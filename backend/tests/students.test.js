import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Tenant } from '../src/models/platform.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let sec8A
let sec8B
let sec9A
let year1
let year2
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SECONDARY', sectionsPerClass: 2 }).expect(201)
  const { classes, year } = (await admin.get('/api/v1/academics/classes')).body.data
  year1 = year
  sec8A = classes.find((c) => c.code === '8').sections.find((s) => s.name === 'A')
  sec8B = classes.find((c) => c.code === '8').sections.find((s) => s.name === 'B')
  // next year, with sections for 8 and 9
  const end = new Date(Date.parse(`${year.endDate}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
  year2 = (await admin.post('/api/v1/academics/years').send({ name: 'Next', startDate: end, endDate: `${Number(end.slice(0, 4)) + 1}${end.slice(4, 8)}${String(Number(end.slice(8)) - 1).padStart(2, '0') === '00' ? '28' : String(Number(end.slice(8)) - 1).padStart(2, '0')}` })).body.data
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SECONDARY', sectionsPerClass: 1, addSubjects: false, academicYearId: year2.id }).expect(201)
  sec9A = (await admin.get(`/api/v1/academics/classes?yearId=${year2.id}`)).body.data.classes.find((c) => c.code === '9').sections[0]
})
afterAll(stopDb)

const admit = (extra = {}) => admin.post('/api/v1/students').send({
  firstName: 'Aarav', lastName: 'Sharma', gender: 'MALE', dob: '2013-05-10', sectionId: sec8A.id,
  guardians: [{ name: 'Rohit Sharma', relation: 'FATHER', mobile: '98450 11111' }, { name: 'Neha Sharma', relation: 'MOTHER', mobile: '9845022222', isPrimary: true }],
  ...extra,
})

describe('admission', () => {
  it('admits with the next admission number, a history entry and one primary guardian', async () => {
    const res = await admit({ aadhaar: '2341 2341 2346' })
    expect(res.status).toBe(201)
    const s = res.body.data
    expect(s.admissionNo).toMatch(/^\d{4}0001$/)
    expect(s.classShort).toBe('8-A')
    expect(s.guardians.filter((g) => g.isPrimary).map((g) => g.name)).toEqual(['Neha Sharma'])
    expect(s.guardians[0].mobile).toBe('9845011111')
    expect(s.history[0]).toMatchObject({ event: 'ADMITTED', classLabel: 'Class 8 – A' })
    expect(s.aadhaar).toBe('•••• •••• 2346') // masked
    expect(s.aadhaarEnc).toBeUndefined()
  })

  it('refuses an invalid or duplicate Aadhaar and a missing guardian', async () => {
    expect((await admit({ aadhaar: '234123412345' })).body.details.fields.aadhaar).toMatch(/Not a valid/)
    expect((await admit({ aadhaar: '234123412346' })).body.details.fields.aadhaar).toMatch(/Already on Aarav Sharma/)
    expect((await admit({ guardians: [] })).body.details.fields.guardians).toMatch(/at least one/)
  })

  it('stops at the plan’s student limit', async () => {
    await Tenant.updateOne({ _id: h.tenant._id }, { $set: { limitsOverride: { students: 2 } } })
    expect((await admit({ firstName: 'Second', guardians: [{ name: 'Parent Two', mobile: '9000000002' }] })).status).toBe(201)
    const over = await admit({ firstName: 'Third', guardians: [{ name: 'Parent Three', mobile: '9000000003' }] })
    expect(over.status).toBe(422)
    await Tenant.updateOne({ _id: h.tenant._id }, { $unset: { limitsOverride: 1 } })
  })
})

describe('directory, Student 360 and guardians', () => {
  it('searches by name, admission number or guardian mobile and shows siblings', async () => {
    await admit({ firstName: 'Diya', gender: 'FEMALE', sectionId: sec8B.id })
    const byMobile = (await admin.get('/api/v1/students?search=22222')).body.data.map((s) => s.name).sort()
    expect(byMobile).toEqual(['Aarav Sharma', 'Diya Sharma'])
    const diya = (await admin.get('/api/v1/students?search=diya')).body.data[0]
    const full = (await admin.get(`/api/v1/students/${diya.id}`)).body.data
    expect(full.siblings.map((x) => x.name)).toEqual(['Aarav Sharma'])
    const parents = (await admin.get('/api/v1/students/guardians?search=neha')).body.data
    expect(parents).toMatchObject({ total: 1, page: 1, pageSize: 50, counts: { children: 2, siblings: 1 } })
    expect(parents.rows[0]).toMatchObject({ name: 'Neha Sharma', mobile: '9845022222', primaryFor: 2 })
    expect(parents.rows[0].children).toHaveLength(2)
    // the search reaches the children too, and pages are cut on the server
    expect((await admin.get('/api/v1/students/guardians?search=diya')).body.data.rows.map((g) => g.name)).toContain('Neha Sharma')
    expect((await admin.get('/api/v1/students/guardians?pageSize=1')).body.data.rows).toHaveLength(1)
  })

  it('shows the full Aadhaar only to roles that may see it, and logs that it was seen', async () => {
    const aarav = (await admin.get('/api/v1/students?search=aarav')).body.data[0]
    expect((await admin.get(`/api/v1/students/${aarav.id}?reveal=1`)).body.data.aadhaar).toBe('234123412346')
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Office', permissions: ['students.profile.view', 'students.directory.view'], dataScopes: { default: 'ALL' } })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Office', email: 'office@s.test', roleIds: [role.id], password: 'Office@123' })
    const office = await signIn(app, 'office@s.test', 'Office@123')
    expect((await office.get(`/api/v1/students/${aarav.id}`)).body.data.aadhaar).toBe('•••• •••• 2346')
    expect((await office.get(`/api/v1/students/${aarav.id}?reveal=1`)).status).toBe(403)
    const log = (await admin.get('/api/v1/core/audit?search=unmasked')).body.data
    expect(log.some((e) => e.action === 'VIEW_SENSITIVE')).toBe(true)
  })

  it('a class teacher sees only their own sections', async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['CLASS_TEACHER'] })).body.data.created[0]
    const teacher = (await admin.post('/api/v1/core/users').send({ name: 'Teacher B', email: 'tb@s.test', roleIds: [tpl.id], password: 'Teach@123' })).body.data.user
    await admin.patch(`/api/v1/academics/sections/${sec8B.id}`).send({ classTeacherId: teacher.id }).expect(200)
    const t = await signIn(app, 'tb@s.test', 'Teach@123')
    const seen = (await t.get('/api/v1/students')).body.data.map((s) => s.name)
    expect(seen).toEqual(['Diya Sharma'])
    const aarav = (await admin.get('/api/v1/students?search=aarav')).body.data[0]
    expect((await t.get(`/api/v1/students/${aarav.id}`)).status).toBe(404)
  })

  it('lists by class order, section and roll number (numbers sort as numbers)', async () => {
    for (const [i, roll] of [['A', '10'], ['B', '2'], ['C', '1']]) await admit({ firstName: `Roll${roll}`, rollNo: roll, guardians: [{ name: `Parent ${i}`, mobile: `97000000${roll.padStart(2, '0')}` }] })
    const names = (await admin.get(`/api/v1/students?sectionId=${sec8A.id}`)).body.data.filter((x) => x.name.startsWith('Roll')).map((x) => x.rollNo)
    expect(names).toEqual(['1', '2', '10'])
  })

  it('moving section is kept in the history', async () => {
    const second = (await admin.get('/api/v1/students?search=second')).body.data[0]
    const moved = (await admin.patch(`/api/v1/students/${second.id}`).send({ sectionId: sec8B.id, rollNo: '7' })).body.data
    expect(moved.classShort).toBe('8-B')
    expect(moved.history.map((x) => x.event)).toEqual(['ADMITTED', 'MOVED'])
  })
})

describe('import', () => {
  it('checks every row first, then admits the good ones', async () => {
    const rows = [
      { firstName: 'Kabir', lastName: 'Khan', gender: 'male', class: '8', section: 'a', guardianName: 'Imran Khan', guardianMobile: '9811111111' },
      { firstName: 'Nobody', class: '99', section: 'A', guardianName: 'X' },
      { firstName: 'Orphan', class: '8', section: 'A' },
    ]
    const dry = (await admin.post('/api/v1/students/import').send({ rows, dryRun: true })).body.data.rows
    expect(dry[0].errors).toEqual([])
    expect(dry[1].errors.map((e) => e.field)).toContain('class')
    expect(dry[2].errors.map((e) => e.field)).toContain('guardianName')
    const real = (await admin.post('/api/v1/students/import').send({ rows: [rows[0]], dryRun: false })).body.data
    expect(real.imported).toBe(1)
    expect((await admin.get('/api/v1/students?search=kabir')).body.data[0]).toMatchObject({ classShort: '8-A', guardianMobile: '9811111111' })
  })
})

describe('promotion', () => {
  it('moves a section to next year: promote, detain, leave', async () => {
    const preview = (await admin.get(`/api/v1/students/promotion?fromSectionId=${sec8A.id}`)).body.data
    expect(preview.toYear.id).toBe(year2.id)
    expect(preview.nextClass.name).toBe('Class 9')
    expect(preview.nextClass.suggested).toBe(sec9A.id)
    const [aarav, kabir] = preview.students
    const same = preview.sameClass.suggested
    const res = (await admin.post('/api/v1/students/promotion').send({ fromSectionId: sec8A.id, decisions: [
      { studentId: aarav.id, outcome: 'PROMOTE', toSectionId: sec9A.id },
      { studentId: kabir.id, outcome: 'DETAIN', toSectionId: same },
    ] })).body.data
    expect(res).toMatchObject({ PROMOTE: 1, DETAIN: 1 })
    const a = (await admin.get(`/api/v1/students/${aarav.id}`)).body.data
    expect(a.classShort).toBe('9-A')
    expect(a.history.at(-1)).toMatchObject({ event: 'PROMOTE', yearName: year1.name })
    // detaining into another class is refused
    expect((await admin.post('/api/v1/students/promotion').send({ fromSectionId: sec8B.id, decisions: [{ studentId: (await admin.get('/api/v1/students?search=diya')).body.data[0].id, outcome: 'DETAIN', toSectionId: sec9A.id }] })).status).toBe(400)
  })
})

describe('transfer certificates', () => {
  it('requested by one person, issued by another; the student is then marked as left', async () => {
    const diya = (await admin.get('/api/v1/students?search=diya')).body.data[0]
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'TC desk', permissions: ['students.transfer.view', 'students.transfer.create', 'students.transfer.print'], dataScopes: { default: 'ALL' } })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'TC Desk', email: 'tc@s.test', roleIds: [role.id], password: 'Desk@1234' })
    const desk = await signIn(app, 'tc@s.test', 'Desk@1234')
    const tc = (await desk.post('/api/v1/students/tc').send({ studentId: diya.id, leavingDate: year1.endDate, reason: 'RELOCATION', conduct: 'Very good', promotedTo: 'Qualified for Class 9' })).body.data
    expect(tc).toMatchObject({ status: 'REQUESTED', lastClassLabel: 'Class 8 – B' })
    const register = (await desk.get('/api/v1/students/tc?search=diya')).body.data
    expect(register).toMatchObject({ total: 1, counts: { REQUESTED: 1 } })
    expect(register.rows.map((r) => r.id)).toEqual([tc.id])
    expect((await desk.get('/api/v1/students/tc?status=ISSUED')).body.data).toMatchObject({ rows: [], total: 0 })
    expect((await desk.post('/api/v1/students/tc').send({ studentId: diya.id, leavingDate: year1.endDate, reason: 'OTHER' })).status).toBe(409)
    expect((await desk.post(`/api/v1/students/tc/${tc.id}/issue`)).status).toBe(403) // can't approve their own
    // the draft prints with a "not yet issued" stamp
    expect((await desk.get(`/api/v1/documents/TRANSFER_CERTIFICATE/${tc.id}?print=0`)).text).toContain('NOT YET ISSUED')
    const issued = (await admin.post(`/api/v1/students/tc/${tc.id}/issue`)).body.data
    expect(issued.tcNo).toMatch(/^TC\/\d{4}\/0001$/)
    const s = (await admin.get(`/api/v1/students/${diya.id}`)).body.data
    expect(s.status).toBe('LEFT')
    expect(s.leaving).toMatchObject({ tcNo: issued.tcNo })
    expect((await admin.get('/api/v1/students')).body.data.map((x) => x.name)).not.toContain('Diya Sharma')
    const html = (await desk.get(`/api/v1/documents/TRANSFER_CERTIFICATE/${tc.id}?print=0`)).text
    expect(html).toContain('Diya Sharma')
    expect(html).toContain('Tenth May Two Thousand Thirteen')
    expect(html).toContain(issued.tcNo)
    // cancelling an issued TC brings the student back
    await admin.post(`/api/v1/students/tc/${tc.id}/cancel`).send({ reason: 'Family stayed' }).expect(200)
    expect((await admin.get(`/api/v1/students/${diya.id}`)).body.data.status).toBe('ACTIVE')
  })
})
