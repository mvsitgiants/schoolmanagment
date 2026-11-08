import { CALENDAR_SOURCES, EVENT_KIND_BY, addDaysYmd, buildIcs, touchesRange } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { EventReply, PtmSession, SchoolEvent } from '../models/events.js'
import { Exam } from '../models/exams.js'
import { Holiday } from '../models/hrms.js'
import { Tenant } from '../models/platform.js'
import { Student, studentName } from '../models/students.js'
import { enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow, timeZoneOf } from '../platform/time.js'
import { familyLink } from './familyLink.js'
import { humanDate } from './notify.js'

// The school calendar (module `events`): events for everyone, some classes or sections, or staff only — shown with the
// holidays from Staff & HR, the exam dates and the parent–teacher meetings. A published event can tell families, ask
// them to reply (going / not going, or consent for a trip) and remind them the day before. The calendar downloads as an
// .ics file for phones. Meetings are services/eventsPtm.js, albums services/eventsGallery.js.

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
export const today = async () => (await institutionNow()).date
export const dateText = (s, e) => (e && e !== s ? `${humanDate(s)} – ${humanDate(e)}` : humanDate(s))

// ───────────────────────────────────────────────────────── audience

/** The students an audience reaches (active ones). */
export async function audienceStudents(a, select = '_id sectionId classId branchId') {
  if (a.audience === 'STAFF') return []
  const f = { status: 'ACTIVE' }
  if (a.branchIds?.length) f.branchId = { $in: a.branchIds }
  if (a.audience === 'CLASSES') f.classId = { $in: a.classIds }
  if (a.audience === 'SECTIONS') f.sectionId = { $in: a.sectionIds }
  return Student.find(f).select(select).lean()
}

/** The records (events, albums) a student's family may see: published, for them, on their campus. */
export const familyAudience = (s) => ({
  published: true,
  $and: [
    { $or: [{ audience: 'EVERYONE' }, { audience: 'CLASSES', classIds: s.classId }, { audience: 'SECTIONS', sectionIds: s.sectionId }] },
    { $or: [{ branchIds: { $size: 0 } }, { branchIds: s.branchId }] },
  ],
})

/** "Everyone", "Classes 6, 7", "8-A, 8-B", "Staff only". */
export async function audienceLabels(rows) {
  const classIds = [...new Set(rows.flatMap((r) => (r.classIds ?? []).map(String)))]
  const sectionIds = [...new Set(rows.flatMap((r) => (r.sectionIds ?? []).map(String)))]
  const sections = await Section.find({ _id: { $in: sectionIds } }).select('name classId').lean()
  const classes = await ClassLevel.find({ _id: { $in: [...classIds, ...sections.map((s) => String(s.classId))] } }).select('name code order').lean()
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const sec = new Map(sections.map((s) => [String(s._id), `${cls.get(String(s.classId))?.code ?? cls.get(String(s.classId))?.name ?? ''}-${s.name}`]))
  return (r) => {
    if (r.audience === 'STAFF') return 'Staff only'
    if (r.audience === 'CLASSES') return r.classIds.map((x) => cls.get(String(x))?.name).filter(Boolean).join(', ')
    if (r.audience === 'SECTIONS') return r.sectionIds.map((x) => sec.get(String(x))).filter(Boolean).join(', ')
    return 'Everyone'
  }
}

function checkAudience(input) {
  if (input.audience === 'CLASSES' && !input.classIds?.length) throw fieldsError({ classIds: 'Pick the classes' })
  if (input.audience === 'SECTIONS' && !input.sectionIds?.length) throw fieldsError({ sectionIds: 'Pick the sections' })
}

// ───────────────────────────────────────────────────────── the calendar

/**
 * Everything on the calendar from `from` to `to`: events (drafts too, for staff), holidays, exam dates and
 * parent–teacher meetings — one list of items, each with its source.
 */
export async function calendar({ from, to, includeDrafts = true }, auth) {
  if (!from || !to || from > to) throw badRequest('Give a date range.')
  const settings = await getSettings('events')
  const modules = new Set(await enabledModuleIds(getContext().tenantId))
  const [events, holidays, exams, ptms] = await Promise.all([
    SchoolEvent.find({ startDate: { $lte: to }, endDate: { $gte: from }, ...(!includeDrafts && { published: true }) }).sort({ startDate: 1, startTime: 1 }).lean(),
    settings.calendarHolidays !== false && modules.has('hrms') ? Holiday.find({ date: { $gte: from, $lte: to } }).lean() : [],
    settings.calendarExams !== false && modules.has('exams') ? Exam.find({ status: { $ne: 'DRAFT' }, startDate: { $lte: to }, endDate: { $gte: from } }).select('name startDate endDate classIds').lean() : [],
    PtmSession.find({ date: { $gte: from, $lte: to }, status: { $ne: 'DRAFT' } }).select('title date startTime endTime classIds sectionIds').lean(),
  ])
  const label = await audienceLabels(events)
  const items = [
    ...events.map((e) => ({ id: String(e._id), source: 'EVENT', kind: e.kind, title: e.title, startDate: e.startDate, endDate: e.endDate, startTime: e.startTime ?? null, endTime: e.endTime ?? null, venue: e.venue ?? null, audience: e.audience, audienceLabel: label(e), published: e.published, reply: e.reply?.kind !== 'NONE' ? e.reply?.kind : null })),
    ...holidays.map((h) => ({ id: `h-${h._id}`, source: 'HOLIDAY', kind: 'HOLIDAY', title: h.name, startDate: h.date, endDate: h.date, optional: h.optional, staffOnly: !h.forStudents, published: true })),
    ...exams.map((x) => ({ id: `x-${x._id}`, source: 'EXAM', kind: 'EXAM', title: x.name, startDate: x.startDate, endDate: x.endDate, published: true })),
    ...ptms.map((p) => ({ id: `p-${p._id}`, ptmId: String(p._id), source: 'PTM', kind: 'PTM', title: p.title, startDate: p.date, endDate: p.date, startTime: p.startTime, endTime: p.endTime, published: true })),
  ].sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')))
  return { from, to, items, weekStartsSunday: settings.weekStartsSunday === true, sources: Object.keys(CALENDAR_SOURCES) }
}

/** The calendar as an .ics file (a term or a year at a time). */
export async function calendarIcs({ from, to }, auth) {
  const { items } = await calendar({ from, to, includeDrafts: false }, auth)
  const t = await Tenant.findById(getContext().tenantId).select('name slug').lean()
  return buildIcs(items.map((i) => ({ uid: `${i.id}@${t?.slug ?? 'school'}`, title: i.source === 'HOLIDAY' ? `Holiday: ${i.title}` : i.title, startDate: i.startDate, endDate: i.endDate, startTime: i.startTime, endTime: i.endTime, venue: i.venue })), { name: `${t?.name ?? 'School'} calendar`, timeZone: await timeZoneOf() })
}

// ───────────────────────────────────────────────────────── events

const eventOut = (e, label) => ({ ...clean(e), classIds: e.classIds.map(String), sectionIds: e.sectionIds.map(String), branchIds: e.branchIds.map(String), audienceLabel: label ? label(e) : undefined, kindTone: EVENT_KIND_BY[e.kind]?.tone })

/** Events for the list view: upcoming, past, or drafts; searched by title. */
export async function listEvents({ when = 'UPCOMING', search, kind }) {
  const t = await today()
  const f = {}
  if (when === 'UPCOMING') f.endDate = { $gte: t }
  if (when === 'PAST') f.endDate = { $lt: t }
  if (when === 'DRAFTS') f.published = false
  if (kind) f.kind = kind
  if (search) f.title = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const rows = await SchoolEvent.find(f).sort({ startDate: when === 'PAST' ? -1 : 1 }).limit(500).lean()
  const label = await audienceLabels(rows)
  const replies = await EventReply.aggregate([{ $match: { eventId: { $in: rows.filter((r) => r.reply?.kind !== 'NONE').map((r) => r._id) } } }, { $group: { _id: { e: '$eventId', a: '$answer' }, n: { $sum: 1 } } }])
  return rows.map((e) => ({ ...eventOut(e, label), replies: e.reply?.kind !== 'NONE' ? { yes: replies.find((r) => String(r._id.e) === String(e._id) && r._id.a === 'YES')?.n ?? 0, no: replies.find((r) => String(r._id.e) === String(e._id) && r._id.a === 'NO')?.n ?? 0 } : null }))
}

export async function getEvent(id) {
  const e = isOid(id) ? await SchoolEvent.findById(id).lean() : null
  if (!e) throw notFound('Event')
  const label = await audienceLabels([e])
  const files = await Attachment.countDocuments({ entityType: 'school_event', entityId: String(e._id), 'deleted.at': null })
  return { ...eventOut(e, label), files, ...(e.reply?.kind !== 'NONE' && { replySummary: await replySummary(e) }) }
}

export async function saveEvent(id, input, auth, req) {
  const end = input.endDate || input.startDate
  if (input.startDate && end < input.startDate) throw fieldsError({ endDate: 'Ends before it starts' })
  if ((input.startTime && !input.endTime) || (!input.startTime && input.endTime)) throw fieldsError({ endTime: 'Give both times, or neither (all day)' })
  if (input.startTime && end === input.startDate && input.endTime <= input.startTime) throw fieldsError({ endTime: 'Ends before it starts' })
  if (input.reply?.kind && input.reply.kind !== 'NONE' && input.audience === 'STAFF') throw fieldsError({ reply: 'Families can’t reply to a staff-only event' })
  checkAudience(input)
  const e = id ? await SchoolEvent.findById(id) : new SchoolEvent({ createdBy: auth.user?.name, createdById: isOid(auth.userId) ? auth.userId : undefined })
  if (!e) throw notFound('Event')
  for (const k of ['title', 'description', 'kind', 'startDate', 'venue', 'audience', 'classIds', 'sectionIds', 'branchIds', 'remind']) if (input[k] !== undefined) e[k] = input[k]
  if (input.startDate !== undefined) e.endDate = end
  if (input.startTime !== undefined || input.endTime !== undefined) { e.startTime = input.startTime || undefined; e.endTime = input.endTime || undefined }
  if (input.reply) e.reply = { kind: input.reply.kind, question: input.reply.question || undefined, by: input.reply.by || undefined }
  if (e.audience !== 'CLASSES') e.classIds = []
  if (e.audience !== 'SECTIONS') e.sectionIds = []
  if (id && e.isModified('startDate')) e.remindedOn = undefined
  await e.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'events', entityType: 'school_event', entityId: String(e._id), entityName: e.title, summary: `${id ? 'Changed' : 'Put on the calendar'}: ${e.title} (${e.startDate}${e.endDate !== e.startDate ? ` – ${e.endDate}` : ''})` }, req)
  return getEvent(String(e._id))
}

/** Show the event to families (and tell them, if asked). An event asking for a reply sends the reply request. */
export async function publishEvent(id, { notify = false }, auth, req) {
  const e = isOid(id) ? await SchoolEvent.findById(id) : null
  if (!e) throw notFound('Event')
  e.published = true
  let told = 0
  if (notify && e.audience !== 'STAFF') {
    const students = await audienceStudents(e)
    const link = await familyLink('calendar')
    const asking = e.reply?.kind && e.reply.kind !== 'NONE'
    const base = { title: e.title, date: dateText(e.startDate, e.endDate), time: e.startTime ? `${e.startTime}${e.endTime ? `–${e.endTime}` : ''}` : '', venue: e.venue ?? '', link }
    for (const s of students) {
      await emit(asking ? 'events.reply' : 'events.announced', { studentId: String(s._id), entity: { type: 'school_event', id: e._id }, data: { event: { ...base, ...(asking && { question: e.reply.question || (e.reply.kind === 'CONSENT' ? 'Do you give permission?' : 'Will your child come?'), replyBy: humanDate(e.reply.by || e.startDate) }) } } })
      told++
    }
    e.notifiedAt = new Date()
  }
  await e.save()
  await audit({ action: 'UPDATE', module: 'events', entityType: 'school_event', entityId: String(e._id), entityName: e.title, summary: `Published ${e.title}${told ? `, told ${told} families` : ''}` }, req)
  return { ...(await getEvent(id)), told }
}

export async function unpublishEvent(id, auth, req) {
  const e = isOid(id) ? await SchoolEvent.findById(id) : null
  if (!e) throw notFound('Event')
  e.published = false
  await e.save()
  await audit({ action: 'UPDATE', module: 'events', entityType: 'school_event', entityId: String(e._id), entityName: e.title, summary: `Took ${e.title} off the families’ calendar` }, req)
  return getEvent(id)
}

export async function deleteEvent(id, auth, req) {
  const e = isOid(id) ? await SchoolEvent.findById(id).lean() : null
  if (!e) throw notFound('Event')
  await EventReply.deleteMany({ eventId: e._id })
  await SchoolEvent.deleteOne({ _id: e._id })
  await audit({ action: 'DELETE', module: 'events', entityType: 'school_event', entityId: String(e._id), entityName: e.title, summary: `Removed ${e.title} from the calendar` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── replies

async function replySummary(e) {
  const [students, replies] = await Promise.all([audienceStudents(e, '_id'), EventReply.find({ eventId: e._id }).select('studentId answer').lean()])
  const reached = new Set(students.map((s) => String(s._id)))
  const mine = replies.filter((r) => reached.has(String(r.studentId)))
  return { students: reached.size, yes: mine.filter((r) => r.answer === 'YES').length, no: mine.filter((r) => r.answer === 'NO').length, waiting: reached.size - mine.length }
}

/** Every student the event reaches, with their family's reply (or none yet). */
export async function eventReplies(id, { answer } = {}) {
  const e = isOid(id) ? await SchoolEvent.findById(id).lean() : null
  if (!e) throw notFound('Event')
  const students = await audienceStudents(e, 'firstName middleName lastName admissionNo rollNo sectionId guardians')
  const replies = new Map((await EventReply.find({ eventId: e._id }).lean()).map((r) => [String(r.studentId), r]))
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).select('name classId').lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
  const sec = new Map(sections.map((s) => [String(s._id), { label: `${cls.get(String(s.classId))?.code ?? cls.get(String(s.classId))?.name ?? ''}-${s.name}`, order: cls.get(String(s.classId))?.order ?? 0 }]))
  const rows = students.map((s) => {
    const r = replies.get(String(s._id))
    const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
    return { studentId: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, section: sec.get(String(s.sectionId))?.label ?? '', order: sec.get(String(s.sectionId))?.order ?? 0, guardian: g?.name ?? null, mobile: g?.mobile ?? null, answer: r?.answer ?? null, note: r?.note ?? null, by: r?.by ?? null, byStaff: !!r?.byStaff, at: r?.at ?? null }
  }).filter((r) => !answer || (answer === 'WAITING' ? !r.answer : r.answer === answer))
    .sort((a, b) => a.order - b.order || a.section.localeCompare(b.section) || (a.rollNo ?? 999) - (b.rollNo ?? 999) || a.name.localeCompare(b.name))
  return { event: { id: String(e._id), title: e.title, reply: e.reply }, rows }
}

export async function exportReplies(id) {
  const { event, rows } = await eventReplies(id)
  const head = ['Class', 'Roll', 'Student', 'Admission no.', 'Parent', 'Mobile', 'Reply', 'Note', 'Replied by', 'When']
  const word = { YES: event.reply?.kind === 'CONSENT' ? 'Permission given' : 'Going', NO: event.reply?.kind === 'CONSENT' ? 'No permission' : 'Not going' }
  return [head, ...rows.map((r) => [r.section, r.rollNo, r.name, r.admissionNo, r.guardian, r.mobile, r.answer ? word[r.answer] : 'No reply yet', r.note, r.byStaff ? `${r.by} (office)` : r.by, r.at ? new Date(r.at).toISOString().slice(0, 16).replace('T', ' ') : ''])].map((x) => x.map(csvCell).join(',')).join('\n')
}

/** A reply the office notes for a family (a paper slip that came back). */
export async function staffReply(id, { studentId, answer, note }, auth, req) {
  const e = isOid(id) ? await SchoolEvent.findById(id).lean() : null
  if (!e) throw notFound('Event')
  if (!e.reply || e.reply.kind === 'NONE') throw conflict('This event doesn’t ask for a reply.')
  const reached = await audienceStudents(e, '_id')
  if (!reached.some((s) => String(s._id) === String(studentId))) throw badRequest('This student isn’t invited to the event.')
  if (answer === null) await EventReply.deleteOne({ eventId: e._id, studentId })
  else await EventReply.updateOne({ eventId: e._id, studentId }, { $set: { answer, note: note || undefined, by: auth.user?.name, byStaff: true, at: new Date() } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'events', entityType: 'school_event', entityId: String(e._id), entityName: e.title, studentId: oid(studentId), summary: `Noted a reply for ${e.title}: ${answer ?? 'cleared'}` }, req)
  return { saved: true }
}

// ───────────────────────────────────────────────────────── the family's calendar

/** What a student's family sees: published events for them, school holidays, their exams and meetings. */
export async function familyCalendarItems(s, { from, to }) {
  const settings = await getSettings('events')
  const modules = new Set(await enabledModuleIds(getContext().tenantId))
  const [events, holidays, exams, ptms] = await Promise.all([
    SchoolEvent.find({ ...familyAudience(s), audience: { $ne: 'STAFF' }, startDate: { $lte: to }, endDate: { $gte: from } }).sort({ startDate: 1 }).lean(),
    settings.calendarHolidays !== false && modules.has('hrms') ? Holiday.find({ date: { $gte: from, $lte: to }, forStudents: true, optional: false, $or: [{ branchIds: { $size: 0 } }, { branchIds: s.branchId }] }).lean() : [],
    settings.calendarExams !== false && modules.has('exams') ? Exam.find({ status: { $ne: 'DRAFT' }, classIds: s.classId, startDate: { $lte: to }, endDate: { $gte: from } }).select('name startDate endDate').lean() : [],
    PtmSession.find({ date: { $gte: from, $lte: to }, status: { $ne: 'DRAFT' }, $and: [{ $or: [{ classIds: { $size: 0 } }, { classIds: s.classId }] }, { $or: [{ sectionIds: { $size: 0 } }, { sectionIds: s.sectionId }] }] }).select('title date startTime endTime').lean(),
  ])
  const replies = new Map((await EventReply.find({ studentId: s._id, eventId: { $in: events.map((e) => e._id) } }).lean()).map((r) => [String(r.eventId), r]))
  return [
    ...events.map((e) => ({ id: String(e._id), source: 'EVENT', kind: e.kind, title: e.title, description: e.description ?? null, startDate: e.startDate, endDate: e.endDate, startTime: e.startTime ?? null, endTime: e.endTime ?? null, venue: e.venue ?? null, reply: e.reply?.kind !== 'NONE' ? { kind: e.reply.kind, question: e.reply.question ?? null, by: e.reply.by ?? e.startDate, answer: replies.get(String(e._id))?.answer ?? null, note: replies.get(String(e._id))?.note ?? null } : null })),
    ...holidays.map((h) => ({ id: `h-${h._id}`, source: 'HOLIDAY', kind: 'HOLIDAY', title: h.name, startDate: h.date, endDate: h.date })),
    ...exams.map((x) => ({ id: `x-${x._id}`, source: 'EXAM', kind: 'EXAM', title: x.name, startDate: x.startDate, endDate: x.endDate })),
    ...ptms.map((p) => ({ id: `p-${p._id}`, ptmId: String(p._id), source: 'PTM', kind: 'PTM', title: p.title, startDate: p.date, endDate: p.date, startTime: p.startTime, endTime: p.endTime })),
  ].filter((i) => touchesRange(i, from, to)).sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')))
}

/** A family's reply (until the reply-by day). */
export async function familyReply(s, eventId, { answer, note }, byName) {
  const e = isOid(eventId) ? await SchoolEvent.findOne({ _id: eventId, ...familyAudience(s), audience: { $ne: 'STAFF' } }).lean() : null
  if (!e) throw notFound('Event')
  if (!e.reply || e.reply.kind === 'NONE') throw conflict('This event doesn’t ask for a reply.')
  if (await today() > (e.reply.by || e.startDate)) throw conflict('Replies for this event have closed. Please talk to the school.')
  await EventReply.updateOne({ eventId: e._id, studentId: s._id }, { $set: { answer, note: note || undefined, by: byName, byStaff: false, at: new Date() } }, { upsert: true })
  return { answer, note: note ?? null }
}

// ───────────────────────────────────────────────────────── reminders (job 'event-reminders')

/** Tomorrow's events that asked for a reminder: their families told (once). From 4 pm the institution's time. */
export async function sendEventReminders({ anyTime = false } = {}) {
  const now = await institutionNow()
  if (!anyTime && now.minutes < 16 * 60) return 0
  if ((await getSettings('events')).remindDayBefore === false) return 0
  const tomorrow = addDaysYmd(now.date, 1)
  const due = await SchoolEvent.find({ published: true, remind: true, startDate: tomorrow, audience: { $ne: 'STAFF' }, remindedOn: { $ne: now.date } }).lean()
  let sent = 0
  for (const e of due) {
    for (const s of await audienceStudents(e)) {
      await emit('events.reminder', { studentId: String(s._id), entity: { type: 'school_event', id: e._id }, data: { event: { title: e.title, date: dateText(e.startDate, e.endDate), time: e.startTime ?? '', venue: e.venue ?? '' } } })
      sent++
    }
    await SchoolEvent.updateOne({ _id: e._id }, { $set: { remindedOn: now.date } })
  }
  return sent
}

/** Files engine: an event's attachments (a circular, a consent form …). */
export async function eventRecord(id) {
  if (!isOid(id)) return null
  const e = await SchoolEvent.findById(id).select('title').lean()
  return e ? { name: e.title, canAdd: true } : null
}

