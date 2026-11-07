import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { CHART } from './tokens'

/**
 * A right-rail breakdown: a donut with a centred total, and a legend that shows
 * each segment's count and share of the total. Segments must come from real data.
 *
 *   <BreakdownDonut
 *     title="Stock health"
 *     centerLabel="items"
 *     segments={[
 *       { name: 'Healthy', value: 120, color: CHART.status.good },
 *       { name: 'Below reorder', value: 8, color: CHART.status.critical },
 *     ]}
 *   />
 *
 * Optional:
 *   actions:     a link or control at the header's end
 *   valueFormat: formats segment values in the legend and tooltip (money, units)
 *   empty:       the line shown when every segment is zero
 *   stacked:     a larger donut above a full-width legend, for a tall narrow column
 *                (side by side again on tablets, where the card spans the page)
 */
export default function BreakdownDonut({
  title, subtitle, segments = [], centerLabel, centerValue, footer, actions, valueFormat = (v) => v, empty, stacked = false, className,
}) {
  const { t } = useTranslation('ui')
  const clean = segments.filter((s) => s && Number.isFinite(Number(s.value)))
  const total = clean.reduce((sum, s) => sum + Number(s.value), 0)
  const data = total === 0 ? [{ name: 'empty', value: 1, color: '#E5E7EB' }] : clean
  const ring = stacked ? { box: 'h-40 w-40', inner: 56, outer: 76 } : { box: 'h-28 w-28', inner: 42, outer: 56 }

  return (
    <div className={clsx('bg-surface border border-border rounded-xl shadow-card p-5 flex flex-col min-w-0', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="font-display text-base font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={clsx('flex items-center gap-5', stacked && 'flex-1 flex-col md:flex-row lg:flex-col justify-center')}>
        <div className={clsx('relative shrink-0', ring.box)}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={ring.inner} outerRadius={ring.outer} paddingAngle={total === 0 ? 0 : 2} dataKey="value" stroke="none">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              {total > 0 && <Tooltip contentStyle={CHART.tooltip} formatter={(v, n) => [valueFormat(v), n]} />}
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-3 text-center">
            <span className={clsx('font-semibold text-ink font-mono-num tabular-nums leading-none', stacked ? 'text-2xl' : 'text-xl')}>{centerValue ?? total}</span>
            <span className="text-[10px] font-medium text-ink-muted mt-1">{centerLabel ?? t('ui.charts.total')}</span>
          </div>
        </div>
        <div className={clsx('flex-1 min-w-0 flex flex-col gap-2', stacked && 'w-full')}>
          {clean.length === 0 && <p className={clsx('text-xs text-ink-faint', stacked && 'text-center')}>{empty ?? t('ui.charts.noData')}</p>}
          {clean.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 min-w-0 text-ink-muted">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="truncate font-medium text-ink">{s.name}</span>
              </span>
              <span className="shrink-0 font-mono-num tabular-nums text-ink">
                {valueFormat(s.value)}
                <span className="inline-block w-10 text-end text-ink-faint">{total ? Math.round((s.value / total) * 100) : 0}%</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      {footer && <div className="mt-4 pt-3 border-t border-border">{footer}</div>}
    </div>
  )
}
