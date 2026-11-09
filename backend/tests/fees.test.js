import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let year
let cls
let heads
let aarav
let diya
let structure
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  const add = async (firstName, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: cls.sections[0].id, guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', '9845000011')
  diya = await add('Diya', '9845000022')
  heads = (await admin.get('/api/v1/fees/heads')).body.data
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const api = '/api/v1/fees'
const head = (code) => heads.find((x) => x.code === code).id

describe('structures and invoices', () => {
  it('a new institution has the usual fee heads', () => {
    expect(heads.map((x) => x.code)).toEqual(expect.arrayContaining(['TUITION', 'ADMISSION', 'TRANSPORT']))
  })

  it('refuses installments that don’t add up to the fees', async () => {
    const bad = await admin.post(`${api}/structures`).send({ name: 'Class 11', classIds: [cls.id], lines: [{ feeHeadId: head('TUITION'), amount: 6000000 }], installments: [{ name: 'Term 1', dueDate: year.startDate, amount: 1000000 }] })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields.installments).toMatch(/add up to/)
  })

  it('raises one invoice per student per installment, only once', async () => {
    const mid = year.terms[1]?.startDate ?? year.endDate
    structure = (await admin.post(`${api}/structures`).send({
      name: 'Class 11', classIds: [cls.id],
      lines: [{ feeHeadId: head('TUITION'), amount: 6000000 }, { feeHeadId: head('LAB'), amount: 1000000 }],
      installments: [{ name: 'Term 1', dueDate: year.startDate, amount: 3500000 }, { name: 'Term 2', dueDate: mid, amount: 3500000 }],
    })).body.data
    const first = (await admin.post(`${api}/structures/${structure.id}/generate`)).body.data
    expect(first).toMatchObject({ created: 4, students: 2 })
    expect((await admin.post(`${api}/structures/${structure.id}/generate`)).body.data).toMatchObject({ created: 0, skipped: 4 })
    const ledger = (await admin.get(`${api}/students/${aarav.id}`)).body.data
    expect(ledger.invoices.map((i) => i.net)).toEqual([3500000, 3500000])
    expect(ledger.invoices[0].lines.reduce((n, l) => n + l.amount, 0)).toBe(3500000)
    // amounts are fixed once invoiced
    expect((await admin.patch(`${api}/structures/${structure.id}`).send({ ...structure, lines: [{ feeHeadId: head('TUITION'), amount: 7000000 }], installments: [{ name: 'Term 1', dueDate: year.startDate, amount: 7000000 }] })).status).toBe(409)
  })
})

describe('concessions', () => {
  it('needs a second person to approve, then lowers the unpaid invoices', async () => {
    const c = (await admin.post(`${api}/concessions`).send({ studentId: diya.id, kind: 'PCT', value: 10, feeHeadIds: [head('TUITION')], reason: 'Sibling' })).body.data
    expect(c.status).toBe('PENDING')
    const done = (await admin.post(`${api}/concessions/${c.id}/decide`).send({ approve: true })).body.data // the admin has full access
    expect(done.invoicesUpdated).toBe(2)
    const ledger = (await admin.get(`${api}/students/${diya.id}`)).body.data
    expect(ledger.invoices[0].concession).toBe(300000) // 10% of the tuition share (₹30,000 of ₹35,000)
    expect(ledger.invoices[0].net).toBe(3200000)
    const list = (await admin.get(`${api}/concessions`).query({ status: 'APPROVED', search: 'diy', pageSize: 10 })).body.data
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 10 })
    expect(list.rows[0]).toMatchObject({ id: c.id, status: 'APPROVED' })
    expect((await admin.get(`${api}/concessions`).query({ search: 'aarav' })).body.data.total).toBe(0)
  })
})

describe('collecting fees', () => {
  it('pays the oldest installment first, tells the family, and prints the receipt', async () => {
    const res = await admin.post(`${api}/collect`).send({ studentId: aarav.id, amount: 4000000, mode: 'UPI', reference: 'UTR123', waiveLateFee: true })
    expect(res.status).toBe(201)
    const r = res.body.data
    expect(r.receiptNo).toMatch(/^RC\d{4}\d{6}$/)
    expect(r.allocations.map((a) => a.amount)).toEqual([3500000, 500000])
    expect(r.balance).toBe(3000000)
    const ledger = (await admin.get(`${api}/students/${aarav.id}`)).body.data
    expect(ledger.invoices.map((i) => i.status)).toEqual(['PAID', 'PARTIAL'])
    const sms = await runAsTenant(h.tenant._id, () => MessageLog.findOne({ event: 'fees.receipt', channel: 'SMS' }).lean())
    expect(sms.body).toContain('₹40,000')
    const html = (await admin.get(`/api/v1/documents/FEE_RECEIPT/${r.id}?print=0`)).text
    expect(html).toContain(r.receiptNo)
    expect(html).toContain('Rupees Forty Thousand Only')
  })

  it('refuses more than is due, and a non-cash payment without a reference', async () => {
    expect((await admin.post(`${api}/collect`).send({ studentId: aarav.id, amount: 9900000, mode: 'CASH', waiveLateFee: true })).status).toBe(400)
    expect((await admin.post(`${api}/collect`).send({ studentId: aarav.id, amount: 100000, mode: 'CHEQUE' })).status).toBe(400)
  })

  it('cancelling a receipt puts the money back on the invoices', async () => {
    const r = (await admin.post(`${api}/collect`).send({ studentId: aarav.id, amount: 100000, mode: 'CASH', waiveLateFee: true })).body.data
    await admin.post(`${api}/receipts/${r.id}/cancel`).send({ reason: 'Wrong student' }).expect(200)
    expect((await admin.get(`${api}/students/${aarav.id}`)).body.data.totals.balance).toBe(3000000)
  })

  it('a refund makes the latest installment it paid due again', async () => {
    const receipts = (await admin.get(`${api}/receipts?status=VALID`)).body.data
    const r = receipts.find((x) => x.amount === 4000000)
    await admin.post(`${api}/receipts/${r.id}/refund`).send({ amount: 500000, mode: 'BANK_TRANSFER', reference: 'NEFT9', reason: 'Lab fee waived' }).expect(201)
    const ledger = (await admin.get(`${api}/students/${aarav.id}`)).body.data
    expect(ledger.totals.balance).toBe(3500000)
    const refunds = (await admin.get(`${api}/refunds`)).body.data
    expect(refunds.rows[0]).toMatchObject({ amount: 500000, receiptNo: r.receiptNo })
    expect(refunds).toMatchObject({ total: 1, page: 1, pageSize: 50, summary: { count: 1, amount: 500000, students: 1, byMode: { BANK_TRANSFER: 1 }, largest: { amount: 500000 } } })
    expect((await admin.get(`${api}/refunds`).query({ search: 'diya' })).body.data.total).toBe(0)
  })
})

describe('dues and day-end', () => {
  it('lists students with fees due and sends reminders', async () => {
    const dues = (await admin.get(`${api}/dues`)).body.data
    expect(dues.rows.map((d) => d.name).sort()).toEqual(['Aarav', 'Diya'])
    expect(dues).toMatchObject({ total: 2, page: 1, pageSize: 50 })
    expect(dues.summary.students).toBe(2)
    expect(dues.summary.due).toBe(dues.rows.reduce((n, d) => n + d.due, 0))
    expect(dues.classes).toEqual([{ classId: cls.id, students: 2, due: dues.summary.due, overdue: dues.summary.overdue }])
    // a page of one: the totals and the class figures stay those of the whole list
    const one = (await admin.get(`${api}/dues`).query({ pageSize: 1, page: 2 })).body.data
    expect(one.rows).toHaveLength(1)
    expect(one).toMatchObject({ total: 2, summary: dues.summary, classes: dues.classes })
    expect((await admin.get(`${api}/dues`).query({ classId: cls.id, search: 'diy' })).body.data.rows.map((d) => d.name)).toEqual(['Diya'])
    const sent = (await admin.post(`${api}/dues/remind`).send({ studentIds: dues.rows.map((d) => d.studentId) })).body.data
    expect(sent.sent).toBe(2)
    // "remind everyone in this list" goes by the filter, not the page on screen
    expect((await admin.post(`${api}/dues/remind`).send({ all: { classId: cls.id } })).body.data.sent).toBe(2)
    expect((await admin.post(`${api}/dues/remind`).send({})).status).toBe(400)
  })

  it('closes the day: cash counted against cash receipts, a difference waits for approval', async () => {
    await admin.post(`${api}/collect`).send({ studentId: diya.id, amount: 200000, mode: 'CASH', waiveLateFee: true }).expect(201)
    const sum = (await admin.get(`${api}/day-end`)).body.data
    expect(sum.expectedCash).toBe(200000) // the cancelled cash receipt doesn't count
    const closed = (await admin.post(`${api}/day-end/close`).send({ cashCounted: 190000 })).body.data
    expect(closed).toMatchObject({ status: 'VARIANCE', variance: -10000 })
    expect((await admin.post(`${api}/day-end/close`).send({ cashCounted: 200000 })).status).toBe(409)
  })
})
