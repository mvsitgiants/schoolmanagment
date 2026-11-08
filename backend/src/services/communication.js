import { CHAT_SIDES, NOTICE_STATUS, maskMobile, sectionLabel } from '@schoolgiant/shared'
import { ClassLevel, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { Attachment, MessageLog } from '../models/engines.js'
import { Broadcast, ChatMessage, Conversation, Notice, NoticeRead } from '../models/communication.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear } from './academics.js'
import { familyLink } from './familyLink.js'
import { notifyUsers, queueFamilyMessages } from './notify.js'

// Communication hub (module `communication`). Notices are written as drafts and published to an
// audience (whole school, classes, sections or picked students); publishing can also send them by
// the channels the sender ticks, and the family app shows them with who has read them. Send
// messages queues a one-off message per student (Notification rules › Message to families decides
// the wording around it). Parent–teacher chat: a family writes to the class teacher or a subject
// teacher of their child from the app; the teacher answers from Communication › Chat; anyone with
// `communication.chat.moderate` sees every conversation and may hide a message.

const today = async () => (await institutionNow()).date
const MAX_AUDIENCE = 5000

// ───────────────────────────────────────────────────────── audiences

/** The active students an audience reaches. */
export async function resolveAudience(a = { kind: 'ALL' }) {
  const filter = { status: 'ACTIVE' }
  if (a.kind === 'CLASSES') filter.classId = { $in: a.classIds ?? [] }
  else if (a.kind === 'SECTIONS') filter.sectionId = { $in: a.sectionIds ?? [] }
  else if (a.kind === 'STUDENTS') filter._id = { $in: a.studentIds ?? [] }
  return Student.find(filter).select('_id sectionId classId firstName lastName').limit(MAX_AUDIENCE + 1).lean()
}

function checkAudience(a) {
  if (!a || a.kind === 'ALL') return
  const ids = a.kind === 'CLASSES' ? a.classIds : a.kind === 'SECTIONS' ? a.sectionIds : a.studentIds
  if (!ids?.length) throw badRequest('Pick who it is for.', { fields: { audience: 'Pick at least one' } })
}

/** id → name of the classes and sections in some audiences, for summaries. */
async function audienceLabels(list) {
  const classIds = list.flatMap((a) => a?.classIds ?? [])
  const sectionIds = list.flatMap((a) => a?.sectionIds ?? [])
  const [classes, sections] = await Promise.all([
    ClassLevel.find({ _id: { $in: classIds } }).select('name').lean(),
    Section.find({ _id: { $in: sectionIds } }).lean(),
  ])
  const cls = new Map((await ClassLevel.find({ _id: { $in: [...classes.map((c) => c._id), ...sections.map((s) => s.classId)] } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return {
    ...Object.fromEntries(classes.map((c) => [String(c._id), c.name])),
    ...Object.fromEntries(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })])),
  }
}

const audienceDto = (a) => ({ kind: a?.kind ?? 'ALL', classIds: (a?.classIds ?? []).map(String), sectionIds: (a?.sectionIds ?? []).map(String), studentIds: (a?.studentIds ?? []).map(String) })

export async function previewAudience(a) {
  checkAudience(a)
  const students = await resolveAudience(a)
  return { students: Math.min(students.length, MAX_AUDIENCE), tooMany: students.length > MAX_AUDIENCE }
}

// ───────────────────────────────────────────────────────── notices

const noticeDto = (n, labels, extra = {}) => ({
  ...clean(n), audience: audienceDto(n.audience), statusLabel: NOTICE_STATUS[n.status]?.label,
  audienceNames: n.audience?.kind === 'CLASSES' ? n.audience.classIds.map((id) => labels[String(id)]).filter(Boolean) : n.audience?.kind === 'SECTIONS' ? n.audience.sectionIds.map((id) => labels[String(id)]).filter(Boolean) : [],
  ...extra,
})

export async function listNotices(q, paging) {
  const filter = {}
  if (q.status) filter.status = q.status
  if (paging.search) filter.$or = [{ title: new RegExp(escapeRegex(paging.search), 'i') }, { body: new RegExp(escapeRegex(paging.search), 'i') }]
  const [rows, total] = await Promise.all([
    Notice.find(filter).sort({ pinned: -1, publishedAt: -1, createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Notice.countDocuments(filter),
  ])
  const [labels, reads, files] = await Promise.all([
    audienceLabels(rows.map((r) => r.audience)),
    NoticeRead.aggregate([{ $match: { noticeId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$noticeId', n: { $sum: 1 } } }]),
    Attachment.aggregate([{ $match: { entityType: 'notice', entityId: { $in: rows.map((r) => String(r._id)) }, 'deleted.at': null } }, { $group: { _id: '$entityId', n: { $sum: 1 } } }]),
  ])
  const readOf = new Map(reads.map((r) => [String(r._id), r.n]))
  const filesOf = new Map(files.map((r) => [r._id, r.n]))
  return listResponse(rows.map((r) => noticeDto(r, labels, { reads: readOf.get(String(r._id)) ?? 0, files: filesOf.get(String(r._id)) ?? 0 })), total, paging)
}

async function noticeById(id) {
  if (!isOid(id)) throw notFound('Notice')
  const n = await Notice.findById(id)
  if (!n) throw notFound('Notice')
  return n
}

export async function saveNotice(id, input, auth, req) {
  checkAudience(input.audience)
  const n = id ? await noticeById(id) : new Notice({ createdBy: auth.user?.name, createdById: auth.userId, academicYearId: (await currentYear())?._id })
  if (n.status === 'WITHDRAWN') throw conflict('This notice was withdrawn.')
  if (n.status === 'PUBLISHED' && JSON.stringify(audienceDto(n.audience)) !== JSON.stringify(audienceDto(input.audience))) throw conflict('A published notice can’t change who it is for. Withdraw it and publish a new one.')
  Object.assign(n, { title: input.title, body: input.body ?? '', category: input.category || 'General', audience: input.audience, pinned: !!input.pinned, expiresOn: input.expiresOn || undefined })
  await n.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'communication', entityType: 'notice', entityId: String(n._id), entityName: n.title, summary: `${id ? 'Updated' : 'Drafted'} notice “${n.title}”` }, req)
  const labels = await audienceLabels([n.audience])
  return noticeDto(n.toObject(), labels)
}

export async function deleteNotice(id, req) {
  const n = await noticeById(id)
  if (n.status !== 'DRAFT') throw conflict('A published notice can’t be deleted — withdraw it instead.')
  await Notice.deleteOne({ _id: n._id })
  await audit({ action: 'DELETE', module: 'communication', entityType: 'notice', entityId: String(n._id), entityName: n.title, summary: `Deleted draft notice “${n.title}”` }, req)
  return { deleted: true }
}

/** Publish: it appears in the family app now; with channels ticked, each family is also sent it. */
export async function publishNotice(id, { channels = [] }, auth, req) {
  const n = await noticeById(id)
  if (n.status !== 'DRAFT') throw conflict('Only a draft can be published.')
  const students = await resolveAudience(n.audience)
  if (!students.length) throw conflict('Nobody is in this audience.')
  if (students.length > MAX_AUDIENCE) throw conflict(`This reaches more than ${MAX_AUDIENCE} students. Send it class by class.`)
  Object.assign(n, { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: auth.user?.name, channels, recipients: students.length })
  await n.save()
  let queued = 0
  if (channels.length) {
    const link = await familyLink('notices')
    for (const s of students) {
      const rows = await queueFamilyMessages('communication.notice', { studentId: String(s._id), data: { notice: { title: n.title, link } }, entity: { type: 'notice', id: n._id }, pick: channels })
      queued += rows.filter((r) => r.status === 'QUEUED').length
    }
  }
  await audit({ action: 'APPROVE', module: 'communication', entityType: 'notice', entityId: String(n._id), entityName: n.title, summary: `Published notice “${n.title}” to ${students.length} student(s)${channels.length ? `, sent by ${channels.join(', ')} (${queued} messages)` : ''}` }, req)
  return { published: true, recipients: students.length, queued }
}

export async function withdrawNotice(id, auth, req) {
  const n = await noticeById(id)
  if (n.status !== 'PUBLISHED') throw conflict('Only a published notice can be withdrawn.')
  Object.assign(n, { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnBy: auth.user?.name })
  await n.save()
  await audit({ action: 'UPDATE', module: 'communication', entityType: 'notice', entityId: String(n._id), entityName: n.title, summary: `Withdrew notice “${n.title}”` }, req)
  return { withdrawn: true }
}

/** For the family app: published notices that reach this student, newest first (pinned on top). */
export async function noticesFor(student, { includeExpired = false } = {}) {
  const t = await today()
  const reach = { $or: [{ 'audience.kind': 'ALL' }, { 'audience.kind': 'CLASSES', 'audience.classIds': student.classId }, { 'audience.kind': 'SECTIONS', 'audience.sectionIds': student.sectionId }, { 'audience.kind': 'STUDENTS', 'audience.studentIds': student._id }] }
  const live = includeExpired ? {} : { $or: [{ expiresOn: null }, { expiresOn: { $gte: t } }] }
  const rows = await Notice.find({ status: 'PUBLISHED', $and: [reach, live] }).sort({ pinned: -1, publishedAt: -1 }).limit(60).lean()
  const [read, files] = await Promise.all([
    NoticeRead.find({ studentId: student._id, noticeId: { $in: rows.map((r) => r._id) } }).select('noticeId').lean(),
    Attachment.find({ entityType: 'notice', entityId: { $in: rows.map((r) => String(r._id)) }, 'deleted.at': null }).select('entityId fileName mime size').lean(),
  ])
  const seen = new Set(read.map((r) => String(r.noticeId)))
  return rows.map((n) => ({
    id: String(n._id), title: n.title, body: n.body, category: n.category, pinned: !!n.pinned, publishedAt: n.publishedAt, expiresOn: n.expiresOn ?? null, read: seen.has(String(n._id)),
    files: files.filter((f) => f.entityId === String(n._id)).map((f) => ({ id: String(f._id), name: f.fileName, mime: f.mime, size: f.size })),
  }))
}

/** A family opened a notice: count it once per student. */
export async function markNoticeRead(student, noticeId) {
  if (!isOid(noticeId)) throw notFound('Notice')
  const visible = (await noticesFor(student, { includeExpired: true })).some((n) => n.id === String(noticeId))
  if (!visible) throw notFound('Notice')
  await NoticeRead.updateOne({ noticeId, studentId: student._id }, { $setOnInsert: { readAt: new Date() } }, { upsert: true })
  return { read: true }
}

/** A notice's file, when the notice reaches this student. */
export async function noticeFile(student, noticeId, fileId) {
  if (!isOid(noticeId) || !isOid(fileId)) throw notFound('File')
  const visible = (await noticesFor(student, { includeExpired: true })).some((n) => n.id === String(noticeId))
  if (!visible) throw notFound('File')
  const file = await Attachment.findOne({ _id: fileId, entityType: 'notice', entityId: String(noticeId), 'deleted.at': null }).lean()
  if (!file) throw notFound('File')
  return file
}

/** For Files: a notice's name (staff attach files to drafts and published notices). */
export async function noticeRecord(id) {
  const n = isOid(id) ? await Notice.findById(id).select('title status').lean() : null
  return n && { name: n.title, locked: n.status === 'WITHDRAWN' }
}

// ───────────────────────────────────────────────────────── one-off messages

export async function sendBroadcast(input, auth, req) {
  checkAudience(input.audience)
  if (!input.channels?.length) throw badRequest('Tick at least one way to send it.', { fields: { channels: 'Pick one' } })
  const students = await resolveAudience(input.audience)
  if (!students.length) throw conflict('Nobody is in this audience.')
  if (students.length > MAX_AUDIENCE) throw conflict(`This reaches more than ${MAX_AUDIENCE} students. Send it class by class.`)
  const b = await Broadcast.create({ subject: input.subject || undefined, text: input.text, audience: input.audience, channels: input.channels, recipients: students.length, sentBy: auth.user?.name, sentById: auth.userId })
  let queued = 0
  let skipped = 0
  for (const s of students) {
    const rows = await queueFamilyMessages('communication.message', { studentId: String(s._id), data: { message: { subject: input.subject || input.text.slice(0, 60), text: input.text } }, entity: { type: 'broadcast', id: b._id }, pick: input.channels })
    queued += rows.filter((r) => r.status === 'QUEUED').length
    skipped += rows.filter((r) => r.status === 'SKIPPED').length
  }
  b.queued = queued
  b.skipped = skipped
  await b.save()
  await audit({ action: 'SEND', module: 'communication', entityType: 'broadcast', entityId: String(b._id), entityName: (input.subject || input.text).slice(0, 60), summary: `Sent a message to ${students.length} famil${students.length === 1 ? 'y' : 'ies'} by ${input.channels.join(', ')} (${queued} queued, ${skipped} skipped)` }, req)
  return { id: String(b._id), recipients: students.length, queued, skipped }
}

export async function listBroadcasts(paging) {
  const [rows, total] = await Promise.all([Broadcast.find().sort({ createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), Broadcast.countDocuments()])
  const [labels, status] = await Promise.all([
    audienceLabels(rows.map((r) => r.audience)),
    MessageLog.aggregate([{ $match: { entityType: 'broadcast', entityId: { $in: rows.map((r) => String(r._id)) } } }, { $group: { _id: { b: '$entityId', s: '$status' }, n: { $sum: 1 } } }]),
  ])
  return listResponse(rows.map((r) => {
    const by = Object.fromEntries(status.filter((x) => x._id.b === String(r._id)).map((x) => [x._id.s, x.n]))
    return noticeDto(r, labels, { delivery: { sent: by.SENT ?? 0, queued: (by.QUEUED ?? 0) + (by.SENDING ?? 0), failed: by.FAILED ?? 0, skipped: by.SKIPPED ?? 0 } })
  }), total, paging)
}

// ───────────────────────────────────────────────────────── chat: the teachers a family may write to

/** The class teacher and the subject teachers of a student's section. */
export async function teachersFor(student) {
  if (!student.sectionId) return []
  const [sec, allocs] = await Promise.all([Section.findById(student.sectionId).select('classTeacherId').lean(), TeacherAllocation.find({ sectionId: student.sectionId }).lean()])
  const ids = [...new Set([sec?.classTeacherId, ...allocs.map((a) => a.teacherId)].filter(Boolean).map(String))]
  const [users, subjects] = await Promise.all([
    User.find({ _id: { $in: ids }, active: { $ne: false } }).select('name designation').lean(),
    Subject.find({ _id: { $in: allocs.map((a) => a.subjectId) } }).select('name').lean(),
  ])
  const subj = new Map(subjects.map((s) => [String(s._id), s.name]))
  return users.map((u) => {
    const teaches = allocs.filter((a) => String(a.teacherId) === String(u._id)).map((a) => subj.get(String(a.subjectId))).filter(Boolean)
    const classTeacher = String(sec?.classTeacherId) === String(u._id)
    return { id: String(u._id), name: u.name, classTeacher, subjects: teaches, role: [classTeacher ? 'Class teacher' : null, ...teaches].filter(Boolean).join(' · ') }
  }).sort((a, b) => Number(b.classTeacher) - Number(a.classTeacher) || a.name.localeCompare(b.name))
}

const convoDto = (c, extra = {}) => ({ ...clean(c), studentId: String(c.studentId), staffUserId: String(c.staffUserId), sectionId: c.sectionId ? String(c.sectionId) : null, familyMobile: c.familyMobile ? maskMobile(c.familyMobile) : null, ...extra })
const messageDto = (m) => ({ id: String(m._id), from: m.from, byName: m.byName, text: m.hidden ? null : m.text, hidden: !!m.hidden, at: m.createdAt })

/** A family's conversations about one student. */
export async function familyConversations(student) {
  const rows = await Conversation.find({ studentId: student._id }).sort({ lastAt: -1 }).lean()
  return rows.map((c) => ({ id: String(c._id), staffUserId: String(c.staffUserId), staffName: c.staffName, subjectName: c.subjectName, lastAt: c.lastAt, lastText: c.lastText, lastFrom: c.lastFrom, unread: c.unreadFamily, closed: c.closed }))
}

/** One conversation for the family (marks the teacher's messages read). */
export async function familyThread(student, conversationId) {
  if (!isOid(conversationId)) throw notFound('Conversation')
  const c = await Conversation.findOne({ _id: conversationId, studentId: student._id }).lean()
  if (!c) throw notFound('Conversation')
  const msgs = await ChatMessage.find({ conversationId: c._id }).sort({ createdAt: 1 }).limit(500).lean()
  if (c.unreadFamily) await Conversation.updateOne({ _id: c._id }, { $set: { unreadFamily: 0 } })
  return { id: String(c._id), staffName: c.staffName, subjectName: c.subjectName, closed: c.closed, messages: msgs.map(messageDto) }
}

/** A family writes to a teacher of their child (starts the conversation, or adds to it). */
export async function familySend(student, session, { staffUserId, text }, req) {
  const teachers = await teachersFor(student)
  const teacher = teachers.find((x) => x.id === String(staffUserId))
  if (!teacher) throw badRequest('Write to one of your child’s teachers.', { fields: { staffUserId: 'Pick a teacher' } })
  let c = await Conversation.findOne({ studentId: student._id, staffUserId: teacher.id })
  if (c?.closed) throw conflict('This conversation was closed by the school. Please call the school office.')
  if (!c) c = new Conversation({ studentId: student._id, sectionId: student.sectionId, staffUserId: teacher.id, staffName: teacher.name, subjectName: teacher.role, familyMobile: session.mobile })
  const who = session.kind === 'STUDENT' ? `${student.firstName} (student)` : `Parent of ${student.firstName}`
  const m = await ChatMessage.create({ conversationId: c._id, from: CHAT_SIDES.FAMILY, byName: who, text })
  Object.assign(c, { lastAt: m.createdAt, lastText: text.slice(0, 140), lastFrom: CHAT_SIDES.FAMILY, unreadStaff: (c.unreadStaff ?? 0) + 1 })
  await c.save()
  await notifyUsers([teacher.id], { event: 'communication.chat', title: `${who}: new message`, message: text.slice(0, 140), link: `/communication/chat?c=${c._id}`, tone: 'info', entityType: 'conversation', entityId: String(c._id) })
  await audit({ action: 'CREATE', module: 'communication', entityType: 'chat_message', entityId: String(m._id), entityName: studentName(student), studentId: student._id, summary: `Family app: a message to ${teacher.name} about ${studentName(student)}` }, req)
  return familyThread(student, c._id)
}

// ───────────────────────────────────────────────────────── chat: the staff side

const mayModerate = (auth) => can(auth, 'communication.chat.moderate')

/** The caller's conversations (or, for a moderator asking for all, everyone's). */
export async function staffConversations(auth, { all = false, search } = {}) {
  const filter = all && mayModerate(auth) ? {} : { staffUserId: auth.userId }
  if (search) {
    const ids = (await Student.find({ $or: [{ firstName: new RegExp(escapeRegex(search), 'i') }, { lastName: new RegExp(escapeRegex(search), 'i') }, { admissionNo: new RegExp(escapeRegex(search), 'i') }] }).select('_id').limit(200).lean()).map((s) => s._id)
    filter.studentId = { $in: ids }
  }
  const rows = await Conversation.find(filter).sort({ lastAt: -1 }).limit(200).lean()
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName middleName lastName admissionNo').lean()).map((s) => [String(s._id), s]))
  const labels = await audienceLabels([{ sectionIds: rows.map((r) => r.sectionId).filter(Boolean) }])
  return rows.map((c) => convoDto(c, { studentName: studentName(students.get(String(c.studentId))), admissionNo: students.get(String(c.studentId))?.admissionNo, section: c.sectionId ? labels[String(c.sectionId)] ?? null : null, mine: String(c.staffUserId) === String(auth.userId) }))
}

async function convoFor(id, auth) {
  if (!isOid(id)) throw notFound('Conversation')
  const c = await Conversation.findById(id)
  if (!c) throw notFound('Conversation')
  if (String(c.staffUserId) !== String(auth.userId) && !mayModerate(auth)) throw notFound('Conversation')
  return c
}

export async function staffThread(id, auth) {
  const c = await convoFor(id, auth)
  const msgs = await ChatMessage.find({ conversationId: c._id }).sort({ createdAt: 1 }).limit(500).lean()
  if (String(c.staffUserId) === String(auth.userId) && c.unreadStaff) await Conversation.updateOne({ _id: c._id }, { $set: { unreadStaff: 0 } })
  const s = await Student.findById(c.studentId).select('firstName middleName lastName admissionNo').lean()
  return { ...convoDto(c.toObject()), studentName: studentName(s), admissionNo: s?.admissionNo, mine: String(c.staffUserId) === String(auth.userId), canModerate: mayModerate(auth), messages: msgs.map((m) => ({ ...messageDto(m), text: m.hidden && !mayModerate(auth) ? null : m.text })) }
}

/** A teacher replies; the family is told (once per unread run) by Notification rules › Teacher replied in chat. */
export async function staffReply(id, text, auth, req) {
  const c = await convoFor(id, auth)
  if (String(c.staffUserId) !== String(auth.userId)) throw forbidden('Only the teacher in this conversation can reply. Moderators can hide messages.')
  if (c.closed) throw conflict('This conversation is closed.')
  const m = await ChatMessage.create({ conversationId: c._id, from: CHAT_SIDES.STAFF, byName: auth.user?.name, byId: auth.userId, text })
  const firstUnread = !c.unreadFamily
  Object.assign(c, { lastAt: m.createdAt, lastText: text.slice(0, 140), lastFrom: CHAT_SIDES.STAFF, unreadFamily: (c.unreadFamily ?? 0) + 1, unreadStaff: 0 })
  await c.save()
  if (firstUnread) await queueFamilyMessages('communication.chat', { studentId: String(c.studentId), data: { chat: { teacher: auth.user?.name, link: await familyLink('chat') } }, entity: { type: 'conversation', id: c._id } })
  await audit({ action: 'CREATE', module: 'communication', entityType: 'chat_message', entityId: String(m._id), entityName: String(c.studentId), studentId: c.studentId, summary: `Replied in chat to the family of ${String(c.studentId)}` }, req)
  return staffThread(id, auth)
}

/** A teacher starts a conversation with a student's family (a student of a section they teach). */
export async function staffStart(studentId, text, auth, req) {
  if (!isOid(studentId)) throw notFound('Student')
  const s = await Student.findOne({ _id: studentId, status: 'ACTIVE' }).lean()
  if (!s) throw notFound('Student')
  const teacher = (await teachersFor(s)).find((x) => x.id === String(auth.userId))
  if (!teacher) throw forbidden('You can start a conversation with families of the classes you teach.')
  let c = await Conversation.findOne({ studentId: s._id, staffUserId: auth.userId })
  if (!c) c = await Conversation.create({ studentId: s._id, sectionId: s.sectionId, staffUserId: auth.userId, staffName: auth.user?.name, subjectName: teacher.role, lastAt: new Date() })
  return staffReply(String(c._id), text, auth, req)
}

/** A moderator hides a message (it stays in the record, shown as removed), or closes a conversation. */
export async function moderate(id, { messageId, close }, auth, req) {
  if (!mayModerate(auth)) throw forbidden()
  const c = await convoFor(id, auth)
  if (messageId) {
    if (!isOid(messageId)) throw notFound('Message')
    const r = await ChatMessage.updateOne({ _id: messageId, conversationId: c._id }, { $set: { hidden: true, hiddenBy: auth.user?.name, hiddenAt: new Date() } })
    if (!r.matchedCount) throw notFound('Message')
  }
  if (close !== undefined) { c.closed = !!close; await c.save() }
  await audit({ action: 'UPDATE', module: 'communication', entityType: 'conversation', entityId: String(c._id), entityName: String(c.studentId), studentId: c.studentId, summary: messageId ? 'Hid a chat message' : close ? 'Closed a chat conversation' : 'Reopened a chat conversation' }, req)
  return staffThread(id, auth)
}

/** Unread family messages for the caller (the menu badge). */
export async function myUnread(auth) {
  const r = await Conversation.aggregate([{ $match: { staffUserId: oid(auth.userId), unreadStaff: { $gt: 0 } } }, { $group: { _id: null, n: { $sum: '$unreadStaff' }, c: { $sum: 1 } } }])
  return { messages: r[0]?.n ?? 0, conversations: r[0]?.c ?? 0 }
}
