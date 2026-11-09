import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GatePass, Visitor } from '../src/models/frontOffice.js'
import { Outpass } from '../src/models/hostel.js'
import { StoreAsset } from '../src/models/inventory.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// Scan, Phase 3: visitor badges at the exit, gate passes and hostel outpasses on the student's card, asset audits.
let app
let h
let admin
let student
let today
const inTenant = (fn) => runAsTenant(h.tenant._id, fn)
const resolve = (code) => admin.post('/api/v1/scan/resolve').send({ code })
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Ira', rollNo: '1', sectionId: section.id, guardians: [{ name: 'Parent Ira', mobile: '9845000071' }] }).expect(201)).body.data
  today = (await inTenant(() => institutionNow())).date
})
afterAll(stopDb)

describe('front office', () => {
  it('a visitor badge scanned at the exit checks the visitor out', async () => {
    await inTenant(() => Visitor.create({ date: today, name: 'Courier', purpose: 'DELIVERY', badgeNo: '12', inAt: new Date() }))
    const r = (await resolve('VB-12')).body.data
    expect(r).toMatchObject({ kind: 'VISITOR', title: 'Courier', badgeNo: '12', actions: [{ key: 'visitorOut' }] })
    const out = (await admin.post(`/api/v1${r.actions[0].post.slice(3)}`)).body.data
    expect(out).toMatchObject({ kind: 'VISITOR', actions: [] })
    expect(out.outAt).toBeTruthy()
    expect((await resolve('VB-12')).body.data.kind).toBe('UNKNOWN') // badge free again
  })

  it('a student’s card shows today’s approved gate pass, and marks them out', async () => {
    await inTenant(() => GatePass.create({ passNo: 'GP-1', kind: 'STUDENT', date: today, studentId: student.id, studentName: 'Ira', admissionNo: student.admissionNo, reason: 'Doctor', status: 'APPROVED' }))
    const r = (await resolve(student.admissionNo)).body.data
    expect(r.gatePass).toMatchObject({ passNo: 'GP-1', status: 'APPROVED' })
    expect(r.actions[0].key).toBe('gatePassLeft')
    const after = (await admin.post(`/api/v1${r.actions[0].post.slice(3)}`)).body.data
    expect(after.gatePass.status).toBe('LEFT')
  })
})

describe('hostel', () => {
  it('a boarder’s card marks an approved outpass out, then back in', async () => {
    await inTenant(() => Outpass.create({ outpassNo: 'OP-1', studentId: student.id, leaveDate: today, leaveTime: '16:00', returnDate: today, returnTime: '20:00', reason: 'Home', status: 'APPROVED', returnBy: new Date(Date.now() + 864e5) }))
    let r = (await resolve(student.admissionNo)).body.data
    const outAction = r.actions.find((a) => a.key === 'outpassOut')
    expect(outAction).toBeTruthy()
    r = (await admin.post(`/api/v1${outAction.post.slice(3)}`)).body.data
    expect(r.outpass.status).toBe('OUT')
    const inAction = r.actions.find((a) => a.key === 'outpassIn')
    r = (await admin.post(`/api/v1${inAction.post.slice(3)}`)).body.data
    expect(r.outpass).toBeNull() // back: nothing in play
  })
})

describe('inventory', () => {
  it('an asset tag scanned in an audit is verified', async () => {
    await inTenant(() => StoreAsset.create({ assetTag: 'IT-00001', name: 'Projector', category: 'IT', location: 'Room 4' }))
    const r = (await resolve('it-00001')).body.data
    expect(r).toMatchObject({ kind: 'ASSET', title: 'Projector', lastVerified: null })
    const v = (await admin.post(`/api/v1${r.actions.find((a) => a.key === 'verifyAsset').post.slice(3)}`)).body.data
    expect(v.lastVerified.at).toBeTruthy()
  })
})
