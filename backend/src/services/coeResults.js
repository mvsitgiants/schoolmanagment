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

/** Students a search names — every word in their name or admission no., or the register no. — as ids for a Mongo filter. */
async function studentIdsMatching(q) {
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5)
  const byName = { $and: words.map((w) => { const re = new RegExp(escapeRegex(w), 'i'); return { $or: [{ firstName: re }, { middleName: re }, { lastName: re }, { admissionNo: re }] } }) }
  const [students, enrolments] = await Promise.all([
    Student.find(byName).select('_id').lean(),
    ProgramEnrolment.find({ registerNo: new RegExp(escapeRegex(q), 'i') }).select('studentId').lean(),
  ])
  return [...students.map((x) => x._id), ...enrolments.map((e) => e.studentId)]
}

/**
 * Aggregation stages that order rows by the student's register no. (else admission no.), then `_id` for stable pages, and
 * cut one page — the register no. lives on the enrolment, the admission no. on the student, so both are looked up.
 */
const byRegisterNo = (page, pageSize) => [
  { $lookup: { from: ProgramEnrolment.collection.name, localField: 'studentId', foreignField: 'studentId', as: '_e', pipeline: [{ $project: { registerNo: 1 } }] } },
  { $lookup: { from: Student.collection.name, localField: 'studentId', foreignField: '_id', as: '_s', pipeline: [{ $project: { admissionNo: 1 } }] } },
  { $addFields: { _key: { $ifNull: [{ $arrayElemAt: ['$_e.registerNo', 0] }, { $arrayElemAt: ['$_s.admissionNo', 0] }] } } },
  { $sort: { _key: 1, _id: 1 } },
  { $skip: (page - 1) * pageSize },
  { $limit: pageSize },
  { $project: { _e: 0, _s: 0, _key: 0 } },
]

// ───────────────────────────────────────────────────────── grade cards list

const GRADE_ORDER = ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F', 'Ab']
const SGPA_BUCKETS = [[9, 10.01], [8, 9], [7, 8], [6, 7], [5, 6], [0, 5]]

/**
 * A session's semester results (grade cards), one page at a time in register-number order, with the picture for the page —
 * pass %, average SGPA, grade spread — over every result of the session / program / semester (not just the page, and not
 * narrowed by `result` or `search`, which pick rows). `result`: PASS · FAIL · ARREARS (any arrears).
 */
export async function listSemesterResults(sessionId, auth, { programId, semester, result, search, page = 1, pageSize = 50 } = {}) {
  const s = await sessionDoc(sessionId)
  const ids = await coeProgramIds(auth)
  const programs = programId && inScope(ids, programId) ? [oid(programId)] : ids?.map(oid)
  const base = { sessionId: s._id, ...(programs && { programId: { $in: programs } }), ...(semester && { semester }) }
  const f = { ...base }
  if (result === 'ARREARS') f.arrears = { $gt: 0 }
  else if (result) f.result = result
  const q = String(search ?? '').trim()
  if (q) f.studentId = { $in: await studentIdsMatching(q) }
  const [rows, total, [sum], grades] = await Promise.all([
    CoeSemesterResult.aggregate([{ $match: f }, ...byRegisterNo(page, pageSize)]),
    CoeSemesterResult.countDocuments(f),
    CoeSemesterResult.aggregate([{ $match: base }, {
      $group: {
        _id: null, students: { $sum: 1 },
        passed: { $sum: { $cond: [{ $eq: ['$result', 'PASS'] }, 1, 0] } },
        withArrears: { $sum: { $cond: [{ $gt: ['$arrears', 0] }, 1, 0] } },
        averageSgpa: { $avg: '$sgpa' }, topSgpa: { $max: '$sgpa' },
        ...Object.fromEntries(SGPA_BUCKETS.map(([lo, hi], i) => [`b${i}`, { $sum: { $cond: [{ $and: [{ $isNumber: '$sgpa' }, { $gte: ['$sgpa', lo] }, { $lt: ['$sgpa', hi] }] }, 1, 0] } }])),
      },
    }]),
    CoeResult.aggregate([{ $match: base }, { $group: { _id: '$grade', n: { $sum: 1 } } }]),
  ])
  const [people, programDocs] = await Promise.all([
    peopleOf(rows.map((r) => r.studentId)),
    Program.find({ _id: { $in: rows.map((r) => r.programId) } }).select('code name').lean(),
  ])
  const code = new Map(programDocs.map((p) => [String(p._id), p.code]))
  const rank = (g) => (GRADE_ORDER.includes(g) ? GRADE_ORDER.indexOf(g) : GRADE_ORDER.length)
  const students = sum?.students ?? 0
  return {
    session: { ...clean(s.toObject()), monthLabel: examMonthLabel(s.examMonth) },
    rows: rows.map((r) => ({ ...clean(r), ...people.get(String(r.studentId)), studentId: String(r.studentId), programCode: code.get(String(r.programId)) ?? null })),
    total, page, pageSize,
    summary: {
      students,
      passed: sum?.passed ?? 0,
      passPct: students ? round((sum.passed / students) * 100, 1) : null,
      averageSgpa: sum?.averageSgpa === null || sum?.averageSgpa === undefined ? null : round(sum.averageSgpa),
      topSgpa: sum?.topSgpa ?? null,
      withArrears: sum?.withArrears ?? 0,
      grades: grades.map((g) => ({ grade: g._id, count: g.n })).sort((a, b) => rank(a.grade) - rank(b.grade)),
      sgpaBuckets: SGPA_BUCKETS.map(([lo, hi], i) => ({ label: hi > 10 ? '9–10' : lo === 0 ? '< 5' : `${lo}–${hi}`, value: sum?.[`b${i}`] ?? 0 })),
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

/**
 * Revaluation requests, one page at a time (latest first). The tiles (`summary`: by status, improved, fees collected) count
 * every request of the session in the caller's programs — not narrowed by `status` or `search`, which pick rows. A program
 * scope reads through the course (a result's program is its course's).
 */
export async function listRevaluations(auth, { sessionId, status, search, page = 1, pageSize = 50 } = {}) {
  const ids = await coeProgramIds(auth)
  const base = { ...(sessionId && { sessionId: oid(sessionId) }) }
  if (ids) base.courseId = { $in: (await ProgramCourse.find({ programId: { $in: ids.map(oid) } }).select('_id').lean()).map((c) => c._id) }
  const f = { ...base, ...(status && { status }) }
  const q = String(search ?? '').trim()
  if (q) f.studentId = { $in: await studentIdsMatching(q) }
  const [rows, total, counts] = await Promise.all([
    CoeRevaluation.find(f).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    CoeRevaluation.countDocuments(f),
    CoeRevaluation.aggregate([{ $match: base }, {
      $group: {
        _id: '$status', n: { $sum: 1 },
        improved: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'REVALUED'] }, { $gt: ['$newMarks', '$oldMarks'] }] }, 1, 0] } },
        fees: { $sum: { $cond: ['$feePaid', { $ifNull: ['$fee', 0] }, 0] } },
      },
    }]),
  ])
  const [results, people, courses, sessions] = await Promise.all([
    CoeResult.find({ _id: { $in: rows.map((r) => r.resultId) } }).select('externalMax grade').lean(),
    peopleOf(rows.map((r) => r.studentId)),
    ProgramCourse.find({ _id: { $in: rows.map((r) => r.courseId) } }).select('code title').lean(),
    CoeSession.find({ _id: { $in: rows.map((r) => r.sessionId) } }).select('name').lean(),
  ])
  const res = new Map(results.map((r) => [String(r._id), r]))
  const cd = new Map(courses.map((c) => [String(c._id), c]))
  const sn = new Map(sessions.map((x) => [String(x._id), x.name]))
  const list = rows.map((r) => ({
    ...clean(r), ...people.get(String(r.studentId)), studentId: String(r.studentId),
    courseCode: cd.get(String(r.courseId))?.code, courseTitle: cd.get(String(r.courseId))?.title, sessionName: sn.get(String(r.sessionId)),
    externalMax: res.get(String(r.resultId))?.externalMax ?? null, currentGrade: res.get(String(r.resultId))?.grade ?? null,
    change: r.newMarks !== null && r.newMarks !== undefined ? round(r.newMarks - r.oldMarks) : null,
  }))
  const summary = { total: 0, REQUESTED: 0, APPROVED: 0, REVALUED: 0, REJECTED: 0, improved: 0, fees: 0 }
  for (const c of counts) {
    summary.total += c.n
    summary[c._id] = (summary[c._id] ?? 0) + c.n
    summary.improved += c.improved
    summary.fees += c.fees
  }
  return { rows: list, total, page, pageSize, summary }
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
