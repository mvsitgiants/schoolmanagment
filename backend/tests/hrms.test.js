import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accrualUpTo, countLeaveDays, dayPay, leaveDates, leaveYear, monthTotals, monthsSoFar, normalizeAccrual, pickLeaveRule, quotaFor, weightedScore,
} from '@schoolgiant/shared'
import { Employee, StaffAttendance } from '../src/models/hrms.js'
import { User } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { sweepExits } from '../src/services/hrms.js'
import { payDays } from '../src/services/hrmsAttendance.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let tpl
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
  // weekly off on Sunday only, leave year from April
  await admin.patch('/api/v1/core/settings/modules/hrms').send({ weeklyOffDays: ['SUN'], saturdaysOff: [], leaveYearStartMonth: 4 }).expect(200)
})
afterAll(stopDb)

const api = '/api/v1/hrms'

describe('helpers', () => {
  it('counts leave days around offs and holidays', () => {
    // Fri 6 Nov – Tue 10 Nov 2026, Sunday off
    expect(leaveDates('2026-11-06', '2026-11-10', { offDays: ['SUN'] }).days).toBe(4)
    expect(leaveDates('2026-11-06', '2026-11-10', { offDays: ['SUN'], sandwich: true }).days).toBe(5)
    expect(leaveDates('2026-11-09', '2026-11-09', { halfDay: true }).days).toBe(0.5)
    expect(leaveDates('2026-11-08', '2026-11-08', { offDays: ['SUN'] }).days).toBe(0)
  })
  it('works out the leave year and accrual', () => {
    expect(leaveYear('2026-02-10', 4)).toEqual({ from: '2025-04-01', to: '2026-03-31', label: '2025-26' })
    expect(leaveYear('2026-07-01', 1).label).toBe('2026')
    expect(monthsSoFar('2026-06-15', 4)).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(accrualUpTo(15, 12)).toBe(15)
    expect(accrualUpTo(15, 1)).toBe(1)
  })
  it('counts leave days with the sandwich rule, reads older accruals and per-category quotas, and picks a chain', () => {
    // Fri, Sat (off), Sun (off), Mon
    const days = [{ date: 'f', working: true }, { date: 's', working: false }, { date: 'u', working: false }, { date: 'm', working: true }]
    expect(countLeaveDays(days).days).toBe(2)
    const sw = countLeaveDays(days, { sandwich: true })
    expect(sw.days).toBe(4)
    expect(sw.dates.filter((d) => d.sandwiched).length).toBe(2)
    expect(countLeaveDays([{ date: 'x', working: true }], { halfDay: true }).days).toBe(0.5)
    expect(normalizeAccrual('YEARLY')).toBe('ANNUAL_UPFRONT')
    expect(normalizeAccrual(undefined)).toBe('NONE')
    const el = { perYear: 15, categoryQuota: [{ category: 'TEACHING', perYear: 5 }] }
    expect(quotaFor(el, { category: 'TEACHING' })).toBe(5)
    expect(quotaFor(el, { category: 'ADMIN' })).toBe(15)
    const rules = [
      { id: 'a', priority: 1, scope: {}, active: true },
      { id: 'b', priority: 5, scope: { categories: ['TEACHING'], minDays: 3 }, active: true },
      { id: 'c', priority: 9, scope: {}, active: false },
    ]
    expect(pickLeaveRule(rules, { category: 'TEACHING', days: 4 }).id).toBe('b')
    expect(pickLeaveRule(rules, { category: 'TEACHING', days: 2 }).id).toBe('a')
  })
  it('pays leave and counts a month', () => {
    expect(dayPay('LEAVE', { leavePaid: false, portion: 0.5 })).toEqual({ payable: 0.5, lop: 0.5 })
    expect(dayPay('ABSENT')).toEqual({ payable: 0, lop: 1 })
    expect(monthTotals([{ status: 'PRESENT', payable: 1, lop: 0, late: true }, { status: 'ABSENT', payable: 0, lop: 1 }])).toMatchObject({ PRESENT: 1, ABSENT: 1, payable: 1, lop: 1, late: 1 })
    expect(weightedScore([{ key: 'a', weight: 3 }, { key: 'b', weight: 1 }], { a: 4, b: 2 })).toBe(3.5)
    expect(weightedScore([{ key: 'a' }], {})).toBeNull()
  })
})

let principal
let teacher
describe('staff records', () => {
  it('adds a principal and a teacher with a login, reporting to the principal', async () => {
    principal = (await admin.post(`${api}/employees`).send({ name: 'Rekha Principal', category: 'ADMIN', employmentType: 'PERMANENT', designation: 'Principal', joiningDate: '2020-06-01', gender: 'FEMALE' })).body.data
    expect(principal.employeeCode).toMatch(/^EMP\d{5}$/)
    // give the principal a login, so leave goes to her
    const login = (await admin.post(`${api}/employees/${principal.id}/login`).send({ email: 'rekha@hr.test', roleIds: [tpl.id], invite: false, password: 'Princ@1234' })).body.data
    expect(login.employee.hasLogin).toBe(true)
    teacher = (await admin.post(`${api}/employees`).send({
      name: 'Sunil Teacher', category: 'TEACHING', employmentType: 'PERMANENT', designation: 'TGT Maths', joiningDate: '2026-04-01', gender: 'MALE', mobile: '9845000101',
      reportingManagerId: principal.id, login: { email: 'sunil@hr.test', roleIds: [tpl.id], invite: false, password: 'Sunil@1234' },
    })).body.data
    expect(teacher).toMatchObject({ hasLogin: true, manager: { name: 'Rekha Principal' } })
  })

  it('refuses a reporting loop and a duplicate code', async () => {
    const loop = await admin.patch(`${api}/employees/${principal.id}`).send({ reportingManagerId: teacher.id })
    expect(loop.status).toBe(400)
    const dup = await admin.post(`${api}/employees`).send({ name: 'Copy', category: 'OTHER', employmentType: 'PERMANENT', joiningDate: '2026-04-01', employeeCode: teacher.employeeCode })
    expect(dup.status).toBe(409)
  })

  it('records a job change and keeps salary and ids hidden from those without the rights', async () => {
    const after = (await admin.patch(`${api}/employees/${teacher.id}`).send({ designation: 'PGT Maths', changeNote: 'Promoted' })).body.data
    expect(after.jobHistory[0]).toMatchObject({ type: 'DESIGNATION', from: 'TGT Maths', to: 'PGT Maths' })
    await admin.put(`${api}/employees/${teacher.id}/salary`).send({ grossMonthly: 4500000, basicMonthly: 2250000 }).expect(200)
    const ids = (await admin.put(`${api}/employees/${teacher.id}/sensitive`).send({ pan: 'ABCDE1234F', account: '123456789012', ifsc: 'SBIN0001234' })).body.data
    expect(ids.statutory.pan).toBe('••••234F')
    expect(ids.bank.account).toBe('••••9012')
    const full = (await admin.get(`${api}/employees/${teacher.id}/sensitive`)).body.data
    expect(full).toMatchObject({ pan: 'ABCDE1234F', account: '123456789012' })
    // stored encrypted
    const raw = await runAsTenant(h.tenant._id, () => Employee.findById(teacher.id).select('+statutory').lean())
    expect(raw.statutory.pan.enc).not.toContain('ABCDE')
    // a teacher can't open staff records
    const t = await signIn(app, 'sunil@hr.test', 'Sunil@1234')
    expect((await t.get(`${api}/employees/${teacher.id}`)).status).toBe(403)
  })

  it('makes records for logins that have none', async () => {
    await admin.post('/api/v1/core/users').send({ name: 'Office Clerk', email: 'clerk@hr.test', roleIds: [tpl.id], password: 'Clerk@1234' }).expect(201)
    const r = (await admin.post(`${api}/employees/from-logins`)).body.data
    expect(r.made).toBeGreaterThanOrEqual(1)
    expect((await admin.post(`${api}/employees/from-logins`)).body.data.made).toBe(0)
  })
})

describe('leave', () => {
  let me
  it('credits the year’s leave and shows the balance in My workspace', async () => {
    me = await signIn(app, 'sunil@hr.test', 'Sunil@1234')
    const mine = (await me.get(`${api}/me/leave`)).body.data
    const cl = mine.balances.find((b) => b.code === 'CL')
    expect(cl.balance).toBe(12) // joined on the first day of the leave year
    expect(mine.balances.some((b) => b.code === 'ML')).toBe(false) // maternity leave: not for him
    expect(mine.balances.some((b) => b.code === 'EL')).toBe(false) // earned leave: not for teaching staff
  })

  let req
  it('a teacher asks for leave; it goes to the principal, who approves it', async () => {
    const types = (await admin.get(`${api}/leave/types`)).body.data
    const cl = types.find((t) => t.code === 'CL')
    // Mon 7 – Wed 9 Dec 2026
    req = (await me.post(`${api}/me/leave`).send({ leaveTypeId: cl.id, from: '2026-12-07', to: '2026-12-09', reason: 'Family function', arrangement: 'Meena takes 9B maths' })).body.data
    expect(req).toMatchObject({ status: 'PENDING', days: 3 })
    // more than allowed at once
    expect((await me.post(`${api}/me/leave`).send({ leaveTypeId: cl.id, from: '2026-12-14', to: '2026-12-18', reason: 'Trip' })).status).toBe(400)
    // overlapping
    expect((await me.post(`${api}/me/leave`).send({ leaveTypeId: cl.id, from: '2026-12-09', to: '2026-12-09', reason: 'x1' })).status).toBe(409)
    // he can't approve his own
    expect((await me.post(`${api}/me/approvals/${req.id}`).send({ approve: true })).status).toBe(403)
    const p = await signIn(app, 'rekha@hr.test', 'Princ@1234')
    const waiting = (await p.get(`${api}/me/approvals`)).body.data
    expect(waiting.map((x) => x.id)).toContain(req.id)
    const done = (await p.post(`${api}/me/approvals/${req.id}`).send({ approve: true, note: 'OK' })).body.data
    expect(done.status).toBe('APPROVED')
    const bal = (await me.get(`${api}/me/leave`)).body.data.balances.find((b) => b.code === 'CL')
    expect(bal).toMatchObject({ balance: 9, taken: 3 })
    // the days are on leave in staff attendance
    const day = (await admin.get(`${api}/attendance/day?date=2026-12-08`)).body.data.rows.find((r) => r.employeeId === teacher.id)
    expect(day).toMatchObject({ status: 'LEAVE', locked: true, leave: { code: 'CL' } })
  })

  it('cancelling an approved leave gives the days back', async () => {
    await admin.post(`${api}/leave/${req.id}/cancel`).send({ reason: 'Function postponed' }).expect(200)
    const bal = (await me.get(`${api}/me/leave`)).body.data.balances.find((b) => b.code === 'CL')
    expect(bal.balance).toBe(12)
    expect(await runAsTenant(h.tenant._id, () => StaffAttendance.countDocuments({ employeeId: teacher.id, source: 'LEAVE' }))).toBe(0)
  })

  it('refuses more than the balance; unpaid leave has none to check and counts as loss of pay', async () => {
    const types = (await admin.get(`${api}/leave/types`)).body.data
    const sl = types.find((t) => t.code === 'SL')
    const lop = types.find((t) => t.code === 'LOP')
    expect((await admin.post(`${api}/leave`).send({ employeeId: teacher.id, leaveTypeId: sl.id, from: '2026-11-02', to: '2026-11-20', reason: 'Long illness' })).status).toBe(409)
    const l = (await admin.post(`${api}/leave`).send({ employeeId: teacher.id, leaveTypeId: lop.id, from: '2026-11-05', to: '2026-11-05', reason: 'Personal', approveNow: true })).body.data
    expect(l.status).toBe('APPROVED')
    const pay = await runAsTenant(h.tenant._id, () => payDays('2026-11', [teacher.id]))
    expect(pay[teacher.id]).toMatchObject({ lop: 1 })
  })

  it('HR can adjust a balance with a reason', async () => {
    const cl = (await admin.get(`${api}/leave/types`)).body.data.find((t) => t.code === 'CL')
    const after = (await admin.post(`${api}/employees/${teacher.id}/leave/adjust`).send({ leaveTypeId: cl.id, days: 1.5, note: 'Worked on the annual day' })).body.data
    expect(after.find((b) => b.code === 'CL').balance).toBe(13.5)
    expect((await admin.post(`${api}/employees/${teacher.id}/leave/adjust`).send({ leaveTypeId: cl.id, days: 0.3, note: 'Bad' })).status).toBe(400)
  })
})

describe('leave: starter types, approval chains, no-leave days, preview, comp-off, calendar and year end', () => {
  let me
  let p
  let types
  const type = (code) => types.find((x) => x.code === code)
  beforeAll(async () => {
    me = await signIn(app, 'sunil@hr.test', 'Sunil@1234')
    p = await signIn(app, 'rekha@hr.test', 'Princ@1234')
    types = (await admin.get(`${api}/leave/types`)).body.data
  })

  it('starts a school with its leave types; the short name stays as made', async () => {
    for (const c of ['CL', 'SL', 'EL', 'ML', 'PL', 'CCL', 'DL', 'CO', 'LOP']) expect(type(c), c).toBeTruthy()
    expect(type('CL').accrual).toBe('ANNUAL_UPFRONT')
    expect(type('CO').compOff).toBe(true)
    expect(type('DL').allowNegative).toBe(true)
    // changing a policy keeps its code; teaching staff get their own number of earned leave
    const el = (await admin.put(`${api}/leave/types/${type('EL').id}`).send({ ...type('EL'), code: 'ZZ', categories: [], categoryQuota: [{ category: 'TEACHING', perYear: 6 }] })).body.data
    expect(el.code).toBe('EL')
    const mine = (await me.get(`${api}/me/leave`)).body.data.balances.find((b) => b.code === 'EL')
    expect(mine).toBeTruthy() // now for everyone, 6 a year for teachers, earned monthly
    expect(mine.balance).toBeLessThanOrEqual(6)
    // a new policy needs a unique short name
    expect((await admin.post(`${api}/leave/types`).send({ code: 'CL', name: 'Copy', accrual: 'NONE' })).status).toBe(400)
  })

  it('previews a leave: the days that count, the balance after, the lessons and who approves it', async () => {
    // Fri 8 – Mon 11 Jan 2027: Sat counts, Sunday is the weekly off
    const pv = (await me.post(`${api}/me/leave/preview`).send({ leaveTypeId: type('CL').id, from: '2027-01-08', to: '2027-01-11' })).body.data
    expect(pv.days).toBe(3)
    expect(pv.dates.find((d) => d.date === '2027-01-10')).toMatchObject({ portion: 0, reason: 'Weekly off' })
    expect(pv.after).toBe(pv.available - 3)
    expect(pv.ok).toBe(true)
    expect(pv.chain.steps[0].people).toContain('Rekha Principal')
    // too long for casual leave: a problem, not an error
    const long = (await me.post(`${api}/me/leave/preview`).send({ leaveTypeId: type('CL').id, from: '2027-01-11', to: '2027-01-16' })).body.data
    expect(long.ok).toBe(false)
    expect(long.problems.map((x) => x.code)).toContain('TOO_LONG')
  })

  let chain
  it('a two-step chain: the reporting manager, then the principal / HR; days are held until the last step', async () => {
    chain = (await admin.post(`${api}/leave/chains`).send({
      name: 'Teachers — manager then office', priority: 10, scope: { categories: ['TEACHING'], leaveTypeIds: [type('CL').id] },
      steps: [{ approverType: 'REPORTING_MANAGER' }, { approverType: 'HR', label: 'Office' }],
    })).body.data
    expect(chain.summary).toBe('Reporting manager → Office')
    const before = (await me.get(`${api}/me/leave`)).body.data.balances.find((b) => b.code === 'CL')
    const l = (await me.post(`${api}/me/leave`).send({ leaveTypeId: type('CL').id, from: '2027-01-04', to: '2027-01-05', reason: 'Wedding' })).body.data
    expect(l.chain).toMatchObject({ status: 'PENDING', stepNumber: 1, totalSteps: 2, waitingOn: 'Reporting manager' })
    const held = (await me.get(`${api}/me/leave`)).body.data.balances.find((b) => b.code === 'CL')
    expect(held).toMatchObject({ balance: before.balance, pending: before.pending + 2 })
    // saying no needs a reason
    expect((await p.post(`${api}/me/approvals/${l.id}`).send({ approve: false })).status).toBe(400)
    const step1 = (await p.post(`${api}/me/approvals/${l.id}`).send({ approve: true })).body.data
    expect(step1.chain).toMatchObject({ status: 'PENDING', stepNumber: 2, waitingOn: 'Office' })
    expect(step1.chain.steps[0]).toMatchObject({ state: 'APPROVED', decidedBy: 'Rekha Principal' })
    // the manager's step is done: it's no longer waiting on her
    expect((await p.get(`${api}/me/approvals`)).body.data.map((x) => x.id)).not.toContain(l.id)
    // the office's step: in the HR inbox
    const inbox = (await admin.get(`${api}/leave?box=mine`)).body.data
    expect(inbox.rows.map((x) => x.id)).toContain(l.id)
    expect(inbox.waitingOnMe).toBeGreaterThanOrEqual(1)
    const done = (await admin.post(`${api}/leave/${l.id}/decide`).send({ approve: true, note: 'Enjoy' })).body.data
    expect(done.status).toBe('APPROVED')
    const after = (await me.get(`${api}/me/leave`)).body.data.balances.find((b) => b.code === 'CL')
    expect(after).toMatchObject({ balance: before.balance - 2, pending: before.pending })
    // the detail has the chain and the balance
    const detail = (await admin.get(`${api}/leave/${l.id}`)).body.data
    expect(detail.chain.steps.map((s) => s.state)).toEqual(['APPROVED', 'APPROVED'])
    await admin.post(`${api}/leave/${l.id}/cancel`).send({ reason: 'Postponed' }).expect(200)
  })

  it('anyone who approves leave can decide in place of the step’s approver; nobody decides their own', async () => {
    const l = (await me.post(`${api}/me/leave`).send({ leaveTypeId: type('CL').id, from: '2027-01-18', to: '2027-01-18', reason: 'Bank work' })).body.data
    const seen = (await admin.get(`${api}/leave/${l.id}`)).body.data
    expect(seen.chain).toMatchObject({ canAct: true, actingAsHr: true })
    expect((await me.post(`${api}/me/approvals/${l.id}`).send({ approve: true })).status).toBe(403)
    const done = (await admin.post(`${api}/leave/${l.id}/decide`).send({ approve: true })).body.data
    expect(done.status).toBe('APPROVED')
    expect(done.chain.steps[0].override).toBe(true)
    await admin.post(`${api}/leave/${l.id}/cancel`).send({}).expect(200)
    await admin.delete(`${api}/leave/chains/${chain.id}`).expect(200)
  })

  it('no-leave days: a warning, the principal’s approval, or not allowed (HR can still enter it)', async () => {
    const exams = (await admin.post(`${api}/leave/no-leave-days`).send({ kind: 'NO_LEAVE', name: 'Pre-board exams', from: '2027-02-01', to: '2027-02-06', mode: 'BLOCK', categories: ['TEACHING'] })).body.data
    const blocked = await me.post(`${api}/me/leave`).send({ leaveTypeId: type('CL').id, from: '2027-02-02', to: '2027-02-02', reason: 'Personal' })
    expect(blocked.status).toBe(409)
    // sick leave doesn't follow the no-leave days
    const sick = (await me.post(`${api}/me/leave/preview`).send({ leaveTypeId: type('SL').id, from: '2027-02-02' })).body.data
    expect(sick.ok).toBe(true)
    expect(sick.noLeave).toEqual([])
    // HR enters it anyway: a warning, and the principal / HR must approve it
    const hr = (await admin.post(`${api}/leave`).send({ employeeId: teacher.id, leaveTypeId: type('CL').id, from: '2027-02-02', to: '2027-02-02', reason: 'Family emergency' })).body.data
    expect(hr.warnings.join(' ')).toMatch(/Pre-board exams/)
    expect(hr.chain.steps.at(-1).approverType).toBe('HR')
    await admin.post(`${api}/leave/${hr.id}/cancel`).send({}).expect(200)
    // a warning only
    await admin.put(`${api}/leave/no-leave-days/${exams.id}`).send({ kind: 'NO_LEAVE', name: 'Pre-board exams', from: '2027-02-01', to: '2027-02-06', mode: 'WARN' }).expect(200)
    const warn = (await me.post(`${api}/me/leave/preview`).send({ leaveTypeId: type('CL').id, from: '2027-02-03' })).body.data
    expect(warn).toMatchObject({ ok: true, needsHr: false })
    expect(warn.warnings.length).toBe(1)
    await admin.delete(`${api}/leave/no-leave-days/${exams.id}`).expect(200)
  })

  it('a school vacation isn’t counted as leave for the staff it covers', async () => {
    const v = (await admin.post(`${api}/leave/no-leave-days`).send({ kind: 'VACATION', name: 'Winter break', from: '2027-01-25', to: '2027-01-27', categories: ['TEACHING'] })).body.data
    const pv = (await me.post(`${api}/me/leave/preview`).send({ leaveTypeId: type('SL').id, from: '2027-01-25', to: '2027-01-28' })).body.data
    expect(pv.days).toBe(1)
    expect(pv.dates[0].reason).toBe('Winter break')
    await admin.delete(`${api}/leave/no-leave-days/${v.id}`).expect(200)
  })

  it('compensatory off for a day worked, once per day; an opening balance; the ledger says what each entry is', async () => {
    const after = (await admin.post(`${api}/leave/comp-off`).send({ employeeId: teacher.id, workedDate: '2026-11-08', days: 1, note: 'Sports day' })).body.data
    expect(after.find((b) => b.code === 'CO').balance).toBe(1)
    expect((await admin.post(`${api}/leave/comp-off`).send({ employeeId: teacher.id, workedDate: '2026-11-08', days: 1 })).status).toBe(409)
    const opened = (await admin.post(`${api}/employees/${teacher.id}/leave/adjust`).send({ leaveTypeId: type('SL').id, days: 20, kind: 'OPENING', note: 'Carried from the old register' })).body.data
    expect(opened.find((b) => b.code === 'SL').balance).toBeGreaterThanOrEqual(20)
    const ledger = (await admin.get(`${api}/employees/${teacher.id}/leave/ledger`)).body.data
    expect(ledger.find((r) => r.kind === 'OPENING').kindLabel).toBe('Opening balance')
    expect(ledger.find((r) => r.kind === 'COMP_OFF').period).toBe('2026-11-08')
  })

  it('the balances board pages on the server; the team calendar and the summary', async () => {
    const board = (await admin.get(`${api}/leave/balances?pageSize=1`)).body.data
    expect(board).toMatchObject({ page: 1, pageSize: 1 })
    expect(board.rows.length).toBe(1)
    expect(board.total).toBeGreaterThanOrEqual(2)
    const l = (await admin.post(`${api}/leave`).send({ employeeId: teacher.id, leaveTypeId: type('CL').id, from: '2027-03-01', to: '2027-03-02', reason: 'Trip', approveNow: true })).body.data
    const cal = (await admin.get(`${api}/leave/calendar?month=2027-03`)).body.data
    const row = cal.rows.find((r) => r.employeeId === teacher.id)
    expect(row.cells['2027-03-01']).toMatchObject({ status: 'APPROVED', leaveId: l.id })
    expect(cal.days.find((d) => d.date === '2027-03-01').onLeave).toBeGreaterThanOrEqual(1)
    const sum = (await admin.get(`${api}/leave/summary`)).body.data
    expect(sum.year.label).toMatch(/^\d{4}-\d{2}$/)
    expect(sum.counts.APPROVED).toBeGreaterThanOrEqual(1)
    await admin.post(`${api}/leave/${l.id}/cancel`).send({}).expect(200)
  })

  it('the year end: what lapses above the carry-forward limit, and bringing everyone up to date (safe to run twice)', async () => {
    const y = (await admin.get(`${api}/leave/year-end`)).body.data
    const mine = y.projected.rows.find((r) => r.employeeId === teacher.id)
    const cl = mine.items.find((x) => x.name === 'Casual leave')
    expect(cl).toMatchObject({ cap: 0, keep: 0 }) // casual leave lapses at the year end
    expect(cl.lapse).toBe(cl.left)
    const run1 = (await admin.post(`${api}/leave/year-end`)).body.data
    const run2 = (await admin.post(`${api}/leave/year-end`)).body.data
    expect(run2.entries).toBe(0)
    expect(run1.done.notYet).toBe(0)
  })
})

describe('staff attendance', () => {
  it('marks a day, flags late arrival, and keeps holidays and offs', async () => {
    await admin.patch('/api/v1/core/settings/modules/hrms').send({ lateAfter: '08:15' }).expect(200)
    await admin.post(`${api}/holidays`).send({ date: '2026-11-14', name: 'Children’s Day' }).expect(201)
    const saved = (await admin.put(`${api}/attendance/day`).send({ date: '2026-11-02', entries: [
      { employeeId: teacher.id, status: 'PRESENT', inTime: '08:30', outTime: '15:00' },
      { employeeId: principal.id, status: 'ABSENT' },
    ] })).body.data
    expect(saved.rows.find((r) => r.employeeId === teacher.id)).toMatchObject({ status: 'PRESENT', late: true })
    expect(saved.rows.find((r) => r.employeeId === principal.id).status).toBe('ABSENT')
    const hol = (await admin.get(`${api}/attendance/day?date=2026-11-14`)).body.data
    expect(hol.rows.find((r) => r.employeeId === teacher.id)).toMatchObject({ status: 'HOLIDAY', marked: false })
    const sun = (await admin.get(`${api}/attendance/day?date=2026-11-08`)).body.data
    expect(sun.rows.find((r) => r.employeeId === teacher.id).status).toBe('WEEKLY_OFF')
    // not a future day
    expect((await admin.put(`${api}/attendance/day`).send({ date: '2099-01-01', entries: [] })).status).toBe(403)
  })

  it('imports the biometric file and shows the month', async () => {
    const r = (await admin.post(`${api}/attendance/import`).send({ rows: [
      { employeeCode: teacher.employeeCode, date: '2026-11-03', inTime: '08:05', outTime: '15:10' },
      { employeeCode: 'NOPE', date: '2026-11-03', inTime: '08:05' },
      { employeeCode: teacher.employeeCode, date: '2026-11-05', inTime: '08:00' }, // on leave that day
    ] })).body.data
    expect(r.saved).toBe(1)
    expect(r.skipped.map((s) => s.reason)).toEqual(['Unknown employee code', 'On approved leave that day'])
    const m = (await admin.get(`${api}/attendance/month?month=2026-11`)).body.data
    const row = m.rows.find((x) => x.employeeId === teacher.id)
    expect(row.cells['2026-11-03'].s).toBe('P')
    expect(row.cells['2026-11-14'].s).toBe('HO')
    expect(row.totals).toMatchObject({ PRESENT: 2, late: 1 })
    const exp = await admin.get(`${api}/attendance/month/export?month=2026-11`)
    expect(exp.headers['content-type']).toMatch(/text\/csv/)
  })
})

describe('recruitment', () => {
  it('a vacancy, a candidate through the demo class and interview, an offer, and joining', async () => {
    const vac = (await admin.post(`${api}/requisitions`).send({ title: 'PGT Physics', category: 'TEACHING', count: 1, subjects: ['Physics'] })).body.data
    expect(vac.requisitionNo).toMatch(/^VAC/)
    const c = (await admin.post(`${api}/candidates`).send({ requisitionId: vac.id, name: 'Asha Rao', mobile: '9845000201', qualifications: 'M.Sc., B.Ed.', source: 'REFERRAL' })).body.data
    expect(c.stage).toBe('APPLIED')
    expect((await admin.post(`${api}/candidates`).send({ requisitionId: vac.id, name: 'Asha Rao again', mobile: '9845000201' })).status).toBe(409)
    await admin.post(`${api}/candidates/${c.id}/move`).send({ stage: 'DEMO', next: { date: '2026-11-20', time: '10:00', panel: 'HOD Science' } }).expect(200)
    const ev = (await admin.post(`${api}/candidates/${c.id}/evaluate`).send({ rating: 4, note: 'Clear, engaging demo on optics' })).body.data
    expect(ev.rating).toBe(4)
    await admin.post(`${api}/candidates/${c.id}/offer`).send({ joiningDate: '2026-12-01', salary: 5000000 }).expect(200)
    const hired = (await admin.post(`${api}/candidates/${c.id}/hire`).send({ reportingManagerId: principal.id })).body.data
    expect(hired.candidate.stage).toBe('HIRED')
    expect(hired.employee).toMatchObject({ name: 'Asha Rao', category: 'TEACHING', designation: 'PGT Physics', joiningDate: '2026-12-01' })
    const list = (await admin.get(`${api}/requisitions?status=ALL`)).body.data
    expect(list.find((x) => x.id === vac.id)).toMatchObject({ status: 'FILLED', filled: 1 })
  })
})

describe('appraisal', () => {
  it('a round: self review, then the reporting manager’s; the score is weighted', async () => {
    const cycle = (await admin.post(`${api}/appraisals/cycles`).send({ name: '2026-27 review', categories: ['TEACHING'], criteria: [{ label: 'Subject knowledge', weight: 3 }, { label: 'Classroom', weight: 1 }] })).body.data
    const launched = (await admin.post(`${api}/appraisals/cycles/${cycle.id}/launch`)).body.data
    expect(launched.made).toBeGreaterThanOrEqual(1)
    const me = await signIn(app, 'sunil@hr.test', 'Sunil@1234')
    const mine = (await me.get(`${api}/me/reviews`)).body.data.mine[0]
    expect(mine.status).toBe('SELF')
    const [k1, k2] = mine.cycle.criteria.map((c) => c.key)
    expect((await me.post(`${api}/me/reviews/${mine.id}/self`).send({ ratings: { [k1]: 4 } })).status).toBe(400)
    await me.post(`${api}/me/reviews/${mine.id}/self`).send({ ratings: { [k1]: 4, [k2]: 5 }, comments: 'Good year' }).expect(200)
    // he can't rate himself as the manager
    expect((await me.post(`${api}/me/reviews/${mine.id}/rate`).send({ ratings: { [k1]: 5, [k2]: 5 } })).status).toBe(403)
    const p = await signIn(app, 'rekha@hr.test', 'Princ@1234')
    const team = (await p.get(`${api}/me/reviews`)).body.data.team
    expect(team.map((x) => x.id)).toContain(mine.id)
    const done = (await p.post(`${api}/me/reviews/${mine.id}/rate`).send({ ratings: { [k1]: 4, [k2]: 2 }, strengths: 'Results', improve: 'Classroom discipline' })).body.data
    expect(done).toMatchObject({ status: 'DONE', finalScore: 3.5 })
  })
})

describe('exit', () => {
  it('on notice until the last working day, then left and the login is off', async () => {
    const e = (await admin.post(`${api}/employees/${teacher.id}/exit`).send({ type: 'RESIGNED', lastWorkingDate: '2099-12-31', reason: 'Moving cities' })).body.data
    expect(e.status).toBe('NOTICE')
    await admin.post(`${api}/employees/${teacher.id}/exit/cancel`).expect(200)
    // a last working day already past: left at once
    const gone = (await admin.post(`${api}/employees/${teacher.id}/exit`).send({ type: 'RESIGNED', lastWorkingDate: '2026-11-30' })).body.data
    expect(['NOTICE', 'EXITED']).toContain(gone.status)
    await runAsTenant(h.tenant._id, async () => {
      await Employee.updateOne({ _id: teacher.id }, { $set: { 'exit.lastWorkingDate': '2000-01-01', status: 'NOTICE' } })
      await sweepExits()
      expect((await Employee.findById(teacher.id).lean()).status).toBe('EXITED')
      expect((await User.findOne({ email: 'sunil@hr.test' }).lean()).active).toBe(false)
    })
  })
})
