import {
  DEFAULT_PAYROLL_STATUTORY, EMPLOYEE_CATEGORIES, PAY_COMPONENT_BY, STARTER_STRUCTURES, STATUTORY_SECTIONS, computePayslip, payrollMonthLabel, stateCodeOf, structureProblem,
} from '@schoolgiant/shared'
import { Employee } from '../models/hrms.js'
import { PayrollAssignment, PayrollLoan, PayrollRun, PayrollStatutory, PayrollStructure, Payslip } from '../models/payroll.js'
import { Tenant } from '../models/platform.js'
import { Branch, Department } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { stamp, todayYmd } from './hrmsCommon.js'

// Payroll setup (ported from the hospital): the institution's statutory rules (PF, ESI, PT, LWF, TDS, gratuity),
// salary structures, which structure each staff member is on from which date (with their own overrides), and staff
// loans and advances. Runs and payslips are in payrollRuns.js; bank and statutory files in payrollExports.js.

const sum = (list, f) => list.reduce((s, x) => s + (f(x) ?? 0), 0)
const rupees = (p) => `₹${Math.round(p / 100)}`
export const monthOfYmd = (ymd) => ymd.slice(0, 7)
export const categoryLabel = (c) => EMPLOYEE_CATEGORIES.find((x) => x.value === c)?.label ?? c
/** Staff on the books in a month (not yet left before it began). */
export const onBooksFilter = (month) => ({ $or: [{ status: { $ne: 'EXITED' } }, { 'exit.lastWorkingDate': { $gte: `${month}-01` } }] })

/** Department and campus names by id. */
export async function orgNames() {
  const [deps, branches] = await Promise.all([Department.find().select('name').lean(), Branch.find().select('name').lean()])
  return { dep: new Map(deps.map((d) => [String(d._id), d.name])), branch: new Map(branches.map((b) => [String(b._id), b.name])) }
}

// ───────────────────────────────────────────────────────── statutory rules

/** The institution's statutory rules; the shipped defaults until someone saves their own. */
export async function getStatutory() {
  let doc = await PayrollStatutory.findOne().lean()
  if (!doc) {
    try {
      await PayrollStatutory.create({ ...structuredClone(DEFAULT_PAYROLL_STATUTORY), updatedBy: 'Defaults' })
    } catch (e) {
      if (e?.code !== 11000) throw e
    }
    doc = await PayrollStatutory.findOne().lean()
  }
  const out = { ...doc }
  // a section added to the defaults after the institution saved theirs still has its values
  for (const k of STATUTORY_SECTIONS) out[k] = { ...structuredClone(DEFAULT_PAYROLL_STATUTORY[k]), ...(doc[k] ?? {}) }
  return out
}

export const statutoryOut = (s) => ({ ...clean(s), verified: s.verified?.at ? s.verified : null, defaults: DEFAULT_PAYROLL_STATUTORY })

export async function saveStatutory(input, auth, req) {
  const before = await getStatutory()
  const set = {}
  const changed = []
  for (const k of [...STATUTORY_SECTIONS, 'payDayBasis', 'separateDuties']) {
    if (input[k] === undefined) continue
    const next = STATUTORY_SECTIONS.includes(k) ? { ...before[k], ...input[k] } : input[k]
    if (JSON.stringify(next) !== JSON.stringify(before[k])) { set[k] = next; changed.push(k) }
  }
  if (set.pt) {
    const codes = set.pt.states.map((s) => s.code)
    if (new Set(codes).size !== codes.length) throw badRequest('A state is listed twice under professional tax.', { fields: { pt: 'Duplicate state' } })
  }
  if (!changed.length && !input.markVerified) return statutoryOut(before)
  if (changed.length) Object.assign(set, { updatedBy: auth.user?.name, verified: null })
  if (input.markVerified) set.verified = { ...stamp(auth), note: input.verifiedNote }
  await PayrollStatutory.updateOne({ _id: before._id }, { $set: set })
  await audit({
    action: 'UPDATE', module: 'payroll', entityType: 'statutory', entityId: String(before._id), entityName: 'Statutory rules',
    summary: [changed.length ? `Changed the payroll statutory rules: ${changed.join(', ')}` : null, input.markVerified ? 'Marked them verified' : null].filter(Boolean).join('. '),
  }, req)
  return statutoryOut(await getStatutory())
}

/** State code of a staff member's place of work: their campus, else the institution, else the default. */
export async function stateResolver(stat) {
  const [branches, tenant] = await Promise.all([Branch.find().select('state isDefault').lean(), Tenant.findById(getContext()?.tenantId).select('profile.state').lean()])
  const byId = new Map(branches.map((b) => [String(b._id), stateCodeOf(b.state)]))
  const home = stateCodeOf(tenant?.profile?.state) ?? stateCodeOf(branches.find((b) => b.isDefault)?.state)
  return (e) => (e.branchId && byId.get(String(e.branchId))) || home || stat.pt.defaultState
}
export const ptStateOf = (stat, code) => stat.pt.states.find((s) => s.code === code) ?? null
export const lwfStateOf = (stat, code) => stat.lwf.states.find((s) => s.code === code) ?? null

// ───────────────────────────────────────────────────────── structures

const structureOut = (s, used = 0) => ({ ...clean(s), assigned: used })

/** The two usual structures (teaching; office and support) to start from. */
export async function ensureStructures() {
  if (await PayrollStructure.exists({})) return
  await PayrollStructure.insertMany(STARTER_STRUCTURES.map((s) => ({ ...s, createdBy: 'Starter' }))).catch((e) => { if (e?.code !== 11000) throw e })
}

export async function listStructures({ all = false } = {}) {
  await ensureStructures()
  const rows = await PayrollStructure.find(all ? {} : { active: true }).sort({ name: 1 }).lean()
  const current = await currentAssignments(await todayYmd())
  const count = new Map()
  for (const a of current.values()) count.set(String(a.structureId), (count.get(String(a.structureId)) ?? 0) + 1)
  return rows.map((s) => structureOut(s, count.get(String(s._id)) ?? 0))
}

export async function saveStructure(id, input, auth, req) {
  const problem = input.components ? structureProblem(input.components) : null
  if (problem) throw badRequest(problem, { fields: { components: problem } })
  let s
  if (id) {
    s = await PayrollStructure.findById(isOid(id) ? id : null)
    if (!s) throw notFound('Salary structure')
  } else {
    if (await PayrollStructure.exists({ code: input.code })) throw conflict('A structure with this code exists.', { fields: { code: 'Taken' } })
    s = new PayrollStructure({ code: input.code, createdBy: auth.user?.name })
  }
  for (const k of ['name', 'description', 'categories', 'components', 'active']) if (input[k] !== undefined) s[k] = input[k]
  s.updatedBy = auth.user?.name
  await s.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'payroll', entityType: 'structure', entityId: String(s._id), entityName: s.code, summary: `${id ? 'Changed' : 'Added'} salary structure ${s.code} — ${s.name}` }, req)
  return structureOut(s.toObject())
}

export async function deleteStructure(id, req) {
  const s = await PayrollStructure.findById(isOid(id) ? id : null)
  if (!s) throw notFound('Salary structure')
  if (await PayrollAssignment.exists({ structureId: s._id }) || await Payslip.exists({ structureId: s._id })) {
    throw conflict('Staff are or have been paid on this structure. Switch it off instead of deleting it.')
  }
  await s.deleteOne()
  await audit({ action: 'DELETE', module: 'payroll', entityType: 'structure', entityId: String(s._id), entityName: s.code, summary: `Deleted salary structure ${s.code} — ${s.name}` }, req)
  return { id: String(s._id) }
}

// ───────────────────────────────────────────────────────── assignments

/** Each person's assignment in force on `date` → Map(employeeId → assignment). */
export async function currentAssignments(date, employeeIds) {
  const filter = { effectiveFrom: { $lte: date } }
  if (employeeIds) filter.employeeId = { $in: employeeIds.map(oid) }
  const rows = await PayrollAssignment.find(filter).sort({ effectiveFrom: 1, createdAt: 1 }).lean()
  const out = new Map()
  for (const a of rows) out.set(String(a.employeeId), a)
  return out
}

/** A structure's components with the person's overrides laid over them. */
export function componentsFor(structure, assignment) {
  const over = new Map((assignment?.overrides ?? []).map((o) => [o.code, o.rule]))
  const out = (structure?.components ?? []).map((c) => (over.has(c.code) ? { code: c.code, rule: over.get(c.code) } : { code: c.code, rule: c.rule }))
  for (const [code, rule] of over) if (!out.some((c) => c.code === code) && rule?.type !== 'NONE') out.push({ code, rule })
  return out
}

/** The pay inputs on the staff member's record and assignment (paise). */
export const payInputs = (e, a) => ({
  gross: a?.grossMonthly ?? e.salary?.grossMonthly ?? 0,
  basic: e.salary?.basicMonthly ?? 0,
  ctcAnnual: e.salary?.ctcAnnual ?? 0,
  pf: e.salary?.pf !== false, pt: e.salary?.pt !== false, gender: e.gender,
})

const empRow = (e, n) => ({
  id: String(e._id), code: e.employeeCode, name: e.name, designation: e.designation ?? null, departmentName: n?.dep.get(String(e.departmentId)) ?? null, category: e.category,
  categoryLabel: categoryLabel(e.category), branchName: n?.branch.get(String(e.branchId)) ?? null, status: e.status, joiningDate: e.joiningDate, lastWorkingDate: e.exit?.lastWorkingDate ?? null,
})

/** A full month's pay for one person (the preview on the staff tab). */
async function monthlyPreview(e, a, s, stat, stateOf, month) {
  const inputs = payInputs(e, a)
  if (!s || !(inputs.gross > 0)) return null
  const state = stateOf(e)
  const r = computePayslip({ month, employee: inputs, components: componentsFor(s, a), stat, ptState: ptStateOf(stat, state), lwfState: null, extras: { tdsMonthly: a?.tdsMonthly } })
  return { ...r, state }
}

/** The staff-tab rows: salary on record, current assignment, and what a full month pays. */
async function assignmentRows(employees, current, today) {
  const [structures, stat, n] = await Promise.all([PayrollStructure.find().lean(), getStatutory(), orgNames()])
  const sById = new Map(structures.map((s) => [String(s._id), s]))
  const stateOf = await stateResolver(stat)
  const out = []
  for (const e of employees) {
    const a = current.get(String(e._id))
    const s = a ? sById.get(String(a.structureId)) : null
    const r = await monthlyPreview(e, a, s, stat, stateOf, today.slice(0, 7))
    out.push({
      employee: empRow(e, n),
      salary: { grossMonthly: e.salary?.grossMonthly ?? null, basicMonthly: e.salary?.basicMonthly ?? null, ctcAnnual: e.salary?.ctcAnnual ?? null, effectiveFrom: e.salary?.effectiveFrom ?? null, pf: e.salary?.pf !== false, esi: !!e.salary?.esi, pt: e.salary?.pt !== false, paymentMode: e.salary?.paymentMode ?? 'BANK' },
      assignment: a ? { id: String(a._id), structureId: String(a.structureId), structureName: s?.name ?? a.structureName, structureCode: s?.code, effectiveFrom: a.effectiveFrom, grossMonthly: a.grossMonthly ?? null, overrides: a.overrides ?? [], tdsMonthly: a.tdsMonthly ?? null, notes: a.notes } : null,
      monthly: r && { gross: r.gross, deductions: r.totalDeductions, net: r.net, employerCost: r.employerCost },
    })
  }
  return out
}

/** Everyone on the books with the structure they are on and what a full month pays (paged). */
export async function listAssignments({ structureId, search, unassigned } = {}, paging) {
  const today = await todayYmd()
  const filter = onBooksFilter(today.slice(0, 7))
  if (search) { const re = new RegExp(escapeRegex(search), 'i'); filter.$and = [{ $or: [{ name: re }, { employeeCode: re }, { designation: re }] }] }
  const light = await Employee.find(filter).select('_id +salary').sort({ name: 1, _id: 1 }).lean()
  const current = await currentAssignments(today, light.map((e) => e._id))
  const match = light.filter((e) => {
    const a = current.get(String(e._id))
    return !(structureId && String(a?.structureId) !== structureId) && !(unassigned && a)
  })
  const ids = match.slice(paging.skip, paging.skip + paging.pageSize).map((e) => e._id)
  const employees = ids.length ? await Employee.find({ _id: { $in: ids } }).select('+salary').sort({ name: 1, _id: 1 }).lean() : []
  return {
    ...listResponse(await assignmentRows(employees, current, today), match.length, paging),
    counts: {
      total: match.length,
      unassigned: match.filter((e) => !current.get(String(e._id))).length,
      noSalary: match.filter((e) => !(current.get(String(e._id))?.grossMonthly ?? e.salary?.grossMonthly)).length,
    },
  }
}

/** One person's assignment history and what the current one pays in a full month. */
export async function assignmentHistory(employeeId) {
  if (!isOid(employeeId)) throw notFound('Staff member')
  const e = await Employee.findById(employeeId).select('+salary').lean()
  if (!e) throw notFound('Staff member')
  const rows = await PayrollAssignment.find({ employeeId: e._id }).sort({ effectiveFrom: -1 }).lean()
  const today = await todayYmd()
  const current = rows.find((a) => a.effectiveFrom <= today)
  let preview = null
  if (current) {
    const [s, stat] = await Promise.all([PayrollStructure.findById(current.structureId).lean(), getStatutory()])
    preview = await monthlyPreview(e, current, s, stat, await stateResolver(stat), today.slice(0, 7))
  }
  return { employee: empRow(e, await orgNames()), salary: e.salary ?? null, history: clean(rows), preview }
}

async function checkAssignment(input, e) {
  const s = await PayrollStructure.findById(input.structureId).lean()
  if (!s) throw badRequest('Pick a salary structure from the list.', { fields: { structureId: 'Unknown' } })
  if (!s.active) throw badRequest('That structure is switched off.', { fields: { structureId: 'Inactive' } })
  const problem = structureProblem(componentsFor(s, input).filter((c) => c.rule?.type !== 'NONE'))
  if (problem) throw badRequest(problem, { fields: { overrides: problem } })
  for (const o of input.overrides ?? []) if (!PAY_COMPONENT_BY[o.code]) throw badRequest(`Unknown component ${o.code}.`, { fields: { overrides: 'Unknown component' } })
  if (!(input.grossMonthly ?? e.salary?.grossMonthly)) throw badRequest(`${e.name} has no monthly gross on their salary record. Enter one here or in Staff & HR.`, { fields: { grossMonthly: 'Required' } })
  return s
}

/** Put a staff member on a structure from a date (a later date makes a revision; the same date replaces it). */
export async function saveAssignment(input, auth, req) {
  if (!isOid(input.employeeId)) throw notFound('Staff member')
  const e = await Employee.findById(input.employeeId).select('+salary').lean()
  if (!e) throw notFound('Staff member')
  const s = await checkAssignment(input, e)
  const paidAfter = await Payslip.findOne({ employeeId: e._id, month: { $gte: monthOfYmd(input.effectiveFrom) }, status: { $in: ['APPROVED', 'PAID'] } }).select('month').sort({ month: -1 }).lean()
  const doc = await PayrollAssignment.findOneAndUpdate(
    { employeeId: e._id, effectiveFrom: input.effectiveFrom },
    { $set: { employeeName: e.name, employeeCode: e.employeeCode, structureId: s._id, structureName: s.name, grossMonthly: input.grossMonthly ?? null, overrides: input.overrides ?? [], tdsMonthly: input.tdsMonthly ?? null, notes: input.notes }, $setOnInsert: { createdBy: auth.user?.name } },
    { upsert: true, new: true, runValidators: true },
  ).lean()
  await audit({
    action: 'UPDATE', module: 'payroll', entityType: 'assignment', entityId: String(doc._id), entityName: e.name,
    summary: `${e.name} on salary structure ${s.code} from ${input.effectiveFrom}${input.grossMonthly ? ` at a gross of ${rupees(input.grossMonthly)}` : ''}${input.overrides?.length ? ` with ${input.overrides.length} override(s)` : ''}${paidAfter ? ' — months already paid get arrears in the next run' : ''}`,
  }, req)
  return { ...clean(doc), arrearsFrom: paidAfter ? input.effectiveFrom : null }
}

/** One structure for many people from the same date. */
export async function bulkAssign({ structureId, employeeIds, effectiveFrom }, auth, req) {
  const out = { assigned: 0, skipped: [] }
  for (const id of employeeIds) {
    try {
      await saveAssignment({ employeeId: id, structureId, effectiveFrom, overrides: [] }, auth)
      out.assigned++
    } catch (e) {
      out.skipped.push({ employeeId: id, reason: e.message })
    }
  }
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'assignment', summary: `Put ${out.assigned} staff member(s) on a salary structure from ${effectiveFrom}${out.skipped.length ? ` (${out.skipped.length} skipped)` : ''}` }, req)
  return out
}

export async function deleteAssignment(id, req) {
  const a = await PayrollAssignment.findById(isOid(id) ? id : null)
  if (!a) throw notFound('Assignment')
  if (await Payslip.exists({ assignmentId: a._id, status: { $in: ['APPROVED', 'PAID'] } })) throw conflict('Salaries have been approved or paid on this assignment. Add a new one from a later date instead.')
  await a.deleteOne()
  await audit({ action: 'DELETE', module: 'payroll', entityType: 'assignment', entityId: String(a._id), entityName: a.employeeName, summary: `Removed ${a.employeeName}’s salary structure from ${a.effectiveFrom}` }, req)
  return { id: String(a._id) }
}

// ───────────────────────────────────────────────────────── loans and advances

export const loanBalance = (l) => Math.max(0, l.amount - sum(l.recoveries ?? [], (r) => r.amount))
const loanOut = (l) => ({ ...clean(l), employeeId: String(l.employeeId), recovered: sum(l.recoveries ?? [], (r) => r.amount), balance: loanBalance(l), instalmentsLeft: l.instalment ? Math.ceil(loanBalance(l) / l.instalment) : null })

export async function listLoans({ status, employeeId } = {}, paging) {
  const filter = {}
  if (status) filter.status = status
  if (isOid(employeeId)) filter.employeeId = oid(employeeId)
  const [rows, total] = await Promise.all([
    PayrollLoan.find(filter).sort({ status: 1, createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    PayrollLoan.countDocuments(filter),
  ])
  return listResponse(rows.map(loanOut), total, paging)
}

export async function createLoan(input, auth, req) {
  if (!isOid(input.employeeId)) throw notFound('Staff member')
  const e = await Employee.findById(input.employeeId).lean()
  if (!e) throw notFound('Staff member')
  if (e.status === 'EXITED') throw conflict(`${e.name} has left.`)
  if (input.instalment > input.amount) throw badRequest('The instalment is more than the loan.', { fields: { instalment: 'Too high' } })
  const loan = await PayrollLoan.create({
    loanNo: await nextNumber('PAYROLL_LOAN'), employeeId: e._id, employeeName: e.name, employeeCode: e.employeeCode,
    type: input.type, amount: input.amount, instalment: input.instalment, startMonth: input.startMonth, disbursedOn: input.disbursedOn, reason: input.reason,
    skipMonths: input.skipMonths ?? [], createdBy: auth.user?.name,
  })
  await audit({ action: 'CREATE', module: 'payroll', entityType: 'loan', entityId: String(loan._id), entityName: loan.loanNo, summary: `${input.type === 'ADVANCE' ? 'Salary advance' : 'Loan'} ${loan.loanNo} of ${rupees(input.amount)} to ${e.name}, ${rupees(input.instalment)} a month from ${payrollMonthLabel(input.startMonth)}` }, req)
  return loanOut(loan.toObject())
}

export async function updateLoan(id, input, auth, req) {
  const l = await PayrollLoan.findById(isOid(id) ? id : null)
  if (!l) throw notFound('Loan')
  if (l.status !== 'ACTIVE') throw conflict('This loan is closed.')
  if (input.instalment !== undefined && input.instalment > l.amount) throw badRequest('The instalment is more than the loan.', { fields: { instalment: 'Too high' } })
  for (const k of ['instalment', 'startMonth', 'skipMonths', 'reason']) if (input[k] !== undefined) l[k] = input[k]
  await l.save()
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'loan', entityId: String(l._id), entityName: l.loanNo, summary: `Changed loan ${l.loanNo} of ${l.employeeName}` }, req)
  return loanOut(l.toObject())
}

/** Close a loan (settled outside payroll) or cancel one nothing was recovered on. */
export async function closeLoan(id, { note, cancel }, auth, req) {
  const l = await PayrollLoan.findById(isOid(id) ? id : null)
  if (!l) throw notFound('Loan')
  if (l.status !== 'ACTIVE') throw conflict('This loan is already closed.')
  if (cancel && l.recoveries.length) throw conflict('Instalments have been recovered on this loan; close it instead.')
  if (await Payslip.exists({ 'loans.loanId': l._id, status: { $in: ['CALCULATED', 'APPROVED'] } })) throw conflict('A payroll run that is not yet paid recovers an instalment of this loan. Reopen or pay that run first.')
  l.status = cancel ? 'CANCELLED' : 'CLOSED'
  l.closed = { ...stamp(auth), note }
  await l.save()
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'loan', entityId: String(l._id), entityName: l.loanNo, summary: `${cancel ? 'Cancelled' : 'Closed'} loan ${l.loanNo} of ${l.employeeName}${note ? ` — ${note}` : ''}` }, req)
  return loanOut(l.toObject())
}

// ───────────────────────────────────────────────────────── pickers and meta

/** Staff to pick from in payroll screens — names only, no salaries. */
export async function payrollEmployeeOptions() {
  const today = await todayYmd()
  const rows = await Employee.find(onBooksFilter(today.slice(0, 7))).select('employeeCode name designation category status').sort({ name: 1 }).limit(3000).lean()
  return rows.map((e) => ({ id: String(e._id), code: e.employeeCode, name: e.name, designation: e.designation ?? null, category: e.category, status: e.status }))
}

export async function payrollMeta() {
  await ensureStructures()
  const [branches, structures, stat, today, lastRun] = await Promise.all([
    Branch.find().select('name code state isDefault').sort({ isDefault: -1, name: 1 }).lean(),
    PayrollStructure.find({ active: true }).select('code name categories').sort({ name: 1 }).lean(),
    getStatutory(), todayYmd(), PayrollRun.findOne().sort({ month: -1 }).select('month status').lean(),
  ])
  return {
    today, month: today.slice(0, 7),
    branches: branches.map((b) => ({ id: String(b._id), name: b.name, code: b.code ?? null, state: b.state ?? null, isDefault: !!b.isDefault })),
    structures: clean(structures),
    statutory: { verified: stat.verified?.at ? stat.verified : null, payDayBasis: stat.payDayBasis, separateDuties: stat.separateDuties, defaultState: stat.pt.defaultState, financialYear: stat.tds.financialYear },
    lastRun: lastRun ? { month: lastRun.month, status: lastRun.status } : null,
  }
}
