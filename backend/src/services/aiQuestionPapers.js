import { AI_MAX_QUESTIONS, BLOOM_LEVELS, DIFFICULTY, QUESTION_TYPES, checkQuestion, splitByMix } from '@schoolgiant/shared'
import { ClassLevel, Subject } from '../models/academics.js'
import { Exam, ExamPaper } from '../models/exams.js'
import { Syllabus } from '../models/homework.js'
import { Question } from '../models/lms.js'
import { QuestionPaper } from '../models/questionPapers.js'
import { can, moduleEnabled } from '../platform/access.js'
import { AppError, badRequest, forbidden, notFound } from '../platform/errors.js'
import { isOid } from '../platform/db.js'
import { AI_MODELS, callModel, jsonFormat, jsonOf } from './aiClient.js'
import { saveQuestion } from './lms.js'
import { addFromBank, board, getPaper } from './questionPapers.js'

// AI › Question paper generator. Pick an exam paper (exam → class → subject), chapters, how many questions of
// each type, the marks and the difficulty mix; Claude drafts the questions with answers (structured output).
// Nothing is saved until the teacher accepts drafts: accepted questions go to the LMS question bank tagged `ai`
// (so Exams › Question papers can auto-pick them), and optionally into the exam paper's draft question paper.

const TYPES = Object.keys(QUESTION_TYPES)
const LEVELS = Object.keys(DIFFICULTY)

// ───────────────────────────────────────────────────────── picking the paper

/** The year's exams and, for one exam, its papers the caller may set (Exams › Question papers' board). */
export async function setup({ examId }, auth) {
  if (!moduleEnabled(auth, 'exams')) return { exams: [], exam: null, rows: [], examsOff: true }
  const b = await board({ examId }, auth)
  return {
    exams: b.exams, exam: b.exam,
    rows: b.rows.map((r) => ({
      examPaperId: r.examPaperId, classId: r.classId, className: r.className, classCode: r.classCode, subjectId: r.subjectId, subject: r.subject,
      maxMarks: r.maxMarks, date: r.date, status: r.status, paperId: r.paper?.id ?? null,
    })),
  }
}

/** One exam paper in the caller's scope, with names. */
async function examPaperFor(examPaperId, auth) {
  const ep = isOid(examPaperId) ? await ExamPaper.findById(examPaperId).lean() : null
  if (!ep || ep.gradeOnly) throw notFound('Exam paper')
  const b = await board({ examId: String(ep.examId) }, auth)
  if (!b.rows.some((r) => r.examPaperId === String(ep._id))) throw notFound('Exam paper')
  const [exam, cls, subject] = await Promise.all([
    Exam.findById(ep.examId).select('name academicYearId').lean(),
    ClassLevel.findById(ep.classId).select('name code').lean(),
    Subject.findById(ep.subjectId).select('name code').lean(),
  ])
  return { ep, exam, cls, subject }
}

/** Chapters to choose from (the syllabus units, then the bank's chapters) and the paper's blueprint, if started. */
export async function paperContext(examPaperId, auth) {
  const { ep, exam, cls, subject } = await examPaperFor(examPaperId, auth)
  const [syllabus, bankChapters, qp, bankCount] = await Promise.all([
    Syllabus.findOne({ academicYearId: exam?.academicYearId, classId: ep.classId, subjectId: ep.subjectId }).select('units.name').lean(),
    Question.distinct('chapter', { subjectId: ep.subjectId, active: { $ne: false }, $or: [{ classId: ep.classId }, { classId: null }] }),
    QuestionPaper.findOne({ examPaperId: ep._id }).select('status sections').lean(),
    Question.countDocuments({ subjectId: ep.subjectId, active: { $ne: false }, $or: [{ classId: ep.classId }, { classId: null }] }),
  ])
  const chapters = [...new Set([...(syllabus?.units ?? []).map((u) => u.name), ...bankChapters.filter(Boolean).sort()].map((c) => String(c).trim()).filter(Boolean))]
  return {
    examPaperId: String(ep._id), examName: exam?.name ?? '', className: cls?.name ?? '', subject: subject?.name ?? '', maxMarks: ep.maxMarks ?? null,
    chapters, bankCount,
    paper: qp ? { id: String(qp._id), status: qp.status, sections: qp.sections.map((s) => ({ id: String(s._id), title: s.title, type: s.type, count: s.count, marks: s.marks })) } : null,
  }
}

// ───────────────────────────────────────────────────────── drafting

const SYSTEM = `You are an experienced Indian school teacher and paper setter. You write exam questions for a class and subject, following the syllabus level of that class (CBSE / NCERT style unless the teacher's notes say otherwise).

Rules for every question:
- Self-contained, unambiguous, answerable in an exam hall without pictures or diagrams. Clear, simple language suitable for the class.
- Only from the chapters given (set "chapter" to the one it comes from, spelled exactly as given). If no chapters are given, use the usual syllabus of the class and name the chapter.
- Match the requested type, difficulty and Bloom level. Do not repeat a question or test the same fact twice.
- MCQ: exactly 4 options, exactly one correct. MULTI: 4 or 5 options, at least two correct; say "(choose all that apply)" in the question.
- TRUE_FALSE: options exactly [{"text":"True"},{"text":"False"}] with the right one marked correct; the statement must be clearly true or clearly false.
- FILL: the question has one blank written as "_____"; "answers" lists the accepted answers (variants, spellings). No options.
- SHORT and LONG: no options; "answers" holds one model answer of the length the marks deserve; "explanation" is the marking scheme (value points with marks).
- MCQ / MULTI / TRUE_FALSE / FILL: "explanation" says briefly why the answer is right. "answers" is empty for MCQ, MULTI and TRUE_FALSE.
- Never include the answer in the question text. No personal names of real living people except well-known public figures in the syllabus.`

const OPTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'correct'], properties: { text: { type: 'string' }, correct: { type: 'boolean' } } }
const QUESTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'text', 'options', 'answers', 'explanation', 'chapter', 'difficulty', 'bloom'],
        properties: {
          type: { type: 'string', enum: TYPES },
          text: { type: 'string' },
          options: { type: 'array', items: OPTION_SCHEMA },
          answers: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
          chapter: { type: 'string' },
          difficulty: { type: 'string', enum: LEVELS },
          bloom: { type: 'string', enum: BLOOM_LEVELS },
        },
      },
    },
  },
}

/** What to ask for: one line per type with its count, marks and difficulty split. */
function specOf({ rows, mix, blooms }) {
  return rows.map((r) => {
    const split = splitByMix(r.count, mix)
    return { type: r.type, typeLabel: QUESTION_TYPES[r.type].label, count: r.count, marksEach: r.marks, difficulty: split, bloomLevels: blooms?.length ? blooms : undefined }
  })
}

/** A draft as the review screen shows it: the shape of a bank question, plus any problems to fix. */
function tidyDraft(q, i, marksOf) {
  const type = TYPES.includes(q.type) ? q.type : 'SHORT'
  const t = QUESTION_TYPES[type]
  let options = t.options ? (q.options ?? []).map((o) => ({ text: String(o.text ?? '').trim().slice(0, 1000), correct: !!o.correct })).filter((o) => o.text).slice(0, 8) : []
  if (type === 'TRUE_FALSE') {
    const trueRight = !!(q.options ?? []).find((o) => /^true$/i.test(String(o.text).trim()))?.correct
    options = [{ text: 'True', correct: trueRight }, { text: 'False', correct: !trueRight }]
  }
  const answers = ['FILL', 'SHORT', 'LONG'].includes(type) ? (q.answers ?? []).map((a) => String(a).trim().slice(0, 2000)).filter(Boolean).slice(0, 10) : []
  const out = {
    id: `d${i + 1}`, type, text: String(q.text ?? '').trim().slice(0, 5000), options, answers,
    explanation: String(q.explanation ?? '').trim().slice(0, 3000), chapter: String(q.chapter ?? '').trim().slice(0, 120),
    difficulty: LEVELS.includes(q.difficulty) ? q.difficulty : 'MEDIUM', bloom: BLOOM_LEVELS.includes(q.bloom) ? q.bloom : '',
    marks: marksOf[type] ?? 1,
  }
  out.problems = checkQuestion({ ...out, answers: answers.length ? answers : undefined })
  return out
}

/** Ask Claude for the questions. Returns drafts — nothing is saved. */
export async function generate(input, auth) {
  const total = input.rows.reduce((n, r) => n + r.count, 0)
  if (!total) throw badRequest('Ask for at least one question.')
  if (total > AI_MAX_QUESTIONS) throw badRequest(`At most ${AI_MAX_QUESTIONS} questions at a time.`)
  const { exam, cls, subject, ep } = await examPaperFor(input.examPaperId, auth)
  const request = {
    exam: exam?.name, class: cls?.name, subject: subject?.name, paperMaxMarks: ep.maxMarks,
    chapters: input.chapters?.length ? input.chapters : undefined,
    topicsAndNotes: input.topics || undefined,
    questions: specOf(input),
    totalQuestions: total,
  }
  const msg = await callModel('QUESTION_PAPERS', {
    model: AI_MODELS.main,
    max_tokens: 32000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: jsonFormat(QUESTIONS_SCHEMA) },
    messages: [{ role: 'user', content: `Write these questions. Return exactly ${total} questions in the order asked.\n\n${JSON.stringify(request, null, 2)}` }],
  }, auth)
  const marksOf = Object.fromEntries([...input.rows].reverse().map((r) => [r.type, r.marks]))
  const wanted = new Set(input.rows.map((r) => r.type))
  const drafts = (jsonOf(msg).questions ?? []).filter((q) => wanted.has(q.type)).slice(0, total).map((q, i) => tidyDraft(q, i, marksOf))
  if (!drafts.length) throw new AppError(502, 'The AI did not return any questions. Try again.', { code: 'AI_ERROR' })
  return { examPaperId: String(ep._id), className: cls?.name ?? '', subject: subject?.name ?? '', drafts }
}

// ───────────────────────────────────────────────────────── accepting

const mayBank = (auth) => (moduleEnabled(auth, 'lms') ? can(auth, 'lms.question-bank.create') : (can(auth, 'exams.question-papers.create') || can(auth, 'exams.question-papers.edit')))

/**
 * Save accepted drafts to the question bank (tagged `ai`, at the paper's class and subject) and, with `sendToPaper`,
 * add them to the exam paper's draft question paper: each into the first section of its type with room.
 */
export async function accept({ examPaperId, questions, sendToPaper }, auth, req) {
  if (!mayBank(auth)) throw forbidden('Your role can’t add questions to the question bank.')
  const { ep } = await examPaperFor(examPaperId, auth)
  const bodies = questions.map((q) => ({
    subjectId: String(ep.subjectId), classId: String(ep.classId), chapter: q.chapter || undefined, type: q.type, text: q.text,
    options: q.options ?? [], answers: q.answers?.length ? q.answers : undefined, explanation: q.explanation || undefined,
    marks: q.marks, negative: 0, difficulty: q.difficulty, bloom: q.bloom || undefined,
    tags: [...new Set(['ai', ...(q.tags ?? [])])].slice(0, 10), active: true,
  }))
  const fields = {}
  bodies.forEach((b, i) => {
    const errors = checkQuestion(b)
    for (const [k, v] of Object.entries(errors)) fields[`questions.${i}.${k}`] = v
  })
  if (Object.keys(fields).length) throw badRequest(`Question ${Number(Object.keys(fields)[0].split('.')[1]) + 1}: ${Object.values(fields)[0]}`, { fields })
  const saved = []
  for (const b of bodies) saved.push(await saveQuestion(null, b, auth, req))
  const out = { saved: saved.length, questionIds: saved.map((q) => String(q.id ?? q._id)), paper: null }
  if (sendToPaper) out.paper = await sendToDraftPaper(ep, saved, auth, req)
  return out
}

/** Put saved bank questions into the exam paper's draft question paper (set A), by type, where there is room. */
async function sendToDraftPaper(ep, saved, auth, req) {
  const qp = await QuestionPaper.findOne({ examPaperId: ep._id }).select('_id status').lean()
  if (!qp) return { added: 0, skipped: saved.length, reason: 'NO_PAPER' }
  if (qp.status !== 'DRAFT') return { id: String(qp._id), added: 0, skipped: saved.length, reason: 'NOT_DRAFT' }
  let paper
  try {
    paper = await getPaper(String(qp._id), auth)
  } catch {
    return { id: String(qp._id), added: 0, skipped: saved.length, reason: 'NOT_ALLOWED' }
  }
  const setA = paper.sets.find((s) => s.letter === 'A') ?? paper.sets[0]
  const room = new Map(paper.sections.map((s) => [s.id, s.count - (setA.sections.find((x) => x.sectionId === s.id)?.items.length ?? 0)]))
  let added = 0
  let reason = null
  for (const type of TYPES) {
    let ids = saved.filter((q) => q.type === type).map((q) => String(q.id ?? q._id))
    for (const s of paper.sections.filter((x) => x.type === type)) {
      const n = Math.min(ids.length, room.get(s.id) ?? 0)
      if (!n) continue
      try {
        await addFromBank(String(qp._id), setA.id, { sectionId: s.id, questionIds: ids.slice(0, n) }, auth, req)
        added += n
        ids = ids.slice(n)
      } catch (err) {
        reason = err?.status === 403 || err?.status === 404 ? 'NOT_ALLOWED' : 'CONFLICT'
        break
      }
    }
  }
  return { id: String(qp._id), added, skipped: saved.length - added, reason: added < saved.length ? (reason ?? 'NO_ROOM') : null }
}
