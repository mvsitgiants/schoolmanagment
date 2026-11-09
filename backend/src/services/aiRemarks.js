import { AI_REMARK_BATCH, pctChange } from '@schoolgiant/shared'
import { AcademicYear, Section } from '../models/academics.js'
import { Exam, ExamCandidate } from '../models/exams.js'
import { Student } from '../models/students.js'
import { can, moduleEnabled } from '../platform/access.js'
import { forbidden, notFound } from '../platform/errors.js'
import { isOid } from '../platform/db.js'
import { institutionNow } from '../platform/time.js'
import { AI_MODELS, callModel, jsonFormat, jsonOf } from './aiClient.js'
import { attendanceReport } from './attendance.js'
import { getExam, listCandidates, listExams, listResults, saveRemarks } from './exams.js'

// AI › Report card remarks. For an exam and a section, a compact set of facts per student (subject
// percentages and grades, overall %, optional rank, attendance %, change since the previous exam) goes to
// Claude Haiku in batches; it drafts a one- or two-sentence remark in the institution's tone. The class teacher
// reviews and edits them and saves (Exams' saveRemarks — the same remarks the report card prints). Only first
// names, gender (for pronouns) and the numbers are sent: no admission numbers, contacts or addresses.

const round1 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10)

/** Exams with results to remark on (scheduled or published) and, for one, the sections the caller may use. */
export async function remarksSetup({ examId }, auth) {
  if (!moduleEnabled(auth, 'exams')) return { exams: [], examId: null, sections: [], examsOff: true }
  const { exams } = await listExams({}, auth)
  const usable = exams.filter((e) => e.status !== 'DRAFT').map((e) => ({ id: e.id, name: e.name, status: e.status, startDate: e.startDate ?? null, classes: e.classes }))
  const exam = usable.find((e) => e.id === examId) ?? usable.filter((e) => e.status === 'SCHEDULED').at(-1) ?? usable.at(-1)
  const sections = exam ? (await getExam(exam.id, auth)).sections : []
  return { exams: usable, examId: exam?.id ?? null, sections }
}

/** Attendance % per student from the start of the year to the end of the exam (when the caller may see attendance). */
async function attendanceOf(exam, sectionId, auth) {
  if (!moduleEnabled(auth, 'attendance') || !(can(auth, 'attendance.reports.view') || can(auth, 'attendance.register.view'))) return new Map()
  try {
    const year = await AcademicYear.findById(exam.academicYearId).select('startDate').lean()
    const today = (await institutionNow()).date
    const to = exam.endDate && exam.endDate < today ? exam.endDate : today
    if (!year?.startDate || year.startDate > to) return new Map()
    const rep = await attendanceReport({ from: year.startDate, to, sectionId }, auth)
    return new Map((rep.students ?? []).map((s) => [s.id, s.pct]))
  } catch {
    return new Map()
  }
}

/** Each student's overall % in the class's previous exam this year (before this one). */
async function previousExam(exam, classId, studentIds) {
  if (!exam.startDate) return { name: null, pct: new Map() }
  const prev = await Exam.findOne({ academicYearId: exam.academicYearId, classIds: classId, _id: { $ne: exam._id }, status: { $ne: 'DRAFT' }, startDate: { $lt: exam.startDate } })
    .sort({ startDate: -1 }).select('name').lean()
  if (!prev) return { name: null, pct: new Map() }
  const rows = await ExamCandidate.find({ examId: prev._id, studentId: { $in: studentIds } }).select('studentId pct').lean()
  return { name: prev.name, pct: new Map(rows.filter((r) => r.pct !== null && r.pct !== undefined).map((r) => [String(r.studentId), r.pct])) }
}

/** The section's students with the facts a remark is drafted from, and their saved remarks. */
export async function remarkStudents({ examId, sectionId }, auth) {
  if (!isOid(examId)) throw notFound('Exam')
  const [results, candidates, exam, section] = await Promise.all([
    listResults(examId, sectionId, auth),
    listCandidates(examId, sectionId, auth),
    Exam.findById(examId).lean(),
    Section.findById(sectionId).select('classId').lean(),
  ])
  if (!exam || !section) throw notFound('Exam')
  const studentIds = results.rows.map((r) => r.studentId)
  const [students, attendance, prev] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('firstName gender').lean(),
    attendanceOf(exam, sectionId, auth),
    previousExam(exam, section.classId, studentIds),
  ])
  const st = new Map(students.map((s) => [String(s._id), s]))
  const saved = new Map(candidates.map((c) => [c.id, c]))
  const rows = results.rows.map((r) => {
    const s = st.get(r.studentId)
    return {
      candidateId: r.candidateId, studentId: r.studentId, name: r.name, firstName: s?.firstName ?? r.name.split(' ')[0], gender: s?.gender ?? null,
      rollNo: r.rollNo, admissionNo: r.admissionNo ?? null,
      pct: round1(r.pct), grade: r.grade ?? null, rank: r.rank ?? null, result: r.result,
      attendancePct: round1(attendance.get(r.studentId) ?? null),
      previousPct: round1(prev.pct.get(r.studentId) ?? null), change: pctChange(prev.pct.get(r.studentId), r.pct),
      subjects: results.papers.map((p) => {
        const m = r.marks[p.id]
        if (!m) return null
        const pct = !p.gradeOnly && m.marks !== null && m.marks !== undefined && p.maxMarks ? round1((m.marks / p.maxMarks) * 100) : null
        return { subject: p.subject, pct, grade: m.grade ?? null, absent: !!m.absent, exempt: !!m.exempt }
      }).filter(Boolean),
      remark: saved.get(r.candidateId)?.remark ?? '', remarkBy: saved.get(r.candidateId)?.remarkBy ?? null,
    }
  })
  return {
    exam: results.exam, section: results.section, previousExam: prev.name,
    rows,
    summary: { students: rows.length, withRemark: rows.filter((r) => r.remark).length, average: results.summary.average, passed: results.summary.passed, failed: results.summary.failed },
  }
}

const SYSTEM = `You write report card remarks for students of an Indian school, as their class teacher would. Parents read them.

For each student you get facts: first name, gender (for pronouns; when missing, use the name and avoid pronouns), overall percentage and grade, the result (PASS, FAIL or INCOMPLETE), optionally the rank, attendance percentage, the change in overall percentage since the previous exam, and each subject's percentage or grade (absent / exempt marked).

Rules:
- Use only these facts. Do not invent behaviour, hobbies, events or anything not in the facts.
- Name one real strength (a strong subject, a clear improvement, good attendance) and one specific, actionable area to work on (a weaker subject, attendance, being absent for a paper).
- Be honest but kind and encouraging, never harsh or sarcastic. Never compare with classmates or mention other students. Mention the rank only if it is given and is in the top three.
- Attendance below 75%: gently ask for regular attendance. A FAIL result: supportive, with a concrete next step. INCOMPLETE: keep it general.
- Do not quote raw marks; percentages only if they help. No emojis, no exclamation-mark chains, no headings.
- Address the student in the third person by first name ("Aarav has …").
- Follow the tone and length asked for. Every remark under 300 characters.`

const REMARKS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['remarks'],
  properties: {
    remarks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'remark'], properties: { ref: { type: 'string' }, remark: { type: 'string' } } } },
  },
}

const TONE = { WARM: 'warm, personal and encouraging, as a caring class teacher writes to a family', FORMAL: 'formal, measured and professional' }
const LENGTH = { SHORT: 'one sentence, at most 25 words', MEDIUM: 'two sentences, at most 50 words' }

/** Run `fn` over items, at most `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

/** Draft remarks (all the section, or `candidateIds`). Nothing is saved. */
export async function draftRemarks({ examId, sectionId, tone = 'WARM', length = 'SHORT', includeRank = false, note, candidateIds }, auth) {
  const { rows } = await remarkStudents({ examId, sectionId }, auth)
  const wanted = candidateIds?.length ? rows.filter((r) => candidateIds.includes(r.candidateId)) : rows
  if (!wanted.length) return { drafts: [] }
  const facts = wanted.map((r, i) => ({
    ref: `S${i + 1}`, candidateId: r.candidateId,
    fact: {
      ref: `S${i + 1}`, firstName: r.firstName, gender: r.gender ?? undefined, result: r.result, overallPct: r.pct, grade: r.grade ?? undefined,
      rank: includeRank && r.rank ? r.rank : undefined, attendancePct: r.attendancePct ?? undefined, changeSincePreviousExam: r.change ?? undefined,
      subjects: r.subjects.map((s) => ({ subject: s.subject, pct: s.pct ?? undefined, grade: s.grade ?? undefined, absent: s.absent || undefined, exempt: s.exempt || undefined })),
    },
  }))
  const batches = []
  for (let i = 0; i < facts.length; i += AI_REMARK_BATCH) batches.push(facts.slice(i, i + AI_REMARK_BATCH))
  const answers = await pool(batches, 3, async (batch) => {
    const msg = await callModel('REMARKS', {
      model: AI_MODELS.bulk,
      max_tokens: 8000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: jsonFormat(REMARKS_SCHEMA) },
      messages: [{
        role: 'user',
        content: `Tone: ${TONE[tone] ?? TONE.WARM}.\nLength: ${LENGTH[length] ?? LENGTH.SHORT}.${note ? `\nThe teacher also asks: ${note}` : ''}\n\nWrite one remark per student; return each with its ref.\n\n${JSON.stringify(batch.map((b) => b.fact))}`,
      }],
    }, auth)
    return jsonOf(msg).remarks ?? []
  })
  const byRef = new Map(answers.flat().map((a) => [a.ref, String(a.remark ?? '').trim().replace(/\s+/g, ' ').slice(0, 300)]))
  return { drafts: facts.map((f) => ({ candidateId: f.candidateId, remark: byRef.get(f.ref) ?? '' })).filter((d) => d.remark) }
}

/** Save the class teacher's remarks (Exams' own save: the report card prints them). */
export async function saveAllRemarks({ examId, sectionId, remarks }, auth, req) {
  if (!can(auth, 'exams.marks.create') && !can(auth, 'exams.report-cards.publish')) throw forbidden('Your role can’t write report card remarks.')
  return saveRemarks(examId, sectionId, remarks, auth, req)
}
