import { AT_RISK_DEFAULT_PCT, ATTENDANCE_BANDS, attendanceBand, attendancePct, pctOf } from '@schoolgiant/shared'
import { GradingScheme, Subject } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Exam, ExamCandidate, MarkSheet } from '../models/exams.js'
import { isOid } from '../platform/db.js'
import { notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { yearOrCurrent } from './academics.js'
import { analyticsScope, scopedSections, studentCards, today, yearOptions } from './analytics.js'

// Analytics › Academic performance: one published exam of a year — class averages and pass %,
// grade spread, subject averages (weakest first), toppers, students at risk — plus the year's
// exam-to-exam trend per class and how attendance lines up with results.

const r1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10)

/** Grades in band order (best first) across the institution's grading schemes. */
async function gradeOrder(seen) {
  const schemes = await GradingScheme.find().select('bands isDefault').lean()
  schemes.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault))
  const out = []
  for (const s of schemes) for (const b of [...(s.bands ?? [])].sort((x, y) => y.min - x.min)) if (!out.includes(b.grade)) out.push(b.grade)
  for (const g of seen) if (g && !out.includes(g)) out.push(g)
  return out.filter((g) => seen.has(g))
}

/** Each student's attendance in a year up to a date (the day's sheets), by student id. */
async function attendanceByStudent(yearId, sectionIds, upto) {
  const rows = await AttendanceSheet.aggregate([
    { $match: { academicYearId: yearId, period: 0, sectionId: { $in: sectionIds }, date: { $lte: upto } } },
    { $unwind: '$entries' },
    { $group: {
      _id: '$entries.studentId',
      total: { $sum: 1 },
      P: { $sum: { $cond: [{ $eq: ['$entries.status', 'P'] }, 1, 0] } },
      L: { $sum: { $cond: [{ $eq: ['$entries.status', 'L'] }, 1, 0] } },
      HD: { $sum: { $cond: [{ $eq: ['$entries.status', 'HD'] }, 1, 0] } },
      A: { $sum: { $cond: [{ $eq: ['$entries.status', 'A'] }, 1, 0] } },
    } },
  ])
  return new Map(rows.map((r) => [String(r._id), { pct: attendancePct(r), days: r.total }]))
}

/** Subject averages of an exam (every paper with marks; absent = 0, exempt and grade-only papers left out). */
async function subjectStats(examId, sectionIds) {
  return MarkSheet.aggregate([
    { $match: { examId, sectionId: { $in: sectionIds } } },
    { $unwind: '$entries' },
    { $match: { 'entries.exempt': { $ne: true }, $or: [{ 'entries.absent': true }, { 'entries.marks': { $ne: null } }] } },
    // a mark sheet is already this institution's, and paper ids are unique: the join needs no tenant filter of its own
    { $lookup: { from: 'exam_papers', localField: 'paperId', foreignField: '_id', as: 'p', pipeline: [{ $project: { subjectId: 1, classId: 1, maxMarks: 1, passMarks: 1, gradeOnly: 1 } }] } },
    { $unwind: '$p' },
    { $match: { 'p.gradeOnly': { $ne: true } } },
    { $project: {
      subjectId: '$p.subjectId', classId: '$p.classId',
      pct: { $cond: ['$entries.absent', 0, { $multiply: [{ $divide: ['$entries.marks', { $max: ['$p.maxMarks', 1] }] }, 100] }] },
      passed: { $cond: [{ $and: [{ $ne: ['$entries.absent', true] }, { $gte: ['$entries.marks', { $ifNull: ['$p.passMarks', 0] }] }] }, 1, 0] },
    } },
    { $group: { _id: { subjectId: '$subjectId', classId: '$classId' }, n: { $sum: 1 }, sumPct: { $sum: '$pct' }, passed: { $sum: '$passed' } } },
  ])
}

const emptyResult = (years, year) => ({
  years, year, exams: [], exam: null, summary: null, classes: [], grades: [], subjects: [], toppers: [], atRisk: [], trend: { exams: [], overall: [], classes: [] }, attendanceBands: [],
})

/**
 * Academic performance for a published exam (default: the latest one of the year).
 * `riskPct`: a result under it puts a student "at risk" (as does failing a subject or attendance under the minimum).
 */
export async function academicsAnalytics({ yearId, examId, riskPct }, auth) {
  const [scope, year, t] = await Promise.all([analyticsScope(auth), yearOrCurrent(yearId), today()])
  const yearDto = { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate }
  const years = await yearOptions()
  const exams = await Exam.find({ academicYearId: year._id, status: 'PUBLISHED' }).select('name term startDate endDate publishedAt').lean()
  exams.sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')) || (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
  if (!exams.length) return emptyResult(years, yearDto)
  if (examId && (!isOid(examId) || !exams.some((e) => String(e._id) === String(examId)))) throw notFound('Published exam')
  const exam = examId ? exams.find((e) => String(e._id) === String(examId)) : exams[exams.length - 1]

  const sections = await scopedSections(scope, year._id)
  const sectionIds = sections.map((s) => s._id)
  const sectionsById = new Map(sections.map((s) => [String(s._id), s]))
  const classes = new Map()
  for (const s of sections) if (!classes.has(String(s.classId))) classes.set(String(s.classId), s.cls)
  const threshold = Number.isFinite(Number(riskPct)) && riskPct !== '' && riskPct !== null && riskPct !== undefined ? Number(riskPct) : AT_RISK_DEFAULT_PCT
  const upto = t < year.endDate ? t : year.endDate

  const [attCfg, candidates, subjectRows, trendRows, attendance] = await Promise.all([
    getSettings('attendance'),
    ExamCandidate.find({ examId: exam._id, sectionId: { $in: sectionIds } }).select('studentId classId sectionId pct grade rank result failedSubjects').lean(),
    subjectStats(exam._id, sectionIds),
    ExamCandidate.aggregate([
      { $match: { examId: { $in: exams.map((e) => e._id) }, sectionId: { $in: sectionIds }, result: { $in: ['PASS', 'FAIL'] } } },
      { $group: { _id: { examId: '$examId', classId: '$classId' }, n: { $sum: 1 }, sumPct: { $sum: { $ifNull: ['$pct', 0] } }, pass: { $sum: { $cond: [{ $eq: ['$result', 'PASS'] }, 1, 0] } } } },
    ]),
    attendanceByStudent(year._id, sectionIds, upto),
  ])
  const minAttendance = Number(attCfg.minimumPct) || 0
  const done = candidates.filter((c) => c.result === 'PASS' || c.result === 'FAIL')

  // ── class-wise: average, pass %, grade spread
  const byClass = new Map()
  const seenGrades = new Set()
  for (const c of candidates) {
    const k = String(c.classId)
    const row = byClass.get(k) ?? { students: 0, assessed: 0, sumPct: 0, pass: 0, fail: 0, incomplete: 0, grades: {} }
    row.students += 1
    if (c.result === 'PASS' || c.result === 'FAIL') {
      row.assessed += 1
      row.sumPct += c.pct ?? 0
      row[c.result === 'PASS' ? 'pass' : 'fail'] += 1
      if (c.grade) { row.grades[c.grade] = (row.grades[c.grade] ?? 0) + 1; seenGrades.add(c.grade) }
    } else row.incomplete += 1
    byClass.set(k, row)
  }
  const classRows = [...byClass.entries()].map(([id, r]) => {
    const cls = classes.get(id)
    return { classId: id, name: cls?.name ?? '?', code: cls?.code ?? null, order: cls?.order ?? 999, students: r.students, assessed: r.assessed, average: r.assessed ? r1(r.sumPct / r.assessed) : null, passPct: pctOf(r.pass, r.assessed), passed: r.pass, failed: r.fail, incomplete: r.incomplete, grades: r.grades }
  }).sort((a, b) => a.order - b.order)

  // ── subjects: overall average and the classes' spread
  const subjectIds = [...new Set(subjectRows.map((r) => String(r._id.subjectId)))]
  const subjectNames = new Map((await Subject.find({ _id: { $in: subjectIds } }).select('name code').lean()).map((s) => [String(s._id), s]))
  const bySubject = new Map()
  for (const r of subjectRows) {
    const k = String(r._id.subjectId)
    const s = bySubject.get(k) ?? { n: 0, sumPct: 0, passed: 0, classes: [] }
    s.n += r.n; s.sumPct += r.sumPct; s.passed += r.passed
    s.classes.push({ classId: String(r._id.classId), name: classes.get(String(r._id.classId))?.name ?? '?', average: r1(r.sumPct / r.n) })
    bySubject.set(k, s)
  }
  const subjects = [...bySubject.entries()].map(([id, s]) => {
    const weakest = [...s.classes].sort((a, b) => a.average - b.average)[0]
    return { subjectId: id, name: subjectNames.get(id)?.name ?? '?', code: subjectNames.get(id)?.code ?? null, students: s.n, average: r1(s.sumPct / s.n), passPct: pctOf(s.passed, s.n), failed: s.n - s.passed, classes: s.classes.length, weakestClass: weakest ?? null }
  }).sort((a, b) => a.average - b.average)

  // ── people: toppers and students at risk
  const toppers = [...done].filter((c) => Number.isFinite(c.pct)).sort((a, b) => b.pct - a.pct).slice(0, 10)
  const risky = []
  for (const c of candidates) {
    const att = attendance.get(String(c.studentId))
    const reasons = []
    if (c.result === 'FAIL') reasons.push('FAILED')
    if (Number.isFinite(c.pct) && c.result !== 'INCOMPLETE' && c.pct < threshold) reasons.push('LOW_RESULT')
    if (att?.pct !== null && att?.pct !== undefined && minAttendance && att.pct < minAttendance) reasons.push('LOW_ATTENDANCE')
    if (reasons.length) risky.push({ c, att, reasons })
  }
  risky.sort((a, b) => b.reasons.length - a.reasons.length || (a.c.pct ?? 101) - (b.c.pct ?? 101))
  const atRiskList = risky.slice(0, 300)
  const cards = await studentCards([...new Set([...toppers, ...atRiskList.map((x) => x.c)].map((c) => c.studentId))], sectionsById)
  const person = (c) => {
    const s = cards.get(String(c.studentId))
    return { studentId: String(c.studentId), name: s?.name ?? '?', admissionNo: s?.admissionNo ?? null, classShort: sectionsById.get(String(c.sectionId))?.short ?? s?.classShort ?? null, classId: String(c.classId) }
  }

  // ── trend: each published exam's class averages
  const trendClasses = new Map()
  const overall = new Map()
  for (const r of trendRows) {
    const e = String(r._id.examId)
    const k = String(r._id.classId)
    const row = trendClasses.get(k) ?? {}
    row[e] = { average: r1(r.sumPct / r.n), passPct: pctOf(r.pass, r.n), students: r.n }
    trendClasses.set(k, row)
    const o = overall.get(e) ?? { n: 0, sumPct: 0, pass: 0 }
    o.n += r.n; o.sumPct += r.sumPct; o.pass += r.pass
    overall.set(e, o)
  }

  // ── attendance against the result
  const bands = new Map(ATTENDANCE_BANDS.map((b) => [b.key, { students: 0, sumPct: 0, pass: 0, sumAtt: 0 }]))
  for (const c of done) {
    const att = attendance.get(String(c.studentId))
    const key = attendanceBand(att?.pct)
    if (!key) continue
    const b = bands.get(key)
    b.students += 1; b.sumPct += c.pct ?? 0; b.sumAtt += att.pct; if (c.result === 'PASS') b.pass += 1
  }

  const attTotals = [...attendance.values()].filter((a) => a.pct !== null)
  return {
    years, year: yearDto,
    exams: exams.map((e) => ({ id: String(e._id), name: e.name, term: e.term ?? null, startDate: e.startDate ?? null, endDate: e.endDate ?? null })),
    exam: { id: String(exam._id), name: exam.name, startDate: exam.startDate ?? null, endDate: exam.endDate ?? null },
    riskPct: threshold, minAttendancePct: minAttendance, attendanceUpto: upto,
    summary: {
      candidates: candidates.length, assessed: done.length, incomplete: candidates.length - done.length,
      average: done.length ? r1(done.reduce((n, c) => n + (c.pct ?? 0), 0) / done.length) : null,
      passPct: pctOf(done.filter((c) => c.result === 'PASS').length, done.length),
      passed: done.filter((c) => c.result === 'PASS').length, failed: done.filter((c) => c.result === 'FAIL').length,
      highest: done.length ? Math.max(...done.map((c) => c.pct ?? 0)) : null,
      atRisk: risky.length,
      attendancePct: attTotals.length ? r1(attTotals.reduce((n, a) => n + a.pct, 0) / attTotals.length) : null,
    },
    grades: await gradeOrder(seenGrades),
    classes: classRows,
    subjects,
    toppers: toppers.map((c, i) => ({ ...person(c), position: i + 1, pct: c.pct, grade: c.grade ?? null, classRank: c.rank ?? null })),
    atRisk: atRiskList.map(({ c, att, reasons }) => ({ ...person(c), pct: c.pct ?? null, grade: c.grade ?? null, result: c.result ?? null, failedSubjects: c.failedSubjects ?? [], attendancePct: att?.pct ?? null, reasons })),
    trend: {
      exams: exams.map((e) => ({ id: String(e._id), name: e.name, startDate: e.startDate ?? null })),
      overall: exams.map((e) => { const o = overall.get(String(e._id)); return { examId: String(e._id), average: o ? r1(o.sumPct / o.n) : null, passPct: o ? pctOf(o.pass, o.n) : null } }),
      classes: [...trendClasses.entries()].map(([id, byExam]) => ({ classId: id, name: classes.get(id)?.name ?? '?', order: classes.get(id)?.order ?? 999, byExam })).sort((a, b) => a.order - b.order),
    },
    attendanceBands: ATTENDANCE_BANDS.map((b) => {
      const x = bands.get(b.key)
      return { key: b.key, min: b.min, max: b.max, tone: b.tone, students: x.students, average: x.students ? r1(x.sumPct / x.students) : null, passPct: pctOf(x.pass, x.students), attendance: x.students ? r1(x.sumAtt / x.students) : null }
    }),
  }
}
