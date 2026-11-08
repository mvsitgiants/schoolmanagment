import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { distanceM, docState, etaMinutes, stopProgress, stopsFor } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { Trip } from '../src/models/transport.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let section
let asha
let ravi
const api = '/api/v1/transport'
// three stops ~1 km apart heading north, then the school
const STOPS = [
  { name: 'Lake View', lat: 12.9000, lng: 77.6000, pickupTime: '07:10', dropTime: '15:50', fee: 1200000 },
  { name: 'Market Road', lat: 12.9090, lng: 77.6000, pickupTime: '07:20', dropTime: '15:40', fee: 1000000 },
  { name: 'Temple Street', lat: 12.9180, lng: 77.6000, pickupTime: '07:30', dropTime: '15:30', fee: 800000 },
]

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  const add = async (firstName, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  asha = await add('Asha', '9845000601')
  ravi = await add('Ravi', '9845000602')
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
})
afterAll(stopDb)

describe('helpers', () => {
  it('measures, orders and checks progress', () => {
    expect(Math.round(distanceM(STOPS[0], STOPS[1]) / 10) * 10).toBe(1000)
    expect(stopsFor(STOPS.map((s, i) => ({ ...s, order: i + 1 })), 'DROP')[0].name).toBe('Temple Street')
    expect(etaMinutes(1000, 30)).toBe(3)
    const stops = STOPS.map((s, i) => ({ ...s, id: `s${i}` }))
    const r = stopProgress({ lat: 12.9001, lng: 77.6 }, stops, {}, { arriveM: 150, nearM: 1500 })
    expect(r.arrived).toEqual(['s0'])
    expect(r.near.map((n) => n.id)).toEqual(['s1'])
    expect(stopProgress({ lat: 12.9001, lng: 77.6 }, stops, { reached: ['s0'], alerted: ['s1'] }).near).toEqual([])
    expect(docState('2026-01-10', '2026-01-01', 30)).toBe('DUE')
    expect(docState('2025-12-31', '2026-01-01')).toBe('EXPIRED')
    expect(docState(null, '2026-01-01')).toBe('NONE')
  })
})

describe('a route with a bus', () => {
  let vehicle
  let route
  let trip
  it('adds a vehicle and flags its papers', async () => {
    const res = await admin.post(`${api}/vehicles`).send({
      regNo: 'ka01ab1234', capacity: 1, gpsDeviceId: '358000111222333',
      docs: [{ kind: 'INSURANCE', number: 'POL-1', expiry: '2020-01-01' }],
      driver: { name: 'Suresh', mobile: '9845000699', licenceExpiry: '2099-01-01' },
    }).expect(201)
    vehicle = res.body.data
    expect(vehicle.regNo).toBe('KA01AB1234')
    expect(vehicle.docs.find((d) => d.kind === 'INSURANCE').state).toBe('EXPIRED')
    expect(vehicle.docsState).toBe('EXPIRED')
    await admin.post(`${api}/vehicles`).send({ regNo: 'KA01AB1234' }).expect(400)
  })

  it('sets up a route with stops, keeping stop ids on edit', async () => {
    route = (await admin.post(`${api}/routes`).send({ name: 'Route 1 — Lake side', vehicleId: vehicle.id, stops: STOPS }).expect(201)).body.data
    expect(route.stops.map((s) => s.name)).toEqual(STOPS.map((s) => s.name))
    const edited = (await admin.patch(`${api}/routes/${route.id}`).send({ name: route.name, vehicleId: vehicle.id, stops: route.stops.map((s) => ({ ...s, landmark: s.name === 'Market Road' ? 'Near the bank' : s.landmark })) }).expect(200)).body.data
    expect(edited.stops.map((s) => s.id)).toEqual(route.stops.map((s) => s.id))
    route = edited
  })

  it('puts students on the route and warns when the bus is full', async () => {
    const first = (await admin.post(`${api}/assignments`).send({ studentId: asha.id, routeId: route.id, stopId: route.stops[1].id }).expect(201)).body.data
    expect(first.warning).toBeNull()
    const second = (await admin.post(`${api}/assignments`).send({ studentId: ravi.id, routeId: route.id, stopId: route.stops[2].id, mode: 'DROP' }).expect(201)).body.data
    expect(second.warning).toMatch(/2 students on a 1-seat/)
    const list = (await admin.get(`${api}/assignments`).query({ routeId: route.id })).body.data
    expect(list).toHaveLength(2)
    // moving Asha to another stop ends the first assignment
    await admin.post(`${api}/assignments`).send({ studentId: asha.id, routeId: route.id, stopId: route.stops[1].id }).expect(201)
    expect((await admin.get(`${api}/assignments`).query({ routeId: route.id })).body.data).toHaveLength(2)
    const csv = await admin.get(`${api}/assignments/export`).expect(200)
    expect(csv.text).toContain('Market Road')
  })

  it('will not drop a stop that has students, nor a route that has riders', async () => {
    await admin.patch(`${api}/routes/${route.id}`).send({ name: route.name, vehicleId: vehicle.id, stops: [route.stops[0]] }).expect(409)
    await admin.delete(`${api}/routes/${route.id}`).expect(409)
    await admin.delete(`${api}/vehicles/${vehicle.id}`).expect(409)
  })

  it('runs the pickup: near alert, stops reached, rides marked', async () => {
    trip = (await admin.post(`${api}/trips`).send({ routeId: route.id, kind: 'PICKUP' }).expect(200)).body.data
    expect(trip.status).toBe('RUNNING')
    // Ravi rides the drop only, so the pickup lists Asha alone
    expect(trip.stops.flatMap((s) => s.students).map((s) => s.name)).toEqual(['Asha'])
    // at Lake View: reached, and Market Road (1 km on) is near → Asha's family is told
    const p1 = (await admin.post(`${api}/trips/${trip.id}/position`).send({ lat: 12.9001, lng: 77.6, speed: 24 }).expect(200)).body.data
    expect(p1.reached).toEqual([route.stops[0].id])
    expect(p1.told).toEqual([route.stops[1].id])
    const near = await runAsTenant(h.tenant._id, () => MessageLog.find({ event: 'transport.near' }).lean())
    expect(near.length).toBeGreaterThan(0)
    expect(near.every((m) => String(m.studentId) === asha.id)).toBe(true)
    // the same position again tells no one twice
    const p2 = (await admin.post(`${api}/trips/${trip.id}/position`).send({ lat: 12.9002, lng: 77.6 }).expect(200)).body.data
    expect(p2.told).toEqual([])
    const done = (await admin.post(`${api}/trips/${trip.id}/rides`).send({ studentId: asha.id, event: 'BOARDED' }).expect(200)).body.data
    expect(done.stops[1].students[0].events).toEqual(['BOARDED'])
    expect(await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'transport.ride' }))).toBeGreaterThan(0)
    const board = (await admin.get(`${api}/board`)).body.data
    expect(board.routes[0].trips.find((t) => t.kind === 'PICKUP').status).toBe('RUNNING')
  })

  it('takes positions from the GPS device webhook', async () => {
    const { url } = (await admin.get(`${api}/gps-hook`).expect(200)).body.data
    const path = new URL(url).pathname
    // OsmAnd style query: lat/lon, speed in knots
    const r = await request(app).get(path).query({ id: '358000111222333', lat: 12.9091, lon: 77.6, speed: 10 }).expect(200)
    expect(r.body.saved).toBe(1)
    const t = await runAsTenant(h.tenant._id, () => Trip.findById(trip.id).lean())
    expect(t.reached.map((x) => String(x.stopId))).toContain(route.stops[1].id)
    // JSON body, unknown device → nothing saved
    const j = await request(app).post(path).set('Content-Type', 'application/json').send({ deviceId: 'nope', lat: 12.9, lng: 77.6 }).expect(200)
    expect(j.body.saved).toBe(0)
    await request(app).get(path.replace(/[^/]+$/, 'x'.repeat(24))).query({ id: '1', lat: 1, lon: 1 }).expect(404)
  })

  it('shows the family their bus', async () => {
    const fam = (p) => `/api/v1/family/${h.tenant.slug}${p}`
    const agent = request.agent(app)
    const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000601' })).body.data
    await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
    const bus = (await agent.get(fam(`/students/${asha.id}/bus`)).expect(200)).body.data
    expect(bus).toMatchObject({ assigned: true, route: route.name, stop: { name: 'Market Road', pickupTime: '07:20' } })
    expect(bus.vehicle.regNo).toBe('KA01AB1234')
    expect(bus.trips.find((t) => t.kind === 'PICKUP')).toMatchObject({ status: 'RUNNING', reachedMyStop: true })
    expect(bus.live).toBeTruthy()
    await agent.get(fam(`/students/${ravi.id}/bus`)).expect(404)
  })

  it('ends the trip; a finished trip takes no more positions', async () => {
    await admin.post(`${api}/trips/${trip.id}/end`).expect(200)
    await admin.post(`${api}/trips/${trip.id}/position`).send({ lat: 12.918, lng: 77.6 }).expect(409)
    await admin.post(`${api}/trips`).send({ routeId: route.id, kind: 'PICKUP' }).expect(409)
  })

  it('takes a student off transport', async () => {
    const a = (await admin.get(`${api}/assignments`).query({ routeId: route.id })).body.data.find((x) => x.studentId === ravi.id)
    await admin.post(`${api}/assignments/${a.id}/end`).send({}).expect(200)
    expect((await admin.get(`${api}/assignments`).query({ routeId: route.id })).body.data).toHaveLength(1)
  })
})
