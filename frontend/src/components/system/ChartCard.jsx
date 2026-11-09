import { useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { BarChart3, Table2 } from 'lucide-react'
import { PANEL } from './tokens'

/**
 * Modern card shell for charts: title, subtitle, header controls,
 * and a sleek segmented Chart / Table view switcher.
 */
export default function ChartCard({ title, subtitle, icon: Icon, actions, table, className, children }) {
  const { t } = useTranslation('ui')
  const [asTable, setAsTable] = useState(false)
  const canTable = !!table?.rows?.length

  return (
    <section className={clsx(PANEL, 'p-5 flex flex-col min-w-0 transition-shadow', className)} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions || canTable) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="font-display text-base font-semibold text-ink tracking-tight">{title}</h3>}
              {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2.5 shrink-0">
            {actions}
            {canTable && (
              <div role="group" aria-label={t('ui.charts.viewAs', 'View as')} className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/60 shadow-inner">
                {[
                  [false, BarChart3, t('ui.charts.chartView', 'Chart')],
                  [true, Table2, t('ui.charts.tableView', 'Table')],
                ].map(([v, SwitchIcon, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={asTable === v}
                    title={label}
                    aria-label={label}
                    onClick={() => setAsTable(v)}
                    className={clsx(
                      'px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1.5 rounded-md transition-all duration-150',
                      asTable === v
                        ? 'bg-surface text-ink font-semibold shadow-sm'
                        : 'text-ink-muted hover:text-ink hover:bg-surface/50'
                    )}
                  >
                    <SwitchIcon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
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
    <div className="overflow-x-auto max-h-72 overflow-y-auto scroll-thin -mx-1 border border-border/80 rounded-xl">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 sticky top-0 z-10 border-b border-border/80">
          <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={clsx('px-3 py-2 font-semibold', c.align === 'right' ? 'text-end' : 'text-start')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 bg-surface">
          {rows.map((r, i) => (
            <tr key={r.key ?? i} className="hover:bg-slate-50/50 transition-colors">
              {columns.map((c, j) => {
                const v = r[c.key]
                const Cell = j === 0 ? 'th' : 'td'
                return (
                  <Cell
                    key={c.key}
                    scope={j === 0 ? 'row' : undefined}
                    className={clsx(
                      'px-3 py-2',
                      j === 0 ? 'font-medium text-ink text-start' : 'text-ink-muted',
                      c.align === 'right' && 'text-end font-mono-num tabular-nums font-medium'
                    )}
                  >
                    {c.format ? c.format(v, r) : v}
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
