import { GST_STATE_CODES, LIMIT_KEYS, SUBSCRIPTION_GST_PCT, closeOverDependencies, formatINR, gstStateOf, stateCodeOf } from '@schoolgiant/shared'
import { DiscountCode, Plan, SubscriptionEvent, SubscriptionInvoice, Tenant, nextSeq } from '../models/platform.js'
import { Student } from '../models/students.js'
import { Branch, User } from '../models/tenant.js'
import { Attachment } from '../models/engines.js'
import { runAsTenant, getContext } from '../platform/context.js'
import { withTransaction } from '../platform/db.js'
import { AppError, badRequest, conflict, limitReached, notFound } from '../platform/errors.js'
import { syncModulesToPlan } from './modules.js'
import { getPlatformSettings } from './platformSettings.js'
import { sendBillingReminders } from './billingReminders.js'

const DAY = 864e5

/** Statuses that stop the institution from working (only the subscription screen stays open). */
export const BLOCKED_STATUSES = ['SUSPENDED', 'CANCELLED', 'TRIAL_EXPIRED']

export function addCycle(date, cycle) {
  const d = new Date(date)
  if (cycle === 'YEARLY') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d
}

/** The status a tenant is really in right now (stored status + dates). */
export function effectiveStatus(t, now = new Date()) {
  if (t.status === 'CANCELLED' || t.status === 'SUSPENDED') return t.status
  if (t.status === 'TRIAL') return t.trialEndsAt && now > new Date(t.trialEndsAt) ? 'TRIAL_EXPIRED' : 'TRIAL'
  if (t.currentPeriodEnd && now > new Date(t.currentPeriodEnd)) {
    const graceEnd = new Date(+new Date(t.currentPeriodEnd) + (t.graceDays ?? 7) * DAY)
    return now > graceEnd ? 'SUSPENDED' : 'PAST_DUE'
  }
  return t.status
}

const daysBetween = (a, b) => Math.max(0, Math.ceil((+new Date(b) - +new Date(a)) / DAY))

export async function getPlan(code, { activeOnly = false } = {}) {
  const plan = await Plan.findOne({ code: String(code).toUpperCase() }).lean()
  if (!plan || (activeOnly && !plan.active)) throw notFound('Plan')
  return plan
}

export function limitsFor(tenant, plan) {
  const out = { ...(plan?.limits ?? {}) }
  for (const [k, v] of Object.entries(tenant.limitsOverride ?? {})) {
    if (v !== null && v !== undefined) out[k] = v
  }
  return out
}

/** Attachments stored by the current tenant, in GB (3 decimals). */
async function storageGb() {
  const [files] = await Attachment.aggregate([{ $group: { _id: null, bytes: { $sum: '$size' } } }])
  return Math.round((files?.bytes ?? 0) / 1e6) / 1e3
}

export async function usageFor(tenantId) {
  return runAsTenant(tenantId, async () => ({
    users: await User.countDocuments({ active: true }),
    branches: await Branch.countDocuments({ active: true }),
    students: await Student.countDocuments({ status: 'ACTIVE' }),
    storageGb: await storageGb(),
  }))
}

function bannerFor(status, t, now) {
  if (status === 'TRIAL') {
    const left = daysBetween(now, t.trialEndsAt)
    return { tone: left <= 3 ? 'danger' : left <= 7 ? 'warning' : 'info', code: 'TRIAL', vars: { count: left }, text: `Free trial · ${left} day${left === 1 ? '' : 's'} left`, action: 'Choose a plan', actionCode: 'CHOOSE_PLAN' }
  }
  if (status === 'TRIAL_EXPIRED') return { tone: 'danger', code: 'TRIAL_EXPIRED', text: 'Your free trial has ended. Choose a plan to keep using the system.', action: 'Choose a plan', actionCode: 'CHOOSE_PLAN' }
  if (status === 'PAST_DUE') {
    const stop = new Date(+new Date(t.currentPeriodEnd) + (t.graceDays ?? 7) * DAY)
    const days = daysBetween(now, stop)
    return { tone: 'danger', code: 'PAST_DUE', vars: { count: days }, text: `Payment overdue. Access stops in ${days} day(s) unless the invoice is paid.`, action: 'View invoices', actionCode: 'VIEW_INVOICES' }
  }
  if (status === 'SUSPENDED') return { tone: 'danger', code: 'SUSPENDED', text: 'Your subscription is suspended. Pay the open invoice to restore access.', action: 'View invoices', actionCode: 'VIEW_INVOICES' }
  if (status === 'CANCELLED') return { tone: 'danger', code: 'CANCELLED', text: 'This subscription has been cancelled.', action: null }
  return null
}

/** Everything the subscription screen and the app banner need. */
export async function subscriptionSummary(tenant, now = new Date()) {
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  const status = effectiveStatus(tenant, now)
  const limits = limitsFor(tenant, plan)
  const usage = await usageFor(tenant._id)
  const openInvoice = await SubscriptionInvoice.findOne({ tenantId: tenant._id, status: 'DUE' }).sort({ issuedAt: -1 }).lean()
  return {
    status,
    storedStatus: tenant.status,
    blocked: BLOCKED_STATUSES.includes(status),
    plan: plan ? { code: plan.code, name: plan.name, priceMonthly: plan.priceMonthly, priceYearly: plan.priceYearly, modules: plan.modules } : null,
    billingCycle: tenant.billingCycle,
    trialEndsAt: tenant.trialEndsAt,
    currentPeriodStart: tenant.currentPeriodStart,
    currentPeriodEnd: tenant.currentPeriodEnd,
    graceDays: tenant.graceDays,
    daysLeft: status === 'TRIAL' ? daysBetween(now, tenant.trialEndsAt) : tenant.currentPeriodEnd ? daysBetween(now, tenant.currentPeriodEnd) : null,
    limits,
    usage,
    limitDefs: LIMIT_KEYS,
    openInvoice: openInvoice ? { id: String(openInvoice._id), number: openInvoice.number, total: openInvoice.total, dueDate: openInvoice.dueDate } : null,
    banner: bannerFor(status, tenant, now),
  }
}

/** Throw a friendly 422 when adding `adding` more of `key` would pass the plan limit. */
export async function assertWithinLimit(tenantId, key, adding = 1) {
  const tenant = await Tenant.findById(tenantId).lean()
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  const limit = limitsFor(tenant, plan)[key]
  if (limit === undefined || limit === null) return
  const used = (await usageFor(tenantId))[key] ?? 0
  if (used + adding > limit) {
    const label = LIMIT_KEYS.find((l) => l.key === key)?.label.toLowerCase() ?? key
    throw limitReached(`Your ${plan?.name ?? ''} plan allows ${limit} ${label}. Upgrade the plan to add more.`, { key, limit, used })
  }
}

export async function recordEvent(tenantId, type, { from, to, note } = {}) {
  const ctx = getContext()
  await SubscriptionEvent.create({
    tenantId, type, from, to, note,
    by: ctx?.userName ? (ctx.superadmin ? `${ctx.userName} (platform)` : ctx.userName) : 'System',
  })
}

// ───────────────────────────────────────────────────────── pricing

/** The platform as seller (Superadmin › Settings › Company), copied onto each invoice. */
async function sellerNow() {
  const c = (await getPlatformSettings()).company ?? {}
  return { name: c.name || 'SchoolGiant', legalName: c.legalName || c.name, gstin: c.gstin, stateCode: c.stateCode || gstStateOf(c.gstin) || undefined, address: c.address }
}

const billedToOf = (tenant) => ({
  name: tenant.profile?.legalName || tenant.name,
  address: [tenant.profile?.addressLine, tenant.profile?.city, tenant.profile?.state, tenant.profile?.pincode].filter(Boolean).join(', '),
  gstin: tenant.profile?.gstin,
})

/** Where the institution is for GST: its GSTIN's state, else the state on its profile. */
const placeOfSupplyOf = (tenant) => gstStateOf(tenant.profile?.gstin) || GST_STATE_CODES[stateCodeOf(tenant.profile?.state)] || null

const dealOf = (tenant, now = new Date()) => (tenant.discount?.pct > 0 && (!tenant.discount.until || new Date(tenant.discount.until) > now) ? tenant.discount : null)

const couponProblem = (msg) => badRequest(msg, { fields: { coupon: msg } })

/** A coupon this plan can use right now (not used up by looking). */
export async function findCoupon(code, planCode) {
  const c = await DiscountCode.findOne({ code: String(code ?? '').trim().toUpperCase() }).lean()
  if (!c || !c.active) throw couponProblem('This coupon code isn’t valid.')
  if (c.validUntil && new Date(c.validUntil) < new Date()) throw couponProblem('This coupon has expired.')
  if (c.maxUses != null && c.uses >= c.maxUses) throw couponProblem('This coupon has been used up.')
  if (c.planCodes?.length && !c.planCodes.includes(planCode)) throw couponProblem('This coupon isn’t for this plan.')
  return c
}

/**
 * What an invoice for `plan` comes to: the list price, less the institution's deal, less a coupon,
 * then GST on the rest — CGST + SGST when the institution is in the platform's state (or its state
 * isn't known), IGST when it is in another state.
 */
export function priceFor({ tenant, plan, cycle, coupon, seller }) {
  const listAmount = cycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly
  const notes = []
  let amount = listAmount
  const deal = dealOf(tenant)
  if (deal) { amount -= Math.round((amount * deal.pct) / 100); notes.push(`${deal.note || 'Special price'} ${deal.pct}%`) }
  if (coupon) { amount -= Math.round((amount * coupon.pct) / 100); notes.push(`coupon ${coupon.code} ${coupon.pct}%`) }
  const gst = Math.round((amount * SUBSCRIPTION_GST_PCT) / 100)
  const to = placeOfSupplyOf(tenant)
  const inter = !!(seller?.stateCode && to && seller.stateCode !== to)
  const cgst = inter ? 0 : Math.round(gst / 2)
  return {
    listAmount, discount: listAmount - amount, discountNote: notes.join(' · ') || undefined, couponCode: coupon?.code,
    amount, gstPct: SUBSCRIPTION_GST_PCT, gst, cgst, sgst: inter ? 0 : gst - cgst, igst: inter ? gst : 0,
    placeOfSupply: to || seller?.stateCode || undefined, total: amount + gst,
  }
}

export async function issueInvoice({ tenant, plan, cycle, kind, periodStart, periodEnd, dueInDays = 7, coupon }) {
  const seller = await sellerNow()
  const price = priceFor({ tenant, plan, cycle, coupon, seller })
  if (coupon) {
    // used up in the same step, so a coupon's last use can't go to two institutions
    const used = await DiscountCode.findOneAndUpdate(
      { _id: coupon._id, active: true, $or: [{ maxUses: null }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
      { $inc: { uses: 1 } },
    )
    if (!used) throw couponProblem('This coupon has been used up.')
  }
  const year = new Date().getFullYear()
  const seq = await nextSeq(`INV-${year}`)
  const invoice = await SubscriptionInvoice.create({
    tenantId: tenant._id,
    number: `INV-${year}-${String(seq).padStart(5, '0')}`,
    kind, planCode: plan.code, planName: plan.name, cycle,
    periodStart, periodEnd,
    ...price,
    seller, billedTo: billedToOf(tenant),
    status: price.amount === 0 ? 'PAID' : 'DUE',
    issuedAt: new Date(Math.min(Date.now(), +new Date(periodStart))),
    dueDate: new Date(+new Date(periodStart) + dueInDays * DAY),
    paidAt: price.amount === 0 ? new Date() : undefined,
  })
  await recordEvent(tenant._id, 'INVOICE_ISSUED', { to: invoice.number, note: `${plan.name} · ${cycle.toLowerCase()} · ${formatINR(invoice.total)}${price.discountNote ? ` · ${price.discountNote}` : ''}` })
  // the "new invoice" email goes out once this is committed: from the route that asked for it
  // (notifyInvoiceIssued) or the hourly billing pass (billingReminders.js), whichever comes first
  return invoice
}

/** Plan problems if the tenant moved to `plan` today (usage above the new limits). */
export async function limitProblems(tenant, plan) {
  const usage = await usageFor(tenant._id)
  const limits = limitsFor({ ...tenant, limitsOverride: undefined }, plan)
  return LIMIT_KEYS
    .filter((l) => limits[l.key] !== undefined && usage[l.key] > limits[l.key])
    .map((l) => ({ key: l.key, label: l.label, used: usage[l.key], limit: limits[l.key] }))
}

/** What changing to `planCode` would do — shown in the confirm dialog before the change. */
export async function previewPlanChange(tenant, planCode, cycle, couponCode) {
  const plan = await getPlan(planCode, { activeOnly: true })
  const current = await Plan.findOne({ code: tenant.planCode }).lean()
  const now = new Set(closeOverDependencies(current?.modules ?? []))
  const next = new Set(closeOverDependencies(plan.modules))
  const coupon = couponCode ? await findCoupon(couponCode, plan.code) : null
  const price = priceFor({ tenant, plan, cycle: cycle || tenant.billingCycle, coupon, seller: await sellerNow() })
  const status = effectiveStatus(tenant)
  return {
    plan: { code: plan.code, name: plan.name },
    cycle: cycle || tenant.billingCycle,
    ...price,
    modulesAdded: [...next].filter((m) => !now.has(m)),
    modulesRemoved: [...now].filter((m) => !next.has(m)),
    problems: await limitProblems(tenant, plan),
    invoiceNeeded: !['TRIAL', 'TRIAL_EXPIRED'].includes(status),
  }
}

/**
 * Switch the tenant to another plan.
 *  · During a trial: switch only (the trial continues).
 *  · On a paid plan: a new billing period starts today and a PLAN_CHANGE invoice is issued.
 *  `invoice: false` lets the superadmin change plans without billing (e.g. a deal).
 */
export async function changePlan(tenantId, { planCode, cycle, invoice = true, couponCode }) {
  return withTransaction(async () => {
    const tenant = await Tenant.findById(tenantId)
    if (!tenant) throw notFound('Tenant')
    const plan = await getPlan(planCode, { activeOnly: true })
    const newCycle = cycle || tenant.billingCycle
    if (plan.code === tenant.planCode && newCycle === tenant.billingCycle) throw badRequest('You are already on this plan.')
    const problems = await limitProblems(tenant.toObject(), plan)
    if (problems.length) {
      throw conflict(`The ${plan.name} plan is too small for current usage: ${problems.map((p) => `${p.used} ${p.label.toLowerCase()} (limit ${p.limit})`).join(', ')}.`, { problems })
    }
    const from = tenant.planCode
    tenant.planCode = plan.code
    tenant.billingCycle = newCycle
    const status = effectiveStatus(tenant)
    let inv = null
    if (invoice && !['TRIAL', 'TRIAL_EXPIRED'].includes(status)) {
      const start = new Date()
      const coupon = couponCode ? await findCoupon(couponCode, plan.code) : null
      inv = await issueInvoice({ tenant, plan, cycle: newCycle, kind: 'PLAN_CHANGE', periodStart: start, periodEnd: addCycle(start, newCycle), coupon })
    }
    await tenant.save()
    const modules = await syncModulesToPlan(tenant._id, plan)
    await recordEvent(tenant._id, 'PLAN_CHANGED', { from, to: plan.code, note: newCycle.toLowerCase() })
    return { tenant, invoice: inv, modules }
  })
}

/** Trial → paid: pick plan + cycle, an invoice is raised; the tenant turns ACTIVE when it is paid. */
export async function subscribe(tenantId, { planCode, cycle, couponCode }) {
  return withTransaction(async () => {
    const tenant = await Tenant.findById(tenantId)
    if (!tenant) throw notFound('Tenant')
    const plan = await getPlan(planCode, { activeOnly: true })
    const problems = await limitProblems(tenant.toObject(), plan)
    if (problems.length) throw conflict(`The ${plan.name} plan is too small for current usage.`, { problems })
    await SubscriptionInvoice.updateMany({ tenantId, status: 'DUE', kind: 'NEW' }, { $set: { status: 'VOID', notes: 'Replaced by a newer subscription request' } })
    if (tenant.planCode !== plan.code) {
      const from = tenant.planCode
      tenant.planCode = plan.code
      await syncModulesToPlan(tenant._id, plan)
      await recordEvent(tenant._id, 'PLAN_CHANGED', { from, to: plan.code })
    }
    tenant.billingCycle = cycle
    await tenant.save()
    const start = new Date()
    const coupon = couponCode ? await findCoupon(couponCode, plan.code) : null
    const invoice = await issueInvoice({ tenant, plan, cycle, kind: 'NEW', periodStart: start, periodEnd: addCycle(start, cycle), coupon })
    return { tenant, invoice }
  })
}

/** Mark an invoice paid (bank transfer / cheque / gateway webhook) and activate the period it covers. */
export async function recordPayment(invoiceId, { method, reference, recordedBy }) {
  return withTransaction(async () => {
    // DUE → PAID in one conditional update: a webhook, the browser callback and the console
    // recording the same payment at once can't all apply it
    const invoice = await SubscriptionInvoice.findOneAndUpdate(
      { _id: invoiceId, status: 'DUE' },
      { $set: { status: 'PAID', paidAt: new Date(), paymentMethod: method, paymentRef: reference, recordedBy } },
      { new: true },
    )
    if (!invoice) {
      const found = await SubscriptionInvoice.findById(invoiceId).select('status').lean()
      if (!found) throw notFound('Invoice')
      throw new AppError(400, `This invoice is already ${found.status.toLowerCase()}.`, { code: 'NOT_DUE' })
    }

    const tenant = await Tenant.findById(invoice.tenantId)
    const fromStatus = tenant.status
    tenant.status = 'ACTIVE'
    tenant.billingCycle = invoice.cycle
    tenant.currentPeriodStart = invoice.periodStart
    tenant.currentPeriodEnd = invoice.periodEnd
    if (tenant.planCode !== invoice.planCode) {
      tenant.planCode = invoice.planCode
      await syncModulesToPlan(tenant._id, await getPlan(invoice.planCode))
    }
    await tenant.save()
    await recordEvent(tenant._id, 'PAYMENT_RECORDED', { to: invoice.number, note: `${formatINR(invoice.total)} · ${method}${reference ? ` · ${reference}` : ''}` })
    if (fromStatus !== 'ACTIVE') await recordEvent(tenant._id, 'STATUS_CHANGED', { from: fromStatus, to: 'ACTIVE' })
    return { invoice, tenant }
  })
}

/**
 * Daily billing job: raise renewal invoices when a period ends, move unpaid
 * tenants to PAST_DUE and, after the grace days, to SUSPENDED.
 */
export async function runBillingCycle(now = new Date()) {
  const tenants = await Tenant.find({ status: { $in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { $lte: now } })
  let invoices = 0
  let changed = 0
  for (const tenant of tenants) {
    let plan = await Plan.findOne({ code: tenant.planCode }).lean()
    if (!plan) continue
    const exists = await SubscriptionInvoice.findOne({ tenantId: tenant._id, periodStart: tenant.currentPeriodEnd, status: { $ne: 'VOID' } })
    if (!exists) {
      // a retired plan renews as its replacement (Superadmin › Plans › Renews into)
      const next = !plan.active && plan.renewsInto ? await Plan.findOne({ code: plan.renewsInto, active: true }).lean() : null
      if (next) {
        await recordEvent(tenant._id, 'PLAN_CHANGED', { from: plan.code, to: next.code, note: `${plan.name} was retired; renewed as ${next.name}` })
        tenant.planCode = next.code
        await tenant.save()
        await syncModulesToPlan(tenant._id, next)
        plan = next
      }
      await issueInvoice({
        tenant, plan, cycle: tenant.billingCycle, kind: 'RENEWAL',
        periodStart: tenant.currentPeriodEnd, periodEnd: addCycle(tenant.currentPeriodEnd, tenant.billingCycle),
        dueInDays: tenant.graceDays ?? 7,
      })
      invoices++
    }
    const status = effectiveStatus(tenant, now)
    if (status !== tenant.status) {
      await recordEvent(tenant._id, 'STATUS_CHANGED', { from: tenant.status, to: status, note: 'Billing job' })
      tenant.status = status
      await tenant.save()
      changed++
    }
  }
  const { sent: reminders } = await sendBillingReminders(now)
  return { checked: tenants.length, invoices, statusChanges: changed, reminders }
}
