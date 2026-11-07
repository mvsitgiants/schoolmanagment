import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { WifiLow, WifiOff, RefreshCw, AlertCircle, ArrowUpRight } from 'lucide-react'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'

/**
 * Topbar chip that shows connection warnings:
 * - Hidden when network is good & fast
 * - Amber chip when connection is slow / high latency
 * - Amber spinner when reconnecting
 * - Red chip when completely offline
 */
export default function NetworkStatusChip() {
  const { t } = useTranslation('ui')
  const { status, online, latency, effectiveType, downlink, checking, checkNow } = useNetworkStatus()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // If connection is normal and popover is closed, stay hidden to avoid clutter
  if (status === 'good' && !open) {
    return null
  }

  const isOffline = status === 'offline' || !online
  const isReconnecting = status === 'reconnecting'
  const isSlow = status === 'slow'

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={isOffline ? t('ui.network.offlineHint') : isSlow ? t('ui.network.slowHint') : t('ui.network.statusHint')}
        className={clsx(
          'h-7 px-2.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-all',
          isOffline && 'bg-danger-50 text-danger-600 border border-danger-500/30 hover:bg-danger-100/70',
          isReconnecting && 'bg-amber-50 text-amber-700 border border-amber-400/40 hover:bg-amber-100/70',
          isSlow && 'bg-amber-50 text-amber-700 border border-amber-400/40 hover:bg-amber-100/70',
          status === 'good' && 'bg-success-50 text-success-700 border border-success-500/30 hover:bg-success-100/70'
        )}
      >
        {isOffline ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-danger-500" />
            </span>
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span className="font-semibold">{t('ui.network.offline')}</span>
          </>
        ) : isReconnecting ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
            <span>{t('ui.network.reconnecting')}</span>
          </>
        ) : isSlow ? (
          <>
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <WifiLow className="w-3.5 h-3.5 shrink-0" />
            <span>{t('ui.network.slow')}</span>
            {latency && (
              <span className="hidden md:inline font-mono text-[11px] opacity-75">
                {latency}ms
              </span>
            )}
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-success-500 shrink-0" />
            <span>{t('ui.network.connected')}</span>
          </>
        )}
      </button>

      {/* Detail Popover */}
      {open && (
        <div className="absolute end-0 top-full mt-2 w-72 rounded-xl bg-surface border border-border shadow-xl p-3.5 z-50 text-ink text-start animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-border">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-ink">
              <AlertCircle className={clsx('w-4 h-4', isOffline ? 'text-danger-500' : 'text-amber-500')} />
              <span>{t('ui.network.title')}</span>
            </div>
            <span
              className={clsx(
                'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                isOffline && 'bg-danger-100 text-danger-700',
                isReconnecting && 'bg-amber-100 text-amber-800',
                isSlow && 'bg-amber-100 text-amber-800',
                status === 'good' && 'bg-success-100 text-success-800'
              )}
            >
              {t(`ui.network.status.${status}`, { defaultValue: status })}
            </span>
          </div>

          <p className="text-xs text-ink-muted leading-relaxed mb-3">
            {isOffline
              ? t('ui.network.offlineDetail')
              : isSlow
              ? t('ui.network.slowDetail')
              : isReconnecting
              ? t('ui.network.reconnectingDetail')
              : t('ui.network.goodDetail')}
          </p>

          <div className="grid grid-cols-2 gap-2 text-[11px] bg-bg rounded-lg p-2.5 mb-3 border border-border">
            <div>
              <span className="text-ink-faint block">{t('ui.network.latency')}</span>
              <span className="font-medium font-mono text-ink">
                {latency != null ? `${latency} ms` : t('ui.network.measuring')}
              </span>
            </div>
            <div>
              <span className="text-ink-faint block">{t('ui.network.effectiveSpeed')}</span>
              <span className="font-medium text-ink uppercase">
                {effectiveType || (downlink ? `${downlink} Mbps` : t('ui.network.standard'))}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={checking}
              onClick={() => checkNow()}
              className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', checking && 'animate-spin')} />
              <span>{checking ? t('ui.network.checking') : t('ui.network.testConnection')}</span>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-ink-muted hover:text-ink px-2 py-1 rounded hover:bg-bg"
            >
              {t('ui.network.dismiss')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
