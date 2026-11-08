import {
  ATTEMPT_STATUS, QUESTION_TYPES, SUBMIT_REASONS, TEST_STATUS, markAttempt, questionForStudent, sectionLabel, seededOrder, testTotal,
} from '@schoolgiant/shared'
import { ClassLevel, Section, Subject } from '../models/academics.js'
import { Question } from '../models/lms.js'
import { OnlineTest, TestAttempt } from '../models/onlineTests.js'
import { Student, studentName } from '../models/students.js'
import { can, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { runAsSystem, runAsTenant } from '../platform/context.js'
import { timeZoneOf, zonedDate } from '../platform/time.js'
import { currentYear, sectionsInScope } from './academics.js'
import { familyLink } from './familyLink.js'
import { need, studentFor } from './portal.js'

// Online tests (module `online-tests`). A test copies its questions from the question bank, so editing the bank later
// changes nothing already set. Attempts are timed on the server: answers after the deadline are refused, and an
// attempt left open past it is submitted (on the next look, and by the sweep job). Objective answers are marked at
// once; short and long answers wait for the teacher (Attempts & results › evaluate).

const NARROW = ['CLASS', 'DEPARTMENT', 'OWN']
const MODULE = 'online-tests'
const wide = (auth) => !NARROW.includes(scopeOf(auth, MODULE))
const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const GRACE_MS = 15_000 // network lag at the deadline

async function visibleFilter(auth) {
  if (wide(auth)) return {}
  const allowed = await sectionsInScope(auth, MODULE) ?? []
  const secs = await Section.find({ _id: { $in: allowed } }).select('classId').lean()
  return { $or: [{ sectionIds: { $in: allowed.map(oid) } }, { sectionIds: { $size: 0 }, classId: { $in: secs.map((s) => s.classId) } }, { teacherIds: oid(auth.userId) }, { createdById: oid(auth.userId) }] }
}
const mayChange = (auth, t) => (wide(auth) && can(auth, 'online-tests.tests.edit')) || (t.teacherIds ?? []).some((x) => String(x) === String(auth.userId)) || String(t.createdById) === String(auth.userId)

async function reachOf(t) {
  if (t.sectionIds?.length) return t.sectionIds.map(String)
  const year = await currentYear()
  return (await Section.find({ classId: t.classId, ...(year && { academicYearId: year._id }) }).select('_id').lean()).map((s) => String(s._id))
}

async function names(tests) {
  const [classes, subjects, sections] = await Promise.all([
    ClassLevel.find({ _id: { $in: tests.map((t) => t.classId) } }).select('name code').lean(),
    Subject.find({ _id: { $in: tests.map((t) => t.subjectId) } }).select('name').lean(),
    Section.find({ _id: { $in: tests.flatMap((t) => t.sectionIds) } }).lean(),
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  return {
    cls: (id) => cls.get(String(id))?.name ?? '', subject: new Map(subjects.map((s) => [String(s._id), s.name])),
    section: new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })])),
  }
}

const testRow = (t, n, auth) => ({
  id: String(t._id), title: t.title, status: t.status, statusLabel: TEST_STATUS[t.status]?.label, classId: String(t.classId), subjectId: String(t.subjectId),
  className: n.cls(t.classId), subject: n.subject.get(String(t.subjectId)) ?? '', sections: t.sectionIds.map((s) => n.section.get(String(s))).filter(Boolean),
  questions: t.questions.length, totalMarks: t.totalMarks, durationMin: t.durationMin, opens: t.opens, closes: t.closes, results: t.results, resultsReleasedAt: t.resultsReleasedAt ?? null,
  canChange: auth ? mayChange(auth, t) : false,
})

// ───────────────────────────────────────────────────────── tests

export async function listTests({ status }, auth) {
  const f = { ...(await visibleFilter(auth)) }
  if (status) f.status = status
  const rows = await OnlineTest.find(f).sort({ opensAt: -1, createdAt: -1 }).limit(300).lean()
  const n = await names(rows)
  const counts = await TestAttempt.aggregate([{ $match: { testId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: { t: '$testId', s: '$status' }, n: { $sum: 1 } } }])
  return rows.map((t) => {
    const mine = counts.filter((c) => String(c._id.t) === String(t._id))
    return { ...testRow(t, n, auth), attempts: mine.reduce((s, c) => s + c.n, 0), toEvaluate: mine.find((c) => c._id.s === 'SUBMITTED')?.n ?? 0 }
  })
}

async function testFor(id, auth) {
  const t = isOid(id) ? await OnlineTest.findOne({ _id: id, ...(await visibleFilter(auth)) }) : null
  if (!t) throw notFound('Test')
  return t
}

export async function getTest(id, auth) {
  const t = (await testFor(id, auth)).toObject()
  const n = await names([t])
  return { ...testRow(t, n, auth), ...clean(t), sectionIds: t.sectionIds.map(String), classId: String(t.classId), subjectId: String(t.subjectId), questions: t.questions.map((q, index) => ({ ...q, index, questionId: idStr(q.questionId) })), statusLabel: TEST_STATUS[t.status]?.label, canChange: mayChange(auth, t) }
}

async function checkWindow(input) {
  const fields = {}
  if (input.opens?.date && input.closes?.date && `${input.closes.date} ${input.closes.time}` <= `${input.opens.date} ${input.opens.time}`) fields['closes.date'] = 'After it opens'
  if (Object.keys(fields).length) throw fieldsError(fields)
  const tz = await timeZoneOf()
  return {
    opensAt: input.opens?.date ? zonedDate(input.opens.date, input.opens.time, tz) : undefined,
    closesAt: input.closes?.date ? zonedDate(input.closes.date, input.closes.time, tz) : undefined,
  }
}

export async function createTest(input, auth, req) {
  if (!await ClassLevel.exists({ _id: input.classId })) throw fieldsError({ classId: 'Pick a class' })
  if (!await Subject.exists({ _id: input.subjectId })) throw fieldsError({ subjectId: 'Pick a subject' })
  if (!wide(auth) && input.sectionIds?.length) {
    const allowed = new Set((await sectionsInScope(auth, MODULE) ?? []).map(String))
    if (input.sectionIds.some((s) => !allowed.has(String(s)))) throw forbidden('You can set tests for your own classes only.')
  }
  const year = await currentYear()
  const t = await OnlineTest.create({
    ...input, ...(await checkWindow(input)), academicYearId: year?._id,
    teacherIds: isOid(auth.userId) ? [auth.userId] : [], createdBy: auth.user?.name, createdById: isOid(auth.userId) ? auth.userId : undefined,
  })
  await audit({ action: 'CREATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Set up online test ${t.title}` }, req)
  return getTest(String(t._id), auth)
}

/** A draft changes freely; once published only the instructions, closing time and result settings can. */
export async function updateTest(id, input, auth, req) {
  const t = await testFor(id, auth)
  if (!mayChange(auth, t)) throw forbidden('Only the test’s teachers can change it.')
  if (t.status === 'CLOSED') throw conflict('This test is closed.')
  const keys = t.status === 'DRAFT'
    ? ['title', 'instructions', 'classId', 'subjectId', 'sectionIds', 'durationMin', 'opens', 'closes', 'attemptsAllowed', 'shuffleQuestions', 'shuffleOptions', 'partialMarks', 'results', 'showAnswers', 'proctor', 'passPct']
    : ['instructions', 'closes', 'results', 'showAnswers']
  for (const k of keys) if (input[k] !== undefined) t[k] = input[k]
  Object.assign(t, await checkWindow({ opens: t.opens, closes: t.closes }))
  await t.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Changed online test ${t.title}` }, req)
  return getTest(id, auth)
}

const copyOf = (q) => ({ questionId: q._id, type: q.type, text: q.text, options: q.options, answers: q.answers, explanation: q.explanation, marks: q.marks, negative: q.negative ?? 0, chapter: q.chapter })

async function draftFor(id, auth) {
  const t = await testFor(id, auth)
  if (!mayChange(auth, t)) throw forbidden('Only the test’s teachers can change it.')
  if (t.status !== 'DRAFT') throw conflict('The questions are fixed once the test is published.')
  return t
}

/** Add chosen questions from the bank (copies; ones already in the test are skipped). */
export async function addQuestions(id, { questionIds }, auth, req) {
  const t = await draftFor(id, auth)
  const have = new Set(t.questions.map((q) => String(q.questionId)))
  const rows = await Question.find({ _id: { $in: questionIds.filter((x) => !have.has(String(x))) }, active: { $ne: false } }).lean()
  const byId = new Map(rows.map((q) => [String(q._id), q]))
  for (const qid of questionIds) { const q = byId.get(String(qid)); if (q) t.questions.push(copyOf(q)) }
  t.totalMarks = testTotal(t.questions)
  await t.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Added ${rows.length} question(s) to ${t.title}` }, req)
  return getTest(id, auth)
}

/** Pick questions at random from the bank: so many of a subject (a chapter, a difficulty, a type). */
export async function pickQuestions(id, { count, chapter, difficulty, type }, auth, req) {
  const t = await draftFor(id, auth)
  const have = t.questions.map((q) => q.questionId).filter(Boolean)
  const f = { subjectId: t.subjectId, active: { $ne: false }, _id: { $nin: have }, $or: [{ classId: t.classId }, { classId: null }] }
  if (chapter) f.chapter = chapter
  if (difficulty) f.difficulty = difficulty
  if (type) f.type = type
  const pool = await Question.aggregate([{ $match: f }, { $sample: { size: count } }])
  if (!pool.length) throw conflict('No questions in the bank match.')
  t.questions.push(...pool.map(copyOf))
  t.totalMarks = testTotal(t.questions)
  await t.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Picked ${pool.length} question(s) for ${t.title}` }, req)
  return { ...(await getTest(id, auth)), picked: pool.length, asked: count }
}

/** The questions in a new order, some left out, marks changed: `items` = [{ index (its current place), marks }]. */
export async function setQuestions(id, { items }, auth, req) {
  const t = await draftFor(id, auth)
  const list = items.map((it) => {
    const q = t.questions[it.index]
    return q && { ...q.toObject(), marks: it.marks ?? q.marks }
  }).filter(Boolean)
  t.questions = list
  t.totalMarks = testTotal(list)
  await t.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Rearranged the questions of ${t.title} (${list.length})` }, req)
  return getTest(id, auth)
}

async function tellFamilies(t) {
  const reach = await reachOf(t)
  const students = await Student.find({ sectionId: { $in: reach }, status: 'ACTIVE' }).select('_id sectionId').lean()
  const n = await names([{ ...t, sectionIds: reach.map(oid) }])
  const link = await familyLink('tests')
  for (const s of students) {
    await emit('tests.published', { studentId: String(s._id), entity: { type: 'online_test', id: t._id }, data: { student: { class: n.section.get(String(s.sectionId)) ?? '' }, test: { subject: n.subject.get(String(t.subjectId)) ?? '', title: t.title, opens: `${t.opens.date} ${t.opens.time}`, closes: `${t.closes.date} ${t.closes.time}`, minutes: t.durationMin, link } } })
  }
  return students.length
}

export async function publishTest(id, { notify }, auth, req) {
  const t = await draftFor(id, auth)
  const fields = {}
  if (!t.questions.length) fields.questions = 'Add questions first'
  if (!t.opens?.date || !t.closes?.date) fields['opens.date'] = 'Set when it opens and closes'
  else if (t.closesAt <= new Date()) fields['closes.date'] = 'Already past'
  if (Object.keys(fields).length) throw fieldsError(fields, fields.questions ?? fields['opens.date'] ?? 'The test closes in the past.')
  t.status = 'PUBLISHED'
  t.publishedAt = new Date()
  t.totalMarks = testTotal(t.questions)
  await t.save()
  await Question.updateMany({ _id: { $in: t.questions.map((q) => q.questionId).filter(Boolean) } }, { $inc: { used: 1 } })
  const told = notify ? await tellFamilies(t.toObject()) : 0
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Published online test ${t.title} (${t.questions.length} questions, ${t.totalMarks} marks)${told ? `; told ${told} families` : ''}` }, req)
  return { ...(await getTest(id, auth)), told }
}

/** Close a test early (or after its window): anyone still writing is submitted. */
export async function closeTest(id, auth, req) {
  const t = await testFor(id, auth)
  if (!mayChange(auth, t)) throw forbidden()
  if (t.status !== 'PUBLISHED') throw conflict('Only a published test can be closed.')
  const open = await TestAttempt.find({ testId: t._id, status: 'IN_PROGRESS' })
  for (const a of open) await finish(a, t.toObject(), 'CLOSED')
  t.status = 'CLOSED'
  t.closedAt = new Date()
  await t.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Closed online test ${t.title}${open.length ? ` (${open.length} attempt(s) submitted)` : ''}` }, req)
  return getTest(id, auth)
}

export async function releaseResults(id, auth, req) {
  const t = await testFor(id, auth)
  if (!mayChange(auth, t)) throw forbidden()
  t.resultsReleasedAt = new Date()
  await t.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Released the results of ${t.title}` }, req)
  return getTest(id, auth)
}

export async function deleteTest(id, auth, req) {
  const t = await testFor(id, auth)
  if (!mayChange(auth, t)) throw forbidden()
  if (await TestAttempt.exists({ testId: t._id })) throw conflict('Students have taken this test. Close it instead.')
  await OnlineTest.deleteOne({ _id: t._id })
  if (t.status !== 'DRAFT') await Question.updateMany({ _id: { $in: t.questions.map((q) => q.questionId).filter(Boolean) } }, { $inc: { used: -1 } })
  await audit({ action: 'DELETE', module: MODULE, entityType: 'online_test', entityId: String(t._id), entityName: t.title, summary: `Deleted online test ${t.title}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── marking

/** Submit an attempt and mark it: objective answers at once; it waits for the teacher if anything else is answered. */
async function finish(a, t, reason) {
  if (a.status !== 'IN_PROGRESS') return a
  const r = markAttempt(t.questions, a.answers ?? {}, a.manual ?? {}, { partial: t.partialMarks })
  a.status = r.pending ? 'SUBMITTED' : 'EVALUATED'
  a.submittedAt = reason === 'TIME' ? a.deadline : new Date()
  a.submitReason = reason
  a.score = { auto: r.auto, manual: r.manual, total: r.total, pct: t.totalMarks ? Math.round((r.total / t.totalMarks) * 1000) / 10 : 0, pending: r.pending }
  a.passed = a.score.pct >= (t.passPct ?? 0)
  if (a.status === 'EVALUATED') a.evaluatedAt = new Date()
  await a.save()
  return a
}

/** Every attempt past its deadline is submitted (the job runs this; reads do it for the attempts they touch). */
export async function sweepExpired() {
  const due = await runAsSystem(() => TestAttempt.find({ status: 'IN_PROGRESS', deadline: { $lt: new Date(Date.now() - GRACE_MS) } }).limit(500).setOptions({ allTenants: true }).lean())
  for (const d of due) {
    await runAsTenant(d.tenantId, async () => {
      const [a, t] = await Promise.all([TestAttempt.findById(d._id), OnlineTest.findById(d.testId).lean()])
      if (a && t) await finish(a, t, 'TIME')
    })
  }
  return due.length
}

/** The class's students with their latest attempt, and how the test went overall and question by question. */
export async function testAttempts(id, auth) {
  const t = (await testFor(id, auth)).toObject()
  const reach = await reachOf(t)
  const [students, attempts] = await Promise.all([
    Student.find({ sectionId: { $in: reach }, status: 'ACTIVE' }).select('firstName middleName lastName admissionNo rollNo sectionId').sort({ rollNo: 1, firstName: 1 }).lean(),
    TestAttempt.find({ testId: t._id }).sort({ attemptNo: -1 }).lean(),
  ])
  const n = await names([{ ...t, sectionIds: reach.map(oid) }])
  const latest = new Map()
  for (const a of attempts) if (!latest.has(String(a.studentId))) latest.set(String(a.studentId), a)
  const done = [...latest.values()].filter((a) => a.status !== 'IN_PROGRESS')
  const scores = done.map((a) => a.score?.total ?? 0)
  // question by question: how many got the objective ones right
  const byQ = t.questions.map((q, index) => {
    const auto = QUESTION_TYPES[q.type]?.auto
    const answered = done.filter((a) => a.answers?.[index] !== undefined && a.answers?.[index] !== null && a.answers?.[index] !== '')
    const right = auto ? answered.filter((a) => markAttempt([q], { 0: a.answers[index] }, {}, { partial: t.partialMarks }).lines[0].correct).length : null
    return { index, text: q.text, type: q.type, answered: answered.length, right, pct: auto && done.length ? Math.round((right / done.length) * 100) : null }
  })
  return {
    test: { id: String(t._id), title: t.title, totalMarks: t.totalMarks, passPct: t.passPct, status: t.status },
    stats: {
      students: students.length, attempted: latest.size, submitted: done.length, toEvaluate: done.filter((a) => a.status === 'SUBMITTED').length,
      average: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null, highest: scores.length ? Math.max(...scores) : null,
      passed: done.filter((a) => a.passed).length,
    },
    rows: students.map((s) => {
      const a = latest.get(String(s._id))
      return {
        studentId: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, section: n.section.get(String(s.sectionId)) ?? '',
        attemptId: a ? String(a._id) : null, status: a?.status ?? null, statusLabel: a ? ATTEMPT_STATUS[a.status]?.label : null, score: a?.score ?? null, passed: a?.passed ?? null,
        submittedAt: a?.submittedAt ?? null, submitReason: a?.submitReason ?? null, tabSwitches: a?.tabSwitches ?? 0, attempts: attempts.filter((x) => String(x.studentId) === String(s._id)).length,
      }
    }),
    questions: byQ,
  }
}

/** One attempt, answer by answer, for the teacher (with the correct answers). */
export async function attemptDetail(attemptId, auth) {
  const a = isOid(attemptId) ? await TestAttempt.findById(attemptId).lean() : null
  if (!a) throw notFound('Attempt')
  const t = (await testFor(a.testId, auth)).toObject()
  const s = await Student.findById(a.studentId).select('firstName middleName lastName admissionNo rollNo').lean()
  const r = markAttempt(t.questions, a.answers ?? {}, a.manual ?? {}, { partial: t.partialMarks })
  return {
    id: String(a._id), testId: String(t._id), testTitle: t.title, status: a.status, statusLabel: ATTEMPT_STATUS[a.status]?.label, student: s && { name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null },
    startedAt: a.startedAt, submittedAt: a.submittedAt, submitReason: a.submitReason, submitReasonLabel: SUBMIT_REASONS[a.submitReason], tabSwitches: a.tabSwitches, events: a.events ?? [], score: a.score, passed: a.passed, totalMarks: t.totalMarks,
    lines: t.questions.map((q, index) => ({ ...q, questionId: idStr(q.questionId), index, answer: a.answers?.[index] ?? null, feedback: a.feedback?.[index] ?? null, ...r.lines[index] })),
  }
}

/** The teacher's marks for short and long answers (and a note on any answer). */
export async function evaluateAttempt(attemptId, { manual = {}, feedback = {} }, auth, req) {
  if (!can(auth, 'online-tests.attempts.evaluate')) throw forbidden()
  const a = isOid(attemptId) ? await TestAttempt.findById(attemptId) : null
  if (!a) throw notFound('Attempt')
  const t = (await testFor(a.testId, auth)).toObject()
  if (a.status === 'IN_PROGRESS') throw conflict('The student is still writing.')
  const fields = {}
  for (const [k, v] of Object.entries(manual)) {
    const q = t.questions[Number(k)]
    if (!q || QUESTION_TYPES[q.type]?.auto) fields[`manual.${k}`] = 'Not a teacher-marked question'
    else if (v !== null && (v < 0 || v > q.marks)) fields[`manual.${k}`] = `0 to ${q.marks}`
  }
  if (Object.keys(fields).length) throw fieldsError(fields)
  a.manual = { ...(a.manual ?? {}), ...manual }
  a.feedback = { ...(a.feedback ?? {}), ...feedback }
  a.markModified('manual')
  a.markModified('feedback')
  const r = markAttempt(t.questions, a.answers ?? {}, a.manual, { partial: t.partialMarks })
  a.score = { auto: r.auto, manual: r.manual, total: r.total, pct: t.totalMarks ? Math.round((r.total / t.totalMarks) * 1000) / 10 : 0, pending: r.pending }
  a.passed = a.score.pct >= (t.passPct ?? 0)
  a.status = r.pending ? 'SUBMITTED' : 'EVALUATED'
  if (!r.pending) { a.evaluatedAt = new Date(); a.evaluatedBy = auth.user?.name }
  await a.save()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'test_attempt', entityId: String(a._id), entityName: t.title, studentId: a.studentId, summary: `Marked an attempt of ${t.title}: ${a.score.total}/${t.totalMarks}${r.pending ? ` (${r.pending} still to mark)` : ''}` }, req)
  return attemptDetail(attemptId, auth)
}

export async function exportResults(id, auth) {
  const r = await testAttempts(id, auth)
  const head = ['Roll', 'Name', 'Admission no.', 'Section', 'Status', 'Marks', 'Out of', '%', 'Result', 'Submitted', 'How', 'Left the test']
  const lines = r.rows.map((x) => [x.rollNo, x.name, x.admissionNo, x.section, x.statusLabel ?? 'Not taken', x.score?.total, r.test.totalMarks, x.score?.pct, x.passed === null ? '' : x.passed ? 'Pass' : 'Fail', x.submittedAt ? new Date(x.submittedAt).toISOString() : '', SUBMIT_REASONS[x.submitReason] ?? '', x.tabSwitches])
  return { name: `${r.test.title.replace(/[^\w-]+/g, '-')}-results.csv`, body: [head, ...lines].map((row) => row.map(csvCell).join(',')).join('\n') }
}

// ───────────────────────────────────────────────────────── the student's side (family app)

async function placeOf(s) {
  const sec = s.sectionId ? await Section.findById(s.sectionId).select('classId').lean() : null
  return sec ? { sectionId: s.sectionId, classId: sec.classId } : null
}
const reachFilter = (p) => ({ $or: [{ sectionIds: p.sectionId }, { sectionIds: { $size: 0 }, classId: p.classId }] })

/** Are the marks of this attempt the student's to see yet? */
const released = (t, a) => a.status !== 'IN_PROGRESS' && (t.results === 'IMMEDIATE' || (t.results === 'AFTER_CLOSE' && (t.status === 'CLOSED' || t.closesAt <= new Date())) || !!t.resultsReleasedAt)

export async function testsFor(f, id) {
  need(f, 'TESTS')
  const s = studentFor(f, id)
  const p = await placeOf(s)
  if (!p) return { tests: [] }
  const tests = await OnlineTest.find({ status: { $in: ['PUBLISHED', 'CLOSED'] }, ...reachFilter(p) }).sort({ opensAt: -1 }).limit(60).lean()
  const attempts = await TestAttempt.find({ studentId: s._id, testId: { $in: tests.map((t) => t._id) } }).sort({ attemptNo: -1 }).lean()
  for (const a of attempts.filter((x) => x.status === 'IN_PROGRESS' && x.deadline < new Date(Date.now() - GRACE_MS))) {
    const doc = await TestAttempt.findById(a._id)
    Object.assign(a, (await finish(doc, tests.find((t) => String(t._id) === String(a.testId)), 'TIME')).toObject())
  }
  const subjects = new Map((await Subject.find({ _id: { $in: tests.map((t) => t.subjectId) } }).select('name').lean()).map((x) => [String(x._id), x.name]))
  const nowMs = Date.now()
  return {
    tests: tests.map((t) => {
      const mine = attempts.filter((a) => String(a.testId) === String(t._id))
      const last = mine[0]
      const open = t.status === 'PUBLISHED' && t.opensAt <= new Date(nowMs) && t.closesAt > new Date(nowMs)
      return {
        id: String(t._id), title: t.title, subject: subjects.get(String(t.subjectId)) ?? '', instructions: t.instructions ?? '', durationMin: t.durationMin, questions: t.questions.length, totalMarks: t.totalMarks,
        opens: t.opens, closes: t.closes, state: t.status === 'CLOSED' || t.closesAt <= new Date(nowMs) ? 'CLOSED' : open ? 'OPEN' : 'LATER',
        attemptsUsed: mine.length, attemptsAllowed: t.attemptsAllowed, inProgress: last?.status === 'IN_PROGRESS' ? String(last._id) : null,
        canStart: open && (last?.status === 'IN_PROGRESS' || mine.length < t.attemptsAllowed),
        last: last && last.status !== 'IN_PROGRESS' ? { id: String(last._id), status: last.status, released: released(t, last), score: released(t, last) ? last.score : null, passed: released(t, last) ? last.passed : null } : null,
      }
    }),
  }
}

async function attemptOf(f, id, attemptId) {
  need(f, 'TESTS')
  const s = studentFor(f, id)
  const a = isOid(attemptId) ? await TestAttempt.findOne({ _id: attemptId, studentId: s._id }) : null
  if (!a) throw notFound('Attempt')
  const t = await OnlineTest.findById(a.testId).lean()
  if (!t) throw notFound('Test')
  if (a.status === 'IN_PROGRESS' && a.deadline < new Date(Date.now() - GRACE_MS)) await finish(a, t, 'TIME')
  return { s, a, t }
}

/** Start (or carry on with) an attempt: inside the window, within the attempts allowed. */
export async function startTest(f, id, testId) {
  need(f, 'TESTS')
  const s = studentFor(f, id)
  const p = await placeOf(s)
  const t = p && isOid(testId) ? await OnlineTest.findOne({ _id: testId, status: 'PUBLISHED', ...reachFilter(p) }).lean() : null
  if (!t) throw notFound('Test')
  const nowD = new Date()
  if (t.opensAt > nowD) throw conflict('This test hasn’t opened yet.', { code: 'LATER' })
  if (t.closesAt <= nowD) throw conflict('This test has closed.', { code: 'CLOSED' })
  const mine = await TestAttempt.find({ testId: t._id, studentId: s._id }).sort({ attemptNo: -1 })
  const open = mine.find((a) => a.status === 'IN_PROGRESS')
  if (open && open.deadline >= new Date(Date.now() - GRACE_MS)) return attemptView(f, id, String(open._id))
  if (open) await finish(open, t, 'TIME')
  if (mine.length >= t.attemptsAllowed) throw conflict('You have used every attempt at this test.', { code: 'NO_ATTEMPTS' })
  const deadline = new Date(Math.min(nowD.getTime() + t.durationMin * 60_000, t.closesAt.getTime()))
  const a = new TestAttempt({ testId: t._id, studentId: s._id, sectionId: s.sectionId, attemptNo: mine.length + 1, startedAt: nowD, deadline })
  a.order = t.shuffleQuestions ? seededOrder(t.questions.length, String(a._id)) : t.questions.map((_, i) => i)
  a.optionOrder = t.shuffleOptions ? Object.fromEntries(t.questions.map((q, i) => [i, q.type === 'TRUE_FALSE' ? [0, 1] : seededOrder(q.options?.length ?? 0, `${a._id}:${i}`)])) : {}
  try { await a.save() } catch (err) { if (err?.code === 11000) throw conflict('This test was just started on another device.'); throw err }
  return attemptView(f, id, String(a._id))
}

/** The paper as the student sees it: their order, no answers, their saved answers and the time left. */
export async function attemptView(f, id, attemptId) {
  const { a, t } = await attemptOf(f, id, attemptId)
  if (a.status !== 'IN_PROGRESS') return { id: String(a._id), status: a.status, submitted: true }
  return {
    id: String(a._id), status: a.status, testTitle: t.title, instructions: t.instructions ?? '', totalMarks: t.totalMarks, durationMin: t.durationMin,
    secondsLeft: Math.max(0, Math.round((a.deadline.getTime() - Date.now()) / 1000)), deadline: a.deadline, proctor: t.proctor, tabSwitches: a.tabSwitches,
    questions: a.order.map((index) => ({ index, ...questionForStudent(t.questions[index], a.optionOrder?.[index]) })),
    answers: a.answers ?? {},
  }
}

/** Save one answer (the app saves as the student goes). */
export async function saveAnswer(f, id, attemptId, { index, value }) {
  const { a, t } = await attemptOf(f, id, attemptId)
  if (a.status !== 'IN_PROGRESS') throw conflict('This attempt is submitted.', { code: 'SUBMITTED' })
  const q = t.questions[index]
  if (!q) throw badRequest('No such question.')
  let v = value
  if (v !== null && v !== undefined && v !== '') {
    if (q.type === 'MCQ' || q.type === 'TRUE_FALSE') { v = Number(v); if (!(v >= 0 && v < (q.options?.length ?? 0))) throw badRequest('Pick one of the options.') }
    else if (q.type === 'MULTI') { v = [...new Set([].concat(v).map(Number))].filter((x) => x >= 0 && x < (q.options?.length ?? 0)) }
    else v = String(v).slice(0, q.type === 'LONG' ? 20000 : 2000)
  } else v = null
  a.answers = { ...(a.answers ?? {}), [index]: v }
  a.markModified('answers')
  await a.save()
  return { saved: true, secondsLeft: Math.max(0, Math.round((a.deadline.getTime() - Date.now()) / 1000)) }
}

/** The app reports leaving the test (switching tab or app, leaving full screen); past the limit it is submitted. */
export async function logEvent(f, id, attemptId, { type }) {
  const { a, t } = await attemptOf(f, id, attemptId)
  if (a.status !== 'IN_PROGRESS') return { submitted: true }
  a.events.push({ type, at: new Date() })
  if (['BLUR', 'FULLSCREEN_EXIT'].includes(type)) a.tabSwitches++
  const max = t.proctor?.maxTabSwitches ?? 0
  if (max > 0 && a.tabSwitches > max) { await finish(a, t, 'PROCTOR'); return { submitted: true, reason: 'PROCTOR' } }
  await a.save()
  return { submitted: false, tabSwitches: a.tabSwitches, left: max > 0 ? max - a.tabSwitches : null }
}

export async function submitAttempt(f, id, attemptId) {
  const { a, t } = await attemptOf(f, id, attemptId)
  if (a.status === 'IN_PROGRESS') await finish(a, t, 'STUDENT')
  return resultView(f, id, attemptId)
}

/** The student's result — once the test's setting lets them see it (with the answers, when it says so). */
export async function resultView(f, id, attemptId) {
  const { a, t } = await attemptOf(f, id, attemptId)
  const base = { id: String(a._id), testTitle: t.title, status: a.status, submittedAt: a.submittedAt, submitReason: a.submitReason, totalMarks: t.totalMarks }
  if (a.status === 'IN_PROGRESS') return { ...base, released: false }
  if (!released(t, a)) return { ...base, released: false, results: t.results, closes: t.closes }
  const r = markAttempt(t.questions, a.answers ?? {}, a.manual ?? {}, { partial: t.partialMarks })
  return {
    ...base, released: true, score: a.score, passed: a.passed, pending: r.pending,
    lines: t.showAnswers ? t.questions.map((q, index) => ({
      index, type: q.type, text: q.text, marks: q.marks, got: r.lines[index].marks, correct: r.lines[index].correct ?? null, pending: !!r.lines[index].pending,
      options: (q.options ?? []).map((o) => ({ text: o.text, correct: !!o.correct })), answers: q.type === 'FILL' ? q.answers : undefined, explanation: q.explanation ?? null,
      yours: a.answers?.[index] ?? null, feedback: a.feedback?.[index] ?? null,
    })) : undefined,
  }
}
