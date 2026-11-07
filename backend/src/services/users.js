import { randomBytes, randomInt } from 'node:crypto'
import { FULL_ACCESS, hasPermissionIn } from '@schoolgiant/shared'
import { Branch, Department, Role, User } from '../models/tenant.js'
import { bumpAccessVersion } from '../platform/access.js'
import { audit, diffFields, diffLists } from '../platform/audit.js'
import { hashPassword, hashToken } from '../platform/auth/tokens.js'
import { clearFailedLogins } from '../platform/auth/lockout.js'
import { clean } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { endSessions } from '../platform/middleware.js'
import { getContext, runAsTenant } from '../platform/context.js'
import { listResponse, searchFilter } from '../platform/validate.js'
import { assertFullAdminRemains } from './roles.js'
import { assertWithinLimit } from './subscription.js'

// No look-alikes (0/O, 1/l/I), so it can be read out or copied from a slip without mistakes.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGIT = '23456789'
const pick = (set) => set[randomInt(set.length)]

/**
 * Temporary password, e.g. "Hk7p-9qRt-Mw2z": 12 random characters (≈ 66 bits). The old
 * word-number-word form had ~20 bits — guessable at the login form. Valid for TEMP_PASSWORD_HOURS.
 */
export function tempPassword() {
  const all = UPPER + LOWER + DIGIT
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), ...Array.from({ length: 9 }, () => pick(all))]
  for (let i = chars.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]] }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}
export const TEMP_PASSWORD_HOURS = 72
const tempExpiry = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000)

/** Invite by email: a one-time link (only its hash is kept) to choose a password. */
export const INVITE_DAYS = 3
function newInvite() {
  const token = randomBytes(32).toString('base64url')
  return { token, fields: { inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) } }
}

async function rolesById(ids) {
  const roles = await Role.find({ _id: { $in: ids } }).lean()
  if (roles.length !== new Set(ids.map(String)).size) throw badRequest('One of the selected roles no longer exists.')
  return roles
}

/** You can't hand out (or take away) a role that carries permissions you don't hold. */
function assertCanAssign(auth, roles) {
  if (auth.fullAccess) return
  for (const r of roles) {
    if (r.fullAccess) throw forbidden(`Only a full-access administrator can assign "${r.name}".`)
    const missing = r.permissions.filter((k) => !hasPermissionIn(auth.permissions, k))
    if (missing.length) throw forbidden(`"${r.name}" has permissions you don't hold, so you can't assign or remove it.`)
  }
}

/** Non-admins can't manage a user who can do more than they can. */
async function assertCanManage(auth, target) {
  if (auth.fullAccess) return
  const roles = await Role.find({ _id: { $in: target.roleIds } }).lean()
  const above = roles.some((r) => r.fullAccess || r.permissions.some((k) => !hasPermissionIn(auth.permissions, k)))
  if (above) throw forbidden('This user has more access than you, so only an administrator can change them.')
}

async function present(users) {
  const roleIds = [...new Set(users.flatMap((u) => u.roleIds.map(String)))]
  const deptIds = [...new Set(users.flatMap((u) => (u.departmentIds ?? []).map(String)))]
  const branchIds = [...new Set(users.map((u) => u.branchId && String(u.branchId)).filter(Boolean))]
  const [roles, depts, branches] = await Promise.all([
    Role.find({ _id: { $in: roleIds } }).select('name fullAccess system').lean(),
    Department.find({ _id: { $in: deptIds } }).select('name').lean(),
    Branch.find({ _id: { $in: branchIds } }).select('name').lean(),
  ])
  const rm = new Map(roles.map((r) => [String(r._id), r]))
  const dm = new Map(depts.map((d) => [String(d._id), d.name]))
  const bm = new Map(branches.map((b) => [String(b._id), b.name]))
  return users.map((u) => ({
    ...clean(u),
    roles: u.roleIds.map((id) => rm.get(String(id))).filter(Boolean).map((r) => ({ id: String(r._id), name: r.name, fullAccess: r.fullAccess, system: r.system })),
    fullAccess: u.roleIds.some((id) => rm.get(String(id))?.fullAccess),
    departments: (u.departmentIds ?? []).map((id) => ({ id: String(id), name: dm.get(String(id)) })).filter((d) => d.name),
    branchName: u.branchId ? bm.get(String(u.branchId)) : null,
    invited: !!u.inviteTokenHash, // invite sent, password not chosen yet
    emailVerified: !!u.emailVerifiedAt,
  }))
}

export async function listUsers(q, paging) {
  const filter = { ...searchFilter(paging.search, ['name', 'email', 'mobile', 'designation']) }
  if (q.roleId) filter.roleIds = q.roleId
  if (q.departmentId) filter.departmentIds = q.departmentId
  if (q.status === 'active') filter.active = true
  if (q.status === 'inactive') filter.active = false
  const [rows, total, activeCount, inactiveCount] = await Promise.all([
    User.find(filter).sort({ active: -1, name: 1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    User.countDocuments(filter),
    User.countDocuments({ active: true }),
    User.countDocuments({ active: false }),
  ])
  const res = listResponse(await present(rows), total, paging)
  res.meta.counts = { active: activeCount, inactive: inactiveCount }
  return res
}

export async function getUser(id) {
  const user = await User.findById(id).lean()
  if (!user) throw notFound('User')
  return (await present([user]))[0]
}

export async function createUser(input, auth) {
  await assertWithinLimit(auth.tenantId, 'users', 1)
  if (await User.exists({ email: input.email })) throw conflict('A user with this email already exists.', { fields: { email: 'Already in use' } })
  const roles = await rolesById(input.roleIds)
  assertCanAssign(auth, roles)
  // invite: they choose the password from the emailed link (until then an unknowable one);
  // otherwise the admin's password, or a temporary one
  const invite = input.invite ? newInvite() : null
  const generated = input.password || invite ? null : tempPassword()
  const user = await User.create({
    name: input.name, email: input.email, mobile: input.mobile, designation: input.designation,
    roleIds: input.roleIds, departmentIds: input.departmentIds ?? [], branchId: input.branchId || undefined,
    sectionIds: input.sectionIds ?? [],
    passwordHash: await hashPassword(invite ? randomBytes(24).toString('base64url') : input.password || generated),
    mustChangePassword: !!generated || (!invite && !!input.mustChangePassword),
    tempPasswordExpiresAt: generated ? tempExpiry() : undefined, // an admin-chosen password doesn't expire
    ...invite?.fields,
  })
  await audit({ action: 'CREATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary: `Added user ${user.name} (${roles.map((r) => r.name).join(', ')})`, added: roles.map((r) => r.name) })
  await bumpAccessVersion(auth.tenantId)
  return { user: await getUser(user._id), tempPassword: generated, inviteToken: invite?.token }
}

/** A new invite link for someone who hasn't chosen a password yet (the old link stops working). */
export async function resendInvite(id, auth) {
  const user = await User.findById(id)
  if (!user) throw notFound('User')
  await assertCanManage(auth, user)
  if (!user.active) throw conflict('This user is deactivated. Re-activate them first.')
  if (user.lastLoginAt && !user.inviteTokenHash) throw conflict(`${user.name} has already signed in. Reset their password instead.`)
  const invite = newInvite()
  Object.assign(user, invite.fields)
  await user.save()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary: `Sent ${user.name} a new invite` })
  return { user: await getUser(user._id), inviteToken: invite.token }
}

export async function updateUser(id, input, auth) {
  const user = await User.findById(id)
  if (!user) throw notFound('User')
  await assertCanManage(auth, user)
  const self = String(user._id) === String(auth.userId)
  const before = user.toObject()

  if (input.email && input.email !== user.email && await User.exists({ email: input.email, _id: { $ne: user._id } })) {
    throw conflict('A user with this email already exists.', { fields: { email: 'Already in use' } })
  }
  let roleDiff = { added: [], removed: [] }
  if (input.roleIds) {
    roleDiff = diffLists(user.roleIds, input.roleIds)
    if (roleDiff.added.length || roleDiff.removed.length) {
      if (self) throw forbidden("You can't change your own roles. Ask another administrator.")
      assertCanAssign(auth, await rolesById([...roleDiff.added, ...roleDiff.removed]))
      await assertFullAdminRemains({ user: { id: String(user._id), active: user.active, roleIds: input.roleIds } })
      user.roleIds = input.roleIds
    }
  }
  if (input.email && input.email !== user.email) user.emailVerifiedAt = undefined // the new address isn't proven yet
  for (const f of ['name', 'email', 'mobile', 'designation']) if (input[f] !== undefined) user[f] = input[f]
  if (input.departmentIds) user.departmentIds = input.departmentIds
  if (input.branchId !== undefined) user.branchId = input.branchId || undefined
  if (input.sectionIds) user.sectionIds = input.sectionIds
  await user.save()

  const changes = diffFields(before, user.toObject(), ['name', 'email', 'mobile', 'designation', 'branchId'])
  const roleNames = async (ids) => (await Role.find({ _id: { $in: ids } }).select('name').lean()).map((r) => r.name)
  if (changes.length || roleDiff.added.length || roleDiff.removed.length) {
    await audit({
      action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name,
      summary: roleDiff.added.length || roleDiff.removed.length ? `Changed roles of ${user.name}` : `Updated ${user.name}`,
      changes, added: await roleNames(roleDiff.added), removed: await roleNames(roleDiff.removed),
    })
    await bumpAccessVersion(auth.tenantId)
  }
  return getUser(user._id)
}

export const revokeUserSessions = (userId, reason = 'ADMIN_REVOKED') => endSessions({ userId }, reason)

export async function setUserActive(id, active, auth) {
  const user = await User.findById(id)
  if (!user) throw notFound('User')
  if (String(user._id) === String(auth.userId)) throw forbidden("You can't deactivate your own account.")
  await assertCanManage(auth, user)
  if (user.active === active) return getUser(user._id)
  if (active) await assertWithinLimit(auth.tenantId, 'users', 1)
  else await assertFullAdminRemains({ dropUserId: user._id })
  user.active = active
  await user.save()
  if (!active) await revokeUserSessions(user._id, 'USER_DEACTIVATED')
  await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary: `${active ? 'Re-activated' : 'Deactivated'} ${user.name}`, changes: [{ field: 'active', from: !active, to: active }] })
  await bumpAccessVersion(auth.tenantId)
  return getUser(user._id)
}

export async function resetUserPassword(id, auth) {
  const user = await User.findById(id)
  if (!user) throw notFound('User')
  await assertCanManage(auth, user)
  const password = tempPassword()
  user.passwordHash = await hashPassword(password)
  user.mustChangePassword = true
  user.tempPasswordExpiresAt = tempExpiry()
  user.inviteTokenHash = undefined // a pending invite link stops working
  user.inviteExpiresAt = undefined
  await user.save()
  await revokeUserSessions(user._id, 'ADMIN_PASSWORD_RESET')
  await clearFailedLogins(user.email) // "ask your administrator to reset your password" ends a lockout
  await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary: `Reset the password of ${user.name}` })
  return { tempPassword: password }
}

/** Users who hold full access — used by the Setup hub card. */
export const isFullAccessRole = (r) => r.fullAccess || r.permissions?.includes(FULL_ACCESS)

/**
 * Mark the email a VERIFY_EMAIL code or link was sent for as confirmed (platform/auth/codes.js).
 * Refused when the user's email has changed since, so an old link can't confirm a new address.
 */
export async function confirmEmailFrom(challenge, req) {
  return runAsTenant(challenge.tenantId, async () => {
    const user = await User.findById(challenge.userId).lean()
    if (!user?.active || user.email !== challenge.email) throw badRequest('This was sent for a different email address. Send yourself a new one from your Account page.')
    if (!user.emailVerifiedAt) {
      await User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } })
      await bumpAccessVersion(challenge.tenantId)
      Object.assign(getContext(), { userId: String(user._id), userName: user.name })
      await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary: `${user.name} confirmed their email address` }, req)
    }
    return user
  })
}
