import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { PANEL } from './tokens'

const RANK_BADGES = [
  'bg-amber-100 text-amber-800 border-amber-300 font-bold',
  'bg-slate-200 text-slate-800 border-slate-300 font-bold',
  'bg-amber-50 text-amber-900 border-amber-200 font-bold',
]

/**
 * A ranked "top N" list in an elevated card with rank badges,
 * smooth gradient scale bars, and interactive hover feedback.
 */
export default function RankBars({
  title,
  subtitle,
  rows = [],
  valueFormat = (v) => v,
  color = 'rgb(var(--brand-500))',
  max = 8,
  peak: fixedPeak,
  empty,
  actions,
  className,
}) {
  const { t } = useTranslation('ui')
  const top = rows.slice(0, max)
  const peak = fixedPeak ?? Math.max(1, ...top.map((r) => Math.abs(Number(r.value) || 0)))

  return (
    <div className={clsx(PANEL, 'p-5 flex flex-col min-w-0 transition-shadow', className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="font-display text-base font-semibold text-ink tracking-tight">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      {top.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-xs text-ink-faint gap-1">
          <span className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">📊</span>
          <span>{empty ?? t('ui.rankBars.empty')}</span>
        </div>
      ) : (
        <ol className="space-y-3">
          {top.map((r, i) => {
            const val = Math.abs(Number(r.value) || 0)
            const pct = Math.round((val / peak) * 100)
            const badgeClass = RANK_BADGES[i] || 'bg-slate-100 text-slate-600 border-slate-200'

            return (
              <li
                key={r.key ?? r.label ?? i}
                title={`${r.label}: ${valueFormat(r.value)}`}
                className="group flex flex-col gap-1.5 p-1.5 rounded-lg hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={clsx('w-5 h-5 rounded-md border flex items-center justify-center text-[10px] shrink-0 font-mono-num', badgeClass)}>
                      {i + 1}
                    </span>
                    <span className="text-ink font-medium truncate">{r.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-ink font-semibold font-mono-num tabular-nums text-xs sm:text-sm">
                      {valueFormat(r.value)}
                    </span>
                    <span className="text-[10px] font-medium text-ink-faint bg-slate-100 px-1.5 py-0.5 rounded">
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 group-hover:brightness-110"
                    style={{
                      width: `${Math.max(3, pct)}%`,
                      backgroundColor: r.color || color,
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
