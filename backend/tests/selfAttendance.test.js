import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AttendanceSheet } from '../src/models/attendance.js'
import { Employee, StaffAttendance } from '../src/models/hrms.js'
import { DevicePunch } from '../src/models/integrations.js'
import { Student } from '../src/models/students.js'
import { Branch, User } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { studentSelfCheckIn } from '../src/services/selfAttendance.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// a campus at the school gate; "inside" is 60 m from it, "outside" ~1.1 km away
const GATE = { lat: 12.9716, lng: 77.5946 }
const INSIDE = { lat: 12.97214, lng: 77.5946, accuracy: 15 }
const OUTSIDE = { lat: 12.9816, lng: 77.5946, accuracy: 15 }

let app
let h
let admin
let branch
let emp
const inTenant = (fn) => runAsTenant(h.tenant._id, fn)
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  branch = (await admin.get('/api/v1/core/branches')).body.data[0]
  emp = (await admin.post('/api/v1/hrms/employees').send({ name: 'Anita Admin', category: 'ADMIN', employmentType: 'PERMANENT', joiningDate: '2020-06-01', gender: 'FEMALE' }).expect(201)).body.data
  const me = await inTenant(() => User.findOne({ email: h.email }).select('_id').lean())
  await inTenant(() => Employee.updateOne({ _id: emp.id }, { $set: { userId: me._id, branchId: branch.id } }))
})
afterAll(stopDb)

const self = (body) => admin.post('/api/v1/scan/self').send(body)

describe('attendance sites on a campus', () => {
  it('saves a circle site; a site needs coordinates', async () => {
    const bad = await admin.patch(`/api/v1/core/branches/${branch.id}`).send({ attendanceSites: [{ name: 'Gate', shape: 'CIRCLE' }] })
    expect(bad.status).toBe(400)
    const ok = (await admin.patch(`/api/v1/core/branches/${branch.id}`).send({ attendanceSites: [{ name: 'Main gate', shape: 'CIRCLE', ...GATE, radiusM: 150 }] }).expect(200)).body.data
    expect(ok.attendanceSites).toEqual([expect.objectContaining({ name: 'Main gate', radiusM: 150 })])
  })
})

describe('staff check in from the phone', () => {
  it('is off until the institution switches it on', async () => {
    expect((await admin.get('/api/v1/scan/self')).body.data.enabled).toBe(false)
    expect((await self({ location: INSIDE })).status).toBe(403)
    await admin.patch('/api/v1/core/settings/modules/hrms').send({ selfAttendance: true, geofence: 'REQUIRED' }).expect(200)
    expect((await admin.get('/api/v1/scan/self')).body.data).toMatchObject({ enabled: true, mode: 'REQUIRED', sites: 1, next: 'IN' })
  })

  it('refuses outside the site, or with a rough location, or with none', async () => {
    const out = await self({ location: OUTSIDE })
    expect(out.status).toBe(403)
    expect(out.body.details.reason).toBe('OUTSIDE')
    expect((await self({ location: { ...INSIDE, accuracy: 900 } })).body.details.reason).toBe('POOR_ACCURACY')
    expect((await self({ locationError: 'DENIED' })).body.details.reason).toBe('NO_LOCATION')
  })

  it('checks in inside; several ins and outs a day make first in / last out', async () => {
    const r = (await self({ location: INSIDE })).body.data
    expect(r).toMatchObject({ direction: 'IN', outcome: 'ATTENDANCE', geofence: { status: 'INSIDE', outside: false } })
    expect((await self({ location: INSIDE })).status).toBe(409) // a moment ago
    // move the first punch back an hour so the next one isn't "a moment ago"
    await inTenant(() => DevicePunch.updateMany({ personId: emp.id }, [{ $set: { at: { $subtract: ['$at', 3600e3] } } }], { updatePipeline: true }))
    const out = (await self({ location: INSIDE })).body.data
    expect(out.direction).toBe('OUT')
    expect(out.today.map((p) => p.direction)).toEqual(['IN', 'OUT'])
    const p = await inTenant(() => DevicePunch.findOne({ personId: emp.id, direction: 'OUT' }).lean())
    expect(p.geo).toMatchObject({ siteName: 'Main gate', inside: true, status: 'INSIDE' })
    const { date } = await inTenant(() => institutionNow())
    const day = await inTenant(() => StaffAttendance.findOne({ employeeId: emp.id, date }).lean())
    expect(day.status).toBe('PRESENT')
  })

  it('WARN accepts outside but flags it for review', async () => {
    await admin.patch('/api/v1/core/settings/modules/hrms').send({ geofence: 'WARN' }).expect(200)
    await inTenant(() => DevicePunch.updateMany({ personId: emp.id }, [{ $set: { at: { $subtract: ['$at', 3600e3] } } }], { updatePipeline: true }))
    const r = (await self({ location: OUTSIDE, direction: 'IN' })).body.data
    expect(r.geofence).toMatchObject({ status: 'OUTSIDE', outside: true })
    expect(await inTenant(() => DevicePunch.countDocuments({ personId: emp.id, outsideGeofence: true }))).toBe(1)
  })
})

describe('students check in from the student app', () => {
  let student
  const family = (kind) => ({ tenant: { _id: h.tenant._id }, enabledModules: h.tenant.modules ?? ['attendance', 'students'], features: ['ATTENDANCE'], students: [student], session: { kind, mobile: '9845000099' } })
  beforeAll(async () => {
    await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
    const section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
    const s = (await admin.post('/api/v1/students').send({ firstName: 'Kabir', rollNo: '1', sectionId: section.id, guardians: [{ name: 'Parent', mobile: '9845000099' }] }).expect(201)).body.data
    student = await inTenant(async () => {
      await Student.updateOne({ _id: s.id }, { $set: { branchId: branch.id } })
      return Student.findById(s.id).lean()
    })
  })

  it('only from the student’s own login, only when switched on, only inside the campus', async () => {
    const f = family('STUDENT')
    f.enabledModules = ['attendance', 'students']
    await expect(inTenant(() => studentSelfCheckIn(f, student._id, { location: INSIDE }))).rejects.toMatchObject({ status: 403 })
    await admin.patch('/api/v1/core/settings/modules/attendance').send({ studentSelfCheckIn: 'LOG' }).expect(200)
    const parent = { ...f, session: { kind: 'GUARDIAN', mobile: '9845000099' } }
    await expect(inTenant(() => studentSelfCheckIn(parent, student._id, { location: INSIDE }))).rejects.toMatchObject({ status: 403 })
    await expect(inTenant(() => studentSelfCheckIn(f, student._id, { location: OUTSIDE }))).rejects.toMatchObject({ status: 403 })
    const r = await inTenant(() => studentSelfCheckIn(f, student._id, { location: INSIDE }))
    expect(r).toMatchObject({ direction: 'IN', outcome: 'GATE', geofence: { status: 'INSIDE' } })
    // LOG: the register is the teacher's — nothing marked
    expect(await inTenant(() => AttendanceSheet.countDocuments({}))).toBe(0)
    expect(await inTenant(() => Branch.countDocuments({}))).toBeGreaterThan(0)
  })
})
