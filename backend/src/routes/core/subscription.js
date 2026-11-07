import { Router } from 'express'
import { MODULE_BY_ID } from '@schoolgiant/shared'
import { Plan, SubscriptionEvent, SubscriptionInvoice, Tenant } from '../../models/platform.js'
import { audit } from '../../platform/audit.js'
import { clean } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'
import { requirePermission } from '../../platform/middleware.js'
import { z } from '../../platform/validate.js'
import { listTenantModules, setModuleEnabled } from '../../services/modules.js'
import { changePlan, previewPlanChange, subscribe, subscriptionSummary } from '../../services/subscription.js'
import { confirmCheckout, startCheckout } from '../../services/platformPayments.js'
import { paymentsReady } from '../../services/platformSettings.js'
import { notifyInvoiceIssued } from '../../services/billingReminders.js'
import { invoiceFileName, renderInvoiceHtml } from '../../services/subscriptionInvoiceDoc.js'
import { pdfOrNull, sendPdf } from '../../platform/pdf.js'
import { logger } from '../../platform/logger.js'

const router = Router()

// ───────────────────────────────────────────────────────── modules

router.get('/modules', requirePermission('core.modules.view'), async (req, res) => {
  res.json({ data: await listTenantModules(req.auth.tenantId) })
})

router.post('/modules/:id', requirePermission('core.modules.edit'), async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
  const result = await setModuleEnabled(req.auth.tenantId, req.params.id, enabled)
  const name = MODULE_BY_ID[req.params.id]?.name
  await audit({ action: 'UPDATE', module: 'core', entityType: 'module', entityId: req.params.id, entityName: name, summary: `${enabled ? 'Switched on' : 'Switched off'} ${name}` }, req)
  res.json({ data: result })
})

// ───────────────────────────────────────────────────────── plans & subscription

const publicPlan = (p) => ({
  code: p.code, name: p.name, tagline: p.tagline, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly,
  modules: p.modules, limits: p.limits, features: p.features, highlight: p.highlight, trialDays: p.trialDays,
})

router.get('/plans', requirePermission('core.subscription.view'), async (req, res) => {
  const plans = await Plan.find({ active: true, $or: [{ isPublic: true }, { code: req.auth.tenant.planCode }] }).sort({ sortOrder: 1 }).lean()
  res.json({ data: plans.map(publicPlan) })
})

router.get('/subscription', requirePermission('core.subscription.view'), async (req, res) => {
  const tenant = await Tenant.findById(req.auth.tenantId).lean()
  const [summary, invoices, events] = await Promise.all([
    subscriptionSummary(tenant),
    SubscriptionInvoice.find({ tenantId: tenant._id }).sort({ issuedAt: -1 }).limit(36).lean(),
    SubscriptionEvent.find({ tenantId: tenant._id }).sort({ at: -1 }).limit(30).lean(),
  ])
  res.json({ data: { ...summary, invoices: clean(invoices.map(({ refundFlags, gatewayOrderId, paymentLinkId, ...i }) => i)), events: clean(events), createdAt: tenant.createdAt, onlinePayment: await paymentsReady() } })
})

router.get('/subscription/invoices/:id', requirePermission('core.subscription.view'), async (req, res) => {
  const inv = await SubscriptionInvoice.findOne({ _id: req.params.id, tenantId: req.auth.tenantId }).lean()
  if (!inv) throw notFound('Invoice')
  const tenant = await Tenant.findById(req.auth.tenantId).lean()
  const { refundFlags, gatewayOrderId, paymentLinkId, ...shown } = inv
  res.json({ data: { ...clean(shown), billedTo: { name: tenant.profile?.legalName || tenant.name, address: [tenant.profile?.addressLine, tenant.profile?.city, tenant.profile?.state, tenant.profile?.pincode].filter(Boolean).join(', '), gstin: tenant.profile?.gstin } } })
})

/** The tax invoice as a page (print) or a PDF (when Gotenberg is set up — /me features.pdf). */
router.get('/subscription/invoices/:id/document', requirePermission('core.subscription.view'), async (req, res) => {
  const inv = await SubscriptionInvoice.findOne({ _id: req.params.id, tenantId: req.auth.tenantId }).lean()
  if (!inv) throw notFound('Invoice')
  res.json({ data: { html: await renderInvoiceHtml(inv) } })
})

router.get('/subscription/invoices/:id/pdf', requirePermission('core.subscription.view'), async (req, res) => {
  const inv = await SubscriptionInvoice.findOne({ _id: req.params.id, tenantId: req.auth.tenantId }).lean()
  if (!inv) throw notFound('Invoice')
  const pdf = await pdfOrNull(await renderInvoiceHtml(inv), { fileName: invoiceFileName(inv) })
  if (!pdf) throw new AppError(409, 'PDF download isn’t available right now. Use Print instead.', { code: 'PDF_UNAVAILABLE' })
  sendPdf(res, pdf, invoiceFileName(inv))
})

/** Pay an invoice online (Razorpay Checkout): open the window, then confirm what it returns. */
router.post('/subscription/invoices/:id/pay', requirePermission('core.subscription.manage'), async (req, res) => {
  res.json({ data: await startCheckout(req.auth, req.params.id) })
})

router.post('/subscription/invoices/:id/confirm', requirePermission('core.subscription.manage'), async (req, res) => {
  const body = z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1) }).parse(req.body)
  const result = await confirmCheckout(req.auth, req.params.id, body)
  await audit({ action: 'UPDATE', module: 'core', entityType: 'tenant', entityId: String(req.auth.tenantId), entityName: req.auth.tenant.name, summary: `Paid a subscription invoice online (${body.paymentId})` }, req)
  res.json({ data: result })
})

const planChoice = z.object({ planCode: z.string().min(1), cycle: z.enum(['MONTHLY', 'YEARLY']).optional(), coupon: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)) })

/** Email a new invoice now that it is saved (never fails the request). */
const emailInvoice = (invoice, tenant) => invoice && notifyInvoiceIssued(invoice.toObject(), tenant.toObject()).catch((err) => logger.warn({ err }, 'invoice email failed'))

router.post('/subscription/preview', requirePermission('core.subscription.view'), async (req, res) => {
  const { planCode, cycle, coupon } = planChoice.parse(req.body)
  const tenant = await Tenant.findById(req.auth.tenantId).lean()
  res.json({ data: await previewPlanChange(tenant, planCode, cycle, coupon) })
})

router.post('/subscription/change-plan', requirePermission('core.subscription.manage'), async (req, res) => {
  const { planCode, cycle, coupon } = planChoice.parse(req.body)
  const { tenant, invoice, modules } = await changePlan(req.auth.tenantId, { planCode, cycle, couponCode: coupon })
  emailInvoice(invoice, tenant)
  await audit({ action: 'PLAN_CHANGE', module: 'core', entityType: 'tenant', entityId: String(tenant._id), entityName: tenant.name, summary: `Changed plan to ${tenant.planCode} (${tenant.billingCycle.toLowerCase()})`, added: modules.enabled, removed: modules.disabled }, req)
  res.json({ data: { invoice: invoice && clean(invoice.toObject()), modules } })
})

router.post('/subscription/subscribe', requirePermission('core.subscription.manage'), async (req, res) => {
  const { planCode, cycle, coupon } = planChoice.required({ cycle: true }).parse(req.body)
  const { tenant, invoice } = await subscribe(req.auth.tenantId, { planCode, cycle, couponCode: coupon })
  emailInvoice(invoice, tenant)
  await audit({ action: 'PLAN_CHANGE', module: 'core', entityType: 'tenant', entityId: String(tenant._id), entityName: tenant.name, summary: `Requested a ${cycle.toLowerCase()} ${tenant.planCode} subscription (invoice ${invoice.number})` }, req)
  res.json({ data: { invoice: clean(invoice.toObject()) } })
})

export default router
