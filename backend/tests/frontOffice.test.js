import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { addDaysYmd, complaintOverdue, foDurationLabel, foWeekStart } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let section
let meera
let today
const api = '/api/v1/frontoffice'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
const PHOTO = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  section = (await admin.get('/api/v1/academics/classes')).body.data.classes[3].sections[0]
  meera = (await admin.post('/api/v1/students').send({ firstName: 'Meera', lastName: 'Rao', sectionId: section.id, guardians: [{ name: 'Lata Rao', relation: 'MOTHER', mobile: '9845000801', isPrimary: true }] })).body.data
  await asTenant(() => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
  today = (await asTenant(() => institutionNow())).date
})
afterAll(stopDb)

describe('helpers', () => {
  it('works out the week, durations and overdue complaints', () => {
    expect(foWeekStart('2026-11-12')).toBe('2026-11-09') // a Thursday → Monday
    expect(foWeekStart('2026-11-15')).toBe('2026-11-09') // a Sunday belongs to the week before
    expect(foDurationLabel(40)).toBe('40 min')
    expect(foDurationLabel(85)).toBe('1 h 25 min')
    expect(complaintOverdue({ status: 'OPEN', dueOn: '2026-11-01' }, '2026-11-02')).toBe(true)
    expect(complaintOverdue({ status: 'RESOLVED', dueOn: '2026-11-01' }, '2026-11-02')).toBe(false)
  })
})

describe('visitor log', () => {
  let visitor
  it('checks a visitor in with a photo and a badge; the host is told; the desk shows them inside', async () => {
    const staff = (await admin.get(`${api}/staff`)).body.data
    expect(staff.length).toBeGreaterThan(0)
    const res = await admin.post(`${api}/visitors`).send({ name: 'Ravi Kumar', mobile: '9845000900', purpose: 'MEET_STAFF', hostId: staff[0].id, from: 'ABC Books', idType: 'AADHAAR', idNumber: '1234', photo: PHOTO })
    expect(res.status).toBe(201)
    visitor = res.body.data
    expect(visitor).toMatchObject({ name: 'Ravi Kumar', inside: true, badgeNo: 'V-1', hasPhoto: true, hostName: staff[0].name, date: today })
    const desk = (await admin.get(`${api}/visitors/desk`)).body.data
    expect(desk.stats).toMatchObject({ today: 1, inside: 1, week: 1 })
    expect(desk.stats.byPurpose.MEET_STAFF).toBe(1)
    expect(desk.inside[0].photo).toBe(PHOTO)
    expect(desk.today[0].photo).toBeUndefined() // the log stays light
  })

  it('needs a host to meet staff, refuses a badge still out, and refuses what is not a photo', async () => {
    expect((await admin.post(`${api}/visitors`).send({ name: 'Nobody', purpose: 'MEET_STAFF' })).status).toBe(400)
    const dup = await admin.post(`${api}/visitors`).send({ name: 'Second', purpose: 'VENDOR', badgeNo: 'V-1' })
    expect(dup.status).toBe(409)
    expect((await admin.post(`${api}/visitors`).send({ name: 'Third', purpose: 'OTHER', photo: 'data:text/html;base64,PGI+' })).status).toBe(400)
  })

  it('checks out once; a returning visitor is found by mobile', async () => {
    const out = (await admin.post(`${api}/visitors/${visitor.id}/checkout`).expect(200)).body.data
    expect(out.inside).toBe(false)
    expect((await admin.post(`${api}/visitors/${visitor.id}/checkout`)).status).toBe(409)
    const again = (await admin.get(`${api}/visitors/lookup?mobile=09845000900`)).body.data
    expect(again).toMatchObject({ name: 'Ravi Kumar', from: 'ABC Books', visits: 1 })
    const log = (await admin.get(`${api}/visitors?status=OUT`)).body.data
    expect(log.map((v) => v.id)).toContain(visitor.id)
  })

  it('turns an admission-enquiry visit into an enquiry in Admissions, once', async () => {
    const v = (await admin.post(`${api}/visitors`).send({ name: 'Sunita Shah', mobile: '9845000911', purpose: 'ADMISSION_ENQUIRY' }).expect(201)).body.data
    const res = await admin.post(`${api}/visitors/${v.id}/enquiry`).send({ childName: 'Aarav Shah' })
    expect(res.status).toBe(201)
    expect(res.body.data.enquiry.enquiryNo).toBeTruthy()
    expect(res.body.data.visitor.enquiryNo).toBe(res.body.data.enquiry.enquiryNo)
    expect((await admin.post(`${api}/visitors/${v.id}/enquiry`).send({ childName: 'Aarav Shah' })).status).toBe(409)
    const enquiries = (await admin.get('/api/v1/admissions/enquiries')).body.data
    expect(enquiries.find((e) => e.childName === 'Aarav Shah')).toMatchObject({ parentName: 'Sunita Shah', source: 'WALK_IN' })
  })
})

describe('gate passes', () => {
  let pass
  let guardianId
  it('writes a numbered pass for a student collected by a guardian on record', async () => {
    const found = (await admin.get(`${api}/students?search=meera`)).body.data
    expect(found[0]).toMatchObject({ id: meera.id, classShort: expect.any(String) })
    const g = found[0].guardians[0]
    guardianId = g.id
    const res = await admin.post(`${api}/gate-passes`).send({ kind: 'STUDENT', studentId: meera.id, collector: { type: 'GUARDIAN', guardianId: g.id }, reason: 'Unwell', leaveAt: '11:30' })
    expect(res.status).toBe(201)
    pass = res.body.data
    expect(pass.passNo).toMatch(/^GP\d{8}$/)
    expect(pass).toMatchObject({ status: 'REQUESTED', studentName: 'Meera Rao', collector: { type: 'GUARDIAN', name: 'Lata Rao', relation: 'MOTHER' } })
  })

  it('one waiting pass per student a day; someone else collecting needs a name and relation', async () => {
    expect((await admin.post(`${api}/gate-passes`).send({ kind: 'STUDENT', studentId: meera.id, collector: { type: 'GUARDIAN', guardianId }, reason: 'Again' })).status).toBe(409)
    const other = (await admin.post('/api/v1/students').send({ firstName: 'Kabir', sectionId: section.id, guardians: [{ name: 'Mr Kabir', relation: 'FATHER', mobile: '9845000802', isPrimary: true }] })).body.data
    expect((await admin.post(`${api}/gate-passes`).send({ kind: 'STUDENT', studentId: other.id, collector: { type: 'OTHER' }, reason: 'Wedding' })).status).toBe(400)
    const ok = await admin.post(`${api}/gate-passes`).send({ kind: 'STUDENT', studentId: other.id, collector: { type: 'OTHER', name: 'Uncle Raj', relation: 'Uncle', photo: PHOTO }, reason: 'Wedding' })
    expect(ok.status).toBe(201)
    expect(ok.body.data.collector).toMatchObject({ type: 'OTHER', name: 'Uncle Raj', photo: PHOTO })
    await admin.post(`${api}/gate-passes/${ok.body.data.id}/cancel`).send({ reason: 'Plans changed' }).expect(200)
  })

  it('can’t leave before approval; the class teacher approves; the gate hands over and the family is told', async () => {
    expect((await admin.post(`${api}/gate-passes/${pass.id}/left`)).status).toBe(409)
    // a class teacher with no front-office permission may decide for their own class only
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    const teacher = (await admin.post('/api/v1/core/users').send({ name: 'Class Teacher', email: 'ct@fo.test', roleIds: [tpl.id], password: 'Teach@123' }).expect(201)).body.data
    const t = await signIn(app, 'ct@fo.test', 'Teach@123')
    expect((await t.post(`${api}/gate-passes/${pass.id}/decide`).send({ approve: true })).status).toBe(403)
    await admin.patch(`/api/v1/academics/sections/${section.id}`).send({ classTeacherId: teacher.id }).expect(200)
    const waiting = (await t.get(`${api}/gate-passes/to-approve`)).body.data.rows
    expect(waiting.map((p) => p.id)).toContain(pass.id)
    const approved = (await t.post(`${api}/gate-passes/${pass.id}/decide`).send({ approve: true, note: 'Mother called' }).expect(200)).body.data
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: 'Class Teacher' })
    const left = (await admin.post(`${api}/gate-passes/${pass.id}/left`).expect(200)).body.data
    expect(left.status).toBe('LEFT')
    expect(left.leftAt).toBeTruthy()
    const msgs = await asTenant(() => MessageLog.find({ event: 'frontoffice.gate_pass' }).lean())
    expect(msgs.length).toBeGreaterThan(0)
    expect(msgs.find((m) => m.channel === 'WHATSAPP')?.body ?? msgs[0].body).toMatch(/Lata Rao|Meera/)
    const day = (await admin.get(`${api}/gate-passes`)).body.data
    expect(day.counts).toMatchObject({ LEFT: 1, CANCELLED: 1 })
  })

  it('a staff pass: out and back', async () => {
    const staff = (await admin.get(`${api}/staff`)).body.data[0]
    const p = (await admin.post(`${api}/gate-passes`).send({ kind: 'STAFF', staffId: staff.id, reason: 'Bank work', returnBy: '14:00', approveNow: true }).expect(201)).body.data
    expect(p.status).toBe('APPROVED')
    await admin.post(`${api}/gate-passes/${p.id}/left`).expect(200)
    expect((await admin.post(`${api}/gate-passes/${p.id}/returned`).expect(200)).body.data.status).toBe('RETURNED')
  })
})

describe('complaints', () => {
  let c
  it('raises a numbered complaint with a due day from the SLA, and acknowledges it', async () => {
    const res = await admin.post(`${api}/complaints`).send({ source: 'PARENT', category: 'TRANSPORT', priority: 'HIGH', subject: 'Bus late every morning', description: 'Route 4 is 20 minutes late.', studentId: meera.id })
    expect(res.status).toBe(201)
    c = res.body.data
    expect(c.complaintNo).toMatch(/^CMP\d{7}$/)
    expect(c).toMatchObject({ status: 'OPEN', dueOn: addDaysYmd(today, 3), studentName: 'Meera Rao', complainant: { name: 'Lata Rao' } })
    expect(await asTenant(() => MessageLog.countDocuments({ event: 'frontoffice.complaint_received' }))).toBeGreaterThan(0)
  })

  it('needs a complainant when there is no student', async () => {
    expect((await admin.post(`${api}/complaints`).send({ source: 'WALK_IN', category: 'FACILITIES', subject: 'Broken gate' })).status).toBe(400)
    const ok = await admin.post(`${api}/complaints`).send({ source: 'WALK_IN', category: 'FACILITIES', subject: 'Broken gate', complainant: { name: 'Neighbour', mobile: '9845000999' } })
    expect(ok.status).toBe(201)
  })

  it('assign → in progress; resolving needs what was done; the family is told; then closed for good', async () => {
    const staff = (await admin.get(`${api}/staff`)).body.data[0]
    const a = (await admin.post(`${api}/complaints/${c.id}/assign`).send({ assignedToId: staff.id }).expect(200)).body.data
    expect(a).toMatchObject({ status: 'IN_PROGRESS', assignedTo: staff.name })
    expect((await admin.post(`${api}/complaints/${c.id}/status`).send({ status: 'RESOLVED' })).status).toBe(400)
    const r = (await admin.post(`${api}/complaints/${c.id}/status`).send({ status: 'RESOLVED', resolution: 'Driver changed; bus now on time.' }).expect(200)).body.data
    expect(r).toMatchObject({ status: 'RESOLVED', resolution: 'Driver changed; bus now on time.' })
    expect(await asTenant(() => MessageLog.countDocuments({ event: 'frontoffice.complaint_resolved' }))).toBeGreaterThan(0)
    await admin.post(`${api}/complaints/${c.id}/status`).send({ status: 'CLOSED' }).expect(200)
    expect((await admin.post(`${api}/complaints/${c.id}/status`).send({ status: 'IN_PROGRESS' })).status).toBe(409)
    const list = (await admin.get(`${api}/complaints`)).body.data
    expect(list.counts.CLOSED).toBe(1)
    expect(list.rows.find((x) => x.id === c.id).steps.map((s) => s.action)).toEqual(['RAISED', 'ASSIGNED', 'RESOLVED', 'CLOSED'])
  })
})

describe('family app › complaints', () => {
  it('a parent raises a complaint about their child and follows it', async () => {
    const agent = request.agent(app)
    const fam = (p) => `/api/v1/family/${h.tenant.slug}${p}`
    const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000801' })).body.data
    await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
    const raised = await agent.post(fam(`/students/${meera.id}/complaints`)).send({ category: 'ACADEMICS', subject: 'Too much homework', description: 'Three hours every day.' })
    expect(raised.status).toBe(201)
    expect(raised.body.data).toMatchObject({ status: 'OPEN', category: 'ACADEMICS' })
    const mine = (await agent.get(fam(`/students/${meera.id}/complaints`))).body.data.rows
    expect(mine.map((x) => x.subject)).toEqual(expect.arrayContaining(['Too much homework', 'Bus late every morning']))
    const desk = (await admin.get(`${api}/complaints?search=homework`)).body.data.rows[0]
    expect(desk).toMatchObject({ source: 'FAMILY_APP', complainant: { name: 'Lata Rao' } })
  })
})
