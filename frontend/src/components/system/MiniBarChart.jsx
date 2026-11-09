import { useId } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useTranslation } from 'react-i18next'
import { CHART } from './tokens'
import ChartCard from './ChartCard'

function BarTooltip({ active, payload, label, valueFormat }) {
  if (!active || !payload || !payload.length) return null
  const entry = payload[0]
  return (
    <div className="chart-tooltip-glass px-3 py-2 text-xs text-ink min-w-[100px] z-50">
      <div className="font-semibold text-ink-muted text-[11px] mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.payload?.fill || entry.color }} />
        <span className="font-mono-num font-bold text-ink tabular-nums text-sm">
          {valueFormat ? valueFormat(entry.value) : entry.value}
        </span>
      </div>
    </div>
  )
}

/**
 * A compact, modern bar chart card with smooth pill columns and interactive tooltips.
 *
 *   <MiniBarChart
 *     title="Spend — last 6 months"
 *     data={[{ label: 'Mar', value: 12000 }, …]}
 *     valueFormat={(v) => `₹${v}`}
 *   />
 */
export default function MiniBarChart({
  title,
  subtitle,
  data = [],
  valueFormat = (v) => v,
  height = 170,
  color = CHART.series[0],
  colorFor,
  actions,
  className,
}) {
  const { t } = useTranslation('ui')
  const chartId = useId().replace(/:/g, '_')
  const clean = data.map((d) => ({ label: d.label, value: Number(d.value) || 0 }))
  const empty = clean.every((d) => d.value === 0)
  const table = empty ? null : {
    columns: [
      { key: 'label', label: '' },
      { key: 'value', label: t('ui.charts.value', 'Value'), align: 'right', format: valueFormat },
    ],
    rows: clean,
  }

  return (
    <ChartCard title={title} subtitle={subtitle} actions={actions} table={table} className={className}>
      <div style={{ height }} className="w-full">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-ink-faint gap-1">
            <span className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">📊</span>
            <span>{t('ui.charts.noDataYet')}</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clean} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
              <defs>
                <linearGradient id={`bar-grad-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="1" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.75" />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={CHART.axisTick} dy={6} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={CHART.axisTick}
                width={56}
                tickFormatter={valueFormat}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15, 23, 42, 0.04)', radius: 6 }}
                content={<BarTooltip valueFormat={valueFormat} />}
              />
              <Bar
                dataKey="value"
                radius={[6, 6, 2, 2]}
                maxBarSize={28}
                isAnimationActive={true}
                animationDuration={750}
                animationEasing="ease-out"
                fill={`url(#bar-grad-${chartId})`}
              >
                {clean.map((d, i) => (
                  <Cell
                    key={i}
                    fill={colorFor ? colorFor(d, i) : `url(#bar-grad-${chartId})`}
                    className="transition-opacity hover:opacity-80"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  )
}
