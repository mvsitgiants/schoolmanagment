import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { PANEL } from './tokens'

function DonutTooltip({ active, payload, valueFormat }) {
  if (!active || !payload || !payload.length) return null
  const entry = payload[0]
  return (
    <div className="chart-tooltip-glass px-3 py-2 text-xs text-ink min-w-[120px] z-50">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.payload?.color }} />
        <span className="font-semibold text-ink-muted text-[11px] truncate">{entry.name}</span>
      </div>
      <div className="font-mono-num font-bold text-ink tabular-nums text-sm">
        {valueFormat ? valueFormat(entry.value) : entry.value}
      </div>
    </div>
  )
}

/**
 * An elevated breakdown donut with centered total, segment hover expansion,
 * and an interactive legend with progress bars.
 */
export default function BreakdownDonut({
  title,
  subtitle,
  segments = [],
  centerLabel,
  centerValue,
  footer,
  actions,
  valueFormat = (v) => v,
  empty,
  stacked = false,
  className,
}) {
  const { t } = useTranslation('ui')
  const [activeIdx, setActiveIdx] = useState(null)

  const clean = segments.filter((s) => s && Number.isFinite(Number(s.value)))
  const total = clean.reduce((sum, s) => sum + Number(s.value), 0)
  const data = total === 0 ? [{ name: 'empty', value: 1, color: '#E2E8F0' }] : clean
  const ring = stacked ? { box: 'h-44 w-44', inner: 60, outer: 80 } : { box: 'h-32 w-32', inner: 44, outer: 60 }

  const hoveredItem = activeIdx != null && clean[activeIdx] ? clean[activeIdx] : null

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
      <div className={clsx('flex items-center gap-6', stacked && 'flex-1 flex-col md:flex-row lg:flex-col justify-center')}>
        <div className={clsx('relative shrink-0 flex items-center justify-center', ring.box)}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={ring.inner}
                outerRadius={ring.outer}
                paddingAngle={total === 0 ? 0 : 3}
                dataKey="value"
                stroke="none"
                isAnimationActive={true}
                animationDuration={800}
                onMouseEnter={(_, idx) => total > 0 && setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.color}
                    className="transition-transform duration-200 cursor-pointer"
                    style={{
                      transform: activeIdx === i ? 'scale(1.04)' : 'scale(1)',
                      transformOrigin: 'center center',
                      filter: activeIdx === i ? 'drop-shadow(0 4px 8px rgba(0,0,0,0.15))' : 'none',
                    }}
                  />
                ))}
              </Pie>
              {total > 0 && <Tooltip content={<DonutTooltip valueFormat={valueFormat} />} />}
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
            <span
              className={clsx(
                'font-bold text-ink font-mono-num tabular-nums leading-none tracking-tight transition-all duration-200',
                stacked ? 'text-2xl' : 'text-xl'
              )}
            >
              {hoveredItem ? valueFormat(hoveredItem.value) : centerValue ?? total}
            </span>
            <span className="text-[10px] font-semibold text-ink-muted mt-1 uppercase tracking-wider truncate max-w-[80px]">
              {hoveredItem ? hoveredItem.name : centerLabel ?? t('ui.charts.total')}
            </span>
          </div>
        </div>
        <div className={clsx('flex-1 min-w-0 flex flex-col gap-2.5', stacked && 'w-full')}>
          {clean.length === 0 && (
            <p className={clsx('text-xs text-ink-faint py-4', stacked && 'text-center')}>{empty ?? t('ui.charts.noData')}</p>
          )}
          {clean.map((s, idx) => {
            const pct = total ? Math.round((s.value / total) * 100) : 0
            const isHovered = activeIdx === idx
            return (
              <div
                key={s.name}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
                className={clsx(
                  'group flex flex-col gap-1 p-1.5 rounded-lg transition-colors cursor-pointer',
                  isHovered ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                )}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-2 min-w-0 text-ink-muted">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm transition-transform group-hover:scale-125"
                      style={{ background: s.color }}
                    />
                    <span className="truncate font-medium text-ink">{s.name}</span>
                  </span>
                  <span className="shrink-0 font-mono-num tabular-nums text-ink font-semibold flex items-center gap-1.5">
                    {valueFormat(s.value)}
                    <span className="text-[11px] font-medium text-ink-faint bg-slate-100 px-1.5 py-0.5 rounded">
                      {pct}%
                    </span>
                  </span>
                </div>
                <div className="w-full h-1 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: s.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {footer && <div className="mt-4 pt-3 border-t border-border/80">{footer}</div>}
    </div>
  )
}
