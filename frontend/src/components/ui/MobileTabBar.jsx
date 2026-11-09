import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Home, LayoutGrid, Bell, User, LogOut, MonitorSmartphone, ScanQrCode, X } from 'lucide-react'
import { getCurrentUser, logout, logoutAll } from '../../api/auth'
import api from '../../api/client'
import { openScan } from '../scan/GlobalScan'

/**
 * Native-app-style bottom navigation — visible below Tailwind's `lg` only.
 * Home · Menu (opens the nav drawer) · Scan (camera) · Alerts · Account.
 */
export default function MobileTabBar({ onMenu }) {
  const { t } = useTranslation(['nav', 'ui'])
  const location = useLocation()
  const [unread, setUnread] = useState(0)
  const [account, setAccount] = useState(false)
  const sheetRef = useRef(null)

  const me = getCurrentUser() || {}
  const displayName = me.user?.name || me.user?.email || t('ui.common.user')
  const subline = [me.tenant?.name, me.roles?.map((r) => r.name).join(', ')].filter(Boolean).join(' · ')
  const initials = displayName.split(' ').map((w) => w[0]).join('').substring(0, 2).toUpperCase()

  useEffect(() => {
    const load = () => api.get('/v1/core/notifications').then((r) => setUnread((r.data?.data ?? []).length)).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { setAccount(false) }, [location.pathname])

  const itemCls = (active) =>
    clsx(
      'flex-1 flex flex-col items-center justify-center gap-0.5 h-full text-[10px] font-medium transition-colors',
      active ? 'text-brand-600' : 'text-ink-faint hover:text-ink-muted',
    )

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-surface border-t border-border flex items-stretch pb-[env(safe-area-inset-bottom)]">
        <NavLink to="/" end className={({ isActive }) => itemCls(isActive)}>
          <Home className="w-5 h-5" />
          {t('home')}
        </NavLink>

        <button type="button" onClick={onMenu} className={itemCls(false)}>
          <LayoutGrid className="w-5 h-5" />
          {t('menu')}
        </button>

        {!me.superadmin && (
          <button type="button" onClick={openScan} className={itemCls(false)}>
            <span className="-mt-5 w-12 h-12 rounded-full bg-brand-600 text-white shadow-pop flex items-center justify-center ring-4 ring-surface">
              <ScanQrCode className="w-6 h-6" />
            </span>
            {t('ui.mobileTabs.scan')}
          </button>
        )}


        <button type="button" onClick={() => window.dispatchEvent(new Event('hx:open-notifications'))} className={itemCls(false)}>
          <span className="relative">
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-1 -end-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-danger-500 text-white text-[9px] font-bold flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
          {t('alerts')}
        </button>

        <button type="button" onClick={() => setAccount(true)} className={itemCls(account)}>
          <User className="w-5 h-5" />
          {t('ui.mobileTabs.account')}
        </button>
      </nav>

      {account && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-navy-900/40" onClick={() => setAccount(false)} />
          <div ref={sheetRef} className="relative w-full bg-surface rounded-t-2xl border-t border-border shadow-pop pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-full bg-brand-500 text-white text-sm font-medium flex items-center justify-center shrink-0">{initials}</span>
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{displayName}</p>
                  <p className="text-xs text-ink-faint truncate">{subline}</p>
                </div>
              </div>
              <button onClick={() => setAccount(false)} aria-label={t('ui.common.close')} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <button onClick={() => { setAccount(false); logout() }} className="w-full flex items-center gap-3 px-4 py-3.5 text-ink hover:bg-bg text-start">
              <LogOut className="w-4 h-4 text-ink-muted" /> {t('logout')}
            </button>
            <button onClick={() => { setAccount(false); logoutAll() }} className="w-full flex items-center gap-3 px-4 py-3.5 text-danger-600 hover:bg-danger-50 text-start">
              <MonitorSmartphone className="w-4 h-4" /> {t('logoutAll')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
