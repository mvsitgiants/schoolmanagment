import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BellRing, BellOff } from 'lucide-react'
import { pushState, turnPushOff, turnPushOn } from '../../utils/push'

/**
 * "Notifications on this device" switch. `api` = { key(), save(sub), off(endpoint) } — staff (api/core.js) or the
 * family app (api/family.js). `ns`/`prefix` pick the locale keys: <prefix>.title, .on, .off, .blocked, .unsupported.
 */
export default function PushToggle({ api, ns = 'ui', prefix = 'ui.push', className }) {
  const { t } = useTranslation(ns)
  const [state, setState] = useState('loading')
  const [busy, setBusy] = useState(false)
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')) }, [])
  if (state === 'loading' || state === 'unsupported') return null
  const on = state === 'on'
  const toggle = async () => {
    setBusy(true)
    try { setState(on ? await turnPushOff(api) : await turnPushOn(api)) } catch { setState(await pushState().catch(() => 'off')) } finally { setBusy(false) }
  }
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      {on ? <BellRing className="h-4 w-4 shrink-0 text-brand-600" aria-hidden /> : <BellOff className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{t(`${prefix}.title`)}</span>
        <span className="block text-xs text-ink-muted">{t(`${prefix}.${state}`)}</span>
      </span>
      {state !== 'blocked' && (
        <button type="button" role="switch" aria-checked={on} aria-label={t(`${prefix}.title`)} disabled={busy} onClick={toggle}
          className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60', on ? 'bg-brand-600' : 'bg-black/15')}>
          <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button>
      )}
    </div>
  )
}
