import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

/**
 * A half-circle gauge for a percentage — OEE, utilisation, on-time delivery.
 *
 * Pure SVG on a 0–100 scale, coloured by how the value compares with `good`/`fair`
 * (or a fixed `color`), with an optional target pip on the arc.
 *
 *   <Gauge value={77.7} target={85} label="Typical discrete plant" />
 */
export default function Gauge({
  value = 0, target, label, color,
  good = 85, fair = 60,
  className,
}) {
  const { t } = useTranslation('ui')
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  const W = 200, H = 118, cx = 100, cy = 100, r = 78, stroke = 16
  const point = (frac) => {
    const a = Math.PI + Math.PI * Math.max(0.0001, Math.min(1, frac))
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const arc = (t0, t1) => {
    const [x0, y0] = point(t0), [x1, y1] = point(t1)
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
  }
  const tone = color || (v >= good ? '#1F9D66' : v >= fair ? '#E2A63A' : '#D64545')
  const [tx, ty] = target != null ? point(target / 100) : []

  return (
    <svg viewBox={`0 0 ${W} ${H + 6}`} className={clsx('w-full h-auto block', className)}
      role="img" aria-label={`${label ? label + ': ' : ''}${target != null ? t('ui.charts.gaugeAriaTarget', { value: v.toFixed(1), target }) : t('ui.charts.gaugeAria', { value: v.toFixed(1) })}`}>
      <path d={arc(0, 1)} fill="none" stroke="currentColor" className="text-black/10" strokeWidth={stroke} strokeLinecap="round" />
      <path d={arc(0, v / 100)} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" />
      {target != null && (
        <>
          <circle cx={tx} cy={ty} r="4.5" fill="#18222E" />
          <title>{t('ui.charts.target', { target })}</title>
        </>
      )}
      <text x={cx} y={cy - 8} textAnchor="middle" className="fill-ink" style={{ fontSize: 26, fontWeight: 700 }}>{v.toFixed(1)}%</text>
      {label && <text x={cx} y={cy + 12} textAnchor="middle" className="fill-ink-muted" style={{ fontSize: 11 }}>{label}</text>}
    </svg>
  )
}
