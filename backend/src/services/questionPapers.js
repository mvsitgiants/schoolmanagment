import {
  QP_SET_LETTERS, QP_STATUS, QUESTION_TYPES, autoPick, blueprintTotals, checkBlueprint, checkQuestion, setProgress, shuffleSet, starterBlueprint,
  suggestQuestion,
} from '@schoolgiant/shared'
import mongoose from 'mongoose'
import { AcademicYear, ClassLevel, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { Exam, ExamPaper } from '../models/exams.js'
import { Question } from '../models/lms.js'
import { QuestionPaper } from '../models/questionPapers.js'
import { can, moduleEnabled, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'
import { yearOrCurrent } from './academics.js'

// Question papers (Exams › Question papers). One per exam paper (exam + class + subject, not grade-only papers).
// The setter (whoever starts it) lays out the blueprint and fills set A — auto-picked from the LMS question bank,
// picked by hand or written there — and makes more sets: the same questions shuffled (derived from set A, so they
// follow every edit) or different questions per set. Only a DRAFT can be changed. The setter submits it; someone
// with `exams.question-papers.approve` approves it (then it is locked) or sends it back with a note; unlocking an
// approved paper needs the same permission and a reason. Who sees which papers follows the role's data scope for
// `exams`: campus / everyone → all; my classes → the papers of the classes and subjects they teach and the ones they
// set; own → the ones they set (and, to start one, the subjects they teach). Printing is the print permission only,
// and every print is in the audit log — a paper is confidential until the exam.

const MODULE = 'exams'
const ENTITY = 'question_paper'
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const idStr = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const wide = (auth) => ['ALL', 'BRANCH'].includes(scopeOf(auth, MODULE))
const minutesBetween = (a, b) => {
  if (!a || !b) return undefined
  const m = (s) => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm }
  const d = m(b) - m(a)
  return d > 0 ? d : undefined
}
const DEFAULT_INSTRUCTIONS = [
  'All questions are compulsory unless a choice is given.',
  'Marks for each question are shown against it.',
  'Write the question number clearly. Write neatly.',
].join('\n')

// ───────────────────────────────────────────────────────── scope

/** "classId:subjectId" pairs a teacher takes in a year (their subject allocations). */
async function myPairs(auth, academicYearId) {
  if (!isOid(auth.userId)) return new Set()
  const allocs = await TeacherAllocation.find({ teacherId: auth.userId, ...(academicYearId && { academicYearId }) }).select('sectionId subjectId').lean()
  const sections = await Section.find({ _id: { $in: allocs.map((a) => a.sectionId) } }).select('classId').lean()
  const cls = new Map(sections.map((s) => [String(s._id), String(s.classId)]))
  return new Set(allocs.map((a) => `${cls.get(String(a.sectionId))}:${a.subjectId}`))
}

/** May the caller see this paper (or, with no paper yet, this exam paper)? */
function inScope(auth, pairs, examPaper, paper) {
  if (wide(auth)) return true
  if (paper && String(paper.setterId) === String(auth.userId)) return true
  const mine = pairs.has(`${examPaper.classId}:${examPaper.subjectId}`)
  if (scopeOf(auth, MODULE) === 'OWN') return !paper && mine // own: only theirs, but they can start one for their subject
  return mine
}

async function paperFor(id, auth) {
  const p = isOid(id) ? await QuestionPaper.findById(id) : null
  if (!p) throw notFound('Question paper')
  if (!wide(auth)) {
    const exam = await Exam.findById(p.examId).select('academicYearId').lean()
    if (!inScope(auth, await myPairs(auth, exam?.academicYearId), p, p)) throw notFound('Question paper')
  }
  return p
}

const mayChange = (auth) => can(auth, 'exams.question-papers.edit') || can(auth, 'exams.question-papers.create')

/** A paper the caller may change: a draft. */
async function draftFor(id, auth) {
  const p = await paperFor(id, auth)
  if (!mayChange(auth)) throw forbidden()
  if (p.status === 'SUBMITTED') throw conflict('This paper is waiting for approval. Take it back (or have it sent back) to change it.')
  if (p.status === 'APPROVED') throw conflict('This paper is approved and locked. Unlock it to change it.')
  return p
}

function setOf(p, setId) {
  const set = p.sets.find((s) => String(s._id) === String(setId))
  if (!set) throw notFound('Set')
  return set
}
/** Sets B, C … of a "shuffled" paper are made from set A and can't be changed on their own. */
function editableSet(p, setId) {
  const set = setOf(p, setId)
  if (p.setMode === 'SHUFFLE' && set.letter !== 'A') throw conflict(`Set ${set.letter} is set A shuffled — change set A and it follows.`)
  return set
}

const history = (p, auth, action, note) => p.history.push({ action, status: p.status, note: note || undefined, by: auth.user?.name, byId: isOid(auth.userId) ? auth.userId : undefined, at: new Date() })

// ───────────────────────────────────────────────────────── shape

const plainQ = (q) => (!q ? null : {
  questionId: idStr(q.questionId), type: q.type, text: q.text,
  options: (q.options ?? []).map((o) => ({ text: o.text, correct: !!o.correct })),
  answers: q.answers ?? undefined, explanation: q.explanation ?? undefined,
  chapter: q.chapter ?? undefined, difficulty: q.difficulty ?? 'MEDIUM', bloom: q.bloom ?? undefined,
})
const plainItem = (it) => ({ ...plainQ(it), or: it.or?.text ? plainQ(it.or) : null })
const blueprintOf = (p) => ({
  durationMin: p.durationMin ?? null, maxMarks: p.maxMarks, instructions: p.instructions ?? '',
  sections: p.sections.map((s) => ({ id: String(s._id), title: s.title, instructions: s.instructions ?? '', type: s.type, count: s.count, marks: s.marks, attempt: s.attempt ?? null, choice: !!s.choice })),
  chapters: (p.chapters ?? []).map((c) => ({ chapter: c.chapter, weight: c.weight })),
  difficulty: { EASY: p.difficulty?.EASY ?? 0, MEDIUM: p.difficulty?.MEDIUM ?? 0, HARD: p.difficulty?.HARD ?? 0 },
})
const plainSet = (s) => ({ id: String(s._id), letter: s.letter, sections: s.sections.map((x) => ({ sectionId: String(x.sectionId), items: x.items.map(plainItem) })) })

/** Sets B, C … of a shuffled paper, made again from set A (after any change to set A or the blueprint). */
function deriveSets(p) {
  if (p.setMode !== 'SHUFFLE' || p.sets.length < 2) return
  const a = plainSet(p.sets[0])
  for (const set of p.sets.slice(1)) {
    set.sections = shuffleSet(a, `${p._id}:${set.letter}`, { options: p.shuffleOptions !== false }).sections.map((x) => ({ sectionId: x.sectionId, items: x.items }))
  }
}

/** The bank questions a paper can draw on: its subject, at its class (or no class), switched on. */
async function bankPool(p) {
  const rows = await Question.find({ subjectId: p.subjectId, active: { $ne: false }, $or: [{ classId: p.classId }, { classId: null }] })
    .select('type text options answers explanation marks chapter difficulty bloom used').lean()
  return rows.map((q) => ({ ...q, id: String(q._id) }))
}

async function names(p) {
  const [exam, cls, subject, examPaper] = await Promise.all([
    Exam.findById(p.examId).select('name status academicYearId term').lean(),
    ClassLevel.findById(p.classId).select('name code').lean(),
    Subject.findById(p.subjectId).select('name code').lean(),
    ExamPaper.findById(p.examPaperId).select('date startTime endTime maxMarks').lean(),
  ])
  return { exam, cls, subject, examPaper }
}

async function paperOut(p, auth) {
  const doc = p.toObject ? p.toObject() : p
  const { exam, cls, subject, examPaper } = await names(doc)
  const bp = blueprintOf(doc)
  const sets = doc.sets.map(plainSet).map((s) => ({ ...s, progress: setProgress(bp, s) }))
  const [bankCount, chapters] = await Promise.all([
    Question.countDocuments({ subjectId: doc.subjectId, active: { $ne: false }, $or: [{ classId: doc.classId }, { classId: null }] }),
    Question.distinct('chapter', { subjectId: doc.subjectId, active: { $ne: false }, $or: [{ classId: doc.classId }, { classId: null }] }),
  ])
  const draft = doc.status === 'DRAFT'
  return {
    id: String(doc._id), examId: String(doc.examId), examPaperId: String(doc.examPaperId), classId: String(doc.classId), subjectId: String(doc.subjectId),
    status: doc.status, statusLabel: QP_STATUS[doc.status]?.label,
    ...bp, setMode: doc.setMode, shuffleOptions: doc.shuffleOptions !== false,
    totals: blueprintTotals(bp), warnings: checkBlueprint(bp, doc.maxMarks).warnings,
    sets,
    setterId: idStr(doc.setterId), setterName: doc.setterName ?? null, submittedAt: doc.submittedAt ?? null,
    approvedAt: doc.approvedAt ?? null, approvedBy: doc.approvedBy ?? null,
    history: (doc.history ?? []).map((h) => ({ action: h.action, status: h.status, note: h.note ?? null, by: h.by ?? null, at: h.at })).reverse(),
    printed: doc.printed ?? 0, lastPrintedAt: doc.lastPrintedAt ?? null, lastPrintedBy: doc.lastPrintedBy ?? null,
    exam: exam ? { id: String(exam._id), name: exam.name, status: exam.status } : null,
    className: cls?.name ?? '', classCode: cls?.code ?? '', subject: subject?.name ?? '', subjectCode: subject?.code ?? '',
    date: examPaper?.date ?? null, startTime: examPaper?.startTime ?? null, endTime: examPaper?.endTime ?? null, paperMaxMarks: examPaper?.maxMarks ?? null,
    bank: { count: bankCount, chapters: chapters.filter(Boolean).sort() },
    updatedAt: doc.updatedAt,
    can: {
      edit: draft && mayChange(auth),
      submit: draft && mayChange(auth),
      recall: doc.status === 'SUBMITTED' && mayChange(auth) && (String(doc.setterId) === String(auth.userId) || can(auth, 'exams.question-papers.approve')),
      approve: doc.status === 'SUBMITTED' && can(auth, 'exams.question-papers.approve'),
      unlock: doc.status === 'APPROVED' && can(auth, 'exams.question-papers.approve'),
      print: can(auth, 'exams.question-papers.print'),
      delete: doc.status !== 'APPROVED' && can(auth, 'exams.question-papers.delete'),
      saveToBank: moduleEnabled(auth, 'lms') && can(auth, 'lms.question-bank.create'),
    },
  }
}

// ───────────────────────────────────────────────────────── the board

/**
 * An exam's papers (class × subject) with where each question paper has got: not started, draft, submitted,
 * approved; who is setting it and how many questions are in. Grade-only papers have no question paper. Also the
 * year's exams for the picker.
 */
export async function board({ examId, yearId } = {}, auth) {
  const year = await yearOrCurrent(yearId)
  const exams = await Exam.find({ academicYearId: year._id }).sort({ startDate: 1, createdAt: 1 }).select('name status startDate endDate').lean()
  const exam = (examId && exams.find((e) => String(e._id) === String(examId))) || exams.filter((e) => e.status !== 'PUBLISHED').at(0) || exams.at(-1)
  const out = { year: { id: String(year._id), name: year.name }, exams: exams.map((e) => ({ id: String(e._id), name: e.name, status: e.status, startDate: e.startDate ?? null, endDate: e.endDate ?? null })), exam: null, rows: [], summary: null }
  if (!exam) return out
  const [papers, qps, pairs] = await Promise.all([
    ExamPaper.find({ examId: exam._id, gradeOnly: { $ne: true } }).sort({ date: 1, startTime: 1, order: 1 }).lean(),
    QuestionPaper.find({ examId: exam._id }).select('examPaperId status setterId setterName sections sets.letter sets.sections maxMarks updatedAt submittedAt approvedAt').lean(),
    wide(auth) ? null : myPairs(auth, exam.academicYearId),
  ])
  const [classes, subjects] = await Promise.all([
    ClassLevel.find({ _id: { $in: papers.map((p) => p.classId) } }).select('name code order').lean(),
    Subject.find({ _id: { $in: papers.map((p) => p.subjectId) } }).select('name code').lean(),
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const subj = new Map(subjects.map((s) => [String(s._id), s]))
  const qpOf = new Map(qps.map((q) => [String(q.examPaperId), q]))
  const rows = []
  for (const ep of papers) {
    const qp = qpOf.get(String(ep._id))
    if (pairs && !inScope(auth, pairs, ep, qp)) continue
    const c = cls.get(String(ep.classId))
    let paper = null
    if (qp) {
      const bp = blueprintOf(qp)
      const progress = setProgress(bp, plainSet({ letter: 'A', sections: [], ...qp.sets[0], _id: 'a' }))
      paper = {
        id: String(qp._id), status: qp.status, setterName: qp.setterName ?? null, mine: String(qp.setterId) === String(auth.userId),
        picked: progress.picked, needed: progress.needed, sets: qp.sets.length, marks: blueprintTotals(bp).total, maxMarks: qp.maxMarks,
        updatedAt: qp.updatedAt, submittedAt: qp.submittedAt ?? null, approvedAt: qp.approvedAt ?? null,
      }
    }
    rows.push({
      examPaperId: String(ep._id), classId: String(ep.classId), className: c?.name ?? '', classCode: c?.code ?? '', classOrder: c?.order ?? 0,
      subjectId: String(ep.subjectId), subject: subj.get(String(ep.subjectId))?.name ?? '', subjectCode: subj.get(String(ep.subjectId))?.code ?? '',
      date: ep.date ?? null, startTime: ep.startTime ?? null, endTime: ep.endTime ?? null, maxMarks: ep.maxMarks,
      status: paper?.status ?? 'NOT_STARTED', paper,
    })
  }
  rows.sort((a, b) => a.classOrder - b.classOrder || a.subject.localeCompare(b.subject))
  const by = (s) => rows.filter((r) => r.status === s).length
  out.exam = { id: String(exam._id), name: exam.name, status: exam.status, startDate: exam.startDate ?? null, endDate: exam.endDate ?? null }
  out.rows = rows
  out.summary = { total: rows.length, NOT_STARTED: by('NOT_STARTED'), DRAFT: by('DRAFT'), SUBMITTED: by('SUBMITTED'), APPROVED: by('APPROVED') }
  out.limited = !wide(auth)
  return out
}

// ───────────────────────────────────────────────────────── a paper

export async function getPaper(id, auth) {
  return paperOut(await paperFor(id, auth), auth)
}

/** Start the question paper of an exam paper: a first blueprint from its max marks, set A empty. */
export async function createPaper({ examPaperId }, auth, req) {
  const ep = isOid(examPaperId) ? await ExamPaper.findById(examPaperId).lean() : null
  if (!ep) throw notFound('Exam paper')
  if (ep.gradeOnly) throw conflict('This paper is graded, not marked — it has no question paper.')
  const exam = await Exam.findById(ep.examId).select('name academicYearId').lean()
  if (!exam) throw notFound('Exam')
  if (!wide(auth) && !inScope(auth, await myPairs(auth, exam.academicYearId), ep, null)) throw forbidden('You can set papers only for the subjects you teach.')
  if (await QuestionPaper.exists({ examPaperId: ep._id })) throw conflict('This paper’s question paper has already been started.')
  const sections = starterBlueprint(ep.maxMarks).map((s) => ({ ...s, _id: new mongoose.Types.ObjectId() }))
  const p = new QuestionPaper({
    examId: ep.examId, examPaperId: ep._id, classId: ep.classId, subjectId: ep.subjectId,
    durationMin: minutesBetween(ep.startTime, ep.endTime), maxMarks: ep.maxMarks || 100, instructions: DEFAULT_INSTRUCTIONS,
    sections, sets: [{ letter: 'A', sections: sections.map((s) => ({ sectionId: s._id, items: [] })) }],
    setterId: isOid(auth.userId) ? auth.userId : undefined, setterName: auth.user?.name,
  })
  history(p, auth, 'CREATED')
  await p.save()
  const { cls, subject } = await names(p)
  await audit({ action: 'CREATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: `${exam.name} · ${cls?.name} · ${subject?.name}`, summary: `Started the question paper of ${exam.name} · ${cls?.name} · ${subject?.name}` }, req)
  return paperOut(p, auth)
}

const label = async (p) => { const { exam, cls, subject } = await names(p); return `${exam?.name ?? ''} · ${cls?.name ?? ''} · ${subject?.name ?? ''}` }

/**
 * The blueprint: duration, max marks, instructions, sections (with `id` to keep one), chapter weightage, difficulty
 * mix. Every set follows: a section dropped takes its questions with it; a new one starts empty; fewer questions
 * keep the first ones; another type drops the questions of the old type; no internal choice drops the OR ones.
 */
export async function saveBlueprint(id, input, auth, req) {
  const p = await draftFor(id, auth)
  const { errors } = checkBlueprint(input, input.maxMarks)
  if (Object.keys(errors).length) throw fieldsError(errors, Object.values(errors)[0])
  const old = new Map(p.sections.map((s) => [String(s._id), s]))
  const sections = input.sections.map((s) => ({
    _id: s.id && old.has(String(s.id)) ? oid(s.id) : new mongoose.Types.ObjectId(),
    title: s.title, instructions: s.instructions || undefined, type: s.type, count: s.count, marks: s.marks, attempt: s.attempt || undefined, choice: !!s.choice,
  }))
  for (const set of p.sets) {
    const had = new Map(set.sections.map((x) => [String(x.sectionId), x.items.map((it) => it.toObject?.() ?? it)]))
    set.sections = sections.map((s) => ({
      sectionId: s._id,
      items: (had.get(String(s._id)) ?? []).filter((it) => it.type === s.type).slice(0, s.count).map((it) => (s.choice ? it : { ...it, or: undefined })),
    }))
  }
  Object.assign(p, {
    durationMin: input.durationMin || undefined, maxMarks: input.maxMarks, instructions: input.instructions || undefined, sections,
    chapters: (input.chapters ?? []).filter((c) => String(c.chapter ?? '').trim() && c.weight > 0).map((c) => ({ chapter: c.chapter.trim(), weight: c.weight })),
    difficulty: input.difficulty ?? { EASY: 0, MEDIUM: 0, HARD: 0 },
  })
  deriveSets(p)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Changed the blueprint (${sections.length} sections, ${blueprintTotals(blueprintOf(p)).total} marks)` }, req)
  return paperOut(p, auth)
}

/** Check and tidy a set's questions of one section (the type is always the section's). → items or throws. */
function tidyItems(section, items, prefix) {
  const errors = {}
  const tidyQ = (q) => {
    const type = section.type
    const opts = QUESTION_TYPES[type]?.options
      ? (type === 'TRUE_FALSE' ? [{ text: 'True', correct: !!q.options?.[0]?.correct }, { text: 'False', correct: !!q.options?.[1]?.correct }] : (q.options ?? []).filter((o) => String(o.text ?? '').trim()).map((o) => ({ text: o.text.trim(), correct: !!o.correct })))
      : []
    return {
      questionId: isOid(q.questionId) ? oid(q.questionId) : undefined, type, text: String(q.text ?? '').trim(), options: opts,
      answers: ['FILL', 'SHORT', 'LONG'].includes(type) ? (q.answers ?? []).map((a) => String(a).trim()).filter(Boolean) : undefined,
      explanation: q.explanation || undefined, chapter: q.chapter?.trim() || undefined, difficulty: q.difficulty || 'MEDIUM', bloom: q.bloom || undefined,
    }
  }
  const check = (q, at) => {
    // a model answer is welcome but not required on a printed paper; an MCQ / fill-in needs its answer for the key
    const e = checkQuestion({ ...q, marks: section.marks })
    for (const [k, v] of Object.entries(e)) errors[`${at}.${k}`] = v
  }
  const out = items.map((it, k) => {
    const main = tidyQ(it)
    check(main, `${prefix}.${k}`)
    if (section.choice && it.or && String(it.or.text ?? '').trim()) {
      const alt = tidyQ(it.or)
      check(alt, `${prefix}.${k}.or`)
      return { ...main, or: alt }
    }
    return main
  })
  if (items.length > section.count) errors[prefix] = `${section.title} has room for ${section.count} question(s)`
  return { items: out, errors }
}

const idsIn = (set) => set.sections.flatMap((x) => x.items.flatMap((it) => [it.questionId, it.or?.questionId])).filter(Boolean).map(String)

/** Save a set's questions as edited on screen (order, wording, answers, removals): `sections` [{ sectionId, items }]. */
export async function saveQuestions(id, setId, { sections: input }, auth, req) {
  const p = await draftFor(id, auth)
  const set = editableSet(p, setId)
  const errors = {}
  const next = new Map(set.sections.map((x) => [String(x.sectionId), x.items]))
  input.forEach((x, i) => {
    const section = p.sections.find((s) => String(s._id) === String(x.sectionId))
    if (!section) { errors[`sections.${i}`] = 'That section isn’t on the blueprint any more'; return }
    const r = tidyItems(section, x.items, `sections.${i}.items`)
    Object.assign(errors, r.errors)
    next.set(String(section._id), r.items)
  })
  const ids = [...next.values()].flat().flatMap((it) => [it.questionId, it.or?.questionId]).filter(Boolean).map(String)
  if (new Set(ids).size !== ids.length) errors.sections = 'A question is in the paper twice'
  if (Object.keys(errors).length) throw fieldsError(errors, errors.sections ?? Object.values(errors)[0])
  set.sections = p.sections.map((s) => ({ sectionId: s._id, items: next.get(String(s._id)) ?? [] }))
  if (set.letter === 'A') deriveSets(p)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Changed the questions of set ${set.letter}` }, req)
  return paperOut(p, auth)
}

/** Questions in the paper's other sets (set apart in "different questions" mode). */
const otherSetIds = (p, set) => (p.setMode === 'DIFFERENT' ? p.sets.filter((s) => s !== set).flatMap(idsIn) : [])

/** Fill the empty places of a set (one section, or all) from the bank; `refill` throws the old ones away first. */
export async function autoPickSet(id, setId, { sectionId, refill, seed }, auth, req) {
  const p = await draftFor(id, auth)
  const set = editableSet(p, setId)
  if (sectionId && !p.sections.some((s) => String(s._id) === String(sectionId))) throw notFound('Section')
  const pool = await bankPool(p)
  if (!pool.length) throw conflict('The question bank has no questions of this subject for this class yet. Add some in Learning › Question bank, or write them here.')
  const bp = blueprintOf(p)
  const r = autoPick({ blueprint: bp, set: plainSet(set), pool, avoid: otherSetIds(p, set), seed: seed || `${p._id}:${set.letter}:${Date.now()}`, sectionId, refill: !!refill })
  set.sections = r.sections.map((x) => ({ sectionId: oid(x.sectionId), items: x.items }))
  if (set.letter === 'A') deriveSets(p)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Auto-picked ${r.picked} question(s) for set ${set.letter}` }, req)
  return { ...(await paperOut(p, auth)), picked: r.picked, short: r.short }
}

/** "Suggest another": swap one question (`part` 'main' or its OR 'or') for the best other one in the bank. */
export async function replaceQuestion(id, setId, { sectionId, index, part = 'main' }, auth, req) {
  const p = await draftFor(id, auth)
  const set = editableSet(p, setId)
  const sec = set.sections.find((x) => String(x.sectionId) === String(sectionId))
  const section = p.sections.find((s) => String(s._id) === String(sectionId))
  if (!sec || !section) throw notFound('Section')
  if (index >= section.count || (part === 'main' && !sec.items[index]) || (part === 'or' && (!section.choice || !sec.items[index]))) throw notFound('Question')
  const q = suggestQuestion({ blueprint: blueprintOf(p), set: plainSet(set), pool: await bankPool(p), avoid: otherSetIds(p, set), sectionId: String(sectionId), index, part, seed: `${p._id}:${Date.now()}` })
  if (!q) throw conflict(`The bank has no other ${QUESTION_TYPES[section.type].label.toLowerCase()} question for this paper.`)
  const items = sec.items.map((it) => it.toObject?.() ?? it)
  items[index] = part === 'or' ? { ...items[index], or: q } : { ...q, or: items[index].or }
  sec.items = items
  if (set.letter === 'A') deriveSets(p)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Replaced a question in set ${set.letter}` }, req)
  return paperOut(p, auth)
}

/** Put questions in a section: in one place (`index`, `part`) or after the ones there. */
function place(p, set, sectionId, newItems, { index, part = 'main' } = {}) {
  const section = p.sections.find((s) => String(s._id) === String(sectionId))
  const sec = set.sections.find((x) => String(x.sectionId) === String(sectionId))
  if (!section || !sec) throw notFound('Section')
  const wrong = newItems.find((q) => q.type !== section.type)
  if (wrong) throw conflict(`${section.title} takes ${QUESTION_TYPES[section.type].label.toLowerCase()} questions only.`)
  const have = new Set(idsIn(set))
  const twice = newItems.find((q) => q.questionId && have.has(String(q.questionId)))
  if (twice) throw conflict('That question is already in this set.')
  const items = sec.items.map((it) => it.toObject?.() ?? it)
  if (index !== undefined && index !== null) {
    if (index >= section.count) throw conflict(`${section.title} has room for ${section.count} question(s).`)
    if (part === 'or') {
      if (!section.choice) throw conflict(`${section.title} has no internal choice.`)
      if (!items[index]) throw conflict('Put the question first, then its OR alternative.')
      items[index] = { ...items[index], or: newItems[0] }
    } else items[Math.min(index, items.length)] = { ...newItems[0], or: items[index]?.or }
  } else {
    if (items.length + newItems.length > section.count) throw conflict(`${section.title} has room for ${section.count} question(s); ${items.length} are in.`)
    items.push(...newItems)
  }
  sec.items = items
}

/** Pick questions from the bank by hand. */
export async function addFromBank(id, setId, { sectionId, questionIds, index, part }, auth, req) {
  const p = await draftFor(id, auth)
  const set = editableSet(p, setId)
  const rows = await Question.find({ _id: { $in: questionIds }, subjectId: p.subjectId, active: { $ne: false } }).lean()
  const byId = new Map(rows.map((q) => [String(q._id), q]))
  const items = questionIds.map((q) => byId.get(String(q))).filter(Boolean).map((q) => ({
    questionId: q._id, type: q.type, text: q.text, options: q.options ?? [], answers: q.answers, explanation: q.explanation, chapter: q.chapter, difficulty: q.difficulty, bloom: q.bloom,
  }))
  if (!items.length) throw notFound('Question')
  place(p, set, sectionId, index !== undefined ? items.slice(0, 1) : items, { index, part })
  if (set.letter === 'A') deriveSets(p)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Added ${items.length} question(s) from the bank to set ${set.letter}` }, req)
  return paperOut(p, auth)
}

/** Write a question for the paper (and, with `saveToBank`, into the question bank too). */
export async function writeQuestion(id, setId, { sectionId, question, saveToBank, index, part }, auth, req) {
  const p = await draftFor(id, auth)
  const set = editableSet(p, setId)
  const section = p.sections.find((s) => String(s._id) === String(sectionId))
  if (!section) throw notFound('Section')
  const { items: [item], errors } = tidyItems({ ...section.toObject(), choice: false, count: 1 }, [question], 'question')
  if (Object.keys(errors).length) throw fieldsError(Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.replace(/^question\.0\./, ''), v])), Object.values(errors)[0])
  if (saveToBank) {
    if (!moduleEnabled(auth, 'lms') || !can(auth, 'lms.question-bank.create')) throw forbidden('You can’t add questions to the question bank.')
    const q = await Question.create({
      subjectId: p.subjectId, classId: p.classId, chapter: item.chapter, type: item.type, text: item.text, options: item.options, answers: item.answers,
      explanation: item.explanation, marks: section.marks, difficulty: item.difficulty, bloom: item.bloom, createdBy: auth.user?.name, createdById: isOid(auth.userId) ? auth.userId : undefined,
    })
    item.questionId = q._id
  }
  place(p, set, sectionId, [item], { index, part })
  if (set.letter === 'A') deriveSets(p)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Wrote a question for set ${set.letter}${saveToBank ? ' (also saved to the question bank)' : ''}` }, req)
  return paperOut(p, auth)
}

/** The bank to pick from by hand: the paper's subject and class, the section's type, with filters. */
export async function bankList(id, q, auth) {
  const p = await paperFor(id, auth)
  const section = q.sectionId ? p.sections.find((s) => String(s._id) === String(q.sectionId)) : null
  const f = { subjectId: p.subjectId, active: { $ne: false }, $or: [{ classId: p.classId }, { classId: null }] }
  if (section) f.type = section.type
  else if (q.type) f.type = q.type
  if (q.chapter) f.chapter = q.chapter
  if (q.difficulty) f.difficulty = q.difficulty
  if (q.bloom) f.bloom = q.bloom
  if (q.search) f.text = new RegExp(escapeRegex(q.search), 'i')
  const pageSize = Math.min(50, q.pageSize || 20)
  const page = Math.max(1, q.page || 1)
  const [rows, total] = await Promise.all([
    Question.find(f).sort({ used: 1, updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Question.countDocuments(f),
  ])
  const where = new Map()
  for (const set of p.sets) for (const qid of idsIn(set)) where.set(qid, [...(where.get(qid) ?? []), set.letter])
  return {
    rows: rows.map((x) => ({
      id: String(x._id), type: x.type, text: x.text, options: (x.options ?? []).map((o) => ({ text: o.text, correct: !!o.correct })), answers: x.answers ?? [],
      marks: x.marks, chapter: x.chapter ?? null, difficulty: x.difficulty, bloom: x.bloom ?? null, used: x.used ?? 0, inSets: where.get(String(x._id)) ?? [],
    })),
    total, page, pageSize,
  }
}

/**
 * Make the sets: `count` in all (set A stays as it is), `mode` SHUFFLE (set A's questions in another order, and the
 * MCQ options too with `shuffleOptions`) or DIFFERENT (each set auto-picked to the blueprint, keeping away from the
 * questions of the sets before it while the bank lasts). Sets beyond A are made again from scratch.
 */
export async function makeSets(id, { count, mode, shuffleOptions }, auth, req) {
  const p = await draftFor(id, auth)
  const first = p.sets.find((s) => s.letter === 'A') ?? p.sets[0]
  const a = { ...first.toObject(), letter: 'A' }
  p.setMode = mode
  p.shuffleOptions = shuffleOptions !== false
  p.sets = [a]
  const short = []
  if (count > 1) {
    const pool = mode === 'DIFFERENT' ? await bankPool(p) : []
    if (mode === 'DIFFERENT' && !pool.length) throw conflict('The question bank has no questions for this paper — different sets need questions from the bank.')
    const bp = blueprintOf(p)
    for (const letter of QP_SET_LETTERS.slice(1, count)) {
      let sections
      if (mode === 'SHUFFLE') sections = shuffleSet(plainSet(a), `${p._id}:${letter}`, { options: p.shuffleOptions }).sections
      else {
        const r = autoPick({ blueprint: bp, set: { sections: [] }, pool, avoid: p.sets.flatMap(idsIn), seed: `${p._id}:${letter}` })
        sections = r.sections
        if (r.short.length) short.push({ letter, missing: r.short.reduce((n, x) => n + x.missing, 0) })
      }
      p.sets.push({ letter, sections: sections.map((x) => ({ sectionId: oid(x.sectionId), items: x.items })) })
    }
  }
  history(p, auth, 'SETS', `${count} set(s), ${mode === 'SHUFFLE' ? 'shuffled' : 'different questions'}`)
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Made ${count} set(s) (${mode === 'SHUFFLE' ? 'shuffled' : 'different questions'})` }, req)
  return { ...(await paperOut(p, auth)), short }
}

// ───────────────────────────────────────────────────────── workflow

/** The setter sends it for approval: every set has all its questions. */
export async function submitPaper(id, { note }, auth, req) {
  const p = await draftFor(id, auth)
  const bp = blueprintOf(p)
  for (const set of p.sets) {
    const pr = setProgress(bp, plainSet(set))
    const gap = pr.sections.find((s) => s.missing || s.extra)
    if (gap) {
      const s = p.sections.find((x) => String(x._id) === gap.id)
      throw conflict(gap.missing ? `Set ${set.letter}: ${s.title} needs ${gap.missing} more question(s).` : `Set ${set.letter}: ${s.title} has ${gap.extra} question(s) too many.`)
    }
  }
  p.status = 'SUBMITTED'
  p.submittedAt = new Date()
  history(p, auth, 'SUBMITTED', note)
  await p.save()
  await audit({ action: 'SUBMIT', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: 'Submitted the question paper for approval' }, req)
  return paperOut(p, auth)
}

/** The setter takes a submitted paper back to change it. */
export async function recallPaper(id, auth, req) {
  const p = await paperFor(id, auth)
  if (p.status !== 'SUBMITTED') throw conflict('Only a paper waiting for approval can be taken back.')
  if (!mayChange(auth) || (String(p.setterId) !== String(auth.userId) && !can(auth, 'exams.question-papers.approve'))) throw forbidden('Only the setter can take it back.')
  p.status = 'DRAFT'
  history(p, auth, 'RECALLED')
  await p.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: 'Took the question paper back to change it' }, req)
  return paperOut(p, auth)
}

const bankUse = async (p, by) => {
  const ids = [...new Set(p.sets.flatMap(idsIn))]
  if (ids.length) await Question.updateMany({ _id: { $in: ids } }, { $inc: { used: by } })
}

/** Approve (and lock) a submitted paper; its bank questions count as used once more. */
export async function approvePaper(id, { note }, auth, req) {
  const p = await paperFor(id, auth)
  if (p.status !== 'SUBMITTED') throw conflict('Only a submitted paper can be approved.')
  p.status = 'APPROVED'
  Object.assign(p, { approvedAt: new Date(), approvedBy: auth.user?.name, approvedById: isOid(auth.userId) ? auth.userId : undefined })
  history(p, auth, 'APPROVED', note)
  await p.save()
  await bankUse(p, 1)
  await audit({ action: 'APPROVE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Approved the question paper${note ? `: ${note}` : ''}` }, req)
  return paperOut(p, auth)
}

/** Send a submitted paper back to the setter with what to change. */
export async function sendBackPaper(id, { note }, auth, req) {
  const p = await paperFor(id, auth)
  if (p.status !== 'SUBMITTED') throw conflict('Only a submitted paper can be sent back.')
  p.status = 'DRAFT'
  history(p, auth, 'SENT_BACK', note)
  await p.save()
  await audit({ action: 'REJECT', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Sent the question paper back: ${note}` }, req)
  return paperOut(p, auth)
}

/** Unlock an approved paper to change it (it goes back to draft and needs approving again). */
export async function unlockPaper(id, { reason }, auth, req) {
  const p = await paperFor(id, auth)
  if (p.status !== 'APPROVED') throw conflict('Only an approved paper can be unlocked.')
  p.status = 'DRAFT'
  Object.assign(p, { approvedAt: undefined, approvedBy: undefined, approvedById: undefined })
  history(p, auth, 'UNLOCKED', reason)
  await p.save()
  await bankUse(p, -1)
  await audit({ action: 'UNLOCK', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: await label(p), summary: `Unlocked the approved question paper: ${reason}` }, req)
  return paperOut(p, auth)
}

export async function deletePaper(id, auth, req) {
  const p = await paperFor(id, auth)
  if (p.status === 'APPROVED') throw conflict('This paper is approved. Unlock it first.')
  const name = await label(p)
  await QuestionPaper.deleteOne({ _id: p._id })
  await audit({ action: 'DELETE', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: name, summary: `Deleted the question paper of ${name}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── printing (QUESTION_PAPER, ANSWER_KEY)

/**
 * One set of a paper for printing (`id`: a set's id, or the paper's for set A), access-checked like the screen.
 * Every print is counted on the paper and written to the audit log. null for someone without the print
 * permission (the template editor then previews over made-up data, never a real paper).
 */
export async function questionPaperPrint(id, auth, docType = 'QUESTION_PAPER') {
  if (!can(auth, 'exams.question-papers.print')) return null
  const found = isOid(id) ? await QuestionPaper.findOne({ $or: [{ _id: id }, { 'sets._id': id }] }).select('_id').lean() : null
  if (!found) throw notFound('Question paper')
  const p = await paperFor(found._id, auth)
  const set = p.sets.find((s) => String(s._id) === String(id)) ?? p.sets[0]
  const { exam, cls, subject, examPaper } = await names(p)
  const year = exam ? await AcademicYear.findById(exam.academicYearId).select('name').lean() : null
  await QuestionPaper.updateOne({ _id: p._id }, { $inc: { printed: 1 }, $set: { lastPrintedAt: new Date(), lastPrintedBy: auth.user?.name } })
  await audit({ action: 'PRINT', module: MODULE, entityType: ENTITY, entityId: String(p._id), entityName: `${exam?.name} · ${cls?.name} · ${subject?.name}`, summary: `Printed the ${docType === 'ANSWER_KEY' ? 'answer key' : 'question paper'} of ${exam?.name} · ${cls?.name} · ${subject?.name}, set ${set.letter}${p.status !== 'APPROVED' ? ' (not approved yet)' : ''}` })
  return { paper: { ...blueprintOf(p), status: p.status, setterName: p.setterName, approvedBy: p.approvedBy, approvedAt: p.approvedAt, setCount: p.sets.length }, set: plainSet(set), exam, year, cls, subject, examPaper }
}

/** The latest paper's set A, for the template editor preview. */
export async function latestQuestionPaperSet() {
  const p = await QuestionPaper.findOne({}).sort({ updatedAt: -1 }).select('sets._id').lean()
  return p?.sets?.[0]?._id
}

