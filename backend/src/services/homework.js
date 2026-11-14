import { LESSON_STATUS, SUBMISSION_STATUS, monthsInRange, sectionLabel, submissionCounts, syllabusProgress, weekOf, yearPlan } from '@schoolgiant/shared'
import { ClassLevel, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { Homework, LessonPlan, SectionTopicPlan, Syllabus, SyllabusDone } from '../models/homework.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear, sectionsInScope } from './academics.js'
import { humanDate } from './notify.js'
import { progressMany, sectionPlans } from './homeworkTopics.js'

// Homework & lessons (module `homework`). Which sections someone sees follows the role's data scope
// for `homework` (services/academics.js sectionsInScope). With a narrow scope (CLASS, DEPARTMENT,
// OWN) a teacher works only on the subjects they teach in a section (Academic setup › Teacher
// allocation), or on every subject of a section they are class teacher of; homework and lesson
// plans someone else made can be changed by their author, the class teacher, or a wider scope.

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const NARROW = ['CLASS', 'DEPARTMENT', 'OWN']
export const wide = (auth, moduleId = 'homework') => !NARROW.includes(scopeOf(auth, moduleId))
const byRoll = { locale: 'en', numericOrdering: true }

export async function requireYear() {
  const y = await currentYear()
  if (!y) throw conflict('Add an academic year first (Academic setup › Academic years & terms).')
  return y
}

/** A section the caller may see, with its class and labels. */
export async function sectionFor(sectionId, auth) {
  if (!isOid(sectionId)) throw notFound('Section')
  const section = await Section.findById(sectionId).lean()
  if (!section) throw notFound('Section')
  const allowed = await sectionsInScope(auth, 'homework')
  if (allowed && !allowed.includes(String(section._id))) throw notFound('Section')
  const cls = await ClassLevel.findById(section.classId).lean()
  return { ...section, cls, label: sectionLabel(cls, section), short: sectionLabel(cls, section, { short: true }) }
}

/** May the caller teach (set homework, plan, tick the syllabus for) this subject in this section? */
export async function mayTeach(auth, section, subjectId) {
  if (wide(auth)) return true
  if (String(section.classTeacherId) === String(auth.userId)) return true
  const [alloc, user] = await Promise.all([
    TeacherAllocation.exists({ sectionId: section._id, subjectId, teacherId: auth.userId }),
    User.findById(auth.userId).select('sectionIds').lean(),
  ])
  return !!alloc || (user?.sectionIds ?? []).some((id) => String(id) === String(section._id))
}

/** May the caller change a plan / homework someone made? Its author, the class teacher, or a wider scope. */
const mayChange = (auth, doc, section) => wide(auth) || String(doc.teacherId) === String(auth.userId) || String(section.classTeacherId) === String(auth.userId)

export async function subjectNames(ids) {
  return new Map((await Subject.find({ _id: { $in: ids } }).select('name code').lean()).map((s) => [String(s._id), s.name]))
}

async function sectionLabels(ids) {
  const sections = await Section.find({ _id: { $in: ids } }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), { label: sectionLabel(classes.get(String(s.classId)), s), short: sectionLabel(classes.get(String(s.classId)), s, { short: true }), classId: String(s.classId) }]))
}

// ───────────────────────────────────────────────────────── what the caller may pick

/**
 * This year's sections the caller may work with, each with the subjects they may pick there; and
 * the classes of those sections with their subjects (for the syllabus screen).
 */
/** The sections and subjects the caller may pick (their own classes on a narrow scope). Also used by LMS. */
export async function homeworkLookup(auth, moduleId = 'homework') {
  const year = await currentYear()
  if (!year) return { year: null, sections: [], classes: [] }
  const allowed = await sectionsInScope(auth, moduleId)
  const sections = await Section.find({ academicYearId: year._id, active: { $ne: false }, ...(allowed && { _id: { $in: allowed } }) }).lean()
  const [classes, allocs, user] = await Promise.all([
    ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order subjectIds').sort({ order: 1 }).lean(),
    TeacherAllocation.find({ sectionId: { $in: sections.map((s) => s._id) } }).select('sectionId subjectId teacherId').lean(),
    User.findById(auth.userId).select('sectionIds').lean(),
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const isWide = wide(auth, moduleId)
  const extra = new Set((user?.sectionIds ?? []).map(String))
  const allSubjectIds = new Set([...classes.flatMap((c) => c.subjectIds.map(String)), ...allocs.map((a) => String(a.subjectId))])
  const names = await subjectNames([...allSubjectIds])
  const list = (ids) => [...new Set(ids.map(String))].filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) })).sort((a, b) => a.name.localeCompare(b.name))
  const out = sections
    .filter((s) => cls.has(String(s.classId)))
    .sort((a, b) => (cls.get(String(a.classId)).order - cls.get(String(b.classId)).order) || a.name.localeCompare(b.name))
    .map((s) => {
      const c = cls.get(String(s.classId))
      const here = allocs.filter((a) => String(a.sectionId) === String(s._id))
      const full = isWide || String(s.classTeacherId) === String(auth.userId) || extra.has(String(s._id))
      const subjectIds = full ? [...c.subjectIds, ...here.map((a) => a.subjectId)] : here.filter((a) => String(a.teacherId) === String(auth.userId)).map((a) => a.subjectId)
      return { id: String(s._id), classId: String(s.classId), label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }), subjects: list(subjectIds) }
    })
  const classRows = classes.map((c) => ({
    id: String(c._id), name: c.name, code: c.code,
    subjects: list(out.filter((s) => s.classId === String(c._id)).flatMap((s) => s.subjects.map((x) => x.id))),
  })).filter((c) => c.subjects.length)
  return { year: { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate }, sections: out, classes: classRows }
}

// ───────────────────────────────────────────────────────── syllabus

export const unitsDto = (units = []) => units.map((u) => ({
  id: String(u._id), name: u.name, fromMonth: u.fromMonth ?? null, toMonth: u.toMonth ?? null,
  topics: (u.topics ?? []).map((t) => ({
    id: String(t._id), name: t.name, periods: t.periods ?? null, month: t.month ?? null,
    hasContent: !!(t.howTo || t.book?.name || t.book?.pages || t.keyPoints?.length || t.questions?.length || t.homeworkHint),
  })),
}))
// a topic's teaching material — kept when the syllabus structure is saved (the editor doesn't send it)
const CONTENT_FIELDS = ['book', 'howTo', 'keyPoints', 'questions', 'homeworkHint', 'subTopics', 'contentBy', 'contentAt']
const thisMonth = async () => (await today()).slice(0, 7)

/** Every class × subject the caller works with, and how far each section has got. */
export async function syllabusOverview(auth) {
  const look = await homeworkLookup(auth)
  if (!look.year) return { year: null, rows: [] }
  const syllabi = await Syllabus.find({ academicYearId: look.year.id }).lean()
  const sectionIds = look.sections.map((s) => s.id)
  const done = await SyllabusDone.aggregate([
    { $match: { academicYearId: oid(look.year.id), sectionId: { $in: sectionIds.map(oid) } } },
    { $group: { _id: { sectionId: '$sectionId', subjectId: '$subjectId' }, topics: { $addToSet: '$topicId' } } },
  ])
  const doneOf = new Map(done.map((d) => [`${d._id.sectionId}:${d._id.subjectId}`, d.topics.map(String)]))
  const month = await thisMonth()
  const date = await today()
  const pairs = look.classes.flatMap((c) => c.subjects.flatMap((sub) => look.sections.filter((s) => s.classId === c.id && s.subjects.some((x) => x.id === sub.id)).map((s) => ({ sectionId: s.id, classId: c.id, subjectId: sub.id }))))
  const dated = await progressMany({ year: { ...look.year, _id: oid(look.year.id) }, syllabi, pairs, date })
  const rows = []
  for (const c of look.classes) {
    for (const sub of c.subjects) {
      const syl = syllabi.find((x) => String(x.classId) === c.id && String(x.subjectId) === sub.id)
      const units = unitsDto(syl?.units)
      const sections = look.sections.filter((s) => s.classId === c.id && s.subjects.some((x) => x.id === sub.id))
      rows.push({
        key: `${c.id}:${sub.id}`, classId: c.id, className: c.name, subjectId: sub.id, subject: sub.name,
        topics: units.reduce((n, u) => n + u.topics.length, 0), units: units.length, updatedBy: syl?.updatedBy ?? null, updatedAt: syl?.updatedAt ?? null,
        sections: sections.map((s) => {
          const ticked = doneOf.get(`${s.id}:${sub.id}`) ?? []
          const { topics, done: n, pct } = syllabusProgress(units, ticked)
          const plan = yearPlan(units, ticked, month)
          const p = dated.get(`${s.id}:${sub.id}`)
          return { id: s.id, short: s.short, topics, done: n, pct, behind: p?.behind ?? plan.behind.length, due: plan.due.length, revision: p?.revision ?? 0, extraDone: p?.extraDone ?? 0 }
        }),
        planned: yearPlan(units, [], month).planned,
      })
    }
  }
  return { year: look.year, month, rows }
}

/** One class's syllabus for a subject, with each section's ticks. */
export async function getSyllabus({ classId, subjectId }, auth) {
  const year = await requireYear()
  if (!isOid(classId) || !isOid(subjectId)) throw notFound('Syllabus')
  const look = await homeworkLookup(auth)
  const cls = look.classes.find((c) => c.id === String(classId))
  if (!cls || !cls.subjects.some((s) => s.id === String(subjectId))) throw notFound('Syllabus')
  const [syl, subject] = await Promise.all([Syllabus.findOne({ academicYearId: year._id, classId, subjectId }).lean(), Subject.findById(subjectId).select('name').lean()])
  const units = unitsDto(syl?.units)
  const sections = look.sections.filter((s) => s.classId === String(classId) && s.subjects.some((x) => x.id === String(subjectId)))
  const [done, allocs] = await Promise.all([
    SyllabusDone.find({ sectionId: { $in: sections.map((s) => s.id) }, subjectId }).lean(),
    TeacherAllocation.find({ sectionId: { $in: sections.map((s) => s.id) }, subjectId }).select('sectionId teacherId').lean(),
  ])
  const teacherNames = new Map((await User.find({ _id: { $in: allocs.map((a) => a.teacherId) } }).select('name').lean()).map((u) => [String(u._id), u.name]))
  const month = await thisMonth()
  const date = await today()
  const plans = await sectionPlans({ year, subjectId, units, sections, date })
  return {
    year: look.year, months: monthsInRange(look.year.startDate, look.year.endDate), month, today: date,
    classId: String(classId), className: cls.name, subjectId: String(subjectId), subject: subject?.name ?? '?',
    units, updatedBy: syl?.updatedBy ?? null, updatedAt: syl?.updatedAt ?? null,
    canEditStructure: wide(auth) || sections.length > 0,
    sections: sections.map((s) => {
      const mine = done.filter((d) => String(d.sectionId) === s.id)
      const ticked = mine.map((d) => String(d.topicId))
      const plan = yearPlan(units, ticked, month)
      const sp = plans.get(s.id)
      return {
        id: s.id, label: s.label, short: s.short,
        // who teaches this subject to the section (teacher allocation)
        teachers: allocs.filter((a) => String(a.sectionId) === s.id).map((a) => ({ id: String(a.teacherId), name: teacherNames.get(String(a.teacherId)) ?? '' })),
        ticks: Object.fromEntries(mine.map((d) => [String(d.topicId), { date: d.date, by: d.by, fromPlan: !!d.lessonPlanId }])),
        ...syllabusProgress(units, ticked), behind: sp.progress.behind, due: plan.due.length,
        progress: sp.progress,
        // each topic's planned dates and how it stands in this section
        topicPlan: Object.fromEntries(sp.rows.map((r) => [r.id, { start: r.start, end: r.end, override: r.override, status: r.status, needsRevision: r.needsRevision, carried: r.carried, notes: r.notes, extraClasses: r.extraClasses }])),
      }
    }),
  }
}

/**
 * Save a syllabus. Units and topics keep their ids (sections' ticks hang off them); a topic left out
 * is removed with its ticks, and lesson plans stop pointing at it.
 */
export async function saveSyllabus({ classId, subjectId, units }, auth, req) {
  const year = await requireYear()
  const current = await getSyllabus({ classId, subjectId }, auth) // checks the caller may see it
  if (!current.canEditStructure) throw forbidden('You can’t change this syllabus.')
  const errors = {}
  const months = new Set(monthsInRange(year.startDate, year.endDate))
  const inYear = `A month of ${year.name}`
  units.forEach((u, i) => {
    if (!u.name?.trim()) errors[`units.${i}.name`] = 'Name the unit'
    if (u.fromMonth && !months.has(u.fromMonth)) errors[`units.${i}.fromMonth`] = inYear
    if (u.toMonth && !months.has(u.toMonth)) errors[`units.${i}.toMonth`] = inYear
    if (u.fromMonth && u.toMonth && u.toMonth < u.fromMonth) errors[`units.${i}.toMonth`] = 'On or after the start month'
    ;(u.topics ?? []).forEach((t, j) => {
      if (!t.name?.trim()) errors[`units.${i}.topics.${j}.name`] = 'Name the topic'
      if (t.month && !months.has(t.month)) errors[`units.${i}.topics.${j}.month`] = inYear
    })
  })
  if (Object.keys(errors).length) throw fieldsError(errors)
  const known = new Set(current.units.flatMap((u) => [u.id, ...u.topics.map((t) => t.id)]))
  const stored = await Syllabus.findOne({ academicYearId: year._id, classId, subjectId }).lean()
  const contentOf = new Map((stored?.units ?? []).flatMap((u) => u.topics.map((t) => [String(t._id), Object.fromEntries(CONTENT_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]))])))
  const keepId = (id) => (id && known.has(String(id)) ? id : undefined)
  const next = units.map((u) => ({
    ...(keepId(u.id) && { _id: u.id }), name: u.name.trim(),
    fromMonth: u.fromMonth || u.toMonth || undefined, toMonth: u.toMonth || u.fromMonth || undefined,
    topics: (u.topics ?? []).map((t) => ({ ...(keepId(t.id) && { ...contentOf.get(String(t.id)), _id: t.id }), name: t.name.trim(), periods: t.periods || undefined, month: t.month || undefined })),
  }))
  const kept = new Set(next.flatMap((u) => u.topics.map((t) => String(t._id ?? ''))).filter(Boolean))
  const removed = current.units.flatMap((u) => u.topics.map((t) => t.id)).filter((id) => !kept.has(id))
  await withTransaction(async () => {
    await Syllabus.updateOne({ academicYearId: year._id, classId, subjectId }, { $set: { units: next, updatedBy: auth.user?.name } }, { upsert: true })
    if (removed.length) {
      await SyllabusDone.deleteMany({ subjectId, topicId: { $in: removed } })
      await SectionTopicPlan.deleteMany({ subjectId, topicId: { $in: removed } })
      await LessonPlan.updateMany({ subjectId, topicIds: { $in: removed } }, { $pull: { topicIds: { $in: removed } } })
    }
  })
  const topics = next.reduce((n, u) => n + u.topics.length, 0)
  const planned = yearPlan(next, []).planned
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus', entityId: `${classId}:${subjectId}`, entityName: `${current.className} · ${current.subject}`, summary: `Saved the ${current.subject} syllabus of ${current.className}: ${next.length} unit(s), ${topics} topic(s)${planned ? `, ${planned} planned by month` : ''}${removed.length ? `; removed ${removed.length}` : ''}` }, req)
  return getSyllabus({ classId, subjectId }, auth)
}

export async function topicIdsOf(classId, subjectId, academicYearId) {
  const syl = await Syllabus.findOne({ academicYearId, classId, subjectId }).lean()
  return new Set((syl?.units ?? []).flatMap((u) => u.topics.map((t) => String(t._id))))
}

export async function tick({ year, section, subjectId, topicIds, date, lessonPlanId }, auth) {
  if (!topicIds.length) return
  await SyllabusDone.bulkWrite(topicIds.map((topicId) => ({
    updateOne: {
      filter: { sectionId: section._id, subjectId, topicId },
      update: { $setOnInsert: { academicYearId: year._id, date, by: auth.user?.name, byId: auth.userId, ...(lessonPlanId && { lessonPlanId }) } },
      upsert: true,
    },
  })))
}

/** A taught topic stays taught — revise it instead. Only someone with full access may undo it, to put a mistake right. */
export const TAUGHT_STAYS = 'This topic is already taught, and a taught topic stays taught. Mark it for revision instead — or ask the administrator if it was marked by mistake.'
export const mayUndoTaught = (auth) => !!auth?.fullAccess

/** Tick topics as taught (or untick them) in a section. */
export async function markTopics({ sectionId, subjectId, topicIds, done = true, date }, auth, req) {
  const year = await requireYear()
  const section = await sectionFor(sectionId, auth)
  if (!await mayTeach(auth, section, subjectId)) throw forbidden('You don’t teach this subject in this class.')
  const valid = await topicIdsOf(section.classId, subjectId, year._id)
  if (topicIds.some((id) => !valid.has(String(id)))) throw badRequest('Some topics are not in this syllabus.')
  if (!done && !mayUndoTaught(auth) && await SyllabusDone.exists({ sectionId: section._id, subjectId, topicId: { $in: topicIds } })) throw conflict(TAUGHT_STAYS)
  if (done) await tick({ year, section, subjectId, topicIds, date: date || await today() }, auth)
  else await SyllabusDone.deleteMany({ sectionId: section._id, subjectId, topicId: { $in: topicIds } })
  const subject = (await subjectNames([subjectId])).get(String(subjectId))
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus', entityId: `${section.classId}:${subjectId}`, entityName: `${section.short} · ${subject}`, summary: `${done ? 'Ticked' : 'Unticked'} ${topicIds.length} ${subject} topic(s) for ${section.short}` }, req)
  return getSyllabus({ classId: section.classId, subjectId }, auth)
}

// ───────────────────────────────────────────────────────── lesson plans

async function planRows(rows, auth) {
  const [labels, subjects] = await Promise.all([sectionLabels(rows.map((r) => r.sectionId)), subjectNames(rows.map((r) => r.subjectId))])
  const syllabi = await Syllabus.find({ subjectId: { $in: rows.map((r) => r.subjectId) } }).select('units').lean()
  const topicName = new Map(syllabi.flatMap((s) => s.units.flatMap((u) => u.topics.map((t) => [String(t._id), t.name]))))
  const sections = new Map((await Section.find({ _id: { $in: rows.map((r) => r.sectionId) } }).select('classTeacherId').lean()).map((s) => [String(s._id), s]))
  return rows.map((r) => ({
    ...clean(r), academicYearId: String(r.academicYearId), sectionId: String(r.sectionId), subjectId: String(r.subjectId), teacherId: idStr(r.teacherId),
    topicIds: (r.topicIds ?? []).map(String), topics: (r.topicIds ?? []).map((id) => topicName.get(String(id))).filter(Boolean),
    section: labels.get(String(r.sectionId))?.short ?? '?', classId: labels.get(String(r.sectionId))?.classId ?? null, subject: subjects.get(String(r.subjectId)) ?? '?',
    statusLabel: LESSON_STATUS[r.status]?.label, canChange: mayChange(auth, r, sections.get(String(r.sectionId)) ?? {}),
  }))
}

/** The lesson-plan filter for this year, the caller's classes and the picked class / subject / teacher / dates — ids cast, so it serves aggregates too. */
async function planFilter({ from, to, sectionId, subjectId, topicId, mine }, auth) {
  const year = await requireYear()
  const allowed = await sectionsInScope(auth, 'homework')
  const filter = { academicYearId: year._id }
  if (allowed) filter.sectionId = { $in: allowed.map(oid) }
  if (sectionId) {
    if (allowed && !allowed.includes(String(sectionId))) throw notFound('Section')
    filter.sectionId = oid(sectionId)
  }
  if (subjectId) filter.subjectId = oid(subjectId)
  if (topicId) filter.topicIds = oid(topicId) // the lessons that cover this syllabus topic
  if (mine) filter.teacherId = isOid(auth.userId) ? oid(auth.userId) : null
  if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  return filter
}

const PLAN_SORT = { date: 1, period: 1, createdAt: 1, _id: 1 }
const statusSums = Object.fromEntries(Object.keys(LESSON_STATUS).map((s) => [s, { $sum: { $cond: [{ $eq: ['$status', s] }, 1, 0] } }]))

/** Lesson plans in date order, one page at a time; `counts` tallies each status over the whole filtered range (the tiles). */
export async function listPlans({ page = 1, pageSize = 50, ...q }, auth) {
  const filter = await planFilter(q, auth)
  const [rows, total, tally] = await Promise.all([
    LessonPlan.find(filter).sort(PLAN_SORT).skip((page - 1) * pageSize).limit(pageSize).lean(),
    LessonPlan.countDocuments(filter),
    LessonPlan.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  return { rows: await planRows(rows, auth), total, page, pageSize, counts: Object.fromEntries(tally.map((c) => [c._id, c.n])) }
}

/**
 * The month view: for each day in the range, how many plans there are (in all and by status) and the first `perDay` of
 * them in period order — the calendar shows three a day and "+N more", which opens that week's paged list.
 */
export async function planCalendar(q, auth, perDay = 3) {
  const filter = await planFilter(q, auth)
  const days = await LessonPlan.aggregate([
    { $match: filter },
    { $sort: PLAN_SORT },
    { $group: { _id: '$date', total: { $sum: 1 }, ...statusSums, ids: { $push: '$_id' } } },
    { $project: { total: 1, ...Object.fromEntries(Object.keys(LESSON_STATUS).map((s) => [s, 1])), ids: { $slice: ['$ids', perDay] } } },
    { $sort: { _id: 1 } },
  ])
  const shown = await LessonPlan.find({ _id: { $in: days.flatMap((d) => d.ids) } }).lean()
  const byId = new Map((await planRows(shown, auth)).map((r) => [r.id, r]))
  return days.map((d) => ({
    date: d._id, total: d.total, counts: Object.fromEntries(Object.keys(LESSON_STATUS).map((s) => [s, d[s]])),
    plans: d.ids.map((id) => byId.get(String(id))).filter(Boolean),
  }))
}

async function planFor(id, auth) {
  if (!isOid(id)) throw notFound('Lesson plan')
  const p = await LessonPlan.findById(id)
  if (!p) throw notFound('Lesson plan')
  const section = await sectionFor(p.sectionId, auth)
  return { p, section }
}

export async function savePlan(id, input, auth, req) {
  const year = await requireYear()
  const section = await sectionFor(input.sectionId, auth)
  if (!await mayTeach(auth, section, input.subjectId)) throw forbidden('You don’t teach this subject in this class.')
  if (input.date < year.startDate || input.date > year.endDate) throw fieldsError({ date: `Inside ${year.name}` })
  const valid = await topicIdsOf(section.classId, input.subjectId, year._id)
  if ((input.topicIds ?? []).some((t) => !valid.has(String(t)))) throw fieldsError({ topicIds: 'Pick topics from this class’s syllabus' })
  let plan
  if (id) {
    const found = await planFor(id, auth)
    if (!mayChange(auth, found.p, found.section)) throw forbidden('Only the teacher who wrote this plan (or the class teacher) can change it.')
    plan = found.p
  } else {
    plan = new LessonPlan({ academicYearId: year._id, teacherId: auth.userId, teacher: auth.user?.name })
  }
  Object.assign(plan, {
    sectionId: section._id, subjectId: input.subjectId, date: input.date, period: input.period || undefined, title: input.title, topicIds: input.topicIds ?? [],
    objectives: input.objectives || undefined, method: input.method || undefined, resources: input.resources || undefined, homeworkNote: input.homeworkNote || undefined,
    ...(input.links !== undefined && { links: input.links.length ? input.links : undefined }),
    ...(input.materialNotes !== undefined && { materialNotes: input.materialNotes || undefined }),
  })
  await plan.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'homework', entityType: 'lesson_plan', entityId: String(plan._id), entityName: plan.title, summary: `${id ? 'Updated' : 'Planned'} “${plan.title}” for ${section.short} on ${plan.date}` }, req)
  return (await planRows([plan.toObject()], auth))[0]
}

export async function deletePlan(id, auth, req) {
  const { p, section } = await planFor(id, auth)
  if (!mayChange(auth, p, section)) throw forbidden('Only the teacher who wrote this plan (or the class teacher) can delete it.')
  await LessonPlan.deleteOne({ _id: p._id })
  await audit({ action: 'DELETE', module: 'homework', entityType: 'lesson_plan', entityId: String(p._id), entityName: p.title, summary: `Deleted the lesson plan “${p.title}” (${section.short}, ${p.date})` }, req)
  return { deleted: true }
}

/**
 * Taught (its topics are ticked in the syllabus), not taken, or back to planned. `partly` with DONE: the lesson was held
 * but its topics were only partly covered — they are marked "partly taught" (a topic already taught stays taught).
 */
export async function setPlanStatus(id, { status, reflection, partly = false }, auth, req) {
  const year = await requireYear()
  const { p, section } = await planFor(id, auth)
  if (!mayChange(auth, p, section)) throw forbidden('Only the teacher who wrote this plan (or the class teacher) can change it.')
  if (p.status === 'DONE' && status !== 'DONE' && !mayUndoTaught(auth)) throw conflict('This lesson is already taught, and a taught lesson stays taught. Ask the administrator if it was marked by mistake.')
  Object.assign(p, { status, reflection: reflection || p.reflection, doneAt: status === 'DONE' ? new Date() : undefined, partly: status === 'DONE' && partly ? true : undefined })
  await p.save()
  if (status === 'DONE' && !partly) await tick({ year, section, subjectId: p.subjectId, topicIds: p.topicIds, date: p.date, lessonPlanId: p._id }, auth)
  if (status === 'DONE' && partly && p.topicIds?.length) {
    const taught = new Set((await SyllabusDone.find({ sectionId: section._id, subjectId: p.subjectId, topicId: { $in: p.topicIds } }).select('topicId').lean()).map((d) => String(d.topicId)))
    const open = p.topicIds.filter((tid) => !taught.has(String(tid)))
    if (open.length) {
      await SectionTopicPlan.bulkWrite(open.map((topicId) => ({
        updateOne: {
          filter: { sectionId: section._id, subjectId: p.subjectId, topicId },
          update: { $set: { status: 'PARTLY', statusDate: p.date }, $setOnInsert: { academicYearId: year._id } },
          upsert: true,
        },
      })))
    }
  }
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'lesson_plan', entityId: String(p._id), entityName: p.title, summary: `Marked “${p.title}” (${section.short}) as ${status === 'DONE' && partly ? 'partly taught' : LESSON_STATUS[status]?.label.toLowerCase()}` }, req)
  return (await planRows([p.toObject()], auth))[0]
}

// ───────────────────────────────────────────────────────── homework

async function strengthOf(sectionIds) {
  const rows = await Student.aggregate([{ $match: { sectionId: { $in: sectionIds }, status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

export async function listHomework(q, paging, auth) {
  const year = await requireYear()
  const t = await today()
  const allowed = await sectionsInScope(auth, 'homework')
  const filter = { academicYearId: year._id }
  if (allowed) filter.sectionId = { $in: allowed }
  if (q.sectionId) {
    if (allowed && !allowed.includes(String(q.sectionId))) throw notFound('Section')
    filter.sectionId = q.sectionId
  }
  if (q.subjectId) filter.subjectId = q.subjectId
  if (q.mine) filter.teacherId = auth.userId
  if (q.when === 'OPEN') filter.dueDate = { $gte: t }
  if (q.when === 'PAST') filter.dueDate = { $lt: t }
  if (paging.search) filter.title = new RegExp(escapeRegex(paging.search), 'i')
  const [rows, total] = await Promise.all([
    Homework.find(filter).sort({ dueDate: q.when === 'OPEN' ? 1 : -1, createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Homework.countDocuments(filter),
  ])
  const [labels, subjects, strength] = await Promise.all([sectionLabels(rows.map((r) => r.sectionId)), subjectNames(rows.map((r) => r.subjectId)), strengthOf(rows.map((r) => r.sectionId))])
  return listResponse(rows.map((r) => ({
    id: String(r._id), sectionId: String(r.sectionId), subjectId: String(r.subjectId), title: r.title, details: r.details ?? '', setDate: r.setDate, dueDate: r.dueDate,
    needsSubmission: r.needsSubmission, teacher: r.teacher, notifiedAt: r.notifiedAt ?? null, overdue: r.dueDate < t,
    section: labels.get(String(r.sectionId))?.short ?? '?', subject: subjects.get(String(r.subjectId)) ?? '?',
    counts: submissionCounts(r.entries, strength.get(String(r.sectionId)) ?? r.entries.length),
  })), total, paging)
}

async function homeworkFor(id, auth) {
  if (!isOid(id)) throw notFound('Homework')
  const h = await Homework.findById(id)
  if (!h) throw notFound('Homework')
  const section = await sectionFor(h.sectionId, auth)
  return { h, section }
}

export async function getHomework(id, auth) {
  const { h, section } = await homeworkFor(id, auth)
  const [students, subjects] = await Promise.all([
    Student.find({ sectionId: section._id, status: 'ACTIVE' }).collation(byRoll).sort({ rollNo: 1, firstName: 1 }).select('firstName middleName lastName admissionNo rollNo').lean(),
    subjectNames([h.subjectId]),
  ])
  const entry = new Map(h.entries.map((e) => [String(e.studentId), e]))
  return {
    id: String(h._id), sectionId: String(h.sectionId), subjectId: String(h.subjectId), title: h.title, details: h.details ?? '', setDate: h.setDate, dueDate: h.dueDate,
    needsSubmission: h.needsSubmission, teacher: h.teacher, teacherId: idStr(h.teacherId), notifiedAt: h.notifiedAt ?? null,
    section: section.label, sectionShort: section.short, subject: subjects.get(String(h.subjectId)) ?? '?',
    canChange: mayChange(auth, h, section), overdue: h.dueDate < await today(),
    counts: submissionCounts(h.entries.filter((e) => students.some((s) => String(s._id) === String(e.studentId))), students.length),
    students: students.map((s) => {
      const e = entry.get(String(s._id))
      return { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, status: e?.status ?? 'PENDING', statusLabel: SUBMISSION_STATUS[e?.status ?? 'PENDING']?.label, remark: e?.remark ?? '', at: e?.at ?? null, by: e?.by ?? null }
    }),
  }
}

/** Tell each family of a section about a homework (Notification rules › Homework set). */
async function notifyFamilies(h, section, subject) {
  const students = await Student.find({ sectionId: section._id, status: 'ACTIVE' }).select('_id').lean()
  for (const s of students) {
    await emit('homework.assigned', { studentId: String(s._id), entity: { type: 'homework', id: h._id }, data: { student: { class: section.short }, homework: { subject, title: h.title, dueDate: humanDate(h.dueDate) } } })
  }
  await Homework.updateOne({ _id: h._id }, { $set: { notifiedAt: new Date() } })
  return students.length
}

/** Set homework for one or more sections of a subject (one homework per section). */
export async function createHomework(input, auth, req) {
  const year = await requireYear()
  const t = await today()
  const setDate = input.setDate || t
  if (input.dueDate < setDate) throw fieldsError({ dueDate: 'On or after the day it is set' })
  if (input.dueDate > year.endDate) throw fieldsError({ dueDate: `Inside ${year.name}` })
  const sections = []
  for (const sid of [...new Set(input.sectionIds)]) {
    const section = await sectionFor(sid, auth)
    if (!await mayTeach(auth, section, input.subjectId)) throw forbidden(`You don’t teach this subject in ${section.short}.`)
    sections.push(section)
  }
  const subject = (await subjectNames([input.subjectId])).get(String(input.subjectId))
  if (!subject) throw fieldsError({ subjectId: 'Pick a subject' })
  const created = await Homework.insertMany(sections.map((s) => ({
    academicYearId: year._id, sectionId: s._id, subjectId: input.subjectId, title: input.title, details: input.details || undefined,
    setDate, dueDate: input.dueDate, needsSubmission: input.needsSubmission !== false, teacherId: auth.userId, teacher: auth.user?.name,
  })))
  let told = 0
  if (input.notify) for (const [i, h] of created.entries()) told += await notifyFamilies(h, sections[i], subject)
  await audit({ action: 'CREATE', module: 'homework', entityType: 'homework', entityId: String(created[0]._id), entityName: input.title, summary: `Set ${subject} homework “${input.title}” for ${sections.map((s) => s.short).join(', ')}, due ${input.dueDate}${told ? `; told ${told} famil${told === 1 ? 'y' : 'ies'}` : ''}` }, req)
  return { created: created.length, ids: created.map((h) => String(h._id)), notified: told }
}

export async function updateHomework(id, input, auth, req) {
  const { h, section } = await homeworkFor(id, auth)
  if (!mayChange(auth, h, section)) throw forbidden('Only the teacher who set this homework (or the class teacher) can change it.')
  if (input.dueDate && input.dueDate < h.setDate) throw fieldsError({ dueDate: 'On or after the day it was set' })
  for (const k of ['title', 'details', 'dueDate', 'needsSubmission']) if (input[k] !== undefined) h[k] = input[k]
  await h.save()
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'homework', entityId: String(h._id), entityName: h.title, summary: `Updated homework “${h.title}” (${section.short})` }, req)
  return getHomework(id, auth)
}

export async function deleteHomework(id, auth, req) {
  const { h, section } = await homeworkFor(id, auth)
  if (!mayChange(auth, h, section)) throw forbidden('Only the teacher who set this homework (or the class teacher) can delete it.')
  await Homework.deleteOne({ _id: h._id })
  await audit({ action: 'DELETE', module: 'homework', entityType: 'homework', entityId: String(h._id), entityName: h.title, summary: `Deleted homework “${h.title}” (${section.short})` }, req)
  return { deleted: true }
}

/** Record who handed it in (and the teacher's remark). Only the students sent are changed. */
export async function saveSubmissions(id, entries, auth, req) {
  const { h, section } = await homeworkFor(id, auth)
  if (!await mayTeach(auth, section, h.subjectId) && !mayChange(auth, h, section)) throw forbidden('You can’t check this homework.')
  if (!h.needsSubmission) throw conflict('This homework doesn’t need handing in.')
  const roster = new Set((await Student.find({ sectionId: section._id, status: 'ACTIVE' }).select('_id').lean()).map((s) => String(s._id)))
  if (entries.some((e) => !roster.has(e.studentId))) throw badRequest('Some students are not in this class.')
  const byStudent = new Map(h.entries.map((e) => [String(e.studentId), e]))
  for (const e of entries) {
    const prev = byStudent.get(e.studentId)
    const changed = !prev || prev.status !== e.status || (prev.remark ?? '') !== (e.remark ?? '')
    if (!changed) continue
    byStudent.set(e.studentId, { studentId: e.studentId, status: e.status, remark: e.remark || undefined, at: new Date(), by: auth.user?.name })
  }
  h.entries = [...byStudent.values()].filter((e) => e.status !== 'PENDING' || e.remark)
  await h.save()
  const counts = submissionCounts(h.entries, roster.size)
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'homework', entityId: String(h._id), entityName: h.title, summary: `Checked homework “${h.title}” (${section.short}): ${counts.handedIn} of ${roster.size} handed in` }, req)
  return getHomework(id, auth)
}

/** For Files: a lesson plan's name, access-checked by the caller's sections; its teacher (or the class teacher) may add. */
export async function lessonPlanRecord(id, auth) {
  const { p, section } = await planFor(id, auth)
  return { name: `${p.title} (${section.short}, ${p.date})`, canAdd: mayChange(auth, p, section) }
}

/** For Files: a homework's name, access-checked by the caller's sections. */
export async function homeworkRecord(id, auth) {
  const { h, section } = await homeworkFor(id, auth)
  return { name: `${h.title} (${section.short})`, canAdd: mayChange(auth, h, section) }
}


// ───────────────────────────────────────────────────────── my teaching (My workspace)

/**
 * The (section, subject) pairs the caller teaches this year: every subject of a section they are
 * class teacher of (or are linked to on their user record), and each subject they are allocated.
 * Unlike the lookup this is "mine" even on a wide scope — an administrator who also teaches sees
 * their own classes here, not the whole institution.
 */
export async function myPairs(auth, year) {
  const [own, allocs, user, allowed] = await Promise.all([
    Section.find({ academicYearId: year._id, classTeacherId: auth.userId, active: { $ne: false } }).lean(),
    TeacherAllocation.find({ academicYearId: year._id, teacherId: auth.userId }).select('sectionId subjectId').lean(),
    User.findById(auth.userId).select('sectionIds').lean(),
    sectionsInScope(auth, 'homework'),
  ])
  const linked = await Section.find({ academicYearId: year._id, _id: { $in: user?.sectionIds ?? [] }, active: { $ne: false } }).lean()
  const allocSections = await Section.find({ _id: { $in: allocs.map((a) => a.sectionId) }, active: { $ne: false } }).lean()
  const sections = new Map([...own, ...linked, ...allocSections].map((s) => [String(s._id), s]))
  if (allowed) for (const id of [...sections.keys()]) if (!allowed.includes(id)) sections.delete(id)
  const classes = new Map((await ClassLevel.find({ _id: { $in: [...sections.values()].map((s) => s.classId) } }).select('name code order subjectIds').lean()).map((c) => [String(c._id), c]))
  const whole = new Set([...own, ...linked].map((s) => String(s._id)))
  const pairs = new Map()
  const add = (s, subjectId, allocated) => {
    if (!s || !classes.has(String(s.classId))) return
    const key = `${s._id}:${subjectId}`
    pairs.set(key, { section: s, subjectId: String(subjectId), allocated: allocated || !!pairs.get(key)?.allocated })
  }
  for (const id of whole) for (const sub of classes.get(String(sections.get(id)?.classId))?.subjectIds ?? []) add(sections.get(id), sub, false)
  for (const a of allocs) add(sections.get(String(a.sectionId)), a.subjectId, true)
  return { pairs: [...pairs.values()], classes }
}

/**
 * Everything a teacher needs on one screen: this week's lesson plans (today's on top), homework of
 * theirs waiting to be checked, and each class × subject they teach with its progress against the
 * year plan (topics behind, topics planned for this month).
 */
export async function myTeaching(auth) {
  const year = await currentYear()
  const t = await today()
  const month = t.slice(0, 7)
  const week = weekOf(t)
  if (!year) return { year: null, today: t, month, week, plans: [], toCheck: [], openHomework: 0, classes: [] }
  const { pairs, classes } = await myPairs(auth, year)
  const sectionIds = [...new Set(pairs.map((p) => String(p.section._id)))]
  const [planDocs, past, openHomework, syllabi, done, subjects] = await Promise.all([
    LessonPlan.find({ academicYearId: year._id, teacherId: auth.userId, date: { $gte: week.from, $lte: week.to } }).sort({ date: 1, period: 1, createdAt: 1 }).lean(),
    Homework.find({ academicYearId: year._id, teacherId: auth.userId, needsSubmission: true, dueDate: { $lte: t } }).sort({ dueDate: -1 }).limit(60).lean(),
    Homework.countDocuments({ academicYearId: year._id, teacherId: auth.userId, dueDate: { $gt: t } }),
    Syllabus.find({ academicYearId: year._id, classId: { $in: [...classes.keys()] } }).lean(),
    SyllabusDone.find({ academicYearId: year._id, sectionId: { $in: sectionIds } }).select('sectionId subjectId topicId').lean(),
    subjectNames(pairs.map((p) => p.subjectId)),
  ])

  // homework still to check: due, and some students not recorded yet
  const [strength, labels] = await Promise.all([strengthOf(past.map((h) => h.sectionId)), sectionLabels(past.map((h) => h.sectionId))])
  const hwSubjects = await subjectNames(past.map((h) => h.subjectId))
  const toCheck = past
    .map((h) => ({ h, counts: submissionCounts(h.entries, strength.get(String(h.sectionId)) ?? h.entries.length) }))
    .filter(({ counts }) => counts.PENDING > 0)
    .slice(0, 10)
    .map(({ h, counts }) => ({
      id: String(h._id), title: h.title, dueDate: h.dueDate, sectionId: String(h.sectionId), subjectId: String(h.subjectId),
      section: labels.get(String(h.sectionId))?.short ?? '?', classId: labels.get(String(h.sectionId))?.classId ?? null, subject: hwSubjects.get(String(h.subjectId)) ?? '?', counts,
    }))

  // each class × subject against its year plan
  const doneOf = new Map()
  for (const d of done) {
    const k = `${d.sectionId}:${d.subjectId}`
    if (!doneOf.has(k)) doneOf.set(k, [])
    doneOf.get(k).push(String(d.topicId))
  }
  // behind = planned date passed and not taught (per section, from the timetable), as the syllabus page counts it
  const dated = await progressMany({ year, syllabi, pairs: pairs.map(({ section, subjectId }) => ({ sectionId: String(section._id), classId: String(section.classId), subjectId })), date: t })
  const rows = pairs.map(({ section, subjectId, allocated }) => {
    const cls = classes.get(String(section.classId))
    const p = dated.get(`${section._id}:${subjectId}`)
    const syl = syllabi.find((x) => String(x.classId) === String(section.classId) && String(x.subjectId) === subjectId)
    const units = unitsDto(syl?.units)
    const ticked = doneOf.get(`${section._id}:${subjectId}`) ?? []
    const progress = syllabusProgress(units, ticked)
    const plan = yearPlan(units, ticked, month)
    return {
      key: `${section._id}:${subjectId}`, sectionId: String(section._id), classId: String(section.classId), subjectId,
      section: sectionLabel(cls, section, { short: true }), subject: subjects.get(subjectId) ?? '?', order: cls?.order ?? 0,
      classTeacher: String(section.classTeacherId) === String(auth.userId), allocated, // allocated: they teach it (not only oversee it as class teacher)
      topics: progress.topics, done: progress.done, pct: progress.pct, planned: plan.planned,
      behind: p?.behind ?? plan.behind.length, behindTopics: (p?.behindTopics ?? plan.behind.map((x) => ({ id: x.topicId, name: x.name }))).slice(0, 8),
      revision: p?.revision ?? 0, extraDone: p?.extraDone ?? 0,
      due: plan.due.length, dueTopics: plan.due.slice(0, 8).map((x) => ({ id: x.topicId, name: x.name })),
    }
  }).filter((r) => r.subject !== '?')
    .sort((a, b) => (b.behind - a.behind) || (a.order - b.order) || a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject))
    .map(({ order, ...r }) => r)

  return {
    year: { id: String(year._id), name: year.name }, today: t, month, week,
    plans: await planRows(planDocs, auth), toCheck, openHomework, classes: rows,
  }
}
