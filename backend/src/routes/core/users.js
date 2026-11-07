import { Router } from 'express'
import { User } from '../../models/tenant.js'
import { PASSWORD_RULE, isStrongPassword } from '../../platform/auth/tokens.js'
import { badRequest } from '../../platform/errors.js'
import { requirePermission } from '../../platform/middleware.js'
import { importUsers } from '../../services/coreImport.js'
import { email, mobile, objectId, optionalText, pageParams, z } from '../../platform/validate.js'
import {
  INVITE_DAYS, createUser, getUser, listUsers, resendInvite, resetUserPassword, revokeUserSessions, setUserActive, updateUser,
} from '../../services/users.js'
import { mailInvite } from '../../services/platformMail.js'
import { emailReady } from '../../services/platformSettings.js'
import { audit } from '../../platform/audit.js'

const router = Router()

const userSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(100),
  email,
  mobile: mobile.optional().or(z.literal('').transform(() => undefined)),
  designation: optionalText(80),
  roleIds: z.array(objectId).min(1, 'Give the user at least one role'),
  departmentIds: z.array(objectId).default([]),
  branchId: objectId.optional().nullable().or(z.literal('').transform(() => null)),
  sectionIds: z.array(objectId).default([]), // class sections a "My classes" data scope covers
  password: z.string().optional().or(z.literal('').transform(() => undefined)),
  mustChangePassword: z.boolean().optional(),
  invite: z.boolean().optional(), // email them a link to choose their own password
})

/** Email the invite link (after the save has committed) and keep the token out of the reply. */
function sendInvite(created, req) {
  const { inviteToken, ...rest } = created
  if (inviteToken) mailInvite(rest.user, inviteToken, { institution: req.auth.tenant.name, by: req.auth.user.name, days: INVITE_DAYS })
  return rest
}

// rows + dryRun; the real run answers with each new user's temporary password, once
router.post('/users/import', requirePermission('core.users.import'), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).max(5000), dryRun: z.boolean().default(true) }).parse(req.body)
  res.json({ data: await importUsers(rows, { dryRun, schema: userSchema.omit({ password: true, mustChangePassword: true, invite: true }) }, req.auth, req) })
})

router.get('/users', requirePermission('core.users.view'), async (req, res) => {
  res.json(await listUsers(req.query, pageParams(req.query)))
})

/** Small list for pickers (department head, owner fields). */
router.get('/users/lookup', requirePermission('core.users.view', 'core.departments.view'), async (req, res) => {
  const rows = await User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(500).lean()
  res.json({ data: rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation })) })
})

router.get('/users/:id', requirePermission('core.users.view'), async (req, res) => {
  res.json({ data: await getUser(req.params.id) })
})

router.post('/users', requirePermission('core.users.create'), async (req, res) => {
  // Adding the person to Staff & HR in the same save comes back with the HR module.
  const input = userSchema.parse(req.body)
  if (input.invite) {
    if (!await emailReady()) throw badRequest('The platform can’t send email yet. Give them a temporary password instead.')
    delete input.password
  }
  if (input.password && !isStrongPassword(input.password)) throw badRequest(PASSWORD_RULE, { fields: { password: PASSWORD_RULE } })
  res.status(201).json({ data: sendInvite(await createUser(input, req.auth), req) })
})

router.patch('/users/:id', requirePermission('core.users.edit'), async (req, res) => {
  const input = userSchema.omit({ password: true, mustChangePassword: true, invite: true }).partial().parse(req.body)
  res.json({ data: await updateUser(req.params.id, input, req.auth) })
})

router.post('/users/:id/activate', requirePermission('core.users.edit'), async (req, res) => {
  res.json({ data: await setUserActive(req.params.id, true, req.auth) })
})

router.post('/users/:id/deactivate', requirePermission('core.users.edit'), async (req, res) => {
  res.json({ data: await setUserActive(req.params.id, false, req.auth) })
})

router.post('/users/:id/invite', requirePermission('core.users.create'), async (req, res) => {
  if (!await emailReady()) throw badRequest('The platform can’t send email yet. Reset their password instead.')
  res.json({ data: sendInvite(await resendInvite(req.params.id, req.auth), req) })
})

router.post('/users/:id/reset-password', requirePermission('core.users.reset_password'), async (req, res) => {
  res.json({ data: await resetUserPassword(req.params.id, req.auth) })
})

router.post('/users/:id/revoke-sessions', requirePermission('core.users.revoke_sessions'), async (req, res) => {
  const user = await getUser(req.params.id)
  const n = await revokeUserSessions(req.params.id)
  await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: user.id, entityName: user.name, summary: `Signed ${user.name} out of ${n} device(s)` }, req)
  res.json({ data: { signedOut: n } })
})

export default router
