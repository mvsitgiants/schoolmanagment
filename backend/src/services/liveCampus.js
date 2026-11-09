import { WEEK_DAYS, addDaysYmd, countMarks, attendancePct, sectionLabel, syllabusProgress, teachingPeriods, topicMonth, weekdayCode, yearPlan } from '@schoolgiant/shared'
import { ClassLevel, Subject, TeacherAllocation } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { PtmSession, SchoolEvent } from '../models/events.js'
import { Exam, ExamPaper } from '../models/exams.js'
import { FeeInvoice } from '../models/fees.js'
import { Complaint } from '../models/frontOffice.js'
import { HealthIncident } from '../models/health.js'
import { Homework, Syllabus, SyllabusDone } from '../models/homework.js'
import { Outpass } from '../models/hostel.js'
import { Employee, Holiday, Leave, StaffAttendance } from '../models/hrms.js'
import { DevicePunch } from '../models/integrations.js'
import { LibraryLoan } from '../models/library.js'
import { OnlineTest } from '../models/onlineTests.js'
import { Student, studentName } from '../models/students.js'
import { Branch, User } from '../models/tenant.js'
import { Room, Substitution, Timetable, TimetableEntry } from '../models/timetable.js'
import { scopeOf } from '../platform/access.js'
import { isOid, oid } from '../platform/db.js'
import { logger } from '../platform/logger.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { currentYear } from './academics.js'
import { waitingCount } from './approvals.js'
import { branchFilterFor, on, pendingFor, scopedSections } from './dashboard.js'
import { homeworkLookup } from './homework.js'
import { dayOffFor } from './hrmsCommon.js'
import { listBells, substitutionNeeds } from './timetable.js'

// Dashboard › Live campus: the school right now, class by class — the period each section is in, who is teaching it
// (and whether they came in), the substitute or "no teacher", today's attendance — then the teachers by presence, the
// syllabus against the year plan, what needs attention first, and the next seven days. `at` (HH:MM) looks at another
// time today (the period scrubber). Each block shows only when its module is on and the caller may see it; each is
// worked out on its own, so one failing leaves the rest of the page standing. Read-only.

const idStr = (v) => (v ? String(v) : null)
const toMin = (hhmm) => { const [h, m] = String(hhmm ?? '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const AWAY = ['ABSENT', 'ON_LEAVE']

/** A block that fails is logged and left out; the rest of the page still shows. */
async function safe(name, fn, fallback = null) {
  try {
    return await fn()
  } catch (err) {
    logger.warn({ err, block: name }, 'live campus block failed')
    return fallback
  }
}

// ───────────────────────────────────────────────────────── the day's frame

/** Where the day is at `time` on a bell: BEFORE · PERIOD · BREAK · AFTER · CLOSED, with the slot. */
function phaseOf(slots, time, schoolDay) {
  const slot = slots.find((sl) => sl.start <= time && time < sl.end) ?? null
  const phase = !schoolDay ? 'CLOSED' : !slots.length || time < slots[0].start ? 'BEFORE' : time >= slots.at(-1).end ? 'AFTER' : slot?.kind === 'PERIOD' && slot.no > 0 ? 'PERIOD' : 'BREAK'
  return { phase, slot: slot && { kind: slot.kind, no: slot.no, label: slot.label ?? null, start: slot.start, end: slot.end } }
}

const elapsed = (slot, time) => (slot ? Math.max(0, Math.min(100, Math.round(((toMin(time) - toMin(slot.start)) / Math.max(1, toMin(slot.end) - toMin(slot.start))) * 100))) : null)

async function dayContext(auth, { at, branchId, date }) {
  const clock = await institutionNow()
  // the day looked at: today, or another day close by (yesterday's picture, tomorrow's plan, the next school day)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Math.abs(Date.parse(date) - Date.parse(clock.date)) <= 31 * 864e5 ? date : clock.date
  const isToday = today === clock.date
  const [year, bells, core, attCfg, hrCfg, branches, holidays] = await Promise.all([
    currentYear(), listBells(), getSettings('core'), getSettings('attendance'), getSettings('hrms'),
    Branch.find().select('name code isDefault').sort({ isDefault: -1, name: 1 }).lean(), Holiday.find({ date: { $gte: addDaysYmd(today, -14), $lte: addDaysYmd(today, 14) } }).lean(),
  ])
  // a campus can be picked by someone who sees the whole institution
  const canPick = branches.length > 1 && (scopeOf(auth, 'attendance') === 'ALL' || !auth.user?.branchId)
  const picked = canPick && isOid(branchId) ? branches.find((b) => String(b._id) === String(branchId)) ?? null : null
  const inBranch = (doc) => !picked || String(doc ?? '') === String(picked._id) || (picked.isDefault && !doc)
  const def = bells.find((b) => b.isDefault) ?? bells[0]
  const bellOf = (classId) => bells.find((b) => (b.classIds ?? []).includes(String(classId))) ?? def
  const frame = def?.slots ?? []
  const valid = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x ?? '')
  // another day with no time picked opens at its first period
  const time = valid(at) ? at : isToday ? clock.time : frame.find((sl) => sl.kind === 'PERIOD' && sl.no > 0)?.start ?? '09:00'
  const workingDays = WEEK_DAYS.filter((d) => (core.workingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']).includes(d))
  const holidayOn = (d) => holidays.find((h) => h.date === d && !h.optional && h.forStudents !== false && (!h.branchIds?.length || !picked || h.branchIds.some((b) => String(b) === String(picked._id))))
  const isSchoolDay = (d) => workingDays.includes(weekdayCode(d)) && !holidayOn(d)
  const holiday = holidayOn(today)
  const workingDay = workingDays.includes(weekdayCode(today))
  const pub = year ? await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).lean() : null
  const inUse = !!pub && (!pub.effectiveFrom || today >= pub.effectiveFrom)
  const schoolDay = workingDay && !holiday
  const { phase, slot } = phaseOf(frame, time, schoolDay)
  const near = (step) => { for (let i = 1; i <= 14; i++) { const d = addDaysYmd(today, step * i); if (isSchoolDay(d)) return d } return null }
  // half the day, for half-day leave (first half: until the middle of the bell)
  const mid = frame.length ? Math.round((toMin(frame[0].start) + toMin(frame.at(-1).end)) / 2) : 12 * 60
  return {
    auth, clock, today, isToday, future: today > clock.date, time, live: isToday && (!valid(at) || at === clock.time), year, bellOf, def, frame, workingDays, holidays, holidayOn, holiday, workingDay, schoolDay, phase, slot,
    prevSchoolDay: near(-1), nextSchoolDay: near(1),
    pub, inUse, attCfg: { mode: 'DAILY', markBefore: '10:00', ...attCfg }, hrCfg, branches, canPick, picked, inBranch, mid,
  }
}

// ───────────────────────────────────────────────────────── teachers' presence

/**
 * Each teacher's state today (by their login id): PRESENT · LATE · ON_LEAVE · ABSENT · NOT_IN_YET · OFF · UNKNOWN (no
 * staff record). From the day's staff attendance, approved leave, the first biometric / phone punch, and their day off.
 */
async function presenceOf(ctx, userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))]
  const out = new Map(ids.map((id) => [id, { state: 'UNKNOWN' }]))
  if (!ids.length) return out
  const emps = await Employee.find({ userId: { $in: ids.map(oid) } }).select('name userId branchId weeklyOffDays joiningDate exit designation').lean()
  const empIds = emps.map((e) => e._id)
  const [att, leaves, punches] = await Promise.all([
    StaffAttendance.find({ date: ctx.today, employeeId: { $in: empIds } }).select('employeeId status inTime late leave').lean(),
    Leave.find({ status: 'APPROVED', 'dates.date': ctx.today, employeeId: { $in: empIds } }).select('employeeId leaveCode leaveName halfDay half dates').lean(),
    DevicePunch.find({ date: ctx.today, personType: 'STAFF', personId: { $in: empIds }, outcome: 'ATTENDANCE' }).select('personId time direction').sort({ at: 1 }).lean(),
  ])
  const attOf = new Map(att.map((a) => [String(a.employeeId), a]))
  const leaveOf = new Map(leaves.map((l) => [String(l.employeeId), l]))
  const firstIn = new Map()
  for (const p of punches) if (p.direction !== 'OUT' && !firstIn.has(String(p.personId))) firstIn.set(String(p.personId), p.time)
  const started = ctx.schoolDay && (!ctx.isToday || ctx.phase !== 'BEFORE')
  for (const e of emps) {
    const a = attOf.get(String(e._id))
    const l = leaveOf.get(String(e._id))
    const row = { employeeId: String(e._id), designation: e.designation ?? null, inTime: a?.inTime ?? firstIn.get(String(e._id)) ?? null }
    if (l || a?.status === 'LEAVE') {
      const portion = l?.dates?.find((d) => d.date === ctx.today)?.portion ?? a?.leave?.portion ?? 1
      row.state = 'ON_LEAVE'
      row.leave = { code: l?.leaveCode ?? a?.leave?.code ?? null, name: l?.leaveName ?? null, half: portion < 1 ? (l?.half || 'FIRST') : null }
    } else if (a) {
      row.state = ['PRESENT', 'ON_DUTY', 'HALF_DAY'].includes(a.status) ? (a.late ? 'LATE' : 'PRESENT') : a.status === 'ABSENT' ? 'ABSENT' : 'OFF'
      if (a.status === 'ON_DUTY') row.onDuty = true
      if (a.status === 'HALF_DAY') row.halfDay = true
    } else if (row.inTime) {
      row.state = ctx.hrCfg.lateAfter && row.inTime > ctx.hrCfg.lateAfter ? 'LATE' : 'PRESENT'
    } else if (!ctx.schoolDay || dayOffFor(e, ctx.today, { settings: ctx.hrCfg, holidays: ctx.holidays })) {
      row.state = 'OFF'
    } else if (ctx.future) {
      row.state = 'EXPECTED'
    } else {
      row.state = 'NOT_IN_YET'
      row.overdue = started // the day has begun and nothing shows them in
    }
    out.set(String(e.userId), row)
  }
  return out
}

/** Is a teacher away at a time? Absent all day, or on leave (a half day: only that half). */
function awayAt(ctx, p, hhmm) {
  if (!p) return false
  if (p.state === 'ABSENT') return true
  if (p.state !== 'ON_LEAVE') return false
  if (!p.leave?.half) return true
  return p.leave.half === 'FIRST' ? toMin(hhmm) < ctx.mid : toMin(hhmm) >= ctx.mid
}

// ───────────────────────────────────────────────────────── the class board

async function classBoard(ctx, sections, presenceOn) {
  const ids = sections.map((s) => s._id)
  const day = weekdayCode(ctx.today)
  const showDay = ctx.schoolDay && ctx.inUse
  const [classes, entries, subs, sheets, strength, homeRooms] = await Promise.all([
    ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean(),
    showDay ? TimetableEntry.find({ timetableId: ctx.pub._id, day, sectionId: { $in: ids } }).select('sectionId period subjectId teacherId roomId').lean() : [],
    Substitution.find({ date: ctx.today, sectionId: { $in: ids } }).select('sectionId period substituteId absentTeacherId subjectId').lean(),
    AttendanceSheet.find({ date: ctx.today, sectionId: { $in: ids } }).select('sectionId period counts entries.status').lean(),
    Student.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: ids } } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
    Room.find({ sectionId: { $in: ids }, active: true }).select('name code sectionId').lean(),
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const rooms = new Map((await Room.find({ _id: { $in: entries.map((e) => e.roomId).filter(Boolean) } }).select('name code').lean()).map((r) => [String(r._id), r]))
  const homeOf = new Map(homeRooms.map((r) => [String(r.sectionId), r]))
  const subjectIds = [...entries.map((e) => e.subjectId), ...subs.map((s) => s.subjectId)].filter(Boolean)
  const subjects = new Map((await Subject.find({ _id: { $in: subjectIds } }).select('name code').lean()).map((s) => [String(s._id), s]))
  const teacherIds = [...new Set([...entries.map((e) => idStr(e.teacherId)), ...subs.flatMap((s) => [idStr(s.substituteId), idStr(s.absentTeacherId)]), ...sections.map((s) => idStr(s.classTeacherId))].filter(Boolean))]
  const [users, presence] = await Promise.all([
    User.find({ _id: { $in: teacherIds } }).select('name designation').lean().then((x) => new Map(x.map((u) => [String(u._id), u]))),
    presenceOn ? presenceOf(ctx, teacherIds) : new Map(),
  ])
  const strengthOf = new Map(strength.map((x) => [String(x._id), x.n]))
  const person = (id) => (id ? { id: String(id), name: users.get(String(id))?.name ?? '', state: presenceOn ? presence.get(String(id))?.state ?? 'UNKNOWN' : null } : null)
  const periodMode = ['PERIOD', 'BOTH'].includes(ctx.attCfg.mode)
  const markDue = ctx.schoolDay && !ctx.future && (!ctx.isToday || ctx.time >= (ctx.attCfg.markBefore || '23:59'))

  const board = sections.map((s) => {
    const sid = String(s._id)
    const c = cls.get(String(s.classId))
    const bell = ctx.bellOf(s.classId)
    const slots = bell?.slots ?? []
    const home = homeOf.get(sid)
    const homeName = home ? home.code || home.name : s.room || null
    const mine = entries.filter((e) => String(e.sectionId) === sid)
    const { phase, slot } = phaseOf(slots, ctx.time, ctx.schoolDay)
    const periods = showDay ? teachingPeriods(slots) : []
    const rows = periods.map((no) => {
      const sl = slots.find((x) => x.kind === 'PERIOD' && x.no === no)
      const e = mine.find((x) => x.period === no)
      const sub = subs.find((x) => String(x.sectionId) === sid && x.period === no)
      const subject = subjects.get(idStr(e?.subjectId) ?? idStr(sub?.subjectId))
      const teacher = person(e?.teacherId)
      const p = teacher && presence.get(teacher.id)
      const r = e?.roomId ? rooms.get(String(e.roomId)) : null
      const state = !sl ? 'LATER' : ctx.time >= sl.end ? 'DONE' : ctx.time >= sl.start ? 'NOW' : 'LATER'
      return {
        period: no, start: sl?.start ?? null, end: sl?.end ?? null, state,
        subject: subject?.name ?? null, subjectCode: subject?.code ?? null, subjectId: idStr(subject?._id),
        teacher, substitute: sub ? person(sub.substituteId) : null,
        uncovered: !!e?.teacherId && !sub && presenceOn && awayAt(ctx, p, sl?.start ?? ctx.time),
        room: r ? r.code || r.name : homeName,
      }
    })
    const firstLater = rows.find((r) => r.state === 'LATER' && r.subject)
    if (firstLater) firstLater.state = 'NEXT'
    const current = phase === 'PERIOD' ? rows.find((r) => r.period === slot.no) ?? null : null
    const next = rows.find((r) => r.state === 'NEXT') ?? null

    const own = sheets.filter((x) => String(x.sectionId) === sid)
    const daySheet = own.find((x) => x.period === 0)
    const taken = ctx.attCfg.mode === 'PERIOD' ? own.length > 0 : !!daySheet
    const cnt = daySheet ? (daySheet.counts?.total ? daySheet.counts : countMarks(daySheet.entries)) : null
    const pSheet = periodMode && current ? own.find((x) => x.period === current.period) : null
    const pc = pSheet ? (pSheet.counts?.total ? pSheet.counts : countMarks(pSheet.entries)) : null
    return {
      id: sid, classId: String(s.classId), className: c?.name ?? '', classCode: c?.code ?? '', order: c?.order ?? 999, name: s.name,
      label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }), room: homeName,
      classTeacher: person(s.classTeacherId), strength: strengthOf.get(sid) ?? 0,
      phase, slot, elapsed: phase === 'PERIOD' || phase === 'BREAK' ? elapsed(slot, ctx.time) : null,
      current, next, day: rows,
      attendance: {
        marked: taken, present: cnt ? cnt.P + cnt.L + cnt.HD : null, absent: cnt?.A ?? null, late: cnt?.L ?? null, onLeave: cnt?.LV ?? null, total: cnt?.total ?? null,
        pct: cnt ? attendancePct(cnt) : null, overdue: !taken && markDue,
        period: current && periodMode ? { period: current.period, marked: !!pSheet, present: pc ? pc.P + pc.L + pc.HD : null, absent: pc?.A ?? null } : null,
      },
      uncovered: rows.filter((r) => r.uncovered && r.state !== 'DONE').length,
    }
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return { board, presence, users }
}

// ───────────────────────────────────────────────────────── teachers

async function teachersBlock(ctx, sections, board, presence, users) {
  const ids = sections.map((s) => s._id)
  const allocs = await TeacherAllocation.find({ academicYearId: ctx.year._id, sectionId: { $in: ids } }).select('teacherId').lean()
  const fromBoard = board.flatMap((s) => s.day.flatMap((r) => [r.teacher?.id, r.substitute?.id]))
  const userIds = [...new Set([...allocs.map((a) => idStr(a.teacherId)), ...sections.map((s) => idStr(s.classTeacherId)), ...fromBoard].filter(Boolean))]
  const missing = userIds.filter((id) => !presence.has(id) || !users.has(id))
  if (missing.length) {
    const [more, morePresence] = await Promise.all([User.find({ _id: { $in: missing } }).select('name designation').lean(), presenceOf(ctx, missing)])
    for (const u of more) users.set(String(u._id), u)
    for (const [k, v] of morePresence) if (!presence.has(k)) presence.set(k, v)
  }
  // who is away now and has periods nobody covers (the substitution desk's own list, with its best suggestion)
  const away = userIds.filter((id) => AWAY.includes(presence.get(id)?.state))
  const inScope = new Set(ids.map(String))
  const needs = away.length && ctx.schoolDay && ctx.inUse ? (await substitutionNeeds(ctx.today, away).catch(() => [])).filter((n) => inScope.has(n.sectionId)) : []
  const slotOf = new Map(board.flatMap((s) => s.day.map((r) => [`${s.id}|${r.period}`, r])))
  const uncovered = needs.filter((n) => !n.covered && awayAt(ctx, presence.get(n.absentTeacherId), slotOf.get(`${n.sectionId}|${n.period}`)?.start ?? ctx.time)).map((n) => {
    const r = slotOf.get(`${n.sectionId}|${n.period}`)
    return {
      sectionId: n.sectionId, section: n.section, period: n.period, start: r?.start ?? null, end: r?.end ?? null, done: r?.state === 'DONE',
      subject: n.subject, teacherId: n.absentTeacherId, teacher: n.absentTeacher, suggestion: n.suggestions[0] ? { id: n.suggestions[0].teacherId, name: n.suggestions[0].name } : null,
    }
  }).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))

  const teaching = new Map() // userId → what they are teaching now
  const todayCount = new Map()
  for (const s of board) {
    for (const r of s.day) {
      const who = r.substitute?.id ?? (r.uncovered ? null : r.teacher?.id)
      if (!who) continue
      todayCount.set(who, (todayCount.get(who) ?? { total: 0, left: 0 }))
      todayCount.get(who).total++
      if (r.state !== 'DONE') todayCount.get(who).left++
      if (r.state === 'NOW') teaching.set(who, { sectionId: s.id, section: s.short, classId: s.classId, subject: r.subject, period: r.period, substitute: !!r.substitute })
    }
  }
  const classTeacherOf = new Map(board.filter((s) => s.classTeacher).map((s) => [s.classTeacher.id, s.short]))
  const list = userIds.map((id) => {
    const p = presence.get(id) ?? { state: 'UNKNOWN' }
    const here = ['PRESENT', 'LATE'].includes(p.state)
    const c = todayCount.get(id) ?? { total: 0, left: 0 }
    return {
      id, name: users.get(id)?.name ?? '', designation: p.designation ?? users.get(id)?.designation ?? null,
      state: p.state, inTime: p.inTime ?? null, leave: p.leave ?? null, onDuty: !!p.onDuty, halfDay: !!p.halfDay, overdue: !!p.overdue,
      now: teaching.get(id) ?? null, free: ctx.phase === 'PERIOD' && here && !teaching.has(id), periodsToday: c.total, periodsLeft: c.left,
      classTeacherOf: classTeacherOf.get(id) ?? null,
      uncovered: uncovered.filter((u) => u.teacherId === id).map(({ teacherId, teacher, ...u }) => u), // eslint-disable-line no-unused-vars
    }
  }).filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name))
  const counts = { total: list.length, PRESENT: 0, LATE: 0, ON_LEAVE: 0, ABSENT: 0, NOT_IN_YET: 0, EXPECTED: 0, OFF: 0, UNKNOWN: 0 }
  for (const t of list) counts[t.state] = (counts[t.state] ?? 0) + 1
  return { counts, list, uncovered, freeNow: list.filter((t) => t.free).length }
}

// ───────────────────────────────────────────────────────── syllabus against the year plan

async function syllabusBlock(ctx, sectionIdSet) {
  const look = await homeworkLookup(ctx.auth)
  if (!look.year) return null
  const sections = look.sections.filter((s) => sectionIdSet.has(s.id))
  const month = ctx.today.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const monthShare = Number(ctx.today.slice(8)) / new Date(Date.UTC(y, m, 0)).getUTCDate()
  const [syllabi, done, allocs, classes] = await Promise.all([
    Syllabus.find({ academicYearId: look.year.id }).select('classId subjectId units').lean(),
    SyllabusDone.aggregate([
      { $match: { academicYearId: oid(look.year.id), sectionId: { $in: sections.map((s) => oid(s.id)) } } },
      { $group: { _id: { sectionId: '$sectionId', subjectId: '$subjectId' }, topics: { $addToSet: '$topicId' } } },
    ]),
    TeacherAllocation.find({ sectionId: { $in: sections.map((s) => s.id) } }).select('sectionId subjectId teacherId').lean(),
    ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name order').lean(),
  ])
  const doneOf = new Map(done.map((d) => [`${d._id.sectionId}:${d._id.subjectId}`, d.topics.map(String)]))
  const names = new Map((await User.find({ _id: { $in: allocs.map((a) => a.teacherId) } }).select('name').lean()).map((u) => [String(u._id), u.name]))
  const teacherOf = new Map(allocs.map((a) => [`${a.sectionId}:${a.subjectId}`, { id: String(a.teacherId), name: names.get(String(a.teacherId)) ?? '' }]))
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const rows = []
  for (const s of sections) {
    for (const sub of s.subjects) {
      const syl = syllabi.find((x) => String(x.classId) === s.classId && String(x.subjectId) === sub.id)
      const units = syl?.units ?? []
      const ticked = doneOf.get(`${s.id}:${sub.id}`) ?? []
      const progress = syllabusProgress(units, ticked)
      if (!progress.topics) continue
      const plan = yearPlan(units, ticked, month)
      // where the year plan says the section should be by today: every topic of an earlier month, and this month's share
      let expected = 0
      for (const u of units) for (const t of u.topics ?? []) { const tm = topicMonth(u, t); if (tm && tm < month) expected += 1; else if (tm === month) expected += monthShare }
      rows.push({
        sectionId: s.id, section: s.short, classId: s.classId, className: cls.get(s.classId)?.name ?? '', order: cls.get(s.classId)?.order ?? 999,
        subjectId: sub.id, subject: sub.name, teacher: teacherOf.get(`${s.id}:${sub.id}`) ?? null,
        topics: progress.topics, done: progress.done, pct: progress.pct, expectedPct: plan.planned ? Math.min(100, Math.round((expected / progress.topics) * 100)) : null,
        behind: plan.behind.length, due: plan.due.length,
      })
    }
  }
  rows.sort((a, b) => b.behind - a.behind || a.order - b.order || a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject))
  const avg = (k) => { const v = rows.filter((r) => r[k] != null); return v.length ? Math.round(v.reduce((n, r) => n + r[k], 0) / v.length) : null }
  return {
    month, rows, behindRows: rows.filter((r) => r.behind > 0).length, behindTopics: rows.reduce((n, r) => n + r.behind, 0),
    sectionsBehind: new Set(rows.filter((r) => r.behind > 0).map((r) => r.sectionId)).size, avgPct: avg('pct'), avgExpected: avg('expectedPct'),
  }
}

// ───────────────────────────────────────────────────────── what needs attention

/** Students absent on each of their section's last 3+ marked days, up to today. */
async function absentStreaks(ctx, sectionIds) {
  const sheets = await AttendanceSheet.find({ sectionId: { $in: sectionIds }, period: 0, date: { $gte: addDaysYmd(ctx.today, -14), $lte: ctx.today } })
    .select('sectionId date entries.studentId entries.status').sort({ date: -1 }).lean()
  const bySection = new Map()
  for (const s of sheets) { const k = String(s.sectionId); if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(s) }
  const streak = new Map()
  for (const list of bySection.values()) {
    const seen = new Set()
    for (const sheet of list) {
      for (const e of sheet.entries) {
        const k = String(e.studentId)
        if (seen.has(k)) continue
        if (e.status === 'A') streak.set(k, (streak.get(k) ?? 0) + 1)
        else seen.add(k)
      }
    }
  }
  const ids = [...streak].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])
  const students = await Student.find({ _id: { $in: ids.slice(0, 8).map(([id]) => id) }, status: 'ACTIVE' }).select('firstName middleName lastName').lean()
  const nameOf = new Map(students.map((s) => [String(s._id), studentName(s)]))
  return { count: ids.length, top: ids.slice(0, 8).filter(([id]) => nameOf.has(id)).map(([id, days]) => ({ id, name: nameOf.get(id), days })) }
}

async function prioritiesBlock(ctx, { board, teachers, syllabus, sectionIds, flags }) {
  const out = []
  const add = (key, severity, count, link, extra = {}) => { if (count) out.push({ key, severity, count, link, ...extra }) }
  const tasks = []
  if (teachers) {
    const left = teachers.uncovered.filter((u) => !u.done)
    add('uncovered', 'high', left.length, '/timetable/substitutions', { sections: [...new Set(left.map((u) => u.section))].slice(0, 6) })
    const absent = teachers.list.filter((t) => AWAY.includes(t.state))
    add('teachersAway', absent.length > 2 ? 'high' : 'medium', absent.length, '/hrms/attendance', { names: absent.slice(0, 5).map((t) => t.name) })
    const notIn = teachers.list.filter((t) => t.state === 'NOT_IN_YET' && t.overdue)
    add('notIn', 'medium', notIn.length, '/hrms/attendance', { names: notIn.slice(0, 5).map((t) => t.name) })
  }
  if (flags.attendance) {
    const overdue = board.filter((s) => s.attendance.overdue)
    add('unmarked', 'high', overdue.length, '/attendance/mark', { sections: overdue.slice(0, 8).map((s) => s.short), by: ctx.attCfg.markBefore })
    tasks.push(safe('streaks', async () => { const st = await absentStreaks(ctx, sectionIds); add('absentStreak', 'medium', st.count, '/attendance/reports', { names: st.top.map((x) => x.name) }) }))
  }
  if (syllabus) add('syllabus', 'medium', syllabus.behindRows, '/homework/syllabus', { topics: syllabus.behindTopics })
  tasks.push(safe('approvals', async () => {
    const list = await pendingFor(ctx.auth)
    if (on(ctx.auth, 'hrms', 'hrms.leave.approve')) { const n = await Leave.countDocuments({ status: 'PENDING', userId: { $ne: ctx.auth.userId } }); if (n) list.push({ key: 'staffLeave', count: n, link: '/hrms/leave' }) }
    const requests = await waitingCount(ctx.auth)
    if (requests) list.push({ key: 'requests', count: requests, link: '/approvals' })
    const total = list.reduce((n, x) => n + x.count, 0)
    add('approvals', 'medium', total, list.length === 1 ? list[0].link : '/approvals', { parts: list })
  }))
  if (on(ctx.auth, 'fees', 'fees.dues.view', 'fees.invoices.view')) {
    tasks.push(safe('fees', async () => {
      const f = await branchFilterFor(ctx.auth, 'fees')
      const pick = ctx.picked ? (ctx.picked.isDefault ? { branchId: { $in: [ctx.picked._id, null] } } : { branchId: ctx.picked._id }) : {}
      const [r] = await FeeInvoice.aggregate([
        { $match: { ...f, ...(Object.keys(f).length ? {} : pick), status: { $in: ['UNPAID', 'PARTIAL'] }, dueDate: { $lt: ctx.today } } },
        { $group: { _id: null, amount: { $sum: '$balance' }, students: { $addToSet: '$studentId' } } },
      ])
      add('feesOverdue', 'medium', r?.students.length ?? 0, '/fees/dues', { amount: r?.amount ?? 0 })
    }))
  }
  if (on(ctx.auth, 'library', 'library.circulation.view')) tasks.push(safe('library', async () => add('libraryOverdue', 'low', await LibraryLoan.countDocuments({ status: 'ISSUED', dueOn: { $lt: ctx.today } }), '/library/circulation')))
  if (on(ctx.auth, 'frontoffice', 'frontoffice.complaints.view')) tasks.push(safe('complaints', async () => add('complaints', 'low', await Complaint.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }), '/frontoffice/complaints')))
  if (on(ctx.auth, 'health', 'health.incidents.view')) tasks.push(safe('incidents', async () => add('incidents', 'medium', await HealthIncident.countDocuments({ status: 'OPEN' }), '/health/incidents')))
  if (on(ctx.auth, 'hostel', 'hostel.outpass.view')) tasks.push(safe('hostel', async () => add('hostelLate', 'high', await Outpass.countDocuments({ status: 'OUT', returnBy: { $lt: new Date() } }), '/hostel/outpass')))
  await Promise.all(tasks)
  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count)
}

// ───────────────────────────────────────────────────────── the next seven days

async function agendaBlock(ctx, { sections, uncoveredToday }) {
  const dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(ctx.today, i))
  const end = dates.at(-1)
  const days = new Map(dates.map((d) => {
    const h = ctx.holidayOn(d)
    return [d, { date: d, day: weekdayCode(d), working: ctx.workingDays.includes(weekdayCode(d)) && !h, items: [], cover: null, onLeave: 0 }]
  }))
  const push = (date, item) => days.get(date)?.items.push(item)
  const classIds = [...new Set(sections.map((s) => String(s.classId)))]
  const sectionIds = sections.map((s) => s._id)
  const mds = dates.map((d) => d.slice(5))
  const auth = ctx.auth
  const tasks = []

  for (const h of ctx.holidays) if (dates.includes(h.date) && (!h.branchIds?.length || !ctx.picked || h.branchIds.some((b) => String(b) === String(ctx.picked._id)))) push(h.date, { kind: 'HOLIDAY', title: h.name, sub: h.optional ? 'optional' : null, link: '/hrms/holidays' })

  if (on(auth, 'exams', 'exams.schedule.view')) {
    tasks.push(safe('exams', async () => {
      const papers = await ExamPaper.find({ date: { $gte: ctx.today, $lte: end }, classId: { $in: classIds } }).select('examId classId date').lean()
      const exams = new Map((await Exam.find({ _id: { $in: [...new Set(papers.map((p) => String(p.examId)))] }, status: { $ne: 'DRAFT' } }).select('name').lean()).map((e) => [String(e._id), e]))
      const group = new Map()
      for (const p of papers) {
        if (!exams.has(String(p.examId))) continue
        const k = `${p.date}|${p.examId}`
        if (!group.has(k)) group.set(k, { date: p.date, exam: exams.get(String(p.examId)), papers: 0, classes: new Set() })
        group.get(k).papers++
        group.get(k).classes.add(String(p.classId))
      }
      for (const g of group.values()) push(g.date, { kind: 'EXAM', title: g.exam.name, count: g.papers, classes: g.classes.size, link: '/exams/schedule' })
    }))
  }
  if (on(auth, 'events', 'events.calendar.view')) {
    tasks.push(safe('events', async () => {
      const rows = await SchoolEvent.find({ published: true, startDate: { $lte: end }, endDate: { $gte: ctx.today } }).select('title kind startDate endDate startTime branchIds').lean()
      for (const e of rows) {
        if (ctx.picked && e.branchIds?.length && !e.branchIds.some((b) => String(b) === String(ctx.picked._id))) continue
        for (const d of dates) if (d >= e.startDate && d <= e.endDate) push(d, { kind: 'EVENT', title: e.title, sub: e.startTime ?? null, eventKind: e.kind, link: '/events/calendar' })
      }
    }))
  }
  if (on(auth, 'events', 'events.ptm.view')) {
    tasks.push(safe('ptm', async () => {
      for (const p of await PtmSession.find({ date: { $gte: ctx.today, $lte: end }, status: { $ne: 'DRAFT' } }).select('title date startTime endTime').lean()) {
        push(p.date, { kind: 'PTM', title: p.title, sub: `${p.startTime}–${p.endTime}`, link: '/events/ptm' })
      }
    }))
  }
  if (on(auth, 'hrms', 'hrms.leave.view', 'hrms.attendance.view', 'hrms.employees.view')) {
    tasks.push(safe('leave', async () => {
      const leaves = await Leave.find({ status: 'APPROVED', 'dates.date': { $gte: ctx.today, $lte: end } }).select('employeeName userId dates half').lean()
      const subs = await Substitution.find({ date: { $gte: ctx.today, $lte: end }, sectionId: { $in: sectionIds } }).select('date sectionId period').lean()
      const covered = new Set(subs.map((s) => `${s.date}|${s.sectionId}|${s.period}`))
      const teacherIds = [...new Set(leaves.map((l) => idStr(l.userId)).filter(Boolean))]
      const entries = ctx.pub && teacherIds.length ? await TimetableEntry.find({ timetableId: ctx.pub._id, teacherId: { $in: teacherIds }, sectionId: { $in: sectionIds } }).select('teacherId day period sectionId').lean() : []
      for (const d of dates) {
        const away = leaves.filter((l) => l.dates.some((x) => x.date === d))
        if (!away.length) continue
        const day = days.get(d)
        day.onLeave = away.length
        push(d, { kind: 'LEAVE', title: away.slice(0, 4).map((l) => l.employeeName).join(', '), count: away.length, link: '/hrms/leave' })
        if (!day.working || d === ctx.today || !ctx.pub || (ctx.pub.effectiveFrom && d < ctx.pub.effectiveFrom)) continue
        const awayIds = new Set(away.map((l) => idStr(l.userId)).filter(Boolean))
        day.cover = entries.filter((e) => e.day === weekdayCode(d) && awayIds.has(String(e.teacherId)) && !covered.has(`${d}|${e.sectionId}|${e.period}`)).length
      }
    }))
  }
  const today = days.get(ctx.today)
  if (today && uncoveredToday != null) today.cover = uncoveredToday
  if (on(auth, 'fees', 'fees.dues.view', 'fees.invoices.view')) {
    tasks.push(safe('feesDue', async () => {
      const f = await branchFilterFor(auth, 'fees')
      const rows = await FeeInvoice.aggregate([
        { $match: { ...f, status: { $in: ['UNPAID', 'PARTIAL'] }, dueDate: { $gte: ctx.today, $lte: end } } },
        { $group: { _id: '$dueDate', n: { $sum: 1 }, amount: { $sum: '$balance' }, installments: { $addToSet: '$installment' } } },
      ])
      for (const r of rows) push(r._id, { kind: 'FEES', title: r.installments.slice(0, 2).join(', '), count: r.n, amount: r.amount, link: '/fees/dues' })
    }))
  }
  if (on(auth, 'homework', 'homework.homework.view')) {
    tasks.push(safe('homework', async () => {
      const rows = await Homework.aggregate([{ $match: { sectionId: { $in: sectionIds }, dueDate: { $gte: ctx.today, $lte: end } } }, { $group: { _id: '$dueDate', n: { $sum: 1 } } }])
      for (const r of rows) push(r._id, { kind: 'HOMEWORK', count: r.n, link: '/homework/homework' })
    }))
  }
  if (on(auth, 'online-tests', 'online-tests.tests.view')) {
    tasks.push(safe('tests', async () => {
      const rows = await OnlineTest.find({ status: 'PUBLISHED', 'opens.date': { $gte: ctx.today, $lte: end }, classId: { $in: classIds } }).select('title opens').lean()
      for (const r of rows) push(r.opens.date, { kind: 'TEST', title: r.title, sub: r.opens.time ?? null, link: '/online-tests/tests' })
    }))
  }
  if (on(auth, 'students', 'students.directory.view')) {
    tasks.push(safe('birthdays', async () => {
      const rows = await Student.aggregate([
        { $match: { status: 'ACTIVE', sectionId: { $in: sectionIds }, dob: { $type: 'string' } } },
        { $project: { md: { $substrCP: ['$dob', 5, 5] }, firstName: 1, lastName: 1 } },
        { $match: { md: { $in: mds } } },
      ])
      for (const d of dates) {
        const list = rows.filter((r) => r.md === d.slice(5))
        if (list.length) push(d, { kind: 'BIRTHDAY', title: list.slice(0, 3).map((r) => [r.firstName, r.lastName].filter(Boolean).join(' ')).join(', '), count: list.length, link: '/students/directory' })
      }
    }))
  }
  if (on(auth, 'hrms', 'hrms.employees.view')) {
    tasks.push(safe('staffBirthdays', async () => {
      const rows = await Employee.aggregate([
        { $match: { status: { $in: ['ACTIVE', 'NOTICE'] }, dob: { $type: 'string' }, ...(ctx.picked && { branchId: ctx.picked._id }) } },
        { $project: { md: { $substrCP: ['$dob', 5, 5] }, name: 1 } },
        { $match: { md: { $in: mds } } },
      ])
      for (const d of dates) {
        const list = rows.filter((r) => r.md === d.slice(5))
        if (list.length) push(d, { kind: 'STAFF_BIRTHDAY', title: list.slice(0, 3).map((r) => r.name).join(', '), count: list.length, link: '/hrms/employees' })
      }
    }))
  }
  await Promise.all(tasks)
  const ORDER = ['HOLIDAY', 'EXAM', 'PTM', 'EVENT', 'TEST', 'FEES', 'LEAVE', 'HOMEWORK', 'BIRTHDAY', 'STAFF_BIRTHDAY']
  return dates.map((d) => { const day = days.get(d); day.items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)); return day })
}

// ───────────────────────────────────────────────────────── the page

export async function liveCampus(auth, { at, branchId, date } = {}) {
  const ctx = await dayContext(auth, { at, branchId, date })
  const out = {
    now: { date: ctx.today, today: ctx.clock.date, isToday: ctx.isToday, time: ctx.time, clock: ctx.clock.time, live: ctx.live, prevSchoolDay: ctx.prevSchoolDay, nextSchoolDay: ctx.nextSchoolDay, day: weekdayCode(ctx.today), schoolDay: ctx.schoolDay, workingDay: ctx.workingDay, holiday: ctx.holiday?.name ?? null, phase: ctx.phase, slot: ctx.slot, elapsed: elapsed(ctx.slot, ctx.time) },
    year: ctx.year ? { id: String(ctx.year._id), name: ctx.year.name } : null,
    branches: ctx.canPick ? ctx.branches.map((b) => ({ id: String(b._id), name: b.name, code: b.code })) : [], branchId: ctx.picked ? String(ctx.picked._id) : null,
    frame: ctx.frame, published: !!ctx.pub, inUse: ctx.inUse, attendanceMode: ctx.attCfg.mode, markBefore: ctx.attCfg.markBefore || null,
    sections: [], teachers: null, syllabus: null, priorities: [], agenda: [], summary: {},
  }
  if (!ctx.year) return out
  const flags = {
    board: on(auth, 'timetable', 'timetable.timetable.view') || on(auth, 'attendance', 'attendance.mark.view', 'attendance.reports.view'),
    attendance: on(auth, 'attendance', 'attendance.mark.view', 'attendance.reports.view'),
    presence: on(auth, 'hrms', 'hrms.attendance.view', 'hrms.employees.view'),
    syllabus: on(auth, 'homework', 'homework.syllabus.view'),
  }
  const sections = (await scopedSections(auth, 'attendance', ctx.year)).filter((s) => ctx.inBranch(s.branchId))
  const sectionIds = sections.map((s) => s._id)

  const board = flags.board ? await safe('board', () => classBoard(ctx, sections, flags.presence)) : null
  const [teachers, syllabus] = await Promise.all([
    board && flags.presence ? safe('teachers', () => teachersBlock(ctx, sections, board.board, board.presence, board.users)) : null,
    flags.syllabus ? safe('syllabus', () => syllabusBlock(ctx, new Set(sectionIds.map(String)))) : null,
  ])
  // what the board shows of a section's attendance follows the attendance permission
  out.sections = (board?.board ?? []).map((s) => (flags.attendance ? s : { ...s, attendance: null }))
  out.teachers = teachers
  out.syllabus = syllabus
  const [priorities, agenda] = await Promise.all([
    safe('priorities', () => prioritiesBlock(ctx, { board: out.sections, teachers, syllabus, sectionIds, flags }), []),
    safe('agenda', () => agendaBlock(ctx, { sections, uncoveredToday: teachers ? teachers.uncovered.filter((u) => !u.done).length : null }), []),
  ])
  out.priorities = priorities
  out.agenda = agenda

  const marked = out.sections.filter((s) => s.attendance?.marked)
  const present = marked.reduce((n, s) => n + (s.attendance.present ?? 0), 0)
  const counted = marked.reduce((n, s) => n + (s.attendance.total ?? 0), 0)
  out.summary = {
    sections: out.sections.length,
    running: out.sections.filter((s) => s.current?.subject).length,
    inPeriod: out.sections.filter((s) => s.phase === 'PERIOD').length,
    uncovered: teachers ? teachers.uncovered.filter((u) => !u.done).length : null,
    teachersIn: teachers ? teachers.counts.PRESENT + teachers.counts.LATE : null,
    teachersExpected: teachers ? teachers.counts.total - teachers.counts.OFF : null,
    attendance: flags.attendance ? { marked: marked.length, sections: out.sections.length, present, counted, pct: counted ? Math.round((present / counted) * 1000) / 10 : null } : null,
    syllabusBehind: syllabus ? syllabus.behindRows : null,
    approvals: priorities.find((p) => p.key === 'approvals')?.count ?? 0,
  }
  return out
}
