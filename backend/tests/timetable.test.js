import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_BELL, checkBell, findClashes, generateTimetable, teachingPeriods, weekdayCode } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let section
let section2
let grid
let teachersList = []
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 2, addSubjects: true }).expect(201)
  const cls = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '11')
  ;[section, section2] = cls.sections
  const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
  for (const [i, name] of ['Anil', 'Bina', 'Chitra', 'Dev'].entries()) {
    teachersList.push((await admin.post('/api/v1/core/users').send({ name: `${name} Teacher`, email: `t${i}@tt.test`, roleIds: [tpl.id], password: 'Teach@123' })).body.data.user)
  }
  grid = (await admin.get(`/api/v1/academics/allocation?classId=${cls.id}`)).body.data
  // four subjects a section, 6 periods a week each, split over the teachers
  const subjects = grid.subjects.slice(0, 4)
  for (const s of [section, section2]) {
    for (const [i, sub] of subjects.entries()) {
      await admin.put('/api/v1/academics/allocation').send({ sectionId: s.id, subjectId: sub.id, teacherId: teachersList[i].id, periodsPerWeek: 6 }).expect(200)
    }
  }
})
afterAll(stopDb)

const api = '/api/v1/timetable'

describe('helpers', () => {
  it('reads a bell schedule', () => {
    expect(teachingPeriods(DEFAULT_BELL)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(checkBell(DEFAULT_BELL)).toEqual({})
    expect(checkBell([{ no: 1, kind: 'PERIOD', start: '09:00', end: '08:00' }])).toHaveProperty('slots.0.end')
    expect(checkBell([{ no: 1, kind: 'PERIOD', start: '08:00', end: '08:40' }, { no: 1, kind: 'PERIOD', start: '08:30', end: '09:10' }])).toMatchObject({ 'slots.1.start': expect.any(String), 'slots.1.no': expect.any(String) })
  })

  it('generates a week with no teacher in two places, the same every time', () => {
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI']
    const periods = { a: [1, 2, 3, 4, 5, 6], b: [1, 2, 3, 4, 5, 6] }
    const lessons = ['a', 'b'].flatMap((s) => [
      { sectionId: s, subjectId: 'm', teacherId: 'T1', count: 6 },
      { sectionId: s, subjectId: 'e', teacherId: 'T2', count: 6 },
      { sectionId: s, subjectId: 'p', teacherId: 'T3', count: 4, lab: true },
    ])
    const one = generateTimetable({ days, periods, lessons, labs: ['LAB1'], seed: 7 })
    const two = generateTimetable({ days, periods, lessons, labs: ['LAB1'], seed: 7 })
    expect(one.placed).toBe(32)
    expect(one.unplaced).toEqual([])
    expect(findClashes(one.entries, { labs: ['LAB1'] })).toEqual([])
    expect(two.entries).toEqual(one.entries)
    // never more than two of a subject in a day
    const perDay = {}
    for (const e of one.entries) perDay[`${e.sectionId}${e.subjectId}${e.day}`] = (perDay[`${e.sectionId}${e.subjectId}${e.day}`] ?? 0) + 1
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2)
  })

  it('keeps locked cells and respects blocked periods', () => {
    const r = generateTimetable({
      days: ['MON', 'TUE'], periods: { a: [1, 2, 3] },
      lessons: [{ sectionId: 'a', subjectId: 'm', teacherId: 'T1', count: 3 }],
      locked: [{ sectionId: 'a', day: 'MON', period: 1, subjectId: 'm', teacherId: 'T1' }],
      blocked: [{ teacherId: 'T1', day: 'TUE', period: 1 }],
    })
    expect(r.entries).toContainEqual(expect.objectContaining({ day: 'MON', period: 1, locked: true }))
    expect(r.entries.filter((e) => e.day === 'TUE' && e.period === 1)).toEqual([])
    expect(r.placed).toBe(3)
  })

  it('reports what does not fit', () => {
    const r = generateTimetable({ days: ['MON'], periods: { a: [1, 2] }, lessons: [{ sectionId: 'a', subjectId: 'm', teacherId: 'T1', count: 3 }], rules: { maxSamePerDay: 3 } })
    expect(r.unplaced).toEqual([{ sectionId: 'a', subjectId: 'm', teacherId: 'T1', missing: 1 }])
  })
})

describe('bell schedules and rooms', () => {
  it('starts with a default bell schedule and refuses a broken one', async () => {
    const bells = (await admin.get(`${api}/bells`)).body.data
    expect(bells).toHaveLength(1)
    expect(bells[0]).toMatchObject({ isDefault: true, periods: [1, 2, 3, 4, 5, 6, 7, 8] })
    const bad = await admin.post(`${api}/bells`).send({ name: 'Broken', slots: [{ no: 1, kind: 'PERIOD', start: '09:00', end: '08:00' }] })
    expect(bad.status).toBe(400)
    expect((await admin.delete(`${api}/bells/${bells[0].id}`)).status).toBe(409)
  })

  let lab
  it('adds rooms; a section has one home room', async () => {
    const home = (await admin.post(`${api}/rooms`).send({ name: 'Room 11A', code: 'R11A', sectionId: section.id })).body.data
    expect(home).toMatchObject({ kind: 'CLASSROOM', sectionId: section.id })
    expect((await admin.post(`${api}/rooms`).send({ name: 'Another', sectionId: section.id })).status).toBe(400)
    lab = (await admin.post(`${api}/rooms`).send({ name: 'Physics lab', code: 'PLAB', kind: 'LAB', capacity: 40 })).body.data
    expect((await admin.get(`${api}/rooms`)).body.data.map((r) => r.code).sort()).toEqual(['PLAB', 'R11A'])
    expect(lab.kind).toBe('LAB')
  })
})

describe('draft, generate, edit, publish', () => {
  let draft
  it('starts a draft and generates the week from the allocations', async () => {
    const ov = (await admin.post(`${api}/draft`).send({})).body.data
    draft = ov.draft
    expect(draft).toMatchObject({ version: 1, status: 'DRAFT', entries: 0 })
    const gen = (await admin.post(`${api}/${draft.id}/generate`).send({})).body.data
    expect(gen.wanted).toBe(48)
    expect(gen.placed).toBe(48)
    expect(gen.unplaced).toEqual([])
  })

  it('shows a section’s week and a teacher’s week', async () => {
    const g = (await admin.get(`${api}/${draft.id}/grid?view=section&of=${section.id}`)).body.data
    const cells = Object.values(g.cells).flatMap((d) => Object.values(d))
    expect(cells).toHaveLength(24)
    expect(cells.every((c) => ['R11A', 'PLAB'].includes(c.room))).toBe(true)
    const t = (await admin.get(`${api}/${draft.id}/grid?view=teacher&of=${teachersList[0].id}`)).body.data
    expect(Object.values(t.cells).flatMap((d) => Object.values(d))).toHaveLength(12)
    const load = (await admin.get(`${api}/${draft.id}/load`)).body.data
    expect(load.find((l) => l.teacherId === teachersList[0].id)).toMatchObject({ periods: 12, wanted: 12 })
  })

  it('refuses a cell that double-books a teacher; a hand-set cell is locked and kept', async () => {
    const g = (await admin.get(`${api}/${draft.id}/grid?view=section&of=${section2.id}`)).body.data
    const [day] = Object.keys(g.cells)
    const [period] = Object.keys(g.cells[day]).map(Number)
    const busy = g.cells[day][period].teacherId
    // putting that teacher in the other section at the same time clashes
    const clash = await admin.put(`${api}/${draft.id}/cell`).send({ sectionId: section.id, day, period, subjectId: g.cells[day][period].subjectId, teacherId: busy })
    expect(clash.status).toBe(409)
    // locking the other section's cell keeps it across a new run
    const own = (await admin.get(`${api}/${draft.id}/grid?view=section&of=${section.id}`)).body.data.cells[day][period]
    await admin.put(`${api}/${draft.id}/cell`).send({ sectionId: section.id, day, period, subjectId: own.subjectId, teacherId: own.teacherId, roomId: own.roomId }).expect(200)
    await admin.post(`${api}/${draft.id}/generate`).send({ seed: 99 }).expect(200)
    const after = (await admin.get(`${api}/${draft.id}/grid?view=section&of=${section.id}`)).body.data.cells[day][period]
    expect(after).toMatchObject({ teacherId: own.teacherId, subjectId: own.subjectId, locked: true })
  })

  it('publishes; the next draft starts as a copy and publishing it archives the first', async () => {
    const pub = (await admin.post(`${api}/${draft.id}/publish`).send({ effectiveFrom: '2026-06-01' })).body.data
    expect(pub.published).toMatchObject({ version: 1, effectiveFrom: '2026-06-01' })
    expect(pub.draft).toBeNull()
    expect((await admin.post(`${api}/${draft.id}/generate`).send({})).status).toBe(409)
    const next = (await admin.post(`${api}/draft`).send({})).body.data.draft
    expect(next).toMatchObject({ version: 2, entries: 48 })
    await admin.post(`${api}/${next.id}/publish`).send({ effectiveFrom: '2026-06-01' }).expect(200)
    const ov = (await admin.get(api)).body.data
    expect(ov.published.version).toBe(2)
    expect(ov.versions.map((v) => v.version)).toEqual([1])
  })

  it('a teacher sees their own week only', async () => {
    const t = await signIn(app, 't0@tt.test', 'Teach@123')
    const mine = (await t.get(`${api}/mine`)).body.data
    expect(Object.values(mine.cells).flatMap((d) => Object.values(d))).toHaveLength(12)
    const ov = (await admin.get(api)).body.data
    expect((await t.get(`${api}/${ov.published.id}/grid?view=teacher&of=${teachersList[1].id}`)).status).toBe(403)
  })
})

describe('substitutions', () => {
  // a Monday after the timetable starts
  const date = '2026-06-08'
  it('lists the absent teacher’s periods with free teachers, and books a cover', async () => {
    expect(weekdayCode(date)).toBe('MON')
    const needs = (await admin.post(`${api}/substitutions/needs`).send({ date, absentIds: [teachersList[0].id] })).body.data
    expect(needs.length).toBeGreaterThan(0)
    const need = needs[0]
    expect(need.covered).toBeNull()
    expect(need.suggestions.length).toBeGreaterThan(0)
    expect(need.suggestions.map((s) => s.teacherId)).not.toContain(teachersList[0].id)
    const sub = need.suggestions[0]
    const list = (await admin.post(`${api}/substitutions`).send({ date, sectionId: need.sectionId, period: need.period, substituteId: sub.teacherId, note: 'Revision' })).body.data
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ substituteId: sub.teacherId, absentTeacherId: teachersList[0].id })
    // the same teacher can't cover two classes in one period
    const again = (await admin.post(`${api}/substitutions/needs`).send({ date, absentIds: [teachersList[0].id] })).body.data
    expect(again.find((n) => n.period === need.period && n.sectionId === need.sectionId).covered.substituteId).toBe(sub.teacherId)
    for (const n of again.filter((x) => x.period === need.period && x.sectionId !== need.sectionId)) expect(n.suggestions.map((s) => s.teacherId)).not.toContain(sub.teacherId)
    // and it goes in the substitute's bell
    const t = await signIn(app, `t${teachersList.findIndex((x) => x.id === sub.teacherId)}@tt.test`, 'Teach@123')
    expect((await t.get('/api/v1/core/notifications')).body.data.items.some((n) => n.event === 'timetable.substitution')).toBe(true)
    await admin.delete(`${api}/substitutions/${list[0].id}`).expect(200)
    expect((await admin.get(`${api}/substitutions?date=${date}`)).body.data).toEqual([])
  })

  it('refuses a date before the timetable starts', async () => {
    expect((await admin.post(`${api}/substitutions/needs`).send({ date: '2026-05-04', absentIds: [teachersList[0].id] })).status).toBe(409)
  })
})
