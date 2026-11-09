import { GEOFENCE_DEFAULT_RADIUS_M, SITE_POLYGON_MAX_POINTS, metresText, polygonCentroid } from '@schoolgiant/shared'
import { Branch } from '../models/tenant.js'
import { audit, diffFields } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { notFound } from '../platform/errors.js'
import { objectId, z } from '../platform/validate.js'

// Attendance sites — where staff may mark their own attendance (Settings › Staff & HR / Attendance ›
// geofence). They live on the branch (Branch.attendanceSites) and are edited from Core ›
// Branches or from Attendance › Setup › Sites & geofence. A site is a circle (centre +
// radius) or a drawn outline (POLYGON, 3+ corners). Whether a punch is inside is only ever
// worked out on the server (hrmsAttendance geofenceCheck, shared nearestSite).

const lat = z.coerce.number().min(-90, 'Latitude is −90 to 90').max(90, 'Latitude is −90 to 90')
const lng = z.coerce.number().min(-180, 'Longitude is −180 to 180').max(180, 'Longitude is −180 to 180')
const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6

/** One site as sent by either screen (whitelisted). */
export const attendanceSiteInput = z.object({
  id: objectId.optional().or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(1, 'Name the site').max(60),
  shape: z.enum(['CIRCLE', 'POLYGON']).default('CIRCLE'),
  lat: lat.optional().or(z.literal('').transform(() => undefined)),
  lng: lng.optional().or(z.literal('').transform(() => undefined)),
  radiusM: z.coerce.number().int().min(20, 'At least 20 m').max(5000, 'At most 5 km').default(GEOFENCE_DEFAULT_RADIUS_M),
  polygon: z.array(z.tuple([lat, lng])).max(SITE_POLYGON_MAX_POINTS, `Up to ${SITE_POLYGON_MAX_POINTS} corners`).optional(),
  active: z.boolean().default(true),
}).superRefine((x, ctx) => {
  if (x.shape === 'POLYGON') {
    if ((x.polygon?.length ?? 0) < 3) ctx.addIssue({ code: 'custom', message: 'Mark at least 3 corners', path: ['polygon'] })
  } else {
    if (x.lat === undefined) ctx.addIssue({ code: 'custom', message: 'Enter the latitude', path: ['lat'] })
    if (x.lng === undefined) ctx.addIssue({ code: 'custom', message: 'Enter the longitude', path: ['lng'] })
    if (x.lat === 0 && x.lng === 0) ctx.addIssue({ code: 'custom', message: 'Enter the site’s coordinates', path: ['lat'] })
  }
})
export const attendanceSitesInput = z.array(attendanceSiteInput).max(10, 'Up to 10 sites per branch')

/** Sites as stored: each keeps its id across edits (punches remember which site they matched). */
export const sitesIn = (list) => list?.map(({ id, ...x }) => {
  const base = { ...(id ? { _id: id } : {}), name: x.name, shape: x.shape, active: x.active }
  if (x.shape === 'POLYGON') {
    const polygon = x.polygon.map(([a, b]) => [round6(a), round6(b)])
    const c = polygonCentroid(polygon)
    return { ...base, polygon, lat: round6(c.lat), lng: round6(c.lng), radiusM: undefined }
  }
  return { ...base, lat: round6(x.lat), lng: round6(x.lng), radiusM: x.radiusM, polygon: undefined }
})

/** One line per site for the audit trail. */
export const sitesText = (list) => (list ?? []).map((x) => (x.shape === 'POLYGON'
  ? `${x.name} outline of ${x.polygon?.length ?? 0} corners${x.active === false ? ' (off)' : ''}`
  : `${x.name} ${x.lat},${x.lng} r${x.radiusM}${x.active === false ? ' (off)' : ''}`)).join('; ')

const siteOut = (x) => ({
  id: String(x._id), name: x.name, shape: x.shape ?? 'CIRCLE', lat: x.lat, lng: x.lng,
  radiusM: x.shape === 'POLYGON' ? null : x.radiusM ?? GEOFENCE_DEFAULT_RADIUS_M, polygon: x.shape === 'POLYGON' ? x.polygon ?? [] : null,
  active: x.active !== false,
})

/** Every active branch with its attendance sites (Attendance › Setup › Sites & geofence). */
export async function listAttendanceSites() {
  const branches = await Branch.find({ active: true }).select('name code isDefault attendanceSites').sort({ isDefault: -1, name: 1 }).lean()
  return branches.map((b) => ({
    branchId: String(b._id), branchName: b.name, code: b.code, isDefault: !!b.isDefault,
    sites: (b.attendanceSites ?? []).map(siteOut),
    summary: (b.attendanceSites ?? []).filter((x) => x.active !== false).map((x) => (x.shape === 'POLYGON' ? `${x.name} · outline` : `${x.name} · ${metresText(x.radiusM)}`)),
  }))
}

/** Replace a branch's attendance sites (HR, with hrms.attendance.edit). */
export async function saveAttendanceSites(branchId, sites, req) {
  const branch = isOid(branchId) ? await Branch.findById(branchId) : null
  if (!branch) throw notFound('Branch')
  const before = sitesText(branch.toObject().attendanceSites)
  branch.attendanceSites = sitesIn(sites)
  await branch.save()
  const after = sitesText(branch.toObject().attendanceSites)
  const changes = diffFields({ attendanceSites: before }, { attendanceSites: after }, ['attendanceSites'])
  if (changes.length) await audit({ action: 'UPDATE', module: 'core', entityType: 'branch', entityId: String(branch._id), entityName: branch.name, summary: `Attendance sites of ${branch.name}: ${after || 'none'}`, changes }, req)
  return (await listAttendanceSites()).find((b) => b.branchId === String(branch._id)) ?? null
}
