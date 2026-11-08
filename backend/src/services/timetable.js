import {
  DEFAULT_BELL, LAB_KINDS, TIMETABLE_STATUS, WEEK_DAYS, checkBell, findClashes, generateTimetable, sectionLabel, teachingPeriods, weekdayCode,
} from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { User } from '../models/tenant.js'
import { BellSchedule, Room, Substitution, Timetable, TimetableEntry } from '../models/timetable.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { sectionsInScope, yearOrCurrent } from './academics.js'
import { notifyUsers } from './notify.js'

// Timetable (module `timetable`). A year's timetable is built as a draft — generated from the teacher allocations
// (periods per week) and the bell schedules, then adjusted by hand (a locked cell survives the next generation) — and
// published; the published one before it is kept as an old version. Substitutions cover an absent teacher's periods on
// one date, from the published timetable, with the free teachers suggested.

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date

// ───────────────────────────────────────────────────────── bell schedules

/** Every institution has a default bell schedule (a typical 8-period day) to start from. */
export async function ensureBell() {
  if (await BellSchedule.exists({})) return
  await BellSchedule.create({ name: 'Regular day', slots: DEFAULT_BELL, isDefault: true })
}

export async function listBells() {
  await ensureBell()
  const rows = await BellSchedule.find().sort({ isDefault: -1, name: 1 }).lean()
  return rows.map((b) => ({ ...clean(b), classIds: b.classIds.map(String), periods: teachingPeriods(b.slots) }))
}

export async function saveBell(id, input, req) {
  const errors = checkBell(input.slots)
  if (Object.keys(errors).length) throw fieldsError(errors)
  const b = id ? await BellSchedule.findById(id) : new BellSchedule()
  if (!b) throw notFound('Bell schedule')
  Object.assign(b, { name: input.name, slots: input.slots, classIds: input.isDefault ? [] : input.classIds ?? [], isDefault: !!input.isDefault })
  await b.save()
  if (b.isDefault) await BellSchedule.updateMany({ _id: { $ne: b._id } }, { $set: { isDefault: false } })
  else if (!await BellSchedule.exists({ isDefault: true })) await BellSchedule.updateOne({ _id: b._id }, { $set: { isDefault: true, classIds: [] } })
  // a class follows one schedule
  if (b.classIds.length) await BellSchedule.updateMany({ _id: { $ne: b._id } }, { $pull: { classIds: { $in: b.classIds } } })
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'timetable', entityType: 'bell_schedule', entityId: String(b._id), entityName: b.name, summary: `${id ? 'Updated' : 'Added'} bell schedule ${b.name} (${teachingPeriods(b.slots).length} periods)` }, req)
  return (await listBells()).find((x) => x.id === String(b._id))
}

export async function deleteBell(id, req) {
  const b = isOid(id) ? await BellSchedule.findById(id) : null
  if (!b) throw notFound('Bell schedule')
  if (b.isDefault) throw conflict('The default bell schedule can’t be deleted. Make another the default first.')
  await BellSchedule.deleteOne({ _id: b._id })
  await audit({ action: 'DELETE', module: 'timetable', entityType: 'bell_schedule', entityId: String(b._id), entityName: b.name, summary: `Deleted bell schedule ${b.name}` }, req)
  return { deleted: true }
}

/** classId → that class's bell schedule (or the default). */
async function bellsByClass() {
  const bells = await listBells()
  const def = bells.find((b) => b.isDefault) ?? bells[0]
  const byClass = new Map()
  for (const b of bells) for (const c of b.classIds) byClass.set(c, b)
  return { of: (classId) => byClass.get(String(classId)) ?? def, def }
}

// ───────────────────────────────────────────────────────── rooms

export async function listRooms() {
  const rows = await Room.find().sort({ active: -1, kind: 1, name: 1 }).lean()
  const sections = await Section.find({ _id: { $in: rows.map((r) => r.sectionId).filter(Boolean) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const label = new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })]))
  return rows.map((r) => ({ ...clean(r), sectionId: idStr(r.sectionId), section: label.get(String(r.sectionId)) ?? null }))
}

export async function saveRoom(id, input, req) {
  if (input.sectionId && await Room.exists({ sectionId: input.sectionId, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ sectionId: 'That section already has a home room' })
  const r = id ? await Room.findById(id) : new Room()
  if (!r) throw notFound('Room')
  Object.assign(r, { name: input.name, code: input.code || undefined, kind: input.kind, capacity: input.capacity || undefined, sectionId: input.sectionId || undefined, active: input.active !== false })
  await r.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'timetable', entityType: 'room', entityId: String(r._id), entityName: r.name, summary: `${id ? 'Updated' : 'Added'} room ${r.name}` }, req)
  return (await listRooms()).find((x) => x.id === String(r._id))
}

/** A room in use in a timetable is switched off instead of deleted. */
export async function deleteRoom(id, req) {
  const r = isOid(id) ? await Room.findById(id) : null
  if (!r) throw notFound('Room')
  const used = await TimetableEntry.exists({ roomId: r._id })
  if (used) await Room.updateOne({ _id: r._id }, { $set: { active: false, sectionId: null } })
  else await Room.deleteOne({ _id: r._id })
  await audit({ action: 'DELETE', module: 'timetable', entityType: 'room', entityId: String(r._id), entityName: r.name, summary: used ? `Switched off room ${r.name} (used in a timetable)` : `Deleted room ${r.name}` }, req)
  return { deleted: !used, deactivated: !!used }
}

// ───────────────────────────────────────────────────────── versions

async function workingDays() {
  const days = (await getSettings('core')).workingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return WEEK_DAYS.filter((d) => days.includes(d))
}

const ttDto = (t) => t && ({ ...clean(t), academicYearId: String(t.academicYearId), statusLabel: TIMETABLE_STATUS[t.status]?.label, blocked: (t.blocked ?? []).map((b) => ({ ...b, teacherId: idStr(b.teacherId) })) })

/** The year's timetables: the draft being worked on, the published one, and older versions. */
export async function overview(yearId) {
  const year = await yearOrCurrent(yearId)
  const rows = await Timetable.find({ academicYearId: year._id }).sort({ version: -1 }).lean()
  const counts = await TimetableEntry.aggregate([{ $match: { timetableId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$timetableId', n: { $sum: 1 } } }])
  const n = new Map(counts.map((c) => [String(c._id), c.n]))
  const dto = (t) => (t ? { ...ttDto(t), entries: n.get(String(t._id)) ?? 0 } : null)
  return {
    year: { id: String(year._id), name: year.name }, days: await workingDays(),
    draft: dto(rows.find((r) => r.status === 'DRAFT')), published: dto(rows.find((r) => r.status === 'PUBLISHED')),
    versions: rows.filter((r) => r.status === 'ARCHIVED').map(dto),
  }
}

/** The year's draft — made from the published timetable (or empty) when there is none. */
async function ensureDraft(year, by) {
  const existing = await Timetable.findOne({ academicYearId: year._id, status: 'DRAFT' })
  if (existing) return existing
  const last = await Timetable.findOne({ academicYearId: year._id }).sort({ version: -1 }).lean()
  const pub = await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).lean()
  const draft = await Timetable.create({ academicYearId: year._id, version: (last?.version ?? 0) + 1, status: 'DRAFT', rules: pub?.rules, blocked: pub?.blocked ?? [], generatedBy: by })
  if (pub) {
    const cells = await TimetableEntry.find({ timetableId: pub._id }).lean()
    if (cells.length) await TimetableEntry.insertMany(cells.map(({ _id, timetableId, ...c }) => ({ ...c, timetableId: draft._id }))) // eslint-disable-line no-unused-vars
  }
  return draft
}

export async function startDraft(yearId, auth, req) {
  const year = await yearOrCurrent(yearId)
  const d = await ensureDraft(year, auth.user?.name)
  await audit({ action: 'CREATE', module: 'timetable', entityType: 'timetable', entityId: String(d._id), entityName: `${year.name} v${d.version}`, summary: `Started timetable draft v${d.version} for ${year.name}` }, req)
  return overview(String(year._id))
}

async function draftById(id) {
  const t = isOid(id) ? await Timetable.findById(id) : null
  if (!t) throw notFound('Timetable')
  if (t.status !== 'DRAFT') throw conflict('Only the draft can be changed. Start a new draft from the published timetable.')
  return t
}

/** The draft's rules and teachers' unavailable periods. */
export async function saveRules(id, { rules, blocked, note }, req) {
  const t = await draftById(id)
  if (rules) t.rules = { ...t.rules?.toObject?.() ?? t.rules, ...rules }
  if (blocked) t.blocked = blocked
  if (note !== undefined) t.note = note || undefined
  await t.save()
  await audit({ action: 'UPDATE', module: 'timetable', entityType: 'timetable', entityId: String(t._id), entityName: `v${t.version}`, summary: `Changed the timetable rules (v${t.version})` }, req)
  return ttDto(t.toObject())
}

// ───────────────────────────────────────────────────────── generating

/** Build the week: every allocation's periods, around the locked cells. Unlocked cells are replaced. */
export async function generate(id, { seed } = {}, auth, req) {
  const t = await draftById(id)
  const year = await AcademicYear.findById(t.academicYearId).lean()
  const [sections, allocs, rooms, bells, days, locked] = await Promise.all([
    Section.find({ academicYearId: year._id, active: { $ne: false } }).lean(),
    TeacherAllocation.find({ academicYearId: year._id, periodsPerWeek: { $gt: 0 } }).lean(),
    Room.find({ active: true }).lean(),
    bellsByClass(),
    workingDays(),
    TimetableEntry.find({ timetableId: t._id, locked: true }).lean(),
  ])
  if (!allocs.length) throw conflict('No teacher has periods per week yet (Academic setup › Teacher allocation).')
  const subjects = new Map((await Subject.find({ _id: { $in: allocs.map((a) => a.subjectId) } }).select('name type').lean()).map((s) => [String(s._id), s]))
  const labs = rooms.filter((r) => LAB_KINDS.includes(r.kind)).map((r) => String(r._id))
  const homeRoom = Object.fromEntries(rooms.filter((r) => r.sectionId).map((r) => [String(r.sectionId), String(r._id)]))
  const periods = Object.fromEntries(sections.map((s) => [String(s._id), bells.of(s.classId).periods]))
  const lessons = allocs.filter((a) => periods[String(a.sectionId)]).map((a) => ({
    sectionId: String(a.sectionId), subjectId: String(a.subjectId), teacherId: String(a.teacherId), count: a.periodsPerWeek, lab: subjects.get(String(a.subjectId))?.type === 'PRACTICAL',
  }))
  const r = generateTimetable({
    days, periods, lessons, labs, homeRoom, seed: seed ?? t.version,
    locked: locked.map((e) => ({ sectionId: String(e.sectionId), day: e.day, period: e.period, subjectId: idStr(e.subjectId), teacherId: idStr(e.teacherId), roomId: idStr(e.roomId) })),
    blocked: (t.blocked ?? []).map((b) => ({ teacherId: String(b.teacherId), day: b.day, period: b.period })),
    rules: { maxSamePerDay: t.rules?.maxSamePerDay ?? 2, teacherMaxPerDay: t.rules?.teacherMaxPerDay ?? 6 },
  })
  await TimetableEntry.deleteMany({ timetableId: t._id, locked: { $ne: true } })
  const fresh = r.entries.filter((e) => !e.locked)
  if (fresh.length) await TimetableEntry.insertMany(fresh.map((e) => ({ ...e, timetableId: t._id, roomId: e.roomId || undefined, locked: false })))
  const names = await labelMaps(r.unplaced.map((u) => u.sectionId), r.unplaced.map((u) => u.teacherId))
  t.unplaced = r.unplaced.map((u) => ({ ...u, section: names.section.get(u.sectionId) ?? '?', subject: subjects.get(u.subjectId)?.name ?? '?', teacher: names.teacher.get(u.teacherId) ?? '—' }))
  Object.assign(t, { generatedAt: new Date(), generatedBy: auth.user?.name })
  t.markModified('unplaced')
  await t.save()
  await audit({ action: 'UPDATE', module: 'timetable', entityType: 'timetable', entityId: String(t._id), entityName: `v${t.version}`, summary: `Generated timetable v${t.version}: ${r.placed} of ${r.wanted} periods placed${r.unplaced.length ? `, ${r.unplaced.reduce((n, u) => n + u.missing, 0)} could not be` : ''}` }, req)
  return { placed: r.placed, wanted: r.wanted, unplaced: t.unplaced }
}

async function labelMaps(sectionIds, teacherIds) {
  const sections = await Section.find({ _id: { $in: sectionIds.filter(isOid) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const teachers = await User.find({ _id: { $in: teacherIds.filter(isOid) } }).select('name').lean()
  return {
    section: new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })])),
    teacher: new Map(teachers.map((u) => [String(u._id), u.name])),
  }
}

// ───────────────────────────────────────────────────────── the grid

/**
 * One view of a timetable: a section's week, a teacher's, or a room's. `cells[day][period]` = { subject, teacher,
 * section, room, locked, id }. The rows are the section's bell schedule (the default one for teachers and rooms).
 */
export async function grid(id, { view, of }, auth) {
  const t = isOid(id) ? await Timetable.findById(id).lean() : null
  if (!t) throw notFound('Timetable')
  if (!isOid(of)) throw badRequest('Pick what to show.')
  if (auth) {
    // a teacher on "my classes" sees their own week and their classes' weeks, nothing else
    const allowed = await sectionsInScope(auth, 'timetable')
    if (allowed && !(view === 'teacher' && String(of) === String(auth.userId)) && !(view === 'section' && allowed.includes(String(of)))) throw forbidden('That timetable is outside your classes.')
  }
  const filter = { timetableId: t._id, ...(view === 'teacher' ? { teacherId: of } : view === 'room' ? { roomId: of } : { sectionId: of }) }
  const [entries, bells, days] = await Promise.all([TimetableEntry.find(filter).lean(), bellsByClass(), workingDays()])
  let bell = bells.def
  if (view === 'section') { const s = await Section.findById(of).select('classId').lean(); if (s) bell = bells.of(s.classId) }
  const [subjects, rooms, names] = await Promise.all([
    Subject.find({ _id: { $in: entries.map((e) => e.subjectId).filter(Boolean) } }).select('name code').lean().then((x) => new Map(x.map((s) => [String(s._id), s]))),
    Room.find({ _id: { $in: entries.map((e) => e.roomId).filter(Boolean) } }).select('name code').lean().then((x) => new Map(x.map((r) => [String(r._id), r]))),
    labelMaps(entries.map((e) => String(e.sectionId)), entries.map((e) => idStr(e.teacherId)).filter(Boolean)),
  ])
  const cells = {}
  for (const e of entries) {
    cells[e.day] ??= {}
    cells[e.day][e.period] = {
      id: String(e._id), sectionId: String(e.sectionId), subjectId: idStr(e.subjectId), teacherId: idStr(e.teacherId), roomId: idStr(e.roomId), locked: !!e.locked,
      subject: subjects.get(String(e.subjectId))?.name ?? '', subjectCode: subjects.get(String(e.subjectId))?.code ?? '', teacher: names.teacher.get(idStr(e.teacherId)) ?? '',
      section: names.section.get(String(e.sectionId)) ?? '', room: rooms.get(idStr(e.roomId))?.code || rooms.get(idStr(e.roomId))?.name || '',
    }
  }
  return { timetable: ttDto(t), view, of: String(of), days, slots: bell.slots, cells }
}

/** Set (or clear) one cell of the draft, refusing a clash: the teacher or the room busy elsewhere then. */
export async function setCell(id, { sectionId, day, period, subjectId, teacherId, roomId, locked, clear }, auth, req) {
  const t = await draftById(id)
  if (!WEEK_DAYS.includes(day)) throw badRequest('Pick a day.')
  const where = { timetableId: t._id, sectionId, day, period }
  if (clear) {
    await TimetableEntry.deleteOne(where)
    return grid(String(t._id), { view: 'section', of: sectionId })
  }
  if (teacherId) {
    const busy = await TimetableEntry.findOne({ timetableId: t._id, teacherId, day, period, sectionId: { $ne: sectionId } }).lean()
    if (busy) { const n = await labelMaps([String(busy.sectionId)], []); throw conflict(`That teacher is with ${n.section.get(String(busy.sectionId))} then.`) }
    if ((t.blocked ?? []).some((b) => String(b.teacherId) === String(teacherId) && b.day === day && b.period === period)) throw conflict('That teacher isn’t available then (timetable rules).')
  }
  if (roomId) {
    const busy = await TimetableEntry.findOne({ timetableId: t._id, roomId, day, period, sectionId: { $ne: sectionId } }).lean()
    const home = await Room.findById(roomId).select('sectionId').lean()
    if (busy && String(home?.sectionId) !== String(busy.sectionId)) throw conflict('That room is taken then.')
  }
  await TimetableEntry.updateOne(where, { $set: { subjectId: subjectId || undefined, teacherId: teacherId || undefined, roomId: roomId || undefined, locked: locked !== false } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'timetable', entityType: 'timetable', entityId: String(t._id), entityName: `v${t.version}`, summary: `Set a timetable cell (${day} period ${period})` }, req)
  return grid(String(t._id), { view: 'section', of: sectionId })
}

/** Lock or unlock every cell of a section (keep it as it is when generating again). */
export async function lockSection(id, sectionId, locked, req) {
  const t = await draftById(id)
  const r = await TimetableEntry.updateMany({ timetableId: t._id, sectionId }, { $set: { locked: !!locked } })
  await audit({ action: 'UPDATE', module: 'timetable', entityType: 'timetable', entityId: String(t._id), entityName: `v${t.version}`, summary: `${locked ? 'Locked' : 'Unlocked'} ${r.modifiedCount} cell(s) of a section` }, req)
  return { changed: r.modifiedCount }
}

/** How full each teacher's week is in a timetable, against what their allocations ask for. */
export async function teacherLoad(id) {
  const t = isOid(id) ? await Timetable.findById(id).lean() : null
  if (!t) throw notFound('Timetable')
  const [counts, allocs] = await Promise.all([
    TimetableEntry.aggregate([{ $match: { timetableId: t._id, teacherId: { $ne: null } } }, { $group: { _id: '$teacherId', n: { $sum: 1 }, days: { $addToSet: '$day' } } }]),
    TeacherAllocation.aggregate([{ $match: { academicYearId: t.academicYearId } }, { $group: { _id: '$teacherId', want: { $sum: { $ifNull: ['$periodsPerWeek', 0] } } } }]),
  ])
  const ids = [...new Set([...counts.map((c) => String(c._id)), ...allocs.map((a) => String(a._id))])]
  const names = await labelMaps([], ids)
  return ids.map((tid) => ({ teacherId: tid, name: names.teacher.get(tid) ?? '?', periods: counts.find((c) => String(c._id) === tid)?.n ?? 0, wanted: allocs.find((a) => String(a._id) === tid)?.want ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Publish the draft: no clashes allowed; the timetable published before becomes an old version. */
export async function publish(id, { effectiveFrom } = {}, auth, req) {
  const t = await draftById(id)
  const entries = await TimetableEntry.find({ timetableId: t._id }).lean()
  if (!entries.length) throw conflict('The draft is empty — generate it first.')
  const labs = (await Room.find({ kind: { $in: LAB_KINDS } }).select('_id').lean()).map((r) => String(r._id))
  const clashes = findClashes(entries.map((e) => ({ ...e, teacherId: idStr(e.teacherId), roomId: idStr(e.roomId), sectionId: String(e.sectionId) })), { labs })
  if (clashes.length) throw conflict(`${clashes.length} clash(es) left: a teacher or lab in two places at once. Fix them first.`)
  await Timetable.updateMany({ academicYearId: t.academicYearId, status: 'PUBLISHED' }, { $set: { status: 'ARCHIVED' } })
  Object.assign(t, { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: auth.user?.name, effectiveFrom: effectiveFrom || await today() })
  await t.save()
  await audit({ action: 'APPROVE', module: 'timetable', entityType: 'timetable', entityId: String(t._id), entityName: `v${t.version}`, summary: `Published timetable v${t.version} (from ${t.effectiveFrom})` }, req)
  return overview(String(t.academicYearId))
}

/** A teacher's own week from the published timetable, with today's substitutions they cover. */
export async function myWeek(auth) {
  const year = await yearOrCurrent()
  const pub = await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).lean()
  if (!pub) return { timetable: null, days: await workingDays(), slots: (await bellsByClass()).def.slots, cells: {}, covering: [] }
  const g = await grid(String(pub._id), { view: 'teacher', of: auth.userId }, auth)
  const t = await today()
  const covering = await Substitution.find({ substituteId: auth.userId, date: { $gte: t } }).sort({ date: 1, period: 1 }).limit(30).lean()
  const names = await labelMaps(covering.map((c) => String(c.sectionId)), covering.map((c) => String(c.absentTeacherId)))
  return { ...g, covering: covering.map((c) => ({ id: String(c._id), date: c.date, period: c.period, section: names.section.get(String(c.sectionId)), forTeacher: names.teacher.get(String(c.absentTeacherId)) })) }
}

// ───────────────────────────────────────────────────────── substitutions

async function publishedFor(date) {
  const year = await yearOrCurrent()
  const pub = await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).lean()
  if (!pub) throw conflict('Publish a timetable first.')
  if (pub.effectiveFrom && date < pub.effectiveFrom) throw conflict(`The published timetable starts on ${pub.effectiveFrom}.`)
  return { pub, year }
}

/** The periods of the absent teachers on a date, each with the free teachers who could take it (best first). */
export async function substitutionNeeds(date, absentIds) {
  const { pub, year } = await publishedFor(date)
  const day = weekdayCode(date)
  const absent = new Set(absentIds.map(String))
  const [needs, dayEntries, done, allocs] = await Promise.all([
    TimetableEntry.find({ timetableId: pub._id, day, teacherId: { $in: absentIds } }).sort({ period: 1 }).lean(),
    TimetableEntry.find({ timetableId: pub._id, day, teacherId: { $ne: null } }).select('teacherId period').lean(),
    Substitution.find({ date }).lean(),
    TeacherAllocation.find({ academicYearId: year._id }).select('teacherId subjectId sectionId').lean(),
  ])
  const weekStart = new Date(Date.parse(`${date}T00:00:00Z`) - ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10)
  const weekSubs = await Substitution.aggregate([{ $match: { date: { $gte: weekStart, $lte: date } } }, { $group: { _id: '$substituteId', n: { $sum: 1 } } }])
  const teachers = [...new Set(allocs.map((a) => String(a.teacherId)))].filter((tid) => !absent.has(tid))
  const busy = new Set(dayEntries.map((e) => `${e.teacherId}|${e.period}`))
  for (const s of done) busy.add(`${s.substituteId}|${s.period}`)
  const periodsToday = new Map()
  for (const e of dayEntries) periodsToday.set(String(e.teacherId), (periodsToday.get(String(e.teacherId)) ?? 0) + 1)
  const names = await labelMaps(needs.map((n) => String(n.sectionId)), [...teachers, ...absentIds.map(String)])
  const subjects = new Map((await Subject.find({ _id: { $in: needs.map((n) => n.subjectId).filter(Boolean) } }).select('name').lean()).map((s) => [String(s._id), s.name]))
  return needs.map((n) => {
    const taken = done.find((s) => String(s.sectionId) === String(n.sectionId) && s.period === n.period)
    const free = teachers.filter((tid) => !busy.has(`${tid}|${n.period}`)).map((tid) => ({
      teacherId: tid, name: names.teacher.get(tid) ?? '?',
      sameSubject: allocs.some((a) => String(a.teacherId) === tid && String(a.subjectId) === String(n.subjectId)),
      teachesClass: allocs.some((a) => String(a.teacherId) === tid && String(a.sectionId) === String(n.sectionId)),
      thisWeek: weekSubs.find((w) => String(w._id) === tid)?.n ?? 0, today: periodsToday.get(tid) ?? 0,
    })).sort((a, b) => Number(b.teachesClass) - Number(a.teachesClass) || Number(b.sameSubject) - Number(a.sameSubject) || a.thisWeek - b.thisWeek || a.today - b.today || a.name.localeCompare(b.name))
    return {
      sectionId: String(n.sectionId), section: names.section.get(String(n.sectionId)), period: n.period, subjectId: idStr(n.subjectId), subject: subjects.get(String(n.subjectId)) ?? '',
      absentTeacherId: String(n.teacherId), absentTeacher: names.teacher.get(String(n.teacherId)), covered: taken ? { id: String(taken._id), substituteId: String(taken.substituteId), name: names.teacher.get(String(taken.substituteId)) ?? '?' } : null,
      suggestions: free.slice(0, 8),
    }
  })
}

export async function listSubstitutions(date) {
  const rows = await Substitution.find({ date }).sort({ period: 1 }).lean()
  const names = await labelMaps(rows.map((r) => String(r.sectionId)), rows.flatMap((r) => [String(r.absentTeacherId), String(r.substituteId)]))
  return rows.map((r) => ({ ...clean(r), sectionId: String(r.sectionId), section: names.section.get(String(r.sectionId)), absentTeacher: names.teacher.get(String(r.absentTeacherId)), substitute: names.teacher.get(String(r.substituteId)), substituteId: String(r.substituteId), absentTeacherId: String(r.absentTeacherId) }))
}

export async function createSubstitution(input, auth, req) {
  const { pub } = await publishedFor(input.date)
  const day = weekdayCode(input.date)
  const cell = await TimetableEntry.findOne({ timetableId: pub._id, sectionId: input.sectionId, day, period: input.period }).lean()
  if (!cell) throw notFound('Period')
  const clash = await TimetableEntry.exists({ timetableId: pub._id, teacherId: input.substituteId, day, period: input.period })
  if (clash) throw conflict('That teacher has their own class then.')
  if (await Substitution.exists({ date: input.date, substituteId: input.substituteId, period: input.period, sectionId: { $ne: input.sectionId } })) throw conflict('That teacher is already covering another class then.')
  const s = await Substitution.findOneAndUpdate(
    { date: input.date, sectionId: input.sectionId, period: input.period },
    { $set: { subjectId: cell.subjectId, absentTeacherId: cell.teacherId, substituteId: input.substituteId, note: input.note || undefined, by: auth.user?.name } },
    { upsert: true, new: true },
  )
  const names = await labelMaps([String(input.sectionId)], [])
  await notifyUsers([input.substituteId], { event: 'timetable.substitution', title: `Cover ${names.section.get(String(input.sectionId))}, period ${input.period}`, message: `${input.date}${input.note ? ` — ${input.note}` : ''}`, link: '/timetable/substitutions', tone: 'info' })
  await audit({ action: 'CREATE', module: 'timetable', entityType: 'substitution', entityId: String(s._id), entityName: `${input.date} P${input.period}`, summary: `Substitution on ${input.date}, period ${input.period} (${names.section.get(String(input.sectionId))})` }, req)
  return listSubstitutions(input.date)
}

export async function deleteSubstitution(id, req) {
  const s = isOid(id) ? await Substitution.findById(id) : null
  if (!s) throw notFound('Substitution')
  await Substitution.deleteOne({ _id: s._id })
  await audit({ action: 'DELETE', module: 'timetable', entityType: 'substitution', entityId: String(s._id), entityName: `${s.date} P${s.period}`, summary: `Removed a substitution on ${s.date}, period ${s.period}` }, req)
  return listSubstitutions(s.date)
}

/** Teachers who can appear in the timetable (anyone with an allocation this year, or a class teacher). */
export async function teachers(yearId) {
  const year = await yearOrCurrent(yearId)
  const [allocs, sections] = await Promise.all([TeacherAllocation.distinct('teacherId', { academicYearId: year._id }), Section.distinct('classTeacherId', { academicYearId: year._id })])
  const ids = [...new Set([...allocs, ...sections].filter(Boolean).map(String))]
  return (await User.find({ _id: { $in: ids } }).select('name designation').sort({ name: 1 }).lean()).map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

/** Teachers on approved leave on a date (when Staff & HR is on) — the substitution desk starts with them ticked. */
export async function awayOn(date, auth) {
  const { moduleEnabled } = await import('../platform/access.js')
  if (!moduleEnabled(auth, 'hrms')) return []
  const { onLeaveOn } = await import('./hrmsLeave.js')
  return (await onLeaveOn(date)).filter((x) => x.userId)
}
