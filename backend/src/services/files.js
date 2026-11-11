import { createHash, randomUUID } from 'node:crypto'
import { COMMENT_MAX, FILE_CATEGORY_LABEL, FILE_MAX_MB, FILE_TYPES, RECORD_TYPES } from '@schoolgiant/shared'
import { Attachment, Comment } from '../models/engines.js'
import { Student, studentName } from '../models/students.js'
import { homeworkRecord, lessonPlanRecord } from './homework.js'
import { syllabusTopicRecord } from './homeworkTopics.js'
import { noticeRecord } from './communication.js'
import { Application } from '../models/admissions.js'
import { Candidate, Employee } from '../models/hrms.js'
import { employeeScope } from './hrmsCommon.js'
import { expenseRecord } from './financeExpenses.js'
import { lmsItemRecord } from './lms.js'
import { libraryTitleRecord } from './library.js'
import { eventRecord } from './events.js'
import { albumRecord } from './eventsGallery.js'
import { can, moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { putFile, readStream } from '../platform/storage.js'
import { assertWithinLimit } from './subscription.js'
import { accrEvidenceRecord } from './accreditation.js'
import { offerRecord } from './placementsOffers.js'
import { StaffChatChannel, StaffChatMember } from '../models/comms.js'

// Attachments and discussion on records (docs/00 §7 E15). Each record type says
// which module it belongs to, who may see it and who may add to it, and which
// student it is about (so Student 360 › Documents can list everything in one place).
//
// A module adds its record types here as it is built (fee receipt, staff document, asset …):
//   { module, view: [perm…], add: [perm…], remove?: [perm…], load: async (id, auth) => ({ studentId, name }) | null }

const RECORDS = {
  // A student's own file: birth certificate, previous school's TC, photos, medical forms.
  student: {
    module: 'students', view: ['students.profile.view'], add: ['students.profile.edit', 'students.admit.create'],
    load: async (id) => { const st = await Student.findById(id).lean(); return st && { studentId: st._id, name: `${studentName(st)} (${st.admissionNo})` } },
  },
  // A homework's worksheet, reference PDF or photos of the board — seen by whoever may see the homework.
  homework: {
    module: 'homework', view: ['homework.homework.view'], add: ['homework.homework.create', 'homework.homework.edit'],
    load: (id, auth) => homeworkRecord(id, auth).catch(() => null),
  },
  // A lesson plan's teaching material: slides, worksheets, an Excel sheet, a short video, pictures.
  lesson_plan: {
    module: 'homework', view: ['homework.lesson-plans.view'], add: ['homework.lesson-plans.create', 'homework.lesson-plans.edit'],
    load: (id, auth) => lessonPlanRecord(id, auth).catch(() => null),
  },
  // A syllabus topic's book pages, worksheets and pictures — shared by every section of the class and subject.
  syllabus_topic: {
    module: 'homework', view: ['homework.syllabus.view', 'homework.lesson-plans.view'], add: ['homework.syllabus.edit'],
    load: (id, auth) => syllabusTopicRecord(id, auth).catch(() => null),
  },
  // An applicant's papers: birth certificate, last report card, transfer certificate, photo — seen in the application.
  application: {
    module: 'admissions', view: ['admissions.applications.view'], add: ['admissions.applications.create', 'admissions.applications.edit'],
    load: async (id) => { const a = await Application.findById(id).select('applicationNo child status').lean(); return a && { name: `${a.applicationNo} · ${[a.child?.firstName, a.child?.lastName].filter(Boolean).join(' ')}`, locked: a.status === 'ADMITTED' } },
    locked: (rec) => (rec.locked ? 'This applicant has been admitted; add files to the student’s record instead.' : null),
  },
  // A notice's circular (PDF), photos or forms — families download them in the app.
  notice: {
    module: 'communication', view: ['communication.notices.view'], add: ['communication.notices.create', 'communication.notices.edit'],
    load: (id) => noticeRecord(id),
    locked: (rec) => (rec.locked ? 'This notice was withdrawn.' : null),
  },
  // A staff member's papers: appointment letter, degree certificates, ID proofs, experience letters.
  employee: {
    module: 'hrms', view: ['hrms.employees.view_sensitive'], add: ['hrms.employees.edit'],
    load: async (id, auth) => { const e = await Employee.findOne({ _id: id, ...employeeScope(auth) }).select('name employeeCode').lean(); return e && { name: `${e.name} (${e.employeeCode})` } },
  },
  // Study material on a course item: worksheets, slides, PDFs — students download them in the app.
  lms_item: {
    module: 'lms', view: ['lms.courses.view', 'lms.create-content.view', 'lms.my-content.view', 'lms.content-library.view'], add: ['lms.courses.create', 'lms.courses.edit', 'lms.create-content.create', 'lms.my-content.edit', 'lms.content-library.edit'],
    load: (id, auth) => lmsItemRecord(id, auth),
  },
  // An expense's bill, quotation or delivery note.
  expense: {
    module: 'finance', view: ['finance.expenses.view'], add: ['finance.expenses.create', 'finance.expenses.approve'],
    load: (id) => expenseRecord(id),
    locked: (rec) => (rec.locked ? 'This expense was cancelled.' : null),
  },
  // A job candidate's CV, certificates and demo-class notes.
  candidate: {
    module: 'hrms', view: ['hrms.hiring.view'], add: ['hrms.hiring.create', 'hrms.hiring.edit'],
    load: async (id) => { const c = await Candidate.findById(id).select('name').lean(); return c && { name: c.name } },
  },
  // An e-book's files (PDF, EPUB …): families open them in the app's e-library when the title is shown to them.
  library_title: {
    module: 'library', view: ['library.catalogue.view'], add: ['library.catalogue.create', 'library.catalogue.edit'],
    load: (id) => libraryTitleRecord(id),
  },
  // An event's circular, consent form or programme sheet.
  school_event: {
    module: 'events', view: ['events.calendar.view'], add: ['events.calendar.create', 'events.calendar.edit'],
    load: (id) => eventRecord(id),
  },
  // A photo album's photos (families see them in the app once the album is published).
  gallery_album: {
    module: 'events', view: ['events.gallery.view'], add: ['events.gallery.create'],
    load: (id) => albumRecord(id),
  },
  // An accreditation evidence item's documents: sanction letters, minutes, geo-tagged photos, certificates.
  accreditation_evidence: {
    module: 'accreditation', view: ['accreditation.evidence.view'], add: ['accreditation.evidence.create', 'accreditation.evidence.edit'],
    remove: ['accreditation.evidence.edit', 'accreditation.evidence.delete'],
    load: (id) => accrEvidenceRecord(id),
  },
  // A student's placement offer: the offer letter, joining papers.
  placement_offer: {
    module: 'placements', view: ['placements.offers.view'], add: ['placements.offers.create'],
    load: (id) => offerRecord(id),
    locked: (rec) => (rec.locked ? 'This offer was revoked.' : null),
  },
  // Staff chat: files are filed against the chat (entityId = channel id) and attached to a
  // message when it is sent. Only the chat's active members open them — the role permission
  // alone is not enough. Never about a student (a student is only a chip in the message).
  chat_message: {
    module: 'comms', view: ['comms.chat.view'], add: ['comms.chat.create'], remove: ['comms.chat.moderate'],
    load: async (id, auth) => {
      if (!auth?.userId || auth.apiKey) return null
      const member = await StaffChatMember.exists({ channelId: id, userId: auth.userId, active: true })
      if (!member) return null
      const c = await StaffChatChannel.findById(id).select('type name').lean()
      return c && { studentId: null, name: c.type === 'DIRECT' ? 'a direct chat' : `the chat “${c.name}”` }
    },
  },
}

const allows = (auth, keys) => keys.some((k) => can(auth, k))
export { allows as canAny }
export const canSeeRecordType = (auth, type) => !!RECORDS[type] && moduleEnabled(auth, RECORDS[type].module) && allows(auth, RECORDS[type].view)

/** Load a record and check the caller may see it (and add to it, when `adding`). */
export async function recordFor(type, id, auth, { adding = false, commenting = false } = {}) {
  const def = RECORDS[type]
  if (!def || !isOid(id)) throw notFound('Record')
  if (!moduleEnabled(auth, def.module)) throw notFound('Record')
  const own = def.owner ? await def.owner(id, auth) : null // a record that is the caller's own (self-service)
  if (!own && !allows(auth, def.view)) throw forbidden(`Your role can’t open this ${RECORD_TYPES[type].toLowerCase()}.`)
  if (adding && !own?.canAdd && !allows(auth, def.add)) throw forbidden(`Your role can’t add to this ${RECORD_TYPES[type].toLowerCase()}.`)
  if (commenting && own?.readOnly && !allows(auth, def.view)) throw forbidden(`Your role can’t comment on this ${RECORD_TYPES[type].toLowerCase()}.`)
  const rec = await def.load(id, auth, { own: !!own })
  if (!rec) throw notFound(RECORD_TYPES[type])
  if (adding) assertNotLocked(type, rec, auth)
  return rec
}

/** A record some may no longer change (a signed imaging report): throws the reason. */
export function assertNotLocked(type, rec, auth) {
  const locked = RECORDS[type].locked?.(rec, auth)
  if (locked) throw conflict(locked)
}

/**
 * May the caller remove this file (or image) from the record? The person who added it,
 * within a day; else whoever holds the record type's remove permission. A record that is
 * locked (a signed imaging report) is checked by recordFor(…, { adding: true }) first.
 */
export function assertCanRemove(type, item, auth) {
  const own = String(item.uploadedById) === auth.userId && Date.now() - new Date(item.createdAt) < 24 * 3_600_000
  if (!own && !auth.fullAccess && !allows(auth, RECORDS[type].remove ?? RECORDS[type].add)) throw forbidden('Only the person who added it (within a day) or someone who edits these records can remove a file.')
}
export const canRemove = (type, item, auth) => { try { assertCanRemove(type, item, auth); return true } catch { return false } }

// ───────────────────────────────────────────────────────── files

const sig = (buf, offset, text) => buf.subarray(offset, offset + text.length).toString('latin1') === text
/** What a file really is, from its first bytes — never trust the name or the browser. */
export function sniffType(buf, fileName = '') {
  if (sig(buf, 0, '%PDF-')) return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (sig(buf, 0, '\x89PNG\r\n\x1a\n')) return 'image/png'
  if (sig(buf, 0, 'RIFF') && sig(buf, 8, 'WEBP')) return 'image/webp'
  if (sig(buf, 0, 'PK\x03\x04')) {
    // Office files are zip packages: the name says which, the package's own folder confirms it
    const office = (ext, folder) => new RegExp(`\\.${ext}$`, 'i').test(fileName) && buf.includes(folder) ? FILE_TYPES.find((t) => t.ext === ext).mime : null
    return office('docx', 'word/') || office('xlsx', 'xl/') || office('pptx', 'ppt/') || null
  }
  if (sig(buf, 4, 'ftyp')) return 'video/mp4' // MP4 / M4V / QuickTime-compatible MP4
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 && /\.webm$/i.test(fileName)) return 'video/webm'
  return null
}

const cleanName = (name) => String(name || 'file').replace(/[\\/\0\r\n"]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file'

function fileDto(a) {
  return {
    id: String(a._id), entityType: a.entityType, entityId: a.entityId, studentId: a.studentId ? String(a.studentId) : null,
    category: a.category, categoryLabel: FILE_CATEGORY_LABEL[a.category] ?? a.category, title: a.title, fileName: a.fileName,
    contentType: a.mime, size: a.size, uploadedBy: a.uploadedBy, uploadedById: a.uploadedById ? String(a.uploadedById) : null,
    uploadedAt: a.createdAt, deleted: a.deleted?.at ? a.deleted : undefined,
  }
}

export async function uploadFile({ entityType, entityId, category, title, fileName }, buffer, auth, req) {
  const rec = await recordFor(entityType, entityId, auth, { adding: true })
  if (!buffer?.length) throw badRequest('The file is empty.')
  if (buffer.length > FILE_MAX_MB * 1024 * 1024) throw badRequest(`Files can be up to ${FILE_MAX_MB} MB.`)
  const name = cleanName(fileName)
  const mime = sniffType(buffer, name)
  if (!mime) throw badRequest('Only PDF, pictures (JPEG, PNG, WebP), Word, Excel, PowerPoint and MP4 / WebM video files can be added.')
  await assertWithinLimit(auth.tenantId, 'storageGb', buffer.length / 1e9)
  const ext = FILE_TYPES.find((t) => t.mime === mime).ext
  const now = new Date()
  const storageKey = `${auth.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`
  await putFile(storageKey, buffer)
  const a = await Attachment.create({
    entityType, entityId: String(entityId), studentId: rec.studentId, category: FILE_CATEGORY_LABEL[category] ? category : 'OTHER',
    title: title?.trim().slice(0, 120) || undefined, fileName: name, mime, size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'), storageKey, uploadedById: auth.userId, uploadedBy: auth.user.name,
  })
  await audit({ action: 'CREATE', module: RECORDS[entityType].module, entityType: 'attachment', entityId: String(a._id), entityName: name, studentId: rec.studentId, summary: `Added ${FILE_CATEGORY_LABEL[a.category].toLowerCase()} “${name}” to ${rec.name}` }, req)
  return fileDto(a.toObject())
}

/** Files on one record, or (studentId) on everything about one student that the caller may see. */
export async function listFiles({ entityType, entityId, studentId, includeDeleted }, auth) {
  let filter
  if (studentId) {
    await recordFor('student', studentId, auth)
    const types = Object.keys(RECORDS).filter((t) => canSeeRecordType(auth, t))
    filter = { studentId: oid(studentId), entityType: { $in: types } }
  } else {
    await recordFor(entityType, entityId, auth)
    filter = { entityType, entityId: String(entityId) }
  }
  if (!includeDeleted) filter['deleted.at'] = null
  const rows = await Attachment.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  return rows.map(fileDto)
}

/** Open a file: checks access, logs the view on the student's record, returns the stream. */
export async function openFile(id, auth, req) {
  const a = await Attachment.findById(id).lean()
  if (!a || a.deleted?.at) throw notFound('File')
  await recordFor(a.entityType, a.entityId, auth)
  if (a.studentId) await audit({ action: 'VIEW', module: RECORDS[a.entityType].module, entityType: 'attachment', entityId: String(a._id), entityName: a.fileName, studentId: a.studentId, summary: `Opened “${a.fileName}”` }, req)
  return { file: a, stream: readStream(a.storageKey) }
}

/** Hide a file. The bytes stay (records are never destroyed); who and why is kept. */
export async function deleteFile(id, reason, auth, req) {
  const a = await Attachment.findById(id)
  if (!a || a.deleted?.at) throw notFound('File')
  await recordFor(a.entityType, a.entityId, auth, { adding: true })
  assertCanRemove(a.entityType, a, auth)
  a.deleted = { at: new Date(), by: auth.user.name, reason }
  await a.save()
  await audit({ action: 'DELETE', module: RECORDS[a.entityType].module, entityType: 'attachment', entityId: String(a._id), entityName: a.fileName, studentId: a.studentId, summary: `Removed “${a.fileName}”: ${reason}` }, req)
  return fileDto(a.toObject())
}

// ───────────────────────────────────────────────────────── comments

const commentDto = (c) => ({
  id: String(c._id), parentId: c.parentId ? String(c.parentId) : null, body: c.body, authorId: String(c.authorId), authorName: c.authorName,
  createdAt: c.createdAt, edited: !!c.editedAt,
})

export async function listComments({ entityType, entityId }, auth) {
  await recordFor(entityType, entityId, auth)
  const rows = await Comment.find({ entityType, entityId: String(entityId), deletedAt: null }).sort({ createdAt: 1 }).limit(500).lean()
  return rows.map(commentDto)
}

export async function addComment({ entityType, entityId, body, parentId }, auth, req) {
  const rec = await recordFor(entityType, entityId, auth, { commenting: true })
  const text = String(body ?? '').trim()
  if (!text) throw badRequest('Write something first.')
  if (text.length > COMMENT_MAX) throw badRequest(`Keep it under ${COMMENT_MAX} characters.`)
  if (parentId) {
    const parent = await Comment.findOne({ _id: parentId, entityType, entityId: String(entityId), deletedAt: null }).lean()
    if (!parent) throw notFound('Comment')
    if (parent.parentId) parentId = String(parent.parentId) // one level of replies
  }
  const c = await Comment.create({ entityType, entityId: String(entityId), studentId: rec.studentId, parentId: parentId || undefined, body: text, authorId: auth.userId, authorName: auth.user.name })
  await audit({ action: 'CREATE', module: RECORDS[entityType].module, entityType: 'comment', entityId: String(c._id), entityName: rec.name, studentId: rec.studentId, summary: `Commented on ${rec.name}` }, req)
  return commentDto(c.toObject())
}

async function ownComment(id, auth, { allowAdmin = false } = {}) {
  const c = await Comment.findOne({ _id: id, deletedAt: null })
  if (!c) throw notFound('Comment')
  await recordFor(c.entityType, c.entityId, auth)
  if (String(c.authorId) !== auth.userId && !(allowAdmin && auth.fullAccess)) throw forbidden('Only the author can change this comment.')
  return c
}

export async function editComment(id, body, auth) {
  const c = await ownComment(id, auth)
  const text = String(body ?? '').trim()
  if (!text) throw badRequest('Write something first.')
  if (text.length > COMMENT_MAX) throw badRequest(`Keep it under ${COMMENT_MAX} characters.`)
  if (Date.now() - c.createdAt > 24 * 3_600_000) throw conflict('Comments can be edited for a day. Add a new one instead.')
  c.body = text
  c.editedAt = new Date()
  await c.save()
  return commentDto(c.toObject())
}

export async function deleteComment(id, auth, req) {
  const c = await ownComment(id, auth, { allowAdmin: true })
  c.deletedAt = new Date()
  await c.save()
  await Comment.updateMany({ parentId: c._id, deletedAt: null }, { $set: { deletedAt: c.deletedAt } })
  await audit({ action: 'DELETE', module: RECORDS[c.entityType].module, entityType: 'comment', entityId: String(c._id), studentId: c.studentId, summary: `Deleted a comment by ${c.authorName}` }, req)
  return { id: String(c._id) }
}
