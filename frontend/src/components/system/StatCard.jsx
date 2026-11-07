import clsx from 'clsx'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { PANEL, TONE } from './tokens'

const STROKE = {
  neutral: '#76838F', brand: 'rgb(var(--brand-500))', success: '#1F9D66',
  warning: '#E2A63A', danger: '#D64545', info: '#3358D6',
}

/** A bare trend line for the last N values — no axes, no labels, just the shape. */
function Sparkline({ values = [], tone = 'neutral' }) {
  if (!Array.isArray(values) || values.length < 2) return null
  const nums = values.map((v) => Number(v) || 0)
  const max = Math.max(...nums), min = Math.min(...nums), range = max - min || 1
  const W = 96, H = 22
  const points = nums.map((v, i) => `${(i / (nums.length - 1)) * W},${H - 2 - ((v - min) / range) * (H - 4)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" className="w-full h-5 mt-1.5">
      <polyline points={points} fill="none" stroke={STROKE[tone] || STROKE.neutral} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function Delta({ value, direction = 'flat', good, label }) {
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight
  const tone = good === true ? 'text-success-700' : good === false ? 'text-danger-600' : 'text-ink-muted'
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] sm:text-xs min-w-0">
      <span className={clsx('inline-flex items-center gap-0.5 font-semibold tabular-nums', tone)}><Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{value}</span>
      {label && <span className="text-ink-faint truncate">{label}</span>}
    </div>
  )
}

/**
 * One KPI tile: icon badge + label + big value + sub-line. Values must come from
 * real data on the page — never a placeholder.
 *
 *   <StatCard icon={Calendar} tone="info" label="Planned Orders" value={42} sub="This week" />
 *
 * Optional:
 *   trend:   [n, n, n…] — draws a sparkline under the value (the same tone)
 *   delta:   { value: '+12%', direction: 'up' | 'down' | 'flat', good: true | false, label: 'vs last week' }
 *            the change against the previous period — an arrow and words, so it never relies on
 *            colour alone; green / red only says whether the change is good for this number
 *   onClick: makes the tile a button; use it to jump to the list this number counts,
 *            already filtered, so a KPI is a way in rather than a dead end.
 */
export function StatCard({ icon: Icon, label, value, sub, tone = 'neutral', trend, delta, onClick }) {
  const t = TONE[tone] ?? TONE.neutral
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={onClick ? `${label}: ${value}` : undefined}
      className={clsx(
        PANEL, 'flex-1 min-w-0 sm:min-w-[180px] overflow-hidden transition-shadow text-start',
        onClick ? ' hover:border-brand-200 cursor-pointer' : '',
      )}
    >
      <div className="ui-stat p-3 sm:p-4 flex gap-3 sm:gap-4">
        {Icon && (
          <span className={clsx('w-10 h-10 sm:w-12 sm:h-12 rounded-xl border flex items-center justify-center shrink-0', t.bg, t.text, t.border)}>
            <Icon className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
          </span>
        )}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="text-[11px] sm:text-xs font-semibold text-ink-muted mb-0.5 truncate">{label}</div>
          <div className="text-xl sm:text-2xl font-semibold text-ink font-mono-num tabular-nums leading-none mb-1">{value}</div>
          {sub != null && <div className="text-[11px] sm:text-xs text-ink-faint truncate">{sub}</div>}
          {delta && <Delta {...delta} />}
          {trend && <Sparkline values={trend} tone={tone} />}
        </div>
      </div>
    </Tag>
  )
}

/** A responsive row of StatCards. 2-up on phones, flex row from `sm`.
 *  Pass `items: [{ icon, label, value, sub, tone, trend, onClick }]`. */
export function StatCardRow({ items = [], className }) {
  return (
    <div className={clsx('grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:gap-4 w-full', className)}>
      {items.map((it) => <StatCard key={it.label} {...it} />)}
    </div>
  )
}

export default StatCard
