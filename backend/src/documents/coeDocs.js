// Exam controller documents (Exam controller › Grade cards & transcripts): a student's semester grade card (`id`: the
// semester result) and the consolidated transcript (`id`: the student's program enrolment). Data from
// services/coeResults.js. Both print PROVISIONAL until the results are published / the program is complete.
import { examMonthLabel, latestExternalSheetId, scriptLabelsData } from '../services/coe.js'
import { gradeCardData, latestSemesterResultId, latestTranscriptId, transcriptData } from '../services/coeResults.js'

const num = (v) => (v === null || v === undefined ? null : Number(v))
const round2 = (n) => Math.round(n * 100) / 100
/** Credit points of a course: credits × grade point (0 for a fail). */
const creditPoints = (c) => (c.credits === null || c.credits === undefined ? null : round2(Number(c.credits) * (c.pass === false ? 0 : Number(c.points ?? 0))))
const sum = (list, fn) => round2(list.reduce((n, x) => n + (Number(fn(x)) || 0), 0))
/** The grading scale as the card's legend prints it: grade, its meaning, grade point and marks range ("80–89"). */
const scaleRows = (scale) => scale.map((b) => ({
  grade: b.grade, min: b.min, max: b.max, points: b.points, label: b.label ?? null,
  range: Number(b.min) === 0 ? `< ${scale.filter((x) => Number(x.min) > 0).reduce((m, x) => Math.min(m, Number(x.min)), 100)}` : `${b.min}–${Number(b.max) % 1 > 0.9 ? Math.floor(Number(b.max)) : b.max}`,
}))

function gradeCardModel({ detail: d, session, program, year, department, regulation, regulationCode, student }) {
  return {
    session: { name: session.name, month: examMonthLabel(session.examMonth), year: year?.name ?? null, published: session.status === 'PUBLISHED', supplementary: session.kind === 'SUPPLEMENTARY', publishedAt: session.publishedAt ?? null },
    program: { name: program.name, code: program.code, department: department?.name ?? null, regulation: regulationCode },
    student: { name: d.name, registerNo: d.registerNo, admissionNo: d.admissionNo, dob: d.dob, batch: d.batch, semester: d.semester, language: student?.language },
    courses: d.courses.map((c) => ({ code: c.code, title: c.title, credits: c.credits, internal: num(c.internal), external: num(c.external), total: num(c.total), max: c.max, grade: c.grade, points: c.points, pass: c.pass, attempt: c.attempt, result: c.pass ? 'P' : 'RA', revalued: c.revalued, creditPoints: creditPoints(c) })),
    totals: { credits: sum(d.courses, (c) => c.credits), creditPoints: sum(d.courses, creditPoints) },
    result: {
      sgpa: d.sgpa, cgpa: d.cgpa, creditsRegistered: d.creditsRegistered, creditsEarned: d.creditsEarned, cumulativeCredits: d.cumulativeCredits,
      arrears: d.arrears, pass: d.result === 'PASS',
    },
    scale: scaleRows(regulation.gradeScale),
  }
}

function transcriptModel(d) {
  return {
    program: { name: d.program.name, code: d.program.code, level: d.program.level, department: d.department?.name ?? null, regulation: d.regulationCode, years: d.program.durationYears },
    student: { ...d.student, batch: d.enrolment.batch },
    semesters: d.semesters.map((x) => ({ ...x, courses: x.courses.map((c) => ({ ...c, creditPoints: creditPoints(c) })), creditPoints: sum(x.courses, creditPoints) })),
    result: { cgpa: d.cgpa, pct: d.pct, earned: d.earned, required: d.regulation.minCredits, arrears: d.arrears, classification: d.classification, complete: d.complete, multiplier: d.regulation.gpa.pctMultiplier },
    scale: scaleRows(d.regulation.gradeScale),
  }
}

export const COE_DOCS = {
  GRADE_CARD: {
    perms: ['coe.grade-cards.view', 'coe.grade-cards.print'],
    load: (id, auth) => gradeCardData(id, auth),
    model: gradeCardModel,
    title: (m) => `Grade card · ${m.session.name} · ${m.student.name}`,
    sample: () => latestSemesterResultId(),
    variables: [
      'institution.name …',
      'session.name, session.month, session.year, session.published, session.supplementary, session.publishedAt',
      'program.name, program.code, program.department, program.regulation',
      'student.name, student.registerNo, student.admissionNo, student.dob, student.batch, student.semester',
      'courses[] {code, title, credits, internal, external, total, max, grade, points, creditPoints, pass, attempt, result (P / RA), revalued} · totals.credits, totals.creditPoints',
      'result.sgpa, result.cgpa, result.creditsRegistered, result.creditsEarned, result.cumulativeCredits, result.arrears, result.pass',
      'scale[] {grade, label, min, max, range, points}',
    ],
  },
  TRANSCRIPT: {
    perms: ['coe.grade-cards.view', 'coe.grade-cards.print'],
    load: (id, auth) => transcriptData(id, auth),
    model: transcriptModel,
    title: (m) => `Transcript · ${m.student.name}`,
    sample: () => latestTranscriptId(),
    variables: [
      'institution.name …',
      'program.name, program.code, program.level, program.department, program.regulation, program.years',
      'student.name, student.registerNo, student.admissionNo, student.dob, student.batch',
      'semesters[] {semester, sgpa, credits, earned, creditPoints, courses[] {code, title, credits, grade, points, creditPoints, pass, attempt, session}}',
      'result.cgpa, result.pct, result.multiplier, result.earned, result.required, result.arrears, result.classification, result.complete',
      'scale[] {grade, label, min, max, range, points}',
    ],
  },
  // answer-script stickers: the dummy number as a barcode, for anonymous marking (GET /documents/SCRIPT_LABEL/<sheetId>)
  SCRIPT_LABEL: {
    perms: ['coe.marks.view'],
    load: (id, auth) => scriptLabelsData(id, auth),
    model: (d) => ({ ...d, count: d.labels.length }),
    title: (m) => `Script labels · ${m.course.code} · ${m.session.name}`,
    sample: () => latestExternalSheetId(),
    variables: ['institution.name', 'session.name, session.month', 'course.code, course.title', 'labels[] {dummyNo} · count · {{barcode dummyNo 10}}'],
  },
}
