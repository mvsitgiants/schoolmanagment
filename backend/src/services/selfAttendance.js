import { DEVICE_KEY_PREFIX, GEOFENCE_DEFAULT_RADIUS_M, metresText, nearestSite } from '@schoolgiant/shared'
import { Employee } from '../models/hrms.js'
import { Device, DevicePunch } from '../models/integrations.js'
import { Branch } from '../models/tenant.js'
import { AppError, conflict, forbidden, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { hhmmIn, institutionNow, timeZoneOf } from '../platform/time.js'
import { receive } from './devices.js'
import { newKey } from './integrationsCommon.js'
import { studentFor } from './portal.js'

// Self attendance from a phone, held to the campus's attendance sites (geofence) — ported from the hospital platform
// (hrmsAttendance geofenceCheck) and extended to students:
//   staff     My workspace › Check in / Check out (Settings › Staff & HR: selfAttendance, geofence OFF/WARN/REQUIRED)
//   students  the student app, own login only (Settings › Attendance: studentSelfCheckIn OFF / LOG / PRESENT; always held
//             to the sites — a student can't check in from home)
// Each check-in is a punch of a system device (kind GEO), so it goes exactly where a card reader's punch goes: staff
// attendance (first IN = in time, last OUT = out time — any number of ins and outs in between), or the student gate log
// (and, with PRESENT, today's register; the family hears "reached school"). The location is read once, when the person
// presses the button — never tracked — and kept on the punch for the audit trail.

const LOCATION_HELP = {
  DENIED: 'Location access is blocked for this site. Allow it in your browser (the lock or location icon next to the address bar, or your phone’s Settings › Location for the browser) and try again.',
  UNAVAILABLE: 'Your device could not work out where you are. Switch on location (and Wi-Fi, which makes it more precise) and try again.',
  TIMEOUT: 'Finding your location took too long. Step near a window or outside and try again.',
  UNSUPPORTED: 'This browser cannot share your location (it needs a secure https page). Use another browser.',
}
const AGAIN_WITHIN_MS = 60_000

/** The attendance sites someone may mark at: their campus's, else (no campus, or it has none) every campus's. */
async function sitesFor(branchId) {
  const branches = await Branch.find({ active: true, 'attendanceSites.0': { $exists: true } }).select('name attendanceSites').lean()
  const own = branchId ? branches.filter((b) => String(b._id) === String(branchId)) : []
  const pool = own.length ? own : branches
  return pool.flatMap((b) => (b.attendanceSites ?? [])
    .filter((x) => x.active !== false && (x.shape === 'POLYGON' ? (x.polygon?.length ?? 0) >= 3 : Number.isFinite(x.lat) && Number.isFinite(x.lng)))
    .map((x) => ({ id: x._id, branchId: b._id, name: x.name || b.name, shape: x.shape === 'POLYGON' ? 'POLYGON' : 'CIRCLE', lat: x.lat, lng: x.lng, radiusM: x.radiusM || GEOFENCE_DEFAULT_RADIUS_M, polygon: x.shape === 'POLYGON' ? x.polygon : undefined })))
}

/** A site as the check-in card draws it on the map. */
const siteOut = (x) => ({ id: String(x.id), name: x.name, shape: x.shape, lat: x.lat, lng: x.lng, radiusM: x.radiusM, polygon: x.polygon })

/**
 * The geofence verdict for one check-in. OFF: nothing checked or kept. REQUIRED: refuse without a fix, with a rough fix,
 * or outside every site. WARN: accept, but flag it (outsideGeofence) for review.
 */
async function geofenceCheck({ mode, maxAcc, branchId }, location, locationError) {
  if (mode === 'OFF') return null
  const required = mode === 'REQUIRED'
  const refuse = (reason, message, extra = {}) => new AppError(403, message, { code: 'GEOFENCE', details: { reason, mode, ...extra } })
  if (!location) {
    const message = `${required ? 'Your location is needed to mark attendance. ' : ''}${LOCATION_HELP[locationError] ?? LOCATION_HELP.UNAVAILABLE}`
    if (required) throw refuse('NO_LOCATION', message, { locationError: locationError ?? null })
    return { geo: { status: 'NO_LOCATION', inside: false }, outside: true, message }
  }
  const fix = { lat: Math.round(location.lat * 1e6) / 1e6, lng: Math.round(location.lng * 1e6) / 1e6, accuracy: Math.round(location.accuracy ?? 0) }
  const sites = await sitesFor(branchId)
  if (!sites.length) {
    if (required) throw refuse('NO_SITE', 'No attendance location has been set up for your campus yet, so attendance cannot be marked from a phone. Ask the administrator (Administration › Campuses).')
    return { geo: { ...fix, status: 'NO_SITE', inside: null }, outside: false, message: 'No attendance site is set up yet — your location was noted.' }
  }
  const near = nearestSite(fix, sites)
  const where = { ...fix, distanceM: near.distanceM, siteId: String(near.site.id), siteName: near.site.name, branchId: String(near.site.branchId), inside: near.inside }
  const outline = near.site.shape === 'POLYGON'
  const facts = { distanceM: near.distanceM, siteName: near.site.name, shape: near.site.shape, radiusM: outline ? null : near.site.radiusM, accuracy: fix.accuracy }
  if (fix.accuracy > maxAcc) {
    const message = `Your location is only accurate to about ${metresText(fix.accuracy)} (the limit is ${metresText(maxAcc)}). Switch on precise location and Wi-Fi, or step near a window, and try again.`
    if (required) throw refuse('POOR_ACCURACY', message, { ...facts, maxAccuracyM: maxAcc })
    return { geo: { ...where, status: 'POOR_ACCURACY' }, outside: true, message }
  }
  if (!near.inside) {
    const message = outline
      ? `You are ${metresText(near.distanceM)} outside ${near.site.name}; attendance can be marked inside its marked area.`
      : `You are ${metresText(near.distanceM)} from ${near.site.name}; attendance can be marked within ${metresText(near.site.radiusM)} of it.`
    if (required) throw refuse('OUTSIDE', message, facts)
    return { geo: { ...where, status: 'OUTSIDE' }, outside: true, message: `${message} Marked anyway and flagged for review.` }
  }
  return { geo: { ...where, status: 'INSIDE' }, outside: false, message: outline ? `You're at ${near.site.name}.` : `You're at ${near.site.name} (${metresText(near.distanceM)}).` }
}

/** The system device a kind of phone check-in punches as (made the first time it is needed). */
async function geoDevice(usedFor) {
  const name = usedFor === 'STAFF' ? 'Phone check-in · staff' : 'Phone check-in · students'
  const found = await Device.findOne({ kind: 'GEO', usedFor }).lean()
  if (found) return found
  const k = newKey(DEVICE_KEY_PREFIX) // unused — a GEO device never calls in; the schema wants a key
  return (await Device.create({ name, kind: 'GEO', usedFor, keyPrefix: k.prefix, keyHash: k.hash, keyLast4: k.last4, keyIssuedAt: new Date(), createdBy: 'System', notes: 'Made by the system for phone check-ins inside the attendance sites.' })).toObject()
}

/** Today's punches of one person (any device), oldest first — what the check-in screen lists. */
async function punchesToday(personId) {
  const { date } = await institutionNow()
  const rows = await DevicePunch.find({ personId, date, test: { $ne: true } }).sort({ at: 1 }).select('at time direction deviceName kind geo outsideGeofence outcome').lean()
  return rows.map((p) => ({ at: p.at, time: p.time, direction: p.direction ?? null, via: p.kind === 'GEO' ? 'PHONE' : p.deviceName, siteName: p.geo?.siteName ?? null, distanceM: p.geo?.distanceM ?? null, outside: !!p.outsideGeofence }))
}
const nextDirection = (rows) => (rows.filter((r) => r.direction).at(-1)?.direction === 'IN' ? 'OUT' : 'IN')

/** One phone punch through the device path, then the location kept on it. */
async function punch(d, asAuth, { code, personId, direction, fence }) {
  const recent = await DevicePunch.exists({ personId, at: { $gte: new Date(Date.now() - AGAIN_WITHIN_MS) }, test: { $ne: true } })
  if (recent) throw conflict('You marked attendance a moment ago.')
  const at = new Date()
  const out = await receive(d, asAuth, { punches: [{ code, direction, at: at.toISOString() }] })
  if (!out.accepted) throw conflict(out.errors[0]?.message ?? 'That could not be recorded.')
  if (fence) await DevicePunch.updateOne({ deviceId: d._id, code, at }, { $set: { geo: fence.geo, ...(fence.outside && { outsideGeofence: true }), note: fence.message } })
  return { direction, at, time: hhmmIn(at, await timeZoneOf()), outcome: out.results[0]?.outcome ?? null, note: out.results[0]?.note ?? null, geofence: fence ? { message: fence.message, outside: fence.outside, status: fence.geo.status } : null }
}

const deviceAuth = (tenantId, enabledModules, name, branchId) => ({ tenantId: String(tenantId), userId: undefined, fullAccess: true, permissions: ['*'], dataScopes: { default: 'ALL' }, enabledModules, user: { name, branchId } })

// ───────────────────────────────────────────────────────── staff (My workspace)

async function myEmployee(auth) {
  const e = await Employee.findOne({ userId: auth.userId, status: { $ne: 'EXITED' } }).lean()
  if (!e) throw notFound('Your staff record')
  return e
}

/** My workspace: may I mark myself in, how is it checked, and what I marked today. */
export async function staffSelfStatus(auth) {
  const cfg = await getSettings('hrms')
  if (!cfg.selfAttendance) return { enabled: false }
  const e = await myEmployee(auth)
  const today = await punchesToday(e._id)
  const mode = e.geofenceExempt ? 'OFF' : (cfg.geofence ?? 'REQUIRED')
  const sites = mode === 'OFF' ? [] : await sitesFor(e.branchId)
  return { enabled: true, mode, exempt: !!e.geofenceExempt, sites: sites.length, siteList: sites.map(siteOut), today, next: nextDirection(today) }
}

/** My workspace › Check in / Check out. `location` { lat, lng, accuracy } is read by the browser at this moment only. */
export async function staffSelfPunch(auth, { direction, location, locationError }) {
  const cfg = await getSettings('hrms')
  if (!cfg.selfAttendance) throw forbidden('Marking your own attendance is switched off. Use the biometric device or ask HR.')
  const e = await myEmployee(auth)
  const fence = await geofenceCheck({ mode: e.geofenceExempt ? 'OFF' : (cfg.geofence ?? 'REQUIRED'), maxAcc: cfg.geofenceMaxAccuracyM ?? 100, branchId: e.branchId }, location, locationError)
  const dir = direction ?? nextDirection(await punchesToday(e._id))
  const d = await geoDevice('STAFF')
  const r = await punch(d, deviceAuth(auth.tenantId, auth.enabledModules, `${d.name} · ${e.name}`, e.branchId), { code: e.employeeCode, personId: e._id, direction: dir, fence })
  return { ...r, today: await punchesToday(e._id) }
}

// ───────────────────────────────────────────────────────── students (the student app)

/** The student app: may this student check in, and what they marked today. */
export async function studentSelfStatus(f, studentId) {
  const s = studentFor(f, studentId)
  const cfg = await getSettings('attendance')
  const mode = cfg.studentSelfCheckIn ?? 'OFF'
  if (mode === 'OFF' || !f.enabledModules?.includes('attendance')) return { enabled: false }
  const today = await punchesToday(s._id)
  const sites = await sitesFor(s.branchId)
  return { enabled: true, mode, ownLogin: f.session.kind === 'STUDENT', sites: sites.length, siteList: sites.map(siteOut), today, next: nextDirection(today) }
}

/** The student app › Check in / Check out — the student's own login, inside an attendance site of their campus. */
export async function studentSelfCheckIn(f, studentId, { direction, location, locationError }) {
  const s = studentFor(f, studentId)
  const cfg = await getSettings('attendance')
  const mode = cfg.studentSelfCheckIn ?? 'OFF'
  if (mode === 'OFF' || !f.enabledModules?.includes('attendance')) throw forbidden('Checking in from the app is switched off. Your class teacher marks attendance.')
  if (f.session.kind !== 'STUDENT') throw forbidden('A student checks in from their own login, on the campus — not from a parent’s phone.')
  const fence = await geofenceCheck({ mode: 'REQUIRED', maxAcc: cfg.studentGeofenceMaxAccuracyM ?? 100, branchId: s.branchId }, location, locationError)
  const dir = direction ?? nextDirection(await punchesToday(s._id))
  const d = { ...(await geoDevice('STUDENTS')), autoMarkAttendance: mode === 'PRESENT' }
  const r = await punch(d, deviceAuth(f.tenant._id, f.enabledModules, `${d.name} · ${s.firstName}`, s.branchId), { code: s.admissionNo, personId: s._id, direction: dir, fence })
  return { ...r, today: await punchesToday(s._id) }
}
