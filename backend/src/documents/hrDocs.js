// Staff & HR documents: the offer / appointment letter (HR_OFFER_LETTER, `id`: a candidate who has been made an offer
// in Recruitment, or a staff record), and for someone leaving the relieving letter and experience certificate
// (HR_RELIEVING_LETTER / HR_EXPERIENCE_LETTER, `id`: a staff record with an exit recorded). Reads the hiring and staff records as they are; the terms that are the same for
// everyone (probation, notice, leave, documents to bring) are wording in the template the institution can edit.
import { EMPLOYEE_CATEGORIES, EMPLOYMENT_TYPES, EXIT_TYPES, defaultConduct } from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { Candidate, Employee, Requisition } from '../models/hrms.js'
import { Branch, Department } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { findEmployee, todayYmd } from '../services/hrmsCommon.js'
import { exitInterviewData, logLetter, noDuesData } from '../services/hrmsExits.js'

/** "A, B and C" */
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '')
const labelOf = (list, v) => list.find((x) => x.value === v)?.label ?? v ?? null
const fyOf = (ymd) => { const y = Number(String(ymd).slice(0, 4)); const m = Number(String(ymd).slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}` }

async function offerLetterData(id, auth) {
  if (!isOid(id)) throw notFound('Offer letter')
  const c = await Candidate.findById(id).lean()
  if (c) {
    if (!c.offer?.joiningDate) throw badRequest(`Make ${c.name} an offer first (Recruitment › the candidate › Make an offer).`)
    const r = await Requisition.findById(c.requisitionId).select('title requisitionNo category employmentType departmentId branchId').lean()
    const [department, branch] = await Promise.all([
      r?.departmentId ? Department.findById(r.departmentId).select('name').lean() : null,
      r?.branchId ? Branch.findById(r.branchId).select('name addressLine city').lean() : null,
    ])
    const date = (c.offer.at ? new Date(c.offer.at) : new Date()).toISOString().slice(0, 10)
    return {
      kind: 'CANDIDATE', person: { name: c.name, gender: c.gender, mobile: c.mobile, email: c.email, address: c.address || null },
      offer: c.offer, requisition: r, department, branch, date,
      refNo: `HR/OFFER/${fyOf(date)}/${r?.requisitionNo ?? String(c._id).slice(-6).toUpperCase()}`,
    }
  }
  // a staff record: the appointment letter for someone already on the rolls (their pay needs the salary permission)
  if (!auth.fullAccess && !can(auth, 'hrms.employees.view_salary')) throw forbidden('Your role can’t see staff salaries, which the letter prints.')
  const e = await Employee.findById(id).select('+salary').lean()
  if (!e) throw notFound('Candidate or staff member')
  const [department, branch] = await Promise.all([
    e.departmentId ? Department.findById(e.departmentId).select('name').lean() : null,
    e.branchId ? Branch.findById(e.branchId).select('name addressLine city').lean() : null,
  ])
  return {
    kind: 'EMPLOYEE', person: { name: e.name, gender: e.gender, mobile: e.mobile, email: e.email, address: e.address },
    offer: { designation: e.designation, joiningDate: e.joiningDate, salary: e.salary?.grossMonthly, ctcAnnual: e.salary?.ctcAnnual },
    requisition: { category: e.category, employmentType: e.employmentType }, department, branch, date: new Date().toISOString().slice(0, 10),
    refNo: `HR/APPT/${fyOf(e.joiningDate)}/${e.employeeCode}`, employeeCode: e.employeeCode,
  }
}

export function offerLetterModel({ kind, person: p, offer: o, requisition: r, department, branch, refNo, date, employeeCode }) {
  const type = r?.employmentType ?? 'PERMANENT'
  const address = p?.address && typeof p.address === 'object' ? [p.address.line, p.address.city, p.address.state, p.address.pincode].filter(Boolean).join(', ') : p?.address ?? null
  return {
    letter: { refNo, date: date ?? new Date().toISOString().slice(0, 10), kind, appointment: kind === 'EMPLOYEE', offer: kind !== 'EMPLOYEE' },
    candidate: {
      name: p?.name, salutation: p?.gender === 'FEMALE' ? 'Ms.' : p?.gender === 'MALE' ? 'Mr.' : '', address: address || null,
      mobile: p?.mobile ?? null, email: p?.email ?? null, employeeCode: employeeCode ?? null,
    },
    post: {
      designation: o?.designation || r?.title || null, department: department?.name ?? null, campus: branch?.name ?? null,
      category: labelOf(EMPLOYEE_CATEGORIES, r?.category), teaching: r?.category === 'TEACHING',
      employmentType: type, employmentTypeLabel: labelOf(EMPLOYMENT_TYPES, type),
      // probation applies to a regular post; a contract, part-time, visiting or temporary one runs on its own terms
      probation: ['PERMANENT', 'PROBATION'].includes(type),
      joiningDate: o?.joiningDate ?? null, grossMonthly: o?.salary ?? null, ctcAnnual: o?.ctcAnnual ?? null, note: o?.note || null,
    },
  }
}

/**
 * What a teacher taught here, from Academic setup › teacher allocations: the subjects, the classes (in class
 * order) and the academic years — for the experience certificate. Empty for someone who never taught.
 */
async function teachingOf(userId) {
  if (!userId) return { subjects: [], classes: [], years: [] }
  const rows = await TeacherAllocation.find({ teacherId: userId }).select('subjectId sectionId academicYearId').lean()
  if (!rows.length) return { subjects: [], classes: [], years: [] }
  const uniq = (k) => [...new Set(rows.map((r) => String(r[k])))]
  const [subjects, sections, years] = await Promise.all([
    Subject.find({ _id: { $in: uniq('subjectId') } }).select('name').lean(),
    Section.find({ _id: { $in: uniq('sectionId') } }).select('classId').lean(),
    AcademicYear.find({ _id: { $in: uniq('academicYearId') } }).select('name startDate').sort({ startDate: 1 }).lean(),
  ])
  const classes = await ClassLevel.find({ _id: { $in: [...new Set(sections.map((x) => String(x.classId)))] } }).select('name order').sort({ order: 1 }).lean()
  // a class named just "6" reads "Class 6" in a sentence
  return { subjects: subjects.map((x) => x.name).sort(), classes: classes.map((x) => (/^\d/.test(x.name) ? `Class ${x.name}` : x.name)), years: years.map((x) => x.name) }
}

/** Relieving letter / experience certificate: a staff record in the caller's scope, with an exit recorded. */
async function exitLetterData(kind, id, auth) {
  const e = await findEmployee(id, auth, { lean: true })
  if (!e.exit?.lastWorkingDate) throw conflict(`${e.name} has no exit recorded. Record the exit first (Staff › the person › Exit).`)
  const [department, branch] = await Promise.all([
    e.departmentId ? Department.findById(e.departmentId).select('name').lean() : null,
    e.branchId ? Branch.findById(e.branchId).select('name').lean() : null,
  ])
  const c = e.exit.certificate ?? {}
  const conduct = c.conduct || defaultConduct(e.exit.type)
  const teaching = kind === 'EXPERIENCE' && c.showTeaching !== false ? await teachingOf(e.userId) : { subjects: [], classes: [], years: [] }
  return {
    kind, date: await todayYmd(), // on the institution's clock, not the server's
    refNo: `HR/${kind === 'EXPERIENCE' ? 'EXP' : 'REL'}/${fyOf(e.exit.lastWorkingDate)}/${e.employeeCode}`,
    staff: {
      name: e.name, code: e.employeeCode, salutation: e.gender === 'FEMALE' ? 'Ms.' : e.gender === 'MALE' ? 'Mr.' : '',
      designation: e.designation ?? labelOf(EMPLOYEE_CATEGORIES, e.category), category: labelOf(EMPLOYEE_CATEGORIES, e.category), teachingStaff: e.category === 'TEACHING',
      department: department?.name ?? null, campus: branch?.name ?? null, qualifications: e.qualifications ?? null,
      address: [e.address?.line, e.address?.city, e.address?.state, e.address?.pincode].filter(Boolean).join(', ') || null,
      joiningDate: e.joiningDate, lastWorkingDate: e.exit.lastWorkingDate, noticeDate: e.exit.noticeDate ?? null, exitType: labelOf(EXIT_TYPES, e.exit.type),
    },
    certificate: {
      conduct, good: conduct === 'GOOD', satisfactory: conduct === 'SATISFACTORY', omit: conduct === 'OMIT', duties: c.duties?.trim() || null,
      subjects: teaching.subjects, classes: teaching.classes, years: teaching.years, taught: teaching.subjects.length > 0,
      subjectList: andList(teaching.subjects), classList: andList(teaching.classes),
      yearRange: teaching.years.length > 1 ? `${teaching.years[0]} to ${teaching.years.at(-1)}` : teaching.years[0] ?? null,
    },
  }
}

const exitLetterVars = [
  'institution.name, institution.addressLine …',
  'letter: refNo, date',
  'staff.name, staff.code, staff.salutation (Mr. / Ms.), staff.designation, staff.category, staff.teachingStaff, staff.department, staff.campus, staff.qualifications, staff.address',
  'staff.joiningDate, staff.lastWorkingDate, staff.noticeDate, staff.exitType',
]

export const HR_DOCS = {
  HR_OFFER_LETTER: {
    perms: ['hrms.hiring.view', 'hrms.employees.view_salary'],
    load: (id, auth) => offerLetterData(id, auth),
    model: offerLetterModel,
    title: (m) => `${m.letter.appointment ? 'Appointment letter' : 'Offer letter'} · ${m.candidate.name}`,
    issued: (id, d, auth) => (d.kind === 'EMPLOYEE' ? logLetter('HR_OFFER_LETTER', id, d.refNo, auth) : undefined),
    sample: async () => (await Candidate.findOne({ 'offer.joiningDate': { $exists: true } }).sort({ 'offer.at': -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name, institution.addressLine …',
      'letter.refNo, letter.date, letter.offer, letter.appointment (a staff record: the appointment letter)',
      'candidate.name, candidate.salutation (Mr. / Ms.), candidate.address, candidate.mobile, candidate.email, candidate.employeeCode',
      'post.designation, post.department, post.campus, post.category, post.teaching, post.employmentTypeLabel, post.probation, post.joiningDate, post.grossMonthly, post.ctcAnnual, post.note',
      '{{money post.grossMonthly}} · {{words post.grossMonthly}}',
    ],
  },
  HR_RELIEVING_LETTER: {
    perms: ['hrms.employees.view', 'hrms.exits.view'],
    load: (id, auth) => exitLetterData('RELIEVING', id, auth),
    model: (d) => d,
    title: (m) => `Relieving letter · ${m.staff.name}`,
    issued: (id, d, auth) => logLetter('HR_RELIEVING_LETTER', id, d.refNo, auth),
    sample: async () => (await Employee.findOne({ 'exit.lastWorkingDate': { $exists: true } }).sort({ updatedAt: -1 }).select('_id').lean())?._id,
    variables: exitLetterVars,
  },
  HR_EXPERIENCE_LETTER: {
    perms: ['hrms.employees.view', 'hrms.exits.view'],
    load: (id, auth) => exitLetterData('EXPERIENCE', id, auth),
    model: (d) => d,
    title: (m) => `Experience certificate · ${m.staff.name}`,
    issued: (id, d, auth) => logLetter('HR_EXPERIENCE_LETTER', id, d.refNo, auth),
    sample: async () => (await Employee.findOne({ 'exit.lastWorkingDate': { $exists: true } }).sort({ updatedAt: -1 }).select('_id').lean())?._id,
    variables: [...exitLetterVars,
      'certificate.good / satisfactory / omit (the conduct line HR picked), certificate.duties',
      'certificate.taught, certificate.subjectList, certificate.classList, certificate.yearRange (a teacher: from Academic setup › teacher allocations)'],
  },
  HR_NO_DUES: {
    perms: ['hrms.exits.view', 'hrms.employees.view'],
    load: (id, auth) => noDuesData(id, auth),
    model: (d) => d,
    title: (m) => `No-dues certificate · ${m.staff.name}`,
    issued: (id, d, auth) => (d.clearance.complete ? logLetter('HR_NO_DUES', id, d.refNo, auth) : undefined), // a draft isn't a certificate
    sample: async () => (await Employee.findOne({ 'exit.lastWorkingDate': { $exists: true } }).sort({ updatedAt: -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name …', 'refNo, date', 'staff.name, staff.code, staff.salutation, staff.designation, staff.department, staff.joiningDate, staff.lastWorkingDate, staff.exitType',
      'clearance.complete, clearance.pending, clearance.dues, clearance.completedOn',
      'clearance.items[] (title, ownerLabel, statusLabel, cleared, notNeeded, pending, done.by, on, note)',
      'library.ok, library.booksOut[] (title, accessionNo, dueOn), library.fines, library.fineTotal (when Library is on)',
      'advances.ok, advances.loans[] (loanNo, balance), advances.total (when Payroll is on)',
    ],
  },
  HR_EXIT_INTERVIEW: {
    perms: ['hrms.exits.view'],
    load: (id, auth) => exitInterviewData(id, auth),
    model: (d) => d,
    title: (m) => `Exit interview · ${m.staff.name}`,
    issued: (id, d, auth) => logLetter('HR_EXIT_INTERVIEW', id, d.refNo, auth),
    sample: async () => (await Employee.findOne({ 'exit.lastWorkingDate': { $exists: true } }).sort({ updatedAt: -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name …', 'refNo, date', 'staff.name, staff.code, staff.salutation, staff.designation, staff.department, staff.joiningDate, staff.lastWorkingDate, staff.exitType',
      'interview.recorded (false: a blank form to fill by hand), interview.by, interview.on',
      'interview.reasons[] (label, chosen), interview.reasonLabel, interview.otherReason',
      'interview.ratings[] (aspect, score, boxes[] (n, on)), interview.liked, interview.improve',
      'interview.rejoinOptions[] (label, on), interview.rehireOptions[] (label, on), interview.rehireNote',
    ],
  },
}
