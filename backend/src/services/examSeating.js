import {
  SEAT_MIX, SEAT_PLAN_DEFAULTS, SEAT_PLAN_STATUS, assignInvigilators, examRoomSeats, examSessions, invigilatorsFor, planExamSeats,
  seatClashes, seatingRuns, sectionLabel, suggestExamRooms,
} from '@schoolgiant/shared'
import mongoose from 'mongoose'
import { ClassLevel, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { Exam, ExamPaper } from '../models/exams.js'
import { ExamSeatPlan } from '../models/examSeating.js'
import { Student, studentName } from '../models/students.js'
import { Tenant } from '../models/platform.js'
import { User } from '../models/tenant.js'
import { Room } from '../models/timetable.js'
import { moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { getContext } from '../platform/context.js'
import { institutionNow } from '../platform/time.js'
import { teachers as timetableTeachers } from './timetable.js'

// Exam seating & invigilation (Exams › Seating & invigilation). For each session of an exam (the papers written at
// the same date and time) a plan puts every student of those classes on a seat — classes mixed so that no two
// neighbours are from the same class — in the rooms picked (or suggested), and gives each room its invigilators:
// never a teacher of a subject written in that room, never someone on leave, fewest duties first. Everything the
// generator does is a suggestion: seats can be swapped or moved by hand (and stay put when it runs again), rooms
// and invigilators changed, then the plan is published for the notice board, the seating charts and the duty chart.

const idStr = (v) => (v ? String(v) : null)
const AUDIT = (plan, summary, extra = {}) => ({ action: 'UPDATE', module: 'exams', entityType: 'exam_seat_plan', entityId: String(plan._id), entityName: `${plan.date} ${plan.startTime}`, summary, ...extra })
const byRoll = { locale: 'en', numericOrdering: true }
const sessionKey = (date, startTime) => `${date}|${startTime}`

async function examById(id) {
  const e = isOid(id) ? await Exam.findById(id).lean() : null
  if (!e) throw notFound('Exam')
  return e
}

/** The exam's sessions (papers grouped by date and start time) and the classes and subjects in each. */
async function sessionsOf(exam) {
  const papers = await ExamPaper.find({ examId: exam._id }).lean()
  return examSessions(papers.map((p) => ({ ...p, id: String(p._id), classId: String(p.classId), subjectId: String(p.subjectId) })))
}

async function sessionOf(exam, date, startTime) {
  const s = (await sessionsOf(exam)).find((x) => x.key === sessionKey(date, startTime))
  if (!s) throw notFound('Exam session')
  return s
}

/** Every room that can be used (active), with the layout of its home section when that has one. */
async function roomPool() {
  const rooms = await Room.find({ active: { $ne: false } }).sort({ kind: 1, code: 1, name: 1 }).collation(byRoll).lean()
  const homes = await Section.find({ _id: { $in: rooms.map((r) => r.sectionId).filter(Boolean) } }).select('seating capacity').lean()
  const home = new Map(homes.map((s) => [String(s._id), s]))
  return rooms.map((r) => {
    const h = home.get(idStr(r.sectionId))
    return { id: String(r._id), name: r.name, code: r.code ?? null, kind: r.kind, capacity: r.capacity ?? h?.capacity ?? null, homeLayout: h?.seating ?? null }
  })
}

/** A room as the seating engine wants it: the plan's own layout, else its home section's, else its capacity. */
const engineRoom = (r) => ({ id: String(r.roomId ?? r.id), kind: r.kind, layout: r.layout ?? r.homeLayout ?? undefined, capacity: r.capacity })

/** The students writing in a session, per class, in fill order, with what the screens print about them. */
async function sessionStudents(exam, session, fill = 'ROLL') {
  const classIds = [...new Set(session.papers.map((p) => p.classId))]
  const [classes, sections] = await Promise.all([
    ClassLevel.find({ _id: { $in: classIds } }).select('name code order').lean(),
    Section.find({ academicYearId: exam.academicYearId, classId: { $in: classIds } }).select('classId name').lean(),
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const sec = new Map(sections.map((s) => [String(s._id), s]))
  const rows = await Student.find({ status: 'ACTIVE', sectionId: { $in: sections.map((s) => s._id) } })
    .select('firstName middleName lastName rollNo admissionNo gender sectionId classId').collation(byRoll).sort({ placeKey: 1, rollNo: 1, firstName: 1 }).lean()
  const info = new Map()
  for (const s of rows) {
    const section = sec.get(String(s.sectionId))
    const c = cls.get(String(s.classId))
    info.set(String(s._id), {
      id: String(s._id), name: studentName(s), rollNo: s.rollNo ?? null, admissionNo: s.admissionNo, gender: s.gender ?? null,
      classId: String(s.classId), sectionId: String(s.sectionId), section: sectionLabel(c, section, { short: true }), className: c?.name ?? '',
    })
  }
  const order = (c) => cls.get(c)?.order ?? 0
  const groups = classIds.sort((a, b) => order(a) - order(b)).map((classId) => {
    const list = [...info.values()].filter((x) => x.classId === classId)
    if (fill === 'NAME') list.sort((a, b) => a.name.localeCompare(b.name))
    return { key: classId, name: cls.get(classId)?.name ?? '', code: cls.get(classId)?.code ?? '', students: list }
  })
  return { groups, info }
}

/** Teachers who may invigilate, with their duties so far in this exam (other sessions). */
async function teacherPool(exam, exceptPlanId) {
  const list = await timetableTeachers(String(exam.academicYearId))
  const plans = await ExamSeatPlan.find({ examId: exam._id, ...(exceptPlanId && { _id: { $ne: exceptPlanId } }) }).select('rooms.invigilatorIds date startTime').lean()
  const duties = new Map()
  for (const p of plans) for (const r of p.rooms) for (const id of r.invigilatorIds) duties.set(String(id), (duties.get(String(id)) ?? 0) + 1)
  return list.map((t) => ({ ...t, duties: duties.get(t.id) ?? 0 }))
}

/** Per room: the teachers of the subjects written there (they don't invigilate their own paper). */
async function avoidByRoom(plan, session, info) {
  const subjectOf = new Map(session.papers.map((p) => [p.classId, p.subjectId]))
  const pairs = new Map() // roomId → Set of `${sectionId}|${subjectId}`
  for (const s of plan.seats) {
    const st = info.get(String(s.studentId))
    const subj = st && subjectOf.get(st.classId)
    if (!subj) continue
    const k = String(s.roomId)
    if (!pairs.has(k)) pairs.set(k, new Set())
    pairs.get(k).add(`${st.sectionId}|${subj}`)
  }
  const all = [...pairs.values()].flatMap((x) => [...x])
  const allocs = all.length ? await TeacherAllocation.find({ $or: all.map((x) => { const [sectionId, subjectId] = x.split('|'); return { sectionId, subjectId } }) }).select('sectionId subjectId teacherId').lean() : []
  const out = {}
  for (const [roomId, set] of pairs) out[roomId] = allocs.filter((a) => set.has(`${a.sectionId}|${a.subjectId}`)).map((a) => String(a.teacherId))
  return out
}

async function awayOn(date, auth) {
  if (auth && !moduleEnabled(auth, 'hrms')) return []
  try {
    const { onLeaveOn } = await import('./hrmsLeave.js')
    return (await onLeaveOn(date)).filter((x) => x.userId).map((x) => x.userId)
  } catch { return [] }
}

// ───────────────────────────────────────────────────────── reading

/** The exam's sessions with how far each plan has got. */
export async function listSessions(examId) {
  const exam = await examById(examId)
  const [sessions, plans] = await Promise.all([sessionsOf(exam), ExamSeatPlan.find({ examId: exam._id }).lean()])
  const classIds = [...new Set(sessions.flatMap((s) => s.papers.map((p) => p.classId)))]
  const [classes, subjects, counts] = await Promise.all([
    ClassLevel.find({ _id: { $in: classIds } }).select('name code order').lean(),
    Subject.find({ _id: { $in: [...new Set(sessions.flatMap((s) => s.papers.map((p) => p.subjectId)))] } }).select('name code').lean(),
    Student.aggregate([{ $match: { status: 'ACTIVE', classId: { $in: classIds.map((x) => new mongoose.Types.ObjectId(x)) } } }, { $group: { _id: '$classId', n: { $sum: 1 } } }]),
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const subj = new Map(subjects.map((s) => [String(s._id), s]))
  const n = new Map(counts.map((c) => [String(c._id), c.n]))
  const planOf = new Map(plans.map((p) => [sessionKey(p.date, p.startTime), p]))
  return {
    exam: { id: String(exam._id), name: exam.name, status: exam.status },
    sessions: sessions.map((s) => {
      const p = planOf.get(s.key)
      const ids = [...new Set(s.papers.map((x) => x.classId))].sort((a, b) => (cls.get(a)?.order ?? 0) - (cls.get(b)?.order ?? 0))
      const students = ids.reduce((t, id) => t + (n.get(id) ?? 0), 0)
      return {
        key: s.key, date: s.date, startTime: s.startTime, endTime: s.endTime, students,
        papers: s.papers.map((x) => ({ classId: x.classId, className: cls.get(x.classId)?.name ?? '', subject: subj.get(x.subjectId)?.name ?? '' }))
          .sort((a, b) => (cls.get(a.classId)?.order ?? 0) - (cls.get(b.classId)?.order ?? 0)),
        plan: p ? {
          id: String(p._id), status: p.status, statusLabel: SEAT_PLAN_STATUS[p.status]?.label, rooms: p.rooms.length, seated: p.seats.length, unseated: p.unseated.length,
          invigilators: p.rooms.reduce((t, r) => t + r.invigilatorIds.length, 0),
        } : null,
      }
    }),
  }
}

/** One session in full: the plan (or nothing yet), the rooms to choose from, the students, the teachers and the checks. */
export async function getSession(examId, { date, startTime }, auth) {
  const exam = await examById(examId)
  const session = await sessionOf(exam, date, startTime)
  const plan = await ExamSeatPlan.findOne({ examId: exam._id, date, startTime }).lean()
  return sessionView(exam, session, plan, auth)
}

async function sessionView(exam, session, plan, auth) {
  const rules = { ...SEAT_PLAN_DEFAULTS, ...(plan?.rules ?? {}) }
  const [{ groups, info }, rooms, teachers, away] = await Promise.all([sessionStudents(exam, session, rules.fill), roomPool(), teacherPool(exam, plan?._id), awayOn(session.date, auth)])
  const needed = groups.reduce((n, g) => n + g.students.length, 0)
  const roomRows = rooms.map((r) => ({ ...r, examSeats: examRoomSeats(engineRoom(r), { gap: rules.gap }).seats.length }))
  const suggestion = suggestExamRooms(rooms.map(engineRoom), needed, { gap: rules.gap })
  const subjectOf = new Map(session.papers.map((p) => [p.classId, p.subjectId]))
  const subjects = new Map((await Subject.find({ _id: { $in: [...subjectOf.values()] } }).select('name').lean()).map((s) => [String(s._id), s.name]))
  const base = {
    exam: { id: String(exam._id), name: exam.name },
    session: { key: session.key, date: session.date, startTime: session.startTime, endTime: session.endTime },
    classes: groups.map((g) => ({ id: g.key, name: g.name, code: g.code, students: g.students.length, subject: subjects.get(subjectOf.get(g.key)) ?? '' })),
    needed, rules, rooms: roomRows, suggestion,
    teachers: teachers.map((t) => ({ ...t, away: away.includes(t.id) })),
  }
  if (!plan) return { ...base, plan: null }
  const byRoom = new Map(plan.rooms.map((r) => [String(r.roomId), r]))
  const seats = plan.seats.map((s) => ({ ...s, roomId: String(s.roomId), studentId: String(s.studentId), classId: idStr(s.classId) }))
  const clashes = seatClashes(seats.map((s) => ({ ...s, group: s.classId })), { mix: plan.rules?.mix })
  const avoid = await avoidByRoom(plan, session, info)
  const runs = seatingRuns(seats, info)
  return {
    ...base,
    plan: {
      id: String(plan._id), status: plan.status, statusLabel: SEAT_PLAN_STATUS[plan.status]?.label, generatedAt: plan.generatedAt, generatedBy: plan.generatedBy,
      publishedAt: plan.publishedAt, publishedBy: plan.publishedBy, updatedAt: plan.updatedAt,
      rooms: plan.rooms.map((r) => {
        const er = engineRoom({ ...r, homeLayout: roomRows.find((x) => x.id === String(r.roomId))?.homeLayout })
        const { plan: drawn, seats: usable } = examRoomSeats(er, { gap: rules.gap })
        const here = seats.filter((s) => s.roomId === String(r.roomId))
        return {
          roomId: String(r.roomId), name: r.name, code: r.code, kind: r.kind, capacity: r.capacity, layout: r.layout ?? null,
          drawn: { kind: drawn.kind, perBench: drawn.perBench, columns: drawn.columns, rows: drawn.rowCount, grid: drawn.rows.map((row) => row.map((bench) => bench.map((x) => x.label))) },
          usable: usable.map((x) => x.label), students: here.length,
          invigilatorIds: r.invigilatorIds.map(String), invigilatorsByHand: !!r.invigilatorsByHand,
          wanted: invigilatorsFor(here.length, rules), avoid: avoid[String(r.roomId)] ?? [],
          runs: runs.find((x) => x.roomId === String(r.roomId))?.runs ?? [],
        }
      }),
      seats: seats.map((s) => ({ roomId: s.roomId, seat: s.seat, studentId: s.studentId, classId: s.classId, locked: !!s.locked, ...pick(info.get(s.studentId)) })),
      unseated: plan.unseated.map((id) => pick(info.get(String(id)))).filter(Boolean),
      clashes,
      awayAssigned: plan.rooms.flatMap((r) => r.invigilatorIds.map(String).filter((id) => away.includes(id)).map((id) => ({ roomId: String(r.roomId), teacherId: id }))),
      ownSubject: plan.rooms.flatMap((r) => r.invigilatorIds.map(String).filter((id) => (avoid[String(r.roomId)] ?? []).includes(id)).map((id) => ({ roomId: String(r.roomId), teacherId: id }))),
      newStudents: [...info.keys()].filter((id) => !seats.some((s) => s.studentId === id) && !plan.unseated.some((u) => String(u) === id)).length,
    },
  }
}
const pick = (st) => st && ({ id: st.id, name: st.name, rollNo: st.rollNo, admissionNo: st.admissionNo, gender: st.gender, section: st.section, sectionId: st.sectionId })

// ───────────────────────────────────────────────────────── generating

/**
 * Make (or remake) a session's plan: seat everyone in the rooms given (or the suggested ones) with the rules, keeping
 * seats placed by hand, then give each room its invigilators (keeping the ones chosen by hand).
 */
export async function generateSession(examId, input, auth, req) {
  const exam = await examById(examId)
  const session = await sessionOf(exam, input.date, input.startTime)
  const existing = await ExamSeatPlan.findOne({ examId: exam._id, date: session.date, startTime: session.startTime })
  if (existing?.status === 'PUBLISHED') throw conflict('This session’s seating is published — take it back to draft to change it.')
  const was = existing ? existing.toObject() : null
  const rules = { ...SEAT_PLAN_DEFAULTS, ...(was?.rules ?? {}), ...(input.rules ?? {}) }
  if (!SEAT_MIX[rules.mix]) throw badRequest('Pick how to mix the classes.')
  const pool = await roomPool()
  const { groups, info } = await sessionStudents(exam, session, rules.fill)
  const needed = groups.reduce((n, g) => n + g.students.length, 0)
  const overrides = new Map((input.rooms ?? []).map((r) => [String(r.roomId), r]))
  let ids = (input.roomIds?.length ? input.roomIds.map(String) : was?.rooms?.map((r) => String(r.roomId))) ?? []
  if (!ids.length) ids = suggestExamRooms(pool.map(engineRoom), needed, { gap: rules.gap }).ids
  const rooms = ids.map((id) => pool.find((r) => r.id === String(id))).filter(Boolean)
  if (!rooms.length) throw badRequest('Add rooms first (Timetable › Rooms), then pick the ones for this exam.')
  const before = new Map((was?.rooms ?? []).map((r) => [String(r.roomId), r]))
  const planRooms = rooms.map((r) => {
    const o = overrides.get(r.id)
    const old = before.get(r.id)
    return {
      roomId: r.id, name: r.name, code: r.code, kind: r.kind, capacity: r.capacity,
      layout: o && 'layout' in o ? (o.layout ?? undefined) : old?.layout ?? undefined,
      invigilatorIds: old?.invigilatorsByHand ? old.invigilatorIds : [], invigilatorsByHand: !!old?.invigilatorsByHand,
    }
  })
  // seats placed by hand stay — as long as the room is still used and the student still writes this session
  const keepLocked = input.keepLocked !== false
  const locked = keepLocked ? (was?.seats ?? []).filter((s) => s.locked && ids.includes(String(s.roomId)) && info.has(String(s.studentId)))
    .map((s) => ({ roomId: String(s.roomId), seat: s.seat, studentId: String(s.studentId) })) : []
  const engineRooms = planRooms.map((r) => engineRoom({ ...r, homeLayout: pool.find((p) => p.id === String(r.roomId))?.homeLayout }))
  const result = planExamSeats({ rooms: engineRooms, groups: groups.map((g) => ({ key: g.key, students: g.students })), rules, locked })
  const lockedSet = new Set(locked.map((l) => `${l.roomId}|${l.seat}`))
  const plan = existing ?? new ExamSeatPlan({ examId: exam._id, date: session.date, startTime: session.startTime })
  Object.assign(plan, {
    endTime: session.endTime, classIds: groups.map((g) => g.key), rules, rooms: planRooms,
    seats: result.seats.map((s) => ({ ...s, classId: info.get(s.studentId)?.classId, locked: lockedSet.has(`${s.roomId}|${s.seat}`) })),
    unseated: result.unseated, generatedAt: new Date(), generatedBy: auth?.user?.name ?? 'System', updatedBy: auth?.user?.name,
  })
  await fillInvigilators(exam, session, plan, info, auth)
  await plan.save()
  await audit(AUDIT(plan, `Seated ${plan.seats.length} students for ${exam.name} on ${session.date} ${session.startTime} in ${planRooms.length} rooms`, { action: existing ? 'UPDATE' : 'CREATE' }), req)
  return sessionView(exam, session, plan.toObject(), auth)
}

/** Every session of the exam at once, with the same rooms and rules (sessions already published are left alone). */
export async function generateAll(examId, input, auth, req) {
  const exam = await examById(examId)
  const sessions = await sessionsOf(exam)
  const done = []
  for (const s of sessions) {
    const p = await ExamSeatPlan.findOne({ examId: exam._id, date: s.date, startTime: s.startTime }).select('status').lean()
    if (p?.status === 'PUBLISHED') { done.push({ key: s.key, skipped: 'published' }); continue }
    const v = await generateSession(examId, { ...input, date: s.date, startTime: s.startTime }, auth, req)
    done.push({ key: s.key, seated: v.plan.seats.length, unseated: v.plan.unseated.length, clashes: v.plan.clashes.length })
  }
  return { sessions: done }
}

async function fillInvigilators(exam, session, plan, info, auth) {
  const [teachers, away] = await Promise.all([teacherPool(exam, plan._id), awayOn(session.date, auth)])
  const avoid = await avoidByRoom(plan, session, info)
  const count = new Map()
  for (const s of plan.seats) count.set(String(s.roomId), (count.get(String(s.roomId)) ?? 0) + 1)
  const keep = Object.fromEntries(plan.rooms.filter((r) => r.invigilatorsByHand).map((r) => [String(r.roomId), r.invigilatorIds.map(String)]))
  const { rooms } = assignInvigilators({
    rooms: plan.rooms.map((r) => ({ id: String(r.roomId), students: count.get(String(r.roomId)) ?? 0, avoid: avoid[String(r.roomId)] ?? [] })),
    teachers, away, keep, rules: { ...SEAT_PLAN_DEFAULTS, ...(plan.toObject?.().rules ?? plan.rules ?? {}) },
  })
  plan.rooms = plan.rooms.map((r) => ({ ...(r.toObject?.() ?? r), invigilatorIds: rooms[String(r.roomId)] ?? [] }))
}

// ───────────────────────────────────────────────────────── editing by hand

async function draftPlan(planId) {
  const plan = isOid(planId) ? await ExamSeatPlan.findById(planId) : null
  if (!plan) throw notFound('Seating plan')
  if (plan.status === 'PUBLISHED') throw conflict('This session’s seating is published — take it back to draft to change it.')
  return plan
}
async function viewOf(plan, auth) {
  const exam = await examById(plan.examId)
  const session = await sessionOf(exam, plan.date, plan.startTime)
  return sessionView(exam, session, plan.toObject(), auth)
}

/**
 * Move students by hand: each move puts a student on a seat of a room in the plan; if someone sits there they swap.
 * A student not seated yet (the room ran out) can be put on a free seat. Moved seats are locked.
 */
export async function moveSeats(planId, moves = [], auth, req) {
  const plan = await draftPlan(planId)
  const exam = await examById(plan.examId)
  const session = await sessionOf(exam, plan.date, plan.startTime)
  const { info } = await sessionStudents(exam, session, plan.rules?.fill)
  const pool = await roomPool()
  for (const m of moves) {
    const room = plan.rooms.find((r) => String(r.roomId) === String(m.roomId))
    if (!room) throw badRequest('That room isn’t in this plan.')
    const { seats } = examRoomSeats(engineRoom({ ...room.toObject(), homeLayout: pool.find((p) => p.id === String(room.roomId))?.homeLayout }), { gap: plan.rules?.gap })
    const target = seats.find((x) => x.label === String(m.seat))
    if (!target) throw badRequest(`Seat ${m.seat} isn’t in ${room.code || room.name}.`)
    const st = info.get(String(m.studentId))
    if (!st) throw badRequest('That student doesn’t write this session.')
    const from = plan.seats.find((s) => String(s.studentId) === String(m.studentId))
    const there = plan.seats.find((s) => String(s.roomId) === String(m.roomId) && s.seat === target.label)
    if (there && from && there === from) continue
    const place = { roomId: room.roomId, seat: target.label, order: target.order, row: target.row, col: target.col, pos: target.pos, across: target.across }
    if (there && from) {
      // swap: the one sitting there takes the mover's old seat
      const old = { roomId: from.roomId, seat: from.seat, order: from.order, row: from.row, col: from.col, pos: from.pos, across: from.across }
      Object.assign(there, old, { locked: true })
      Object.assign(from, place, { locked: true })
    } else if (there && !from) {
      // an unseated student takes the seat; the one sitting there becomes unseated
      plan.unseated = plan.unseated.filter((u) => String(u) !== String(m.studentId)).concat([there.studentId])
      Object.assign(there, { studentId: st.id, classId: st.classId, locked: true })
    } else if (from) Object.assign(from, place, { locked: true })
    else {
      plan.seats.push({ ...place, studentId: st.id, classId: st.classId, locked: true })
      plan.unseated = plan.unseated.filter((u) => String(u) !== String(m.studentId))
    }
  }
  plan.markModified('seats')
  plan.updatedBy = auth?.user?.name
  await plan.save()
  await audit(AUDIT(plan, `Moved ${moves.length} seat${moves.length === 1 ? '' : 's'} by hand`), req)
  return viewOf(plan, auth)
}

/** Unlock seats placed by hand (the next generation may move them again). `all` = every seat. */
export async function unlockSeats(planId, { all = false, seats = [] } = {}, auth) {
  const plan = await draftPlan(planId)
  for (const s of plan.seats) if (all || seats.some((x) => String(x.roomId) === String(s.roomId) && x.seat === s.seat)) s.locked = false
  plan.markModified('seats')
  await plan.save()
  return viewOf(plan, auth)
}

/** Invigilators of one room, chosen by hand (or `auto: true` to hand the room back to the generator). */
export async function setInvigilators(planId, { roomId, teacherIds = [], auto = false }, auth, req) {
  const plan = await draftPlan(planId)
  const room = plan.rooms.find((r) => String(r.roomId) === String(roomId))
  if (!room) throw badRequest('That room isn’t in this plan.')
  const clash = plan.rooms.find((r) => r !== room && r.invigilatorIds.some((id) => teacherIds.includes(String(id))))
  if (clash && !auto) throw badRequest(`Already invigilating ${clash.code || clash.name} in this session.`)
  room.invigilatorIds = auto ? [] : teacherIds
  room.invigilatorsByHand = !auto
  if (auto) {
    const exam = await examById(plan.examId)
    const session = await sessionOf(exam, plan.date, plan.startTime)
    const { info } = await sessionStudents(exam, session, plan.rules?.fill)
    await fillInvigilators(exam, session, plan, info, auth)
  }
  plan.markModified('rooms')
  await plan.save()
  await audit(AUDIT(plan, `Invigilators for ${room.code || room.name}: ${auto ? 'automatic' : `${teacherIds.length} chosen`}`), req)
  return viewOf(plan, auth)
}

/** Re-pick the invigilators of every room not chosen by hand. */
export async function autoInvigilators(planId, auth, req) {
  const plan = await draftPlan(planId)
  const exam = await examById(plan.examId)
  const session = await sessionOf(exam, plan.date, plan.startTime)
  const { info } = await sessionStudents(exam, session, plan.rules?.fill)
  await fillInvigilators(exam, session, plan, info, auth)
  plan.markModified('rooms')
  await plan.save()
  await audit(AUDIT(plan, 'Invigilators picked again'), req)
  return viewOf(plan, auth)
}

export async function publishPlan(planId, publish, auth, req) {
  const plan = isOid(planId) ? await ExamSeatPlan.findById(planId) : null
  if (!plan) throw notFound('Seating plan')
  if (publish) {
    if (plan.unseated.length) throw conflict(`${plan.unseated.length} student${plan.unseated.length === 1 ? ' has' : 's have'} no seat — add a room first.`)
    plan.status = 'PUBLISHED'; plan.publishedAt = new Date(); plan.publishedBy = auth?.user?.name
  } else { plan.status = 'DRAFT'; plan.publishedAt = undefined; plan.publishedBy = undefined }
  await plan.save()
  await audit(AUDIT(plan, publish ? 'Published the seating' : 'Took the seating back to draft'), req)
  return viewOf(plan, auth)
}

export async function deletePlan(planId, req) {
  const plan = isOid(planId) ? await ExamSeatPlan.findById(planId) : null
  if (!plan) throw notFound('Seating plan')
  if (plan.status === 'PUBLISHED') throw conflict('Take the seating back to draft first.')
  await ExamSeatPlan.deleteOne({ _id: plan._id })
  await audit(AUDIT(plan, 'Cleared the seating plan', { action: 'DELETE' }), req)
  return { deleted: true }
}

/** The signed-in teacher's invigilation duties from today on (published plans). */
export async function myDuties(auth) {
  const today = (await institutionNow()).date
  const plans = await ExamSeatPlan.find({ status: 'PUBLISHED', date: { $gte: today }, 'rooms.invigilatorIds': auth.userId }).sort({ date: 1, startTime: 1 }).limit(60).lean()
  const exams = new Map((await Exam.find({ _id: { $in: plans.map((p) => p.examId) } }).select('name').lean()).map((e) => [String(e._id), e.name]))
  return plans.map((p) => {
    const room = p.rooms.find((r) => r.invigilatorIds.some((id) => String(id) === String(auth.userId)))
    return { planId: String(p._id), exam: exams.get(String(p.examId)) ?? '', date: p.date, startTime: p.startTime, endTime: p.endTime, room: room?.code || room?.name, students: p.seats.filter((s) => String(s.roomId) === String(room?.roomId)).length }
  })
}

// ───────────────────────────────────────────────────────── printing

const institution = async () => { const t = await Tenant.findById(getContext()?.tenantId).select('name profile').lean(); return { name: t?.name, ...(t?.profile ?? {}) } }

/** EXAM_SEATING_CHART: each room of a session as a drawing of its seats with who sits where, and its invigilators. */
export async function seatingChartPrint(planId, auth) {
  const plan = isOid(planId) ? await ExamSeatPlan.findById(planId).lean() : null
  if (!plan) throw notFound('Seating plan')
  const exam = await examById(plan.examId)
  const view = await sessionView(exam, await sessionOf(exam, plan.date, plan.startTime), plan, auth)
  const teacher = new Map(view.teachers.map((t) => [t.id, t.name]))
  const users = await User.find({ _id: { $in: plan.rooms.flatMap((r) => r.invigilatorIds) } }).select('name').lean()
  for (const u of users) teacher.set(String(u._id), u.name)
  const at = new Map(view.plan.seats.map((s) => [`${s.roomId}|${s.seat}`, s]))
  const classCode = new Map(view.classes.map((c, i) => [c.id, { code: c.code || c.name, n: i % 6 }]))
  return {
    institution: await institution(), exam: view.exam, session: view.session, status: view.plan.status,
    classes: view.classes.map((c, i) => ({ ...c, n: i % 6 })),
    rooms: view.plan.rooms.map((r) => ({
      name: r.name, code: r.code, students: r.students, invigilators: r.invigilatorIds.map((id) => teacher.get(id) ?? '').filter(Boolean),
      runs: r.runs, columns: r.drawn.columns, perBench: r.drawn.perBench, compact: r.drawn.columns * r.drawn.perBench > 10, // too wide for names
      rows: r.drawn.grid.map((row) => ({ benches: row.map((bench) => ({ seats: bench.map((label) => {
        const s = at.get(`${r.roomId}|${label}`)
        return s ? { label, name: s.name, rollNo: s.rollNo, section: s.section, tone: classCode.get(s.classId)?.n ?? 0 } : { label, empty: true }
      }) })) })),
    })),
  }
}
export const seatingChartModel = (raw) => ({ ...raw, roomCount: raw.rooms.length })

/** EXAM_DOOR_LIST: the notice for the board — per room, each class-section's roll numbers. */
export async function doorListPrint(planId, auth) {
  const raw = await seatingChartPrint(planId, auth)
  return { ...raw, rooms: raw.rooms.map(({ rows, ...r }) => r) } // eslint-disable-line no-unused-vars
}

/** INVIGILATION_DUTY: the exam's duty chart — every session and room with its invigilators, and each teacher's total. */
export async function dutyChartPrint(examId) {
  const exam = await examById(examId)
  const plans = await ExamSeatPlan.find({ examId: exam._id }).sort({ date: 1, startTime: 1 }).lean()
  if (!plans.length) throw notFound('Seating plan')
  const users = new Map((await User.find({ _id: { $in: plans.flatMap((p) => p.rooms.flatMap((r) => r.invigilatorIds)) } }).select('name designation').lean()).map((u) => [String(u._id), u]))
  const totals = new Map()
  const sessions = plans.map((p) => ({
    date: p.date, startTime: p.startTime, endTime: p.endTime, status: p.status,
    rooms: p.rooms.map((r) => {
      const names = r.invigilatorIds.map((id) => { const u = users.get(String(id)); totals.set(String(id), (totals.get(String(id)) ?? 0) + 1); return u?.name ?? '' }).filter(Boolean)
      return { room: r.code || r.name, students: p.seats.filter((s) => String(s.roomId) === String(r.roomId)).length, invigilators: names.join(', ') }
    }),
  }))
  return {
    institution: await institution(), exam: { id: String(exam._id), name: exam.name }, sessions,
    teachers: [...totals.entries()].map(([id, n]) => ({ name: users.get(id)?.name ?? '', designation: users.get(id)?.designation ?? '', duties: n })).sort((a, b) => b.duties - a.duties || a.name.localeCompare(b.name)),
  }
}
export const latestPlanId = async () => (await ExamSeatPlan.findOne().sort({ updatedAt: -1 }).select('_id').lean())?._id
export const latestPlanExamId = async () => (await ExamSeatPlan.findOne().sort({ updatedAt: -1 }).select('examId').lean())?.examId
