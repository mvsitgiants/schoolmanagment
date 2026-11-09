import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseSyllabusText, spreadUnits, submissionCounts, syllabusProgress, yearPlan } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let year
let cls
let section
let eng
let aarav
let diya
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const add = async (firstName, rollNo, mobile) => (await admin.post('/api/v1/students').send({ firstName, rollNo, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', '1', '9845000041')
  diya = await add('Diya', '2', '9845000042')
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { whatsapp: { provider: 'TEST' }, sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const api = '/api/v1/homework'

describe('helpers', () => {
  it('reads a pasted syllabus into units and topics', () => {
    expect(parseSyllabusText('# Prose\n1. The Last Lesson\n2. Lost Spring\nPoetry:\n- My Mother at Sixty-six')).toEqual([
      { name: 'Prose', topics: [{ name: 'The Last Lesson' }, { name: 'Lost Spring' }] },
      { name: 'Poetry', topics: [{ name: 'My Mother at Sixty-six' }] },
    ])
  })
  it('spreads units over the year by their topics, and reads the plan against a month', () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
    const units = spreadUnits([{ id: 'a', topics: [{ id: 'a1' }, { id: 'a2' }] }, { id: 'b', topics: [{ id: 'b1' }] }, { id: 'c', topics: [] }], months)
    expect(units.map((u) => [u.fromMonth, u.toMonth])).toEqual([['2026-04', '2026-06'], ['2026-07', '2026-08'], ['2026-09', '2026-09']])
    units[0].topics[1].month = '2026-07' // a topic's own month wins over its unit's
    const plan = yearPlan(units, ['a1'], '2026-07')
    expect(plan.byMonth['2026-06'].map((r) => r.topicId)).toEqual(['a1'])
    expect(plan).toMatchObject({ planned: 3, behind: [], due: [expect.objectContaining({ topicId: 'a2' })] })
    const later = yearPlan(units, [], '2026-08')
    expect(later.behind.map((r) => r.topicId)).toEqual(['a1', 'a2'])
    expect(later.due.map((r) => r.topicId)).toEqual(['b1'])
  })
  it('counts progress and submissions', () => {
    expect(syllabusProgress([{ id: 'u', topics: [{ id: 'a' }, { id: 'b' }] }], ['a']).pct).toBe(50)
    expect(submissionCounts([{ status: 'CHECKED' }, { status: 'MISSING' }], 3)).toMatchObject({ handedIn: 1, MISSING: 1, PENDING: 1, total: 3 })
  })
})

describe('syllabus and lesson plans', () => {
  it('lists the sections and the subjects the caller may pick', async () => {
    const look = (await admin.get(`${api}/lookup`)).body.data
    const s = look.sections.find((x) => x.id === section.id)
    eng = s.subjects.find((x) => x.name === 'English')
    expect(eng).toBeTruthy()
  })

  let units
  it('saves a syllabus and ticks topics per section', async () => {
    const saved = (await admin.put(`${api}/syllabus`).send({ classId: cls.id, subjectId: eng.id, units: [
      { name: 'Prose', topics: [{ name: 'The Last Lesson' }, { name: 'Lost Spring' }] },
      { name: 'Poetry', topics: [{ name: 'My Mother at Sixty-six' }] },
    ] })).body.data
    units = saved.units
    expect(saved.sections[0]).toMatchObject({ topics: 3, done: 0 })
    const ticked = (await admin.post(`${api}/syllabus/progress`).send({ sectionId: section.id, subjectId: eng.id, topicIds: [units[0].topics[0].id], date: year.startDate })).body.data
    expect(ticked.sections[0]).toMatchObject({ done: 1, pct: 33 })
  })

  it('keeps ticks when the syllabus is edited, drops them with a removed topic', async () => {
    const kept = (await admin.put(`${api}/syllabus`).send({ classId: cls.id, subjectId: eng.id, units: [
      { id: units[0].id, name: 'Prose (Flamingo)', topics: [{ id: units[0].topics[0].id, name: 'The Last Lesson' }, { name: 'Deep Water' }] },
    ] })).body.data
    expect(kept.sections[0]).toMatchObject({ topics: 2, done: 1 })
    const dropped = (await admin.put(`${api}/syllabus`).send({ classId: cls.id, subjectId: eng.id, units: [{ id: kept.units[0].id, name: 'Prose', topics: [{ id: kept.units[0].topics[1].id, name: 'Deep Water' }] }] })).body.data
    expect(dropped.sections[0].done).toBe(0)
    units = dropped.units
  })

  it('a lesson plan marked taught ticks its topics', async () => {
    const plan = (await admin.post(`${api}/lesson-plans`).send({ sectionId: section.id, subjectId: eng.id, date: year.startDate, title: 'Deep Water — reading', topicIds: [units[0].topics[0].id] })).body.data
    expect(plan.status).toBe('PLANNED')
    expect(plan.topics).toEqual(['Deep Water'])
    await admin.post(`${api}/lesson-plans/${plan.id}/status`).send({ status: 'DONE', reflection: 'Went well' }).expect(200)
    const syl = (await admin.get(`${api}/syllabus?classId=${cls.id}&subjectId=${eng.id}`)).body.data
    expect(syl.sections[0].ticks[units[0].topics[0].id]).toMatchObject({ fromPlan: true })
    const week = (await admin.get(`${api}/lesson-plans?from=${year.startDate}&to=${year.startDate}`)).body.data
    expect(week).toMatchObject({ total: 1, page: 1, counts: { DONE: 1 } })
    expect(week.rows).toHaveLength(1)
    const month = (await admin.get(`${api}/lesson-plans/calendar?from=${year.startDate}&to=${year.startDate}`)).body.data
    expect(month).toEqual([expect.objectContaining({ date: year.startDate, total: 1, counts: expect.objectContaining({ DONE: 1 }), plans: [expect.objectContaining({ id: plan.id })] })])
  })
})

describe('homework', () => {
  let hw
  it('refuses a due date before the day it is set', async () => {
    const res = await admin.post(api).send({ sectionIds: [section.id], subjectId: eng.id, title: 'Read chapter 1', setDate: year.startDate, dueDate: '2000-01-01' })
    expect(res.status).toBe(400)
  })

  it('sets homework and tells the families', async () => {
    const res = (await admin.post(api).send({ sectionIds: [section.id], subjectId: eng.id, title: 'Answer the questions on page 12', setDate: year.startDate, dueDate: year.startDate, notify: true })).body.data
    expect(res).toMatchObject({ created: 1, notified: 2 })
    hw = res.ids[0]
    const msgs = await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'homework.assigned' }))
    expect(msgs).toBeGreaterThan(0)
  })

  it('records who handed it in', async () => {
    const done = (await admin.put(`${api}/${hw}/submissions`).send({ entries: [{ studentId: aarav.id, status: 'CHECKED', remark: 'Neat' }, { studentId: diya.id, status: 'MISSING' }] })).body.data
    expect(done.counts).toMatchObject({ CHECKED: 1, MISSING: 1, handedIn: 1, total: 2 })
    const list = (await admin.get(`${api}?sectionId=${section.id}`)).body
    expect(list.data[0].counts.handedIn).toBe(1)
    expect(list.meta.total).toBe(1)
  })
})

describe('year plan', () => {
  it('saves months on units and topics, and counts topics behind once their month is over', async () => {
    const first = year.startDate.slice(0, 7)
    const bad = await admin.put(`${api}/syllabus`).send({ classId: cls.id, subjectId: eng.id, units: [{ name: 'Prose', fromMonth: '1999-01', topics: [{ name: 'X' }] }] })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields['units.0.fromMonth']).toBeTruthy()
    const saved = (await admin.put(`${api}/syllabus`).send({ classId: cls.id, subjectId: eng.id, units: [
      { name: 'Prose', fromMonth: first, toMonth: first, topics: [{ name: 'Deep Water' }, { name: 'The Rattrap', month: first }] },
      { name: 'Poetry', topics: [{ name: 'Keeping Quiet' }] }, // not planned
    ] })).body.data
    expect(saved.units[0]).toMatchObject({ fromMonth: first, toMonth: first })
    expect(saved.units[0].topics[1].month).toBe(first)
    expect(saved.months[0]).toBe(first)
    const pastFirst = saved.month > first
    expect(saved.sections[0]).toMatchObject({ behind: pastFirst ? 2 : 0, due: pastFirst ? 0 : 2 })
    // ticking one off takes it out of “behind”
    const ticked = (await admin.post(`${api}/syllabus/progress`).send({ sectionId: section.id, subjectId: eng.id, topicIds: [saved.units[0].topics[0].id] })).body.data
    expect(ticked.sections[0].behind + ticked.sections[0].due).toBe(1)
    const row = (await admin.get(`${api}/syllabus/overview`)).body.data.rows.find((r) => r.classId === cls.id && r.subjectId === eng.id)
    expect(row.planned).toBe(2)
    expect(row.sections[0].behind + row.sections[0].due).toBe(1)
  })
})

describe('my teaching', () => {
  let teacher
  let tc
  beforeAll(async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    teacher = (await admin.post('/api/v1/core/users').send({ name: 'Meera Teacher', email: 'meera@hw.test', roleIds: [tpl.id], password: 'Teach@123' })).body.data.user
    await admin.put('/api/v1/academics/allocation').send({ sectionId: section.id, subjectId: eng.id, teacherId: teacher.id }).expect(200)
    tc = await signIn(app, 'meera@hw.test', 'Teach@123')
  })

  it('shows only the teacher’s own class × subject, with the year plan', async () => {
    const me = (await tc.get(`${api}/me`)).body.data
    expect(me.classes).toEqual([expect.objectContaining({ sectionId: section.id, subjectId: eng.id, planned: 2, classTeacher: false, allocated: true })])
    expect(me.classes[0].behind + me.classes[0].due).toBe(1)
    // the administrator teaches nothing, so has no classes of their own here
    expect((await admin.get(`${api}/me`)).body.data.classes).toEqual([])
  })

  it('lists this week’s own lesson plans and homework still to check', async () => {
    const before = (await tc.get(`${api}/me`)).body.data
    const plan = (await tc.post(`${api}/lesson-plans`).send({ sectionId: section.id, subjectId: eng.id, date: before.today, title: 'The Rattrap — reading' })).body.data
    await admin.post(`${api}/lesson-plans`).send({ sectionId: section.id, subjectId: eng.id, date: before.today, title: 'Someone else’s plan' }).expect(201)
    const hw = (await tc.post(api).send({ sectionIds: [section.id], subjectId: eng.id, title: 'Summarise the story', setDate: before.today, dueDate: before.today })).body.data
    const me = (await tc.get(`${api}/me`)).body.data
    expect(me.plans.map((p) => p.id)).toEqual([plan.id])
    expect(me.toCheck).toEqual([expect.objectContaining({ id: hw.ids[0], counts: expect.objectContaining({ PENDING: 2 }) })])
    // once everyone is recorded it drops off the list
    await tc.put(`${api}/${hw.ids[0]}/submissions`).send({ entries: [{ studentId: aarav.id, status: 'CHECKED' }, { studentId: diya.id, status: 'MISSING' }] }).expect(200)
    expect((await tc.get(`${api}/me`)).body.data.toCheck).toEqual([])
    // the lesson plans list can be narrowed to one's own
    const mine = (await admin.get(`${api}/lesson-plans?from=${before.today}&to=${before.today}&mine=1`)).body.data
    expect(mine.rows.map((p) => p.title)).toEqual(['Someone else’s plan'])
    expect(mine.total).toBe(1)
  })
})
