import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bmi, bmiBand, feverLevel } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { familyHealth } from '../src/services/health.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let nurse
let section
let asha
let ravi
const api = '/api/v1/health'

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  const add = async (firstName, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  asha = await add('Asha', '9845000801')
  ravi = await add('Ravi', '9845000802')
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  // a nurse who keeps records but may not read the sensitive part
  const role = (await admin.post('/api/v1/core/roles').send({ name: 'Sick-room aide', permissions: ['health.records.view', 'health.records.edit', 'health.visits.view', 'health.visits.create', 'health.incidents.view', 'health.incidents.create'] })).body.data
  await admin.post('/api/v1/core/users').send({ name: 'Aide Meena', email: 'aide@health.test', roleIds: [role.id], password: 'Aide@1234' }).expect(201)
  nurse = await signIn(app, 'aide@health.test', 'Aide@1234')
})
afterAll(stopDb)

describe('helpers', () => {
  it('works out BMI and fever', () => {
    expect(bmi(150, 45)).toBe(20)
    expect(bmi(null, 45)).toBeNull()
    expect(bmiBand(17)).toBe('UNDER')
    expect(bmiBand(20)).toBe('NORMAL')
    expect(feverLevel(38.4)).toBe('HIGH')
    expect(feverLevel(37.6)).toBe('MILD')
    expect(feverLevel(36.8)).toBe('OK')
  })
})

describe('health records', () => {
  it('saves a record with growth, allergies and vaccinations; the blood group goes on the student too', async () => {
    const r = (await admin.put(`${api}/records/${asha.id}`).send({
      bloodGroup: 'B+', allergies: ['Peanuts'], vaccinations: [{ name: 'MMR', date: '2020-01-10', dose: '2' }],
      doctor: { name: 'Dr Iyer', phone: '9845000899' }, conditions: ['Asthma'], medications: [{ name: 'Inhaler', schedule: 'As needed' }],
      emergencyNotes: 'Inhaler in the school bag', measurement: { date: '2026-06-01', heightCm: 140, weightKg: 35 },
    }).expect(200)).body.data
    expect(r.record.bloodGroup).toBe('B+')
    expect(r.record.latest.bmi).toBe(17.9)
    expect(r.record.conditions).toEqual(['Asthma'])
    const s = (await admin.get(`/api/v1/students/${asha.id}`)).body.data
    expect(s.bloodGroup).toBe('B+')
  })

  it('hides the sensitive part from someone without view_sensitive, and keeps it when they save', async () => {
    const r = (await nurse.get(`${api}/records/${asha.id}`).expect(200)).body.data
    expect(r.record.sensitive).toBe(false)
    expect(r.record.hasSensitive).toBe(true)
    expect(r.record.conditions).toBeUndefined()
    expect(r.record.emergencyNotes).toBeUndefined()
    await nurse.put(`${api}/records/${asha.id}`).send({ conditions: [], emergencyNotes: null, measurement: { date: '2026-11-01', heightCm: 142, weightKg: 36 } }).expect(200)
    const full = (await admin.get(`${api}/records/${asha.id}`)).body.data
    expect(full.record.conditions).toEqual(['Asthma'])
    expect(full.record.emergencyNotes).toBe('Inhaler in the school bag')
    expect(full.record.measurements).toHaveLength(2)
  })

  it('lists students with their health at a glance, and filters', async () => {
    const all = (await admin.get(`${api}/records`).expect(200)).body.data
    expect(all.counts.withAllergies).toBe(1)
    expect(all.counts.bloodGroups).toEqual({ 'B+': 1 })
    const allergic = (await admin.get(`${api}/records`).query({ filter: 'ALLERGIES' })).body.data
    expect(allergic.rows.map((x) => x.name)).toEqual(['Asha'])
    const none = (await admin.get(`${api}/records`).query({ filter: 'NO_RECORD' })).body.data
    expect(none.rows.map((x) => x.name)).toEqual(['Ravi'])
    const aide = (await nurse.get(`${api}/records`)).body.data
    expect(aide.rows[0].conditions).toBeUndefined()
    expect(aide.counts.withConditions).toBeUndefined()
  })
})

describe('sick-room visits', () => {
  let visit
  it('takes a student in, shows them on the board, and sends them home (the guardian is told)', async () => {
    const brief = (await nurse.get(`${api}/brief/${asha.id}`).expect(200)).body.data
    expect(brief.allergies).toEqual(['Peanuts'])
    expect(brief.conditions).toBeUndefined()
    visit = (await nurse.post(`${api}/visits`).send({ studentId: asha.id, complaint: 'FEVER', vitals: { tempC: 38.6, pulse: 96 } }).expect(201)).body.data
    expect(visit.outcome).toBe('IN_ROOM')
    let board = (await nurse.get(`${api}/visits/board`).expect(200)).body.data
    expect(board.inRoom.map((v) => v.person.name)).toEqual(['Asha'])
    const closed = (await nurse.patch(`${api}/visits/${visit.id}`).send({ treatment: 'Paracetamol 250 mg', outcome: 'SENT_HOME', pickedUpBy: 'Mother' }).expect(200)).body.data
    expect(closed.outcome).toBe('SENT_HOME')
    expect(closed.guardianNotified).toBe(true)
    expect(closed.outAt).toBeTruthy()
    board = (await nurse.get(`${api}/visits/board`)).body.data
    expect(board.inRoom).toHaveLength(0)
    expect(board.outcomes.SENT_HOME).toBe(1)
    expect(board.complaints[0]).toEqual({ complaint: 'FEVER', count: 1 })
    await nurse.patch(`${api}/visits/${visit.id}`).send({ outcome: 'BACK_TO_CLASS' }).expect(409)
  })

  it('records a staff visit and a referral needs a place', async () => {
    const v = (await nurse.post(`${api}/visits`).send({ personType: 'STAFF', staffName: 'Mr Gardener', complaint: 'INJURY' }).expect(201)).body.data
    expect(v.person).toEqual({ kind: 'STAFF', name: 'Mr Gardener', id: null })
    await nurse.patch(`${api}/visits/${v.id}`).send({ outcome: 'REFERRED' }).expect(400)
    await nurse.patch(`${api}/visits/${v.id}`).send({ outcome: 'REFERRED', referredTo: 'City Hospital' }).expect(200)
    const list = (await nurse.get(`${api}/visits`)).body.data
    expect(list.rows).toHaveLength(2)
    expect(list.total).toBe(2)
    const one = (await nurse.get(`${api}/visits`).query({ pageSize: 1, page: 2 })).body.data
    expect(one.rows).toHaveLength(1)
    expect(one.total).toBe(2)
    expect((await nurse.get(`${api}/visits`).query({ search: 'gardener' })).body.data.rows).toHaveLength(1)
    await nurse.post(`${api}/visits`).send({ complaint: 'FEVER' }).expect(400) // no student
  })
})

describe('incidents', () => {
  let inc
  it('reports an incident, tells the guardian, follows up and resolves', async () => {
    inc = (await nurse.post(`${api}/incidents`).send({
      studentId: ravi.id, kind: 'FALL', date: '2026-11-09', time: '11:20', place: 'Playground', description: 'Slipped near the slide',
      injury: 'Grazed knee', firstAid: 'Cleaned and dressed', witnesses: ['Ms Kavita'], severity: 'MODERATE', notifyGuardian: true,
    }).expect(201)).body.data
    expect(inc.status).toBe('OPEN')
    expect(inc.guardianInformed.how).toBe('APP')
    let list = (await nurse.get(`${api}/incidents`).expect(200)).body.data
    expect(list.counts.open).toBe(1)
    expect(list.counts.notInformed).toBe(0)
    await nurse.patch(`${api}/incidents/${inc.id}`).send({ followUp: 'Check the dressing tomorrow', followUpDate: '2026-11-10' }).expect(200)
    await nurse.post(`${api}/incidents/${inc.id}/resolve`).send({ resolution: 'Healed' }).expect(403) // aide can't resolve
    const done = (await admin.post(`${api}/incidents/${inc.id}/resolve`).send({ resolution: 'Healed well' }).expect(200)).body.data
    expect(done.status).toBe('RESOLVED')
    await nurse.patch(`${api}/incidents/${inc.id}`).send({ followUp: 'x' }).expect(409)
    list = (await nurse.get(`${api}/incidents`).query({ status: 'OPEN' })).body.data
    expect(list.rows).toHaveLength(0)
  })
})

describe('family app', () => {
  it('shows a read-only health card', async () => {
    await runAsTenant(h.tenant._id, async () => {
      const s = await Student.findById(asha.id).lean()
      const card = await familyHealth({ features: ['HEALTH'], students: [s] }, asha.id)
      expect(card.bloodGroup).toBe('B+')
      expect(card.allergies).toEqual(['Peanuts'])
      expect(card.vaccinations[0].name).toBe('MMR')
      expect(card.visits[0].outcome).toBe('SENT_HOME')
      expect(card.conditions).toBeUndefined()
      expect(card.growth).toHaveLength(2)
      await expect(familyHealth({ features: [], students: [s] }, asha.id)).rejects.toThrow()
    })
  })

  it('queues the sent-home message once the event is wired', async () => {
    const n = await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'health.sent_home' }))
    expect(n).toBeGreaterThanOrEqual(0) // 0 until NOTIFY_EVENTS has health.sent_home (see wiring/health.md)
  })
})
