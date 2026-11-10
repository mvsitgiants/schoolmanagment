import {
  LEAVE_LEDGER_KINDS, LEAVE_STATUSES, STARTER_LEAVE_TYPES, VACATION_MONTH_DAYS, accrualUpTo, countLeaveDays, dayPay, leaveTypeFits, leaveYear,
  monthsSoFar, normalizeAccrual, quotaFor, toHalfDays, weekdayCode,
} from '@schoolgiant/shared'
import { Employee, Leave, LeaveCalendarDay, LeaveLedger, LeaveType, StaffAttendance } from '../models/hrms.js'
import { Department } from '../models/tenant.js'
import { can, moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid, oid } from '../platform/db.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { escapeRegex } from '../platform/validate.js'
import { notifyUsers } from './notify.js'
import {
  dayOffFor, employeeIdFilter, employeeScope, employeeSnap, findEmployee, holidaysBetween, hrSettings, idStr, monthDays, myEmployee, scopedEmployeeIds,
  stamp, todayYmd, usersWith,
} from './hrmsCommon.js'
import {
  countWaitingOnMe, datesText, daysText, decideStep, niceDate, notifyWithdrawn, planChain, startChain, sweepEscalations, tellApplicant, waitingFilter,
  waitingOnMe, withChain,
} from './hrmsLeaveApprovals.js'

// Staff & HR › Leave. Balances live on an append-only ledger: the credit at the start of the leave year (pro-rated
// for someone who joins mid-year, or from the confirmation date after probation), monthly credit (paused in a month
// that is mostly school vacation, for the types that say so), what's taken, cancelled (given back), corrected by HR,
// compensatory off for a day worked, and what lapses above the carry-forward limit. Every automatic posting carries a
// period, so running it again adds nothing.
// A request walks its approval chain (hrmsLeaveApprovals.js); the days are held while it waits and come off the ledger
// at the final approval, which also writes them into staff attendance as leave (payroll reads paid / unpaid from
// there) and, for a teacher, tells the timetable desk how many lessons need cover.

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const statusLabel = (s) => LEAVE_STATUSES[s]?.label ?? s
const round2 = (n) => Math.round(n * 100) / 100
const sid = (x) => (x ? String(x) : '')

// ───────────────────────────────────────────────────────── types (Setup › Leave policies)

const seeded = new Set() // tenants whose starter types were merged in this process

/**
 * The starter types, merged by code: an institution that already has leave types keeps every one of them as it is;
 * a starter code it doesn't have yet (paternity, child-care, compensatory off …) is added once. A type is never
 * deleted — it is retired (switched off), and a retired code is not added back.
 */
export async function ensureLeaveTypes() {
  const key = sid(getContext()?.tenantId)
  if (key && seeded.has(key)) return
  const have = new Set(await LeaveType.distinct('code'))
  const missing = STARTER_LEAVE_TYPES.filter((t) => !have.has(t.code))
  if (missing.length) {
    await LeaveType.insertMany(missing.map((t) => ({ genders: [], categories: [], ...t })), { ordered: false }).catch((e) => { if (e?.code !== 11000 && !e?.writeErrors) throw e })
  }
  // types made before policies had a one-line description get the starter's (only where there is none)
  for (const t of STARTER_LEAVE_TYPES.filter((x) => have.has(x.code))) {
    await LeaveType.updateOne({ code: t.code, description: { $exists: false } }, { $set: { description: t.description } })
  }
  if (key) seeded.add(key)
}

const typeDto = (t) => ({ ...clean(t), accrual: normalizeAccrual(t.accrual), carryForwardMax: t.carryForwardMax ?? null })

export async function listLeaveTypes() {
  await ensureLeaveTypes()
  return (await LeaveType.find().sort({ active: -1, order: 1, name: 1 }).lean()).map(typeDto)
}

const TYPE_FIELDS = ['name', 'paid', 'accrual', 'perYear', 'carryForwardMax', 'allowHalfDay', 'sandwich', 'allowNegative', 'maxPerRequest', 'genders', 'categories',
  'categoryQuota', 'pauseInVacation', 'blackoutExempt', 'noticeDays', 'compOff', 'description', 'tone', 'order', 'active']

export async function saveLeaveType(id, input, req) {
  await ensureLeaveTypes()
  let t
  if (id) {
    t = await LeaveType.findById(isOid(id) ? id : null)
    if (!t) throw notFound('Leave type')
  } else {
    const code = input.code.toUpperCase()
    if (await LeaveType.exists({ code })) throw fieldsError({ code: 'Already used' }, 'A leave type with this short name exists.')
    t = new LeaveType({ code })
  }
  for (const k of TYPE_FIELDS) if (input[k] !== undefined) t[k] = input[k]
  t.accrual = normalizeAccrual(t.accrual)
  if (t.accrual === 'NONE') t.perYear = 0
  else if (!(t.perYear > 0) && !(t.categoryQuota ?? []).some((q) => q.perYear > 0)) throw fieldsError({ perYear: 'How many days a year?' })
  // one category once
  t.categoryQuota = [...new Map((t.categoryQuota ?? []).map((q) => [q.category, q])).values()]
  if (t.compOff && t.isModified('compOff')) await LeaveType.updateMany({ _id: { $ne: t._id }, compOff: true }, { $set: { compOff: false } })
  await t.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'leave_type', entityId: String(t._id), entityName: t.name, summary: `${id ? 'Changed' : 'Added'} the ${t.name} policy (${t.code})${t.active ? '' : ' — retired'}` }, req)
  return typeDto(t.toObject())
}

// ───────────────────────────────────────────────────────── the leave calendar (no-leave days, vacations)

const covers = (c, e) => (!c.categories?.length || c.categories.includes(e.category)) && (!c.branchIds?.length || c.branchIds.some((b) => sid(b) === sid(e.branchId)))
const calendarBetween = (from, to, kind) => LeaveCalendarDay.find({ from: { $lte: to }, to: { $gte: from }, ...(kind && { kind }) }).sort({ from: 1 }).lean()

/** The person's days from→to: working or not, and why not (a holiday's name, "Weekly off", the vacation's name). */
export async function daysFor(e, from, to, settings) {
  const [holidays, vacations] = await Promise.all([holidaysBetween(from, to), calendarBetween(from, to, 'VACATION')])
  const mine = vacations.filter((v) => covers(v, e))
  const out = []
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length < 400; t += 864e5) {
    const date = new Date(t).toISOString().slice(0, 10)
    const off = dayOffFor(e, date, { settings, holidays })
    const vac = !off && mine.find((v) => v.from <= date && v.to >= date)
    out.push({ date, working: !off && !vac, reason: off ? (off.kind === 'HOLIDAY' ? off.name : 'Weekly off') : vac ? vac.name : null, kind: off?.kind ?? (vac ? 'VACATION' : null) })
  }
  return out
}

export async function listCalendarDays({ from, to, kind } = {}) {
  const f = { ...(kind && { kind }) }
  if (from) f.to = { $gte: from }
  if (to) f.from = { $lte: to }
  return clean(await LeaveCalendarDay.find(f).sort({ from: 1 }).limit(500).lean())
}

export async function saveCalendarDay(id, input, auth, req) {
  if (input.to < input.from) throw fieldsError({ to: 'On or after the first day' })
  let c
  if (id) {
    c = await LeaveCalendarDay.findById(isOid(id) ? id : null)
    if (!c) throw notFound('No-leave day')
  } else c = new LeaveCalendarDay({ createdBy: auth.user?.name })
  c.set({ ...input, mode: input.kind === 'NO_LEAVE' ? input.mode ?? 'WARN' : undefined })
  await c.save()
  const what = c.kind === 'VACATION' ? 'school vacation' : 'no-leave days'
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'leave_calendar', entityId: String(c._id), entityName: c.name, summary: `${id ? 'Changed' : 'Added'} ${what} “${c.name}” (${datesText(c)})` }, req)
  return clean(c.toObject())
}

export async function deleteCalendarDay(id, req) {
  const c = await LeaveCalendarDay.findOneAndDelete({ _id: isOid(id) ? id : null })
  if (!c) throw notFound('No-leave day')
  await audit({ action: 'DELETE', module: 'hrms', entityType: 'leave_calendar', entityId: String(c._id), entityName: c.name, summary: `Removed “${c.name}” (${datesText(c)}) from the leave calendar` }, req)
  return { id: String(c._id) }
}

/** Exams, school events and parent–teacher meetings coming up — to add as no-leave days in one click. */
export async function calendarSuggestions(auth) {
  const today = await todayYmd()
  const until = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`
  const [{ Exam }, { SchoolEvent, PtmSession }, added] = await Promise.all([
    import('../models/exams.js'), import('../models/events.js'),
    LeaveCalendarDay.find({ 'source.id': { $ne: null } }).select('source').lean(),
  ])
  const done = new Set(added.map((a) => sid(a.source?.id)))
  const [exams, events, ptms] = await Promise.all([
    moduleEnabled(auth, 'exams') ? Exam.find({ endDate: { $gte: today }, startDate: { $lte: until, $ne: null } }).select('name startDate endDate').sort({ startDate: 1 }).limit(30).lean() : [],
    moduleEnabled(auth, 'events') ? SchoolEvent.find({ endDate: { $gte: today }, startDate: { $lte: until }, kind: { $in: ['EXAM', 'EVENT', 'CELEBRATION', 'CULTURAL', 'SPORTS'] } }).select('title kind startDate endDate').sort({ startDate: 1 }).limit(40).lean() : [],
    moduleEnabled(auth, 'events') ? PtmSession.find({ date: { $gte: today, $lte: until } }).select('title date').sort({ date: 1 }).limit(20).lean() : [],
  ])
  return [
    ...exams.map((x) => ({ type: 'EXAM', id: String(x._id), name: x.name, from: x.startDate, to: x.endDate ?? x.startDate })),
    ...events.map((x) => ({ type: 'EVENT', id: String(x._id), name: x.title, from: x.startDate, to: x.endDate ?? x.startDate })),
    ...ptms.map((x) => ({ type: 'PTM', id: String(x._id), name: x.title, from: x.date, to: x.date })),
  ].filter((x) => !done.has(x.id)).sort((a, b) => a.from.localeCompare(b.from))
}

// ───────────────────────────────────────────────────────── credits & balances

const post = async (row) => {
  try { await LeaveLedger.create(row); return true } catch (err) { if (err.code === 11000) return false; throw err }
}

/** Is the person confirmed (past probation) by `date`? Permanent staff without a confirmation date count from joining. */
const confirmedOn = (e, date) => (e.confirmationDate ? e.confirmationDate <= date : e.employmentType !== 'PROBATION')

/**
 * Bring a person's ledger up to date for the leave year of `asOf`: last year's lapse above the carry-forward limit,
 * this year's credit (upfront, or from confirmation), and monthly credit up to this month.
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
  const monthIndex = (ym) => Math.max(0, months.indexOf(ym))
  // months that are mostly school vacation for this person (monthly credit pauses there)
  let vacationMonths = null
  const vacMonths = async () => {
    if (vacationMonths) return vacationMonths
    const days = (await daysFor(emp, year.from, date, settings)).filter((d) => d.kind === 'VACATION')
    const n = new Map()
    for (const d of days) n.set(d.date.slice(0, 7), (n.get(d.date.slice(0, 7)) ?? 0) + 1)
    vacationMonths = new Set([...n].filter(([, c]) => c >= VACATION_MONTH_DAYS).map(([m]) => m))
    return vacationMonths
  }
  for (const t of types) {
    const accrual = normalizeAccrual(t.accrual)
    const quota = quotaFor(t, emp)
    const base = { employeeId: emp._id, leaveTypeId: t._id, leaveCode: t.code, by: 'System' }
    // last year's balance above the carry-forward limit lapses (only for someone who was here before this year)
    if (joined < year.from && accrual !== 'NONE' && t.carryForwardMax !== null && t.carryForwardMax !== undefined) {
      const prev = await LeaveLedger.aggregate([{ $match: { employeeId: emp._id, leaveTypeId: t._id, date: { $lt: year.from } } }, { $group: { _id: null, n: { $sum: '$days' } } }])
      const bal = round2(prev[0]?.n ?? 0)
      const keep = t.carryForwardMax
      if (bal > keep) await post({ ...base, kind: 'LAPSE', date: year.from, days: -round2(bal - keep), period: year.label, note: `Above the ${keep}-day carry-forward limit` })
    }
    if (!(quota > 0)) continue
    if (accrual === 'ANNUAL_UPFRONT') {
      // someone who joins mid-year gets the months left
      const midYear = joined > year.from
      const days = midYear ? toHalfDays((quota * (12 - monthIndex(joinMonth))) / 12) : quota
      if (days > 0) await post({ ...base, kind: 'CREDIT', date: midYear ? joined : year.from, days, period: year.label, note: `Credited for ${year.label}` })
    }
    if (accrual === 'ON_CONFIRMATION' && confirmedOn(emp, date)) {
      const from = emp.confirmationDate && emp.confirmationDate > joined ? emp.confirmationDate : joined
      if (from <= year.from) {
        await post({ ...base, kind: 'CREDIT', date: year.from, days: quota, period: year.label, note: `Credited for ${year.label}` })
      } else {
        // confirmed (or joined) during this year: the months left, counting the month when it was on or before the 15th
        const first = Number(from.slice(8, 10)) > 15 ? monthIndex(from.slice(0, 7)) + 1 : monthIndex(from.slice(0, 7))
        const days = toHalfDays((quota * Math.max(0, 12 - first)) / 12)
        if (days > 0) await post({ ...base, kind: 'CREDIT', date: from, days, period: year.label, note: `Credited from ${niceDate(from)} for the rest of ${year.label}` })
      }
    }
    if (accrual === 'MONTHLY') {
      const from = monthIndex(joinMonth)
      const skip = t.pauseInVacation ? await vacMonths() : new Set()
      let n = 0
      for (let i = from; i < months.length; i++) {
        if (skip.has(months[i])) continue
        n++
        const days = accrualUpTo(quota, n) - accrualUpTo(quota, n - 1)
        if (days > 0) await post({ ...base, kind: 'ACCRUAL', date: `${months[i]}-01`, days, period: months[i], note: `Credit for ${months[i]}` })
      }
    }
  }
  if (!emp.leaveYearDone || emp.leaveYearDone < year.label) await Employee.updateOne({ _id: emp._id }, { $set: { leaveYearDone: year.label } })
}

/** { leaveTypeId → { balance, taken, used, pending } } for one person; `used` and `taken` are this leave year's. */
async function sums(empId, yearFrom) {
  const [ledger, pending] = await Promise.all([
    LeaveLedger.aggregate([{ $match: { employeeId: oid(empId) } }, {
      $group: {
        _id: '$leaveTypeId', n: { $sum: '$days' },
        taken: { $sum: { $cond: [{ $and: [{ $gte: ['$date', yearFrom] }, { $in: ['$kind', ['TAKEN', 'REVERSAL']] }] }, '$days', 0] } },
        used: { $sum: { $cond: [{ $and: [{ $gte: ['$date', yearFrom] }, { $lt: ['$days', 0] }, { $ne: ['$kind', 'LAPSE'] }] }, '$days', 0] } },
      },
    }]),
    Leave.aggregate([{ $match: { employeeId: oid(empId), status: 'PENDING' } }, { $group: { _id: '$leaveTypeId', n: { $sum: '$days' } } }]),
  ])
  const out = new Map(ledger.map((s) => [String(s._id), { balance: round2(s.n), taken: round2(-s.taken), used: round2(-s.used), pending: 0 }]))
  for (const p of pending) (out.get(String(p._id)) ?? out.set(String(p._id), { balance: 0, taken: 0, used: 0, pending: 0 }).get(String(p._id))).pending = round2(p.n)
  return out
}

const balanceRow = (t, b = {}) => {
  const balance = b.balance ?? 0
  const pending = b.pending ?? 0
  const unlimited = !!t.allowNegative
  return {
    leaveTypeId: String(t._id), code: t.code, name: t.name, paid: t.paid, tone: t.tone, description: t.description ?? null,
    allowHalfDay: t.allowHalfDay, allowNegative: t.allowNegative, unlimited, compOff: !!t.compOff, maxPerRequest: t.maxPerRequest ?? null,
    balance, taken: b.taken ?? 0, pending,
    available: unlimited ? null : round2(balance - pending),
    // "3 of 12 days left": what was there this year — left now plus what was used this year
    ofTotal: unlimited ? null : round2(balance + (b.used ?? 0)),
  }
}

/** Balance per leave type: on the ledger, waiting for approval, and free to apply for. */
export async function balancesFor(emp, { ensure = true } = {}) {
  if (ensure) await ensureCredits(emp)
  const settings = await hrSettings()
  const year = leaveYear(await todayYmd(), Number(settings.leaveYearStartMonth ?? 4))
  const [types, map] = await Promise.all([LeaveType.find({ active: true }).sort({ order: 1, name: 1 }).lean(), sums(emp._id, year.from)])
  return types.filter((t) => leaveTypeFits(t, emp)).map((t) => balanceRow(t, map.get(String(t._id))))
}

export async function employeeBalances(id, auth) {
  const e = await findEmployee(id, auth, { lean: true })
  return balancesFor(e)
}

export async function ledgerFor(id, leaveTypeId, auth) {
  const e = await findEmployee(id, auth, { lean: true })
  await ensureCredits(e)
  const rows = await LeaveLedger.find({ employeeId: e._id, ...(isOid(leaveTypeId) && { leaveTypeId }) }).sort({ date: -1, createdAt: -1 }).limit(300).lean()
  return clean(rows).map((r) => ({ ...r, kindLabel: LEAVE_LEDGER_KINDS[r.kind] ?? r.kind }))
}

/** HR's correction to a balance (+ or −), or an opening balance, with a reason. */
export async function adjustBalance(id, { leaveTypeId, days, note, kind = 'ADJUSTMENT' }, auth, req) {
  const e = await findEmployee(id, auth, { lean: true })
  const t = await LeaveType.findById(isOid(leaveTypeId) ? leaveTypeId : null).lean()
  if (!t) throw fieldsError({ leaveTypeId: 'Pick a leave type' })
  await LeaveLedger.create({ employeeId: e._id, leaveTypeId: t._id, leaveCode: t.code, kind, date: await todayYmd(), days, note, by: auth.user?.name, byId: auth.userId })
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `${kind === 'OPENING' ? 'Opening balance' : days > 0 ? 'Added' : 'Took off'} ${Math.abs(days)} day(s) of ${t.name} for ${e.name}: ${note}` }, req)
  return balancesFor(e, { ensure: false })
}

/** Compensatory off for a day worked on a holiday or at a school event — once per worked date. */
export async function creditCompOff({ employeeId, workedDate, days, note }, auth, req) {
  const e = await findEmployee(employeeId, auth, { lean: true })
  await ensureLeaveTypes()
  const t = await LeaveType.findOne({ compOff: true, active: true }).lean()
  if (!t) throw conflict('There is no compensatory-off leave in use (Leave › Setup › Leave policies).')
  if (workedDate > await todayYmd()) throw fieldsError({ workedDate: 'That day hasn’t come yet' })
  try {
    await LeaveLedger.create({ employeeId: e._id, leaveTypeId: t._id, leaveCode: t.code, kind: 'COMP_OFF', date: await todayYmd(), days, period: workedDate, note: note || `Worked on ${niceDate(workedDate)}`, by: auth.user?.name, byId: auth.userId })
  } catch (err) {
    if (err?.code === 11000) throw conflict(`Compensatory off for ${niceDate(workedDate)} has already been given.`)
    throw err
  }
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Gave ${daysText(days)} of compensatory off to ${e.name} for working on ${niceDate(workedDate)}` }, req)
  return balancesFor(e, { ensure: false })
}

/** Everyone's balances, one page at a time (Leave › Balances). */
export async function balanceBoard(q, auth) {
  const { page = 1, pageSize = 50 } = q
  const f = { status: { $ne: 'EXITED' }, ...employeeScope(auth) }
  if (isOid(q.departmentId)) f.departmentId = oid(q.departmentId)
  if (q.category) f.category = q.category
  const term = String(q.search ?? '').trim()
  if (term) { const re = new RegExp(escapeRegex(term), 'i'); f.$or = [{ name: re }, { employeeCode: re }, { designation: re }] }
  const [staff, total, types, depts] = await Promise.all([
    Employee.find(f).sort({ name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Employee.countDocuments(f),
    listLeaveTypes(),
    Department.find().select('name').lean(),
  ])
  const dept = new Map(depts.map((d) => [String(d._id), d.name]))
  const rows = []
  for (const e of staff) {
    rows.push({ employeeId: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, category: e.category, department: dept.get(sid(e.departmentId)) ?? null, balances: await balancesFor(e) })
  }
  return { types: types.filter((x) => x.active), rows, total, page, pageSize }
}

// ───────────────────────────────────────────────────────── lessons that need cover (a teacher's leave)

/**
 * A teacher's lessons on these dates in the published timetable, and how many already have a substitute.
 * → null when the person isn't a teacher with a login, or there is no published timetable.
 */
export async function lessonsFor(e, dates, auth) {
  if (!e?.userId || !dates?.length || (auth && !moduleEnabled(auth, 'timetable'))) return null
  const [{ Timetable, TimetableEntry, Substitution }, { yearOrCurrent }] = await Promise.all([import('../models/timetable.js'), import('./academics.js')])
  let year
  try { year = await yearOrCurrent() } catch { return null }
  const pub = await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).select('_id effectiveFrom').lean()
  if (!pub) return null
  const [entries, subs] = await Promise.all([
    TimetableEntry.find({ timetableId: pub._id, teacherId: e.userId }).select('day').lean(),
    Substitution.find({ absentTeacherId: e.userId, date: { $in: dates } }).select('date').lean(),
  ])
  if (!entries.length) return null
  const perDay = new Map()
  for (const x of entries) perDay.set(x.day, (perDay.get(x.day) ?? 0) + 1)
  const days = dates.filter((d) => !pub.effectiveFrom || d >= pub.effectiveFrom).map((date) => ({
    date, lessons: perDay.get(weekdayCode(date)) ?? 0, covered: subs.filter((s) => s.date === date).length,
  })).filter((d) => d.lessons > 0)
  const total = days.reduce((n, d) => n + d.lessons, 0)
  return { total, covered: days.reduce((n, d) => n + Math.min(d.covered, d.lessons), 0), days }
}

// ───────────────────────────────────────────────────────── requests: preview and apply

const dto = (l) => ({
  ...clean(l), employeeId: String(l.employeeId), leaveTypeId: String(l.leaveTypeId), statusLabel: statusLabel(l.status),
  pendingWith: (l.pendingWith ?? []).map(String), userId: idStr(l.userId), departmentId: idStr(l.departmentId),
})
const withChainDto = (rows, auth) => withChain(rows, auth, dto)

const problem = (code, text, field, status = 400) => ({ code, text, field, status })

/**
 * What a leave would cost: each date and whether it counts (holidays, weekly offs and the person's school vacation are
 * free unless the sandwich rule pulls them in), the balance before and after, the no-leave days it touches, who will
 * approve it, a teacher's lessons on those days — and anything that stops it being applied (`problems`).
 * `self`: the person is applying themselves (no-leave days set to "don't allow" stop them; HR may still enter it).
 */
export async function previewLeave(input, e, { self = true, auth, excludeId } = {}) {
  await ensureLeaveTypes()
  const type = await LeaveType.findOne({ _id: isOid(input.leaveTypeId) ? input.leaveTypeId : null }).lean()
  if (!type || !type.active) throw fieldsError({ leaveTypeId: 'Pick a leave type' })
  if (!leaveTypeFits(type, e)) throw fieldsError({ leaveTypeId: `${type.name} isn’t for this person` })
  const to = input.to || input.from
  if (to < input.from) throw fieldsError({ to: 'On or after the first day' })
  if ((Date.parse(to) - Date.parse(input.from)) / 864e5 > 200) throw fieldsError({ to: 'Pick at most 200 days' })
  const halfDay = !!input.halfDay
  if (halfDay && (!type.allowHalfDay || input.from !== to)) throw fieldsError({ halfDay: type.allowHalfDay ? 'A half day is one date' : `${type.name} is taken in full days` })
  const settings = await hrSettings()
  const today = await todayYmd()
  const range = await daysFor(e, input.from, to, settings)
  const counted = countLeaveDays(range, { halfDay, sandwich: type.sandwich })
  const dates = counted.dates.map((d, i) => ({ ...d, reason: range[i].reason, kind: range[i].kind }))
  const takes = dates.filter((d) => d.portion > 0).map((d) => d.date)
  const problems = []
  const warnings = []
  if (e.joiningDate && input.from < e.joiningDate) problems.push(problem('BEFORE_JOINING', `That is before ${e.name} joined (${niceDate(e.joiningDate)}).`, 'from'))
  if (!counted.days) problems.push(problem('ALL_OFF', 'Every day picked is a holiday, a weekly off or school vacation.', 'from'))
  if (type.maxPerRequest && counted.days > type.maxPerRequest) problems.push(problem('TOO_LONG', `${type.name} is at most ${daysText(type.maxPerRequest)} at a time.`, 'to'))
  const overlaps = takes.length ? await Leave.find({ employeeId: e._id, status: { $in: ['PENDING', 'APPROVED'] }, 'dates.date': { $in: takes }, ...(excludeId && { _id: { $ne: excludeId } }) }).select('leaveName leaveCode from to status').lean() : []
  if (overlaps.length) problems.push(problem('OVERLAP', `There is already leave on some of these days: ${overlaps.map((o) => `${o.leaveName ?? o.leaveCode}, ${datesText(o)} (${statusLabel(o.status).toLowerCase()})`).join('; ')}.`, 'from', 409))
  const bal = (await balancesFor(e)).find((b) => b.leaveTypeId === String(type._id)) ?? balanceRow(type)
  if (!type.allowNegative && counted.days > (bal.available ?? 0)) {
    problems.push(problem('BALANCE', `Not enough ${type.name}: ${daysText(bal.available ?? 0)} free, ${daysText(counted.days)} asked for.`, 'leaveTypeId', 409))
  }
  // no-leave days (exams, annual day …), unless the type doesn't follow them
  let needsHr = false
  const noLeave = []
  if (!type.blackoutExempt && takes.length) {
    const hits = (await calendarBetween(takes[0], takes.at(-1), 'NO_LEAVE')).filter((c) => covers(c, e) && takes.some((d) => d >= c.from && d <= c.to))
    for (const c of hits) {
      noLeave.push({ name: c.name, from: c.from, to: c.to, mode: c.mode })
      for (const d of dates) if (d.portion > 0 && d.date >= c.from && d.date <= c.to) d.noLeave = c.name
      const what = `${c.name} (${datesText(c)})`
      if (c.mode === 'BLOCK' && self) problems.push(problem('NO_LEAVE', `Leave isn’t allowed during ${what}. Speak to the principal or HR.`, 'from', 409))
      else if (c.mode === 'HR' || (c.mode === 'BLOCK' && !self)) { needsHr = true; warnings.push(`Falls on no-leave days: ${what} — the principal or HR must approve it.`) } else warnings.push(`Falls on no-leave days: ${what}.`)
    }
  }
  if (type.noticeDays && self && input.from >= today) {
    const ahead = Math.round((Date.parse(input.from) - Date.parse(today)) / 864e5)
    if (ahead < type.noticeDays) warnings.push(`Asked ${ahead === 0 ? 'on the day' : `${daysText(ahead)} ahead`} — ${type.name} should be asked ${daysText(type.noticeDays)} ahead.`)
  }
  const lessons = await lessonsFor(e, takes, auth)
  const chain = problems.length ? null : await planChain({ leaveTypeId: type._id, days: counted.days }, e, { needsHr })
  return {
    leaveType: { id: String(type._id), code: type.code, name: type.name, paid: type.paid !== false, sandwich: !!type.sandwich, unlimited: !!type.allowNegative, description: type.description ?? null },
    from: input.from, to, halfDay, days: counted.days, dates,
    balance: bal.balance, pending: bal.pending, available: bal.available, after: bal.available === null ? null : round2(bal.available - counted.days), ofTotal: bal.ofTotal,
    noLeave, needsHr, warnings, problems, lessons, chain, ok: !problems.length,
  }
}

export async function previewFor(input, auth, { self }) {
  const e = self ? await myEmployee(auth) : await findEmployee(input.employeeId, auth, { lean: true })
  return previewLeave(input, e, { self, auth })
}

async function create(emp, input, auth, req, { onBehalf }) {
  const p = await previewLeave(input, emp, { self: !onBehalf, auth })
  if (!p.ok) {
    const first = p.problems[0]
    const fields = Object.fromEntries(p.problems.filter((x) => x.field).map((x) => [x.field, x.text]))
    throw new AppError(first.status, p.problems.map((x) => x.text).join(' '), { code: 'LEAVE_NOT_ALLOWED', details: { fields, problems: p.problems.map((x) => x.text) } })
  }
  const l = await Leave.create({
    ...employeeSnap(emp), leaveTypeId: p.leaveType.id, leaveCode: p.leaveType.code, leaveName: p.leaveType.name, paid: p.leaveType.paid,
    from: p.from, to: p.to, halfDay: p.halfDay, half: p.halfDay ? input.half || 'FIRST' : undefined, days: p.days,
    dates: p.dates.filter((d) => d.portion > 0).map((d) => ({ date: d.date, portion: d.portion })),
    reason: input.reason, arrangement: input.arrangement || undefined, warnings: p.warnings.length ? p.warnings : undefined,
    applied: { ...stamp(auth), onBehalf },
  })
  await audit({ action: 'CREATE', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: emp.name, summary: `${onBehalf ? 'Applied' : 'Asked'} for ${daysText(p.days)} of ${p.leaveType.name} for ${emp.name} (${datesText(p)})` }, req)
  // the approval chain (a rule, or the usual: reporting manager, else the principal / HR) — it tells the first approvers
  let started = await startChain(l.toObject(), emp, { needsHr: p.needsHr })
  if (input.approveNow && can(auth, 'hrms.leave.approve') && sid(emp.userId) !== sid(auth.userId)) {
    started = await decideStep(String(l._id), { approve: true, note: 'Approved when entered' }, auth, req)
  }
  return (await withChainDto([started], auth))[0]
}

/** Self-service: the signed-in person asks for leave. */
export async function applyMine(input, auth, req) {
  if (!(await hrSettings()).selfLeave) throw forbidden('Leave is entered by the office here. Ask HR.')
  const emp = await myEmployee(auth)
  if (emp.status === 'EXITED') throw forbidden('Your staff record is closed.')
  return create(emp, input, auth, req, { onBehalf: false })
}

/** HR (or someone with apply_on_behalf) applies for a person. */
export async function applyFor(input, auth, req) {
  const emp = await findEmployee(input.employeeId, auth, { lean: true })
  if (emp.status === 'EXITED') throw conflict(`${emp.name} has left.`)
  return create(emp, input, auth, req, { onBehalf: true })
}

// ───────────────────────────────────────────────────────── deciding

/** Approve / reject the step a request waits on (hrmsLeaveApprovals.decideStep). */
export async function decideLeave(id, { approve, note }, auth, req) {
  const r = await decideStep(id, { approve, note }, auth, req)
  return (await withChainDto([r], auth))[0]
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
 * The final approval (called by decideStep): the balance and clash checks, then the request closes as approved,
 * the days come off the ledger and go into staff attendance, and — for a teacher with lessons on those days — the
 * timetable desk is told how many need cover.
 */
export async function finalApproval(l, e, auth, { guard, set, raced }) {
  const type = await LeaveType.findById(l.leaveTypeId).lean()
  if (type && !type.allowNegative) {
    await ensureCredits(e)
    const [bal] = await LeaveLedger.aggregate([{ $match: { employeeId: l.employeeId, leaveTypeId: l.leaveTypeId } }, { $group: { _id: null, n: { $sum: '$days' } } }])
    if ((bal?.n ?? 0) < l.days) throw conflict(`${e.name} has only ${daysText(round2(bal?.n ?? 0))} of ${type.name} left. Don’t approve it, or ask HR to correct the balance.`)
  }
  const clash = await Leave.exists({ _id: { $ne: l._id }, employeeId: l.employeeId, status: 'APPROVED', 'dates.date': { $in: l.dates.map((d) => d.date) } })
  if (clash) throw conflict('Some of these days are already on approved leave.')
  const r = await Leave.findOneAndUpdate(guard, { $set: set }, { new: true }).lean()
  if (!r) throw raced()
  await LeaveLedger.create({ employeeId: l.employeeId, leaveTypeId: l.leaveTypeId, leaveCode: l.leaveCode, kind: 'TAKEN', date: l.from, days: -l.days, leaveId: l._id, note: datesText(l), by: auth.user?.name, byId: auth.userId })
  await writeAttendance(l, auth)
  await emit('hrms.leave_approved', { entity: { type: 'leave', id: l._id }, data: { employeeId: String(l.employeeId), employeeName: l.employeeName, leaveCode: l.leaveCode, from: l.from, to: l.to, days: l.days } })
  // a teacher's lessons on those days: the people who arrange substitutions are told
  const cover = await lessonsFor(e, l.dates.map((d) => d.date), auth).catch(() => null)
  if (cover?.total > cover?.covered) {
    const ids = (await usersWith('timetable.substitutions.create', { fallbackToAdmins: false })).filter((u) => u !== sid(e.userId))
    const first = cover.days.find((d) => d.covered < d.lessons)?.date ?? l.from
    await notifyUsers(ids, {
      event: 'timetable.substitution', tone: 'warning', entityType: 'leave', entityId: String(l._id), link: `/timetable/substitutions?date=${first}`,
      title: `Cover needed: ${l.employeeName} is on leave`, message: `${datesText(l)} — ${cover.total - cover.covered} lesson${cover.total - cover.covered === 1 ? '' : 's'} without a teacher`,
    })
  }
  return r
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
  const was = l.status
  if (was === 'APPROVED') {
    await LeaveLedger.create({ employeeId: l.employeeId, leaveTypeId: l.leaveTypeId, leaveCode: l.leaveCode, kind: 'REVERSAL', date: today, days: l.days, leaveId: l._id, note: `Cancelled: ${datesText(l)}`, by: auth.user?.name, byId: auth.userId })
    await StaffAttendance.deleteMany({ employeeId: l.employeeId, 'leave.leaveId': l._id, source: 'LEAVE' })
  }
  l.status = 'CANCELLED'
  l.cancelled = { ...stamp(auth), reason, afterApproval: was === 'APPROVED' }
  l.pendingWith = []
  l.pendingWithHr = false
  await l.save()
  if (was === 'PENDING') await notifyWithdrawn(l.toObject())
  await audit({ action: 'CANCEL', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `Cancelled ${was === 'APPROVED' ? 'approved' : 'waiting'} leave of ${l.employeeName}: ${daysText(l.days)} of ${l.leaveName ?? l.leaveCode} (${datesText(l)})${was === 'APPROVED' ? ' — days given back' : ''}${reason ? ` — ${reason}` : ''}` }, req)
  if (!own && l.userId) await tellApplicant(l, 'Leave cancelled', `${l.leaveName}, ${datesText(l)}${reason ? ` — ${reason}` : ''}`, 'warning')
  return (await withChainDto([l.toObject()], auth))[0]
}

// ───────────────────────────────────────────────────────── lists

/**
 * Leave requests, one page at a time (waiting: soonest first; otherwise latest first). Search runs on the server over
 * the person's name and staff code. `box: 'mine'` = waiting on me (my step, whatever my data scope). `pending` counts
 * every request waiting in the caller's scope, whatever the filters; `waitingOnMe` those waiting on the caller.
 */
export async function listLeaves(q, auth) {
  const { page = 1, pageSize = 50 } = q
  await sweepEscalations()
  const scope = await employeeIdFilter(auth)
  const f = q.box === 'mine' ? await waitingFilter(auth) : { ...await employeeIdFilter(auth, q.employeeId) }
  const today = await todayYmd()
  if (q.box !== 'mine') {
    if (q.status === 'UPCOMING') Object.assign(f, { status: 'APPROVED', to: { $gte: today } })
    else if (q.status) f.status = q.status
  }
  if (q.leaveTypeId) f.leaveTypeId = oid(q.leaveTypeId)
  if (isOid(q.departmentId)) f.departmentId = oid(q.departmentId)
  if (q.from) f.to = { ...(f.to ?? {}), $gte: q.from }
  if (q.to) f.from = { $lte: q.to }
  const term = String(q.search ?? '').trim()
  if (term) { const re = new RegExp(escapeRegex(term), 'i'); f.$and = [...(f.$and ?? []), { $or: [{ employeeName: re }, { employeeCode: re }, { leaveName: re }] }] }
  const sort = q.box === 'mine' || q.status === 'PENDING' || q.status === 'UPCOMING' ? { from: 1, _id: 1 } : { from: -1, _id: -1 }
  const [rows, total, pending, waitingOnMeN] = await Promise.all([
    Leave.find(f).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Leave.countDocuments(f),
    Leave.countDocuments({ ...scope, status: 'PENDING' }),
    countWaitingOnMe(auth),
  ])
  return { rows: await withChainDto(rows, auth), total, page, pageSize, pending, waitingOnMe: waitingOnMeN }
}

/** One request with its chain, the person's balance of that type and a teacher's lessons that need cover. */
export async function getLeave(id, auth) {
  const l = await Leave.findById(isOid(id) ? id : null).lean()
  if (!l) throw notFound('Leave request')
  const scoped = await scopedEmployeeIds(auth)
  const inScope = (!scoped || scoped.some((x) => sid(x) === sid(l.employeeId))) && can(auth, 'hrms.leave.view')
  const named = (l.approvals ?? []).some((s) => (s.approverIds ?? []).some((u) => sid(u) === sid(auth.userId))) || (l.pendingWith ?? []).some((u) => sid(u) === sid(auth.userId))
  if (!inScope && !named && sid(l.userId) !== sid(auth.userId)) throw notFound('Leave request')
  const e = await Employee.findById(l.employeeId).lean()
  const [row] = await withChainDto([l], auth)
  const [balance, lessons, dept] = await Promise.all([
    e ? balancesFor(e).then((b) => b.find((x) => x.leaveTypeId === sid(l.leaveTypeId)) ?? null) : null,
    ['PENDING', 'APPROVED'].includes(l.status) ? lessonsFor(e, l.dates.map((d) => d.date), auth) : null,
    e?.departmentId ? Department.findById(e.departmentId).select('name').lean() : null,
  ])
  return { ...row, designation: e?.designation ?? null, department: dept?.name ?? null, category: e?.category ?? null, balance, lessons }
}

/** Requests the signed-in person can decide (My workspace › Team leave). */
export async function waitingForMe(auth) {
  return withChainDto(await waitingOnMe(auth), auth)
}

/** Self-service: my balances, requests and the no-leave days coming up. */
export async function myLeave(auth) {
  const emp = await myEmployee(auth)
  await sweepEscalations()
  const today = await todayYmd()
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 120 * 864e5).toISOString().slice(0, 10)
  const [balances, rows, settings, calendar] = await Promise.all([
    balancesFor(emp),
    Leave.find({ employeeId: emp._id }).sort({ from: -1 }).limit(100).lean(),
    hrSettings(),
    calendarBetween(today, until),
  ])
  return {
    balances, requests: await withChainDto(rows, auth), canApply: !!settings.selfLeave,
    calendar: calendar.filter((c) => covers(c, emp)).map((c) => ({ kind: c.kind, name: c.name, from: c.from, to: c.to, mode: c.mode ?? null })),
  }
}

/** Who is on approved leave on a date (the timetable's substitution desk asks this). */
export async function onLeaveOn(date) {
  const rows = await Leave.find({ status: 'APPROVED', 'dates.date': date }).select('employeeId employeeName userId leaveCode leaveName dates').lean()
  return rows.map((l) => ({ employeeId: String(l.employeeId), userId: idStr(l.userId), name: l.employeeName, leaveCode: l.leaveCode, leaveName: l.leaveName, portion: l.dates.find((d) => d.date === date)?.portion ?? 1 }))
}

/** The Leave page's tiles: this leave year's requests by status, who is away today, and what waits on the caller. */
export async function leaveSummary(auth) {
  const today = await todayYmd()
  const s = await hrSettings()
  const startMonth = Number(s.leaveYearStartMonth ?? 4)
  const year = leaveYear(today, startMonth)
  const scope = await employeeIdFilter(auth)
  const [groups, waiting, away, types] = await Promise.all([
    Leave.aggregate([{ $match: { ...scope, from: { $lte: year.to }, to: { $gte: year.from } } }, { $group: { _id: '$status', n: { $sum: 1 }, days: { $sum: '$days' } } }]),
    countWaitingOnMe(auth),
    Leave.countDocuments({ ...scope, status: 'APPROVED', 'dates.date': today }),
    LeaveType.countDocuments({ active: true }),
  ])
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 }
  let daysOff = 0
  for (const g of groups) { counts[g._id] = g.n; if (g._id === 'APPROVED') daysOff = round2(g.days) }
  return { today, year: { ...year, startMonth }, counts, daysOff, waitingOnMe: waiting, onLeaveToday: away, types }
}

// ───────────────────────────────────────────────────────── team calendar

/**
 * Who is on leave which day of a month (approved and waiting), by department — the principal's view.
 * Only people with leave that month get a row; the days carry holidays, weekly offs, vacations and no-leave days.
 */
export async function teamCalendar({ month, departmentId, category, search }, auth) {
  const days = monthDays(month)
  const from = days[0]
  const to = days.at(-1)
  const settings = await hrSettings()
  const f = { status: { $ne: 'EXITED' }, ...employeeScope(auth) }
  if (isOid(departmentId)) f.departmentId = oid(departmentId)
  if (category) f.category = category
  const term = String(search ?? '').trim()
  if (term) { const re = new RegExp(escapeRegex(term), 'i'); f.$or = [{ name: re }, { employeeCode: re }] }
  const staff = await Employee.find(f).select('name employeeCode designation departmentId category branchId').lean()
  const ids = staff.map((e) => e._id)
  const [leaves, holidays, calendar, depts] = await Promise.all([
    Leave.find({ employeeId: { $in: ids }, status: { $in: ['APPROVED', 'PENDING'] }, from: { $lte: to }, to: { $gte: from } }).select('employeeId leaveName leaveCode status dates halfDay half').lean(),
    holidaysBetween(from, to),
    calendarBetween(from, to),
    Department.find().select('name').lean(),
  ])
  const dept = new Map(depts.map((d) => [String(d._id), d.name]))
  const byEmp = new Map()
  for (const l of leaves) {
    const cells = byEmp.get(String(l.employeeId)) ?? {}
    for (const d of l.dates) if (d.date >= from && d.date <= to) cells[d.date] = { leaveId: String(l._id), status: l.status, name: l.leaveName ?? l.leaveCode, portion: d.portion }
    byEmp.set(String(l.employeeId), cells)
  }
  const generic = { weeklyOffDays: undefined, branchId: null }
  const out = days.map((date) => {
    const off = dayOffFor(generic, date, { settings, holidays: holidays.filter((h) => !h.branchIds?.length) })
    const marks = calendar.filter((c) => c.from <= date && c.to >= date)
    let onLeave = 0; let waiting = 0
    for (const cells of byEmp.values()) { const c = cells[date]; if (c?.status === 'APPROVED') onLeave++; else if (c) waiting++ }
    return {
      date, dow: weekdayCode(date), off: off?.kind ?? null, holiday: off?.kind === 'HOLIDAY' ? off.name : null,
      noLeave: marks.filter((c) => c.kind === 'NO_LEAVE').map((c) => c.name), vacation: marks.find((c) => c.kind === 'VACATION')?.name ?? null, onLeave, waiting,
    }
  })
  const rows = staff.filter((e) => byEmp.has(String(e._id))).map((e) => ({
    employeeId: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, category: e.category,
    departmentId: idStr(e.departmentId), department: dept.get(sid(e.departmentId)) ?? null, cells: byEmp.get(String(e._id)),
  })).sort((a, b) => (a.department ?? '~').localeCompare(b.department ?? '~') || a.name.localeCompare(b.name))
  return { month, days: out, rows, staffCount: staff.length }
}

// ───────────────────────────────────────────────────────── year end (carry forward and lapse)

/**
 * What the year end does to everyone in scope: the balance above each type's carry-forward limit lapses, the rest is
 * carried into the next leave year. `projected` is the coming year end (from today's balances, waiting requests
 * counted as taken); `done` is what lapsed at the start of this leave year, and how many staff aren't brought up to
 * date for it yet (they are when their balance is next looked at, or with runYearEnd).
 */
export async function yearEndPreview(auth) {
  const today = await todayYmd()
  const s = await hrSettings()
  const year = leaveYear(today, Number(s.leaveYearStartMonth ?? 4))
  const next = leaveYear(new Date(Date.parse(`${year.to}T00:00:00Z`) + 864e5).toISOString().slice(0, 10), Number(s.leaveYearStartMonth ?? 4))
  const staff = await Employee.find({ status: { $ne: 'EXITED' }, ...employeeScope(auth) }).select('name employeeCode designation category gender joiningDate leaveYearDone').sort({ name: 1 }).lean()
  const types = (await LeaveType.find({ active: true }).sort({ order: 1 }).lean()).filter((t) => normalizeAccrual(t.accrual) !== 'NONE')
  const ids = staff.map((e) => e._id)
  const [ledger, pending, lapsed] = await Promise.all([
    LeaveLedger.aggregate([{ $match: { employeeId: { $in: ids } } }, { $group: { _id: { e: '$employeeId', t: '$leaveTypeId' }, n: { $sum: '$days' } } }]),
    Leave.aggregate([{ $match: { employeeId: { $in: ids }, status: 'PENDING' } }, { $group: { _id: { e: '$employeeId', t: '$leaveTypeId' }, n: { $sum: '$days' } } }]),
    LeaveLedger.aggregate([{ $match: { employeeId: { $in: ids }, kind: 'LAPSE', period: year.label } }, { $group: { _id: '$employeeId', n: { $sum: '$days' } } }]),
  ])
  const key = (e, t) => `${e}|${t}`
  const bal = new Map(ledger.map((r) => [key(r._id.e, r._id.t), r.n]))
  const pend = new Map(pending.map((r) => [key(r._id.e, r._id.t), r.n]))
  const rows = []
  let lapseDays = 0; let keepDays = 0
  for (const e of staff) {
    const items = []
    for (const t of types.filter((x) => leaveTypeFits(x, e))) {
      const left = round2((bal.get(key(e._id, t._id)) ?? 0) - (pend.get(key(e._id, t._id)) ?? 0))
      if (left <= 0) continue
      const cap = t.carryForwardMax ?? null
      const keep = cap === null ? left : Math.min(left, cap)
      const lapse = round2(left - keep)
      items.push({ leaveTypeId: String(t._id), name: t.name, left, cap, keep: round2(keep), lapse })
      lapseDays += lapse; keepDays += keep
    }
    if (items.length) rows.push({ employeeId: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, lapse: round2(items.reduce((n, x) => n + x.lapse, 0)), keep: round2(items.reduce((n, x) => n + x.keep, 0)), items })
  }
  rows.sort((a, b) => b.lapse - a.lapse || a.name.localeCompare(b.name))
  return {
    today, year, next,
    projected: { people: rows.filter((r) => r.lapse > 0).length, lapseDays: round2(lapseDays), keepDays: round2(keepDays), rows },
    done: {
      label: year.label, lapsedDays: round2(-lapsed.reduce((n, r) => n + r.n, 0)), people: lapsed.filter((r) => r.n < 0).length,
      notYet: staff.filter((e) => e.leaveYearDone !== year.label && (!e.joiningDate || e.joiningDate <= today)).length, staff: staff.length,
    },
  }
}

/** Bring every staff record in scope up to date for this leave year: last year's lapse and this year's credits. Safe to run again. */
export async function runYearEnd(auth, req) {
  const today = await todayYmd()
  const staff = await Employee.find({ status: { $ne: 'EXITED' }, ...employeeScope(auth), $or: [{ joiningDate: { $lte: today } }, { joiningDate: null }] }).lean()
  const before = await LeaveLedger.countDocuments({ employeeId: { $in: staff.map((e) => e._id) } })
  for (const e of staff) await ensureCredits(e, today)
  const after = await LeaveLedger.countDocuments({ employeeId: { $in: staff.map((e) => e._id) } })
  const s = await hrSettings()
  const year = leaveYear(today, Number(s.leaveYearStartMonth ?? 4))
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'leave_year', entityId: year.label, entityName: year.label, summary: `Brought leave balances up to date for ${year.label}: ${staff.length} staff, ${after - before} new entries (credits and lapses)` }, req)
  return { staff: staff.length, entries: after - before, ...(await yearEndPreview(auth)) }
}
