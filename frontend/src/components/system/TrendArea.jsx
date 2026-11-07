import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { CHART } from './tokens'
import ChartCard from './ChartCard'

/**
 * A titled time-series card — a filled area (optionally two or three series) for
 * a real trend on a module overview. Data must be derived from real records.
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
 *
 * Optional: `actions` (a link or control at the header's end), `emptyText`, `line` (no area fill).
 */
export default function TrendArea({
  title,
  subtitle,
  data = [],
  series: seriesProp,
  valueFormat = (v) => v,
  height = 200,
  yAxisWidth = 48, // wider for money labels such as ₹80K
  actions,
  emptyText, // replaces the default "no activity" line
  line = false, // plain lines, no fill — for comparing two series by shape
  className,
}) {
  const { t } = useTranslation('ui')
  // six palette slots at most — a 7th series would need a colour nobody can tell apart
  const series = (seriesProp ?? [{ key: 'value', name: t('ui.common.total') }]).slice(0, CHART.series.length)
  const clean = data.map((d) => {
    const row = { label: d.label }
    series.forEach((s) => { row[s.key] = Number(d[s.key]) || 0 })
    return row
  })
  const empty = clean.length === 0 || clean.every((d) => series.every((s) => d[s.key] === 0))
  const multi = series.length > 1
  const colorOf = (s, i) => s.color || CHART.series[i]
  const table = empty ? null : {
    columns: [{ key: 'label', label: t('ui.charts.period', 'Period') }, ...series.map((s) => ({ key: s.key, label: s.name || s.key, align: 'right', format: valueFormat }))],
    rows: clean,
  }

  return (
    <ChartCard title={title} subtitle={subtitle} actions={actions} table={table} className={className}>
      <div style={{ height }} className="w-full">
        {empty ? (
          <div className="h-full flex items-center justify-center text-xs text-ink-faint">{emptyText ?? t('ui.charts.noActivity')}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={clean} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
              {/* recessive: one solid hairline per tick, no vertical lines, no axis rules */}
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={CHART.axisTick} dy={6} minTickGap={24} />
              <YAxis axisLine={false} tickLine={false} tick={CHART.axisTick} width={yAxisWidth} tickFormatter={valueFormat} allowDecimals={false} />
              <Tooltip contentStyle={CHART.tooltip} formatter={(v, n) => [valueFormat(v), n]} labelStyle={{ fontWeight: 600 }} cursor={{ stroke: CHART.grid, strokeWidth: 1 }} />
              {multi && <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 4, color: '#5B616E' }} />}
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name || s.key}
                  stroke={colorOf(s, i)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  // a wash under the line (~10%), never a saturated block; none when comparing shapes
                  fill={line ? 'none' : colorOf(s, i)}
                  fillOpacity={line ? 0 : multi ? 0.06 : 0.1}
                  dot={false}
                  // the hover marker: ≥ 8px, ringed in the surface colour so it stays clear where lines cross
                  activeDot={{ r: 4.5, stroke: '#FFFFFF', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  )
}
