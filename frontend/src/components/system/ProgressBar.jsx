import clsx from 'clsx'
import { TONE } from './tokens'

/**
 * Modern progress meter: rounded track with smooth transitions and optional value badge.
 * Tone auto-derives from pct unless you pass one.
 */
export default function ProgressBar({ value = 0, tone, showValue = true, className, size = 'sm' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const auto = pct >= 100 ? 'success' : pct >= 50 ? 'success' : pct >= 25 ? 'warning' : 'danger'
  const t = TONE[tone ?? auto] ?? TONE.brand
  const h = size === 'md' ? 'h-2.5' : size === 'lg' ? 'h-3.5' : 'h-2'

  return (
    <div className={clsx('flex flex-col gap-1.5 w-full', className)}>
      {showValue && (
        <div className="flex justify-between items-center text-[11px]">
          <span className="font-semibold text-ink-muted">Progress</span>
          <span className="font-mono-num font-bold text-ink tabular-nums">{pct}%</span>
        </div>
      )}
      <div className={clsx('w-full rounded-full bg-slate-100 shadow-inner overflow-hidden', h)}>
        <div
          className={clsx('rounded-full transition-all duration-500 ease-out', h, t.fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
