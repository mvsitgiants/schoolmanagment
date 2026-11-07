import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useTranslation } from 'react-i18next'
import { CHART } from './tokens'
import ChartCard from './ChartCard'

/**
 * A compact titled bar chart in a card — for a short trend or a small
 * categorical comparison beside a table. Data must be real.
 *
 *   <MiniBarChart
 *     title="Spend — last 6 months"
 *     data={[{ label: 'Mar', value: 12000 }, …]}
 *     valueFormat={(v) => `₹${v}`}
 *   />
 */
export default function MiniBarChart({ title, subtitle, data = [], valueFormat = (v) => v, height = 160, color = CHART.series[0], colorFor, actions, className }) {
  const { t } = useTranslation('ui')
  const clean = data.map((d) => ({ label: d.label, value: Number(d.value) || 0 }))
  const empty = clean.every((d) => d.value === 0)
  const table = empty ? null : { columns: [{ key: 'label', label: '' }, { key: 'value', label: t('ui.charts.value', 'Value'), align: 'right', format: valueFormat }], rows: clean }
  return (
    <ChartCard title={title} subtitle={subtitle} actions={actions} table={table} className={className}>
      <div style={{ height }} className="w-full">
        {empty ? (
          <div className="h-full flex items-center justify-center text-xs text-ink-faint">{t('ui.charts.noDataYet')}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clean} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={CHART.axisTick} dy={6} />
              <YAxis axisLine={false} tickLine={false} tick={CHART.axisTick} width={56} tickFormatter={valueFormat} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={CHART.tooltip} formatter={(v) => [valueFormat(v), '']} labelStyle={{ fontWeight: 600 }} />
              {/* columns ≤ 24px thick with a 4px rounded top, square at the baseline; the band's rest is air */}
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                {clean.map((d, i) => <Cell key={i} fill={colorFor ? colorFor(d, i) : color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  )
}
