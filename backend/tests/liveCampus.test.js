import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_BELL, addDaysYmd, nowIn, weekdayCode } from '@schoolgiant/shared'
import { Employee, StaffAttendance } from '../src/models/hrms.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// Dashboard › Live campus (GET /api/v1/dashboard/live): the class board from the published timetable, teachers'
// presence and the periods nobody covers, the priorities and the next seven days.

let app
let h
let admin
let sections
let teachers = []
let day // a weekday close to today with the timetable in use
const api = '/api/v1/dashboard/live'
const P1 = DEFAULT_BELL.find((s) => s.kind === 'PERIOD' && s.no === 1)

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 2, addSubjects: true }).expect(201)
  const cls = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '11')
  sections = cls.sections
  const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
  for (const [i, name] of ['Anil', 'Bina', 'Chitra', 'Dev'].entries()) {
    teachers.push((await admin.post('/api/v1/core/users').send({ name: `${name} Teacher`, email: `t${i}@live.test`, roleIds: [tpl.id], password: 'Teach@123' })).body.data.user)
  }
  const grid = (await admin.get(`/api/v1/academics/allocation?classId=${cls.id}`)).body.data
  for (const s of sections) {
    for (const [i, sub] of grid.subjects.slice(0, 4).entries()) {
      await admin.put('/api/v1/academics/allocation').send({ sectionId: s.id, subjectId: sub.id, teacherId: teachers[i].id, periodsPerWeek: 6 }).expect(200)
    }
  }
  const draft = (await admin.post('/api/v1/timetable/draft').send({})).body.data.draft
  await admin.post(`/api/v1/timetable/${draft.id}/generate`).send({}).expect(200)
  const today = nowIn('Asia/Kolkata').date
  await admin.post(`/api/v1/timetable/${draft.id}/publish`).send({ effectiveFrom: addDaysYmd(today, -7) }).expect(200)
  // the next Monday–Friday from today (the default working week is Monday–Saturday, Sunday off)
  day = today
  while (['SAT', 'SUN'].includes(weekdayCode(day))) day = addDaysYmd(day, 1)
})
afterAll(stopDb)

describe('Live campus', () => {
  it('shows every section at a period: subject, teacher, room, the day and attendance', async () => {
    const d = (await admin.get(`${api}?date=${day}&at=${P1.start}`)).body.data
    expect(d.now).toMatchObject({ date: day, time: P1.start, schoolDay: true, phase: 'PERIOD', slot: expect.objectContaining({ no: 1 }) })
    expect(d.published).toBe(true)
    expect(d.sections.length).toBeGreaterThanOrEqual(sections.length)
    const s = d.sections.find((x) => x.id === sections[0].id)
    expect(s.day.length).toBe(8)
    expect(s.day.filter((r) => r.subject).length).toBeGreaterThan(0)
    expect(s.day[0].state).toBe('NOW')
    expect(s.attendance).toMatchObject({ marked: false })
    if (s.current?.subject) expect(s.current.teacher).toMatchObject({ id: expect.any(String), name: expect.stringMatching(/Teacher$/) })
    expect(d.agenda).toHaveLength(7)
    expect(d.agenda[0].date).toBe(day)
    expect(Array.isArray(d.priorities)).toBe(true)
    expect(d.summary).toMatchObject({ sections: d.sections.length })
  })

  it('works out before school and after school', async () => {
    expect((await admin.get(`${api}?date=${day}&at=06:00`)).body.data.now.phase).toBe('BEFORE')
    const after = (await admin.get(`${api}?date=${day}&at=20:00`)).body.data
    expect(after.now.phase).toBe('AFTER')
    expect(after.sections[0].day.every((r) => r.state === 'DONE')).toBe(true)
  })

  it('marks an absent teacher’s periods as uncovered, and ranks them first', async () => {
    const absent = teachers[0]
    await runAsTenant(h.tenant._id, async () => {
      const e = await Employee.create({ employeeCode: 'LIVE1', userId: absent.id, name: absent.name, category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2020-01-01' })
      await StaffAttendance.create({ employeeId: e._id, date: day, status: 'ABSENT' })
    })
    const d = (await admin.get(`${api}?date=${day}&at=06:00`)).body.data
    const t = d.teachers.list.find((x) => x.id === absent.id)
    expect(t.state).toBe('ABSENT')
    expect(t.uncovered.length).toBeGreaterThan(0)
    expect(d.teachers.uncovered.every((u) => u.teacherId === absent.id)).toBe(true)
    expect(d.summary.uncovered).toBe(d.teachers.uncovered.length)
    expect(d.priorities[0]).toMatchObject({ key: 'uncovered', severity: 'high', count: d.summary.uncovered, link: '/timetable/substitutions' })
    const row = d.sections.flatMap((s) => s.day).find((r) => r.teacher?.id === absent.id)
    expect(row.uncovered).toBe(true)
    // the teachers without a staff record show as such
    expect(d.teachers.list.find((x) => x.id === teachers[1].id).state).toBe('UNKNOWN')
  })

  it('refuses a bad time or date, and a role without the page', async () => {
    expect((await admin.get(`${api}?at=25:00`)).status).toBe(400)
    expect((await admin.get(`${api}?date=tomorrow`)).status).toBe(400)
    const tc = await signIn(app, 't1@live.test', 'Teach@123')
    expect((await tc.get(api)).status).toBe(403)
  })
})
