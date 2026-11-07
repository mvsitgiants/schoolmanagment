import { useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { BarChart3, Table2 } from 'lucide-react'
import { PANEL } from './tokens'

/**
 * The shell every chart card shares: title, subtitle, actions — and a Chart / Table switch.
 * The table is the same numbers as rows: for screen readers, for anyone who can't tell two
 * colours apart, for reading an exact value, and required whenever a light series colour is on
 * the chart (dataviz relief rule). `table`: { columns: [{ key, label, align, format }], rows }.
 * Pass `table={null}` for a card that has nothing tabular (a single number).
 */
export default function ChartCard({ title, subtitle, actions, table, className, children }) {
  const { t } = useTranslation('ui')
  const [asTable, setAsTable] = useState(false)
  const canTable = !!table?.rows?.length
  return (
    <section className={clsx(PANEL, 'p-5 flex flex-col min-w-0', className)} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions || canTable) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="font-display text-base font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          <div className="ms-auto flex items-center gap-2 shrink-0">
            {actions}
            {canTable && (
              <div role="group" aria-label={t('ui.charts.viewAs', 'View as')} className="inline-flex rounded-md border border-border p-0.5">
                {[[false, BarChart3, t('ui.charts.chartView', 'Chart')], [true, Table2, t('ui.charts.tableView', 'Table')]].map(([v, Icon, label]) => (
                  <button key={label} type="button" aria-pressed={asTable === v} title={label} aria-label={label} onClick={() => setAsTable(v)}
                    className={clsx('w-7 h-7 [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:h-9 inline-flex items-center justify-center rounded', asTable === v ? 'bg-bg text-ink' : 'text-ink-faint hover:text-ink')}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {asTable && canTable ? <ChartTable {...table} /> : children}
    </section>
  )
}

/** The chart's numbers as a plain table (ChartCard's Table view). */
export function ChartTable({ columns = [], rows = [] }) {
  return (
    <div className="overflow-x-auto max-h-72 overflow-y-auto scroll-thin -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {columns.map((c) => <th key={c.key} scope="col" className={clsx('px-2 py-1.5 font-semibold', c.align === 'right' ? 'text-end' : 'text-start')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={r.key ?? i}>
              {columns.map((c, j) => {
                const v = r[c.key]
                const Cell = j === 0 ? 'th' : 'td'
                return <Cell key={c.key} scope={j === 0 ? 'row' : undefined} className={clsx('px-2 py-1.5', j === 0 ? 'font-medium text-ink text-start' : 'text-ink-muted', c.align === 'right' && 'text-end font-mono-num tabular-nums')}>{c.format ? c.format(v, r) : v}</Cell>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
