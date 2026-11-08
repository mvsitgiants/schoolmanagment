import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { markAttempt, questionForStudent, seededOrder } from '@schoolgiant/shared'
import { MessagingConfig } from '../src/models/engines.js'
import { TestAttempt } from '../src/models/onlineTests.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { sweepExpired } from '../src/services/onlineTests.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let cls
let section
let subject
let student
let qs = []
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  subject = (await admin.get('/api/v1/lms/lookup')).body.data.sections.find((s) => s.id === section.id).subjects[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Rohan', sectionId: section.id, guardians: [{ name: 'Parent Rohan', relation: 'FATHER', mobile: '9845000501', isPrimary: true }] })).body.data
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
  const add = async (body) => (await admin.post('/api/v1/lms/questions').send({ subjectId: subject.id, classId: cls.id, ...body })).body.data
  qs = [
    await add({ type: 'MCQ', text: 'SI unit of force', options: [{ text: 'Joule' }, { text: 'Newton', correct: true }, { text: 'Watt' }], marks: 1, negative: 0.25 }),
    await add({ type: 'MULTI', text: 'Vector quantities', options: [{ text: 'Velocity', correct: true }, { text: 'Speed' }, { text: 'Force', correct: true }], marks: 2 }),
    await add({ type: 'FILL', text: 'Unit of power: the ____', answers: ['watt', 'W'], marks: 1 }),
    await add({ type: 'LONG', text: 'State Newton’s three laws with examples.', marks: 6 }),
  ]
})
afterAll(stopDb)

const api = '/api/v1/online-tests'
const fam = (path) => `/api/v1/family/${h.tenant.slug}${path}`
async function familyAgent() {
  const agent = request.agent(app)
  const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000501' })).body.data
  await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
  return agent
}

describe('helpers', () => {
  it('shuffles the same way for the same seed, hides answers, and marks', () => {
    expect(seededOrder(6, 'a1')).toEqual(seededOrder(6, 'a1'))
    expect([...seededOrder(6, 'a1')].sort()).toEqual([0, 1, 2, 3, 4, 5])
    const q = { type: 'MCQ', text: 'x', marks: 1, options: [{ text: 'a', correct: true }, { text: 'b' }], explanation: 'because' }
    const shown = questionForStudent(q, [1, 0])
    expect(shown.options).toEqual([{ i: 1, text: 'b' }, { i: 0, text: 'a' }])
    expect(JSON.stringify(shown)).not.toContain('correct')
    expect(JSON.stringify(shown)).not.toContain('because')
    const r = markAttempt([q, { type: 'SHORT', marks: 3 }], { 0: 0, 1: 'answer' }, { 1: 2 })
    expect(r).toMatchObject({ total: 3, pending: 0 })
  })
})

describe('a test from the bank', () => {
  let test
  let t
  it('is set up, filled from the bank and published', async () => {
    t = await runAsTenant(h.tenant._id, () => institutionNow())
    test = (await admin.post(`${api}/tests`).send({
      title: 'Unit test — Laws of motion', classId: cls.id, subjectId: subject.id, sectionIds: [section.id], durationMin: 20,
      opens: { date: addDays(t.date, -1), time: '00:00' }, closes: { date: addDays(t.date, 1), time: '23:00' }, results: 'IMMEDIATE', proctor: { maxTabSwitches: 2 },
    })).body.data
    expect((await admin.post(`${api}/tests/${test.id}/publish`).send({})).status).toBe(400) // no questions yet
    test = (await admin.post(`${api}/tests/${test.id}/questions`).send({ questionIds: qs.slice(0, 3).map((q) => q.id) })).body.data
    const picked = (await admin.post(`${api}/tests/${test.id}/questions/pick`).send({ count: 5, type: 'LONG' })).body.data
    expect(picked.picked).toBe(1)
    expect(picked.totalMarks).toBe(10)
    const pub = (await admin.post(`${api}/tests/${test.id}/publish`).send({ notify: true })).body.data
    expect(pub).toMatchObject({ status: 'PUBLISHED', told: 1 })
    // the questions are fixed now
    expect((await admin.post(`${api}/tests/${test.id}/questions`).send({ questionIds: [qs[0].id] })).status).toBe(409)
  })

  let attempt
  it('the student starts it, sees no answers, saves answers as they go and submits', async () => {
    const agent = await familyAgent()
    const list = (await agent.get(fam(`/students/${student.id}/tests`))).body.data.tests
    expect(list[0]).toMatchObject({ state: 'OPEN', canStart: true })
    attempt = (await agent.post(fam(`/students/${student.id}/tests/${test.id}/start`))).body.data
    expect(attempt.questions).toHaveLength(4)
    expect(attempt.secondsLeft).toBeGreaterThan(1100)
    expect(JSON.stringify(attempt.questions)).not.toMatch(/"correct"|watt/)
    // starting again carries on with the same attempt
    expect((await agent.post(fam(`/students/${student.id}/tests/${test.id}/start`))).body.data.id).toBe(attempt.id)
    const byText = (s) => attempt.questions.find((q) => q.text.startsWith(s))
    const mcq = byText('SI unit')
    const multi = byText('Vector')
    await agent.put(fam(`/students/${student.id}/attempts/${attempt.id}/answers`)).send({ index: mcq.index, value: mcq.options.find((o) => o.text === 'Newton').i }).expect(200)
    await agent.put(fam(`/students/${student.id}/attempts/${attempt.id}/answers`)).send({ index: multi.index, value: multi.options.filter((o) => o.text !== 'Speed').map((o) => o.i) }).expect(200)
    await agent.put(fam(`/students/${student.id}/attempts/${attempt.id}/answers`)).send({ index: byText('Unit of power').index, value: ' Watt ' }).expect(200)
    await agent.put(fam(`/students/${student.id}/attempts/${attempt.id}/answers`)).send({ index: byText('State Newton').index, value: 'First law: inertia…' }).expect(200)
    // leaving the test is counted
    expect((await agent.post(fam(`/students/${student.id}/attempts/${attempt.id}/events`)).send({ type: 'BLUR' })).body.data).toMatchObject({ tabSwitches: 1, left: 1 })
    const result = (await agent.post(fam(`/students/${student.id}/attempts/${attempt.id}/submit`))).body.data
    expect(result).toMatchObject({ released: true, status: 'SUBMITTED', pending: 1 })
    expect(result.score.total).toBe(4) // 1 + 2 + 1, the long answer waits for the teacher
    // nothing more can be saved, and no second attempt
    expect((await agent.put(fam(`/students/${student.id}/attempts/${attempt.id}/answers`)).send({ index: 0, value: 1 })).status).toBe(409)
    expect((await agent.post(fam(`/students/${student.id}/tests/${test.id}/start`))).status).toBe(409)
  })

  it('the teacher marks the long answer; the result and the question analysis follow', async () => {
    const view = (await admin.get(`${api}/tests/${test.id}/attempts`)).body.data
    expect(view.stats).toMatchObject({ attempted: 1, toEvaluate: 1 })
    const detail = (await admin.get(`${api}/attempts/${attempt.id}`)).body.data
    const long = detail.lines.find((l) => l.type === 'LONG')
    expect(long.pending).toBe(true)
    expect((await admin.post(`${api}/attempts/${attempt.id}/evaluate`).send({ manual: { [long.index]: 9 } })).status).toBe(400) // more than the marks
    const marked = (await admin.post(`${api}/attempts/${attempt.id}/evaluate`).send({ manual: { [long.index]: 5 }, feedback: { [long.index]: 'Good examples' } })).body.data
    expect(marked).toMatchObject({ status: 'EVALUATED', score: { total: 9, pct: 90 }, passed: true })
    const after = (await admin.get(`${api}/tests/${test.id}/attempts`)).body.data
    expect(after.questions.find((q) => q.type === 'MCQ').pct).toBe(100)
    const csv = await admin.get(`${api}/tests/${test.id}/attempts/export`)
    expect(csv.text).toContain('Rohan')
  })
})

describe('time limits and proctoring', () => {
  it('an attempt left open past its deadline is submitted; leaving too often submits it', async () => {
    const t = await runAsTenant(h.tenant._id, () => institutionNow())
    const mk = async (title, proctor) => {
      const x = (await admin.post(`${api}/tests`).send({ title, classId: cls.id, subjectId: subject.id, durationMin: 10, opens: { date: addDays(t.date, -1), time: '00:00' }, closes: { date: addDays(t.date, 1), time: '23:00' }, proctor })).body.data
      await admin.post(`${api}/tests/${x.id}/questions`).send({ questionIds: [qs[0].id] }).expect(200)
      await admin.post(`${api}/tests/${x.id}/publish`).send({}).expect(200)
      return x
    }
    const timed = await mk('Quick quiz')
    const strict = await mk('Strict quiz', { maxTabSwitches: 1 })
    const agent = await familyAgent()
    const a1 = (await agent.post(fam(`/students/${student.id}/tests/${timed.id}/start`))).body.data
    await runAsTenant(h.tenant._id, () => TestAttempt.updateOne({ _id: a1.id }, { $set: { deadline: new Date(Date.now() - 60_000) } }))
    expect((await agent.put(fam(`/students/${student.id}/attempts/${a1.id}/answers`)).send({ index: 0, value: 1 })).status).toBe(409)
    const saved = await runAsTenant(h.tenant._id, () => TestAttempt.findById(a1.id).lean())
    expect(saved).toMatchObject({ status: 'EVALUATED', submitReason: 'TIME' })
    const a2 = (await agent.post(fam(`/students/${student.id}/tests/${strict.id}/start`))).body.data
    await agent.post(fam(`/students/${student.id}/attempts/${a2.id}/events`)).send({ type: 'BLUR' }).expect(200)
    const out = (await agent.post(fam(`/students/${student.id}/attempts/${a2.id}/events`)).send({ type: 'FULLSCREEN_EXIT' })).body.data
    expect(out).toMatchObject({ submitted: true, reason: 'PROCTOR' })
    expect(await sweepExpired()).toBe(0)
  })
})
