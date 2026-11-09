import { useState, useEffect, useRef } from 'react'
import { Bell, ChevronDown, LogOut, MonitorSmartphone, Menu, Rows3, KeyRound, UserRound, Building2, CheckSquare, ScanQrCode, ArrowLeftRight } from 'lucide-react'
import GlobalScan, { openScan } from '../scan/GlobalScan'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import PushToggle from '../app/PushToggle'
import { logout, logoutAll } from '../../api/auth'
import { fetchNotifications, markNotificationsRead, pushApi } from '../../api/core'
import useAuthUser from '../../hooks/useAuthUser'
import GlobalSearch from './GlobalSearch'
import ChangePasswordModal from './ChangePasswordModal'
import SwitchInstitutionModal from './SwitchInstitutionModal'
import { readDensity, applyDensity } from '../../utils/density'
import { TONE } from '../system/tokens'
import { useRealtimeEvent } from '../../context/RealtimeContext'
import { updateBadgeSource, flashTabNotification } from '../../utils/tabBadge'
import NetworkStatusChip from './NetworkStatusChip'
import LanguageSelector from './LanguageSelector'

const ago = (iso, t) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return t('ui.topbar.justNow')
  if (m < 60) return t('ui.topbar.minutesAgo', { count: m })
  const h = Math.round(m / 60)
  return h < 24 ? t('ui.topbar.hoursAgo', { count: h }) : t('ui.topbar.daysAgo', { count: Math.round(h / 24) })
}

const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'

function useClickOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, open, close])
}

export default function Topbar({ onMenu }) {
  const { t } = useTranslation(['nav', 'common', 'ui'])
  const me = useAuthUser()
  const name = me?.user?.name || t('ui.common.user')
  const navigate = useNavigate()
  const [bellData, setBellData] = useState({ alerts: [], items: [], unread: 0 })
  const [bell, setBell] = useState(false)
  const [menu, setMenu] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [density, setDensity] = useState(readDensity)
  const bellRef = useRef(null)
  const menuRef = useRef(null)
  useClickOutside(bellRef, bell, () => setBell(false))
  useClickOutside(menuRef, menu, () => setMenu(false))

  const loadBell = () => fetchNotifications().then((d) => setBellData({ alerts: d?.alerts ?? [], items: d?.items ?? [], unread: d?.unread ?? 0 })).catch(() => {})
  useEffect(() => {
    if (me?.superadmin) return undefined
    loadBell()
    const t = setInterval(loadBell, 30_000)
    return () => clearInterval(t)
  }, [me?.superadmin, me?.subscription?.status])
  // a new notification arrives over the live connection: refresh the bell at once
  useRealtimeEvent('notification:new', (payload) => {
    if (!me?.superadmin) {
      loadBell()
      if (document.hidden) {
        flashTabNotification(payload?.title ? `🔔 ${payload.title}` : `🔔 ${t('ui.topbar.newNotification')}`)
      }
    }
  })
  // the phone bottom bar's "Alerts" opens this same panel (MobileTabBar dispatches the event)
  useEffect(() => {
    const open = () => { loadBell(); setBell(true) }
    window.addEventListener('hx:open-notifications', open)
    return () => window.removeEventListener('hx:open-notifications', open)
  }, [])
  const { alerts, items, unread } = bellData
  const badge = alerts.length + unread

  useEffect(() => {
    updateBadgeSource('bell', badge)
  }, [badge])
  const openItem = async (n) => {
    setBell(false)
    if (!n.readAt) { await markNotificationsRead([n.id]).catch(() => {}); loadBell() }
    if (n.link) navigate(n.link)
  }
  const readAll = async () => { await markNotificationsRead().catch(() => {}); loadBell() }

  return (
    <header className="h-14 shrink-0 border-b border-border bg-surface flex items-center justify-between px-3 sm:px-5 gap-2 sm:gap-4">
      <button onClick={onMenu} aria-label={t('ui.topbar.openMenu')} className="lg:hidden w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink">
        <Menu className="w-5 h-5" />
      </button>

      <GlobalSearch />

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <NetworkStatusChip />
        <LanguageSelector saveToProfile={me?.kind === 'TENANT'} enabledLanguages={me?.tenant?.enabledLanguages} />
        {me?.tenant?.name && (
          <span className="hidden xl:flex items-center gap-1.5 text-xs text-ink-muted px-2.5 h-8 rounded-md bg-bg border border-border">
            <Building2 className="w-3.5 h-3.5" /> {me.tenant.name}
          </span>
        )}


        {!me?.superadmin && (
          <>
            <button type="button" onClick={openScan} aria-label={t('ui.topbar.scan')} title={t('ui.topbar.scan')} className="hidden lg:flex w-9 h-9 rounded-md items-center justify-center text-ink-muted hover:bg-bg hover:text-ink">
              <ScanQrCode className="w-[18px] h-[18px]" />
            </button>
            <GlobalScan />
          </>
        )}

        <div className="relative" ref={bellRef}>
          <button aria-label={t('notifications.title', 'Notifications')} onClick={() => { if (!bell) loadBell(); setBell((o) => !o) }} className="w-9 h-9 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink relative">
            <Bell className="w-[18px] h-[18px]" />
            {badge > 0 && <span className="absolute top-1 end-1 min-w-[16px] h-4 px-1 rounded-full bg-danger-500 text-white text-[10px] font-semibold leading-4 text-center ring-2 ring-surface">{badge > 9 ? '9+' : badge}</span>}
          </button>
          {bell && (
            <div className="absolute end-0 top-11 w-80 sm:w-96 max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-surface shadow-pop z-50">
              <div className="px-3 py-2.5 border-b border-border text-sm font-medium text-ink flex items-center justify-between">
                <span>{t('notifications.title', 'Notifications')}</span>
                {unread > 0 && <button type="button" onClick={readAll} className="text-xs text-brand-600 hover:underline font-normal">{t('notifications.markAllRead', 'Mark all read')}</button>}
              </div>
              {alerts.length === 0 && items.length === 0 ? (
                <p className="px-3 py-8 text-sm text-ink-muted text-center">{t('notifications.empty', "You're all caught up.")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {alerts.map((n) => (
                    <li key={n.id}>
                      <Link to={n.link || '/'} onClick={() => setBell(false)} className="flex gap-2.5 px-3 py-2.5 hover:bg-bg bg-amber-50/40">
                        <span className={clsx('w-2 h-2 mt-1.5 rounded-full shrink-0', TONE[n.tone]?.dot || TONE.info.dot)} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{n.title}</span>
                          {n.message && <span className="block text-xs text-ink-muted mt-0.5">{n.message}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {items.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => openItem(n)} className="w-full text-start flex gap-2.5 px-3 py-2.5 hover:bg-bg">
                        <span className={clsx('w-2 h-2 mt-1.5 rounded-full shrink-0', n.readAt ? 'bg-transparent' : TONE[n.tone]?.dot || TONE.info.dot)} />
                        <span className="min-w-0">
                          <span className={clsx('block text-sm text-ink', !n.readAt && 'font-medium')}>{n.title}</span>
                          {n.message && <span className="block text-xs text-ink-muted mt-0.5 line-clamp-2">{n.message}</span>}
                          <span className="block text-[11px] text-ink-faint mt-0.5">{ago(n.createdAt, t)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <PushToggle api={pushApi} className="border-t border-border px-3 py-2.5" />
            </div>
          )}
        </div>

        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenu((v) => !v)} className="flex items-center gap-2 ps-1 pe-2 h-9 rounded-md hover:bg-bg transition-colors" aria-haspopup="menu" aria-expanded={menu}>
            <span className="w-7 h-7 rounded-full bg-brand-500 text-white text-xs font-semibold flex items-center justify-center">{initialsOf(name)}</span>
            <span className="text-sm text-ink font-medium hidden sm:block max-w-[160px] truncate">{name}</span>
            <ChevronDown className="w-3.5 h-3.5 text-ink-faint" />
          </button>
          {menu && (
            <div className="absolute end-0 mt-2 w-64 bg-surface border border-border rounded-lg shadow-pop z-50 py-1 text-sm" role="menu">
              <div className="px-3 py-2.5 border-b border-border">
                <div className="font-medium text-ink truncate">{name}</div>
                <div className="text-xs text-ink-faint truncate">{me?.user?.email}</div>
                {me?.roles?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {me.roles.map((r) => <span key={r.id} className="text-[11px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-700">{r.name}</span>)}
                  </div>
                )}
                {me?.superadmin && <span className="inline-block mt-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">{t('ui.topbar.platformOwner')}</span>}
              </div>
              {!me?.superadmin && (
                <Link to="/me" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2 text-ink hover:bg-bg">
                  <UserRound className="w-4 h-4 text-ink-muted" /> {t('myWorkspace', 'My workspace')}
                </Link>
              )}
              {!me?.superadmin && (
                <Link to="/approvals" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2 text-ink hover:bg-bg">
                  <CheckSquare className="w-4 h-4 text-ink-muted" /> {t('approvals', 'Approvals')}
                </Link>
              )}
              <button onClick={() => setDensity(applyDensity(density === 'compact' ? 'comfortable' : 'compact'))} className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-bg text-start" title={t('ui.topbar.compactHint')}>
                <Rows3 className="w-4 h-4 text-ink-muted" />
                <span className="flex-1">{t('compactLayout', 'Compact layout')}</span>
                <span className={clsx('text-[11px] font-semibold', density === 'compact' ? 'text-brand-700' : 'text-ink-faint')}>{density === 'compact' ? t('ui.common.on') : t('ui.common.off')}</span>
              </button>
              <button onClick={() => { setMenu(false); setPwdOpen(true) }} className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-bg text-start">
                <KeyRound className="w-4 h-4 text-ink-muted" /> {t('changePassword', 'Change password')}
              </button>
              {me?.otherInstitutions && (
                <button onClick={() => { setMenu(false); setSwitchOpen(true) }} className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-bg text-start">
                  <ArrowLeftRight className="w-4 h-4 text-ink-muted" /> {t('ui.switchInstitution.menu')}
                </button>
              )}
              <div className="border-t border-border my-1" />
              <button onClick={() => { setMenu(false); logout() }} className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-bg text-start">
                <LogOut className="w-4 h-4 text-ink-muted" /> {t('logout', 'Sign out')}
              </button>
              <button onClick={() => { setMenu(false); logoutAll() }} className="w-full flex items-center gap-2 px-3 py-2 text-danger-600 hover:bg-danger-50 text-start">
                <MonitorSmartphone className="w-4 h-4" /> {t('logoutAll', 'Sign out of all devices')}
              </button>
            </div>
          )}
        </div>
      </div>
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
      <SwitchInstitutionModal open={switchOpen} onClose={() => setSwitchOpen(false)} />
    </header>
  )
}
