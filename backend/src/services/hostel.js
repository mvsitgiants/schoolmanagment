import {
  BED_MANUAL_STATES, HOSTEL_DEFAULTS, MEALS, MESS_DAYS, OUTPASS_KINDS, OUTPASS_OPEN, bedCode, bedLabels, lateMinutes, occupancyPct, sectionLabel, weekDayOf,
} from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { HostelAllotment, HostelBlock, HostelRoom, MessCount, MessMenu, Outpass } from '../models/hostel.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { hhmmIn, institutionNow, timeZoneOf, zonedDate } from '../platform/time.js'
import { usersWith } from './hrmsCommon.js'
import { humanDate, notifyUsers } from './notify.js'
import { need, studentFor } from './portal.js'

// Hostel (module `hostel`): blocks, floors, rooms and beds (the bed board); which student sleeps where (allotment,
// move, checkout — one bed per student, one student per bed); outpasses (asked by the warden or a parent in the
// family app, approved, marked out at the gate and back in, late or not — the guardian is told at each step); and
// the mess: a weekly menu per block (or one common menu) and how many ate each meal.

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const dupKey = (err) => err?.code === 11000
export const hostelSettings = async () => ({ ...HOSTEL_DEFAULTS, ...(await getSettings('hostel')) })

/** Campus scope: someone on one campus sees its blocks (and the ones on no campus). */
function siteFilter(auth) {
  if (!auth || scopeOf(auth, 'hostel') === 'ALL' || !auth.user?.branchId) return {}
  return { branchId: { $in: [oid(auth.user.branchId), null] } }
}
const blocksInScope = (auth, extra = {}) => HostelBlock.find({ ...siteFilter(auth), ...extra }).sort({ name: 1 }).lean()

export async function studentLabels(ids) {
  const students = await Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo rollNo sectionId status gender guardians branchId').lean()
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const sec = new Map(sections.map((s) => [String(s._id), { label: sectionLabel(cls.get(String(s.classId)), s, { short: true }), classCode: cls.get(String(s.classId))?.code ?? null }]))
  return new Map(students.map((s) => {
    const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
    const c = sec.get(String(s.sectionId))
    return [String(s._id), { id: String(s._id), name: studentName(s), firstName: s.firstName, admissionNo: s.admissionNo, className: c?.label ?? '', classCode: c?.classCode ?? null, gender: s.gender ?? null, status: s.status, guardian: g?.name ?? null, relation: g?.relation ?? null, mobile: g?.mobile ?? null }]
  }))
}

// ───────────────────────────────────────────────────────── blocks

const tally = (beds) => {
  const c = { total: beds.length, FREE: 0, OCCUPIED: 0, RESERVED: 0, BLOCKED: 0 }
  for (const b of beds) c[b.state]++
  return { ...c, occupancy: occupancyPct({ occupied: c.OCCUPIED, total: c.total, blocked: c.BLOCKED }) }
}

export async function listBlocks(auth) {
  return (await board(auth)).blocks.map(({ rooms, ...b }) => ({ ...b, rooms: rooms.length }))
}

export async function saveBlock(id, input, auth, req) {
  if (await HostelBlock.exists({ name: input.name, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: 'Another block has this name' })
  const b = id ? await HostelBlock.findOne({ _id: id, ...siteFilter(auth) }) : new HostelBlock({ branchId: auth.user?.branchId })
  if (!b) throw notFound('Block')
  for (const k of ['name', 'code', 'kind', 'floors', 'warden', 'notes', 'active']) if (input[k] !== undefined) b[k] = input[k]
  await b.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hostel', entityType: 'hostel_block', entityId: String(b._id), entityName: b.name, summary: `${id ? 'Changed' : 'Added'} hostel block ${b.name}` }, req)
  return clean(b.toObject())
}

export async function deleteBlock(id, auth, req) {
  const b = isOid(id) ? await HostelBlock.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!b) throw notFound('Block')
  if (await HostelAllotment.exists({ blockId: b._id, active: true })) throw conflict('Students live in this block. Check them out or move them first.')
  if (await HostelAllotment.exists({ blockId: b._id })) {
    b.active = false
    await b.save()
    await HostelRoom.updateMany({ blockId: b._id }, { $set: { active: false } })
  } else {
    await HostelRoom.deleteMany({ blockId: b._id })
    await HostelBlock.deleteOne({ _id: b._id })
  }
  await audit({ action: 'DELETE', module: 'hostel', entityType: 'hostel_block', entityId: String(b._id), entityName: b.name, summary: `Removed hostel block ${b.name}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── the bed board

/**
 * Every block in scope, floor by floor: rooms with their beds — free, occupied (and by whom, and whether they are out
 * on a pass now), reserved or blocked — and the counts for the side list and the tiles.
 */
export async function board(auth) {
  const blocks = await blocksInScope(auth, { active: true })
  const rooms = await HostelRoom.find({ blockId: { $in: blocks.map((b) => b._id) }, active: true }).lean()
  const allots = await HostelAllotment.find({ blockId: { $in: blocks.map((b) => b._id) }, active: true }).lean()
  const labels = await studentLabels(allots.map((a) => a.studentId))
  const out = new Set((await Outpass.find({ studentId: { $in: allots.map((a) => a.studentId) }, status: 'OUT' }).select('studentId').lean()).map((o) => String(o.studentId)))
  const byBed = new Map(allots.map((a) => [String(a.bedId), a]))
  const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : Infinity)
  const outBlocks = blocks.map((b) => {
    const mine = rooms.filter((r) => String(r.blockId) === String(b._id))
      .sort((x, y) => x.floor - y.floor || num(x.number) - num(y.number) || x.number.localeCompare(y.number))
      .map((r) => ({
        id: String(r._id), number: r.number, floor: r.floor, type: r.type, ac: !!r.ac, fee: r.fee ?? null, notes: r.notes ?? null,
        beds: r.beds.map((bed) => {
          const a = byBed.get(String(bed._id))
          return {
            id: String(bed._id), label: bed.label, code: bedCode(b.code, r.number, bed.label), state: a ? 'OCCUPIED' : bed.state, note: bed.note ?? null,
            allotment: a ? { id: String(a._id), from: a.from, student: labels.get(String(a.studentId)) ?? null, out: out.has(String(a.studentId)) } : null,
          }
        }),
      }))
    return {
      id: String(b._id), name: b.name, code: b.code ?? null, kind: b.kind, floors: b.floors ?? 1, branchId: idStr(b.branchId), notes: b.notes ?? null,
      warden: b.warden?.name ? { name: b.warden.name, mobile: b.warden.mobile ?? null, userId: idStr(b.warden.userId) } : null,
      counts: tally(mine.flatMap((r) => r.beds)), rooms: mine,
    }
  })
  const pending = await Outpass.countDocuments({ blockId: { $in: blocks.map((b) => b._id) }, status: 'REQUESTED' })
  return { blocks: outBlocks, counts: tally(outBlocks.flatMap((b) => b.rooms.flatMap((r) => r.beds))), outNow: out.size, pendingOutpasses: pending }
}

// ───────────────────────────────────────────────────────── rooms and beds

async function blockFor(blockId, auth) {
  const b = isOid(blockId) ? await HostelBlock.findOne({ _id: blockId, active: true, ...siteFilter(auth) }).lean() : null
  if (!b) throw fieldsError({ blockId: 'Pick a block' })
  return b
}

const roomOut = (r, b) => ({
  ...clean(r), blockId: String(r.blockId),
  beds: r.beds.map((x) => ({ id: String(x._id), label: x.label, code: bedCode(b?.code, r.number, x.label), state: x.state, note: x.note ?? null })),
})

const nextLabels = (beds, n) => {
  const used = new Set(beds.map((b) => b.label))
  return bedLabels(n + beds.length + 26).filter((l) => !used.has(l)).slice(0, n)
}

export async function saveRoom(id, input, auth, req) {
  const r = id ? await HostelRoom.findById(id) : new HostelRoom({ blockId: input.blockId })
  if (!r) throw notFound('Room')
  const b = await blockFor(id ? r.blockId : input.blockId, auth)
  if (input.blockId && String(input.blockId) !== String(b._id)) throw fieldsError({ blockId: 'A room stays in its block; add it again in the other block' })
  if (await HostelRoom.exists({ blockId: b._id, number: input.number.toUpperCase(), ...(id && { _id: { $ne: id } }) })) throw fieldsError({ number: 'This block already has this room' })
  for (const k of ['floor', 'number', 'type', 'ac', 'notes']) if (input[k] !== undefined) r[k] = input[k]
  if (input.fee !== undefined) r.fee = input.fee ?? undefined
  const want = input.capacity
  if (want > r.beds.length) {
    for (const label of nextLabels(r.beds, want - r.beds.length)) r.beds.push({ label, state: 'FREE' })
  } else if (want < r.beds.length) {
    const drop = r.beds.slice(want)
    if (await HostelAllotment.exists({ bedId: { $in: drop.map((x) => x._id) }, active: true })) throw conflict('A bed you are taking away has a student in it. Move them first.')
    r.beds = r.beds.slice(0, want)
  }
  await r.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hostel', entityType: 'hostel_room', entityId: String(r._id), entityName: `${b.name} ${r.number}`, summary: `${id ? 'Changed' : 'Added'} room ${r.number} in ${b.name} (${r.beds.length} bed${r.beds.length === 1 ? '' : 's'})` }, req)
  return roomOut(r.toObject(), b)
}

/** Add a run of rooms on a floor (e.g. 101–110), each with the same type and beds. Rooms already there are skipped. */
export async function addRooms(input, auth, req) {
  const b = await blockFor(input.blockId, auth)
  if (input.to < input.from) throw fieldsError({ to: 'After the first number' })
  if (input.to - input.from >= 100) throw fieldsError({ to: 'Up to 100 rooms at a time' })
  const have = new Set((await HostelRoom.find({ blockId: b._id }).select('number').lean()).map((r) => r.number))
  const rows = []
  for (let n = input.from; n <= input.to; n++) {
    const number = `${input.prefix ?? ''}${n}`.toUpperCase()
    if (have.has(number)) continue
    rows.push({ blockId: b._id, floor: input.floor, number, type: input.type, ac: input.ac, fee: input.fee ?? undefined, beds: bedLabels(input.capacity).map((label) => ({ label, state: 'FREE' })) })
  }
  if (rows.length) await HostelRoom.insertMany(rows)
  await audit({ action: 'CREATE', module: 'hostel', entityType: 'hostel_block', entityId: String(b._id), entityName: b.name, summary: `Added ${rows.length} room(s) on floor ${input.floor} of ${b.name}` }, req)
  return { created: rows.length, skipped: input.to - input.from + 1 - rows.length }
}

export async function deleteRoom(id, auth, req) {
  const r = isOid(id) ? await HostelRoom.findById(id) : null
  if (!r) throw notFound('Room')
  await blockFor(r.blockId, auth)
  if (await HostelAllotment.exists({ roomId: r._id, active: true })) throw conflict('Students live in this room. Move them first.')
  if (await HostelAllotment.exists({ roomId: r._id })) { r.active = false; await r.save() } else await HostelRoom.deleteOne({ _id: r._id })
  await audit({ action: 'DELETE', module: 'hostel', entityType: 'hostel_room', entityId: String(r._id), entityName: r.number, summary: `Removed room ${r.number}` }, req)
  return { deleted: true }
}

/** Hold a bed for someone, take it out of use, or free it again (a bed with a student in it can't change). */
export async function setBedState(roomId, bedId, { state, note }, auth, req) {
  if (!BED_MANUAL_STATES.includes(state)) throw badRequest('Pick free, reserved or blocked.')
  const r = isOid(roomId) ? await HostelRoom.findById(roomId) : null
  if (!r) throw notFound('Room')
  await blockFor(r.blockId, auth)
  const bed = r.beds.id(bedId)
  if (!bed) throw notFound('Bed')
  if (await HostelAllotment.exists({ bedId: bed._id, active: true })) throw conflict('A student is in this bed. Check them out or move them first.')
  if (state !== 'FREE' && !note) throw fieldsError({ note: state === 'RESERVED' ? 'Say who it is held for' : 'Say why it is out of use' })
  bed.state = state
  bed.note = state === 'FREE' ? undefined : note
  await r.save()
  await audit({ action: 'UPDATE', module: 'hostel', entityType: 'hostel_room', entityId: String(r._id), entityName: `${r.number}-${bed.label}`, summary: `Bed ${r.number}-${bed.label}: ${state.toLowerCase()}${note ? ` (${note})` : ''}` }, req)
  return { id: String(bed._id), state: bed.state, note: bed.note ?? null }
}

// ───────────────────────────────────────────────────────── allotment

async function freeBed(bedId, auth) {
  const r = isOid(bedId) ? await HostelRoom.findOne({ 'beds._id': bedId, active: true }) : null
  if (!r) throw fieldsError({ bedId: 'Pick a bed' })
  const b = await blockFor(r.blockId, auth)
  const bed = r.beds.id(bedId)
  if (bed.state === 'BLOCKED') throw fieldsError({ bedId: 'This bed is out of use' })
  if (await HostelAllotment.exists({ bedId: bed._id, active: true })) throw fieldsError({ bedId: 'Someone is already in this bed' })
  return { room: r, block: b, bed }
}

const genderWarning = (block, student) => {
  if (block.kind === 'BOYS' && student.gender === 'FEMALE') return `${block.name} is a boys’ block.`
  if (block.kind === 'GIRLS' && student.gender === 'MALE') return `${block.name} is a girls’ block.`
  return null
}

async function placeIn({ student, bedId, from, note }, auth) {
  const { room, block, bed } = await freeBed(bedId, auth)
  let a
  try {
    a = await HostelAllotment.create({ studentId: student._id, blockId: block._id, roomId: room._id, bedId: bed._id, branchId: block.branchId, from, note, by: auth.user?.name })
  } catch (err) {
    if (dupKey(err)) throw conflict('That bed or student was just allotted by someone else. Refresh and try again.')
    throw err
  }
  if (bed.state === 'RESERVED') { bed.state = 'FREE'; bed.note = undefined; await room.save() }
  return { a, room, block, bed }
}

export async function listAllotments({ blockId, search, history }, auth) {
  const blocks = await blocksInScope(auth)
  const ids = isOid(blockId) ? [oid(blockId)] : blocks.map((b) => b._id)
  const rows = await HostelAllotment.find({ blockId: { $in: ids }, ...(history ? {} : { active: true }) }).sort({ active: -1, from: -1 }).limit(history ? 1000 : 5000).lean()
  const [labels, rooms] = await Promise.all([studentLabels(rows.map((r) => r.studentId)), HostelRoom.find({ _id: { $in: [...new Set(rows.map((r) => String(r.roomId)))] } }).select('number floor type ac fee beds').lean()])
  const blockOf = new Map(blocks.map((b) => [String(b._id), b]))
  const roomOf = new Map(rooms.map((r) => [String(r._id), r]))
  const out = new Set((await Outpass.find({ studentId: { $in: rows.filter((r) => r.active).map((r) => r.studentId) }, status: 'OUT' }).select('studentId').lean()).map((o) => String(o.studentId)))
  const q = String(search ?? '').trim().toLowerCase()
  return rows.map((a) => {
    const b = blockOf.get(String(a.blockId))
    const r = roomOf.get(String(a.roomId))
    const bed = r?.beds.find((x) => String(x._id) === String(a.bedId))
    return {
      ...clean(a), studentId: String(a.studentId), blockId: String(a.blockId), roomId: String(a.roomId), bedId: String(a.bedId), branchId: idStr(a.branchId),
      student: labels.get(String(a.studentId)) ?? null, block: b?.name ?? '', blockKind: b?.kind ?? null, room: r?.number ?? '', floor: r?.floor ?? null, roomType: r?.type ?? null, ac: !!r?.ac,
      bed: bed?.label ?? '', bedCode: bedCode(b?.code, r?.number, bed?.label), fee: r?.fee ?? null, out: a.active && out.has(String(a.studentId)),
    }
  }).filter((x) => !q || (x.student?.name ?? '').toLowerCase().includes(q) || (x.student?.admissionNo ?? '').toLowerCase().includes(q) || x.bedCode.toLowerCase().includes(q))
}

/** A student's hostel story: every bed they had, and their outpasses. */
export async function studentHistory(studentId, auth) {
  if (!isOid(studentId)) throw notFound('Student')
  const labels = await studentLabels([studentId])
  if (!labels.size) throw notFound('Student')
  const all = (await listAllotments({ history: true }, auth)).filter((a) => a.studentId === String(studentId))
  const passes = await Outpass.find({ studentId }).sort({ createdAt: -1 }).limit(50).lean()
  return { student: labels.get(String(studentId)), allotments: all, outpasses: passes.map(outpassOut) }
}

export async function allot(input, auth, req) {
  const s = isOid(input.studentId) ? await Student.findById(input.studentId).select('firstName middleName lastName status gender').lean() : null
  if (!s || s.status !== 'ACTIVE') throw fieldsError({ studentId: 'Pick a current student' })
  const prev = await HostelAllotment.findOne({ studentId: s._id, active: true }).lean()
  if (prev) throw conflict(`${studentName(s)} already has a bed. Use Move to change it.`)
  const from = input.from || await today()
  const { a, room, block, bed } = await placeIn({ student: s, bedId: input.bedId, from, note: input.note }, auth)
  await audit({ action: 'CREATE', module: 'hostel', entityType: 'hostel_allotment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} allotted ${bedCode(block.code, room.number, bed.label)} in ${block.name} from ${from}` }, req)
  return { ...clean(a.toObject()), warning: genderWarning(block, s) }
}

/** Move a student to another bed from a date: the old allotment ends the night before. */
export async function moveAllotment(id, input, auth, req) {
  const old = isOid(id) ? await HostelAllotment.findOne({ _id: id, active: true }) : null
  if (!old) throw notFound('Allotment')
  if (String(old.bedId) === String(input.bedId)) throw fieldsError({ bedId: 'Pick a different bed' })
  const s = await Student.findById(old.studentId).select('firstName middleName lastName gender').lean()
  const from = input.from || await today()
  if (from < old.from) throw fieldsError({ from: `On or after ${old.from}` })
  await freeBed(input.bedId, auth) // check first, so a refused move leaves the old bed alone
  Object.assign(old, { active: false, to: from > old.from ? addDays(from, -1) : old.from, endReason: 'MOVED', endedBy: auth.user?.name })
  await old.save()
  try {
    const { a, room, block, bed } = await placeIn({ student: s, bedId: input.bedId, from, note: input.note }, auth)
    await audit({ action: 'UPDATE', module: 'hostel', entityType: 'hostel_allotment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} moved to ${bedCode(block.code, room.number, bed.label)} in ${block.name} from ${from}` }, req)
    return { ...clean(a.toObject()), warning: genderWarning(block, s) }
  } catch (err) {
    Object.assign(old, { active: true, to: undefined, endReason: undefined, endedBy: undefined })
    await old.save()
    throw err
  }
}

export async function checkout(id, { to, reason, note }, auth, req) {
  const a = isOid(id) ? await HostelAllotment.findOne({ _id: id, active: true }) : null
  if (!a) throw notFound('Allotment')
  await blockFor(a.blockId, auth)
  const end = to || await today()
  if (end < a.from) throw fieldsError({ to: `On or after ${a.from}` })
  if (await Outpass.exists({ studentId: a.studentId, status: 'OUT' })) throw conflict('The student is out on a pass. Mark them back in first.')
  Object.assign(a, { active: false, to: end, endReason: reason, endNote: note, endedBy: auth.user?.name })
  await a.save()
  await Outpass.updateMany({ studentId: a.studentId, status: { $in: ['REQUESTED', 'APPROVED'] } }, { $set: { status: 'CANCELLED', decisionNote: 'Checked out of the hostel' } })
  const s = await Student.findById(a.studentId).select('firstName middleName lastName').lean()
  await audit({ action: 'UPDATE', module: 'hostel', entityType: 'hostel_allotment', entityId: String(a._id), entityName: studentName(s), studentId: a.studentId, summary: `${studentName(s)} checked out of the hostel on ${end} (${reason})` }, req)
  return { ended: true }
}

// ───────────────────────────────────────────────────────── outpasses

function outpassOut(o) {
  return {
    ...clean(o), studentId: String(o.studentId), blockId: idStr(o.blockId), branchId: idStr(o.branchId),
    overdue: o.status === 'OUT' && o.returnBy && new Date(o.returnBy).getTime() < Date.now(),
  }
}

export async function listOutpasses({ view = 'OPEN', status, blockId, search, from, to }, auth) {
  const blocks = await blocksInScope(auth)
  const f = { $or: [{ blockId: { $in: blocks.map((b) => b._id) } }, { blockId: null, ...siteFilter(auth) }] }
  if (isOid(blockId)) { delete f.$or; f.blockId = oid(blockId) }
  if (status) f.status = status
  else if (view === 'OPEN') f.status = { $in: OUTPASS_OPEN }
  if (view === 'ALL' && (from || to)) f.leaveDate = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const rows = await Outpass.find(f).sort({ leaveAt: view === 'OPEN' ? 1 : -1 }).limit(view === 'OPEN' ? 2000 : 500).lean()
  const labels = await studentLabels(rows.map((r) => r.studentId))
  const blockOf = new Map(blocks.map((b) => [String(b._id), b]))
  const q = String(search ?? '').trim().toLowerCase()
  const list = rows.map((o) => ({ ...outpassOut(o), student: labels.get(String(o.studentId)) ?? null, block: blockOf.get(String(o.blockId))?.name ?? null }))
    .filter((x) => !q || (x.student?.name ?? '').toLowerCase().includes(q) || (x.student?.admissionNo ?? '').toLowerCase().includes(q) || x.outpassNo.toLowerCase().includes(q))
  const scope = { $or: f.$or ?? [{ blockId: f.blockId }] }
  const counts = Object.fromEntries((await Outpass.aggregate([{ $match: { ...scope, status: { $in: OUTPASS_OPEN } } }, { $group: { _id: '$status', n: { $sum: 1 } } }])).map((c) => [c._id, c.n]))
  const t = await today()
  return {
    rows: list,
    counts: {
      REQUESTED: counts.REQUESTED ?? 0, APPROVED: counts.APPROVED ?? 0, OUT: counts.OUT ?? 0,
      overdue: await Outpass.countDocuments({ ...scope, status: 'OUT', returnBy: { $lt: new Date() } }),
      backToday: await Outpass.countDocuments({ ...scope, status: 'RETURNED', inAt: { $gte: zonedDate(t, '00:00', await timeZoneOf()) } }),
    },
  }
}

async function outpassFor(id, auth) {
  const o = isOid(id) ? await Outpass.findById(id) : null
  if (!o) throw notFound('Outpass')
  if (o.blockId) {
    const ok = await HostelBlock.exists({ _id: o.blockId, ...siteFilter(auth) })
    if (!ok) throw notFound('Outpass')
  }
  return o
}

const when = (ymd, hhmm) => `${humanDate(ymd)} ${hhmm}`

async function tellFamily(event, o, extra = {}) {
  const s = await Student.findById(o.studentId).select('sectionId').lean()
  let cls = ''
  if (s?.sectionId) {
    const sec = await Section.findById(s.sectionId).lean()
    const c = sec ? await ClassLevel.findById(sec.classId).select('name code').lean() : null
    cls = sec ? sectionLabel(c, sec, { short: true }) : ''
  }
  await emit(event, {
    studentId: String(o.studentId), entity: { type: 'hostel_outpass', id: o._id },
    data: { student: { class: cls }, outpass: { no: o.outpassNo, leave: when(o.leaveDate, o.leaveTime), return: when(o.returnDate, o.returnTime), reason: o.reason, ...extra } },
  })
}

/** Ask for an outpass (the warden, or a parent in the family app). One open outpass per student at a time. */
export async function createOutpass(input, auth, req, { family = null } = {}) {
  const s = isOid(input.studentId) ? await Student.findById(input.studentId).select('firstName middleName lastName status branchId guardians').lean() : null
  if (!s || s.status !== 'ACTIVE') throw fieldsError({ studentId: 'Pick a current student' })
  const stay = await HostelAllotment.findOne({ studentId: s._id, active: true }).lean()
  if (!stay) throw conflict(`${studentName(s)} doesn’t have a hostel bed.`)
  if (!family) await blockFor(stay.blockId, auth)
  if (await Outpass.exists({ studentId: s._id, status: { $in: OUTPASS_OPEN } })) throw conflict(`${studentName(s)} already has an open outpass. Close or cancel it first.`)
  const tz = await timeZoneOf()
  const leaveAt = zonedDate(input.leaveDate, input.leaveTime, tz)
  const returnBy = zonedDate(input.returnDate, input.returnTime, tz)
  if (returnBy <= leaveAt) throw fieldsError({ returnDate: 'After leaving', returnTime: 'After leaving' })
  if (returnBy.getTime() - leaveAt.getTime() > 31 * 864e5) throw fieldsError({ returnDate: 'Up to a month at a time' })
  const t = await today()
  if (input.leaveDate < addDays(t, -1)) throw fieldsError({ leaveDate: 'Not in the past' })
  const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
  const escort = input.escort?.name ? input.escort : family && g ? { name: g.name, relation: g.relation, mobile: g.mobile } : input.escort
  const approveNow = !family && input.approve === true
  const o = await Outpass.create({
    outpassNo: await nextNumber('OUTPASS', { branchId: stay.branchId ?? s.branchId }),
    studentId: s._id, blockId: stay.blockId, branchId: stay.branchId ?? s.branchId, kind: input.kind ?? OUTPASS_KINDS[0].value,
    leaveDate: input.leaveDate, leaveTime: input.leaveTime, returnDate: input.returnDate, returnTime: input.returnTime, leaveAt, returnBy,
    reason: input.reason, destination: input.destination, escort, note: input.note,
    status: approveNow ? 'APPROVED' : 'REQUESTED', requestedBy: family ? 'PARENT' : 'WARDEN', requestedByName: family ?? auth?.user?.name,
    ...(approveNow && { decidedBy: auth.user?.name, decidedAt: new Date() }),
  })
  if (!approveNow) {
    const to = (await usersWith('hostel.outpass.approve')).filter((u) => u !== String(auth?.userId ?? ''))
    await notifyUsers(to, { event: 'hostel.outpass_request', title: `Outpass asked: ${studentName(s)}`, message: `${when(o.leaveDate, o.leaveTime)} to ${when(o.returnDate, o.returnTime)} — ${o.reason}`, link: '/hostel/outpass', tone: 'info', entityType: 'hostel_outpass', entityId: String(o._id) })
  } else if ((await hostelSettings()).alertOutpass) {
    await tellFamily('hostel.outpass_decided', o, { status: 'approved', note: '' })
  }
  await audit({ action: 'CREATE', module: 'hostel', entityType: 'hostel_outpass', entityId: String(o._id), entityName: o.outpassNo, studentId: s._id, summary: `Outpass ${o.outpassNo} for ${studentName(s)}, ${o.leaveDate} ${o.leaveTime} to ${o.returnDate} ${o.returnTime}${family ? ` (asked by ${family})` : ''}${approveNow ? ', approved' : ''}` }, req)
  return outpassOut(o.toObject())
}

export async function decideOutpass(id, { approve, note }, auth, req) {
  const o = await outpassFor(id, auth)
  if (o.status !== 'REQUESTED') throw conflict('Only an outpass waiting for approval can be approved or rejected.')
  if (!approve && !note) throw fieldsError({ note: 'Say why' })
  Object.assign(o, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: auth.user?.name, decidedAt: new Date(), decisionNote: note })
  await o.save()
  if ((await hostelSettings()).alertOutpass) await tellFamily('hostel.outpass_decided', o, { status: approve ? 'approved' : 'not approved', note: note ?? '' })
  await audit({ action: approve ? 'APPROVE' : 'REJECT', module: 'hostel', entityType: 'hostel_outpass', entityId: String(o._id), entityName: o.outpassNo, studentId: o.studentId, summary: `Outpass ${o.outpassNo} ${approve ? 'approved' : 'rejected'}${note ? `: ${note}` : ''}` }, req)
  return outpassOut(o.toObject())
}

/** At the gate: the student leaves (approved → out) or comes back (out → back, late or not). */
export async function gateOutpass(id, direction, auth, req) {
  const o = await outpassFor(id, auth)
  const tz = await timeZoneOf()
  const now = new Date()
  if (direction === 'OUT') {
    if (o.status !== 'APPROVED') throw conflict('Only an approved outpass can be marked out.')
    Object.assign(o, { status: 'OUT', outAt: now, outBy: auth.user?.name })
  } else {
    if (o.status !== 'OUT') throw conflict('This student isn’t out on this pass.')
    const { lateGraceMinutes } = await hostelSettings()
    const late = lateMinutes(o.returnBy, now, lateGraceMinutes)
    Object.assign(o, { status: 'RETURNED', inAt: now, inBy: auth.user?.name, late: late > 0, lateMinutes: late || undefined })
  }
  await o.save()
  if ((await hostelSettings()).alertOutpass) {
    await tellFamily(direction === 'OUT' ? 'hostel.outpass_out' : 'hostel.outpass_in', o, {
      time: hhmmIn(now, tz), ...(direction === 'IN' && { late: o.late ? `${o.lateMinutes} min late` : 'on time' }),
    })
  }
  await audit({ action: 'UPDATE', module: 'hostel', entityType: 'hostel_outpass', entityId: String(o._id), entityName: o.outpassNo, studentId: o.studentId, summary: `Outpass ${o.outpassNo}: ${direction === 'OUT' ? 'left the campus' : `back in${o.late ? `, ${o.lateMinutes} min late` : ''}`}` }, req)
  return outpassOut(o.toObject())
}

export async function cancelOutpass(id, { note }, auth, req) {
  const o = await outpassFor(id, auth)
  if (!['REQUESTED', 'APPROVED'].includes(o.status)) throw conflict('Only an outpass not yet used can be cancelled.')
  Object.assign(o, { status: 'CANCELLED', decisionNote: note, decidedBy: auth.user?.name, decidedAt: new Date() })
  await o.save()
  await audit({ action: 'CANCEL', module: 'hostel', entityType: 'hostel_outpass', entityId: String(o._id), entityName: o.outpassNo, studentId: o.studentId, summary: `Outpass ${o.outpassNo} cancelled${note ? `: ${note}` : ''}` }, req)
  return outpassOut(o.toObject())
}

// ───────────────────────────────────────────────────────── mess

const menuItems = (doc) => MESS_DAYS.flatMap((day) => MEALS.map((m) => ({ day, meal: m.value, dishes: doc?.items?.find((x) => x.day === day && x.meal === m.value)?.dishes ?? '' })))

/** Monday … Sunday of the week a date falls in. */
const weekOf = (ymd) => {
  const start = addDays(ymd, -MESS_DAYS.indexOf(weekDayOf(ymd)))
  return MESS_DAYS.map((day, i) => ({ day, date: addDays(start, i) }))
}

/**
 * The mess for a block (or the common menu when `blockId` is empty): the weekly menu — the block's own or, when it
 * has none, the common one — the week's meal counts, and how many should eat (residents, less those out on a pass).
 */
export async function messView({ blockId, date }, auth) {
  const block = blockId ? await blockFor(blockId, auth) : null
  const blocks = block ? [block] : await blocksInScope(auth, { active: true })
  const [own, common] = await Promise.all([block ? MessMenu.findOne({ blockId: block._id }).lean() : null, MessMenu.findOne({ blockId: null }).lean()])
  const menu = block ? own ?? common : common
  const d = date || await today()
  const week = weekOf(d)
  const counts = await MessCount.find({ blockId: block?._id ?? null, date: { $gte: week[0].date, $lte: week[6].date } }).lean()
  const residents = await HostelAllotment.find({ blockId: { $in: blocks.map((b) => b._id) }, active: true }).select('studentId').lean()
  const outNow = await Outpass.countDocuments({ studentId: { $in: residents.map((r) => r.studentId) }, status: 'OUT' })
  return {
    blockId: block ? String(block._id) : null, own: block ? !!own : !!common, inherited: !!block && !own && !!common,
    items: menuItems(menu), updatedAt: menu?.updatedAt ?? null, updatedBy: menu?.updatedBy ?? null,
    today: await today(), week, counts: counts.map((c) => ({ date: c.date, meal: c.meal, count: c.count, note: c.note ?? null })),
    residents: residents.length, outNow, expected: Math.max(0, residents.length - outNow),
  }
}

export async function saveMenu({ blockId, items }, auth, req) {
  const block = blockId ? await blockFor(blockId, auth) : null
  const keep = items.filter((x) => MESS_DAYS.includes(x.day) && MEALS.some((m) => m.value === x.meal) && x.dishes?.trim()).map((x) => ({ day: x.day, meal: x.meal, dishes: x.dishes.trim() }))
  await MessMenu.updateOne({ blockId: block?._id ?? null }, { $set: { items: keep, branchId: block?.branchId ?? auth.user?.branchId, updatedBy: auth.user?.name } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'hostel', entityType: 'mess_menu', entityId: block ? String(block._id) : 'common', entityName: block?.name ?? 'Common menu', summary: `Changed the mess menu${block ? ` of ${block.name}` : ''} (${keep.length} meals)` }, req)
  return messView({ blockId: block ? String(block._id) : null }, auth)
}

/** A block goes back to the common menu. */
export async function clearMenu(blockId, auth, req) {
  const block = await blockFor(blockId, auth)
  await MessMenu.deleteOne({ blockId: block._id })
  await audit({ action: 'DELETE', module: 'hostel', entityType: 'mess_menu', entityId: String(block._id), entityName: block.name, summary: `${block.name} now uses the common mess menu` }, req)
  return messView({ blockId: String(block._id) }, auth)
}

export async function saveMealCount({ blockId, date, meal, count, note }, auth, req) {
  const block = blockId ? await blockFor(blockId, auth) : null
  if (date > await today()) throw fieldsError({ date: 'Not a future day' })
  await MessCount.updateOne({ blockId: block?._id ?? null, date, meal }, { $set: { count, note, by: auth.user?.name } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'hostel', entityType: 'mess_count', entityId: `${block?._id ?? 'common'}:${date}:${meal}`, entityName: block?.name ?? 'Hostel', summary: `${meal.toLowerCase()} on ${date}: ${count} ate` }, req)
  return { date, meal, count, note: note ?? null }
}

/** Staff logins a block's warden can be linked to. */
export async function staffLogins() {
  const rows = await User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(1000).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

// ───────────────────────────────────────────────────────── the family app (feature HOSTEL)

/** The family app › Hostel: the child's room and bed, the warden, today's menu, and their outpasses. */
export async function familyHostel(f, id) {
  need(f, 'HOSTEL')
  const s = studentFor(f, id)
  const [stay, passes, settings, t] = await Promise.all([
    HostelAllotment.findOne({ studentId: s._id, active: true }).lean(),
    Outpass.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(20).lean(),
    hostelSettings(), today(),
  ])
  if (!stay) return { resident: false, outpasses: passes.map(familyPass), canRequest: false }
  const [block, room, menu] = await Promise.all([
    HostelBlock.findById(stay.blockId).lean(), HostelRoom.findById(stay.roomId).lean(),
    MessMenu.findOne({ blockId: stay.blockId }).lean().then((m) => m ?? MessMenu.findOne({ blockId: null }).lean()),
  ])
  const bed = room?.beds.find((b) => String(b._id) === String(stay.bedId))
  const day = weekDayOf(t)
  return {
    resident: true,
    stay: { block: block?.name ?? '', kind: block?.kind ?? null, room: room?.number ?? '', floor: room?.floor ?? null, bed: bed?.label ?? '', code: bedCode(block?.code, room?.number, bed?.label), ac: !!room?.ac, from: stay.from },
    warden: block?.warden?.name ? { name: block.warden.name, mobile: block.warden.mobile ?? null } : null,
    menuToday: MEALS.map((m) => ({ meal: m.value, time: m.time, dishes: menu?.items?.find((x) => x.day === day && x.meal === m.value)?.dishes ?? null })).filter((x) => x.dishes),
    outpasses: passes.map(familyPass),
    canRequest: !!settings.familyOutpass && !passes.some((p) => OUTPASS_OPEN.includes(p.status)),
    today: t,
  }
}

const familyPass = (o) => ({
  id: String(o._id), outpassNo: o.outpassNo, kind: o.kind, status: o.status, reason: o.reason, destination: o.destination ?? null,
  leaveDate: o.leaveDate, leaveTime: o.leaveTime, returnDate: o.returnDate, returnTime: o.returnTime,
  escort: o.escort?.name ? { name: o.escort.name, relation: o.escort.relation ?? null } : null,
  outAt: o.outAt ?? null, inAt: o.inAt ?? null, late: !!o.late, lateMinutes: o.lateMinutes ?? null,
  decisionNote: o.decisionNote ?? null, byFamily: o.requestedBy === 'PARENT',
})

export async function familyRequestOutpass(f, id, input, req) {
  need(f, 'HOSTEL')
  const s = studentFor(f, id)
  if (!(await hostelSettings()).familyOutpass) throw conflict('Your school takes outpass requests at the hostel office. Please call the warden.')
  const who = f.session?.kind === 'STUDENT' ? `${s.firstName} (student)` : `Parent (•••• ${String(f.session?.mobile ?? '').slice(-4)})`
  await createOutpass({ ...input, studentId: String(s._id), approve: false }, null, req, { family: who })
  return familyHostel(f, id)
}

export async function familyCancelOutpass(f, id, outpassId, req) {
  need(f, 'HOSTEL')
  const s = studentFor(f, id)
  const o = isOid(outpassId) ? await Outpass.findOne({ _id: outpassId, studentId: s._id }) : null
  if (!o) throw notFound('Outpass')
  if (o.status !== 'REQUESTED' || o.requestedBy !== 'PARENT') throw conflict('Only a request you made that is still waiting can be withdrawn. Call the warden for anything else.')
  Object.assign(o, { status: 'CANCELLED', decisionNote: 'Withdrawn in the family app' })
  await o.save()
  await audit({ action: 'CANCEL', module: 'hostel', entityType: 'hostel_outpass', entityId: String(o._id), entityName: o.outpassNo, studentId: s._id, summary: `Outpass ${o.outpassNo} withdrawn in the family app` }, req)
  return familyHostel(f, id)
}
