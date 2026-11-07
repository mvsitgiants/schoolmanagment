import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Tenant, SubscriptionInvoice } from '../src/models/platform.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { assertWithinLimit, runBillingCycle } from '../src/services/subscription.js'
import { asSystem, newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
beforeAll(async () => { app = await startDb() })
afterAll(stopDb)

const DAY = 864e5

describe('plans and limits', () => {
  it('blocks adding users beyond the plan limit', async () => {
    const h = await newInstitution('STARTER') // 40 users
    await Tenant.updateOne({ _id: h.tenant._id }, { $set: { limitsOverride: { users: 2 } } })
    const admin = await signIn(app, h.email, h.password)
    const role = (await admin.get('/api/v1/core/roles')).body.data[0]
    const ok = await admin.post('/api/v1/core/users').send({ name: 'Two', email: 'two@x.test', roleIds: [role.id] })
    expect(ok.status).toBe(201)
    expect(ok.body.data.tempPassword).toMatch(/^\w{4}-\w{4}-\w{4}$/)
    const over = await admin.post('/api/v1/core/users').send({ name: 'Three', email: 'three@x.test', roleIds: [role.id] })
    expect(over.status).toBe(422)
    expect(over.body.message).toMatch(/plan allows 2 staff logins/)
  })

  it('counts active students against the plan’s student limit', async () => {
    const h = await newInstitution('STARTER') // 500 students
    await Tenant.updateOne({ _id: h.tenant._id }, { $set: { limitsOverride: { students: 1 } } })
    await runAsTenant(h.tenant._id, () => Student.create({ admissionNo: 'S1', firstName: 'One' }))
    const admin = await signIn(app, h.email, h.password)
    const sub = (await admin.get('/api/v1/core/subscription')).body.data
    expect(sub.usage.students).toBe(1)
    expect(sub.limits.students).toBe(1)
    await expect(assertWithinLimit(h.tenant._id, 'students', 1)).rejects.toThrow(/plan allows 1 students/)
  })

  it('changing plan during the trial switches modules without an invoice', async () => {
    const h = await newInstitution('STARTER')
    const admin = await signIn(app, h.email, h.password)
    const preview = (await admin.post('/api/v1/core/subscription/preview').send({ planCode: 'GROWTH' })).body.data
    expect(preview.modulesAdded).toContain('timetable')
    expect(preview.invoiceNeeded).toBe(false)
    const res = await admin.post('/api/v1/core/subscription/change-plan').send({ planCode: 'GROWTH' })
    expect(res.status).toBe(200)
    expect(res.body.data.invoice).toBeNull()
    const me = (await admin.get('/api/v1/auth/me')).body.data
    expect(me.enabledModules).toContain('timetable')
  })

  it('subscribing raises an invoice; recording the payment activates the period', async () => {
    const h = await newInstitution('STARTER')
    const admin = await signIn(app, h.email, h.password)
    const res = await admin.post('/api/v1/core/subscription/subscribe').send({ planCode: 'STARTER', cycle: 'YEARLY' })
    expect(res.status).toBe(200)
    const inv = res.body.data.invoice
    expect(inv.total).toBe(7500000 + Math.round(7500000 * 0.18))
    const owner = await signIn(app, 'owner@schoolgiant.test', 'Owner@123')
    const paid = await owner.post(`/api/v1/superadmin/tenants/${h.tenant._id}/invoices/${inv.id}/pay`).send({ method: 'BANK_TRANSFER', reference: 'UTR1' })
    expect(paid.status).toBe(200)
    const sub = (await admin.get('/api/v1/core/subscription')).body.data
    expect(sub.status).toBe('ACTIVE')
    expect(sub.billingCycle).toBe('YEARLY')
  })
})

describe('when a subscription stops', () => {
  it('trial expired: staff cannot sign in, the admin can — only to renew', async () => {
    const h = await newInstitution('STARTER')
    const admin = await signIn(app, h.email, h.password)
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Desk', permissions: ['core.users.view'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Desk', email: 'desk@exp.test', roleIds: [role.id], password: 'Desk@1234' })
    await Tenant.updateOne({ _id: h.tenant._id }, { $set: { trialEndsAt: new Date(Date.now() - DAY), accessVersion: 99 } })

    const staff = await request(app).post('/api/v1/auth/login').send({ email: 'desk@exp.test', password: 'Desk@1234' })
    expect(staff.status).toBe(403)
    const again = await signIn(app, h.email, h.password)
    expect(again.me.subscription.status).toBe('TRIAL_EXPIRED')
    expect((await again.get('/api/v1/core/users')).status).toBe(402)
    expect((await again.get('/api/v1/core/subscription')).status).toBe(200)
  })

  it('billing job: renewal invoice, then past due, then suspended after the grace days', async () => {
    const h = await newInstitution('STARTER')
    await Tenant.updateOne({ _id: h.tenant._id }, { $set: { status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 32 * DAY), currentPeriodEnd: new Date(Date.now() - 2 * DAY), graceDays: 7 } })
    await asSystem(() => runBillingCycle())
    let t = await Tenant.findById(h.tenant._id).lean()
    expect(t.status).toBe('PAST_DUE')
    expect(await SubscriptionInvoice.countDocuments({ tenantId: h.tenant._id, kind: 'RENEWAL', status: 'DUE' })).toBe(1)
    await asSystem(() => runBillingCycle(new Date(Date.now() + 10 * DAY)))
    t = await Tenant.findById(h.tenant._id).lean()
    expect(t.status).toBe('SUSPENDED')
    expect(await SubscriptionInvoice.countDocuments({ tenantId: h.tenant._id, kind: 'RENEWAL' })).toBe(1) // idempotent
  })
})

describe('sign-in', () => {
  it('asks which institution when one email works at two', async () => {
    const a = await newInstitution('STARTER')
    const b = await newInstitution('STARTER')
    for (const h of [a, b]) {
      const admin = await signIn(app, h.email, h.password)
      const role = (await admin.get('/api/v1/core/roles')).body.data[0]
      await admin.post('/api/v1/core/users').send({ name: 'Dr Two', email: 'two.places@test.test', roleIds: [role.id], password: 'Doc@12345' })
    }
    const first = await request(app).post('/api/v1/auth/login').send({ email: 'two.places@test.test', password: 'Doc@12345' })
    expect(first.body.data.needsTenant).toBe(true)
    expect(first.body.data.tenants).toHaveLength(2)
    const pick = await request(app).post('/api/v1/auth/login').send({ email: 'two.places@test.test', password: 'Doc@12345', tenantId: String(b.tenant._id) })
    expect(pick.body.data.tenant.id).toBe(String(b.tenant._id))
  })

  it('self-service sign-up starts a trial and signs the admin in', async () => {
    const res = await request(app).post('/api/v1/public/signup').send({ institutionName: 'New Life Clinic', name: 'Dr New', email: 'new@life.test', mobile: '9876543210', password: 'Life@1234', planCode: 'STARTER' })
    expect(res.status).toBe(201)
    expect(res.body.data.roles.map((r) => r.name)).toEqual(['Institution Admin'])
    expect(res.body.data.subscription.status).toBe('TRIAL')
    expect(res.headers['set-cookie'].join(';')).toMatch(/hx_at=/)
  })
})
