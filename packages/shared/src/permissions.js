import { MODULES, MODULE_BY_ID, SOD_RULES, pagePath } from './catalog.js'

/** Held by full-access roles: every permission of every enabled module, now and later. */
export const FULL_ACCESS = '*'

/**
 * Permissions every signed-in staff member holds whatever their roles say (in modules the tenant has
 * switched on). Empty for now; e.g. staff chat would go here so no custom role can forget it.
 */
export const STAFF_BASELINE_PERMISSIONS = []

export const permKey = (moduleId, pageId, actionId) => `${moduleId}.${pageId}.${actionId}`

// key → { key, module, page, action, … } for every permission in the catalog
const INDEX = new Map()
for (const m of MODULES) {
  for (const p of m.pages) {
    for (const a of p.actions) {
      const key = permKey(m.id, p.id, a.id)
      INDEX.set(key, {
        key, module: m.id, page: p.id, action: a.id,
        moduleName: m.name, pageName: p.name, label: a.label,
        sensitive: !!a.sensitive, standard: !!a.standard, setup: !!p.setup,
      })
    }
  }
}

export const isKnownPermission = (key) => INDEX.has(key)

/** Human description of a key, e.g. "Nursing › Nursing chart › Give medication". */
export function describePermission(key) {
  const meta = INDEX.get(key)
  if (!meta) return { key, label: key, exists: false }
  return { ...meta, exists: true, text: `${meta.moduleName} › ${meta.pageName} › ${meta.label}` }
}

/** Every permission key in the catalog, optionally limited to some modules. */
export function allPermissions(moduleIds) {
  const only = moduleIds ? new Set(moduleIds) : null
  return [...INDEX.values()].filter((p) => !only || only.has(p.module)).map((p) => p.key)
}

/**
 * Clean a permission list before saving it on a role:
 * drop unknown keys, and make sure a page's `view` is held whenever any other
 * action on that page is (you can't act on a page you can't open).
 */
export function normalizePermissions(perms = []) {
  if (perms.includes(FULL_ACCESS)) return [FULL_ACCESS]
  const out = new Set(perms.filter((k) => INDEX.has(k)))
  for (const key of [...out]) {
    const meta = INDEX.get(key)
    const view = permKey(meta.module, meta.page, 'view')
    if (meta.action !== 'view' && INDEX.has(view)) out.add(view)
  }
  return [...out].sort()
}

/** Does a permission set allow this key? Superadmin / '*' always pass. */
export function hasPermissionIn(perms, key) {
  if (!perms) return false
  if (perms.includes(FULL_ACCESS)) return true
  return perms.includes(key)
}

/** Any-of check. */
export const hasAnyPermissionIn = (perms, keys) => keys.some((k) => hasPermissionIn(perms, k))

// ─────────────────────────────────────────────────────────── module dependencies

/** Add every (transitive) hard dependency, plus mandatory modules. */
export function closeOverDependencies(moduleIds = []) {
  const out = new Set(MODULES.filter((m) => m.mandatory).map((m) => m.id))
  const visit = (id) => {
    if (out.has(id) && !MODULE_BY_ID[id]?.mandatory) return
    const mod = MODULE_BY_ID[id]
    if (!mod) return
    out.add(id)
    for (const dep of mod.deps ?? []) visit(dep)
  }
  for (const id of moduleIds) visit(id)
  // keep catalog order so lists render in a stable order
  return MODULES.map((m) => m.id).filter((id) => out.has(id))
}

/** Enabled modules that hard-depend on `moduleId` (these block disabling it). */
export function dependentsOf(moduleId, enabledIds) {
  const enabled = new Set(enabledIds)
  return MODULES.filter((m) => enabled.has(m.id) && (m.deps ?? []).includes(moduleId)).map((m) => m.id)
}

/** Hard dependencies of `moduleId` that are not yet enabled (these block enabling it). */
export function missingDependencies(moduleId, enabledIds) {
  const enabled = new Set(enabledIds)
  return (MODULE_BY_ID[moduleId]?.deps ?? []).filter((d) => !enabled.has(d))
}

// ─────────────────────────────────────────────────────────── role analysis

/** Separation-of-duty warnings for a permission set. */
export function sodWarnings(perms = []) {
  if (perms.includes(FULL_ACCESS)) return []
  const set = new Set(perms)
  return SOD_RULES.filter(([a, b]) => set.has(a) && set.has(b)).map(([a, b, message]) => ({ a, b, message }))
}

export const sensitivePermissions = (perms = []) =>
  perms.filter((k) => INDEX.get(k)?.sensitive)

/** Modules a permission set touches (has at least one page view in). */
export function modulesTouched(perms = []) {
  return [...new Set(perms.map((k) => INDEX.get(k)?.module).filter(Boolean))]
}

/**
 * Pages a permission set can open, in catalog order — this drives the sidebar.
 * `enabledIds` limits it to modules switched on for the tenant.
 */
export function visiblePages(perms = [], enabledIds) {
  const enabled = enabledIds ? new Set(enabledIds) : null
  const out = []
  for (const m of MODULES) {
    if (enabled && !enabled.has(m.id)) continue
    const pages = m.pages.filter((p) => p.nav !== false && hasPermissionIn(perms, permKey(m.id, p.id, 'view')))
    if (pages.length) out.push({ module: m, pages: pages.map((p) => ({ ...p, path: pagePath(m.id, p.id) })) })
  }
  return out
}

// ─────────────────────────────────────────────────────────── template grants

/**
 * Expand compact template grants into permission keys.
 *   [moduleId, pages, level]
 *   pages: '*' (all pages; setup pages only with level F) | 'pageId' | ['a', 'b']
 *   level: 'V' view · 'W' view+create+edit+print+export · 'A' all except delete and sensitive ·
 *          'F' everything · '+act act' exactly these actions (view added automatically)
 */
export function expandGrants(grants = []) {
  const out = new Set()
  for (const [moduleId, pages, level] of grants) {
    const mod = MODULE_BY_ID[moduleId]
    if (!mod) throw new Error(`Unknown module in template grant: ${moduleId}`)
    const chosen = pages === '*'
      ? mod.pages.filter((p) => level === 'F' || !p.setup)
      : mod.pages.filter((p) => [].concat(pages).includes(p.id))
    if (pages !== '*' && chosen.length !== [].concat(pages).length) {
      throw new Error(`Unknown page in template grant: ${moduleId} ${[].concat(pages).join(',')}`)
    }
    for (const p of chosen) {
      for (const a of p.actions) {
        let take = false
        if (level === 'F') take = true
        else if (level === 'A') take = a.id !== 'delete' && !a.sensitive
        else if (level === 'W') take = ['view', 'create', 'edit', 'print', 'export'].includes(a.id)
        else if (level === 'V') take = a.id === 'view'
        else if (level.startsWith('+')) take = level.slice(1).trim().split(/\s+/).includes(a.id)
        if (take) out.add(permKey(moduleId, p.id, a.id))
      }
    }
  }
  return normalizePermissions([...out])
}
