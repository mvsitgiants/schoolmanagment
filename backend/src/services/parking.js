import {
  PARKING_VEHICLE_KIND_BY, addDaysYmd, areaFill, areaTakes, classNumber, formatPlate, passState, plateKey, sectionLabel,
} from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { Employee } from '../models/hrms.js'
import { ParkingArea, ParkingEntry, ParkingVehicle } from '../models/parking.js'
import { Student, studentName } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { hhmmIn, institutionNow, timeZoneOf } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'

// Parking: areas with a capacity, parking passes for staff, student and parent vehicles (a QR sticker with the pass
// number), and the gate — a pass holder scanned or found by number plate and marked in / out, a visitor's vehicle
// noted, and how full each area is now. Students get a scooter or car only from a set class, with a licence number.

const actor = () => getContext()?.userName
const idStr = (v) => (v ? String(v) : null)
const fields = (msg, f) => badRequest(msg, { fields: f })
const PARK_DEFAULTS = { studentMotorFromClass: 11, licenceNeeded: true, passMonths: 12, visitorHours: 4 }
export const parkingSettings = async () => ({ ...PARK_DEFAULTS, ...(await getSettings('parking')) })
const today = async () => (await institutionNow()).date

/** A date some months on ("2026-11-18" + 12 → "2027-11-17": the day before the same date). */
function monthsOn(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  t.setUTCDate(Math.min(d, last))
  return addDaysYmd(t.toISOString().slice(0, 10), -1)
}

/** Records on the caller's campus (data scope BRANCH), or all (ALL). Records with no campus belong to the main one. */
async function campusFilter(auth) {
  if (scopeOf(auth, 'parking') === 'ALL' || !auth?.user?.branchId) return {}
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(main) === String(auth.user.branchId) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}
const campusOf = (auth) => auth?.user?.branchId || undefined

/** The campuses an area can be put on: every campus for someone who sees all, else their own (locked). */
export async function parkingMeta(auth) {
  const locked = scopeOf(auth, 'parking') !== 'ALL' && !!auth?.user?.branchId
  const rows = await Branch.find(locked ? { _id: auth.user.branchId } : {}).sort({ isDefault: -1, name: 1 }).select('name isDefault').lean()
  return { branches: rows.map((b) => ({ id: String(b._id), name: b.name, isDefault: !!b.isDefault })), branchLocked: locked }
}

/** The campus of something new: the one asked for (when the person sees every campus), else their own. */
async function campusFor(auth, asked) {
  if (asked && scopeOf(auth, 'parking') === 'ALL') {
    if (!(await Branch.exists({ _id: asked }))) throw fields('Pick a campus from the list.', { branchId: 'Not found' })
    return asked
  }
  return campusOf(auth)
}

// ───────────────────────────────────────────────────────── areas

async function insideByArea(match = {}) {
  const rows = await ParkingEntry.aggregate([{ $match: { outAt: null, ...match } }, { $group: { _id: '$areaId', n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

const areaOut = (a, inside = 0, passes = 0) => ({
  id: String(a._id), name: a.name, for: a.for ?? 'ANY', kinds: a.kinds ?? [], capacity: a.capacity ?? 0, note: a.note ?? null, active: a.active !== false,
  branchId: idStr(a.branchId), passes, ...areaFill(inside, a.capacity),
})

/** Areas on the campus, with how many are parked in each now and how many passes name it. */
export async function listAreas(auth, { all = false } = {}) {
  const scope = await campusFilter(auth)
  const areas = await ParkingArea.find({ ...scope, ...(all ? {} : { active: true }) }).sort({ name: 1 }).lean()
  const inside = await insideByArea()
  const passes = new Map((await ParkingVehicle.aggregate([{ $match: { status: 'ACTIVE', areaId: { $in: areas.map((a) => a._id) } } }, { $group: { _id: '$areaId', n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]))
  return areas.map((a) => areaOut(a, inside.get(String(a._id)) ?? 0, passes.get(String(a._id)) ?? 0))
}

async function areaFor(id, auth) {
  const a = isOid(String(id ?? '')) ? await ParkingArea.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!a) throw notFound('Parking area')
  return a
}

export async function saveArea(id, input, auth, req) {
  const a = id ? await areaFor(id, auth) : new ParkingArea({ branchId: await campusFor(auth, input.branchId) })
  const clash = await ParkingArea.findOne({ _id: { $ne: a._id }, branchId: a.branchId ?? null, name: new RegExp(`^${escapeRegex(input.name.trim())}$`, 'i') }).select('_id').lean()
  if (clash) throw fields('There is already an area with this name.', { name: 'Already there' })
  Object.assign(a, { name: input.name.trim(), for: input.for, kinds: input.kinds ?? [], capacity: input.capacity ?? 0, note: input.note || undefined, active: input.active ?? true })
  await a.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'parking', entityType: 'parking_area', entityId: String(a._id), entityName: a.name, summary: `${id ? 'Changed' : 'Added'} parking area ${a.name}` }, req)
  return areaOut(a.toObject())
}

/** Only an area nobody's pass names and nothing is parked in; otherwise switch it off. */
export async function deleteArea(id, auth, req) {
  const a = await areaFor(id, auth)
  if (await ParkingEntry.exists({ areaId: a._id, outAt: null })) throw conflict('Vehicles are parked in this area now. Mark them out first, or switch the area off.')
  if (await ParkingVehicle.exists({ areaId: a._id, status: 'ACTIVE' })) throw conflict('Parking passes name this area. Move them to another area first, or switch the area off.')
  if (await ParkingEntry.exists({ areaId: a._id })) throw conflict('This area has a parking history. Switch it off instead of deleting it.')
  await a.deleteOne()
  await audit({ action: 'DELETE', module: 'parking', entityType: 'parking_area', entityId: String(a._id), entityName: a.name, summary: `Deleted parking area ${a.name}` }, req)
  return { id: String(a._id) }
}

// ───────────────────────────────────────────────────────── people to give a pass to

async function classOf(sectionId) {
  const sec = sectionId ? await Section.findById(sectionId).select('name classId').lean() : null
  const cls = sec ? await ClassLevel.findById(sec.classId).select('name code').lean() : null
  return { label: sec ? sectionLabel(cls, sec, { short: true }) : null, number: classNumber(cls) }
}

/** Students or staff by name, admission number or staff code — for the pass form. */
export async function findPeople(kind, search, auth) {
  const q = search?.trim()
  if (!q || q.length < 2) return []
  const rx = new RegExp(escapeRegex(q), 'i')
  if (kind === 'STAFF') {
    const rows = await Employee.find({ status: { $ne: 'EXITED' }, $or: [{ name: rx }, { employeeCode: q.toUpperCase() }, { mobile: rx }] }).select('name employeeCode designation mobile').limit(20).lean()
    return rows.map((e) => ({ id: String(e._id), name: e.name, sub: [e.employeeCode, e.designation].filter(Boolean).join(' · '), mobile: e.mobile ?? null }))
  }
  const scope = await campusFilter(auth)
  const rows = await Student.find({ status: 'ACTIVE', ...scope, $or: [{ firstName: rx }, { lastName: rx }, { admissionNo: q.toUpperCase() }] }).select('firstName middleName lastName admissionNo sectionId guardians').limit(20).lean()
  return Promise.all(rows.map(async (s) => {
    const c = await classOf(s.sectionId)
    const g = (s.guardians ?? []).map((x) => ({ name: x.name, relation: x.relation ?? null, mobile: x.mobile ?? null })).filter((x) => x.name)
    return { id: String(s._id), name: studentName(s), sub: [c.label, s.admissionNo].filter(Boolean).join(' · '), guardians: g }
  }))
}

// ───────────────────────────────────────────────────────── vehicles and passes

function vehicleOut(v, date, extra = {}) {
  return {
    id: String(v._id), passNo: v.passNo, ownerKind: v.ownerKind, ownerName: v.ownerName, ownerMobile: v.ownerMobile ?? null, relation: v.relation ?? null,
    studentId: idStr(v.studentId), employeeId: idStr(v.employeeId), studentName: v.studentName ?? null, classLabel: v.classLabel ?? null,
    plate: v.plate, kind: v.kind, model: v.model ?? null, colour: v.colour ?? null, licenceNo: v.licenceNo ?? null,
    areaId: idStr(v.areaId), validFrom: v.validFrom, validTo: v.validTo, state: passState(v, date),
    revokeReason: v.revokeReason ?? null, revokedAt: v.revokedAt ?? null, revokedBy: v.revokedBy ?? null, note: v.note ?? null, createdBy: v.createdBy ?? null, createdAt: v.createdAt,
    ...extra,
  }
}

async function vehicleFor(id, auth) {
  const v = isOid(String(id ?? '')) ? await ParkingVehicle.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!v) throw notFound('Vehicle')
  return v
}

/** The pass list: by state, whose, area, kind, or a search on plate / pass no. / name. */
export async function listVehicles(q, auth) {
  const date = await today()
  const filter = { ...(await campusFilter(auth)) }
  if (q.ownerKind) filter.ownerKind = q.ownerKind
  if (q.kind) filter.kind = q.kind
  if (q.areaId) filter.areaId = q.areaId
  if (q.state === 'REVOKED') filter.status = 'REVOKED'
  else if (q.state === 'ACTIVE') Object.assign(filter, { status: 'ACTIVE', validTo: { $gte: date } })
  else if (q.state === 'EXPIRED') Object.assign(filter, { status: 'ACTIVE', validTo: { $lt: date } })
  const s = q.search?.trim()
  if (s) {
    const rx = new RegExp(escapeRegex(s), 'i')
    filter.$or = [{ plateKey: new RegExp(escapeRegex(plateKey(s))) }, { passNo: s.toUpperCase() }, { ownerName: rx }, { studentName: rx }, { model: rx }]
  }
  const [rows, total] = await Promise.all([
    ParkingVehicle.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    ParkingVehicle.countDocuments(filter),
  ])
  const areas = new Map((await ParkingArea.find({ _id: { $in: rows.map((r) => r.areaId).filter(Boolean) } }).select('name').lean()).map((a) => [String(a._id), a.name]))
  const inside = new Set((await ParkingEntry.find({ vehicleId: { $in: rows.map((r) => r._id) }, outAt: null }).select('vehicleId').lean()).map((e) => String(e.vehicleId)))
  const counts = await ParkingVehicle.aggregate([{ $match: { ...(await campusFilter(auth)) } }, { $group: { _id: { s: '$status', live: { $gte: ['$validTo', date] } }, n: { $sum: 1 } } }])
  const count = (fn) => counts.filter((c) => fn(c._id)).reduce((n, c) => n + c.n, 0)
  return {
    date, total,
    counts: { ACTIVE: count((k) => k.s === 'ACTIVE' && k.live), EXPIRED: count((k) => k.s === 'ACTIVE' && !k.live), REVOKED: count((k) => k.s === 'REVOKED') },
    rows: rows.map((v) => vehicleOut(v, date, { areaName: areas.get(String(v.areaId)) ?? null, inside: inside.has(String(v._id)) })),
  }
}

export async function getVehicle(id, auth) {
  const v = await vehicleFor(id, auth)
  const date = await today()
  const area = v.areaId ? await ParkingArea.findById(v.areaId).select('name').lean() : null
  const visits = await ParkingEntry.find({ vehicleId: v._id }).sort({ inAt: -1 }).limit(20).lean()
  return vehicleOut(v.toObject(), date, { areaName: area?.name ?? null, inside: visits.some((e) => !e.outAt), visits: visits.map(entryOut(new Map())) })
}

/** Who the pass is for, checked and filled from the record (a student's class, a parent's child, staff details). */
async function ownerOf(input, settings) {
  const motor = PARKING_VEHICLE_KIND_BY[input.kind]?.motor
  if (input.ownerKind === 'STAFF') {
    const e = input.employeeId ? await Employee.findOne({ _id: input.employeeId, status: { $ne: 'EXITED' } }).select('name mobile branchId').lean() : null
    if (!e) throw fields('Pick the staff member from the list.', { employeeId: 'Pick the staff member' })
    return { branchId: e.branchId ?? undefined, employeeId: e._id, studentId: undefined, ownerName: e.name, ownerMobile: input.ownerMobile || e.mobile || undefined, studentName: undefined, classLabel: undefined, relation: undefined }
  }
  const s = input.studentId ? await Student.findOne({ _id: input.studentId, status: 'ACTIVE' }).select('firstName middleName lastName sectionId branchId').lean() : null
  if (!s) throw fields('Pick the student from the list.', { studentId: 'Pick the student' })
  const c = await classOf(s.sectionId)
  if (input.ownerKind === 'STUDENT') {
    if (motor && (!settings.studentMotorFromClass || c.number < settings.studentMotorFromClass)) {
      throw fields(settings.studentMotorFromClass
        ? `Students can register a scooter, bike or car only from class ${settings.studentMotorFromClass}. ${studentName(s)} can register a cycle.`
        : 'Students can register only a cycle.', { kind: 'Not for this class' })
    }
    return { branchId: s.branchId ?? undefined, studentId: s._id, employeeId: undefined, ownerName: studentName(s), ownerMobile: input.ownerMobile || undefined, studentName: studentName(s), classLabel: c.label ?? undefined, relation: undefined }
  }
  if (!input.ownerName?.trim()) throw fields('Enter the parent’s name.', { ownerName: 'Enter the name' })
  return { branchId: s.branchId ?? undefined, studentId: s._id, employeeId: undefined, ownerName: input.ownerName.trim(), ownerMobile: input.ownerMobile || undefined, relation: input.relation || undefined, studentName: studentName(s), classLabel: c.label ?? undefined }
}

async function checkVehicle(input, settings, exceptId, auth) {
  const key = plateKey(input.plate)
  if (key.length < 4) throw fields('Enter the number plate.', { plate: 'Enter the number plate' })
  const motor = PARKING_VEHICLE_KIND_BY[input.kind]?.motor
  if (motor && settings.licenceNeeded && !input.licenceNo?.trim()) throw fields('Enter the driving licence number.', { licenceNo: 'Needed for a motor vehicle' })
  const twin = await ParkingVehicle.findOne({ plateKey: key, status: 'ACTIVE', ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('passNo ownerName').lean()
  if (twin) throw conflict(`${formatPlate(input.plate)} already has pass ${twin.passNo} (${twin.ownerName}). Cancel that pass first.`, { fields: { plate: 'Already has a pass' } })
  if (input.areaId) {
    const area = await areaFor(input.areaId, auth)
    if (!areaTakes(area, input.ownerKind, input.kind)) throw fields(`${area.name} doesn’t take this vehicle. Pick another area.`, { areaId: 'Doesn’t take this vehicle' })
  }
  return key
}

export async function registerVehicle(input, auth, req) {
  const settings = await parkingSettings()
  const key = await checkVehicle(input, settings, null, auth)
  const owner = await ownerOf(input, settings)
  const date = await today()
  const branchId = owner.branchId ?? campusOf(auth)
  const v = await ParkingVehicle.create({
    passNo: await nextNumber('PARKING_PASS', { branchId }), ownerKind: input.ownerKind, ...owner, branchId,
    plate: formatPlate(input.plate), plateKey: key, kind: input.kind, model: input.model || undefined, colour: input.colour || undefined,
    licenceNo: input.licenceNo?.trim() || undefined, areaId: input.areaId || undefined,
    validFrom: date, validTo: input.validTo || monthsOn(date, settings.passMonths), note: input.note || undefined, createdBy: actor(),
  })
  await audit({ action: 'CREATE', module: 'parking', entityType: 'parking_vehicle', entityId: String(v._id), entityName: v.plate, studentId: v.studentId, summary: `Parking pass ${v.passNo} for ${v.plate} (${v.ownerName})` }, req)
  return getVehicle(v._id, auth)
}

export async function updateVehicle(id, input, auth, req) {
  const v = await vehicleFor(id, auth)
  if (v.status === 'REVOKED') throw conflict('This pass is cancelled. Give a new pass instead.')
  const settings = await parkingSettings()
  const key = await checkVehicle(input, settings, v._id, auth)
  const owner = await ownerOf(input, settings)
  Object.assign(v, {
    ownerKind: input.ownerKind, ...owner, branchId: owner.branchId ?? v.branchId, plate: formatPlate(input.plate), plateKey: key, kind: input.kind, model: input.model || undefined, colour: input.colour || undefined,
    licenceNo: input.licenceNo?.trim() || undefined, areaId: input.areaId || undefined, note: input.note || undefined,
    ...(input.validTo ? { validTo: input.validTo } : {}),
  })
  if (v.validTo < v.validFrom) throw fields('The pass can’t end before it starts.', { validTo: `On or after ${v.validFrom}` })
  await v.save()
  await audit({ action: 'UPDATE', module: 'parking', entityType: 'parking_vehicle', entityId: String(v._id), entityName: v.plate, summary: `Changed parking pass ${v.passNo}` }, req)
  return getVehicle(v._id, auth)
}

/** Another term of the pass: from the day after it ends (or today, once it has lapsed). */
export async function renewVehicle(id, auth, req) {
  const v = await vehicleFor(id, auth)
  if (v.status === 'REVOKED') throw conflict('This pass is cancelled. Give a new pass instead.')
  const settings = await parkingSettings()
  const date = await today()
  const from = v.validTo >= date ? addDaysYmd(v.validTo, 1) : date
  v.validTo = monthsOn(from, settings.passMonths)
  await v.save()
  await audit({ action: 'UPDATE', module: 'parking', entityType: 'parking_vehicle', entityId: String(v._id), entityName: v.plate, summary: `Renewed parking pass ${v.passNo} to ${v.validTo}` }, req)
  return getVehicle(v._id, auth)
}

export async function revokeVehicle(id, { reason }, auth, req) {
  const v = await vehicleFor(id, auth)
  if (v.status === 'REVOKED') throw conflict('This pass is already cancelled.')
  Object.assign(v, { status: 'REVOKED', revokedAt: new Date(), revokedBy: actor(), revokeReason: reason })
  await v.save()
  await audit({ action: 'UPDATE', module: 'parking', entityType: 'parking_vehicle', entityId: String(v._id), entityName: v.plate, summary: `Cancelled parking pass ${v.passNo}: ${reason}` }, req)
  return getVehicle(v._id, auth)
}

/** A pass given by mistake: only before the vehicle has ever come through the gate (after that, cancel it). */
export async function deleteVehicle(id, auth, req) {
  const v = await vehicleFor(id, auth)
  if (await ParkingEntry.exists({ vehicleId: v._id })) throw conflict('This vehicle has come through the gate. Cancel the pass instead of deleting it.')
  await v.deleteOne()
  await audit({ action: 'DELETE', module: 'parking', entityType: 'parking_vehicle', entityId: String(v._id), entityName: v.plate, summary: `Deleted parking pass ${v.passNo}` }, req)
  return { id: String(v._id) }
}

// ───────────────────────────────────────────────────────── the gate

const minutesSince = (d) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000))
const entryOut = (areas, visitorHours = 0) => (e) => {
  const minutes = minutesSince(e.inAt)
  const end = e.outAt ? Math.round((new Date(e.outAt) - new Date(e.inAt)) / 60000) : minutes
  return {
    id: String(e._id), date: e.date, areaId: idStr(e.areaId), areaName: areas.get(String(e.areaId)) ?? null, vehicleId: idStr(e.vehicleId), passNo: e.passNo ?? null,
    parker: e.parker, plate: e.plate, kind: e.kind, name: e.name ?? null, mobile: e.mobile ?? null, purpose: e.purpose ?? null,
    inAt: e.inAt, outAt: e.outAt ?? null, inBy: e.inBy ?? null, outBy: e.outBy ?? null, minutes: end, overFull: !!e.overFull, note: e.note ?? null,
    long: !e.outAt && e.parker === 'VISITOR' && visitorHours > 0 && minutes > visitorHours * 60,
  }
}
const areaNames = async (rows) => new Map((await ParkingArea.find({ _id: { $in: [...new Set(rows.map((r) => String(r.areaId)).filter((x) => isOid(x)))] } }).select('name').lean()).map((a) => [String(a._id), a.name]))

/** The gate's screen: each area's fill, what is parked now, and today's numbers. */
export async function gateDesk(auth) {
  const [date, settings, scope] = [await today(), await parkingSettings(), await campusFilter(auth)]
  const areas = await listAreas(auth)
  const inside = await ParkingEntry.find({ outAt: null, ...scope }).sort({ inAt: -1 }).lean()
  const names = await areaNames(inside)
  const todays = await ParkingEntry.aggregate([{ $match: { date, ...scope } }, { $group: { _id: '$parker', n: { $sum: 1 } } }])
  const by = Object.fromEntries(todays.map((r) => [r._id, r.n]))
  const rows = inside.map(entryOut(names, settings.visitorHours))
  return {
    date, visitorHours: settings.visitorHours, areas, inside: rows,
    stats: {
      inside: rows.length, visitorsInside: rows.filter((r) => r.parker === 'VISITOR').length, longStay: rows.filter((r) => r.long).length,
      today: Object.values(by).reduce((n, x) => n + x, 0), todayVisitors: by.VISITOR ?? 0, fullAreas: areas.filter((a) => a.full).length,
    },
  }
}

/** A plate or pass number typed or scanned at the gate: the pass (if any) and whether it is parked now. */
export async function gateLookup(text, auth) {
  const raw = String(text ?? '').trim()
  const key = plateKey(raw)
  if (key.length < 3) return { query: raw, vehicle: null, inside: null, matches: [] }
  const scope = await campusFilter(auth)
  const date = await today()
  let v = await ParkingVehicle.findOne({ passNo: raw.toUpperCase(), ...scope }).lean()
    ?? await ParkingVehicle.findOne({ plateKey: key, status: 'ACTIVE', ...scope }).lean()
    ?? await ParkingVehicle.findOne({ plateKey: key, ...scope }).sort({ createdAt: -1 }).lean()
  // a few digits (the end of a plate, "1234"): the passes that end that way
  let matches = []
  if (!v && /^\d{3,4}$/.test(key)) {
    const found = await ParkingVehicle.find({ plateKey: new RegExp(`${key}$`), status: 'ACTIVE', ...scope }).limit(8).lean()
    if (found.length === 1) [v] = found
    else matches = found.map((x) => vehicleOut(x, date))
  }
  const inside = await ParkingEntry.findOne({ plateKey: v?.plateKey ?? key, outAt: null, ...scope }).lean()
  const names = await areaNames([inside, v].filter(Boolean))
  return {
    query: raw, plate: formatPlate(raw), matches,
    vehicle: v ? vehicleOut(v, date, { areaName: names.get(String(v.areaId)) ?? null }) : null,
    inside: inside ? entryOut(names)(inside) : null,
  }
}

/** Into the lot: a pass holder (vehicleId) or a visitor (plate, name …). A full area needs `overFull`. */
export async function markIn(input, auth, req) {
  const scope = await campusFilter(auth)
  const date = await today()
  let v = null
  let entry
  if (input.vehicleId) {
    v = await vehicleFor(input.vehicleId, auth)
    const state = passState(v, date)
    if (state === 'REVOKED') throw conflict(`Pass ${v.passNo} is cancelled. Note the vehicle as a visitor instead.`)
    if (state === 'EXPIRED') throw conflict(`Pass ${v.passNo} ended on ${v.validTo}. Renew it, or note the vehicle as a visitor.`)
    entry = { vehicleId: v._id, passNo: v.passNo, parker: v.ownerKind, plate: v.plate, plateKey: v.plateKey, kind: v.kind, name: v.ownerName, mobile: v.ownerMobile }
  } else {
    const key = plateKey(input.plate)
    if (key.length < 4) throw fields('Enter the number plate.', { plate: 'Enter the number plate' })
    if (!input.name?.trim()) throw fields('Enter the driver’s name.', { name: 'Enter the name' })
    entry = { parker: 'VISITOR', plate: formatPlate(input.plate), plateKey: key, kind: input.kind, name: input.name.trim(), mobile: input.mobile || undefined, purpose: input.purpose || undefined }
  }
  const already = await ParkingEntry.findOne({ plateKey: entry.plateKey, outAt: null, ...scope }).lean()
  if (already) throw conflict(`${entry.plate} is already parked inside (since ${hhmmIn(already.inAt, await timeZoneOf())}). Mark it out first.`)
  const areaId = input.areaId || v?.areaId
  let overFull
  let area = null
  if (areaId) {
    area = await areaFor(areaId, auth)
    if (!areaTakes(area, entry.parker, entry.kind)) throw fields(`${area.name} doesn’t take this vehicle. Pick another area.`, { areaId: 'Doesn’t take this vehicle' })
    const n = await ParkingEntry.countDocuments({ areaId: area._id, outAt: null })
    if (area.capacity && n >= area.capacity) {
      if (!input.overFull) throw conflict(`${area.name} is full (${n} of ${area.capacity}).`, { code: 'AREA_FULL', area: area.name, inside: n, capacity: area.capacity })
      overFull = true
    }
  }
  const e = await ParkingEntry.create({ ...entry, date, branchId: area?.branchId ?? v?.branchId ?? campusOf(auth), areaId: areaId || undefined, inAt: new Date(), inBy: actor(), overFull, note: input.note || undefined })
  await audit({ action: 'CREATE', module: 'parking', entityType: 'parking_entry', entityId: String(e._id), entityName: e.plate, summary: `${e.plate} in${e.passNo ? ` on pass ${e.passNo}` : ' (visitor)'}` }, req)
  return entryOut(await areaNames([e]))(e.toObject())
}

export async function markOut(id, auth, req) {
  const e = isOid(String(id ?? '')) ? await ParkingEntry.findOne({ _id: id, ...(await campusFilter(auth)) }) : null
  if (!e) throw notFound('Parking entry')
  if (e.outAt) throw conflict(`${e.plate} was already marked out.`)
  Object.assign(e, { outAt: new Date(), outBy: actor() })
  await e.save()
  await audit({ action: 'UPDATE', module: 'parking', entityType: 'parking_entry', entityId: String(e._id), entityName: e.plate, summary: `${e.plate} out` }, req)
  return entryOut(await areaNames([e]))(e.toObject())
}

/** The gate log: in and out over some days, by who parks, or a search on plate / name / pass no. */
export async function listEntries(q, auth) {
  const date = await today()
  const filter = { ...(await campusFilter(auth)), date: { $gte: q.from || date, $lte: q.to || date } }
  if (q.parker) filter.parker = q.parker
  if (q.areaId) filter.areaId = q.areaId
  const s = q.search?.trim()
  if (s) filter.$or = [{ plateKey: new RegExp(escapeRegex(plateKey(s))) }, { name: new RegExp(escapeRegex(s), 'i') }, { passNo: s.toUpperCase() }]
  const [rows, total] = await Promise.all([
    ParkingEntry.find(filter).sort({ inAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    ParkingEntry.countDocuments(filter),
  ])
  return { total, rows: rows.map(entryOut(await areaNames(rows))) }
}

// ───────────────────────────────────────────────────────── scan

/** A parking sticker (its pass no.) or a number plate read by the app's Scan: the vehicle, and In / Out. */
export async function vehicleScanResult(code, auth, can) {
  if (!can('parking.gate.view', 'parking.vehicles.view')) return null
  const key = plateKey(code)
  if (key.length < 4) return null
  const scope = await campusFilter(auth)
  const v = await ParkingVehicle.findOne({ passNo: String(code).toUpperCase(), ...scope }).lean() ?? await ParkingVehicle.findOne({ plateKey: key, status: 'ACTIVE', ...scope }).lean()
  if (!v) return null
  const date = await today()
  const state = passState(v, date)
  const inside = await ParkingEntry.findOne({ plateKey: v.plateKey, outAt: null, ...scope }).lean()
  const area = await areaNames([inside ?? v])
  const gate = can('parking.gate.create')
  return {
    kind: 'VEHICLE', id: String(v._id), title: v.plate,
    subtitle: [v.ownerName, v.classLabel, PARKING_VEHICLE_KIND_BY[v.kind]?.label, v.model].filter(Boolean).join(' · '),
    status: state === 'ACTIVE' ? null : state,
    parking: { passNo: v.passNo, validTo: v.validTo, area: area.get(String((inside ?? v).areaId)) ?? null, inside: !!inside, inAt: inside?.inAt ?? null },
    actions: [
      gate && inside && { key: 'parkingOut', post: `/v1/scan/parking/entry/${inside._id}/out` },
      gate && !inside && state === 'ACTIVE' && { key: 'parkingIn', post: `/v1/scan/parking/${v._id}/in` },
      can('parking.vehicles.view') && { key: 'parkingPass', link: `/parking/vehicles?open=${v._id}` },
    ].filter(Boolean),
  }
}

// ───────────────────────────────────────────────────────── the gate scanner

/**
 * One read at the gate scanner (a sticker's QR, a scanner gun, or a plate typed in): the entry or the exit is recorded
 * at once. `direction` IN (entry gate), OUT (exit gate) or AUTO (one gate: in when outside, out when parked inside).
 * Never throws for a vehicle that can't pass — it says why (`result`), so the guard can act:
 *   IN · OUT · ALREADY_IN · NOT_INSIDE · NO_PASS · EXPIRED · REVOKED · AREA_FULL · REFUSED
 */
export async function gateScanCode({ code, direction = 'AUTO' }, auth, req) {
  const raw = String(code ?? '').trim()
  const key = plateKey(raw)
  if (key.length < 3) throw fields('Scan the sticker or type the number plate.', { code: 'Too short' })
  const scope = await campusFilter(auth)
  const date = await today()
  const v = await ParkingVehicle.findOne({ passNo: raw.toUpperCase(), ...scope }).lean()
    ?? await ParkingVehicle.findOne({ plateKey: key, status: 'ACTIVE', ...scope }).lean()
    ?? await ParkingVehicle.findOne({ plateKey: key, ...scope }).sort({ createdAt: -1 }).lean()
  const inside = await ParkingEntry.findOne({ plateKey: v?.plateKey ?? key, outAt: null, ...scope }).lean()
  const names = await areaNames([inside, v].filter(Boolean))
  const base = { code: raw, direction, plate: v?.plate ?? formatPlate(raw), at: new Date(), vehicle: v ? vehicleOut(v, date, { areaName: names.get(String(v.areaId)) ?? null }) : null }
  if (direction === 'OUT' || (direction === 'AUTO' && inside)) {
    if (!inside) return { ...base, result: 'NOT_INSIDE' }
    return { ...base, result: 'OUT', entry: await markOut(inside._id, auth, req) }
  }
  if (inside) return { ...base, result: 'ALREADY_IN', entry: entryOut(names)(inside) }
  if (!v) return { ...base, result: 'NO_PASS' }
  const state = passState(v, date)
  if (state !== 'ACTIVE') return { ...base, result: state }
  try {
    return { ...base, result: 'IN', entry: await markIn({ vehicleId: v._id }, auth, req) }
  } catch (err) {
    if (err?.details?.code === 'AREA_FULL') return { ...base, result: 'AREA_FULL', area: err.details.area, inside: err.details.inside, capacity: err.details.capacity }
    if (err?.status === 409 || err?.status === 400) return { ...base, result: 'REFUSED', message: err.message }
    throw err
  }
}
