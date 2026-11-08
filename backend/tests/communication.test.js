import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MessageLog, MessagingConfig, Notification } from '../src/models/engines.js'
import { TeacherAllocation } from '../src/models/academics.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let slug
let cls
let other
let section
let aarav
let kabir
let me
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  slug = h.tenant.slug
  admin = await signIn(app, h.email, h.password)
  me = (await admin.get('/api/v1/auth/me')).body.data.user
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  cls = data.classes.find((c) => c.code === '11')
  other = data.classes.find((c) => c.code === '12')
  section = cls.sections[0]
  const add = async (firstName, sectionId, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId, guardians: [{ name: `Parent of ${firstName}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  aarav = await add('Aarav', section.id, '9845000081')
  kabir = await add('Kabir', other.sections[0].id, '9845000082')
  // the admin teaches English in 11-A, so families of 11-A can write to them
  const eng = (await admin.get('/api/v1/academics/subjects')).body.data.find((s) => s.code === 'ENG')
  await runAsTenant(h.tenant._id, () => TeacherAllocation.create({ academicYearId: data.year.id, sectionId: section.id, subjectId: eng.id, teacherId: me.id }))
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
})
afterAll(stopDb)

const api = '/api/v1/communication'
const fam = (path) => `/api/v1/family/${slug}${path}`
async function family(mobile) {
  const agent = request.agent(app)
  const sent = (await agent.post(fam('/otp')).send({ mobile })).body.data
  await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
  return agent
}

describe('notices', () => {
  let notice
  it('a draft is invisible to families; publishing shows it to its audience only and can send it', async () => {
    notice = (await admin.post(`${api}/notices`).send({ title: 'Class 11 trip on Friday', body: 'Bring a packed lunch.', category: 'Event', audience: { kind: 'CLASSES', classIds: [cls.id] } })).body.data
    expect(notice.status).toBe('DRAFT')
    const a = await family('9845000081')
    expect((await a.get(fam(`/students/${aarav.id}/notices`))).body.data).toHaveLength(0)
    const pub = (await admin.post(`${api}/notices/${notice.id}/publish`).send({ channels: ['WHATSAPP'] })).body.data
    expect(pub).toMatchObject({ recipients: 1 })
    expect(await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'communication.notice' }))).toBe(1)
    const list = (await a.get(fam(`/students/${aarav.id}/notices`))).body.data
    expect(list[0]).toMatchObject({ title: 'Class 11 trip on Friday', read: false })
    await a.post(fam(`/students/${aarav.id}/notices/${notice.id}/read`)).expect(200)
    const k = await family('9845000082')
    expect((await k.get(fam(`/students/${kabir.id}/notices`))).body.data).toHaveLength(0) // class 12
    const staff = (await admin.get(`${api}/notices`)).body.data
    expect(staff[0]).toMatchObject({ reads: 1, recipients: 1 })
  })

  it('a published notice can’t be deleted or retargeted, only withdrawn', async () => {
    expect((await admin.delete(`${api}/notices/${notice.id}`)).status).toBe(409)
    expect((await admin.patch(`${api}/notices/${notice.id}`).send({ title: 'x trip', audience: { kind: 'ALL' } })).status).toBe(409)
    await admin.post(`${api}/notices/${notice.id}/withdraw`).expect(200)
  })
})

describe('messages to families', () => {
  it('queues one message per family by the ticked channels, and keeps the count', async () => {
    const res = (await admin.post(`${api}/broadcasts`).send({ text: 'School closed tomorrow because of rain.', audience: { kind: 'ALL' }, channels: ['SMS'] })).body.data
    expect(res.recipients).toBe(2)
    const rows = await runAsTenant(h.tenant._id, () => MessageLog.find({ event: 'communication.message' }).lean())
    expect(rows).toHaveLength(2)
    expect(rows[0].body).toContain('School closed tomorrow')
    expect((await admin.get(`${api}/broadcasts`)).body.data[0].recipients).toBe(2)
    expect((await admin.post(`${api}/broadcasts`).send({ text: 'x'.repeat(400), channels: ['SMS'] })).status).toBe(400) // too long for SMS
  })
})

describe('parent–teacher chat', () => {
  it('a parent writes to a teacher of the child; the teacher gets a bell and replies; the family is told', async () => {
    const a = await family('9845000081')
    const teachers = (await a.get(fam(`/students/${aarav.id}/chat/teachers`))).body.data
    expect(teachers.map((t) => t.id)).toContain(me.id)
    const thread = (await a.post(fam(`/students/${aarav.id}/chat`)).send({ staffUserId: me.id, text: 'Can Aarav sit in the front row?' })).body.data
    expect(thread.messages).toHaveLength(1)
    const bell = await runAsTenant(h.tenant._id, () => Notification.findOne({ event: 'communication.chat' }).lean())
    expect(bell.message).toContain('front row')
    const inbox = (await admin.get(`${api}/chat`)).body.data
    expect(inbox[0]).toMatchObject({ unreadStaff: 1, studentName: 'Aarav' })
    const replied = (await admin.post(`${api}/chat/${inbox[0].id}/reply`).send({ text: 'Yes, from Monday.' })).body.data
    expect(replied.messages.map((m) => m.from)).toEqual(['FAMILY', 'STAFF'])
    expect(await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'communication.chat' }))).toBeGreaterThan(0)
    const mine = (await a.get(fam(`/students/${aarav.id}/chat`))).body.data
    expect(mine[0].unread).toBe(1)
  })

  it('a family can’t write to someone who doesn’t teach the child', async () => {
    const k = await family('9845000082')
    expect((await k.post(fam(`/students/${kabir.id}/chat`)).send({ staffUserId: me.id, text: 'Hello' })).status).toBe(400)
  })

  it('a moderator can hide a message', async () => {
    const inbox = (await admin.get(`${api}/chat?all=1`)).body.data
    const t = (await admin.get(`${api}/chat/${inbox[0].id}`)).body.data
    const after = (await admin.post(`${api}/chat/${inbox[0].id}/moderate`).send({ messageId: t.messages[0].id })).body.data
    expect(after.messages[0].hidden).toBe(true)
    const a = await family('9845000081')
    const thread = (await a.get(fam(`/students/${aarav.id}/chat/${inbox[0].id}`))).body.data
    expect(thread.messages[0].text).toBeNull()
  })
})
