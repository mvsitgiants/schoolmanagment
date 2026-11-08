import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { GatewayOrder } from '../src/models/integrations.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

const WEBHOOK_SECRET = 'whsec_test_123'
let app
let h
let admin
let year
let aarav
let hookPath
const sign = (body) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
const hook = (event, payload, eventId) => {
  const body = JSON.stringify({ event, payload })
  return request(app).post(hookPath).set('Content-Type', 'application/json').set('X-Razorpay-Signature', sign(body)).set('X-Razorpay-Event-Id', eventId).send(body)
}
const order = (fields) => runAsTenant(h.tenant._id, () => GatewayOrder.create({ provider: 'RAZORPAY', kind: 'ORDER', source: 'APP', mode: 'SANDBOX', studentId: aarav.id, studentName: 'Aarav', admissionNo: aarav.admissionNo, ...fields }))

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  const cls = data.classes.find((c) => c.code === '11')
  aarav = (await admin.post('/api/v1/students').send({ firstName: 'Aarav', sectionId: cls.sections[0].id, guardians: [{ name: 'Neha', mobile: '9845000101', isPrimary: true }] })).body.data
  const heads = (await admin.get('/api/v1/fees/heads')).body.data
  const st = (await admin.post('/api/v1/fees/structures').send({
    name: 'Class 11', classIds: [cls.id], lines: [{ feeHeadId: heads.find((x) => x.code === 'TUITION').id, amount: 1000000 }],
    installments: [{ name: 'Annual', dueDate: year.startDate, amount: 1000000 }],
  })).body.data
  await admin.post(`/api/v1/fees/structures/${st.id}/generate`).expect(200)
})
afterAll(stopDb)

describe('setting up the gateway', () => {
  it('refuses a key that doesn’t match the mode, and switching on without the secret', async () => {
    expect((await admin.put('/api/v1/fees/online/config').send({ mode: 'LIVE', settings: { keyId: 'rzp_test_abcdef123' } })).status).toBe(400)
    expect((await admin.put('/api/v1/fees/online/config').send({ enabled: true, mode: 'SANDBOX', settings: { keyId: 'rzp_test_abcdef123' } })).status).toBe(400)
  })

  it('saves the keys (secrets never come back) and gives the webhook address', async () => {
    await admin.put('/api/v1/fees/online/config').send({ enabled: true, mode: 'SANDBOX', settings: { keyId: 'rzp_test_abcdef123' }, secrets: { keySecret: 'ks_test_secret', webhookSecret: WEBHOOK_SECRET } }).expect(200)
    const view = (await admin.get('/api/v1/fees/online/config')).body.data
    expect(JSON.stringify(view)).not.toContain('ks_test_secret')
    expect(view.webhookUrl).toMatch(/\/api\/v1\/hooks\/razorpay\/[\w-]+$/)
    hookPath = new URL(view.webhookUrl).pathname
    expect((await admin.get('/api/v1/fees/online/status')).body.data.on).toBe(true)
  })
})

describe('the webhook', () => {
  it('rejects a bad signature', async () => {
    const res = await request(app).post(hookPath).set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'nope').send('{"event":"payment.captured"}')
    expect(res.status).toBe(400)
  })

  it('a captured payment becomes one fee receipt, once', async () => {
    await order({ amount: 400000, providerOrderId: 'order_T1' })
    const payment = { entity: { id: 'pay_T1', order_id: 'order_T1', amount: 400000, currency: 'INR', status: 'captured', method: 'upi', created_at: Math.floor(Date.now() / 1000) } }
    expect((await hook('payment.captured', { payment }, 'evt_1')).status).toBe(200)
    expect((await hook('payment.captured', { payment }, 'evt_1')).body.duplicate).toBe(true) // same event again
    expect((await hook('order.paid', { payment }, 'evt_2')).status).toBe(200) // another event for the same payment
    const o = await runAsTenant(h.tenant._id, () => GatewayOrder.findOne({ providerOrderId: 'order_T1' }).lean())
    expect(o).toMatchObject({ status: 'APPLIED', providerPaymentId: 'pay_T1', method: 'upi' })
    const receipts = (await admin.get('/api/v1/fees/receipts')).body.data.filter((r) => r.reference === 'pay_T1')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ amount: 400000, mode: 'ONLINE' })
    expect((await admin.get(`/api/v1/fees/students/${aarav.id}`)).body.data.totals.balance).toBe(600000)
  })

  it('a payment for a different amount waits for review instead of being receipted', async () => {
    await order({ amount: 600000, providerOrderId: 'order_T2' })
    const payment = { entity: { id: 'pay_T2', order_id: 'order_T2', amount: 500000, currency: 'INR', status: 'captured', method: 'card' } }
    await hook('payment.captured', { payment }, 'evt_3').expect(200)
    const o = await runAsTenant(h.tenant._id, () => GatewayOrder.findOne({ providerOrderId: 'order_T2' }).lean())
    expect(o.status).toBe('NEEDS_REVIEW')
    expect(o.error).toMatch(/order was for/)
    const list = (await admin.get('/api/v1/fees/online/orders?status=NEEDS_REVIEW')).body.data
    expect(list[0].providerOrderId).toBe('order_T2')
  })
})
