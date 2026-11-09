import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDaysYmd, ageingBucket, attendanceBand, monthsInRange, nowIn, pctOf } from '@schoolgiant/shared'
import { AttendanceSheet } from '../src/models/attendance.js'
import { Section } from '../src/models/academics.js'
import { Exam, ExamCandidate, ExamPaper, MarkSheet } from '../src/models/exams.js'
import { Concession, FeeInvoice, FeePayment, FeeRefund } from '../src/models/fees.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// Analytics reads what the other modules store: the records are written straight into the models
// (the exams, fees and attendance flows have their own tests), then each dashboard is checked.

let app
let h
let admin
let year
let c11
let c12
let north
let aarav
let diya
let kabir
const today = nowIn('Asia/Kolkata').date
const api = '/api/v1/analytics'

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  c11 = data.classes.find((c) => c.code === '11')
  c12 = data.classes.find((c) => c.code === '12')
  north = (await admin.post('/api/v1/core/branches').send({ name: 'North campus', code: 'NTH' })).body.data
  expect(north?.id).toBeTruthy()
  const add = async (firstName, sectionId, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId, guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', c11.sections[0].id, '9845000041')
  diya = await add('Diya', c11.sections[0].id, '9845000042')
  kabir = await add('Kabir', c12.sections[0].id, '9845000043')
  const subjects = (await admin.get('/api/v1/academics/lookup')).body.data.subjects
  const english = subjects.find((s) => s.name === 'English')
  const maths = subjects.find((s) => s.name === 'Mathematics')
  const day = (n) => addDaysYmd(year.startDate, n)

  await runAsTenant(h.tenant._id, async () => {
    // class 12 is taught on the north campus
    await Section.updateOne({ _id: c12.sections[0].id }, { $set: { branchId: north.id } })
    await Student.updateOne({ _id: kabir.id }, { $set: { branchId: north.id } })
    const s11 = c11.sections[0].id
    const s12 = c12.sections[0].id

    // two published exams: the unit test, then the half-yearly
    const ut = await Exam.create({ name: 'Unit test', academicYearId: year.id, classIds: [c11.id, c12.id], status: 'PUBLISHED', startDate: day(30), endDate: day(31) })
    const hy = await Exam.create({ name: 'Half-yearly', academicYearId: year.id, classIds: [c11.id, c12.id], status: 'PUBLISHED', startDate: day(60), endDate: day(62) })
    await Exam.create({ name: 'Not published', academicYearId: year.id, classIds: [c11.id], status: 'SCHEDULED', startDate: day(90) })
    const cand = (examId, s, classId, sectionId, pct, result, grade, rank, failedSubjects = []) => ({ examId, studentId: s.id, classId, sectionId, pct, result, grade, rank, failedSubjects })
    await ExamCandidate.create([
      cand(ut._id, aarav, c11.id, s11, 70, 'PASS', 'B1', 1), cand(ut._id, diya, c11.id, s11, 50, 'PASS', 'C1', 2), cand(ut._id, kabir, c12.id, s12, 55, 'PASS', 'C1', 1),
      cand(hy._id, aarav, c11.id, s11, 80, 'PASS', 'A2', 1), cand(hy._id, diya, c11.id, s11, 30, 'FAIL', 'E', 2, ['Mathematics']), cand(hy._id, kabir, c12.id, s12, 60, 'PASS', 'B2', 1),
    ])
    const [en11, ma11, en12] = await ExamPaper.create([
      { examId: hy._id, classId: c11.id, subjectId: english.id, maxMarks: 100, passMarks: 33 },
      { examId: hy._id, classId: c11.id, subjectId: maths.id, maxMarks: 100, passMarks: 33 },
      { examId: hy._id, classId: c12.id, subjectId: english.id, maxMarks: 50, passMarks: 17 },
    ])
    await MarkSheet.create([
      { examId: hy._id, paperId: en11._id, sectionId: s11, entries: [{ studentId: aarav.id, marks: 85 }, { studentId: diya.id, marks: 40 }] },
      { examId: hy._id, paperId: ma11._id, sectionId: s11, entries: [{ studentId: aarav.id, marks: 75 }, { studentId: diya.id, marks: 20 }] },
      { examId: hy._id, paperId: en12._id, sectionId: s12, entries: [{ studentId: kabir.id, marks: 30 }] },
    ])

    // attendance: Aarav every day, Diya once in four, Kabir every day
    const sheet = (sectionId, date, entries) => ({ academicYearId: year.id, sectionId, date, period: 0, entries, counts: { P: entries.filter((e) => e.status === 'P').length, A: entries.filter((e) => e.status === 'A').length, L: 0, HD: 0, LV: 0, total: entries.length } })
    await AttendanceSheet.create([1, 2, 3, 4].map((n) => sheet(s11, day(n), [{ studentId: aarav.id, status: 'P' }, { studentId: diya.id, status: n === 1 ? 'P' : 'A' }])))
    await AttendanceSheet.create([1, 2].map((n) => sheet(s12, day(n), [{ studentId: kabir.id, status: 'P' }])))

    // fees: Aarav paid, Diya part paid after a concession, Kabir (north) not yet due
    const inv = (no, s, sectionId, branchId, dueDate, gross, concession, paid) => ({
      invoiceNo: no, studentId: s.id, sectionId, branchId, academicYearId: year.id, installment: 'Term 1', dueDate,
      lines: [{ name: 'Tuition fee', amount: gross, concession }], gross, concession, net: gross - concession, paid, balance: gross - concession - paid,
      status: paid === 0 ? 'UNPAID' : paid >= gross - concession ? 'PAID' : 'PARTIAL',
    })
    const [ia] = await FeeInvoice.create([
      inv('INV-1', aarav, s11, null, day(14), 100000, 0, 100000),
      inv('INV-2', diya, s11, null, day(14), 110000, 10000, 40000),
      inv('INV-3', kabir, s12, north.id, addDaysYmd(today, 10) > year.endDate ? year.endDate : addDaysYmd(today, 10), 50000, 0, 0),
      { ...inv('INV-4', diya, s11, null, day(15), 99999, 0, 0), status: 'CANCELLED' },
    ])
    const [pa] = await FeePayment.create([
      { receiptNo: 'R-1', studentId: aarav.id, date: day(10), mode: 'CASH', amount: 100000, allocations: [{ invoiceId: ia._id, amount: 100000 }] },
      { receiptNo: 'R-2', studentId: diya.id, date: day(20), mode: 'UPI', amount: 40000 },
      { receiptNo: 'R-3', studentId: diya.id, date: day(21), mode: 'CASH', amount: 7000, status: 'CANCELLED' },
    ])
    await FeeRefund.create({ refundNo: 'RF-1', studentId: aarav.id, paymentId: pa._id, date: day(25), amount: 5000, mode: 'CASH', reason: 'Excess' })
    await Concession.create({ studentId: diya.id, academicYearId: year.id, kind: 'AMOUNT', value: 10000, reason: 'Sibling', status: 'APPROVED' })
  })
}, 300_000) // the in-memory database can take a while to start on a busy machine
afterAll(stopDb)

describe('helpers', () => {
  it('percentages, ageing buckets, attendance bands and months', () => {
    expect(pctOf(1, 3)).toBe(33.3)
    expect(pctOf(5, 0)).toBeNull()
    expect(ageingBucket('2026-01-10', '2026-01-10')).toBeNull()
    expect(ageingBucket('2026-01-01', '2026-01-31')).toBe('D0_30')
    expect(ageingBucket('2026-01-01', '2026-02-15')).toBe('D31_60')
    expect(ageingBucket('2026-01-01', '2026-03-15')).toBe('D61_90')
    expect(ageingBucket('2025-01-01', '2026-01-01')).toBe('D90_PLUS')
    expect([95, 80, 65, 10, null].map(attendanceBand)).toEqual(['A90', 'A75', 'A60', 'A0', null])
    expect(monthsInRange('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})

describe('academic performance', () => {
  it('defaults to the latest published exam: class results, grades, subjects, toppers and students at risk', async () => {
    const d = (await admin.get(`${api}/academics`).expect(200)).body.data
    expect(d.exams.map((e) => e.name)).toEqual(['Unit test', 'Half-yearly'])
    expect(d.exam.name).toBe('Half-yearly')
    expect(d.summary).toMatchObject({ candidates: 3, assessed: 3, passed: 2, failed: 1, average: 56.7, passPct: 66.7, highest: 80, atRisk: 1 })
    const cls11 = d.classes.find((c) => c.classId === c11.id)
    expect(cls11).toMatchObject({ students: 2, average: 55, passPct: 50, grades: { A2: 1, E: 1 } })
    expect(d.grades).toEqual(expect.arrayContaining(['A2', 'B2', 'E']))
    // weakest first: Maths (75 + 20) / 2, then English (85 + 40 + 60) / 3
    expect(d.subjects.map((s) => [s.name, s.average, s.failed])).toEqual([['Mathematics', 47.5, 1], ['English', 61.7, 0]])
    expect(d.toppers.map((x) => x.name)).toEqual(['Aarav', 'Kabir', 'Diya'])
    expect(d.atRisk).toHaveLength(1)
    expect(d.atRisk[0]).toMatchObject({ name: 'Diya', attendancePct: 25, failedSubjects: ['Mathematics'] })
    expect(d.atRisk[0].reasons).toEqual(['FAILED', 'LOW_RESULT', 'LOW_ATTENDANCE'])
  })

  it('the trend runs exam to exam, and attendance lines up with the result', async () => {
    const d = (await admin.get(`${api}/academics`)).body.data
    expect(d.trend.overall.map((o) => o.average)).toEqual([58.3, 56.7])
    expect(d.trend.classes.find((c) => c.classId === c11.id).byExam[d.exams[0].id].average).toBe(60)
    const band = Object.fromEntries(d.attendanceBands.map((b) => [b.key, b]))
    expect(band.A90).toMatchObject({ students: 2, average: 70, passPct: 100 })
    expect(band.A0).toMatchObject({ students: 1, average: 30, passPct: 0 })
  })

  it('picks another exam and threshold; refuses an exam that is not published', async () => {
    const list = (await admin.get(`${api}/academics`)).body.data.exams
    const d = (await admin.get(`${api}/academics?examId=${list[0].id}&riskPct=60`)).body.data
    expect(d.exam.name).toBe('Unit test')
    expect(d.atRisk.map((x) => x.name).sort()).toEqual(['Diya', 'Kabir'])
    const draft = await runAsTenant(h.tenant._id, () => Exam.findOne({ name: 'Not published' }).lean())
    expect((await admin.get(`${api}/academics?examId=${draft._id}`)).status).toBe(404)
  })
})

describe('fee collection', () => {
  it('billed, collected and outstanding over the academic year, by month, mode, head and class', async () => {
    const d = (await admin.get(`${api}/fees`).expect(200)).body.data
    expect(d.range).toEqual({ from: year.startDate, to: year.endDate })
    expect(d.summary).toMatchObject({ billed: 250000, collected: 140000, outstanding: 110000, realised: 140000, collectionPct: 56, concession: 10000, concessionStudents: 1, refunded: 5000, refunds: 1, invoices: 3, receipts: 2 })
    expect(d.months.find((m) => m.month === year.startDate.slice(0, 7))).toMatchObject({ billed: 200000, collected: 140000 })
    expect(d.modes.map((m) => [m.mode, m.amount])).toEqual([['CASH', 100000], ['UPI', 40000]])
    expect(d.heads[0]).toMatchObject({ name: 'Tuition fee', billed: 250000, collected: 140000, concession: 10000 })
    const byClass = Object.fromEntries(d.classes.map((c) => [c.classId, c]))
    expect(byClass[c11.id]).toMatchObject({ students: 2, owing: 1, billed: 200000, outstanding: 60000, collectionPct: 70 })
    expect(byClass[c12.id]).toMatchObject({ billed: 50000, outstanding: 50000, overdue: 0, collectionPct: 0 })
    expect(d.concessions).toEqual([{ reason: 'Sibling', amount: 10000, students: 1 }])
  })

  it('ages what is overdue and lists the defaulters', async () => {
    const d = (await admin.get(`${api}/fees`)).body.data
    const age = Object.fromEntries(d.ageing.map((a) => [a.key, a.amount]))
    expect(age.NOT_DUE).toBe(50000)
    expect(age[ageingBucket(addDaysYmd(year.startDate, 14), today)]).toBe(60000)
    expect(d.summary.overdue).toBe(60000)
    expect(d.defaulters).toHaveLength(1)
    expect(d.defaulters[0]).toMatchObject({ name: 'Diya', overdue: 60000, guardianName: 'Parent Diya', classShort: expect.any(String) })
  })

  it('keeps to the dates asked for, and refuses a range that runs backwards', async () => {
    const from = addDaysYmd(year.startDate, 18)
    const d = (await admin.get(`${api}/fees?from=${from}&to=${addDaysYmd(year.startDate, 30)}`)).body.data
    expect(d.summary).toMatchObject({ billed: 0, collected: 40000, refunded: 5000 })
    expect((await admin.get(`${api}/fees?from=${year.endDate}&to=${year.startDate}`)).status).toBe(400)
  })
})

describe('campus comparison', () => {
  it('puts each campus side by side', async () => {
    const d = (await admin.get(`${api}/campuses`).expect(200)).body.data
    expect(d.campuses).toHaveLength(2)
    const [main, nth] = d.campuses
    expect(main).toMatchObject({ isDefault: true, students: 2, sections: 1, attendancePct: 62.5, billed: 200000, outstanding: 60000, collectionPct: 70 })
    expect(main.resultPct).toBe(57.5) // 70, 50, 80, 30 over both exams
    expect(nth).toMatchObject({ id: north.id, students: 1, sections: 1, attendancePct: 100, resultPct: 57.5, billed: 50000, collectionPct: 0 })
    expect(d.totals).toMatchObject({ campuses: 2, students: 3, billed: 250000, outstanding: 110000 })
  })
})

describe('who sees what', () => {
  it('a campus-scoped role sees only its campus; a role without the page is refused', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Campus head', permissions: ['analytics.academics.view', 'analytics.fees.view', 'analytics.campuses.view'], dataScopes: { default: 'BRANCH' } })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'North Head', email: 'north@an.test', roleIds: [role.id], branchId: north.id, password: 'North@123' }).expect(201)
    const head = await signIn(app, 'north@an.test', 'North@123')
    const campuses = (await head.get(`${api}/campuses`).expect(200)).body.data
    expect(campuses.campuses.map((c) => c.id)).toEqual([north.id])
    const fees = (await head.get(`${api}/fees`)).body.data
    expect(fees.summary).toMatchObject({ billed: 50000, collected: 0, refunded: 0 })
    const res = (await head.get(`${api}/academics`)).body.data
    expect(res.summary).toMatchObject({ candidates: 1, average: 60 })
    expect(res.toppers.map((x) => x.name)).toEqual(['Kabir'])

    const viewer = (await admin.post('/api/v1/core/roles').send({ name: 'Results only', permissions: ['analytics.academics.view'], dataScopes: { default: 'ALL' } })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Results Viewer', email: 'results@an.test', roleIds: [viewer.id], password: 'Results@123' }).expect(201)
    const v = await signIn(app, 'results@an.test', 'Results@123')
    expect((await v.get(`${api}/academics`)).status).toBe(200)
    expect((await v.get(`${api}/fees`)).status).toBe(403)
  })

  it('needs the analytics module on the plan', async () => {
    const small = await newInstitution('STARTER')
    const a = await signIn(app, small.email, small.password)
    expect((await a.get(`${api}/fees`)).status).toBe(404)
  })
})
