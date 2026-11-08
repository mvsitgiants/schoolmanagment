import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { liveFamilyFeatures, mobile10 } from '@schoolgiant/shared'
import { MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let slug
let year
let cls
let section
let aarav
let diya
let other
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  slug = h.tenant.slug
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const add = async (firstName, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: section.id, guardians: [{ name: `Parent of ${firstName}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  aarav = await add('Aarav', '9845000071') // two children on one number
  diya = await add('Diya', '9845000071')
  other = await add('Kabir', '9845000072')
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const fam = (path) => `/api/v1/family/${slug}${path}`
async function signInFamily(mobile) {
  const agent = request.agent(app)
  const sent = (await agent.post(fam('/otp')).send({ mobile })).body.data
  const me = await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode })
  return { agent, sent, me }
}

describe('helpers', () => {
  it('reads Indian mobile numbers however they are written', () => {
    expect(mobile10('+91 98450 00071')).toBe('9845000071')
    expect(mobile10('098450-00071')).toBe('9845000071')
    expect(mobile10('12345')).toBeNull()
  })
  it('shows only the features whose module and setting are on', () => {
    expect(liveFamilyFeatures({ showFees: false }, ['attendance', 'fees', 'exams'])).toEqual(['ATTENDANCE', 'RESULTS'])
  })
})

describe('signing in', () => {
  it('is closed until the school switches the app on', async () => {
    expect((await request(app).get(fam('/'))).status).toBe(404)
    await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
    const info = (await request(app).get(fam('/'))).body.data
    expect(info.school.slug).toBe(slug)
    expect(info.features).toEqual(expect.arrayContaining(['ATTENDANCE', 'FEES']))
  })

  it('a parent signs in with the code and sees both children; staff routes don’t accept the session', async () => {
    const { agent, me } = await signInFamily('98450 00071')
    expect(me.status).toBe(200)
    expect(me.body.data.students.map((s) => s.firstName).sort()).toEqual(['Aarav', 'Diya'])
    expect((await agent.get('/api/v1/students')).status).toBe(401)
  })

  it('an unknown number gets the same reply, but its code never works', async () => {
    const { sent, me } = await signInFamily('9000000001')
    expect(sent.challengeId).toBeTruthy()
    expect(me.status).toBe(400)
  })
})

describe('what a family sees', () => {
  let agent
  beforeAll(async () => { ({ agent } = await signInFamily('9845000071')) })

  it('its own children only', async () => {
    expect((await agent.get(fam(`/students/${aarav.id}/home`))).status).toBe(200)
    expect((await agent.get(fam(`/students/${other.id}/home`))).status).toBe(404)
  })

  it('attendance this month, and asking for leave tells the school', async () => {
    const t = (await agent.get(fam(`/students/${diya.id}/home`))).body.data.today
    await admin.put('/api/v1/attendance/sheet').send({ sectionId: section.id, date: t, period: 0, entries: [{ studentId: aarav.id, status: 'P' }, { studentId: diya.id, status: 'A' }, { studentId: other.id, status: 'P' }] }).expect(200)
    const att = (await agent.get(fam(`/students/${diya.id}/attendance`))).body.data
    expect(att.days.find((d) => d.date === t).status).toBe('A')
    const after = (await agent.post(fam(`/students/${diya.id}/leave`)).send({ from: t, to: t, reason: 'Fever' })).body.data
    expect(after.leave[0]).toMatchObject({ status: 'PENDING', byFamily: true })
    const staff = (await admin.get('/api/v1/attendance/leave?status=PENDING')).body.data
    expect(staff.some((l) => l.reason === 'Fever')).toBe(true)
    expect((await agent.post(fam(`/students/${diya.id}/leave`)).send({ from: t, to: t, reason: 'Again' })).status).toBe(409)
  })

  it('fees, and only its own receipts can be opened', async () => {
    const heads = (await admin.get('/api/v1/fees/heads')).body.data
    const st = (await admin.post('/api/v1/fees/structures').send({
      name: 'Class 11', classIds: [cls.id], lines: [{ feeHeadId: heads.find((x) => x.code === 'TUITION').id, amount: 1000000 }],
      installments: [{ name: 'Annual', dueDate: year.startDate, amount: 1000000 }],
    })).body.data
    await admin.post(`/api/v1/fees/structures/${st.id}/generate`).expect(200)
    const mine = (await admin.post('/api/v1/fees/collect').send({ studentId: aarav.id, amount: 400000, mode: 'CASH', waiveLateFee: true })).body.data
    const theirs = (await admin.post('/api/v1/fees/collect').send({ studentId: other.id, amount: 400000, mode: 'CASH', waiveLateFee: true })).body.data
    const fees = (await agent.get(fam(`/students/${aarav.id}/fees`))).body.data
    expect(fees.totals).toMatchObject({ billed: 1000000, paid: 400000, due: 600000 })
    expect(fees.receipts[0].receiptNo).toBe(mine.receiptNo)
    expect((await agent.get(fam(`/doc/FEE_RECEIPT/${mine.id}`))).text).toContain(mine.receiptNo)
    expect((await agent.get(fam(`/doc/FEE_RECEIPT/${theirs.id}`))).status).toBe(404)
  })

  it('fees disappear when the school hides them', async () => {
    await admin.patch('/api/v1/core/settings/modules/portal').send({ showFees: false }).expect(200)
    expect((await agent.get(fam(`/students/${aarav.id}/fees`))).status).toBe(404)
    await admin.patch('/api/v1/core/settings/modules/portal').send({ showFees: true }).expect(200)
  })

  it('signing out ends the session', async () => {
    await agent.post(fam('/logout')).expect(200)
    expect((await agent.get(fam('/me'))).status).toBe(401)
  })
})
