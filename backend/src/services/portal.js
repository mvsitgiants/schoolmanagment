import {
  CERTIFICATE_KIND_BY, EXAM_STATUS, INVOICE_STATUS, LEAVE_STATUS, PAYMENT_MODE_LABEL, RESULT_STATUS, SUBMISSION_STATUS, attendancePct, countMarks,
  familyPath, liveFamilyFeatures, maskMobile, monthRange, sectionLabel,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { qrSvg } from '../documents/engine.js'
import { AcademicYear, ClassLevel, Section, Subject } from '../models/academics.js'
import { AttendanceSheet, StudentLeave } from '../models/attendance.js'
import { Certificate } from '../models/certificates.js'
import { Attachment } from '../models/engines.js'
import { Exam, ExamCandidate, ExamPaper } from '../models/exams.js'
import { FeeInvoice, FeePayment } from '../models/fees.js'
import { Homework } from '../models/homework.js'
import { Tenant } from '../models/platform.js'
import { PortalContent } from '../models/portal.js'
import { studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { readStream } from '../platform/storage.js'
import { institutionNow } from '../platform/time.js'
import { currentYear } from './academics.js'
import { renderDocument } from './documents.js'
import { notifyUsers } from './notify.js'
import { onlinePaymentsOn } from './feePayments.js'
import { sectionWeek } from './timetable.js'
import { familyYearResult } from './yearResults.js'
import { familyConversations, familySend, familyThread, markNoticeRead, noticeFile, noticesFor, teachersFor } from './communication.js'

// The family side of the parent & student app (routes/portal.js `familyRouter`), and the school's
// settings for it. A family request carries `f` = { tenant, slug, settings, enabledModules, features,
// session, students } — set by the routes from the session cookie. Every read is limited to
// f.students (and to the features the school has switched on); nothing here takes a staff
// permission. Only finished things are shown: published results, issued certificates, valid receipts.

const today = async () => (await institutionNow()).date
const off = () => new AppError(404, 'This isn’t available in your school’s app.', { code: 'FEATURE_OFF' })
export const need = (f, feature) => { if (!f.features.includes(feature)) throw off() }

/** The student a family asked about — one of theirs, or 404. */
export function studentFor(f, id) {
  const s = f.students.find((x) => String(x._id) === String(id))
  if (!s) throw notFound('Student')
  return s
}

async function placeOf(sectionId) {
  if (!sectionId) return null
  const sec = await Section.findById(sectionId).lean()
  if (!sec) return null
  const cls = await ClassLevel.findById(sec.classId).select('name code').lean()
  return { section: sec, label: sectionLabel(cls, sec), short: sectionLabel(cls, sec, { short: true }) }
}

// ───────────────────────────────────────────────────────── school info and who is signed in

export async function publicInfo(f) {
  const t = f.tenant
  const p = t.profile ?? {}
  const content = await PortalContent.findOne().lean()
  return {
    school: { name: t.name, slug: f.slug, city: p.city ?? null, logoUrl: p.logoUrl ?? null, primaryColor: p.primaryColor ?? null, timezone: p.timezone ?? 'Asia/Kolkata', phone: p.phone ?? null, addressLine: p.addressLine ?? null },
    features: f.features, studentLogins: !!f.settings.studentLogins,
    welcome: content?.welcome ?? null, contact: content?.contact ?? {}, timings: content?.timings ?? [], help: content?.help ?? null,
    otp: { digits: 6 },
  }
}

export async function meView(f) {
  const places = await Promise.all(f.students.map((s) => placeOf(s.sectionId)))
  return {
    kind: f.session.kind, mobile: maskMobile(f.session.mobile), features: f.features,
    students: f.students.map((s, i) => ({ id: String(s._id), firstName: s.firstName, name: studentName(s), class: places[i]?.label ?? null, classShort: places[i]?.short ?? null, admissionNo: s.admissionNo, gender: s.gender ?? null })),
  }
}

// ───────────────────────────────────────────────────────── home

export async function homeFor(f, id) {
  const s = studentFor(f, id)
  const t = await today()
  const out = { today: t }
  if (f.features.includes('ATTENDANCE') && s.sectionId) {
    const { from } = monthRange(t.slice(0, 7))
    const sheets = await AttendanceSheet.find({ sectionId: s.sectionId, period: 0, date: { $gte: from, $lte: t }, 'entries.studentId': s._id }).select('date entries').lean()
    const mine = sheets.map((sh) => ({ date: sh.date, status: sh.entries.find((e) => String(e.studentId) === String(s._id))?.status })).filter((x) => x.status)
    const c = countMarks(mine)
    out.attendance = { today: mine.find((x) => x.date === t)?.status ?? null, monthPct: attendancePct(c), monthDays: c.total, absentThisMonth: c.A }
  }
  if (f.features.includes('HOMEWORK') && s.sectionId) {
    const due = await Homework.find({ sectionId: s.sectionId, dueDate: { $gte: t } }).sort({ dueDate: 1 }).limit(3).lean()
    const subjects = await subjectNames(due.map((h) => h.subjectId))
    out.homework = due.map((h) => ({ id: String(h._id), title: h.title, subject: subjects.get(String(h.subjectId)) ?? '', dueDate: h.dueDate, status: h.entries.find((e) => String(e.studentId) === String(s._id))?.status ?? 'PENDING' }))
  }
  if (f.features.includes('FEES')) {
    const open = await FeeInvoice.find({ studentId: s._id, status: { $in: ['UNPAID', 'PARTIAL'] } }).sort({ dueDate: 1 }).lean()
    out.fees = { due: open.reduce((n, i) => n + i.balance, 0), overdue: open.filter((i) => i.dueDate < t).reduce((n, i) => n + i.balance, 0), nextDue: open.find((i) => i.dueDate >= t)?.dueDate ?? open[0]?.dueDate ?? null }
  }
  if (f.features.includes('RESULTS')) {
    const exams = await Exam.find({ status: 'PUBLISHED', classIds: s.classId }).sort({ publishedAt: -1 }).limit(5).lean()
    const cand = exams.length ? await ExamCandidate.findOne({ studentId: s._id, examId: { $in: exams.map((e) => e._id) } }).sort({ updatedAt: -1 }).lean() : null
    if (cand) {
      const e = exams.find((x) => String(x._id) === String(cand.examId))
      out.result = { candidateId: String(cand._id), exam: e?.name, pct: cand.pct ?? null, grade: cand.grade ?? null, result: cand.result, resultLabel: RESULT_STATUS[cand.result]?.label }
    }
  }
  if (f.features.includes('NOTICES')) {
    const notices = await noticesFor(s)
    out.notices = { unread: notices.filter((n) => !n.read).length, latest: notices.slice(0, 2).map((n) => ({ id: n.id, title: n.title, category: n.category, publishedAt: n.publishedAt, read: n.read, pinned: n.pinned })) }
  }
  if (f.features.includes('CHAT')) out.chatUnread = (await familyConversations(s)).reduce((n, c) => n + (c.unread ?? 0), 0)
  if (f.enabledModules.includes('exams')) {
    const next = await Exam.findOne({ status: 'SCHEDULED', classIds: s.classId, endDate: { $gte: t } }).sort({ startDate: 1 }).lean()
    if (next) out.nextExam = { id: String(next._id), name: next.name, startDate: next.startDate, endDate: next.endDate }
  }
  return out
}

// ───────────────────────────────────────────────────────── timetable

export async function timetableFor(f, id) {
  need(f, 'TIMETABLE')
  const s = studentFor(f, id)
  return sectionWeek(s.sectionId)
}

async function subjectNames(ids) {
  return new Map((await Subject.find({ _id: { $in: ids } }).select('name').lean()).map((x) => [String(x._id), x.name]))
}

// ───────────────────────────────────────────────────────── attendance and leave

export async function attendanceFor(f, id, month) {
  need(f, 'ATTENDANCE')
  const s = studentFor(f, id)
  const t = await today()
  const m = /^\d{4}-\d{2}$/.test(month ?? '') ? month : t.slice(0, 7)
  const { from, to } = monthRange(m)
  const sheets = s.sectionId ? await AttendanceSheet.find({ sectionId: s.sectionId, period: 0, date: { $gte: from, $lte: to }, 'entries.studentId': s._id }).select('date entries').lean() : []
  const days = sheets.map((sh) => {
    const e = sh.entries.find((x) => String(x.studentId) === String(s._id))
    return { date: sh.date, status: e?.status, note: e?.note ?? null }
  }).filter((d) => d.status).sort((a, b) => a.date.localeCompare(b.date))
  const c = countMarks(days)
  const leave = await StudentLeave.find({ studentId: s._id }).sort({ from: -1 }).limit(20).lean()
  return {
    month: m, today: t, days, counts: c, pct: attendancePct(c),
    leave: leave.map((l) => ({ id: String(l._id), from: l.from, to: l.to, reason: l.reason, status: l.status, statusLabel: LEAVE_STATUS[l.status]?.label, byFamily: l.appliedBy === 'PARENT', decisionNote: l.decisionNote ?? null })),
  }
}

export async function applyLeave(f, id, { from, to, reason }, req) {
  need(f, 'ATTENDANCE')
  const s = studentFor(f, id)
  const t = await today()
  if (to < from) throw badRequest('The last day can’t be before the first.', { fields: { to: 'After the first day' } })
  const back = new Date(Date.parse(`${t}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10)
  if (from < back) throw badRequest('Leave can be asked for up to a week back.', { fields: { from: 'Too far back' } })
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 30) throw badRequest('Up to 30 days at a time.', { fields: { to: 'Up to 30 days' } })
  if (await StudentLeave.exists({ studentId: s._id, status: { $in: ['PENDING', 'APPROVED'] }, from: { $lte: to }, to: { $gte: from } })) throw conflict('There is already leave for some of these days.')
  const who = f.session.kind === 'STUDENT' ? `${s.firstName} (student)` : `Parent (${maskMobile(f.session.mobile)})`
  const l = await StudentLeave.create({ studentId: s._id, sectionId: s.sectionId, from, to, reason, status: 'PENDING', appliedBy: 'PARENT', appliedByName: who })
  const sec = s.sectionId ? await Section.findById(s.sectionId).select('classTeacherId').lean() : null
  if (sec?.classTeacherId) await notifyUsers([sec.classTeacherId], { event: 'attendance.leave_request', title: `Leave request: ${studentName(s)}`, message: `${from}${to !== from ? ` to ${to}` : ''} — ${reason}`, link: '/attendance/leave', tone: 'info', entityType: 'student_leave', entityId: String(l._id) })
  await audit({ action: 'CREATE', module: 'attendance', entityType: 'student_leave', entityId: String(l._id), entityName: studentName(s), studentId: s._id, summary: `Leave asked in the family app for ${studentName(s)}, ${from}${to !== from ? ` to ${to}` : ''} (${who})` }, req)
  return attendanceFor(f, id)
}

export async function cancelLeave(f, id, leaveId, req) {
  need(f, 'ATTENDANCE')
  const s = studentFor(f, id)
  if (!isOid(leaveId)) throw notFound('Leave')
  const l = await StudentLeave.findOne({ _id: leaveId, studentId: s._id })
  if (!l) throw notFound('Leave')
  if (l.status !== 'PENDING' || l.appliedBy !== 'PARENT') throw conflict('Only a request you made that is still waiting can be withdrawn. Call the school for anything else.')
  l.status = 'CANCELLED'
  await l.save()
  await audit({ action: 'UPDATE', module: 'attendance', entityType: 'student_leave', entityId: String(l._id), entityName: studentName(s), studentId: s._id, summary: `Leave request withdrawn in the family app (${l.from})` }, req)
  return attendanceFor(f, id)
}

// ───────────────────────────────────────────────────────── homework

export async function homeworkFor(f, id, { when = 'OPEN' } = {}) {
  need(f, 'HOMEWORK')
  const s = studentFor(f, id)
  if (!s.sectionId) return { today: await today(), items: [] }
  const t = await today()
  const rows = await Homework.find({ sectionId: s.sectionId, ...(when === 'PAST' ? { dueDate: { $lt: t } } : { dueDate: { $gte: t } }) }).sort({ dueDate: when === 'PAST' ? -1 : 1 }).limit(60).lean()
  const [subjects, files] = await Promise.all([
    subjectNames(rows.map((h) => h.subjectId)),
    Attachment.find({ entityType: 'homework', entityId: { $in: rows.map((h) => String(h._id)) }, 'deleted.at': null }).select('entityId fileName mime size').lean(),
  ])
  return {
    today: t,
    items: rows.map((h) => {
      const e = h.entries.find((x) => String(x.studentId) === String(s._id))
      const status = e?.status ?? 'PENDING'
      return {
        id: String(h._id), title: h.title, details: h.details ?? '', subject: subjects.get(String(h.subjectId)) ?? '', setDate: h.setDate, dueDate: h.dueDate, teacher: h.teacher ?? null,
        needsSubmission: h.needsSubmission, status, statusLabel: SUBMISSION_STATUS[status]?.label, remark: e?.remark ?? null,
        files: files.filter((x) => x.entityId === String(h._id)).map((x) => ({ id: String(x._id), name: x.fileName, mime: x.mime, size: x.size })),
      }
    }),
  }
}

/** A homework file, when the homework is set for this student's class. */
export async function homeworkFile(f, id, homeworkId, fileId) {
  need(f, 'HOMEWORK')
  const s = studentFor(f, id)
  if (!isOid(homeworkId) || !isOid(fileId)) throw notFound('File')
  const h = await Homework.findOne({ _id: homeworkId, sectionId: s.sectionId }).select('_id').lean()
  if (!h) throw notFound('File')
  const file = await Attachment.findOne({ _id: fileId, entityType: 'homework', entityId: String(h._id), 'deleted.at': null }).lean()
  if (!file) throw notFound('File')
  return { file, stream: readStream(file.storageKey) }
}

// ───────────────────────────────────────────────────────── fees

export async function feesFor(f, id) {
  need(f, 'FEES')
  const s = studentFor(f, id)
  const t = await today()
  const [invoices, payments] = await Promise.all([
    FeeInvoice.find({ studentId: s._id, status: { $ne: 'CANCELLED' } }).sort({ dueDate: 1 }).lean(),
    FeePayment.find({ studentId: s._id, status: 'VALID' }).sort({ at: -1 }).limit(50).lean(),
  ])
  const year = await currentYear()
  return {
    today: t, year: year?.name ?? null,
    totals: {
      billed: invoices.reduce((n, i) => n + i.net, 0), paid: invoices.reduce((n, i) => n + i.paid, 0),
      due: invoices.reduce((n, i) => n + Math.max(0, i.balance), 0), overdue: invoices.filter((i) => i.balance > 0 && i.dueDate < t).reduce((n, i) => n + i.balance, 0),
    },
    invoices: invoices.map((i) => ({ id: String(i._id), installment: i.installment, dueDate: i.dueDate, net: i.net, paid: i.paid, balance: i.balance, concession: i.concession, status: i.status, statusLabel: INVOICE_STATUS[i.status]?.label, overdue: i.balance > 0 && i.dueDate < t })),
    receipts: payments.map((p) => ({ id: String(p._id), receiptNo: p.receiptNo, date: p.date, amount: p.amount, refunded: p.refunded ?? 0, mode: p.mode, modeLabel: PAYMENT_MODE_LABEL[p.mode] ?? p.mode })),
    onlinePayment: await onlinePaymentsOn(f.enabledModules), // the school's own gateway (Fees › Online payments)
  }
}

// ───────────────────────────────────────────────────────── results, exams, certificates

export async function resultsFor(f, id) {
  const s = studentFor(f, id)
  const showResults = f.features.includes('RESULTS')
  if (!showResults && !f.enabledModules.includes('exams')) throw off()
  const cfg = await getSettings('exams')
  const cands = await ExamCandidate.find({ studentId: s._id }).lean()
  const exams = await Exam.find({ _id: { $in: cands.map((c) => c.examId) }, status: { $in: ['SCHEDULED', 'PUBLISHED'] } }).sort({ startDate: -1 }).lean()
  const t = await today()
  const results = []
  const upcoming = []
  for (const e of exams) {
    const c = cands.find((x) => String(x.examId) === String(e._id))
    if (e.status === 'PUBLISHED' && showResults) {
      results.push({ candidateId: String(c._id), exam: e.name, term: e.term ?? null, publishedAt: e.publishedAt, total: c.total, max: c.max, pct: c.pct, grade: c.grade, rank: cfg.showRank ? c.rank : null, result: c.result, resultLabel: RESULT_STATUS[c.result]?.label })
    } else if (e.status === 'SCHEDULED' && (e.endDate ?? t) >= t) {
      const papers = await ExamPaper.find({ examId: e._id, classId: s.classId }).sort({ date: 1, startTime: 1 }).lean()
      const subjects = await subjectNames(papers.map((p) => p.subjectId))
      upcoming.push({ candidateId: String(c._id), exam: e.name, statusLabel: EXAM_STATUS[e.status]?.label, startDate: e.startDate, endDate: e.endDate, papers: papers.map((p) => ({ subject: subjects.get(String(p.subjectId)) ?? '', date: p.date, startTime: p.startTime ?? null, endTime: p.endTime ?? null })) })
    }
  }
  // the year-end result, once the school has published it for the child's class
  const year = showResults ? await familyYearResult(s._id) : null
  return { results, upcoming, year }
}

export async function certificatesFor(f, id) {
  need(f, 'CERTIFICATES')
  const s = studentFor(f, id)
  const rows = await Certificate.find({ studentId: s._id, status: 'ISSUED' }).sort({ issueDate: -1 }).limit(50).lean()
  return rows.map((c) => ({ id: String(c._id), certificateNo: c.certificateNo, kind: c.kind, kindLabel: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind, issueDate: c.issueDate, purpose: c.purpose ?? c.snapshot?.event ?? null }))
}

export async function profileFor(f, id) {
  const s = studentFor(f, id)
  const place = await placeOf(s.sectionId)
  const teacher = place?.section?.classTeacherId ? await User.findById(place.section.classTeacherId).select('name').lean() : null
  const year = place?.section ? await AcademicYear.findById(place.section.academicYearId).select('name').lean() : null
  return {
    id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, class: place?.label ?? null, year: year?.name ?? null,
    classTeacher: teacher?.name ?? null, dob: s.dob ?? null, gender: s.gender ?? null, bloodGroup: s.bloodGroup ?? null,
    guardians: (s.guardians ?? []).map((g) => ({ name: g.name, relation: g.relation ?? null, mobile: g.mobile ? maskMobile(g.mobile) : null, primary: !!g.isPrimary })),
  }
}

// ───────────────────────────────────────────────────────── printed documents

/**
 * A document of one of this family's own records — receipt, report card, hall ticket, certificate —
 * checked here (it is theirs, and it is final), then rendered as the school prints it.
 */
export async function documentFor(f, docType, recordId) {
  if (!isOid(recordId)) throw notFound('Document')
  const mine = f.students.map((s) => String(s._id))
  let ok = false
  if (docType === 'FEE_RECEIPT') {
    need(f, 'FEES')
    const p = await FeePayment.findById(recordId).select('studentId status').lean()
    ok = !!p && p.status === 'VALID' && mine.includes(String(p.studentId))
  } else if (docType === 'REPORT_CARD' || docType === 'HALL_TICKET') {
    if (docType === 'REPORT_CARD') need(f, 'RESULTS')
    else if (!f.enabledModules.includes('exams')) throw off()
    const c = await ExamCandidate.findById(recordId).select('studentId examId').lean()
    const e = c && await Exam.findById(c.examId).select('status').lean()
    ok = !!c && mine.includes(String(c.studentId)) && (docType === 'REPORT_CARD' ? e?.status === 'PUBLISHED' : ['SCHEDULED', 'PUBLISHED'].includes(e?.status))
  } else if (docType === 'YEAR_REPORT_CARD') {
    need(f, 'RESULTS')
    ok = mine.includes(String(recordId)) && !!(await familyYearResult(recordId))
  } else if (docType === 'CERTIFICATE') {
    need(f, 'CERTIFICATES')
    const c = await Certificate.findById(recordId).select('studentId status').lean()
    ok = !!c && c.status === 'ISSUED' && mine.includes(String(c.studentId))
  }
  if (!ok) throw notFound('Document')
  // the record is checked as this family's own above; render it with the document's own loader
  const asSchool = { fullAccess: true, permissions: ['*'], enabledModules: f.enabledModules, tenantId: String(f.tenant._id), userId: null, user: { name: 'Family app' }, dataScopes: {} }
  return renderDocument(docType, recordId, asSchool, { autoPrint: false })
}

// ───────────────────────────────────────────────────────── notices and chat (Communication hub)

export async function familyNotices(f, id) { need(f, 'NOTICES'); return noticesFor(studentFor(f, id)) }
export async function familyReadNotice(f, id, noticeId) { need(f, 'NOTICES'); return markNoticeRead(studentFor(f, id), noticeId) }
export async function familyNoticeFile(f, id, noticeId, fileId) {
  need(f, 'NOTICES')
  const file = await noticeFile(studentFor(f, id), noticeId, fileId)
  return { file, stream: readStream(file.storageKey) }
}
export async function familyChatTeachers(f, id) { need(f, 'CHAT'); return teachersFor(studentFor(f, id)) }
export async function familyChats(f, id) { need(f, 'CHAT'); return familyConversations(studentFor(f, id)) }
export async function familyChat(f, id, conversationId) { need(f, 'CHAT'); return familyThread(studentFor(f, id), conversationId) }
export async function familyChatSend(f, id, body, req) { need(f, 'CHAT'); return familySend(studentFor(f, id), f.session, body, req) }

// ───────────────────────────────────────────────────────── the school's side

export async function appLink() {
  const t = await Tenant.findById(getContext()?.tenantId).select('slug name').lean()
  const url = `${config.appUrl}${familyPath(t.slug)}`
  return { url, slug: t.slug, qr: qrSvg(url, 40) }
}

export async function getContent() {
  const c = await PortalContent.findOne().lean()
  return c ? clean(c) : { welcome: '', contact: {}, timings: [], help: '' }
}

export async function saveContent(input, req) {
  const c = (await PortalContent.findOne()) ?? new PortalContent()
  Object.assign(c, { welcome: input.welcome || undefined, contact: input.contact ?? {}, timings: (input.timings ?? []).filter((x) => x.label?.trim() || x.hours?.trim()), help: input.help || undefined, updatedBy: req?.auth?.user?.name })
  await c.save()
  await audit({ action: 'UPDATE', module: 'portal', entityType: 'portal_content', entityId: String(c._id), entityName: 'App content', summary: 'Updated what the family app shows (welcome, contact, timings)' }, req)
  return clean(c.toObject())
}

/** For the routes: the features live for this school. */
export const featuresFor = (settings, enabledModules) => liveFamilyFeatures(settings, enabledModules)
