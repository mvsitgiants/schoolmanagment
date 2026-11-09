import { sectionLabel, teachingPeriods, weekdayCode } from '@schoolgiant/shared'
import { ClassLevel, Section, Subject } from '../models/academics.js'
import { User } from '../models/tenant.js'
import { Substitution, Timetable, TimetableEntry } from '../models/timetable.js'
import { yearOrCurrent } from './academics.js'
import { listBells } from './timetable.js'

// The periods of a day for period-wise attendance: from the class's bell schedule, with the subject and teacher the
// published timetable gives each period (and the substitute, when one covers it that date). Without a published
// timetable the periods still come from the bell schedule, just without a subject.

const idStr = (v) => (v ? String(v) : null)

/** The published timetable in use on a date (none before its "in use from" date). */
async function publishedOn(date) {
  const year = await yearOrCurrent().catch(() => null)
  if (!year) return null
  const tt = await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).lean()
  return tt && (!tt.effectiveFrom || date >= tt.effectiveFrom) ? tt : null
}

/**
 * Each section's periods on `date`: Map(sectionId → [{ period, start, end, subjectId, subject, teacherId, teacher,
 * substitute, regularTeacherId }]).
 */
export async function periodPlan(sectionIds = [], date) {
  const ids = sectionIds.map(String)
  if (!ids.length) return new Map()
  const day = weekdayCode(date)
  const [sections, bells, tt, subs] = await Promise.all([
    Section.find({ _id: { $in: ids } }).select('classId').lean(),
    listBells(),
    publishedOn(date),
    Substitution.find({ date, sectionId: { $in: ids } }).lean(),
  ])
  const def = bells.find((b) => b.isDefault) ?? bells[0]
  const bellOf = (classId) => bells.find((b) => (b.classIds ?? []).map(String).includes(String(classId))) ?? def
  const entries = tt ? await TimetableEntry.find({ timetableId: tt._id, day, sectionId: { $in: ids } }).lean() : []
  const subjectIds = [...entries.map((e) => e.subjectId), ...subs.map((s) => s.subjectId)].filter(Boolean)
  const userIds = [...entries.map((e) => e.teacherId), ...subs.map((s) => s.substituteId)].filter(Boolean)
  const [subjects, users] = await Promise.all([
    Subject.find({ _id: { $in: subjectIds } }).select('name code').lean().then((x) => new Map(x.map((s) => [String(s._id), s.name]))),
    User.find({ _id: { $in: userIds } }).select('name').lean().then((x) => new Map(x.map((u) => [String(u._id), u.name]))),
  ])
  const out = new Map()
  for (const s of sections) {
    const bell = bellOf(s.classId)
    const slots = (bell?.slots ?? []).filter((x) => x.kind === 'PERIOD' && x.no > 0)
    const nos = teachingPeriods(bell?.slots ?? [])
    out.set(String(s._id), nos.map((no) => {
      const slot = slots.find((x) => x.no === no)
      const e = entries.find((x) => String(x.sectionId) === String(s._id) && x.period === no)
      const sub = subs.find((x) => String(x.sectionId) === String(s._id) && x.period === no)
      const subjectId = idStr(e?.subjectId) ?? idStr(sub?.subjectId)
      const teacherId = idStr(sub?.substituteId) ?? idStr(e?.teacherId)
      return {
        period: no, start: slot?.start ?? null, end: slot?.end ?? null,
        subjectId, subject: subjects.get(subjectId) ?? null, teacherId, teacher: users.get(teacherId) ?? null,
        substitute: !!sub, regularTeacherId: idStr(e?.teacherId),
      }
    }))
  }
  return out
}

/** One section's periods on a date. */
export async function periodsOf(sectionId, date) {
  return (await periodPlan([sectionId], date)).get(String(sectionId)) ?? []
}

/** The signed-in teacher's periods on a date (their own, minus ones a substitute covers, plus the ones they cover). */
export async function teacherPeriods(userId, date) {
  if (!userId) return []
  const day = weekdayCode(date)
  const tt = await publishedOn(date)
  const [own, covering, coveredAway] = await Promise.all([
    tt ? TimetableEntry.find({ timetableId: tt._id, day, teacherId: userId }).select('sectionId period').lean() : [],
    Substitution.find({ date, substituteId: userId }).select('sectionId period').lean(),
    Substitution.find({ date, absentTeacherId: userId }).select('sectionId period').lean(),
  ])
  const away = new Set(coveredAway.map((x) => `${x.sectionId}|${x.period}`))
  const wanted = [...own.filter((x) => !away.has(`${x.sectionId}|${x.period}`)), ...covering]
  const sectionIds = [...new Set(wanted.map((x) => String(x.sectionId)))]
  const plan = await periodPlan(sectionIds, date)
  const sections = await Section.find({ _id: { $in: sectionIds } }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const label = new Map(sections.map((s) => [String(s._id), sectionLabel(classes.get(String(s.classId)), s, { short: true })]))
  return wanted
    .map((w) => ({ sectionId: String(w.sectionId), short: label.get(String(w.sectionId)) ?? '', ...(plan.get(String(w.sectionId))?.find((p) => p.period === w.period) ?? { period: w.period }) }))
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.period - b.period)
}
