// Parking (module `parking`): parking areas with a capacity, the vehicles of staff, students and parents with a
// parking pass (a QR sticker), and the gate — vehicles in and out, visitors' vehicles, how full each area is now.

/** `motor`: needs a licence (when the school asks for one) and is held back for younger students. */
export const PARKING_VEHICLE_KINDS = [
  { value: 'TWO_WHEELER', label: 'Two-wheeler', motor: true },
  { value: 'CAR', label: 'Car', motor: true },
  { value: 'CYCLE', label: 'Cycle', motor: false },
  { value: 'OTHER', label: 'Other', motor: true },
]
export const PARKING_VEHICLE_KIND_BY = Object.fromEntries(PARKING_VEHICLE_KINDS.map((k) => [k.value, k]))

/** Whose vehicle a pass is for. A visitor's vehicle has no pass; it is noted at the gate. */
export const PARKING_OWNERS = [
  { value: 'STAFF', label: 'Staff' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'GUARDIAN', label: 'Parent / guardian' },
]
/** Who parks at the gate: the pass holders, and visitors. */
export const PARKING_PARKERS = [...PARKING_OWNERS, { value: 'VISITOR', label: 'Visitor' }]

/** Who an area is for. */
export const PARKING_AREA_FOR = [
  { value: 'ANY', label: 'Everyone' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'STUDENT', label: 'Students' },
  { value: 'GUARDIAN', label: 'Parents' },
  { value: 'VISITOR', label: 'Visitors' },
]

/** A pass's state: REVOKED is saved; EXPIRED is read from its end date. */
export const PARKING_PASS_STATUS = [
  { value: 'ACTIVE', label: 'Valid', tone: 'success' },
  { value: 'EXPIRED', label: 'Expired', tone: 'warning' },
  { value: 'REVOKED', label: 'Cancelled', tone: 'neutral' },
]

/** "up 32 ab-1234" → "UP32AB1234": how plates are matched, whatever the spaces and dashes. */
export const plateKey = (plate) => String(plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** "up32ab1234" → "UP 32 AB 1234" when it reads like an Indian plate; otherwise as typed, in capitals. */
export function formatPlate(plate) {
  const k = plateKey(plate)
  const m = k.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/)
  if (m) return [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ')
  const bh = k.match(/^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/) // Bharat series: 22 BH 1234 AA
  if (bh) return bh.slice(1).join(' ')
  return String(plate ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
}

/** ACTIVE / EXPIRED / REVOKED on `today` (YYYY-MM-DD). */
export function passState(v, today) {
  if (v?.status === 'REVOKED') return 'REVOKED'
  return v?.validTo && today && v.validTo < today ? 'EXPIRED' : 'ACTIVE'
}

/** May this vehicle park in this area? (area.for and area.kinds — an empty list takes every kind) */
export function areaTakes(area, parker, kind) {
  if (!area || area.active === false) return false
  if (area.for && area.for !== 'ANY' && area.for !== parker) return false
  return !area.kinds?.length || area.kinds.includes(kind)
}

/** The class number of a class ("11", "Class 11 (UP)" → 11; Nursery, LKG → 0), for the student vehicle rule. */
export function classNumber(cls) {
  const m = String(cls?.code ?? '').match(/^\D*(\d{1,2})/) ?? String(cls?.name ?? '').match(/\b(\d{1,2})\b/)
  return m ? Number(m[1]) : 0
}

/** Area fill for a board: { inside, capacity, free, pct, full }. A capacity of 0 means no limit. */
export function areaFill(inside, capacity) {
  const cap = Number(capacity) || 0
  return { inside, capacity: cap, free: cap ? Math.max(0, cap - inside) : null, pct: cap ? Math.min(100, Math.round((inside / cap) * 100)) : 0, full: cap > 0 && inside >= cap }
}
