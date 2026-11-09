import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { rankApplicants } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let slug
let year
let cls
let cycle
let test
const pub = (path) => `/api/v1/public/admissions/${slug}${path}`
const child = (firstName, dob = '2015-06-10') => ({ firstName, dob, gender: 'FEMALE' })

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH') // admissions is in Growth
  slug = h.tenant.slug
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

describe('ranking', () => {
  it('higher score first, ties by who applied first', () => {
    expect(rankApplicants([{ id: 'a', score: 50, submittedAt: '2' }, { id: 'b', score: 70, submittedAt: '3' }, { id: 'c', score: 50, submittedAt: '1' }], 'TEST').map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(rankApplicants([{ id: 'a', score: 90, submittedAt: '2' }, { id: 'b', score: 10, submittedAt: '1' }], 'FIRST_COME').map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('the enquiry pipeline', () => {
  it('takes an enquiry, thanks the family, and is due for follow-up', async () => {
    cycle = (await admin.post('/api/v1/admissions/cycles').send({ name: 'Admissions 2027', academicYearId: year.id, classes: [{ classId: cls.id, seats: 2, meritBasis: 'TEST', testRequired: true }] })).body.data
    await admin.post(`/api/v1/admissions/cycles/${cycle.id}/status`).send({ status: 'OPEN' }).expect(200)
    const e = (await admin.post('/api/v1/admissions/enquiries').send({ childName: 'Riya', parentName: 'Neha', mobile: '9845000201', classId: cls.id, source: 'PHONE' })).body.data
    expect(e.enquiryNo).toMatch(/^ENQ\d{2}\d{5}$/)
    expect(e.stage).toBe('NEW')
    expect(await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'admissions.enquiry', channel: 'SMS' }))).toBe(1)
    const after = (await admin.post(`/api/v1/admissions/enquiries/${e.id}/follow-ups`).send({ type: 'CALL', note: 'Will visit Saturday', stage: 'VISIT' })).body.data
    expect(after).toMatchObject({ stage: 'VISIT' })
    expect(after.followUps).toHaveLength(1)
    expect((await admin.patch(`/api/v1/admissions/enquiries/${e.id}`).send({ stage: 'LOST' })).status).toBe(400) // needs a reason
  })
})

describe('applying online', () => {
  it('stays closed until the school switches online applications on', async () => {
    expect((await request(app).get(pub(''))).body.data.cycles).toHaveLength(0)
    await admin.patch('/api/v1/core/settings/modules/admissions').send({ onlineApplication: true }).expect(200)
    const info = (await request(app).get(pub(''))).body.data
    expect(info.cycles[0].classes[0].className).toBe(cls.name)
  })

  it('a family proves its number, applies, and the enquiry on that number moves to Applied', async () => {
    const sent = (await request(app).post(pub('/otp')).send({ mobile: '9845000201' })).body.data
    const { pass } = (await request(app).post(pub('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode })).body.data
    const res = await request(app).post(pub('/apply')).send({ pass, cycleId: cycle.id, classId: cls.id, child: child('Riya'), parent: { name: 'Neha', relation: 'MOTHER', mobile: '0000000000' } })
    expect(res.status).toBe(201)
    expect(res.body.data.applicationNo).toMatch(/^APP\d{2}\d{5}$/)
    expect((await request(app).post(pub('/apply')).send({ pass, cycleId: cycle.id, classId: cls.id, child: child('Riya'), parent: { name: 'Neha', mobile: '9845000201' } })).status).toBe(409) // twice
    const mine = (await request(app).post(pub('/applications')).send({ pass })).body.data
    expect(mine[0]).toMatchObject({ childName: 'Riya', status: 'SUBMITTED' })
    const enq = (await admin.get('/api/v1/admissions/enquiries?stage=APPLIED')).body.data
    expect(enq[0].childName).toBe('Riya')
    expect((await request(app).post(pub('/applications')).send({ pass: 'forged' })).status).toBe(400)
  })
})

describe('test, merit list, seats and admission', () => {
  it('ranks on test marks, offers the seats, waitlists the rest', async () => {
    for (const [n, m] of [['Aarav', '9845000202'], ['Kabir', '9845000203']]) {
      await admin.post('/api/v1/admissions/applications').send({ cycleId: cycle.id, classId: cls.id, child: child(n), parent: { name: `Parent of ${n}`, mobile: m } }).expect(201)
    }
    test = (await admin.post('/api/v1/admissions/tests').send({ cycleId: cycle.id, name: 'Entrance test', classIds: [cls.id], date: year.startDate, time: '10:00', venue: 'Hall', maxMarks: 50 })).body.data
    expect((await admin.post(`/api/v1/admissions/tests/${test.id}/assign`).send({})).body.data.assigned).toBe(3)
    const sheet = (await admin.get(`/api/v1/admissions/tests/${test.id}/marks`)).body.data
    const marks = { Riya: 30, Aarav: 45, Kabir: 20 }
    await admin.put(`/api/v1/admissions/tests/${test.id}/marks`).send({ entries: sheet.rows.map((r) => ({ applicationId: r.id, marks: marks[r.childName] })) }).expect(200)
    expect((await admin.post(`/api/v1/admissions/merit/${cycle.id}/${cls.id}/allot`)).status).toBe(409) // publish first
    const list = (await admin.post(`/api/v1/admissions/merit/${cycle.id}/${cls.id}/publish`)).body.data
    expect(list.rows.map((r) => r.childName)).toEqual(['Aarav', 'Riya', 'Kabir'])
    const r = (await admin.post(`/api/v1/admissions/merit/${cycle.id}/${cls.id}/allot`)).body.data
    expect(r).toMatchObject({ offered: 2, waitlisted: 1 })
    expect(r.list.left).toBe(0)
    expect(await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'admissions.offer', channel: 'SMS' }))).toBe(2)
  })

  it('the family accepts online, and the school admits the child as a student', async () => {
    const sent = (await request(app).post(pub('/otp')).send({ mobile: '9845000201' })).body.data
    const { pass } = (await request(app).post(pub('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode })).body.data
    const mine = (await request(app).post(pub('/applications')).send({ pass })).body.data
    const accepted = (await request(app).post(pub(`/applications/${mine[0].id}/accept`)).send({ pass })).body.data
    expect(accepted[0].status).toBe('ACCEPTED')
    const done = (await admin.post(`/api/v1/admissions/applications/${mine[0].id}/admit`).send({ sectionId: cls.sections[0].id })).body.data
    expect(done.application.status).toBe('ADMITTED')
    expect(done.student.admissionNo).toBeTruthy()
    const s = (await admin.get(`/api/v1/students/${done.student.id}`)).body.data
    expect(s.guardians[0]).toMatchObject({ name: 'Neha', mobile: '9845000201' })
  })
})
