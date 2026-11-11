import { REG_STATUS, checkRegistration, isElectiveType, regWindowStatus } from '@schoolgiant/shared'
import { AcademicYear } from '../models/academics.js'
import { CoeResult, CoeSession } from '../models/coe.js'
import { ProgramCourse, Program, ProgramEnrolment, Regulation } from '../models/programs.js'
import { CourseRegistration, RegistrationWindow } from '../models/registration.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { institutionNow } from '../platform/time.js'
import { yearOrCurrent } from './academics.js'
import { assertProgramInScope, getProgramDoc, programIdsInScope, regulationRules } from './programs.js'

// Semester registration (module `registration`). A window opens registration for one program-semester in an academic
// year; staff enter each student's course selection for them (the student app comes later). Every save is checked:
// compulsory courses, elective group picks, credit limits, seats, and prerequisites passed (published exam controller
// results). Add / drop is open until the window closes; with approval on, every change goes back to the advisor.

const AUDIT = (entityType, entity, summary, extra = {}) => ({ action: extra.action ?? 'UPDATE', module: 'registration', entityType, entityId: String(entity._id), entityName: entity.name ?? summary, summary, ...extra })
const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const TAKEN = { status: { $ne: 'REJECTED' } } // a registration that holds its seats

/**
 * Who the caller may see: programs in scope, and for the OWN scope only the students they advise.
 * → { programIds: [id] | null, advisorId: id | null }
 */
async function regScope(auth) {
  if (scopeOf(auth, 'registration') === 'OWN') {
    const advised = await ProgramEnrolment.distinct('programId', { advisorId: auth.userId })
    const own = (await programIdsInScope(auth, 'registration')) ?? []
    return { programIds: [...new Set([...advised.map(String), ...own])], advisorId: auth.userId }
  }
  return { programIds: await programIdsInScope(auth, 'registration'), advisorId: null }
}

async function windowDoc(id, auth) {
  if (!isOid(id)) throw notFound('Registration window')
  const w = await RegistrationWindow.findById(id)
  if (!w) throw notFound('Registration window')
  if (auth) {
    const { programIds } = await regScope(auth)
    if (programIds && !programIds.includes(String(w.programId))) throw notFound('Registration window')
  }
  return w
}

// ───────────────────────────────────────────────────────── windows

export async function listWindows(auth, { academicYearId, programId } = {}) {
  const { programIds } = await regScope(auth)
  const filter = {
    ...(academicYearId && { academicYearId: oid(academicYearId) }),
    ...(programId && { programId: oid(programId) }),
    ...(programIds && { programId: { $in: (programId ? programIds.filter((p) => p === String(programId)) : programIds).map(oid) } }),
  }
  const [rows, day] = await Promise.all([RegistrationWindow.find(filter).sort({ opensOn: -1 }).lean(), today()])
  const [programs, years, counts, enrolled] = await Promise.all([
    Program.find({ _id: { $in: rows.map((w) => w.programId) } }).select('name code').lean(),
    AcademicYear.find({ _id: { $in: rows.map((w) => w.academicYearId) } }).select('name').lean(),
    CourseRegistration.aggregate([{ $match: { windowId: { $in: rows.map((w) => w._id) } } }, { $group: { _id: { w: '$windowId', s: '$status' }, n: { $sum: 1 } } }]),
    ProgramEnrolment.aggregate([{ $match: { status: 'ACTIVE', programId: { $in: rows.map((w) => w.programId) } } }, { $group: { _id: { p: '$programId', s: '$currentSemester' }, n: { $sum: 1 } } }]),
  ])
  const prog = new Map(programs.map((p) => [String(p._id), p]))
  const yr = new Map(years.map((y) => [String(y._id), y.name]))
  const count = (w, s) => counts.find((c) => String(c._id.w) === String(w._id) && c._id.s === s)?.n ?? 0
  return rows.map((w) => ({
    ...clean(w),
    programName: prog.get(String(w.programId))?.name ?? null,
    programCode: prog.get(String(w.programId))?.code ?? null,
    yearName: yr.get(String(w.academicYearId)) ?? null,
    status: regWindowStatus(w, day),
    courseCount: w.offerings.length,
    students: enrolled.find((e) => String(e._id.p) === String(w.programId) && e._id.s === w.semester)?.n ?? 0,
    submitted: count(w, 'SUBMITTED'), approved: count(w, 'APPROVED'), rejected: count(w, 'REJECTED'),
  }))
}

/** Seats taken per course in a window (registrations that are not rejected), leaving out one student. */
async function seatsTaken(windowId, exceptStudentId) {
  const rows = await CourseRegistration.aggregate([
    { $match: { windowId: oid(windowId), ...TAKEN, ...(exceptStudentId && { studentId: { $ne: oid(exceptStudentId) } }) } },
    { $unwind: '$courseIds' }, { $group: { _id: '$courseIds', n: { $sum: 1 } } },
  ])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

/** One window with its offerings (course details, seats used) and groups. */
export async function getWindow(id, auth) {
  const w = (await windowDoc(id, auth)).toObject()
  const [program, year, courses, taken, approvedTaken, day] = await Promise.all([
    Program.findById(w.programId).select('name code semesters').lean(),
    AcademicYear.findById(w.academicYearId).select('name').lean(),
    ProgramCourse.find({ _id: { $in: w.offerings.map((o) => o.courseId) } }).lean(),
    seatsTaken(w._id),
    CourseRegistration.aggregate([{ $match: { windowId: w._id, status: 'APPROVED' } }, { $unwind: '$courseIds' }, { $group: { _id: '$courseIds', n: { $sum: 1 } } }]),
    today(),
  ])
  const byId = new Map(courses.map((c) => [String(c._id), c]))
  const approved = new Map(approvedTaken.map((r) => [String(r._id), r.n]))
  const codeOf = new Map((await ProgramCourse.find({ _id: { $in: courses.flatMap((c) => c.prerequisiteIds ?? []) } }).select('code').lean()).map((c) => [String(c._id), c.code]))
  return {
    ...clean(w),
    programName: program?.name, programCode: program?.code, yearName: year?.name, status: regWindowStatus(w, day),
    offerings: w.offerings.map((o) => {
      const c = byId.get(String(o.courseId))
      return {
        ...o, courseId: String(o.courseId), code: c?.code, title: c?.title, credits: c?.credits, type: c?.type, semester: c?.semester,
        prerequisites: (c?.prerequisiteIds ?? []).map((x) => codeOf.get(String(x))).filter(Boolean),
        taken: taken.get(String(o.courseId)) ?? 0, approved: approved.get(String(o.courseId)) ?? 0,
      }
    }),
  }
}

/** A new window's starting offerings: the semester's active courses, core compulsory, electives by their group. */
async function defaultOfferings(programId, semester) {
  const courses = await ProgramCourse.find({ programId, semester, active: true }).sort({ code: 1 }).lean()
  const offerings = courses.map((c) => ({
    courseId: c._id, mandatory: !isElectiveType(c.type), group: isElectiveType(c.type) ? (c.electiveGroup || (c.type === 'OPEN_ELECTIVE' ? 'OE' : 'PE')) : undefined,
  }))
  const groups = [...new Set(offerings.map((o) => o.group).filter(Boolean))].map((code) => ({ code, name: code, minPick: 1, maxPick: 1 }))
  return { offerings, groups }
}

export async function saveWindow(id, input, auth, req) {
  const before = id ? await windowDoc(id, auth) : null
  const programId = before ? before.programId : input.programId
  const program = await getProgramDoc(programId)
  await assertProgramInScope(program._id, auth, 'registration')
  const semester = input.semester ?? before?.semester
  if (semester > program.semesters) throw fieldsError({ semester: `${program.code} has ${program.semesters} semesters` })
  const opensOn = input.opensOn ?? before?.opensOn
  const closesOn = input.closesOn ?? before?.closesOn
  if (opensOn > closesOn) throw fieldsError({ closesOn: 'Closes before it opens' })
  if (input.minCredits && input.maxCredits && input.minCredits > input.maxCredits) throw fieldsError({ maxCredits: 'Must be at least the minimum' })

  if (input.offerings) {
    const ids = input.offerings.map((o) => String(o.courseId))
    if (new Set(ids).size !== ids.length) throw fieldsError({ offerings: 'A course is listed twice' })
    if ((await ProgramCourse.countDocuments({ _id: { $in: ids } })) !== ids.length) throw fieldsError({ offerings: 'Some courses were not found' })
    const groups = new Set((input.groups ?? before?.groups ?? []).map((g) => g.code))
    const bad = input.offerings.find((o) => o.group && !groups.has(o.group))
    if (bad) throw fieldsError({ groups: `Add the group ${bad.group}` })
    if (before) {
      const dropped = before.offerings.map((o) => String(o.courseId)).filter((x) => !ids.includes(x))
      if (dropped.length && await CourseRegistration.exists({ windowId: before._id, courseIds: { $in: dropped.map(oid) }, ...TAKEN })) throw conflict('Students have registered for a course you took off. Drop it from their registrations first.')
    }
  }

  if (!before) {
    const year = await yearOrCurrent(input.academicYearId)
    if (await RegistrationWindow.exists({ academicYearId: year._id, programId: program._id, semester })) throw fieldsError({ semester: `${program.code} semester ${semester} already has a window in ${year.name}` })
    const reg = regulationRules(program.regulationId ? await Regulation.findById(program.regulationId).lean() : null)
    const defaults = input.offerings ? {} : await defaultOfferings(program._id, semester)
    const w = await RegistrationWindow.create({
      minCredits: reg.semesterMinCredits ?? undefined, maxCredits: reg.semesterMaxCredits ?? undefined,
      ...defaults, ...input, programId: program._id, academicYearId: year._id, createdBy: auth.user?.name,
    })
    await audit(AUDIT('registration_window', w, `Opened registration for ${program.code} semester ${semester} (${opensOn} to ${closesOn})`, { action: 'CREATE', entityName: `${program.code} S${semester}` }), req)
    return getWindow(w._id)
  }
  const { programId: _p, academicYearId: _y, ...rest } = input
  Object.assign(before, rest)
  await before.save()
  await audit(AUDIT('registration_window', before, `Updated registration for ${program.code} semester ${before.semester}`, { entityName: `${program.code} S${before.semester}` }), req)
  return getWindow(before._id)
}

/** Delete a window opened by mistake (wrong semester or program). Once any student has registered in it, it stays — close it instead. */
export async function deleteWindow(id, auth, req) {
  const w = await windowDoc(id, auth)
  await assertProgramInScope(w.programId, auth, 'registration')
  const n = await CourseRegistration.countDocuments({ windowId: w._id })
  if (n) throw conflict(`${n} student${n === 1 ? ' has' : 's have'} registered in this window. Close it instead.`)
  await w.deleteOne()
  await audit(AUDIT('registration_window', w, `Deleted the registration window for semester ${w.semester} (opened by mistake)`, { action: 'DELETE', entityName: `S${w.semester}` }), req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── a student's selection

/** Courses a student has passed (latest attempt passed, in published results). */
export async function passedCourseIds(studentId) {
  const published = await CoeSession.find({ status: 'PUBLISHED' }).select('_id').lean()
  const rows = await CoeResult.find({ studentId, sessionId: { $in: published.map((s) => s._id) } }).select('courseId pass order').sort({ order: 1 }).lean()
  const latest = new Map()
  for (const r of rows) latest.set(String(r.courseId), r.pass)
  return new Set([...latest].filter(([, pass]) => pass).map(([k]) => k))
}

async function enrolmentFor(w, studentId, advisorId) {
  if (!isOid(studentId)) throw notFound('Student')
  const e = await ProgramEnrolment.findOne({ studentId, programId: w.programId }).lean()
  if (!e) throw fieldsError({ studentId: 'This student is not in the program' })
  if (advisorId && String(e.advisorId) !== String(advisorId)) throw notFound('Student')
  return e
}

/** What the registration form needs for one student: offerings with seats left and prerequisite status, and their selection. */
export async function registrationForm(windowId, studentId, auth) {
  const w = await getWindow(windowId, auth)
  const { advisorId } = await regScope(auth)
  const e = await enrolmentFor(w, studentId, advisorId)
  const [current, taken, passed, student, courses] = await Promise.all([
    CourseRegistration.findOne({ windowId: w.id, studentId }).lean(),
    seatsTaken(w.id, studentId),
    passedCourseIds(studentId),
    Student.findById(studentId).select('firstName middleName lastName admissionNo').lean(),
    ProgramCourse.find({ _id: { $in: w.offerings.map((o) => o.courseId) } }).select('prerequisiteIds').lean(),
  ])
  const pre = new Map(courses.map((c) => [String(c._id), (c.prerequisiteIds ?? []).map(String)]))
  return {
    window: w,
    student: { id: String(studentId), name: studentName(student), admissionNo: student?.admissionNo, registerNo: e.registerNo ?? null, semester: e.currentSemester, status: e.status },
    registration: current ? { ...clean(current), courseIds: current.courseIds.map(String) } : null,
    offerings: w.offerings.map((o) => {
      const missing = (pre.get(o.courseId) ?? []).filter((x) => !passed.has(x))
      return { ...o, seatsLeft: o.seats ? Math.max(0, o.seats - (taken.get(o.courseId) ?? 0)) : null, prerequisitesMet: missing.length === 0 }
    }),
  }
}

/**
 * Enter or change a student's selection. Refused while the window is not open, and with every problem listed
 * (details.errors) when a rule is broken. With approval on, a change goes back to waiting for approval.
 */
export async function saveRegistration(windowId, { studentId, courseIds }, auth, req) {
  const w = await windowDoc(windowId, auth)
  const day = await today()
  const state = regWindowStatus(w, day)
  if (state === 'UPCOMING') throw conflict(`Registration opens on ${w.opensOn}.`)
  if (state === 'CLOSED') throw conflict('Registration is closed for this semester — add / drop is no longer possible.')
  const { advisorId } = await regScope(auth)
  const e = await enrolmentFor(w, studentId, advisorId)
  if (e.status !== 'ACTIVE') throw conflict('Only students who are studying can register.')
  if (e.currentSemester !== w.semester) throw conflict(`This student is in semester ${e.currentSemester}, not ${w.semester}.`)

  const picked = [...new Set(courseIds.map(String))]
  const courses = await ProgramCourse.find({ _id: { $in: picked } }).lean()
  const byId = new Map(courses.map((c) => [String(c._id), c]))
  const { credits, errors } = checkRegistration(w.toObject(), byId, picked)
  // seats
  const taken = await seatsTaken(w._id, studentId)
  const current = await CourseRegistration.findOne({ windowId: w._id, studentId })
  const had = new Set((current?.status !== 'REJECTED' ? current?.courseIds ?? [] : []).map(String))
  for (const o of w.offerings) {
    const k = String(o.courseId)
    if (!picked.includes(k) || had.has(k) || !o.seats) continue
    if ((taken.get(k) ?? 0) >= o.seats) errors.push({ code: 'SEATS_FULL', courseId: k, message: `${byId.get(k)?.code} is full (${o.seats} seats)` })
  }
  // prerequisites
  const passed = await passedCourseIds(studentId)
  const preIds = [...new Set(courses.flatMap((c) => (c.prerequisiteIds ?? []).map(String)))]
  const preCode = new Map((await ProgramCourse.find({ _id: { $in: preIds } }).select('code').lean()).map((c) => [String(c._id), c.code]))
  for (const c of courses) {
    const missing = (c.prerequisiteIds ?? []).map(String).filter((x) => !passed.has(x))
    if (missing.length) errors.push({ code: 'PREREQUISITE', courseId: String(c._id), message: `${c.code} needs ${missing.map((x) => preCode.get(x)).join(', ')} passed first` })
  }
  if (errors.length) throw badRequest(errors[0].message, { errors })

  const before = current ? current.courseIds.map(String) : []
  const added = picked.filter((x) => !before.includes(x))
  const dropped = before.filter((x) => !picked.includes(x))
  const droppedCodes = new Map((await ProgramCourse.find({ _id: { $in: dropped } }).select('code').lean()).map((c) => [String(c._id), c.code]))
  const codes = (ids) => ids.map((x) => byId.get(x)?.code ?? droppedCodes.get(x) ?? x)
  const status = w.requireApproval ? 'SUBMITTED' : 'APPROVED'
  const by = auth.user?.name
  const doc = current ?? new CourseRegistration({ windowId: w._id, enrolmentId: e._id, studentId, programId: w.programId, academicYearId: w.academicYearId, semester: w.semester })
  if (current && !added.length && !dropped.length && current.status !== 'REJECTED') return registrationOut(current.toObject())
  Object.assign(doc, { courseIds: picked, credits, status, note: undefined, decidedBy: w.requireApproval ? undefined : by, decidedAt: w.requireApproval ? undefined : new Date() })
  doc.history.push({ by, action: current ? 'CHANGED' : 'SUBMITTED', added: current ? codes(added) : codes(picked), dropped: dropped.length ? codes(dropped) : undefined })
  await doc.save()
  const s = await Student.findById(studentId).select('firstName middleName lastName').lean()
  await audit({ action: current ? 'UPDATE' : 'CREATE', module: 'registration', entityType: 'course_registration', entityId: String(doc._id), entityName: studentName(s), summary: `${current ? 'Changed' : 'Registered'} ${studentName(s)} for semester ${w.semester} (${credits} credits)${added.length && current ? ` · added ${codes(added).join(', ')}` : ''}${dropped.length ? ` · dropped ${codes(dropped).join(', ')}` : ''}` }, req)
  return registrationOut(doc.toObject())
}

const registrationOut = (r) => ({ ...clean(r), courseIds: (r.courseIds ?? []).map(String) })

// ───────────────────────────────────────────────────────── the requests list and decisions

/**
 * A window's registrations, plus the program-semester's students who have not registered yet. `summary` counts the
 * whole window.
 */
export async function listRegistrations(windowId, auth, { status } = {}) {
  const w = await windowDoc(windowId, auth)
  const { advisorId } = await regScope(auth)
  const enrolments = await ProgramEnrolment.find({ programId: w.programId, currentSemester: w.semester, status: 'ACTIVE', ...(advisorId && { advisorId }) }).lean()
  const regs = await CourseRegistration.find({ windowId: w._id, ...(advisorId && { enrolmentId: { $in: enrolments.map((e) => e._id) } }) }).lean()
  const ids = [...new Set([...enrolments.map((e) => String(e.studentId)), ...regs.map((r) => String(r.studentId))])]
  const [students, courses, advisors] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo gender').lean(),
    ProgramCourse.find({ _id: { $in: w.offerings.map((o) => o.courseId) } }).select('code title credits type').lean(),
    User.find({ _id: { $in: enrolments.map((e) => e.advisorId).filter(Boolean) } }).select('name').lean(),
  ])
  const st = new Map(students.map((s) => [String(s._id), s]))
  const code = new Map(courses.map((c) => [String(c._id), c.code]))
  const adv = new Map(advisors.map((u) => [String(u._id), u.name]))
  const enr = new Map(enrolments.map((e) => [String(e.studentId), e]))
  const regBy = new Map(regs.map((r) => [String(r.studentId), r]))
  const rows = ids.map((sid) => {
    const r = regBy.get(sid)
    const e = enr.get(sid)
    const s = st.get(sid)
    return {
      id: r ? String(r._id) : `student-${sid}`, registrationId: r ? String(r._id) : null, studentId: sid,
      name: studentName(s), admissionNo: s?.admissionNo ?? null, gender: s?.gender ?? null, registerNo: e?.registerNo ?? null,
      advisorName: adv.get(idStr(e?.advisorId)) ?? null,
      status: r?.status ?? 'NOT_REGISTERED', credits: r?.credits ?? 0,
      courses: (r?.courseIds ?? []).map((c) => code.get(String(c))).filter(Boolean),
      courseIds: (r?.courseIds ?? []).map(String),
      note: r?.note ?? null, decidedBy: r?.decidedBy ?? null, decidedAt: r?.decidedAt ?? null, updatedAt: r?.updatedAt ?? null,
      history: r?.history ?? [],
    }
  }).sort((a, b) => String(a.registerNo ?? a.admissionNo).localeCompare(String(b.registerNo ?? b.admissionNo)))
  const summary = { total: rows.length, NOT_REGISTERED: 0, ...Object.fromEntries(Object.keys(REG_STATUS).map((k) => [k, 0])) }
  for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1
  return { rows: status ? rows.filter((r) => r.status === status) : rows, summary }
}

/** Approve or reject registrations waiting for approval (one or many). Others are skipped. */
export async function decideRegistrations(ids, { action, note }, auth, req) {
  if (action === 'REJECT' && !note) throw fieldsError({ note: 'Say why — the student will be told' })
  const rows = await CourseRegistration.find({ _id: { $in: ids } })
  const { programIds, advisorId } = await regScope(auth)
  let done = 0
  let skipped = 0
  for (const r of rows) {
    const inScope = (!programIds || programIds.includes(String(r.programId))) && (!advisorId || await ProgramEnrolment.exists({ _id: r.enrolmentId, advisorId }))
    if (!inScope || r.status !== 'SUBMITTED') { skipped++; continue }
    r.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    r.note = note || undefined
    r.decidedBy = auth.user?.name
    r.decidedAt = new Date()
    r.history.push({ by: auth.user?.name, action: r.status, note })
    await r.save()
    done++
  }
  skipped += ids.length - rows.length
  if (done) await audit({ action: 'UPDATE', module: 'registration', entityType: 'course_registration', entityName: `${done} registration(s)`, summary: `${action === 'APPROVE' ? 'Approved' : 'Rejected'} ${done} course registration(s)${note ? `: ${note}` : ''}` }, req)
  return { done, skipped }
}

// ───────────────────────────────────────────────────────── course rosters

/** Students per course in a window: approved and waiting. */
export async function windowRosters(windowId, auth) {
  const w = await getWindow(windowId, auth)
  return w.offerings.map((o) => ({ courseId: o.courseId, code: o.code, title: o.title, credits: o.credits, type: o.type, group: o.group, seats: o.seats ?? null, registered: o.taken, approved: o.approved }))
}

export async function courseRoster(windowId, courseId, auth) {
  const w = await windowDoc(windowId, auth)
  if (!isOid(courseId) || !w.offerings.some((o) => String(o.courseId) === String(courseId))) throw notFound('Course')
  const regs = await CourseRegistration.find({ windowId: w._id, courseIds: oid(courseId), ...TAKEN }).lean()
  const [students, enrolments, course] = await Promise.all([
    Student.find({ _id: { $in: regs.map((r) => r.studentId) } }).select('firstName middleName lastName admissionNo gender').lean(),
    ProgramEnrolment.find({ _id: { $in: regs.map((r) => r.enrolmentId) } }).select('registerNo studentId').lean(),
    ProgramCourse.findById(courseId).select('code title credits').lean(),
  ])
  const st = new Map(students.map((s) => [String(s._id), s]))
  const reg = new Map(enrolments.map((e) => [String(e.studentId), e.registerNo]))
  return {
    course: clean(course),
    students: regs.map((r) => {
      const s = st.get(String(r.studentId))
      return { id: String(r.studentId), name: studentName(s), admissionNo: s?.admissionNo, gender: s?.gender ?? null, registerNo: reg.get(String(r.studentId)) ?? null, status: r.status }
    }).sort((a, b) => String(a.registerNo ?? a.admissionNo).localeCompare(String(b.registerNo ?? b.admissionNo))),
  }
}

/**
 * For the exam controller: the courses each student takes in a program-semester of a year, from approved registrations.
 * → Map studentId → [courseId], or null when the semester has no registration window (everyone takes the curriculum).
 */
export async function registeredCourses({ academicYearId, programId, semester }) {
  const w = await RegistrationWindow.findOne({ academicYearId, programId, semester }).select('_id').lean()
  if (!w) return null
  const regs = await CourseRegistration.find({ windowId: w._id, status: 'APPROVED' }).select('studentId courseIds').lean()
  return new Map(regs.map((r) => [String(r.studentId), r.courseIds.map(String)]))
}
