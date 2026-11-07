import clsx from 'clsx'
import { TONE } from './tokens'

/**
 * Compact progress meter: optional value label above a thin track.
 * Tone auto-derives from pct unless you pass one.
 */
export default function ProgressBar({ value = 0, tone, showValue = true, className, size = 'sm' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const auto = pct >= 100 ? 'success' : pct >= 50 ? 'success' : pct >= 25 ? 'warning' : 'danger'
  const t = TONE[tone ?? auto] ?? TONE.brand
  const h = size === 'md' ? 'h-2' : 'h-1.5'
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {showValue && <span className="text-[10px] font-semibold text-ink-muted font-mono-num">{pct}%</span>}
      <div className={clsx('w-full rounded-full bg-black/5', h)}>
        <div className={clsx('rounded-full', h, t.fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
