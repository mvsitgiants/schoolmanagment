import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DevicePunch } from '../src/models/integrations.js'
import { Employee } from '../src/models/hrms.js'
import { FeePayment } from '../src/models/fees.js'
import { Exam, ExamCandidate } from '../src/models/exams.js'
import { Section } from '../src/models/academics.js'
import { LibraryCopy, LibraryTitle } from '../src/models/library.js'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { Student, TransferCertificate } from '../src/models/students.js'
import { User } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { readCode } from '../src/services/scan.js'
import { createPickupPass, familyPasses } from '../src/services/passes.js'
import { EventReply, SchoolEvent } from '../src/models/events.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let student
const inTenant = (fn) => runAsTenant(h.tenant._id, fn)
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Aarav', rollNo: '1', sectionId: section.id, guardians: [{ name: 'Parent Aarav', mobile: '9845000081' }] }).expect(201)).body.data
  await inTenant(() => Student.updateOne({ _id: student.id }, { $set: { cardCode: 'CARDAARAV01' } }))
  await inTenant(() => MessagingConfig.updateOne({}, { $set: { whatsapp: { provider: 'TEST' }, sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const resolve = (who, code) => who.post('/api/v1/scan/resolve').send({ code })

describe('reading codes', () => {
  it('knows our printed links and plain codes', () => {
    expect(readCode('https://app.schoolgiant.in/verify/student/abcd2345')).toEqual({ kind: 'STUDENT_CARD', code: 'ABCD2345' })
    expect(readCode('https://x.in/verify/receipt/ABCDEFGHJKMN')).toEqual({ kind: 'RECEIPT', code: 'ABCDEFGHJKMN' })
    expect(readCode('https://x.in/verify/ABCDEFGHJKMN')).toEqual({ kind: 'CERTIFICATE', code: 'ABCDEFGHJKMN' })
    expect(readCode(' 2026001 ')).toEqual({ kind: 'TEXT', code: '2026001' })
    expect(readCode('SGP1.abc.1.x').kind).toBe('PUNCH')
  })
})

describe('what a scanned code is', () => {
  it('finds a student by the card QR link or the admission-number barcode, with what the scanner may do', async () => {
    const byQr = (await resolve(admin, 'https://anywhere.example/verify/student/CARDAARAV01')).body.data
    expect(byQr).toMatchObject({ kind: 'STUDENT', id: student.id })
    expect(byQr.actions.map((a) => a.key)).toEqual(expect.arrayContaining(['profile', 'collectFee']))
    const byBarcode = (await resolve(admin, student.admissionNo)).body.data
    expect(byBarcode).toMatchObject({ kind: 'STUDENT', id: student.id })
    expect((await resolve(admin, 'NOTHING-HERE')).body.data.kind).toBe('UNKNOWN')
  })

  it('a teacher with no class sees no student (data scope)', async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    await admin.post('/api/v1/core/users').send({ name: 'Scan Teacher', email: 'teacher@scan.test', roleIds: [tpl.id], password: 'Teach@123' }).expect(201)
    const tc = await signIn(app, 'teacher@scan.test', 'Teach@123')
    expect((await resolve(tc, student.admissionNo)).body.data.kind).toBe('UNKNOWN')
    expect((await tc.get('/api/v1/scan/gates')).body.data).toEqual([])
  })

  it('a fee receipt is checked through its QR code, publicly', async () => {
    const p = await inTenant(() => FeePayment.create({ receiptNo: 'R-0001', studentId: student.id, date: '2026-06-10', mode: 'CASH', amount: 150000 }))
    expect(p.verifyCode).toMatch(/^[A-Z0-9]{12}$/)
    const pub = (await admin.get(`/api/v1/public/verify/receipt/${p.verifyCode}`)).body.data
    expect(pub).toMatchObject({ found: true, valid: true, receiptNo: 'R-0001', amount: 150000, student: { name: 'Aarav' } })
    expect((await resolve(admin, `https://x.in/verify/receipt/${p.verifyCode}`)).body.data).toMatchObject({ kind: 'RECEIPT', title: 'R-0001' })
    expect((await admin.get('/api/v1/public/verify/receipt/ZZZZZZZZZZZZ')).body.data.found).toBe(false)
  })
})

describe('gate scanner on a phone', () => {
  let gate
  it('scans a student in: the gate log, and the family hears “reached school” once', async () => {
    gate = (await admin.post('/api/v1/integrations/devices').send({ name: 'Main gate phone', kind: 'PHONE', usedFor: 'STUDENTS' }).expect(201)).body.data.device
    expect((await admin.get('/api/v1/scan/gates')).body.data.map((d) => d.id)).toContain(gate.id)
    const first = (await admin.post(`/api/v1/scan/gates/${gate.id}`).send({ code: 'https://x.in/verify/student/CARDAARAV01', direction: 'IN' })).body.data
    expect(first).toMatchObject({ ok: true, outcome: 'GATE', name: 'Aarav' })
    await admin.post(`/api/v1/scan/gates/${gate.id}`).send({ code: student.admissionNo, direction: 'IN' }).expect(200)
    const punches = await inTenant(() => DevicePunch.countDocuments({ personId: student.id }))
    expect(punches).toBe(2)
    const told = await inTenant(() => MessageLog.countDocuments({ event: 'attendance.arrived' }))
    expect(told).toBe(1) // the second scan the same morning tells no one
    const unknown = (await admin.post(`/api/v1/scan/gates/${gate.id}`).send({ code: 'NOBODY', direction: 'IN' })).body.data
    expect(unknown).toMatchObject({ ok: false, outcome: 'UNKNOWN' })
  })

  it('a member of staff punches in with the rotating code from My workspace', async () => {
    const emp = (await admin.post('/api/v1/hrms/employees').send({ name: 'Anita Admin', category: 'ADMIN', employmentType: 'PERMANENT', joiningDate: '2020-06-01', gender: 'FEMALE' }).expect(201)).body.data
    const me = await inTenant(() => User.findOne({ email: h.email }).select('_id').lean())
    await inTenant(() => Employee.updateOne({ _id: emp.id }, { $set: { userId: me._id } }))
    const { code } = (await admin.get('/api/v1/scan/punch-code')).body.data
    expect(code.startsWith('SGP1.')).toBe(true)
    expect((await resolve(admin, code)).body.data).toMatchObject({ kind: 'STAFF', id: emp.id })
    const staffGate = (await admin.post('/api/v1/integrations/devices').send({ name: 'Staff room tablet', kind: 'PHONE', usedFor: 'STAFF' }).expect(201)).body.data.device
    const r = (await admin.post(`/api/v1/scan/gates/${staffGate.id}`).send({ code, direction: 'IN' })).body.data
    expect(r).toMatchObject({ ok: true, outcome: 'ATTENDANCE' })
    // a forged code is refused
    const forged = `${code.slice(0, -4)}AAAA`
    expect((await resolve(admin, forged)).status).toBe(400)
  })
})

describe('hall tickets and report cards', () => {
  it('a candidate gets a check code: public page, and the exam door sees who it is', async () => {
    const s = await inTenant(() => Student.findById(student.id).lean())
    const section = await inTenant(() => Section.findById(s.sectionId).lean())
    const exam = await inTenant(() => Exam.create({ name: 'Half-yearly', academicYearId: section.academicYearId, classIds: [section.classId], status: 'SCHEDULED' }))
    const c = await inTenant(() => ExamCandidate.create({ examId: exam._id, studentId: s._id, classId: section.classId, sectionId: section._id, rollNo: '1' }))
    expect(c.verifyCode).toMatch(/^[A-Z0-9]{12}$/)
    const pub = (await admin.get(`/api/v1/public/verify/exam/${c.verifyCode}`)).body.data
    expect(pub).toMatchObject({ found: true, published: false, result: null, exam: { name: 'Half-yearly' }, student: { name: 'Aarav' } })
    const door = (await resolve(admin, `https://x.in/verify/exam/${c.verifyCode}`)).body.data
    expect(door).toMatchObject({ kind: 'HALL_TICKET', title: 'Aarav', papers: [] })
  })
})

describe('library stock check', () => {
  it('scans the shelves and lists what is missing — books out on loan are not missing', async () => {
    const title = await inTenant(() => LibraryTitle.create({ title: 'Wings of Fire', authors: ['A. P. J. Abdul Kalam'] }))
    await inTenant(() => LibraryCopy.create([
      { titleId: title._id, accessionNo: 'ACC-1', shelf: 'A1' }, { titleId: title._id, accessionNo: 'ACC-2', shelf: 'A1' },
      { titleId: title._id, accessionNo: 'ACC-3', shelf: 'B2' }, { titleId: title._id, accessionNo: 'ACC-4', shelf: 'B2', status: 'ISSUED' },
    ]))
    const api = '/api/v1/library/stock-checks'
    const c = (await admin.post(api).send({ name: 'Term-end check' }).expect(201)).body.data
    expect(c).toMatchObject({ expected: 3, seen: 0, missingCount: 3, onLoan: 1 })
    expect((await admin.post(api).send({ name: 'Second' })).status).toBe(409)
    expect((await admin.post(`${api}/${c.id}/scan`).send({ code: 'acc-1' })).body.data).toMatchObject({ found: true, already: false, title: 'Wings of Fire' })
    expect((await admin.post(`${api}/${c.id}/scan`).send({ code: 'ACC-1' })).body.data.already).toBe(true)
    await admin.post(`${api}/${c.id}/scan`).send({ code: 'ACC-3' }).expect(200)
    expect((await admin.post(`${api}/${c.id}/scan`).send({ code: 'STRAY-9' })).body.data.found).toBe(false)
    const done = (await admin.post(`${api}/${c.id}/close`)).body.data
    expect(done).toMatchObject({ status: 'CLOSED', seen: 2, missingCount: 1, unknown: ['STRAY-9'] })
    expect(done.missing.map((m) => m.accessionNo)).toEqual(['ACC-2'])
    expect(done.shelves).toEqual([{ shelf: 'A1', expected: 2, seen: 1 }, { shelf: 'B2', expected: 1, seen: 1 }])
  })
})

describe('transfer certificates', () => {
  it('an issued TC is checked through its QR; a requested one is not public', async () => {
    const tc = await inTenant(() => TransferCertificate.create({ studentId: student.id, status: 'ISSUED', tcNo: 'TC-0007', leavingDate: '2026-11-01', issuedAt: new Date() }))
    expect(tc.verifyCode).toMatch(/^[A-Z0-9]{12}$/)
    expect((await admin.get(`/api/v1/public/verify/tc/${tc.verifyCode}`)).body.data).toMatchObject({ found: true, valid: true, tcNo: 'TC-0007', student: { name: 'Aarav' } })
    expect((await resolve(admin, `https://x.in/verify/tc/${tc.verifyCode}`)).body.data).toMatchObject({ kind: 'TC', title: 'TC-0007' })
    const draft = await inTenant(() => TransferCertificate.create({ studentId: student.id, status: 'REQUESTED', leavingDate: '2026-11-02' }))
    expect((await admin.get(`/api/v1/public/verify/tc/${draft.verifyCode}`)).body.data.found).toBe(false)
  })
})

describe('passes a family shows', () => {
  const family = async () => {
    const s = await Student.findById(student.id).lean()
    return { tenant: { _id: h.tenant._id }, features: ['EVENTS', 'ATTENDANCE'], students: [s], session: { kind: 'GUARDIAN', mobile: '9845000081' } }
  }
  it('an event pass checks the family in once', async () => {
    const ev = await inTenant(() => SchoolEvent.create({ title: 'Annual Day', startDate: '2099-12-19', endDate: '2099-12-19' }))
    await inTenant(() => EventReply.create({ eventId: ev._id, studentId: student.id, answer: 'YES' }))
    const passes = await inTenant(async () => familyPasses(await family(), student.id))
    expect(passes.events).toEqual([expect.objectContaining({ title: 'Annual Day', checkedInAt: null })])
    const r = (await resolve(admin, passes.events[0].code)).body.data
    expect(r).toMatchObject({ kind: 'EVENT_PASS', title: 'Annual Day', valid: true, actions: [{ key: 'checkIn' }] })
    expect((await admin.post(`/api/v1${r.actions[0].post.slice(3)}`)).body.data.checkedInAt).toBeTruthy()
    expect((await admin.post(`/api/v1${r.actions[0].post.slice(3)}`)).status).toBe(409)
    expect((await resolve(admin, passes.events[0].code.slice(0, -2) + 'xx')).status).toBe(400) // tampered
  })
  it('an early-pickup pass is checked at the gate and used once; the family is told', async () => {
    const p = await inTenant(async () => createPickupPass(await family(), student.id, { name: 'Rakesh Sharma', relation: 'Uncle' }))
    expect(p.code.startsWith('SGK1.')).toBe(true)
    const r = (await resolve(admin, p.code)).body.data
    expect(r).toMatchObject({ kind: 'PICKUP_PASS', title: 'Aarav', valid: true, person: { name: 'Rakesh Sharma', relation: 'Uncle' } })
    const used = (await admin.post(`/api/v1/scan/passes/pickup/${p.id}/hand-over`)).body.data
    expect(used).toMatchObject({ status: 'USED', valid: false, actions: [] })
    expect((await admin.post(`/api/v1/scan/passes/pickup/${p.id}/hand-over`)).status).toBe(409)
    expect(await inTenant(() => MessageLog.countDocuments({ event: 'attendance.pickedUp' }))).toBeGreaterThan(0)
  })
})
