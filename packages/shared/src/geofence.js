// Geofenced self attendance (ported from the hospital platform, packages/shared/src/hrms.js): attendance sites —
// a circle (centre + radius) or a drawn outline — on each campus, and whether a phone's location is inside one.
// Used for staff marking themselves in and out (My workspace) and students checking in from the student app.

export const GEOFENCE_MODES = [
  { value: 'OFF', label: 'Off — anywhere' },
  { value: 'WARN', label: 'Allow, but flag punches outside an attendance site' },
  { value: 'REQUIRED', label: 'Block — only within an attendance site' },
]

export const GEOFENCE_RESULTS = {
  INSIDE: { label: 'At the site', tone: 'success' },
  OUTSIDE: { label: 'Outside the site', tone: 'warning' },
  POOR_ACCURACY: { label: 'Location too rough', tone: 'warning' },
  NO_LOCATION: { label: 'No location', tone: 'warning' },
  NO_SITE: { label: 'No site set up', tone: 'neutral' },
}
export const GEOFENCE_DEFAULT_RADIUS_M = 200

/** Great-circle distance in metres between two { lat, lng } points (haversine). */
export function distanceMetres(a, b) {
  const R = 6371008.8
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The shape of an attendance site: a centre and radius, or a drawn outline. */
export const SITE_SHAPES = [
  { value: 'CIRCLE', label: 'Circle' },
  { value: 'POLYGON', label: 'Outline (polygon)' },
]
export const SITE_POLYGON_MAX_POINTS = 50

/** Metres east / north of `origin` (equirectangular — fine over a campus). */
function toXY(p, origin) {
  const R = 6371008.8
  const rad = (d) => (d * Math.PI) / 180
  return { x: rad(p.lng - origin.lng) * Math.cos(rad(origin.lat)) * R, y: rad(p.lat - origin.lat) * R }
}
const asPoint = (v) => (Array.isArray(v) ? { lat: Number(v[0]), lng: Number(v[1]) } : { lat: Number(v?.lat), lng: Number(v?.lng) })

/** Is the point inside the polygon ([[lat, lng], …], at least 3 corners)? Ray casting. */
export function pointInPolygon(point, polygon = []) {
  const pts = (polygon ?? []).map(asPoint).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (pts.length < 3) return false
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
  }
  return inside
}

/** Metres from the point to the polygon's nearest edge (0 when inside). */
export function distanceToPolygonM(point, polygon = []) {
  const pts = (polygon ?? []).map(asPoint)
  if (pts.length < 3) return Infinity
  if (pointInPolygon(point, polygon)) return 0
  const P = { x: 0, y: 0 }
  let best = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const A = toXY(pts[j], point)
    const B = toXY(pts[i], point)
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(A.x + t * dx, A.y + t * dy))
  }
  return best
}

/** The centre of a polygon's corners — where its marker and maps link point. */
export function polygonCentroid(polygon = []) {
  const pts = (polygon ?? []).map(asPoint).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (!pts.length) return null
  return { lat: pts.reduce((n, p) => n + p.lat, 0) / pts.length, lng: pts.reduce((n, p) => n + p.lng, 0) / pts.length }
}

/** Distance from a point to one site and whether it is inside (circle or polygon). */
export function siteDistance(point, site) {
  if (site.shape === 'POLYGON' && (site.polygon?.length ?? 0) >= 3) {
    const inside = pointInPolygon(point, site.polygon)
    return { distanceM: inside ? 0 : Math.round(distanceToPolygonM(point, site.polygon)), inside }
  }
  const distanceM = Math.round(distanceMetres(point, site))
  return { distanceM, inside: distanceM <= (site.radiusM || GEOFENCE_DEFAULT_RADIUS_M) }
}

/**
 * The best site for a point → { site, distanceM, inside } (null when there are no sites):
 * a site the point is inside wins, else the closest. A polygon's distance is to its edge.
 */
export function nearestSite(point, sites = []) {
  let best = null
  for (const s of sites) {
    const d = siteDistance(point, s)
    if (!best || (d.inside && !best.inside) || (d.inside === best.inside && d.distanceM < best.distanceM)) best = { site: s, ...d }
  }
  return best
}

/** "35 m" / "1.2 km". */
export const metresText = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`)

/** A link that opens the point in a maps app (no map library needed). */
export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`

/** Students checking in from the student app: off, log it (gate log only), or also mark present before "mark by". */
export const STUDENT_SELF_CHECKIN = [
  { value: 'OFF', label: 'Off — the class teacher marks attendance' },
  { value: 'LOG', label: 'Students check in on the campus; it goes to the gate log (the teacher still marks the register)' },
  { value: 'PRESENT', label: 'Students check in on the campus; a check-in before the “mark by” time marks them present' },
]
