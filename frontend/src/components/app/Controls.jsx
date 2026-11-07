import clsx from 'clsx'
import { Check, Copy, Lock, Minus } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Modal from '../system/Modal'
import Button from '../ui/Button'

/** On/off switch. */
export function Switch({ checked, onChange, disabled, label, size = 'md' }) {
  const dims = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]'
  const knob = size === 'sm' ? 'w-3.5 h-3.5' : 'w-[18px] h-[18px]'
  const shift = size === 'sm' ? 'translate-x-[14px] rtl:-translate-x-[14px]' : 'translate-x-[18px] rtl:-translate-x-[18px]'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={clsx('relative inline-flex shrink-0 items-center rounded-full transition-colors', dims,
        checked ? 'bg-brand-500' : 'bg-black/15', disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
    >
      <span className={clsx('inline-block rounded-full bg-white shadow transition-transform', knob, checked ? shift : 'translate-x-[2px] rtl:-translate-x-[2px]')} />
    </button>
  )
}

/**
 * Square tick used by the permission matrix. `state`: true | false | 'some'.
 * `locked` shows a lock (you can't grant what you don't hold).
 */
export function Tick({ state, onClick, disabled, locked, label, size = 18, tone = 'brand' }) {
  const on = state === true
  const some = state === 'some'
  const { t } = useTranslation('ui')
  const fill = tone === 'warning' ? 'bg-amber-400 border-amber-400' : 'bg-brand-500 border-brand-500'
  if (locked && !on) {
    return (
      <span title={t('ui.controls.lockedHint')} className="inline-flex items-center justify-center rounded-[5px] border border-dashed border-border text-ink-faint" style={{ width: size, height: size }}>
        <Lock className="w-2.5 h-2.5" />
      </span>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={some ? 'mixed' : on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx('inline-flex items-center justify-center rounded-[5px] border transition-colors shrink-0',
        on || some ? `${fill} text-white` : 'bg-surface border-ink-faint/50 hover:border-brand-500',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer')}
      style={{ width: size, height: size }}
    >
      {on && <Check className="w-3 h-3" strokeWidth={3} />}
      {some && <Minus className="w-3 h-3" strokeWidth={3} />}
    </button>
  )
}

/** "12 of 150 users" with a bar that turns amber near, red at the limit. */
export function UsageMeter({ label, used = 0, limit, unit = '' }) {
  const unlimited = limit === undefined || limit === null
  const pct = unlimited || limit === 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / limit) * 100))
  const tone = unlimited ? 'bg-brand-500' : pct >= 100 ? 'bg-danger-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="text-ink font-medium tabular-nums">
          {used.toLocaleString('en-IN')}{unit && ` ${unit}`}
          <span className="text-ink-faint font-normal"> / {unlimited ? '∞' : `${limit.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-black/5 overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', tone)} style={{ width: `${limit === 0 && !used ? 0 : pct}%` }} />
      </div>
    </div>
  )
}

/** Label/value pairs in a responsive grid. */
export function DefinitionGrid({ items = [], cols = 2 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
      {items.filter(Boolean).map((it, i) => (
        <div key={i} className={it.full ? 'sm:col-span-full' : ''}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{it.label}</dt>
          <dd className={clsx('mt-0.5 text-sm text-ink', it.mono && 'font-mono-num')}>{it.value ?? <span className="text-ink-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One-time display of a generated password, with copy. */
export function TempPasswordModal({ open, onClose, name, email, password }) {
  const { t } = useTranslation('ui')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('ui.controls.tempPassword.title')} size="sm" footer={<Button onClick={onClose}>{t('ui.controls.tempPassword.done')}</Button>}>
      <p className="text-sm text-ink-muted"><Trans t={t} i18nKey={email ? 'ui.controls.tempPassword.shareWithEmail' : 'ui.controls.tempPassword.share'} values={{ name, email }} components={{ b: <span className="font-medium text-ink" /> }} /></p>
      <div className="mt-4 flex items-center gap-2">
        <code className="flex-1 px-3 py-2.5 rounded-lg bg-bg border border-border text-base font-mono-num tracking-wide text-ink select-all">{password}</code>
        <Button variant="secondary" icon={copied ? Check : Copy} onClick={copy}>{copied ? t('ui.controls.tempPassword.copied') : t('ui.controls.tempPassword.copy')}</Button>
      </div>
    </Modal>
  )
}
