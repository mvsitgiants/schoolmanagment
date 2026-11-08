import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { checkQuestion, courseProgress, joinWindow, scoreAnswer, videoEmbed } from '@schoolgiant/shared'
import { MessagingConfig } from '../src/models/engines.js'
import { LiveClass } from '../src/models/lms.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let cls
let section
let physics
let student
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const look = (await admin.get('/api/v1/lms/lookup')).body.data
  physics = look.sections.find((s) => s.id === section.id).subjects[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Meera', sectionId: section.id, guardians: [{ name: 'Parent Meera', relation: 'MOTHER', mobile: '9845000401', isPrimary: true }] })).body.data
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
})
afterAll(stopDb)

const api = '/api/v1/lms'
const fam = (path) => `/api/v1/family/${h.tenant.slug}${path}`
async function familyAgent() {
  const agent = request.agent(app)
  const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000401' })).body.data
  await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
  return agent
}

describe('helpers', () => {
  it('embeds YouTube and Vimeo, counts progress, opens the join window', () => {
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbed('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789')
    expect(videoEmbed('https://example.com/a.mp4')).toBeNull()
    expect(courseProgress([{ items: [{ id: 'a' }, { id: 'b' }, { id: 'c', published: false }] }], ['a'])).toEqual({ done: 1, total: 2, pct: 50 })
    const at = { date: '2026-11-09', start: '10:00', durationMin: 40 }
    expect(joinWindow(at, { date: '2026-11-09', time: '09:45' }).open).toBe(false)
    expect(joinWindow(at, { date: '2026-11-09', time: '09:52' }).open).toBe(true)
    expect(joinWindow(at, { date: '2026-11-09', time: '10:41' })).toMatchObject({ open: false, reason: 'OVER' })
  })
  it('checks and marks questions', () => {
    const mcq = { type: 'MCQ', text: 'SI unit of force?', marks: 1, negative: 0.25, options: [{ text: 'Joule' }, { text: 'Newton', correct: true }] }
    expect(checkQuestion(mcq)).toEqual({})
    expect(checkQuestion({ ...mcq, options: [{ text: 'Joule', correct: true }, { text: 'Newton', correct: true }] })).toHaveProperty('options')
    expect(scoreAnswer(mcq, 1)).toEqual({ marks: 1, correct: true })
    expect(scoreAnswer(mcq, 0)).toEqual({ marks: -0.25, correct: false })
    expect(scoreAnswer({ type: 'FILL', marks: 2, answers: ['photosynthesis'] }, '  Photosynthesis ')).toEqual({ marks: 2, correct: true })
    expect(scoreAnswer({ type: 'LONG', marks: 5 }, 'essay')).toBeNull()
  })
})

describe('courses', () => {
  let course
  it('a teacher makes a course, lays out units and items, and publishes it', async () => {
    course = (await admin.post(`${api}/courses`).send({ title: 'Physics — Class 11', classId: cls.id, subjectId: physics.id, sectionIds: [section.id] })).body.data
    expect(course).toMatchObject({ status: 'DRAFT', units: [expect.objectContaining({ title: 'Unit 1' })] })
    const bad = await admin.put(`${api}/courses/${course.id}/outline`).send({ units: [{ title: 'Motion', items: [{ kind: 'VIDEO', title: 'Lecture', url: 'not a url' }] }] })
    expect(bad.status).toBe(400)
    course = (await admin.put(`${api}/courses/${course.id}/outline`).send({ units: [
      { id: course.units[0].id, title: 'Motion in a straight line', items: [
        { kind: 'NOTE', title: 'Key ideas', body: 'Speed is distance over time.' },
        { kind: 'VIDEO', title: 'Lecture 1', url: 'https://youtu.be/dQw4w9WgXcQ' },
        { kind: 'LINK', title: 'PhET simulation', url: 'https://phet.colorado.edu' },
        { kind: 'NOTE', title: 'Teacher’s draft', body: 'not yet', published: false },
      ] },
    ] })).body.data
    expect(course.units[0].items).toHaveLength(4)
    const keep = course.units[0].items[0].id
    // saving again keeps the item ids
    const again = (await admin.put(`${api}/courses/${course.id}/outline`).send({ units: course.units })).body.data
    expect(again.units[0].items[0].id).toBe(keep)
    await admin.post(`${api}/courses/${course.id}/status`).send({ status: 'PUBLISHED' }).expect(200)
  })

  it('the student sees the published items, ticks one off, and the teacher sees the progress', async () => {
    const agent = await familyAgent()
    const learning = (await agent.get(fam(`/students/${student.id}/learning`))).body.data
    expect(learning.courses).toHaveLength(1)
    expect(learning.courses[0]).toMatchObject({ total: 3, done: 0 })
    const view = (await agent.get(fam(`/students/${student.id}/learning/courses/${course.id}`))).body.data
    expect(view.units[0].items.map((i) => i.title)).not.toContain('Teacher’s draft')
    expect(view.units[0].items.find((i) => i.kind === 'VIDEO').embed).toMatch(/youtube-nocookie/)
    const ticked = (await agent.post(fam(`/students/${student.id}/learning/courses/${course.id}/items/${view.units[0].items[0].id}`)).send({ done: true })).body.data
    expect(ticked).toMatchObject({ done: 1, pct: 33 })
    const report = (await admin.get(`${api}/courses/${course.id}/progress`)).body.data
    expect(report.rows.find((r) => r.studentId === student.id)).toMatchObject({ done: 1, pct: 33 })
    // a course with progress can't be deleted — only archived
    expect((await admin.delete(`${api}/courses/${course.id}`)).status).toBe(409)
  })
})

describe('live classes', () => {
  it('scheduled on Jitsi with a room of its own; students join only when it opens, and the join is recorded', async () => {
    const t = await runAsTenant(h.tenant._id, () => institutionNow())
    const live = (await admin.post(`${api}/live`).send({ title: 'Doubt clearing', classId: cls.id, subjectId: physics.id, sectionIds: [section.id], date: t.date, start: '23:59', durationMin: 30, notify: true })).body.data
    expect(live.link).toMatch(/^https:\/\/meet\.jit\.si\/SchoolGiant-/)
    expect(live.told).toBe(1)
    expect((await admin.post(`${api}/live`).send({ title: 'Zoom', classId: cls.id, date: t.date, start: '10:00', provider: 'ZOOM' })).status).toBe(400)
    const agent = await familyAgent()
    const list = (await agent.get(fam(`/students/${student.id}/learning`))).body.data.live
    expect(list.map((l) => l.id)).toContain(live.id)
    // not open yet (unless the test runs in the last minutes of the day)
    if (t.time < '23:45') expect((await agent.post(fam(`/students/${student.id}/learning/live/${live.id}/join`))).status).toBe(409)
    await admin.post(`${api}/live/${live.id}/start`).expect(200)
    const join = (await agent.post(fam(`/students/${student.id}/learning/live/${live.id}/join`))).body.data
    expect(join.url).toBe(live.link)
    await agent.post(fam(`/students/${student.id}/learning/live/${live.id}/join`)).expect(200) // twice: counted once
    const att = (await admin.get(`${api}/live/${live.id}/attendance`)).body.data
    expect(att).toMatchObject({ joined: 1, total: 1 })
    const ended = (await admin.post(`${api}/live/${live.id}/end`).send({ recordingUrl: 'https://youtu.be/dQw4w9WgXcQ' })).body.data
    expect(ended.status).toBe('ENDED')
    const saved = await runAsTenant(h.tenant._id, () => LiveClass.findById(live.id).lean())
    expect(saved.joins).toHaveLength(1)
  })
})

describe('question bank', () => {
  it('adds, imports (with a dry run) and switches off rather than deletes a used question', async () => {
    const q = (await admin.post(`${api}/questions`).send({ subjectId: physics.id, classId: cls.id, chapter: 'Laws of motion', type: 'MCQ', text: 'The SI unit of force is', options: [{ text: 'Joule' }, { text: 'Newton', correct: true }, { text: 'Watt' }], marks: 1, difficulty: 'EASY' })).body.data
    expect(q.typeLabel).toMatch(/one answer/)
    expect((await admin.post(`${api}/questions`).send({ subjectId: physics.id, type: 'MCQ', text: 'No answer marked', options: [{ text: 'a' }, { text: 'b' }] })).status).toBe(400)
    const rows = [
      { subject: physics.name, class: '11', chapter: 'Laws of motion', type: 'TRUE_FALSE', question: 'Inertia depends on mass.', answer: 'True', marks: 1 },
      { subject: physics.name, class: '11', chapter: 'Work and energy', type: 'FILL', question: 'The unit of power is the ____.', answer: 'watt|W', marks: 1 },
      { subject: 'Astrology', type: 'MCQ', question: 'Bad row', option1: 'x', option2: 'y', answer: '1' },
    ]
    const dry = (await admin.post(`${api}/questions/import`).send({ rows, dryRun: true })).body.data
    expect(dry.rows.map((r) => r.errors.length)).toEqual([0, 0, 1])
    const done = (await admin.post(`${api}/questions/import`).send({ rows, dryRun: false })).body.data
    expect(done.imported).toBe(2)
    const list = (await admin.get(`${api}/questions?subjectId=${physics.id}`)).body
    expect(list.meta.total).toBe(3)
    expect(list.chapters).toEqual(['Laws of motion', 'Work and energy'])
    await admin.delete(`${api}/questions/${q.id}`).expect(200)
    expect((await admin.get(`${api}/questions?subjectId=${physics.id}`)).body.meta.total).toBe(2)
  })
})
