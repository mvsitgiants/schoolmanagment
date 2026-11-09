import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { notifyUsers } from '../src/services/notify.js'
import { sentPushes } from '../src/services/push.js'
import { emit } from '../src/platform/events.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let student
const sub = (n) => ({ endpoint: `https://push.example.test/send/${n}`, keys: { p256dh: `BP${'x'.repeat(80)}${n}`, auth: `auth${n}` } })

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const cls = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '11')
  student = (await admin.post('/api/v1/students').send({ firstName: 'Nila', sectionId: cls.sections[0].id, guardians: [{ name: 'Parent Nila', relation: 'MOTHER', mobile: '9845000101', isPrimary: true }] })).body.data
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

describe('web push', () => {
  it('gives the public key and keeps a staff subscription; the bell also pushes', async () => {
    const key = (await admin.get('/api/v1/core/notifications/push/key')).body.data.publicKey
    expect(key).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    await admin.post('/api/v1/core/notifications/push').send({ subscription: sub(1) }).expect(200)
    const me = (await admin.get('/api/v1/auth/me')).body.data
    await runAsTenant(h.tenant._id, () => notifyUsers([me.user?.id ?? me.id], { event: 'test.event', title: 'Leave waiting', message: 'Approve it', link: '/approvals' }))
    await new Promise((r) => setTimeout(r, 200))
    expect(sentPushes().some((p) => p.endpoint === sub(1).endpoint && p.title === 'Leave waiting' && p.url === '/approvals')).toBe(true)
    await admin.post('/api/v1/core/notifications/push/off').send({ endpoint: sub(1).endpoint }).expect(200)
  })

  it('a family subscription hears about its own child’s events and stops on sign-out', async () => {
    await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
    const fam = (p) => `/api/v1/family/${h.tenant.slug}${p}`
    const agent = request.agent(app)
    const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000101' })).body.data
    await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
    await agent.post(fam('/push')).send({ subscription: sub(2) }).expect(200)
    await runAsTenant(h.tenant._id, () => emit('attendance.absent', { studentId: student.id, data: { attendance: { date: '2026-11-09' } } }))
    await new Promise((r) => setTimeout(r, 300))
    expect(sentPushes().some((p) => p.endpoint === sub(2).endpoint && p.family)).toBe(true)
    await agent.post(fam('/logout')).expect(200)
    const before = sentPushes().length
    await runAsTenant(h.tenant._id, () => emit('attendance.absent', { studentId: student.id, data: { attendance: { date: '2026-11-10' } } }))
    await new Promise((r) => setTimeout(r, 300))
    expect(sentPushes().slice(before).some((p) => p.endpoint === sub(2).endpoint)).toBe(false)
  })

  it('refuses something that isn’t a subscription', async () => {
    expect((await admin.post('/api/v1/core/notifications/push').send({ subscription: { endpoint: 'nope' } })).status).toBe(400)
  })
})
