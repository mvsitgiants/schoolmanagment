import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import clsx from 'clsx'
import { CloudOff, CloudUpload, Download, RefreshCw, Share, X } from 'lucide-react'
import Button from '../ui/Button'
import { useSnackbar } from '../../context/SnackbarContext'
import { dropQueued, flushQueue, onQueueChange, queued, registerSender } from '../../utils/offlineQueue'
import { saveSheet } from '../../api/attendance'

// The installed-app (PWA) layer, mounted once at the root:
//   · "A new version is ready — Reload" when the service worker has an update (never forced mid-task)
//   · an offline bar, with how many saves are waiting on this device; they are sent when the connection is back
//   · "Install SchoolGiant" (Chrome / Edge / Android) or the Add-to-Home-Screen hint on iPhone and iPad, once
registerSender('attendance', (body) => saveSheet(body))

const DISMISS_KEY = 'sg.installDismissed'
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !/crios|fxios/i.test(window.navigator.userAgent)
const dismissed = () => { try { return !!localStorage.getItem(DISMISS_KEY) } catch { return true } }

export default function PwaPrompts() {
  const { t } = useTranslation('ui')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000) }, // look for a new version hourly
  })
  const [online, setOnline] = useState(() => navigator.onLine)
  const [waiting, setWaiting] = useState(() => queued())
  const [installEvent, setInstallEvent] = useState(null)
  const [showIos, setShowIos] = useState(false)
  const [hideInstall, setHideInstall] = useState(dismissed)

  useEffect(() => onQueueChange(setWaiting), [])
  useEffect(() => {
    const flush = async () => {
      if (!queued().length) return
      const { sent } = await flushQueue()
      if (sent) { showSuccess(t('ui.pwa.sent', { count: sent })); qc.invalidateQueries({ queryKey: ['attendance-board'] }); qc.invalidateQueries({ queryKey: ['attendance-sheet'] }) }
      const failed = queued().filter((x) => x.error)
      if (failed.length) showError(t('ui.pwa.failed', { count: failed.length }))
    }
    const up = () => { setOnline(true); flush() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    if (navigator.onLine) flush() // anything left from an earlier session
    // a save queued after the "online" moment (a request that was still retrying) — and a quiet retry every 30 s
    const offChange = onQueueChange((list) => { if (navigator.onLine && list.some((x) => !x.error && !x.tries)) setTimeout(flush, 1500) })
    const timer = setInterval(() => { if (navigator.onLine && queued().some((x) => !x.error)) flush() }, 30_000)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); offChange(); clearInterval(timer) }
  }, [qc, showSuccess, showError, t])
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    if (isIos() && !isStandalone()) setShowIos(true)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const dismissInstall = () => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* blocked */ } setHideInstall(true) }
  const install = async () => {
    if (!installEvent) return
    installEvent.prompt()
    await installEvent.userChoice.catch(() => null)
    setInstallEvent(null)
    dismissInstall()
  }
  const failed = waiting.filter((x) => x.error)
  const canInstall = !hideInstall && !isStandalone() && (installEvent || showIos)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-4">
      {(!online || waiting.length > 0) && (
        <div className={clsx('pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-pop',
          !online ? 'border-amber-200 bg-amber-50 text-amber-900' : failed.length ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-info-200 bg-info-50 text-info-700')}>
          {online ? <CloudUpload className="h-4 w-4 shrink-0" aria-hidden /> : <CloudOff className="h-4 w-4 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">
            {!online ? t('ui.pwa.offline') : failed.length ? t('ui.pwa.failedBar', { count: failed.length }) : t('ui.pwa.sending')}
            {waiting.length > 0 && <span className="block text-xs opacity-80">{t('ui.pwa.waiting', { count: waiting.length })}</span>}
            {failed.slice(0, 2).map((x) => (
              <span key={x.id} className="mt-0.5 flex items-center gap-1 text-xs">
                <span className="truncate">{x.label}: {x.error}</span>
                <button type="button" onClick={() => dropQueued(x.id)} className="shrink-0 underline">{t('ui.pwa.discard')}</button>
              </span>
            ))}
          </span>
          {online && waiting.length > 0 && <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => flushQueue()}>{t('ui.pwa.retry')}</Button>}
        </div>
      )}
      {needRefresh && (
        <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-brand-200 bg-surface px-3.5 py-2.5 text-sm text-ink shadow-pop">
          <RefreshCw className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <span className="flex-1">{t('ui.pwa.update')}</span>
          <Button size="sm" onClick={() => updateServiceWorker(true)}>{t('ui.pwa.reload')}</Button>
          <button type="button" onClick={() => setNeedRefresh(false)} aria-label={t('ui.pwa.later')} className="rounded p-1 text-ink-faint hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
      )}
      {canInstall && (
        <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-sm text-ink shadow-pop">
          <img src="/icons/icon-192.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('ui.pwa.installTitle')}</span>
            <span className="block text-xs text-ink-muted">
              {installEvent ? t('ui.pwa.installBody') : <>{t('ui.pwa.iosBody1')} <Share className="inline h-3.5 w-3.5 align-text-bottom" aria-label={t('ui.pwa.share')} /> {t('ui.pwa.iosBody2')}</>}
            </span>
            {installEvent && <Button className="mt-2" size="sm" icon={Download} onClick={install}>{t('ui.pwa.install')}</Button>}
          </span>
          <button type="button" onClick={dismissInstall} aria-label={t('ui.pwa.later')} className="rounded p-1 text-ink-faint hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  )
}
