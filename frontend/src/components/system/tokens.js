// Design tokens for the shop-floor / operations screen style, expressed against
// the existing Tailwind theme (teal `brand`, `surface`/`ink`/`border`, Sora
// display font). Import these instead of hand-picking hex or slate classes so
// every screen stays consistent.

/** Card / panel surface. Use on every white block. */
export const PANEL = 'ui-panel bg-surface border border-border/80 rounded-2xl shadow-card'

/** Full-bleed page wrapper. Full width, and NO own padding — edge spacing comes
 *  from the app shell's <main> (p-4), so every screen sits as tight to the edges
 *  as the Command Center. Vertical rhythm between bands is `gap-6`. */
export const PAGE = 'ui-page w-full flex flex-col gap-6 min-h-full bg-bg'

/** Semantic tones -> class fragments, shared by StatusPill, Badge-like chips, progress bars. */
export const TONE = {
  neutral: { text: 'text-ink-muted', bg: 'bg-black/5', border: 'border-border', dot: 'bg-ink-faint', fill: 'bg-ink-faint', glow: 'shadow-sm' },
  brand:   { text: 'text-brand-700', bg: 'bg-brand-50', border: 'border-brand-200', dot: 'bg-brand-500', fill: 'bg-brand-500', glow: 'shadow-glow-brand' },
  success: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', fill: 'bg-emerald-500', glow: 'shadow-glow-success' },
  warning: { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', fill: 'bg-amber-500', glow: 'shadow-glow-amber' },
  danger:  { text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200', dot: 'bg-rose-500', fill: 'bg-rose-500', glow: 'shadow-glow-danger' },
  info:    { text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', fill: 'bg-blue-500', glow: 'shadow-glow-info' },
  // decorative accents — no meaning, just colour, for counts and categories that are neither good nor bad
  violet:  { text: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500', fill: 'bg-violet-500', glow: 'shadow-sm' },
  pink:    { text: 'text-pink-700', bg: 'bg-pink-50', border: 'border-pink-200', dot: 'bg-pink-500', fill: 'bg-pink-500', glow: 'shadow-sm' },
  sky:     { text: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200', dot: 'bg-sky-500', fill: 'bg-sky-500', glow: 'shadow-sm' },
  orange:  { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500', fill: 'bg-orange-500', glow: 'shadow-sm' },
  teal:    { text: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200', dot: 'bg-teal-500', fill: 'bg-teal-500', glow: 'shadow-sm' },
}

/** The decorative tones in the order a row of tiles cycles through them. */
export const ACCENTS = ['brand', 'violet', 'info', 'pink', 'orange', 'sky', 'teal']

/** The same name always gets the same accent (a class, a department, a route), so it reads the same on every screen. */
export function hueTone(name) {
  let h = 0
  for (const c of String(name ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
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

/** Recharts styling — vibrant, accessible palette + modern glassmorphism tooltip. */
export const CHART = {
  series: ['#0284C7', '#6366F1', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'],
  status: { good: '#10B981', warning: '#F59E0B', critical: '#EF4444', info: '#3B82F6', neutral: '#94A3B8' },
  other: '#94A3B8',
  grid: '#EDF0F5',
  axisTick: { fontSize: 11, fill: '#64748B', fontWeight: 500 },
  tooltip: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: '12px',
    border: '1px solid rgba(228, 231, 236, 0.9)',
    boxShadow: '0 12px 28px -4px rgba(16, 24, 40, 0.12), 0 4px 10px -2px rgba(16, 24, 40, 0.04)',
    fontSize: '12px',
    padding: '8px 12px',
    color: '#0F172A',
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
