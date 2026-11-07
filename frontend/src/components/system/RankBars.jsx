import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

/**
 * A ranked "top N" in a card: one row per item with its label and value as text and
 * a thin bar for scale. For comparisons whose labels are too long for a bar axis
 * (classes, subjects, payment modes). Single series, so no legend; the title names it.
 *
 *   <RankBars title="Most absences" rows={[{ label: '8-A', value: 42 }]} valueFormat={(v) => v} />
 *
 * Optional `actions` sits at the header's end (e.g. a "Full report" link). `peak` fixes the bar
 * scale (100 for percentages) instead of scaling to the largest row.
 */
export default function RankBars({ title, subtitle, rows = [], valueFormat = (v) => v, color = 'rgb(var(--brand-500))', max = 8, peak: fixedPeak, empty, actions, className }) {
  const { t } = useTranslation('ui')
  const top = rows.slice(0, max)
  const peak = fixedPeak ?? Math.max(1, ...top.map((r) => Math.abs(Number(r.value) || 0)))
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
      {top.length === 0 ? <p className="py-6 text-center text-xs text-ink-faint">{empty ?? t('ui.rankBars.empty')}</p> : (
        <ol className="space-y-2.5">
          {top.map((r, i) => (
            <li key={r.key ?? r.label ?? i} title={`${r.label}: ${valueFormat(r.value)}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink truncate">{r.label}</span>
                <span className="text-ink-muted tabular-nums shrink-0">{valueFormat(r.value)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-black/5">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (Math.abs(Number(r.value) || 0) / peak) * 100)}%`, background: color }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
