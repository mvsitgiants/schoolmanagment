import { CONTENT_TYPES, contentStatus, contentTypeOfKind, hasRichContent, isWebUrl, sanitizeHtml, htmlToText, videoEmbed } from '@schoolgiant/shared'
import { Section, Subject } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { Syllabus } from '../models/homework.js'
import { Course } from '../models/lms.js'
import { Student, studentName } from '../models/students.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { hhmmIn, timeZoneOf, ymdIn, zonedDate } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear } from './academics.js'
import { lmsLookup, lmsNames, lmsWide, visibleFilter } from './lms.js'

// Teaching content ("Create content", "My content", "Content library"): study material, videos and links a teacher
// shares for a syllabus topic. Each one is an item of the class + subject course of the current year (made, published,
// when there is none), in the unit named after the topic's syllabus unit — so the course page and the students' Learning
// page show it as they show any other item. Assignment and quiz tiles open the homework and online-test forms instead.

const fieldsError = (fields) => badRequest('Some details need fixing.', { fields })
const me = (auth) => (isOid(auth.userId) ? oid(auth.userId) : null)

/** May this person change (edit) or remove (delete) the item? Its creator, or wide-scope staff who manage all content. */
export function mayChangeItem(auth, item, action = 'edit') {
  const mine = !!item.createdById && String(item.createdById) === String(auth.userId)
  return (mine && can(auth, `lms.my-content.${action}`)) || (lmsWide(auth) && (can(auth, `lms.content-library.${action}`) || can(auth, 'lms.courses.edit')))
}

/** The syllabus units and topics of a class's subject this year (the topic picker). */
export async function contentTopics({ classId, subjectId }, auth) {
  const look = await lmsLookup(auth)
  const cls = look.classes.find((c) => c.id === String(classId))
  if (!cls || !cls.subjects.some((s) => s.id === String(subjectId))) throw notFound('Syllabus')
  const syl = await Syllabus.findOne({ academicYearId: look.year.id, classId, subjectId }).select('units').lean()
  return (syl?.units ?? []).map((u) => ({ id: String(u._id), name: u.name, topics: (u.topics ?? []).map((t) => ({ id: String(t._id), name: t.name })) })).filter((u) => u.topics.length)
}

/** The class's students this year (the "chosen students" checklist). */
export async function contentStudents({ classId }, auth) {
  const look = await lmsLookup(auth)
  if (!look.classes.some((c) => c.id === String(classId))) throw notFound('Class')
  const sections = await Section.find({ classId, academicYearId: look.year.id }).select('_id').lean()
  const label = new Map(look.sections.map((s) => [s.id, s.short]))
  const rows = await Student.find({ sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' }).select('firstName middleName lastName admissionNo rollNo sectionId').sort({ rollNo: 1, firstName: 1 }).limit(2000).lean()
  return rows.map((s) => ({ id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, section: label.get(String(s.sectionId)) ?? '' }))
}

/** Where the content goes: class + subject this person teaches, the topic of its syllabus (and its unit). */
async function placeOf(input, auth) {
  const look = await lmsLookup(auth)
  const cls = look.classes.find((c) => c.id === String(input.classId))
  if (!cls) throw fieldsError({ classId: 'Pick one of your classes' })
  if (!cls.subjects.some((s) => s.id === String(input.subjectId))) throw fieldsError({ subjectId: 'Pick a subject of this class' })
  if (!look.year) throw conflict('Set up the academic year first.')
  const syl = await Syllabus.findOne({ academicYearId: look.year.id, classId: input.classId, subjectId: input.subjectId }).select('units').lean()
  for (const u of syl?.units ?? []) {
    const topic = (u.topics ?? []).find((t) => String(t._id) === String(input.topicId))
    if (topic) return { yearId: look.year.id, unitName: u.name, topic }
  }
  throw fieldsError({ topicId: 'Pick a topic from this class’s syllabus' })
}

/** The checked item fields from the form. */
async function itemFields(input, auth) {
  const type = CONTENT_TYPES[input.type]
  if (!type?.kind) throw fieldsError({ type: 'Pick study material, video or link' })
  const fields = {}
  const url = String(input.url ?? '').trim()
  if (['VIDEO', 'LINK'].includes(type.kind) && !isWebUrl(url)) fields.url = 'A web address (https://…)'
  let publishAt = null
  if (input.publish === 'LATER') {
    if (!input.publishDate || !input.publishTime) fields.publishDate = 'Pick the date and time'
    else {
      publishAt = zonedDate(input.publishDate, input.publishTime, await timeZoneOf())
      if (publishAt <= new Date()) fields.publishDate = 'Pick a time later than now'
    }
  }
  let studentIds
  if (input.visibility === 'STUDENTS') {
    const ids = [...new Set((input.studentIds ?? []).map(String))].filter(isOid)
    const sections = await Section.find({ classId: input.classId }).select('_id').lean()
    const ok = ids.length ? await Student.countDocuments({ _id: { $in: ids }, sectionId: { $in: sections.map((s) => s._id) } }) : 0
    if (!ids.length) fields.studentIds = 'Pick the students'
    else if (ok !== ids.length) fields.studentIds = 'Students of this class only'
    studentIds = ids
  }
  if (Object.keys(fields).length) throw fieldsError(fields)
  const html = sanitizeHtml(input.descriptionHtml ?? '')
  return {
    kind: type.kind, title: input.title.trim(), descriptionHtml: html || undefined, body: htmlToText(html).slice(0, 20000) || undefined,
    url: ['VIDEO', 'LINK'].includes(type.kind) ? url : undefined, published: true, publishAt,
    visibility: input.visibility === 'STUDENTS' ? 'STUDENTS' : 'ALL', studentIds, updatedAt: new Date(),
  }
}

/** The class + subject course of the year that holds shared content (made, published, for every section if missing). */
async function holderCourse({ yearId, classId, subjectId }, auth) {
  const c = await Course.findOne({ academicYearId: yearId, classId, subjectId, sectionIds: { $size: 0 }, status: 'PUBLISHED' }).sort({ createdAt: 1 })
  if (c) return c
  const subject = await Subject.findById(subjectId).select('name').lean()
  return new Course({
    academicYearId: yearId, classId, subjectId, sectionIds: [], title: subject?.name ?? 'Course', status: 'PUBLISHED', publishedAt: new Date(),
    teacherIds: me(auth) ? [me(auth)] : [], createdBy: auth.user?.name, createdById: me(auth) ?? undefined, units: [],
  })
}

const unitIn = (course, name) => {
  let u = course.units.find((x) => x.title.trim().toLowerCase() === name.trim().toLowerCase())
  if (!u) { course.units.push({ title: name, items: [] }); u = course.units[course.units.length - 1] }
  return u
}

/** The course and item of an id the caller can see. */
async function locate(id, auth) {
  const c = isOid(id) ? await Course.findOne({ 'units.items._id': id, ...(await visibleFilter(auth)) }) : null
  const unit = c?.units.find((u) => u.items.some((i) => String(i._id) === String(id)))
  const item = unit?.items.find((i) => String(i._id) === String(id))
  if (!item) throw notFound('Content')
  return { c, unit, item }
}

export async function createContent(input, auth, req) {
  const place = await placeOf(input, auth)
  const fields = await itemFields(input, auth)
  const c = await holderCourse({ yearId: place.yearId, classId: input.classId, subjectId: input.subjectId }, auth)
  const unit = unitIn(c, place.unitName)
  unit.items.push({ ...fields, topicId: place.topic._id, views: 0, createdBy: auth.user?.name, createdById: me(auth) ?? undefined, createdAt: new Date() })
  const id = String(unit.items[unit.items.length - 1]._id)
  await c.save()
  await audit({ action: 'CREATE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Shared “${fields.title}” (${place.topic.name}) in ${c.title}` }, req)
  return getContent(id, auth)
}

export async function updateContent(id, input, auth, req) {
  const { c, unit, item } = await locate(id, auth)
  if (!mayChangeItem(auth, item, 'edit')) throw forbidden('Only the teacher who shared it (or someone who manages all content) can change it.')
  const place = await placeOf(input, auth)
  const fields = { ...(await itemFields(input, auth)), topicId: place.topic._id }
  const sameCourse = String(c.classId) === String(input.classId) && String(c.subjectId) === String(input.subjectId)
  if (sameCourse && unit.title.trim().toLowerCase() === place.unitName.trim().toLowerCase()) {
    item.set(fields)
    if (fields.visibility === 'ALL') item.studentIds = undefined
    await c.save()
  } else {
    // moved to another unit or class / subject: same id, so its files stay with it
    const moved = { ...item.toObject(), ...fields, ...(fields.visibility === 'ALL' && { studentIds: undefined }) }
    unit.items.pull(item._id)
    const target = sameCourse ? c : await holderCourse({ yearId: place.yearId, classId: input.classId, subjectId: input.subjectId }, auth)
    unitIn(target, place.unitName).items.push(moved)
    await c.save()
    if (target !== c) await target.save()
  }
  await audit({ action: 'UPDATE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Changed shared content “${fields.title}”` }, req)
  return getContent(id, auth)
}

export async function deleteContent(id, auth, req) {
  const { c, unit, item } = await locate(id, auth)
  if (!mayChangeItem(auth, item, 'delete')) throw forbidden('Only the teacher who shared it (or someone who manages all content) can delete it.')
  unit.items.pull(item._id)
  await c.save()
  await Attachment.updateMany({ entityType: 'lms_item', entityId: String(id), 'deleted.at': null }, { $set: { deleted: { at: new Date(), by: auth.user?.name, reason: 'The content was deleted' } } })
  await audit({ action: 'DELETE', module: 'lms', entityType: 'course', entityId: String(c._id), entityName: c.title, summary: `Deleted shared content “${item.title}”` }, req)
  return { deleted: true }
}

/** Topic names and units for item rows. */
async function topicNames(topicIds) {
  const ids = [...new Set(topicIds.filter(Boolean).map(String))].filter(isOid)
  if (!ids.length) return new Map()
  const syls = await Syllabus.find({ 'units.topics._id': { $in: ids.map(oid) } }).select('units').lean()
  const m = new Map()
  for (const s of syls) for (const u of s.units) for (const t of u.topics) if (ids.includes(String(t._id))) m.set(String(t._id), { name: t.name, unit: u.name })
  return m
}

/** Rows ({ courseId, classId, subjectId, unit, item }) → what the screens show. */
async function present(rows, auth) {
  const itemIds = rows.map((r) => String(r.item._id))
  const [n, topics, files, tz] = await Promise.all([
    lmsNames({ classIds: rows.map((r) => String(r.classId)), subjectIds: rows.map((r) => String(r.subjectId)) }),
    topicNames(rows.map((r) => r.item.topicId)),
    Attachment.find({ entityType: 'lms_item', entityId: { $in: itemIds }, 'deleted.at': null }).select('entityId fileName mime size').lean(),
    timeZoneOf(),
  ])
  const now = new Date()
  return rows.map(({ courseId, classId, subjectId, unit, item: i }) => {
    const topic = i.topicId ? topics.get(String(i.topicId)) : null
    return {
      id: String(i._id), courseId: String(courseId), kind: i.kind, type: contentTypeOfKind(i.kind), title: i.title,
      descriptionHtml: i.descriptionHtml ? sanitizeHtml(i.descriptionHtml) : '', body: i.body ?? '', url: i.url ?? '', embed: i.kind === 'VIDEO' ? videoEmbed(i.url) : null,
      classId: String(classId), className: n.cls.get(String(classId))?.name ?? '', subjectId: String(subjectId), subject: n.subject.get(String(subjectId)) ?? '',
      topicId: i.topicId ? String(i.topicId) : null, topic: topic?.name ?? '', unit: topic?.unit ?? unit ?? '',
      status: contentStatus(i, now), publishAt: i.publishAt ?? null,
      publishDate: i.publishAt ? ymdIn(i.publishAt, tz) : null, publishTime: i.publishAt ? hhmmIn(i.publishAt, tz) : null,
      visibility: i.visibility ?? 'ALL', studentIds: (i.studentIds ?? []).map(String), views: i.views ?? 0,
      createdBy: i.createdBy ?? null, createdById: i.createdById ? String(i.createdById) : null, createdAt: i.createdAt ?? i._id.getTimestamp(),
      files: files.filter((f) => f.entityId === String(i._id)).map((f) => ({ id: String(f._id), name: f.fileName, mime: f.mime, size: f.size })),
      canEdit: mayChangeItem(auth, i, 'edit'), canDelete: mayChangeItem(auth, i, 'delete'),
      hub: !!i.hub, // a topic's Subject hub content (edited in the hub)
    }
  })
}

export async function getContent(id, auth) {
  const { c, unit, item } = await locate(id, auth)
  return (await present([{ courseId: c._id, classId: c.classId, subjectId: c.subjectId, unit: unit.title, item: item.toObject() }], auth))[0]
}

/** My content (`mine`) or the library: items of this year's courses the caller can see, newest first, paged. */
export async function listContent(q, pg, auth, { mine = false } = {}) {
  const year = await currentYear()
  if (!year) return { ...listResponse([], 0, pg), teachers: [] }
  const match = { ...(await visibleFilter(auth)), academicYearId: year._id, status: { $ne: 'ARCHIVED' } }
  if (isOid(q.classId)) match.classId = oid(q.classId)
  if (isOid(q.subjectId)) match.subjectId = oid(q.subjectId)
  const im = {}
  if (mine) im['units.items.createdById'] = me(auth)
  else if (isOid(q.teacherId)) im['units.items.createdById'] = oid(q.teacherId)
  if (isOid(q.topicId)) im['units.items.topicId'] = oid(q.topicId)
  if (q.type) im['units.items.kind'] = q.type === 'MATERIAL' ? { $in: ['NOTE', 'FILE'] } : CONTENT_TYPES[q.type].kind
  const now = new Date()
  if (q.status === 'SCHEDULED') Object.assign(im, { 'units.items.published': { $ne: false }, 'units.items.publishAt': { $gt: now } })
  if (q.status === 'PUBLISHED') Object.assign(im, { 'units.items.published': { $ne: false }, $or: [{ 'units.items.publishAt': null }, { 'units.items.publishAt': { $lte: now } }] })
  if (pg.search) im['units.items.title'] = { $regex: escapeRegex(pg.search), $options: 'i' }
  const flat = [{ $match: match }, { $unwind: '$units' }, { $unwind: '$units.items' }]
  const [[r], teachers] = await Promise.all([
    Course.aggregate([...flat, ...(Object.keys(im).length ? [{ $match: im }] : []), { $sort: { 'units.items._id': -1 } }, {
      $facet: {
        rows: [{ $skip: pg.skip }, { $limit: pg.pageSize }, { $project: { courseId: '$_id', classId: 1, subjectId: 1, unit: '$units.title', item: '$units.items' } }],
        total: [{ $count: 'n' }],
      },
    }]),
    mine ? [] : Course.aggregate([...flat, { $match: { 'units.items.createdById': { $ne: null } } }, { $group: { _id: '$units.items.createdById', name: { $last: '$units.items.createdBy' } } }, { $sort: { name: 1 } }, { $limit: 300 }]),
  ])
  const rows = await present(r?.rows ?? [], auth)
  return { ...listResponse(rows, r?.total?.[0]?.n ?? 0, pg), teachers: teachers.map((x) => ({ id: String(x._id), name: x.name ?? '' })) }
}

/** How many items students can open for a syllabus topic now (the topic drawer and lesson view show it). */
export async function topicContentCount(topicId, auth) {
  if (!isOid(topicId)) return { count: 0 }
  const now = new Date()
  const [r] = await Course.aggregate([
    { $match: { ...(await visibleFilter(auth)), status: 'PUBLISHED', 'units.items.topicId': oid(topicId) } },
    { $unwind: '$units' }, { $unwind: '$units.items' },
    { $match: { 'units.items.topicId': oid(topicId), 'units.items.published': { $ne: false }, $or: [{ 'units.items.publishAt': null }, { 'units.items.publishAt': { $lte: now } }] } },
    { $count: 'n' },
  ])
  return { count: r?.n ?? 0 }
}

// ───────────────────────────────────────────────────────── Subject hub (services/teachingHub.js)
//
// The hub keeps ONE item per syllabus topic (and per sub-topic) holding what students read: kind NOTE, `hub: true`,
// `topicId` (+ `subTopicId`), in the class + subject course of the year, in the unit named after the syllabus unit.
// A draft is `published: false`; publishing sets it visible (now or from `publishAt`) to all or chosen students.
// The caller (the hub service) has already checked the person works with this class and subject.

const sameId = (a, b) => String(a ?? '') === String(b ?? '')
const isHubItem = (i, topicId, subTopicId) => i.hub && sameId(i.topicId, topicId) && sameId(i.subTopicId, subTopicId)

/** The class + subject courses of the year that hold hub items for any of these topics. */
const hubCourses = ({ yearId, classId, subjectId, topicIds }) => Course.find({ academicYearId: yearId, classId, subjectId, 'units.items': { $elemMatch: { hub: true, topicId: { $in: topicIds.map(oid) } } } })

/** The hub items of these topics, each with its files: Map `${topicId}:${subTopicId ?? ''}` → item. */
export async function hubItems({ yearId, classId, subjectId, topicIds }) {
  const ids = topicIds.filter(isOid)
  if (!ids.length) return new Map()
  const [courses, tz] = await Promise.all([hubCourses({ yearId, classId, subjectId, topicIds: ids }).lean(), timeZoneOf()])
  const items = courses.flatMap((c) => c.units.flatMap((u) => u.items.filter((i) => i.hub && ids.includes(String(i.topicId))).map((i) => ({ ...i, courseId: c._id, unit: u.title }))))
  const files = items.length ? await Attachment.find({ entityType: 'lms_item', entityId: { $in: items.map((i) => String(i._id)) }, 'deleted.at': null }).select('entityId fileName mime size createdAt').sort({ createdAt: 1 }).lean() : []
  const now = new Date()
  return new Map(items.map((i) => [`${i.topicId}:${i.subTopicId ?? ''}`, {
    id: String(i._id), courseId: String(i.courseId), html: i.descriptionHtml ? sanitizeHtml(i.descriptionHtml) : '',
    published: i.published !== false, status: i.published === false ? 'DRAFT' : contentStatus(i, now), publishAt: i.publishAt ?? null,
    publishDate: i.publishAt ? ymdIn(i.publishAt, tz) : null, publishTime: i.publishAt ? hhmmIn(i.publishAt, tz) : null,
    visibility: i.visibility ?? 'ALL', studentIds: (i.studentIds ?? []).map(String), views: i.views ?? 0, updatedAt: i.updatedAt ?? null,
    files: files.filter((f) => f.entityId === String(i._id)).map((f) => ({ id: String(f._id), name: f.fileName, mime: f.mime, size: f.size })),
  }]))
}

/**
 * Create or update the hub item of a topic / sub-topic. A missing item is made (as a draft) only when there is
 * something to keep or `create` is set (files are about to be added). Returns the item id, or null.
 */
export async function saveHubItem({ yearId, classId, subjectId, unitName, topicId, subTopicId, title, html, create = false }, auth) {
  const clean = html === undefined ? undefined : sanitizeHtml(html ?? '')
  let c = (await hubCourses({ yearId, classId, subjectId, topicIds: [String(topicId)] })).find((x) => x.units.some((u) => u.items.some((i) => isHubItem(i, topicId, subTopicId))))
  const fields = { title: title.trim().slice(0, 200), updatedAt: new Date(), ...(clean !== undefined && { descriptionHtml: clean || undefined, body: htmlToText(clean).slice(0, 20000) || undefined }) }
  if (me(auth) && c && !c.teacherIds.some((x) => sameId(x, auth.userId))) c.teacherIds.push(me(auth)) // they may add files to it
  if (!c) {
    if (!create && !clean) return null
    c = await holderCourse({ yearId, classId, subjectId }, auth)
    if (me(auth) && !c.teacherIds.some((x) => sameId(x, auth.userId))) c.teacherIds.push(me(auth))
    const unit = unitIn(c, unitName)
    unit.items.push({ kind: 'NOTE', ...fields, hub: true, topicId, subTopicId: subTopicId || undefined, published: false, visibility: 'ALL', views: 0, createdBy: auth.user?.name, createdById: me(auth) ?? undefined, createdAt: new Date() })
    const id = String(unit.items[unit.items.length - 1]._id)
    await c.save()
    return id
  }
  const unit = c.units.find((u) => u.items.some((i) => isHubItem(i, topicId, subTopicId)))
  const item = unit.items.find((i) => isHubItem(i, topicId, subTopicId))
  item.set(fields)
  if (unit.title.trim().toLowerCase() !== unitName.trim().toLowerCase()) { // the syllabus unit was renamed or the topic moved: follow it
    const moved = item.toObject()
    unit.items.pull(item._id)
    unitIn(c, unitName).items.push(moved)
  }
  await c.save()
  return String(item._id)
}

/**
 * Publish (or take back to draft) the hub items of a unit's topics. `order` lists `${topicId}:${subTopicId ?? ''}` keys in
 * syllabus order: the items follow it in the course unit. Items with nothing in them stay drafts.
 */
export async function publishHubItems({ yearId, classId, subjectId, topicIds, order = [], publish, publishAt = null, visibility = 'ALL', studentIds }) {
  if (publish && visibility === 'STUDENTS') {
    const ids = [...new Set((studentIds ?? []).map(String))].filter(isOid)
    const sections = await Section.find({ classId }).select('_id').lean()
    const ok = ids.length ? await Student.countDocuments({ _id: { $in: ids }, sectionId: { $in: sections.map((s) => s._id) } }) : 0
    if (!ids.length) throw fieldsError({ studentIds: 'Pick the students' })
    if (ok !== ids.length) throw fieldsError({ studentIds: 'Students of this class only' })
    studentIds = ids
  }
  const courses = await hubCourses({ yearId, classId, subjectId, topicIds })
  if (!courses.length) return { published: 0, drafts: 0 }
  const want = new Set(topicIds.map(String))
  const rank = new Map(order.map((k, i) => [k, i]))
  const itemIds = courses.flatMap((c) => c.units.flatMap((u) => u.items.filter((i) => i.hub && want.has(String(i.topicId))).map((i) => String(i._id))))
  const withFiles = new Set((await Attachment.distinct('entityId', { entityType: 'lms_item', entityId: { $in: itemIds }, 'deleted.at': null })).map(String))
  let published = 0
  let drafts = 0
  for (const c of courses) {
    for (const u of c.units) {
      let touched = false
      for (const i of u.items) {
        if (!i.hub || !want.has(String(i.topicId))) continue
        touched = true
        const has = withFiles.has(String(i._id)) || hasRichContent(i.descriptionHtml)
        const on = !!publish && has
        i.published = on
        if (on) {
          i.publishAt = publishAt
          i.visibility = visibility === 'STUDENTS' ? 'STUDENTS' : 'ALL'
          i.studentIds = visibility === 'STUDENTS' ? studentIds : undefined
          published += 1
        } else drafts += 1
      }
      if (touched && rank.size) { // hub items in syllabus order; the unit's other items keep theirs, after them
        const key = (i) => (i.hub ? rank.get(`${i.topicId}:${i.subTopicId ?? ''}`) ?? 1e6 : 2e6)
        const sorted = [...u.items].map((i, n) => ({ i, n })).sort((a, b) => (key(a.i) - key(b.i)) || (a.n - b.n)).map((x) => x.i.toObject())
        u.items = sorted
      }
    }
    await c.save()
  }
  return { published, drafts }
}

/** Remove the hub items of topics (or only of these sub-topics); their files are hidden with them. */
export async function removeHubItems({ yearId, classId, subjectId, topicIds, subTopicIds }, auth) {
  const want = new Set(topicIds.map(String))
  const subs = subTopicIds ? new Set(subTopicIds.map(String)) : null
  const gone = []
  for (const c of await hubCourses({ yearId, classId, subjectId, topicIds })) {
    for (const u of c.units) {
      const drop = u.items.filter((i) => i.hub && want.has(String(i.topicId)) && (!subs || (i.subTopicId && subs.has(String(i.subTopicId)))))
      for (const i of drop) { gone.push(String(i._id)); u.items.pull(i._id) }
    }
    await c.save()
  }
  if (gone.length) await Attachment.updateMany({ entityType: 'lms_item', entityId: { $in: gone }, 'deleted.at': null }, { $set: { deleted: { at: new Date(), by: auth.user?.name, reason: 'The topic was removed from the syllabus' } } })
  return gone.length
}

/** Copy another item's files onto a hub item (Add from library): new file records over the same stored bytes. */
export async function copyItemFiles(fromItemId, toItemId, auth) {
  await locate(fromItemId, auth) // the caller can see the source
  const files = await Attachment.find({ entityType: 'lms_item', entityId: String(fromItemId), 'deleted.at': null }).lean()
  if (!files.length) return 0
  await Attachment.insertMany(files.map(({ _id, createdAt, updatedAt, deleted, ...f }) => ({ ...f, entityId: String(toItemId), uploadedById: me(auth) ?? undefined, uploadedBy: auth.user?.name })))
  return files.length
}
