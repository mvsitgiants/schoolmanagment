import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alumniBatchOf, donationFundLabel, isValidDonorPan, linkedInUrl } from '@schoolgiant/shared'
import { ALUMNI_DOCS } from '../src/documents/alumniDocs.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { on } from '../src/platform/events.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
const api = '/api/v1/alumni'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
const posted = []

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
  on('alumni.donation', (p) => { posted.push(String(p.entity?.id)) })
  await asTenant(() => Student.create([
    { admissionNo: 'A001', firstName: 'Kiran', lastName: 'Rao', status: 'PASSED_OUT', leaving: { date: '2025-04-30', reason: 'COMPLETED' }, email: 'kiran@alumni.test', address: { city: 'Pune' } },
    { admissionNo: 'A002', firstName: 'Lata', status: 'PASSED_OUT', leaving: { date: '2025-05-02' }, guardians: [{ name: 'Mr Lata', relation: 'FATHER', mobile: '9845000222', isPrimary: true }] },
    { admissionNo: 'A003', firstName: 'Mohan', status: 'LEFT', leaving: { date: '2024-11-15' } },
    { admissionNo: 'A004', firstName: 'Nisha' },
  ]))
})
afterAll(stopDb)

describe('helpers', () => {
  it('checks PAN, links and batches', () => {
    expect(isValidDonorPan('abcde1234f')).toBe(true)
    expect(isValidDonorPan('ABCDE12345')).toBe(false)
    expect(linkedInUrl('linkedin.com/in/kiran')).toBe('https://linkedin.com/in/kiran')
    expect(alumniBatchOf('2025-04-30')).toBe(2025)
    expect(alumniBatchOf(null, '2024-01-01')).toBe(2024)
    expect(donationFundLabel('SCHOLARSHIP')).toBe('Scholarships')
    expect(donationFundLabel('Hostel wing')).toBe('Hostel wing')
  })
})

describe('the directory', () => {
  let kiran
  it('lists the years that have leavers and previews one', async () => {
    const years = (await admin.get(`${api}/directory/leavers`)).body.data.years
    expect(years).toEqual([{ year: 2025, leavers: 2, imported: 0 }, { year: 2024, leavers: 1, imported: 0 }])
    const p = (await admin.get(`${api}/directory/leavers`).query({ year: 2025 })).body.data
    expect(p.data.map((r) => r.name).sort()).toEqual(['Kiran Rao', 'Lata'])
    expect(p.data.find((r) => r.name === 'Lata').mobile).toBe('9845000222')
  })

  it('imports a year’s leavers once', async () => {
    expect((await admin.post(`${api}/directory/import-leavers`).send({ year: 2025 }).expect(200)).body.data).toEqual({ added: 2, already: 0 })
    expect((await admin.post(`${api}/directory/import-leavers`).send({ year: 2025 }).expect(200)).body.data).toEqual({ added: 0, already: 2 })
    const list = (await admin.get(`${api}/directory`).query({ batch: 2025 })).body
    expect(list.total).toBe(2)
    kiran = list.data.find((a) => a.name === 'Kiran Rao')
    expect(kiran).toMatchObject({ batch: 2025, source: 'IMPORT', email: 'kiran@alumni.test', city: 'Pune', consent: false })
  })

  it('adds an alumnus by hand, edits, searches and filters by batch', async () => {
    await admin.post(`${api}/directory`).send({ name: 'X', batch: 2020 }).expect(400)
    const a = (await admin.post(`${api}/directory`).send({ name: 'Priya Menon', batch: 2019, program: 'B.Com', organisation: 'Deloitte', designation: 'Manager', city: 'Kochi', linkedIn: 'linkedin.com/in/priya', consent: true }).expect(201)).body.data
    expect(a.linkedIn).toBe('https://linkedin.com/in/priya')
    await admin.patch(`${api}/directory/${kiran.id}`).send({ organisation: 'Tata Steel', consent: true }).expect(200)
    expect((await admin.get(`${api}/directory`).query({ search: 'tata' })).body.data.map((x) => x.name)).toEqual(['Kiran Rao'])
    expect((await admin.get(`${api}/directory`).query({ consent: '1' })).body.total).toBe(2)
    const meta = (await admin.get(`${api}/meta`)).body.data
    expect(meta.batches.map((b) => [b.batch, b.count])).toEqual([[2025, 2], [2019, 1]])
    expect(meta.totals).toMatchObject({ alumni: 3, consent: 2, working: 2 })
    const csv = await admin.get(`${api}/directory/export`).expect(200)
    expect(csv.text).toContain('Priya Menon')
  })
})

describe('donations', () => {
  let alumnus
  beforeAll(async () => {
    alumnus = (await admin.get(`${api}/directory`).query({ search: 'Kiran' })).body.data[0]
  })

  it('records a donation from an alumnus with a numbered receipt, and emits it for Accounts', async () => {
    posted.length = 0
    const d = (await admin.post(`${api}/donations`).send({ donorKind: 'ALUMNUS', alumnusId: alumnus.id, amount: 2500000, mode: 'UPI', reference: 'UTR123', fund: 'SCHOLARSHIP' }).expect(201)).body.data
    expect(d.receiptNo).toMatch(/\d/)
    expect(d.donor).toMatchObject({ kind: 'ALUMNUS', name: 'Kiran Rao', batch: 2025 })
    expect(posted).toEqual([d.id])
    const model = ALUMNI_DOCS.DONATION_RECEIPT.model(await asTenant(() => ALUMNI_DOCS.DONATION_RECEIPT.load(d.id)))
    expect(model.receipt).toMatchObject({ no: d.receiptNo, amount: 2500000, fund: 'Scholarships', is80G: false })
  })

  it('80G needs a valid PAN; another donor needs a name', async () => {
    await admin.post(`${api}/donations`).send({ donorKind: 'OTHER', name: 'Well Wisher', amount: 100000, mode: 'CASH', is80G: true }).expect(400)
    await admin.post(`${api}/donations`).send({ donorKind: 'OTHER', name: 'Well Wisher', amount: 100000, mode: 'CASH', is80G: true, pan: 'BAD' }).expect(400)
    await admin.post(`${api}/donations`).send({ donorKind: 'OTHER', amount: 100000, mode: 'CASH' }).expect(400)
    const d = (await admin.post(`${api}/donations`).send({ donorKind: 'OTHER', name: 'Well Wisher', amount: 1000000, mode: 'CHEQUE', is80G: true, pan: 'abcde1234f', fund: 'Library wing' }).expect(201)).body.data
    expect(d).toMatchObject({ is80G: true, donor: { pan: 'ABCDE1234F' }, fund: 'Library wing' })
  })

  it('totals by fund and by batch; lists, filters and exports', async () => {
    const s = (await admin.get(`${api}/donations/summary`)).body.data
    expect(s.totals).toMatchObject({ amount: 3500000, count: 2, amount80G: 1000000 })
    expect(s.byFund.map((f) => [f.label, f.amount])).toEqual([['Scholarships', 2500000], ['Library wing', 1000000]])
    expect(s.byBatch).toEqual([{ batch: 2025, amount: 2500000, count: 1 }])
    const list = (await admin.get(`${api}/donations`).query({ batch: 2025 })).body
    expect(list).toMatchObject({ total: 1, amount: 2500000 })
    expect((await admin.get(`${api}/directory/${alumnus.id}`)).body.data.donations).toHaveLength(1)
    const csv = await admin.get(`${api}/donations/export`).expect(200)
    expect(csv.text).toContain('Well Wisher')
  })
})
