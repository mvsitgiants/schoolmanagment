import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DevicePunch } from '../src/models/integrations.js'
import { Employee } from '../src/models/hrms.js'
import { FeePayment } from '../src/models/fees.js'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { Student } from '../src/models/students.js'
import { User } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { readCode } from '../src/services/scan.js'
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
