import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Building2, FileText, History, KeyRound, LayoutDashboard, Layers, LogOut, Menu, Settings2, ShieldCheck, Tag, UserCog, X } from 'lucide-react'
import { canPlatform, getCurrentUser, logout } from '../api/auth'
import ChangePasswordModal from '../components/ui/ChangePasswordModal'
import NoticeBanner from '../components/ui/NoticeBanner'
import Button from '../components/ui/Button'
import useAuthUser from '../hooks/useAuthUser'
import IdleGuard from '../components/ui/IdleGuard'

const LINKS = [
  { to: '/superadmin', labelKey: 'ui.superadmin.overview', icon: LayoutDashboard, end: true },
  { to: '/superadmin/tenants', labelKey: 'ui.superadmin.institutions', icon: Building2 },
  { to: '/superadmin/invoices', labelKey: 'ui.superadmin.invoices', icon: FileText },
  { to: '/superadmin/plans', labelKey: 'ui.superadmin.plans', icon: Layers },
  { to: '/superadmin/coupons', labelKey: 'ui.superadmin.coupons', icon: Tag },
  { to: '/superadmin/role-templates', labelKey: 'ui.superadmin.roleTemplates', icon: ShieldCheck },
  { to: '/superadmin/staff', labelKey: 'ui.superadmin.staff', icon: UserCog, perm: 'staff' },
  { to: '/superadmin/audit', labelKey: 'ui.superadmin.audit', icon: History, perm: 'audit' },
  { to: '/superadmin/settings', labelKey: 'ui.superadmin.settings', icon: Settings2, perm: 'settings' },
]

/** Platform owner console: every institution, plan and invoice of the SaaS. */
export default function SuperadminLayout() {
  const { t } = useTranslation(['nav', 'ui'])
  const user = useAuthUser()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [location.pathname])
  if (!user) return <Navigate to="/login" replace />
  if (!user.superadmin) return <Navigate to="/" replace />
  const me = getCurrentUser()

  return (
    <div className="h-[100dvh] w-screen flex bg-bg overflow-hidden">
      <div className={clsx('lg:hidden fixed inset-0 bg-navy-900/50 z-40 transition-opacity', open ? 'opacity-100' : 'opacity-0 pointer-events-none')} onClick={() => setOpen(false)} />
      <aside className={clsx('w-[80vw] max-w-[18rem] lg:w-60 shrink-0 h-full bg-navy-900 text-white/90 flex flex-col fixed inset-y-0 start-0 z-50 transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full')}>
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-white/10">
          <span className="w-9 h-9 rounded-md bg-brand-500 flex items-center justify-center">
            <svg viewBox="0 0 64 64" className="w-5 h-5"><path d="M26 14h12v12h12v12H38v12H26V38H14V26h12z" fill="#fff" /></svg>
          </span>
          <div>
            <p className="font-display font-semibold text-[15px] leading-tight">SchoolGiant</p>
            <p className="text-[11px] text-white/45">{t('ui.superadmin.consoleTitle')}</p>
          </div>
          <button className="lg:hidden ms-auto text-white/60" onClick={() => setOpen(false)} aria-label={t('ui.superadmin.closeMenu')}><X className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-0.5">
          {LINKS.filter((l) => !l.perm || canPlatform(l.perm)).map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => clsx('flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors', isActive ? 'bg-brand-500/25 text-white' : 'text-white/65 hover:text-white hover:bg-white/5')}>
              <l.icon className="w-4 h-4 opacity-70" /> {t(l.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="px-3 py-2">
            <p className="text-sm font-medium truncate">{me?.user?.name}</p>
            <p className="text-[11px] text-white/45 truncate">{me?.user?.email}</p>
          </div>
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/65 hover:text-white hover:bg-white/5"><LogOut className="w-4 h-4" /> {t('logout')}</button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-14 shrink-0 border-b border-border bg-surface flex items-center px-3 gap-2">
          <button onClick={() => setOpen(true)} className="w-9 h-9 rounded-md flex items-center justify-center text-ink-muted" aria-label={t('ui.topbar.openMenu')}><Menu className="w-5 h-5" /></button>
          <span className="font-display font-semibold text-ink">{t('ui.superadmin.consoleTitle')}</span>
        </header>
        <NoticeBanner />
        <main className="flex-1 overflow-y-auto scroll-hide p-3 sm:p-4 lg:p-6">
          {user.user?.mustChangePassword ? (
            // a temporary password is only for setting your own — the server answers nothing else until then
            <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center gap-3 px-4">
              <KeyRound className="w-6 h-6 text-ink-faint" />
              <p className="text-ink font-medium text-lg">{t('changePassword')}</p>
              <p className="text-ink-muted text-sm max-w-md">{t('ui.layout.tempPassword')}</p>
              <Button icon={KeyRound} onClick={() => setPwdOpen(true)}>{t('changePassword')}</Button>
            </div>
          ) : <Outlet />}
        </main>
      </div>
      <IdleGuard idleMinutes={user.idleMinutes} />
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  )
}
