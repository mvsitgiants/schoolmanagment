import {
  CATEGORIES, FULL_ACCESS, MODULES, MODULE_BY_ID, ROLE_LIMITS, SCOPE_LABELS, SOD_RULES,
  allPermissions, closeOverDependencies, describePermission, hasPermissionIn, modulesTouched,
  normalizePermissions, sensitivePermissions, sodWarnings,
} from '@schoolgiant/shared'
import { Plan, RoleTemplate } from '../models/platform.js'
import { AuditLog, Role, User } from '../models/tenant.js'
import { bumpAccessVersion } from '../platform/access.js'
import { audit, diffFields, diffLists } from '../platform/audit.js'
import { clean } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'

// Role rules (docs/04 §7):
//   · the system "Institution Admin" role is locked — no rename, no reduction, no delete;
//   · no escalation — you can only grant permissions you hold yourself;
//   · only full-access users can grant full access;
//   · non-full users can't edit a role they hold themselves;
//   · at least one active user with full access must always remain.

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const actorHolds = (auth, key) => auth.fullAccess || hasPermissionIn(auth.permissions, key)

function assertCanGrant(auth, keys) {
  if (auth.fullAccess) return
  const missing = keys.filter((k) => !hasPermissionIn(auth.permissions, k))
  if (missing.length) {
    throw forbidden(`You can only grant permissions you hold yourself. Not yours: ${missing.slice(0, 5).map((k) => describePermission(k).text).join('; ')}${missing.length > 5 ? ' …' : ''}`, { missing })
  }
}

/** Active users who would still hold full access after a change. */
export async function fullAdminCount({ dropRoleId, dropUserId, user } = {}) {
  const fullRoles = await Role.find({ fullAccess: true }).select('_id').lean()
  const fullIds = fullRoles.map((r) => String(r._id)).filter((id) => id !== String(dropRoleId ?? ''))
  const filter = { active: true, roleIds: { $in: fullIds } }
  if (dropUserId || user) filter._id = { $ne: dropUserId ?? user.id }
  let count = await User.countDocuments(filter)
  if (user?.active && user.roleIds?.some((r) => fullIds.includes(String(r)))) count++
  return count
}

export async function assertFullAdminRemains(change) {
  if ((await fullAdminCount(change)) < 1) {
    throw conflict('At least one active user must keep full access (Institution Admin). Give another user full access first.')
  }
}

/** Sanitise a role's data scopes: only known modules, only scopes the module offers. */
function cleanScopes(scopes = {}) {
  const out = {}
  for (const [mod, scope] of Object.entries(scopes)) {
    if (mod === 'default') { if (SCOPE_LABELS[scope]) out.default = scope; continue }
    const allowed = MODULE_BY_ID[mod]?.scopes
    if (allowed?.includes(scope)) out[mod] = scope
  }
  return out
}

function cleanLimits(limits = {}) {
  const out = {}
  for (const def of ROLE_LIMITS) {
    const v = limits[def.key]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${def.label} must be zero or more.`)
    if (def.unit === '%' && n > 100) throw badRequest(`${def.label} can't be more than 100%.`)
    out[def.key] = n
  }
  return out
}

/** Permission catalog for the role designer: every module, with plan/enabled state and grantability. */
export async function catalogFor(auth) {
  const plan = await Plan.findOne({ code: auth.tenant.planCode }).lean()
  const inPlan = new Set(closeOverDependencies(plan?.modules ?? []))
  const enabled = new Set(auth.enabledModules)
  return {
    categories: CATEGORIES,
    scopeLabels: SCOPE_LABELS,
    limits: ROLE_LIMITS.filter((l) => enabled.has(l.module)),
    sod: SOD_RULES.map(([a, b, message]) => ({ a, b, message })),
    plan: plan ? { code: plan.code, name: plan.name } : null,
    modules: MODULES.map((m) => ({
      id: m.id, name: m.name, category: m.category, icon: m.icon, desc: m.desc,
      mandatory: !!m.mandatory, internal: !!m.internal, scopes: m.scopes ?? null,
      inPlan: inPlan.has(m.id), enabled: enabled.has(m.id) || !!m.mandatory,
      pages: m.pages.map((p) => ({
        id: p.id, name: p.name, setup: !!p.setup, nav: p.nav !== false,
        actions: p.actions.map((a) => {
          const key = `${m.id}.${p.id}.${a.id}`
          return { id: a.id, label: a.label, sensitive: !!a.sensitive, standard: !!a.standard, key, grantable: actorHolds(auth, key) }
        }),
      })),
    })),
  }
}

function summarise(role, userCount = 0, enabledIds) {
  const perms = role.fullAccess ? [] : (role.permissions ?? []).filter((k) => !enabledIds || enabledIds.has(k.split('.')[0]))
  return {
    ...clean(role),
    userCount,
    permissionCount: role.fullAccess ? null : perms.length,
    moduleCount: role.fullAccess ? null : modulesTouched(perms).length,
    sensitiveCount: role.fullAccess ? null : sensitivePermissions(perms).length,
    sodCount: role.fullAccess ? 0 : sodWarnings(perms).length,
  }
}

async function memberCounts() {
  const rows = await User.aggregate([{ $match: { active: true } }, { $unwind: '$roleIds' }, { $group: { _id: '$roleIds', n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

export async function listRoles(auth) {
  const [roles, counts] = await Promise.all([Role.find().sort({ system: -1, name: 1 }).lean(), memberCounts()])
  const enabled = new Set(auth.enabledModules)
  return roles.map((r) => summarise(r, counts.get(String(r._id)) ?? 0, enabled))
}

export async function getRole(id, auth) {
  const role = await Role.findById(id).lean()
  if (!role) throw notFound('Role')
  const counts = await memberCounts()
  return summarise(role, counts.get(String(role._id)) ?? 0, new Set(auth.enabledModules))
}

async function assertNameFree(name, exceptId) {
  const clash = await Role.findOne({ nameLower: name.trim().toLowerCase(), _id: { $ne: exceptId } }).lean()
  if (clash) throw conflict(`A role named "${clash.name}" already exists.`, { fields: { name: 'Already in use' } })
}

export async function createRole(input, auth) {
  if (input.fullAccess && !auth.fullAccess) throw forbidden('Only a full-access administrator can create a full-access role.')
  const permissions = input.fullAccess ? [FULL_ACCESS] : normalizePermissions(input.permissions)
  if (!input.fullAccess) assertCanGrant(auth, permissions)
  await assertNameFree(input.name)
  const role = await Role.create({
    name: input.name.trim(),
    description: input.description,
    icon: input.icon,
    fullAccess: !!input.fullAccess,
    permissions,
    dataScopes: cleanScopes(input.dataScopes),
    limits: cleanLimits(input.limits),
    homePage: input.homePage || undefined,
    security: input.security,
    templateCode: input.templateCode,
  })
  await audit({
    action: 'CREATE', module: 'core', entityType: 'role', entityId: String(role._id), entityName: role.name,
    summary: input.fullAccess ? `Created role "${role.name}" with full access` : `Created role "${role.name}" with ${permissions.length} permissions`,
    added: input.fullAccess ? [FULL_ACCESS] : permissions,
  })
  return getRole(role._id, auth)
}

export async function updateRole(id, input, auth) {
  const role = await Role.findById(id)
  if (!role) throw notFound('Role')
  const before = role.toObject()

  if (role.locked) {
    const touchesLocked = ['name', 'permissions', 'fullAccess', 'dataScopes', 'limits'].some((f) => input[f] !== undefined)
    if (touchesLocked) throw forbidden(`"${role.name}" is the built-in administrator role. Only its description can change.`)
  }
  if (!auth.fullAccess && auth.user.roleIds.some((r) => String(r) === String(role._id))) {
    throw forbidden("You can't edit a role you hold yourself. Ask another administrator.")
  }
  if (input.fullAccess !== undefined && input.fullAccess !== role.fullAccess && !auth.fullAccess) {
    throw forbidden('Only a full-access administrator can switch full access on or off.')
  }

  if (input.name !== undefined && input.name.trim() !== role.name) {
    await assertNameFree(input.name, role._id)
    role.name = input.name.trim()
  }
  if (input.description !== undefined) role.description = input.description
  if (input.icon !== undefined) role.icon = input.icon
  if (input.homePage !== undefined) role.homePage = input.homePage || undefined
  if (input.security !== undefined) role.security = { ...role.security, ...input.security }
  if (input.dataScopes !== undefined) role.dataScopes = cleanScopes(input.dataScopes)
  if (input.limits !== undefined) role.limits = cleanLimits(input.limits)

  let added = []
  let removed = []
  if (input.fullAccess !== undefined || input.permissions !== undefined) {
    const full = input.fullAccess ?? role.fullAccess
    const next = full ? [FULL_ACCESS] : normalizePermissions(input.permissions ?? role.permissions)
    ;({ added, removed } = diffLists(role.permissions, next))
    if (!full) assertCanGrant(auth, [...added, ...removed].filter((k) => k !== FULL_ACCESS))
    if (role.fullAccess && !full) await assertFullAdminRemains({ dropRoleId: role._id })
    role.fullAccess = full
    role.permissions = next
  }

  await role.save()
  const changes = diffFields(before, role.toObject(), ['name', 'description', 'homePage', 'fullAccess', 'dataScopes', 'limits'])
  if (changes.length || added.length || removed.length) {
    await audit({
      action: 'UPDATE', module: 'core', entityType: 'role', entityId: String(role._id), entityName: role.name,
      summary: capitalise([
        changes.length && `changed ${changes.map((c) => c.field).join(', ')}`,
        added.length && `added ${added.length} permission${added.length === 1 ? '' : 's'}`,
        removed.length && `removed ${removed.length} permission${removed.length === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' · ')),
      changes, added, removed,
    })
    await bumpAccessVersion(auth.tenantId)
  }
  return getRole(role._id, auth)
}

export async function deleteRole(id, { moveMembersTo } = {}, auth) {
  const role = await Role.findById(id)
  if (!role) throw notFound('Role')
  if (role.locked) throw forbidden(`"${role.name}" is the built-in administrator role and can't be deleted.`)
  const members = await User.countDocuments({ roleIds: role._id })
  if (members) {
    if (!moveMembersTo) throw conflict(`${members} user${members === 1 ? ' has' : 's have'} this role. Choose a role to move ${members === 1 ? 'them' : 'them'} to first.`, { members })
    if (String(moveMembersTo) === String(role._id)) throw badRequest('Pick a different role to move the members to.')
    const target = await Role.findById(moveMembersTo)
    if (!target) throw notFound('Target role')
    if (!auth.fullAccess) assertCanGrant(auth, target.fullAccess ? [FULL_ACCESS] : target.permissions)
    if (role.fullAccess && !target.fullAccess) await assertFullAdminRemains({ dropRoleId: role._id })
    await User.updateMany({ roleIds: role._id }, { $addToSet: { roleIds: target._id } })
    await User.updateMany({ roleIds: role._id }, { $pull: { roleIds: role._id } })
  } else if (role.fullAccess) {
    await assertFullAdminRemains({ dropRoleId: role._id })
  }
  await role.deleteOne()
  await audit({ action: 'DELETE', module: 'core', entityType: 'role', entityId: String(role._id), entityName: role.name, summary: `Deleted role "${role.name}"${members ? ` and moved ${members} user(s)` : ''}`, removed: role.permissions })
  await bumpAccessVersion(auth.tenantId)
  return { deleted: true, movedUsers: members }
}

export async function cloneRole(id, auth) {
  const src = await Role.findById(id).lean()
  if (!src) throw notFound('Role')
  let name = `Copy of ${src.name}`
  for (let i = 2; await Role.exists({ nameLower: name.toLowerCase() }); i++) name = `Copy of ${src.name} (${i})`
  return createRole({
    name, description: src.description, icon: src.icon,
    fullAccess: src.fullAccess && auth.fullAccess,
    permissions: src.fullAccess ? allPermissions(auth.enabledModules) : src.permissions,
    dataScopes: src.dataScopes, limits: src.limits, homePage: src.homePage, security: src.security,
  }, auth)
}

export async function roleMembers(id) {
  const users = await User.find({ roleIds: id }).sort({ active: -1, name: 1 }).lean()
  return users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, designation: u.designation, active: u.active, lastLoginAt: u.lastLoginAt }))
}

export async function roleHistory(id) {
  const rows = await AuditLog.find({ entityType: 'role', entityId: String(id) }).sort({ at: -1 }).limit(100).lean()
  return clean(rows)
}

export async function listTemplates(auth) {
  const enabled = new Set(auth.enabledModules)
  const [templates, roles] = await Promise.all([
    RoleTemplate.find({ active: true }).sort({ sortOrder: 1 }).lean(),
    Role.find().select('nameLower templateCode').lean(),
  ])
  const taken = new Set(roles.map((r) => r.nameLower))
  const used = new Set(roles.map((r) => r.templateCode).filter(Boolean))
  return templates.map((t) => {
    const perms = t.permissions.filter((k) => enabled.has(k.split('.')[0]))
    return {
      ...clean(t),
      permissions: perms,
      permissionCount: perms.length,
      moduleCount: modulesTouched(perms).length,
      modules: modulesTouched(perms),
      available: perms.length > 0,
      alreadyCreated: used.has(t.code) || taken.has(t.name.toLowerCase()),
    }
  })
}

/** Create roles from recommended templates (Setup hub "Team & roles"). */
export async function createFromTemplates(codes, auth) {
  const templates = await listTemplates(auth)
  const created = []
  const skipped = []
  for (const code of codes) {
    const t = templates.find((x) => x.code === code)
    if (!t) { skipped.push({ code, reason: 'Unknown template' }); continue }
    if (t.alreadyCreated) { skipped.push({ code, name: t.name, reason: 'A role with this name already exists' }); continue }
    if (!t.available) { skipped.push({ code, name: t.name, reason: 'None of its modules are in your plan' }); continue }
    const role = await createRole({
      name: t.name, description: t.description, icon: t.icon, permissions: t.permissions,
      dataScopes: t.dataScopes, limits: t.limits, homePage: t.homePage, templateCode: t.code,
    }, auth)
    created.push(role)
  }
  return { created, skipped }
}
