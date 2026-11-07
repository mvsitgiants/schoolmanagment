import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nextRunAt, resolveRange } from '@schoolgiant/shared'
import { Notification } from '../src/models/engines.js'
import { SavedReport } from '../src/models/reports.js'
import { runAsTenant } from '../src/platform/context.js'
import { runDueSchedules } from '../src/services/reports.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let section
let today
let aarav
let diya
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  section = data.classes.find((c) => c.code === '11').sections[0]
  const add = async (firstName, gender, mobile) => (await admin.post('/api/v1/students').send({ firstName, gender, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', 'MALE', '9845000061')
  diya = await add('Diya', 'FEMALE', '9845000062')
  today = (await admin.get('/api/v1/dashboard/command')).body.data.today
})
afterAll(stopDb)

describe('date helpers', () => {
  it('turns presets into dates and finds the next send time', () => {
    expect(resolveRange('lastMonth', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(resolveRange('thisYear', '2026-02-01')).toEqual({ from: '2025-04-01', to: '2026-02-01' })
    // Sunday 8 Nov 2026, 15:30 IST → Monday 7:00 IST
    expect(nextRunAt('WEEKLY', 7, new Date('2026-11-08T10:00:00Z'), 330).toISOString()).toBe('2026-11-09T01:30:00.000Z')
  })
})

describe('command centre', () => {
  it('shows today’s strength, attendance and fees, and what is waiting', async () => {
    await admin.put('/api/v1/attendance/sheet').send({ sectionId: section.id, date: today, period: 0, entries: [{ studentId: aarav.id, status: 'P' }, { studentId: diya.id, status: 'A' }] }).expect(200)
    const d = (await admin.get('/api/v1/dashboard/command')).body.data
    expect(d.students).toMatchObject({ active: 2, boys: 1, girls: 1 })
    expect(d.attendance).toMatchObject({ marked: 1, present: 1, absent: 1, pct: 50 })
    expect(d.fees).toMatchObject({ today: 0 })
    expect(Array.isArray(d.pending)).toBe(true)
  })
})

describe('report library', () => {
  it('lists the reports the role may run', async () => {
    const lib = (await admin.get('/api/v1/reports/library')).body.data
    expect(lib.map((r) => r.id)).toEqual(expect.arrayContaining(['students.strength', 'attendance.daily', 'fees.collection']))
  })

  it('runs class strength with totals, and daily attendance', async () => {
    const s = (await admin.post('/api/v1/reports/run/students.strength').send({})).body.data
    expect(s.rows.find((r) => r.class === 'Class 11')).toMatchObject({ boys: 1, girls: 1, total: 2 })
    expect(s.totals.total).toBe(2)
    const a = (await admin.post('/api/v1/reports/run/attendance.daily').send({ params: { date: today } })).body.data
    expect(a.rows[0]).toMatchObject({ present: 1, absent: 1, pct: 50 })
  })

  it('checks inputs and only keeps the chosen columns', async () => {
    expect((await admin.post('/api/v1/reports/run/students.contacts').send({})).status).toBe(400) // needs a class
    const c = (await admin.post('/api/v1/reports/run/students.contacts').send({ params: { sectionId: section.id }, columns: ['name', 'mobile'] })).body.data
    expect(c.columns.map((x) => x.key)).toEqual(['name', 'mobile'])
    expect(c.rows.map((r) => r.mobile).sort()).toEqual(['9845000061', '9845000062'])
    const low = (await admin.post('/api/v1/reports/run/attendance.defaulters').send({ params: { range: 'thisMonth', below: 75 } })).body.data
    expect(low.rows.map((r) => r.name)).toEqual(['Diya'])
  })
})

describe('saved reports and schedules', () => {
  it('saves a report with its inputs, runs it, and sends it when due', async () => {
    const me = (await admin.get('/api/v1/auth/me')).body.data
    const saved = (await admin.post('/api/v1/reports/saved').send({
      name: 'Monday attendance check', reportId: 'attendance.defaulters', params: { range: 'thisMonth', below: 75 },
      schedule: { active: true, frequency: 'WEEKLY', hour: 7, userIds: [me.user.id] },
    })).body.data
    expect(saved.nextRunAt).toBeTruthy()
    const run = (await admin.post(`/api/v1/reports/saved/${saved.id}/run`)).body.data
    expect(run.rows).toHaveLength(1)
    await runAsTenant(h.tenant._id, () => SavedReport.updateOne({ _id: saved.id }, { $set: { nextRunAt: new Date(Date.now() - 60_000) } }))
    expect(await runDueSchedules()).toBe(1)
    const bell = await runAsTenant(h.tenant._id, () => Notification.findOne({ event: 'reports.scheduled' }).lean())
    expect(bell.title).toBe('Monday attendance check')
    const after = await runAsTenant(h.tenant._id, () => SavedReport.findById(saved.id).lean())
    expect(after.lastRows).toBe(1)
    expect(after.nextRunAt > new Date()).toBe(true)
  })
})
