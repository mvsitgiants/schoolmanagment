// Hostel: blocks (boys / girls / staff), floors, rooms and beds; which student sleeps in which bed (allotment), outpasses
// to leave the campus and come back, and the mess — a weekly menu and how many ate each meal.
//
// A bed is FREE, OCCUPIED (a student is allotted to it), RESERVED (held for someone) or BLOCKED (not in use).
// Only FREE / RESERVED / BLOCKED are stored on the bed; OCCUPIED comes from the active allotment.

export const BLOCK_KINDS = [
  { value: 'BOYS', label: 'Boys', tone: 'info' },
  { value: 'GIRLS', label: 'Girls', tone: 'pink' },
  { value: 'MIXED', label: 'Mixed', tone: 'violet' },
  { value: 'STAFF', label: 'Staff', tone: 'orange' },
]

export const ROOM_TYPES = [
  { value: 'SINGLE', label: 'Single', beds: 1 },
  { value: 'DOUBLE', label: 'Double', beds: 2 },
  { value: 'TRIPLE', label: 'Triple', beds: 3 },
  { value: 'QUAD', label: 'Four-bed', beds: 4 },
  { value: 'DORM', label: 'Dormitory', beds: 8 },
]

export const BED_STATES = {
  FREE: { label: 'Free', tone: 'success' },
  OCCUPIED: { label: 'Occupied', tone: 'brand' },
  RESERVED: { label: 'Reserved', tone: 'info' },
  BLOCKED: { label: 'Blocked', tone: 'neutral' },
}
/** States a warden can set on a bed by hand (OCCUPIED comes from an allotment). */
export const BED_MANUAL_STATES = ['FREE', 'RESERVED', 'BLOCKED']

export const CHECKOUT_REASONS = [
  { value: 'LEFT_HOSTEL', label: 'Left the hostel' },
  { value: 'YEAR_END', label: 'End of the year' },
  { value: 'LEFT_INSTITUTION', label: 'Left the institution' },
  { value: 'DISCIPLINE', label: 'Disciplinary' },
  { value: 'OTHER', label: 'Other' },
]

export const OUTPASS_KINDS = [
  { value: 'DAY', label: 'Day out' },
  { value: 'NIGHT', label: 'Overnight' },
  { value: 'HOME', label: 'Home leave' },
  { value: 'MEDICAL', label: 'Medical' },
]

export const OUTPASS_STATUS = {
  REQUESTED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  OUT: { label: 'Out', tone: 'violet' },
  RETURNED: { label: 'Back', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}
/** Outpasses still in play (the student is going or gone). */
export const OUTPASS_OPEN = ['REQUESTED', 'APPROVED', 'OUT']

export const ESCORT_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN', 'RELATIVE', 'OTHER']

export const MEALS = [
  { value: 'BREAKFAST', label: 'Breakfast', time: '07:30' },
  { value: 'LUNCH', label: 'Lunch', time: '12:45' },
  { value: 'SNACKS', label: 'Snacks', time: '16:30' },
  { value: 'DINNER', label: 'Dinner', time: '19:30' },
]
export const MESS_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** Code defaults for Settings › Hostel (merged under whatever the institution saved). */
export const HOSTEL_DEFAULTS = { lateGraceMinutes: 30, familyOutpass: true, alertOutpass: true }

/** Bed labels for a room: A, B, C … (AA, AB … past 26). */
export function bedLabels(n) {
  const out = []
  for (let i = 0; i < Math.max(0, Math.floor(Number(n) || 0)); i++) {
    out.push(i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)))
  }
  return out
}

/** A bed's code as printed on a door: "B-204-A" (block code, room number, bed label). */
export const bedCode = (blockCode, roomNo, label) => [blockCode, roomNo, label].filter(Boolean).join('-')

/** Day of the week of a YYYY-MM-DD date: MON … SUN. */
export function weekDayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay()
  return MESS_DAYS[(d + 6) % 7]
}

/** Minutes late coming back (0 when on time), from ISO instants or Dates. */
export function lateMinutes(returnBy, inAt, graceMinutes = 0) {
  if (!returnBy || !inAt) return 0
  const m = Math.floor((new Date(inAt).getTime() - new Date(returnBy).getTime()) / 60000)
  return m > graceMinutes ? m : 0
}

/** Occupancy as a whole percentage of beds in use (blocked beds don't count). */
export function occupancyPct({ occupied = 0, total = 0, blocked = 0 } = {}) {
  const usable = total - blocked
  return usable > 0 ? Math.round((occupied / usable) * 100) : 0
}
