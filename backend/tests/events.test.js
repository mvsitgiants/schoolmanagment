import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { addDaysYmd, buildIcs, monthGrid, ptmSlots } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { sendEventReminders } from '../src/services/events.js'
import { sendPtmReminders } from '../src/services/eventsPtm.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let t
let secA
let secB
let anu
let bala
let teacher
let teacherAgent
const api = '/api/v1/events'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
const fam = (p) => `/api/v1/family/${h.tenant.slug}${p}`
async function familyAgent(mobile) {
  const agent = request.agent(app)
  const sent = (await agent.post(fam('/otp')).send({ mobile })).body.data
  await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
  return agent
}
const count = (event) => asTenant(() => MessageLog.countDocuments({ event }))

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 2 }).expect(201)
  const cls = (await admin.get('/api/v1/academics/classes')).body.data.classes[0]
  ;[secA, secB] = cls.sections
  const add = async (firstName, sectionId, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId, guardians: [{ name: `Parent ${firstName}`, relation: 'FATHER', mobile, isPrimary: true }] })).body.data
  anu = await add('Anu', secA.id, '9845000801')
  bala = await add('Bala', secB.id, '9845000802')
  const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['CLASS_TEACHER'] })).body.data.created[0]
  teacher = (await admin.post('/api/v1/core/users').send({ name: 'Kavita Rao', email: 'kavita@school.test', roleIds: [tpl.id], password: 'Teach@123' })).body.data.user
  await admin.patch(`/api/v1/academics/sections/${secA.id}`).send({ classTeacherId: teacher.id }).expect(200)
  teacherAgent = await signIn(app, 'kavita@school.test', 'Teach@123')
  await asTenant(() => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
  t = (await asTenant(() => institutionNow())).date
})
afterAll(stopDb)

describe('helpers', () => {
  it('makes slots, month grids and calendar files', () => {
    expect(ptmSlots('09:00', '09:40', 10)).toEqual(['09:00', '09:10', '09:20', '09:30'])
    expect(ptmSlots('09:00', '09:40', 10, 5)).toEqual(['09:00', '09:15'])
    const g = monthGrid(2026, 11)
    expect(g[0]).toContain('2026-11-01')
    expect(g[0][0]).toBe('2026-10-26') // a Monday
    expect(g.every((w) => w.length === 7)).toBe(true)
    const ics = buildIcs([{ uid: 'a@x', title: 'Sports day, finals', startDate: '2026-12-05', endDate: '2026-12-06' }])
    expect(ics).toContain('SUMMARY:Sports day\\, finals')
    expect(ics).toContain('DTEND;VALUE=DATE:20261207')
  })
})

describe('the calendar', () => {
  let trip
  it('puts an event on the calendar, with holidays alongside', async () => {
    await admin.post('/api/v1/hrms/holidays').send({ date: addDaysYmd(t, 3), name: 'Founders’ Day', forStudents: true }).expect(201)
    trip = (await admin.post(`${api}/events`).send({
      title: 'Trip to the science centre', kind: 'TRIP', startDate: addDaysYmd(t, 10), startTime: '08:30', endTime: '15:00', venue: 'Visvesvaraya Museum',
      audience: 'SECTIONS', sectionIds: [secA.id], reply: { kind: 'CONSENT', question: 'May your child join the trip?', by: addDaysYmd(t, 7) },
    }).expect(201)).body.data
    expect(trip.published).toBe(false)
    expect(trip.replySummary).toMatchObject({ students: 1, waiting: 1 })
    await admin.post(`${api}/events`).send({ title: 'Staff meeting', kind: 'MEETING', startDate: addDaysYmd(t, 2), audience: 'STAFF' }).expect(201)
    await admin.post(`${api}/events`).send({ title: 'Bad', startDate: addDaysYmd(t, 2), endDate: addDaysYmd(t, 1) }).expect(400)
    await admin.post(`${api}/events`).send({ title: 'No classes', startDate: t, audience: 'CLASSES' }).expect(400)
    const cal = (await admin.get(`${api}/calendar`).query({ from: t, to: addDaysYmd(t, 30) }).expect(200)).body.data
    expect(cal.items.map((i) => i.source).sort()).toEqual(['EVENT', 'EVENT', 'HOLIDAY'])
  })

  it('publishes it, asking the families it is for to reply', async () => {
    const before = await count('events.reply')
    const pub = (await admin.post(`${api}/events/${trip.id}/publish`).send({ notify: true }).expect(200)).body.data
    expect(pub.told).toBe(1)
    expect(await count('events.reply')).toBeGreaterThan(before)
  })

  it('shows families their events (not staff ones), and takes their reply', async () => {
    const anuApp = await familyAgent('9845000801')
    const cal = (await anuApp.get(fam(`/students/${anu.id}/calendar`)).expect(200)).body.data
    expect(cal.items.map((i) => i.title).sort()).toEqual(['Founders’ Day', 'Trip to the science centre'])
    expect(cal.items.find((i) => i.source === 'EVENT').reply).toMatchObject({ kind: 'CONSENT', answer: null })
    await anuApp.put(fam(`/students/${anu.id}/events/${trip.id}/reply`)).send({ answer: 'YES', note: 'He is vegetarian' }).expect(200)
    const balaApp = await familyAgent('9845000802')
    const balaCal = (await balaApp.get(fam(`/students/${bala.id}/calendar`))).body.data
    expect(balaCal.items.map((i) => i.title)).toEqual(['Founders’ Day'])
    await balaApp.put(fam(`/students/${bala.id}/events/${trip.id}/reply`)).send({ answer: 'YES' }).expect(404)
    const r = (await admin.get(`${api}/events/${trip.id}/replies`)).body.data
    expect(r.rows).toEqual([expect.objectContaining({ name: 'Anu', answer: 'YES', note: 'He is vegetarian', by: 'Parent Anu' })])
    const csv = (await admin.get(`${api}/events/${trip.id}/replies/export`).expect(200)).text
    expect(csv).toContain('Permission given')
  })

  it('reminds families the day before, once', async () => {
    const e = (await admin.post(`${api}/events`).send({ title: 'Annual Day', kind: 'CULTURAL', startDate: addDaysYmd(t, 1), startTime: '17:00', endTime: '19:00', venue: 'Auditorium', remind: true }).expect(201)).body.data
    await admin.post(`${api}/events/${e.id}/publish`).send({}).expect(200)
    expect(await asTenant(() => sendEventReminders({ anyTime: true }))).toBe(2)
    expect(await asTenant(() => sendEventReminders({ anyTime: true }))).toBe(0)
    const ics = (await admin.get(`${api}/calendar.ics`).query({ from: t, to: addDaysYmd(t, 30) }).expect(200)).text
    expect(ics).toContain('SUMMARY:Annual Day')
    expect(ics).not.toContain('Staff meeting') // drafts stay out of the file
  })
})

describe('parent–teacher meetings', () => {
  let session
  it('sets up a meeting with the class teachers and opens booking', async () => {
    const hosts = (await admin.get(`${api}/ptm/class-teachers`).expect(200)).body.data
    expect(hosts).toEqual([expect.objectContaining({ userId: teacher.id, name: 'Kavita Rao', sectionIds: [secA.id] })])
    session = (await admin.post(`${api}/ptm`).send({ title: 'Term 1 PTM', date: addDaysYmd(t, 7), startTime: '10:00', endTime: '10:30', slotMinutes: 10, hosts }).expect(201)).body.data
    expect(session.slots).toEqual(['10:00', '10:10', '10:20'])
    const before = await count('events.ptm_open')
    const opened = (await admin.post(`${api}/ptm/${session.id}/open`).send({}).expect(200)).body.data
    expect(opened.told).toBe(1) // only Anu's section has a teacher to meet
    expect(await count('events.ptm_open')).toBe(before + 1)
  })

  it('lets the family book a free slot (one per teacher), and cancel it', async () => {
    const anuApp = await familyAgent('9845000801')
    const [m] = (await anuApp.get(fam(`/students/${anu.id}/meetings`)).expect(200)).body.data
    expect(m.teachers[0].free).toEqual(['10:00', '10:10', '10:20'])
    const after = (await anuApp.post(fam(`/students/${anu.id}/meetings/${session.id}/book`)).send({ hostId: m.teachers[0].id, time: '10:10' }).expect(200)).body.data
    expect(after[0].teachers[0].booking).toMatchObject({ time: '10:10', status: 'BOOKED' })
    await anuApp.post(fam(`/students/${anu.id}/meetings/${session.id}/book`)).send({ hostId: m.teachers[0].id, time: '10:20' }).expect(409)
    expect(await count('events.ptm_booked')).toBeGreaterThan(0)
    const grid = (await admin.get(`${api}/ptm/${session.id}`)).body.data.grid[0].slots
    expect(grid.find((s) => s.time === '10:10').booking).toMatchObject({ student: 'Anu', byFamily: true })
    // Bala's section has no teacher in this meeting
    await admin.post(`${api}/ptm/${session.id}/bookings`).send({ hostId: m.teachers[0].id, time: '10:00', studentId: bala.id }).expect(400)
    const cancelled = (await anuApp.delete(fam(`/students/${anu.id}/meetings/bookings/${after[0].teachers[0].booking.id}`)).expect(200)).body.data
    expect(cancelled[0].teachers[0].booking).toBeNull()
  })

  it('on the day, the teacher marks who came and notes the talk', async () => {
    const hosts = (await admin.get(`${api}/ptm/class-teachers`)).body.data
    const today = (await admin.post(`${api}/ptm`).send({ title: 'Open house', date: t, startTime: '11:00', endTime: '11:20', hosts }).expect(201)).body.data
    await admin.post(`${api}/ptm/${today.id}/status`).send({ status: 'CLOSED' }).expect(200)
    const b = (await admin.post(`${api}/ptm/${today.id}/bookings`).send({ hostId: today.hosts[0].id, time: '11:00', studentId: anu.id }).expect(201)).body.data
    const mine = (await teacherAgent.get(`${api}/ptm/mine`).expect(200)).body.data
    expect(mine.find((x) => x.id === today.id).slots[0].booking.student).toBe('Anu')
    const marked = (await teacherAgent.patch(`${api}/ptm/bookings/${b.id}`).send({ status: 'ATTENDED', remarks: 'Reading well; practise tables.' }).expect(200)).body.data
    expect(marked).toMatchObject({ status: 'ATTENDED', remarks: 'Reading well; practise tables.' })
  })

  it('reminds families of tomorrow’s slots', async () => {
    const hosts = (await admin.get(`${api}/ptm/class-teachers`)).body.data
    const s = (await admin.post(`${api}/ptm`).send({ title: 'Make-up PTM', date: addDaysYmd(t, 1), startTime: '09:00', endTime: '09:30', hosts }).expect(201)).body.data
    await admin.post(`${api}/ptm/${s.id}/open`).send({ notify: false }).expect(200)
    await admin.post(`${api}/ptm/${s.id}/bookings`).send({ hostId: s.hosts[0].id, time: '09:10', studentId: anu.id }).expect(201)
    expect(await asTenant(() => sendPtmReminders({ anyTime: true }))).toBe(1)
    expect(await asTenant(() => sendPtmReminders({ anyTime: true }))).toBe(0)
  })
})

describe('the gallery', () => {
  it('shows a published album with its photos to the families it is for', async () => {
    const album = (await admin.post(`${api}/albums`).send({ title: 'Annual Day 2026', date: t, audience: 'SECTIONS', sectionIds: [secA.id], published: true }).expect(201)).body.data
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
    const up = await admin.post('/api/v1/files').query({ entityType: 'gallery_album', entityId: album.id }).set('Content-Type', 'image/jpeg').set('X-File-Name', 'stage.jpg').send(jpeg).expect(201)
    const detail = (await admin.get(`${api}/albums/${album.id}`)).body.data
    expect(detail.photoList).toHaveLength(1)
    const anuApp = await familyAgent('9845000801')
    const albums = (await anuApp.get(fam(`/students/${anu.id}/albums`)).expect(200)).body.data
    expect(albums).toEqual([expect.objectContaining({ title: 'Annual Day 2026', photos: 1 })])
    const photo = await anuApp.get(fam(`/students/${anu.id}/albums/${album.id}/photos/${up.body.data.id}`)).expect(200)
    expect(photo.headers['content-type']).toContain('image/jpeg')
    const balaApp = await familyAgent('9845000802')
    expect((await balaApp.get(fam(`/students/${bala.id}/albums`))).body.data).toEqual([])
  })
})
