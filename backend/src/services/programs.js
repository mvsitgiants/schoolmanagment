import {
  DEFAULT_ATTAINMENT_LEVELS, DEFAULT_CLASSIFICATION, DEFAULT_IA_COMPONENTS, UGC_CBCS_REGULATION, UGC_GRADE_SCALE,
  attainmentLevelOf, checkGradeScale, directAttainment, isElectiveType, poAttainmentOf,
} from '@schoolgiant/shared'
import { CoeMarkSheet, CoeResult, CoeSession } from '../models/coe.js'
import { ProgramCourse, Program, ProgramEnrolment, Regulation } from '../models/programs.js'
import { CourseRegistration, RegistrationWindow } from '../models/registration.js'
import { Student, studentName } from '../models/students.js'
import { Branch, Department, User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit, diffFields } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'

// Programs & OBE (module `programs`). Regulations are the rule books (credits, grading, pass marks, IA components);
// a program follows one; its courses carry the credits, the course outcomes and the CO–PO mapping. Students join a
// program through a ProgramEnrolment (batch, semester, advisor) — the Student record itself is not changed.
// Attainment reads the Exam controller's mark sheets: internal components and external marks per CO.

const AUDIT = (entityType, entity, summary, extra = {}) => ({
  action: extra.action ?? 'UPDATE', module: 'programs', entityType, entityId: String(entity._id), entityName: entity.code ?? entity.name, summary, ...extra,
})
const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

// ───────────────────────────────────────────────────────── scope (used by registration and the exam controller)

/**
 * Program ids a user may work with in a module, by the role's data scope: ALL → null (no limit) · BRANCH → programs on
 * the user's campus (or with no campus) · DEPARTMENT → programs of the user's departments · OWN → programs they coordinate.
 */
export async function programIdsInScope(auth, moduleId) {
  const scope = scopeOf(auth, moduleId)
  if (scope === 'ALL') return null
  const u = auth.user ?? {}
  let filter
  if (scope === 'BRANCH') {
    if (!u.branchId) return null
    filter = { $or: [{ branchId: u.branchId }, { branchId: null }] }
  } else if (scope === 'DEPARTMENT') filter = { departmentId: { $in: (u.departmentIds ?? []).map(oid) } }
  else filter = { coordinatorId: auth.userId }
  return (await Program.find(filter).select('_id').lean()).map((p) => String(p._id))
}

/** Throws 404 when the program is outside the caller's scope. */
export async function assertProgramInScope(programId, auth, moduleId) {
  const ids = await programIdsInScope(auth, moduleId)
  if (ids && !ids.includes(String(programId))) throw notFound('Program')
}

// ───────────────────────────────────────────────────────── regulations

const regulationOut = (r, usedBy = 0) => ({ ...clean(r), usedBy })

export async function listRegulations() {
  const [rows, used] = await Promise.all([
    Regulation.find().sort({ active: -1, code: -1 }).lean(),
    Program.aggregate([{ $group: { _id: '$regulationId', n: { $sum: 1 } } }]),
  ])
  const n = new Map(used.map((u) => [String(u._id), u.n]))
  return rows.map((r) => regulationOut(r, n.get(String(r._id)) ?? 0))
}

export async function getRegulation(id) {
  if (!isOid(id)) throw notFound('Regulation')
  const r = await Regulation.findById(id).lean()
  if (!r) throw notFound('Regulation')
  return r
}

/** A regulation with every rule filled in (old records, partial input) — what grading reads. */
export function regulationRules(r) {
  return {
    ...r,
    gradeScale: r?.gradeScale?.length ? r.gradeScale : UGC_GRADE_SCALE,
    iaComponents: r?.iaComponents?.length ? r.iaComponents : DEFAULT_IA_COMPONENTS,
    passRules: { ...UGC_CBCS_REGULATION.passRules, ...(r?.passRules ?? {}) },
    gpa: { ...UGC_CBCS_REGULATION.gpa, ...(r?.gpa ?? {}) },
    classification: r?.classification?.length ? r.classification : DEFAULT_CLASSIFICATION,
    attainment: { ...UGC_CBCS_REGULATION.attainment, ...(r?.attainment ?? {}), levels: r?.attainment?.levels?.length ? r.attainment.levels : DEFAULT_ATTAINMENT_LEVELS },
  }
}

export async function saveRegulation(id, input, req) {
  if (input.gradeScale) {
    const errors = checkGradeScale(input.gradeScale)
    if (Object.keys(errors).length) throw fieldsError(errors)
  }
  if (input.iaComponents) {
    const codes = input.iaComponents.map((c) => c.code)
    if (new Set(codes).size !== codes.length) throw fieldsError({ iaComponents: 'Each component needs its own code' })
  }
  if (input.semesterMinCredits && input.semesterMaxCredits && input.semesterMinCredits > input.semesterMaxCredits) throw fieldsError({ semesterMaxCredits: 'Must be at least the minimum' })
  if (input.code && await Regulation.exists({ code: input.code, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: `${input.code} is already a regulation` })
  if (!id) {
    const r = await Regulation.create({ ...UGC_CBCS_REGULATION, name: undefined, ...input })
    await audit(AUDIT('regulation', r, `Added regulation ${r.code}`, { action: 'CREATE' }), req)
    return regulationOut(r.toObject())
  }
  const r = await Regulation.findById(id)
  if (!r) throw notFound('Regulation')
  const before = r.toObject()
  Object.assign(r, input)
  await r.save()
  const changes = diffFields(before, r.toObject(), ['code', 'name', 'minCredits', 'semesterMinCredits', 'semesterMaxCredits', 'gradeScale', 'passRules', 'iaComponents', 'gpa', 'attainment', 'active'])
  await audit(AUDIT('regulation', r, `Updated regulation ${r.code}`, { changes }), req)
  return regulationOut(r.toObject())
}

export async function deleteRegulation(id, req) {
  const r = await Regulation.findById(id)
  if (!r) throw notFound('Regulation')
  const [programs, students] = await Promise.all([Program.countDocuments({ regulationId: r._id }), ProgramEnrolment.countDocuments({ regulationId: r._id })])
  if (programs || students) throw conflict(`${r.code} is followed by ${programs} program(s) and ${students} student(s). Make it inactive instead.`)
  await r.deleteOne()
  await audit(AUDIT('regulation', r, `Deleted regulation ${r.code}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── programs

async function namesOf() {
  const [depts, branches, regs] = await Promise.all([
    Department.find().select('name').lean(), Branch.find().select('name').lean(), Regulation.find().select('code').lean(),
  ])
  return {
    dept: new Map(depts.map((d) => [String(d._id), d.name])),
    branch: new Map(branches.map((b) => [String(b._id), b.name])),
    reg: new Map(regs.map((r) => [String(r._id), r.code])),
  }
}

export async function listPrograms() {
  const [rows, names, courses, students] = await Promise.all([
    Program.find().sort({ active: -1, name: 1 }).lean(),
    namesOf(),
    ProgramCourse.aggregate([{ $match: { active: true } }, { $group: { _id: '$programId', n: { $sum: 1 }, credits: { $sum: '$credits' }, cos: { $sum: { $size: { $ifNull: ['$outcomes', []] } } } } }]),
    ProgramEnrolment.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$programId', n: { $sum: 1 } } }]),
  ])
  const c = new Map(courses.map((x) => [String(x._id), x]))
  const s = new Map(students.map((x) => [String(x._id), x.n]))
  return rows.map((p) => ({
    ...clean(p),
    departmentName: names.dept.get(idStr(p.departmentId)) ?? null,
    branchName: names.branch.get(idStr(p.branchId)) ?? null,
    regulationCode: names.reg.get(idStr(p.regulationId)) ?? null,
    courseCount: c.get(String(p._id))?.n ?? 0,
    totalCredits: c.get(String(p._id))?.credits ?? 0,
    coCount: c.get(String(p._id))?.cos ?? 0,
    studentCount: s.get(String(p._id)) ?? 0,
  }))
}

export async function getProgramDoc(id) {
  if (!isOid(id)) throw notFound('Program')
  const p = await Program.findById(id).lean()
  if (!p) throw notFound('Program')
  return p
}

/** One program: its regulation, curriculum per semester and the students per semester. */
export async function getProgram(id) {
  const p = await getProgramDoc(id)
  const [names, courses, reg, perSem] = await Promise.all([
    namesOf(),
    ProgramCourse.find({ programId: p._id }).sort({ semester: 1, code: 1 }).lean(),
    p.regulationId ? Regulation.findById(p.regulationId).lean() : null,
    ProgramEnrolment.aggregate([{ $match: { programId: p._id, status: 'ACTIVE' } }, { $group: { _id: '$currentSemester', n: { $sum: 1 } } }]),
  ])
  const code = new Map(courses.map((c) => [String(c._id), c.code]))
  const studentsBySem = new Map(perSem.map((x) => [x._id, x.n]))
  const semesters = Array.from({ length: p.semesters || 0 }, (_, i) => {
    const list = courses.filter((c) => c.semester === i + 1 && c.active)
    return {
      semester: i + 1,
      courses: list.length,
      credits: round(list.filter((c) => !isElectiveType(c.type)).reduce((n, c) => n + c.credits, 0), 1),
      electiveCredits: round(list.filter((c) => isElectiveType(c.type)).reduce((n, c) => n + c.credits, 0), 1),
      students: studentsBySem.get(i + 1) ?? 0,
    }
  })
  return {
    ...clean(p),
    departmentName: names.dept.get(idStr(p.departmentId)) ?? null,
    branchName: names.branch.get(idStr(p.branchId)) ?? null,
    regulation: reg ? regulationOut(reg) : null,
    courses: courses.map((c) => ({ ...clean(c), prerequisites: (c.prerequisiteIds ?? []).map((x) => code.get(String(x))).filter(Boolean) })),
    semesterSummary: semesters,
    totalCredits: round(courses.filter((c) => c.active).reduce((n, c) => n + c.credits, 0), 1),
    studentCount: perSem.reduce((n, x) => n + x.n, 0),
  }
}

export async function saveProgram(id, input, req) {
  if (input.code && await Program.exists({ code: input.code, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: `${input.code} is already a program` })
  if (input.regulationId && !await Regulation.exists({ _id: input.regulationId })) throw fieldsError({ regulationId: 'Pick a regulation' })
  if (input.departmentId && !await Department.exists({ _id: input.departmentId })) throw fieldsError({ departmentId: 'Pick a department' })
  if (!id) {
    const p = await Program.create(input)
    await audit(AUDIT('program', p, `Added program ${p.name}`, { action: 'CREATE' }), req)
    return clean(p.toObject())
  }
  const p = await Program.findById(id)
  if (!p) throw notFound('Program')
  if (input.semesters && await ProgramCourse.exists({ programId: p._id, semester: { $gt: input.semesters } })) throw fieldsError({ semesters: 'Some courses are in a later semester — move them first' })
  const before = p.toObject()
  Object.assign(p, input)
  await p.save()
  const changes = diffFields(before, p.toObject(), ['name', 'code', 'level', 'departmentId', 'branchId', 'durationYears', 'semesters', 'intake', 'regulationId', 'coordinatorId', 'active'])
  await audit(AUDIT('program', p, `Updated program ${p.name}`, { changes }), req)
  return clean(p.toObject())
}

export async function deleteProgram(id, req) {
  const p = await Program.findById(id)
  if (!p) throw notFound('Program')
  const [courses, students] = await Promise.all([ProgramCourse.countDocuments({ programId: p._id }), ProgramEnrolment.countDocuments({ programId: p._id })])
  if (courses || students) throw conflict(`${p.name} has ${courses} course(s) and ${students} student(s). Make it inactive instead.`)
  await p.deleteOne()
  await audit(AUDIT('program', p, `Deleted program ${p.name}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

/** Pickers on the registration and exam controller screens. Any signed-in user of the module. */
export async function programLookup(auth, moduleId) {
  const scoped = moduleId ? await programIdsInScope(auth, moduleId) : null
  const [programs, regs] = await Promise.all([
    Program.find({ active: true, ...(scoped && { _id: { $in: scoped.map(oid) } }) }).select('name code level semesters regulationId').sort({ name: 1 }).lean(),
    Regulation.find({ active: true }).select('code name').sort({ code: -1 }).lean(),
  ])
  return { programs: programs.map(clean), regulations: regs.map(clean) }
}

// ───────────────────────────────────────────────────────── courses

async function checkCourse(input, id, program) {
  const errors = {}
  if (input.code && await ProgramCourse.exists({ code: input.code, ...(id && { _id: { $ne: id } }) })) errors.code = `${input.code} is already a course`
  if (input.semester && program && input.semester > program.semesters) errors.semester = `${program.code} has ${program.semesters} semesters`
  if (input.prerequisiteIds?.length) {
    const pre = await ProgramCourse.find({ _id: { $in: input.prerequisiteIds } }).select('programId semester code').lean()
    if (pre.length !== new Set(input.prerequisiteIds.map(String)).size) errors.prerequisiteIds = 'Pick courses of the curriculum'
    else if (id && pre.some((c) => String(c._id) === String(id))) errors.prerequisiteIds = 'A course cannot need itself'
    else if (input.semester && pre.some((c) => c.semester >= input.semester)) errors.prerequisiteIds = 'Prerequisites must come from earlier semesters'
  }
  if (Object.keys(errors).length) throw fieldsError(errors)
}

export async function saveCourse(id, input, req) {
  if (!id) {
    const program = await getProgramDoc(input.programId)
    await checkCourse(input, null, program)
    const c = await ProgramCourse.create(input)
    await audit(AUDIT('course', c, `Added course ${c.code} ${c.title} to ${program.code}`, { action: 'CREATE' }), req)
    return clean(c.toObject())
  }
  const c = await ProgramCourse.findById(id)
  if (!c) throw notFound('Course')
  const program = await getProgramDoc(c.programId)
  const { programId: _ignored, ...rest } = input
  await checkCourse({ semester: c.semester, ...rest }, id, program)
  const before = c.toObject()
  Object.assign(c, rest)
  await c.save()
  const changes = diffFields(before, c.toObject(), ['code', 'title', 'semester', 'type', 'electiveGroup', 'credits', 'l', 't', 'p', 'internalMax', 'externalMax', 'prerequisiteIds', 'active'])
  await audit(AUDIT('course', c, `Updated course ${c.code}`, { changes }), req)
  return clean(c.toObject())
}

export async function deleteCourse(id, req) {
  const c = await ProgramCourse.findById(id)
  if (!c) throw notFound('Course')
  const needed = await ProgramCourse.countDocuments({ prerequisiteIds: c._id })
  if (needed) throw conflict(`${c.code} is a prerequisite of ${needed} course(s). Take it off them first.`)
  const [offered, sheets] = await Promise.all([RegistrationWindow.countDocuments({ 'offerings.courseId': c._id }), CoeMarkSheet.countDocuments({ courseId: c._id })])
  if (offered || sheets) throw conflict(`${c.code} is already used in registration or exams. Make it inactive instead.`)
  await c.deleteOne()
  await audit(AUDIT('course', c, `Deleted course ${c.code}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── outcomes and CO–PO mapping

export async function saveProgramOutcomes(id, outcomes, req) {
  const p = await Program.findById(id)
  if (!p) throw notFound('Program')
  const codes = outcomes.map((o) => o.code)
  if (new Set(codes).size !== codes.length) throw fieldsError({ outcomes: 'Each outcome needs its own code' })
  const before = p.outcomes.map((o) => o.code)
  p.outcomes = outcomes
  await p.save()
  // mappings to an outcome that no longer exists go with it
  const removed = before.filter((c) => !codes.includes(c))
  if (removed.length) await ProgramCourse.updateMany({ programId: p._id }, { $pull: { coPo: { po: { $in: removed } } } })
  await audit(AUDIT('program', p, `Updated the program outcomes of ${p.name} (${codes.length})`), req)
  return clean(p.toObject())
}

export async function saveCourseOutcomes(id, input, req) {
  const c = await ProgramCourse.findById(id)
  if (!c) throw notFound('Course')
  const p = await getProgramDoc(c.programId)
  const cos = input.outcomes.map((o) => o.code)
  if (new Set(cos).size !== cos.length) throw fieldsError({ outcomes: 'Each CO needs its own code' })
  const pos = new Set(p.outcomes.map((o) => o.code))
  const coPo = (input.coPo ?? []).filter((m) => m.level > 0 && cos.includes(m.co) && pos.has(m.po))
  const seen = new Set()
  const unique = coPo.filter((m) => { const k = `${m.co}|${m.po}`; if (seen.has(k)) return false; seen.add(k); return true })
  c.outcomes = input.outcomes
  c.coPo = unique
  if (input.componentCos) c.componentCos = input.componentCos.map((x) => ({ component: x.component, cos: x.cos.filter((co) => cos.includes(co)) }))
  await c.save()
  await audit(AUDIT('course', c, `Updated the outcomes of ${c.code}: ${cos.length} CO(s), ${unique.length} CO–PO link(s)`), req)
  return clean(c.toObject())
}

/** The Outcomes screen: the program's POs / PSOs and every course with its COs and mapping, plus the PO coverage. */
export async function outcomesBoard(id) {
  const p = await getProgramDoc(id)
  const [courses, reg] = await Promise.all([
    ProgramCourse.find({ programId: p._id, active: true }).sort({ semester: 1, code: 1 }).lean(),
    p.regulationId ? Regulation.findById(p.regulationId).lean() : null,
  ])
  const coverage = Object.fromEntries(p.outcomes.map((o) => [o.code, { courses: 0, strength: 0 }]))
  for (const c of courses) {
    const touched = new Set()
    for (const m of c.coPo ?? []) {
      if (!coverage[m.po]) continue
      coverage[m.po].strength += m.level
      touched.add(m.po)
    }
    for (const po of touched) coverage[po].courses++
  }
  return {
    program: { id: String(p._id), name: p.name, code: p.code, semesters: p.semesters },
    outcomes: p.outcomes,
    iaComponents: regulationRules(reg).iaComponents,
    courses: courses.map((c) => ({ id: String(c._id), code: c.code, title: c.title, semester: c.semester, type: c.type, outcomes: c.outcomes ?? [], coPo: c.coPo ?? [], componentCos: c.componentCos ?? [] })),
    coverage,
  }
}

// ───────────────────────────────────────────────────────── students in a program

/**
 * A program's students, one page at a time — by semester, then register no. (else admission no.), then `_id` for stable
 * pages. Search runs on the server: every word in the name or admission no., or the register no.
 */
export async function listEnrolments(programId, { semester, status, search, page = 1, pageSize = 50 } = {}) {
  const p = await getProgramDoc(programId)
  const f = { programId: p._id, ...(semester && { currentSemester: semester }), ...(status && { status }) }
  const q = String(search ?? '').trim()
  if (q) {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 5)
    const named = await Student.find({ $and: words.map((w) => { const re = new RegExp(escapeRegex(w), 'i'); return { $or: [{ firstName: re }, { middleName: re }, { lastName: re }, { admissionNo: re }] } }) }).select('_id').lean()
    f.$or = [{ studentId: { $in: named.map((x) => x._id) } }, { registerNo: new RegExp(escapeRegex(q), 'i') }]
  }
  const [rows, total] = await Promise.all([
    ProgramEnrolment.aggregate([
      { $match: f },
      { $lookup: { from: Student.collection.name, localField: 'studentId', foreignField: '_id', as: '_s', pipeline: [{ $project: { admissionNo: 1 } }] } },
      { $addFields: { _key: { $ifNull: ['$registerNo', { $arrayElemAt: ['$_s.admissionNo', 0] }] } } },
      { $sort: { currentSemester: 1, _key: 1, _id: 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $project: { _s: 0, _key: 0 } },
    ]),
    ProgramEnrolment.countDocuments(f),
  ])
  const [students, advisors, regs] = await Promise.all([
    Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName middleName lastName admissionNo gender mobile email status').lean(),
    User.find({ _id: { $in: rows.map((r) => r.advisorId).filter(Boolean) } }).select('name').lean(),
    Regulation.find({ _id: { $in: rows.map((r) => r.regulationId).filter(Boolean) } }).select('code').lean(),
  ])
  const st = new Map(students.map((s) => [String(s._id), s]))
  const adv = new Map(advisors.map((u) => [String(u._id), u.name]))
  const reg = new Map(regs.map((r) => [String(r._id), r.code]))
  return {
    rows: rows.map((e) => {
      const s = st.get(String(e.studentId))
      return {
        ...clean(e), name: studentName(s), admissionNo: s?.admissionNo ?? null, gender: s?.gender ?? null, mobile: s?.mobile ?? null,
        advisorName: adv.get(idStr(e.advisorId)) ?? null, regulationCode: reg.get(idStr(e.regulationId)) ?? null,
      }
    }),
    total, page, pageSize,
  }
}

/** Students who could join a program: active, not in any program yet, matching the search. */
export async function enrolmentCandidates(search) {
  const taken = (await ProgramEnrolment.find().select('studentId').lean()).map((e) => e.studentId)
  const q = String(search ?? '').trim()
  const rx = q ? new RegExp(escapeRegex(q), 'i') : null
  const rows = await Student.find({
    status: 'ACTIVE', _id: { $nin: taken },
    ...(rx && { $or: [{ firstName: rx }, { lastName: rx }, { admissionNo: rx }] }),
  }).select('firstName middleName lastName admissionNo gender').sort({ firstName: 1 }).limit(50).lean()
  return rows.map((s) => ({ id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, gender: s.gender ?? null }))
}

export async function enrolStudents(programId, input, req) {
  const p = await getProgramDoc(programId)
  if (input.currentSemester > p.semesters) throw fieldsError({ currentSemester: `${p.code} has ${p.semesters} semesters` })
  const ids = [...new Set(input.studentIds.map(String))]
  const [students, taken] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select('_id').lean(),
    ProgramEnrolment.find({ studentId: { $in: ids } }).select('studentId').lean(),
  ])
  if (students.length !== ids.length) throw fieldsError({ studentIds: 'Some students were not found' })
  if (taken.length) throw conflict(`${taken.length} of these students are already in a program.`)
  const regulationId = input.regulationId ?? p.regulationId
  await ProgramEnrolment.insertMany(ids.map((studentId) => ({ studentId, programId: p._id, regulationId, batch: input.batch, currentSemester: input.currentSemester ?? 1, advisorId: input.advisorId ?? undefined })), { ordered: true })
  await audit(AUDIT('program', p, `Enrolled ${ids.length} student(s) in ${p.name} (batch ${input.batch})`), req)
  return { enrolled: ids.length }
}

export async function updateEnrolments(ids, input, req) {
  const rows = await ProgramEnrolment.find({ _id: { $in: ids } })
  if (rows.length !== ids.length) throw notFound('Enrolment')
  const programs = new Map((await Program.find({ _id: { $in: rows.map((r) => r.programId) } }).lean()).map((p) => [String(p._id), p]))
  for (const e of rows) {
    const p = programs.get(String(e.programId))
    if (input.currentSemester && input.currentSemester > p.semesters) throw fieldsError({ currentSemester: `${p.code} has ${p.semesters} semesters` })
  }
  if (input.registerNo) {
    if (rows.length > 1) throw fieldsError({ registerNo: 'One student at a time' })
    if (await ProgramEnrolment.exists({ registerNo: input.registerNo, _id: { $ne: rows[0]._id } })) throw fieldsError({ registerNo: 'Already given to another student' })
  }
  for (const e of rows) {
    const before = e.toObject()
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue
      e[k] = v === '' || v === null ? undefined : v
    }
    await e.save()
    const changes = diffFields(before, e.toObject(), ['currentSemester', 'status', 'registerNo', 'advisorId', 'batch', 'regulationId'])
    if (changes.length) await audit({ action: 'UPDATE', module: 'programs', entityType: 'enrolment', entityId: String(e._id), entityName: e.registerNo ?? String(e.studentId), summary: 'Updated a student’s program record', changes }, req)
  }
  return { updated: rows.length }
}

export async function deleteEnrolment(id, req) {
  const e = await ProgramEnrolment.findById(id)
  if (!e) throw notFound('Enrolment')
  const [regs, results] = await Promise.all([CourseRegistration.countDocuments({ enrolmentId: e._id }), CoeResult.countDocuments({ studentId: e.studentId })])
  if (regs || results) throw conflict('This student already has registrations or results. Mark them discontinued instead.')
  await e.deleteOne()
  await audit({ action: 'DELETE', module: 'programs', entityType: 'enrolment', entityId: String(e._id), entityName: String(e.studentId), summary: 'Removed a student from a program' }, req)
  return { deleted: true }
}

/** Staff who can be a program coordinator or a student's advisor. */
export async function staffOptions() {
  const rows = await User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(2000).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

// ───────────────────────────────────────────────────────── attainment

/** Exam sessions with marks for this program (attainment picks one). */
export async function attainmentSessions(programId) {
  const ids = await CoeMarkSheet.distinct('sessionId', { programId: oid(programId) })
  const rows = await CoeSession.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).select('name kind status examMonth').lean()
  return rows.map(clean)
}

/**
 * Direct attainment for a program in an exam session.
 *   CO level, internal side: per CO, the % of students whose marks in the internal components assessing that CO reach the
 *   target %; external side: the % reaching the target in the end-semester exam (it assesses every CO). Each % → a level
 *   (regulation's levels, default 50/60/70 % → 1/2/3); direct = internalWeight % internal + the rest external.
 *   PO level: Σ(CO attainment × CO–PO strength) / Σ strength over the program's courses.
 */
export async function programAttainment(programId, sessionId) {
  const p = await getProgramDoc(programId)
  const reg = regulationRules(p.regulationId ? await Regulation.findById(p.regulationId).lean() : null)
  const { targetPct, levels, internalWeight } = reg.attainment
  const sessions = await attainmentSessions(programId)
  const sid = sessionId && isOid(sessionId) ? sessionId : (sessions.find((x) => x.kind !== 'SUPPLEMENTARY') ?? sessions[0])?.id
  const sheets = sid ? await CoeMarkSheet.find({ sessionId: sid, programId: p._id }).lean() : []
  const courses = await ProgramCourse.find({ programId: p._id, _id: { $in: sheets.map((s) => s.courseId) } }).sort({ semester: 1, code: 1 }).lean()
  const pos = p.outcomes.map((o) => o.code)
  const allCos = []
  const allMap = []
  const rows = courses.map((c) => {
    const internal = sheets.find((s) => String(s.courseId) === String(c._id) && s.part === 'INTERNAL')
    const external = sheets.find((s) => String(s.courseId) === String(c._id) && s.part === 'EXTERNAL')
    const comps = reg.iaComponents
    const cos = (c.outcomes ?? []).map((co) => {
      // internal: the components that assess this CO (none mapped → all components)
      const mapped = comps.filter((k) => {
        const m = (c.componentCos ?? []).find((x) => x.component === k.code)
        return !m || !m.cos?.length || m.cos.includes(co.code)
      })
      let iReached = 0
      let iCount = 0
      for (const e of internal?.entries ?? []) {
        let got = 0
        let max = 0
        let any = false
        for (const k of mapped) {
          const v = e.components?.[k.code]
          if (v === null || v === undefined || v === '') continue
          any = true
          got += Number(v) || 0
          max += Number(k.maxMarks) || 0
        }
        if (!any || !max) continue
        iCount++
        if ((got / max) * 100 >= targetPct) iReached++
      }
      let eReached = 0
      let eCount = 0
      for (const e of external?.entries ?? []) {
        if (e.absent) { eCount++; continue }
        if (e.marks === null || e.marks === undefined) continue
        eCount++
        if ((e.marks / (external.maxMarks || c.externalMax || 1)) * 100 >= targetPct) eReached++
      }
      const iPct = iCount ? round((iReached / iCount) * 100, 1) : null
      const ePct = eCount ? round((eReached / eCount) * 100, 1) : null
      const iLevel = attainmentLevelOf(iPct, levels)
      const eLevel = attainmentLevelOf(ePct, levels)
      const attainment = directAttainment(iLevel, eLevel, internalWeight)
      const key = `${c.code}:${co.code}`
      allCos.push({ key, attainment })
      return { code: co.code, statement: co.statement, bloom: co.bloom, internalPct: iPct, externalPct: ePct, internalLevel: iLevel, externalLevel: eLevel, attainment, students: Math.max(iCount, eCount) }
    })
    for (const m of c.coPo ?? []) allMap.push({ co: `${c.code}:${m.co}`, po: m.po, level: m.level })
    const own = poAttainmentOf(cos.map((x) => ({ key: x.code, attainment: x.attainment })), c.coPo ?? [], pos)
    const vals = cos.map((x) => x.attainment).filter((v) => v !== null)
    return {
      id: String(c._id), code: c.code, title: c.title, semester: c.semester, cos,
      average: vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, poAttainment: own,
    }
  })
  const po = poAttainmentOf(allCos, allMap, pos)
  const vals = Object.values(po).filter((v) => v !== null)
  return {
    program: { id: String(p._id), name: p.name, code: p.code },
    sessions, sessionId: sid ?? null,
    rules: { targetPct, levels, internalWeight },
    outcomes: p.outcomes,
    courses: rows,
    po,
    summary: {
      courses: rows.length,
      cos: allCos.length,
      cosAttained: allCos.filter((c) => c.attainment !== null && c.attainment >= 2).length,
      poAverage: vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    },
  }
}
