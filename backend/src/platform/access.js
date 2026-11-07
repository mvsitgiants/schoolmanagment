import {
  FULL_ACCESS, MODULES, MODULE_BY_ID, STAFF_BASELINE_PERMISSIONS, hasPermissionIn,
} from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { Role, TenantModule, User } from '../models/tenant.js'
import { runAsTenant } from './context.js'
import { getSetting } from './settings.js'

// Effective access of a signed-in tenant user = union of their roles, limited to the
// modules switched on for the tenant. Rebuilt whenever tenant.accessVersion changes
// (any role, user or module edit bumps it), so a role change applies on the next
// request without signing anyone out. (docs/04 §6)

const cache = new Map() // `${tenantId}:${userId}` → { version, access }

const SCOPE_RANK = { OWN: 1, DEPARTMENT: 2, WARD: 2, BRANCH: 3, ALL: 4 }

export async function bumpAccessVersion(tenantId) {
  await Tenant.updateOne({ _id: tenantId }, { $inc: { accessVersion: 1 } })
}

export async function enabledModuleIds(tenantId) {
  return runAsTenant(tenantId, async () => {
    const rows = await TenantModule.find({ enabled: true }).select('moduleId').lean()
    const ids = new Set(rows.map((r) => r.moduleId))
    for (const m of MODULES) if (m.mandatory) ids.add(m.id)
    return MODULES.map((m) => m.id).filter((id) => ids.has(id))
  })
}

/** Merge several roles into one effective access (union / widest scope / highest limit). */
export function mergeRoles(roles, enabledIds) {
  const enabled = new Set(enabledIds)
  const fullAccess = roles.some((r) => r.fullAccess)
  const perms = new Set()
  const dataScopes = {}
  const limits = {}
  for (const r of roles) {
    for (const p of r.permissions ?? []) {
      if (enabled.has(p.split('.')[0])) perms.add(p)
    }
    for (const [mod, scope] of Object.entries(r.dataScopes ?? {})) {
      if (!dataScopes[mod] || SCOPE_RANK[scope] > SCOPE_RANK[dataScopes[mod]]) dataScopes[mod] = scope
    }
    for (const [key, val] of Object.entries(r.limits ?? {})) {
      if (val === null || val === undefined || val === '') continue
      limits[key] = Math.max(limits[key] ?? -Infinity, Number(val))
    }
  }
  return {
    fullAccess,
    permissions: fullAccess ? [FULL_ACCESS] : [...perms].sort(),
    dataScopes: fullAccess ? { default: 'ALL' } : dataScopes,
    limits: fullAccess ? {} : limits,
    homePage: roles.find((r) => r.homePage)?.homePage || null,
  }
}

export async function loadAccess(tenantId, userId) {
  const tenant = await Tenant.findById(tenantId).lean()
  if (!tenant) return null
  const key = `${tenantId}:${userId}`
  const hit = cache.get(key)
  if (hit && hit.version === tenant.accessVersion) return { ...hit.access, tenant }

  const access = await runAsTenant(tenantId, async () => {
    const user = await User.findById(userId).lean()
    if (!user) return null
    const roles = await Role.find({ _id: { $in: user.roleIds } }).lean()
    const enabled = await enabledModuleIds(tenantId)
    const merged = mergeRoles(roles, enabled)
    // idle sign-out: the strictest of the user's roles that set one, else the institution default
    const roleIdle = roles.map((r) => r.security?.idleMinutes).filter((m) => Number.isFinite(m) && m > 0)
    merged.require2fa = roles.some((r) => r.security?.require2fa)
    merged.idleMinutes = roleIdle.length ? Math.min(...roleIdle) : Number(await getSetting('core', 'sessionIdleMinutes')) || 30
    // every staff member can call and chat (see STAFF_BASELINE_PERMISSIONS), even with no role
    if (!merged.fullAccess) {
      const on = new Set(enabled)
      merged.permissions = [...new Set([...merged.permissions, ...STAFF_BASELINE_PERMISSIONS.filter((p) => on.has(p.split('.')[0]))])].sort()
    }
    return {
      user,
      roles: roles.map((r) => ({ id: String(r._id), name: r.name, fullAccess: r.fullAccess, system: r.system })),
      enabledModules: enabled,
      ...merged,
    }
  })
  if (!access) return null
  cache.set(key, { version: tenant.accessVersion, access })
  return { ...access, tenant }
}

export const forgetAccess = () => cache.clear()

/** Is the module switched on for this request's tenant? */
export const moduleEnabled = (auth, moduleId) =>
  !!MODULE_BY_ID[moduleId]?.mandatory || auth.enabledModules?.includes(moduleId)

export const can = (auth, key) => !!auth?.superadmin || hasPermissionIn(auth?.permissions, key)

/** The caller's data scope for a module: OWN · DEPARTMENT · WARD · BRANCH · ALL. */
export function scopeOf(auth, moduleId) {
  if (auth?.superadmin || auth?.fullAccess) return 'ALL'
  return auth?.dataScopes?.[moduleId] || auth?.dataScopes?.default || 'BRANCH'
}
