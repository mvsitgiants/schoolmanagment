import {
  YEAR_RESULT, attendancePct, countMarks, gradeFor, paperPct, rankBy, sectionLabel, weightPlan, yearResultFor,
} from '@schoolgiant/shared'
import { ClassLevel, GradingScheme, Section, Subject } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Exam, ExamCandidate, ExamPaper, ExamType, MarkSheet, YearResult } from '../models/exams.js'
import { Student, studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { conflict, forbidden, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { sectionsInScope, yearOrCurrent } from './academics.js'

// Year-end result (Exams › Year-end results, page exams.year-results). Every PUBLISHED exam of the year is combined per
// subject by its exam type's weightage (shared yearResults.js); until every weighted type has a published exam the
// sheet says "so far". Publishing freezes a class's result (YearResult) — the report card, the family app and
// promotion read the frozen copy from then on. Sections follow the caller's data scope for `exams`.

const idStr = (v) => (v ? String(v) : null)
const rulesOf = async () => {
  const s = await getSettings('exams')
  return { combine: s.yearCombine ?? 'AVERAGE', passPct: Number(s.yearPassPct ?? 33), compartmentMax: Number(s.compartmentMax ?? 2) }
}

async function bandsForClass(cls) {
  const scheme = (cls.gradingSchemeId && await GradingScheme.findById(cls.gradingSchemeId).lean()) || await GradingScheme.findOne({ isDefault: true }).lean()
  return scheme?.bands ?? []
}

/** The weighting for a class this year: published exams by type, and the weighted exams still to come. */
async function planFor(year, classId) {
  const [types, exams] = await Promise.all([
    ExamType.find({ active: { $ne: false } }).sort({ weightage: 1 }).lean(),
    Exam.find({ academicYearId: year._id, classIds: classId }).select('name examTypeId status startDate').sort({ startDate: 1 }).lean(),
  ])
  const published = exams.filter((e) => e.status === 'PUBLISHED')
  const plan = weightPlan(types.map((t) => ({ id: t._id, code: t.code, name: t.name, weightage: t.weightage })), published.map((e) => ({ id: e._id, name: e.name, typeId: e.examTypeId })))
  const weighted = new Set(plan.rows.map((r) => r.typeId))
  plan.coming = exams.filter((e) => e.status !== 'PUBLISHED' && weighted.has(idStr(e.examTypeId))).map((e) => ({ id: String(e._id), name: e.name, startDate: e.startDate ?? null }))
  return plan
}

/** Work out a class's year live: per student, per subject, from the marks of its published exams. */
async function computeClass(year, cls, sections) {
  const rules = await rulesOf()
  const plan = await planFor(year, cls._id)
  const examIds = plan.rows.flatMap((r) => r.exams.map((e) => e.id))
  const papers = examIds.length ? await ExamPaper.find({ examId: { $in: examIds }, classId: cls._id }).lean() : []
  // subjects with marks, in the class's own subject order
  const order = new Map((cls.subjectIds ?? []).map((id, i) => [String(id), i]))
  const counted = papers.filter((p) => !p.gradeOnly && p.countsInTotal !== false)
  const subjectRows = await Subject.find({ _id: { $in: [...new Set(counted.map((p) => String(p.subjectId)))] } }).select('name code').lean()
  const subjects = subjectRows.map((s) => ({ id: String(s._id), name: s.name, code: s.code ?? null })).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.name.localeCompare(b.name))
  const [sheets, students, bands] = await Promise.all([
    papers.length ? MarkSheet.find({ paperId: { $in: papers.map((p) => p._id) }, sectionId: { $in: sections.map((s) => s._id) } }).lean() : [],
    Student.find({ sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' }).select('firstName middleName lastName admissionNo rollNo sectionId').lean(),
    bandsForClass(cls),
  ])
  const paperById = new Map(papers.map((p) => [String(p._id), p]))
  const scores = new Map() // studentId → { subjectId: { examId: pct } }
  for (const sh of sheets) {
    const p = paperById.get(String(sh.paperId))
    if (!p) continue
    for (const x of sh.entries) {
      const v = paperPct(x, p)
      if (v === null) continue
      const m = scores.get(String(x.studentId)) ?? {}
      ;(m[String(p.subjectId)] ??= {})[String(p.examId)] = v
      scores.set(String(x.studentId), m)
    }
  }
  const rows = students.map((s) => {
    const r = yearResultFor(scores.get(String(s._id)) ?? {}, plan, { ...rules, subjects })
    return {
      studentId: String(s._id), sectionId: String(s.sectionId), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null,
      subjects: r.subjects.map((x) => ({ ...x, grade: x.pct === null ? null : gradeFor(bands, x.pct)?.grade ?? null })),
      pct: r.pct, grade: r.pct === null ? null : gradeFor(bands, r.pct)?.grade ?? null, result: r.result, failed: r.failed,
    }
  })
  // rank inside each section, on the overall %
  for (const sec of sections) {
    const mine = rows.filter((r) => r.sectionId === String(sec._id))
    const ranks = rankBy(mine.map((r) => ({ pct: r.result === 'INCOMPLETE' ? null : r.pct })), 'pct')
    mine.forEach((r, i) => { r.rank = ranks[i] })
  }
  return { plan, rules, subjects, rows, bands }
}

/** The stored (published) result of a class, shaped like computeClass. */
async function storedClass(stored, sections) {
  const want = new Set(sections.map((s) => String(s._id)))
  const students = await Student.find({ _id: { $in: stored.students.map((s) => s.studentId) } }).select('firstName middleName lastName admissionNo rollNo').lean()
  const st = new Map(students.map((s) => [String(s._id), s]))
  const subjects = []
  for (const r of stored.students) for (const x of r.subjects) if (!subjects.some((s) => s.id === x.subjectId)) subjects.push({ id: x.subjectId, name: x.subject })
  return {
    plan: stored.plan, rules: stored.rules, subjects,
    rows: stored.students.filter((r) => want.has(String(r.sectionId))).map((r) => {
      const s = st.get(String(r.studentId))
      return { studentId: String(r.studentId), sectionId: String(r.sectionId), name: s ? studentName(s) : '?', admissionNo: s?.admissionNo, rollNo: s?.rollNo ?? null, subjects: r.subjects, pct: r.pct ?? null, grade: r.grade ?? null, rank: r.rank ?? null, result: r.result, failed: r.failed ?? [] }
    }),
  }
}

async function classInScope(classId, auth, year) {
  if (!isOid(classId)) throw notFound('Class')
  const cls = await ClassLevel.findById(classId).lean()
  if (!cls) throw notFound('Class')
  const allowed = auth ? await sectionsInScope(auth, 'exams') : null
  const sections = (await Section.find({ academicYearId: year._id, classId: cls._id, active: { $ne: false } }).sort({ name: 1 }).lean())
    .filter((s) => !allowed || allowed.includes(String(s._id)))
  if (!sections.length) throw forbidden('That class is outside your classes.')
  return { cls, sections: sections.map((s) => ({ ...s, label: sectionLabel(cls, s), short: sectionLabel(cls, s, { short: true }) })) }
}

const summaryOf = (rows) => {
  const done = rows.filter((r) => r.pct !== null && r.result !== 'INCOMPLETE')
  const by = (k) => rows.filter((r) => r.result === k).length
  return {
    students: rows.length, PASS: by('PASS'), COMPARTMENT: by('COMPARTMENT'), FAIL: by('FAIL'), INCOMPLETE: by('INCOMPLETE'),
    average: done.length ? Math.round((done.reduce((n, r) => n + r.pct, 0) / done.length) * 100) / 100 : null,
    highest: done.length ? Math.max(...done.map((r) => r.pct)) : null,
  }
}

// ───────────────────────────────────────────────────────── screens

/** Every class of the year the caller can see: its weighting so far and whether its result is published. */
export async function yearOverview(auth) {
  const year = await yearOrCurrent()
  const allowed = await sectionsInScope(auth, 'exams')
  const sections = (await Section.find({ academicYearId: year._id, active: { $ne: false } }).select('classId name').lean()).filter((s) => !allowed || allowed.includes(String(s._id)))
  const classes = await ClassLevel.find({ _id: { $in: [...new Set(sections.map((s) => String(s.classId)))] }, active: { $ne: false } }).sort({ order: 1, name: 1 }).lean()
  const stored = new Map((await YearResult.find({ academicYearId: year._id }).select('classId publishedAt publishedBy').lean()).map((y) => [String(y.classId), y]))
  const out = []
  for (const c of classes) {
    const plan = await planFor(year, c._id)
    const y = stored.get(String(c._id))
    out.push({
      id: String(c._id), name: c.name, code: c.code,
      sections: sections.filter((s) => String(s.classId) === String(c._id)).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ id: String(s._id), label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }) })),
      exams: plan.rows.reduce((n, r) => n + r.exams.length, 0), missing: plan.missing, provisional: plan.provisional,
      status: y ? 'PUBLISHED' : 'OPEN', publishedAt: y?.publishedAt ?? null,
    })
  }
  return { year: { id: String(year._id), name: year.name }, classes: out }
}

/** One section's year sheet (or the whole class with no section): weighting, a column per subject, a row per student. */
export async function yearSheet(classId, sectionId, auth) {
  const year = await yearOrCurrent()
  const { cls, sections } = await classInScope(classId, auth, year)
  const pick = sectionId ? sections.filter((s) => String(s._id) === String(sectionId)) : sections
  if (!pick.length) throw notFound('Section')
  const stored = await YearResult.findOne({ academicYearId: year._id, classId: cls._id }).lean()
  const r = stored ? await storedClass(stored, pick) : await computeClass(year, cls, pick)
  const plan = stored ? { ...stored.plan, coming: [] } : r.plan
  const rows = r.rows.sort((a, b) => String(a.rollNo ?? '').localeCompare(String(b.rollNo ?? ''), 'en', { numeric: true }) || a.name.localeCompare(b.name))
  return {
    year: { id: String(year._id), name: year.name }, class: { id: String(cls._id), name: cls.name },
    section: sectionId ? { id: String(pick[0]._id), label: pick[0].label } : null,
    status: stored ? 'PUBLISHED' : 'OPEN', publishedAt: stored?.publishedAt ?? null, publishedBy: stored?.publishedBy ?? null,
    plan, rules: r.rules, subjects: r.subjects, rows, summary: summaryOf(rows),
  }
}

/** Freeze a class's year result. Every weighted exam type needs a published exam first. */
export async function publishYear(classId, auth, req) {
  const year = await yearOrCurrent()
  const { cls, sections } = await classInScope(classId, null, year)
  if (await YearResult.exists({ academicYearId: year._id, classId: cls._id })) throw conflict('Already published.')
  const r = await computeClass(year, cls, sections)
  if (r.plan.provisional) {
    const names = r.plan.rows.filter((x) => !x.exams.length).map((x) => x.name).join(', ')
    throw conflict(`Publish the ${names} results first — the year result needs every exam that carries a weightage.`, { code: 'YEAR_PROVISIONAL' })
  }
  await YearResult.create({
    academicYearId: year._id, classId: cls._id, plan: r.plan, rules: r.rules, publishedAt: new Date(), publishedBy: auth.user?.name,
    students: r.rows.map((x) => ({ studentId: x.studentId, sectionId: x.sectionId, subjects: x.subjects, pct: x.pct, grade: x.grade, rank: x.rank, result: x.result, failed: x.failed })),
  })
  const s = summaryOf(r.rows)
  await audit({ action: 'APPROVE', module: 'exams', entityType: 'year_result', entityId: String(cls._id), entityName: `${cls.name} ${year.name}`, summary: `Published the year-end result of ${cls.name} (${s.students} students: ${s.PASS} pass, ${s.COMPARTMENT} compartment, ${s.FAIL} need to improve)` }, req)
  return { published: true, students: s.students }
}

export async function unpublishYear(classId, auth, req) {
  const year = await yearOrCurrent()
  const { cls } = await classInScope(classId, null, year)
  const gone = await YearResult.findOneAndDelete({ academicYearId: year._id, classId: cls._id })
  if (!gone) throw conflict('The year result is not published.')
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'year_result', entityId: String(cls._id), entityName: `${cls.name} ${year.name}`, summary: `Unpublished the year-end result of ${cls.name}` }, req)
  return { published: false }
}

// ───────────────────────────────────────────────────────── one student: the year report card and the family app

/**
 * One student's year: subjects with the % per exam type, final, grade; overall; attendance for the year; the class
 * teacher's remark from the latest published exam. `publishedOnly` (family app): null unless the class is published.
 */
export async function yearCardData(studentId, auth, { publishedOnly = false } = {}) {
  if (!isOid(studentId)) throw notFound('Student')
  const student = await Student.findById(studentId).lean()
  if (!student?.sectionId) throw notFound('Student')
  const year = await yearOrCurrent()
  const section = await Section.findById(student.sectionId).lean()
  const cls = await ClassLevel.findById(section?.classId ?? student.classId).lean()
  if (!section || !cls) throw notFound('Student')
  if (auth) {
    const allowed = await sectionsInScope(auth, 'exams')
    if (allowed && !allowed.includes(String(section._id))) throw forbidden('That student is outside your classes.')
  }
  const stored = await YearResult.findOne({ academicYearId: year._id, classId: cls._id }).lean()
  if (publishedOnly && !stored) return null
  const r = stored ? await storedClass(stored, [section]) : await computeClass(year, cls, [section])
  const row = r.rows.find((x) => x.studentId === String(student._id))
  if (!row) return publishedOnly ? null : (() => { throw notFound('Student') })()
  const [bands, att, remarkRow] = await Promise.all([
    bandsForClass(cls),
    AttendanceSheet.aggregate([
      { $match: { sectionId: section._id, period: 0, date: { $gte: year.startDate, $lte: year.endDate } } },
      { $unwind: '$entries' }, { $match: { 'entries.studentId': student._id } },
      { $group: { _id: '$entries.status', n: { $sum: 1 } } },
    ]),
    ExamCandidate.findOne({ studentId: student._id, remark: { $nin: [null, ''] } }).sort({ updatedAt: -1 }).select('remark remarkBy').lean(),
  ])
  const counts = countMarks(att.flatMap((a) => Array(a.n).fill({ status: a._id })))
  return {
    year, student, cls, section, place: sectionLabel(cls, section), status: stored ? 'PUBLISHED' : 'OPEN', publishedAt: stored?.publishedAt ?? null,
    plan: stored?.plan ?? r.plan, rules: r.rules, row, bands, sectionSize: r.rows.length,
    attendance: { ...counts, pct: attendancePct(counts) }, remark: remarkRow?.remark ?? null, remarkBy: remarkRow?.remarkBy ?? null,
  }
}

/** The family app's year card (published classes only), already shaped for the screen. */
export async function familyYearResult(studentId) {
  const d = await yearCardData(studentId, null, { publishedOnly: true })
  if (!d) return null
  return {
    year: d.year.name, publishedAt: d.publishedAt, pct: d.row.pct, grade: d.row.grade, result: d.row.result, resultLabel: YEAR_RESULT[d.row.result]?.label,
    failed: d.row.failed, weights: d.plan.rows.filter((x) => x.exams.length).map((x) => ({ code: x.code, name: x.name, share: x.share })),
    subjects: d.row.subjects.map((x) => ({ subject: x.subject, pct: x.pct, grade: x.grade, pass: x.pass })),
    attendancePct: d.attendance.pct, remark: d.remark,
  }
}

/** For the print sample: a student of the latest published class, else any student in a section. */
export async function latestYearStudent() {
  const y = await YearResult.findOne().sort({ publishedAt: -1 }).select('students.studentId').lean()
  if (y?.students?.[0]) return y.students[0].studentId
  return (await Student.findOne({ status: 'ACTIVE', sectionId: { $ne: null } }).sort({ updatedAt: -1 }).select('_id').lean())?._id
}
