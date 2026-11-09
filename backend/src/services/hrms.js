import {
  EMPLOYEE_CATEGORIES, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, EXIT_TYPES, last4,
} from '@schoolgiant/shared'
import { Section, TeacherAllocation } from '../models/academics.js'
import { Employee, Holiday } from '../models/hrms.js'
import { Branch, Department, User } from '../models/tenant.js'
import { bumpAccessVersion, can } from '../platform/access.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { audit } from '../platform/audit.js'
import { decrypt, encrypt } from '../platform/crypto.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { createUser, revokeUserSessions } from './users.js'
import { employeeScope, findEmployee, hrSettings, idStr, myEmployee, stamp, todayYmd } from './hrmsCommon.js'

// Staff & HR › Staff (module `hrms`): the staff records, their logins, job changes and exits; holidays.
// Salary, bank and statutory ids are out of the default projection: salary needs `view_salary`, the ids `view_sensitive`
// (shown masked; the full values only through `sensitive()`, which is audited).

const JOB_FIELDS = ['designation', 'departmentId', 'category', 'employmentType', 'branchId', 'reportingManagerId']
const label = (list, v) => list.find((x) => x.value === v)?.label ?? v

// ───────────────────────────────────────────────────────── lookups

/** Everything the staff screens pick from. */
export async function hrmsMeta(auth) {
  const [departments, branches, people, users] = await Promise.all([
    Department.find({ active: true }).select('name code type').sort({ name: 1 }).lean(),
    Branch.find().select('name code isDefault').sort({ isDefault: -1, name: 1 }).lean(),
    Employee.find({ status: { $ne: 'EXITED' }, ...employeeScope(auth) }).select('name employeeCode designation userId category').sort({ name: 1 }).lean(),
    User.find({ active: true }).select('name email designation').sort({ name: 1 }).lean(),
  ])
  const linked = new Set((await Employee.find({ userId: { $ne: null } }).select('userId').lean()).map((e) => String(e.userId)))
  return {
    categories: EMPLOYEE_CATEGORIES, employmentTypes: EMPLOYMENT_TYPES, exitTypes: EXIT_TYPES, statuses: EMPLOYEE_STATUSES,
    departments: clean(departments), branches: clean(branches),
    staff: people.map((e) => ({ id: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, category: e.category, userId: idStr(e.userId) })),
    unlinkedUsers: users.filter((u) => !linked.has(String(u._id))).map((u) => ({ id: String(u._id), name: u.name, email: u.email, designation: u.designation ?? null })),
    can: {
      salary: can(auth, 'hrms.employees.view_salary'), sensitive: can(auth, 'hrms.employees.view_sensitive'),
      edit: can(auth, 'hrms.employees.edit'), exit: can(auth, 'hrms.employees.terminate'),
    },
  }
}

// ───────────────────────────────────────────────────────── list & detail

const listFilter = (q, auth) => {
  const f = { ...employeeScope(auth) }
  if (q.status === 'CURRENT' || !q.status) f.status = { $ne: 'EXITED' }
  else if (q.status !== 'ALL') f.status = q.status
  if (q.category) f.category = q.category
  if (q.employmentType) f.employmentType = q.employmentType
  if (q.departmentId) f.departmentId = q.departmentId
  if (q.branchId) f.branchId = q.branchId
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search.trim()), 'i')
    f.$or = [{ name: rx }, { employeeCode: rx }, { mobile: rx }, { email: rx }, { designation: rx }]
  }
  return f
}

async function names() {
  const [deps, branches] = await Promise.all([Department.find().select('name').lean(), Branch.find().select('name').lean()])
  return { dep: new Map(deps.map((d) => [String(d._id), d.name])), branch: new Map(branches.map((b) => [String(b._id), b.name])) }
}

const row = (e, n, managers) => ({
  id: String(e._id), employeeCode: e.employeeCode, name: e.name, designation: e.designation ?? null, category: e.category, employmentType: e.employmentType,
  department: n.dep.get(String(e.departmentId)) ?? null, departmentId: idStr(e.departmentId), branch: n.branch.get(String(e.branchId)) ?? null, branchId: idStr(e.branchId),
  mobile: e.mobile ?? null, email: e.email ?? null, joiningDate: e.joiningDate, status: e.status, statusLabel: EMPLOYEE_STATUSES[e.status]?.label,
  hasLogin: !!e.userId, userId: idStr(e.userId), manager: managers?.get(String(e.reportingManagerId)) ?? null, lastWorkingDate: e.exit?.lastWorkingDate ?? null,
})

export async function listEmployees(q, paging, auth) {
  const filter = listFilter(q, auth)
  const [rows, total, n] = await Promise.all([
    Employee.find(filter).sort({ name: 1 }).skip((paging.page - 1) * paging.pageSize).limit(paging.pageSize).lean(),
    Employee.countDocuments(filter), names(),
  ])
  const managers = new Map((await Employee.find({ _id: { $in: rows.map((r) => r.reportingManagerId).filter(Boolean) } }).select('name').lean()).map((m) => [String(m._id), m.name]))
  const counts = await Employee.aggregate([{ $match: { ...employeeScope(auth), status: { $ne: 'EXITED' } } }, { $group: { _id: '$category', n: { $sum: 1 } } }])
  return { ...listResponse(rows.map((e) => row(e, n, managers)), total, paging), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) }
}

const maskIds = (statutory) => Object.fromEntries(['pan', 'aadhaar', 'uan', 'esi'].map((k) => [k, statutory?.[k]?.last4 ? `••••${statutory[k].last4}` : null]))

/** One staff record with what the caller may see of salary and ids. */
export async function getEmployee(id, auth) {
  const showSalary = can(auth, 'hrms.employees.view_salary')
  const showIds = can(auth, 'hrms.employees.view_sensitive')
  const extra = [showSalary && '+salary', showIds && '+statutory +bank'].filter(Boolean).join(' ')
  const e = await findEmployee(id, auth, { select: extra || undefined, lean: true })
  const n = await names()
  const [manager, user, reports] = await Promise.all([
    e.reportingManagerId ? Employee.findById(e.reportingManagerId).select('name designation').lean() : null,
    e.userId ? User.findById(e.userId).select('name email active lastLoginAt').lean() : null,
    Employee.find({ reportingManagerId: e._id, status: { $ne: 'EXITED' } }).select('name designation').sort({ name: 1 }).lean(),
  ])
  return {
    ...row(e, n), gender: e.gender ?? null, dob: e.dob ?? null, bloodGroup: e.bloodGroup ?? null, address: e.address ?? {}, emergencyContact: e.emergencyContact ?? {},
    qualifications: e.qualifications ?? null, experienceYears: e.experienceYears ?? null, subjects: e.subjects ?? [], confirmationDate: e.confirmationDate ?? null,
    weeklyOffDays: e.weeklyOffDays ?? [], reportingManagerId: idStr(e.reportingManagerId), notes: e.notes ?? null, geofenceExempt: !!e.geofenceExempt,
    manager: manager && { id: String(manager._id), name: manager.name, designation: manager.designation ?? null },
    login: user && { id: String(user._id), name: user.name, email: user.email, active: user.active, lastLoginAt: user.lastLoginAt ?? null },
    reports: reports.map((r) => ({ id: String(r._id), name: r.name, designation: r.designation ?? null })),
    exit: e.exit?.type ? { ...e.exit, typeLabel: label(EXIT_TYPES, e.exit.type) } : null,
    jobHistory: (e.jobHistory ?? []).slice().reverse(),
    salary: showSalary ? (e.salary ?? null) : undefined,
    statutory: showIds ? maskIds(e.statutory) : undefined,
    bank: showIds ? (e.bank ? { bankName: e.bank.bankName ?? null, ifsc: e.bank.ifsc ?? null, accountName: e.bank.accountName ?? null, account: e.bank.account?.last4 ? `••••${e.bank.account.last4}` : null } : null) : undefined,
  }
}

/** The full ids and account number — every read is audited. */
export async function sensitive(id, auth, req) {
  const e = await findEmployee(id, auth, { select: '+statutory +bank', lean: true })
  await audit({ action: 'VIEW', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Viewed the ids and bank account of ${e.name}` }, req)
  const open = (s) => (s?.enc ? decrypt(s.enc) : null)
  return {
    pan: open(e.statutory?.pan), aadhaar: open(e.statutory?.aadhaar), uan: open(e.statutory?.uan), esi: open(e.statutory?.esi),
    account: open(e.bank?.account),
  }
}

// ───────────────────────────────────────────────────────── create & edit

async function checkManager(managerId, selfId) {
  if (!managerId) return
  if (selfId && String(managerId) === String(selfId)) throw badRequest('Some details need fixing.', { fields: { reportingManagerId: 'Can’t report to themselves' } })
  if (!await Employee.exists({ _id: managerId, status: { $ne: 'EXITED' } })) throw badRequest('Some details need fixing.', { fields: { reportingManagerId: 'Pick someone on the staff' } })
  // no loops: walk up from the manager
  let at = managerId
  for (let i = 0; i < 20 && at; i++) {
    if (selfId && String(at) === String(selfId)) throw badRequest('Some details need fixing.', { fields: { reportingManagerId: 'That would make a loop' } })
    at = (await Employee.findById(at).select('reportingManagerId').lean())?.reportingManagerId
  }
}

async function checkLink(userId, selfId) {
  if (!userId) return
  if (!await User.exists({ _id: userId })) throw badRequest('Some details need fixing.', { fields: { userId: 'Pick a login' } })
  if (await Employee.exists({ userId, ...(selfId && { _id: { $ne: selfId } }) })) throw conflict('That login is already linked to another staff record.', { fields: { userId: 'Already linked' } })
}

const personal = (input) => {
  const out = {}
  for (const k of ['name', 'gender', 'dob', 'bloodGroup', 'mobile', 'email', 'address', 'emergencyContact', 'qualifications', 'experienceYears', 'subjects', 'joiningDate', 'confirmationDate', 'weeklyOffDays', 'notes']) {
    if (input[k] !== undefined) out[k] = input[k] === '' ? undefined : input[k]
  }
  return out
}

export async function createEmployee(input, auth, req) {
  await checkManager(input.reportingManagerId)
  await checkLink(input.userId)
  const code = input.employeeCode?.trim() || await nextNumber('EMPLOYEE', { branchId: input.branchId })
  if (await Employee.exists({ employeeCode: code.toUpperCase() })) throw conflict('That employee code is taken.', { fields: { employeeCode: 'Already used' } })
  const e = await Employee.create({
    ...personal(input), employeeCode: code,
    ...Object.fromEntries(JOB_FIELDS.map((k) => [k, input[k] || undefined])),
    userId: input.userId || undefined, candidateId: input.candidateId || undefined, geofenceExempt: !!input.geofenceExempt,
    jobHistory: [{ type: 'JOINED', date: input.joiningDate, to: input.designation, by: auth.user?.name, at: new Date() }],
    createdBy: auth.user?.name,
  })
  if (input.login && !input.userId) await createLogin(String(e._id), input.login, auth, req, { quiet: true })
  await audit({ action: 'CREATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Added staff record ${e.name} (${e.employeeCode})` }, req)
  return getEmployee(String(e._id), auth)
}

export async function updateEmployee(id, input, auth, req) {
  const e = await findEmployee(id, auth)
  if (input.reportingManagerId !== undefined) await checkManager(input.reportingManagerId || null, e._id)
  if (input.employeeCode && input.employeeCode.toUpperCase() !== e.employeeCode && await Employee.exists({ employeeCode: input.employeeCode.toUpperCase() })) throw conflict('That employee code is taken.', { fields: { employeeCode: 'Already used' } })
  const n = await names()
  const show = (k, v) => (k === 'departmentId' ? n.dep.get(String(v)) : k === 'branchId' ? n.branch.get(String(v)) : k === 'category' ? label(EMPLOYEE_CATEGORIES, v) : k === 'employmentType' ? label(EMPLOYMENT_TYPES, v) : v) ?? '—'
  const changes = []
  for (const k of JOB_FIELDS) {
    if (input[k] === undefined) continue
    const next = input[k] || undefined
    if (String(e[k] ?? '') === String(next ?? '')) continue
    let to = show(k, next)
    if (k === 'reportingManagerId') to = next ? (await Employee.findById(next).select('name').lean())?.name : '—'
    let from = show(k, e[k])
    if (k === 'reportingManagerId') from = e[k] ? (await Employee.findById(e[k]).select('name').lean())?.name ?? '—' : '—'
    changes.push({ type: k.replace(/Id$/, '').toUpperCase(), date: input.effectiveDate || await todayYmd(), from, to, note: input.changeNote, by: auth.user?.name, at: new Date() })
    e[k] = next
  }
  Object.assign(e, personal(input))
  if (input.employeeCode) e.employeeCode = input.employeeCode
  if (input.geofenceExempt !== undefined) e.geofenceExempt = input.geofenceExempt
  e.jobHistory.push(...changes)
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Updated staff record ${e.name}${changes.length ? ` (${changes.map((c) => c.type.toLowerCase()).join(', ')})` : ''}` }, req)
  return getEmployee(id, auth)
}

/** Salary on the record (payroll's structures build on it). */
export async function setSalary(id, input, auth, req) {
  if (!can(auth, 'hrms.employees.view_salary')) throw forbidden()
  const e = await findEmployee(id, auth, { select: '+salary' })
  const before = e.salary?.grossMonthly
  e.salary = { ...input, revisedBy: auth.user?.name, revisedAt: new Date() }
  if (before !== undefined && before !== input.grossMonthly) e.jobHistory.push({ type: 'SALARY', date: input.effectiveFrom || await todayYmd(), note: 'Salary revised', by: auth.user?.name, at: new Date() })
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Set the salary of ${e.name}` }, req)
  return getEmployee(id, auth)
}

/** PAN, Aadhaar, UAN, ESI and the bank account — kept encrypted. A blank leaves a value as it is; null clears it. */
export async function setSensitive(id, input, auth, req) {
  if (!can(auth, 'hrms.employees.view_sensitive')) throw forbidden()
  const e = await findEmployee(id, auth, { select: '+statutory +bank' })
  const seal = (v, old) => (v === undefined || v === '' ? old : v === null ? undefined : { enc: encrypt(v), last4: last4(v) })
  const st = e.statutory?.toObject?.() ?? {}
  e.statutory = { pan: seal(input.pan, st.pan), aadhaar: seal(input.aadhaar, st.aadhaar), uan: seal(input.uan, st.uan), esi: seal(input.esi, st.esi) }
  const bk = e.bank?.toObject?.() ?? {}
  e.bank = { bankName: input.bankName ?? bk.bankName, ifsc: input.ifsc ?? bk.ifsc, accountName: input.accountName ?? bk.accountName, account: seal(input.account, bk.account) }
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Updated the ids / bank account of ${e.name}` }, req)
  return getEmployee(id, auth)
}

// ───────────────────────────────────────────────────────── logins

export async function linkLogin(id, userId, auth, req) {
  const e = await findEmployee(id, auth)
  if (userId) await checkLink(userId, e._id)
  e.userId = userId || undefined
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: userId ? `Linked ${e.name} to a login` : `Unlinked the login of ${e.name}` }, req)
  return getEmployee(id, auth)
}

/** Make a login for a staff member (Administration › Users does the same, from the other side). */
export async function createLogin(id, { email, roleIds, invite, password }, auth, req, { quiet = false } = {}) {
  if (!can(auth, 'core.users.create')) throw forbidden('Making a login needs permission to add users.')
  const e = await findEmployee(id, auth)
  if (e.userId) throw conflict('This staff member already has a login.')
  const made = await createUser({ name: e.name, email: email || e.email, mobile: e.mobile, designation: e.designation, roleIds, departmentIds: e.departmentId ? [e.departmentId] : [], branchId: e.branchId, invite, password }, auth)
  e.userId = made.user.id
  if (!e.email) e.email = email
  await e.save()
  if (!quiet) await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Made a login for ${e.name}` }, req)
  return { employee: await getEmployee(id, auth), tempPassword: made.tempPassword, inviteToken: made.inviteToken }
}

/**
 * A staff record for every login that has none — the quick start for a school whose teachers were added as users
 * first. Teachers (with an allocation or a class this year) come in as Teaching; everyone else as Administration.
 */
export async function recordsFromLogins(auth, req) {
  const linked = (await Employee.find({ userId: { $ne: null } }).select('userId').lean()).map((e) => String(e.userId))
  const users = await User.find({ active: true, _id: { $nin: linked } }).lean()
  const teachers = new Set([...(await TeacherAllocation.distinct('teacherId')), ...(await Section.distinct('classTeacherId'))].filter(Boolean).map(String))
  let made = 0
  for (const u of users) {
    const joined = new Date(u.createdAt ?? Date.now()).toISOString().slice(0, 10)
    await Employee.create({
      employeeCode: await nextNumber('EMPLOYEE', { branchId: u.branchId }), userId: u._id, name: u.name, email: u.email, mobile: u.mobile, designation: u.designation,
      category: teachers.has(String(u._id)) ? 'TEACHING' : 'ADMIN', employmentType: 'PERMANENT', joiningDate: joined,
      departmentId: u.departmentIds?.[0], branchId: u.branchId, jobHistory: [{ type: 'JOINED', date: joined, by: auth.user?.name, at: new Date() }], createdBy: auth.user?.name,
    })
    made++
  }
  if (made) await audit({ action: 'CREATE', module: 'hrms', entityType: 'employee', entityName: `${made} staff`, summary: `Made ${made} staff record(s) from logins` }, req)
  return { made }
}

/**
 * Add many at once from a spreadsheet. Columns: employeeCode (blank = next number), name, designation, category,
 * employmentType, joiningDate, gender, dob, mobile, email. A dry run checks every row and saves nothing.
 */
export async function importEmployees(rows, { dryRun }, auth, req) {
  const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const taken = new Set((await Employee.find().select('employeeCode').lean()).map((e) => e.employeeCode))
  const seen = new Set()
  const pick = (list, v) => list.find((c) => c.value === cell(v).toUpperCase().replace(/[\s-]+/g, '_') || c.label.toLowerCase() === cell(v).toLowerCase())?.value
  const out = rows.map((f, i) => {
    const errors = []
    const doc = {
      employeeCode: cell(f.employeeCode).toUpperCase() || undefined, name: cell(f.name), designation: cell(f.designation) || undefined,
      category: pick(EMPLOYEE_CATEGORIES, f.category), employmentType: pick(EMPLOYMENT_TYPES, f.employmentType) ?? 'PERMANENT',
      joiningDate: cell(f.joiningDate), gender: cell(f.gender).toUpperCase() || undefined, dob: cell(f.dob) || undefined,
      mobile: cell(f.mobile) || undefined, email: cell(f.email).toLowerCase() || undefined,
    }
    if (doc.name.length < 2) errors.push({ field: 'name', message: 'Enter the name' })
    if (!doc.category) errors.push({ field: 'category', message: cell(f.category) ? `No category "${cell(f.category)}"` : 'Enter the category' })
    if (cell(f.employmentType) && !pick(EMPLOYMENT_TYPES, f.employmentType)) errors.push({ field: 'employmentType', message: `No employment type "${cell(f.employmentType)}"` })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.joiningDate)) errors.push({ field: 'joiningDate', message: 'Use YYYY-MM-DD' })
    if (doc.dob && !/^\d{4}-\d{2}-\d{2}$/.test(doc.dob)) errors.push({ field: 'dob', message: 'Use YYYY-MM-DD' })
    if (doc.gender && !['MALE', 'FEMALE', 'OTHER'].includes(doc.gender)) errors.push({ field: 'gender', message: 'MALE, FEMALE or OTHER' })
    if (doc.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(doc.email)) errors.push({ field: 'email', message: 'Not an email address' })
    if (doc.employeeCode && (taken.has(doc.employeeCode) || seen.has(doc.employeeCode))) errors.push({ field: 'employeeCode', message: taken.has(doc.employeeCode) ? 'Already used' : 'Twice in this file' })
    if (doc.employeeCode) seen.add(doc.employeeCode)
    return { row: i + 1, fields: f, errors, doc }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let imported = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    try {
      const d = r.doc
      await Employee.create({ ...d, employeeCode: d.employeeCode || await nextNumber('EMPLOYEE'), jobHistory: [{ type: 'JOINED', date: d.joiningDate, to: d.designation, by: auth.user?.name, at: new Date() }], createdBy: auth.user?.name })
      imported++
    } catch (e) {
      errors.push({ row: r.row, field: e.code === 11000 ? 'employeeCode' : 'name', message: e.code === 11000 ? 'Already used' : e.message })
    }
  }
  if (imported) await audit({ action: 'IMPORT', module: 'hrms', entityType: 'employee', entityName: `${imported} staff`, summary: `Imported ${imported} staff record(s) from a file` }, req)
  return { imported, errors }
}

export async function exportEmployees(q, auth) {
  const rows = await Employee.find(listFilter(q, auth)).sort({ name: 1 }).lean()
  const n = await names()
  const head = ['Code', 'Name', 'Designation', 'Category', 'Employment', 'Department', 'Campus', 'Mobile', 'Email', 'Joined', 'Status', 'Last working day']
  const lines = rows.map((e) => [e.employeeCode, e.name, e.designation, label(EMPLOYEE_CATEGORIES, e.category), label(EMPLOYMENT_TYPES, e.employmentType), n.dep.get(String(e.departmentId)), n.branch.get(String(e.branchId)), e.mobile, e.email, e.joiningDate, EMPLOYEE_STATUSES[e.status]?.label, e.exit?.lastWorkingDate])
  return [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── exit

/** Resignation, retirement, termination: on notice until the last working day, then left (the login is switched off then). */
export async function exitEmployee(id, input, auth, req) {
  const e = await findEmployee(id, auth)
  if (e.status === 'EXITED') throw conflict('This person has already left.')
  if (input.lastWorkingDate < e.joiningDate) throw badRequest('Some details need fixing.', { fields: { lastWorkingDate: 'Before they joined' } })
  const today = await todayYmd()
  e.exit = { type: input.type, noticeDate: input.noticeDate || today, lastWorkingDate: input.lastWorkingDate, reason: input.reason, deactivateLogin: input.deactivateLogin !== false, ...stamp(auth) }
  e.status = input.lastWorkingDate < today ? 'EXITED' : 'NOTICE'
  e.jobHistory.push({ type: 'EXIT', date: input.lastWorkingDate, note: `${label(EXIT_TYPES, input.type)}${input.reason ? ` — ${input.reason}` : ''}`, by: auth.user?.name, at: new Date() })
  await e.save()
  if (e.status === 'EXITED') await closeLogin(e)
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `${label(EXIT_TYPES, input.type)}: ${e.name}, last working day ${input.lastWorkingDate}` }, req)
  return getEmployee(id, auth)
}

/** Take back a resignation (while on notice), or rejoin someone who left by mistake. */
export async function cancelExit(id, auth, req) {
  const e = await findEmployee(id, auth)
  if (!e.exit?.type) throw conflict('Nothing to take back.')
  e.jobHistory.push({ type: 'EXIT_CANCELLED', date: await todayYmd(), note: 'Exit taken back', by: auth.user?.name, at: new Date() })
  e.exit = undefined
  e.status = 'ACTIVE'
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Took back the exit of ${e.name}` }, req)
  return getEmployee(id, auth)
}

/** Switch off the login of someone who has left (unless HR said to keep it). */
async function closeLogin(e) {
  if (!e.userId || e.exit?.deactivateLogin === false) return
  const r = await User.updateOne({ _id: e.userId, active: true }, { $set: { active: false } })
  if (!r.modifiedCount) return
  await revokeUserSessions(e.userId, 'USER_DEACTIVATED')
  await bumpAccessVersion(getContext()?.tenantId)
  await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(e.userId), entityName: e.name, summary: `Deactivated the login of ${e.name} (left the staff)` })
}

/** Daily: people whose last working day has passed are moved to "left" and their login is switched off. */
export async function sweepExits() {
  const today = await todayYmd()
  const due = await Employee.find({ status: 'NOTICE', 'exit.lastWorkingDate': { $lt: today } })
  for (const e of due) {
    e.status = 'EXITED'
    await e.save()
    await closeLogin(e)
  }
  return due.length
}

// ───────────────────────────────────────────────────────── holidays

export async function listHolidays({ year }) {
  const y = /^\d{4}$/.test(String(year ?? '')) ? String(year) : (await todayYmd()).slice(0, 4)
  const rows = await Holiday.find({ date: { $gte: `${y}-01-01`, $lte: `${y}-12-31` } }).sort({ date: 1 }).lean()
  const n = await names()
  return rows.map((h) => ({ ...clean(h), branchIds: h.branchIds.map(String), branches: h.branchIds.map((b) => n.branch.get(String(b))).filter(Boolean) }))
}

export async function saveHoliday(id, input, auth, req) {
  const h = id ? await Holiday.findById(id) : new Holiday({ createdBy: auth.user?.name })
  if (!h) throw notFound('Holiday')
  Object.assign(h, { date: input.date, name: input.name, branchIds: input.branchIds ?? [], optional: !!input.optional, forStudents: input.forStudents !== false })
  await h.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'holiday', entityId: String(h._id), entityName: h.name, summary: `${id ? 'Updated' : 'Added'} holiday ${h.name} on ${h.date}` }, req)
  return clean(h.toObject())
}

/** Many at once — a pasted list ("2026-01-26 Republic Day"). Days already on the list are skipped. */
export async function addHolidays(rows, auth, req) {
  let added = 0
  for (const r of rows) {
    if (await Holiday.exists({ date: r.date, name: r.name })) continue
    await Holiday.create({ date: r.date, name: r.name, optional: !!r.optional, forStudents: r.forStudents !== false, createdBy: auth.user?.name })
    added++
  }
  if (added) await audit({ action: 'IMPORT', module: 'hrms', entityType: 'holiday', entityName: `${added} holidays`, summary: `Added ${added} holiday(s)` }, req)
  return { added }
}

export async function deleteHoliday(id, req) {
  const h = isOid(id) ? await Holiday.findById(id) : null
  if (!h) throw notFound('Holiday')
  await Holiday.deleteOne({ _id: h._id })
  await audit({ action: 'DELETE', module: 'hrms', entityType: 'holiday', entityId: String(h._id), entityName: h.name, summary: `Deleted holiday ${h.name} (${h.date})` }, req)
  return { deleted: true }
}

/** Settings the HR screens need (weekly off, leave year). */
export const hrRules = hrSettings

// ───────────────────────────────────────────────────────── self-service

/** My workspace: the person's own record (no salary or ids), their manager and the holidays coming up. */
export async function myRecord(auth) {
  const e = await myEmployee(auth)
  const n = await names()
  const today = await todayYmd()
  const [manager, holidays, reports] = await Promise.all([
    e.reportingManagerId ? Employee.findById(e.reportingManagerId).select('name designation').lean() : null,
    Holiday.find({ date: { $gte: today } }).sort({ date: 1 }).limit(8).lean(),
    Employee.countDocuments({ reportingManagerId: e._id, status: { $ne: 'EXITED' } }),
  ])
  return {
    ...row(e, n), gender: e.gender ?? null, dob: e.dob ?? null, bloodGroup: e.bloodGroup ?? null, qualifications: e.qualifications ?? null,
    emergencyContact: e.emergencyContact ?? {}, address: e.address ?? {},
    manager: manager && { name: manager.name, designation: manager.designation ?? null }, reports,
    holidays: holidays.filter((h) => !h.branchIds?.length || h.branchIds.some((b) => String(b) === String(e.branchId))).map((h) => ({ date: h.date, name: h.name, optional: h.optional })),
  }
}

/** The bits of their own record a person may change: mobile, address, emergency contact. */
export async function updateMyRecord(input, auth, req) {
  const e = await myEmployee(auth, { lean: false })
  for (const k of ['mobile', 'address', 'emergencyContact', 'bloodGroup']) if (input[k] !== undefined) e[k] = input[k] || undefined
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `${e.name} updated their contact details` }, req)
  return myRecord(auth)
}

/** The job: each institution with someone whose notice has ended (by its own date) gets its sweep. */
export async function sweepAllExits() {
  const yesterdayUtc = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const tenants = await runAsSystem(() => Employee.distinct('tenantId', { status: 'NOTICE', 'exit.lastWorkingDate': { $lte: yesterdayUtc } }).setOptions({ allTenants: true }))
  let n = 0
  for (const t of tenants) n += await runAsTenant(t, () => sweepExits())
  return n
}
