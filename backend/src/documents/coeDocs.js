// Exam controller documents (Exam controller › Grade cards & transcripts): a student's semester grade card (`id`: the
// semester result) and the consolidated transcript (`id`: the student's program enrolment). Data from
// services/coeResults.js. Both print PROVISIONAL until the results are published / the program is complete.
import { examMonthLabel } from '../services/coe.js'
import { gradeCardData, latestSemesterResultId, latestTranscriptId, transcriptData } from '../services/coeResults.js'

const num = (v) => (v === null || v === undefined ? null : Number(v))

function gradeCardModel({ detail: d, session, program, year, department, regulation, regulationCode, student }) {
  return {
    session: { name: session.name, month: examMonthLabel(session.examMonth), year: year?.name ?? null, published: session.status === 'PUBLISHED', supplementary: session.kind === 'SUPPLEMENTARY' },
    program: { name: program.name, code: program.code, department: department?.name ?? null, regulation: regulationCode },
    student: { name: d.name, registerNo: d.registerNo, admissionNo: d.admissionNo, dob: d.dob, batch: d.batch, semester: d.semester, language: student?.language },
    courses: d.courses.map((c) => ({ code: c.code, title: c.title, credits: c.credits, internal: num(c.internal), external: num(c.external), total: num(c.total), max: c.max, grade: c.grade, points: c.points, pass: c.pass, attempt: c.attempt, result: c.pass ? 'P' : 'RA', revalued: c.revalued })),
    result: {
      sgpa: d.sgpa, cgpa: d.cgpa, creditsRegistered: d.creditsRegistered, creditsEarned: d.creditsEarned, cumulativeCredits: d.cumulativeCredits,
      arrears: d.arrears, pass: d.result === 'PASS',
    },
    scale: regulation.gradeScale.map((b) => ({ grade: b.grade, min: b.min, max: b.max, points: b.points })),
  }
}

function transcriptModel(d) {
  return {
    program: { name: d.program.name, code: d.program.code, level: d.program.level, department: d.department?.name ?? null, regulation: d.regulationCode, years: d.program.durationYears },
    student: { ...d.student, batch: d.enrolment.batch },
    semesters: d.semesters,
    result: { cgpa: d.cgpa, pct: d.pct, earned: d.earned, required: d.regulation.minCredits, arrears: d.arrears, classification: d.classification, complete: d.complete, multiplier: d.regulation.gpa.pctMultiplier },
    scale: d.regulation.gradeScale.map((b) => ({ grade: b.grade, min: b.min, max: b.max, points: b.points })),
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
      'session.name, session.month, session.year, session.published, session.supplementary',
      'program.name, program.code, program.department, program.regulation',
      'student.name, student.registerNo, student.admissionNo, student.dob, student.batch, student.semester',
      'courses[] {code, title, credits, internal, external, total, max, grade, points, pass, attempt, result (P / RA), revalued}',
      'result.sgpa, result.cgpa, result.creditsRegistered, result.creditsEarned, result.cumulativeCredits, result.arrears, result.pass',
      'scale[] {grade, min, max, points}',
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
      'semesters[] {semester, sgpa, credits, earned, courses[] {code, title, credits, grade, points, pass, attempt, session}}',
      'result.cgpa, result.pct, result.multiplier, result.earned, result.required, result.arrears, result.classification, result.complete',
      'scale[] {grade, min, max, points}',
    ],
  },
}
