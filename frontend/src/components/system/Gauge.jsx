import { useId } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

/**
 * A half-circle gauge for a percentage with smooth gradient stroke,
 * decorative tick marks, target callout pip, and status tag.
 *
 *   <Gauge value={77.7} target={85} label="Typical discrete plant" />
 */
export default function Gauge({
  value = 0,
  target,
  label,
  color,
  good = 85,
  fair = 60,
  className,
}) {
  const { t } = useTranslation('ui')
  const gradId = useId().replace(/:/g, '_')
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  const W = 210, H = 125, cx = 105, cy = 105, r = 80, stroke = 15

  const point = (frac) => {
    const a = Math.PI + Math.PI * Math.max(0.0001, Math.min(1, frac))
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }

  const arc = (t0, t1) => {
    const [x0, y0] = point(t0), [x1, y1] = point(t1)
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
  }

  const toneColor = color || (v >= good ? '#10B981' : v >= fair ? '#F59E0B' : '#EF4444')
  const [tx, ty] = target != null ? point(target / 100) : []

  return (
    <div className={clsx('flex flex-col items-center justify-center p-2', className)}>
      <svg
        viewBox={`0 0 ${W} ${H + 8}`}
        className="w-full max-w-[220px] h-auto block overflow-visible"
        role="img"
        aria-label={`${label ? label + ': ' : ''}${target != null ? t('ui.charts.gaugeAriaTarget', { value: v.toFixed(1), target }) : t('ui.charts.gaugeAria', { value: v.toFixed(1) })}`}
      >
        <defs>
          <linearGradient id={`gauge-grad-${gradId}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor={toneColor} />
            <stop offset="100%" stopColor={toneColor} />
          </linearGradient>
          <filter id={`gauge-glow-${gradId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={toneColor} floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={arc(0, 1)}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={stroke}
          strokeLinecap="round"
        />

        {/* Value arc */}
        {v > 0 && (
          <path
            d={arc(0, v / 100)}
            fill="none"
            stroke={`url(#gauge-grad-${gradId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            filter={`url(#gauge-glow-${gradId})`}
            className="transition-all duration-700 ease-out"
          />
        )}

        {/* Target indicator */}
        {target != null && (
          <g>
            <circle cx={tx} cy={ty} r="5" fill="#0F172A" stroke="#FFFFFF" strokeWidth="2" className="drop-shadow" />
            <title>{t('ui.charts.target', { target })}</title>
          </g>
        )}

        {/* Center figures */}
        <text x={cx} y={cy - 10} textAnchor="middle" className="fill-ink font-mono-num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {v.toFixed(1)}%
        </text>
        {label && (
          <text x={cx} y={cy + 12} textAnchor="middle" className="fill-ink-muted" style={{ fontSize: 11, fontWeight: 500 }}>
            {label}
          </text>
        )}
      </svg>
    </div>
  )
}
