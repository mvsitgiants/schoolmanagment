import { Router } from 'express'
import { ADMIN_ROLE_NAME, MODULES, allPermissions, visiblePages } from '@schoolgiant/shared'
import { Tenant } from '../../models/platform.js'
import { Department, Role, User } from '../../models/tenant.js'
import { bumpAccessVersion } from '../../platform/access.js'
import { audit, diffFields } from '../../platform/audit.js'
import { requirePermission } from '../../platform/middleware.js'
import { optionalText, z } from '../../platform/validate.js'
import { conflict } from '../../platform/errors.js'
import { recordEvent, subscriptionSummary } from '../../services/subscription.js'

const router = Router()

const PROFILE_FIELDS = ['legalName', 'email', 'phone', 'website', 'addressLine', 'city', 'state', 'pincode', 'country', 'gstin', 'pan', 'registrationNo', 'nabhNo', 'hfrId', 'logoUrl', 'primaryColor', 'sidebarColor', 'timezone', 'currency', 'dateFormat']

const shape = (t) => ({ id: String(t._id), name: t.name, slug: t.slug, ...(t.profile ?? {}), verification: t.verification?.at ? { at: t.verification.at } : null })

// what the platform checked when it verified the institution: changing any of them needs a fresh check
const VERIFIED_FIELDS = ['name', 'legalName', 'gstin', 'pan', 'registrationNo', 'hfrId']

// Every signed-in user reads branding and formats (logo, colours, date format).
router.get('/settings', async (req, res) => {
  const t = await Tenant.findById(req.auth.tenantId).lean()
  res.json({ data: shape(t) })
})

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0E7C86').optional().or(z.literal('').transform(() => undefined))
// A logo is either a link (https://…) or an image uploaded from the profile page, stored inline as a data URL so it
// shows everywhere without a sign-in (prints/PDFs, patient portal, public pages). SVG is not accepted (it can carry script).
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const logo = z.union([
  optionalText(500).refine((v) => !v || /^(https?:\/\/|\/)/i.test(v), 'Enter a web address (https://…) or upload an image'),
  z.string().max(400_000, 'The logo image is too large — use one under 300 KB').regex(LOGO_DATA_URL, 'Upload a PNG, JPG or WebP image'),
])
const auditValue = (v) => (typeof v === 'string' && v.startsWith('data:') ? '(uploaded image)' : v)

const settingsSchema = z.object({
  name: z.string().trim().min(2, 'Enter the institution name').max(120).optional(),
  legalName: optionalText(160), email: optionalText(120), phone: optionalText(30), website: optionalText(160),
  addressLine: optionalText(250), city: optionalText(80), state: optionalText(80), pincode: optionalText(12), country: optionalText(60),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN has 15 letters/digits').optional().or(z.literal('').transform(() => undefined)),
  pan: optionalText(10), registrationNo: optionalText(60), nabhNo: optionalText(60), hfrId: optionalText(60),
  logoUrl: logo, primaryColor: hex, sidebarColor: hex,
  timezone: optionalText(60), currency: optionalText(3), dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
})

router.patch('/settings', requirePermission('core.profile.edit'), async (req, res) => {
  const input = settingsSchema.parse(req.body)
  const tenant = await Tenant.findById(req.auth.tenantId)
  const before = { name: tenant.name, ...(tenant.toObject().profile ?? {}) }
  before.logoUrl = auditValue(before.logoUrl)
  if (input.name) tenant.name = input.name
  // A GSTIN or ABDM facility (HFR) ID belongs to one institution on the platform — the same institution
  // signing up again (a second free trial) shows up here.
  for (const [field, label] of [['gstin', 'GSTIN'], ['hfrId', 'ABDM facility (HFR) ID']]) {
    const v = input[field]
    if (v && v !== tenant.profile?.[field] && await Tenant.exists({ _id: { $ne: tenant._id }, [`profile.${field}`]: v })) {
      throw conflict(`Another institution on the platform already uses this ${label}. If it is yours, contact support to join the two accounts.`, { fields: { [field]: 'Already registered' } })
    }
  }
  for (const f of PROFILE_FIELDS) if (f in input) tenant.profile[f] = input[f]
  const after = { name: tenant.name, ...(tenant.toObject().profile ?? {}) }
  const unverified = tenant.verification?.at && VERIFIED_FIELDS.some((f) => (before[f] ?? '') !== (after[f] ?? ''))
  if (unverified) tenant.verification = undefined
  await tenant.save()
  if (unverified) await recordEvent(tenant._id, 'VERIFICATION_REMOVED', { note: 'The institution changed its legal details' })
  after.logoUrl = auditValue(after.logoUrl) // the audit log keeps "(uploaded image)", not the image itself
  const changes = diffFields(before, after, ['name', ...PROFILE_FIELDS])
  if (changes.length) {
    await audit({ action: 'UPDATE', module: 'core', entityType: 'tenant', entityId: String(tenant._id), entityName: tenant.name, summary: `Updated institution profile (${changes.map((c) => c.field).join(', ')})`, changes }, req)
    await bumpAccessVersion(tenant._id) // branding is part of /auth/me
  }
  res.json({ data: shape(tenant.toObject()) })
})

/** Setup hub checklist + the "Institution Admin can open N pages" card. */
router.get('/setup', requirePermission('core.setup.view'), async (req, res) => {
  const t = req.auth.tenant
  const [departments, roles, users, adminRole] = await Promise.all([
    Department.countDocuments({ active: true }),
    Role.countDocuments(),
    User.countDocuments({ active: true }),
    Role.findOne({ system: true }).lean(),
  ])
  const p = t.profile ?? {}
  const sub = await subscriptionSummary(t)
  const steps = [
    { id: 'profile', title: 'Institution profile', hint: 'Address, contact numbers and registration details used on every print.', path: '/core/profile', done: !!(p.addressLine && p.city && p.phone) },
    { id: 'branding', title: 'Logo & colours', hint: 'Your logo and brand colour across the app and printouts.', path: '/core/profile', done: !!(p.logoUrl || p.primaryColor) },
    { id: 'departments', title: 'Departments', hint: 'Clinical and support departments with specialities.', path: '/core/departments', done: departments >= 3, count: departments },
    { id: 'roles', title: 'Team & roles', hint: 'Decide what each role can see and do. Start from recommended roles.', path: '/core/setup#roles', done: roles >= 2, count: roles },
    { id: 'users', title: 'Invite your staff', hint: 'Create logins and give each person a role.', path: '/core/users', done: users >= 2, count: users },
    { id: 'subscription', title: 'Choose a plan', hint: 'Pick the plan that fits and keep the workspace running after the trial.', path: '/core/subscription', done: sub.status === 'ACTIVE' },
  ]
  const adminPages = visiblePages(allPermissions(req.auth.enabledModules), req.auth.enabledModules)
  res.json({
    data: {
      steps,
      done: steps.filter((s) => s.done).length,
      total: steps.length,
      admin: {
        roleId: adminRole ? String(adminRole._id) : null,
        roleName: adminRole?.name ?? ADMIN_ROLE_NAME,
        moduleCount: adminPages.length,
        pageCount: adminPages.reduce((n, g) => n + g.pages.length, 0),
        actionCount: allPermissions(req.auth.enabledModules).length,
        totalModules: MODULES.length,
      },
    },
  })
})

export default router
