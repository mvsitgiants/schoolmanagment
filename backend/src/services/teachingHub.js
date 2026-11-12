import mongoose from 'mongoose'
import { QUESTION_KINDS, QUESTION_USES, monthsInRange } from '@schoolgiant/shared'
import { Section } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { Course } from '../models/lms.js'
import { LessonPlan, SectionTopicPlan, Syllabus, SyllabusDone } from '../models/homework.js'
import { Student, studentName } from '../models/students.js'
import { moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid, oid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { zonedDate, timeZoneOf } from '../platform/time.js'
import { homeworkLookup, requireYear, wide } from './homework.js'
import { copyItemFiles, hubItems, publishHubItems, removeHubItems, saveHubItem } from './lmsContent.js'

// Subject hub (homework.hub): one place where a teacher builds a class + subject, unit by unit — the unit's topics
// and sub-topics, what students read for each (an LMS item per topic / sub-topic, see lmsContent.js), the teacher's
// own notes (how to teach, key points, book, periods) and the questions. Teacher fields stay on the syllabus topic;
// students never see them. A teacher works on the classes and subjects they teach; wide-scope staff on all.

const fieldsError = (fields) => badRequest('Some details need fixing.', { fields })
const idStr = (v) => (v ? String(v) : null)
const keyOf = (topicId, subTopicId) => `${topicId}:${subTopicId ?? ''}`

/** The class and subject, if the caller works with them; with the year and whether they may change it. */
async function placeFor({ classId, subjectId }, auth) {
  const year = await requireYear()
  if (!isOid(classId) || !isOid(subjectId)) throw notFound('Syllabus')
  const look = await homeworkLookup(auth)
  const cls = look.classes.find((c) => c.id === String(classId))
  const subject = cls?.subjects.find((s) => s.id === String(subjectId))
  if (!subject) throw notFound('Syllabus')
  const teaches = look.sections.some((s) => s.classId === cls.id && s.subjects.some((x) => x.id === subject.id))
  return { year, look, cls, subject, canEdit: wide(auth) || teaches, lmsOn: moduleEnabled(auth, 'lms') }
}

const mustEdit = (p) => { if (!p.canEdit) throw forbidden('You can’t change this subject’s syllabus.') }
const label = (p) => `${p.cls.name} · ${p.subject.name}`
const findSyl = (p) => Syllabus.findOne({ academicYearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id })

/** The stored syllabus (a document to change), made empty if there is none yet. */
async function sylDoc(p, auth) {
  return (await findSyl(p)) ?? new Syllabus({ academicYearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, units: [], updatedBy: auth.user?.name })
}

function topicIn(doc, topicId) {
  for (const u of doc?.units ?? []) {
    const t = u.topics.id(topicId)
    if (t) return { unit: u, topic: t }
  }
  throw notFound('Topic')
}

/** Why a topic can't be removed: sections where it was taught or started, lesson plans that name it. Null = free. */
async function inUse(subjectId, topicIds) {
  const [taught, started, plans] = await Promise.all([
    SyllabusDone.countDocuments({ subjectId, topicId: { $in: topicIds } }),
    SectionTopicPlan.countDocuments({ subjectId, topicId: { $in: topicIds }, status: { $ne: 'NOT_STARTED' } }),
    LessonPlan.countDocuments({ subjectId, topicIds: { $in: topicIds } }),
  ])
  if (taught || started) return `It has already been taught in ${Math.max(taught, started)} section(s). Its record would be lost, so it can’t be removed — rename it instead.`
  if (plans) return `${plans} lesson plan(s) use it. Change those lesson plans first, or rename the topic instead.`
  return null
}

const months = (year) => monthsInRange(year.startDate, year.endDate)

// ───────────────────────────────────────────────────────── read

/** The hub of a class + subject: its units, and the chosen unit's topics with everything on them. */
export async function getHub({ classId, subjectId, unitId, topicId }, auth) {
  const p = await placeFor({ classId, subjectId }, auth)
  const syl = await findSyl(p).lean()
  const units = syl?.units ?? []
  // the named unit; else the one holding `topicId` (a link to a topic); else the first
  const unit = units.find((u) => String(u._id) === String(unitId)) ?? (topicId ? units.find((u) => u.topics.some((t) => String(t._id) === String(topicId))) : null) ?? units[0] ?? null
  const topics = unit?.topics ?? []
  const topicIds = topics.map((t) => String(t._id))
  const [items, taught, oldFiles] = await Promise.all([
    p.lmsOn ? hubItems({ yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, topicIds }) : new Map(),
    topicIds.length ? SyllabusDone.aggregate([{ $match: { subjectId: oid(p.subject.id), topicId: { $in: topicIds.map(oid) } } }, { $group: { _id: '$topicId', n: { $sum: 1 } } }]) : [],
    // files added to a topic from the syllabus page's topic drawer (for the teacher; they can be copied to the student content)
    topicIds.length ? Attachment.find({ entityType: 'syllabus_topic', entityId: { $in: topicIds }, 'deleted.at': null }).select('entityId fileName mime size').sort({ createdAt: 1 }).lean() : [],
  ])
  const taughtIn = new Map(taught.map((x) => [String(x._id), x.n]))
  const all = [...items.values()]
  const states = new Set(all.map((i) => i.status))
  const first = all.find((i) => i.published) ?? all[0]
  return {
    year: { id: String(p.year._id), name: p.year.name }, months: months(p.year),
    classId: p.cls.id, className: p.cls.name, subjectId: p.subject.id, subject: p.subject.name,
    canEdit: p.canEdit, lmsOn: p.lmsOn,
    units: units.map((u) => ({ id: String(u._id), name: u.name, fromMonth: u.fromMonth ?? null, toMonth: u.toMonth ?? null, topics: u.topics.length })),
    unit: unit && {
      id: String(unit._id), name: unit.name, fromMonth: unit.fromMonth ?? null, toMonth: unit.toMonth ?? null,
      // DRAFT · PUBLISHED · SCHEDULED · MIXED (some of each) · EMPTY (nothing written yet)
      status: !all.length ? 'EMPTY' : states.size === 1 ? [...states][0] : 'MIXED',
      publishAt: first?.publishAt ?? null, publishDate: first?.publishDate ?? null, publishTime: first?.publishTime ?? null,
      visibility: first?.visibility ?? 'ALL', studentIds: first?.studentIds ?? [],
    },
    topics: topics.map((t) => ({
      id: String(t._id), name: t.name, periods: t.periods ?? null, month: t.month ?? null,
      book: { name: t.book?.name ?? '', chapter: t.book?.chapter ?? '', pages: t.book?.pages ?? '' },
      howTo: t.howTo ?? '', keyPoints: t.keyPoints ?? [], homeworkHint: t.homeworkHint ?? '',
      questions: (t.questions ?? []).map((q) => ({ id: String(q._id), question: q.question, answer: q.answer ?? '', kind: q.kind ?? 'SHORT', options: q.options ?? [], use: q.use ?? 'CLASS' })),
      taughtIn: taughtIn.get(String(t._id)) ?? 0,
      teacherFiles: oldFiles.filter((f) => f.entityId === String(t._id)).map((f) => ({ id: String(f._id), name: f.fileName, mime: f.mime, size: f.size })),
      content: items.get(keyOf(t._id)) ?? null,
      subTopics: (t.subTopics ?? []).map((s) => ({ id: String(s._id), name: s.name, content: items.get(keyOf(t._id, s._id)) ?? null })),
      contentBy: t.contentBy ?? null, contentAt: t.contentAt ?? null,
    })),
  }
}

/**
 * The outline on the left of the Subject hub: every class and subject this person works on, each one's units and topics,
 * and on each topic what is there — student content (NONE · DRAFT · SCHEDULED · PUBLISHED), sub-topics, the teacher's
 * notes, questions, and in how many sections it was taught. A handful of queries for the whole year, whatever its size.
 */
export async function hubOutline(auth) {
  const year = await requireYear()
  const look = await homeworkLookup(auth)
  const classIds = look.classes.map((c) => oid(c.id))
  const lmsOn = moduleEnabled(auth, 'lms')
  const [syllabi, items, taught, partly] = await Promise.all([
    Syllabus.find({ academicYearId: year._id, classId: { $in: classIds } })
      .select('classId subjectId units._id units.name units.fromMonth units.toMonth units.topics._id units.topics.name units.topics.howTo units.topics.keyPoints units.topics.questions._id units.topics.subTopics._id').lean(),
    // the student content of each topic (its hub item; sub-topics' items don't change the topic's state)
    lmsOn ? Course.aggregate([
      { $match: { academicYearId: year._id, classId: { $in: classIds }, 'units.items.hub': true } },
      { $unwind: '$units' }, { $unwind: '$units.items' },
      { $match: { 'units.items.hub': true, 'units.items.subTopicId': null } },
      { $project: { _id: 0, id: '$units.items._id', topicId: '$units.items.topicId', published: '$units.items.published', publishAt: '$units.items.publishAt', size: { $strLenCP: { $ifNull: ['$units.items.descriptionHtml', ''] } } } },
    ]) : [],
    SyllabusDone.aggregate([{ $group: { _id: '$topicId', n: { $sum: 1 } } }]),
    // classes where it is partly taught (started, not finished)
    SectionTopicPlan.aggregate([{ $match: { status: 'PARTLY' } }, { $group: { _id: '$topicId', n: { $sum: 1 } } }]),
  ])
  const withFiles = items.length ? new Set((await Attachment.distinct('entityId', { entityType: 'lms_item', entityId: { $in: items.map((i) => String(i.id)) }, 'deleted.at': null })).map(String)) : new Set()
  const now = new Date()
  const contentOf = new Map(items.map((i) => {
    const has = i.size > 0 || withFiles.has(String(i.id))
    const state = !has ? 'NONE' : i.published === false ? 'DRAFT' : i.publishAt && i.publishAt > now ? 'SCHEDULED' : 'PUBLISHED'
    return [String(i.topicId), state]
  }))
  const taughtIn = new Map(taught.map((x) => [String(x._id), x.n]))
  const partlyIn = new Map(partly.map((x) => [String(x._id), x.n]))
  const sylOf = new Map(syllabi.map((x) => [`${x.classId}:${x.subjectId}`, x]))
  return {
    year: { id: String(year._id), name: year.name }, lmsOn,
    classes: look.classes.map((c) => ({
      id: c.id, name: c.name,
      subjects: c.subjects.map((sb) => ({
        id: sb.id, name: sb.name,
        units: (sylOf.get(`${c.id}:${sb.id}`)?.units ?? []).map((u) => ({
          id: String(u._id), name: u.name, fromMonth: u.fromMonth ?? null, toMonth: u.toMonth ?? null,
          topics: (u.topics ?? []).map((t) => ({
            id: String(t._id), name: t.name, content: contentOf.get(String(t._id)) ?? 'NONE',
            subTopics: t.subTopics?.length ?? 0, questions: t.questions?.length ?? 0,
            notes: !!(t.howTo || t.keyPoints?.length), taughtIn: taughtIn.get(String(t._id)) ?? 0, partlyIn: partlyIn.get(String(t._id)) ?? 0,
          })),
        })),
      })),
    })),
  }
}

/** The class's students this year (the "chosen students" list when publishing). */
export async function hubStudents({ classId, subjectId }, auth) {
  const p = await placeFor({ classId, subjectId }, auth)
  const sections = p.look.sections.filter((s) => s.classId === p.cls.id)
  const short = new Map(sections.map((s) => [s.id, s.short]))
  const all = await Section.find({ classId: p.cls.id, academicYearId: p.year._id }).select('_id').lean()
  const ids = wide(auth) ? all.map((s) => s._id) : sections.map((s) => oid(s.id))
  const rows = await Student.find({ sectionId: { $in: ids }, status: 'ACTIVE' }).select('firstName middleName lastName admissionNo rollNo sectionId').sort({ rollNo: 1, firstName: 1 }).limit(2000).lean()
  return rows.map((s) => ({ id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, section: short.get(String(s.sectionId)) ?? '' }))
}

// ───────────────────────────────────────────────────────── units

function unitFields(input, year, errors) {
  const ok = new Set(months(year))
  if (!input.name?.trim()) errors.name = 'Name the unit'
  if (input.fromMonth && !ok.has(input.fromMonth)) errors.fromMonth = `A month of ${year.name}`
  if (input.toMonth && !ok.has(input.toMonth)) errors.toMonth = `A month of ${year.name}`
  if (input.fromMonth && input.toMonth && input.toMonth < input.fromMonth) errors.toMonth = 'On or after the start month'
  return { name: input.name?.trim(), fromMonth: input.fromMonth || input.toMonth || undefined, toMonth: input.toMonth || input.fromMonth || undefined }
}

/** Add a unit (with its months), or rename it / change its months when `unitId` is given. */
export async function saveUnit(unitId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  const errors = {}
  const fields = unitFields(input, p.year, errors)
  if (Object.keys(errors).length) throw fieldsError(errors)
  const doc = await sylDoc(p, auth)
  let unit
  let was
  if (unitId) {
    unit = doc.units.id(unitId)
    if (!unit) throw notFound('Unit')
    was = unit.name
    unit.set(fields)
  } else {
    doc.units.push({ ...fields, topics: [] })
    unit = doc.units[doc.units.length - 1]
  }
  doc.updatedBy = auth.user?.name
  await doc.save()
  // a renamed unit: its content follows on the course page and the students' Learning page
  if (unitId && was !== fields.name && p.lmsOn) {
    for (const t of unit.topics) {
      await saveHubItem({ yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, unitName: fields.name, topicId: t._id, title: t.name }, auth)
      for (const s of t.subTopics ?? []) await saveHubItem({ yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, unitName: fields.name, topicId: t._id, subTopicId: s._id, title: `${t.name} · ${s.name}` }, auth)
    }
  }
  await audit({ action: unitId ? 'UPDATE' : 'CREATE', module: 'homework', entityType: 'syllabus', entityId: `${p.cls.id}:${p.subject.id}`, entityName: label(p), summary: unitId ? `Changed the unit “${fields.name}”${was !== fields.name ? ` (was “${was}”)` : ''} in ${label(p)}` : `Added the unit “${fields.name}” to ${label(p)}` }, req)
  return { id: String(unit._id) }
}

/** Remove topics: refused while any is in use; otherwise their section records and hub content go with them. */
async function dropTopics(p, doc, topicIds, auth) {
  const why = await inUse(p.subject.id, topicIds)
  if (why) throw conflict(why)
  await withTransaction(async () => {
    await doc.save()
    await SectionTopicPlan.deleteMany({ subjectId: p.subject.id, topicId: { $in: topicIds } })
  })
  if (p.lmsOn) await removeHubItems({ yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, topicIds }, auth)
}

export async function deleteUnit(unitId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  const doc = await findSyl(p)
  const unit = doc?.units.id(unitId)
  if (!unit) throw notFound('Unit')
  const topicIds = unit.topics.map((t) => t._id)
  const name = unit.name
  doc.units.pull(unit._id)
  doc.updatedBy = auth.user?.name
  if (topicIds.length) await dropTopics(p, doc, topicIds, auth)
  else await doc.save()
  await audit({ action: 'DELETE', module: 'homework', entityType: 'syllabus', entityId: `${p.cls.id}:${p.subject.id}`, entityName: label(p), summary: `Removed the unit “${name}” (${topicIds.length} topic(s)) from ${label(p)}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── topics

export async function addTopic(input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  if (!input.name?.trim()) throw fieldsError({ name: 'Name the topic' })
  const doc = await findSyl(p)
  const unit = doc?.units.id(input.unitId)
  if (!unit) throw notFound('Unit')
  unit.topics.push({ name: input.name.trim() })
  const topic = unit.topics[unit.topics.length - 1]
  doc.updatedBy = auth.user?.name
  await doc.save()
  await audit({ action: 'CREATE', module: 'homework', entityType: 'syllabus_topic', entityId: String(topic._id), entityName: `${label(p)} · ${topic.name}`, summary: `Added the topic “${topic.name}” to ${unit.name} (${label(p)})` }, req)
  return { id: String(topic._id) }
}

/** Put a unit's topics in this order (ids of the unit's topics; any left out keep their place at the end). */
export async function orderTopics(unitId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  const doc = await findSyl(p)
  const unit = doc?.units.id(unitId)
  if (!unit) throw notFound('Unit')
  const rank = new Map(input.topicIds.map((id, i) => [String(id), i]))
  const sorted = unit.topics.map((t, n) => ({ t, n })).sort((a, b) => ((rank.get(String(a.t._id)) ?? 1e6 + a.n) - (rank.get(String(b.t._id)) ?? 1e6 + b.n))).map((x) => x.t.toObject())
  unit.topics = sorted
  doc.updatedBy = auth.user?.name
  await doc.save()
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus', entityId: `${p.cls.id}:${p.subject.id}`, entityName: label(p), summary: `Reordered the topics of “${unit.name}” (${label(p)})` }, req)
  return { ordered: true }
}

export async function deleteTopic(topicId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  const doc = await findSyl(p)
  const { unit, topic } = topicIn(doc, topicId)
  const name = topic.name
  unit.topics.pull(topic._id)
  doc.updatedBy = auth.user?.name
  await dropTopics(p, doc, [topic._id], auth)
  await audit({ action: 'DELETE', module: 'homework', entityType: 'syllabus_topic', entityId: String(topicId), entityName: `${label(p)} · ${name}`, summary: `Removed the topic “${name}” from ${unit.name} (${label(p)})` }, req)
  return { deleted: true }
}

const cleanQuestions = (list = [], keep) => list.filter((q) => q.question?.trim()).map((q) => ({
  ...(q.id && keep.has(String(q.id)) && { _id: q.id }), question: q.question.trim(), answer: q.answer || undefined,
  kind: QUESTION_KINDS.includes(q.kind) ? q.kind : 'SHORT', options: q.kind === 'MCQ' ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined,
  use: QUESTION_USES.includes(q.use) ? q.use : 'CLASS',
}))

/**
 * Save everything on a topic in one call: its name, the teacher's notes, questions, sub-topics, and the student
 * content of the topic and of each sub-topic (kept as LMS items; a new one starts as a draft). Fields left out
 * (undefined) are not changed, so a quick rename sends only `name`.
 */
export async function saveHubTopic(topicId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  const doc = await findSyl(p)
  const { unit, topic } = topicIn(doc, topicId)
  if (input.name !== undefined) {
    if (!input.name.trim()) throw fieldsError({ name: 'Name the topic' })
    topic.name = input.name.trim()
  }
  if (input.periods !== undefined) topic.periods = input.periods || undefined
  if (input.book !== undefined) topic.book = { name: input.book?.name || undefined, chapter: input.book?.chapter || undefined, pages: input.book?.pages || undefined }
  if (input.howTo !== undefined) topic.howTo = input.howTo || undefined
  if (input.keyPoints !== undefined) topic.keyPoints = input.keyPoints.map((k) => k.trim()).filter(Boolean)
  if (input.homeworkHint !== undefined) topic.homeworkHint = input.homeworkHint || undefined
  if (input.questions !== undefined) topic.questions = cleanQuestions(input.questions, new Set((topic.questions ?? []).map((q) => String(q._id))))
  let removedSubs = []
  if (input.subTopics !== undefined) {
    const known = new Set((topic.subTopics ?? []).map((s) => String(s._id)))
    const next = input.subTopics.filter((s) => s.name?.trim()).map((s) => ({ _id: s.id && known.has(String(s.id)) ? s.id : new mongoose.Types.ObjectId(), name: s.name.trim(), html: s.contentHtml }))
    const kept = new Set(next.map((s) => String(s._id)))
    removedSubs = [...known].filter((id) => !kept.has(id))
    topic.subTopics = next.length ? next.map(({ _id, name }) => ({ _id, name })) : undefined
    input.subTopics = next
  }
  topic.contentBy = auth.user?.name
  topic.contentAt = new Date()
  doc.updatedBy = auth.user?.name
  await doc.save()
  if (p.lmsOn) {
    const base = { yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, unitName: unit.name, topicId: topic._id }
    await saveHubItem({ ...base, title: topic.name, html: input.contentHtml }, auth)
    for (const s of input.subTopics ?? topic.subTopics ?? []) await saveHubItem({ ...base, subTopicId: s._id, title: `${topic.name} · ${s.name}`, html: s.html }, auth)
    if (removedSubs.length) await removeHubItems({ ...base, topicIds: [topic._id], subTopicIds: removedSubs }, auth)
  }
  const said = [input.contentHtml !== undefined && 'student content', input.questions !== undefined && `${topic.questions?.length ?? 0} question(s)`, input.subTopics !== undefined && `${topic.subTopics?.length ?? 0} sub-topic(s)`, input.howTo !== undefined && 'teacher’s notes'].filter(Boolean)
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus_topic', entityId: String(topic._id), entityName: `${label(p)} · ${topic.name}`, summary: `Saved “${topic.name}” in the subject hub (${label(p)})${said.length ? `: ${said.join(', ')}` : ''}` }, req)
  return { id: String(topic._id) }
}

/** The LMS item of a topic / sub-topic, made (as a draft) if missing — files and pictures hang off it. */
export async function ensureHubItem(topicId, input, auth) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  if (!p.lmsOn) throw conflict('Turn on Learning (LMS) to share content with students.')
  const doc = await findSyl(p)
  const { unit, topic } = topicIn(doc, topicId)
  const sub = input.subTopicId ? (topic.subTopics ?? []).find((s) => String(s._id) === String(input.subTopicId)) : null
  if (input.subTopicId && !sub) throw notFound('Sub-topic')
  const id = await saveHubItem({ yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, unitName: unit.name, topicId: topic._id, subTopicId: sub?._id, title: sub ? `${topic.name} · ${sub.name}` : topic.name, create: true }, auth)
  if (input.copyFrom) await copyItemFiles(input.copyFrom, id, auth)
  return { id }
}

/**
 * Copy the topic's own files (added from the syllabus page's topic drawer, record type syllabus_topic) onto its student
 * content (the hub item, made as a draft if missing): new file records over the same stored bytes. `fileIds` picks
 * some; left out = all. Files already copied (same stored file) are skipped.
 */
export async function copyTopicFiles(topicId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  if (!p.lmsOn) throw conflict('Turn on Learning (LMS) to share content with students.')
  const doc = await findSyl(p)
  const { unit, topic } = topicIn(doc, topicId)
  const files = await Attachment.find({ entityType: 'syllabus_topic', entityId: String(topic._id), 'deleted.at': null, ...(input.fileIds?.length && { _id: { $in: input.fileIds } }) }).lean()
  if (!files.length) throw notFound('File')
  const itemId = await saveHubItem({ yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, unitName: unit.name, topicId: topic._id, title: topic.name, create: true }, auth)
  const have = new Set((await Attachment.find({ entityType: 'lms_item', entityId: itemId, 'deleted.at': null }).select('storageKey').lean()).map((f) => f.storageKey))
  const fresh = files.filter((f) => !have.has(f.storageKey))
  if (fresh.length) {
    await Attachment.insertMany(fresh.map(({ _id, createdAt, updatedAt, deleted, ...f }) => ({ ...f, entityType: 'lms_item', entityId: itemId, uploadedById: isOid(auth.userId) ? auth.userId : undefined, uploadedBy: auth.user?.name })))
    await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus_topic', entityId: String(topic._id), entityName: `${label(p)} · ${topic.name}`, summary: `Copied ${fresh.length} file(s) of “${topic.name}” to its student content (${label(p)})` }, req)
  }
  return { id: itemId, copied: fresh.length }
}

// ───────────────────────────────────────────────────────── publish

/** Publish every topic's content in the unit (now or later; to all or chosen students), or take it back to draft. */
export async function publishUnit(unitId, input, auth, req) {
  const p = await placeFor(input, auth)
  mustEdit(p)
  if (!p.lmsOn) throw conflict('Turn on Learning (LMS) to share content with students.')
  const doc = await findSyl(p)
  const unit = doc?.units.id(unitId)
  if (!unit) throw notFound('Unit')
  let publishAt = null
  if (input.publish && input.when === 'LATER') {
    if (!input.publishDate || !input.publishTime) throw fieldsError({ publishDate: 'Pick the date and time' })
    publishAt = zonedDate(input.publishDate, input.publishTime, await timeZoneOf())
    if (publishAt <= new Date()) throw fieldsError({ publishDate: 'Pick a time later than now' })
  }
  const order = unit.topics.flatMap((t) => [keyOf(t._id), ...(t.subTopics ?? []).map((s) => keyOf(t._id, s._id))])
  const r = await publishHubItems({
    yearId: p.year._id, classId: p.cls.id, subjectId: p.subject.id, topicIds: unit.topics.map((t) => String(t._id)), order,
    publish: !!input.publish, publishAt, visibility: input.visibility, studentIds: input.studentIds,
  })
  if (input.publish && !r.published) throw conflict('Nothing to publish yet: add content to at least one topic first.')
  const whom = input.visibility === 'STUDENTS' ? `${input.studentIds?.length ?? 0} chosen student(s)` : 'all students'
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus', entityId: `${p.cls.id}:${p.subject.id}`, entityName: label(p), summary: input.publish ? `Published “${unit.name}” (${label(p)}): ${r.published} topic content item(s) for ${whom}${publishAt ? `, from ${input.publishDate} ${input.publishTime}` : ''}` : `Took “${unit.name}” (${label(p)}) back to draft` }, req)
  return { ...r, unitId: idStr(unit._id) }
}
