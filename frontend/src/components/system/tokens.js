// Design tokens for the shop-floor / operations screen style, expressed against
// the existing Tailwind theme (teal `brand`, `surface`/`ink`/`border`, Sora
// display font). Import these instead of hand-picking hex or slate classes so
// every screen stays consistent.

/** Card / panel surface. Use on every white block. */
export const PANEL = 'ui-panel bg-surface border border-border rounded-xl shadow-card'

/** Full-bleed page wrapper. Full width, and NO own padding — edge spacing comes
 *  from the app shell's <main> (p-4), so every screen sits as tight to the edges
 *  as the Command Center. Vertical rhythm between bands is `gap-6`. */
export const PAGE = 'ui-page w-full flex flex-col gap-6 min-h-full bg-bg'

/** Semantic tones -> class fragments, shared by StatusPill, Badge-like chips, progress bars. */
export const TONE = {
  neutral: { text: 'text-ink-muted', bg: 'bg-black/5', border: 'border-border', dot: 'bg-ink-faint', fill: 'bg-ink-faint' },
  brand:   { text: 'text-brand-700', bg: 'bg-brand-50', border: 'border-brand-100', dot: 'bg-brand-500', fill: 'bg-brand-500' },
  success: { text: 'text-success-600', bg: 'bg-success-50', border: 'border-success-500/20', dot: 'bg-success-500', fill: 'bg-success-500' },
  warning: { text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-400/30', dot: 'bg-amber-400', fill: 'bg-amber-400' },
  danger:  { text: 'text-danger-600', bg: 'bg-danger-50', border: 'border-danger-500/20', dot: 'bg-danger-500', fill: 'bg-danger-500' },
  info:    { text: 'text-info-600', bg: 'bg-info-50', border: 'border-info-500/20', dot: 'bg-info-500', fill: 'bg-info-500' },
}

/** Map an arbitrary ERP status string to a tone. Extend as new statuses appear. */
export function statusTone(status) {
  const s = String(status ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  const map = {
    // generic lifecycle
    draft: 'neutral', new: 'neutral', open: 'info', scheduled: 'neutral',
    planned: 'neutral', pending: 'warning', pending_approval: 'warning',
    on_hold: 'warning', paused: 'warning', at_risk: 'warning', behind: 'danger',
    confirmed: 'info', in_progress: 'info', running: 'success', active: 'success',
    released: 'info', approved: 'success', enabled: 'success', on_track: 'success',
    completed: 'success', done: 'success', delivered: 'success', paid: 'success', grn_posted: 'success',
    closed: 'neutral', cancelled: 'danger', rejected: 'danger', failed: 'danger',
    overdue: 'danger', delayed: 'danger', blocked: 'danger', down: 'danger', maintenance: 'danger',
    idle: 'warning', ahead: 'info', shipped: 'brand', partial: 'warning', partial_grn: 'warning',
  }
  return map[s] || 'neutral'
}

/** Recharts styling — one palette + one look for every chart in the app. */
export const CHART = {
  // Categorical series — identity only (which doctor, which ward, billed vs collected). Taken in
  // this order, never cycled, never re-ordered by rank. Validated as a set (dataviz skill
  // validate_palette, light mode, white surface): lightness band, chroma, colour-blind (CVD)
  // separation ΔE ≥ 9 between neighbours, normal vision ΔE ≥ 19. Slots 3–5 are light on white,
  // so every chart carrying them shows labels / a legend and has a table view (ChartTable).
  // A 7th series is never a new colour: fold the tail into "Other" (foldSeries below).
  series: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#6250D6'],
  // Status — meaning only (good / warning / critical …), never "series 5". Always shown with a
  // label or icon beside it; the same steps as StatusPill / the success-warning-danger tokens.
  status: { good: '#1F9D66', warning: '#E2A63A', critical: '#D64545', info: '#3358D6', neutral: '#9AA1AE' },
  other: '#B8BDC7', // the folded "Other" slice / bar
  // a hairline, solid (never dashed), one step off the surface
  grid: '#E9EBEF',
  axisTick: { fontSize: 10, fill: '#5B616E' },
  tooltip: {
    borderRadius: '10px',
    border: '1px solid #E4E7EC',
    boxShadow: '0 4px 12px rgba(16,24,40,0.10)',
    fontSize: '12px',
  },
}

/**
 * Keep a breakdown to the palette's six slots: the biggest five keep their own colour, the rest
 * fold into one "Other" entry (a 7th colour would be a hue nobody can tell apart).
 * rows: [{ label, value }] (already sorted, biggest first). Returns rows with a `color` each.
 */
export function foldSeries(rows = [], otherLabel = 'Other', max = CHART.series.length) {
  const list = rows.filter((r) => Number(r.value) > 0)
  if (list.length <= max) return list.map((r, i) => ({ ...r, color: r.color ?? CHART.series[i] }))
  const head = list.slice(0, max - 1).map((r, i) => ({ ...r, color: r.color ?? CHART.series[i] }))
  const rest = list.slice(max - 1).reduce((s, r) => s + Number(r.value), 0)
  return [...head, { label: otherLabel, name: otherLabel, value: rest, color: CHART.other, other: true }]
}
