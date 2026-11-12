import {
  CATEGORIES, MODULES, MODULE_BY_ID, hasPermissionIn, pagePath, permKey,
} from '@schoolgiant/shared'

// Navigation and route gating, derived from the shared catalog + the signed-in
// profile. The sidebar, the route gate, global search and "my pages" all use these,
// so a page hidden from the menu can't be reached by typing its URL either.

/** Extra routes that belong to a catalog page (detail screens etc.). */
const ROUTE_ALIASES = [
  { prefix: '/core/all-pages', module: 'core', page: 'roles' },
  { prefix: '/teaching/hub', module: 'homework', page: 'hub' }, // the Subject hub's deep link (/teaching/hub?classId=&subjectId=&unitId=)
  { prefix: '/canteen/token-board', module: 'canteen', page: 'orders' }, // the token board: anyone who can see orders
]

/** Routes open to every signed-in user. */
export const OPEN_ROUTES = ['/', '/me', '/approvals']

const hiddenPage = (user, key) => !!user?.hiddenPages?.includes(String(key).split('.').slice(0, 2).join('.'))
const can = (user, key) => !!user && (user.superadmin || (!hiddenPage(user, key) && hasPermissionIn(user.permissions, key)))
const enabledSet = (user) => new Set(user?.enabledModules ?? [])
const isOn = (user, m) => m.mandatory || enabledSet(user).has(m.id)

/**
 * A page with `menuIf: [permission keys]` is in the menu only for people who hold one of
 * them (e.g. the call log for those who review it — everyone else calls from the dock).
 * It still opens by URL and from global search for anyone with its `view`.
 * `menu: false` keeps a page out of the menu for everyone (an older screen another page replaced), the same way.
 */
const inMenu = (user, p) => p.menu !== false && (!p.menuIf?.length || p.menuIf.some((k) => can(user, k)))

/** Sidebar model: categories → modules → pages the user can open. `all` keeps `menuIf` pages. */
export function navFor(user, { all = false } = {}) {
  return CATEGORIES.map((cat) => ({
    ...cat,
    modules: MODULES
      .filter((m) => m.category === cat.id && isOn(user, m))
      .map((m) => ({
        ...m,
        pages: m.pages
          .filter((p) => p.nav !== false && can(user, permKey(m.id, p.id, 'view')) && (all || inMenu(user, p)))
          .map((p) => ({ ...p, path: pagePath(m.id, p.id) })),
      }))
      .filter((m) => m.pages.length),
  })).filter((c) => c.modules.length)
}

/** Every page the user can open, flat (search, home "my pages"). */
export const pagesFor = (user) => navFor(user, { all: true }).flatMap((c) => c.modules.flatMap((m) => m.pages.map((p) => ({ ...p, module: m, category: c }))))

/** Which catalog page does a URL belong to? Longest matching prefix wins. */
export function pageForPath(pathname) {
  const alias = ROUTE_ALIASES.find((a) => pathname === a.prefix || pathname.startsWith(a.prefix + '/'))
  if (alias) {
    const m = MODULE_BY_ID[alias.module]
    return { module: m, page: m.pages.find((p) => p.id === alias.page) }
  }
  let best = null
  for (const m of MODULES) {
    for (const p of m.pages) {
      const path = pagePath(m.id, p.id)
      if ((pathname === path || pathname.startsWith(path + '/')) && (!best || path.length > best.path.length)) best = { module: m, page: p, path }
    }
  }
  return best
}

/**
 * Route gate verdict for a URL:
 *   { state: 'open' } · { state: 'module-off', module } · { state: 'denied', missing: [key] } ·
 *   { state: 'unknown' }  (not a catalog route — the router's 404 handles it)
 */
export function gateFor(user, pathname) {
  if (OPEN_ROUTES.includes(pathname)) return { state: 'open' }
  const hit = pageForPath(pathname)
  if (!hit) return { state: 'unknown' }
  if (!isOn(user, hit.module)) return { state: 'module-off', module: hit.module }
  const keys = entryKeys(hit.module, hit.page)
  return keys.some((k) => can(user, k)) ? { state: 'open', ...hit } : { state: 'denied', missing: keys, ...hit }
}

/** What opens a page: its `view`, or — for an action-only page such as Emergency access (`use`) — any of its actions. */
function entryKeys(m, p) {
  if (!p.actions?.length || p.actions.some((a) => a.id === 'view')) return [permKey(m.id, p.id, 'view')]
  return p.actions.map((a) => permKey(m.id, p.id, a.id))
}

/** Where to land after sign-in: the role's home page if allowed, else Home. */
export function landingFor(user) {
  if (!user) return '/login'
  if (user.superadmin) return '/superadmin'
  if (user.subscription?.blocked) return '/core/subscription'
  const home = user.homePage
  if (home && home !== '/' && gateFor(user, home).state === 'open') return home
  return '/'
}

/** Can the user do `action` on the page a URL belongs to? */
export function canOnPath(user, pathname, action) {
  const hit = pageForPath(pathname)
  return !!hit && can(user, permKey(hit.module.id, hit.page.id, action))
}
