import {
  PAYROLL_PAY_MODE_LABEL, PAYROLL_RUN_ACTIONS, PAYROLL_RUN_STATUSES, computePayslip, daysInclusive, esiPeriodOf, fixedEarnings, gratuityFor, lineAmount,
  monthEndOf, payrollMonthLabel, payrollYearOf, roundToRupee,
} from '@schoolgiant/shared'
import { Employee, LeaveLedger } from '../models/hrms.js'
import { PayrollLoan, PayrollRun, PayrollStructure, Payslip } from '../models/payroll.js'
import { Tenant } from '../models/platform.js'
import { Branch } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid, oid, withTransaction } from '../platform/db.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { listResponse } from '../platform/validate.js'
import { payrollAttendance } from './hrmsAttendance.js'
import { myEmployee, stamp, todayYmd } from './hrmsCommon.js'
import { ensureCredits } from './hrmsLeave.js'
import { notifyUsers } from './notify.js'
import { componentsFor, currentAssignments, getStatutory, loanBalance, lwfStateOf, orgNames, payInputs, ptStateOf, stateResolver } from './payroll.js'

// Payroll runs (ported from the hospital): one run per month for the whole institution or one campus,
//   DRAFT → calculate → CALCULATED → approve → APPROVED → pay → PAID   (reopen: CALCULATED → DRAFT)
// Calculating reads the month's staff attendance from Staff & HR (loss of pay, with half days and unpaid leave) and
// works each payslip out with the shared engine (computePayslip). Recalculating replaces the payslips but keeps their
// numbers, LOP corrections and manual lines, so it can run any number of times. The person who prepared a run cannot
// approve it, and the approver cannot record its payment (Statutory rules › separation of duties). Loan instalments
// are booked against the loans only on payment.

const sum = (list, f) => list.reduce((s, x) => s + (f(x) ?? 0), 0)
const fmt = (p) => `₹${Math.round(p / 100)}`
const SOD = 'SEPARATION_OF_DUTIES'

function assertAction(run, action) {
  if (!PAYROLL_RUN_ACTIONS[action].includes(run.status)) {
    throw new AppError(409, `This run is ${PAYROLL_RUN_STATUSES[run.status]?.label.toLowerCase() ?? run.status}; it cannot be ${{ calculate: 'calculated', reopen: 'reopened', approve: 'approved', pay: 'paid' }[action]} now.`, { code: 'INVALID_TRANSITION' })
  }
}

async function findRun(id) {
  const run = await PayrollRun.findById(isOid(id) ? id : null)
  if (!run) throw notFound('Payroll run')
  return run
}

// ───────────────────────────────────────────────────────── runs

export async function createRun({ month, branchId, notes }, auth, req) {
  const today = await todayYmd()
  if (month > today.slice(0, 7)) throw badRequest('That month has not started yet.', { fields: { month: 'In the future' } })
  let branch = null
  if (branchId) {
    branch = await Branch.findById(branchId).lean()
    if (!branch) throw badRequest('Pick a campus from the list.', { fields: { branchId: 'Unknown' } })
  }
  const scopeKey = branch ? String(branch._id) : 'ALL'
  const same = await PayrollRun.findOne({ month, scopeKey }).lean()
  if (same) throw conflict(`There is already a ${payrollMonthLabel(month)} run${branch ? ` for ${branch.name}` : ''} (${same.runNo}).`, { runId: String(same._id) })
  const clash = await PayrollRun.findOne({ month, scopeKey: branch ? 'ALL' : { $ne: 'ALL' } }).lean()
  if (clash) throw conflict(branch ? `${payrollMonthLabel(month)} is already run for the whole institution (${clash.runNo}).` : `${payrollMonthLabel(month)} already has campus runs (${clash.runNo}). Run the other campuses separately.`, { runId: String(clash._id) })
  const run = await PayrollRun.create({ runNo: await nextNumber('PAYROLL_RUN', { date: new Date(`${month}-15T06:30:00Z`) }), month, branchId: branch?._id, branchName: branch?.name, scopeKey, status: 'DRAFT', created: stamp(auth), notes })
  await audit({ action: 'CREATE', module: 'payroll', entityType: 'payroll-run', entityId: String(run._id), entityName: run.runNo, summary: `Started the ${payrollMonthLabel(month)} payroll run ${run.runNo}${branch ? ` for ${branch.name}` : ''}` }, req)
  return runOut(run.toObject(), auth)
}

function runOut(r, auth) {
  return {
    ...clean(r), statusLabel: PAYROLL_RUN_STATUSES[r.status]?.label, monthLabel: payrollMonthLabel(r.month),
    preparedByMe: (r.preparers ?? []).some((x) => String(x) === String(auth?.userId)),
    approvedByMe: String(r.approved?.byId ?? '') === String(auth?.userId),
  }
}

/** One page plus a summary: the latest paid run and how many wait for approval / payment. */
export async function listRuns({ status, year } = {}, auth, paging) {
  const filter = {}
  if (status) filter.status = status
  if (year) filter.month = { $gte: `${year}-01`, $lte: `${year}-12` }
  const sort = { month: -1, createdAt: -1 }
  const base = { ...filter }
  delete base.status
  const [rows, total, lastPaid, waiting, toPay] = await Promise.all([
    PayrollRun.find(filter).sort({ ...sort, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    PayrollRun.countDocuments(filter),
    PayrollRun.findOne({ ...base, status: 'PAID' }).sort(sort).lean(),
    PayrollRun.countDocuments({ ...base, status: 'CALCULATED' }),
    PayrollRun.countDocuments({ ...base, status: 'APPROVED' }),
  ])
  return { ...listResponse(rows.map((r) => runOut(r, auth)), total, paging), summary: { lastPaid: lastPaid ? runOut(lastPaid, auth) : null, waiting, toPay } }
}

const payslipRow = (p) => ({
  id: String(p._id), payslipNo: p.payslipNo, employeeId: String(p.employeeId), code: p.employee?.code, name: p.employee?.name, designation: p.employee?.designation,
  departmentName: p.employee?.departmentName, branchName: p.employee?.branchName, structureName: p.structureName, paymentMode: p.employee?.paymentMode,
  payDays: p.attendance?.payDays, baseDays: p.attendance?.baseDays, lop: p.attendance?.lop, unmarked: p.attendance?.unmarked ?? 0, lopEdited: p.lopOverride?.days !== undefined && p.lopOverride?.days !== null,
  gross: p.gross, deductions: p.totalDeductions, net: p.net, employerCost: p.employerCost, warnings: p.warnings ?? [], fnf: !!p.fnf?.lastWorkingDate, status: p.status,
})

export async function runDetail(id, auth) {
  const run = await findRun(id)
  const payslips = await Payslip.find({ runId: run._id }).sort({ 'employee.name': 1 }).lean()
  return { ...runOut(run.toObject(), auth), payslips: payslips.map(payslipRow) }
}

// ───────────────────────────────────────────────────────── the calculation

async function runEmployees(run, employeeIds) {
  const filter = { joiningDate: { $lte: monthEndOf(run.month) }, $or: [{ 'exit.lastWorkingDate': null }, { 'exit.lastWorkingDate': { $gte: `${run.month}-01` } }] }
  if (run.branchId) {
    const b = await Branch.findById(run.branchId).select('isDefault').lean()
    filter.branchId = b?.isDefault ? { $in: [run.branchId, null] } : run.branchId
  }
  if (employeeIds) filter._id = { $in: employeeIds.map(oid) }
  return Employee.find(filter).select('+salary +statutory +bank').sort({ name: 1 }).lean()
}

/** Full and final settlement for someone whose last working day falls in the month. */
async function fnfFor(e, month, fullOf, grossFull, stat) {
  const lwd = e.exit?.lastWorkingDate
  if (!lwd || lwd.slice(0, 7) !== month) return null
  const basicDa = (fullOf.BASIC ?? 0) + (fullOf.DA ?? 0)
  try { await ensureCredits(e, lwd) } catch { /* the balance as it stands */ }
  const codes = stat.encashment.leaveCodes ?? []
  const [bal] = codes.length ? await LeaveLedger.aggregate([{ $match: { employeeId: e._id, leaveCode: { $in: codes } } }, { $group: { _id: null, days: { $sum: '$days' } } }]) : []
  const leaveDays = Math.max(0, Math.round((bal?.days ?? 0) * 100) / 100)
  const leaveEncashment = roundToRupee((leaveDays * basicDa) / (stat.encashment.divisor || 30))
  const g = gratuityFor({ joiningDate: e.joiningDate, lastWorkingDate: lwd, basicDaMonthly: basicDa, exitType: e.exit?.type }, stat.gratuity)
  let noticeServed = null
  let noticeShortfall = 0
  if (e.exit?.type === 'RESIGNED' && e.exit?.noticeDate) {
    noticeServed = daysInclusive(e.exit.noticeDate, lwd)
    noticeShortfall = Math.max(0, (stat.notice.days ?? 0) - noticeServed)
  }
  const noticeRecovery = roundToRupee((grossFull * noticeShortfall) / 30)
  return {
    lastWorkingDate: lwd, exitType: e.exit?.type, leaveDays, leaveEncashment, gratuity: g.amount, serviceYears: Math.round(g.exact * 100) / 100, countedYears: g.eligible ? g.counted : 0,
    noticeDays: stat.notice.days, noticeServed, noticeShortfall, noticeRecovery,
    encashmentBasis: `${leaveDays} day(s) × ${fmt(basicDa)} ÷ ${stat.encashment.divisor}`,
    gratuityBasis: g.eligible ? `${stat.gratuity.factor}/${stat.gratuity.divisor} × ${fmt(basicDa)} × ${g.counted} year(s)` : undefined,
    noticeBasis: noticeShortfall ? `${noticeShortfall} day(s) short of ${stat.notice.days} × ${fmt(grossFull)} ÷ 30` : undefined,
    note: !g.eligible && basicDa ? `No gratuity: ${g.years} year(s) ${g.months} month(s) of service (needs ${stat.gratuity.minYears}).` : undefined,
  }
}

const last4 = (s) => s?.last4 ?? null

/** Work out the payslips of a run (all its staff, or some) without saving them. → { docs, exceptions } */
async function buildPayslips(run, { employeeIds } = {}) {
  const month = run.month
  const end = monthEndOf(month)
  const [employees, stat, n] = await Promise.all([runEmployees(run, employeeIds), getStatutory(), orgNames()])
  const ids = employees.map((e) => e._id)
  const [assignments, structures, existing, stateOf] = await Promise.all([
    currentAssignments(end, ids), PayrollStructure.find().lean(), Payslip.find({ runId: run._id, employeeId: { $in: ids } }).lean(), stateResolver(stat),
  ])
  const sById = new Map(structures.map((s) => [String(s._id), s]))
  const prevBy = new Map(existing.map((p) => [String(p.employeeId), p]))
  const exceptions = []
  const payable = []
  for (const e of employees) {
    const a = assignments.get(String(e._id))
    const s = a ? sById.get(String(a.structureId)) : null
    const why = !a ? 'No salary structure assigned' : !s ? 'Its salary structure was deleted' : !(payInputs(e, a).gross > 0) ? 'No monthly gross on the salary record' : null
    if (why) exceptions.push({ employeeId: e._id, employeeName: e.name, employeeCode: e.employeeCode, reason: why })
    else payable.push({ e, a, s })
  }
  if (!payable.length) return { docs: [], exceptions }

  const pIds = payable.map((x) => x.e._id)
  const fy = payrollYearOf(month)
  const esiP = esiPeriodOf(month)
  const [attendance, loans, history] = await Promise.all([
    payrollAttendance(payable.map((x) => x.e), month),
    PayrollLoan.find({ employeeId: { $in: pIds }, status: 'ACTIVE', startMonth: { $lte: month } }).lean(),
    Payslip.find({ employeeId: { $in: pIds }, runId: { $ne: run._id }, month: { $gte: [fy.start, esiP.start].sort()[0], $lt: month }, status: { $in: ['APPROVED', 'PAID'] } })
      .select('employeeId month status gross net deductions attendance fixedEarned arrearsFor calculatedAt').lean(),
  ])
  const histBy = new Map()
  for (const p of history) { const k = String(p.employeeId); if (!histBy.has(k)) histBy.set(k, []); histBy.get(k).push(p) }

  const docs = []
  for (const { e, a, s } of payable) {
    const k = String(e._id)
    const prev = prevBy.get(k)
    const components = componentsFor(s, a)
    const inputs = payInputs(e, a)
    const att = attendance.get(k)
    const lopAuto = att.lop
    const override = prev?.lopOverride?.days
    const lop = override !== undefined && override !== null ? override : lopAuto
    const state = stateOf(e)
    const fullOf = Object.fromEntries(fixedEarnings(components, inputs).map((f) => [f.code, f.full]))
    const grossFull = Object.values(fullOf).reduce((x, y) => x + y, 0)
    const past = histBy.get(k) ?? []

    // arrears: a revision recorded after a month was paid, effective from that month or earlier
    const arrears = []
    const revisions = [{ from: a.effectiveFrom, at: a.updatedAt ?? a.createdAt }]
    if (!a.grossMonthly && e.salary?.effectiveFrom) revisions.push({ from: e.salary.effectiveFrom, at: e.salary.revisedAt })
    const revisedIn = (p) => revisions.some((rv) => rv.from && rv.at && p.month >= rv.from.slice(0, 7) && +new Date(p.calculatedAt ?? 0) < +new Date(rv.at))
    for (const p of past.filter((x) => x.status === 'PAID' && x.month < month && revisedIn(x)).sort((x, y) => x.month.localeCompare(y.month))) {
      const f = p.attendance?.baseDays ? (p.attendance.payDays ?? 0) / p.attendance.baseDays : 0
      const now = sum(fixedEarnings(components, inputs), (x) => roundToRupee(x.full * f))
      const already = sum(past.filter((x) => String(x._id) !== String(p._id)), (x) => sum(x.arrearsFor ?? [], (y) => (y.month === p.month ? y.amount : 0)))
      const diff = roundToRupee(now - (p.fixedEarned ?? 0) - already)
      if (diff >= 100) arrears.push({ month: p.month, amount: diff })
    }
    // loan instalments due this month
    const myLoans = loans.filter((l) => String(l.employeeId) === k && !(l.skipMonths ?? []).includes(month) && !(l.recoveries ?? []).some((r) => r.month === month))
      .map((l) => ({ loanId: l._id, amount: Math.min(l.instalment, loanBalance(l)), label: `${l.type === 'ADVANCE' ? 'Advance' : 'Loan'} ${l.loanNo}` })).filter((l) => l.amount > 0)
    const fnf = await fnfFor(e, month, fullOf, grossFull, stat)
    const esiContinuing = past.some((p) => p.month >= esiP.start && lineAmount(p.deductions, 'ESI') > 0)
    const adjustments = prev?.adjustments ?? []

    const r = computePayslip({
      month, employee: inputs, components, stat, ptState: ptStateOf(stat, state), lwfState: lwfStateOf(stat, state),
      attendance: { lop, notEmployedDays: att.notEmployedDays },
      extras: { arrears, adjustments, loans: myLoans, fnf: fnf ?? undefined, tdsMonthly: a.tdsMonthly, esiContinuing },
    })
    const warnings = [...r.warnings]
    if (att.unmarked) warnings.push(`${att.unmarked} working day(s) have no attendance marked and are counted as paid.`)
    if ((e.salary?.paymentMode ?? 'BANK') === 'BANK' && !e.bank?.account?.enc) warnings.push('No bank account on record.')
    if (fnf?.note) warnings.push(fnf.note)
    const ytdPast = past.filter((p) => p.month >= fy.start)
    const ded = (code) => lineAmount(r.deductions, code) + sum(ytdPast, (p) => lineAmount(p.deductions, code))
    docs.push({
      runId: run._id, runNo: run.runNo, month, employeeId: e._id, userId: e.userId ?? null,
      employee: {
        code: e.employeeCode, name: e.name, designation: e.designation, departmentName: n.dep.get(String(e.departmentId)) ?? null, branchId: e.branchId ?? null, branchName: n.branch.get(String(e.branchId)) ?? null,
        category: e.category, gender: e.gender, joiningDate: e.joiningDate, lastWorkingDate: e.exit?.lastWorkingDate ?? null, exitType: e.exit?.type ?? null, paymentMode: e.salary?.paymentMode ?? 'BANK',
        pan: last4(e.statutory?.pan), uan: last4(e.statutory?.uan), esi: last4(e.statutory?.esi),
        bankName: e.bank?.bankName, ifsc: e.bank?.ifsc, accountLast4: e.bank?.account?.last4 ?? null,
      },
      structureId: s._id, structureName: s.name, assignmentId: a._id, grossMonthly: inputs.gross, state,
      attendance: { ...att, lopAuto, lop, baseDays: r.baseDays, payDays: r.payDays },
      lopOverride: prev?.lopOverride ?? null, adjustments,
      earnings: r.earnings, deductions: r.deductions, employer: r.employer, loans: r.loans,
      arrearsFor: arrears.filter((x) => r.earnings.some((y) => y.code === 'ARREARS' && y.month === x.month)),
      fnf: fnf ? { lastWorkingDate: fnf.lastWorkingDate, exitType: fnf.exitType, leaveDays: fnf.leaveDays, leaveEncashment: fnf.leaveEncashment, gratuity: fnf.gratuity, serviceYears: fnf.serviceYears, countedYears: fnf.countedYears, noticeDays: fnf.noticeDays, noticeServed: fnf.noticeServed, noticeShortfall: fnf.noticeShortfall, noticeRecovery: fnf.noticeRecovery, note: fnf.note } : null,
      gross: r.gross, totalDeductions: r.totalDeductions, net: r.net, employerContribution: r.employerContribution, employerCost: r.employerCost,
      fixedFull: r.fixedFull, fixedEarned: r.fixedEarned, pfWages: r.pfWages, esiWages: r.esiWages,
      ytd: { gross: r.gross + sum(ytdPast, (p) => p.gross), net: r.net + sum(ytdPast, (p) => p.net), pf: ded('PF'), esi: ded('ESI'), pt: ded('PT'), tds: ded('TDS') },
      warnings, calculatedAt: new Date(),
    })
  }
  return { docs, exceptions }
}

/** Run totals from its payslips. */
async function refreshTotals(runId) {
  const ps = await Payslip.find({ runId }).select('gross totalDeductions net employerContribution employerCost deductions attendance.lop').lean()
  const d = (code) => sum(ps, (p) => lineAmount(p.deductions, code))
  return {
    employees: ps.length, gross: sum(ps, (p) => p.gross), deductions: sum(ps, (p) => p.totalDeductions), net: sum(ps, (p) => p.net),
    employerContribution: sum(ps, (p) => p.employerContribution), employerCost: sum(ps, (p) => p.employerCost),
    pf: d('PF'), esi: d('ESI'), pt: d('PT'), lwf: d('LWF'), tds: d('TDS'), loans: d('LOAN'), lop: Math.round(sum(ps, (p) => p.attendance?.lop) * 2) / 2,
  }
}

/** Save worked-out payslips (numbers kept across recalculations) and the run's totals. */
async function savePayslips(run, docs, { replaceAll, status }) {
  const date = new Date(`${run.month}-15T06:30:00Z`)
  await withTransaction(async () => {
    const existing = new Map((await Payslip.find({ runId: run._id }).select('employeeId payslipNo').lean()).map((p) => [String(p.employeeId), p.payslipNo]))
    if (replaceAll) await Payslip.deleteMany({ runId: run._id, employeeId: { $nin: docs.map((d) => d.employeeId) } })
    for (const d of docs) {
      const payslipNo = existing.get(String(d.employeeId)) ?? await nextNumber('PAYSLIP', { date })
      await Payslip.updateOne({ runId: run._id, employeeId: d.employeeId }, { $set: { ...d, payslipNo, status } }, { upsert: true })
    }
    run.totals = await refreshTotals(run._id)
    await run.save()
  })
}

export async function calculateRun(id, auth, req) {
  const run = await findRun(id)
  assertAction(run, 'calculate')
  const { docs, exceptions } = await buildPayslips(run)
  run.status = 'CALCULATED'
  run.version = (run.version ?? 0) + 1
  run.exceptions = exceptions
  run.calculated = { ...stamp(auth), count: docs.length }
  run.preparers.addToSet(auth.userId)
  await savePayslips(run, docs, { replaceAll: true, status: 'CALCULATED' })
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'payroll-run', entityId: String(run._id), entityName: run.runNo, summary: `Calculated the ${payrollMonthLabel(run.month)} payroll ${run.runNo}: ${docs.length} payslip(s), net ${fmt(run.totals.net)}${exceptions.length ? `, ${exceptions.length} not paid (no structure or salary)` : ''}` }, req)
  return runDetail(run._id, auth)
}

export async function reopenRun(id, reason, auth, req) {
  const run = await findRun(id)
  assertAction(run, 'reopen')
  await withTransaction(async () => {
    run.status = 'DRAFT'
    run.reopened.push({ ...stamp(auth), reason })
    await run.save()
    await Payslip.updateMany({ runId: run._id }, { $set: { status: 'DRAFT' } })
  })
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'payroll-run', entityId: String(run._id), entityName: run.runNo, summary: `Reopened the ${payrollMonthLabel(run.month)} payroll ${run.runNo}: ${reason}` }, req)
  return runDetail(run._id, auth)
}

export async function approveRun(id, note, auth, req) {
  const run = await findRun(id)
  assertAction(run, 'approve')
  const stat = await getStatutory()
  if (stat.separateDuties && (run.preparers ?? []).some((x) => String(x) === String(auth.userId))) {
    throw new AppError(403, 'You prepared this payroll (calculated it or changed a payslip); someone else has to approve it.', { code: SOD })
  }
  if (!run.totals?.employees) throw conflict('This run has no payslips to approve.')
  await withTransaction(async () => {
    run.status = 'APPROVED'
    run.approved = { ...stamp(auth), note }
    await run.save()
    await Payslip.updateMany({ runId: run._id }, { $set: { status: 'APPROVED' } })
  })
  await audit({ action: 'APPROVE', module: 'payroll', entityType: 'payroll-run', entityId: String(run._id), entityName: run.runNo, summary: `Approved the ${payrollMonthLabel(run.month)} payroll ${run.runNo}: ${run.totals.employees} staff, net ${fmt(run.totals.net)}${note ? ` — ${note}` : ''}` }, req)
  return runDetail(run._id, auth)
}

/** Record that salaries were paid (date, mode, UTR); loan instalments are booked here, once. */
export async function payRun(id, input, auth, req) {
  const run = await findRun(id)
  assertAction(run, 'pay')
  const stat = await getStatutory()
  if (stat.separateDuties && String(run.approved?.byId ?? '') === String(auth.userId)) throw new AppError(403, 'You approved this payroll; someone else has to record its payment.', { code: SOD })
  if (stat.separateDuties && (run.preparers ?? []).some((x) => String(x) === String(auth.userId))) throw new AppError(403, 'You prepared this payroll; someone else has to record its payment.', { code: SOD })
  const today = await todayYmd()
  if (input.date > today) throw badRequest('The payment date is in the future.', { fields: { date: 'In the future' } })
  if (input.date < `${run.month}-01`) throw badRequest('The payment date is before the payroll month.', { fields: { date: 'Too early' } })
  const paid = { date: input.date, mode: input.mode, reference: input.reference }
  let closedLoans = 0
  await withTransaction(async () => {
    run.status = 'PAID'
    run.paid = { ...stamp(auth), ...paid, note: input.note }
    await run.save()
    await Payslip.updateMany({ runId: run._id }, { $set: { status: 'PAID', paid } })
    const withLoans = await Payslip.find({ runId: run._id, 'loans.0': { $exists: true } }).select('loans month').lean()
    for (const p of withLoans) {
      for (const l of p.loans) {
        await PayrollLoan.updateOne({ _id: l.loanId, 'recoveries.payslipId': { $ne: p._id } }, { $push: { recoveries: { payslipId: p._id, runId: run._id, month: p.month, amount: l.amount, at: new Date() } } })
        const loan = await PayrollLoan.findById(l.loanId)
        if (loan && loan.status === 'ACTIVE' && loanBalance(loan.toObject()) === 0) {
          loan.status = 'CLOSED'
          loan.closed = { by: 'Payroll', at: new Date(), note: `Recovered in full by ${run.runNo}` }
          await loan.save()
          closedLoans++
        }
      }
    }
  })
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'payroll-run', entityId: String(run._id), entityName: run.runNo, summary: `Paid the ${payrollMonthLabel(run.month)} payroll ${run.runNo} on ${input.date} by ${PAYROLL_PAY_MODE_LABEL[input.mode] ?? input.mode}${input.reference ? ` (${input.reference})` : ''}: net ${fmt(run.totals.net)}${closedLoans ? `; ${closedLoans} loan(s) fully recovered` : ''}` }, req)
  const t = run.totals
  await emit('payroll.paid', {
    entity: { type: 'payroll_run', id: run._id },
    data: { runNo: run.runNo, month: run.month, branchId: run.branchId ? String(run.branchId) : null, branchName: run.branchName ?? null, employees: t.employees, gross: t.gross, deductions: t.deductions, net: t.net, employerContribution: t.employerContribution, employerCost: t.employerCost, pf: t.pf, esi: t.esi, pt: t.pt, lwf: t.lwf, tds: t.tds, loans: t.loans, paidOn: input.date, mode: input.mode, reference: input.reference ?? null },
  })
  const users = await Payslip.distinct('userId', { runId: run._id, userId: { $ne: null } })
  await notifyUsers(users.map(String), { event: 'payroll.payslip_ready', title: `Your payslip for ${payrollMonthLabel(run.month)}`, message: `Salary paid on ${input.date}. Open My workspace to see or print the payslip.`, link: '/me?tab=payslips', tone: 'success', entityType: 'payroll_run', entityId: String(run._id) })
  return runDetail(run._id, auth)
}

// ───────────────────────────────────────────────────────── payslips

const EDITABLE = ['DRAFT', 'CALCULATED']

export function payslipOut(p) {
  return { ...clean(p), statusLabel: PAYROLL_RUN_STATUSES[p.status]?.label, monthLabel: payrollMonthLabel(p.month), paidModeLabel: p.paid?.mode ? PAYROLL_PAY_MODE_LABEL[p.paid.mode] : undefined }
}

/** One page plus counts over every matching payslip (with LOP, with warnings). */
export async function listPayslips({ runId, month, search }, paging) {
  const filter = {}
  if (isOid(runId)) filter.runId = oid(runId)
  if (month) filter.month = month
  if (search) { const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ 'employee.name': re }, { 'employee.code': re }, { payslipNo: re }] }
  if (!filter.runId && !filter.month) return { ...listResponse([], 0, paging), summary: { lop: 0, flagged: 0 } }
  const [rows, total, lop, flagged] = await Promise.all([
    Payslip.find(filter).sort({ 'employee.name': 1, _id: 1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Payslip.countDocuments(filter),
    Payslip.countDocuments({ ...filter, 'attendance.lop': { $gt: 0 } }),
    Payslip.countDocuments({ ...filter, 'warnings.0': { $exists: true } }),
  ])
  return { ...listResponse(rows.map(payslipRow), total, paging), summary: { lop, flagged } }
}

export async function payslipDetail(id) {
  const p = await Payslip.findById(isOid(id) ? id : null).lean()
  if (!p) throw notFound('Payslip')
  return payslipOut(p)
}

/** Recalculate one payslip after a change to it, then the run's totals. */
async function recalcOne(p, run, auth) {
  const { docs } = await buildPayslips(run, { employeeIds: [p.employeeId] })
  if (!docs.length) throw conflict(`${p.employee?.name} is no longer paid in this run (no structure or salary). Recalculate the run.`)
  run.preparers.addToSet(auth.userId)
  await savePayslips(run, docs, { replaceAll: false, status: run.status })
  return payslipDetail(p._id)
}

async function editablePayslip(id) {
  const p = await Payslip.findById(isOid(id) ? id : null)
  if (!p) throw notFound('Payslip')
  const run = await findRun(p.runId)
  if (!EDITABLE.includes(run.status)) throw new AppError(409, `The run is ${PAYROLL_RUN_STATUSES[run.status].label.toLowerCase()}; payslips can only change before approval.`, { code: 'INVALID_TRANSITION' })
  return { p, run }
}

/** Correct the LOP days of a payslip (with a reason, audited); `days: null` goes back to attendance. */
export async function editLop(id, { days, reason }, auth, req) {
  const { p, run } = await editablePayslip(id)
  const employed = (p.attendance?.daysInMonth ?? 0) - (p.attendance?.notEmployedDays ?? 0)
  if (days !== null && days > employed) throw badRequest(`${p.employee.name} was on the books for ${employed} day(s) this month.`, { fields: { days: 'Too many' } })
  const from = p.attendance?.lop ?? 0
  p.lopOverride = days === null ? null : { days, reason, ...stamp(auth) }
  await p.save()
  const out = await recalcOne(p, run, auth)
  await audit({
    action: 'UPDATE', module: 'payroll', entityType: 'payslip', entityId: String(p._id), entityName: `${p.payslipNo} · ${p.employee.name}`,
    summary: days === null ? `LOP of ${p.employee.name} for ${payrollMonthLabel(p.month)} put back to attendance (${out.attendance.lop} day(s)): ${reason}` : `LOP of ${p.employee.name} for ${payrollMonthLabel(p.month)} changed from ${from} to ${days} day(s) (attendance: ${p.attendance?.lopAuto ?? 0}): ${reason}`,
  }, req)
  return out
}

/** Add a manual line (arrears, extra classes, exam duty, other deduction) to a payslip before approval. */
export async function addAdjustment(id, input, auth, req) {
  const { p, run } = await editablePayslip(id)
  p.adjustments.push({ code: input.code, label: input.label, amount: input.amount, note: input.note, by: auth.user?.name, at: new Date() })
  await p.save()
  const out = await recalcOne(p, run, auth)
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'payslip', entityId: String(p._id), entityName: `${p.payslipNo} · ${p.employee.name}`, summary: `Added ${input.label || input.code} of ${fmt(input.amount)} to ${p.employee.name}’s ${payrollMonthLabel(p.month)} payslip: ${input.note}` }, req)
  return out
}

export async function removeAdjustment(id, index, auth, req) {
  const { p, run } = await editablePayslip(id)
  const a = p.adjustments[index]
  if (!a) throw notFound('Line')
  p.adjustments.splice(index, 1)
  await p.save()
  const out = await recalcOne(p, run, auth)
  await audit({ action: 'UPDATE', module: 'payroll', entityType: 'payslip', entityId: String(p._id), entityName: `${p.payslipNo} · ${p.employee.name}`, summary: `Removed ${a.label || a.code} of ${fmt(a.amount)} from ${p.employee.name}’s ${payrollMonthLabel(p.month)} payslip` }, req)
  return out
}

// ───────────────────────────────────────────────────────── self-service and print

const RELEASED = ['APPROVED', 'PAID']

/** The signed-in person's own payslips (approved or paid runs only). */
export async function myPayslips(auth) {
  const e = await myEmployee(auth).catch(() => null)
  if (!e) return { employee: null, payslips: [] }
  const rows = await Payslip.find({ employeeId: e._id, status: { $in: RELEASED } }).sort({ month: -1 }).limit(60).lean()
  return { employee: { id: String(e._id), code: e.employeeCode, name: e.name }, payslips: rows.map((p) => ({ ...payslipRow(p), month: p.month, monthLabel: payrollMonthLabel(p.month), paid: p.paid ?? null })) }
}

export async function myPayslip(id, auth) {
  const e = await myEmployee(auth)
  const p = isOid(id) ? await Payslip.findOne({ _id: id, employeeId: e._id, status: { $in: RELEASED } }).lean() : null
  if (!p) throw notFound('Payslip')
  return payslipOut(p)
}

async function institutionOf() {
  const t = await Tenant.findById(getContext()?.tenantId).select('name profile').lean()
  return { name: t?.name, ...(t?.profile ?? {}) }
}

/** Print data of a payslip (the PAYSLIP document). `own`: a staff member printing their own. */
export async function payslipPrint(id, auth, { own = false } = {}) {
  const p = own ? await myPayslip(id, auth) : await payslipDetail(id)
  return { payslip: p, institution: await institutionOf() }
}

export const latestPayslipId = async () => (await Payslip.findOne().sort({ createdAt: -1 }).select('_id').lean())?._id

const mask = (last, n = 6) => (last ? `${'X'.repeat(n)}${last}` : '')
const PAY_MODE_TEXT = { BANK: 'Bank transfer', CHEQUE: 'Cheque', CASH: 'Cash' }

/** What the payslip template sees (documents/defaults/PAYSLIP.hbs). */
export function payslipModel({ payslip: p, institution }) {
  const a = p.attendance ?? {}
  const earnings = p.earnings ?? []
  const deductions = p.deductions ?? []
  const rows = Array.from({ length: Math.max(earnings.length, deductions.length) }, (_, i) => ({ earning: earnings[i] ?? null, deduction: deductions[i] ?? null }))
  return {
    institution,
    payslip: {
      no: p.payslipNo, month: p.month, monthLabel: payrollMonthLabel(p.month), runNo: p.runNo, status: PAYROLL_RUN_STATUSES[p.status]?.label,
      draft: !RELEASED.includes(p.status), paid: p.status === 'PAID', paidOn: p.paid?.date, paidMode: PAYROLL_PAY_MODE_LABEL[p.paid?.mode], reference: p.paid?.reference,
    },
    employee: {
      ...p.employee, panMasked: mask(p.employee?.pan), uanMasked: mask(p.employee?.uan, 8), esiMasked: mask(p.employee?.esi), accountMasked: mask(p.employee?.accountLast4, 4),
      paymentModeLabel: PAY_MODE_TEXT[p.employee?.paymentMode] ?? p.employee?.paymentMode,
    },
    structureName: p.structureName,
    attendance: { ...a, lopEdited: p.lopOverride?.days !== undefined && p.lopOverride?.days !== null, lopReason: p.lopOverride?.reason },
    earnings, deductions, rows, employer: p.employer ?? [], loans: p.loans ?? [],
    totals: { gross: p.gross, deductions: p.totalDeductions, net: p.net, employerCost: p.employerCost, employerContributions: (p.employer ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0) },
    ytd: { ...(p.ytd ?? {}), label: payrollYearOf(p.month).label },
    fnf: p.fnf?.lastWorkingDate ? p.fnf : null,
  }
}
