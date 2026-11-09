import { useId } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'

// Pieces of Home's command center (as the ERP's): a headline card with its sparkline, a small
// donut with its legend beside it, and a plain white card to hold either.

export const HUE = {
  brand: '#0E7C86', info: '#3358D6', success: '#1F9D66', amber: '#B9821F', danger: '#D64545', violet: '#7A5CC8', pink: '#D6428F', sky: '#0284C7', neutral: '#8A8F98',
}

/** A white card with a title line (and an optional muted note after it). */
export function Card({ title, note, action, children, className, bodyClassName }) {
  return (
    <section className={clsx('bg-surface border border-border rounded-xl p-5 shadow-card min-w-0', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm font-semibold text-ink min-w-0 truncate">{title}{note && <span className="text-ink-muted font-normal"> — {note}</span>}</p>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** A filled sparkline; flat zeroes read "No data yet". */
export function Spark({ data = [], tone = 'brand', height = 40 }) {
  const { t } = useTranslation('dashboard')
  const id = useId().replace(/:/g, '_')
  const points = data.map((v, i) => ({ i, v: Number(v) || 0 }))
  const color = HUE[tone] ?? HUE.brand
  if (points.length < 2 || points.every((p) => p.v === 0)) {
    return <div style={{ height }} className="flex items-center text-[11px] text-ink-faint">{t('home.noData')}</div>
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * A headline figure: icon and label, the value, how it moved against the previous period, and its
 * sparkline over the period. `delta` { text, good } — good colours it green, bad red, null grey.
 */
export function KpiCard({ icon: Icon, label, value, delta, sub, spark, tone = 'brand', onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={clsx('bg-surface border border-border rounded-xl p-4 shadow-card text-start min-w-0 flex flex-col', onClick && 'hover:border-brand-300 transition-colors')}>
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${HUE[tone] ?? HUE.brand}14`, color: HUE[tone] ?? HUE.brand }}>
          <Icon className="w-4 h-4" />
        </span>
        <p className="text-sm text-ink-muted truncate">{label}</p>
      </div>
      <p className="text-xl font-semibold text-ink font-mono-num tabular-nums truncate">{value}</p>
      {delta?.text ? (
        <p className={clsx('text-xs font-medium mt-0.5 leading-snug line-clamp-2 min-h-[2lh]', delta.good == null ? 'text-ink-muted' : delta.good ? 'text-success-600' : 'text-danger-600')}>{delta.text}</p>
      ) : <p className="text-xs text-ink-muted mt-0.5 leading-snug line-clamp-2 min-h-[2lh]">{sub ?? ' '}</p>}
      {spark && <div className="mt-2 -mx-1"><Spark data={spark} tone={tone} /></div>}
    </Tag>
  )
}

/** A donut with its total in the middle and a legend beside it. `segments` [{ name, value, color, label? }]. */
export function DonutStat({ centerValue, centerLabel, segments = [], format = (v) => v }) {
  const total = segments.reduce((n, s) => n + (Number(s.value) || 0), 0)
  const data = total === 0 ? [{ name: 'empty', value: 1, color: '#E5E7EB' }] : segments.filter((s) => s.value > 0)
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-28 h-28 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={54} paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((s) => <Cell key={s.name} fill={s.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
          <p className="text-lg font-semibold text-ink leading-tight tabular-nums">{centerValue}</p>
          <p className="text-[10px] text-ink-muted leading-tight">{centerLabel}</p>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {segments.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-ink-muted min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="truncate">{s.label ?? s.name}</span>
            </span>
            <span className="font-medium text-ink shrink-0 tabular-nums">{format(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
