import {
  DEVICE_IDLE_HOURS, DEVICE_KEY_PREFIX, DEVICE_PUSH_MAX, DEVICE_TYPE_LABEL, DEVICE_USED_FOR, PUNCH_OUTCOMES, countMarks, sectionLabel,
} from '@schoolgiant/shared'
import { AttendanceSheet } from '../models/attendance.js'
import { Employee, StaffAttendance } from '../models/hrms.js'
import { Device, DevicePunch, IntegrationConfig } from '../models/integrations.js'
import { Tenant } from '../models/platform.js'
import { Branch } from '../models/tenant.js'
import { Student, studentName } from '../models/students.js'
import { ClassLevel, Section } from '../models/academics.js'
import { emit } from '../platform/events.js'
import { humanDate } from './notify.js'
import { Vehicle } from '../models/transport.js'
import { enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { runAsSystem, runAsTenant } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { hhmmIn, institutionNow, timeZoneOf, ymdIn, zonedDate } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { importAttendance } from './hrmsAttendance.js'
import { hookUrl, keyPrefixOf, logInbound, newKey, safeEqual, sha256 } from './integrationsCommon.js'
import { BLOCKED_STATUSES, effectiveStatus } from './subscription.js'
import { recordPosition } from './transport.js'

// Integrations › Devices. A biometric, RFID or face device (or the small bridge next to it) pushes punches to
//   POST /api/v1/hooks/devices/:key      { punches: [{ code, at, direction }] }  — or one punch, or a list
// where `code` is the employee code (staff), or the card code / admission number (students), `at` an ISO time
// (a time without a zone is read on the institution's clock) and `direction` IN or OUT (optional).
//   · staff     → Staff attendance, through hrms importAttendance(): first IN is the in time, last OUT the out time;
//   · students  → the gate log (DevicePunch); with `autoMarkAttendance` on the device, a first IN before the
//                 "mark by" time marks the child present in today's daily register — when the register is open
//                 (a class's register is never started by a device: the teacher still takes it).
//   · GPS       → { lat, lng, speed, heading, at } positions for the bus the device is on (Transport).
// The key is shown once and kept only as a sha-256 hash. Every push writes one IntegrationLog row (provider DEVICE).

const STATUS_DAY_MS = DEVICE_IDLE_HOURS * 3600_000

const statusOf = (d) => {
  if (!d.active) return 'DISABLED'
  if (!d.lastSeenAt) return 'NEVER'
  if (d.lastError?.at && d.lastError.at >= d.lastSeenAt) return 'ERROR'
  if (Date.now() - new Date(d.lastSeenAt) > STATUS_DAY_MS) return 'IDLE'
  return 'OK'
}

function view(d, extra = {}) {
  const { keyHash, ...rest } = clean(d)
  return {
    ...rest, status: statusOf(d), kindLabel: DEVICE_TYPE_LABEL[d.kind] ?? d.kind,
    usedForLabel: d.kind === 'GPS' ? null : DEVICE_USED_FOR.find((u) => u.value === d.usedFor)?.label ?? null,
    keyHint: `${d.keyPrefix}_••••${d.keyLast4 ?? ''}`, ...extra,
  }
}

const oidStr = (v) => (v ? String(v) : null)

async function names() {
  const [branches, vehicles] = await Promise.all([Branch.find().select('name').lean(), Vehicle.find().select('regNo').lean()])
  return { branch: new Map(branches.map((b) => [String(b._id), b.name])), vehicle: new Map(vehicles.map((v) => [String(v._id), v.regNo])) }
}

/** Pickers for the register form: campuses and buses. */
export async function deviceOptions() {
  const [branches, vehicles] = await Promise.all([
    Branch.find({ active: { $ne: false } }).select('name code').sort({ name: 1 }).lean(),
    Vehicle.find().select('regNo gpsDeviceId').sort({ regNo: 1 }).lean(),
  ])
  return {
    branches: branches.map((b) => ({ id: String(b._id), name: b.name, code: b.code })),
    vehicles: vehicles.map((v) => ({ id: String(v._id), regNo: v.regNo, gpsDeviceId: v.gpsDeviceId ?? null })),
  }
}

/** Every device with today's punches, and the bus GPS trackers set on vehicles in Transport. */
export async function listDevices() {
  const today = (await institutionNow()).date
  const [rows, counts, n, vehicles, gpsCfg] = await Promise.all([
    Device.find().sort({ kind: 1, name: 1 }).lean(),
    DevicePunch.aggregate([{ $match: { date: today, test: { $ne: true } } }, { $group: { _id: '$deviceId', n: { $sum: 1 } } }]),
    names(),
    Vehicle.find({ gpsDeviceId: { $type: 'string' } }).select('regNo gpsDeviceId branchId status lastPosition').sort({ regNo: 1 }).lean(),
    IntegrationConfig.findOne({ provider: 'GPS' }).select('hookKey health').lean(),
  ])
  const today$ = new Map(counts.map((c) => [String(c._id), c.n]))
  const devices = rows.map((d) => view(d, {
    punchesToday: today$.get(String(d._id)) ?? 0,
    branchName: n.branch.get(oidStr(d.branchId)) ?? null, vehicleRegNo: n.vehicle.get(oidStr(d.vehicleId)) ?? null,
  }))
  const trackers = vehicles.map((v) => {
    const at = v.lastPosition?.at ?? null
    return {
      id: String(v._id), regNo: v.regNo, gpsDeviceId: v.gpsDeviceId, branchName: n.branch.get(oidStr(v.branchId)) ?? null, vehicleStatus: v.status,
      lastSeenAt: at, source: v.lastPosition?.source ?? null, status: !at ? 'NEVER' : Date.now() - new Date(at) > STATUS_DAY_MS ? 'IDLE' : 'OK',
    }
  })
  return { today, devices, trackers, gps: { hasUrl: !!gpsCfg?.hookKey, health: gpsCfg?.health ?? { status: 'UNKNOWN' } } }
}

/** The bus trackers' address (made the first time it is asked for). */
export async function gpsUrl(baseUrl) {
  return { url: await hookUrl('GPS', 'gps', baseUrl) }
}

export async function deviceDetail(id) {
  const d = isOid(id) ? await Device.findById(id).lean() : null
  if (!d) throw notFound('Device')
  const n = await names()
  const today = (await institutionNow()).date
  return view(d, {
    punchesToday: await DevicePunch.countDocuments({ deviceId: d._id, date: today, test: { $ne: true } }),
    branchName: n.branch.get(oidStr(d.branchId)) ?? null, vehicleRegNo: n.vehicle.get(oidStr(d.vehicleId)) ?? null,
  })
}

async function checkInput(input, current) {
  const kind = input.kind ?? current?.kind
  if (input.branchId && !await Branch.exists({ _id: input.branchId })) throw badRequest('Unknown campus.', { fields: { branchId: 'Unknown campus' } })
  if (kind === 'GPS') {
    const vehicleId = input.vehicleId ?? current?.vehicleId
    if (!vehicleId) throw badRequest('Pick the bus this tracker is on.', { fields: { vehicleId: 'Required' } })
    if (!await Vehicle.exists({ _id: vehicleId })) throw badRequest('Unknown vehicle.', { fields: { vehicleId: 'Unknown vehicle' } })
    return { usedFor: undefined, autoMarkAttendance: false }
  }
  const usedFor = input.usedFor ?? current?.usedFor ?? (kind === 'RFID' ? 'STUDENTS' : 'STAFF')
  return { usedFor, vehicleId: undefined, autoMarkAttendance: usedFor === 'STUDENTS' ? (input.autoMarkAttendance ?? current?.autoMarkAttendance ?? false) : false }
}

const nameTaken = (err) => {
  if (err?.code === 11000 && err.keyPattern?.name) throw conflict('Another device already has this name.', { fields: { name: 'Already used' } })
  throw err
}

/** Register a device: returns the record and its push key, which is never shown again. */
export async function createDevice(input, auth, req) {
  const fixed = await checkInput(input)
  const k = newKey(DEVICE_KEY_PREFIX)
  const d = await Device.create({ ...input, ...fixed, keyPrefix: k.prefix, keyHash: k.hash, keyLast4: k.last4, keyIssuedAt: new Date(), createdBy: auth.user?.name }).catch(nameTaken)
  await audit({ action: 'CREATE', module: 'integrations', entityType: 'device', entityId: String(d._id), entityName: d.name, summary: `Registered ${(DEVICE_TYPE_LABEL[d.kind] ?? d.kind).toLowerCase()} “${d.name}”` }, req)
  return { device: await deviceDetail(d._id), key: k.key }
}

export async function updateDevice(id, input, auth, req) {
  const d = isOid(id) ? await Device.findById(id) : null
  if (!d) throw notFound('Device')
  if (input.kind && input.kind !== d.kind) throw badRequest('A device’s kind can’t change — register it again.')
  const fixed = await checkInput(input, d.toObject())
  d.set({ ...input, ...fixed, updatedBy: auth.user?.name })
  await d.save().catch(nameTaken)
  await audit({ action: 'UPDATE', module: 'integrations', entityType: 'device', entityId: String(d._id), entityName: d.name, summary: `Changed device “${d.name}” (${Object.keys(input).join(', ')})` }, req)
  return deviceDetail(d._id)
}

/** New key; the old one stops working at once. */
export async function rotateDeviceKey(id, auth, req) {
  const k = newKey(DEVICE_KEY_PREFIX)
  const d = isOid(id) ? await Device.findOneAndUpdate({ _id: id }, { $set: { keyPrefix: k.prefix, keyHash: k.hash, keyLast4: k.last4, keyIssuedAt: new Date(), updatedBy: auth.user?.name } }, { returnDocument: 'after' }).lean() : null
  if (!d) throw notFound('Device')
  await audit({ action: 'UPDATE', module: 'integrations', entityType: 'device', entityId: String(d._id), entityName: d.name, summary: `Issued a new key for “${d.name}” (the old key no longer works)` }, req)
  return { device: await deviceDetail(d._id), key: k.key }
}

export async function deleteDevice(id, req) {
  const d = isOid(id) ? await Device.findByIdAndDelete(id).lean() : null
  if (!d) throw notFound('Device')
  await audit({ action: 'DELETE', module: 'integrations', entityType: 'device', entityId: String(d._id), entityName: d.name, summary: `Removed device “${d.name}” (its punches stay in the log)` }, req)
  return { id: String(d._id) }
}

/** The punch log: gate, bus and staff punches, newest first. */
export async function listPunches(q, paging) {
  const filter = {}
  if (q.date) filter.date = q.date
  if (q.deviceId) filter.deviceId = q.deviceId
  if (q.outcome) filter.outcome = q.outcome
  if (q.personType) filter.personType = q.personType
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ code: re }, { personName: re }, { deviceName: re }]
  }
  const [rows, total, by] = await Promise.all([
    DevicePunch.find(filter).sort({ at: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    DevicePunch.countDocuments(filter),
    DevicePunch.aggregate([{ $match: { ...filter, test: { $ne: true } } }, { $group: { _id: '$outcome', n: { $sum: 1 } } }]),
  ])
  const res = listResponse(clean(rows), total, paging)
  res.meta.byOutcome = Object.fromEntries(by.map((b) => [b._id, b.n]))
  res.meta.outcomes = PUNCH_OUTCOMES
  return res
}

// ───────────────────────────────────────────────────────── inbound

const deviceDenied = () => new AppError(401, 'Unknown or switched-off device key.', { code: 'DEVICE_KEY' })
const needs = (d) => (d.kind === 'GPS' ? 'transport' : d.usedFor === 'STAFF' ? 'hrms' : null)

/** Find the device (and its institution) from the key, and run `fn(device, auth)` as that institution. */
export async function asDevice(presented, ip, fn) {
  const prefix = keyPrefixOf(presented, DEVICE_KEY_PREFIX)
  if (!prefix) throw deviceDenied()
  const d = await runAsSystem(() => Device.findOne({ keyPrefix: prefix }).setOptions({ allTenants: true }).lean())
  if (!d || !safeEqual(d.keyHash, sha256(presented)) || !d.active) throw deviceDenied()
  const tenant = await runAsSystem(() => Tenant.findById(d.tenantId).lean())
  if (!tenant || BLOCKED_STATUSES.includes(effectiveStatus(tenant))) throw new AppError(402, 'The institution’s subscription is not active.', { code: 'SUBSCRIPTION_INACTIVE' })
  const modules = await enabledModuleIds(d.tenantId)
  const need = needs(d)
  if (!modules.includes('integrations') || (need && !modules.includes(need))) throw new AppError(404, `The ${need && modules.includes('integrations') ? need : 'integrations'} module is not enabled for this institution.`, { code: 'MODULE_DISABLED' })
  const name = `Device: ${d.name}`
  return runAsTenant(d.tenantId, async () => {
    const auth = { tenantId: String(d.tenantId), userId: undefined, fullAccess: true, permissions: ['*'], dataScopes: { default: 'ALL' }, enabledModules: modules, user: { name, branchId: d.branchId } }
    try {
      const out = await fn(d, auth)
      const failed = !out.accepted && out.received
      await Device.updateOne({ _id: d._id }, {
        $set: { lastSeenAt: new Date(), lastIp: ip, ...(failed && { lastError: { at: new Date(), message: String(out.errors?.[0]?.message ?? 'Nothing accepted').slice(0, 300) } }) },
        $inc: { 'counts.received': out.received ?? 0, 'counts.accepted': out.accepted ?? 0, 'counts.rejected': out.rejected ?? 0 },
      })
      await logInbound({ provider: 'DEVICE', operation: out.operation, status: failed ? 'REJECTED' : 'OK', ref: d.name, entityType: 'device', entityId: String(d._id), summary: { received: out.received, accepted: out.accepted, duplicates: out.duplicates, rejected: out.rejected, errors: out.errors?.slice(0, 5) } })
      return out
    } catch (err) {
      await Device.updateOne({ _id: d._id }, { $set: { lastSeenAt: new Date(), lastIp: ip, lastError: { at: new Date(), message: String(err.message).slice(0, 300) } } })
      await logInbound({ provider: 'DEVICE', operation: 'push', status: err.status && err.status < 500 ? 'REJECTED' : 'ERROR', ref: d.name, entityType: 'device', entityId: String(d._id), error: err.message })
      throw err
    }
  }, { userId: null, userName: name })
}

/** The body as a list of items: one object, an array, or { punches | positions | data: [...] }. */
function itemsOf(body) {
  let j = body
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    const s = String(body).trim()
    if (!s) return []
    try { j = JSON.parse(s) } catch { throw badRequest('The body must be JSON: { "punches": [{ "code", "at", "direction" }] }') }
  }
  const list = Array.isArray(j) ? j : Array.isArray(j?.punches) ? j.punches : Array.isArray(j?.positions) ? j.positions : Array.isArray(j?.data) ? j.data : j && typeof j === 'object' ? [j] : []
  if (list.length > DEVICE_PUSH_MAX) throw badRequest(`Send at most ${DEVICE_PUSH_MAX} at a time.`)
  return list.filter((x) => x && typeof x === 'object')
}

/** A punch's instant: an ISO time with a zone as given; a wall-clock time on the institution's clock; none → now. */
function instantOf(raw, tz) {
  if (raw === undefined || raw === null || raw === '') return new Date()
  const s = String(raw).trim()
  if (/^\d{10,13}$/.test(s)) return new Date(Number(s) * (s.length === 10 ? 1000 : 1))
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/)
  if (m) return new Date(zonedDate(m[1], m[2], tz).getTime() + (m[3] ? Number(m[3].slice(1)) * 1000 : 0))
  return new Date(NaN)
}

const codeOf = (p) => String(p.code ?? p.employeeCode ?? p.empCode ?? p.cardCode ?? p.card ?? p.admissionNo ?? p.userId ?? p.uid ?? '').trim().slice(0, 60)
const dirOf = (p) => {
  const v = String(p.direction ?? p.dir ?? p.type ?? '').trim().toUpperCase()
  return v === 'IN' || v === 'I' || v === '0' ? 'IN' : v === 'OUT' || v === 'O' || v === '1' ? 'OUT' : null
}

/** Shape and check the raw punches: { ok: [{ code, at, date, time, direction }], errors }. */
async function readPunches(items) {
  const tz = await timeZoneOf()
  const now = Date.now()
  const ok = []
  const errors = []
  items.forEach((p, i) => {
    const code = codeOf(p)
    const at = instantOf(p.at ?? p.timestamp ?? p.time ?? p.dateTime, tz)
    if (!code) return errors.push({ row: i + 1, message: 'No code (employee code, card code or admission number)' })
    if (Number.isNaN(at.getTime())) return errors.push({ row: i + 1, code, message: 'Time not understood — send ISO 8601, e.g. 2026-11-09T08:05:00+05:30' })
    if (at.getTime() > now + 5 * 60_000) return errors.push({ row: i + 1, code, message: 'Time is in the future (check the device clock)' })
    if (at.getTime() < now - 45 * 86_400_000) return errors.push({ row: i + 1, code, message: 'Older than 45 days' })
    ok.push({ code, at, date: ymdIn(at, tz), time: hhmmIn(at, tz), direction: dirOf(p) })
  })
  return { ok, errors }
}

const base = (d) => ({ deviceId: d._id, deviceName: d.name, kind: d.kind, usedFor: d.usedFor, branchId: d.branchId })

/** Save one punch row; null when the device already sent it. */
async function savePunch(row) {
  try {
    return (await DevicePunch.create(row)).toObject()
  } catch (err) {
    if (err?.code === 11000) return null
    throw err
  }
}

const minT = (a, b) => (!a ? b : !b ? a : a < b ? a : b)
const maxT = (a, b) => (!a ? b : !b ? a : a > b ? a : b)

/** Staff punches → one Staff attendance row a person a day (first in, last out), through hrms importAttendance(). */
async function staffPunches(d, auth, punches, { test }) {
  const codes = [...new Set(punches.map((p) => p.code.toUpperCase()))]
  const staff = new Map((await Employee.find({ employeeCode: { $in: codes } }).select('name employeeCode').lean()).map((e) => [e.employeeCode.toUpperCase(), e]))
  const out = { accepted: 0, duplicates: 0, rejected: 0, errors: [], results: [] }
  const days = new Map() // employeeId|date → { e, date, ins: [], outs: [], rows: [] }
  for (const p of punches) {
    const e = staff.get(p.code.toUpperCase())
    const row = { ...base(d), ...p, personType: 'STAFF', personId: e?._id, personName: e?.name, outcome: e ? (test ? 'TEST' : 'ATTENDANCE') : 'UNKNOWN', note: e ? undefined : 'No employee with this code', test }
    if (!e) {
      out.rejected++
      out.errors.push({ code: p.code, message: 'Unknown employee code' })
      if (!test) await savePunch(row)
      out.results.push({ code: p.code, outcome: 'UNKNOWN' })
      continue
    }
    if (test) {
      out.accepted++
      out.results.push({ code: p.code, outcome: 'TEST', name: e.name, date: p.date, time: p.time, direction: p.direction })
      await savePunch({ ...row, note: 'Test punch — not saved to attendance' })
      continue
    }
    const saved = await savePunch(row)
    if (!saved) { out.duplicates++; out.results.push({ code: p.code, outcome: 'DUPLICATE' }); continue }
    const k = `${e._id}|${p.date}`
    if (!days.has(k)) days.set(k, { e, date: p.date, ins: [], outs: [], ids: [] })
    const day = days.get(k)
    if (p.direction !== 'OUT') day.ins.push(p.time)
    if (p.direction !== 'IN') day.outs.push(p.time)
    day.ids.push(saved._id)
  }
  if (!days.size) return out
  const list = [...days.values()]
  const existing = await StaffAttendance.find({ $or: list.map((x) => ({ employeeId: x.e._id, date: x.date })) }).lean()
  const ex = new Map(existing.map((a) => [`${a.employeeId}|${a.date}`, a]))
  const rows = list.map((x) => {
    const a = ex.get(`${x.e._id}|${x.date}`)
    const inTime = x.ins.reduce(minT, a?.inTime ?? null)
    let outTime = x.outs.reduce(maxT, a?.outTime ?? null)
    if (outTime && inTime && outTime <= inTime) outTime = a?.outTime && a.outTime > inTime ? a.outTime : null
    return { employeeCode: x.e.employeeCode, date: x.date, inTime: inTime ?? undefined, outTime: outTime ?? undefined, status: ['HALF_DAY', 'ON_DUTY'].includes(a?.status) ? a.status : 'PRESENT' }
  })
  const r = await importAttendance(rows, auth, null)
  const skipped = new Map(r.skipped.map((s) => [s.row - 1, s.reason]))
  for (const [i, x] of list.entries()) {
    const why = skipped.get(i)
    if (why) {
      out.rejected += x.ids.length
      out.errors.push({ code: x.e.employeeCode, message: `${x.date}: ${why}` })
      await DevicePunch.updateMany({ _id: { $in: x.ids } }, { $set: { outcome: 'SKIPPED', note: why } })
      out.results.push({ code: x.e.employeeCode, outcome: 'SKIPPED', name: x.e.name, note: why })
    } else {
      out.accepted += x.ids.length
      out.results.push({ code: x.e.employeeCode, outcome: 'ATTENDANCE', name: x.e.name, date: x.date, inTime: rows[i].inTime ?? null, outTime: rows[i].outTime ?? null })
    }
  }
  return out
}

/**
 * Mark a student present in today's daily register (when the device allows it): a first IN before the "mark by"
 * time. Only an open register is touched — an unmarked or absent child becomes present; other marks stay.
 * Returns a note when it did (or why it didn't), null when the rule doesn't apply.
 */
async function premark(student, p, auth) {
  const [cfg, now] = await Promise.all([getSettings('attendance'), institutionNow()])
  if ((cfg.mode ?? 'DAILY') !== 'DAILY' || p.direction === 'OUT' || p.date !== now.date) return null
  const markBefore = cfg.markBefore || '10:00'
  if (p.time > markBefore) return null
  const earlier = await DevicePunch.exists({ personId: student._id, date: p.date, direction: { $ne: 'OUT' }, at: { $lt: p.at }, test: { $ne: true } })
  if (earlier) return null
  if (!student.sectionId) return { marked: false, note: 'No class' }
  const sheet = await AttendanceSheet.findOne({ sectionId: student.sectionId, date: p.date, period: 0 })
  if (!sheet) return { marked: false, note: 'Register not taken yet — the class teacher marks it' }
  const entry = sheet.entries.find((e) => String(e.studentId) === String(student._id))
  if (entry && entry.status !== 'A') return { marked: false, note: 'Already marked in the register' }
  const note = `Card at the gate ${p.time}`
  if (entry) Object.assign(entry, { status: 'P', note })
  else sheet.entries.push({ studentId: student._id, status: 'P', note })
  sheet.counts = countMarks(sheet.entries)
  sheet.updatedBy = auth.user?.name
  await sheet.save()
  await audit({ action: 'UPDATE', module: 'attendance', entityType: 'attendance_sheet', entityId: String(sheet._id), entityName: `${studentName(student)} · ${p.date}`, summary: `Marked ${studentName(student)} present from the gate (${p.time})`, studentId: student._id })
  return { marked: true, note }
}

/** The family hears "reached school" once a day: on the child's first IN at a gate, today (Notification rules › Reached school). */
async function tellArrived(student, p, saved) {
  if (p.direction === 'OUT' || p.date !== (await institutionNow()).date) return
  const earlier = await DevicePunch.exists({ _id: { $ne: saved._id }, personId: student._id, date: p.date, direction: { $ne: 'OUT' }, test: { $ne: true } })
  if (earlier) return
  const sec = student.sectionId ? await Section.findById(student.sectionId).lean() : null
  const cls = sec ? await ClassLevel.findById(sec.classId).select('name code').lean() : null
  await emit('attendance.arrived', { studentId: String(student._id), entity: { type: 'device_punch', id: saved._id }, data: { student: { class: sec ? sectionLabel(cls, sec, { short: true }) : '' }, attendance: { time: p.time, date: humanDate(p.date) } } })
}

/** Student punches → the gate log; optionally today's register. */
async function studentPunches(d, auth, punches, { test }) {
  const codes = [...new Set(punches.map((p) => p.code))]
  const found = await Student.find({ status: 'ACTIVE', $or: [{ cardCode: { $in: codes } }, { admissionNo: { $in: codes } }] })
    .select('firstName middleName lastName admissionNo cardCode sectionId').lean()
  const byCode = new Map()
  for (const s of found) { if (s.cardCode) byCode.set(s.cardCode, s); byCode.set(s.admissionNo, s) }
  const out = { accepted: 0, duplicates: 0, rejected: 0, errors: [], results: [] }
  for (const p of punches) {
    const s = byCode.get(p.code)
    const row = { ...base(d), ...p, personType: 'STUDENT', personId: s?._id, personName: s ? studentName(s) : undefined, outcome: s ? (test ? 'TEST' : 'GATE') : 'UNKNOWN', test }
    if (!s) {
      out.rejected++
      out.errors.push({ code: p.code, message: 'No student with this card code or admission number' })
      if (!test) await savePunch({ ...row, note: 'Unknown card' })
      out.results.push({ code: p.code, outcome: 'UNKNOWN' })
      continue
    }
    if (test) {
      out.accepted++
      await savePunch({ ...row, note: 'Test punch — not saved to the gate log' })
      out.results.push({ code: p.code, outcome: 'TEST', name: studentName(s), date: p.date, time: p.time, direction: p.direction })
      continue
    }
    const saved = await savePunch(row)
    if (!saved) { out.duplicates++; out.results.push({ code: p.code, outcome: 'DUPLICATE' }); continue }
    out.accepted++
    const mark = d.autoMarkAttendance && auth.enabledModules.includes('attendance') ? await premark(s, p, auth) : null
    await tellArrived(s, p, saved)
    if (mark) await DevicePunch.updateOne({ _id: saved._id }, { $set: { ...(mark.marked && { outcome: 'MARKED_PRESENT' }), note: mark.note } })
    out.results.push({ code: p.code, outcome: mark?.marked ? 'MARKED_PRESENT' : 'GATE', name: studentName(s), date: p.date, time: p.time, direction: p.direction, note: mark?.note })
  }
  return out
}

/** GPS positions for the device's bus. */
async function gpsPositions(d, items, { test }) {
  const vehicle = d.vehicleId ? await Vehicle.findById(d.vehicleId).lean() : null
  if (!vehicle) throw conflict('This tracker isn’t on a bus — pick the vehicle in Integrations › Devices.')
  const out = { operation: 'positions', received: items.length, accepted: 0, rejected: 0, errors: [], results: [] }
  for (const [i, o] of items.entries()) {
    const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))
    const p = { lat: num(o.lat ?? o.latitude), lng: num(o.lng ?? o.lon ?? o.longitude), speed: num(o.speed), heading: num(o.heading ?? o.bearing), at: o.at ?? o.timestamp ?? o.time }
    if (test) {
      const okPos = Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
      if (okPos) out.accepted++
      else { out.rejected++; out.errors.push({ row: i + 1, message: 'Send lat and lng' }) }
      out.results.push({ outcome: okPos ? 'TEST' : 'SKIPPED', name: vehicle.regNo })
      continue
    }
    try {
      await recordPosition(vehicle, p, 'DEVICE')
      out.accepted++
    } catch (err) {
      out.rejected++
      out.errors.push({ row: i + 1, message: err.message })
    }
  }
  if (!test && out.accepted) out.results.push({ outcome: 'POSITION', name: vehicle.regNo })
  return out
}

/** The phones and tablets set up as gate scanners (Integrations › Devices, kind PHONE) — for the Gate scanner screen. */
export async function phoneScanners() {
  const rows = await Device.find({ kind: 'PHONE', active: true }).sort({ name: 1 }).lean()
  return rows.map((d) => ({ id: String(d._id), name: d.name, usedFor: d.usedFor, autoMarkAttendance: !!d.autoMarkAttendance, branchId: d.branchId ? String(d.branchId) : null }))
}

/**
 * One code read by a phone scanner: the device's own path (the same as a card reader's push), run as the device but
 * signed with who was holding the phone. The route checks the person may take attendance for what the scanner records.
 */
export async function phonePunch(id, { code, direction }, auth) {
  if (!isOid(id)) throw notFound('Scanner')
  const d = await Device.findById(id).lean()
  if (!d || d.kind !== 'PHONE') throw notFound('Scanner')
  if (!d.active) throw conflict('This scanner is switched off (Integrations › Devices).')
  const need = needs(d)
  if (need && !auth.enabledModules?.includes(need)) throw conflict(`The ${need} module is not switched on.`)
  const as = { tenantId: auth.tenantId, userId: undefined, fullAccess: true, permissions: ['*'], dataScopes: { default: 'ALL' }, enabledModules: auth.enabledModules, user: { name: `${d.name} · ${auth.user?.name ?? ''}`.trim(), branchId: d.branchId } }
  const out = await receive(d, as, { punches: [{ code, direction, at: new Date().toISOString() }] })
  await Device.updateOne({ _id: d._id }, {
    $set: { lastSeenAt: new Date(), ...(!out.accepted && out.errors[0] && { lastError: { at: new Date(), message: String(out.errors[0].message).slice(0, 300) } }) },
    $inc: { 'counts.received': out.received ?? 0, 'counts.accepted': out.accepted ?? 0, 'counts.rejected': out.rejected ?? 0 },
  })
  const r = out.results[0] ?? {}
  return { ok: out.accepted > 0, duplicate: out.duplicates > 0, outcome: r.outcome ?? (out.errors.length ? 'UNKNOWN' : null), name: r.name ?? null, time: r.time ?? null, direction: r.direction ?? direction ?? null, note: r.note ?? null, error: out.accepted ? null : out.errors[0]?.message ?? null, usedFor: d.usedFor }
}

/** One push from a device (already found by its key): punches or positions. */
export async function receive(d, auth, body, { test = false } = {}) {
  const items = itemsOf(body)
  if (d.kind === 'GPS') return gpsPositions(d, items, { test })
  const { ok, errors } = await readPunches(items)
  const r = d.usedFor === 'STUDENTS' ? await studentPunches(d, auth, ok, { test }) : await staffPunches(d, auth, ok, { test })
  return {
    operation: test ? 'test_punch' : 'punches', received: items.length, accepted: r.accepted, duplicates: r.duplicates, rejected: r.rejected + errors.length,
    errors: [...errors, ...r.errors].slice(0, 50), results: r.results.slice(0, 50),
  }
}

/**
 * "Send a test punch" from the screen: the device's own path end to end (code lookup, time, direction) without
 * writing attendance, the gate log or a bus position. With no code, the first person it would match is used.
 */
export async function testPunch(id, { code, direction, lat, lng }, auth, req) {
  const d = isOid(id) ? await Device.findById(id).lean() : null
  if (!d) throw notFound('Device')
  let body
  if (d.kind === 'GPS') {
    const v = d.vehicleId ? await Vehicle.findById(d.vehicleId).select('lastPosition').lean() : null
    body = [{ lat: lat ?? v?.lastPosition?.lat ?? 12.9716, lng: lng ?? v?.lastPosition?.lng ?? 77.5946 }]
  } else {
    let c = code?.trim()
    if (!c) {
      if (d.usedFor === 'STUDENTS') {
        const s = await Student.findOne({ status: 'ACTIVE' }).select('admissionNo').sort({ admissionNo: 1 }).lean()
        c = s?.admissionNo
      } else {
        const e = await Employee.findOne({ status: { $ne: 'EXITED' }, employeeCode: { $type: 'string' } }).select('employeeCode').sort({ employeeCode: 1 }).lean()
        c = e?.employeeCode
      }
    }
    if (!c) throw conflict(d.usedFor === 'STUDENTS' ? 'There are no students to test with.' : 'There are no staff with an employee code to test with.')
    body = [{ code: c, at: new Date().toISOString(), direction: direction ?? 'IN' }]
  }
  const out = await receive(d, auth, body, { test: true })
  await Device.updateOne({ _id: d._id }, { $set: { lastSeenAt: new Date(), ...(out.accepted && { 'lastError.at': null }) } })
  await logInbound({ provider: 'DEVICE', operation: 'test_punch', status: out.accepted ? 'OK' : 'REJECTED', ref: d.name, entityType: 'device', entityId: String(d._id), summary: { received: out.received, accepted: out.accepted, rejected: out.rejected, errors: out.errors?.slice(0, 5) } })
  await audit({ action: 'UPDATE', module: 'integrations', entityType: 'device', entityId: String(d._id), entityName: d.name, summary: `Sent a test punch to “${d.name}”: ${out.accepted ? 'accepted' : 'not accepted'}` }, req)
  return out
}
