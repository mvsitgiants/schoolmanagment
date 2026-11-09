// The year-end report card (Exams › Year-end results): one student's year — every subject's % per exam type, the
// weighted final and grade, the overall result, the year's attendance and the class teacher's remark. `?id=` is the
// student. Data from services/yearResults.js yearCardData; a class not yet published prints with a PROVISIONAL stamp.
import { YEAR_RESULT } from '@schoolgiant/shared'
import { latestYearStudent, yearCardData } from '../services/yearResults.js'

const nameOf = (s) => [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(' ')
const guardianOf = (s, rel) => s?.guardians?.find((g) => g.relation === rel)?.name ?? null

export function yearCardModel(d) {
  const cols = d.plan.rows.filter((r) => r.exams.length)
  return {
    year: d.year.name, published: d.status === 'PUBLISHED', publishedAt: d.publishedAt,
    student: { name: nameOf(d.student), admissionNo: d.student.admissionNo, rollNo: d.student.rollNo ?? null, class: d.place, dob: d.student.dob ?? null, father: guardianOf(d.student, 'FATHER'), mother: guardianOf(d.student, 'MOTHER') },
    columns: cols.map((r) => ({ code: r.code, name: r.name, share: r.share, exams: r.exams.map((e) => e.name).join(', ') })),
    subjects: d.row.subjects.map((s) => ({
      subject: s.subject, pct: s.pct, grade: s.grade, below: s.pass === false,
      parts: cols.map((c) => ({ pct: s.parts.find((p) => p.code === c.code)?.pct ?? null })),
    })),
    result: {
      pct: d.row.pct, grade: d.row.grade, rank: d.row.rank, of: d.sectionSize, status: d.row.result, label: YEAR_RESULT[d.row.result]?.label ?? '',
      pass: d.row.result === 'PASS', compartment: d.row.result === 'COMPARTMENT', failed: d.row.failed ?? [],
    },
    rules: d.rules,
    attendance: { present: (d.attendance.P ?? 0) + (d.attendance.L ?? 0) + 0.5 * (d.attendance.HD ?? 0), working: d.attendance.total, pct: d.attendance.pct },
    remark: d.remark, remarkBy: d.remarkBy,
    bands: (d.bands ?? []).map((b) => ({ grade: b.grade, min: b.min, max: b.max })),
  }
}

export const YEAR_RESULT_DOCS = {
  YEAR_REPORT_CARD: {
    perms: ['exams.year-results.view', 'exams.year-results.print'],
    load: (id, auth) => yearCardData(id, auth),
    model: yearCardModel,
    title: (m) => `Year report card · ${m.year} · ${m.student.name}`,
    sample: () => latestYearStudent(),
    variables: ['institution.name …', 'year · published · publishedAt', 'student.name, student.admissionNo, student.rollNo, student.class, student.dob, student.father, student.mother',
      'columns[] {code, name, share, exams} — the exam types that count, with their share of 100', 'subjects[] {subject, parts[] {pct}, pct, grade, below}',
      'result.pct, result.grade, result.rank, result.of, result.label, result.pass, result.compartment, result.failed[] · rules {passPct, compartmentMax, combine}',
      'attendance.present, attendance.working, attendance.pct · remark, remarkBy · bands[] {grade, min, max}'],
  },
}
