import clsx from 'clsx'

// a label inside a fill: white, but dark ink on the light fills (yellow / amber) where white can't be read
const inkOn = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return '#FFFFFF'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#12141C' : '#FFFFFF'
}

/**
 * A single 100%-wide bar split into parts with modern rounded caps,
 * subtle gaps, and interactive legend with percentages.
 */
export default function StackedBar({
  segments = [],
  total,
  unit = '',
  height = 24,
  legend = true,
  format,
  className,
}) {
  const parts = segments.filter((s) => Number(s.value) > 0)
  const sum = parts.reduce((n, s) => n + Number(s.value || 0), 0)
  const base = Number(total) > 0 ? Number(total) : sum || 1
  const fmt = format || ((v) => `${v}${unit}`)
  const shortfall = Math.max(0, base - sum)

  return (
    <div className={clsx('min-w-0', className)}>
      <div
        className="flex gap-1 rounded-xl overflow-hidden p-0.5 bg-slate-100/90 shadow-inner"
        style={{ height }}
        role="img"
        aria-label={parts.map((s) => `${s.label}: ${fmt(s.value)}`).join(', ')}
      >
        {parts.map((s) => {
          const share = (Number(s.value) / base) * 100
          const text = fmt(s.value)
          const fits = share > 0 && (share / 100) * 320 > String(text).length * 7 + 12
          return (
            <div
              key={s.label}
              title={`${s.label}: ${text}`}
              style={{ width: `${share}%`, backgroundColor: s.color, color: inkOn(s.color) }}
              className="flex items-center justify-center text-[11px] font-bold whitespace-nowrap min-w-[3px] rounded-lg shadow-sm transition-all hover:brightness-110"
            >
              {fits ? text : ''}
            </div>
          )
        })}
        {shortfall > 0 && (
          <div
            style={{ width: `${(shortfall / base) * 100}%` }}
            className="bg-slate-200/50 rounded-lg"
            title={`Remaining: ${fmt(shortfall)}`}
          />
        )}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-xs text-ink-muted">
          {parts.map((s) => {
            const pct = Math.round((Number(s.value) / base) * 100)
            return (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block shadow-sm" style={{ backgroundColor: s.color }} />
                <span className="text-ink font-medium">{s.label}</span>
                <span className="font-mono-num tabular-nums text-ink font-semibold">{fmt(s.value)}</span>
                <span className="text-[10px] text-ink-faint font-medium bg-slate-100 px-1 py-0.2 rounded">{pct}%</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
