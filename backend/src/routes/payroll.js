import { Router } from 'express'
import { ELECTRONIC_PAY_MODES, EMPLOYEE_CATEGORIES, LOAN_STATUSES, LOAN_TYPES, PAY_ADJUSTMENT_CODES, PAY_COMPONENTS, PAY_DAY_BASES, PAYROLL_PAY_MODES, PAYROLL_RUN_STATUSES, PCT_BASES } from '@schoolgiant/shared'
import { badRequest } from '../platform/errors.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  assignmentHistory, bulkAssign, closeLoan, createLoan, deleteAssignment, deleteStructure, getStatutory, listAssignments, listLoans, listStructures,
  payrollEmployeeOptions, payrollMeta, saveAssignment, saveStatutory, saveStructure, statutoryOut, updateLoan,
} from '../services/payroll.js'
import { EXPORTS, exportFile, exportOptions } from '../services/payrollExports.js'
import {
  addAdjustment, approveRun, calculateRun, createRun, editLop, listPayslips, listRuns, myPayslip, myPayslips, payRun, payslipDetail, payslipPrint,
  removeAdjustment, reopenRun, runDetail,
} from '../services/payrollRuns.js'
import { renderData } from '../services/documents.js'

// Payroll: /api/v1/payroll — statutory rules, salary structures and assignments, loans, monthly runs, payslips and the
// bank / statutory files. Run and payslip statuses, computed amounts and the tenant are never taken from a request
// body: the actions below move and work them out. `/me/*` is self-service — no payroll permission, and only the
// caller's own released payslips.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('payroll'))

const values = (list) => list.map((x) => x.value)
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const paise = z.coerce.number().int().min(0).max(1e11)
const pct = z.coerce.number().min(0).max(100)
const id = (req) => objectId.parse(req.params.id)
const ANY = ['structures', 'statutory', 'loans', 'runs', 'payslips', 'exports'].map((p) => `payroll.${p}.view`)
const COMPONENT_CODES = PAY_COMPONENTS.map((c) => c.code)

const rule = z.object({
  type: z.enum(['EMPLOYEE', 'FIXED', 'PCT', 'BALANCE', 'STATUTORY', 'LOANS', 'NONE']),
  of: z.enum(values(PCT_BASES)).optional(), pct: pct.optional(), amount: paise.optional(),
}).transform((r) => ({ type: r.type, ...(r.type === 'PCT' && { of: r.of ?? 'BASIC', pct: r.pct ?? 0 }), ...(r.type === 'FIXED' && { amount: r.amount ?? 0 }) }))
const component = z.object({ code: z.enum(COMPONENT_CODES), rule })

router.get('/meta', requirePermission(...ANY), async (req, res) => { res.json({ data: await payrollMeta() }) })
router.get('/employees/options', requirePermission(...ANY), async (req, res) => { res.json({ data: await payrollEmployeeOptions() }) })

// ───────────────────────────────────────────────────────── statutory rules

const slab = z.object({ from: paise, amount: paise, febAmount: paise.optional().nullable() })
const stateCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Two-letter state code')
const statutory = z.object({
  pf: z.object({ employeePct: pct, employerPct: pct, epsPct: pct, edliPct: pct, adminPct: pct, wageCeiling: paise, restrictToCeiling: z.boolean() }).partial(),
  esi: z.object({ employeePct: pct, employerPct: pct, grossCeiling: paise }).partial(),
  pt: z.object({
    defaultState: stateCode,
    states: z.array(z.object({
      code: stateCode, name: z.string().trim().min(2).max(60), period: z.enum(['MONTH', 'HALF_YEAR']).default('MONTH'),
      months: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(), slabs: z.array(slab).min(1).max(20), femaleSlabs: z.array(slab).max(20).optional(),
    })).max(40),
  }).partial(),
  lwf: z.object({ states: z.array(z.object({ code: stateCode, name: z.string().trim().min(2).max(60), months: z.array(z.coerce.number().int().min(1).max(12)).min(1).max(12), employee: paise, employer: paise })).max(40) }),
  tds: z.object({
    regime: z.enum(['NEW']), financialYear: z.string().trim().regex(/^\d{4}-\d{2}$/, 'e.g. 2026-27'), standardDeduction: paise,
    slabs: z.array(z.object({ upTo: paise.nullable(), pct })).min(1).max(12), rebateUpTo: paise, rebateMax: paise, marginalRelief: z.boolean(), cessPct: pct,
    surcharge: z.array(z.object({ above: paise, pct })).max(6),
  }).partial(),
  gratuity: z.object({ minYears: z.coerce.number().min(0).max(10), factor: z.coerce.number().min(1).max(60), divisor: z.coerce.number().min(1).max(31), cap: paise }).partial(),
  encashment: z.object({ leaveCodes: z.array(z.string().trim().toUpperCase().max(8)).max(10), divisor: z.coerce.number().min(1).max(31) }).partial(),
  notice: z.object({ days: z.coerce.number().int().min(0).max(180) }).partial(),
  payDayBasis: z.enum(values(PAY_DAY_BASES)),
  separateDuties: z.boolean(),
  markVerified: z.boolean(), verifiedNote: optionalText(300),
}).partial()

router.get('/statutory', requirePermission('payroll.statutory.view', 'payroll.runs.view'), async (req, res) => { res.json({ data: statutoryOut(await getStatutory()) }) })
router.put('/statutory', requirePermission('payroll.statutory.edit'), async (req, res) => { res.json({ data: await saveStatutory(statutory.parse(req.body), req.auth, req) }) })

// ───────────────────────────────────────────────────────── structures and assignments

const structure = z.object({
  name: z.string().trim().min(2, 'Name it').max(80), description: optionalText(300),
  categories: z.array(z.enum(values(EMPLOYEE_CATEGORIES))).max(10).default([]),
  components: z.array(component).min(1).max(30),
  active: z.boolean().default(true),
})
router.get('/structures', requirePermission('payroll.structures.view'), async (req, res) => { res.json({ data: await listStructures({ all: req.query.all === '1' }) }) })
router.post('/structures', requirePermission('payroll.structures.create'), async (req, res) => {
  const body = structure.extend({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/, '2–12 letters or digits') }).parse(req.body)
  res.status(201).json({ data: await saveStructure(null, body, req.auth, req) })
})
router.put('/structures/:id', requirePermission('payroll.structures.edit'), async (req, res) => { res.json({ data: await saveStructure(id(req), structure.partial().parse(req.body), req.auth, req) }) })
router.delete('/structures/:id', requirePermission('payroll.structures.delete'), async (req, res) => { res.json({ data: await deleteStructure(id(req), req) }) })

const assignment = z.object({
  employeeId: objectId, structureId: objectId, effectiveFrom: ymd,
  grossMonthly: paise.nullable().optional(), overrides: z.array(component).max(30).default([]), tdsMonthly: paise.nullable().optional(), notes: optionalText(300),
})
router.get('/assignments', requirePermission('payroll.structures.view'), async (req, res) => {
  const q = z.object({ structureId: objectId.optional(), search: optionalText(60), unassigned: z.enum(['1', '0']).optional() }).parse(req.query)
  res.json(await listAssignments({ ...q, unassigned: q.unassigned === '1' }, pageParams(req.query)))
})
router.get('/assignments/:id', requirePermission('payroll.structures.view'), async (req, res) => { res.json({ data: await assignmentHistory(id(req)) }) })
router.post('/assignments', requirePermission('payroll.structures.create', 'payroll.structures.edit'), async (req, res) => { res.status(201).json({ data: await saveAssignment(assignment.parse(req.body), req.auth, req) }) })
router.post('/assignments/bulk', requirePermission('payroll.structures.create', 'payroll.structures.edit'), async (req, res) => {
  res.json({ data: await bulkAssign(z.object({ structureId: objectId, employeeIds: z.array(objectId).min(1).max(1000), effectiveFrom: ymd }).parse(req.body), req.auth, req) })
})
router.delete('/assignments/:id', requirePermission('payroll.structures.delete', 'payroll.structures.edit'), async (req, res) => { res.json({ data: await deleteAssignment(id(req), req) }) })

// ───────────────────────────────────────────────────────── loans and advances

router.get('/loans', requirePermission('payroll.loans.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(LOAN_STATUSES)).optional(), employeeId: objectId.optional() }).parse(req.query)
  res.json(await listLoans(q, pageParams(req.query)))
})
router.post('/loans', requirePermission('payroll.loans.create'), async (req, res) => {
  const body = z.object({
    employeeId: objectId, type: z.enum(values(LOAN_TYPES)).default('ADVANCE'), amount: paise.refine((n) => n > 0, 'Enter the amount'), instalment: paise.refine((n) => n > 0, 'Enter the instalment'),
    startMonth: ym, disbursedOn: ymd.optional(), reason: z.string().trim().min(3, 'Say what it is for').max(300), skipMonths: z.array(ym).max(24).default([]),
  }).parse(req.body)
  res.status(201).json({ data: await createLoan(body, req.auth, req) })
})
router.put('/loans/:id', requirePermission('payroll.loans.edit'), async (req, res) => {
  const body = z.object({ instalment: paise.refine((n) => n > 0).optional(), startMonth: ym.optional(), skipMonths: z.array(ym).max(24).optional(), reason: optionalText(300) }).parse(req.body)
  res.json({ data: await updateLoan(id(req), body, req.auth, req) })
})
router.post('/loans/:id/close', requirePermission('payroll.loans.edit'), async (req, res) => {
  const body = z.object({ note: z.string().trim().min(3, 'Say why').max(300), cancel: z.boolean().default(false) }).parse(req.body)
  res.json({ data: await closeLoan(id(req), body, req.auth, req) })
})

// ───────────────────────────────────────────────────────── runs

router.get('/runs', requirePermission('payroll.runs.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(PAYROLL_RUN_STATUSES)).optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query)
  res.json(await listRuns(q, req.auth, pageParams(req.query)))
})
router.get('/runs/:id', requirePermission('payroll.runs.view'), async (req, res) => { res.json({ data: await runDetail(id(req), req.auth) }) })
router.post('/runs', requirePermission('payroll.runs.create'), async (req, res) => {
  const body = z.object({ month: ym, branchId: objectId.optional().nullable().or(z.literal('').transform(() => null)), notes: optionalText(300) }).parse(req.body)
  res.status(201).json({ data: await createRun(body, req.auth, req) })
})
router.post('/runs/:id/calculate', requirePermission('payroll.runs.calculate'), async (req, res) => { res.json({ data: await calculateRun(id(req), req.auth, req) }) })
router.post('/runs/:id/reopen', requirePermission('payroll.runs.calculate'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) }).parse(req.body ?? {})
  res.json({ data: await reopenRun(id(req), reason, req.auth, req) })
})
router.post('/runs/:id/approve', requirePermission('payroll.runs.approve'), async (req, res) => {
  const { note } = z.object({ note: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await approveRun(id(req), note, req.auth, req) })
})
router.post('/runs/:id/pay', requirePermission('payroll.runs.pay'), async (req, res) => {
  const body = z.object({ date: ymd, mode: z.enum(values(PAYROLL_PAY_MODES)), reference: optionalText(40), note: optionalText(300) }).parse(req.body ?? {})
  if (ELECTRONIC_PAY_MODES.includes(body.mode) && !body.reference) throw badRequest('Enter the UTR / bank reference of the transfer.', { fields: { reference: 'Required' } })
  res.json({ data: await payRun(id(req), body, req.auth, req) })
})

// ───────────────────────────────────────────────────────── payslips

router.get('/payslips', requirePermission('payroll.payslips.view'), async (req, res) => {
  res.json(await listPayslips(z.object({ runId: objectId.optional(), month: ym.optional(), search: optionalText(60) }).parse(req.query), pageParams(req.query)))
})
router.get('/payslips/:id', requirePermission('payroll.payslips.view'), async (req, res) => { res.json({ data: await payslipDetail(id(req)) }) })
router.post('/payslips/:id/lop', requirePermission('payroll.payslips.edit_lop'), async (req, res) => {
  const body = z.object({
    days: z.coerce.number().min(0).max(31).refine((n) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-9, 'Whole or half days').nullable(),
    reason: z.string().trim().min(3, 'Say why the LOP changes').max(300),
  }).parse(req.body ?? {})
  res.json({ data: await editLop(id(req), body, req.auth, req) })
})
router.post('/payslips/:id/adjustments', requirePermission('payroll.runs.calculate'), async (req, res) => {
  const body = z.object({ code: z.enum(values(PAY_ADJUSTMENT_CODES)), label: optionalText(60), amount: paise.refine((n) => n > 0, 'Enter the amount'), note: z.string().trim().min(3, 'Say what it is for').max(300) }).parse(req.body)
  res.status(201).json({ data: await addAdjustment(id(req), body, req.auth, req) })
})
router.delete('/payslips/:id/adjustments/:index', requirePermission('payroll.runs.calculate'), async (req, res) => {
  res.json({ data: await removeAdjustment(id(req), z.coerce.number().int().min(0).max(50).parse(req.params.index), req.auth, req) })
})

// ───────────────────────────────────────────────────────── exports

router.get('/runs/:id/exports', requirePermission('payroll.exports.view'), async (req, res) => { res.json({ data: await exportOptions(id(req)) }) })
router.get('/runs/:id/exports/:kind', requirePermission('payroll.exports.export'), async (req, res) => {
  const kind = z.enum(Object.keys(EXPORTS)).parse(req.params.kind)
  const f = await exportFile(id(req), kind, req)
  res.setHeader('Content-Type', f.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`)
  res.setHeader('X-Rows', String(f.count))
  res.setHeader('X-Skipped', String(f.skipped.length))
  res.setHeader('Access-Control-Expose-Headers', 'X-Rows, X-Skipped, Content-Disposition')
  res.send(f.body)
})

// ───────────────────────────────────────────────────────── self-service (/me)

const html = (res, page) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.send(page) }
router.get('/me/payslips', async (req, res) => { res.json({ data: await myPayslips(req.auth) }) })
router.get('/me/payslips/:id', async (req, res) => { res.json({ data: await myPayslip(id(req), req.auth) }) })
router.get('/me/payslips/:id/print', async (req, res) => {
  html(res, await renderData('PAYSLIP', await payslipPrint(id(req), req.auth, { own: true }), { autoPrint: req.query.print !== '0' }))
})

export default router
