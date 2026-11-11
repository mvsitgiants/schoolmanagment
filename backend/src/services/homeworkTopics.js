import { QUESTION_KINDS, TOPIC_STATUS, nextTeachingDay, topicProgress, topicSchedule, weekdayCode } from '@schoolgiant/shared'
import { SectionTopicPlan, Syllabus, SyllabusDone } from '../models/homework.js'
import { Holiday } from '../models/hrms.js'
import { Substitution, Timetable, TimetableEntry } from '../models/timetable.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { forbidden, notFound } from '../platform/errors.js'
import { institutionNow } from '../platform/time.js'
import { getSettings } from '../platform/settings.js'
import { currentYear } from './academics.js'
import { homeworkLookup, mayTeach, myPairs, requireYear, sectionFor, subjectNames, tick, topicIdsOf, unitsDto, wide } from './homework.js'

// Topics per section (module `homework`): the teaching material on each syllabus topic, each section's
// planned date for it, how it went (partly taught, needs revision, extra classes), and the teacher's
// day screen that brings these together. A topic fully taught is a SyllabusDone row, so the existing
// progress screens keep counting it.

const today = async () => (await institutionNow()).date
const idStr = (v) => (v ? String(v) : null)

// ───────────────────────────────────────────────────────── planned dates

/** What every section's dates are worked out from: working days, holidays, the published timetable, the year. */
export async function scheduleContext(year) {
  const [core, holidays, pub] = await Promise.all([
    getSettings('core'),
    Holiday.find({ date: { $gte: year.startDate, $lte: year.endDate }, optional: { $ne: true }, forStudents: { $ne: false } }).select('date').lean(),
    Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).select('_id').lean(),
  ])
  return {
    workingDays: core?.workingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    holidays: new Set(holidays.map((h) => h.date)),
    timetableId: pub?._id ?? null, from: year.startDate, to: year.endDate,
  }
}

/** The published timetable's cells for these sections, and each section × subject's periods a week ({ MON: 2 }). */
export async function timetableOf(ctx, sectionIds) {
  const entries = ctx.timetableId && sectionIds.length
    ? await TimetableEntry.find({ timetableId: ctx.timetableId, sectionId: { $in: sectionIds }, subjectId: { $ne: null } }).select('sectionId subjectId day period teacherId').lean()
    : []
  const weekly = new Map()
  for (const e of entries) {
    const k = `${e.sectionId}:${e.subjectId}`
    if (!weekly.has(k)) weekly.set(k, {})
    const w = weekly.get(k)
    w[e.day] = (w[e.day] ?? 0) + 1
  }
  // substitutions: a period taught as another subject that day moves one slot from the timetabled subject to it
  if (entries.length) {
    const subs = await Substitution.find({ sectionId: { $in: sectionIds }, date: { $gte: ctx.from, $lte: ctx.to }, subjectId: { $ne: null } }).select('date sectionId period subjectId').lean()
    const cell = new Map(entries.map((e) => [`${e.sectionId}:${e.day}:${e.period}`, String(e.subjectId)]))
    const bump = (k, date, n) => {
      if (!weekly.has(k)) weekly.set(k, {})
      const w = weekly.get(k)
      w._adjust ??= {}
      w._adjust[date] = (w._adjust[date] ?? 0) + n
    }
    for (const s of subs) {
      const was = cell.get(`${s.sectionId}:${weekdayCode(s.date)}:${s.period}`)
      if (!was || was === String(s.subjectId)) continue
      bump(`${s.sectionId}:${was}`, s.date, -1)
      bump(`${s.sectionId}:${s.subjectId}`, s.date, 1)
    }
  }
  return { entries, weekly }
}

const extraDto = (x) => ({ id: String(x._id), date: x.date, period: x.period ?? null, note: x.note ?? '', done: !!x.done })

/**
 * Every topic of a syllabus for one section, in syllabus order, with its planned dates and how it stands.
 *   units  unitsDto rows; plans  that section's SectionTopicPlan docs for the subject; done  its SyllabusDone docs
 */
export function sectionTopicRows(units, { ctx, weekly, plans = [], done = [] }) {
  const byTopic = new Map(plans.map((p) => [String(p.topicId), p]))
  const doneOf = new Map(done.map((d) => [String(d.topicId), d]))
  const overrides = Object.fromEntries(plans.filter((p) => p.plannedDate).map((p) => [String(p.topicId), p.plannedDate]))
  const sched = topicSchedule(units, { ...ctx, weekly, overrides })
  return units.flatMap((u) => u.topics.map((t) => {
    const p = byTopic.get(t.id)
    const d = doneOf.get(t.id)
    const s = sched[t.id]
    return {
      id: t.id, name: t.name, unitId: u.id, unit: u.name, periods: t.periods ?? null, hasContent: !!t.hasContent,
      start: s?.start ?? null, end: s?.end ?? null, override: !!s?.override,
      status: d ? 'TAUGHT' : p?.status === 'PARTLY' ? 'PARTLY' : 'NOT_STARTED',
      taughtOn: d?.date ?? null, statusDate: p?.statusDate ?? null, carried: p?.carried ?? 0,
      needsRevision: !!p?.needsRevision, revisionBy: p?.revisionBy ?? null, notes: p?.notes ?? '',
      extraClasses: (p?.extraClasses ?? []).map(extraDto).sort((a, b) => a.date.localeCompare(b.date)),
    }
  }))
}

/**
 * Per section of one class × subject: topic rows and progress as of today. Used by the syllabus screens.
 * `sections` [{ id }]; returns Map sectionId → { rows, progress }.
 */
export async function sectionPlans({ year, subjectId, units, sections, date }) {
  const ids = sections.map((s) => s.id)
  const [ctx, plans, done] = await Promise.all([
    scheduleContext(year),
    SectionTopicPlan.find({ sectionId: { $in: ids }, subjectId }).lean(),
    SyllabusDone.find({ sectionId: { $in: ids }, subjectId }).select('sectionId topicId date').lean(),
  ])
  const { weekly } = await timetableOf(ctx, ids)
  const out = new Map()
  for (const id of ids) {
    const rows = sectionTopicRows(units, {
      ctx, weekly: weekly.get(`${id}:${subjectId}`),
      plans: plans.filter((p) => String(p.sectionId) === id), done: done.filter((d) => String(d.sectionId) === id),
    })
    out.set(id, { rows, progress: topicProgress(rows, date) })
  }
  return out
}

/** For the overview: progress of many class × subject × section at once. keys `${sectionId}:${subjectId}`. */
export async function progressMany({ year, syllabi, pairs, date }) {
  const sectionIds = [...new Set(pairs.map((p) => p.sectionId))]
  const [ctx, plans, done] = await Promise.all([
    scheduleContext(year),
    SectionTopicPlan.find({ academicYearId: year._id, sectionId: { $in: sectionIds } }).lean(),
    SyllabusDone.find({ academicYearId: year._id, sectionId: { $in: sectionIds } }).select('sectionId subjectId topicId date').lean(),
  ])
  const { weekly } = await timetableOf(ctx, sectionIds)
  const group = (list) => {
    const m = new Map()
    for (const x of list) {
      const k = `${x.sectionId}:${x.subjectId}`
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(x)
    }
    return m
  }
  const plansOf = group(plans)
  const doneOf = group(done)
  const out = new Map()
  for (const p of pairs) {
    const syl = syllabi.find((x) => String(x.classId) === p.classId && String(x.subjectId) === p.subjectId)
    const k = `${p.sectionId}:${p.subjectId}`
    const rows = sectionTopicRows(unitsDto(syl?.units), { ctx, weekly: weekly.get(k), plans: plansOf.get(k) ?? [], done: doneOf.get(k) ?? [] })
    // which topics are overdue (planned date passed, not taught) — the class cards in My teaching name a few
    out.set(k, { ...topicProgress(rows, date), behindTopics: rows.filter((r) => r.status !== 'TAUGHT' && r.end && date && r.end < date).map((r) => ({ id: r.id, name: r.name })) })
  }
  return out
}

// ───────────────────────────────────────────────────────── topic content

const contentDto = (t) => ({
  book: { name: t.book?.name ?? '', chapter: t.book?.chapter ?? '', pages: t.book?.pages ?? '' },
  howTo: t.howTo ?? '', keyPoints: t.keyPoints ?? [], homeworkHint: t.homeworkHint ?? '',
  questions: (t.questions ?? []).map((q) => ({ id: String(q._id), question: q.question, answer: q.answer ?? '', kind: q.kind ?? 'SHORT', options: q.options ?? [], use: q.use ?? 'CLASS' })),
  contentBy: t.contentBy ?? null, contentAt: t.contentAt ?? null,
})

/** The syllabus (lean) holding a topic this year, with the unit and topic. */
async function findTopic(topicId, year) {
  if (!isOid(topicId)) throw notFound('Topic')
  const syl = await Syllabus.findOne({ academicYearId: year._id, 'units.topics._id': topicId }).lean()
  if (!syl) throw notFound('Topic')
  for (const u of syl.units) {
    const t = u.topics.find((x) => String(x._id) === String(topicId))
    if (t) return { syl, unit: u, topic: t }
  }
  throw notFound('Topic')
}

/** One topic with its teaching material, if the caller works with that class and subject. */
export async function getTopic(topicId, auth) {
  const year = await requireYear()
  const { syl, unit, topic } = await findTopic(topicId, year)
  const look = await homeworkLookup(auth)
  const cls = look.classes.find((c) => c.id === String(syl.classId))
  const subject = cls?.subjects.find((s) => s.id === String(syl.subjectId))
  if (!subject) throw notFound('Topic')
  const teaches = look.sections.some((s) => s.classId === cls.id && s.subjects.some((x) => x.id === subject.id))
  return {
    id: String(topic._id), name: topic.name, unitId: String(unit._id), unit: unit.name, periods: topic.periods ?? null, month: topic.month ?? null,
    classId: cls.id, className: cls.name, subjectId: subject.id, subject: subject.name,
    ...contentDto(topic), canEdit: wide(auth) || teaches,
  }
}

/** Save a topic's material (book, how to teach, key points, questions, homework suggestion). */
export async function saveTopic(topicId, input, auth, req) {
  const current = await getTopic(topicId, auth)
  if (!current.canEdit) throw forbidden('You can’t change this topic.')
  const year = await requireYear()
  const doc = await Syllabus.findOne({ academicYearId: year._id, classId: current.classId, subjectId: current.subjectId })
  const topic = doc?.units.id(current.unitId)?.topics.id(current.id)
  if (!topic) throw notFound('Topic')
  const keep = new Set(current.questions.map((q) => q.id))
  topic.book = { name: input.book?.name || undefined, chapter: input.book?.chapter || undefined, pages: input.book?.pages || undefined }
  topic.howTo = input.howTo || undefined
  topic.keyPoints = (input.keyPoints ?? []).map((k) => k.trim()).filter(Boolean)
  topic.homeworkHint = input.homeworkHint || undefined
  topic.questions = (input.questions ?? []).filter((q) => q.question?.trim()).map((q) => ({
    ...(q.id && keep.has(q.id) && { _id: q.id }), question: q.question.trim(), answer: q.answer || undefined,
    kind: QUESTION_KINDS.includes(q.kind) ? q.kind : 'SHORT', options: q.kind === 'MCQ' ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined, use: q.use === 'HOMEWORK' ? 'HOMEWORK' : 'CLASS',
  }))
  topic.contentBy = auth.user?.name
  topic.contentAt = new Date()
  await doc.save()
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus_topic', entityId: current.id, entityName: `${current.className} · ${current.subject} · ${current.name}`, summary: `Updated the teaching material of “${current.name}” (${current.className} ${current.subject}): ${topic.questions.length} question(s), ${topic.keyPoints.length} key point(s)` }, req)
  return getTopic(topicId, auth)
}

/** For Files: a topic's name, if the caller works with its class and subject. */
export async function syllabusTopicRecord(id, auth) {
  const t = await getTopic(id, auth)
  return { name: `${t.name} (${t.className} · ${t.subject})`, canAdd: t.canEdit }
}

// ───────────────────────────────────────────────────────── a section's record of a topic

/**
 * Change how a topic stands in a section. Any of:
 *   status        NOT_STARTED | PARTLY | TAUGHT (TAUGHT ticks the syllabus; anything else unticks it), on `date`
 *   notTaughtOn   it wasn't taught on this day: its date moves to the subject's next period
 *   needsRevision, plannedDate (null = back to the worked-out date), notes
 *   addExtra { date, period, note }; extraId with extraDone or removeExtra
 */
export async function updateTopicPlan(input, auth, req) {
  const year = await requireYear()
  const section = await sectionFor(input.sectionId, auth)
  if (!await mayTeach(auth, section, input.subjectId)) throw forbidden('You don’t teach this subject in this class.')
  const valid = await topicIdsOf(section.classId, input.subjectId, year._id)
  if (!valid.has(String(input.topicId))) throw notFound('Topic')
  const key = { sectionId: section._id, subjectId: input.subjectId, topicId: input.topicId }
  const plan = await SectionTopicPlan.findOne(key) ?? new SectionTopicPlan({ ...key, academicYearId: year._id })
  const t = await today()
  const said = []
  if (input.status) {
    const on = input.date || t
    plan.status = input.status
    plan.statusDate = on
    if (input.status === 'TAUGHT') {
      await SyllabusDone.deleteMany({ ...key, date: { $ne: on } })
      await tick({ year, section, subjectId: input.subjectId, topicIds: [input.topicId], date: on }, auth)
    } else await SyllabusDone.deleteMany(key)
    said.push(`marked ${TOPIC_STATUS[input.status].label.toLowerCase()}`)
  }
  if (input.notTaughtOn) {
    const ctx = await scheduleContext(year)
    const { weekly } = await timetableOf(ctx, [section._id])
    plan.plannedDate = nextTeachingDay(input.notTaughtOn, { ...ctx, weekly: weekly.get(`${section._id}:${input.subjectId}`) })
    plan.carried = (plan.carried ?? 0) + 1
    if (plan.status === 'TAUGHT') plan.status = 'NOT_STARTED'
    await SyllabusDone.deleteMany(key)
    said.push(`not taught on ${input.notTaughtOn}, moved to ${plan.plannedDate}`)
  }
  if (input.needsRevision !== undefined) { plan.needsRevision = input.needsRevision; said.push(input.needsRevision ? 'needs revision' : 'revision done'); if (!input.needsRevision) plan.revisionBy = undefined }
  if (input.revisionBy !== undefined) { plan.revisionBy = input.revisionBy || undefined; if (input.revisionBy) { plan.needsRevision = true; said.push(`revise by ${input.revisionBy}`) } }
  if (input.plannedDate !== undefined) { plan.plannedDate = input.plannedDate || undefined; said.push(input.plannedDate ? `planned for ${input.plannedDate}` : 'back to the planned date') }
  if (input.notes !== undefined) plan.notes = input.notes || undefined
  if (input.addExtra) { plan.extraClasses.push({ ...input.addExtra, by: auth.user?.name }); said.push(`extra class on ${input.addExtra.date}`) }
  if (input.extraId) {
    const x = plan.extraClasses.id(input.extraId)
    if (!x) throw notFound('Extra class')
    if (input.removeExtra) { x.deleteOne(); said.push('removed an extra class') } else if (input.extraDone !== undefined) {
      x.done = input.extraDone
      x.doneAt = input.extraDone ? new Date() : undefined
      said.push(input.extraDone ? `extra class on ${x.date} taken` : 'extra class not taken')
    }
  }
  plan.by = auth.user?.name
  await plan.save()
  const subject = (await subjectNames([input.subjectId])).get(String(input.subjectId))
  const syl = await Syllabus.findOne({ academicYearId: year._id, classId: section.classId, subjectId: input.subjectId }).select('units').lean()
  const topicName = syl?.units.flatMap((u) => u.topics).find((x) => String(x._id) === String(input.topicId))?.name ?? 'topic'
  await audit({ action: 'UPDATE', module: 'homework', entityType: 'syllabus', entityId: `${section.classId}:${input.subjectId}`, entityName: `${section.short} · ${subject}`, summary: `${section.short} ${subject} “${topicName}”: ${said.join(', ') || 'updated'}` }, req)
  return { saved: true }
}

// ───────────────────────────────────────────────────────── the teacher's day

/**
 * One class on one day, for a teacher: per subject they teach there, the topics planned for the day,
 * topics carried over (planned before and still not taught), extra classes and revisions due, each
 * topic with its material; and how the subject stands. Sections to pick: theirs first (all, if
 * their scope is wide). Defaults to the class of their first period that day.
 */
export async function teachDay({ sectionId, date }, auth) {
  const year = await currentYear()
  const t = await today()
  const day = date || t
  if (!year) return { year: null, today: t, date: day, sections: [], subjects: [] }
  const [{ pairs }, look, ctx] = await Promise.all([myPairs(auth, year), homeworkLookup(auth), scheduleContext(year)])
  const mine = new Set(pairs.map((p) => String(p.section._id)))
  const sections = look.sections.map((s) => ({ id: s.id, classId: s.classId, short: s.short, label: s.label, mine: mine.has(s.id) }))
    .sort((a, b) => Number(b.mine) - Number(a.mine))
  let pick = sectionId && sections.some((s) => s.id === String(sectionId)) ? String(sectionId) : null
  if (!pick && ctx.timetableId) {
    const first = await TimetableEntry.find({ timetableId: ctx.timetableId, teacherId: auth.userId, day: weekdayCode(day) }).sort({ period: 1 }).select('sectionId').lean()
    pick = first.map((e) => String(e.sectionId)).find((id) => sections.some((s) => s.id === id)) ?? null
  }
  pick ??= sections[0]?.id ?? null
  const base = { year: { id: String(year._id), name: year.name }, today: t, date: day, sections, sectionId: pick, subjects: [] }
  if (!pick) return base
  const section = await sectionFor(pick, auth)

  // the subjects: the ones they are allocated here; else all they look after (class teacher); else all they may see
  const here = pairs.filter((p) => String(p.section._id) === pick)
  const allocated = here.filter((p) => p.allocated)
  const subjectIds = allocated.length ? allocated.map((p) => p.subjectId) : here.length ? here.map((p) => p.subjectId) : (look.sections.find((s) => s.id === pick)?.subjects ?? []).map((s) => s.id)
  const [names, syllabi, plans, done, { entries, weekly }] = await Promise.all([
    subjectNames(subjectIds),
    Syllabus.find({ academicYearId: year._id, classId: section.classId, subjectId: { $in: subjectIds } }).lean(),
    SectionTopicPlan.find({ sectionId: section._id, subjectId: { $in: subjectIds } }).lean(),
    SyllabusDone.find({ sectionId: section._id, subjectId: { $in: subjectIds } }).select('subjectId topicId date').lean(),
    timetableOf(ctx, [section._id]),
  ])
  const code = weekdayCode(day)
  const subjects = []
  for (const subjectId of subjectIds) {
    const syl = syllabi.find((x) => String(x.subjectId) === subjectId)
    const units = unitsDto(syl?.units)
    const raw = new Map((syl?.units ?? []).flatMap((u) => u.topics.map((x) => [String(x._id), x])))
    const rows = sectionTopicRows(units, {
      ctx, weekly: weekly.get(`${section._id}:${subjectId}`),
      plans: plans.filter((p) => String(p.subjectId) === subjectId), done: done.filter((d) => String(d.subjectId) === subjectId),
    })
    const withContent = (r) => ({ ...r, ...contentDto(raw.get(r.id) ?? {}) })
    const todays = rows.filter((r) => (r.start && r.start <= day && day <= r.end && r.status !== 'TAUGHT') || r.taughtOn === day || (r.statusDate === day && r.status === 'PARTLY'))
    const shown = new Set(todays.map((r) => r.id))
    const overdue = rows.filter((r) => !shown.has(r.id) && r.status !== 'TAUGHT' && r.end && r.end < day)
    overdue.forEach((r) => shown.add(r.id))
    const extra = rows.filter((r) => r.extraClasses.some((x) => x.date === day))
    // a revision shows from its date on (or straight away when it has none)
    const revision = rows.filter((r) => r.needsRevision && (!r.revisionBy || r.revisionBy <= day) && !extra.some((x) => x.id === r.id))
    const next = todays.length ? null : rows.find((r) => r.status !== 'TAUGHT' && r.start && r.start > day) ?? null
    subjects.push({
      subjectId, subject: names.get(subjectId) ?? '?', hasSyllabus: units.some((u) => u.topics.length),
      periods: entries.filter((e) => String(e.subjectId) === subjectId && e.day === code).map((e) => e.period).sort((a, b) => a - b),
      canMark: await mayTeach(auth, section, subjectId),
      today: todays.map(withContent), overdue: overdue.map(withContent), extra: extra.map(withContent), revision: revision.map(withContent),
      next: next && withContent(next),
      progress: topicProgress(rows, day),
    })
  }
  subjects.sort((a, b) => (a.periods[0] ?? 99) - (b.periods[0] ?? 99) || a.subject.localeCompare(b.subject))
  return {
    ...base, section: { id: pick, classId: idStr(section.classId), label: section.label, short: section.short },
    subjects,
  }
}
