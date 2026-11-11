import { Router } from 'express'
import { LIMIT_KEYS, MODULES, PLATFORM_ROLES, closeOverDependencies, normalizePermissions, platformCan } from '@schoolgiant/shared'
import {
  DiscountCode, Plan, PlatformAuditLog, PlatformUser, RoleTemplate, SubscriptionEvent, SubscriptionInvoice, TENANT_STATUSES, Tenant,
} from '../models/platform.js'
import { Role, User } from '../models/tenant.js'
import { bumpAccessVersion } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { PASSWORD_RULE, hashPassword, isStrongPassword } from '../platform/auth/tokens.js'
import { runAsSystem, runAsTenant } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { authenticate, endSessions, requirePlatform, requireSuperadmin } from '../platform/middleware.js'
import { clearFailedLogins } from '../platform/auth/lockout.js'
import { tempPassword } from '../services/users.js'
import { platformAudit } from '../services/platformAudit.js'
import { email, escapeRegex, mobile, optionalText, pageParams, listResponse, searchFilter, z } from '../platform/validate.js'
import { applyPlanModuleChange, listTenantModules, saveModuleOverrides } from '../services/modules.js'
import { provisionTenant } from '../services/provisioning.js'
import { getPlatformSettings, platformSettingsView, savePlatformSettings } from '../services/platformSettings.js'
import { sendPlatformTestSms } from '../services/codeDelivery.js'
import { mailPaymentLink, mailWelcome, sendTestEmail } from '../services/platformMail.js'
import { paymentLinkFor } from '../services/platformPayments.js'
import { publicBaseUrl } from '../services/integrationsCommon.js'
import {
  BLOCKED_STATUSES, changePlan, effectiveStatus, recordEvent, recordPayment, runBillingCycle, subscriptionSummary, usageFor,
} from '../services/subscription.js'

const router = Router()
router.use(authenticate, requireSuperadmin, platformAudit)

const DAY = 864e5
const monthlyValue = (plan, cycle) => (!plan ? 0 : cycle === 'YEARLY' ? Math.round(plan.priceYearly / 12) : plan.priceMonthly)

// ───────────────────────────────────────────────────────── dashboard

router.get('/dashboard', async (req, res) => {
  const now = new Date()
  const [tenants, plans, dueInvoices, paidRecent] = await Promise.all([
    Tenant.find().lean(),
    Plan.find().lean(),
    SubscriptionInvoice.find({ status: 'DUE' }).lean(),
    SubscriptionInvoice.find({ status: 'PAID', paidAt: { $gte: new Date(+now - 30 * DAY) } }).lean(),
  ])
  const planBy = new Map(plans.map((p) => [p.code, p]))
  const withStatus = tenants.map((t) => ({ ...t, eff: effectiveStatus(t, now) }))
  const byStatus = Object.fromEntries(['TRIAL', 'ACTIVE', 'PAST_DUE', 'TRIAL_EXPIRED', 'SUSPENDED', 'CANCELLED'].map((s) => [s, 0]))
  for (const t of withStatus) byStatus[t.eff] = (byStatus[t.eff] ?? 0) + 1
  const paying = withStatus.filter((t) => ['ACTIVE', 'PAST_DUE'].includes(t.eff))
  const mrr = paying.reduce((n, t) => n + monthlyValue(planBy.get(t.planCode), t.billingCycle), 0)
  const byPlan = plans.sort((a, b) => a.sortOrder - b.sortOrder).map((p) => ({
    code: p.code, name: p.name,
    tenants: withStatus.filter((t) => t.planCode === p.code && t.eff !== 'CANCELLED').length,
    paying: paying.filter((t) => t.planCode === p.code).length,
    mrr: paying.filter((t) => t.planCode === p.code).reduce((n, t) => n + monthlyValue(p, t.billingCycle), 0),
  }))
  // sign-ups per week, last 12 weeks
  const weeks = []
  for (let i = 11; i >= 0; i--) {
    const start = new Date(+now - (i + 1) * 7 * DAY)
    const end = new Date(+now - i * 7 * DAY)
    weeks.push({ label: start.toISOString().slice(5, 10), signups: tenants.filter((t) => t.createdAt >= start && t.createdAt < end).length })
  }
  const trialsEnding = withStatus
    .filter((t) => t.eff === 'TRIAL' && t.trialEndsAt && +t.trialEndsAt - +now < 7 * DAY)
    .sort((a, b) => a.trialEndsAt - b.trialEndsAt)
    .map((t) => ({ id: String(t._id), name: t.name, planCode: t.planCode, trialEndsAt: t.trialEndsAt }))
  const attention = withStatus
    .filter((t) => ['PAST_DUE', 'SUSPENDED', 'TRIAL_EXPIRED'].includes(t.eff))
    .map((t) => ({ id: String(t._id), name: t.name, status: t.eff, planCode: t.planCode, currentPeriodEnd: t.currentPeriodEnd, trialEndsAt: t.trialEndsAt }))
  res.json({
    data: {
      tenants: tenants.length,
      byStatus, byPlan, mrr, arr: mrr * 12,
      payingTenants: paying.length,
      outstanding: dueInvoices.reduce((n, i) => n + i.total, 0),
      outstandingCount: dueInvoices.length,
      collected30d: paidRecent.reduce((n, i) => n + i.total, 0),
      signupsByWeek: weeks,
      trialsEnding, attention,
      recent: tenants.sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((t) => ({ id: String(t._id), name: t.name, planCode: t.planCode, status: effectiveStatus(t, now), createdAt: t.createdAt, createdVia: t.createdVia })),
    },
  })
})

// ───────────────────────────────────────────────────────── tenants

router.get('/tenants', async (req, res) => {
  const paging = pageParams(req.query)
  const filter = { ...searchFilter(paging.search, ['name', 'slug', 'profile.email', 'profile.city']) }
  if (req.query.planCode) filter.planCode = String(req.query.planCode)
  const all = await Tenant.find(filter).sort({ createdAt: -1 }).lean()
  const now = new Date()
  let rows = all.map((t) => ({ ...t, eff: effectiveStatus(t, now) }))
  if (req.query.status) rows = rows.filter((t) => t.eff === req.query.status)
  const total = rows.length
  const page = rows.slice(paging.skip, paging.skip + paging.pageSize)
  const plans = new Map((await Plan.find().lean()).map((p) => [p.code, p]))
  const data = await Promise.all(page.map(async (t) => {
    const usage = await usageFor(t._id)
    const plan = plans.get(t.planCode)
    return {
      id: String(t._id), name: t.name, slug: t.slug, city: t.profile?.city, email: t.profile?.email, verified: !!t.verification?.at,
      planCode: t.planCode, planName: plan?.name, billingCycle: t.billingCycle,
      status: t.eff, storedStatus: t.status, blocked: BLOCKED_STATUSES.includes(t.eff),
      users: usage.users, userLimit: t.limitsOverride?.users ?? plan?.limits?.users,
      trialEndsAt: t.trialEndsAt, currentPeriodEnd: t.currentPeriodEnd,
      mrr: ['ACTIVE', 'PAST_DUE'].includes(t.eff) ? monthlyValue(plan, t.billingCycle) : 0,
      createdAt: t.createdAt, createdVia: t.createdVia,
    }
  }))
  res.json(listResponse(data, total, paging))
})

const provisionSchema = z.object({
  institutionName: z.string().trim().min(3, 'Enter the institution name').max(120),
  city: optionalText(80),
  state: optionalText(80),
  planCode: z.string().min(1),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  trialDays: z.coerce.number().int().min(0).max(90).optional(),
  adminName: z.string().trim().min(2, 'Enter the admin name').max(100),
  adminEmail: email,
  adminMobile: mobile.optional().or(z.literal('').transform(() => undefined)),
  adminPassword: z.string(),
})

router.post('/tenants', requirePlatform('tenants.create'), async (req, res) => {
  const input = provisionSchema.parse(req.body)
  if (!isStrongPassword(input.adminPassword)) throw badRequest(PASSWORD_RULE, { fields: { adminPassword: PASSWORD_RULE } })
  const { tenant, user, role } = await provisionTenant({
    institutionName: input.institutionName, planCode: input.planCode, billingCycle: input.billingCycle, trialDays: input.trialDays,
    admin: { name: input.adminName, email: input.adminEmail, mobile: input.adminMobile, password: input.adminPassword },
    profile: { city: input.city, state: input.state },
    createdVia: 'SUPERADMIN',
  })
  mailWelcome(user, tenant)
  res.status(201).json({ data: { id: String(tenant._id), name: tenant.name, slug: tenant.slug, adminUserId: String(user._id), adminRole: role.name } })
})

router.get('/tenants/:id', async (req, res) => {
  const tenant = await Tenant.findById(req.params.id).lean()
  if (!tenant) throw notFound('Institution')
  const [summary, invoices, events, modules] = await Promise.all([
    subscriptionSummary(tenant),
    SubscriptionInvoice.find({ tenantId: tenant._id }).sort({ issuedAt: -1 }).lean(),
    SubscriptionEvent.find({ tenantId: tenant._id }).sort({ at: -1 }).limit(50).lean(),
    listTenantModules(tenant._id),
  ])
  const { users, roles } = await runAsTenant(tenant._id, async () => ({
    users: await User.find().sort({ createdAt: 1 }).limit(100).select('name email emailVerifiedAt designation active lastLoginAt roleIds createdAt').lean(),
    roles: await Role.find().select('name fullAccess system').lean(),
  }))
  const roleName = new Map(roles.map((r) => [String(r._id), r.name]))
  res.json({
    data: {
      ...clean(tenant),
      subscription: summary,
      invoices: clean(invoices),
      events: clean(events),
      modules,
      roles: clean(roles),
      users: users.map((u) => ({ ...clean(u), roles: u.roleIds.map((id) => roleName.get(String(id))).filter(Boolean), roleIds: undefined })),
    },
  })
})

const tenantPatch = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  graceDays: z.coerce.number().int().min(0).max(60).optional(),
  trialEndsAt: z.coerce.date().optional(),
  limitsOverride: z.object(Object.fromEntries(LIMIT_KEYS.map((l) => [l.key, z.coerce.number().int().min(0).nullable().optional()]))).optional(),
  notes: optionalText(2000),
  // the platform checked the institution's identity documents (shows a verified badge)
  verified: z.boolean().optional(),
  verificationNote: optionalText(200),
  // a deal: % off every invoice until a date (null pct = no deal)
  discount: z.object({ pct: z.coerce.number().min(0).max(100).nullable(), note: optionalText(80), until: z.coerce.date().nullable().optional() }).optional(),
})

router.patch('/tenants/:id', async (req, res) => {
  const input = tenantPatch.parse(req.body)
  // a deal discount is money (billing); status, trial, limits and notes are support work
  const { discount, ...rest } = input
  if (discount && !platformCan(req.auth.role, 'billing')) throw forbidden('Your platform role doesn’t allow changing prices.')
  if (Object.keys(rest).length && !platformCan(req.auth.role, 'tenants.edit')) throw forbidden('Your platform role doesn’t allow changing institutions.')
  const tenant = await Tenant.findById(req.params.id)
  if (!tenant) throw notFound('Institution')
  if (input.status && input.status !== tenant.status) {
    if (input.status === 'ACTIVE' && !tenant.currentPeriodEnd) throw badRequest('Record a payment to activate a paid period — there is no billing period yet.')
    await recordEvent(tenant._id, 'STATUS_CHANGED', { from: tenant.status, to: input.status, note: 'Changed by platform owner' })
    tenant.status = input.status
  }
  if (input.trialEndsAt && +input.trialEndsAt !== +tenant.trialEndsAt) {
    await recordEvent(tenant._id, 'TRIAL_EXTENDED', { from: tenant.trialEndsAt?.toISOString().slice(0, 10), to: input.trialEndsAt.toISOString().slice(0, 10) })
    tenant.trialEndsAt = input.trialEndsAt
  }
  if (input.limitsOverride) {
    const cleaned = Object.fromEntries(Object.entries(input.limitsOverride).filter(([, v]) => v !== null && v !== undefined))
    tenant.limitsOverride = Object.keys(cleaned).length ? cleaned : undefined
    await recordEvent(tenant._id, 'LIMITS_CHANGED', { note: Object.keys(cleaned).length ? Object.entries(cleaned).map(([k, v]) => `${k}: ${v}`).join(', ') : 'Back to plan limits' })
  }
  if (input.discount) {
    const { pct, note, until } = input.discount
    tenant.discount = pct ? { pct, note, until: until ?? undefined } : undefined
    await recordEvent(tenant._id, 'DISCOUNT_CHANGED', { note: pct ? `${pct}%${note ? ` · ${note}` : ''}${until ? ` until ${until.toISOString().slice(0, 10)}` : ''}` : 'Deal removed' })
  }
  if (input.verified !== undefined && input.verified !== !!tenant.verification?.at) {
    tenant.verification = input.verified ? { at: new Date(), by: req.auth.user?.name, note: input.verificationNote } : undefined
    await recordEvent(tenant._id, input.verified ? 'VERIFIED' : 'VERIFICATION_REMOVED', { note: input.verificationNote })
  }
  for (const f of ['name', 'graceDays', 'notes']) if (input[f] !== undefined) tenant[f] = input[f]
  await tenant.save()
  await bumpAccessVersion(tenant._id)
  res.json({ data: clean(tenant.toObject()) })
})

// Modules & screens for one institution: extra modules (optionally until a date), plan modules taken away,
// single screens hidden. Saving switches modules on/off at once and is recorded in the institution's activity.
const ymdOrEmpty = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal('').transform(() => undefined))
const overridesBody = z.object({
  moduleAdds: z.array(z.object({ moduleId: z.string().max(40), until: ymdOrEmpty, note: optionalText(200) })).max(60).default([]),
  moduleRemovals: z.array(z.object({ moduleId: z.string().max(40), note: optionalText(200) })).max(60).default([]),
  hiddenPages: z.array(z.object({ key: z.string().max(80), note: optionalText(200) })).max(400).default([]),
})
router.put('/tenants/:id/modules', requirePlatform('tenants.edit'), async (req, res) => {
  const input = overridesBody.parse(req.body)
  const tenant = await Tenant.findById(req.params.id).lean()
  if (!tenant) throw notFound('Institution')
  const { changes, summary } = await saveModuleOverrides(tenant._id, input, req.auth.user?.name)
  const note = [
    summary.added.length && `Extra: ${summary.added.join(', ')}`,
    summary.removed.length && `Taken away: ${summary.removed.join(', ')}`,
    summary.hidden.length && `Hidden screens: ${summary.hidden.length}`,
  ].filter(Boolean).join(' · ') || 'Back to the plan as it is'
  await recordEvent(tenant._id, 'MODULES_CHANGED', { note })
  await runAsTenant(tenant._id, () => audit({ action: 'UPDATE', module: 'core', entityType: 'tenant', entityId: String(tenant._id), entityName: tenant.name, summary: `Modules and screens changed by the platform — ${note}`, added: changes.enabled, removed: changes.disabled }))
  res.json({ data: { modules: await listTenantModules(tenant._id), changes } })
})

router.post('/tenants/:id/change-plan', requirePlatform('billing'), async (req, res) => {
  const { planCode, cycle, invoice } = z.object({ planCode: z.string(), cycle: z.enum(['MONTHLY', 'YEARLY']).optional(), invoice: z.boolean().default(true) }).parse(req.body)
  const result = await changePlan(req.params.id, { planCode, cycle, invoice })
  await runAsTenant(req.params.id, () => audit({ action: 'PLAN_CHANGE', module: 'core', entityType: 'tenant', entityId: req.params.id, entityName: result.tenant.name, summary: `Plan changed to ${planCode} by the platform`, added: result.modules.enabled, removed: result.modules.disabled }))
  res.json({ data: { invoice: result.invoice && clean(result.invoice.toObject()), modules: result.modules } })
})

router.post('/tenants/:id/invoices/:invoiceId/pay', requirePlatform('billing'), async (req, res) => {
  const { method, reference } = z.object({ method: z.enum(['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'CASH', 'OTHER']), reference: optionalText(80) }).parse(req.body)
  const inv = await SubscriptionInvoice.findOne({ _id: req.params.invoiceId, tenantId: req.params.id })
  if (!inv) throw notFound('Invoice')
  const { invoice, tenant } = await recordPayment(inv._id, { method, reference, recordedBy: req.auth.user.name })
  await bumpAccessVersion(tenant._id)
  res.json({ data: clean(invoice.toObject()) })
})

/** A Razorpay payment link for an unpaid invoice, emailed to the institution's owner (and shown here to copy). */
router.post('/tenants/:id/invoices/:invoiceId/payment-link', requirePlatform('billing'), async (req, res) => {
  const found = await SubscriptionInvoice.findOne({ _id: req.params.invoiceId, tenantId: req.params.id }).select('_id').lean()
  if (!found) throw notFound('Invoice')
  const { url, invoice, owner, tenant } = await paymentLinkFor(found._id)
  if (owner) mailPaymentLink(owner, { institution: tenant.name, invoice, url })
  await recordEvent(invoice.tenantId, 'PAYMENT_LINK_SENT', { to: invoice.number, note: owner ? `to ${owner.email}` : 'link created' })
  res.json({ data: { url, emailedTo: owner?.email ?? null } })
})

router.post('/tenants/:id/invoices/:invoiceId/void', requirePlatform('billing'), async (req, res) => {
  // DUE → VOID in one conditional update, so a payment arriving at the same moment isn't lost
  const inv = await SubscriptionInvoice.findOneAndUpdate(
    { _id: req.params.invoiceId, tenantId: req.params.id, status: 'DUE' },
    { $set: { status: 'VOID', notes: String(req.body?.reason || 'Voided by platform owner') } },
    { new: true },
  )
  if (!inv) {
    if (!await SubscriptionInvoice.exists({ _id: req.params.invoiceId, tenantId: req.params.id })) throw notFound('Invoice')
    throw conflict('Only an unpaid invoice can be voided.')
  }
  await recordEvent(inv.tenantId, 'INVOICE_VOIDED', { to: inv.number, note: inv.notes })
  res.json({ data: clean(inv.toObject()) })
})

// ───────────────────────────────────────────────────────── invoices across tenants

router.get('/invoices', async (req, res) => {
  const paging = pageParams(req.query)
  const filter = {}
  if (req.query.status) filter.status = String(req.query.status)
  if (paging.search) filter.number = new RegExp(paging.search.replace(/[^\w-]/g, ''), 'i')
  const [rows, total] = await Promise.all([
    SubscriptionInvoice.find(filter).sort({ issuedAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    SubscriptionInvoice.countDocuments(filter),
  ])
  const names = new Map((await Tenant.find({ _id: { $in: rows.map((r) => r.tenantId) } }).select('name').lean()).map((t) => [String(t._id), t.name]))
  res.json(listResponse(rows.map((r) => ({ ...clean(r), tenantId: String(r.tenantId), tenantName: names.get(String(r.tenantId)) })), total, paging))
})

router.post('/billing/run', requirePlatform('billing'), async (req, res) => {
  res.json({ data: await runBillingCycle(new Date()) })
})

// ───────────────────────────────────────────────────────── plans

const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, '2–20 capital letters, digits or _'),
  name: z.string().trim().min(2).max(60),
  tagline: optionalText(160),
  priceMonthly: z.coerce.number().int().min(0),
  priceYearly: z.coerce.number().int().min(0),
  trialDays: z.coerce.number().int().min(0).max(90).default(14),
  modules: z.array(z.string()).min(1, 'Pick at least one module'),
  limits: z.object(Object.fromEntries(LIMIT_KEYS.map((l) => [l.key, z.coerce.number().int().min(0)]))),
  features: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  isPublic: z.boolean().default(true),
  active: z.boolean().default(true),
  highlight: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  renewsInto: z.string().trim().toUpperCase().max(20).optional().or(z.literal('').transform(() => undefined)),
})

const planOut = async (p) => ({
  ...clean(p),
  tenantCount: await Tenant.countDocuments({ planCode: p.code, status: { $ne: 'CANCELLED' } }),
})

router.get('/plans', async (req, res) => {
  const plans = await Plan.find().sort({ sortOrder: 1 }).lean()
  res.json({ data: await Promise.all(plans.map(planOut)) })
})

router.get('/catalog', async (req, res) => {
  res.json({ data: { modules: MODULES.map((m) => ({ id: m.id, name: m.name, category: m.category, icon: m.icon, mandatory: !!m.mandatory, internal: !!m.internal, deps: m.deps ?? [], desc: m.desc, pageCount: m.pages.length })), limitKeys: LIMIT_KEYS } })
})

/** A retired plan's replacement must be another, active plan. */
async function checkRenewsInto(code, renewsInto) {
  if (!renewsInto) return
  if (renewsInto === code) throw badRequest('A plan can’t renew into itself.', { fields: { renewsInto: 'Pick another plan' } })
  if (!await Plan.exists({ code: renewsInto, active: true })) throw badRequest('Renew into an active plan.', { fields: { renewsInto: 'Not an active plan' } })
}

router.post('/plans', requirePlatform('plans'), async (req, res) => {
  const input = planSchema.parse(req.body)
  await checkRenewsInto(input.code, input.renewsInto)
  input.modules = closeOverDependencies(input.modules)
  const plan = await Plan.create(input)
  res.status(201).json({ data: await planOut(plan.toObject()) })
})

router.patch('/plans/:code', requirePlatform('plans'), async (req, res) => {
  const input = planSchema.partial().omit({ code: true }).parse(req.body)
  const plan = await Plan.findOne({ code: req.params.code.toUpperCase() })
  if (!plan) throw notFound('Plan')
  if ('renewsInto' in req.body) {
    await checkRenewsInto(plan.code, input.renewsInto)
    if (!input.renewsInto) plan.renewsInto = undefined // cleared in the form
  }
  const before = new Set(closeOverDependencies([...plan.modules]))
  if (input.modules) input.modules = closeOverDependencies(input.modules)
  Object.assign(plan, input)
  await plan.save()
  // institutions already on this plan get the module change now, not at their next plan change
  if (input.modules) {
    const after = new Set(input.modules)
    const change = { added: [...after].filter((m) => !before.has(m)), removed: [...before].filter((m) => !after.has(m)) }
    if (change.added.length || change.removed.length) {
      const tenants = await Tenant.find({ planCode: plan.code, status: { $ne: 'CANCELLED' } }).select('_id').lean()
      for (const t of tenants) await applyPlanModuleChange(t._id, change)
    }
  }
  res.json({ data: await planOut(plan.toObject()) })
})

// ───────────────────────────────────────────────────────── platform settings

// Empty text clears a field (stored as ''), so these allow '' rather than dropping it.
const text = (max) => z.string().trim().max(max)
const emailOrEmpty = z.union([email, z.literal('')])
const settingsSchema = z.object({
  company: z.object({
    name: text(120), legalName: text(160),
    gstin: z.union([z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN has 15 letters/digits'), z.literal('')]),
    stateCode: z.union([z.string().trim().regex(/^\d{2}$/, 'Two digits, as in the GSTIN'), z.literal('')]),
    address: text(400), supportEmail: emailOrEmpty, supportPhone: text(30),
  }).partial().optional(),
  email: z.object({
    host: text(200), port: z.number().int().min(1).max(65535).nullable(), secure: z.boolean(), user: text(200),
    pass: z.string().max(500), fromName: text(80), fromEmail: emailOrEmpty, replyTo: emailOrEmpty,
  }).partial().optional(),
  sms: z.object({
    provider: z.enum(['NONE', 'MSG91', 'TEST']), senderId: z.union([z.string().trim().regex(/^[A-Za-z]{6}$/, 'Six letters, as registered on DLT'), z.literal('')]),
    authKey: z.string().trim().max(200), route: text(10),
    otpTemplateId: z.union([z.string().trim().regex(/^\d{10,25}$/, 'The DLT template id is 10–25 digits'), z.literal('')]),
    otpText: z.string().trim().max(300).refine((v) => !v || v.includes('{{code}}'), 'Keep {{code}} in the text'),
  }).partial().optional(),
  signupEnabled: z.boolean().optional(),
  notice: z.object({ message: z.string().trim().max(300), tone: z.enum(['info', 'warning']), active: z.boolean(), until: z.coerce.date().nullable() }).partial().optional(),
  razorpay: z.object({
    keyId: z.union([z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, 'Starts with rzp_test_ or rzp_live_'), z.literal('')]),
    keySecret: z.string().trim().max(200), webhookSecret: z.string().trim().max(200),
  }).partial().optional(),
})

router.get('/settings', requirePlatform('settings'), async (req, res) => {
  res.json({ data: platformSettingsView(await getPlatformSettings()) })
})

router.patch('/settings', requirePlatform('settings'), async (req, res) => {
  res.json({ data: await savePlatformSettings(settingsSchema.parse(req.body)) })
})

/** Send a test email with the saved server settings; success marks outgoing email as working. */
router.post('/settings/test-email', requirePlatform('settings'), async (req, res) => {
  const { to } = z.object({ to: email }).parse(req.body)
  await sendTestEmail(to)
  res.json({ data: platformSettingsView(await getPlatformSettings()) })
})

/** Send a sample code SMS with the saved account; success marks platform SMS as working. */
router.post('/settings/test-sms', requirePlatform('settings'), async (req, res) => {
  const { to } = z.object({ to: z.string().trim().max(20) }).parse(req.body)
  await sendPlatformTestSms(to)
  res.json({ data: platformSettingsView(await getPlatformSettings()) })
})

// ───────────────────────────────────────────────────────── coupons

const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/, '3–24 letters, digits, - or _'),
  pct: z.coerce.number().int().min(1).max(100),
  description: optionalText(200),
  planCodes: z.array(z.string().trim().toUpperCase()).default([]),
  validUntil: z.coerce.date().nullable().optional(),
  maxUses: z.coerce.number().int().min(1).nullable().optional(),
  active: z.boolean().default(true),
})

router.get('/coupons', async (req, res) => {
  res.json({ data: clean(await DiscountCode.find().sort({ active: -1, createdAt: -1 }).lean()) })
})

router.post('/coupons', requirePlatform('coupons'), async (req, res) => {
  const input = couponSchema.parse(req.body)
  if (await DiscountCode.exists({ code: input.code })) throw conflict('This code already exists.', { fields: { code: 'Already exists' } })
  const c = await DiscountCode.create({ ...input, createdBy: req.auth.user.name })
  res.status(201).json({ data: clean(c.toObject()) })
})

router.patch('/coupons/:id', requirePlatform('coupons'), async (req, res) => {
  const input = couponSchema.omit({ code: true }).partial().parse(req.body)
  const c = await DiscountCode.findById(req.params.id)
  if (!c) throw notFound('Coupon')
  Object.assign(c, input)
  await c.save()
  res.json({ data: clean(c.toObject()) })
})

// ───────────────────────────────────────────────────────── platform staff & audit

const staffView = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role || 'OWNER', active: u.active, mustChangePassword: !!u.mustChangePassword, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })
const STAFF_ROLES = PLATFORM_ROLES.map((r) => r.value)
const TEMP_HOURS = 72

/** At least one active owner always remains, so the console can't lock itself out. */
async function assertOwnerRemains(exceptId) {
  const n = await PlatformUser.countDocuments({ _id: { $ne: exceptId }, active: true, $or: [{ role: 'OWNER' }, { role: null }] })
  if (!n) throw conflict('Keep at least one active owner.')
}

router.get('/staff', requirePlatform('staff'), async (req, res) => {
  res.json({ data: (await PlatformUser.find().sort({ active: -1, name: 1 }).lean()).map(staffView) })
})

/** A new console user with a temporary password (shown once; they set their own at first sign-in). */
router.post('/staff', requirePlatform('staff'), async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), email, role: z.enum(STAFF_ROLES) }).parse(req.body)
  if (await PlatformUser.exists({ email: input.email })) throw conflict('This email is already platform staff.', { fields: { email: 'Already staff' } })
  // sign-in tries platform staff first, so an institution login on the same email would stop working
  if (await runAsSystem(() => User.exists({ email: input.email }).setOptions({ allTenants: true }))) {
    throw conflict('This email signs in to an institution. Use a separate email for the console.', { fields: { email: 'Used by an institution login' } })
  }
  const password = tempPassword()
  const u = await PlatformUser.create({ ...input, passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TEMP_HOURS * 3600_000) })
  res.status(201).json({ data: { staff: staffView(u.toObject()), tempPassword: password } })
})

router.patch('/staff/:id', requirePlatform('staff'), async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), role: z.enum(STAFF_ROLES), active: z.boolean() }).partial().parse(req.body)
  const u = await PlatformUser.findById(req.params.id)
  if (!u) throw notFound('Staff member')
  const self = String(u._id) === String(req.auth.user._id)
  if (self && (('role' in input && input.role !== (u.role || 'OWNER')) || input.active === false)) throw forbidden('You can’t change your own role or deactivate yourself.')
  const wasOwner = (u.role || 'OWNER') === 'OWNER' && u.active
  if (wasOwner && ((input.role && input.role !== 'OWNER') || input.active === false)) await assertOwnerRemains(u._id)
  Object.assign(u, input)
  await u.save()
  if (input.active === false) await endSessions({ userId: u._id }, 'USER_DEACTIVATED')
  res.json({ data: staffView(u.toObject()) })
})

router.post('/staff/:id/reset-password', requirePlatform('staff'), async (req, res) => {
  const u = await PlatformUser.findById(req.params.id)
  if (!u) throw notFound('Staff member')
  if (String(u._id) === String(req.auth.user._id)) throw badRequest('Change your own password from the menu.')
  const password = tempPassword()
  Object.assign(u, { passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TEMP_HOURS * 3600_000) })
  await u.save()
  await endSessions({ userId: u._id }, 'ADMIN_PASSWORD_RESET')
  await clearFailedLogins(u.email)
  res.json({ data: { tempPassword: password } })
})

router.get('/audit', requirePlatform('audit'), async (req, res) => {
  const paging = pageParams(req.query)
  const filter = {}
  if (isOid(req.query.actorId)) filter.actorId = req.query.actorId
  if (req.query.search) filter.$or = ['action', 'target', 'actorName', 'path'].map((f) => ({ [f]: { $regex: escapeRegex(String(req.query.search).slice(0, 80)), $options: 'i' } }))
  const [rows, total] = await Promise.all([
    PlatformAuditLog.find(filter).sort({ at: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    PlatformAuditLog.countDocuments(filter),
  ])
  res.json(listResponse(clean(rows), total, paging))
})

// ───────────────────────────────────────────────────────── role templates

router.get('/role-templates', async (req, res) => {
  res.json({ data: clean(await RoleTemplate.find().sort({ sortOrder: 1 }).lean()) })
})

router.patch('/role-templates/:code', requirePlatform('templates'), async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    description: optionalText(500),
    permissions: z.array(z.string()).optional(),
    homePage: optionalText(120),
    active: z.boolean().optional(),
  }).parse(req.body)
  const t = await RoleTemplate.findOne({ code: req.params.code })
  if (!t) throw notFound('Role template')
  if (input.permissions) input.permissions = normalizePermissions(input.permissions)
  Object.assign(t, input)
  await t.save()
  res.json({ data: clean(t.toObject()) })
})

export default router
