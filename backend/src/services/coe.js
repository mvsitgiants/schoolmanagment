import {
  COE_FAIL_REASONS, courseResultOf, cumulativeGpa, gradePointAverage, internalTotalOf, isElectiveType, makeDummyNo, moderatedMarks,
} from '@schoolgiant/shared'
import { AcademicYear } from '../models/academics.js'
import { CoeMarkSheet, CoeResult, CoeRevaluation, CoeSemesterResult, CoeSession } from '../models/coe.js'
import { ProgramCourse, Program, ProgramEnrolment, Regulation } from '../models/programs.js'
import { Student, studentName } from '../models/students.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { yearOrCurrent } from './academics.js'
import { programIdsInScope, regulationRules } from './programs.js'
import { registeredCourses } from './registration.js'

// Exam controller (module `coe`). A session (regular end-semester, or supplementary for arrears) covers some
// program-semesters. "Prepare mark sheets" makes an INTERNAL and an EXTERNAL sheet per course for the students who
// take it (approved registrations, or the whole semester when there was no registration window). External marks
// are entered against dummy numbers, so evaluators never see whose script it is; only the controller (lock
// permission) can reveal the mapping. Moderation (grace marks / scaling) is proposed on an external sheet and applied
// once someone else approves it. Results — grade, grade points, SGPA, CGPA, arrears — are worked out from the sheets
// and published once every sheet is locked. A supplementary attempt replaces the failed one in the CGPA.

const AUDIT = (entityType, entity, summary, extra = {}) => ({ action: extra.action ?? 'UPDATE', module: 'coe', entityType, entityId: String(entity._id), entityName: entity.name ?? summary, summary, ...extra })
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const examMonthLabel = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : null)

// ───────────────────────────────────────────────────────── scope

/** Program ids in the caller's exam-controller scope (null: all). */
export const coeProgramIds = (auth) => programIdsInScope(auth, 'coe')
const inScope = (ids, programId) => !ids || ids.includes(String(programId))

export async function sessionDoc(id) {
  if (!isOid(id)) throw notFound('Exam session')
  const s = await CoeSession.findById(id)
  if (!s) throw notFound('Exam session')
  return s
}

async function sheetDoc(id, auth) {
  if (!isOid(id)) throw notFound('Mark sheet')
  const sh = await CoeMarkSheet.findById(id)
  if (!sh || !inScope(await coeProgramIds(auth), sh.programId)) throw notFound('Mark sheet')
  return sh
}

/** Regulation rules per program id. */
async function rulesByProgram(programIds) {
  const programs = await Program.find({ _id: { $in: programIds } }).select('regulationId code name').lean()
  const regs = new Map((await Regulation.find({ _id: { $in: programs.map((p) => p.regulationId).filter(Boolean) } }).lean()).map((r) => [String(r._id), r]))
  return new Map(programs.map((p) => [String(p._id), regulationRules(regs.get(String(p.regulationId)) ?? null)]))
}

// ───────────────────────────────────────────────────────── sessions

export async function listSessions(auth) {
  const ids = await coeProgramIds(auth)
  const rows = await CoeSession.find(ids ? { 'targets.programId': { $in: ids.map(oid) } } : {}).sort({ createdAt: -1 }).lean()
  const [years, sheets, programs] = await Promise.all([
    AcademicYear.find({ _id: { $in: rows.map((s) => s.academicYearId) } }).select('name').lean(),
    CoeMarkSheet.aggregate([{ $match: { sessionId: { $in: rows.map((s) => s._id) } } }, { $group: { _id: { s: '$sessionId', st: '$status' }, n: { $sum: 1 } } }]),
    Program.find({ _id: { $in: rows.flatMap((s) => s.targets.map((t) => t.programId)) } }).select('code').lean(),
  ])
  const yr = new Map(years.map((y) => [String(y._id), y.name]))
  const code = new Map(programs.map((p) => [String(p._id), p.code]))
  const n = (s, st) => sheets.filter((x) => String(x._id.s) === String(s._id) && (!st || x._id.st === st)).reduce((a, x) => a + x.n, 0)
  return rows.map((s) => ({
    ...clean(s), yearName: yr.get(String(s.academicYearId)) ?? null, monthLabel: examMonthLabel(s.examMonth),
    targets: s.targets.map((t) => ({ programId: String(t.programId), semester: t.semester, programCode: code.get(String(t.programId)) ?? null })),
    sheets: n(s), locked: n(s, 'LOCKED'),
  }))
}

export async function saveSession(id, input, auth, req) {
  const ids = await coeProgramIds(auth)
  if (input.targets) {
    const programs = await Program.find({ _id: { $in: input.targets.map((t) => t.programId) } }).select('semesters code').lean()
    const byId = new Map(programs.map((p) => [String(p._id), p]))
    for (const [i, t] of input.targets.entries()) {
      const p = byId.get(String(t.programId))
      if (!p || !inScope(ids, t.programId)) throw fieldsError({ [`targets.${i}.programId`]: 'Pick a program' })
      if (t.semester > p.semesters) throw fieldsError({ [`targets.${i}.semester`]: `${p.code} has ${p.semesters} semesters` })
    }
    const keys = input.targets.map((t) => `${t.programId}|${t.semester}`)
    if (new Set(keys).size !== keys.length) throw fieldsError({ targets: 'A program-semester is listed twice' })
  }
  if (input.name && await CoeSession.exists({ name: input.name, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: 'Another session has this name' })
  if (!id) {
    const year = await yearOrCurrent(input.academicYearId)
    const s = await CoeSession.create({ ...input, academicYearId: year._id, createdBy: auth.user?.name })
    await audit(AUDIT('coe_session', s, `Created the exam session ${s.name}`, { action: 'CREATE' }), req)
    return clean(s.toObject())
  }
  const s = await sessionDoc(id)
  if (s.status === 'PUBLISHED') throw conflict('Results of this session are published — it can no longer change.')
  if (input.targets) {
    const kept = new Set(input.targets.map((t) => `${t.programId}|${t.semester}`))
    const orphan = await CoeMarkSheet.find({ sessionId: s._id }).select('programId semester entries').lean()
    if (orphan.some((sh) => !kept.has(`${sh.programId}|${sh.semester}`) && sh.entries.some((e) => e.marks !== null || e.absent))) throw conflict('Marks are already entered for a program-semester you took off.')
    await CoeMarkSheet.deleteMany({ sessionId: s._id, _id: { $in: orphan.filter((sh) => !kept.has(`${sh.programId}|${sh.semester}`)).map((sh) => sh._id) } })
  }
  const { academicYearId: _y, kind: _k, ...rest } = input
  Object.assign(s, rest)
  await s.save()
  await audit(AUDIT('coe_session', s, `Updated the exam session ${s.name}`), req)
  return clean(s.toObject())
}

/**
 * Who sits each course of a program-semester in a session → Map courseId → Set(studentId).
 *   REGULAR: approved registrations of the year; no registration window → every studying student of the semester,
 *            in its core courses.
 *   SUPPLEMENTARY: students whose latest attempt at a course of that semester (published results) failed.
 */
async function candidatesFor(session, programId, semester) {
  const out = new Map()
  const add = (c, s) => { if (!out.has(String(c))) out.set(String(c), new Set()); out.get(String(c)).add(String(s)) }
  const courses = await ProgramCourse.find({ programId, semester, active: true }).lean()
  if (session.kind === 'SUPPLEMENTARY') {
    const published = (await CoeSession.find({ status: 'PUBLISHED' }).select('_id').lean()).map((s) => s._id)
    const results = await CoeResult.find({ courseId: { $in: courses.map((c) => c._id) }, sessionId: { $in: published } }).select('studentId courseId pass order').sort({ order: 1 }).lean()
    const latest = new Map()
    for (const r of results) latest.set(`${r.studentId}|${r.courseId}`, r)
    for (const r of latest.values()) if (!r.pass) add(r.courseId, r.studentId)
    return out
  }
  const registered = await registeredCourses({ academicYearId: session.academicYearId, programId, semester })
  if (registered) {
    for (const [studentId, courseIds] of registered) for (const c of courseIds) add(c, studentId)
    return out
  }
  const students = await ProgramEnrolment.find({ programId, currentSemester: semester, status: 'ACTIVE' }).select('studentId').lean()
  for (const c of courses.filter((x) => !isElectiveType(x.type))) for (const s of students) add(c._id, s.studentId)
  return out
}

/**
 * Make (or bring up to date) the mark sheets of a session: an INTERNAL sheet per course (regular sessions — a
 * supplementary attempt keeps its internal marks) and an EXTERNAL one with a dummy number per script. Locked sheets are
 * left alone; students no longer taking a course leave its open sheets when nothing was entered for them.
 */
export async function prepareSheets(sessionId, auth, req) {
  const s = await sessionDoc(sessionId)
  if (s.status === 'PUBLISHED') throw conflict('Results of this session are published.')
  const ids = await coeProgramIds(auth)
  const existing = await CoeMarkSheet.find({ sessionId: s._id })
  const used = new Set(existing.flatMap((sh) => sh.entries.map((e) => e.dummyNo).filter(Boolean)))
  const dummy = () => { let d; do d = makeDummyNo(); while (used.has(d)); used.add(d); return d }
  let created = 0
  let students = 0
  for (const t of s.targets) {
    if (!inScope(ids, t.programId)) continue
    const cands = await candidatesFor(s, t.programId, t.semester)
    const courses = new Map((await ProgramCourse.find({ _id: { $in: [...cands.keys()] } }).lean()).map((c) => [String(c._id), c]))
    const parts = s.kind === 'SUPPLEMENTARY' ? ['EXTERNAL'] : ['INTERNAL', 'EXTERNAL']
    for (const [courseId, set] of cands) {
      const c = courses.get(courseId)
      if (!c) continue
      students += set.size
      for (const part of parts) {
        const max = part === 'INTERNAL' ? c.internalMax : c.externalMax
        if (!max) continue
        let sh = existing.find((x) => String(x.courseId) === courseId && x.part === part)
        if (sh?.status === 'LOCKED') continue
        if (!sh) { sh = new CoeMarkSheet({ sessionId: s._id, courseId: c._id, programId: t.programId, semester: c.semester, part, maxMarks: max }); created++ }
        const have = new Set(sh.entries.map((e) => String(e.studentId)))
        sh.entries = sh.entries.filter((e) => set.has(String(e.studentId)) || e.marks !== null || e.absent)
        for (const sid of set) if (!have.has(sid)) sh.entries.push({ studentId: sid, marks: null, absent: false, ...(part === 'EXTERNAL' && { dummyNo: dummy() }) })
        sh.maxMarks = max
        await sh.save()
      }
    }
  }
  await audit(AUDIT('coe_session', s, `Prepared the mark sheets of ${s.name} (${created} new)`), req)
  return { created, students }
}

/** The session board: a row per course with its internal and external sheets' progress. */
export async function sessionBoard(id, auth) {
  const s = (await sessionDoc(id)).toObject()
  const ids = await coeProgramIds(auth)
  const sheets = await CoeMarkSheet.find({ sessionId: s._id, ...(ids && { programId: { $in: ids.map(oid) } }) }).lean()
  const [courses, programs, year, revals] = await Promise.all([
    ProgramCourse.find({ _id: { $in: sheets.map((x) => x.courseId) } }).select('code title credits semester type programId').lean(),
    Program.find({ _id: { $in: s.targets.map((t) => t.programId) } }).select('code name').lean(),
    AcademicYear.findById(s.academicYearId).select('name').lean(),
    CoeRevaluation.countDocuments({ sessionId: s._id, status: { $in: ['REQUESTED', 'APPROVED'] } }),
  ])
  const prog = new Map(programs.map((p) => [String(p._id), p]))
  const progress = (sh) => (!sh ? null : {
    id: String(sh._id), status: sh.status, total: sh.entries.length, maxMarks: sh.maxMarks,
    entered: sh.entries.filter((e) => e.absent || e.marks !== null).length,
    moderation: sh.moderation ?? null, lockedBy: sh.lockedBy ?? null, lockedAt: sh.lockedAt ?? null,
  })
  const rows = courses.map((c) => {
    const mine = sheets.filter((x) => String(x.courseId) === String(c._id))
    const internal = mine.find((x) => x.part === 'INTERNAL')
    const external = mine.find((x) => x.part === 'EXTERNAL')
    return {
      id: String(c._id), courseId: String(c._id), code: c.code, title: c.title, credits: c.credits, semester: c.semester, type: c.type,
      programId: String(c.programId), programCode: prog.get(String(c.programId))?.code ?? null,
      students: Math.max(internal?.entries.length ?? 0, external?.entries.length ?? 0),
      internal: progress(internal), external: progress(external),
    }
  }).sort((a, b) => String(a.programCode).localeCompare(String(b.programCode)) || a.semester - b.semester || a.code.localeCompare(b.code))
  const all = sheets.length
  const locked = sheets.filter((x) => x.status === 'LOCKED').length
  return {
    session: { ...clean(s), yearName: year?.name ?? null, monthLabel: examMonthLabel(s.examMonth), targets: s.targets.map((t) => ({ programId: String(t.programId), semester: t.semester, programCode: prog.get(String(t.programId))?.code ?? null })) },
    rows,
    summary: {
      courses: rows.length, sheets: all, locked,
      entries: sheets.reduce((n, x) => n + x.entries.length, 0),
      entered: sheets.reduce((n, x) => n + x.entries.filter((e) => e.absent || e.marks !== null).length, 0),
      moderationPending: sheets.filter((x) => x.moderation?.status === 'PROPOSED').length,
      revaluationsOpen: revals,
    },
  }
}

// ───────────────────────────────────────────────────────── one mark sheet

/**
 * A mark sheet to enter. INTERNAL: a row per student with the component marks. EXTERNAL: a row per dummy number only —
 * names come back only with `reveal` for someone who may lock marks (the controller).
 */
export async function getSheet(id, auth, { reveal = false } = {}) {
  const sh = (await sheetDoc(id, auth)).toObject()
  const [session, course] = await Promise.all([CoeSession.findById(sh.sessionId).lean(), ProgramCourse.findById(sh.courseId).lean()])
  const rules = (await rulesByProgram([sh.programId])).get(String(sh.programId))
  const mayReveal = can(auth, 'coe.marks.lock')
  const showNames = sh.part === 'INTERNAL' || (reveal && mayReveal)
  let people = new Map()
  if (showNames) {
    const ids = sh.entries.map((e) => e.studentId)
    const [students, enrolments] = await Promise.all([
      Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo gender').lean(),
      ProgramEnrolment.find({ studentId: { $in: ids } }).select('studentId registerNo').lean(),
    ])
    const reg = new Map(enrolments.map((e) => [String(e.studentId), e.registerNo]))
    people = new Map(students.map((s) => [String(s._id), { name: studentName(s), admissionNo: s.admissionNo, gender: s.gender ?? null, registerNo: reg.get(String(s._id)) ?? null }]))
  }
  const entries = sh.entries.map((e) => {
    const base = { marks: e.marks, absent: !!e.absent }
    if (sh.part === 'EXTERNAL') {
      const row = { id: e.dummyNo, dummyNo: e.dummyNo, ...base, moderated: moderatedMarks(e.marks, sh.moderation, sh.maxMarks) }
      return showNames ? { ...row, studentId: String(e.studentId), ...people.get(String(e.studentId)) } : row
    }
    return { id: String(e.studentId), studentId: String(e.studentId), ...base, components: e.components ?? {}, ...people.get(String(e.studentId)) }
  })
  entries.sort((a, b) => (sh.part === 'EXTERNAL' && !showNames ? a.dummyNo.localeCompare(b.dummyNo) : String(a.registerNo ?? a.admissionNo ?? '').localeCompare(String(b.registerNo ?? b.admissionNo ?? ''))))
  const open = sh.status !== 'LOCKED' && session.status !== 'PUBLISHED'
  return {
    id: String(sh._id), part: sh.part, status: sh.status, maxMarks: sh.maxMarks, sessionId: String(sh.sessionId), sessionName: session.name, sessionStatus: session.status,
    course: { id: String(course._id), code: course.code, title: course.title, credits: course.credits, internalMax: course.internalMax, externalMax: course.externalMax },
    components: sh.part === 'INTERNAL' ? rules.iaComponents : [],
    entries, masked: !showNames, canReveal: sh.part === 'EXTERNAL' && mayReveal,
    moderation: sh.moderation ?? null,
    enteredBy: sh.enteredBy ?? null, enteredAt: sh.enteredAt ?? null, lockedBy: sh.lockedBy ?? null, lockedAt: sh.lockedAt ?? null,
    canEdit: open && can(auth, 'coe.marks.edit'), canLock: open && can(auth, 'coe.marks.lock'),
    canUnlock: sh.status === 'LOCKED' && session.status !== 'PUBLISHED' && can(auth, 'coe.marks.lock'),
  }
}

async function assertOpen(sh) {
  const session = await CoeSession.findById(sh.sessionId).select('status').lean()
  if (session.status === 'PUBLISHED') throw conflict('Results of this session are published — marks can no longer change.')
  if (sh.status === 'LOCKED') throw conflict('These marks are locked. Unlock them first.')
}

/** Save marks: INTERNAL rows by student with component marks; EXTERNAL rows by dummy number. Problems come back per row. */
export async function saveSheet(id, rows, auth, req) {
  const sh = await sheetDoc(id, auth)
  await assertOpen(sh)
  const errors = {}
  if (sh.part === 'INTERNAL') {
    const rules = (await rulesByProgram([sh.programId])).get(String(sh.programId))
    const byStudent = new Map(sh.entries.map((e, i) => [String(e.studentId), i]))
    rows.forEach((r, k) => {
      const i = byStudent.get(String(r.studentId))
      if (i === undefined) { errors[`entries.${k}`] = 'Not on this sheet'; return }
      const comps = {}
      for (const c of rules.iaComponents) {
        const v = r.components?.[c.code]
        if (v === null || v === undefined || v === '') continue
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0 || n > c.maxMarks) { errors[`entries.${k}.${c.code}`] = `${c.code}: 0 to ${c.maxMarks}`; continue }
        comps[c.code] = n
      }
      const e = sh.entries[i]
      e.components = comps
      e.absent = !!r.absent
      e.marks = r.absent ? 0 : internalTotalOf(comps, rules.iaComponents, sh.maxMarks)
    })
    sh.markModified('entries')
  } else {
    const byDummy = new Map(sh.entries.map((e, i) => [e.dummyNo, i]))
    rows.forEach((r, k) => {
      const i = byDummy.get(r.dummyNo)
      if (i === undefined) { errors[`entries.${k}`] = `${r.dummyNo} is not on this sheet`; return }
      const e = sh.entries[i]
      if (r.absent) { e.absent = true; e.marks = null; return }
      if (r.marks === null || r.marks === undefined || r.marks === '') { e.absent = false; e.marks = null; return }
      const n = Number(r.marks)
      if (!Number.isFinite(n) || n < 0 || n > sh.maxMarks) { errors[`entries.${k}`] = `0 to ${sh.maxMarks}`; return }
      e.absent = false
      e.marks = n
    })
  }
  if (Object.keys(errors).length) throw fieldsError(errors, Object.values(errors)[0])
  Object.assign(sh, { enteredBy: auth.user?.name, enteredAt: new Date() })
  await sh.save()
  const course = await ProgramCourse.findById(sh.courseId).select('code').lean()
  await audit({ action: 'UPDATE', module: 'coe', entityType: 'coe_mark_sheet', entityId: String(sh._id), entityName: `${course?.code} ${sh.part.toLowerCase()}`, summary: `Entered ${sh.part.toLowerCase()} marks of ${course?.code} (${rows.length} rows)` }, req)
  return getSheet(sh._id, auth)
}

export async function lockSheet(id, auth, req) {
  const sh = await sheetDoc(id, auth)
  await assertOpen(sh)
  const missing = sh.entries.filter((e) => !e.absent && (e.marks === null || e.marks === undefined)).length
  if (missing) throw conflict(`${missing} script(s) have no marks yet. Enter them, or mark the student absent.`)
  if (sh.moderation?.status === 'PROPOSED') throw conflict('A moderation is waiting for approval.')
  Object.assign(sh, { status: 'LOCKED', lockedBy: auth.user?.name, lockedAt: new Date() })
  await sh.save()
  const course = await ProgramCourse.findById(sh.courseId).select('code').lean()
  await audit({ action: 'UPDATE', module: 'coe', entityType: 'coe_mark_sheet', entityId: String(sh._id), entityName: course?.code, summary: `Locked the ${sh.part.toLowerCase()} marks of ${course?.code}` }, req)
  return getSheet(sh._id, auth)
}

export async function unlockSheet(id, reason, auth, req) {
  const sh = await sheetDoc(id, auth)
  const session = await CoeSession.findById(sh.sessionId).select('status').lean()
  if (session.status === 'PUBLISHED') throw conflict('Results of this session are published — use revaluation instead.')
  if (sh.status !== 'LOCKED') return getSheet(sh._id, auth)
  Object.assign(sh, { status: 'OPEN', unlockedBy: auth.user?.name, unlockedAt: new Date(), unlockReason: reason })
  await sh.save()
  const course = await ProgramCourse.findById(sh.courseId).select('code').lean()
  await audit({ action: 'UPDATE', module: 'coe', entityType: 'coe_mark_sheet', entityId: String(sh._id), entityName: course?.code, summary: `Unlocked the ${sh.part.toLowerCase()} marks of ${course?.code}: ${reason}` }, req)
  return getSheet(sh._id, auth)
}

// ───────────────────────────────────────────────────────── moderation (external sheets)

export async function proposeModeration(id, input, auth, req) {
  const sh = await sheetDoc(id, auth)
  if (sh.part !== 'EXTERNAL') throw badRequest('Moderation is for end-semester marks.')
  await assertOpen(sh)
  sh.moderation = { ...input, status: 'PROPOSED', proposedBy: auth.user?.name, proposedAt: new Date() }
  await sh.save()
  const course = await ProgramCourse.findById(sh.courseId).select('code').lean()
  await audit({ action: 'UPDATE', module: 'coe', entityType: 'coe_mark_sheet', entityId: String(sh._id), entityName: course?.code, summary: `Proposed moderation for ${course?.code}: ${input.kind === 'SCALE' ? `scale up ${input.value}%` : `add ${input.value} marks`} — ${input.reason}` }, req)
  return getSheet(sh._id, auth)
}

/** Approve or reject a proposed moderation — by someone other than who proposed it (full-access roles excepted). */
export async function decideModeration(id, approve, auth, req) {
  const sh = await sheetDoc(id, auth)
  await assertOpen(sh)
  if (sh.moderation?.status !== 'PROPOSED') throw conflict('No moderation is waiting for approval.')
  if (!auth.fullAccess && sh.moderation.proposedBy === auth.user?.name) throw forbidden('Someone else must approve the moderation you proposed.')
  sh.moderation.status = approve ? 'APPROVED' : 'REJECTED'
  sh.moderation.decidedBy = auth.user?.name
  sh.moderation.decidedAt = new Date()
  sh.markModified('moderation')
  await sh.save()
  const course = await ProgramCourse.findById(sh.courseId).select('code').lean()
  await audit({ action: 'UPDATE', module: 'coe', entityType: 'coe_mark_sheet', entityId: String(sh._id), entityName: course?.code, summary: `${approve ? 'Approved' : 'Rejected'} the moderation of ${course?.code}` }, req)
  return getSheet(sh._id, auth)
}

// ───────────────────────────────────────────────────────── results

/**
 * Work out the session's results from its sheets: a CoeResult per student and course (rows with marks still missing
 * are left out and counted), then a CoeSemesterResult per student and semester with SGPA, CGPA and arrears.
 */
export async function computeSession(sessionId, auth, req) {
  const s = await sessionDoc(sessionId)
  if (s.status === 'PUBLISHED') throw conflict('Results of this session are published.')
  const out = await computeResults(s)
  await CoeSession.updateOne({ _id: s._id }, { $set: { computedAt: new Date() } })
  if (req) await audit(AUDIT('coe_session', s, `Worked out the results of ${s.name}: ${out.results} course result(s), ${out.missing} waiting for marks`), req)
  return out
}

async function computeResults(s) {
  const sheets = await CoeMarkSheet.find({ sessionId: s._id }).lean()
  const courses = new Map((await ProgramCourse.find({ _id: { $in: sheets.map((x) => x.courseId) } }).lean()).map((c) => [String(c._id), c]))
  const rules = await rulesByProgram([...new Set(sheets.map((x) => String(x.programId)))])
  const order = s.createdAt.getTime()
  const earlier = await CoeResult.find({ courseId: { $in: [...courses.keys()] }, sessionId: { $ne: s._id }, order: { $lt: order } }).sort({ order: 1 }).lean()
  const prevOf = new Map()
  for (const r of earlier) {
    const k = `${r.studentId}|${r.courseId}`
    if (!prevOf.has(k)) prevOf.set(k, [])
    prevOf.get(k).push(r)
  }
  const ops = []
  const keep = new Set()
  let missing = 0
  for (const [courseId, c] of courses) {
    const internal = sheets.find((x) => String(x.courseId) === courseId && x.part === 'INTERNAL')
    const external = sheets.find((x) => String(x.courseId) === courseId && x.part === 'EXTERNAL')
    const rule = rules.get(String(c.programId)) ?? regulationRules(null)
    const students = new Set([...(internal?.entries ?? []), ...(external?.entries ?? [])].map((e) => String(e.studentId)))
    for (const sid of students) {
      const prev = prevOf.get(`${sid}|${courseId}`) ?? []
      const iEntry = internal?.entries.find((e) => String(e.studentId) === sid)
      const eEntry = external?.entries.find((e) => String(e.studentId) === sid)
      const iMarks = c.internalMax ? (iEntry ? iEntry.marks : prev.at(-1)?.internal ?? null) : 0
      const eAbsent = !!eEntry?.absent
      const eMarks = c.externalMax ? (eEntry?.marks ?? null) : 0
      if ((c.internalMax && iMarks === null) || (c.externalMax && !eAbsent && eMarks === null)) { missing++; continue }
      const ext = eAbsent ? 0 : moderatedMarks(eMarks, external?.moderation, c.externalMax)
      const r = courseResultOf({ internal: iMarks, internalMax: c.internalMax, external: ext, externalMax: c.externalMax, absent: eAbsent && !!c.externalMax }, rule)
      keep.add(`${sid}|${courseId}`)
      ops.push({
        updateOne: {
          filter: { sessionId: s._id, studentId: oid(sid), courseId: c._id },
          update: {
            $set: {
              programId: c.programId, semester: c.semester, credits: c.credits, attempt: prev.length + 1, kind: s.kind,
              internal: iMarks, internalMax: c.internalMax, externalRaw: eAbsent ? null : eMarks, external: ext, externalMax: c.externalMax,
              absent: eAbsent, total: r.total, max: r.max, pct: r.pct, grade: r.grade, points: r.points, pass: r.pass, reason: r.reason, order,
            },
          },
          upsert: true,
        },
      })
    }
  }
  if (ops.length) await CoeResult.bulkWrite(ops)
  // results of students who are no longer on the sheets (or whose marks were cleared)
  const stale = (await CoeResult.find({ sessionId: s._id }).select('studentId courseId').lean()).filter((r) => !keep.has(`${r.studentId}|${r.courseId}`))
  if (stale.length) await CoeResult.deleteMany({ _id: { $in: stale.map((r) => r._id) } })
  const studentIds = [...new Set([...keep].map((k) => k.split('|')[0]))]
  await CoeSemesterResult.deleteMany({ sessionId: s._id, studentId: { $nin: studentIds.map(oid) } })
  for (const sid of studentIds) await semesterResultsFor(s, sid, rules)
  return { results: ops.length, missing, students: studentIds.length }
}

/** Recompute a student's semester rows in a session (SGPA, CGPA, credits, arrears). */
export async function semesterResultsFor(s, studentId, rulesMap) {
  const published = (await CoeSession.find({ $or: [{ status: 'PUBLISHED' }, { _id: s._id }] }).select('_id').lean()).map((x) => x._id)
  const order = s.createdAt.getTime()
  const all = await CoeResult.find({ studentId: oid(studentId), sessionId: { $in: published }, order: { $lte: order } }).lean()
  const mine = all.filter((r) => String(r.sessionId) === String(s._id))
  if (!mine.length) { await CoeSemesterResult.deleteMany({ sessionId: s._id, studentId: oid(studentId) }); return }
  const programId = mine[0].programId
  const rules = rulesMap?.get(String(programId)) ?? (await rulesByProgram([programId])).get(String(programId)) ?? regulationRules(null)
  const gpaOpts = { countFailed: rules.gpa.countFailed, decimals: rules.gpa.decimals }
  const cum = cumulativeGpa(all.map((r) => ({ courseId: r.courseId, credits: r.credits, points: r.points, pass: r.pass, order: r.order })), gpaOpts)
  const enrolment = await ProgramEnrolment.findOne({ studentId }).select('_id').lean()
  for (const semester of [...new Set(mine.map((r) => r.semester))]) {
    const latestOfSem = new Map()
    for (const r of all.filter((x) => x.semester === semester).sort((a, b) => a.order - b.order)) latestOfSem.set(String(r.courseId), r)
    const thisSem = mine.filter((r) => r.semester === semester)
    await CoeSemesterResult.updateOne(
      { sessionId: s._id, studentId: oid(studentId), semester },
      {
        $set: {
          programId, enrolmentId: enrolment?._id,
          courses: thisSem.length, passed: thisSem.filter((r) => r.pass).length,
          creditsRegistered: round(thisSem.reduce((n, r) => n + r.credits, 0), 1),
          creditsEarned: round(thisSem.filter((r) => r.pass).reduce((n, r) => n + r.credits, 0), 1),
          sgpa: gradePointAverage([...latestOfSem.values()], gpaOpts),
          cgpa: cum.cgpa, cumulativeCredits: cum.creditsEarned, arrears: cum.arrears.length,
          result: thisSem.every((r) => r.pass) ? 'PASS' : 'FAIL',
          published: s.status === 'PUBLISHED',
        },
      },
      { upsert: true },
    )
  }
}

/** After a change to a published result (revaluation): this session's rows, then the CGPA of later sessions. */
export async function refreshStudent(studentId) {
  const sessions = await CoeSession.find({ status: 'PUBLISHED', _id: { $in: await CoeSemesterResult.distinct('sessionId', { studentId: oid(studentId) }) } }).sort({ createdAt: 1 })
  for (const s of sessions) await semesterResultsFor(s, studentId)
}

/** Publish a session's results: every sheet locked, no moderation waiting, results worked out once more. */
export async function publishSession(sessionId, auth, req) {
  const s = await sessionDoc(sessionId)
  if (s.status === 'PUBLISHED') throw conflict('Already published.')
  const sheets = await CoeMarkSheet.find({ sessionId: s._id }).select('status').lean()
  if (!sheets.length) throw conflict('This session has no mark sheets yet.')
  const open = sheets.filter((x) => x.status !== 'LOCKED').length
  if (open) throw conflict(`${open} mark sheet(s) are not locked yet.`)
  const out = await computeResults(s)
  s.status = 'PUBLISHED'
  s.publishedAt = new Date()
  s.publishedBy = auth.user?.name
  s.computedAt = new Date()
  await s.save()
  await CoeSemesterResult.updateMany({ sessionId: s._id }, { $set: { published: true } })
  await audit(AUDIT('coe_session', s, `Published the results of ${s.name} (${out.students} students)`), req)
  return { ...clean(s.toObject()), ...out }
}

export const failReasonLabel = (r) => (r ? COE_FAIL_REASONS[r] ?? r : null)

/**
 * Answer-script stickers (SCRIPT_LABEL): one per dummy number of an EXTERNAL sheet — the barcode the evaluator scans on
 * Exam controller › Marks to jump to that script's box. No names, no register numbers: the sticker goes on the booklet.
 */
export async function scriptLabelsData(id, auth) {
  const sh = (await sheetDoc(id, auth)).toObject()
  if (sh.part !== 'EXTERNAL') throw badRequest('Script labels are for the external (answer script) sheet.')
  const [session, course] = await Promise.all([CoeSession.findById(sh.sessionId).lean(), ProgramCourse.findById(sh.courseId).lean()])
  return {
    session: { name: session?.name ?? '', month: examMonthLabel(session?.examMonth) },
    course: { code: course?.code ?? '', title: course?.title ?? '' },
    labels: sh.entries.map((e) => e.dummyNo).filter(Boolean).sort().map((dummyNo) => ({ dummyNo })),
  }
}
export const latestExternalSheetId = async () => (await CoeMarkSheet.findOne({ part: 'EXTERNAL' }).sort({ createdAt: -1 }).select('_id').lean())?._id ?? null
