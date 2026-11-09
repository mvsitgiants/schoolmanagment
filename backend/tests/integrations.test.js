import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { StaffAttendance } from '../src/models/hrms.js'
import { AttendanceSheet } from '../src/models/attendance.js'
import { DevicePunch, IntegrationLog } from '../src/models/integrations.js'
import { Vehicle } from '../src/models/transport.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let today
let yesterday
const api = '/api/v1/integrations'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  today = await asTenant(async () => (await institutionNow()).date)
  yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)
}, 300_000)
afterAll(stopDb)

describe('module gate', () => {
  it('is not there on a plan without integrations', async () => {
    const s = await newInstitution('STARTER')
    const a = await signIn(app, s.email, s.password)
    expect((await a.get(`${api}/devices`)).status).toBe(404)
  }, 120_000)
})

describe('payment gateway', () => {
  it('shows the Razorpay setup with its webhook URL and no webhooks yet', async () => {
    const d = (await admin.get(`${api}/payments`).expect(200)).body.data
    expect(d.config.provider).toBe('RAZORPAY')
    expect(d.webhookUrl).toMatch(/\/api\/v1\/hooks\/razorpay\/[A-Za-z0-9_-]{16,40}$/)
    expect(d.webhooks).toEqual([])
  })

  it('saves keys write-only (last 4 only) and checks the key against the mode', async () => {
    await admin.put(`${api}/payments`).send({ mode: 'LIVE', settings: { keyId: 'rzp_test_abcdef123' } }).expect(400)
    const cfg = (await admin.put(`${api}/payments`).send({ mode: 'SANDBOX', settings: { keyId: 'rzp_test_abcdef123' }, secrets: { keySecret: 'sekret-value-9876', webhookSecret: 'whsec-4321' } }).expect(200)).body.data
    expect(cfg.secrets.keySecret).toEqual({ set: true, last4: '9876' })
    const again = JSON.stringify((await admin.get(`${api}/payments`)).body)
    expect(again).not.toContain('sekret-value')
  })

  it('lists the webhooks Razorpay sent (a refused one too)', async () => {
    const { webhookUrl } = (await admin.get(`${api}/payments`)).body.data
    const path = new URL(webhookUrl).pathname
    await request(app).post(path).set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'bad').send('{"event":"payment.captured"}').expect(400)
    const body = '{"event":"payment.failed","payload":{}}'
    const sig = createHmac('sha256', 'whsec-4321').update(body).digest('hex')
    await request(app).post(path).set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', 'evt_1').send(body).expect(200)
    const d = (await admin.get(`${api}/payments`)).body.data
    expect(d.webhooks.map((w) => w.status).sort()).toEqual(['OK', 'REJECTED'])
    expect(d.last24h.REJECTED).toBe(1)
  })
})

describe('SMS & WhatsApp', () => {
  let urls
  it('makes the delivery-report addresses on request', async () => {
    const v = (await admin.get(`${api}/messaging`).expect(200)).body.data
    expect(v.urls).toBeNull()
    urls = (await admin.post(`${api}/messaging/urls`).expect(200)).body.data
    expect(urls.msg91).toMatch(/\/api\/v1\/hooks\/msg91\//)
    expect(new URL((await admin.get(`${api}/messaging`)).body.data.urls.msg91).pathname).toBe(new URL(urls.msg91).pathname)
  })

  it('takes MSG91 delivery reports onto the message', async () => {
    const msg = await asTenant(() => MessageLog.create({ channel: 'SMS', to: '919845000001', body: 'Hello', status: 'SENT', provider: 'MSG91', providerRef: 'req-123' }))
    await request(app).post(new URL(urls.msg91).pathname).set('Content-Type', 'application/json').send([{ requestId: 'req-123', report: [{ number: '919845000001', status: '1', date: new Date().toISOString() }] }]).expect(200)
    const after = await asTenant(() => MessageLog.findById(msg._id).lean())
    expect(after.delivery.status).toBe('DELIVERED')
    const sends = (await admin.get(`${api}/messaging/sends`).expect(200)).body.data
    expect(sends.find((s) => s.id === String(msg._id)).delivery.status).toBe('DELIVERED')
  })

  it('checks WhatsApp webhooks against the Meta secrets', async () => {
    await admin.put(`${api}/messaging/webhook`).send({ secrets: { metaAppSecret: 'meta-app-secret', metaVerifyToken: 'verify-me-please' } }).expect(200)
    const path = new URL(urls.whatsapp).pathname
    expect((await request(app).get(`${path}?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=42`).expect(200)).text).toBe('42')
    await request(app).get(`${path}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`).expect(403)
    const msg = await asTenant(() => MessageLog.create({ channel: 'WHATSAPP', to: '919845000002', body: 'Hi', status: 'SENT', provider: 'META', providerRef: 'wamid.1' }))
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })
    await request(app).post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=00').send(body).expect(401)
    const sig = createHmac('sha256', 'meta-app-secret').update(body).digest('hex')
    await request(app).post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', `sha256=${sig}`).send(body).expect(200)
    expect((await asTenant(() => MessageLog.findById(msg._id).lean())).delivery.status).toBe('READ')
  })

  it('lists the template each family message uses', async () => {
    const rows = (await admin.get(`${api}/messaging/templates`).expect(200)).body.data
    expect(rows.find((r) => r.event === 'attendance.absent')).toBeTruthy()
  })

  it('the connection test needs MSG91 to be the SMS provider', async () => {
    await asTenant(() => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
    expect((await admin.post(`${api}/messaging/test/SMS`)).status).toBe(409)
  })
})

describe('devices', () => {
  let staffDevice
  let staffKey
  let teacher
  const push = (key, body) => request(app).post(`/api/v1/hooks/devices/${key}`).set('Content-Type', 'application/json').send(body)

  it('registers a biometric device and shows its key once', async () => {
    teacher = (await admin.post('/api/v1/hrms/employees').send({ name: 'Meera Teacher', category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2020-06-01', gender: 'FEMALE' }).expect(201)).body.data
    expect(teacher.employeeCode).toBeTruthy()
    const r = (await admin.post(`${api}/devices`).send({ name: 'Staff room biometric', kind: 'BIOMETRIC', usedFor: 'STAFF', location: 'Staff room', serialNo: 'ZK-001' }).expect(201)).body.data
    staffDevice = r.device
    staffKey = r.key
    expect(staffKey).toMatch(/^sgd_[a-f0-9]{12}_[A-Za-z0-9_-]{32}$/)
    expect(staffDevice.status).toBe('NEVER')
    expect(JSON.stringify((await admin.get(`${api}/devices`)).body)).not.toContain(staffKey.split('_').pop())
    await admin.post(`${api}/devices`).send({ name: 'Staff room biometric', kind: 'BIOMETRIC' }).expect(409)
  })

  it('refuses an unknown key', async () => {
    await push('sgd_000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { code: 'X' }).expect(401)
    await push('not-a-key', { code: 'X' }).expect(401)
  })

  it('turns punches into staff attendance: first in, last out', async () => {
    const r = (await push(staffKey, { punches: [
      { code: teacher.employeeCode, at: `${yesterday}T08:55:00+05:30`, direction: 'IN' },
      { code: teacher.employeeCode.toLowerCase(), at: `${yesterday} 13:00`, direction: 'IN' },
      { code: teacher.employeeCode, at: `${yesterday}T17:10:00+05:30`, direction: 'OUT' },
      { code: 'NOBODY', at: `${yesterday}T09:00:00+05:30` },
    ] }).expect(200)).body.data
    expect(r).toMatchObject({ received: 4, accepted: 3, rejected: 1 })
    const a = await asTenant(() => StaffAttendance.findOne({ employeeId: teacher.id, date: yesterday }).lean())
    expect(a).toMatchObject({ status: 'PRESENT', inTime: '08:55', outTime: '17:10', source: 'IMPORT' })
    // re-sending adds nothing; a later OUT moves the out time
    const again = (await push(staffKey, [{ code: teacher.employeeCode, at: `${yesterday}T08:55:00+05:30`, direction: 'IN' }, { code: teacher.employeeCode, at: `${yesterday}T18:05:00+05:30`, direction: 'OUT' }]).expect(200)).body.data
    expect(again).toMatchObject({ accepted: 1, duplicates: 1 })
    expect((await asTenant(() => StaffAttendance.findOne({ employeeId: teacher.id, date: yesterday }).lean())).outTime).toBe('18:05')
  })

  it('refuses times in the future and bodies it can’t read', async () => {
    const r = (await push(staffKey, { code: teacher.employeeCode, at: new Date(Date.now() + 3600_000).toISOString() }).expect(200)).body.data
    expect(r.accepted).toBe(0)
    expect(r.errors[0].message).toMatch(/future/)
    await request(app).post(`/api/v1/hooks/devices/${staffKey}`).set('Content-Type', 'text/plain').send('not json').expect(400)
  })

  it('shows last seen, punches and errors; logs every push', async () => {
    const d = (await admin.get(`${api}/devices/${staffDevice.id}`).expect(200)).body.data
    expect(d.lastSeenAt).toBeTruthy()
    expect(d.counts.accepted).toBe(4)
    const punches = (await admin.get(`${api}/devices/punches?date=${yesterday}`).expect(200)).body
    expect(punches.meta.byOutcome.ATTENDANCE).toBe(4)
    expect(punches.meta.byOutcome.UNKNOWN).toBe(1)
    const logs = (await admin.get(`${api}/logs?provider=DEVICE`).expect(200)).body.data
    expect(logs.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(logs)).not.toContain(staffKey)
  })

  it('a test punch goes the whole way without touching attendance', async () => {
    const r = (await admin.post(`${api}/devices/${staffDevice.id}/test`).send({ code: teacher.employeeCode }).expect(200)).body.data
    expect(r.accepted).toBe(1)
    expect(r.results[0]).toMatchObject({ outcome: 'TEST', name: 'Meera Teacher' })
    expect(await asTenant(() => StaffAttendance.exists({ employeeId: teacher.id, date: today }))).toBeNull()
    const bad = (await admin.post(`${api}/devices/${staffDevice.id}/test`).send({ code: 'NOPE' }).expect(200)).body.data
    expect(bad.accepted).toBe(0)
  })

  it('a new key retires the old one; a switched-off device is refused', async () => {
    const { key } = (await admin.post(`${api}/devices/${staffDevice.id}/rotate-key`).expect(200)).body.data
    await push(staffKey, []).expect(401)
    await push(key, []).expect(200)
    await admin.patch(`${api}/devices/${staffDevice.id}`).send({ active: false }).expect(200)
    await push(key, []).expect(401)
    staffKey = key
  })

  describe('students at the gate', () => {
    let sec
    let asha
    let ravi
    let gate
    beforeAll(async () => {
      await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1, addSubjects: false }).expect(201)
      sec = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
      const add = async (firstName, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: sec.id, guardians: [{ name: `Parent ${firstName}`, mobile }] }).expect(201)).body.data
      asha = await add('Asha', '9845000701')
      ravi = await add('Ravi', '9845000702')
      await admin.patch('/api/v1/core/settings/modules/attendance').send({ mode: 'DAILY', markBefore: '23:59' }).expect(200)
      gate = (await admin.post(`${api}/devices`).send({ name: 'Main gate', kind: 'RFID', usedFor: 'STUDENTS', autoMarkAttendance: true }).expect(201)).body
    }, 120_000)

    it('logs the card at the gate; doesn’t start a register', async () => {
      const r = (await push(gate.data.key, { code: asha.admissionNo, direction: 'IN' }).expect(200)).body.data
      expect(r.accepted).toBe(1)
      const p = await asTenant(() => DevicePunch.findOne({ personId: asha.id }).lean())
      expect(p).toMatchObject({ outcome: 'GATE', personType: 'STUDENT', date: today })
      expect(p.note).toMatch(/not taken yet/)
      expect(await asTenant(() => AttendanceSheet.exists({ sectionId: sec.id, date: today }))).toBeNull()
    })

    it('marks an absent child present on their first IN before the mark-by time', async () => {
      await admin.put('/api/v1/attendance/sheet').send({ sectionId: sec.id, date: today, entries: [{ studentId: asha.id, status: 'P' }, { studentId: ravi.id, status: 'A' }] }).expect(200)
      const r = (await push(gate.data.key, { punches: [{ code: ravi.admissionNo, direction: 'IN' }] }).expect(200)).body.data
      expect(r.accepted).toBe(1)
      const sheet = await asTenant(() => AttendanceSheet.findOne({ sectionId: sec.id, date: today, period: 0 }).lean())
      expect(sheet.entries.find((e) => String(e.studentId) === ravi.id).status).toBe('P')
      expect(sheet.counts.A).toBe(0)
      expect((await asTenant(() => DevicePunch.findOne({ personId: ravi.id }).lean())).outcome).toBe('MARKED_PRESENT')
    })

    it('doesn’t mark when the device isn’t allowed to', async () => {
      await admin.patch(`${api}/devices/${gate.data.device.id}`).send({ autoMarkAttendance: false }).expect(200)
      await admin.put('/api/v1/attendance/sheet').send({ sectionId: sec.id, date: today, entries: [{ studentId: asha.id, status: 'A' }, { studentId: ravi.id, status: 'P' }] }).expect(200)
      await push(gate.data.key, { code: asha.admissionNo, direction: 'OUT' }).expect(200)
      const sheet = await asTenant(() => AttendanceSheet.findOne({ sectionId: sec.id, date: today, period: 0 }).lean())
      expect(sheet.entries.find((e) => String(e.studentId) === asha.id).status).toBe('A')
    })

    it('lists devices with punches today', async () => {
      const { devices } = (await admin.get(`${api}/devices`).expect(200)).body.data
      expect(devices.find((d) => d.name === 'Main gate').punchesToday).toBe(3)
    })
  })

  it('a GPS device moves its bus', async () => {
    const v = (await admin.post('/api/v1/transport/vehicles').send({ regNo: 'KA01GP0001', gpsDeviceId: 'IMEI-1' }).expect(201)).body.data
    await admin.post(`${api}/devices`).send({ name: 'Bus 1 tracker', kind: 'GPS' }).expect(400)
    const { key } = (await admin.post(`${api}/devices`).send({ name: 'Bus 1 tracker', kind: 'GPS', vehicleId: v.id }).expect(201)).body.data
    const r = (await push(key, { positions: [{ lat: 12.97, lng: 77.59, speed: 20 }] }).expect(200)).body.data
    expect(r.accepted).toBe(1)
    expect((await asTenant(() => Vehicle.findById(v.id).lean())).lastPosition.lat).toBe(12.97)
    const { trackers } = (await admin.get(`${api}/devices`)).body.data
    expect(trackers.find((x) => x.regNo === 'KA01GP0001').status).toBe('OK')
  })

  it('removes a device', async () => {
    await admin.delete(`${api}/devices/${staffDevice.id}`).expect(200)
    await push(staffKey, []).expect(401)
  })
})

describe('integration logs', () => {
  it('filters, shows one entry, and gives health per provider', async () => {
    const list = (await admin.get(`${api}/logs?status=REJECTED`).expect(200)).body
    expect(list.data.every((r) => r.status === 'REJECTED')).toBe(true)
    const one = (await admin.get(`${api}/logs/${list.data[0].id}`).expect(200)).body.data
    expect(one.retry).toBeNull()
    const health = (await admin.get(`${api}/logs/health`).expect(200)).body.data
    const dev = health.providers.find((p) => p.provider === 'DEVICE')
    expect(dev.calls).toBeGreaterThan(3)
    expect(dev.failures).toBeGreaterThan(0)
    expect(dev.lastError).toBeTruthy()
    expect(health.providers.find((p) => p.provider === 'RAZORPAY').calls).toBe(2)
  })

  it('only safe failed calls can be tried again', async () => {
    const list = (await admin.get(`${api}/logs?provider=DEVICE`)).body.data
    expect((await admin.post(`${api}/logs/${list[0].id}/retry`)).status).toBe(409)
    const row = await asTenant(() => IntegrationLog.create({ provider: 'RAZORPAY', direction: 'OUT', operation: 'test_connection', status: 'ERROR', error: 'boom' }))
    const r = (await admin.get(`${api}/logs/${row._id}`)).body.data
    expect(r.retry).toBe('TEST')
  })
})
