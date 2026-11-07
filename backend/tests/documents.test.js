import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PRINT_DOCS } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let nurse
let bill
let admission
const SIGN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const page = (res) => res.text

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  const role = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['STAFF_NURSE'] })).body.data.created[0]
  await admin.post('/api/v1/core/users').send({ name: 'Nurse Doc', email: 'nd@d.test', roleIds: [role.id], password: 'Staff@123' })
  nurse = await signIn(app, 'nd@d.test', 'Staff@123')
  const p = (await admin.post('/api/v1/patients').send({ firstName: 'Print', lastName: 'Patient', gender: 'FEMALE', age: { years: 44 }, mobile: '9811100071', address: { pincode: '560001' }, consents: { dataProcessing: true } })).body.data
  const svc = (await admin.get('/api/v1/billing/services?search=dressing small')).body.data[0]
  bill = (await admin.post('/api/v1/billing/bills').send({ studentId: p.id, chargeIds: [], extras: [{ serviceId: svc.id, qty: 2 }], payments: [{ mode: 'CASH', amount: 30000 }] })).body.data
  const doctor = (await admin.post('/api/v1/appointments/doctors').send({ name: 'Dr. Print', sessions: [], fees: { newVisit: 50000, followUp: 30000 } })).body.data
  const meta = (await admin.get('/api/v1/ipd/meta')).body.data
  const ward = (await admin.post('/api/v1/ipd/wards').send({ code: 'W1', name: 'Ward one' })).body.data
  const gen = meta.classes.find((c) => c.code === 'GENERAL')
  const [bed] = (await admin.post('/api/v1/ipd/beds').send({ wardId: ward.id, bedClassId: gen.id, prefix: 'W-', count: 1 })).body.data
  admission = (await admin.post('/api/v1/ipd/admissions').send({ studentId: p.id, doctorId: doctor.id, bedId: bed.id, consent: { signature: SIGN, signedBy: 'Print Patient' }, deposits: [{ mode: 'CASH', amount: 1000000 }] })).body.data
})
afterAll(stopDb)

describe('server-rendered documents', () => {
  it('prints a bill from the built-in template with the institution letterhead', async () => {
    const res = await admin.get(`/api/v1/documents/OPD_BILL/${bill.id}`).expect(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(page(res)).toContain(bill.invoiceNo)
    expect(page(res)).toContain('Print Patient')
    expect(page(res)).toContain('Test Institution')
    expect(page(res)).toContain('₹300.00')
    expect(page(res)).toContain('window.print()')
    expect(page(res)).toMatch(/@page \{ size: A5/)
  })

  it('an inpatient bill id asked for as OPD_BILL prints with the inpatient template, and every IPD document renders', async () => {
    for (const doc of ['ADMISSION_FORM', 'INTERIM_BILL']) {
      const res = await admin.get(`/api/v1/documents/${doc}/${admission.id}`).expect(200)
      expect(page(res)).toContain(admission.ipNo)
    }
    const form = page(await admin.get(`/api/v1/documents/ADMISSION_FORM/${admission.id}`))
    expect(form).toContain('<svg') // barcode of the IP number
    expect(form).toContain('General consent')
    const acc = (await admin.get(`/api/v1/billing/ip-accounts/${admission.id}`)).body.data
    const dep = acc.payments[0]
    expect(page(await admin.get(`/api/v1/documents/DEPOSIT_RECEIPT/${dep.id}`))).toContain('Advance deposit receipt')
  })

  it('checks permissions per document', async () => {
    expect((await nurse.get(`/api/v1/documents/OPD_BILL/${bill.id}`)).status).toBe(403)
    expect((await nurse.get(`/api/v1/documents/ADMISSION_FORM/${admission.id}`)).status).toBe(200)
    expect((await admin.get(`/api/v1/documents/NOPE/${bill.id}`)).status).toBe(404)
  })

  it('an institution template replaces the body; a broken one is refused', async () => {
    const help = (await admin.get('/api/v1/documents/OPD_BILL/help')).body.data
    expect(help.source).toContain('{{#> letterhead}}')
    expect(help.variables.length).toBeGreaterThan(3)
    const broken = await admin.post('/api/v1/core/print-templates').send({ docType: 'OPD_BILL', name: 'Broken', margins: { top: 10, right: 10, bottom: 10, left: 10 }, body: '{{#each lines}}no end' })
    expect(broken.status).toBe(400)
    expect(broken.body.details.fields.body).toBeTruthy()
    const preview = await admin.post('/api/v1/documents/OPD_BILL/preview').send({ body: '<h1>Receipt {{bill.no}} for {{patient.name}} — {{money totals.net}}</h1>{{> footer}}' }).expect(200)
    expect(page(preview)).toContain(`Receipt ${bill.invoiceNo} for Print Patient — ₹300.00`)
    await admin.post('/api/v1/core/print-templates').send({ docType: 'OPD_BILL', name: 'Short slip', paper: 'THERMAL_80', margins: { top: 3, right: 3, bottom: 3, left: 3 }, letterhead: 'NONE', body: '{{> letterhead}}<p class="slip">Slip {{bill.no}} · {{words totals.net}}</p>' }).expect(201)
    const out = page(await admin.get(`/api/v1/documents/OPD_BILL/${bill.id}`))
    expect(out).toContain(`Slip ${bill.invoiceNo} · Rupees Three Hundred Only`)
    expect(out).toMatch(/@page \{ size: 80mm/)
    expect(out).not.toContain('Net payable')
  })

  it('previews every document, over made-up data where the institution has no record yet', async () => {
    for (const d of PRINT_DOCS.filter((x) => x.server)) {
      const r = await admin.post(`/api/v1/documents/${d.value}/preview`).send({})
      expect(r.status, `${d.value}: ${r.text.slice(0, 200)}`).toBe(200)
    }
    const offer = page(await admin.post('/api/v1/documents/HR_OFFER_LETTER/preview').send({}))
    expect(offer).toContain('Sample data — no offer letter yet')
    expect(offer).toContain('Priya Nair')
    const real = page(await admin.post('/api/v1/documents/OPD_BILL/preview').send({}))
    expect(real).toContain(bill.invoiceNo)
    expect(real).not.toContain('Sample data')
  })

  it('emptying the body goes back to the standard layout', async () => {
    const t = (await admin.get('/api/v1/core/print-templates')).body.data.find((d) => d.value === 'OPD_BILL').templates[0]
    await admin.patch(`/api/v1/core/print-templates/${t.id}`).send({ body: '' }).expect(200)
    expect(page(await admin.get(`/api/v1/documents/OPD_BILL/${bill.id}`))).toContain('Net payable')
  })
})
