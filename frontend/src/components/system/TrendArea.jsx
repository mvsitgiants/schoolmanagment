import { useId } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { CHART } from './tokens'
import ChartCard from './ChartCard'

/**
 * Custom glassmorphic tooltip for TrendArea.
 */
function TrendTooltip({ active, payload, label, valueFormat }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="chart-tooltip-glass px-3 py-2.5 text-xs text-ink min-w-[130px] z-50">
      <div className="font-semibold text-ink-muted mb-1.5 pb-1 border-b border-border/60 text-[11px] tracking-wide">
        {label}
      </div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-ink-muted truncate font-medium">{entry.name}</span>
            </span>
            <span className="font-mono-num font-semibold text-ink tabular-nums">
              {valueFormat ? valueFormat(entry.value) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A titled time-series card with smooth bezier curve and radiant gradient area fill.
 *
 *   <TrendArea
 *     title="Stock movements — last 30 days"
 *     data={[{ label: 'Jul 1', value: 12, value2: 3 }, …]}
 *     series={[
 *       { key: 'value', name: 'Receipts' },
 *       { key: 'value2', name: 'Issues' },
 *     ]}
 *     valueFormat={(v) => v}
 *   />
 */
export default function TrendArea({
  title,
  subtitle,
  data = [],
  series: seriesProp,
  valueFormat = (v) => v,
  height = 220,
  yAxisWidth = 48,
  actions,
  emptyText,
  line = false,
  className,
}) {
  const { t } = useTranslation('ui')
  const chartId = useId().replace(/:/g, '_')
  const series = (seriesProp ?? [{ key: 'value', name: t('ui.common.total') }]).slice(0, CHART.series.length)
  const clean = data.map((d) => {
    const row = { label: d.label }
    series.forEach((s) => { row[s.key] = Number(d[s.key]) || 0 })
    return row
  })
  const empty = clean.length === 0 || clean.every((d) => series.every((s) => d[s.key] === 0))
  const multi = series.length > 1
  const colorOf = (s, i) => s.color || CHART.series[i % CHART.series.length]
  const table = empty ? null : {
    columns: [{ key: 'label', label: t('ui.charts.period', 'Period') }, ...series.map((s) => ({ key: s.key, label: s.name || s.key, align: 'right', format: valueFormat }))],
    rows: clean,
  }

  return (
    <ChartCard title={title} subtitle={subtitle} actions={actions} table={table} className={className}>
      <div style={{ height }} className="w-full">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-ink-faint gap-1">
            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">📊</span>
            <span>{emptyText ?? t('ui.charts.noActivity')}</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={clean} margin={{ top: 12, right: 10, left: -16, bottom: 0 }}>
              <defs>
                {series.map((s, i) => {
                  const color = colorOf(s, i)
                  return (
                    <linearGradient key={s.key} id={`grad-${chartId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={line ? 0 : 0.35} />
                      <stop offset="90%" stopColor={color} stopOpacity={line ? 0 : 0.02} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  )
                })}
              </defs>
              <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={CHART.axisTick}
                dy={6}
                minTickGap={20}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={CHART.axisTick}
                width={yAxisWidth}
                tickFormatter={valueFormat}
                allowDecimals={false}
              />
              <Tooltip
                content={<TrendTooltip valueFormat={valueFormat} />}
                cursor={{ stroke: '#94A3B8', strokeWidth: 1.2, strokeDasharray: '4 4' }}
              />
              {multi && (
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#64748B', fontWeight: 500 }}
                />
              )}
              {series.map((s, i) => {
                const color = colorOf(s, i)
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name || s.key}
                    stroke={color}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={`url(#grad-${chartId}-${s.key})`}
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: color,
                      stroke: '#FFFFFF',
                      strokeWidth: 2.5,
                      className: 'drop-shadow-md',
                    }}
                    isAnimationActive={true}
                    animationDuration={850}
                    animationEasing="ease-out"
                  />
                )
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  )
}
