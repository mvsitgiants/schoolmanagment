import { randomBytes } from 'node:crypto'
import {
  COURSE_STATUS, ITEM_KINDS, LIVE_STATUS, QUESTION_TYPES, checkQuestion, isWebUrl, jitsiUrl, sectionLabel,
} from '@schoolgiant/shared'
import { ClassLevel, Section, Subject } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { Course, CourseProgress, LiveClass, Question } from '../models/lms.js'
import { Student, studentName } from '../models/students.js'
import { can, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear, sectionsInScope } from './academics.js'
import { familyLink } from './familyLink.js'
import { homeworkLookup } from './homework.js'

// Learning (module `lms`): courses and their material, live classes and the question bank.
// Who sees what: wide-scope staff (all / campus) see every course and live class; a teacher on "My classes" sees the
// ones for their sections and the ones they teach. A course changes only by its teachers, whoever made it, or
// wide-scope staff with the edit permission.

const NARROW = ['CLASS', 'DEPARTMENT', 'OWN']
const wide = (auth) => !NARROW.includes(scopeOf(auth, 'lms'))
const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const now = () => institutionNow()

export const lmsLookup = (auth) => homeworkLookup(auth, 'lms')

/** Names for sections, classes and subjects. */
async function names({ sectionIds = [], classIds = [], subjectIds = [] }) {
  const sections = await Section.find({ $or: [{ _id: { $in: sectionIds.filter(isOid) } }, { classId: { $in: classIds.filter(isOid) } }] }).lean()
  const classes = await ClassLevel.find({ _id: { $in: [...classIds, ...sections.map((s) => s.classId)].filter(isOid) } }).select('name code order').lean()
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const subjects = await Subject.find({ _id: { $in: subjectIds.filter(isOid) } }).select('name code').lean()
  return {
    section: new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })])),
    sectionsOf: (classId) => sections.filter((s) => String(s.classId) === String(classId)),
    cls, subject: new Map(subjects.map((s) => [String(s._id), s.name])),
  }
}

/** The sections a course or live class reaches: its own, else every section of its class this year. */
async function reachOf(doc) {
  if (doc.sectionIds?.length) return doc.sectionIds.map(String)
  const year = await currentYear()
  return (await Section.find({ classId: doc.classId, ...(year && { academicYearId: year._id }) }).select('_id').lean()).map((s) => String(s._id))
}

async function visibleFilter(auth) {
  if (wide(auth)) return {}
  const allowed = await sectionsInScope(auth, 'lms') ?? []
  const secs = await Section.find({ _id: { $in: allowed } }).select('classId').lean()
  return { $or: [{ sectionIds: { $in: allowed.map(oid) } }, { sectionIds: { $size: 0 }, classId: { $in: secs.map((s) => s.classId) } }, { teacherIds: oid(auth.userId) }, { createdById: oid(auth.userId) }, { hostUserId: oid(auth.userId) }] }
}

const mayChange = (auth, c) => (wide(auth) && can(auth, 'lms.courses.edit')) || (c.teacherIds ?? []).some((t) => String(t) === String(auth.userId)) || String(c.createdById) === String(auth.userId)

// ───────────────────────────────────────────────────────── courses

const countItems = (units) => units.reduce((n, u) => n + u.items.length, 0)
const countPublished = (units) => units.reduce((n, u) => n + u.items.filter((i) => i.published !== false).length, 0)

export async function listCourses(q, auth) {
  const year = await currentYear()
  const f = { ...(await visibleFilter(auth)), ...(year && { academicYearId: year._id }) }
  if (q.status) f.status = q.status
  else f.status = { $ne: 'ARCHIVED' }
  if (isOid(q.classId)) f.classId = q.classId
  if (isOid(q.subjectId)) f.subjectId = q.subjectId
  const rows = await Course.find(f).sort({ updatedAt: -1 }).limit(500).lean()
  const n = await names({ sectionIds: rows.flatMap((r) => r.sectionIds.map(String)), classIds: rows.map((r) => String(r.classId)), subjectIds: rows.map((r) => String(r.subjectId)) })
  return rows.map((c) => ({
    id: String(c._id), title: c.title, status: c.status, statusLabel: COURSE_STATUS[c.status]?.label, classId: String(c.classId), subjectId: String(c.subjectId),
    className: n.cls.get(String(c.classId))?.name ?? '', subject: n.subject.get(String(c.subjectId)) ?? '',
    sections: c.sectionIds.length ? c.sectionIds.map((s) => n.section.get(String(s))).filter(Boolean) : [],
    units: c.units.length, items: countItems(c.units), published: countPublished(c.units), updatedAt: c.updatedAt, canChange: mayChange(auth, c),
  }))
}

async function courseFor(id, auth) {
  const c = isOid(id) ? await Course.findOne({ _id: id, ...(await visibleFilter(auth)) }) : null
  if (!c) throw notFound('Course')
  return c
}

export async function getCourse(id, auth) {
  const c = (await courseFor(id, auth)).toObject()
  const itemIds = c.units.flatMap((u) => u.items.map((i) => String(i._id)))
  const [n, files] = await Promise.all([
    names({ sectionIds: c.sectionIds.map(String), classIds: [String(c.classId)], subjectIds: [String(c.subjectId)] }),
    Attachment.find({ entityType: 'lms_item', entityId: { $in: itemIds }, 'deleted.at': null }).select('entityId fileName mime size').lean(),
  ])
  return {
    ...clean(c), classId: String(c.classId), subjectId: String(c.subjectId), sectionIds: c.sectionIds.map(String), teacherIds: c.teacherIds.map(String),
    className: n.cls.get(String(c.classId))?.name ?? '', subject: n.subject.get(String(c.subjectId)) ?? '', statusLabel: COURSE_STATUS[c.status]?.label,
    sections: c.sectionIds.map((s) => ({ id: String(s), label: n.section.get(String(s)) ?? '' })),
    units: c.units.map((u) => ({ id: String(u._id), title: u.title, items: u.items.map((i) => ({ id: String(i._id), kind: i.kind, title: i.title, body: i.body ?? '', url: i.url ?? '', published: i.published !== false, minutes: i.minutes ?? null, files: files.filter((x) => x.entityId === String(i._id)).map((x) => ({ id: String(x._id), name: x.fileName, mime: x.mime, size: x.size })) })) })),
    canChange: mayChange(auth, c),
  }
}

async function checkMeta(input, auth) {
  const cls = isOid(input.classId) ? await ClassLevel.findById(input.classId).select('subjectIds').lean() : null
  if (!cls) throw fieldsError({ classId: 'Pick a class' })
  if (!await Subject.exists({ _id: input.subjectId })) throw fieldsError({ subjectId: 'Pick a subject' })
  const year = await currentYear()
  if (!year) throw conflict('Set up the academic year first.')
  if (input.sectionIds?.length) {
    const ok = await Section.countDocuments({ _id: { $in: input.sectionIds }, classId: cls._id })
    if (ok !== input.sectionIds.length) throw fieldsError({ sectionIds: 'Sections of this class only' })
    if (!wide(auth)) {
      const allowed = new Set((await sectionsInScope(auth, 'lms') ?? []).map(String))
      if (input.sectionIds.some((s) => !allowed.has(String(s)))) throw forbidden('You can make courses for your own classes only.')
    }
  }
  return year
}

export async function createCourse(input, auth, req) {
  const year = await checkMeta(input, auth)
  const c = await Course.create({
    academicYearId: year._id, classId: input.classId, subjectId: input.subjectId, sectionIds: input.sectionIds ?? [], title: input.title, description: input.description,
    teacherIds: [...new Set([...(input.teacherIds ?? []), ...(isOid(auth.userId) ? [String(auth.userId)] : [])])], createdBy: auth.user?.name, createdById: isOid(auth.userId) ? auth.userId : undefined,
    units: [{ title: input.firstUnit || 'Unit 1', items: [] }],
  })
  await audit({ action: 'CREATE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Made course ${c.title}` }, req)
  return getCourse(String(c._id), auth)
}

export async function updateCourse(id, input, auth, req) {
  const c = await courseFor(id, auth)
  if (!mayChange(auth, c)) throw forbidden('Only the course’s teachers can change it.')
  if (input.classId || input.subjectId || input.sectionIds) await checkMeta({ classId: input.classId ?? String(c.classId), subjectId: input.subjectId ?? String(c.subjectId), sectionIds: input.sectionIds ?? c.sectionIds.map(String) }, auth)
  for (const k of ['title', 'description', 'classId', 'subjectId', 'sectionIds', 'teacherIds']) if (input[k] !== undefined) c[k] = input[k]
  await c.save()
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Changed course ${c.title}` }, req)
  return getCourse(id, auth)
}

/** The whole outline at once: units and their items in order (ids kept, so files and progress stay with them). */
export async function saveOutline(id, units, auth, req) {
  const c = await courseFor(id, auth)
  if (!mayChange(auth, c)) throw forbidden('Only the course’s teachers can change it.')
  const fields = {}
  units.forEach((u, i) => u.items.forEach((it, j) => {
    if (!ITEM_KINDS[it.kind]) fields[`units.${i}.items.${j}.kind`] = 'Pick a kind'
    if (['LINK', 'VIDEO'].includes(it.kind) && !isWebUrl(it.url)) fields[`units.${i}.items.${j}.url`] = 'A web address (https://…)'
  }))
  if (Object.keys(fields).length) throw fieldsError(fields)
  c.units = units.map((u) => ({ ...(isOid(u.id) && { _id: u.id }), title: u.title, items: u.items.map((it) => ({ ...(isOid(it.id) && { _id: it.id }), kind: it.kind, title: it.title, body: it.kind === 'NOTE' ? it.body : undefined, url: ['LINK', 'VIDEO'].includes(it.kind) ? it.url : undefined, published: it.published !== false, minutes: it.minutes || undefined })) }))
  await c.save()
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Changed the material of ${c.title} (${units.length} unit(s), ${countItems(c.units)} item(s))` }, req)
  return getCourse(id, auth)
}

export async function setCourseStatus(id, status, auth, req) {
  const c = await courseFor(id, auth)
  if (!mayChange(auth, c)) throw forbidden('Only the course’s teachers can change it.')
  c.status = status
  if (status === 'PUBLISHED' && !c.publishedAt) c.publishedAt = new Date()
  await c.save()
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `${COURSE_STATUS[status].label}: course ${c.title}` }, req)
  return getCourse(id, auth)
}

export async function deleteCourse(id, auth, req) {
  const c = await courseFor(id, auth)
  if (!mayChange(auth, c)) throw forbidden('Only the course’s teachers can delete it.')
  if (await CourseProgress.exists({ courseId: c._id, 'done.0': { $exists: true } })) throw conflict('Students have started this course. Archive it instead.')
  await Course.deleteOne({ _id: c._id })
  await audit({ action: 'DELETE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Deleted course ${c.title}` }, req)
  return { deleted: true }
}

/** How far each student of the course's sections has got. */
export async function courseProgressReport(id, auth) {
  const c = (await courseFor(id, auth)).toObject()
  const reach = await reachOf(c)
  const [students, progress] = await Promise.all([
    Student.find({ sectionId: { $in: reach }, status: 'ACTIVE' }).select('firstName middleName lastName admissionNo rollNo sectionId').sort({ rollNo: 1, firstName: 1 }).lean(),
    CourseProgress.find({ courseId: c._id }).lean(),
  ])
  const published = new Set(c.units.flatMap((u) => u.items.filter((i) => i.published !== false).map((i) => String(i._id))))
  const by = new Map(progress.map((p) => [String(p.studentId), p]))
  const n = await names({ sectionIds: reach })
  return {
    total: published.size,
    rows: students.map((s) => {
      const p = by.get(String(s._id))
      const done = (p?.done ?? []).filter((d) => published.has(String(d))).length
      return { studentId: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, section: n.section.get(String(s.sectionId)) ?? '', done, pct: published.size ? Math.round((done / published.size) * 100) : 0, lastAt: p?.lastAt ?? null }
    }),
  }
}

/** For the files engine: an item's files are seen by whoever sees the course. */
export async function lmsItemRecord(itemId, auth) {
  if (!isOid(itemId)) return null
  const c = await Course.findOne({ 'units.items._id': itemId, ...(await visibleFilter(auth)) }).lean()
  if (!c) return null
  const item = c.units.flatMap((u) => u.items).find((i) => String(i._id) === String(itemId))
  return { name: `${c.title} · ${item?.title ?? ''}`, canAdd: mayChange(auth, c) }
}

// ───────────────────────────────────────────────────────── live classes

const liveOut = (l, n, nowT) => ({
  ...clean(l), classId: String(l.classId), subjectId: idStr(l.subjectId), courseId: idStr(l.courseId), sectionIds: l.sectionIds.map(String), hostUserId: idStr(l.hostUserId),
  subject: n?.subject.get(String(l.subjectId)) ?? '', className: n?.cls.get(String(l.classId))?.name ?? '',
  sections: l.sectionIds.map((s) => n?.section.get(String(s))).filter(Boolean), statusLabel: LIVE_STATUS[l.status]?.label,
  link: l.provider === 'JITSI' ? jitsiUrl(l.room) : l.joinUrl, joined: l.joins?.length ?? 0,
  past: nowT ? l.date < nowT.date : false,
})

export async function listLive({ from, to, status }, auth) {
  const t = await now()
  const f = { ...(await visibleFilter(auth)) }
  f.date = { $gte: from ?? t.date, ...(to && { $lte: to }) }
  if (status) f.status = status
  const rows = await LiveClass.find(f).sort({ date: 1, start: 1 }).limit(300).lean()
  const n = await names({ sectionIds: rows.flatMap((r) => r.sectionIds.map(String)), classIds: rows.map((r) => String(r.classId)), subjectIds: rows.map((r) => idStr(r.subjectId)).filter(Boolean) })
  return rows.map((l) => liveOut(l, n, t))
}

async function liveFor(id, auth) {
  const l = isOid(id) ? await LiveClass.findOne({ _id: id, ...(await visibleFilter(auth)) }) : null
  if (!l) throw notFound('Live class')
  return l
}
const mayRun = (auth, l) => String(l.hostUserId) === String(auth.userId) || (wide(auth) && can(auth, 'lms.live-classes.create'))

async function tellFamilies(l, status) {
  const reach = await reachOf(l)
  const students = await Student.find({ sectionId: { $in: reach }, status: 'ACTIVE' }).select('_id sectionId').lean()
  const n = await names({ sectionIds: reach, subjectIds: [idStr(l.subjectId)].filter(Boolean) })
  const link = await familyLink('learning')
  for (const s of students) {
    await emit('lms.live_class', { studentId: String(s._id), entity: { type: 'live_class', id: l._id }, data: { student: { class: n.section.get(String(s.sectionId)) ?? '' }, live: { subject: n.subject.get(String(l.subjectId)) ?? '', title: l.title, date: l.date, time: l.start, status, link } } })
  }
  return students.length
}

export async function createLive(input, auth, req) {
  const cls = isOid(input.classId) ? await ClassLevel.exists({ _id: input.classId }) : null
  if (!cls) throw fieldsError({ classId: 'Pick a class' })
  if (input.provider !== 'JITSI' && !isWebUrl(input.joinUrl)) throw fieldsError({ joinUrl: 'Paste the meeting link (https://…)' })
  if (input.date < (await now()).date) throw fieldsError({ date: 'In the past' })
  if (!wide(auth) && input.sectionIds?.length) {
    const allowed = new Set((await sectionsInScope(auth, 'lms') ?? []).map(String))
    if (input.sectionIds.some((s) => !allowed.has(String(s)))) throw forbidden('You can schedule live classes for your own classes only.')
  }
  const l = await LiveClass.create({
    ...input, joinUrl: input.provider === 'JITSI' ? undefined : input.joinUrl,
    room: input.provider === 'JITSI' ? `SchoolGiant-${randomBytes(9).toString('base64url')}` : undefined,
    hostUserId: isOid(auth.userId) ? auth.userId : undefined, hostName: auth.user?.name, createdBy: auth.user?.name,
  })
  let told = 0
  if (input.notify) { told = await tellFamilies(l, 'scheduled'); l.notifiedAt = new Date(); await l.save() }
  await audit({ action: 'CREATE', module: 'lms', entityType: 'live_class', entityId: String(l._id), entityName: l.title, summary: `Scheduled live class ${l.title} on ${l.date} ${l.start}${told ? ` (told ${told} families)` : ''}` }, req)
  return { ...liveOut(l.toObject(), await names({ sectionIds: l.sectionIds.map(String), classIds: [String(l.classId)], subjectIds: [idStr(l.subjectId)].filter(Boolean) })), told }
}

export async function updateLive(id, input, auth, req) {
  const l = await liveFor(id, auth)
  if (!mayRun(auth, l)) throw forbidden('Only the teacher who scheduled it can change it.')
  if (['ENDED', 'CANCELLED'].includes(l.status)) throw conflict('This class is over.')
  for (const k of ['title', 'date', 'start', 'durationMin', 'notes']) if (input[k] !== undefined) l[k] = input[k]
  if (input.joinUrl !== undefined && l.provider !== 'JITSI') {
    if (!isWebUrl(input.joinUrl)) throw fieldsError({ joinUrl: 'Paste the meeting link (https://…)' })
    l.joinUrl = input.joinUrl
  }
  await l.save()
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'live_class', entityId: String(l._id), entityName: l.title, summary: `Changed live class ${l.title} (${l.date} ${l.start})` }, req)
  return liveOut(l.toObject())
}

/** The teacher starts the class: it is live for students to join, and the teacher gets the link. */
export async function startLive(id, auth, req) {
  const l = await liveFor(id, auth)
  if (!mayRun(auth, l)) throw forbidden('Only the teacher who scheduled it can start it.')
  if (['ENDED', 'CANCELLED'].includes(l.status)) throw conflict('This class is over.')
  if (l.status !== 'LIVE') { l.status = 'LIVE'; l.startedAt = new Date(); await l.save() }
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'live_class', entityId: String(l._id), entityName: l.title, summary: `Started live class ${l.title}` }, req)
  return liveOut(l.toObject())
}

export async function endLive(id, { recordingUrl }, auth, req) {
  const l = await liveFor(id, auth)
  if (!mayRun(auth, l)) throw forbidden()
  if (l.status === 'CANCELLED') throw conflict('This class was cancelled.')
  if (recordingUrl && !isWebUrl(recordingUrl)) throw fieldsError({ recordingUrl: 'A web address (https://…)' })
  Object.assign(l, { status: 'ENDED', endedAt: l.endedAt ?? new Date(), recordingUrl: recordingUrl || l.recordingUrl })
  await l.save()
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'live_class', entityId: String(l._id), entityName: l.title, summary: `Ended live class ${l.title} — ${l.joins.length} student(s) joined` }, req)
  return liveOut(l.toObject())
}

export async function cancelLive(id, { reason, notify }, auth, req) {
  const l = await liveFor(id, auth)
  if (!mayRun(auth, l)) throw forbidden()
  if (l.status !== 'SCHEDULED') throw conflict('Only a class that hasn’t started can be cancelled.')
  l.status = 'CANCELLED'
  l.cancelReason = reason
  await l.save()
  if (notify || l.notifiedAt) await tellFamilies(l, 'is cancelled')
  await audit({ action: 'CANCEL', module: 'lms', entityType: 'live_class', entityId: String(l._id), entityName: l.title, summary: `Cancelled live class ${l.title}${reason ? `: ${reason}` : ''}` }, req)
  return liveOut(l.toObject())
}

/** Who of the class's students joined. */
export async function liveAttendance(id, auth) {
  const l = (await liveFor(id, auth)).toObject()
  const reach = await reachOf(l)
  const students = await Student.find({ sectionId: { $in: reach }, status: 'ACTIVE' }).select('firstName middleName lastName admissionNo rollNo sectionId').sort({ rollNo: 1, firstName: 1 }).lean()
  const joined = new Map((l.joins ?? []).map((j) => [String(j.studentId), j.at]))
  const n = await names({ sectionIds: reach })
  return { joined: joined.size, total: students.length, rows: students.map((s) => ({ studentId: String(s._id), name: studentName(s), rollNo: s.rollNo ?? null, section: n.section.get(String(s.sectionId)) ?? '', joinedAt: joined.get(String(s._id)) ?? null })) }
}

// ───────────────────────────────────────────────────────── question bank

const qOut = (q) => ({ ...clean(q), subjectId: String(q.subjectId), classId: idStr(q.classId), typeLabel: QUESTION_TYPES[q.type]?.label })

export async function listQuestions(q, paging) {
  const f = {}
  if (isOid(q.subjectId)) f.subjectId = q.subjectId
  if (isOid(q.classId)) f.classId = q.classId
  if (q.type) f.type = q.type
  if (q.difficulty) f.difficulty = q.difficulty
  if (q.chapter) f.chapter = q.chapter
  f.active = q.inactive ? false : { $ne: false }
  if (q.search) f.text = new RegExp(escapeRegex(q.search), 'i')
  const [rows, total] = await Promise.all([
    Question.find(f).sort({ updatedAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Question.countDocuments(f),
  ])
  const chapters = isOid(q.subjectId) ? (await Question.distinct('chapter', { subjectId: q.subjectId, ...(isOid(q.classId) && { classId: q.classId }) })).filter(Boolean).sort() : []
  return { ...listResponse(rows.map(qOut), total, paging), chapters }
}

export async function getQuestion(id) {
  const q = isOid(id) ? await Question.findById(id).lean() : null
  if (!q) throw notFound('Question')
  return qOut(q)
}

const tidy = (input) => ({
  ...input,
  options: QUESTION_TYPES[input.type]?.options ? (input.type === 'TRUE_FALSE' ? [{ text: 'True', correct: !!input.options?.[0]?.correct }, { text: 'False', correct: !!input.options?.[1]?.correct }] : (input.options ?? []).filter((o) => String(o.text ?? '').trim())) : [],
  answers: ['FILL', 'SHORT', 'LONG'].includes(input.type) ? (input.answers ?? []).map((a) => String(a).trim()).filter(Boolean) : undefined,
})

export async function saveQuestion(id, input, auth, req) {
  const body = tidy(input)
  const errors = checkQuestion(body)
  if (Object.keys(errors).length) throw fieldsError(errors)
  if (!await Subject.exists({ _id: body.subjectId })) throw fieldsError({ subjectId: 'Pick a subject' })
  const q = id ? await Question.findById(id) : new Question({ createdBy: auth.user?.name, createdById: isOid(auth.userId) ? auth.userId : undefined })
  if (!q) throw notFound('Question')
  Object.assign(q, body)
  await q.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'lms', entityType: 'question', entityId: String(q._id), entityName: q.text.slice(0, 60), summary: `${id ? 'Changed' : 'Added'} a ${QUESTION_TYPES[q.type].label.toLowerCase()} question` }, req)
  return qOut(q.toObject())
}

/** A question a test used is switched off instead of deleted (the test keeps its copy). */
export async function deleteQuestion(id, req) {
  const q = isOid(id) ? await Question.findById(id) : null
  if (!q) throw notFound('Question')
  if (q.used > 0) { q.active = false; await q.save() } else await Question.deleteOne({ _id: q._id })
  await audit({ action: 'DELETE', module: 'lms', entityType: 'question', entityId: String(q._id), entityName: q.text.slice(0, 60), summary: q.used > 0 ? 'Switched off a question used in tests' : 'Deleted a question' }, req)
  return { deleted: !q.used, deactivated: q.used > 0 }
}

/**
 * Many at once from a sheet. Columns: subject (code or name), class (code or name), chapter, type (MCQ, MULTI,
 * TRUE_FALSE, FILL, SHORT, LONG), question, option1…option6, answer (MCQ: the option number; MULTI: numbers
 * separated by commas; TRUE_FALSE: True or False; FILL: accepted answers separated by |), marks, negative,
 * difficulty, explanation.
 */
export async function importQuestions(rows, { dryRun }, auth, req) {
  const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const [subjects, classes] = await Promise.all([Subject.find().select('name code').lean(), ClassLevel.find().select('name code').lean()])
  const find = (list, v) => list.find((x) => x.code?.toUpperCase() === cell(v).toUpperCase() || x.name.toLowerCase() === cell(v).toLowerCase())
  const out = rows.map((f, i) => {
    const errors = []
    const type = cell(f.type).toUpperCase().replace(/[\s/-]+/g, '_') || 'MCQ'
    const subject = find(subjects, f.subject)
    const cls = cell(f.class) ? find(classes, f.class) : null
    if (!subject) errors.push({ field: 'subject', message: cell(f.subject) ? `No subject "${cell(f.subject)}"` : 'Enter the subject' })
    if (cell(f.class) && !cls) errors.push({ field: 'class', message: `No class "${cell(f.class)}"` })
    const opts = [1, 2, 3, 4, 5, 6].map((n) => cell(f[`option${n}`])).filter(Boolean)
    const ans = cell(f.answer)
    let options = []
    let answers
    if (type === 'MCQ' || type === 'MULTI') {
      const picked = new Set(ans.split(/[,\s]+/).map(Number).filter((n) => n >= 1))
      options = opts.map((text, k) => ({ text, correct: picked.has(k + 1) }))
    } else if (type === 'TRUE_FALSE') options = [{ text: 'True', correct: /^t/i.test(ans) }, { text: 'False', correct: /^f/i.test(ans) }]
    else answers = ans ? ans.split('|').map((x) => x.trim()).filter(Boolean) : []
    const doc = {
      subjectId: subject?._id, classId: cls?._id, chapter: cell(f.chapter) || undefined, type, text: cell(f.question), options, answers,
      marks: Number(cell(f.marks) || 1), negative: Number(cell(f.negative) || 0), difficulty: ['EASY', 'MEDIUM', 'HARD'].includes(cell(f.difficulty).toUpperCase()) ? cell(f.difficulty).toUpperCase() : 'MEDIUM',
      explanation: cell(f.explanation) || undefined,
    }
    for (const [field, message] of Object.entries(checkQuestion(doc))) errors.push({ field: field === 'text' ? 'question' : field === 'options' ? 'answer' : field, message })
    return { row: i + 1, fields: f, errors, doc }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let imported = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    await Question.create({ ...r.doc, createdBy: auth.user?.name, createdById: isOid(auth.userId) ? auth.userId : undefined })
    imported++
  }
  if (imported) await audit({ action: 'IMPORT', module: 'lms', entityType: 'question', entityName: `${imported} questions`, summary: `Imported ${imported} question(s) into the question bank` }, req)
  return { imported, errors }
}
