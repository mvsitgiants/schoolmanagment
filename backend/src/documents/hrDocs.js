// Staff & HR documents: the offer / appointment letter (HR_OFFER_LETTER, `id`: a candidate who has been made an offer
// in Recruitment, or a staff record). Reads the hiring and staff records as they are; the terms that are the same for
// everyone (probation, notice, leave, documents to bring) are wording in the template the institution can edit.
import { EMPLOYEE_CATEGORIES, EMPLOYMENT_TYPES } from '@schoolgiant/shared'
import { Candidate, Employee, Requisition } from '../models/hrms.js'
import { Branch, Department } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { isOid } from '../platform/db.js'
import { badRequest, forbidden, notFound } from '../platform/errors.js'

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
      kind: 'CANDIDATE', person: { name: c.name, gender: c.gender, mobile: c.mobile, email: c.email, address: null },
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

export const HR_DOCS = {
  HR_OFFER_LETTER: {
    perms: ['hrms.hiring.view', 'hrms.employees.view_salary'],
    load: (id, auth) => offerLetterData(id, auth),
    model: offerLetterModel,
    title: (m) => `${m.letter.appointment ? 'Appointment letter' : 'Offer letter'} · ${m.candidate.name}`,
    sample: async () => (await Candidate.findOne({ 'offer.joiningDate': { $exists: true } }).sort({ 'offer.at': -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name, institution.addressLine …',
      'letter.refNo, letter.date, letter.offer, letter.appointment (a staff record: the appointment letter)',
      'candidate.name, candidate.salutation (Mr. / Ms.), candidate.address, candidate.mobile, candidate.email, candidate.employeeCode',
      'post.designation, post.department, post.campus, post.category, post.teaching, post.employmentTypeLabel, post.probation, post.joiningDate, post.grossMonthly, post.ctcAnnual, post.note',
      '{{money post.grossMonthly}} · {{words post.grossMonthly}}',
    ],
  },
}
