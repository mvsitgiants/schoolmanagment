import { courseProgress, itemVisibleTo, joinWindow, jitsiUrl, sanitizeHtml, videoEmbed } from '@schoolgiant/shared'
import { Section, Subject } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { Course, CourseProgress, LiveClass } from '../models/lms.js'
import { isOid } from '../platform/db.js'
import { conflict, notFound } from '../platform/errors.js'
import { readStream } from '../platform/storage.js'
import { institutionNow } from '../platform/time.js'
import { currentYear } from './academics.js'
import { need, studentFor } from './portal.js'

// Learning in the family app: the published courses of the student's class, what they have ticked off, the live
// classes coming up (join opens a few minutes before the start, and the join is recorded) and recent recordings.

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

async function placeOf(s) {
  const sec = s.sectionId ? await Section.findById(s.sectionId).select('classId').lean() : null
  return sec ? { sectionId: s.sectionId, classId: sec.classId } : null
}
const reachFilter = (p) => ({ $or: [{ sectionIds: p.sectionId }, { sectionIds: { $size: 0 }, classId: p.classId }] })
/** The course's units with only what this student sees now (published, its time come, meant for all or for them). */
const unitsFor = (c, studentId, now = new Date()) => c.units.map((u) => ({ ...u, items: u.items.filter((i) => itemVisibleTo(i, studentId, now)) }))
const findItem = (c, studentId, itemId) => c.units.flatMap((u) => u.items).find((i) => String(i._id) === String(itemId) && itemVisibleTo(i, studentId))

export async function learningFor(f, id) {
  need(f, 'LEARNING')
  const s = studentFor(f, id)
  const p = await placeOf(s)
  if (!p) return { courses: [], live: [], recordings: [] }
  const year = await currentYear()
  const t = await institutionNow()
  const [courses, live, recordings] = await Promise.all([
    Course.find({ status: 'PUBLISHED', ...(year && { academicYearId: year._id }), ...reachFilter(p) }).sort({ title: 1 }).lean(),
    LiveClass.find({ ...reachFilter(p), status: { $in: ['SCHEDULED', 'LIVE'] }, date: { $gte: t.date, $lte: addDays(t.date, 7) } }).sort({ date: 1, start: 1 }).limit(30).lean(),
    LiveClass.find({ ...reachFilter(p), status: 'ENDED', recordingUrl: { $ne: null }, date: { $gte: addDays(t.date, -30) } }).sort({ date: -1 }).limit(10).lean(),
  ])
  const [progress, subjects] = await Promise.all([
    CourseProgress.find({ studentId: s._id, courseId: { $in: courses.map((c) => c._id) } }).lean(),
    Subject.find({ _id: { $in: [...courses, ...live, ...recordings].map((x) => x.subjectId).filter(Boolean) } }).select('name').lean(),
  ])
  const subject = new Map(subjects.map((x) => [String(x._id), x.name]))
  const done = new Map(progress.map((x) => [String(x.courseId), x.done]))
  return {
    courses: courses.map((c) => ({ id: String(c._id), title: c.title, subject: subject.get(String(c.subjectId)) ?? '', ...courseProgress(unitsFor(c, s._id), done.get(String(c._id)) ?? []) })),
    live: live.map((l) => ({ id: String(l._id), title: l.title, subject: subject.get(String(l.subjectId)) ?? '', date: l.date, start: l.start, durationMin: l.durationMin, host: l.hostName ?? null, status: l.status, canJoin: l.status === 'LIVE' || joinWindow(l, t).open })),
    recordings: recordings.map((l) => ({ id: String(l._id), title: l.title, subject: subject.get(String(l.subjectId)) ?? '', date: l.date, url: l.recordingUrl, embed: videoEmbed(l.recordingUrl) })),
  }
}

async function courseOf(f, id, courseId) {
  need(f, 'LEARNING')
  const s = studentFor(f, id)
  const p = await placeOf(s)
  const c = p && isOid(courseId) ? await Course.findOne({ _id: courseId, status: 'PUBLISHED', ...reachFilter(p) }).lean() : null
  if (!c) throw notFound('Course')
  return { s, c }
}

export async function courseView(f, id, courseId) {
  const { s, c } = await courseOf(f, id, courseId)
  const units = unitsFor(c, s._id)
  const items = units.flatMap((u) => u.items)
  const [progress, files, subject] = await Promise.all([
    CourseProgress.findOne({ courseId: c._id, studentId: s._id }).lean(),
    Attachment.find({ entityType: 'lms_item', entityId: { $in: items.map((i) => String(i._id)) }, 'deleted.at': null }).select('entityId fileName mime size').lean(),
    Subject.findById(c.subjectId).select('name').lean(),
  ])
  const done = new Set((progress?.done ?? []).map(String))
  return {
    id: String(c._id), title: c.title, description: c.description ?? '', subject: subject?.name ?? '', ...courseProgress(units, progress?.done ?? []),
    units: units.map((u) => ({
      id: String(u._id), title: u.title,
      items: u.items.map((i) => ({
        id: String(i._id), kind: i.kind, title: i.title, body: i.body ?? '', html: i.descriptionHtml ? sanitizeHtml(i.descriptionHtml) : '', url: i.url ?? '', embed: i.kind === 'VIDEO' ? videoEmbed(i.url) : null, minutes: i.minutes ?? null, done: done.has(String(i._id)),
        files: files.filter((x) => x.entityId === String(i._id)).map((x) => ({ id: String(x._id), name: x.fileName, mime: x.mime, size: x.size })),
      })),
    })).filter((u) => u.items.length),
  }
}

/** Tick an item off (or back on). */
export async function markItem(f, id, courseId, itemId, isDone) {
  const { s, c } = await courseOf(f, id, courseId)
  const item = findItem(c, s._id, itemId)
  if (!item) throw notFound('Item')
  await CourseProgress.updateOne({ courseId: c._id, studentId: s._id }, { [isDone ? '$addToSet' : '$pull']: { done: item._id }, $set: { lastAt: new Date() } }, { upsert: true })
  return courseView(f, id, courseId)
}

export async function itemFile(f, id, courseId, itemId, fileId) {
  const { s, c } = await courseOf(f, id, courseId)
  const item = findItem(c, s._id, itemId)
  if (!item || !isOid(fileId)) throw notFound('File')
  const file = await Attachment.findOne({ _id: fileId, entityType: 'lms_item', entityId: String(item._id), 'deleted.at': null }).lean()
  if (!file) throw notFound('File')
  return { file, stream: readStream(file.storageKey) }
}

/** The student opened an item: counted once per student in the item's views. */
export async function viewItem(f, id, courseId, itemId) {
  const { s, c } = await courseOf(f, id, courseId)
  const item = findItem(c, s._id, itemId)
  if (!item) throw notFound('Item')
  await CourseProgress.updateOne({ courseId: c._id, studentId: s._id }, { $setOnInsert: { done: [], viewed: [] } }, { upsert: true })
  const r = await CourseProgress.updateOne({ courseId: c._id, studentId: s._id, viewed: { $ne: item._id } }, { $push: { viewed: item._id }, $set: { lastAt: new Date() } })
  if (r.modifiedCount) await Course.updateOne({ _id: c._id }, { $inc: { 'units.$[].items.$[i].views': 1 } }, { arrayFilters: [{ 'i._id': item._id }] })
  return { viewed: true }
}

/** Join a live class: open from a few minutes before the start until the end, or while the teacher has it live. */
export async function joinLive(f, id, liveId) {
  need(f, 'LEARNING')
  const s = studentFor(f, id)
  const p = await placeOf(s)
  const l = p && isOid(liveId) ? await LiveClass.findOne({ _id: liveId, ...reachFilter(p) }).lean() : null
  if (!l) throw notFound('Live class')
  if (l.status === 'CANCELLED') throw conflict('This class was cancelled.')
  if (l.status === 'ENDED') throw conflict('This class is over.')
  const w = joinWindow(l, await institutionNow())
  if (l.status !== 'LIVE' && !w.open) throw conflict(w.reason === 'LATER' ? 'The class hasn’t started yet. Join a few minutes before it begins.' : 'This class is over.', { code: w.reason })
  await LiveClass.updateOne({ _id: l._id, 'joins.studentId': { $ne: s._id } }, { $push: { joins: { studentId: s._id, at: new Date() } } })
  return { url: l.provider === 'JITSI' ? jitsiUrl(l.room) : l.joinUrl, provider: l.provider }
}
