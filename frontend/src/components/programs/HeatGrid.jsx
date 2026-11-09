import clsx from 'clsx'

/**
 * A heat-map grid: rows × columns of 0–3 values (CO–PO correlation, attainment levels). Darker = stronger.
 * With `onCell`, a cell is a button (the Outcomes screen cycles 0 → 1 → 2 → 3 → 0).
 *
 *   <HeatGrid rows={[{ key: 'CO1', label: 'CO1', hint: 'Prepare final accounts' }]} columns={[{ key: 'PO1', label: 'PO1', hint }]}
 *     value={(r, c) => level} onCell={(r, c) => …} format={(v) => v || ''} />
 */
const SHADE = [
  'bg-black/[0.03] text-ink-faint',
  'bg-brand-500/15 text-brand-700',
  'bg-brand-500/45 text-brand-900',
  'bg-brand-600 text-white',
]
export const heatShade = (v, max = 3) => {
  if (v === null || v === undefined || v === '') return 'bg-black/[0.02] text-ink-faint'
  const i = Math.max(0, Math.min(3, Math.round((Number(v) / max) * 3 * 100) / 100))
  return SHADE[i >= 2.5 ? 3 : i >= 1.5 ? 2 : i > 0 ? 1 : 0]
}

export default function HeatGrid({ rows = [], columns = [], value, onCell, format = (v) => v ?? '—', max = 3, rowHeader, footer, className }) {
  const cols = `minmax(120px, 1.4fr) repeat(${columns.length}, minmax(44px, 1fr))${footer ? ' minmax(56px, 0.8fr)' : ''}`
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <div className="grid gap-1 min-w-max" style={{ gridTemplateColumns: cols }} role="grid">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{rowHeader}</div>
        {columns.map((c) => (
          <div key={c.key} title={c.hint} className="px-1 py-1.5 text-center text-[11px] font-semibold text-ink-muted">{c.label}</div>
        ))}
        {footer && <div className="px-1 py-1.5 text-center text-[11px] font-semibold text-ink-muted">{footer.label}</div>}
        {rows.map((r) => (
          <div key={r.key} className="contents" role="row">
            <div className="px-2 py-1.5 min-w-0" title={r.hint}>
              <p className="text-sm font-semibold text-ink truncate">{r.label}</p>
              {r.sub && <p className="text-[11px] text-ink-faint truncate">{r.sub}</p>}
            </div>
            {columns.map((c) => {
              const v = value(r, c)
              const Cell = onCell ? 'button' : 'div'
              return (
                <Cell key={c.key} type={onCell ? 'button' : undefined} onClick={onCell ? () => onCell(r, c, v) : undefined}
                  aria-label={`${r.label} · ${c.label}: ${v ?? '—'}`}
                  className={clsx('flex min-h-[36px] items-center justify-center rounded-md text-sm font-semibold tabular-nums transition-colors', heatShade(v, max), onCell && 'cursor-pointer hover:ring-2 hover:ring-brand-300')}>
                  {format(v)}
                </Cell>
              )
            })}
            {footer && <div className={clsx('flex min-h-[36px] items-center justify-center rounded-md border border-border text-sm font-semibold tabular-nums', heatShade(footer.value(r), max))}>{footer.format ? footer.format(footer.value(r)) : footer.value(r) ?? '—'}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The legend under a heat grid: one swatch per level. */
export function HeatLegend({ items = [] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
      {items.map((it, i) => (
        <span key={it} className="inline-flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded', SHADE[i])} />{it}</span>
      ))}
    </div>
  )
}

/** A 0–3 level as a small coloured figure (attainment tables). */
export function LevelValue({ value, max = 3 }) {
  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>
  return <span className={clsx('inline-flex min-w-[40px] justify-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums', heatShade(value, max))}>{value}</span>
}
