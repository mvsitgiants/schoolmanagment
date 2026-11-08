import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fyOf, fyRange, incomeKeyForHead } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let student
let heads
let receipt
let meta
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  const cls = data.classes.find((c) => c.code === '11')
  student = (await admin.post('/api/v1/students').send({ firstName: 'Ishaan', sectionId: cls.sections[0].id, guardians: [{ name: 'Parent Ishaan', mobile: '9845000301' }] })).body.data
  heads = (await admin.get('/api/v1/fees/heads')).body.data
  const head = (code) => heads.find((x) => x.code === code).id
  const s = (await admin.post('/api/v1/fees/structures').send({
    name: 'Class 11', classIds: [cls.id],
    lines: [{ feeHeadId: head('TUITION'), amount: 6000000 }, { feeHeadId: head('CAUTION'), amount: 500000 }],
    installments: [{ name: 'Annual', dueDate: data.year.startDate, amount: 6500000 }],
  })).body.data
  await admin.post(`/api/v1/fees/structures/${s.id}/generate`).expect(200)
  meta = (await admin.get('/api/v1/finance/meta')).body.data
})
afterAll(stopDb)

const api = '/api/v1/finance'
const acc = (key) => meta.accounts.find((a) => a.systemKey === key)
const linesOf = (j, key) => j.lines.filter((l) => l.accountId === acc(key).id)

describe('helpers', () => {
  it('maps fee heads to ledgers and knows the financial year', () => {
    expect(incomeKeyForHead({ code: 'TUITION' })).toBe('INC_TUITION')
    expect(incomeKeyForHead({ code: 'BUS', name: 'School bus' })).toBe('INC_TRANSPORT')
    expect(incomeKeyForHead({ code: 'CAUTION', refundable: true })).toBe('CAUTION_DEPOSITS')
    expect(fyOf('2027-03-31')).toBe('2026-27')
    expect(fyRange('2026-27')).toEqual({ from: '2026-04-01', to: '2027-03-31' })
  })
})

describe('the chart', () => {
  it('starts with a school chart and a main bank account', async () => {
    expect(acc('INC_TUITION')).toBeTruthy()
    expect(acc('CAUTION_DEPOSITS')).toBeTruthy()
    expect(meta.banks).toHaveLength(1)
    const rows = (await admin.get(`${api}/accounts`)).body.data
    const group = rows.find((a) => a.systemKey === 'G_FEE_INCOME')
    expect(group.isGroup).toBe(true)
    // a system account can't go
    expect((await admin.delete(`${api}/accounts/${acc('INC_TUITION').id}`)).status).toBe(409)
  })
})

describe('fees post to the books on their own', () => {
  it('a receipt: bank debited, tuition income and the caution deposit credited', async () => {
    receipt = (await admin.post('/api/v1/fees/collect').send({ studentId: student.id, amount: 6500000, mode: 'UPI', reference: 'UTR777', waiveLateFee: true })).body.data
    const list = (await admin.get(`${api}/journals?source=FEE_RECEIPT`)).body
    expect(list.data).toHaveLength(1)
    const j = (await admin.get(`${api}/journals/${list.data[0].id}`)).body.data
    expect(j).toMatchObject({ status: 'POSTED', type: 'RECEIPT', total: 6500000, auto: true })
    expect(linesOf(j, 'BANK')[0].debit).toBe(6500000)
    expect(linesOf(j, 'INC_TUITION')[0].credit).toBe(6000000)
    expect(linesOf(j, 'CAUTION_DEPOSITS')[0].credit).toBe(500000)
  })

  it('refunding the caution deposit comes out of the deposit, not income', async () => {
    await admin.post(`/api/v1/fees/receipts/${receipt.id}/refund`).send({ amount: 500000, mode: 'BANK_TRANSFER', reference: 'NEFT55', reason: 'Left the school' }).expect(201)
    const r = (await admin.get(`${api}/journals?source=FEE_REFUND`)).body.data[0]
    const j = (await admin.get(`${api}/journals/${r.id}`)).body.data
    expect(linesOf(j, 'CAUTION_DEPOSITS')[0].debit).toBe(500000)
    expect(linesOf(j, 'FEE_REFUNDS')).toHaveLength(0)
  })

  it('a cancelled receipt is mirrored; rebuilding posts nothing twice', async () => {
    const small = (await admin.post('/api/v1/fees/collect').send({ studentId: student.id, amount: 100000, mode: 'CASH' })).body.data
    await admin.post(`/api/v1/fees/receipts/${small.id}/cancel`).send({ reason: 'Wrong student' }).expect(200)
    const rows = (await admin.get(`${api}/journals?source=FEE_RECEIPT`)).body.data
    expect(rows).toHaveLength(3) // two receipts and the cancellation
    const fy = fyRange(meta.fy)
    const again = (await admin.post(`${api}/postings/rebuild`).send(fy)).body.data
    expect(again.posted).toBe(0)
    expect(again.existing).toBeGreaterThanOrEqual(4)
  })
})

describe('vouchers by hand', () => {
  let draft
  it('refuses an unbalanced voucher; drafts, posts and reverses a contra', async () => {
    const bad = await admin.post(`${api}/journals`).send({ type: 'JOURNAL', date: receipt.date, lines: [{ accountId: acc('CASH').id, debit: 100 }, { accountId: acc('BANK').id, credit: 90 }] })
    expect(bad.status).toBe(400)
    const notMoney = await admin.post(`${api}/journals`).send({ type: 'CONTRA', date: receipt.date, lines: [{ accountId: acc('CASH').id, debit: 100 }, { accountId: acc('INC_TUITION').id, credit: 100 }] })
    expect(notMoney.status).toBe(400)
    draft = (await admin.post(`${api}/journals`).send({ type: 'CONTRA', date: receipt.date, narration: 'Cash deposited', lines: [{ accountId: acc('BANK').id, debit: 200000 }, { accountId: acc('CASH').id, credit: 200000 }] })).body.data
    expect(draft.status).toBe('DRAFT')
    const posted = (await admin.post(`${api}/journals/${draft.id}/post`)).body.data
    expect(posted.voucherNo).toMatch(/^CV/)
    expect((await admin.patch(`${api}/journals/${draft.id}`).send({ narration: 'x' })).status).toBe(409)
    const rev = (await admin.post(`${api}/journals/${draft.id}/reverse`).send({ reason: 'Deposited twice' })).body.data
    expect(rev.reversalOf.voucherNo).toBe(posted.voucherNo)
    expect((await admin.post(`${api}/journals/${draft.id}/reverse`).send({ reason: 'Again' })).status).toBe(409)
  })
})

describe('expenses', () => {
  let x
  it('recorded, approved and paid — paying posts it, TDS held back', async () => {
    const heads2 = (await admin.get(`${api}/expenses/heads`)).body.data
    const power = heads2.find((a) => /Electricity/.test(a.name))
    x = (await admin.post(`${api}/expenses`).send({ date: receipt.date, accountId: power.id, payee: { name: 'State electricity board' }, description: 'October bill', amount: 1200000 })).body.data
    expect(x.status).toBe('SUBMITTED')
    expect((await admin.post(`${api}/expenses/${x.id}/pay`).send({ date: receipt.date, mode: 'CASH' })).status).toBe(409)
    await admin.post(`${api}/expenses/${x.id}/decide`).send({ approve: true }).expect(200)
    expect((await admin.post(`${api}/expenses/${x.id}/pay`).send({ date: receipt.date, mode: 'BANK_TRANSFER' })).status).toBe(400)
    const paid = (await admin.post(`${api}/expenses/${x.id}/pay`).send({ date: receipt.date, mode: 'BANK_TRANSFER', reference: 'UTR900' })).body.data
    expect(paid.status).toBe('PAID')
    const j = (await admin.get(`${api}/journals/${paid.paid.journalId}`)).body.data
    expect(j.lines.find((l) => l.accountId === power.id).debit).toBe(1200000)

    const rent = heads2.find((a) => /Rent/.test(a.name))
    const y = (await admin.post(`${api}/expenses`).send({ date: receipt.date, accountId: rent.id, payee: { name: 'Landlord' }, description: 'Hostel block rent', amount: 5000000, tds: { section: '194I', pct: 10, amount: 500000 } })).body.data
    expect(y.payable).toBe(4500000)
    await admin.post(`${api}/expenses/${y.id}/decide`).send({ approve: true }).expect(200)
    const yp = (await admin.post(`${api}/expenses/${y.id}/pay`).send({ date: receipt.date, mode: 'CHEQUE', reference: 'CHQ 1001' })).body.data
    const yj = (await admin.get(`${api}/journals/${yp.paid.journalId}`)).body.data
    expect(linesOf(yj, 'TDS_PAYABLE')[0].credit).toBe(500000)
    expect(linesOf(yj, 'BANK')[0].credit).toBe(4500000)
  })
})

describe('bank reconciliation', () => {
  it('imports a statement and matches the fee receipt by amount and reference', async () => {
    const [d] = receipt.date.split('T')
    const dmy = `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
    const csv = `Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance\n${dmy},UPI COLLECT,UTR777,,65000.00,65000.00\n${dmy},BANK CHARGES,,118.00,,64882.00\n`
    const bank = meta.banks[0]
    const r = (await admin.post(`${api}/bank/accounts/${bank.id}/import`).send({ csv })).body.data
    expect(r).toMatchObject({ imported: 2, matched: 1 })
    expect((await admin.post(`${api}/bank/accounts/${bank.id}/import`).send({ csv })).body.data).toMatchObject({ imported: 0, duplicates: 2 })
    const rec = (await admin.get(`${api}/bank/accounts/${bank.id}/reconciliation`)).body.data
    expect(rec.summary.statementUnreconciled.count).toBe(1) // the bank charges, not yet in the books
  })
})

describe('reports', () => {
  it('the trial balance and the balance sheet balance; income and expenditure adds up', async () => {
    const fy = fyRange(meta.fy)
    const tb = (await admin.get(`${api}/reports/trial-balance`).query(fy)).body.data
    expect(tb.balanced).toBe(true)
    const ie = (await admin.get(`${api}/reports/income-expenditure`).query(fy)).body.data
    expect(ie.income.total).toBe(6000000)
    expect(ie.expenses.total).toBe(6200000)
    expect(ie.profit).toBe(-200000)
    const bs = (await admin.get(`${api}/reports/balance-sheet`).query({ asOf: fy.to })).body.data
    expect(bs.balanced).toBe(true)
    const cash = (await admin.get(`${api}/reports/ledger`).query({ ...fy, accountId: acc('CASH').id })).body.data
    expect(cash.closing).toBe(0) // the cash receipt was cancelled, the contra reversed
    const tally = await admin.get(`${api}/reports/tally/export`).query(fy)
    expect(tally.text).toContain('<VOUCHER VCHTYPE="Receipt"')
    const csv = await admin.get(`${api}/reports/trial-balance/export`).query(fy)
    expect(csv.text).toContain('Tuition fees')
  })
})
