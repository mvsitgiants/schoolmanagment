import clsx from 'clsx'

/**
 * A single 100%-wide bar split into parts — good/rework/scrap, run/idle/breakdown,
 * delivered/ready/in-production. Says "what is this total made of" in one row,
 * where a donut would need its own card.
 *
 *   <StackedBar
 *     segments={[{ label: 'Good', value: 95, color: '#1F9D66' }, { label: 'Scrap', value: 5, color: '#D64545' }]}
 *     total={100} unit=" units"
 *   />
 *
 * `total` lets the bar show a shortfall: pass the planned figure and the segments
 * stop short of the end instead of being re-based to themselves.
 */
// a label inside a fill: white, but dark ink on the light fills (yellow / amber) where white can't be read
const inkOn = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return '#FFFFFF'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#12141C' : '#FFFFFF'
}

export default function StackedBar({
  segments = [], total, unit = '', height = 26, legend = true, format, className,
}) {
  const parts = segments.filter((s) => Number(s.value) > 0)
  const sum = parts.reduce((n, s) => n + Number(s.value || 0), 0)
  const base = Number(total) > 0 ? Number(total) : sum || 1
  const fmt = format || ((v) => `${v}${unit}`)
  const shortfall = Math.max(0, base - sum)

  return (
    <div className={clsx('min-w-0', className)}>
      {/* segments sit 2px apart on the surface — the gap separates them, never a border */}
      <div className="flex gap-[2px] rounded-md overflow-hidden" style={{ height }} role="img"
        aria-label={parts.map((s) => `${s.label}: ${fmt(s.value)}`).join(', ')}>
        {parts.map((s) => {
          const share = (Number(s.value) / base) * 100
          const text = fmt(s.value)
          // a label only when it fits with room to spare (≈ 7px a character); else the legend carries it
          const fits = share > 0 && (share / 100) * 320 > String(text).length * 7 + 12
          return (
            <div key={s.label} title={`${s.label}: ${text}`} style={{ width: `${share}%`, backgroundColor: s.color, color: inkOn(s.color) }}
              className="flex items-center justify-center text-[11px] font-semibold whitespace-nowrap min-w-[2px]">
              {fits ? text : ''}
            </div>
          )
        })}
        {shortfall > 0 && <div style={{ width: `${(shortfall / base) * 100}%` }} className="bg-black/5" />}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-muted">
          {parts.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="font-mono-num tabular-nums text-ink">{fmt(s.value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
