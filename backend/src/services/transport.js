import {
  RIDE_EVENTS, TRIP_KINDS, VEHICLE_DOCS, docState, distanceM, etaMinutes, formatINR, isLatLng, osmEmbed, osmLink, sectionLabel, stopProgress, stopsFor,
} from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { TransportAssignment, TransportRoute, Trip, Vehicle, VehiclePosition } from '../models/transport.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { getSettings } from '../platform/settings.js'
import { hhmmIn, institutionNow, timeZoneOf } from '../platform/time.js'
import { asHookOwner, hookUrl, logInbound } from './integrationsCommon.js'
import { need, studentFor } from './portal.js'

// Transport (module `transport`): vehicles and their papers, routes and stops, which student rides where, and the
// day's trips. A running trip takes positions from the driver's phone (POST /transport/trips/:id/position) or the
// bus's GPS device (the webhook /hooks/gps/:key); each is checked against the stops — families are told when the bus
// is near their stop, and the stops it reached are marked. The attendant marks who got on and off.

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

/** Campus scope: someone on one campus sees its routes and vehicles (and the ones on no campus). */
function siteFilter(auth) {
  if (!auth || scopeOf(auth, 'transport') === 'ALL' || !auth.user?.branchId) return {}
  return { branchId: { $in: [oid(auth.user.branchId), null] } }
}

async function studentLabels(ids) {
  const students = await Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo rollNo sectionId status guardians').lean()
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const sec = new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })]))
  return new Map(students.map((s) => {
    const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
    return [String(s._id), { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, className: sec.get(String(s.sectionId)) ?? '', status: s.status, guardian: g?.name ?? null, mobile: g?.mobile ?? null }]
  }))
}

// ───────────────────────────────────────────────────────── vehicles

const vehicleOut = (v, t, warnDays, routes = []) => {
  const docs = VEHICLE_DOCS.map((d) => {
    const row = (v.docs ?? []).find((x) => x.kind === d.value)
    return { kind: d.value, number: row?.number ?? null, expiry: row?.expiry ?? null, state: row ? docState(row.expiry, t, warnDays) : 'MISSING' }
  })
  const licence = v.driver?.licenceExpiry ? docState(v.driver.licenceExpiry, t, warnDays) : null
  const states = [...docs.map((d) => d.state), licence]
  const worst = states.includes('EXPIRED') ? 'EXPIRED' : states.includes('DUE') ? 'DUE' : states.includes('MISSING') ? 'MISSING' : 'VALID'
  return { ...clean(v), branchId: idStr(v.branchId), docs, licenceState: licence, docsState: worst, routes: routes.filter((r) => String(r.vehicleId) === String(v._id)).map((r) => ({ id: String(r._id), name: r.name })), map: osmLink(v.lastPosition) }
}

export async function listVehicles(auth) {
  const [rows, routes, t, { docWarnDays }] = await Promise.all([Vehicle.find(siteFilter(auth)).sort({ regNo: 1 }).lean(), TransportRoute.find({ active: true }).select('name vehicleId').lean(), today(), getSettings('transport')])
  return rows.map((v) => vehicleOut(v, t, docWarnDays ?? 30, routes))
}

export async function saveVehicle(id, input, auth, req) {
  if (await Vehicle.exists({ regNo: input.regNo.toUpperCase(), ...(id && { _id: { $ne: id } }) })) throw fieldsError({ regNo: 'Already added' })
  if (input.gpsDeviceId && await Vehicle.exists({ gpsDeviceId: input.gpsDeviceId, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ gpsDeviceId: 'Another vehicle has this device' })
  const v = id ? await Vehicle.findOne({ _id: id, ...siteFilter(auth) }) : new Vehicle({ branchId: auth.user?.branchId })
  if (!v) throw notFound('Vehicle')
  for (const k of ['regNo', 'type', 'capacity', 'make', 'docs', 'driver', 'attendant', 'status', 'notes']) if (input[k] !== undefined) v[k] = input[k]
  v.gpsDeviceId = input.gpsDeviceId || undefined
  await v.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'transport', entityType: 'vehicle', entityId: String(v._id), entityName: v.regNo, summary: `${id ? 'Changed' : 'Added'} vehicle ${v.regNo}` }, req)
  return (await listVehicles(auth)).find((x) => x.id === String(v._id))
}

export async function deleteVehicle(id, auth, req) {
  const v = isOid(id) ? await Vehicle.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!v) throw notFound('Vehicle')
  if (await TransportRoute.exists({ vehicleId: v._id, active: true })) throw conflict('A route uses this vehicle. Move the route to another vehicle first.')
  if (await Trip.exists({ vehicleId: v._id })) { v.status = 'OFF_ROAD'; await v.save() } else await Vehicle.deleteOne({ _id: v._id })
  await audit({ action: 'DELETE', module: 'transport', entityType: 'vehicle', entityId: String(v._id), entityName: v.regNo, summary: `Removed vehicle ${v.regNo}` }, req)
  return { deleted: true }
}

/** Staff logins a driver or attendant can be linked to (so the driver page shows their bus). */
export async function staffLogins() {
  const rows = await User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(1000).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

/** The address GPS trackers post to (one per institution; the key in it is the secret). */
export const gpsHook = async (baseUrl) => ({ url: await hookUrl('GPS', 'gps', baseUrl) })

// ───────────────────────────────────────────────────────── routes

const routeOut = (r, vehicles, counts) => {
  const v = vehicles.get(String(r.vehicleId))
  const riders = counts.filter((c) => String(c._id.r) === String(r._id))
  return {
    ...clean(r), vehicleId: idStr(r.vehicleId), branchId: idStr(r.branchId), vehicle: v ? { id: String(v._id), regNo: v.regNo, capacity: v.capacity, driver: v.driver?.name ?? null } : null,
    stops: stopsFor(r.stops, 'PICKUP').map((s) => ({ id: String(s._id), name: s.name, order: s.order, lat: s.lat ?? null, lng: s.lng ?? null, pickupTime: s.pickupTime ?? null, dropTime: s.dropTime ?? null, fee: s.fee ?? null, landmark: s.landmark ?? null, students: riders.find((c) => String(c._id.s) === String(s._id))?.n ?? 0 })),
    students: riders.reduce((n, c) => n + c.n, 0),
  }
}

export async function listRoutes(auth, { all = false } = {}) {
  const rows = await TransportRoute.find({ ...siteFilter(auth), ...(all ? {} : { active: true }) }).sort({ name: 1 }).lean()
  const [vehicles, counts] = await Promise.all([
    Vehicle.find({ _id: { $in: rows.map((r) => r.vehicleId).filter(Boolean) } }).lean(),
    TransportAssignment.aggregate([{ $match: { routeId: { $in: rows.map((r) => r._id) }, active: true } }, { $group: { _id: { r: '$routeId', s: '$stopId' }, n: { $sum: 1 } } }]),
  ])
  const vById = new Map(vehicles.map((v) => [String(v._id), v]))
  return rows.map((r) => routeOut(r, vById, counts))
}

export async function getRoute(id, auth) {
  const r = (await listRoutes(auth, { all: true })).find((x) => x.id === String(id))
  if (!r) throw notFound('Route')
  return r
}

export async function saveRoute(id, input, auth, req) {
  if (await TransportRoute.exists({ name: input.name, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: 'Another route has this name' })
  if (input.vehicleId && !await Vehicle.exists({ _id: input.vehicleId })) throw fieldsError({ vehicleId: 'Pick a vehicle' })
  const r = id ? await TransportRoute.findOne({ _id: id, ...siteFilter(auth) }) : new TransportRoute({ branchId: auth.user?.branchId })
  if (!r) throw notFound('Route')
  if (input.stops) {
    const keep = new Set(input.stops.map((s) => String(s.id)).filter(isOid))
    const dropped = r.stops.filter((s) => !keep.has(String(s._id))).map((s) => s._id)
    if (dropped.length && await TransportAssignment.exists({ routeId: r._id, stopId: { $in: dropped }, active: true })) throw conflict('Students are on a stop you removed. Move them to another stop first.')
    r.stops = input.stops.map((s, i) => ({ ...(isOid(s.id) && { _id: s.id }), name: s.name, order: i + 1, lat: s.lat ?? undefined, lng: s.lng ?? undefined, pickupTime: s.pickupTime || undefined, dropTime: s.dropTime || undefined, fee: s.fee ?? undefined, landmark: s.landmark || undefined }))
  }
  for (const k of ['name', 'code', 'active', 'notes']) if (input[k] !== undefined) r[k] = input[k]
  if (input.vehicleId !== undefined) r.vehicleId = input.vehicleId || undefined
  await r.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'transport', entityType: 'route', entityId: String(r._id), entityName: r.name, summary: `${id ? 'Changed' : 'Added'} route ${r.name} (${r.stops.length} stops)` }, req)
  return getRoute(String(r._id), auth)
}

export async function deleteRoute(id, auth, req) {
  const r = isOid(id) ? await TransportRoute.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!r) throw notFound('Route')
  if (await TransportAssignment.exists({ routeId: r._id, active: true })) throw conflict('Students ride this route. Move them first, or switch the route off.')
  if (await Trip.exists({ routeId: r._id })) { r.active = false; await r.save() } else await TransportRoute.deleteOne({ _id: r._id })
  await audit({ action: 'DELETE', module: 'transport', entityType: 'route', entityId: String(r._id), entityName: r.name, summary: `Removed route ${r.name}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── students on routes

export async function listAssignments({ routeId, search }, auth) {
  const routes = await TransportRoute.find(siteFilter(auth)).select('name stops vehicleId').lean()
  const f = { active: true, routeId: isOid(routeId) ? oid(routeId) : { $in: routes.map((r) => r._id) } }
  const rows = await TransportAssignment.find(f).limit(5000).lean()
  const labels = await studentLabels(rows.map((r) => r.studentId))
  const byRoute = new Map(routes.map((r) => [String(r._id), r]))
  const q = String(search ?? '').trim().toLowerCase()
  return rows.map((a) => {
    const r = byRoute.get(String(a.routeId))
    const stop = r?.stops.find((s) => String(s._id) === String(a.stopId))
    return { ...clean(a), studentId: String(a.studentId), routeId: String(a.routeId), stopId: String(a.stopId), student: labels.get(String(a.studentId)) ?? null, route: r?.name ?? '', stop: stop?.name ?? '', pickupTime: stop?.pickupTime ?? null, dropTime: stop?.dropTime ?? null, fee: stop?.fee ?? null }
  }).filter((x) => !q || (x.student?.name ?? '').toLowerCase().includes(q) || (x.student?.admissionNo ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.route.localeCompare(b.route) || a.stop.localeCompare(b.stop) || (a.student?.name ?? '').localeCompare(b.student?.name ?? ''))
}

/** Put a student on a route from a date (their earlier assignment ends the day before). */
export async function assignStudent(input, auth, req) {
  const s = isOid(input.studentId) ? await Student.findById(input.studentId).select('firstName middleName lastName admissionNo status').lean() : null
  if (!s) throw fieldsError({ studentId: 'Pick a student' })
  const r = isOid(input.routeId) ? await TransportRoute.findOne({ _id: input.routeId, active: true, ...siteFilter(auth) }).lean() : null
  if (!r) throw fieldsError({ routeId: 'Pick a route' })
  const stop = r.stops.find((x) => String(x._id) === String(input.stopId))
  if (!stop) throw fieldsError({ stopId: 'Pick a stop on this route' })
  const from = input.from || await today()
  const prev = await TransportAssignment.findOne({ studentId: s._id, active: true })
  if (prev) { Object.assign(prev, { active: false, to: addDays(from, -1) }); await prev.save() }
  const a = await TransportAssignment.create({ studentId: s._id, routeId: r._id, stopId: stop._id, mode: input.mode, from, note: input.note, by: auth.user?.name })
  let warning = null
  if (r.vehicleId) {
    const v = await Vehicle.findById(r.vehicleId).select('capacity regNo').lean()
    const riders = await TransportAssignment.countDocuments({ routeId: r._id, active: true })
    if (v?.capacity && riders > v.capacity) warning = `${riders} students on a ${v.capacity}-seat vehicle (${v.regNo}).`
  }
  await audit({ action: 'CREATE', module: 'transport', entityType: 'transport_assignment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} on route ${r.name}, stop ${stop.name} from ${from}${prev ? ' (moved from another route)' : ''}` }, req)
  return { ...clean(a.toObject()), warning }
}

export async function endAssignment(id, { to }, auth, req) {
  const a = isOid(id) ? await TransportAssignment.findById(id) : null
  if (!a || !a.active) throw notFound('Assignment')
  a.active = false
  a.to = to || await today()
  await a.save()
  await audit({ action: 'UPDATE', module: 'transport', entityType: 'transport_assignment', entityId: String(a._id), studentId: a.studentId, summary: `Took a student off transport from ${a.to}` }, req)
  return { ended: true }
}

export async function exportAssignments(q, auth) {
  const rows = await listAssignments(q, auth)
  const head = ['Route', 'Stop', 'Pickup', 'Drop', 'Student', 'Admission no.', 'Class', 'Rides', 'Parent', 'Mobile', 'Fee a year', 'From']
  return [head, ...rows.map((r) => [r.route, r.stop, r.pickupTime, r.dropTime, r.student?.name, r.student?.admissionNo, r.student?.className, r.mode, r.student?.guardian, r.student?.mobile, r.fee != null ? formatINR(r.fee) : '', r.from])].map((x) => x.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── trips

const ridesNow = (trip, studentId) => (trip.rides ?? []).filter((x) => String(x.studentId) === String(studentId))
const tripOut = (t) => ({ ...clean(t), routeId: String(t.routeId), vehicleId: idStr(t.vehicleId), reached: (t.reached ?? []).map((x) => ({ stopId: String(x.stopId), at: x.at })), alerted: (t.alerted ?? []).map(String), rides: (t.rides ?? []).map((x) => ({ ...x, studentId: String(x.studentId), stopId: idStr(x.stopId) })), map: osmEmbed([t.lastPosition].filter(Boolean)) })

/** Today's board: each route's pickup and drop, where its bus is, the stops reached. */
export async function board(auth, { date } = {}) {
  const d = date || await today()
  const routes = await listRoutes(auth)
  const trips = await Trip.find({ date: d, routeId: { $in: routes.map((r) => oid(r.id)) } }).lean()
  const vehicles = new Map((await Vehicle.find({ _id: { $in: routes.map((r) => r.vehicleId).filter(Boolean) } }).select('regNo lastPosition').lean()).map((v) => [String(v._id), v]))
  return {
    date: d,
    routes: routes.map((r) => ({
      ...r, lastPosition: vehicles.get(String(r.vehicleId))?.lastPosition ?? null,
      trips: Object.keys(TRIP_KINDS).map((kind) => { const t = trips.find((x) => String(x.routeId) === r.id && x.kind === kind); return t ? tripOut(t) : { kind, status: 'NOT_STARTED' } }),
    })),
  }
}

async function tripFor(id) {
  const t = isOid(id) ? await Trip.findById(id) : null
  if (!t) throw notFound('Trip')
  return t
}

/** The trip as the attendant works it: stops in order with their students, who got on and off. */
export async function tripDetail(id) {
  const t = (await tripFor(id)).toObject()
  const r = await TransportRoute.findById(t.routeId).lean()
  const assignments = await TransportAssignment.find({ routeId: t.routeId, active: true, mode: { $in: ['BOTH', t.kind] } }).lean()
  const labels = await studentLabels(assignments.map((a) => a.studentId))
  const reached = new Map((t.reached ?? []).map((x) => [String(x.stopId), x.at]))
  return {
    ...tripOut(t), routeName: r?.name ?? '',
    stops: stopsFor(r?.stops ?? [], t.kind).map((s) => ({
      id: String(s._id), name: s.name, time: t.kind === 'PICKUP' ? s.pickupTime : s.dropTime, lat: s.lat ?? null, lng: s.lng ?? null, reachedAt: reached.get(String(s._id)) ?? null,
      students: assignments.filter((a) => String(a.stopId) === String(s._id)).map((a) => ({ ...labels.get(String(a.studentId)), events: ridesNow(t, a.studentId).map((x) => x.event) })),
    })),
  }
}

/** The driver (or the transport office) starts today's pickup or drop of a route. */
export async function startTrip({ routeId, kind }, auth, req) {
  const r = isOid(routeId) ? await TransportRoute.findOne({ _id: routeId, active: true }).lean() : null
  if (!r) throw notFound('Route')
  const d = await today()
  const existing = await Trip.findOne({ routeId: r._id, date: d, kind })
  if (existing?.status === 'DONE') throw conflict(`Today’s ${TRIP_KINDS[kind].label.toLowerCase()} on this route is finished.`)
  const t = existing ?? await Trip.create({ routeId: r._id, vehicleId: r.vehicleId, date: d, kind, startedAt: new Date(), startedBy: auth.user?.name, startedById: isOid(auth.userId) ? auth.userId : undefined })
  if (!existing) await audit({ action: 'CREATE', module: 'transport', entityType: 'trip', entityId: String(t._id), entityName: r.name, summary: `Started the ${TRIP_KINDS[kind].label.toLowerCase()} of ${r.name}` }, req)
  return tripDetail(String(t._id))
}

export async function endTrip(id, auth, req) {
  const t = await tripFor(id)
  if (t.status !== 'DONE') { t.status = 'DONE'; t.endedAt = new Date(); await t.save() }
  await audit({ action: 'UPDATE', module: 'transport', entityType: 'trip', entityId: String(t._id), summary: `Finished a trip (${(t.reached ?? []).length} stops reached)` }, req)
  return tripDetail(id)
}

/** Families of the students at a stop on a trip of this kind. */
async function ridersAt(routeId, stopId, kind) {
  return TransportAssignment.find({ routeId, stopId, active: true, mode: { $in: ['BOTH', kind] } }).select('studentId').lean()
}

/**
 * A position for a vehicle (from the driver's phone or its GPS device). Saved; if the vehicle has a running trip
 * today, the stops reached are marked and the families of the next stops told the bus is near.
 */
export async function recordPosition(vehicle, p, source) {
  if (!isLatLng(p)) throw badRequest('Not a position.')
  const at = p.at && !Number.isNaN(new Date(p.at).getTime()) ? new Date(p.at) : new Date()
  if (at > new Date(Date.now() + 5 * 60_000)) throw badRequest('That time is in the future.')
  const pos = { lat: p.lat, lng: p.lng, speed: p.speed ?? undefined, heading: p.heading ?? undefined, at }
  const trip = await Trip.findOne({ vehicleId: vehicle._id, status: 'RUNNING', date: await today() })
  await VehiclePosition.create({ vehicleId: vehicle._id, tripId: trip?._id, ...pos, accuracy: p.accuracy ?? undefined, source })
  await Vehicle.updateOne({ _id: vehicle._id }, { $set: { lastPosition: { ...pos, source } } })
  if (!trip) return { tripId: null }
  const r = await TransportRoute.findById(trip.routeId).lean()
  const settings = await getSettings('transport')
  const stops = stopsFor(r?.stops ?? [], trip.kind).map((s) => ({ id: String(s._id), name: s.name, lat: s.lat, lng: s.lng }))
  const prog = stopProgress(pos, stops, { reached: trip.reached.map((x) => x.stopId), alerted: trip.alerted }, { arriveM: settings.arriveMetres ?? 150, nearM: settings.nearMetres ?? 1500 })
  trip.lastPosition = pos
  for (const sid of prog.arrived) trip.reached.push({ stopId: sid, at })
  const toTell = settings.alertNear === false ? [] : prog.near
  for (const n of toTell) trip.alerted.push(n.id)
  await trip.save()
  if (toTell.length) {
    const v = await Vehicle.findById(vehicle._id).select('regNo').lean()
    for (const n of toTell) {
      const stop = stops.find((s) => s.id === n.id)
      for (const a of await ridersAt(trip.routeId, n.id, trip.kind)) {
        await emit('transport.near', { studentId: String(a.studentId), entity: { type: 'trip', id: trip._id }, data: { bus: { route: r.name, stop: stop.name, minutes: etaMinutes(n.metres, p.speed), vehicle: v?.regNo ?? '', trip: TRIP_KINDS[trip.kind].label.toLowerCase() } } })
      }
    }
  }
  return { tripId: String(trip._id), reached: prog.arrived, told: toTell.map((n) => n.id) }
}

/** The driver's phone shares its position while the trip runs. */
export async function phonePosition(tripId, input) {
  const t = await tripFor(tripId)
  if (t.status !== 'RUNNING') throw conflict('This trip is finished.')
  if (!t.vehicleId) throw conflict('The route has no vehicle set.')
  const v = await Vehicle.findById(t.vehicleId).lean()
  return recordPosition(v, input, 'PHONE')
}

/** The attendant marks a student on, off, or not at the stop; the family is told. */
export async function markRide(tripId, { studentId, event }, auth, req) {
  const t = await tripFor(tripId)
  const a = await TransportAssignment.findOne({ routeId: t.routeId, studentId, active: true }).lean()
  if (!a) throw notFound('Student on this route')
  t.rides.push({ studentId: a.studentId, stopId: a.stopId, event, at: new Date(), by: auth.user?.name })
  await t.save()
  const r = await TransportRoute.findById(t.routeId).lean()
  const stop = r?.stops.find((s) => String(s._id) === String(a.stopId))
  const v = t.vehicleId ? await Vehicle.findById(t.vehicleId).select('regNo').lean() : null
  if ((await getSettings('transport')).alertRide !== false) {
    const verb = { BOARDED: 'got on', DROPPED: 'got off', ABSENT: 'was not at the stop for' }[event]
    await emit('transport.ride', { studentId: String(a.studentId), entity: { type: 'trip', id: t._id }, data: { bus: { route: r?.name ?? '', stop: event === 'DROPPED' && t.kind === 'PICKUP' ? 'school' : stop?.name ?? '', event: verb, time: hhmmIn(new Date(), await timeZoneOf()), vehicle: v?.regNo ?? '' } } })
  }
  await audit({ action: 'UPDATE', module: 'transport', entityType: 'trip', entityId: String(t._id), studentId: a.studentId, summary: `${RIDE_EVENTS[event].label}: a student on ${r?.name ?? 'a route'}` }, req)
  return tripDetail(tripId)
}

/** The driver's or attendant's own routes today (their login is on the vehicle). */
export async function myRoutes(auth) {
  if (!isOid(auth.userId)) return { routes: [] }
  const vehicles = await Vehicle.find({ $or: [{ 'driver.userId': auth.userId }, { 'attendant.userId': auth.userId }] }).select('_id').lean()
  const b = await board(null)
  const mine = b.routes.filter((r) => vehicles.some((v) => String(v._id) === r.vehicleId))
  return { date: b.date, routes: mine }
}

/** The recent path of a vehicle (the last few hours), for the tracking map. */
export async function vehicleTrail(vehicleId, { hours = 3 } = {}) {
  if (!isOid(vehicleId)) throw notFound('Vehicle')
  const rows = await VehiclePosition.find({ vehicleId, at: { $gte: new Date(Date.now() - hours * 3600_000) } }).sort({ at: 1 }).limit(2000).select('lat lng speed at source').lean()
  return rows.map((p) => ({ lat: p.lat, lng: p.lng, speed: p.speed ?? null, at: p.at, source: p.source }))
}

// ───────────────────────────────────────────────────────── GPS devices (webhook)

/** Read one or many positions from what a tracker sent: JSON, or the OsmAnd / Traccar query (speed in knots). */
function parsePositions(query, raw) {
  const out = []
  const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))
  const one = (o, knots = false) => {
    const lat = num(o.lat ?? o.latitude)
    const lng = num(o.lng ?? o.lon ?? o.longitude)
    const speed = num(o.speed)
    const t = o.time ?? o.timestamp ?? o.fixTime ?? o.at
    const at = t === undefined ? undefined : /^\d+(\.\d+)?$/.test(String(t)) ? new Date(Number(t) * (Number(t) < 1e12 ? 1000 : 1)) : new Date(t)
    return { deviceId: String(o.deviceId ?? o.imei ?? o.id ?? o.uniqueId ?? '').trim(), lat, lng, speed: speed === undefined ? undefined : knots ? speed * 1.852 : speed, heading: num(o.heading ?? o.bearing ?? o.course), at }
  }
  if (query && (query.lat || query.latitude)) out.push(one(query, true))
  if (raw?.length) {
    let body = null
    try { body = JSON.parse(raw.toString('utf8')) } catch { /* not JSON — the query is all there is */ }
    // One point ({ deviceId, lat, lng }), a list of them, { positions: [...] }, or { deviceId, location: { coords } }.
    const list = Array.isArray(body) ? body : body?.positions ?? (body?.location ? [body.location] : body ? [body] : [])
    for (const o of list) {
      if (!o || typeof o !== 'object') continue
      out.push(one({ ...o, ...(o.coords ?? {}), deviceId: o.deviceId ?? o.imei ?? o.id ?? o.device?.uniqueId ?? body.deviceId ?? body.device_id }))
    }
  }
  return out.filter((p) => p.deviceId && isLatLng(p))
}

export async function handleGpsHook(hookKey, query, raw) {
  return asHookOwner('GPS', hookKey, async () => {
    const list = parsePositions(query, raw)
    if (!list.length) { await logInbound({ provider: 'GPS', operation: 'position', status: 'REJECTED', error: 'No device id and position found' }); return [400, { message: 'Send deviceId, lat and lng.' }] }
    let saved = 0
    const unknown = new Set()
    for (const p of list.slice(0, 200)) {
      const v = await Vehicle.findOne({ gpsDeviceId: p.deviceId }).lean()
      if (!v) { unknown.add(p.deviceId); continue }
      try { await recordPosition(v, p, 'DEVICE'); saved++ } catch { /* a bad point; the next one counts */ }
    }
    if (unknown.size) await logInbound({ provider: 'GPS', operation: 'position', status: 'REJECTED', error: `Unknown device(s): ${[...unknown].slice(0, 5).join(', ')}` })
    return [200, { ok: true, saved }]
  })
}

// ───────────────────────────────────────────────────────── the family's view

/** The student's bus: route, stop and times, today's trips, where the bus is and how far from the stop. */
export async function busFor(f, id) {
  need(f, 'BUS')
  const s = studentFor(f, id)
  const a = await TransportAssignment.findOne({ studentId: s._id, active: true }).lean()
  if (!a) return { assigned: false }
  const r = await TransportRoute.findById(a.routeId).lean()
  const stop = r?.stops.find((x) => String(x._id) === String(a.stopId))
  const v = r?.vehicleId ? await Vehicle.findById(r.vehicleId).select('regNo type driver attendant lastPosition').lean() : null
  const d = await today()
  const trips = await Trip.find({ routeId: a.routeId, date: d }).lean()
  const fresh = v?.lastPosition?.at && Date.now() - new Date(v.lastPosition.at).getTime() < 15 * 60_000 ? v.lastPosition : null
  const metres = fresh && isLatLng(stop) ? distanceM(fresh, stop) : null
  return {
    assigned: true, mode: a.mode, route: r?.name ?? '', stop: stop && { name: stop.name, pickupTime: stop.pickupTime ?? null, dropTime: stop.dropTime ?? null, landmark: stop.landmark ?? null },
    vehicle: v && { regNo: v.regNo, driver: v.driver?.name ?? null, driverMobile: v.driver?.mobile ?? null, attendant: v.attendant?.name ?? null, attendantMobile: v.attendant?.mobile ?? null },
    trips: Object.keys(TRIP_KINDS).filter((k) => a.mode === 'BOTH' || a.mode === k).map((kind) => {
      const t = trips.find((x) => x.kind === kind)
      const mine = t ? ridesNow(t, s._id) : []
      return { kind, status: t?.status ?? 'NOT_STARTED', reachedMyStop: !!t?.reached?.some((x) => String(x.stopId) === String(a.stopId)), events: mine.map((x) => ({ event: x.event, at: x.at })) }
    }),
    live: fresh && trips.some((t) => t.status === 'RUNNING') ? { at: fresh.at, metres: metres === null ? null : Math.round(metres), minutes: metres === null ? null : etaMinutes(metres, fresh.speed), map: osmEmbed([fresh]), link: osmLink(fresh) } : null,
  }
}
