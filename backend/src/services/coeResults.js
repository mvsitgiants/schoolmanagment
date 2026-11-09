import { classificationOf, courseResultOf } from '@schoolgiant/shared'
import { AcademicYear } from '../models/academics.js'
import { CoeResult, CoeRevaluation, CoeSemesterResult, CoeSession } from '../models/coe.js'
import { ProgramCourse, Program, ProgramEnrolment, Regulation } from '../models/programs.js'
import { Student, studentName } from '../models/students.js'
import { Department } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'
import { coeProgramIds, examMonthLabel, failReasonLabel, refreshStudent, sessionDoc } from './coe.js'
import { regulationRules } from './programs.js'

// Exam controller results (module `coe`): the grade-card list with its picture (pass %, grade spread, SGPA), one
// student's results, revaluation (REQUESTED → APPROVED → REVALUED, the higher of the old and new marks counts), and
// the data of the printed grade card and consolidated transcript.

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const inScope = (ids, programId) => !ids || ids.includes(String(programId))

async function peopleOf(studentIds) {
  const [students, enrolments] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('firstName middleName lastName admissionNo gender dob').lean(),
    ProgramEnrolment.find({ studentId: { $in: studentIds } }).select('studentId registerNo batch').lean(),
  ])
  const reg = new Map(enrolments.map((e) => [String(e.studentId), e]))
  return new Map(students.map((s) => [String(s._id), { name: studentName(s), admissionNo: s.admissionNo, gender: s.gender ?? null, dob: s.dob ?? null, registerNo: reg.get(String(s._id))?.registerNo ?? null, batch: reg.get(String(s._id))?.batch ?? null, enrolmentId: reg.get(String(s._id)) ? String(reg.get(String(s._id))._id) : null }]))
}

// ───────────────────────────────────────────────────────── grade cards list

/** A session's semester results (grade cards) with the picture for the page: pass %, average SGPA, grade spread. */
export async function listSemesterResults(sessionId, auth, { programId, semester } = {}) {
  const s = await sessionDoc(sessionId)
  const ids = await coeProgramIds(auth)
  const filter = {
    sessionId: s._id,
    ...(ids && { programId: { $in: ids.map(oid) } }),
    ...(programId && inScope(ids, programId) && { programId: oid(programId) }),
    ...(semester && { semester }),
  }
  const rows = await CoeSemesterResult.find(filter).lean()
  const [people, programs, grades] = await Promise.all([
    peopleOf(rows.map((r) => r.studentId)),
    Program.find({ _id: { $in: rows.map((r) => r.programId) } }).select('code name').lean(),
    CoeResult.aggregate([{ $match: { sessionId: s._id, studentId: { $in: rows.map((r) => r.studentId) } } }, { $group: { _id: '$grade', n: { $sum: 1 } } }]),
  ])
  const code = new Map(programs.map((p) => [String(p._id), p.code]))
  const list = rows.map((r) => ({ ...clean(r), ...people.get(String(r.studentId)), studentId: String(r.studentId), programCode: code.get(String(r.programId)) ?? null }))
    .sort((a, b) => String(a.registerNo ?? a.admissionNo).localeCompare(String(b.registerNo ?? b.admissionNo)))
  const sgpas = list.map((r) => r.sgpa).filter((v) => v !== null && v !== undefined)
  const buckets = [[9, 10.01], [8, 9], [7, 8], [6, 7], [5, 6], [0, 5]].map(([lo, hi]) => ({ label: hi > 10 ? '9–10' : lo === 0 ? '< 5' : `${lo}–${hi}`, value: sgpas.filter((v) => v >= lo && v < hi).length }))
  const order = ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F', 'Ab']
  const rank = (g) => (order.includes(g) ? order.indexOf(g) : order.length)
  return {
    session: { ...clean(s.toObject()), monthLabel: examMonthLabel(s.examMonth) },
    rows: list,
    summary: {
      students: list.length,
      passed: list.filter((r) => r.result === 'PASS').length,
      passPct: list.length ? round((list.filter((r) => r.result === 'PASS').length / list.length) * 100, 1) : null,
      averageSgpa: sgpas.length ? round(sgpas.reduce((a, b) => a + b, 0) / sgpas.length) : null,
      topSgpa: sgpas.length ? Math.max(...sgpas) : null,
      withArrears: list.filter((r) => r.arrears > 0).length,
      grades: grades.map((g) => ({ grade: g._id, count: g.n })).sort((a, b) => rank(a.grade) - rank(b.grade)),
      sgpaBuckets: buckets,
    },
  }
}

/** One student's semester in a session: course grades, plus their SGPA / CGPA over every published session. */
export async function semesterResultDetail(id, auth) {
  if (!isOid(id)) throw notFound('Result')
  const r = await CoeSemesterResult.findById(id).lean()
  if (!r || !inScope(await coeProgramIds(auth), r.programId)) throw notFound('Result')
  const [courses, people, history] = await Promise.all([
    CoeResult.find({ sessionId: r.sessionId, studentId: r.studentId, semester: r.semester }).lean(),
    peopleOf([r.studentId]),
    CoeSemesterResult.find({ studentId: r.studentId }).lean(),
  ])
  const [courseDocs, sessions, revals] = await Promise.all([
    ProgramCourse.find({ _id: { $in: courses.map((c) => c.courseId) } }).select('code title type').lean(),
    CoeSession.find({ _id: { $in: history.map((h) => h.sessionId) } }).select('name examMonth createdAt status').lean(),
    CoeRevaluation.find({ resultId: { $in: courses.map((c) => c._id) } }).select('resultId status').lean(),
  ])
  const cd = new Map(courseDocs.map((c) => [String(c._id), c]))
  const sess = new Map(sessions.map((x) => [String(x._id), x]))
  const rv = new Map(revals.map((x) => [String(x.resultId), x.status]))
  return {
    ...clean(r), ...people.get(String(r.studentId)), studentId: String(r.studentId),
    courses: courses.map((c) => ({ ...clean(c), code: cd.get(String(c.courseId))?.code, title: cd.get(String(c.courseId))?.title, type: cd.get(String(c.courseId))?.type, reasonLabel: failReasonLabel(c.reason), revaluation: rv.get(String(c._id)) ?? null }))
      .sort((a, b) => String(a.code).localeCompare(String(b.code))),
    trend: history.filter((h) => sess.get(String(h.sessionId))?.status === 'PUBLISHED' || String(h._id) === String(r._id))
      .sort((a, b) => (sess.get(String(a.sessionId))?.createdAt ?? 0) - (sess.get(String(b.sessionId))?.createdAt ?? 0) || a.semester - b.semester)
      .map((h) => ({ id: String(h._id), semester: h.semester, session: sess.get(String(h.sessionId))?.name, sgpa: h.sgpa, cgpa: h.cgpa })),
  }
}

// ───────────────────────────────────────────────────────── revaluation

const REVAL_FLOW = { APPROVE: ['REQUESTED', 'APPROVED'], REJECT: ['REQUESTED', 'REJECTED'] }

export async function listRevaluations(auth, { sessionId, status } = {}) {
  const ids = await coeProgramIds(auth)
  const rows = await CoeRevaluation.find({ ...(sessionId && { sessionId: oid(sessionId) }), ...(status && { status }) }).sort({ createdAt: -1 }).limit(1000).lean()
  const results = new Map((await CoeResult.find({ _id: { $in: rows.map((r) => r.resultId) } }).select('programId semester externalMax grade').lean()).map((r) => [String(r._id), r]))
  const visible = rows.filter((r) => inScope(ids, results.get(String(r.resultId))?.programId))
  const [people, courses, sessions] = await Promise.all([
    peopleOf(visible.map((r) => r.studentId)),
    ProgramCourse.find({ _id: { $in: visible.map((r) => r.courseId) } }).select('code title').lean(),
    CoeSession.find({ _id: { $in: visible.map((r) => r.sessionId) } }).select('name').lean(),
  ])
  const cd = new Map(courses.map((c) => [String(c._id), c]))
  const sn = new Map(sessions.map((x) => [String(x._id), x.name]))
  const list = visible.map((r) => ({
    ...clean(r), ...people.get(String(r.studentId)), studentId: String(r.studentId),
    courseCode: cd.get(String(r.courseId))?.code, courseTitle: cd.get(String(r.courseId))?.title, sessionName: sn.get(String(r.sessionId)),
    externalMax: results.get(String(r.resultId))?.externalMax ?? null, currentGrade: results.get(String(r.resultId))?.grade ?? null,
    change: r.newMarks !== null && r.newMarks !== undefined ? round(r.newMarks - r.oldMarks) : null,
  }))
  const summary = { total: list.length, REQUESTED: 0, APPROVED: 0, REVALUED: 0, REJECTED: 0, improved: list.filter((r) => r.status === 'REVALUED' && r.change > 0).length, fees: list.filter((r) => r.feePaid).reduce((n, r) => n + (r.fee || 0), 0) }
  for (const r of list) summary[r.status]++
  return { rows: list, summary }
}

/** Results a revaluation can be asked for: a published session's results with end-semester marks, by student search. */
export async function revaluationCandidates(sessionId, search, auth) {
  const s = await sessionDoc(sessionId)
  if (s.status !== 'PUBLISHED') return []
  const ids = await coeProgramIds(auth)
  const q = String(search ?? '').trim()
  let studentFilter = {}
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i')
    const [students, enrolments] = await Promise.all([
      Student.find({ $or: [{ firstName: rx }, { lastName: rx }, { admissionNo: rx }] }).select('_id').limit(100).lean(),
      ProgramEnrolment.find({ registerNo: rx }).select('studentId').limit(100).lean(),
    ])
    studentFilter = { studentId: { $in: [...students.map((x) => x._id), ...enrolments.map((e) => e.studentId)] } }
  }
  const rows = await CoeResult.find({ sessionId: s._id, externalMax: { $gt: 0 }, absent: false, ...studentFilter, ...(ids && { programId: { $in: ids.map(oid) } }) }).limit(200).lean()
  const [people, courses, taken] = await Promise.all([
    peopleOf(rows.map((r) => r.studentId)),
    ProgramCourse.find({ _id: { $in: rows.map((r) => r.courseId) } }).select('code title').lean(),
    CoeRevaluation.find({ resultId: { $in: rows.map((r) => r._id) } }).select('resultId').lean(),
  ])
  const cd = new Map(courses.map((c) => [String(c._id), c]))
  const asked = new Set(taken.map((x) => String(x.resultId)))
  return rows.filter((r) => !asked.has(String(r._id))).map((r) => ({
    id: String(r._id), studentId: String(r.studentId), ...people.get(String(r.studentId)), courseCode: cd.get(String(r.courseId))?.code, courseTitle: cd.get(String(r.courseId))?.title,
    external: r.external, externalMax: r.externalMax, grade: r.grade, pass: r.pass,
  }))
}

export async function requestRevaluation(input, auth, req) {
  if (!isOid(input.resultId)) throw notFound('Result')
  const r = await CoeResult.findById(input.resultId).lean()
  if (!r || !inScope(await coeProgramIds(auth), r.programId)) throw notFound('Result')
  const s = await CoeSession.findById(r.sessionId).lean()
  if (s.status !== 'PUBLISHED') throw conflict('Revaluation opens once the results are published.')
  if (!r.externalMax || r.absent) throw badRequest('There is no end-semester script to re-evaluate.')
  if (await CoeRevaluation.exists({ resultId: r._id })) throw conflict('A revaluation was already asked for this paper.')
  const doc = await CoeRevaluation.create({
    sessionId: r.sessionId, resultId: r._id, studentId: r.studentId, courseId: r.courseId,
    fee: input.fee ?? s.revaluationFee ?? 0, feePaid: !!input.feePaid, reason: input.reason,
    oldMarks: r.external, oldGrade: r.grade, requestedBy: auth.user?.name,
    history: [{ by: auth.user?.name, action: 'REQUESTED', note: input.reason }],
  })
  const [st, c] = await Promise.all([Student.findById(r.studentId).select('firstName middleName lastName').lean(), ProgramCourse.findById(r.courseId).select('code').lean()])
  await audit({ action: 'CREATE', module: 'coe', entityType: 'coe_revaluation', entityId: String(doc._id), entityName: studentName(st), summary: `Revaluation asked for ${studentName(st)} in ${c?.code} (marks ${r.external}/${r.externalMax})` }, req)
  return clean(doc.toObject())
}

/** APPROVE / REJECT a request, or REVALUE an approved one with the new marks (the higher of old and new counts). */
export async function actOnRevaluation(id, input, auth, req) {
  if (!isOid(id)) throw notFound('Revaluation')
  const doc = await CoeRevaluation.findById(id)
  if (!doc) throw notFound('Revaluation')
  const r = await CoeResult.findById(doc.resultId)
  if (!r || !inScope(await coeProgramIds(auth), r.programId)) throw notFound('Revaluation')
  const by = auth.user?.name
  if (input.action === 'REVALUE') {
    if (doc.status !== 'APPROVED') throw conflict('Approve the request before entering the new marks.')
    if (input.newMarks === undefined || input.newMarks === null) throw badRequest('Enter the new marks.', { fields: { newMarks: 'Required' } })
    if (input.newMarks > r.externalMax) throw badRequest(`Out of ${r.externalMax}.`, { fields: { newMarks: `0 to ${r.externalMax}` } })
    const best = Math.max(Number(input.newMarks), Number(doc.oldMarks) || 0)
    const program = await Program.findById(r.programId).select('regulationId').lean()
    const rules = regulationRules(program?.regulationId ? await Regulation.findById(program.regulationId).lean() : null)
    const res = courseResultOf({ internal: r.internal, internalMax: r.internalMax, external: best, externalMax: r.externalMax, absent: false }, rules)
    Object.assign(r, { external: best, total: res.total, pct: res.pct, grade: res.grade, points: res.points, pass: res.pass, reason: res.reason, revalued: true })
    await r.save()
    Object.assign(doc, { status: 'REVALUED', newMarks: input.newMarks, newGrade: res.grade, note: input.note ?? doc.note })
    doc.history.push({ by, action: 'REVALUED', note: input.note ?? `${doc.oldMarks} → ${input.newMarks}` })
    await doc.save()
    await refreshStudent(r.studentId)
  } else {
    const [from, to] = REVAL_FLOW[input.action]
    if (doc.status !== from) throw conflict(`This request is ${doc.status.toLowerCase()} — it cannot be ${input.action === 'APPROVE' ? 'approved' : 'rejected'} now.`)
    if (input.action === 'REJECT' && !input.note) throw badRequest('Say why it is rejected.', { fields: { note: 'Required' } })
    doc.status = to
    if (input.feePaid !== undefined) doc.feePaid = input.feePaid
    if (input.note) doc.note = input.note
    doc.history.push({ by, action: to, note: input.note })
    await doc.save()
  }
  const [st, c] = await Promise.all([Student.findById(doc.studentId).select('firstName middleName lastName').lean(), ProgramCourse.findById(doc.courseId).select('code').lean()])
  await audit({ action: 'UPDATE', module: 'coe', entityType: 'coe_revaluation', entityId: String(doc._id), entityName: studentName(st), summary: input.action === 'REVALUE' ? `Revalued ${c?.code} for ${studentName(st)}: ${doc.oldMarks} → ${doc.newMarks} (grade ${doc.oldGrade} → ${doc.newGrade})` : `${input.action === 'APPROVE' ? 'Approved' : 'Rejected'} the revaluation of ${c?.code} for ${studentName(st)}` }, req)
  return clean(doc.toObject())
}

// ───────────────────────────────────────────────────────── printed documents

/** GRADE_CARD: one student's semester in a session. */
export async function gradeCardData(id, auth) {
  const d = await semesterResultDetail(id, auth)
  const [session, program] = await Promise.all([CoeSession.findById(d.sessionId).lean(), Program.findById(d.programId).lean()])
  const [year, dept, reg, student] = await Promise.all([
    AcademicYear.findById(session.academicYearId).select('name').lean(),
    program.departmentId ? Department.findById(program.departmentId).select('name').lean() : null,
    program.regulationId ? Regulation.findById(program.regulationId).lean() : null,
    Student.findById(d.studentId).select('language').lean(),
  ])
  return { detail: d, session, program, year, department: dept, regulation: regulationRules(reg), regulationCode: reg?.code ?? null, student }
}

/** TRANSCRIPT: every semester of a student's program, latest attempt of each course (published results). */
export async function transcriptData(enrolmentId, auth) {
  if (!isOid(enrolmentId)) throw notFound('Student')
  const e = await ProgramEnrolment.findById(enrolmentId).lean()
  if (!e || !inScope(await coeProgramIds(auth), e.programId)) throw notFound('Student')
  const published = await CoeSession.find({ status: 'PUBLISHED' }).select('name examMonth createdAt').lean()
  const sess = new Map(published.map((x) => [String(x._id), x]))
  const results = await CoeResult.find({ studentId: e.studentId, sessionId: { $in: published.map((x) => x._id) } }).sort({ order: 1 }).lean()
  const latest = new Map()
  for (const r of results) latest.set(String(r.courseId), r)
  const [program, people, courses, semRows] = await Promise.all([
    Program.findById(e.programId).lean(),
    peopleOf([e.studentId]),
    ProgramCourse.find({ _id: { $in: [...latest.keys()] } }).select('code title').lean(),
    CoeSemesterResult.find({ studentId: e.studentId, sessionId: { $in: published.map((x) => x._id) } }).lean(),
  ])
  const [reg, dept, student] = await Promise.all([
    program.regulationId || e.regulationId ? Regulation.findById(e.regulationId ?? program.regulationId).lean() : null,
    program.departmentId ? Department.findById(program.departmentId).select('name').lean() : null,
    Student.findById(e.studentId).select('language').lean(),
  ])
  const cd = new Map(courses.map((c) => [String(c._id), c]))
  const rules = regulationRules(reg)
  const semesters = [...new Set([...latest.values()].map((r) => r.semester))].sort((a, b) => a - b).map((semester) => {
    const rows = [...latest.values()].filter((r) => r.semester === semester)
    const lastRow = semRows.filter((x) => x.semester === semester).sort((a, b) => (sess.get(String(b.sessionId))?.createdAt ?? 0) - (sess.get(String(a.sessionId))?.createdAt ?? 0))[0]
    return {
      semester,
      sgpa: lastRow?.sgpa ?? null,
      credits: round(rows.reduce((n, r) => n + r.credits, 0), 1),
      earned: round(rows.filter((r) => r.pass).reduce((n, r) => n + r.credits, 0), 1),
      courses: rows.map((r) => ({ code: cd.get(String(r.courseId))?.code, title: cd.get(String(r.courseId))?.title, credits: r.credits, grade: r.grade, points: r.points, pass: r.pass, attempt: r.attempt, session: examMonthLabel(sess.get(String(r.sessionId))?.examMonth) ?? sess.get(String(r.sessionId))?.name })).sort((a, b) => String(a.code).localeCompare(String(b.code))),
    }
  })
  const all = [...latest.values()]
  const counted = all.filter((r) => rules.gpa.countFailed || r.pass)
  const credits = counted.reduce((n, r) => n + r.credits, 0)
  const cgpa = credits ? round(counted.reduce((n, r) => n + r.credits * (r.pass ? r.points : 0), 0) / credits, rules.gpa.decimals) : null
  const earned = round(all.filter((r) => r.pass).reduce((n, r) => n + r.credits, 0), 1)
  const arrears = all.filter((r) => !r.pass).length
  return {
    enrolment: e, program, department: dept, regulation: rules, regulationCode: reg?.code ?? null, student: { ...people.get(String(e.studentId)), language: student?.language },
    semesters, cgpa, earned, arrears,
    pct: cgpa !== null ? round(cgpa * (rules.gpa.pctMultiplier ?? 10), 2) : null,
    classification: arrears ? null : classificationOf(cgpa, rules.classification),
    complete: !arrears && earned >= (rules.minCredits || Infinity),
  }
}

export const latestSemesterResultId = async () => (await CoeSemesterResult.findOne().sort({ updatedAt: -1 }).select('_id').lean())?._id
export const latestTranscriptId = async () => {
  const r = await CoeSemesterResult.findOne({ published: true }).sort({ updatedAt: -1 }).select('studentId').lean()
  return r ? (await ProgramEnrolment.findOne({ studentId: r.studentId }).select('_id').lean())?._id : undefined
}
