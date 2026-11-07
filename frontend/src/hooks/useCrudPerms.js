import { useLocation } from 'react-router-dom'
import { pageForPath } from '../catalog/nav'
import { hasPermission, hasAnyPermission } from '../api/auth'
import useAuthUser from './useAuthUser'

/**
 * Action flags for the catalog page the current route belongs to. Screens hide
 * New / Edit / Delete controls when the role lacks `<module>.<page>.<action>`.
 *
 *   const { canCreate, canEdit, canDelete, can } = useCrudPerms()
 *   {canCreate && <HeaderButton>New</HeaderButton>}
 *
 * `allows(requires)` resolves a Button / HeaderButton `requires` prop:
 *   'create' | 'edit' | 'delete' | any page action id  → this page's permission
 *   'core.users.reset_password'                        → that exact key
 *   ['a.b.c', 'x.y.z']                                 → any of them
 */
export default function useCrudPerms() {
  useAuthUser() // re-render when the role changes
  const { pathname } = useLocation()
  const hit = pageForPath(pathname)
  const base = hit ? `${hit.module.id}.${hit.page.id}` : null
  // Screens outside the catalog (superadmin console, My account) are not gated here.
  const can = (action) => !base || hasPermission(`${base}.${action}`)
  const allows = (requires) => {
    if (!requires) return true
    if (Array.isArray(requires)) return hasAnyPermission(...requires)
    if (requires.includes('.')) return hasPermission(requires)
    return can(requires)
  }
  return { moduleId: hit?.module.id ?? null, page: base, can, canCreate: can('create'), canEdit: can('edit'), canDelete: can('delete'), allows }
}
