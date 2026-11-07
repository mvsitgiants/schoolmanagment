import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { financialYearOf, makeVerifyCode } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let year
let cls
let aarav
let diya
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  const add = async (firstName, gender, father) => (await admin.post('/api/v1/students').send({ firstName, gender, sectionId: cls.sections[0].id, guardians: [{ name: father, relation: 'FATHER', mobile: '9845000051' }] })).body.data
  aarav = await add('Aarav', 'MALE', 'Rajesh Sharma')
  diya = await add('Diya', 'FEMALE', 'Vikram Rao')
})
afterAll(stopDb)

const api = '/api/v1/certificates'

describe('helpers', () => {
  it('works out the financial year and makes readable codes', () => {
    expect(financialYearOf('2027-02-10')).toEqual({ label: '2026-27', from: '2026-04-01', to: '2027-03-31' })
    expect(makeVerifyCode()).toMatch(/^[A-HJKMNP-Z2-9]{12}$/)
  })
})

describe('issuing and verifying', () => {
  let bonafide
  it('issues a bonafide certificate with a number and a verify code, and prints it', async () => {
    const res = (await admin.post(api).send({ kind: 'BONAFIDE', studentIds: [aarav.id], purpose: 'Passport' })).body.data
    expect(res.created).toBe(1)
    expect(res.numbers[0]).toMatch(/^CRT\d{2}\d{5}$/)
    const list = (await admin.get(`${api}?kind=BONAFIDE`)).body
    bonafide = list.data[0]
    expect(bonafide).toMatchObject({ name: 'Aarav', status: 'ISSUED', purpose: 'Passport' })
    const html = (await admin.get(`/api/v1/documents/CERTIFICATE/${bonafide.id}?print=0`)).text
    expect(html).toContain('son of Rajesh Sharma')
    expect(html).toContain('Passport')
    expect(html).toContain('<svg') // the QR
  })

  it('anyone can check it without signing in; a cancelled one shows as not valid', async () => {
    const ok = (await request(app).get(`/api/v1/public/verify/certificate/${bonafide.verifyCode}`)).body.data
    expect(ok).toMatchObject({ found: true, valid: true, name: 'Aarav', kind: 'BONAFIDE' })
    expect(ok.institution.name).toBeTruthy()
    await admin.post(`${api}/${bonafide.id}/cancel`).send({ reason: 'Wrong purpose' }).expect(200)
    const gone = (await request(app).get(`/api/v1/public/verify/certificate/${bonafide.verifyCode}`)).body.data
    expect(gone).toMatchObject({ found: true, valid: false, status: 'CANCELLED' })
    expect((await request(app).get('/api/v1/public/verify/certificate/NOTACODE1234')).body.data.found).toBe(false)
  })

  it('a bonafide is for one student; merit can go to many at once', async () => {
    expect((await admin.post(api).send({ kind: 'BONAFIDE', studentIds: [aarav.id, diya.id] })).status).toBe(400)
    expect((await admin.post(api).send({ kind: 'MERIT', studentIds: [aarav.id, diya.id] })).status).toBe(400) // needs the event
    const res = (await admin.post(api).send({ kind: 'MERIT', studentIds: [aarav.id, diya.id], event: 'Annual Sports Meet', achievement: 'First place, 100 m', eventDate: year.startDate })).body.data
    expect(res.created).toBe(2)
    const html = (await admin.get(`/api/v1/documents/CERTIFICATE/${res.ids[1]}?print=0`)).text
    expect(html).toContain('Annual Sports Meet')
    expect(html).toContain('Diya')
  })

  it('a character certificate uses she / her for a girl', async () => {
    const res = (await admin.post(api).send({ kind: 'CHARACTER', studentIds: [diya.id], conduct: 'Excellent' })).body.data
    const html = (await admin.get(`/api/v1/documents/CERTIFICATE/${res.ids[0]}?print=0`)).text
    expect(html).toContain('daughter of Vikram Rao')
    expect(html).toContain('Excellent')
  })
})

describe('fee paid certificate', () => {
  it('adds up the fees paid in the financial year, tuition separately', async () => {
    const heads = (await admin.get('/api/v1/fees/heads')).body.data
    const head = (code) => heads.find((x) => x.code === code).id
    const st = (await admin.post('/api/v1/fees/structures').send({
      name: 'Class 11', classIds: [cls.id], lines: [{ feeHeadId: head('TUITION'), amount: 3000000 }, { feeHeadId: head('LAB'), amount: 1000000 }],
      installments: [{ name: 'Annual', dueDate: year.startDate, amount: 4000000 }],
    })).body.data
    await admin.post(`/api/v1/fees/structures/${st.id}/generate`).expect(200)
    await admin.post('/api/v1/fees/collect').send({ studentId: aarav.id, amount: 4000000, mode: 'CASH', waiveLateFee: true }).expect(201)
    const receipts = (await admin.get('/api/v1/fees/receipts')).body.data
    const fy = financialYearOf(receipts[0].date).label
    const preview = (await admin.post(`${api}/preview`).send({ kind: 'FEE', studentIds: [aarav.id], fy })).body.data
    expect(preview.fees).toMatchObject({ fy, total: 4000000, tuition: 3000000 })
    expect((await admin.post(`${api}/preview`).send({ kind: 'FEE', studentIds: [diya.id], fy })).status).toBe(400) // paid nothing
  })
})
