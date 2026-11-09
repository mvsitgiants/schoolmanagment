import { useId } from 'react'
import clsx from 'clsx'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { ACCENTS, PANEL, TONE } from './tokens'

const STROKE = {
  neutral: '#64748B',
  brand: 'rgb(var(--brand-500))',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  violet: '#8B5CF6',
  pink: '#EC4899',
  sky: '#0EA5E9',
  orange: '#F97316',
  teal: '#14B8A6',
}

/** A smooth bezier sparkline with gradient area wash underneath. */
function Sparkline({ values = [], tone = 'neutral' }) {
  const gradId = useId().replace(/:/g, '_')
  if (!Array.isArray(values) || values.length < 2) return null
  const nums = values.map((v) => Number(v) || 0)
  const max = Math.max(...nums), min = Math.min(...nums), range = max - min || 1
  const W = 110, H = 28
  const padY = 3
  const effectiveH = H - padY * 2

  const pts = nums.map((v, i) => ({
    x: (i / (nums.length - 1)) * W,
    y: H - padY - ((v - min) / range) * effectiveH,
  }))

  // Construct smooth SVG path
  let pathD = `M ${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const mx = (p0.x + p1.x) / 2
    pathD += ` C ${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`
  }
  const areaD = `${pathD} L ${pts[pts.length - 1].x},${H} L ${pts[0].x},${H} Z`
  const color = STROKE[tone] || STROKE.neutral
  const lastPt = pts[pts.length - 1]

  return (
    <div className="w-full h-7 mt-2 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" className="w-full h-full block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastPt.x} cy={lastPt.y} r="2.5" fill={color} className="animate-pulse" />
      </svg>
    </div>
  )
}

function Delta({ value, direction = 'flat', good, label }) {
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight
  const isGood = good === true
  const isBad = good === false
  const toneClasses = isGood
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
    : isBad
    ? 'bg-rose-50 text-rose-700 border-rose-200/70'
    : 'bg-slate-100 text-slate-700 border-slate-200/70'

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] sm:text-xs min-w-0">
      <span className={clsx('inline-flex items-center gap-0.5 font-semibold tabular-nums px-1.5 py-0.5 rounded-md border text-[11px]', toneClasses)}>
        <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
        {value}
      </span>
      {label && <span className="text-ink-faint truncate">{label}</span>}
    </div>
  )
}

/** A thin split bar with a legend under it: boys / girls, paid / due, present / absent. */
function Segments({ parts }) {
  const list = parts.filter((p) => Number(p.value) > 0)
  const sum = list.reduce((n, p) => n + Number(p.value), 0)
  if (!sum) return null
  return (
    <div className="mt-2.5 w-full">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.05]" role="img"
        aria-label={list.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        {list.map((p, i) => (
          <span key={p.label ?? i} className={clsx('h-full first:rounded-s-full last:rounded-e-full', (TONE[p.tone] ?? TONE[ACCENTS[i % ACCENTS.length]]).fill)}
            style={{ width: `${(Number(p.value) / sum) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-muted">
        {list.map((p, i) => (
          <span key={p.label ?? i} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className={clsx('h-1.5 w-1.5 rounded-full', (TONE[p.tone] ?? TONE[ACCENTS[i % ACCENTS.length]]).dot)} />
            {p.label} <span className="font-semibold text-ink tabular-nums">{p.value}</span>
            <span className="text-ink-faint tabular-nums">{Math.round((Number(p.value) / sum) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * One KPI tile: icon badge (in its tone) + label + big value + sub-line. Values must come from
 * real data on the page — never a placeholder.
 *
 *   <StatCard icon={Calendar} tone="info" label="Planned Orders" value={42} sub="This week" />
 *
 * Optional:
 *   trend:    [n, n, n…] — draws a smooth gradient sparkline under the value
 *   delta:    { value: '+12%', direction: 'up' | 'down' | 'flat', good: true | false, label: 'vs last week' }
 *   progress: 75 (displays a subtle progress bar)
 *   segments: [{ label, value, tone? }] — a split bar with a legend (boys / girls, paid / due)
 *   onClick:  makes the tile a button; use it to jump to the list this number counts.
 * `tone` may be a meaning (success, warning, danger, info) or a decorative accent (brand, violet, pink, sky, orange, teal).
 */
export function StatCard({ icon: Icon, label, value, sub, tone = 'neutral', trend, delta, progress, segments, onClick, className }) {
  const t = TONE[tone] ?? TONE.neutral
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={onClick ? `${label}: ${value}` : undefined}
      className={clsx(
        PANEL,
        'relative flex-1 min-w-0 sm:min-w-[190px] overflow-hidden text-start group card-hover',
        onClick ? 'cursor-pointer hover:border-brand-300' : '',
        className
      )}
    >
      <div className="ui-stat p-4 sm:p-5 flex gap-3 sm:gap-4 relative z-10">
        {Icon && (
          <span
            className={clsx(
              'w-11 h-11 sm:w-12 sm:h-12 rounded-xl border flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 group-hover:scale-105',
              t.bg, t.text, t.border
            )}
          >
            <Icon className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
          </span>
        )}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="text-[11px] sm:text-xs font-semibold text-ink-muted mb-1 truncate uppercase tracking-wider">{label}</div>
          <div className="font-display text-2xl sm:text-[26px] font-bold text-ink tabular-nums leading-none tracking-tight mb-1">
            {value}
          </div>
          {sub != null && <div className="text-[11px] sm:text-xs text-ink-faint truncate font-medium">{sub}</div>}
          {delta && <Delta {...delta} />}
          {progress != null && (
            <div className="mt-2 w-full h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
              <div
                className={clsx('h-full rounded-full transition-all duration-500', t.fill)}
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
          )}
          {segments && <Segments parts={segments} />}
          {trend && <Sparkline values={trend} tone={tone} />}
        </div>
      </div>
    </Tag>
  )
}

/** A responsive row of StatCards. 2-up on phones, flex row from `sm`.
 *  Pass `items: [{ icon, label, value, sub, tone, trend, delta, segments, onClick }]`.
 *  A tile without a `tone` takes the next decorative accent, so a row of plain counts is still colourful. */
const ROW_COLS = { 3: 'lg:grid-cols-3', 5: 'lg:grid-cols-3 xl:grid-cols-5', 6: 'lg:grid-cols-3 2xl:grid-cols-6' }
export function StatCardRow({ items = [], className }) {
  return (
    <div className={clsx('grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4 w-full', ROW_COLS[items.length] ?? 'lg:grid-cols-4', className)}>
      {items.map((it, i) => <StatCard key={it.label} {...it} tone={it.tone ?? ACCENTS[i % ACCENTS.length]} />)}
    </div>
  )
}

export default StatCard
