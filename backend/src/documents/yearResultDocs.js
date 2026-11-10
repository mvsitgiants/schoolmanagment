// The year-end report card (Exams › Year-end results): one student's year — every subject's % per exam type, the
// weighted final and grade, the overall result, the year's attendance and the class teacher's remark. `?id=` is the
// student. Data from services/yearResults.js yearCardData; a class not yet published prints with a PROVISIONAL stamp.
// The printed card also shows the co-scholastic / discipline grades of the year's published exams, the class the
// student is promoted to and the class teacher (yearCardExtras below).
import { YEAR_RESULT, gradeFor } from '@schoolgiant/shared'
import { ClassLevel, Subject } from '../models/academics.js'
import { Exam, ExamCandidate, ExamPaper, MarkSheet } from '../models/exams.js'
import { User } from '../models/tenant.js'
import { latestYearStudent, yearCardData } from '../services/yearResults.js'
import { bandRange, nextClassName, splitActivities } from './examPrint.js'

const nameOf = (s) => [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(' ')
const guardianOf = (s, rel) => s?.guardians?.find((g) => g.relation === rel)?.name ?? null

/** What the printed card adds to yearCardData: grade-only papers of the year's published exams, next class, class teacher. */
async function yearCardExtras(d) {
  const exams = await Exam.find({ academicYearId: d.year._id, classIds: d.cls._id, status: 'PUBLISHED' }).select('name startDate publishedAt').sort({ startDate: 1 }).lean()
  const sat = new Set((await ExamCandidate.find({ studentId: d.student._id, examId: { $in: exams.map((e) => e._id) } }).select('examId').lean()).map((c) => String(c.examId)))
  const mine = exams.filter((e) => sat.has(String(e._id)))
  const papers = mine.length ? await ExamPaper.find({ examId: { $in: mine.map((e) => e._id) }, classId: d.cls._id, gradeOnly: true }).lean() : []
  const sheets = papers.length ? await MarkSheet.find({ paperId: { $in: papers.map((p) => p._id) }, sectionId: d.section._id }).select('paperId entries').lean() : []
  const subjects = new Map((await Subject.find({ _id: { $in: papers.map((p) => p.subjectId) } }).select('name').lean()).map((s) => [String(s._id), s.name]))
  const gradeOf = new Map()
  for (const sh of sheets) {
    const x = sh.entries.find((e) => String(e.studentId) === String(d.student._id))
    if (x) gradeOf.set(String(sh.paperId), x.exempt ? null : x.grade ?? null)
  }
  // one row per grade-only subject, one grade per exam that had it
  const withGrades = mine.filter((e) => papers.some((p) => String(p.examId) === String(e._id)))
  const rows = [...new Set(papers.map((p) => String(p.subjectId)))].map((sid) => ({
    subject: subjects.get(sid) ?? '?',
    grades: withGrades.map((e) => { const p = papers.find((x) => String(x.examId) === String(e._id) && String(x.subjectId) === sid); return { grade: p ? gradeOf.get(String(p._id)) ?? null : null } }),
  }))
  const [classes, teacher] = await Promise.all([
    ClassLevel.find().select('name order').lean(),
    d.section.classTeacherId ? User.findById(d.section.classTeacherId).select('name').lean() : null,
  ])
  return { coExams: withGrades.map((e) => e.name), coRows: rows, nextClass: nextClassName(classes, d.cls), classTeacher: teacher?.name ?? null }
}

export function yearCardModel(d) {
  const cols = d.plan.rows.filter((r) => r.exams.length)
  const bands = d.bands ?? []
  const { coScholastic, discipline } = splitActivities(d.extras?.coRows ?? [])
  return {
    year: d.year.name, published: d.status === 'PUBLISHED', publishedAt: d.publishedAt,
    student: { name: nameOf(d.student), admissionNo: d.student.admissionNo, rollNo: d.student.rollNo ?? null, class: d.place, dob: d.student.dob ?? null, father: guardianOf(d.student, 'FATHER'), mother: guardianOf(d.student, 'MOTHER') },
    columns: cols.map((r) => ({ code: r.code, name: r.name, share: r.share, exams: r.exams.map((e) => e.name).join(', ') })),
    span: 4 + 2 * cols.length, // the Part 1 table's column count
    subjects: d.row.subjects.map((s) => ({
      subject: s.subject, pct: s.pct, grade: s.grade, below: s.pass === false,
      parts: cols.map((c) => { const pct = s.parts.find((p) => p.code === c.code)?.pct ?? null; return { pct, grade: pct === null ? null : gradeFor(bands, pct)?.grade ?? null } }),
    })),
    result: {
      pct: d.row.pct, grade: d.row.grade, rank: d.row.rank, of: d.sectionSize, status: d.row.result, label: YEAR_RESULT[d.row.result]?.label ?? '',
      pass: d.row.result === 'PASS', compartment: d.row.result === 'COMPARTMENT', failed: d.row.failed ?? [],
      promotedTo: d.row.result === 'PASS' ? d.extras?.nextClass ?? null : null, date: d.publishedAt ?? null,
    },
    rules: d.rules,
    attendance: { present: (d.attendance.P ?? 0) + (d.attendance.L ?? 0) + 0.5 * (d.attendance.HD ?? 0), working: d.attendance.total, pct: d.attendance.pct },
    remark: d.remark, remarkBy: d.remarkBy,
    bands: bands.map((b) => ({ grade: b.grade, min: b.min, max: b.max, remark: b.remark, range: bandRange(b) })),
    coExams: d.extras?.coExams ?? [], coScholastic, discipline, classTeacher: d.extras?.classTeacher ?? null,
  }
}

export const YEAR_RESULT_DOCS = {
  YEAR_REPORT_CARD: {
    perms: ['exams.year-results.view', 'exams.year-results.print'],
    load: async (id, auth) => { const d = await yearCardData(id, auth); return { ...d, extras: await yearCardExtras(d) } },
    model: yearCardModel,
    title: (m) => `Year report card · ${m.year} · ${m.student.name}`,
    sample: () => latestYearStudent(),
    variables: ['institution.name …', 'year · published · publishedAt', 'student.name, student.admissionNo, student.rollNo, student.class, student.dob, student.father, student.mother',
      'columns[] {code, name, share, exams} — the exam types that count, with their share of 100', 'subjects[] {subject, parts[] {pct, grade}, pct, grade, below}',
      'result.pct, result.grade, result.rank, result.of, result.label, result.pass, result.compartment, result.failed[], result.promotedTo, result.date · rules {passPct, compartmentMax, combine}',
      'attendance.present, attendance.working, attendance.pct · remark, remarkBy · bands[] {grade, min, max, remark, range} · classTeacher',
      'coExams[] (exam names) · coScholastic[] / discipline[] {subject, grades[] {grade}} — grade-only papers of the year'],
  },
}
