import { CATEGORIES, MODULES, ROLE_LIMITS, SCOPE_LABELS, SOD_RULES, permKey } from '@schoolgiant/shared'

/** Matrix columns; every other action of a page shows under "More". */
export const STD_COLS = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
]
const STD_IDS = new Set(STD_COLS.map((c) => c.id))

export const pageKeys = (m, p) => p.actions.map((a) => a.key ?? permKey(m.id, p.id, a.id))
export const moduleKeys = (m) => m.pages.flatMap((p) => pageKeys(m, p))
export const actionOf = (p, id) => p.actions.find((a) => a.id === id)
export const moreActions = (p) => p.actions.filter((a) => !STD_IDS.has(a.id))
export const keyOf = (m, p, a) => a.key ?? permKey(m.id, p.id, a.id)

/**
 * The catalog in the API's shape, built from the shared package — used where every
 * module is in play (superadmin role templates), with every action grantable.
 */
export function catalogFromShared() {
  return {
    categories: CATEGORIES,
    scopeLabels: SCOPE_LABELS,
    limits: ROLE_LIMITS,
    sod: SOD_RULES.map(([a, b, message]) => ({ a, b, message })),
    modules: MODULES.map((m) => ({
      ...m, enabled: true, inPlan: true,
      pages: m.pages.map((p) => ({ ...p, actions: p.actions.map((a) => ({ ...a, key: permKey(m.id, p.id, a.id), grantable: true })) })),
    })),
  }
}

/** Add a permission and the page view it needs. */
export function grant(set, m, p, actionId) {
  set.add(permKey(m.id, p.id, actionId))
  if (actionId !== 'view' && actionOf(p, 'view')) set.add(permKey(m.id, p.id, 'view'))
}

/** Remove a permission; removing a page's view removes every action on it. */
export function revoke(set, m, p, actionId) {
  if (actionId === 'view') for (const k of pageKeys(m, p)) set.delete(k)
  else set.delete(permKey(m.id, p.id, actionId))
}
