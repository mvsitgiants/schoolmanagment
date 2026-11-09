import {
  LEAVE_STATUSES, STARTER_LEAVE_TYPES, accrualUpTo, dayPay, leaveDates, leaveTypeFits, leaveYear, monthsSoFar,
} from '@schoolgiant/shared'
import { Employee, Leave, LeaveLedger, LeaveType, StaffAttendance } from '../models/hrms.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'
import { notifyUsers } from './notify.js'
import { employeeIdFilter, employeeScope, employeeSnap, findEmployee, hrSettings, idStr, myEmployee, offDatesFor, stamp, todayYmd, usersWith } from './hrmsCommon.js'

// Staff & HR › Leave. Balances live on an append-only ledger: the yearly credit at the start of the leave year (pro-rated
// for someone who joins mid-year), monthly accrual, what's taken, cancelled (reversed), adjusted by HR, lapsed above the
// carry-forward limit. Every automatic posting carries a period, so running it again adds nothing.
// A request goes to the person's reporting manager (when they have a login) — anyone holding hrms.leave.approve can
// decide it too. Approving writes the days into staff attendance as leave (payroll reads paid / unpaid from there).

const fieldsError = (fields) => badRequest('Some details need fixing.', { fields })
const statusLabel = (s) => LEAVE_STATUSES[s]?.label ?? s

// ───────────────────────────────────────────────────────── types

export async function ensureLeaveTypes() {
  if (await LeaveType.exists({})) return
  await LeaveType.insertMany(STARTER_LEAVE_TYPES)
}

export async function listLeaveTypes() {
  await ensureLeaveTypes()
  return clean(await LeaveType.find().sort({ active: -1, order: 1, name: 1 }).lean())
}

export async function saveLeaveType(id, input, req) {
  if (await LeaveType.exists({ code: input.code.toUpperCase(), ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: 'Already used' })
  const t = id ? await LeaveType.findById(id) : new LeaveType()
  if (!t) throw notFound('Leave type')
  Object.assign(t, input)
  await t.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'leave_type', entityId: String(t._id), entityName: t.name, summary: `${id ? 'Updated' : 'Added'} leave type ${t.name} (${t.code})` }, req)
  return clean(t.toObject())
}

// ───────────────────────────────────────────────────────── credits & balances

const roundHalf = (n) => Math.round(n * 2) / 2
const post = async (row) => {
  try { await LeaveLedger.create(row); return true } catch (err) { if (err.code === 11000) return false; throw err }
}

/**
 * Bring a person's ledger up to date for the leave year of `asOf`: last year's lapse above the carry-forward limit,
 * this year's yearly credit, and monthly accrual up to this month.
 */
export async function ensureCredits(emp, asOf) {
  await ensureLeaveTypes() // an institution made before HR existed has none yet
  const settings = await hrSettings()
  const start = Number(settings.leaveYearStartMonth ?? 4)
  const date = asOf ?? await todayYmd()
  const year = leaveYear(date, start)
  const types = (await LeaveType.find({ active: true }).lean()).filter((t) => leaveTypeFits(t, emp))
  const joined = emp.joiningDate ?? year.from
  if (joined > date) return
  const months = monthsSoFar(date, start)
  const joinMonth = joined.slice(0, 7)
  for (const t of types) {
    const base = { employeeId: emp._id, leaveTypeId: t._id, leaveCode: t.code, by: 'System' }
    // last year's balance above the carry-forward limit lapses (only for someone who was here before this year)
    if (joined < year.from && t.accrual !== 'NONE') {
      const prev = await LeaveLedger.aggregate([{ $match: { employeeId: emp._id, leaveTypeId: t._id, date: { $lt: year.from } } }, { $group: { _id: null, n: { $sum: '$days' } } }])
      const bal = prev[0]?.n ?? 0
      const keep = t.carryForwardMax ?? 0
      if (bal > keep) await post({ ...base, kind: 'LAPSE', date: year.from, days: -(bal - keep), period: year.label, note: `Over the ${keep}-day carry-forward limit` })
    }
    if (t.accrual === 'YEARLY' && t.perYear > 0) {
      // someone who joins mid-year gets the months left
      const left = joined > year.from ? 12 - Math.max(0, months.indexOf(joinMonth)) : 12
      const days = joined > year.from ? roundHalf((t.perYear * Math.max(0, Math.min(12, left))) / 12) : t.perYear
      if (days > 0) await post({ ...base, kind: 'CREDIT', date: joined > year.from ? joined : year.from, days, period: year.label, note: `${year.label} credit` })
    }
    if (t.accrual === 'MONTHLY' && t.perYear > 0) {
      const from = Math.max(0, months.indexOf(joinMonth))
      for (let i = from; i < months.length; i++) {
        const n = i - from + 1
        const days = accrualUpTo(t.perYear, n) - accrualUpTo(t.perYear, n - 1)
        if (days > 0) await post({ ...base, kind: 'ACCRUAL', date: `${months[i]}-01`, days, period: months[i], note: `Accrual for ${months[i]}` })
      }
    }
  }
}

/** Balance per leave type: on the ledger, waiting for approval, and free to apply for. */
export async function balancesFor(emp, { ensure = true } = {}) {
  if (ensure) await ensureCredits(emp)
  const [types, sums, pending] = await Promise.all([
    LeaveType.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
    LeaveLedger.aggregate([{ $match: { employeeId: emp._id } }, { $group: { _id: '$leaveTypeId', n: { $sum: '$days' }, taken: { $sum: { $cond: [{ $eq: ['$kind', 'TAKEN'] }, '$days', 0] } } } }]),
    Leave.aggregate([{ $match: { employeeId: emp._id, status: 'PENDING' } }, { $group: { _id: '$leaveTypeId', n: { $sum: '$days' } } }]),
  ])
  const bal = new Map(sums.map((s) => [String(s._id), s]))
  const pend = new Map(pending.map((p) => [String(p._id), p.n]))
  return types.filter((t) => leaveTypeFits(t, emp)).map((t) => {
    const b = bal.get(String(t._id))
    const balance = Math.round((b?.n ?? 0) * 100) / 100
    const waiting = pend.get(String(t._id)) ?? 0
    return {
      leaveTypeId: String(t._id), code: t.code, name: t.name, paid: t.paid, tone: t.tone, allowHalfDay: t.allowHalfDay, allowNegative: t.allowNegative, maxPerRequest: t.maxPerRequest ?? null,
      balance, taken: -(b?.taken ?? 0), pending: waiting, available: t.allowNegative ? null : Math.round((balance - waiting) * 100) / 100,
    }
  })
}

export async function employeeBalances(id, auth) {
  const e = await findEmployee(id, auth, { lean: true })
  return balancesFor(e)
}

export async function ledgerFor(id, leaveTypeId, auth) {
  const e = await findEmployee(id, auth, { lean: true })
  await ensureCredits(e)
  const rows = await LeaveLedger.find({ employeeId: e._id, ...(isOid(leaveTypeId) && { leaveTypeId }) }).sort({ date: -1, createdAt: -1 }).limit(200).lean()
  return clean(rows)
}

/** HR's correction to a balance (+ or −), with a reason. */
export async function adjustBalance(id, { leaveTypeId, days, note }, auth, req) {
  const e = await findEmployee(id, auth, { lean: true })
  const t = await LeaveType.findById(leaveTypeId).lean()
  if (!t) throw notFound('Leave type')
  await LeaveLedger.create({ employeeId: e._id, leaveTypeId: t._id, leaveCode: t.code, kind: 'ADJUST', date: await todayYmd(), days, note, by: auth.user?.name, byId: auth.userId })
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `${days > 0 ? 'Added' : 'Took off'} ${Math.abs(days)} day(s) of ${t.code} for ${e.name}: ${note}` }, req)
  return balancesFor(e, { ensure: false })
}

/** Everyone's balances at a glance (Leave › Balances). */
export async function balanceBoard(auth) {
  const staff = await Employee.find({ status: { $ne: 'EXITED' }, ...employeeScope(auth) }).sort({ name: 1 }).limit(1000).lean()
  const out = []
  for (const e of staff) out.push({ employeeId: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, balances: await balancesFor(e) })
  return { types: await listLeaveTypes(), rows: out }
}

// ───────────────────────────────────────────────────────── requests

const dto = (l) => ({
  ...clean(l), employeeId: String(l.employeeId), leaveTypeId: String(l.leaveTypeId), statusLabel: statusLabel(l.status),
  pendingWith: (l.pendingWith ?? []).map(String), userId: idStr(l.userId),
})

/** Count the days of a leave and check it against the type, other leave and the balance. */
async function shape(emp, input, { excludeId } = {}) {
  const type = await LeaveType.findById(input.leaveTypeId).lean()
  if (!type || !type.active) throw fieldsError({ leaveTypeId: 'Pick a leave type' })
  if (!leaveTypeFits(type, emp)) throw fieldsError({ leaveTypeId: 'This leave isn’t for this person' })
  if (input.to < input.from) throw fieldsError({ to: 'On or after the start' })
  const halfDay = !!input.halfDay
  if (halfDay && (!type.allowHalfDay || input.from !== input.to)) throw fieldsError({ halfDay: type.allowHalfDay ? 'A half day is one date' : 'This leave is taken in full days' })
  if (emp.joiningDate && input.from < emp.joiningDate) throw fieldsError({ from: 'Before they joined' })
  const settings = await hrSettings()
  const offs = await offDatesFor(emp, input.from, input.to, settings)
  const { dates, days } = leaveDates(input.from, input.to, { halfDay, offDays: [], holidays: offs, sandwich: type.sandwich })
  if (!days) throw fieldsError({ from: 'Those are all days off' })
  if (type.maxPerRequest && days > type.maxPerRequest) throw fieldsError({ to: `At most ${type.maxPerRequest} day(s) at a time` })
  const clash = await Leave.findOne({ employeeId: emp._id, status: { $in: ['PENDING', 'APPROVED'] }, 'dates.date': { $in: dates.map((d) => d.date) }, ...(excludeId && { _id: { $ne: excludeId } }) }).lean()
  if (clash) throw conflict(`There is already ${clash.leaveCode} leave on some of these days (${clash.from}${clash.to !== clash.from ? ` to ${clash.to}` : ''}).`)
  if (!type.allowNegative) {
    const bal = (await balancesFor(emp)).find((b) => b.leaveTypeId === String(type._id))
    if ((bal?.available ?? 0) < days) throw conflict(`Not enough ${type.name}: ${bal?.available ?? 0} day(s) free, ${days} asked for.`, { fields: { leaveTypeId: 'Not enough balance' } })
  }
  return { type, dates, days, halfDay }
}

/** Who decides a person's leave: their reporting manager's login, else whoever holds hrms.leave.approve. */
async function approversOf(emp) {
  const mgr = emp.reportingManagerId ? await Employee.findById(emp.reportingManagerId).select('userId status').lean() : null
  if (mgr?.userId && mgr.status !== 'EXITED' && String(mgr.userId) !== String(emp.userId)) return { pendingWith: [mgr.userId], notify: [String(mgr.userId)] }
  return { pendingWith: [], notify: (await usersWith('hrms.leave.approve')).filter((u) => u !== String(emp.userId)) }
}

async function create(emp, input, auth, req, { onBehalf }) {
  const { type, dates, days, halfDay } = await shape(emp, input)
  const who = await approversOf(emp)
  const l = await Leave.create({
    ...employeeSnap(emp), leaveTypeId: type._id, leaveCode: type.code, leaveName: type.name, paid: type.paid,
    from: input.from, to: input.to, halfDay, half: halfDay ? input.half || 'FIRST' : undefined, days, dates,
    reason: input.reason, arrangement: input.arrangement || undefined,
    applied: { ...stamp(auth), onBehalf }, pendingWith: who.pendingWith,
  })
  await audit({ action: 'CREATE', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: emp.name, summary: `${onBehalf ? 'Applied' : 'Asked'} for ${days} day(s) of ${type.code} for ${emp.name} (${input.from}${input.to !== input.from ? ` to ${input.to}` : ''})` }, req)
  if (input.approveNow && can(auth, 'hrms.leave.approve')) return decideLeave(String(l._id), { approve: true, note: 'Approved when applied' }, auth, req)
  await notifyUsers(who.notify, { event: 'hrms.leave_applied', title: `Leave request: ${emp.name}`, message: `${days} day(s) of ${type.name}, ${input.from}${input.to !== input.from ? ` to ${input.to}` : ''}`, link: '/hrms/leave', tone: 'info', entityType: 'leave', entityId: String(l._id) })
  return dto(l.toObject())
}

/** Self-service: the signed-in person asks for leave. */
export async function applyMine(input, auth, req) {
  if (!(await hrSettings()).selfLeave) throw forbidden('Leave is applied for by HR here. Ask the office.')
  const emp = await myEmployee(auth)
  if (emp.status === 'EXITED') throw forbidden('Your staff record is closed.')
  return create(emp, input, auth, req, { onBehalf: false })
}

/** HR (or someone with apply_on_behalf) applies for a person. */
export async function applyFor(input, auth, req) {
  const emp = await findEmployee(input.employeeId, auth, { lean: true })
  return create(emp, input, auth, req, { onBehalf: true })
}

const canDecide = (l, auth) => String(l.userId) !== String(auth.userId) && (can(auth, 'hrms.leave.approve') || (l.pendingWith ?? []).some((u) => String(u) === String(auth.userId)))

export async function decideLeave(id, { approve, note }, auth, req) {
  const l = isOid(id) ? await Leave.findById(id) : null
  if (!l) throw notFound('Leave request')
  if (l.status !== 'PENDING') throw conflict(`This request is already ${statusLabel(l.status).toLowerCase()}.`)
  if (String(l.userId) === String(auth.userId) && l.userId) throw forbidden('You can’t decide your own leave.')
  if (!canDecide(l, auth)) throw forbidden('This request is waiting for someone else.')
  if (can(auth, 'hrms.leave.approve') && !(l.pendingWith ?? []).some((u) => String(u) === String(auth.userId))) {
    // an HR approver: still kept to their scope
    const inScope = await Employee.exists({ _id: l.employeeId, ...employeeScope(auth) })
    if (!inScope) throw forbidden('This person is outside your staff.')
  }
  if (approve) {
    const emp = await Employee.findById(l.employeeId).lean()
    const type = await LeaveType.findById(l.leaveTypeId).lean()
    if (type && !type.allowNegative) {
      await ensureCredits(emp)
      const bal = await LeaveLedger.aggregate([{ $match: { employeeId: l.employeeId, leaveTypeId: l.leaveTypeId } }, { $group: { _id: null, n: { $sum: '$days' } } }])
      if ((bal[0]?.n ?? 0) < l.days) throw conflict(`Not enough ${type.name} left (${bal[0]?.n ?? 0} day(s)). Reject it, or ask HR to adjust the balance.`)
    }
    await LeaveLedger.create({ employeeId: l.employeeId, leaveTypeId: l.leaveTypeId, leaveCode: l.leaveCode, kind: 'TAKEN', date: l.from, days: -l.days, leaveId: l._id, note: `${l.from}${l.to !== l.from ? ` to ${l.to}` : ''}`, by: auth.user?.name, byId: auth.userId })
    await writeAttendance(l, auth)
  }
  l.status = approve ? 'APPROVED' : 'REJECTED'
  l.decided = { ...stamp(auth), note }
  l.pendingWith = []
  await l.save()
  await audit({ action: approve ? 'APPROVE' : 'REJECT', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `${approve ? 'Approved' : 'Rejected'} ${l.days} day(s) of ${l.leaveCode} for ${l.employeeName}${note ? `: ${note}` : ''}` }, req)
  if (l.userId) await notifyUsers([l.userId], { event: 'hrms.leave_decided', title: `Leave ${approve ? 'approved' : 'not approved'}`, message: `${l.leaveName}, ${l.from}${l.to !== l.from ? ` to ${l.to}` : ''}${note ? ` — ${note}` : ''}`, link: '/me?tab=leave', tone: approve ? 'success' : 'warning', entityType: 'leave', entityId: String(l._id) })
  return dto(l.toObject())
}

/** The approved days become "on leave" in staff attendance (over anything marked by hand). */
async function writeAttendance(l, auth) {
  for (const d of l.dates) {
    const pay = dayPay('LEAVE', { leavePaid: l.paid !== false, portion: d.portion })
    await StaffAttendance.updateOne({ employeeId: l.employeeId, date: d.date }, {
      $set: { status: 'LEAVE', ...pay, leave: { leaveId: l._id, code: l.leaveCode, portion: d.portion, paid: l.paid !== false }, source: 'LEAVE', markedBy: auth.user?.name, markedAt: new Date() },
      $unset: { inTime: 1, outTime: 1, late: 1 },
    }, { upsert: true })
  }
}

/**
 * Cancel a request: the person (while it waits, or before an approved leave starts), or HR at any time.
 * An approved leave's days go back to the balance and come off staff attendance.
 */
export async function cancelLeave(id, { reason }, auth, req, { self = false } = {}) {
  const l = isOid(id) ? await Leave.findById(id) : null
  if (!l) throw notFound('Leave request')
  if (!['PENDING', 'APPROVED'].includes(l.status)) throw conflict(`This request is already ${statusLabel(l.status).toLowerCase()}.`)
  const own = l.userId && String(l.userId) === String(auth.userId)
  const today = await todayYmd()
  if (self) {
    if (!own) throw notFound('Leave request')
    if (l.status === 'APPROVED' && l.from <= today) throw forbidden('This leave has started. Ask HR to cancel it.')
  } else {
    if (!can(auth, 'hrms.leave.cancel')) throw forbidden()
    if (!await Employee.exists({ _id: l.employeeId, ...employeeScope(auth) })) throw notFound('Leave request')
  }
  const after = l.status === 'APPROVED'
  if (after) {
    await LeaveLedger.create({ employeeId: l.employeeId, leaveTypeId: l.leaveTypeId, leaveCode: l.leaveCode, kind: 'REVERSAL', date: today, days: l.days, leaveId: l._id, note: `Cancelled: ${l.from}${l.to !== l.from ? ` to ${l.to}` : ''}`, by: auth.user?.name, byId: auth.userId })
    await StaffAttendance.deleteMany({ employeeId: l.employeeId, 'leave.leaveId': l._id, source: 'LEAVE' })
  }
  l.status = 'CANCELLED'
  l.cancelled = { ...stamp(auth), reason, afterApproval: after }
  l.pendingWith = []
  await l.save()
  await audit({ action: 'CANCEL', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `Cancelled ${l.days} day(s) of ${l.leaveCode} for ${l.employeeName}${reason ? `: ${reason}` : ''}` }, req)
  if (!own && l.userId) await notifyUsers([l.userId], { event: 'hrms.leave_cancelled', title: 'Leave cancelled', message: `${l.leaveName}, ${l.from}${reason ? ` — ${reason}` : ''}`, link: '/me?tab=leave', tone: 'warning' })
  return dto(l.toObject())
}

/** HR's list of requests. */
/**
 * Leave requests, one page at a time (pending: soonest first; otherwise latest first). Search runs on the server over the
 * person's name and staff code. `pending` counts every request waiting in the caller's scope, whatever the filters.
 */
export async function listLeaves(q, auth) {
  const { page = 1, pageSize = 50 } = q
  const scope = await employeeIdFilter(auth)
  const f = { ...await employeeIdFilter(auth, q.employeeId) }
  if (q.status) f.status = q.status
  if (q.leaveTypeId) f.leaveTypeId = oid(q.leaveTypeId)
  if (q.from) f.to = { $gte: q.from }
  if (q.to) f.from = { $lte: q.to }
  const term = String(q.search ?? '').trim()
  if (term) { const re = new RegExp(escapeRegex(term), 'i'); f.$or = [{ employeeName: re }, { employeeCode: re }] }
  const sort = q.status === 'PENDING' ? { from: 1, _id: 1 } : { from: -1, _id: -1 }
  const [rows, total, pending] = await Promise.all([
    Leave.find(f).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Leave.countDocuments(f),
    Leave.countDocuments({ ...scope, status: 'PENDING' }),
  ])
  return { rows: rows.map(dto), total, page, pageSize, pending }
}

/** Requests the signed-in person can decide: those with them, and (HR) every one waiting. */
export async function waitingForMe(auth) {
  const mine = isOid(auth.userId) ? { pendingWith: oid(auth.userId) } : null
  const or = [mine, can(auth, 'hrms.leave.approve') ? await employeeIdFilter(auth) : null].filter(Boolean)
  if (!or.length) return []
  const rows = await Leave.find({ status: 'PENDING', $or: or, userId: { $ne: isOid(auth.userId) ? oid(auth.userId) : null } }).sort({ from: 1 }).limit(200).lean()
  return rows.map(dto)
}

/** Self-service: my balances and requests. */
export async function myLeave(auth) {
  const emp = await myEmployee(auth)
  const [balances, rows] = await Promise.all([balancesFor(emp), Leave.find({ employeeId: emp._id }).sort({ from: -1 }).limit(100).lean()])
  return { balances, requests: rows.map(dto), canApply: !!(await hrSettings()).selfLeave }
}

/** Who is on approved leave on a date (the timetable's substitution desk asks this). */
export async function onLeaveOn(date) {
  const rows = await Leave.find({ status: 'APPROVED', 'dates.date': date }).select('employeeId employeeName userId leaveCode dates').lean()
  return rows.map((l) => ({ employeeId: String(l.employeeId), userId: idStr(l.userId), name: l.employeeName, leaveCode: l.leaveCode, portion: l.dates.find((d) => d.date === date)?.portion ?? 1 }))
}
