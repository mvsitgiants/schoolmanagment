import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Home, X, CreditCard, UserRound } from 'lucide-react'
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

/**
 * Navigation built from the shared catalog: a module shows only when it is switched on
 * for the institution AND the role can open at least one of its pages (docs/04 §6).
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
          'w-[86vw] max-w-[20rem] lg:w-64 shrink-0 h-full bg-sidebar text-sidebar-fg/90 flex flex-col',
          'fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 lg:rtl:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
        )}
        aria-label={t('ui.sidebar.mainNavigation')}
      >
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-fg/10 shrink-0">
          <BrandMark brand={brand} />
          <div className="min-w-0">
            <p className="font-display font-semibold tracking-tight text-sidebar-fg truncate text-[15px] leading-tight">{brand.companyName}</p>
            <p className="text-[11px] text-sidebar-fg/45 truncate">SchoolGiant</p>
          </div>
          <button onClick={onClose} aria-label={t('ui.sidebar.closeMenu')} className="lg:hidden ms-auto -me-1 w-9 h-9 rounded-md flex items-center justify-center text-sidebar-fg/60 hover:text-sidebar-fg hover:bg-sidebar-fg/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scroll-hide py-4 px-3">
          <div className="mb-5 space-y-0.5">
            <NavLink
              to="/"
              end
              className={({ isActive }) => clsx('flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive ? 'bg-brand-500/20 text-sidebar-fg' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5')}
            >
              <Home className="w-4 h-4 text-sidebar-fg/50" /> {t('home', 'Home')}
            </NavLink>
            {/* Everyone's own account — never gated by a module or a permission, because a teacher
                with no HR access still has to change a password, ask for leave and read a payslip. */}
            <NavLink
              to="/me"
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors font-medium',
                  isActive ? 'bg-sidebar-fg/10 text-sidebar-fg' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5'
                )
              }
            >
              <UserRound className="w-4 h-4 text-sidebar-fg/50" />
              {t('myWorkspace', 'My workspace')}
            </NavLink>
          </div>

          {nav.map((cat) => (
            <div key={cat.id} className="mb-5">
              <div className="flex items-center gap-2 px-3 mb-1.5">
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
                  const rowCls = clsx('w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    childActive ? 'text-sidebar-fg bg-sidebar-fg/[0.06]' : 'text-sidebar-fg/70 hover:text-sidebar-fg hover:bg-sidebar-fg/5')
                  const label = (
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className={clsx('w-4 h-4 shrink-0', childActive ? 'text-brand-400' : 'text-sidebar-fg/50')} />
                      <span className="truncate">{cl.module(m)}</span>
                      {soon && <span className="text-[9px] uppercase tracking-wide px-1.5 py-px rounded bg-sidebar-fg/10 text-sidebar-fg/45 shrink-0">{t('ui.sidebar.soon')}</span>}
                    </span>
                  )
                  return (
                    <li key={m.id}>
                      {single ? (
                        <NavLink to={m.pages[0].path} className={rowCls}>{label}</NavLink>
                      ) : (
                        <button type="button" onClick={() => toggle(m.id)} className={rowCls} aria-expanded={isOpen}>
                          {label}
                          {isOpen ? <ChevronDown className="w-4 h-4 text-sidebar-fg/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-sidebar-fg/40 shrink-0 rtl:rotate-180" />}
                        </button>
                      )}
                      {!single && isOpen && (
                        <ul className="mt-0.5 mb-1.5 space-y-0.5 relative before:absolute before:inset-y-1 before:start-5 before:w-px before:bg-sidebar-fg/10">
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
          <div className="px-3 py-3 border-t border-sidebar-fg/10 shrink-0">
            <Link
              to={hasPermission('core.subscription.view') ? '/core/subscription' : '/'}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-sidebar-fg/5 transition-colors"
            >
              <CreditCard className="w-4 h-4 text-sidebar-fg/50" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-sidebar-fg font-medium truncate">{t('ui.sidebar.plan', { name: sub.plan.name })}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-sidebar-fg/50">
                  <span className={clsx('w-1.5 h-1.5 rounded-full', status.dot)} />
                  {t(`ui.sidebar.subscription.${status.key}`)}{sub.status === 'TRIAL' && sub.daysLeft != null ? ` · ${t('ui.sidebar.daysLeft', { count: sub.daysLeft })}` : ''}
                </span>
              </span>
            </Link>
            <p className="text-[11px] text-sidebar-fg/30 px-3 mt-1.5">{t('ui.sidebar.modulesAvailable', { count: moduleCount })}</p>
          </div>
        )}
      </aside>
    </>
  )
}
