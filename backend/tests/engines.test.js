import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDaysYmd, nowIn } from '@schoolgiant/shared'
import { MessageLog } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { processOutbox } from '../src/services/notify.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let doctor
let cashier
let cashier2
let manager
let nurse
let vitalsOnly
const today = () => nowIn('Asia/Kolkata').date
const tomorrow = () => addDaysYmd(today(), 1)
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '12:00', slotMinutes: 15 }))
let mobileSeq = 0

const patient = async (extra = {}) => (await admin.post('/api/v1/patients').send({
  firstName: 'Asha', lastName: 'Rao', gender: 'FEMALE', age: { years: 40 },
  mobile: `98${String(++mobileSeq).padStart(8, '0')}`, address: { pincode: '560001' }, consents: { dataProcessing: true }, ...extra,
})).body.data
const userWith = async (code, email) => {
  const roles = (await admin.get('/api/v1/core/roles')).body.data
  let role = roles.find((r) => r.templateCode === code)
  if (!role) role = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: [code] })).body.data.created[0]
  await admin.post('/api/v1/core/users').send({ name: `${code} ${email.split('@')[0]}`, email, roleIds: [role.id], password: 'Staff@123' })
  return signIn(app, email, 'Staff@123')
}
const messagesFor = (studentId) => runAsTenant(h.tenant._id, () => MessageLog.find({ studentId }).sort({ channel: 1 }).lean())
const book = async (p, time = '09:00') => (await admin.post('/api/v1/appointments').send({ studentId: p.id, doctorId: doctor.id, date: tomorrow(), time })).body.data
const service = async (q) => (await admin.get(`/api/v1/billing/services?search=${q}`)).body.data[0]

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  doctor = (await admin.post('/api/v1/appointments/doctors').send({ name: 'Dr. Message', sessions: ALL_WEEK, fees: { newVisit: 50000, followUp: 30000 } })).body.data
  cashier = await userWith('CASHIER', 'cash1@e.test')
  cashier2 = await userWith('CASHIER', 'cash2@e.test')
  manager = await userWith('BILLING_MANAGER', 'mgr@e.test')
  nurse = await userWith('STAFF_NURSE', 'nurse@e.test')
  const role = (await admin.post('/api/v1/core/roles').send({ name: 'Vitals only', permissions: ['opd.vitals.view'] })).body.data
  await admin.post('/api/v1/core/users').send({ name: 'Vitals person', email: 'vitals@e.test', roleIds: [role.id], password: 'Staff@123' })
  vitalsOnly = await signIn(app, 'vitals@e.test', 'Staff@123')
})
afterAll(stopDb)

// ───────────────────────────────────────────────────────── patient messages

describe('patient messages', () => {
  it('are kept as "not sent" with the reason while no provider is set up', async () => {
    const p = await patient()
    await book(p)
    const rows = await messagesFor(p.id)
    expect(rows.map((m) => [m.channel, m.status])).toEqual([['SMS', 'SKIPPED'], ['WHATSAPP', 'SKIPPED']])
    expect(rows[0].reason).toMatch(/SMS isn’t set up/)
    expect(rows[0].body).toContain('Dr. Message')
  })

  it('go out in test mode, respect the patient’s choice, and are listed in the log', async () => {
    await admin.put('/api/v1/core/messaging/SMS').send({ provider: 'TEST' }).expect(200)
    await admin.put('/api/v1/core/messaging/WHATSAPP').send({ provider: 'TEST' }).expect(200)
    const p = await patient({ firstName: 'Ravi', consents: { dataProcessing: true, whatsapp: false } })
    await book(p, '09:15')
    let rows = await messagesFor(p.id)
    expect(rows.map((m) => [m.channel, m.status])).toEqual([['SMS', 'QUEUED'], ['WHATSAPP', 'SKIPPED']])
    expect(rows[1].reason).toMatch(/doesn’t want WhatsApp/)
    expect(rows[0].to).toBe(`91${p.mobile.replace(/\D/g, '').slice(-10)}`)
    expect(await processOutbox()).toBeGreaterThanOrEqual(1)
    rows = await messagesFor(p.id)
    expect(rows[0]).toMatchObject({ status: 'SENT', provider: 'TEST' })
    const log = (await admin.get(`/api/v1/core/messages?studentId=${p.id}`)).body
    expect(log.data).toHaveLength(2)
    expect(log.meta.last7Days.SENT).toBeGreaterThanOrEqual(1)
  })

  it('use the institution’s wording; unknown placeholders are refused', async () => {
    const bad = await admin.put('/api/v1/core/notification-rules/appointments.booked').send({ channels: { SMS: { enabled: true, body: 'Hi {{patient.nickname}}' } } })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields['SMS.body']).toMatch(/nickname/)
    await admin.put('/api/v1/core/notification-rules/appointments.booked').send({ channels: { SMS: { enabled: true, body: 'See {{doctor.name}} on {{appt.date}} at {{appt.time}}. {{institution.name}}' }, WHATSAPP: { enabled: false } } }).expect(200)
    const p = await patient({ firstName: 'Meera' })
    await book(p, '09:30')
    const rows = await messagesFor(p.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toMatch(/^See Dr\. Message on \w{3}, \d{1,2} \w{3} at 9:30 AM\. Test Institution/)
    const rules = (await admin.get('/api/v1/core/notification-rules')).body.data.rules
    const booked = rules.find((r) => r.event === 'appointments.booked')
    expect(booked.customized).toMatchObject({ SMS: true, WHATSAPP: true, EMAIL: false })
    await admin.put('/api/v1/core/notification-rules/appointments.booked').send({ channels: { SMS: null, WHATSAPP: null } }).expect(200)
  })

  it('tell the patient when an appointment moves or is cancelled', async () => {
    const p = await patient({ firstName: 'Kiran' })
    const a = await book(p, '10:00')
    await admin.patch(`/api/v1/appointments/${a.id}/reschedule`).send({ date: addDaysYmd(today(), 2), time: '10:15' }).expect(200)
    await admin.post(`/api/v1/appointments/${a.id}/cancel`).send({ reason: 'Doctor on leave' }).expect(200)
    const sms = (await messagesFor(p.id)).filter((m) => m.channel === 'SMS').map((m) => m.event)
    expect(sms.sort()).toEqual(['appointments.booked', 'appointments.cancelled', 'appointments.rescheduled'])
  })

  it('keeps provider secrets hidden and sends a test message on demand', async () => {
    const res = await admin.put('/api/v1/core/messaging/WHATSAPP').send({ provider: 'META', meta: { phoneNumberId: '12345', token: 'secret-token' } }).expect(200)
    expect(res.body.data.WHATSAPP.meta).toEqual(expect.objectContaining({ phoneNumberId: '12345', tokenSet: true }))
    expect(JSON.stringify(res.body)).not.toContain('secret-token')
    // saving again without the token keeps it
    const again = await admin.put('/api/v1/core/messaging/WHATSAPP').send({ provider: 'META', meta: { phoneNumberId: '67890' } }).expect(200)
    expect(again.body.data.WHATSAPP.meta.tokenSet).toBe(true)
    await admin.put('/api/v1/core/messaging/WHATSAPP').send({ provider: 'TEST' }).expect(200)
    const sent = (await admin.post('/api/v1/core/messaging/SMS/test').send({ to: '98450 11223' })).body.data
    expect(sent).toMatchObject({ status: 'SENT', to: '919845011223', test: true })
    expect((await admin.post('/api/v1/core/messaging/SMS/test').send({ to: '12' })).status).toBe(400)
  })

  it('send through any HTTP gateway, and retry when it fails', async () => {
    const hits = []
    let fail = false
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        hits.push({ url: req.url, auth: req.headers['x-api-key'], body })
        res.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' }).end(fail ? 'down' : '{"request_id":"gw-1"}')
      })
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    await processOutbox() // send what earlier tests queued in test mode before switching the gateway
    const url = `http://127.0.0.1:${server.address().port}/send?to={{to}}`
    try {
      await admin.put('/api/v1/core/messaging/SMS').send({
        provider: 'HTTP',
        http: { method: 'POST', url, bodyType: 'JSON', body: '{"to":"{{to}}","text":"{{message}}","tpl":"{{templateId}}"}', headers: [{ name: 'X-Api-Key', value: '{{apiKey}}' }], apiKey: 'k-123' },
      }).expect(200)
      await admin.put('/api/v1/core/notification-rules/appointments.booked').send({ channels: { SMS: { enabled: true, body: 'Line one "quoted"\nLine two {{appt.no}}', templateId: '1207160000000' } } }).expect(200)
      const p = await patient({ firstName: 'Gateway' })
      await book(p, '10:30')
      await processOutbox()
      expect(hits).toHaveLength(1)
      expect(hits[0].url).toMatch(/^\/send\?to=91\d{10}$/)
      expect(hits[0].auth).toBe('k-123')
      expect(JSON.parse(hits[0].body)).toMatchObject({ text: expect.stringMatching(/^Line one "quoted"\nLine two AP/), tpl: '1207160000000' })
      let [sms] = (await messagesFor(p.id)).filter((m) => m.channel === 'SMS')
      expect(sms).toMatchObject({ status: 'SENT', providerRef: 'gw-1' })

      fail = true
      const q = await patient({ firstName: 'Retry' })
      await book(q, '10:45')
      await processOutbox()
      ;[sms] = (await messagesFor(q.id)).filter((m) => m.channel === 'SMS')
      expect(sms).toMatchObject({ status: 'QUEUED', attempts: 1, reason: expect.stringContaining('500') })
      expect(+new Date(sms.nextAttemptAt)).toBeGreaterThan(Date.now())
      // a failed message can be sent again by hand once the gateway is back
      await runAsTenant(h.tenant._id, () => MessageLog.updateOne({ _id: sms._id }, { $set: { status: 'FAILED' } }))
      fail = false
      await admin.post(`/api/v1/core/messages/${sms._id}/retry`).expect(200)
      await processOutbox()
      ;[sms] = (await messagesFor(q.id)).filter((m) => m.channel === 'SMS')
      expect(sms.status).toBe('SENT')
    } finally {
      server.close()
      await admin.put('/api/v1/core/notification-rules/appointments.booked').send({ channels: { SMS: null } })
      await admin.put('/api/v1/core/messaging/SMS').send({ provider: 'TEST' })
    }
  })

  it('setting up messages needs Notification rules', async () => {
    expect((await nurse.get('/api/v1/core/messaging')).status).toBe(403)
    expect((await cashier.put('/api/v1/core/messaging/SMS').send({ provider: 'TEST' })).status).toBe(403)
  })
})

// ───────────────────────────────────────────────────────── approvals

describe('discount approval', () => {
  let p
  let svc
  let requestId
  const bill = (pct, extra = {}) => ({ studentId: p.id, extras: [{ serviceId: svc.id }], discount: { type: 'PCT', value: pct, reason: 'Staff family' }, payments: [], ...extra })

  beforeAll(async () => {
    p = await patient({ firstName: 'Discount' })
    svc = await service('cbc')
  })

  it('a cashier without discount rights is told to ask for approval', async () => {
    const res = await cashier.post('/api/v1/billing/bills').send(bill(15))
    expect(res.status).toBe(403)
    expect(res.body.details).toEqual({ approval: 'billing.discount' })
  })

  it('the request reaches people who can approve it — not the requester or other cashiers', async () => {
    const { payments, ...payload } = bill(15)
    const res = await cashier.post('/api/v1/core/approvals').send({ type: 'billing.discount', payload, reason: 'Daughter of our attendant' })
    expect(res.status).toBe(201)
    requestId = res.body.data.id
    expect(res.body.data).toMatchObject({ status: 'PENDING', value: 15, title: expect.stringContaining('15% discount for Discount Rao') })
    expect(res.body.data.approvers.map((a) => a.name).sort()).toEqual(expect.arrayContaining(['Admin 1', 'BILLING_MANAGER mgr']))
    expect(res.body.data.approvers.map((a) => a.name)).not.toContain('CASHIER cash2')

    const waiting = (await manager.get('/api/v1/core/approvals?box=waiting')).body.data
    expect(waiting.map((r) => r.id)).toContain(requestId)
    const bell = (await manager.get('/api/v1/core/notifications')).body.data
    expect(bell.approvalsWaiting).toBe(1)
    expect(bell.items[0]).toMatchObject({ title: expect.stringContaining('Approval needed'), link: `/approvals?id=${requestId}` })
    expect((await cashier2.get('/api/v1/core/approvals?box=waiting')).body.data).toHaveLength(0)
    expect((await cashier.post(`/api/v1/core/approvals/${requestId}/approve`).send({})).status).toBe(403)
    expect((await cashier2.post(`/api/v1/core/approvals/${requestId}/approve`).send({})).status).toBe(403)
    // until approved, the bill still can't be saved
    expect((await cashier.post('/api/v1/billing/bills').send(bill(15, { approvalId: requestId }))).status).toBe(409)
  })

  it('once approved, the cashier saves the bill with that discount, once', async () => {
    const decided = (await manager.post(`/api/v1/core/approvals/${requestId}/approve`).send({ note: 'OK' })).body.data
    expect(decided.status).toBe('APPROVED')
    const told = (await cashier.get('/api/v1/core/notifications')).body.data.items[0]
    expect(told.title).toMatch(/^Approved/)
    expect((await cashier.post('/api/v1/billing/bills').send(bill(20, { approvalId: requestId }))).status).toBe(409) // more than approved
    expect((await cashier2.post('/api/v1/billing/bills').send(bill(15, { approvalId: requestId }))).status).toBe(403) // someone else's
    const saved = await cashier.post('/api/v1/billing/bills').send(bill(15, { approvalId: requestId }))
    expect(saved.status).toBe(201)
    expect(saved.body.data.discountApproval).toMatchObject({ approvedBy: 'BILLING_MANAGER mgr' })
    expect(saved.body.data.totals.discount).toBeGreaterThan(0)
    const used = (await cashier.get(`/api/v1/core/approvals/${requestId}`)).body.data
    expect(used).toMatchObject({ status: 'USED', usedRef: saved.body.data.invoiceNo })
    expect((await cashier.post('/api/v1/billing/bills').send(bill(15, { approvalId: requestId }))).status).toBe(409)
  })

  it('a manager can only approve within their own limit; rejecting needs a reason', async () => {
    const { payments, ...payload } = bill(30)
    const r = (await cashier.post('/api/v1/core/approvals').send({ type: 'billing.discount', payload })).body.data
    expect(r.approvers.map((a) => a.name)).toEqual(['Admin 1'])
    expect((await manager.get('/api/v1/core/approvals?box=waiting')).body.data.map((x) => x.id)).not.toContain(r.id)
    expect((await manager.post(`/api/v1/core/approvals/${r.id}/approve`).send({})).status).toBe(403)
    expect((await admin.post(`/api/v1/core/approvals/${r.id}/reject`).send({})).status).toBe(400)
    const rejected = (await admin.post(`/api/v1/core/approvals/${r.id}/reject`).send({ note: 'Too high' })).body.data
    expect(rejected.status).toBe('REJECTED')
    expect((await cashier.get('/api/v1/core/notifications')).body.data.items[0]).toMatchObject({ title: expect.stringMatching(/^Rejected/), message: expect.stringContaining('Too high') })
  })

  it('asking again replaces your earlier request; a waiting request can be withdrawn', async () => {
    const { payments, ...payload } = bill(10)
    const first = (await cashier.post('/api/v1/core/approvals').send({ type: 'billing.discount', payload })).body.data
    const second = (await cashier.post('/api/v1/core/approvals').send({ type: 'billing.discount', payload: { ...payload, discount: { ...payload.discount, value: 12 } } })).body.data
    expect((await cashier.get(`/api/v1/core/approvals/${first.id}`)).body.data.status).toBe('WITHDRAWN')
    expect((await manager.post(`/api/v1/core/approvals/${second.id}/withdraw`)).status).toBe(409)
    expect((await cashier.post(`/api/v1/core/approvals/${second.id}/withdraw`)).body.data.status).toBe('WITHDRAWN')
  })

  it('an institution can add a second step above a value, for chosen roles', async () => {
    const adminRole = (await admin.get('/api/v1/core/roles')).body.data.find((r) => r.system)
    const cashierRole = (await admin.get('/api/v1/core/roles')).body.data.find((r) => r.templateCode === 'CASHIER')
    const rule = (steps) => ({ enabled: true, expiryHours: 4, steps })
    const bad = await admin.put('/api/v1/core/approval-rules/billing.discount').send(rule([{ label: 'Manager', roleIds: [] }, { label: 'Cashier', roleIds: [cashierRole.id], minValue: 10 }]))
    expect(bad.status).toBe(400)
    await admin.put('/api/v1/core/approval-rules/billing.discount').send(rule([{ label: 'Manager', roleIds: [] }, { label: 'Administrator', roleIds: [adminRole.id], minValue: 10 }])).expect(200)

    const { payments, ...payload } = bill(15)
    const r = (await cashier.post('/api/v1/core/approvals').send({ type: 'billing.discount', payload })).body.data
    expect(r.steps.map((s) => s.label)).toEqual(['Manager', 'Administrator'])
    const step1 = (await manager.post(`/api/v1/core/approvals/${r.id}/approve`).send({})).body.data
    expect(step1).toMatchObject({ status: 'PENDING', currentStep: 1 })
    expect((await manager.post(`/api/v1/core/approvals/${r.id}/approve`).send({})).status).toBe(403)
    expect((await admin.post(`/api/v1/core/approvals/${r.id}/approve`).send({})).body.data.status).toBe('APPROVED')
    // small discounts still need one step only
    const small = (await cashier.post('/api/v1/core/approvals').send({ type: 'billing.discount', payload: { ...payload, discount: { ...payload.discount, value: 5 } } })).body.data
    expect(small.steps).toHaveLength(1)
    await admin.put('/api/v1/core/approval-rules/billing.discount').send(rule([{ label: 'Approval', roleIds: [] }])).expect(200)
  })
})

describe('bill cancellation approval', () => {
  it('a cashier asks to cancel a bill they can’t; approving cancels it and refunds at the cashier’s counter', async () => {
    const p = await patient({ firstName: 'Cancel' })
    const svc = await service('cbc')
    const b = (await manager.post('/api/v1/billing/bills').send({ studentId: p.id, extras: [{ serviceId: svc.id }], payments: [{ mode: 'CASH', amount: 35000 }] })).body.data
    // the cashier role has no cancel action at all; a counter role that may cancel its own
    // same-day bills is pointed to approval for anyone else's
    expect((await cashier.post(`/api/v1/billing/bills/${b.id}/cancel`).send({ reason: 'Wrong patient' })).status).toBe(403)
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Counter lead', permissions: ['billing.opd-bill.view', 'billing.opd-bill.create', 'billing.opd-bill.cancel', 'billing.invoices.view'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Counter lead', email: 'lead@e.test', roleIds: [role.id], password: 'Staff@123' })
    const lead = await signIn(app, 'lead@e.test', 'Staff@123')
    const denied = await lead.post(`/api/v1/billing/bills/${b.id}/cancel`).send({ reason: 'Wrong patient' })
    expect(denied.status).toBe(403)
    expect(denied.body.details).toEqual({ approval: 'billing.cancel' })

    const r = (await cashier.post('/api/v1/core/approvals').send({ type: 'billing.cancel', payload: { invoiceId: b.id, reason: 'Wrong patient' } })).body.data
    expect(r).toMatchObject({ value: 35000, summary: expect.stringContaining('Refund ₹350') })
    expect((await cashier2.post('/api/v1/core/approvals').send({ type: 'billing.cancel', payload: { invoiceId: b.id, reason: 'Twice' } })).status).toBe(409)

    const done = (await manager.post(`/api/v1/core/approvals/${r.id}/approve`).send({})).body.data
    expect(done).toMatchObject({ status: 'USED', result: { invoiceNo: b.invoiceNo, refunded: 35000 } })
    const after = (await manager.get(`/api/v1/billing/bills/${b.id}`)).body.data
    expect(after.status).toBe('CANCELLED')
    expect(after.cancelled).toMatchObject({ by: 'BILLING_MANAGER mgr', reason: 'Wrong patient (asked by CASHIER cash1)' })
    const refund = after.payments.find((x) => x.kind === 'REFUND')
    expect(refund).toMatchObject({ amount: -35000, cashierName: 'CASHIER cash1' })
  })
})

// ───────────────────────────────────────────────────────── files & comments

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const upload = (agent, query, buf = PDF, name = 'Old report.pdf', type = 'application/pdf') =>
  agent.post(`/api/v1/files?${new URLSearchParams(query)}`).set('Content-Type', type).set('X-File-Name', encodeURIComponent(name)).send(buf)

describe('attachments', () => {
  let p
  let fileId
  beforeAll(async () => { p = await patient({ firstName: 'Files' }) })

  it('stores a file on the patient, checks what it really is, and logs who opened it', async () => {
    const res = await upload(admin, { entityType: 'patient', entityId: p.id, category: 'OUTSIDE_REPORT' })
    expect(res.status).toBe(201)
    fileId = res.body.data.id
    expect(res.body.data).toMatchObject({ fileName: 'Old report.pdf', contentType: 'application/pdf', categoryLabel: 'Outside report', size: PDF.length })
    const fake = await upload(admin, { entityType: 'patient', entityId: p.id }, Buffer.from('<html><script>alert(1)</script></html>'), 'scan.pdf')
    expect(fake.status).toBe(400)
    const content = await admin.get(`/api/v1/files/${fileId}/content`).buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))) })
    expect(content.status).toBe(200)
    expect(content.headers['content-type']).toBe('application/pdf')
    expect(content.headers['content-security-policy']).toContain('sandbox')
    expect(Buffer.compare(content.body, PDF)).toBe(0)
    const activity = (await admin.get(`/api/v1/core/audit/entity/${fileId}`)).body.data
    expect(activity.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'VIEW']))
  })

  it('lists files for the patient, counts them against the plan’s storage, and hides removed ones', async () => {
    const list = (await admin.get(`/api/v1/files?studentId=${p.id}`)).body.data
    expect(list.map((f) => f.id)).toContain(fileId)
    const usage = (await admin.get('/api/v1/core/subscription')).body.data.usage
    expect(usage.storageGb).toBeGreaterThanOrEqual(0)
    expect((await admin.delete(`/api/v1/files/${fileId}`).send({})).status).toBe(400)
    await admin.delete(`/api/v1/files/${fileId}`).send({ reason: 'Wrong patient' }).expect(200)
    expect((await admin.get(`/api/v1/files?studentId=${p.id}`)).body.data).toHaveLength(0)
    expect((await admin.get(`/api/v1/files?studentId=${p.id}&includeDeleted=1`)).body.data[0].deleted).toMatchObject({ reason: 'Wrong patient' })
    expect((await admin.get(`/api/v1/files/${fileId}/content`)).status).toBe(404)
  })

  it('follows the record’s access, and never crosses institutions', async () => {
    const res = await upload(admin, { entityType: 'patient', entityId: p.id, category: 'ID_PROOF' }, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]), 'aadhaar.jpg', 'image/jpeg')
    expect(res.status).toBe(201)
    expect((await nurse.get(`/api/v1/files?studentId=${p.id}`)).status).toBe(200)
    expect((await vitalsOnly.get(`/api/v1/files?studentId=${p.id}`)).status).toBe(403)
    const other = await newInstitution('STARTER')
    const otherAdmin = await signIn(app, other.email, other.password)
    expect((await otherAdmin.get(`/api/v1/files/${res.body.data.id}/content`)).status).toBe(404)
    expect((await otherAdmin.get(`/api/v1/files?studentId=${p.id}`)).status).toBe(404)
  })
})

describe('discussion', () => {
  it('comments and replies on a bill; only the author edits, others cannot', async () => {
    const p = await patient({ firstName: 'Talk' })
    const svc = await service('cbc')
    const b = (await manager.post('/api/v1/billing/bills').send({ studentId: p.id, extras: [{ serviceId: svc.id }], payments: [] })).body.data
    const c = (await manager.post('/api/v1/comments').send({ entityType: 'invoice', entityId: b.id, body: 'Patient will pay tomorrow.' })).body.data
    const reply = (await cashier.post('/api/v1/comments').send({ entityType: 'invoice', entityId: b.id, body: 'Noted.', parentId: c.id })).body.data
    expect(reply.parentId).toBe(c.id)
    expect((await cashier.patch(`/api/v1/comments/${c.id}`).send({ body: 'Changed' })).status).toBe(403)
    expect((await manager.patch(`/api/v1/comments/${c.id}`).send({ body: 'Patient will pay on Friday.' })).body.data).toMatchObject({ edited: true })
    const thread = (await cashier.get(`/api/v1/comments?entityType=invoice&entityId=${b.id}`)).body.data
    expect(thread.map((x) => x.body)).toEqual(['Patient will pay on Friday.', 'Noted.'])
    await manager.delete(`/api/v1/comments/${c.id}`).expect(200)
    expect((await cashier.get(`/api/v1/comments?entityType=invoice&entityId=${b.id}`)).body.data).toHaveLength(0)
    expect((await nurse.get(`/api/v1/comments?entityType=invoice&entityId=${b.id}`)).status).toBe(403)
  })
})
