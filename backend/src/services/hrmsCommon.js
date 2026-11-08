import { FULL_ACCESS } from '@schoolgiant/shared'
import { Employee, Holiday } from '../models/hrms.js'
import { Role, User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { isOid, oid } from '../platform/db.js'
import { AppError, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'

// Helpers every Staff & HR service uses (ported from the hospital's hrmsCommon.js).

export const stamp = (auth) => ({ by: auth?.user?.name ?? 'System', byId: auth?.userId && isOid(auth.userId) ? auth.userId : undefined, at: new Date() })
export const hrSettings = () => getSettings('hrms')
export const todayYmd = async () => (await institutionNow()).date
export const idStr = (v) => (v ? String(v) : null)

/** Staff the caller may see, by their Staff & HR data scope (OWN · DEPARTMENT · BRANCH · ALL). */
export function employeeScope(auth) {
  if (!auth) return {}
  const scope = scopeOf(auth, 'hrms')
  const u = auth.user ?? {}
  if (scope === 'ALL') return {}
  if (scope === 'OWN') return { userId: isOid(auth.userId) ? oid(auth.userId) : null }
  if (scope === 'DEPARTMENT') return { departmentId: { $in: (u.departmentIds ?? []).map(oid) } }
  return u.branchId ? { branchId: { $in: [oid(u.branchId), null] } } : {}
}

/** Ids of the staff in scope, or null when the caller sees everyone. */
export async function scopedEmployeeIds(auth) {
  const filter = employeeScope(auth)
  if (!Object.keys(filter).length) return null
  return (await Employee.find(filter).select('_id').lean()).map((e) => e._id)
}

/** `{ employeeId: … }` for collections keyed by employee, kept to the caller's scope. */
export async function employeeIdFilter(auth, employeeId) {
  const ids = await scopedEmployeeIds(auth)
  if (employeeId) {
    if (!isOid(employeeId) || (ids && !ids.some((x) => String(x) === String(employeeId)))) return { employeeId: oid('000000000000000000000000') }
    return { employeeId: oid(employeeId) }
  }
  return ids ? { employeeId: { $in: ids } } : {}
}

export async function findEmployee(id, auth, { select, lean = false } = {}) {
  if (!isOid(id)) throw notFound('Staff record')
  let q = Employee.findOne({ _id: id, ...employeeScope(auth) })
  if (select) q = q.select(select)
  const e = lean ? await q.lean() : await q
  if (!e) throw notFound('Staff record')
  return e
}

/** The signed-in user's own staff record (self-service). */
export async function myEmployee(auth, { lean = true } = {}) {
  // never { userId: null } — that matches every staff record without a login
  if (!isOid(auth?.userId)) throw new AppError(403, 'My workspace is for a signed-in member of staff.')
  const q = Employee.findOne({ userId: auth.userId })
  const e = lean ? await q.lean() : await q
  if (!e) throw new AppError(404, 'Your login is not linked to a staff record yet. Ask HR to link it.', { code: 'NO_EMPLOYEE' })
  return e
}

export const employeeSnap = (e) => ({ employeeId: e._id, employeeName: e.name, employeeCode: e.employeeCode, departmentId: e.departmentId, branchId: e.branchId, userId: e.userId })

/** Active users whose role holds `perm` (or full access when nobody does). */
export async function usersWith(perm, { fallbackToAdmins = true } = {}) {
  let roles = await Role.find({ permissions: perm }).select('_id').lean()
  if (!roles.length && fallbackToAdmins) roles = await Role.find({ $or: [{ fullAccess: true }, { permissions: FULL_ACCESS }] }).select('_id').lean()
  const users = await User.find({ active: true, roleIds: { $in: roles.map((r) => r._id) } }).select('_id').lean()
  return users.map((u) => String(u._id))
}

/** Is the person on the staff on `date` (joined, not yet left)? */
export const employedOn = (e, date) => (!e.joiningDate || e.joiningDate <= date) && (!e.exit?.lastWorkingDate || date <= e.exit.lastWorkingDate)

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const dowOf = (ymd) => DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()]

/**
 * A person's day off: their weekly off (or the institution's), the nth Saturdays off, or a holiday for their campus.
 * → null | { kind: 'WEEKLY_OFF' | 'HOLIDAY', name }
 */
export function dayOffFor(e, date, { settings, holidays }) {
  const h = holidays.find((x) => x.date === date && !x.optional && (!x.branchIds?.length || x.branchIds.some((b) => String(b) === String(e.branchId))))
  if (h) return { kind: 'HOLIDAY', name: h.name }
  const day = dowOf(date)
  if ((e.weeklyOffDays?.length ? e.weeklyOffDays : settings.weeklyOffDays ?? ['SUN']).includes(day)) return { kind: 'WEEKLY_OFF' }
  if (day === 'SAT' && (settings.saturdaysOff ?? []).includes(String(Math.ceil(Number(date.slice(8)) / 7)))) return { kind: 'WEEKLY_OFF' }
  return null
}

/** Holidays between two dates (inclusive). */
export const holidaysBetween = (from, to) => Holiday.find({ date: { $gte: from, $lte: to } }).lean()

/** The off days (weekly offs, Saturdays off, holidays) of a person between two dates — for counting leave. */
export async function offDatesFor(e, from, to, settings) {
  const holidays = await holidaysBetween(from, to)
  const out = []
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10)
    if (dayOffFor(e, d, { settings, holidays })) out.push(d)
  }
  return out
}

export const monthDays = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}
