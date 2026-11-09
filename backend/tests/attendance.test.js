import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let sec
let today
let students
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  sec = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '11').sections[0]
  for (const [i, name] of ['Aarav', 'Diya', 'Kabir'].entries()) {
    await admin.post('/api/v1/students').send({ firstName: name, rollNo: String(i + 1), sectionId: sec.id, guardians: [{ name: `Parent ${name}`, mobile: `98450000${i}1` }] }).expect(201)
  }
  today = await runAsTenant(h.tenant._id, async () => (await institutionNow()).date)
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const api = '/api/v1/attendance'
const sheet = async (date = today) => (await admin.get(`${api}/sheet?sectionId=${sec.id}&date=${date}`)).body.data
const save = (entries, date = today) => admin.put(`${api}/sheet`).send({ sectionId: sec.id, date, entries })

describe('marking attendance', () => {
  it('a fresh sheet lists the section in roll order, everyone present', async () => {
    const s = await sheet()
    students = s.students
    expect(s.taken).toBe(false)
    expect(s.canEdit).toBe(true)
    expect(students.map((x) => x.name)).toEqual(['Aarav', 'Diya', 'Kabir'])
    expect(students.every((x) => x.status === 'P')).toBe(true)
  })

  it('saves every student’s mark; an absence today tells the family once', async () => {
    const res = await save(students.map((x, i) => ({ studentId: x.id, status: i === 1 ? 'A' : 'P' })))
    expect(res.status).toBe(200)
    expect(res.body.data.taken).toBe(true)
    const log = await runAsTenant(h.tenant._id, () => MessageLog.find({ event: 'attendance.absent' }).lean())
    expect(log.filter((m) => m.channel === 'SMS')).toHaveLength(1)
    expect(log.find((m) => m.channel === 'SMS').body).toContain('Diya')
    // saving again with Diya still absent sends nothing more
    await save(students.map((x, i) => ({ studentId: x.id, status: i === 1 ? 'A' : 'L' }))).expect(200)
    expect(await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'attendance.absent', channel: 'SMS' }))).toBe(1)
  })

  it('refuses a sheet that leaves a student out, an unknown mark or a future date', async () => {
    expect((await save([{ studentId: students[0].id, status: 'P' }])).status).toBe(400)
    expect((await save(students.map((x) => ({ studentId: x.id, status: 'X' })))).status).toBe(400)
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
    expect((await save(students.map((x) => ({ studentId: x.id, status: 'P' })), tomorrow)).status).toBe(403)
  })

  it('the board shows the section as taken with its counts', async () => {
    const board = (await admin.get(`${api}/board`)).body.data
    const row = board.sections.find((x) => x.id === sec.id)
    expect(row).toMatchObject({ taken: true, strength: 3 })
    expect(row.counts).toMatchObject({ A: 1, L: 2, total: 3 })
  })
})

describe('who may mark', () => {
  it('a teacher marks only their own sections', async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    await admin.post('/api/v1/core/users').send({ name: 'Other Teacher', email: 'other@att.test', roleIds: [tpl.id], password: 'Teach@123' })
    const t = await signIn(app, 'other@att.test', 'Teach@123')
    expect((await t.get(`${api}/sheet?sectionId=${sec.id}`)).status).toBe(404)
    expect((await t.get(`${api}/board`)).body.data.sections).toEqual([])
  })
})

describe('register and reports', () => {
  it('the month register has each student’s marks and %', async () => {
    const reg = (await admin.get(`${api}/register?sectionId=${sec.id}&month=${today.slice(0, 7)}`)).body.data
    const diya = reg.students.find((x) => x.name === 'Diya')
    expect(diya.marks[today]).toBe('A')
    expect(diya.pct).toBe(0)
    expect(reg.students.find((x) => x.name === 'Aarav').pct).toBe(100) // late counts as present
  })

  it('reports per section, and per student with those under the minimum flagged', async () => {
    const all = (await admin.get(`${api}/reports?from=${today}&to=${today}`)).body.data
    expect(all.sections.find((x) => x.id === sec.id)).toMatchObject({ daysTaken: 1, below: 1 })
    const one = (await admin.get(`${api}/reports?from=${today}&to=${today}&sectionId=${sec.id}`)).body.data
    expect(one.students.find((x) => x.name === 'Diya')).toMatchObject({ pct: 0, below: true })
  })
})

describe('student leave', () => {
  it('approved leave turns an absence into “on leave” and pre-marks new sheets', async () => {
    const diya = students[1]
    const leave = (await admin.post(`${api}/leave`).send({ studentId: diya.id, from: today, to: today, reason: 'Fever' })).body.data
    expect(leave.status).toBe('PENDING')
    expect((await admin.post(`${api}/leave`).send({ studentId: diya.id, from: today, to: today, reason: 'Again' })).status).toBe(409)
    const decided = (await admin.post(`${api}/leave/${leave.id}/decide`).send({ approve: true })).body.data
    expect(decided.status).toBe('APPROVED')
    const s = await sheet()
    expect(s.students.find((x) => x.id === diya.id).status).toBe('LV')
  })
})

describe('period-wise attendance', () => {
  // a section of its own, so the daily sheets above are left alone
  let psec
  let kids
  const periodSheet = async (period) => (await admin.get(`${api}/sheet?sectionId=${psec.id}&date=${today}&period=${period}`)).body.data
  const mark = (period, statuses) => admin.put(`${api}/sheet`).send({ sectionId: psec.id, date: today, period, entries: kids.map((k, i) => ({ studentId: k.id, status: statuses[i] })) })
  beforeAll(async () => {
    const c12 = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '12')
    psec = c12.sections[0]
    for (const [i, name] of ['Ira', 'Om'].entries()) {
      await admin.post('/api/v1/students').send({ firstName: name, rollNo: String(i + 1), sectionId: psec.id, guardians: [{ name: `Parent ${name}`, mobile: `98451000${i}1` }] }).expect(201)
    }
    kids = (await periodSheet(1)).students
  })
  afterAll(async () => { await admin.patch('/api/v1/core/settings/modules/attendance').send({ mode: 'DAILY', dayFrom: 'FIRST' }) })

  it('once a day refuses period sheets', async () => {
    expect((await mark(1, ['P', 'P'])).status).toBe(400)
  })

  it('every period: the day is worked out from the first period marked, and can’t be marked by hand', async () => {
    await admin.patch('/api/v1/core/settings/modules/attendance').send({ mode: 'PERIOD', dayFrom: 'FIRST' }).expect(200)
    expect((await mark(2, ['A', 'P'])).status).toBe(200)
    expect((await mark(3, ['P', 'A'])).status).toBe(200)
    const day = (await admin.get(`${api}/sheet?sectionId=${psec.id}&date=${today}`)).body.data
    expect(day).toMatchObject({ derived: true, taken: true, canEdit: false, reason: 'DERIVED' })
    expect(day.students.map((s) => s.status)).toEqual(['A', 'P']) // period 2 was the first marked
    expect((await admin.put(`${api}/sheet`).send({ sectionId: psec.id, date: today, entries: kids.map((k) => ({ studentId: k.id, status: 'P' })) })).status).toBe(400)
    expect((await mark(99, ['P', 'P'])).status).toBe(400) // no such period in the bell schedule
  })

  it('every period, by share: present once enough periods are attended', async () => {
    await admin.patch('/api/v1/core/settings/modules/attendance').send({ dayFrom: 'SHARE', dayMinPct: 60 }).expect(200)
    await mark(4, ['P', 'A']).expect(200) // Ira 2 of 3 (67%), Om 1 of 3 (33%)
    const day = (await admin.get(`${api}/sheet?sectionId=${psec.id}&date=${today}`)).body.data
    expect(day.students.map((s) => s.status)).toEqual(['P', 'A'])
  })

  it('the subject-wise report counts each student’s periods', async () => {
    const rep = (await admin.get(`${api}/subject-report?sectionId=${psec.id}&from=${today}&to=${today}`)).body.data
    expect(rep.periodsTaken).toBe(3)
    const ira = rep.students.find((s) => s.name === 'Ira')
    expect(ira.pct).toBeCloseTo(66.7, 0)
  })

  it('both: the class teacher’s day sheet stays the day, and periods are marked as well', async () => {
    await admin.patch('/api/v1/core/settings/modules/attendance').send({ mode: 'BOTH' }).expect(200)
    const tomorrowless = (await admin.put(`${api}/sheet`).send({ sectionId: psec.id, date: today, entries: kids.map((k) => ({ studentId: k.id, status: 'P' })) }))
    expect(tomorrowless.status).toBe(200)
    expect(tomorrowless.body.data.students.map((s) => s.status)).toEqual(['P', 'P'])
    expect((await mark(5, ['A', 'P'])).status).toBe(200)
    const day = (await admin.get(`${api}/sheet?sectionId=${psec.id}&date=${today}`)).body.data
    expect(day.students.map((s) => s.status)).toEqual(['P', 'P']) // not rebuilt from the periods
  })
})
