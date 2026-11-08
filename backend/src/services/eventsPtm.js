import { ACTIVE_BOOKING, addDaysYmd, jitsiUrl, ptmSlots } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { PtmBooking, PtmSession, SchoolEvent } from '../models/events.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { runAsSystem, runAsTenant } from '../platform/context.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { sendEventReminders, today } from './events.js'
import { familyLink } from './familyLink.js'
import { humanDate } from './notify.js'

// Parent–teacher meetings (Events › Parent–teacher meetings): a session — the day, the hours, the slot length — with
// its teachers (hosts), each meeting the parents of some sections (class teachers by default). Opening booking tells
// the families; they book a free slot with each teacher in the app (or the office books for them). On the day the
// teacher marks who came and notes what was discussed. Families are reminded of their slot the day before.

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const sameId = (a, b) => String(a) === String(b)

const slotsOf = (p) => ptmSlots(p.startTime, p.endTime, p.slotMinutes, p.gapMinutes)
const invites = (p, s) => (!p.classIds?.length || p.classIds.some((c) => sameId(c, s.classId))) && (!p.sectionIds?.length || p.sectionIds.some((x) => sameId(x, s.sectionId)))
const hostFor = (h, s) => !h.sectionIds?.length || h.sectionIds.some((x) => sameId(x, s.sectionId))
const lastBookingDay = (p) => p.bookingCloses || addDaysYmd(p.date, -1)
const roomOf = (p, h) => (p.mode === 'ONLINE' ? jitsiUrl(`sg-ptm-${p._id}-${h._id}`) : h.room || '')

async function sectionNames(ids) {
  const sections = await Section.find({ _id: { $in: ids } }).select('name classId').lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), `${cls.get(String(s.classId))?.code ?? cls.get(String(s.classId))?.name ?? ''}-${s.name}`]))
}

/** The students a session invites (active). */
async function invitedStudents(p, select = '_id classId sectionId') {
  const f = { status: 'ACTIVE' }
  if (p.classIds?.length) f.classId = { $in: p.classIds }
  if (p.sectionIds?.length) f.sectionId = { $in: p.sectionIds }
  return Student.find(f).select(select).lean()
}

const sessionOut = (p, extra = {}) => ({
  ...clean(p), classIds: p.classIds.map(String), sectionIds: p.sectionIds.map(String),
  hosts: p.hosts.map((h) => ({ id: String(h._id), userId: h.userId ? String(h.userId) : null, name: h.name, role: h.role ?? null, room: h.room ?? null, sectionIds: h.sectionIds.map(String), away: h.away ?? [] })),
  slots: slotsOf(p), lastBookingDay: lastBookingDay(p), ...extra,
})

export async function listSessions({ when = 'UPCOMING' }) {
  const t = await today()
  const rows = await PtmSession.find(when === 'PAST' ? { date: { $lt: t } } : { date: { $gte: t } }).sort({ date: when === 'PAST' ? -1 : 1 }).limit(200).lean()
  const counts = await PtmBooking.aggregate([{ $match: { sessionId: { $in: rows.map((r) => r._id) }, status: { $in: ACTIVE_BOOKING } } }, { $group: { _id: { s: '$sessionId', st: '$status' }, n: { $sum: 1 } } }])
  return rows.map((p) => {
    const c = counts.filter((x) => sameId(x._id.s, p._id))
    const n = (st) => c.find((x) => x._id.st === st)?.n ?? 0
    return sessionOut(p, { booked: n('BOOKED') + n('ATTENDED') + n('NO_SHOW'), met: n('ATTENDED'), capacity: p.hosts.reduce((k, h) => k + slotsOf(p).length - (h.away?.length ?? 0), 0) })
  })
}

/** A session with each teacher's slots: who is booked when, and which slots are free. */
export async function getSession(id) {
  const p = isOid(id) ? await PtmSession.findById(id).lean() : null
  if (!p) throw notFound('Meeting')
  const bookings = await PtmBooking.find({ sessionId: p._id, status: { $in: ACTIVE_BOOKING } }).lean()
  const students = new Map((await Student.find({ _id: { $in: bookings.map((b) => b.studentId) } }).select('firstName middleName lastName admissionNo sectionId').lean()).map((s) => [String(s._id), s]))
  const names = await sectionNames([...new Set([...bookings.map((b) => b.sectionId), ...p.hosts.flatMap((h) => h.sectionIds), ...p.sectionIds].filter(Boolean).map(String))])
  const invited = await invitedStudents(p, '_id')
  return sessionOut(p, {
    invited: invited.length,
    hostSections: Object.fromEntries(p.hosts.map((h) => [String(h._id), h.sectionIds.map((x) => names.get(String(x))).filter(Boolean)])),
    sectionNames: Object.fromEntries(p.sectionIds.map((x) => [String(x), names.get(String(x)) ?? ''])),
    grid: p.hosts.map((h) => ({
      hostId: String(h._id),
      slots: slotsOf(p).map((time) => {
        const b = bookings.find((x) => sameId(x.hostId, h._id) && x.time === time)
        const s = b && students.get(String(b.studentId))
        return { time, away: (h.away ?? []).includes(time), booking: b ? { id: String(b._id), studentId: String(b.studentId), student: s ? studentName(s) : '', admissionNo: s?.admissionNo ?? '', section: names.get(String(b.sectionId)) ?? '', guardian: b.guardian?.name ?? null, mobile: b.guardian?.mobile ?? null, status: b.status, remarks: b.remarks ?? null, byFamily: b.byFamily } : null }
      }),
    })),
  })
}

/** The class teachers of the sections picked (or of every section), as hosts — one each, meeting their section's parents. */
export async function classTeacherHosts({ classIds = [], sectionIds = [] }) {
  const f = { classTeacherId: { $type: 'objectId' } }
  if (sectionIds.length) f._id = { $in: sectionIds }
  else if (classIds.length) f.classId = { $in: classIds }
  const sections = await Section.find(f).select('name classId classTeacherId').lean()
  const users = new Map((await User.find({ _id: { $in: sections.map((s) => s.classTeacherId) } }).select('name').lean()).map((u) => [String(u._id), u]))
  const names = await sectionNames(sections.map((s) => s._id))
  const byUser = new Map()
  for (const s of sections) {
    const u = users.get(String(s.classTeacherId))
    if (!u) continue
    const h = byUser.get(String(u._id)) ?? { userId: String(u._id), name: u.name, sectionIds: [], labels: [] }
    h.sectionIds.push(String(s._id))
    h.labels.push(names.get(String(s._id)))
    byUser.set(String(u._id), h)
  }
  return [...byUser.values()].map((h) => ({ userId: h.userId, name: h.name, role: `Class teacher ${h.labels.join(', ')}`, room: h.labels.length === 1 ? `Room ${h.labels[0]}` : '', sectionIds: h.sectionIds }))
}

export async function saveSession(id, input, auth, req) {
  if (input.endTime <= input.startTime) throw fieldsError({ endTime: 'Ends before it starts' })
  const slots = ptmSlots(input.startTime, input.endTime, input.slotMinutes, input.gapMinutes)
  if (!slots.length) throw fieldsError({ endTime: 'No slot fits between these times' })
  if (input.bookingCloses && input.bookingCloses > input.date) throw fieldsError({ bookingCloses: 'After the meeting day' })
  const names = new Set()
  for (const h of input.hosts) {
    if (h.userId && names.has(`u${h.userId}`)) throw fieldsError({ hosts: `${h.name} is on the list twice` })
    names.add(`u${h.userId ?? h.name}`)
  }
  const p = id ? await PtmSession.findById(id) : new PtmSession({ createdBy: auth.user?.name })
  if (!p) throw notFound('Meeting')
  if (id) {
    const active = await PtmBooking.find({ sessionId: p._id, status: { $in: ACTIVE_BOOKING } }).select('hostId time').lean()
    const keep = new Set(input.hosts.map((h) => String(h.id)).filter(isOid))
    if (active.some((b) => !keep.has(String(b.hostId)))) throw conflict('A teacher you took off has meetings booked. Cancel those first.')
    if (active.some((b) => !slots.includes(b.time))) throw conflict('Some booked slots no longer fit the new times. Cancel or move them first.')
    if (input.date !== p.date && active.length) throw conflict('Meetings are booked for this day. Cancel them before moving the meeting.')
  }
  for (const k of ['title', 'date', 'startTime', 'endTime', 'slotMinutes', 'gapMinutes', 'mode', 'classIds', 'sectionIds', 'instructions']) if (input[k] !== undefined) p[k] = input[k]
  p.bookingCloses = input.bookingCloses || undefined
  p.hosts = input.hosts.map((h) => ({ ...(isOid(h.id) && { _id: h.id }), userId: h.userId || undefined, name: h.name, role: h.role || undefined, room: h.room || undefined, sectionIds: h.sectionIds ?? [], away: (h.away ?? []).filter((x) => slots.includes(x)) }))
  await p.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'events', entityType: 'ptm_session', entityId: String(p._id), entityName: p.title, summary: `${id ? 'Changed' : 'Set up'} ${p.title} on ${p.date} (${p.hosts.length} teachers, ${slots.length} slots each)` }, req)
  return getSession(String(p._id))
}

/** Open booking — and tell the families of the students invited (who have a teacher to meet). */
export async function openBooking(id, { notify = true }, auth, req) {
  const p = isOid(id) ? await PtmSession.findById(id) : null
  if (!p) throw notFound('Meeting')
  if (!p.hosts.length) throw conflict('Add the teachers first.')
  if (p.date < await today()) throw conflict('This meeting day has passed.')
  p.status = 'OPEN'
  p.openedAt = new Date()
  await p.save()
  let told = 0
  if (notify) {
    const link = await familyLink('meetings')
    for (const s of await invitedStudents(p)) {
      if (!p.hosts.some((h) => hostFor(h, s))) continue
      await emit('events.ptm_open', { studentId: String(s._id), entity: { type: 'ptm_session', id: p._id }, data: { ptm: { title: p.title, date: humanDate(p.date), bookBy: humanDate(lastBookingDay(p)), link } } })
      told++
    }
  }
  await audit({ action: 'UPDATE', module: 'events', entityType: 'ptm_session', entityId: String(p._id), entityName: p.title, summary: `Opened booking for ${p.title}${told ? `, told ${told} families` : ''}` }, req)
  return { ...(await getSession(id)), told }
}

export async function setSessionStatus(id, status, auth, req) {
  const p = isOid(id) ? await PtmSession.findById(id) : null
  if (!p) throw notFound('Meeting')
  p.status = status
  await p.save()
  await audit({ action: 'UPDATE', module: 'events', entityType: 'ptm_session', entityId: String(p._id), entityName: p.title, summary: `${p.title}: ${status.toLowerCase()}` }, req)
  return getSession(id)
}

export async function deleteSession(id, auth, req) {
  const p = isOid(id) ? await PtmSession.findById(id).lean() : null
  if (!p) throw notFound('Meeting')
  if (await PtmBooking.exists({ sessionId: p._id, status: { $in: ACTIVE_BOOKING } })) throw conflict('Families have booked slots. Cancel them, or keep the meeting.')
  await PtmBooking.deleteMany({ sessionId: p._id })
  await PtmSession.deleteOne({ _id: p._id })
  await audit({ action: 'DELETE', module: 'events', entityType: 'ptm_session', entityId: String(p._id), entityName: p.title, summary: `Removed ${p.title}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── booking (shared by the office and the family app)

async function tellBooked(p, h, b) {
  await emit('events.ptm_booked', { studentId: String(b.studentId), entity: { type: 'ptm_session', id: p._id }, data: { ptm: { title: p.title, date: humanDate(p.date), time: b.time, teacher: h.name, room: roomOf(p, h) } } })
}

async function book(p, { hostId, time, student }, { by, byFamily, guardian }) {
  const h = p.hosts.find((x) => sameId(x._id, hostId))
  if (!h) throw notFound('Teacher in this meeting')
  if (!invites(p, student) || !hostFor(h, student)) throw badRequest(`${h.name} isn’t meeting this student’s parents.`)
  if (!slotsOf(p).includes(time) || (h.away ?? []).includes(time)) throw badRequest('That isn’t one of the teacher’s slots.')
  const mine = await PtmBooking.findOne({ sessionId: p._id, hostId: h._id, studentId: student._id, status: { $in: ACTIVE_BOOKING } }).lean()
  if (mine) throw conflict(`You already have ${mine.time} with ${h.name}. Cancel it to pick another time.`)
  const clash = await PtmBooking.findOne({ sessionId: p._id, studentId: student._id, time, status: { $in: ACTIVE_BOOKING } }).lean()
  if (clash) throw conflict(`You already have another teacher at ${time}.`)
  let b
  try {
    b = await PtmBooking.create({ sessionId: p._id, hostId: h._id, time, studentId: student._id, sectionId: student.sectionId, guardian, bookedBy: by, byFamily })
  } catch (e) {
    if (e.code === 11000) throw conflict('Someone has just taken that slot. Please pick another.')
    throw e
  }
  await tellBooked(p, h, b)
  return b
}

/** The office books a slot for a family (on the phone, at the desk). Any time before the meeting. */
export async function staffBook(id, { hostId, time, studentId }, auth, req) {
  const p = isOid(id) ? await PtmSession.findById(id).lean() : null
  if (!p) throw notFound('Meeting')
  if (p.status === 'DONE') throw conflict('This meeting is over.')
  const s = isOid(studentId) ? await Student.findOne({ _id: studentId, status: 'ACTIVE' }).select('firstName middleName lastName classId sectionId guardians').lean() : null
  if (!s) throw fieldsError({ studentId: 'Pick a student' })
  const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
  const b = await book(p, { hostId, time, student: s }, { by: auth.user?.name, byFamily: false, guardian: g ? { name: g.name, mobile: g.mobile } : undefined })
  await audit({ action: 'CREATE', module: 'events', entityType: 'ptm_session', entityId: String(p._id), entityName: p.title, studentId: s._id, summary: `Booked ${time} for ${studentName(s)} in ${p.title}` }, req)
  return { id: String(b._id), time: b.time }
}

/** Whether this user may mark / note a booking: a host marks their own meetings; otherwise the edit permission. */
const mayMark = (auth, p, b) => can(auth, 'events.ptm.edit') || p.hosts.some((h) => sameId(h._id, b.hostId) && h.userId && sameId(h.userId, auth.userId))

export async function updateBooking(bookingId, { status, remarks }, auth, req) {
  const b = isOid(bookingId) ? await PtmBooking.findById(bookingId) : null
  if (!b || !ACTIVE_BOOKING.includes(b.status)) throw notFound('Booking')
  const p = await PtmSession.findById(b.sessionId).lean()
  if (!mayMark(auth, p, b)) throw forbidden('Only the teacher, or someone who manages the meetings, can do this.')
  if (status === 'CANCELLED') {
    Object.assign(b, { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.user?.name })
  } else {
    if (status) {
      if (status !== 'BOOKED' && p.date > await today()) throw conflict('Mark who came on the meeting day.')
      b.status = status
    }
    if (remarks !== undefined) b.remarks = remarks || undefined
  }
  await b.save()
  await audit({ action: 'UPDATE', module: 'events', entityType: 'ptm_session', entityId: String(p._id), entityName: p.title, studentId: b.studentId, summary: `${p.title} ${b.time}: ${b.status.toLowerCase()}${remarks ? ' (noted)' : ''}` }, req)
  return { id: String(b._id), status: b.status, remarks: b.remarks ?? null }
}

/** The teacher's own meetings: sessions they host from a month back, with their slots. */
export async function myMeetings(auth) {
  if (!isOid(auth.userId)) return []
  const since = addDaysYmd(await today(), -30)
  const sessions = await PtmSession.find({ 'hosts.userId': auth.userId, date: { $gte: since }, status: { $ne: 'DRAFT' } }).sort({ date: 1 }).lean()
  const out = []
  for (const p of sessions) {
    const h = p.hosts.find((x) => sameId(x.userId, auth.userId))
    const full = await getSession(String(p._id))
    out.push({ id: String(p._id), title: p.title, date: p.date, startTime: p.startTime, endTime: p.endTime, mode: p.mode, status: p.status, hostId: String(h._id), room: roomOf(p, h), slots: full.grid.find((g) => g.hostId === String(h._id))?.slots ?? [] })
  }
  return out
}

export async function exportSession(id) {
  const p = await getSession(id)
  const head = ['Teacher', 'Time', 'Student', 'Admission no.', 'Class', 'Parent', 'Mobile', 'Status', 'Notes']
  const rows = []
  for (const g of p.grid) {
    const h = p.hosts.find((x) => x.id === g.hostId)
    for (const s of g.slots) if (s.booking) rows.push([h?.name, s.time, s.booking.student, s.booking.admissionNo, s.booking.section, s.booking.guardian, s.booking.mobile, s.booking.status, s.booking.remarks])
  }
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── the family app

/** The meetings a student's parents are invited to, each teacher's free slots (while booking is open), their bookings. */
export async function ptmForStudent(s) {
  const t = await today()
  const sessions = (await PtmSession.find({ status: { $in: ['OPEN', 'CLOSED', 'DONE'] }, date: { $gte: addDaysYmd(t, -60) } }).sort({ date: 1 }).lean()).filter((p) => invites(p, s))
  const bookings = await PtmBooking.find({ sessionId: { $in: sessions.map((p) => p._id) }, studentId: s._id, status: { $in: ACTIVE_BOOKING } }).lean()
  const taken = await PtmBooking.find({ sessionId: { $in: sessions.map((p) => p._id) }, status: { $in: ACTIVE_BOOKING } }).select('sessionId hostId time').lean()
  return sessions.map((p) => {
    const canBook = p.status === 'OPEN' && t <= lastBookingDay(p)
    const mine = bookings.filter((b) => sameId(b.sessionId, p._id))
    return {
      id: String(p._id), title: p.title, date: p.date, startTime: p.startTime, endTime: p.endTime, mode: p.mode, instructions: p.instructions ?? null, status: p.status, canBook, bookBy: lastBookingDay(p),
      teachers: p.hosts.filter((h) => hostFor(h, s)).map((h) => {
        const b = mine.find((x) => sameId(x.hostId, h._id))
        const busy = new Set(taken.filter((x) => sameId(x.sessionId, p._id) && sameId(x.hostId, h._id)).map((x) => x.time))
        const myTimes = new Set(mine.map((x) => x.time))
        return {
          id: String(h._id), name: h.name, role: h.role ?? null, room: b ? roomOf(p, h) : (p.mode === 'ONLINE' ? null : h.room ?? null),
          booking: b ? { id: String(b._id), time: b.time, status: b.status } : null,
          free: canBook && !b ? slotsOf(p).filter((x) => !busy.has(x) && !(h.away ?? []).includes(x) && !myTimes.has(x)) : [],
        }
      }),
    }
  })
}

export async function familyBook(s, sessionId, { hostId, time }, guardian) {
  const p = isOid(sessionId) ? await PtmSession.findById(sessionId).lean() : null
  if (!p || !invites(p, s)) throw notFound('Meeting')
  if (p.status !== 'OPEN' || await today() > lastBookingDay(p)) throw conflict('Booking for this meeting has closed. Please call the school.')
  await book(p, { hostId, time, student: s }, { by: guardian?.name ?? 'Family', byFamily: true, guardian })
  return ptmForStudent(s)
}

export async function familyCancel(s, bookingId) {
  const b = isOid(bookingId) ? await PtmBooking.findOne({ _id: bookingId, studentId: s._id, status: 'BOOKED' }) : null
  if (!b) throw notFound('Booking')
  const p = await PtmSession.findById(b.sessionId).lean()
  if (p.status !== 'OPEN' || await today() > lastBookingDay(p)) throw conflict('Booking has closed — please call the school to change it.')
  Object.assign(b, { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'Family' })
  await b.save()
  return ptmForStudent(s)
}

// ───────────────────────────────────────────────────────── reminders

/** Tomorrow's meetings: each family with a slot reminded (once). From 4 pm the institution's time. */
export async function sendPtmReminders({ anyTime = false } = {}) {
  const now = await institutionNow()
  if (!anyTime && now.minutes < 16 * 60) return 0
  if ((await getSettings('events')).ptmReminder === false) return 0
  const sessions = await PtmSession.find({ date: addDaysYmd(now.date, 1), status: { $in: ['OPEN', 'CLOSED'] }, remindedOn: { $ne: now.date } }).lean()
  let sent = 0
  for (const p of sessions) {
    for (const b of await PtmBooking.find({ sessionId: p._id, status: 'BOOKED' }).lean()) {
      const h = p.hosts.find((x) => sameId(x._id, b.hostId))
      if (h) { await tellBooked(p, h, b); sent++ }
    }
    await PtmSession.updateOne({ _id: p._id }, { $set: { remindedOn: now.date } })
  }
  return sent
}

/** Every institution with an event or meeting about tomorrow: event and meeting reminders (job 'event-reminders'). */
export async function sendAllEventReminders() {
  const d = new Date().toISOString().slice(0, 10)
  const window = { $gte: addDaysYmd(d, -1), $lte: addDaysYmd(d, 2) }
  const tenants = await runAsSystem(async () => [...new Set([
    ...(await SchoolEvent.distinct('tenantId', { remind: true, published: true, startDate: window }).setOptions({ allTenants: true })),
    ...(await PtmSession.distinct('tenantId', { date: window, status: { $in: ['OPEN', 'CLOSED'] } }).setOptions({ allTenants: true })),
  ].map(String))])
  let n = 0
  for (const t of tenants) n += await runAsTenant(t, async () => (await sendEventReminders()) + (await sendPtmReminders()))
  return n
}
