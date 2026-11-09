import { LEAVE_STATUS, MARK_BY, attendancePct, countMarks, dayFromPeriods, daysBetween, monthRange, sectionLabel, takesDaily, takesPeriods, weekdayCode } from '@schoolgiant/shared'
import { AttendanceSheet, StudentLeave } from '../models/attendance.js'
import { AcademicYear, ClassLevel, Section, Subject } from '../models/academics.js'
import { Student, studentName } from '../models/students.js'
import { can, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'
import { currentYear, mySectionIds, sectionsInScope } from './academics.js'
import { humanDate } from './notify.js'
import { periodPlan, periodsOf, teacherPeriods } from './attendancePeriods.js'

// Student attendance (module `attendance`). A teacher marks a section for a day (or a period);
// absences can tell the family at once (Notification rules › Absence alert). Who may mark which
// section follows the role's data scope for `attendance` (services/academics.js sectionsInScope).
// Corrections: anyone who may mark can change a sheet up to `editDays` back; older sheets need
// `attendance.mark.edit`. Future dates are never marked.

const idStr = (v) => (v ? String(v) : null)

async function settings() {
  const [att, core] = await Promise.all([getSettings('attendance'), getSettings('core')])
  return { mode: 'DAILY', dayFrom: 'FIRST', dayMinPct: 50, periodMarkers: 'TIMETABLE', ...att, workingDays: core.workingDays ?? [] }
}

/**
 * May the caller mark this period? With "its teacher in the timetable" (the default): the period's teacher or substitute,
 * the class teacher, or staff whose attendance scope is the whole campus / institution. Returns null when allowed, else the reason.
 */
function periodBlock(cfg, auth, slot, section) {
  // staff who see the whole campus or institution (principal, coordinator, office) may mark any period; teachers on
  // "my classes" only their own (every teacher can edit attendance, so that permission alone says nothing here)
  if (cfg.periodMarkers === 'ANYONE' || ['ALL', 'BRANCH'].includes(scopeOf(auth, 'attendance'))) return null
  if (String(section.classTeacherId ?? '') === String(auth.userId)) return null
  if (slot?.teacherId && String(slot.teacherId) === String(auth.userId)) return null
  if (!slot?.teacherId) return null // no teacher in the timetable for that period: whoever may mark the class
  return 'NOT_YOUR_PERIOD'
}

/** The section with its class and year, checked against the caller's scope. */
async function sectionFor(sectionId, auth) {
  if (!isOid(sectionId)) throw notFound('Section')
  const section = await Section.findById(sectionId).lean()
  if (!section) throw notFound('Section')
  const allowed = await sectionsInScope(auth, 'attendance')
  if (allowed && !allowed.includes(String(section._id))) throw notFound('Section')
  const [cls, year] = await Promise.all([ClassLevel.findById(section.classId).lean(), AcademicYear.findById(section.academicYearId).lean()])
  return { section, cls, year, label: sectionLabel(cls, section), short: sectionLabel(cls, section, { short: true }) }
}

/** Students on approved leave on a date, by id. */
async function onLeave(studentIds, date) {
  const rows = await StudentLeave.find({ studentId: { $in: studentIds }, status: 'APPROVED', from: { $lte: date }, to: { $gte: date } }).select('studentId').lean()
  return new Set(rows.map((r) => String(r.studentId)))
}

/** May the caller change a sheet on this date? { canEdit, reason } */
function editRule(date, today, cfg, auth) {
  if (date > today) return { canEdit: false, reason: 'FUTURE' }
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - (Number(cfg.editDays) || 0) * 864e5).toISOString().slice(0, 10)
  const mayMark = can(auth, 'attendance.mark.create')
  const mayEdit = can(auth, 'attendance.mark.edit')
  if (!mayMark && !mayEdit) return { canEdit: false, reason: 'NO_PERMISSION' }
  if (date < oldest && !mayEdit) return { canEdit: false, reason: 'TOO_OLD' }
  return { canEdit: true, reason: null }
}

// ───────────────────────────────────────────────────────── today

/** The sections the caller may mark, with today's sheet (taken or not) — the Mark screen's list. */
export async function todayBoard(auth, { date } = {}) {
  const today = (await institutionNow()).date
  const day = date || today
  const year = await currentYear()
  if (!year) return { date: day, today, sections: [], mode: (await settings()).mode }
  const allowed = await sectionsInScope(auth, 'attendance')
  const sections = await Section.find({ academicYearId: year._id, active: true, ...(allowed && { _id: { $in: allowed } }) }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
  const sheets = await AttendanceSheet.find({ date: day, sectionId: { $in: sections.map((s) => s._id) } }).select('sectionId period counts takenBy takenAt').lean()
  const counts = await Student.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: sections.map((s) => s._id) } } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }])
  const strength = new Map(counts.map((c) => [String(c._id), c.n]))
  const mine = new Set(auth.userId ? await mySectionIds(auth.userId, year._id) : [])
  const cfg = await settings()
  const periodsOn = takesPeriods(cfg.mode)
  const plan = periodsOn ? await periodPlan(sections.map((s) => s._id), day) : new Map()
  const taken = (sectionId, period) => sheets.some((x) => String(x.sectionId) === String(sectionId) && x.period === period)
  // the teacher's own periods today (theirs in the timetable, and the ones they cover)
  const myPeriods = periodsOn && auth.userId ? (await teacherPeriods(auth.userId, day))
    .filter((p) => !allowed || allowed.includes(p.sectionId))
    .map((p) => ({ ...p, taken: taken(p.sectionId, p.period) })) : []
  return {
    date: day, today, mode: cfg.mode, dayFrom: cfg.dayFrom, markBefore: cfg.markBefore, workingDay: cfg.workingDays.includes(weekdayCode(day)),
    myPeriods,
    sections: sections.map((s) => {
      const c = classes.get(String(s.classId))
      const own = sheets.filter((x) => String(x.sectionId) === String(s._id))
      const daySheet = own.find((x) => x.period === 0)
      return {
        id: String(s._id), label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }), classOrder: c?.order ?? 999, sectionName: s.name,
        strength: strength.get(String(s._id)) ?? 0, mine: mine.has(String(s._id)),
        // every period: the day counts as taken once its first period is (the day sheet is built from them)
        taken: cfg.mode === 'PERIOD' ? own.length > 0 : !!daySheet, periodsTaken: own.filter((x) => x.period > 0).map((x) => x.period),
        periods: periodsOn ? (plan.get(String(s._id)) ?? []).map((p) => ({ period: p.period, start: p.start, end: p.end, subject: p.subject, teacher: p.teacher, taken: taken(s._id, p.period) })) : undefined,
        counts: daySheet?.counts ?? null, takenBy: daySheet?.takenBy ?? null, takenAt: daySheet?.takenAt ?? null, derived: !!daySheet?.derived,
      }
    }).sort((a, b) => Number(b.mine) - Number(a.mine) || a.classOrder - b.classOrder || a.sectionName.localeCompare(b.sectionName)),
  }
}

// ───────────────────────────────────────────────────────── one sheet

/** The roster for a section, date and period: saved marks, or a fresh sheet (approved leave pre-marked). */
export async function getSheet({ sectionId, date, period = 0 }, auth) {
  const { section, label, year } = await sectionFor(sectionId, auth)
  const cfg = await settings()
  const today = (await institutionNow()).date
  const day = date || today
  if (day < year.startDate || day > year.endDate) throw badRequest(`${day} is outside ${year.name}.`)
  const [sheet, students] = await Promise.all([
    AttendanceSheet.findOne({ sectionId: section._id, date: day, period }).lean(),
    Student.find({ sectionId: section._id, status: 'ACTIVE' }).collation({ locale: 'en', numericOrdering: true }).sort({ rollNo: 1, firstName: 1 }).select('firstName middleName lastName admissionNo rollNo gender').lean(),
  ])
  const leave = await onLeave(students.map((s) => s._id), day)
  const saved = new Map((sheet?.entries ?? []).map((e) => [String(e.studentId), e]))
  // gate devices (Integrations › Devices): the first time each student came in that day, shown beside their name
  const gate = new Map()
  try {
    const { DevicePunch } = await import('../models/integrations.js')
    const punches = await DevicePunch.find({ date: day, personType: 'STUDENT', personId: { $in: students.map((s) => s._id) }, direction: { $ne: 'OUT' }, test: { $ne: true } }).select('personId time').sort({ at: 1 }).lean()
    for (const p of punches) if (!gate.has(String(p.personId))) gate.set(String(p.personId), p.time)
  } catch { /* no devices */ }
  let rule = editRule(day, today, cfg, auth)
  const slot = period > 0 ? (await periodsOf(section._id, day)).find((p) => p.period === period) ?? null : null
  if (rule.canEdit && period > 0) { const why = periodBlock(cfg, auth, slot, section); if (why) rule = { canEdit: false, reason: why } }
  // every period: the day's sheet is worked out from the periods and isn't marked by hand
  if (rule.canEdit && period === 0 && !takesDaily(cfg.mode)) rule = { canEdit: false, reason: 'DERIVED' }
  return {
    section: { id: String(section._id), label }, date: day, period, today, mode: cfg.mode, slot, derived: !!sheet?.derived,
    workingDay: cfg.workingDays.includes(weekdayCode(day)), taken: !!sheet, takenBy: sheet?.takenBy ?? null, takenAt: sheet?.takenAt ?? null,
    updatedBy: sheet?.updatedBy ?? null, updatedAt: sheet?.updatedAt ?? null, subjectId: idStr(sheet?.subjectId), ...rule,
    students: students.map((s) => {
      const e = saved.get(String(s._id))
      return {
        id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, gender: s.gender ?? null,
        status: e?.status ?? (leave.has(String(s._id)) ? 'LV' : 'P'), note: e?.note ?? '', onLeave: leave.has(String(s._id)), saved: !!e,
        gateIn: gate.get(String(s._id)) ?? null,
      }
    }),
  }
}

/**
 * Save a sheet: every mark checked, counts kept, a line in the audit log. Students newly marked
 * absent on today's daily sheet raise `attendance.absent` (the family message, when switched on).
 */
export async function saveSheet({ sectionId, date, period = 0, subjectId: givenSubject, entries }, auth, req) {
  let subjectId = givenSubject
  const { section, label, short, year } = await sectionFor(sectionId, auth)
  if (year.closed) throw conflict(`${year.name} is closed.`)
  const cfg = await settings()
  const today = (await institutionNow()).date
  if (date < year.startDate || date > year.endDate) throw badRequest(`${date} is outside ${year.name}.`)
  if (!takesPeriods(cfg.mode) && period !== 0) throw badRequest('This institution takes attendance once a day.')
  if (!takesDaily(cfg.mode) && period === 0) throw badRequest('The day’s attendance is worked out from the periods — mark a period instead.')
  const slot = period > 0 ? (await periodsOf(section._id, date)).find((p) => p.period === period) ?? null : null
  if (period > 0 && !slot) throw badRequest(`There is no period ${period} in this class’s bell schedule.`)
  if (period > 0 && periodBlock(cfg, auth, slot, section)) throw forbidden(`Period ${period} of ${short} is ${slot.teacher ?? 'another teacher'}’s${slot.subject ? ` (${slot.subject})` : ''}.`)
  if (period > 0 && !subjectId && slot?.subjectId) subjectId = slot.subjectId
  const existing = await AttendanceSheet.findOne({ sectionId: section._id, date, period })
  const rule = editRule(date, today, cfg, auth)
  if (!rule.canEdit) {
    throw forbidden(rule.reason === 'FUTURE' ? 'Attendance can’t be marked for a future date.'
      : rule.reason === 'TOO_OLD' ? `Attendance older than ${cfg.editDays} day(s) can only be corrected by someone allowed to edit it.`
        : 'Your role can’t mark attendance.')
  }
  if (subjectId && !await Subject.exists({ _id: subjectId })) throw badRequest('Unknown subject.')
  const roster = await Student.find({ sectionId: section._id, status: 'ACTIVE' }).select('_id firstName middleName lastName').lean()
  const inSection = new Set(roster.map((s) => String(s._id)))
  const marks = []
  for (const e of entries) {
    if (!inSection.has(String(e.studentId))) throw badRequest('A student on the sheet is not in this section.')
    if (!MARK_BY[e.status]) throw badRequest(`Unknown mark “${e.status}”.`)
    marks.push({ studentId: e.studentId, status: e.status, note: e.note?.trim() || undefined })
  }
  const missing = roster.filter((s) => !marks.some((e) => String(e.studentId) === String(s._id)))
  if (missing.length) throw badRequest(`Mark every student: ${missing.slice(0, 3).map(studentName).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`)
  const before = new Map((existing?.entries ?? []).map((e) => [String(e.studentId), e.status]))
  const counts = countMarks(marks)
  const by = auth.user?.name
  let sheet
  if (existing) {
    Object.assign(existing, { entries: marks, counts, subjectId: subjectId || existing.subjectId, teacherId: existing.teacherId ?? slot?.teacherId ?? undefined, updatedBy: by, ...(period === 0 && { derived: false }) })
    sheet = await existing.save()
  } else {
    sheet = await AttendanceSheet.create({ academicYearId: year._id, sectionId: section._id, date, period, subjectId: subjectId || undefined, teacherId: slot?.teacherId ?? (period > 0 ? auth.userId : undefined), entries: marks, counts, takenById: auth.userId, takenBy: by, takenAt: new Date() })
  }
  const changed = existing ? marks.filter((e) => before.get(String(e.studentId)) !== e.status) : marks
  await audit({
    action: existing ? 'UPDATE' : 'CREATE', module: 'attendance', entityType: 'attendance_sheet', entityId: String(sheet._id),
    entityName: `${label} · ${date}${period ? ` · period ${period}` : ''}`,
    summary: existing
      ? `Corrected attendance of ${short} for ${date}: ${changed.length} change(s)`
      : `Marked attendance of ${short} for ${date}: ${counts.P + counts.L} present, ${counts.A} absent`,
  }, req)
  // every period: rebuild the day's sheet from the periods (the register, reports and the family alert read it)
  if (period > 0 && cfg.mode === 'PERIOD') await rebuildDay({ section, year, date, short, today, cfg, by })
  // the family hears once, the first time a child is marked absent today (not on corrections back to absent later in the week)
  if (cfg.absentAlert && period === 0 && date === today) {
    const nowAbsent = marks.filter((e) => e.status === 'A' && before.get(String(e.studentId)) !== 'A')
    for (const e of nowAbsent) {
      await emit('attendance.absent', { studentId: String(e.studentId), data: { student: { class: short }, attendance: { date: humanDate(date) } }, entity: { type: 'attendance_sheet', id: sheet._id } })
    }
  }
  return getSheet({ sectionId, date, period }, auth)
}

/**
 * The day sheet of a section worked out from its period sheets (mode "every period"), by the rule in settings: the
 * first period marked, or the share of periods attended. A student who becomes absent for the day today raises the
 * family alert once, like a daily sheet.
 */
async function rebuildDay({ section, year, date, short, today, cfg, by }) {
  const periods = await AttendanceSheet.find({ sectionId: section._id, date, period: { $gt: 0 } }).lean()
  const existing = await AttendanceSheet.findOne({ sectionId: section._id, date, period: 0 })
  const before = new Map((existing?.entries ?? []).map((e) => [String(e.studentId), e.status]))
  const entries = dayFromPeriods(periods, { rule: cfg.dayFrom, minPct: Number(cfg.dayMinPct) || 50 }).map((e) => ({ studentId: e.studentId, status: e.status }))
  const counts = countMarks(entries)
  if (existing) {
    Object.assign(existing, { entries, counts, derived: true, updatedBy: by })
    await existing.save()
  } else if (entries.length) {
    await AttendanceSheet.create({ academicYearId: year._id, sectionId: section._id, date, period: 0, derived: true, entries, counts, takenBy: by, takenAt: new Date() })
  }
  if (cfg.absentAlert && date === today) {
    for (const e of entries.filter((x) => x.status === 'A' && before.get(String(x.studentId)) !== 'A')) {
      await emit('attendance.absent', { studentId: String(e.studentId), data: { student: { class: short }, attendance: { date: humanDate(date) } }, entity: { type: 'attendance_sheet', id: existing?._id ?? section._id } })
    }
  }
}

// ───────────────────────────────────────────────────────── subject-wise (period sheets)

/**
 * Subject-wise attendance of one section between two dates, from its period sheets: for each subject the periods
 * held, and each student's attended / marked periods and %. Students under the minimum in any subject are flagged.
 */
export async function subjectReport({ from, to, sectionId }, auth) {
  if (from > to) throw badRequest('The start date is after the end date.')
  const cfg = await settings()
  const minimum = Number(cfg.minimumPct) || 0
  const { section, label } = await sectionFor(sectionId, auth)
  const [sheets, students] = await Promise.all([
    AttendanceSheet.find({ sectionId: section._id, date: { $gte: from, $lte: to }, period: { $gt: 0 } }).select('date period subjectId teacherId entries').lean(),
    Student.find({ sectionId: section._id, status: 'ACTIVE' }).collation({ locale: 'en', numericOrdering: true }).sort({ rollNo: 1, firstName: 1 }).select('firstName middleName lastName admissionNo rollNo').lean(),
  ])
  const subjectIds = [...new Set(sheets.map((s) => idStr(s.subjectId) ?? 'NONE'))]
  const names = new Map((await Subject.find({ _id: { $in: subjectIds.filter(isOid) } }).select('name code').lean()).map((x) => [String(x._id), x]))
  const subjects = subjectIds.map((id) => {
    const own = sheets.filter((s) => (idStr(s.subjectId) ?? 'NONE') === id)
    const all = countMarks(own.flatMap((s) => s.entries))
    return { id, name: id === 'NONE' ? null : names.get(id)?.name ?? '?', code: names.get(id)?.code ?? null, periods: own.length, pct: attendancePct(all) }
  }).sort((a, b) => (a.name ?? '~').localeCompare(b.name ?? '~'))
  const rows = students.map((st) => {
    const by = {}
    let below = 0
    for (const sub of subjects) {
      const marks = sheets.filter((s) => (idStr(s.subjectId) ?? 'NONE') === sub.id).map((s) => s.entries.find((e) => String(e.studentId) === String(st._id))).filter(Boolean)
      const c = countMarks(marks)
      const pct = attendancePct(c)
      if (pct != null && pct < minimum) below++
      by[sub.id] = { counts: c, pct }
    }
    const overall = attendancePct(countMarks(sheets.map((s) => s.entries.find((e) => String(e.studentId) === String(st._id))).filter(Boolean)))
    return { id: String(st._id), name: studentName(st), admissionNo: st.admissionNo, rollNo: st.rollNo ?? null, bySubject: by, pct: overall, belowSubjects: below }
  })
  return { from, to, minimumPct: minimum, mode: cfg.mode, section: { id: String(section._id), label }, periodsTaken: sheets.length, subjects, students: rows }
}

// ───────────────────────────────────────────────────────── register (a month)

/** One section, one month: students × days, with each student's totals and %. */
export async function monthRegister({ sectionId, month, subjectId }, auth) {
  const { section, label } = await sectionFor(sectionId, auth)
  const { from, to } = monthRange(month)
  const cfg = await settings()
  // by subject (period-wise attendance): that subject's periods, the first one of a day standing for the day
  const periodSheets = takesPeriods(cfg.mode) ? await AttendanceSheet.find({ sectionId: section._id, date: { $gte: from, $lte: to }, period: { $gt: 0 } }).select('date period subjectId entries counts').sort({ date: 1, period: 1 }).lean() : []
  const subjectIds = [...new Set(periodSheets.map((x) => idStr(x.subjectId)).filter(Boolean))]
  const subjects = (await Subject.find({ _id: { $in: subjectIds } }).select('name').sort({ name: 1 }).lean()).map((x) => ({ id: String(x._id), name: x.name }))
  const bySubject = subjectId ? periodSheets.filter((x) => idStr(x.subjectId) === String(subjectId)).filter((x, i, all) => all.findIndex((y) => y.date === x.date) === i) : null
  const [sheets, students] = await Promise.all([
    bySubject ?? AttendanceSheet.find({ sectionId: section._id, date: { $gte: from, $lte: to }, period: 0 }).lean(),
    Student.find({ $or: [{ sectionId: section._id }, { 'history.sectionId': section._id }] }).collation({ locale: 'en', numericOrdering: true }).sort({ rollNo: 1, firstName: 1 }).select('firstName middleName lastName admissionNo rollNo status sectionId').lean(),
  ])
  const days = daysBetween(from, to)
  const byDay = new Map(sheets.map((s) => [s.date, new Map(s.entries.map((e) => [String(e.studentId), e.status]))]))
  return {
    section: { id: String(section._id), label }, month, minimumPct: cfg.minimumPct, mode: cfg.mode, subjects, subjectId: subjectId ? String(subjectId) : null,
    days: days.map((d) => ({ date: d, taken: byDay.has(d), working: cfg.workingDays.includes(weekdayCode(d)), counts: sheets.find((s) => s.date === d)?.counts ?? null })),
    students: students.map((s) => {
      const marks = Object.fromEntries(days.map((d) => [d, byDay.get(d)?.get(String(s._id)) ?? null]))
      const c = countMarks(Object.values(marks).filter(Boolean).map((status) => ({ status })))
      return { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, current: String(s.sectionId) === String(section._id) && s.status === 'ACTIVE', marks, counts: c, pct: attendancePct(c) }
    }).filter((s) => s.current || s.counts.total > 0),
  }
}

// ───────────────────────────────────────────────────────── reports

/**
 * Attendance between two dates. Without a section: one row per section in scope (days taken,
 * average %, students below the minimum). With a section: one row per student.
 */
export async function attendanceReport({ from, to, sectionId }, auth) {
  if (from > to) throw badRequest('The start date is after the end date.')
  const cfg = await settings()
  const minimum = Number(cfg.minimumPct) || 0
  if (sectionId) {
    const { section, label } = await sectionFor(sectionId, auth)
    const sheets = await AttendanceSheet.find({ sectionId: section._id, date: { $gte: from, $lte: to }, period: 0 }).lean()
    const students = await Student.find({ sectionId: section._id, status: 'ACTIVE' }).collation({ locale: 'en', numericOrdering: true }).sort({ rollNo: 1, firstName: 1 }).select('firstName middleName lastName admissionNo rollNo').lean()
    const rows = students.map((s) => {
      const entries = sheets.map((sh) => sh.entries.find((e) => String(e.studentId) === String(s._id))).filter(Boolean)
      const c = countMarks(entries)
      const pct = attendancePct(c)
      return { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, counts: c, pct, below: pct != null && pct < minimum }
    })
    return { from, to, minimumPct: minimum, mode: cfg.mode, section: { id: String(section._id), label }, daysTaken: sheets.length, students: rows }
  }
  const year = await currentYear()
  const allowed = await sectionsInScope(auth, 'attendance')
  const sections = year ? await Section.find({ academicYearId: year._id, ...(allowed && { _id: { $in: allowed } }) }).lean() : []
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
  const sheets = await AttendanceSheet.find({ sectionId: { $in: sections.map((s) => s._id) }, date: { $gte: from, $lte: to }, period: 0 }).lean()
  const rows = sections.map((s) => {
    const own = sheets.filter((x) => String(x.sectionId) === String(s._id))
    const total = own.reduce((m, x) => ({ P: m.P + (x.counts?.P ?? 0), A: m.A + (x.counts?.A ?? 0), L: m.L + (x.counts?.L ?? 0), HD: m.HD + (x.counts?.HD ?? 0), LV: m.LV + (x.counts?.LV ?? 0), total: m.total + (x.counts?.total ?? 0) }), { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })
    // students under the minimum, from their own marks
    const per = new Map()
    for (const sh of own) for (const e of sh.entries) { const k = String(e.studentId); per.set(k, [...(per.get(k) ?? []), e]) }
    const below = [...per.values()].filter((list) => { const p = attendancePct(countMarks(list)); return p != null && p < minimum }).length
    const c = classes.get(String(s.classId))
    return { id: String(s._id), label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }), classOrder: c?.order ?? 999, sectionName: s.name, daysTaken: own.length, counts: total, pct: attendancePct(total), below }
  }).sort((a, b) => a.classOrder - b.classOrder || a.sectionName.localeCompare(b.sectionName))
  return { from, to, minimumPct: minimum, mode: cfg.mode, sections: rows }
}

// ───────────────────────────────────────────────────────── student leave

function leaveDto(l, names, places) {
  return { ...clean(l), studentId: String(l.studentId), studentName: names.get(String(l.studentId))?.name ?? null, admissionNo: names.get(String(l.studentId))?.admissionNo ?? null, classShort: places.get(idStr(l.sectionId)) ?? null }
}

async function decorate(rows) {
  const students = await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName middleName lastName admissionNo').lean()
  const names = new Map(students.map((s) => [String(s._id), { name: studentName(s), admissionNo: s.admissionNo }]))
  const sections = await Section.find({ _id: { $in: rows.map((r) => r.sectionId).filter(Boolean) } }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('code').lean()).map((c) => [String(c._id), c]))
  const places = new Map(sections.map((s) => [String(s._id), sectionLabel(classes.get(String(s.classId)), s, { short: true })]))
  return rows.map((r) => leaveDto(r, names, places))
}

/**
 * Student leave requests in the caller's sections, a page at a time (by status, latest first). `counts` is per status
 * over every request for the same section / search, whichever status is picked (the screen's tiles).
 */
export async function listLeave({ status, sectionId, search, page = 1, pageSize = 50 } = {}, auth) {
  const allowed = await sectionsInScope(auth, 'attendance')
  const wide = { ...(sectionId && { sectionId }) }
  if (allowed) wide.sectionId = sectionId ? (allowed.includes(String(sectionId)) ? sectionId : null) : { $in: allowed }
  const q = String(search ?? '').trim()
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i')
    wide.studentId = { $in: (await Student.find({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }).select('_id').lean()).map((s) => s._id) }
  }
  const filter = { ...wide, ...(status && { status }) }
  const statuses = Object.keys(LEAVE_STATUS)
  const [rows, total, ...tally] = await Promise.all([
    StudentLeave.find(filter).sort({ status: 1, from: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    StudentLeave.countDocuments(filter),
    ...statuses.map((s) => StudentLeave.countDocuments({ ...wide, status: s })),
  ])
  return { rows: await decorate(rows), total, page, pageSize, counts: Object.fromEntries(statuses.map((s, i) => [s, tally[i]])) }
}

export async function applyLeave({ studentId, from, to, reason }, auth, req) {
  if (from > to) throw badRequest('The leave ends before it starts.', { fields: { to: 'Before the start' } })
  const s = await Student.findById(studentId).lean()
  if (!s || s.status !== 'ACTIVE') throw notFound('Student')
  const allowed = await sectionsInScope(auth, 'attendance')
  if (allowed && !allowed.includes(String(s.sectionId))) throw notFound('Student')
  const overlap = await StudentLeave.findOne({ studentId: s._id, status: { $in: ['PENDING', 'APPROVED'] }, from: { $lte: to }, to: { $gte: from } }).lean()
  if (overlap) throw conflict(`${studentName(s)} already has leave from ${overlap.from} to ${overlap.to}.`)
  const leave = await StudentLeave.create({ studentId: s._id, sectionId: s.sectionId, from, to, reason, appliedBy: 'STAFF', appliedByName: auth.user?.name, appliedById: auth.userId })
  await audit({ action: 'CREATE', module: 'attendance', entityType: 'student_leave', entityId: String(leave._id), entityName: studentName(s), studentId: s._id, summary: `Leave for ${studentName(s)}, ${from} to ${to}` }, req)
  return (await decorate([leave.toObject()]))[0]
}

/** Approve or refuse. Approving marks the student "on leave" on sheets already taken in the range where they were absent. */
export async function decideLeave(id, { approve, note }, auth, req) {
  const leave = await StudentLeave.findById(id)
  if (!leave) throw notFound('Leave')
  if (leave.status !== 'PENDING') throw conflict('This leave has already been decided.')
  const allowed = await sectionsInScope(auth, 'attendance')
  if (allowed && !allowed.includes(String(leave.sectionId))) throw notFound('Leave')
  Object.assign(leave, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: auth.user?.name, decidedAt: new Date(), decisionNote: note || undefined })
  await leave.save()
  let excused = 0
  if (approve) {
    const sheets = await AttendanceSheet.find({ sectionId: leave.sectionId, date: { $gte: leave.from, $lte: leave.to }, entries: { $elemMatch: { studentId: leave.studentId, status: 'A' } } })
    for (const sh of sheets) {
      for (const e of sh.entries) if (String(e.studentId) === String(leave.studentId) && e.status === 'A') { e.status = 'LV'; excused++ }
      sh.counts = countMarks(sh.entries)
      sh.updatedBy = auth.user?.name
      await sh.save()
    }
  }
  const s = await Student.findById(leave.studentId).select('firstName middleName lastName').lean()
  await audit({ action: approve ? 'APPROVE' : 'REJECT', module: 'attendance', entityType: 'student_leave', entityId: String(leave._id), entityName: studentName(s), studentId: leave.studentId, summary: `${approve ? 'Approved' : 'Refused'} leave of ${studentName(s)}, ${leave.from} to ${leave.to}${excused ? ` (${excused} absence(s) marked as leave)` : ''}` }, req)
  return (await decorate([leave.toObject()]))[0]
}

export async function cancelLeave(id, auth, req) {
  const leave = await StudentLeave.findById(id)
  if (!leave) throw notFound('Leave')
  if (!['PENDING', 'APPROVED'].includes(leave.status)) throw conflict('This leave can’t be cancelled.')
  const allowed = await sectionsInScope(auth, 'attendance')
  if (allowed && !allowed.includes(String(leave.sectionId))) throw notFound('Leave')
  leave.status = 'CANCELLED'
  await leave.save()
  await audit({ action: 'CANCEL', module: 'attendance', entityType: 'student_leave', entityId: String(leave._id), entityName: String(leave.studentId), studentId: leave.studentId, summary: `Cancelled leave ${leave.from} to ${leave.to}` }, req)
  return (await decorate([leave.toObject()]))[0]
}
