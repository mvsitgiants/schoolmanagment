// Analytics: pure helpers shared by the API and the web app (management dashboards over the
// data the other modules store). Money is integer paise; dates are YYYY-MM-DD strings.

/** Share of `part` in `whole` as a percentage with one decimal; null when there is no whole. */
export function pctOf(part, whole) {
  const w = Number(whole) || 0
  if (!w) return null
  return Math.round(((Number(part) || 0) / w) * 1000) / 10
}

/** Mean of the finite numbers in a list, one decimal; null for an empty list. */
export function meanOf(values = []) {
  const list = values.map(Number).filter(Number.isFinite)
  if (!list.length) return null
  return Math.round((list.reduce((n, v) => n + v, 0) / list.length) * 10) / 10
}

/** Whole days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetweenYmd(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

/** Ageing of overdue fees, by days past the due date (Fee collection › Ageing of dues). */
export const AGEING_BUCKETS = [
  { key: 'D0_30', min: 0, max: 30, tone: 'warning' },
  { key: 'D31_60', min: 31, max: 60, tone: 'orange' },
  { key: 'D61_90', min: 61, max: 90, tone: 'danger' },
  { key: 'D90_PLUS', min: 91, max: Infinity, tone: 'danger' },
]

/** The ageing bucket key for an amount that fell due on `dueDate`, as of `today`; null when not yet overdue. */
export function ageingBucket(dueDate, today) {
  if (!dueDate || dueDate >= today) return null
  const days = daysBetweenYmd(dueDate, today)
  return AGEING_BUCKETS.find((b) => days >= b.min && days <= b.max)?.key ?? AGEING_BUCKETS[AGEING_BUCKETS.length - 1].key
}

/** Attendance bands for "attendance vs result" (Academic performance). */
export const ATTENDANCE_BANDS = [
  { key: 'A90', min: 90, max: 100, tone: 'success' },
  { key: 'A75', min: 75, max: 89.99, tone: 'info' },
  { key: 'A60', min: 60, max: 74.99, tone: 'warning' },
  { key: 'A0', min: 0, max: 59.99, tone: 'danger' },
]

/** The band key for an attendance %; null when the student has no attendance taken. */
export function attendanceBand(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return null
  const n = Number(pct)
  return ATTENDANCE_BANDS.find((b) => n >= b.min)?.key ?? 'A0'
}

/** Default thresholds for "students at risk" (Academic performance). */
export const AT_RISK_DEFAULT_PCT = 40

/** Every calendar month touched by a date range, as YYYY-MM (at most 36). */
export function monthsInRange(from, to) {
  const out = []
  if (!from || !to || from > to) return out
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const endKey = to.slice(0, 7)
  while (out.length < 36) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key >= endKey) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/** The period of the same length just before from–to (for "vs previous period"). */
export function priorRange(from, to) {
  const days = daysBetweenYmd(from, to) + 1
  const end = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10)
  return { from: start, to: end }
}

/** from–to cut into at most `max` back-to-back pieces of whole days (for sparklines). */
export function splitRange(from, to, max = 12) {
  const days = daysBetweenYmd(from, to) + 1
  if (days < 1) return []
  const n = Math.min(max, days)
  const out = []
  const at = (i) => new Date(Date.parse(`${from}T00:00:00Z`) + Math.round((i * days) / n) * 86400000).toISOString().slice(0, 10)
  for (let i = 0; i < n; i++) {
    const end = new Date(Date.parse(`${at(i + 1)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    out.push({ from: at(i), to: end })
  }
  return out
}

/** % change from `prev` to `value` (null when there is nothing to compare with). */
export const deltaPct = (value, prev) => (prev ? Math.round(((value - prev) / Math.abs(prev)) * 1000) / 10 : null)
