import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Home, X, CreditCard, PanelLeftClose, PanelLeftOpen, UserRound } from 'lucide-react'
import { useBrand } from '../../context/SettingsContext'
import useAuthUser from '../../hooks/useAuthUser'
import { navFor, pageForPath } from '../../catalog/nav'
import { iconFor } from '../../catalog/icons'
import { moduleHasScreens } from '../../catalog/built'
import { hasPermission } from '../../api/auth'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

// label: ui.sidebar.subscription.<key>
const STATUS = {
  TRIAL: { key: 'trial', dot: 'bg-info-500' },
  ACTIVE: { key: 'active', dot: 'bg-success-500' },
  PAST_DUE: { key: 'pastDue', dot: 'bg-amber-400' },
  TRIAL_EXPIRED: { key: 'trialExpired', dot: 'bg-danger-500' },
  SUSPENDED: { key: 'suspended', dot: 'bg-danger-500' },
  CANCELLED: { key: 'cancelled', dot: 'bg-danger-500' },
}

/** The institution's mark: its logo, or its initials on the brand colour. */
export function BrandMark({ brand, size = 'h-9 w-9' }) {
  const [failed, setFailed] = useState(false)
  if (brand.logoUrl && !failed) {
    return <img src={brand.logoUrl} alt="" className={clsx(size, 'rounded-md object-contain bg-white/95 p-0.5')} onError={() => setFailed(true)} />
  }
  const initials = brand.companyName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return <span className={clsx(size, 'rounded-md bg-brand-500 text-white text-sm font-semibold flex items-center justify-center shrink-0')}>{initials}</span>
}

const COLLAPSED_KEY = 'sg.sidebar.collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false } }
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

/**
 * Navigation built from the shared catalog: a module shows only when it is switched on
 * for the institution AND the role can open at least one of its pages (docs/04 §6).
 * On a computer it can be collapsed to a strip of icons (remembered on this device); pointing at an icon shows that
 * module's pages. Phones always get the full menu as a drawer.
 */
export default function Sidebar({ open = false, onClose }) {
  const { t } = useTranslation(['nav', 'ui'])
  const cl = useCatalogLabel()
  const user = useAuthUser()
  const brand = useBrand()
  const location = useLocation()
  const nav = useMemo(() => navFor(user), [user])
  const activeModule = pageForPath(location.pathname)?.module.id
  const [expanded, setExpanded] = useState(() => new Set(activeModule ? [activeModule] : ['core']))

  useEffect(() => {
    if (activeModule) setExpanded((s) => (s.has(activeModule) ? s : new Set(s).add(activeModule)))
  }, [activeModule])

  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [fly, setFly] = useState(null) // { id, top } — a module's pages beside the collapsed strip
  const flyTimer = useRef(null)
  const narrow = collapsed // shorthand for class names: narrow only applies at lg (the drawer on phones is always full)
  const setNarrow = (v) => {
    setCollapsed(v); setFly(null)
    try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0') } catch { /* private window: just for now */ }
  }
  const showFly = (id, el) => {
    if (!collapsed || !isDesktop()) return
    clearTimeout(flyTimer.current)
    setFly({ id, top: Math.min(el.getBoundingClientRect().top, window.innerHeight - 80) })
  }
  const hideFly = () => { clearTimeout(flyTimer.current); flyTimer.current = setTimeout(() => setFly(null), 180) }
  useEffect(() => () => clearTimeout(flyTimer.current), [])
  const hideLabel = narrow && 'lg:hidden'

  const toggle = (id) => setExpanded((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const sub = user?.subscription
  const status = STATUS[sub?.status] ?? STATUS.ACTIVE
  const moduleCount = nav.reduce((n, c) => n + c.modules.length, 0)

  return (
    <>
      <div
        className={clsx('lg:hidden fixed inset-0 bg-navy-900/50 z-40 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={clsx(
          'w-[86vw] max-w-[20rem] shrink-0 h-full bg-sidebar text-sidebar-fg/90 flex flex-col lg:transition-[width] lg:duration-200',
          narrow ? 'lg:w-16' : 'lg:w-64',
          'fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out lg:relative lg:z-30 lg:translate-x-0 lg:rtl:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
        )}
        aria-label={t('ui.sidebar.mainNavigation')}
      >
        <div className={clsx('h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-fg/10 shrink-0', narrow && 'lg:justify-center lg:px-0')}>
          <BrandMark brand={brand} />
          <div className={clsx('min-w-0', hideLabel)}>
            <p className="font-display font-semibold tracking-tight text-sidebar-fg truncate text-[15px] leading-tight">{brand.companyName}</p>
            <p className="text-[11px] text-sidebar-fg/45 truncate">SchoolGiant</p>
          </div>
          <button onClick={onClose} aria-label={t('ui.sidebar.closeMenu')} className="lg:hidden ms-auto -me-1 w-9 h-9 rounded-md flex items-center justify-center text-sidebar-fg/60 hover:text-sidebar-fg hover:bg-sidebar-fg/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className={clsx('flex-1 overflow-y-auto scroll-hide py-4 px-3', narrow && 'lg:px-2')}>
          <div className="mb-5 space-y-0.5">
            <NavLink
              to="/"
              end
              title={narrow ? t('home', 'Home') : undefined}
              className={({ isActive }) => clsx('flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors', narrow && 'lg:justify-center lg:px-0',
                isActive ? 'bg-brand-500/20 text-sidebar-fg' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5')}
            >
              <Home className="w-4 h-4 shrink-0 text-sidebar-fg/50" /> <span className={clsx(hideLabel)}>{t('home', 'Home')}</span>
            </NavLink>
            {/* Everyone's own account — never gated by a module or a permission, because a teacher
                with no HR access still has to change a password, ask for leave and read a payslip. */}
            <NavLink
              to="/me"
              title={narrow ? t('myWorkspace', 'My workspace') : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors font-medium', narrow && 'lg:justify-center lg:px-0',
                  isActive ? 'bg-sidebar-fg/10 text-sidebar-fg' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5'
                )
              }
            >
              <UserRound className="w-4 h-4 shrink-0 text-sidebar-fg/50" />
              <span className={clsx(hideLabel)}>{t('myWorkspace', 'My workspace')}</span>
            </NavLink>
          </div>

          {nav.map((cat) => (
            <div key={cat.id} className="mb-5">
              {narrow && <div className="hidden lg:block mx-2 mb-2 border-t border-sidebar-fg/10" />}
              <div className={clsx('flex items-center gap-2 px-3 mb-1.5', hideLabel)}>
                <span className="w-1.5 h-1.5 rounded-full bg-sidebar-fg/30" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-fg/40">
                  {cl.category(cat)}
                </span>
              </div>
              <ul className="space-y-0.5">
                {cat.modules.map((m) => {
                  const Icon = iconFor(m.icon)
                  const isOpen = expanded.has(m.id)
                  const childActive = m.id === activeModule
                  const soon = !moduleHasScreens(m)
                  const single = m.pages.length === 1
                  const rowCls = clsx('w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors', narrow && 'lg:justify-center lg:px-0',
                    childActive ? 'text-sidebar-fg bg-sidebar-fg/[0.06]' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5')
                  const label = (
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className={clsx('w-4 h-4 shrink-0', childActive ? 'text-brand-400' : 'text-sidebar-fg/50')} />
                      <span className={clsx('truncate', hideLabel)}>{cl.module(m)}</span>
                      {soon && <span className={clsx('text-[9px] uppercase tracking-wide px-1.5 py-px rounded bg-sidebar-fg/10 text-sidebar-fg/45 shrink-0', hideLabel)}>{t('ui.sidebar.soon')}</span>}
                    </span>
                  )
                  return (
                    <li key={m.id} onMouseEnter={(e) => showFly(m.id, e.currentTarget)} onMouseLeave={hideFly}>
                      {single ? (
                        <NavLink to={m.pages[0].path} className={rowCls} aria-label={narrow ? cl.module(m) : undefined}>{label}</NavLink>
                      ) : (
                        <button type="button" onClick={() => (collapsed && isDesktop() ? setFly((f) => (f?.id === m.id ? null : { id: m.id, top: Math.min(document.activeElement?.getBoundingClientRect().top ?? 0, window.innerHeight - 80) })) : toggle(m.id))}
                          className={rowCls} aria-expanded={collapsed && isDesktop() ? fly?.id === m.id : isOpen} aria-label={narrow ? cl.module(m) : undefined}>
                          {label}
                          <span className={clsx(hideLabel)}>{isOpen ? <ChevronDown className="w-4 h-4 text-sidebar-fg/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-sidebar-fg/40 shrink-0 rtl:rotate-180" />}</span>
                        </button>
                      )}
                      {/* collapsed: the module's name and pages beside the strip */}
                      {narrow && fly?.id === m.id && (
                        <div className="hidden lg:block fixed z-50 start-16 ms-1 w-60 rounded-lg bg-sidebar py-1.5 shadow-pop ring-1 ring-sidebar-fg/10" style={{ top: fly.top }}
                          onMouseEnter={() => clearTimeout(flyTimer.current)} onMouseLeave={hideFly}>
                          <p className="px-3 pb-1 pt-0.5 text-xs font-semibold text-sidebar-fg">{cl.module(m)}</p>
                          {m.pages.map((p) => (
                            <NavLink key={p.id} to={p.path} onClick={() => setFly(null)}
                              className={({ isActive }) => clsx('block px-3 py-1.5 text-[13px] transition-colors', isActive ? 'text-brand-300 font-medium bg-brand-500/10' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5')}>
                              {cl.page(m, p)}
                            </NavLink>
                          ))}
                        </div>
                      )}
                      {!single && isOpen && (
                        <ul className={clsx('mt-0.5 mb-1.5 space-y-0.5 relative before:absolute before:inset-y-1 before:start-5 before:w-px before:bg-sidebar-fg/10', hideLabel)}>
                          {m.pages.map((p) => (
                            <li key={p.id}>
                              <NavLink
                                to={p.path}
                                className={({ isActive }) => clsx('flex items-center ps-9 pe-3 py-1.5 text-[13px] rounded-e-md transition-colors',
                                  isActive ? 'text-brand-300 font-medium bg-brand-500/10' : 'text-sidebar-fg/60 hover:text-sidebar-fg hover:bg-sidebar-fg/5')}
                              >
                                <span className="truncate">{cl.page(m, p)}</span>
                              </NavLink>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {sub?.plan && (
          <div className={clsx('px-3 py-3 border-t border-sidebar-fg/10 shrink-0', narrow && 'lg:px-2')}>
            <Link
              to={hasPermission('core.subscription.view') ? '/core/subscription' : '/'}
              title={narrow ? t('ui.sidebar.plan', { name: sub.plan.name }) : undefined}
              className={clsx('flex items-center gap-3 px-3 py-2 rounded-md hover:bg-sidebar-fg/5 transition-colors', narrow && 'lg:justify-center lg:px-0')}
            >
              <CreditCard className="w-4 h-4 shrink-0 text-sidebar-fg/50" />
              <span className={clsx('min-w-0 flex-1', hideLabel)}>
                <span className="block text-sm text-sidebar-fg font-medium truncate">{t('ui.sidebar.plan', { name: sub.plan.name })}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-sidebar-fg/50">
                  <span className={clsx('w-1.5 h-1.5 rounded-full', status.dot)} />
                  {t(`ui.sidebar.subscription.${status.key}`)}{sub.status === 'TRIAL' && sub.daysLeft != null ? ` · ${t('ui.sidebar.daysLeft', { count: sub.daysLeft })}` : ''}
                </span>
              </span>
            </Link>
            <p className={clsx('text-[11px] text-sidebar-fg/30 px-3 mt-1.5', hideLabel)}>{t('ui.sidebar.modulesAvailable', { count: moduleCount })}</p>
          </div>
        )}
        {/* collapse to icons / open again — computers only */}
        <div className={clsx('hidden lg:block px-3 pb-3 shrink-0', narrow && 'lg:px-2', !sub?.plan && 'pt-3 border-t border-sidebar-fg/10')}>
          <button type="button" onClick={() => setNarrow(!collapsed)} aria-expanded={!collapsed}
            title={collapsed ? t('ui.sidebar.expand') : t('ui.sidebar.collapse')}
            className={clsx('w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-fg/60 hover:text-sidebar-fg hover:bg-sidebar-fg/5 transition-colors', narrow && 'justify-center px-0')}>
            {collapsed ? <PanelLeftOpen className="w-4 h-4 shrink-0 rtl:-scale-x-100" /> : <PanelLeftClose className="w-4 h-4 shrink-0 rtl:-scale-x-100" />}
            {!collapsed && <span>{t('ui.sidebar.collapse')}</span>}
            {collapsed && <span className="sr-only">{t('ui.sidebar.expand')}</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
