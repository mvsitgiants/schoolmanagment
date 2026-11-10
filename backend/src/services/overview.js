import { addDaysYmd, attendancePct, countMarks, priorRange, splitRange } from '@schoolgiant/shared'
import { Enquiry, Application } from '../models/admissions.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Certificate } from '../models/certificates.js'
import { MessageLog } from '../models/engines.js'
import { SchoolEvent } from '../models/events.js'
import { Exam } from '../models/exams.js'
import { FeeInvoice, FeePayment, FeeRefund } from '../models/fees.js'
import { Expense } from '../models/finance.js'
import { Homework } from '../models/homework.js'
import { Employee, Holiday, StaffAttendance } from '../models/hrms.js'
import { LibraryCopy, LibraryLoan } from '../models/library.js'
import { LiveClass } from '../models/lms.js'
import { Notice } from '../models/communication.js'
import { TestAttempt } from '../models/onlineTests.js'
import { PayrollRun } from '../models/payroll.js'
import { Student } from '../models/students.js'
import { AuditLog } from '../models/tenant.js'
import { TransportAssignment, Vehicle } from '../models/transport.js'
import { can, moduleEnabled } from '../platform/access.js'
import { institutionNow, timeZoneOf } from '../platform/time.js'
import { currentYear } from './academics.js'
import { waitingCount } from './approvals.js'
import { myTeaching } from './homework.js'
import { branchFilterFor, on, pendingFor, scopedSections } from './dashboard.js'

// Home › the institution at a glance, for a chosen period (as the ERP's command center): headline
// figures with the previous period and a sparkline, money in and out by month, the admissions
// funnel, today's state of attendance / fees / staff / library / transport, each module's pulse,
// what is coming up, recent activity and decisions waiting. Every block shows only when its module
// is on and the caller may see it there — within their data scope (sections, campus).

const sum = (rows, key = 'amount') => rows.reduce((n, r) => n + (r[key] ?? 0), 0)
const inRange = (d, r) => d >= r.from && d <= r.to
/** Per-day rows ({ _id: 'YYYY-MM-DD', … }) summed into the range, the prior range and each bucket. */
function series(rows, range, prev, buckets, key = 'n') {
  const total = (r) => rows.filter((x) => inRange(x._id, r)).reduce((n, x) => n + (x[key] ?? 0), 0)
  return { value: total(range), prev: total(prev), spark: buckets.map(total) }
}
const byDay = (field, extra = {}) => [{ $group: { _id: `$${field}`, n: { $sum: 1 }, ...extra } }]
const byDayOfDate = (field, tz) => [{ $group: { _id: { $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone: tz } }, n: { $sum: 1 } } }]
const toDate = (ymd, end = false) => new Date(`${ymd}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
/** A Date window wide enough for every timezone around from–to (the day itself is then cut in YYYY-MM-DD). */
const dateWindow = (from, to) => ({ $gte: new Date(toDate(from).getTime() - 864e5), $lte: new Date(toDate(to, true).getTime() + 864e5) })

function monthsBack(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - n + i, 1)); return d.toISOString().slice(0, 7) })
}

// ───────────────────────────────────────────────────────── headline figures

async function studentsKpi(auth, year, ctx) {
  const sections = await scopedSections(auth, 'students', year)
  const ids = sections.map((s) => s._id)
  const [active, byGender, joined] = await Promise.all([
    Student.countDocuments({ status: 'ACTIVE', sectionId: { $in: ids } }),
    Student.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: ids } } }, { $group: { _id: '$gender', n: { $sum: 1 } } }]),
    Student.aggregate([{ $match: { sectionId: { $in: ids }, admissionDate: { $gte: ctx.prev.from, $lte: ctx.range.to } } }, ...byDay('admissionDate')]),
  ])
  const g = (k) => byGender.find((x) => x._id === k)?.n ?? 0
  const s = series(joined, ctx.range, ctx.prev, ctx.buckets)
  return { value: active, joined: s.value, prevJoined: s.prev, spark: s.spark, boys: g('MALE'), girls: g('FEMALE'), sections: sections.length }
}

async function attendanceKpi(auth, year, ctx) {
  const sections = await scopedSections(auth, 'attendance', year)
  const sheets = await AttendanceSheet.find({ sectionId: { $in: sections.map((s) => s._id) }, period: 0, date: { $gte: ctx.prev.from, $lte: ctx.range.to } }).select('sectionId date entries').lean()
  const pct = (r) => attendancePct(countMarks(sheets.filter((s) => inRange(s.date, r)).flatMap((s) => s.entries)))
  const todays = sheets.filter((s) => s.date === ctx.today)
  const c = countMarks(todays.flatMap((s) => s.entries))
  return {
    value: pct(ctx.range), prev: pct(ctx.prev), spark: ctx.buckets.map((b) => pct(b) ?? 0),
    today: { present: c.P + c.L + c.HD, absent: c.A, onLeave: c.LV, sections: sections.length, marked: new Set(todays.map((s) => String(s.sectionId))).size },
  }
}

async function feesKpi(auth, year, ctx) {
  const f = await branchFilterFor(auth, 'fees')
  const [paid, refunds, dues, yearPaid] = await Promise.all([
    FeePayment.aggregate([{ $match: { ...f, status: 'VALID', date: { $gte: ctx.prev.from, $lte: ctx.range.to } } }, ...byDay('date', { amount: { $sum: '$amount' } })]),
    FeeRefund.aggregate([{ $match: { ...f, date: { $gte: ctx.range.from, $lte: ctx.range.to } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    FeeInvoice.aggregate([
      { $match: { ...f, academicYearId: year._id, status: { $in: ['UNPAID', 'PARTIAL'] } } },
      { $group: { _id: null, due: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', ctx.today] }, '$balance', 0] } }, students: { $addToSet: '$studentId' } } },
    ]),
    FeePayment.aggregate([{ $match: { ...f, status: 'VALID', date: { $gte: year.startDate, $lte: ctx.today } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ])
  const s = series(paid, ctx.range, ctx.prev, ctx.buckets, 'amount')
  const receipts = series(paid, ctx.range, ctx.prev, ctx.buckets, 'n')
  return {
    value: s.value - (refunds[0]?.amount ?? 0), prev: s.prev, spark: s.spark, receipts: receipts.value,
    position: { collected: yearPaid[0]?.amount ?? 0, due: (dues[0]?.due ?? 0) - (dues[0]?.overdue ?? 0), overdue: dues[0]?.overdue ?? 0, studentsOwing: dues[0]?.students.length ?? 0 },
  }
}

async function admissionsKpi(ctx) {
  const window = { createdAt: dateWindow(ctx.prev.from, ctx.range.to) }
  const [made, stages, applications, admitted] = await Promise.all([
    Enquiry.aggregate([{ $match: window }, ...byDayOfDate('createdAt', ctx.tz)]),
    Enquiry.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Application.countDocuments({ submittedAt: dateWindow(ctx.range.from, ctx.range.to) }),
    Application.countDocuments({ status: 'ADMITTED' }),
  ])
  const s = series(made, ctx.range, ctx.prev, ctx.buckets)
  const total = stages.reduce((n, x) => n + x.n, 0)
  const won = stages.find((x) => x._id === 'ADMITTED')?.n ?? 0
  return {
    value: s.value, prev: s.prev, spark: s.spark, applications, admitted,
    stages: Object.fromEntries(stages.map((x) => [x._id, x.n])), conversion: total ? Math.round((won / total) * 1000) / 10 : 0,
  }
}

async function expensesKpi(ctx) {
  const rows = await Expense.aggregate([{ $match: { status: { $in: ['APPROVED', 'PAID'] }, date: { $gte: ctx.prev.from, $lte: ctx.range.to } } }, ...byDay('date', { amount: { $sum: '$amount' } })])
  const waiting = await Expense.countDocuments({ status: 'SUBMITTED' })
  return { ...series(rows, ctx.range, ctx.prev, ctx.buckets, 'amount'), waiting }
}

async function staffKpi(ctx) {
  const [active, joined, att] = await Promise.all([
    Employee.countDocuments({ status: { $in: ['ACTIVE', 'NOTICE'] } }),
    Employee.aggregate([{ $match: { joiningDate: { $gte: ctx.prev.from, $lte: ctx.range.to } } }, ...byDay('joiningDate')]),
    StaffAttendance.find({ date: { $gte: ctx.prev.from, $lte: ctx.range.to } }).select('date status').lean(),
  ])
  const worked = (r) => {
    const days = att.filter((a) => inRange(a.date, r) && !['HOLIDAY', 'WEEKLY_OFF'].includes(a.status))
    if (!days.length) return null
    const present = days.filter((a) => ['PRESENT', 'ON_DUTY'].includes(a.status)).length + days.filter((a) => a.status === 'HALF_DAY').length / 2
    return Math.round((present / days.length) * 1000) / 10
  }
  const today = att.filter((a) => a.date === ctx.today)
  const n = (...st) => today.filter((a) => st.includes(a.status)).length
  const j = series(joined, ctx.range, ctx.prev, ctx.buckets)
  return {
    value: active, joined: j.value, attendance: worked(ctx.range), prevAttendance: worked(ctx.prev), spark: ctx.buckets.map((b) => worked(b) ?? 0),
    today: { present: n('PRESENT', 'ON_DUTY', 'HALF_DAY'), absent: n('ABSENT'), onLeave: n('LEAVE'), notMarked: Math.max(0, active - today.filter((a) => !['HOLIDAY', 'WEEKLY_OFF'].includes(a.status)).length) },
  }
}

// ───────────────────────────────────────────────────────── money in and out, by month

async function moneyByMonth(auth, ctx, show) {
  const months = monthsBack(ctx.range.to.slice(0, 7), 6)
  const from = `${months[0]}-01`
  const out = months.map((m) => ({ month: m }))
  const put = (key, rows) => { for (const r of rows) { const row = out.find((x) => x.month === r._id); if (row) row[key] = r.amount } }
  const month = { $substr: ['$date', 0, 7] }
  if (show.fees) {
    const f = await branchFilterFor(auth, 'fees')
    put('fees', await FeePayment.aggregate([{ $match: { ...f, status: 'VALID', date: { $gte: from, $lte: ctx.range.to } } }, { $group: { _id: month, amount: { $sum: '$amount' } } }]))
  }
  if (show.expenses) put('expenses', await Expense.aggregate([{ $match: { status: { $in: ['APPROVED', 'PAID'] }, date: { $gte: from, $lte: ctx.range.to } } }, { $group: { _id: month, amount: { $sum: '$amount' } } }]))
  if (show.payroll) put('payroll', await PayrollRun.aggregate([{ $match: { status: { $in: ['APPROVED', 'PAID'] }, month: { $gte: months[0], $lte: months.at(-1) } } }, { $group: { _id: '$month', amount: { $sum: '$totals.net' } } }]))
  const keys = ['fees', 'expenses', 'payroll'].filter((k) => show[k])
  for (const row of out) for (const k of keys) row[k] ??= 0 // a month with nothing is a 0, so the lines join up
  return { series: keys, months: out }
}

// ───────────────────────────────────────────────────────── the other modules, in a line each

async function libraryState(ctx) {
  const [shelf, issued, overdue, lent] = await Promise.all([
    LibraryCopy.countDocuments({ status: 'AVAILABLE' }),
    LibraryLoan.countDocuments({ status: 'ISSUED', dueOn: { $gte: ctx.today } }),
    LibraryLoan.countDocuments({ status: 'ISSUED', dueOn: { $lt: ctx.today } }),
    LibraryLoan.countDocuments({ issuedOn: { $gte: ctx.range.from, $lte: ctx.range.to } }),
  ])
  return { onShelf: shelf, issued, overdue, lent }
}

async function transportState() {
  const [riders, vehicles] = await Promise.all([
    TransportAssignment.countDocuments({ active: true }),
    Vehicle.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  const v = (k) => vehicles.find((x) => x._id === k)?.n ?? 0
  return { riders, active: v('ACTIVE'), maintenance: v('MAINTENANCE'), offRoad: v('OFF_ROAD') }
}

async function pulse(auth, year, ctx) {
  const out = []
  const add = (key, link, value, extra = {}) => out.push({ key, link, value, ...extra })
  const r = { $gte: ctx.range.from, $lte: ctx.range.to }
  if (on(auth, 'homework', 'homework.homework.view')) {
    const ids = (await scopedSections(auth, 'homework', year)).map((s) => s._id)
    add('homework', '/homework/homework', await Homework.countDocuments({ sectionId: { $in: ids }, setDate: r }))
  }
  if (on(auth, 'exams', 'exams.schedule.view', 'exams.results.view')) {
    const [upcoming, published] = await Promise.all([
      Exam.countDocuments({ academicYearId: year._id, startDate: { $gte: ctx.today } }),
      Exam.countDocuments({ academicYearId: year._id, status: 'PUBLISHED' }),
    ])
    add('exams', '/exams/schedule', upcoming, { more: published })
  }
  if (on(auth, 'certificates', 'certificates.register.view')) {
    const f = await branchFilterFor(auth, 'certificates')
    add('certificates', '/certificates/register', await Certificate.countDocuments({ ...f, status: 'ISSUED', issueDate: r }))
  }
  if (on(auth, 'communication', 'communication.notices.view')) add('notices', '/communication/notices', await Notice.countDocuments({ status: 'PUBLISHED', publishedAt: dateWindow(ctx.range.from, ctx.range.to) }))
  if (on(auth, 'communication', 'communication.log.view')) {
    const rows = await MessageLog.aggregate([{ $match: { createdAt: dateWindow(ctx.range.from, ctx.range.to) } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    const n = (k) => rows.find((x) => x._id === k)?.n ?? 0
    add('messages', '/communication/log', n('SENT'), { more: n('FAILED') })
  }
  if (on(auth, 'events', 'events.calendar.view')) add('events', '/events/calendar', await SchoolEvent.countDocuments({ startDate: { $gte: ctx.today, $lte: addDaysYmd(ctx.today, 30) } }))
  if (on(auth, 'lms', 'lms.live-classes.view')) add('liveClasses', '/lms/live-classes', await LiveClass.countDocuments({ date: r }))
  if (on(auth, 'online-tests', 'online-tests.attempts.view', 'online-tests.tests.view')) add('tests', '/online-tests/attempts', await TestAttempt.countDocuments({ submittedAt: dateWindow(ctx.range.from, ctx.range.to) }))
  return out
}

/** The next fortnight: events, exams, holidays. */
async function agenda(auth, year, ctx) {
  const until = addDaysYmd(ctx.today, 14)
  const items = []
  if (on(auth, 'events', 'events.calendar.view')) {
    for (const e of await SchoolEvent.find({ startDate: { $lte: until }, endDate: { $gte: ctx.today } }).sort({ startDate: 1 }).limit(8).lean()) {
      items.push({ id: `e-${e._id}`, kind: 'EVENT', title: e.title, from: e.startDate, to: e.endDate, link: '/events/calendar' })
    }
  }
  if (on(auth, 'exams', 'exams.schedule.view')) {
    for (const e of await Exam.find({ academicYearId: year._id, startDate: { $lte: until }, endDate: { $gte: ctx.today } }).sort({ startDate: 1 }).limit(5).lean()) {
      items.push({ id: `x-${e._id}`, kind: 'EXAM', title: e.name, from: e.startDate, to: e.endDate, link: '/exams/schedule' })
    }
  }
  if (on(auth, 'hrms', 'hrms.holidays.view', 'hrms.employees.view')) {
    for (const h of await Holiday.find({ date: { $gte: ctx.today, $lte: until } }).sort({ date: 1 }).limit(5).lean()) {
      items.push({ id: `h-${h._id}`, kind: 'HOLIDAY', title: h.name, from: h.date, to: h.date, link: '/hrms/holidays' })
    }
  }
  return items.sort((a, b) => a.from.localeCompare(b.from)).slice(0, 10)
}

/** Decisions waiting on the caller, with the ERP's own (staff leave, expenses, approval steps). */
async function approvals(auth) {
  const out = await pendingFor(auth)
  const add = async (key, link, fn) => { const n = await fn(); if (n) out.push({ key, count: n, link }) }
  // staff leave waiting on the caller's step of its approval chain (a named approver needs no Staff & HR permission)
  if (moduleEnabled(auth, 'hrms')) await add('staffLeave', can(auth, 'hrms.leave.view') ? '/hrms/leave' : '/me?tab=approvals', async () => (await import('./hrmsLeaveApprovals.js')).countWaitingOnMe(auth))
  if (on(auth, 'finance', 'finance.expenses.approve')) await add('expenses', '/finance/expenses', () => Expense.countDocuments({ status: 'SUBMITTED' }))
  await add('requests', '/approvals', () => waitingCount(auth))
  return out
}

async function activity(auth) {
  if (!can(auth, 'core.audit.view')) return null
  const rows = await AuditLog.find({ action: { $nin: ['LOGIN', 'LOGOUT', 'VIEW'] } }).sort({ at: -1 }).limit(8).select('at userName action module entityType entityName summary').lean()
  return rows.map((r) => ({ id: String(r._id), at: r.at, who: r.userName ?? null, action: r.action, module: r.module ?? null, what: r.summary || r.entityName || r.entityType }))
}

// ───────────────────────────────────────────────────────── the page

export async function institutionOverview(auth, { from, to } = {}) {
  const today = (await institutionNow()).date
  const range = { from: from || `${today.slice(0, 7)}-01`, to: to || today }
  if (range.from > range.to) [range.from, range.to] = [range.to, range.from]
  const ctx = { today, range, prev: priorRange(range.from, range.to), buckets: splitRange(range.from, range.to, 12), tz: await timeZoneOf() }
  const year = await currentYear()
  const out = { today, range, prev: ctx.prev, buckets: ctx.buckets, year: year ? { id: String(year._id), name: year.name } : null, kpis: {} }
  out.approvals = await approvals(auth)
  out.activity = await activity(auth)
  if (on(auth, 'admissions', 'admissions.enquiries.view')) out.kpis.enquiries = await admissionsKpi(ctx)
  if (on(auth, 'finance', 'finance.expenses.view')) out.kpis.expenses = await expensesKpi(ctx)
  if (on(auth, 'hrms', 'hrms.employees.view')) out.kpis.staff = await staffKpi(ctx)
  if (on(auth, 'library', 'library.circulation.view', 'library.catalogue.view')) out.library = await libraryState(ctx)
  if (on(auth, 'transport', 'transport.assignments.view', 'transport.vehicles.view')) out.transport = await transportState()
  if (!year) return out
  if (on(auth, 'students', 'students.directory.view')) out.kpis.students = await studentsKpi(auth, year, ctx)
  if (on(auth, 'attendance', 'attendance.mark.view', 'attendance.reports.view')) out.kpis.attendance = await attendanceKpi(auth, year, ctx)
  if (on(auth, 'fees', 'fees.invoices.view', 'fees.day-end.view')) out.kpis.fees = await feesKpi(auth, year, ctx)
  if (on(auth, 'homework', 'homework.lesson-plans.view', 'homework.homework.view')) {
    // the caller's own teaching (My workspace › My teaching), when they teach anything
    const mine = await myTeaching(auth)
    if (mine.classes.length) {
      out.kpis.teaching = {
        week: mine.plans.length, taught: mine.plans.filter((p) => p.status === 'DONE').length, today: mine.plans.filter((p) => p.date === mine.today).length,
        toCheck: mine.toCheck.length, behind: mine.classes.reduce((n, c) => n + c.behind, 0), classes: mine.classes.length,
      }
    }
  }
  const show = { fees: !!out.kpis.fees, expenses: !!out.kpis.expenses, payroll: on(auth, 'payroll', 'payroll.runs.view') }
  if (show.fees || show.expenses || show.payroll) out.money = await moneyByMonth(auth, ctx, show)
  out.pulse = await pulse(auth, year, ctx)
  out.agenda = await agenda(auth, year, ctx)
  return out
}
