import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_PAYROLL_STATUTORY, STARTER_STRUCTURES, annualIncomeTax, computePayslip, gratuityFor, lineAmount, professionalTax, ruleText, structureProblem,
} from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

const stat = DEFAULT_PAYROLL_STATUTORY
const KA = stat.pt.states.find((s) => s.code === 'KA')
const R = (rupees) => rupees * 100

describe('the payslip engine', () => {
  const comps = STARTER_STRUCTURES[0].components
  it('splits the gross, prorates loss of pay and caps PF at the wage ceiling', () => {
    const r = computePayslip({ month: '2026-11', employee: { gross: R(45000), pf: true, pt: true }, components: comps, stat, ptState: KA, attendance: { lop: 1 } })
    expect(r.payDays).toBe(29)
    expect(r.gross).toBe(R(43500))
    expect(lineAmount(r.earnings, 'BASIC')).toBe(R(21750))
    expect(lineAmount(r.deductions, 'PF')).toBe(R(1800)) // 12% of the ₹15,000 ceiling
    expect(lineAmount(r.deductions, 'PT')).toBe(R(200))
    expect(lineAmount(r.deductions, 'ESI')).toBe(0) // above the ₹21,000 ESI ceiling
    expect(r.net).toBe(r.gross - r.totalDeductions)
  })
  it('deducts ESI below the ceiling, February PT, and TDS on a projected salary', () => {
    const low = computePayslip({ month: '2027-02', employee: { gross: R(18000) }, components: STARTER_STRUCTURES[1].components, stat, ptState: KA })
    expect(lineAmount(low.deductions, 'ESI')).toBe(R(135))
    expect(lineAmount(low.employer, 'ESI_ER')).toBe(R(585))
    expect(professionalTax(KA, R(30000), { month: '2027-02' })).toBe(R(300))
    expect(annualIncomeTax(R(1500000), stat.tds).total).toBe(R(97500))
    expect(annualIncomeTax(R(1200000), stat.tds).total).toBe(0) // rebate
  })
  it('recovers a loan only as far as the pay goes', () => {
    const r = computePayslip({ month: '2026-11', employee: { gross: R(10000) }, components: comps, stat, ptState: KA, attendance: { lop: 29 }, extras: { loans: [{ loanId: 'x', amount: R(5000), label: 'Advance' }] } })
    expect(lineAmount(r.deductions, 'LOAN')).toBeLessThan(R(5000))
    expect(r.net).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/instalment fits/)
  })
  it('checks structures and gratuity', () => {
    expect(structureProblem([{ code: 'HRA', rule: { type: 'PCT', of: 'BASIC', pct: 40 } }])).toMatch(/basic/)
    expect(structureProblem([{ code: 'BASIC', rule: { type: 'PCT', of: 'BASIC', pct: 50 } }])).toMatch(/itself/)
    expect(ruleText({ type: 'FIXED', amount: R(123456) })).toBe('₹1,23,456')
    expect(gratuityFor({ joiningDate: '2016-06-01', lastWorkingDate: '2026-11-30', basicDaMonthly: R(26000), exitType: 'RESIGNED' }, stat.gratuity)).toMatchObject({ eligible: true, counted: 10, amount: R(150000) })
    expect(gratuityFor({ joiningDate: '2023-06-01', lastWorkingDate: '2026-11-30', basicDaMonthly: R(26000) }, stat.gratuity).eligible).toBe(false)
  })
})

let app
let h
let admin
let tpl
let emp
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
  emp = (await admin.post('/api/v1/hrms/employees').send({
    name: 'Kavya Teacher', category: 'TEACHING', employmentType: 'PERMANENT', designation: 'TGT Science', joiningDate: '2026-04-01', gender: 'FEMALE',
    login: { email: 'kavya@pay.test', roleIds: [tpl.id], invite: false, password: 'Kavya@1234' },
  })).body.data
  await admin.put(`/api/v1/hrms/employees/${emp.id}/salary`).send({ grossMonthly: R(45000) }).expect(200)
  await admin.put(`/api/v1/hrms/employees/${emp.id}/sensitive`).send({ pan: 'ABCDE1234F', uan: '100200300400', account: '123456789012', ifsc: 'SBIN0001234', bankName: 'SBI' }).expect(200)
})
afterAll(stopDb)

const api = '/api/v1/payroll'

describe('structures and assignments', () => {
  it('starts with the teaching and office structures, and puts a teacher on one', async () => {
    const list = (await admin.get(`${api}/structures`)).body.data
    expect(list.map((s) => s.code).sort()).toEqual(['STAFF', 'TEACHING'])
    const teaching = list.find((s) => s.code === 'TEACHING')
    const a = (await admin.post(`${api}/assignments`).send({ employeeId: emp.id, structureId: teaching.id, effectiveFrom: '2026-04-01' })).body.data
    expect(a.structureName).toBe('Teaching staff')
    const hist = (await admin.get(`${api}/assignments/${emp.id}`)).body.data
    expect(hist.preview.gross).toBe(R(45000))
    const rows = (await admin.get(`${api}/assignments?search=Kavya`)).body
    expect(rows.data[0].monthly.net).toBeGreaterThan(0)
  })
  it('refuses a structure without a basic', async () => {
    const r = await admin.post(`${api}/structures`).send({ code: 'BAD', name: 'Bad', components: [{ code: 'HRA', rule: { type: 'PCT', of: 'GROSS', pct: 20 } }] })
    expect(r.status).toBe(400)
  })
})

describe('a month’s run', () => {
  let run
  it('calculates October from staff attendance (one day absent)', async () => {
    await admin.put('/api/v1/hrms/attendance/day').send({ date: '2026-10-07', entries: [{ employeeId: emp.id, status: 'ABSENT' }] }).expect(200)
    run = (await admin.post(`${api}/runs`).send({ month: '2026-10' })).body.data
    expect(run.status).toBe('DRAFT')
    expect((await admin.post(`${api}/runs`).send({ month: '2026-10' })).status).toBe(409)
    run = (await admin.post(`${api}/runs/${run.id}/calculate`)).body.data
    expect(run.status).toBe('CALCULATED')
    const slip = run.payslips.find((p) => p.employeeId === emp.id)
    expect(slip).toMatchObject({ lop: 1, payDays: 30, baseDays: 31 })
    expect(slip.warnings.join(' ')).toMatch(/no attendance marked/)
    expect(run.totals.net).toBe(slip.net)
  })

  it('keeps separation of duties: whoever calculated can’t approve', async () => {
    const r = await admin.post(`${api}/runs/${run.id}/approve`).send({})
    expect(r.status).toBe(403)
    expect(r.body.code ?? r.body.error?.code).toBe('SEPARATION_OF_DUTIES')
    await admin.put(`${api}/statutory`).send({ separateDuties: false }).expect(200)
  })

  it('bank files wait for approval; approve, then pay with a UTR', async () => {
    expect((await admin.get(`${api}/runs/${run.id}/exports/bank-csv`)).status).toBe(409)
    const reg = await admin.get(`${api}/runs/${run.id}/exports/register`)
    expect(reg.status).toBe(200)
    expect(reg.text).toContain('Kavya Teacher')
    await admin.post(`${api}/runs/${run.id}/approve`).send({ note: 'OK' }).expect(200)
    const bank = await admin.get(`${api}/runs/${run.id}/exports/bank-csv`)
    expect(bank.text).toContain('123456789012')
    expect((await admin.post(`${api}/runs/${run.id}/pay`).send({ date: '2026-11-01', mode: 'NEFT' })).status).toBe(400)
    const paid = (await admin.post(`${api}/runs/${run.id}/pay`).send({ date: '2026-11-01', mode: 'NEFT', reference: 'UTR123' })).body.data
    expect(paid.status).toBe('PAID')
  })

  it('the teacher sees and prints her paid payslip in My workspace', async () => {
    const me = await signIn(app, 'kavya@pay.test', 'Kavya@1234')
    const mine = (await me.get(`${api}/me/payslips`)).body.data
    expect(mine.payslips).toHaveLength(1)
    expect(mine.payslips[0]).toMatchObject({ month: '2026-10', status: 'PAID' })
    const page = await me.get(`${api}/me/payslips/${mine.payslips[0].id}/print?print=0`)
    expect(page.status).toBe(200)
    expect(page.text).toContain(mine.payslips[0].payslipNo)
    // and nothing of payroll's own screens
    expect((await me.get(`${api}/runs`)).status).toBe(403)
  })
})

describe('advances, LOP corrections and manual lines', () => {
  let run
  let slip
  it('recovers a salary advance in instalments', async () => {
    const loan = (await admin.post(`${api}/loans`).send({ employeeId: emp.id, type: 'ADVANCE', amount: R(6000), instalment: R(2000), startMonth: '2026-11', reason: 'Medical' })).body.data
    expect(loan).toMatchObject({ balance: R(6000), instalmentsLeft: 3 })
    run = (await admin.post(`${api}/runs`).send({ month: '2026-11' })).body.data
    run = (await admin.post(`${api}/runs/${run.id}/calculate`)).body.data
    slip = (await admin.get(`${api}/payslips/${run.payslips[0].id}`)).body.data
    expect(lineAmount(slip.deductions, 'LOAN')).toBe(R(2000))
  })
  it('corrects LOP with a reason and adds extra-class pay', async () => {
    const before = slip.net
    const lop = (await admin.post(`${api}/payslips/${slip.id}/lop`).send({ days: 2, reason: 'Two days absent, not marked' })).body.data
    expect(lop.attendance.lop).toBe(2)
    expect(lop.net).toBeLessThan(before)
    const adj = (await admin.post(`${api}/payslips/${slip.id}/adjustments`).send({ code: 'OTHER_EARNING', label: 'Extra classes', amount: R(1500), note: 'Board exam revision' })).body.data
    expect(lineAmount(adj.earnings, 'OTHER_EARNING')).toBe(R(1500))
    // a recalculation keeps both
    const again = (await admin.post(`${api}/runs/${run.id}/calculate`)).body.data.payslips[0]
    expect(again.lop).toBe(2)
    expect((await admin.get(`${api}/payslips/${slip.id}`)).body.data.adjustments).toHaveLength(1)
  })
  it('can’t close a loan while an unpaid run recovers it', async () => {
    const loans = (await admin.get(`${api}/loans?status=ACTIVE`)).body.data
    expect((await admin.post(`${api}/loans/${loans[0].id}/close`).send({ note: 'Paid back in cash' })).status).toBe(409)
  })
})
