import { addDaysYmd, attendancePct, countMarks, sectionLabel } from '@schoolgiant/shared'
import { AttendanceSheet, StudentLeave } from '../models/attendance.js'
import { Certificate } from '../models/certificates.js'
import { Exam, ExamPaper, MarkSheet } from '../models/exams.js'
import { Concession, FeeDayEnd, FeeInvoice, FeePayment, FeeRefund } from '../models/fees.js'
import { Homework } from '../models/homework.js'
import { ClassLevel, Section } from '../models/academics.js'
import { Student, TransferCertificate } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { can, moduleEnabled, scopeOf } from '../platform/access.js'
import { institutionNow } from '../platform/time.js'
import { currentYear, sectionsInScope } from './academics.js'

// Dashboard › Command centre: the principal's picture of today — strength, attendance, fee
// collection, exams, homework, certificates — and what is waiting for a decision. Each block shows
// only when its module is on and the caller may see that module, within their data scope there.

const on = (auth, moduleId, ...keys) => moduleEnabled(auth, moduleId) && keys.some((k) => can(auth, k))

async function branchFilterFor(auth, moduleId) {
  if (scopeOf(auth, moduleId) === 'ALL' || !auth.user?.branchId) return {}
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(auth.user.branchId) === String(main) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}

async function scopedSections(auth, moduleId, year) {
  const allowed = await sectionsInScope(auth, moduleId)
  return Section.find({ academicYearId: year._id, active: { $ne: false }, ...(allowed && { _id: { $in: allowed } }) }).lean()
}

async function studentsBlock(auth, year, t) {
  const sections = await scopedSections(auth, 'students', year)
  const ids = sections.map((s) => s._id)
  const monthStart = `${t.slice(0, 7)}-01`
  const [active, joined, byGender] = await Promise.all([
    Student.countDocuments({ status: 'ACTIVE', sectionId: { $in: ids } }),
    Student.countDocuments({ sectionId: { $in: ids }, admissionDate: { $gte: monthStart, $lte: t } }),
    Student.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: ids } } }, { $group: { _id: '$gender', n: { $sum: 1 } } }]),
  ])
  const g = (k) => byGender.find((x) => x._id === k)?.n ?? 0
  return { active, sections: sections.length, joinedThisMonth: joined, boys: g('MALE'), girls: g('FEMALE') }
}

async function attendanceBlock(auth, year, t) {
  const sections = await scopedSections(auth, 'attendance', year)
  const ids = sections.map((s) => s._id)
  const from = addDaysYmd(t, -6)
  const sheets = await AttendanceSheet.find({ sectionId: { $in: ids }, period: 0, date: { $gte: from, $lte: t } }).select('sectionId date entries').lean()
  const todays = sheets.filter((s) => s.date === t)
  const c = countMarks(todays.flatMap((s) => s.entries))
  const marked = new Set(todays.map((s) => String(s.sectionId)))
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((x) => [String(x._id), x]))
  const unmarked = sections.filter((s) => !marked.has(String(s._id)))
    .sort((a, b) => (classes.get(String(a.classId))?.order ?? 0) - (classes.get(String(b.classId))?.order ?? 0) || a.name.localeCompare(b.name))
    .map((s) => sectionLabel(classes.get(String(s.classId)), s, { short: true }))
  const trend = []
  for (let i = 6; i >= 0; i--) {
    const d = addDaysYmd(t, -i)
    const day = sheets.filter((s) => s.date === d)
    trend.push({ date: d, pct: day.length ? attendancePct(countMarks(day.flatMap((s) => s.entries))) : null })
  }
  return { sections: sections.length, marked: marked.size, present: c.P + c.L + c.HD, absent: c.A, onLeave: c.LV, pct: attendancePct(c), unmarked: unmarked.slice(0, 15), unmarkedCount: unmarked.length, trend }
}

async function feesBlock(auth, year, t) {
  const f = await branchFilterFor(auth, 'fees')
  const monthStart = `${t.slice(0, 7)}-01`
  const from = addDaysYmd(t, -13)
  const [days, refunds, dues] = await Promise.all([
    FeePayment.aggregate([{ $match: { ...f, status: 'VALID', date: { $gte: from < monthStart ? from : monthStart, $lte: t } } }, { $group: { _id: '$date', amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    FeeRefund.aggregate([{ $match: { ...f, date: { $gte: monthStart, $lte: t } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    FeeInvoice.aggregate([
      { $match: { ...f, academicYearId: year._id, status: { $in: ['UNPAID', 'PARTIAL'] } } },
      { $group: { _id: null, due: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', t] }, '$balance', 0] } }, students: { $addToSet: '$studentId' } } },
    ]),
  ])
  const dayOf = (d) => days.find((x) => x._id === d)
  const trend = []
  for (let i = 13; i >= 0; i--) { const d = addDaysYmd(t, -i); trend.push({ date: d, amount: dayOf(d)?.amount ?? 0 }) }
  return {
    today: dayOf(t)?.amount ?? 0, receiptsToday: dayOf(t)?.n ?? 0,
    month: days.filter((d) => d._id >= monthStart).reduce((n, d) => n + d.amount, 0) - (refunds[0]?.amount ?? 0),
    due: dues[0]?.due ?? 0, overdue: dues[0]?.overdue ?? 0, studentsOwing: dues[0]?.students.length ?? 0, trend,
  }
}

async function examsBlock(auth, year, t) {
  const exams = await Exam.find({ academicYearId: year._id, status: { $in: ['SCHEDULED', 'PUBLISHED'] } }).sort({ startDate: 1 }).lean()
  const upcoming = exams.filter((e) => e.startDate && e.startDate >= t).slice(0, 3).map((e) => ({ id: String(e._id), name: e.name, startDate: e.startDate, endDate: e.endDate }))
  const open = exams.filter((e) => e.status === 'SCHEDULED' && e.startDate && e.startDate <= t)
  const progress = []
  for (const e of open.slice(0, 4)) {
    const [papers, sections, locked] = await Promise.all([
      ExamPaper.find({ examId: e._id }).select('classId').lean(),
      Section.find({ academicYearId: e.academicYearId, classId: { $in: e.classIds } }).select('classId').lean(),
      MarkSheet.countDocuments({ examId: e._id, status: 'LOCKED' }),
    ])
    const expected = sections.reduce((n, s) => n + papers.filter((p) => String(p.classId) === String(s.classId)).length, 0)
    progress.push({ id: String(e._id), name: e.name, locked, expected })
  }
  return { upcoming, marking: progress, published: exams.filter((e) => e.status === 'PUBLISHED').length }
}

async function homeworkBlock(auth, year, t) {
  const sections = await scopedSections(auth, 'homework', year)
  const ids = sections.map((s) => s._id)
  const weekStart = addDaysYmd(t, -((new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7))
  const [setThisWeek, dueToday] = await Promise.all([
    Homework.countDocuments({ sectionId: { $in: ids }, setDate: { $gte: weekStart, $lte: t } }),
    Homework.countDocuments({ sectionId: { $in: ids }, dueDate: t }),
  ])
  return { setThisWeek, dueToday }
}

async function certificatesBlock(auth, t) {
  const f = await branchFilterFor(auth, 'certificates')
  return { thisMonth: await Certificate.countDocuments({ ...f, issueDate: { $gte: `${t.slice(0, 7)}-01`, $lte: t }, status: 'ISSUED' }) }
}

/** Decisions waiting on the caller: leave, concessions, cash differences, TCs. */
async function pendingFor(auth) {
  const out = []
  const add = async (key, link, fn) => { const n = await fn(); if (n) out.push({ key, count: n, link }) }
  if (on(auth, 'attendance', 'attendance.leave.approve')) await add('leave', '/attendance/leave', () => StudentLeave.countDocuments({ status: 'PENDING' }))
  if (on(auth, 'fees', 'fees.concessions.approve')) await add('concessions', '/fees/concessions', () => Concession.countDocuments({ status: 'PENDING', requestedById: { $ne: auth.userId } }))
  if (on(auth, 'fees', 'fees.day-end.approve_variance')) await add('dayEnd', '/fees/day-end', () => FeeDayEnd.countDocuments({ status: 'VARIANCE', collectorId: { $ne: auth.userId } }))
  if (on(auth, 'students', 'students.transfer.approve')) await add('tc', '/students/transfer', () => TransferCertificate.countDocuments({ status: 'REQUESTED' }))
  return out
}

export async function commandCentre(auth) {
  const t = (await institutionNow()).date
  const year = await currentYear()
  const out = { today: t, year: year ? { id: String(year._id), name: year.name } : null, pending: await pendingFor(auth) }
  if (!year) return out
  if (on(auth, 'students', 'students.directory.view')) out.students = await studentsBlock(auth, year, t)
  if (on(auth, 'attendance', 'attendance.mark.view', 'attendance.reports.view')) out.attendance = await attendanceBlock(auth, year, t)
  if (on(auth, 'fees', 'fees.invoices.view', 'fees.day-end.view')) out.fees = await feesBlock(auth, year, t)
  if (on(auth, 'exams', 'exams.results.view', 'exams.schedule.view')) out.exams = await examsBlock(auth, year, t)
  if (on(auth, 'homework', 'homework.homework.view')) out.homework = await homeworkBlock(auth, year, t)
  if (on(auth, 'certificates', 'certificates.register.view')) out.certificates = await certificatesBlock(auth, t)
  return out
}
