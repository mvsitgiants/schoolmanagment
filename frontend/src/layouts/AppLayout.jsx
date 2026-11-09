import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle, CreditCard, KeyRound, Lock, ShieldOff } from 'lucide-react'
import Sidebar from '../components/ui/Sidebar'
import Topbar from '../components/ui/Topbar'
import MobileTabBar from '../components/ui/MobileTabBar'
import ChangePasswordModal from '../components/ui/ChangePasswordModal'
import IdleGuard from '../components/ui/IdleGuard'
import NoticeBanner from '../components/ui/NoticeBanner'
import IncomingCalls from '../components/comms/IncomingCalls'
import CommsDock from '../components/comms/CommsDock'
import { RealtimeProvider } from '../context/RealtimeContext'
import Button from '../components/ui/Button'
import { ErrorBoundary } from '../components/system'
import { hasPermission, syncCurrentUser } from '../api/auth'
import useAuthUser from '../hooks/useAuthUser'
import { gateFor } from '../catalog/nav'
import { useCatalogLabel } from '../hooks/useCatalogLabel'
import { describePermission } from '@schoolgiant/shared'
import { bannerAction, bannerText } from '../utils/subscriptionBanner'

const BANNER_TONE = {
  info: 'bg-info-50 text-info-600 border-info-500/20',
  warning: 'bg-amber-50 text-amber-600 border-amber-400/30',
  danger: 'bg-danger-50 text-danger-600 border-danger-500/20',
}

function Blocked({ icon: Icon, title, children, action }) {
  return (
    <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center gap-3 px-4">
      <span className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center"><Icon className="w-5 h-5 text-ink-faint" /></span>
      <p className="text-ink font-medium text-lg">{title}</p>
      <div className="text-ink-muted text-sm max-w-md">{children}</div>
      {action}
    </div>
  )
}

export default function AppLayout() {
  const { t } = useTranslation(['nav', 'ui'])
  const cl = useCatalogLabel()
  const location = useLocation()
  const user = useAuthUser()
  const [navOpen, setNavOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)

  // Pick up role / plan changes made since sign-in, and again when the API says the
  // subscription stopped (client.js raises the event on a 402).
  useEffect(() => { syncCurrentUser() }, [])
  useEffect(() => {
    const onBlocked = () => syncCurrentUser()
    window.addEventListener('erp:subscription-blocked', onBlocked)
    return () => window.removeEventListener('erp:subscription-blocked', onBlocked)
  }, [])
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  if (user?.superadmin) return <Navigate to="/superadmin" replace />

  const sub = user?.subscription
  const gate = gateFor(user, location.pathname)
  const onSubscriptionPage = location.pathname.startsWith('/core/subscription')
  const showBanner = sub?.banner && hasPermission('core.subscription.view') && !onSubscriptionPage

  let body
  if (user?.user?.mustChangePassword) {
    // a temporary password is only for setting your own — the server answers nothing else until then
    body = (
      <Blocked icon={KeyRound} title={t('changePassword')} action={<Button icon={KeyRound} onClick={() => setPwdOpen(true)}>{t('changePassword')}</Button>}>
        {t('ui.layout.tempPassword')}
      </Blocked>
    )
  } else if (sub?.blocked && !onSubscriptionPage && location.pathname !== '/me') {
    body = (
      <Blocked icon={CreditCard} title={t('ui.layout.subscriptionInactive')} action={hasPermission('core.subscription.view') && <Link to="/core/subscription"><Button icon={CreditCard}>{t('ui.layout.goToSubscription')}</Button></Link>}>
        {bannerText(t, sub.banner)} {t('ui.layout.subscriptionDataSafe')}
      </Blocked>
    )
  } else if (gate.state === 'module-off') {
    body = (
      <Blocked icon={Lock} title={t('ui.layout.moduleOff', { name: cl.module(gate.module) })} action={hasPermission('core.modules.view') && <Link to="/core/modules" className="text-brand-600 text-sm hover:underline">{t('ui.layout.openModules')}</Link>}>
        {t('ui.layout.moduleOffDetail')}
      </Blocked>
    )
  } else if (gate.state === 'denied') {
    body = (
      <Blocked icon={ShieldOff} title={t('ui.layout.deniedTitle')} action={<Link to="/" className="text-brand-600 text-sm hover:underline">{t('ui.layout.goHome')}</Link>}>
        <p>
          <Trans
            t={t}
            ns="ui"
            i18nKey={user?.roles?.length ? 'ui.layout.deniedWithRoles' : 'ui.layout.denied'}
            values={{ roles: (user?.roles ?? []).map((r) => r.name).join(', '), page: gate.page ? cl.page(gate.module, gate.page) : '' }}
            components={{ b: <span className="font-medium text-ink" /> }}
          />
        </p>
        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
          {gate.missing.map((p) => (
            <code key={p} title={describePermission(p).text} className="text-[11px] px-2 py-0.5 rounded bg-bg border border-border text-ink-muted">{p}</code>
          ))}
        </div>
      </Blocked>
    )
  } else {
    body = <ErrorBoundary resetKey={location.pathname}><Outlet /></ErrorBoundary>
  }

  return (
    // one live connection per signed-in staff tab (not public pages, the portal, kiosks or TV displays)
    <RealtimeProvider userId={user?.user?.id}>
      <div className="h-[100dvh] w-screen flex bg-bg overflow-hidden">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Topbar onMenu={() => setNavOpen(true)} />
          <NoticeBanner />
          {showBanner && (
            <div className={clsx('shrink-0 border-b px-4 sm:px-6 py-2 text-sm flex items-center gap-3', BANNER_TONE[sub.banner.tone] || BANNER_TONE.info)}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1 min-w-0">{bannerText(t, sub.banner)}</span>
              {sub.banner.action && <Link to="/core/subscription" className="font-medium underline-offset-2 hover:underline whitespace-nowrap">{bannerAction(t, sub.banner)}</Link>}
            </div>
          )}
          {user?.user?.mustChangePassword && (
            <div className="shrink-0 border-b px-4 sm:px-6 py-2 text-sm flex items-center gap-3 bg-amber-50 text-amber-600 border-amber-400/30">
              <KeyRound className="w-4 h-4 shrink-0" />
              <span className="flex-1">{t('ui.layout.tempPassword')}</span>
              <button onClick={() => setPwdOpen(true)} className="font-medium hover:underline whitespace-nowrap">{t('changePassword')}</button>
            </div>
          )}
          {/* bottom room for the phone tab bar, so it never covers a page's last actions */}
          <main className="flex-1 overflow-y-auto scroll-hide p-3 sm:p-4 lg:p-6 pb-40 sm:pb-40 lg:pb-24">{body}</main>
        </div>
        <MobileTabBar onMenu={() => setNavOpen(true)} />
        <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
        <IdleGuard idleMinutes={user?.idleMinutes} />
        {/* staff call bell & chat: the incoming-call popup and the floating Call / Chat dock */}
        <IncomingCalls />
        <CommsDock />
      </div>
    </RealtimeProvider>
  )
}
