import { Role, Branch, Department, User } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { escapeRegex } from '../platform/validate.js'
import { cell, checkRow, compact } from '../platform/importRows.js'
import { assertWithinLimit } from './subscription.js'
import { TEMP_PASSWORD_HOURS, createUser } from './users.js'

// Administration onboarding imports: departments and users (Administration › Departments / Users › Import).
// Users get a temporary password each (valid TEMP_PASSWORD_HOURS, must be changed at first sign-in);
// the result carries them once, for the admin to hand out — they are never stored in clear.

const same = (v) => new RegExp(`^${escapeRegex(cell(v))}$`, 'i')
const list = (v) => cell(v).split(/[|;,]/).map((x) => x.trim()).filter(Boolean)

export async function importDepartments(rows, { dryRun, schema }, req) {
  const seen = new Set()
  const out = rows.map((f, i) => {
    const { doc, errors } = checkRow(schema, compact({
      name: cell(f.name), code: cell(f.code), type: cell(f.type).toUpperCase() || undefined,
      specialities: cell(f.specialities) ? list(f.specialities) : undefined, description: cell(f.description) || undefined,
    }))
    const code = cell(f.code).toUpperCase()
    if (code && seen.has(code)) errors.push({ field: 'code', message: 'Twice in this file' })
    seen.add(code)
    return { row: i + 1, fields: f, errors, doc }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let created = 0
  let updated = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    const existing = await Department.findOne({ code: r.doc.code })
    if (existing) { Object.assign(existing, r.doc); await existing.save(); updated++ } else { await Department.create(r.doc); created++ }
  }
  await audit({ action: 'IMPORT', module: 'core', entityType: 'department', entityId: 'import', entityName: 'Departments', summary: `Imported departments from a file: ${created} added, ${updated} updated` }, req)
  return { imported: created + updated, errors }
}

export async function importUsers(rows, { dryRun, schema }, auth, req) {
  const [roles, departments, branches] = await Promise.all([Role.find().select('name').lean(), Department.find({ active: true }).select('name code').lean(), Branch.find().select('name code').lean()])
  const roleOf = (n) => roles.find((r) => r.name.toLowerCase() === n.toLowerCase())
  const deptOf = (n) => departments.find((d) => d.code === n.toUpperCase() || d.name.toLowerCase() === n.toLowerCase())
  const seen = new Set()
  const out = []
  for (const [i, f] of rows.entries()) {
    const errors = []
    const roleNames = list(f.roles)
    const missingRole = roleNames.find((n) => !roleOf(n))
    if (missingRole) errors.push({ field: 'roles', message: `No role called "${missingRole}"` })
    const deptNames = list(f.departments)
    const missingDept = deptNames.find((n) => !deptOf(n))
    if (missingDept) errors.push({ field: 'departments', message: `No department "${missingDept}"` })
    const branch = cell(f.branch) ? branches.find((b) => b.code === cell(f.branch).toUpperCase() || b.name.toLowerCase() === cell(f.branch).toLowerCase()) : null
    if (cell(f.branch) && !branch) errors.push({ field: 'branch', message: 'No branch with this name or code' })
    const checked = checkRow(schema, compact({
      name: cell(f.name), email: cell(f.email).toLowerCase(), mobile: cell(f.mobile) || undefined, designation: cell(f.designation) || undefined,
      roleIds: roleNames.map(roleOf).filter(Boolean).map((r) => String(r._id)),
      departmentIds: deptNames.map(deptOf).filter(Boolean).map((d) => String(d._id)),
      branchId: branch ? String(branch._id) : undefined,
    }), { roleIds: 'roles', departmentIds: 'departments', branchId: 'branch' })
    if (!missingRole && !missingDept) errors.push(...checked.errors)
    const mail = cell(f.email).toLowerCase()
    if (mail && seen.has(mail)) errors.push({ field: 'email', message: 'Twice in this file' })
    seen.add(mail)
    if (mail && !errors.length && await User.exists({ email: same(mail) })) errors.push({ field: 'email', message: 'Already a user here' })
    out.push({ row: i + 1, fields: f, errors, doc: checked.doc })
  }
  // the plan's user limit, for the whole file at once
  const good = out.filter((r) => !r.errors.length)
  if (good.length) {
    try { await assertWithinLimit(auth.tenantId, 'users', good.length) } catch (e) { good[0].errors.push({ field: 'email', message: e.message }) }
  }
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let imported = 0
  const errors = []
  const credentials = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    try {
      const { user, tempPassword } = await createUser(r.doc, auth) // checks role rights (assertCanAssign) and the limit again
      credentials.push({ name: user.name, email: user.email, tempPassword })
      imported++
    } catch (e) {
      errors.push({ row: r.row, field: 'roles', message: e.message })
    }
  }
  await audit({ action: 'IMPORT', module: 'core', entityType: 'user', entityId: 'import', entityName: 'Users', summary: `Imported ${imported} user(s) from a file (temporary passwords, valid ${TEMP_PASSWORD_HOURS} h)` }, req)
  return { imported, errors, credentials, validHours: TEMP_PASSWORD_HOURS }
}
