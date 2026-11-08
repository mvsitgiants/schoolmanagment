// Transport: routes and their stops, vehicles (and their papers), which students ride where, and the day's trips.
// A trip is one run of a route — the morning pickup or the afternoon drop. While it runs, the bus's position comes
// from the driver's phone (the driver page in the staff app) or a GPS device posting to the school's webhook; each
// position is checked against the stops to tell families the bus is near, and to mark the stops it reached.

export const VEHICLE_TYPES = [
  { value: 'BUS', label: 'Bus' },
  { value: 'MINI_BUS', label: 'Mini bus' },
  { value: 'VAN', label: 'Van' },
  { value: 'CAR', label: 'Car' },
  { value: 'AUTO', label: 'Auto-rickshaw' },
]

export const VEHICLE_STATUS = {
  ACTIVE: { label: 'On the road', tone: 'success' },
  MAINTENANCE: { label: 'In maintenance', tone: 'warning' },
  OFF_ROAD: { label: 'Off the road', tone: 'neutral' },
}

/** Papers a school vehicle must carry (state rules and the CBSE / state board safety norms). */
export const VEHICLE_DOCS = [
  { value: 'RC', label: 'Registration (RC)' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'FITNESS', label: 'Fitness certificate' },
  { value: 'PERMIT', label: 'Permit' },
  { value: 'PUC', label: 'Pollution (PUC)' },
  { value: 'SPEED_GOVERNOR', label: 'Speed governor certificate' },
]

/** A paper's state on a date: no expiry, valid, due within `warnDays`, or expired. */
export function docState(expiry, today, warnDays = 30) {
  if (!expiry) return 'NONE'
  if (expiry < today) return 'EXPIRED'
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5)
  return days <= warnDays ? 'DUE' : 'VALID'
}
export const DOC_STATES = {
  MISSING: { label: 'Not added', tone: 'warning' },
  NONE: { label: 'No expiry', tone: 'neutral' },
  VALID: { label: 'Valid', tone: 'success' },
  DUE: { label: 'Renew soon', tone: 'warning' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
}

/** Which way a student rides. */
export const RIDE_MODES = [
  { value: 'BOTH', label: 'Pickup and drop' },
  { value: 'PICKUP', label: 'Pickup only' },
  { value: 'DROP', label: 'Drop only' },
]

export const TRIP_KINDS = {
  PICKUP: { label: 'Morning pickup' },
  DROP: { label: 'Afternoon drop' },
}
export const TRIP_STATUS = {
  RUNNING: { label: 'Running', tone: 'success' },
  DONE: { label: 'Finished', tone: 'neutral' },
}
/** What the attendant marks for a student on a trip. */
export const RIDE_EVENTS = {
  BOARDED: { label: 'Got on' },
  DROPPED: { label: 'Got off' },
  ABSENT: { label: 'Not at the stop' },
}

// ───────────────────────────────────────────────────────── geometry

const R = 6371000
const rad = (d) => (d * Math.PI) / 180

/** Metres between two points ({ lat, lng }). */
export function distanceM(a, b) {
  if (!a || !b) return Infinity
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const isLatLng = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0)

/** Roughly how many minutes away, at the bus's speed (km/h) or a city average when it is standing. */
export function etaMinutes(metres, speedKmh) {
  const v = speedKmh > 5 ? speedKmh : 18
  return Math.max(1, Math.round(metres / ((v * 1000) / 60) * 1.3)) // roads are not straight lines
}

/**
 * What a new position means for a trip's stops: the ones now reached (within `arriveM`), and the ones the bus is
 * now near (within `nearM`) that haven't been told yet. `stops` in the order the trip visits them.
 */
export function stopProgress(position, stops, { reached = [], alerted = [] } = {}, { arriveM = 150, nearM = 1500 } = {}) {
  const done = new Set(reached.map(String))
  const told = new Set(alerted.map(String))
  const arrived = []
  const near = []
  for (const s of stops) {
    if (!isLatLng(s)) continue
    const d = distanceM(position, s)
    const id = String(s.id ?? s._id)
    if (!done.has(id) && d <= arriveM) arrived.push(id)
    if (!told.has(id) && !done.has(id) && d <= nearM && d > arriveM) near.push({ id, metres: Math.round(d) })
  }
  return { arrived, near }
}

/** The stops in the order a trip of this kind visits them: pickup towards school, drop away from it. */
export const stopsFor = (stops = [], kind) => {
  const ordered = [...stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return kind === 'DROP' ? ordered.reverse() : ordered
}

/** An OpenStreetMap embed around a point (or the box holding several points). */
export function osmEmbed(points = []) {
  const ok = points.filter(isLatLng)
  if (!ok.length) return null
  const lats = ok.map((p) => p.lat)
  const lngs = ok.map((p) => p.lng)
  const pad = ok.length === 1 ? 0.01 : 0.005
  const box = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad].map((n) => n.toFixed(5)).join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${ok[0].lat.toFixed(6)},${ok[0].lng.toFixed(6)}`
}
export const osmLink = (p) => (isLatLng(p) ? `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lng.toFixed(6)}#map=16/${p.lat.toFixed(6)}/${p.lng.toFixed(6)}` : null)
