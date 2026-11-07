// Student attendance: the marks a teacher gives and how they count. Shared by the API and the web app.

/**
 * `weight` is how much of a day the mark counts as present; `excused` marks are kept apart in
 * reports (approved leave is not a "bunk", but it is not a day attended either).
 */
export const ATTENDANCE_MARKS = [
  { value: 'P', label: 'Present', short: 'P', tone: 'success', weight: 1 },
  { value: 'A', label: 'Absent', short: 'A', tone: 'danger', weight: 0 },
  { value: 'L', label: 'Late', short: 'L', tone: 'warning', weight: 1 },
  { value: 'HD', label: 'Half day', short: 'H', tone: 'info', weight: 0.5 },
  { value: 'LV', label: 'On leave', short: 'Lv', tone: 'neutral', weight: 0, excused: true },
]
export const MARK_BY = Object.fromEntries(ATTENDANCE_MARKS.map((m) => [m.value, m]))
export const MARK_VALUES = ATTENDANCE_MARKS.map((m) => m.value)

export const LEAVE_STATUS = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

/** Counts of each mark in a list of entries: { P, A, L, HD, LV, total }. */
export function countMarks(entries = []) {
  const out = { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 }
  for (const e of entries) {
    if (!MARK_BY[e.status]) continue
    out[e.status]++
    out.total++
  }
  return out
}

/** Attendance % from counts: days attended (late = present, half day = ½) over days marked. Null with no days. */
export function attendancePct(c) {
  if (!c?.total) return null
  const attended = (c.P ?? 0) + (c.L ?? 0) + 0.5 * (c.HD ?? 0)
  return Math.round((attended / c.total) * 1000) / 10
}

/** Every date from `from` to `to` (YYYY-MM-DD, inclusive). */
export function daysBetween(from, to) {
  const out = []
  let d = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  while (d <= end && out.length < 400) {
    out.push(new Date(d).toISOString().slice(0, 10))
    d += 864e5
  }
  return out
}

/** The working-day code ('MON' …) of a date, matching the core.workingDays setting. */
export const weekdayCode = (ymd) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(`${ymd}T12:00:00Z`).getUTCDay()]

/** First and last day of a month 'YYYY-MM'. */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}
