import crypto from 'node:crypto'
import { sectionLabel } from '@schoolgiant/shared'
import { config } from '../config.js'
import { ClassLevel, Section } from '../models/academics.js'
import { PickupPass } from '../models/attendance.js'
import { EventReply, PtmBooking, PtmSession, SchoolEvent } from '../models/events.js'
import { Student, studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { hhmmIn, institutionNow, timeZoneOf } from '../platform/time.js'
import { on } from './dashboard.js'
import { need, studentFor } from './portal.js'

// Passes a family shows on their phone and the school scans (the app's Scan button):
//   event pass       SGE1.<replyId>.<sig>     — an RSVP "yes": checked in at the gate, once
//   meeting pass     SGM1.<bookingId>.<sig>   — a parent–teacher meeting slot: arrived, the teacher sees who is waiting
//   early pickup     SGK1.<code>              — who collects the child today: checked and handed over at the gate, once
// The first two are signed ids (nothing stored); a pickup pass is a record the parent makes and can cancel.

const sign = (kind, tenantId, id) => crypto.createHmac('sha256', config.jwtSecret).update(`pass:${kind}:${tenantId}:${id}`).digest('base64url').slice(0, 16)
const token = (kind, tenantId, id) => `SG${kind}1.${id}.${sign(kind, tenantId, id)}`
const today = async () => (await institutionNow()).date
const newPickupCode = () => crypto.randomBytes(9).toString('base64url')

/** Read a pass a family shows: { kind: 'EVENT' | 'MEETING' | 'PICKUP', id | code } — null when it isn't one, or is forged. */
export function readPass(text, tenantId) {
  const m = String(text ?? '').trim().match(/^SG([EMK])1\.([A-Za-z0-9_-]{6,40})(?:\.([A-Za-z0-9_-]{16}))?$/)
  if (!m) return null
  const kind = { E: 'EVENT', M: 'MEETING', K: 'PICKUP' }[m[1]]
  if (kind === 'PICKUP') return { kind, code: m[2] }
  if (!m[3] || !isOid(m[2])) return null
  const good = sign(m[1], tenantId, m[2])
  if (!crypto.timingSafeEqual(Buffer.from(m[3]), Buffer.from(good))) throw badRequest('This pass isn’t from this institution.')
  return { kind, id: m[2] }
}

async function classOf(sectionId) {
  if (!sectionId) return null
  const sec = await Section.findById(sectionId).lean()
  const cls = sec ? await ClassLevel.findById(sec.classId).select('name code').lean() : null
  return sec ? sectionLabel(cls, sec, { short: true }) : null
}

// ───────────────────────────────────────────────────────── the family's side (parent app)

/** The family app: this child's passes — events they said yes to, meetings booked, today's pickup passes. */
export async function familyPasses(f, studentId) {
  const s = studentFor(f, studentId)
  const t = await today()
  const tenantId = String(f.tenant._id)
  const out = { events: [], meetings: [], pickups: [] }
  if (f.features.includes('EVENTS')) {
    const replies = await EventReply.find({ studentId: s._id, answer: 'YES' }).lean()
    const events = await SchoolEvent.find({ _id: { $in: replies.map((r) => r.eventId) }, endDate: { $gte: t } }).select('title startDate endDate startTime venue').lean()
    out.events = events.map((e) => {
      const r = replies.find((x) => String(x.eventId) === String(e._id))
      return { id: String(r._id), eventId: String(e._id), title: e.title, startDate: e.startDate, endDate: e.endDate, startTime: e.startTime ?? null, venue: e.venue ?? null, code: token('E', tenantId, r._id), checkedInAt: r.checkedInAt ?? null }
    }).sort((a, b) => a.startDate.localeCompare(b.startDate))
    const bookings = await PtmBooking.find({ studentId: s._id, status: 'BOOKED' }).lean()
    const sessions = await PtmSession.find({ _id: { $in: bookings.map((b) => b.sessionId) }, date: { $gte: t } }).lean()
    out.meetings = bookings.flatMap((b) => {
      const ses = sessions.find((x) => String(x._id) === String(b.sessionId))
      if (!ses) return []
      const host = ses.hosts.find((h) => String(h._id) === String(b.hostId))
      return [{ id: String(b._id), title: ses.title, date: ses.date, time: b.time, host: host?.name ?? '', room: host?.room ?? null, code: token('M', tenantId, b._id), arrivedAt: b.arrivedAt ?? null }]
    }).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
  }
  if (f.features.includes('ATTENDANCE')) {
    const passes = await PickupPass.find({ studentId: s._id, date: t }).sort({ createdAt: -1 }).lean()
    out.pickups = passes.map(pickupDto)
  }
  return out
}

const pickupDto = (p) => ({ id: String(p._id), date: p.date, person: p.person, reason: p.reason ?? null, status: p.status, code: `SGK1.${p.code}`, usedAt: p.usedAt ?? null, createdBy: p.createdBy ?? null })

/** The family names who collects the child today. Good until the end of the day; one active pass at a time. */
export async function createPickupPass(f, studentId, input, req) {
  need(f, 'ATTENDANCE')
  const s = studentFor(f, studentId)
  const t = await today()
  await PickupPass.updateMany({ studentId: s._id, date: t, status: 'ACTIVE' }, { $set: { status: 'CANCELLED' } })
  const p = await PickupPass.create({ studentId: s._id, date: t, person: { name: input.name, relation: input.relation || undefined, mobile: input.mobile || undefined }, reason: input.reason || undefined, code: newPickupCode(), createdBy: f.session.kind === 'STUDENT' ? 'Student' : `Parent (${f.session.mobile?.slice(-4) ?? ''})` })
  await audit({ action: 'CREATE', module: 'attendance', entityType: 'pickup_pass', entityId: String(p._id), entityName: studentName(s), studentId: s._id, summary: `Early-pickup pass for ${studentName(s)}: ${input.name}${input.relation ? ` (${input.relation})` : ''}` }, req)
  return pickupDto(p.toObject())
}

export async function cancelPickupPass(f, studentId, passId) {
  need(f, 'ATTENDANCE')
  const s = studentFor(f, studentId)
  if (!isOid(passId)) throw notFound('Pass')
  const p = await PickupPass.findOneAndUpdate({ _id: passId, studentId: s._id, status: 'ACTIVE' }, { $set: { status: 'CANCELLED' } }, { new: true }).lean()
  if (!p) throw notFound('Pass')
  return pickupDto(p)
}

// ───────────────────────────────────────────────────────── the school's side (Scan)

/** What a scanned pass is, for the app's Scan result. Null when the person may not see it. */
export async function passResult(pass, auth) {
  if (pass.kind === 'EVENT') {
    if (!on(auth, 'events', 'events.calendar.view')) return null
    const r = await EventReply.findById(pass.id).lean()
    if (!r) throw notFound('Pass')
    const [e, s] = await Promise.all([SchoolEvent.findById(r.eventId).select('title startDate endDate').lean(), Student.findById(r.studentId).select('firstName middleName lastName sectionId').lean()])
    return {
      kind: 'EVENT_PASS', id: String(r._id), title: e?.title ?? '', subtitle: [s && studentName(s), await classOf(s?.sectionId)].filter(Boolean).join(' · '),
      checkedInAt: r.checkedInAt ?? null, valid: !!e && e.endDate >= await today() && r.answer === 'YES',
      actions: !r.checkedInAt && on(auth, 'events', 'events.calendar.edit', 'events.calendar.view') ? [{ key: 'checkIn', post: `/v1/scan/passes/event/${r._id}/check-in` }] : [],
    }
  }
  if (pass.kind === 'MEETING') {
    if (!on(auth, 'events', 'events.ptm.view')) return null
    const b = await PtmBooking.findById(pass.id).lean()
    if (!b) throw notFound('Pass')
    const [ses, s] = await Promise.all([PtmSession.findById(b.sessionId).lean(), Student.findById(b.studentId).select('firstName middleName lastName sectionId').lean()])
    const host = ses?.hosts.find((h) => String(h._id) === String(b.hostId))
    return {
      kind: 'MEETING_PASS', id: String(b._id), title: [s && studentName(s), await classOf(s?.sectionId)].filter(Boolean).join(' · '), subtitle: [ses?.title, b.time, host?.name, host?.room].filter(Boolean).join(' · '),
      checkedInAt: b.arrivedAt ?? null, valid: b.status === 'BOOKED',
      actions: !b.arrivedAt && b.status === 'BOOKED' ? [{ key: 'arrived', post: `/v1/scan/passes/meeting/${b._id}/check-in` }] : [],
    }
  }
  if (!on(auth, 'attendance', 'attendance.mark.view') && !on(auth, 'students', 'students.directory.view')) return null
  const p = await PickupPass.findOne({ code: pass.code }).lean()
  if (!p) throw notFound('Pass')
  const s = await Student.findById(p.studentId).select('firstName middleName lastName admissionNo sectionId').lean()
  const valid = p.status === 'ACTIVE' && p.date === await today()
  return {
    kind: 'PICKUP_PASS', id: String(p._id), title: s ? studentName(s) : '', subtitle: [await classOf(s?.sectionId), s?.admissionNo].filter(Boolean).join(' · '),
    person: p.person, reason: p.reason ?? null, status: p.status, valid, usedAt: p.usedAt ?? null, usedBy: p.usedBy ?? null,
    actions: valid ? [{ key: 'handOver', post: `/v1/scan/passes/pickup/${p._id}/hand-over` }] : [],
  }
}

/** Check a family in (event, meeting) or hand a child over (pickup). Once only; returns the pass as Scan shows it. */
export async function usePass(kind, id, auth, req) {
  if (!isOid(id)) throw notFound('Pass')
  const by = auth.user?.name
  if (kind === 'event') {
    const r = await EventReply.findOneAndUpdate({ _id: id, answer: 'YES', checkedInAt: null }, { $set: { checkedInAt: new Date(), checkedInBy: by } }, { new: true }).lean()
    if (!r) throw conflict('Already checked in, or not a “yes” to this event.')
    return passResult({ kind: 'EVENT', id }, auth)
  }
  if (kind === 'meeting') {
    const b = await PtmBooking.findOneAndUpdate({ _id: id, status: 'BOOKED', arrivedAt: null }, { $set: { arrivedAt: new Date(), arrivedBy: by } }, { new: true }).lean()
    if (!b) throw conflict('Already marked arrived, or the booking was cancelled.')
    return passResult({ kind: 'MEETING', id }, auth)
  }
  const t = await today()
  const p = await PickupPass.findOneAndUpdate({ _id: id, status: 'ACTIVE', date: t }, { $set: { status: 'USED', usedAt: new Date(), usedBy: by } }, { new: true }).lean()
  if (!p) throw conflict('This pass was already used, cancelled, or is not for today.')
  const s = await Student.findById(p.studentId).select('firstName middleName lastName sectionId').lean()
  await audit({ action: 'UPDATE', module: 'attendance', entityType: 'pickup_pass', entityId: String(p._id), entityName: studentName(s), studentId: p.studentId, summary: `Handed ${studentName(s)} over to ${p.person.name}${p.person.relation ? ` (${p.person.relation})` : ''} — early pickup` }, req)
  await emit('attendance.pickedUp', { studentId: String(p.studentId), entity: { type: 'pickup_pass', id: p._id }, data: { student: { class: await classOf(s?.sectionId) ?? '' }, pickup: { person: p.person.name, time: hhmmIn(new Date(), await timeZoneOf()) } } })
  return passResult({ kind: 'PICKUP', code: p.code }, auth)
}
