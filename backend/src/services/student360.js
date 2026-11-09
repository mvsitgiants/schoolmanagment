import {
  CERTIFICATE_KIND_BY, CONCESSION_STATUS, FINE_REASONS, LEAVE_STATUS, OFFER_STATUS, OUTPASS_OPEN, OUTPASS_STATUS, PAYMENT_MODE_LABEL,
  RESULT_STATUS, YEAR_RESULT, attendancePct, bedCode, countMarks, dayDiff, loanState, weekdayCode,
} from '@schoolgiant/shared'
import { Subject } from '../models/academics.js'
import { AttendanceSheet, StudentLeave } from '../models/attendance.js'
import { Certificate } from '../models/certificates.js'
import { CoeSemesterResult } from '../models/coe.js'
import { Attachment, MessageLog } from '../models/engines.js'
import { Exam, ExamCandidate, ExamPaper, MarkSheet } from '../models/exams.js'
import { HostelAllotment, HostelBlock, HostelRoom, Outpass } from '../models/hostel.js'
import { Homework } from '../models/homework.js'
import { LibraryFine, LibraryLoan } from '../models/library.js'
import { Company, PlacementOffer } from '../models/placements.js'
import { Program, ProgramEnrolment } from '../models/programs.js'
import { Student } from '../models/students.js'
import { TransportAssignment, TransportRoute, Vehicle } from '../models/transport.js'
import { can, moduleEnabled } from '../platform/access.js'
import { isOid } from '../platform/db.js'
import { notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { currentYear } from './academics.js'
import { canteenSettings, spentOn, walletFor } from './canteen.js'
import { studentLedger } from './fees.js'
import { getRecord } from './health.js'
import { scopeFilter } from './students.js'
import { sectionWeek } from './timetable.js'
import { yearCardData } from './yearResults.js'

// Student 360 (GET /students/:id/overview): one read of a student's school life for the profile page — attendance,
// fees, exams, homework, the timetable, transport, library, hostel, health, canteen, college extras, messages to the
// family and certificates. Read-only. Each section is there only when its module is switched on and the caller may
// see that module's page; each is built on its own, so a section that fails comes back as { error: true } and the
// rest of the page still shows. A section outside the caller's data scope for that module (404 / 403) is left out.

const idStr = (v) => (v ? String(v) : null)
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const anyOf = (auth, keys) => keys.some((k) => can(auth, k))
const HEATMAP_DAYS = 91

async function subjectMap(ids) {
  const list = await Subject.find({ _id: { $in: [...new Set(ids.filter(Boolean).map(String))] } }).select('name code').lean()
  return new Map(list.map((x) => [String(x._id), x]))
}

// ───────────────────────────────────────────────────────── attendance

async function attendanceSection(s, { today, year }) {
  const from = year?.startDate ?? addDays(today, -365)
  const to = year?.endDate && year.endDate < today ? year.endDate : today
  const [marks, leave, cfg] = await Promise.all([
    AttendanceSheet.aggregate([
      { $match: { period: 0, date: { $gte: from, $lte: to }, 'entries.studentId': s._id } },
      { $unwind: '$entries' }, { $match: { 'entries.studentId': s._id } },
      { $project: { _id: 0, date: 1, status: '$entries.status' } },
      { $sort: { date: 1 } },
    ]),
    StudentLeave.find({ studentId: s._id }).sort({ from: -1 }).limit(10).lean(),
    getSettings('attendance').catch(() => ({})),
  ])
  const counts = countMarks(marks)
  const byMonth = new Map()
  for (const m of marks) {
    const k = m.date.slice(0, 7)
    if (!byMonth.has(k)) byMonth.set(k, [])
    byMonth.get(k).push(m)
  }
  const since = addDays(today, -(HEATMAP_DAYS - 1))
  return {
    from, to, pct: attendancePct(counts), counts, minimumPct: Number(cfg?.minimumPct ?? 75),
    today: marks.find((m) => m.date === today)?.status ?? null,
    days: marks.filter((m) => m.date >= since).map((m) => ({ date: m.date, status: m.status })),
    heatmapFrom: since,
    months: [...byMonth.entries()].map(([month, list]) => { const c = countMarks(list); return { month, pct: attendancePct(c), total: c.total, absent: c.A } }),
    leave: leave.map((l) => ({ id: String(l._id), from: l.from, to: l.to, reason: l.reason, status: l.status, statusLabel: LEAVE_STATUS[l.status]?.label, byFamily: l.appliedBy === 'PARENT', decisionNote: l.decisionNote ?? null })),
    openLeave: leave.filter((l) => l.status === 'PENDING').length,
  }
}

// ───────────────────────────────────────────────────────── fees (services/fees.js studentLedger)

async function feesSection(s, auth, { today }) {
  const l = await studentLedger(String(s._id), auth)
  const open = l.invoices.filter((i) => i.status !== 'CANCELLED' && i.balance > 0)
  const next = open.find((i) => i.dueDate >= today) ?? open[0] ?? null
  return {
    totals: { billed: l.totals.billed, paid: l.totals.paid, due: l.totals.balance, overdue: l.totals.overdue, lateFeeDue: l.totals.lateFeeDue },
    nextDue: next && { date: next.dueDate, amount: next.balance, installment: next.installment ?? null, overdue: !!next.overdue },
    openCount: open.length,
    invoices: open.slice(0, 10).map((i) => ({ id: i.id ?? idStr(i._id), invoiceNo: i.invoiceNo ?? null, installment: i.installment ?? null, dueDate: i.dueDate, net: i.net, paid: i.paid, balance: i.balance, concession: i.concession ?? 0, lateFeeDue: i.lateFeeDue ?? 0, status: i.status, statusLabel: i.statusLabel, overdue: !!i.overdue })),
    receipts: l.payments.slice(0, 10).map((p) => ({ id: p.id ?? idStr(p._id), receiptNo: p.receiptNo, date: p.date, amount: p.amount, refunded: p.refunded ?? 0, mode: p.mode, modeLabel: p.modeLabel ?? PAYMENT_MODE_LABEL[p.mode] ?? p.mode, status: p.status, collectedBy: p.collectedBy ?? null })),
    receiptCount: l.payments.length,
    concessions: l.concessions.slice(0, 10).map((c) => ({ id: c.id ?? idStr(c._id), kind: c.kind, value: c.value, reason: c.reason, status: c.status, statusLabel: c.statusLabel ?? CONCESSION_STATUS[c.status]?.label })),
  }
}

// ───────────────────────────────────────────────────────── exams

async function examsSection(s, auth, { today, year }) {
  const [cfg, cands] = await Promise.all([getSettings('exams').catch(() => ({})), ExamCandidate.find({ studentId: s._id }).lean()])
  const exams = cands.length
    ? await Exam.find({ _id: { $in: cands.map((c) => c.examId) }, ...(year && { academicYearId: year._id }), status: { $in: ['SCHEDULED', 'PUBLISHED'] } }).sort({ startDate: 1 }).lean()
    : []
  const candOf = new Map(cands.map((c) => [String(c.examId), c]))
  const published = exams.filter((e) => e.status === 'PUBLISHED')
  const results = published.map((e) => {
    const c = candOf.get(String(e._id))
    return {
      candidateId: String(c._id), examId: String(e._id), exam: e.name, term: e.term ?? null, startDate: e.startDate ?? null, endDate: e.endDate ?? null, publishedAt: e.publishedAt ?? null,
      total: c.total ?? null, max: c.max ?? null, pct: c.pct ?? null, grade: c.grade ?? null, rank: cfg.showRank ? c.rank ?? null : null,
      result: c.result ?? null, resultLabel: RESULT_STATUS[c.result]?.label ?? null, failedSubjects: c.failedSubjects ?? [],
    }
  })

  // the latest published exam, subject by subject
  let latest = null
  const last = [...published].sort((a, b) => String(b.publishedAt ?? b.endDate ?? '').localeCompare(String(a.publishedAt ?? a.endDate ?? '')))[0]
  if (last) {
    const c = candOf.get(String(last._id))
    const [papers, sheets] = await Promise.all([
      ExamPaper.find({ examId: last._id, classId: c.classId }).sort({ order: 1, date: 1 }).lean(),
      MarkSheet.find({ examId: last._id, sectionId: c.sectionId }).select('paperId entries').lean(),
    ])
    const subjects = await subjectMap(papers.map((p) => p.subjectId))
    const entryOf = new Map(sheets.map((sh) => [String(sh.paperId), sh.entries.find((x) => String(x.studentId) === String(s._id))]))
    latest = {
      examId: String(last._id), exam: last.name, candidateId: String(c._id), pct: c.pct ?? null, grade: c.grade ?? null,
      subjects: papers.map((p) => {
        const e = entryOf.get(String(p._id))
        const marks = e?.marks ?? null
        return {
          subject: subjects.get(String(p.subjectId))?.name ?? '', code: subjects.get(String(p.subjectId))?.code ?? null, gradeOnly: !!p.gradeOnly,
          maxMarks: p.maxMarks, passMarks: p.passMarks, marks, absent: !!e?.absent, exempt: !!e?.exempt, grade: e?.grade ?? null,
          pct: p.gradeOnly || marks == null || !p.maxMarks ? null : Math.round((marks / p.maxMarks) * 1000) / 10,
          pass: p.gradeOnly || marks == null ? null : marks >= (p.passMarks ?? 0),
        }
      }).filter((x) => !x.exempt),
    }
  }

  // the next exam on the calendar
  const nextExam = exams.filter((e) => e.status === 'SCHEDULED' && (e.endDate ?? today) >= today).sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')))[0]
  let upcoming = null
  if (nextExam) {
    const papers = await ExamPaper.find({ examId: nextExam._id, classId: s.classId }).sort({ date: 1, startTime: 1 }).lean()
    const subjects = await subjectMap(papers.map((p) => p.subjectId))
    upcoming = {
      examId: String(nextExam._id), exam: nextExam.name, startDate: nextExam.startDate ?? null, endDate: nextExam.endDate ?? null, candidateId: idStr(candOf.get(String(nextExam._id))?._id),
      papers: papers.map((p) => ({ subject: subjects.get(String(p.subjectId))?.name ?? '', date: p.date ?? null, startTime: p.startTime ?? null, endTime: p.endTime ?? null })),
    }
  }

  // the year-end result: published, or worked out so far (needs Exams › Year results)
  let yearResult = null
  if (can(auth, 'exams.year-results.view') && s.sectionId) {
    const d = await yearCardData(String(s._id), auth).catch((e) => { if ([403, 404].includes(e?.status)) return null; throw e })
    if (d?.row) {
      yearResult = {
        status: d.status, year: d.year?.name ?? null, publishedAt: d.publishedAt ?? null, pct: d.row.pct ?? null, grade: d.row.grade ?? null,
        rank: cfg.showRank ? d.row.rank ?? null : null, of: d.sectionSize, result: d.row.result ?? null, resultLabel: YEAR_RESULT[d.row.result]?.label ?? null,
        failed: d.row.failed ?? [], subjects: (d.row.subjects ?? []).map((x) => ({ subject: x.subject, pct: x.pct ?? null, grade: x.grade ?? null, pass: x.pass ?? null })),
        weights: (d.plan?.rows ?? []).filter((x) => x.exams?.length).map((x) => ({ code: x.code, name: x.name, share: x.share })),
      }
    }
  }
  return { showRank: !!cfg.showRank, results, latest, upcoming, year: yearResult }
}

// ───────────────────────────────────────────────────────── homework

async function homeworkSection(s, { today, year }) {
  if (!s.sectionId) return { term: null, counts: { pending: 0, submitted: 0, checked: 0, overdue: 0, missing: 0, total: 0 }, items: [] }
  const term = (year?.terms ?? []).find((x) => x.startDate <= today && x.endDate >= today) ?? null
  const rows = await Homework.find({
    sectionId: s.sectionId, ...(year && { academicYearId: year._id }), ...(term && { dueDate: { $gte: term.startDate, $lte: term.endDate } }),
  }, { title: 1, subjectId: 1, setDate: 1, dueDate: 1, needsSubmission: 1, teacher: 1, entries: { $elemMatch: { studentId: s._id } } }).sort({ dueDate: -1 }).limit(400).lean()
  const counts = { pending: 0, submitted: 0, checked: 0, overdue: 0, missing: 0, total: rows.length }
  const items = rows.map((h) => {
    const e = h.entries?.[0]
    const status = e?.status ?? 'PENDING'
    const overdue = h.needsSubmission && status === 'PENDING' && h.dueDate < today
    if (h.needsSubmission) {
      if (overdue) counts.overdue++
      else if (status === 'PENDING') counts.pending++
      else if (status === 'SUBMITTED' || status === 'LATE') counts.submitted++
      else if (status === 'CHECKED') counts.checked++
      else if (status === 'MISSING') counts.missing++
    }
    return { id: String(h._id), title: h.title, subjectId: idStr(h.subjectId), setDate: h.setDate, dueDate: h.dueDate, needsSubmission: h.needsSubmission !== false, teacher: h.teacher ?? null, status, remark: e?.remark ?? null, overdue }
  })
  const pick = items.slice(0, 8)
  const subjects = await subjectMap(pick.map((x) => x.subjectId))
  return { term: term?.name ?? null, counts, items: pick.map(({ subjectId, ...x }) => ({ ...x, subject: subjects.get(String(subjectId))?.name ?? '' })) }
}

// ───────────────────────────────────────────────────────── timetable (services/timetable.js sectionWeek)

async function timetableSection(s) {
  const w = await sectionWeek(s.sectionId)
  if (!w.published) return { published: false, today: w.today }
  // today, or the next working day when there are no classes today (or they are over)
  const end = w.slots.filter((x) => x.end).map((x) => x.end).sort().at(-1)
  let day = w.today
  let isToday = w.days.includes(weekdayCode(day)) && !(end && w.time > end)
  if (!isToday) {
    day = addDays(day, 1)
    for (let i = 0; i < 7 && !w.days.includes(weekdayCode(day)); i++) day = addDays(day, 1)
  }
  const code = weekdayCode(day)
  const row = w.cells[code] ?? {}
  const subs = w.substitutions.filter((x) => x.date === day)
  const periods = w.slots.map((sl) => {
    const c = sl.kind === 'PERIOD' ? row[sl.no] : null
    const sub = sl.kind === 'PERIOD' ? subs.find((x) => x.period === sl.no) : null
    return { no: sl.no, kind: sl.kind, label: sl.label ?? null, start: sl.start ?? null, end: sl.end ?? null, subject: c?.subject ?? null, subjectCode: c?.subjectCode ?? null, teacher: sub?.teacher || c?.teacher || null, substitute: !!sub, room: c?.room ?? null }
  })
  const weekly = new Map()
  for (const r of Object.values(w.cells)) for (const c of Object.values(r)) if (c.subject) weekly.set(c.subject, (weekly.get(c.subject) ?? 0) + 1)
  return {
    published: true, today: w.today, time: w.time, day, weekday: code, isToday, periods,
    perWeek: [...weekly.entries()].map(([subject, n]) => ({ subject, periods: n })).sort((a, b) => b.periods - a.periods),
  }
}

// ───────────────────────────────────────────────────────── campus life

async function transportSection(s) {
  const a = await TransportAssignment.findOne({ studentId: s._id, active: true }).lean()
  if (!a) return { assigned: false }
  const r = await TransportRoute.findById(a.routeId).lean()
  const stop = r?.stops?.find((x) => String(x._id) === String(a.stopId))
  const v = r?.vehicleId ? await Vehicle.findById(r.vehicleId).select('regNo type capacity driver attendant').lean() : null
  return {
    assigned: true, mode: a.mode, from: a.from, routeId: idStr(a.routeId), route: r?.name ?? '', routeCode: r?.code ?? null,
    stop: stop ? { name: stop.name, pickupTime: stop.pickupTime ?? null, dropTime: stop.dropTime ?? null, landmark: stop.landmark ?? null } : null,
    stops: r?.stops?.length ?? 0,
    vehicle: v ? { regNo: v.regNo, type: v.type ?? null, driver: v.driver?.name ?? null, driverMobile: v.driver?.mobile ?? null, attendant: v.attendant?.name ?? null, attendantMobile: v.attendant?.mobile ?? null } : null,
  }
}

async function librarySection(s, { today }) {
  const [out, fines, read] = await Promise.all([
    LibraryLoan.find({ studentId: s._id, status: 'ISSUED' }).sort({ dueOn: 1 }).select('title accessionNo issuedOn dueOn status renewals').lean(),
    LibraryFine.find({ studentId: s._id, status: 'OPEN' }).sort({ date: -1 }).select('reason amount days title date').lean(),
    LibraryLoan.countDocuments({ studentId: s._id, status: 'RETURNED' }),
  ])
  return {
    out: out.map((l) => {
      const state = loanState(l, today)
      return { id: String(l._id), title: l.title, accessionNo: l.accessionNo, issuedOn: l.issuedOn, dueOn: l.dueOn, state, daysLate: state === 'OVERDUE' ? dayDiff(l.dueOn, today) : 0, daysLeft: state === 'ISSUED' ? dayDiff(today, l.dueOn) : 0 }
    }),
    overdue: out.filter((l) => loanState(l, today) === 'OVERDUE').length,
    fines: fines.map((f) => ({ id: String(f._id), reason: f.reason, reasonLabel: FINE_REASONS.find((x) => x.value === f.reason)?.label ?? f.reason, amount: f.amount, days: f.days ?? null, title: f.title ?? null, date: f.date })),
    owed: fines.reduce((n, f) => n + (f.amount ?? 0), 0),
    read,
  }
}

async function hostelSection(s) {
  const [a, passes] = await Promise.all([
    HostelAllotment.findOne({ studentId: s._id, active: true }).lean(),
    Outpass.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(5).lean(),
  ])
  let allotment = null
  if (a) {
    const [b, r] = await Promise.all([HostelBlock.findById(a.blockId).select('name code kind warden').lean(), HostelRoom.findById(a.roomId).select('number floor type ac beds').lean()])
    const bed = r?.beds?.find((x) => String(x._id) === String(a.bedId))
    allotment = {
      from: a.from, block: b?.name ?? '', blockKind: b?.kind ?? null, warden: b?.warden?.name ?? null, wardenMobile: b?.warden?.mobile ?? null,
      room: r?.number ?? '', floor: r?.floor ?? null, roomType: r?.type ?? null, ac: !!r?.ac, bed: bed?.label ?? '', bedCode: bedCode(b?.code, r?.number, bed?.label),
      roommates: Math.max(0, (r?.beds?.length ?? 1) - 1),
    }
  }
  return {
    allotment,
    open: passes.filter((p) => OUTPASS_OPEN.includes(p.status)).length,
    outpasses: passes.map((p) => ({ id: String(p._id), outpassNo: p.outpassNo, kind: p.kind, leaveDate: p.leaveDate, leaveTime: p.leaveTime, returnDate: p.returnDate, returnTime: p.returnTime, reason: p.reason, status: p.status, statusLabel: OUTPASS_STATUS[p.status]?.label, late: !!p.late })),
  }
}

async function healthSection(s, auth) {
  const h = await getRecord(String(s._id), auth)
  const r = h.record
  return {
    bloodGroup: r.bloodGroup, allergies: r.allergies ?? [], vaccinations: (r.vaccinations ?? []).length,
    lastVaccination: r.vaccinations?.[0] ? { name: r.vaccinations[0].name, date: r.vaccinations[0].date, dose: r.vaccinations[0].dose } : null,
    latest: r.latest ? { date: r.latest.date, heightCm: r.latest.heightCm ?? null, weightKg: r.latest.weightKg ?? null, bmi: r.latest.bmi ?? null } : null,
    doctor: r.doctor, sensitive: !!r.sensitive, hasSensitive: !!r.hasSensitive,
    ...(r.sensitive && { conditions: r.conditions ?? [], medications: r.medications ?? [] }),
    visits: h.visits.slice(0, 3).map((v) => ({ id: v.id, date: v.date, complaint: v.complaint, outcome: v.outcome, tempC: v.tempC })),
    incidents: h.incidents.length,
  }
}

async function canteenSection(s, { today }) {
  const [w, spent, set] = await Promise.all([walletFor(s._id), spentOn(s._id, today), canteenSettings()])
  return { balance: w.balance ?? 0, spentToday: spent, dailyLimit: w.dailyLimit ?? null, low: (w.balance ?? 0) < set.lowBalance, lowBalance: set.lowBalance }
}

// ───────────────────────────────────────────────────────── college extras

async function programsSection(s) {
  const e = await ProgramEnrolment.findOne({ studentId: s._id }).lean()
  if (!e) return null
  const [p, sem] = await Promise.all([
    Program.findById(e.programId).select('name code level semesters').lean(),
    CoeSemesterResult.findOne({ studentId: s._id, published: true }).sort({ semester: -1, updatedAt: -1 }).lean(),
  ])
  return {
    program: p?.name ?? '', code: p?.code ?? null, level: p?.level ?? null, semesters: p?.semesters ?? null, semester: e.currentSemester, batch: e.batch, registerNo: e.registerNo ?? null, status: e.status,
    result: sem ? { semester: sem.semester, sgpa: sem.sgpa ?? null, cgpa: sem.cgpa ?? null, credits: sem.cumulativeCredits ?? null, arrears: sem.arrears ?? 0, result: sem.result ?? null } : null,
  }
}

async function placementsSection(s) {
  const offers = await PlacementOffer.find({ studentId: s._id }).sort({ offeredOn: -1 }).limit(10).lean()
  if (!offers.length) return null
  const cos = new Map((await Company.find({ _id: { $in: offers.map((o) => o.companyId) } }).select('name').lean()).map((c) => [String(c._id), c.name]))
  return { offers: offers.map((o) => ({ id: String(o._id), company: cos.get(String(o.companyId)) ?? '', role: o.role ?? null, ctc: o.ctc, location: o.location ?? null, offeredOn: o.offeredOn, status: o.status, statusLabel: OFFER_STATUS[o.status]?.label, offCampus: !!o.offCampus })) }
}

// ───────────────────────────────────────────────────────── messages, certificates, documents

async function messagesSection(s) {
  const rows = await MessageLog.find({ studentId: s._id, test: { $ne: true } }).sort({ createdAt: -1 }).limit(10).select('event channel status to subject createdAt sentAt delivery.status').lean()
  return rows.map((m) => ({ id: String(m._id), event: m.event ?? null, channel: m.channel, status: m.status, delivery: m.delivery?.status ?? null, to: m.to ?? null, subject: m.subject ?? null, at: m.sentAt ?? m.createdAt }))
}

async function certificatesSection(s) {
  const rows = await Certificate.find({ studentId: s._id }).sort({ issueDate: -1 }).limit(20).select('certificateNo kind issueDate purpose status snapshot.event').lean()
  return rows.map((c) => ({ id: String(c._id), certificateNo: c.certificateNo, kind: c.kind, kindLabel: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind, issueDate: c.issueDate, purpose: c.purpose ?? c.snapshot?.event ?? null, status: c.status }))
}

// ───────────────────────────────────────────────────────── the whole picture

/** Run one section: undefined when off or out of scope, { error: true } when it broke (logged). */
async function section(name, on, fn) {
  if (!on) return [name, undefined]
  try {
    const v = await fn()
    return [name, v ?? undefined]
  } catch (err) {
    if ([403, 404].includes(err?.status)) return [name, undefined]
    logger.warn({ err, section: name }, 'student 360: a section could not be read')
    return [name, { error: true }]
  }
}

export async function studentOverview(id, auth) {
  if (!isOid(id)) throw notFound('Student')
  const s = await Student.findById(id).lean()
  if (!s) throw notFound('Student')
  const scope = await scopeFilter(auth)
  if (scope && !scope.sectionId.$in.some((x) => String(x) === String(s.sectionId))) throw notFound('Student')

  const [now, year] = await Promise.all([institutionNow(), currentYear()])
  const ctx = { today: now.date, year }
  const on = (moduleId, perms) => moduleEnabled(auth, moduleId) && anyOf(auth, perms)

  const parts = await Promise.all([
    section('attendance', on('attendance', ['attendance.register.view', 'attendance.mark.view', 'attendance.reports.view']) && s.sectionId, () => attendanceSection(s, ctx)),
    section('fees', on('fees', ['fees.collect.view', 'fees.invoices.view', 'fees.dues.view']), () => feesSection(s, auth, ctx)),
    section('exams', on('exams', ['exams.results.view', 'exams.report-cards.view', 'exams.year-results.view']), () => examsSection(s, auth, ctx)),
    section('homework', on('homework', ['homework.homework.view']), () => homeworkSection(s, ctx)),
    section('timetable', on('timetable', ['timetable.timetable.view']) && s.sectionId, () => timetableSection(s)),
    section('transport', on('transport', ['transport.assignments.view', 'transport.routes.view']), () => transportSection(s)),
    section('library', on('library', ['library.circulation.view', 'library.fines.view']), () => librarySection(s, ctx)),
    section('hostel', on('hostel', ['hostel.allotment.view', 'hostel.outpass.view']), () => hostelSection(s)),
    section('health', on('health', ['health.records.view']), () => healthSection(s, auth)),
    section('canteen', on('canteen', ['canteen.wallet.view']), () => canteenSection(s, ctx)),
    section('programs', on('programs', ['programs.programs.view']), () => programsSection(s)),
    section('placements', on('placements', ['placements.offers.view']), () => placementsSection(s)),
    section('messages', on('communication', ['communication.log.view']), () => messagesSection(s)),
    section('certificates', on('certificates', ['certificates.register.view', 'certificates.issue.view']), () => certificatesSection(s)),
    section('documents', true, async () => ({ attachments: await Attachment.countDocuments({ entityType: 'student', entityId: String(s._id), 'deleted.at': null }) })),
  ])
  const out = { studentId: String(s._id), today: now.date, time: now.time, year: year ? { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate } : null }
  for (const [k, v] of parts) if (v !== undefined) out[k] = v
  return out
}
