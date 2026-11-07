import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { formatINR } from '@schoolgiant/shared'
import { PaymentEvent, SubscriptionInvoice, Tenant } from '../models/platform.js'
import { User } from '../models/tenant.js'
import { bumpAccessVersion } from '../platform/access.js'
import { runAsTenant } from '../platform/context.js'
import { decrypt } from '../platform/crypto.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { getPlatformSettings } from './platformSettings.js'
import { recordEvent, recordPayment } from './subscription.js'

// Institutions paying their subscription invoices online, into the platform's own Razorpay account
// (Superadmin › Settings) — not an institution's gateway (services/integrationsPayments.js, which
// logs to the institution). Three ways money arrives, all ending in applyGatewayPayment():
//   · in-app checkout: an order per invoice, confirmed by the browser with Razorpay's signature;
//   · a payment link the platform owner emails;
//   · the webhook, which covers both when the browser never comes back.
// recordPayment() moves the invoice DUE → PAID in one conditional update, so whichever arrives
// first applies it; money that arrives for an invoice already paid or void is flagged for refund.

const RZP = 'https://api.razorpay.com/v1'
const TIMEOUT_MS = 15_000
const LINK_DAYS = 30

const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex')
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

async function keys() {
  const r = (await getPlatformSettings()).razorpay ?? {}
  const keySecret = decrypt(r.keySecret)
  if (!r.keyId || !keySecret) throw conflict('Online payment isn’t set up yet. Your account manager can record the payment instead.')
  return { keyId: r.keyId, keySecret, webhookSecret: decrypt(r.webhookSecret) }
}

async function rzp(path, { method = 'GET', body } = {}) {
  const { keyId, keySecret } = await keys()
  let res
  try {
    res = await fetch(`${RZP}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    logger.warn({ err, path }, 'razorpay unreachable')
    throw new AppError(409, 'The payment service didn’t answer. Please try again in a minute.', { code: 'GATEWAY_DOWN' })
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    logger.warn({ status: res.status, path, error: data?.error }, 'razorpay refused')
    // not a 5xx: the web app reads those as "server down"
    throw new AppError(409, `The payment service refused: ${data?.error?.description || res.status}`, { code: 'GATEWAY_REFUSED' })
  }
  return data
}

async function openInvoice(tenantId, invoiceId) {
  const inv = await SubscriptionInvoice.findOne({ _id: invoiceId, tenantId }).lean()
  if (!inv) throw notFound('Invoice')
  if (inv.status !== 'DUE') throw badRequest(`This invoice is already ${inv.status.toLowerCase()}.`)
  return inv
}

/** In-app checkout: the Razorpay order for this invoice (made once, reused), and what the checkout window shows. */
export async function startCheckout(auth, invoiceId) {
  const inv = await openInvoice(auth.tenantId, invoiceId)
  const { keyId } = await keys()
  let orderId = inv.gatewayOrderId
  if (!orderId) {
    const order = await rzp('/orders', { method: 'POST', body: { amount: inv.total, currency: 'INR', receipt: inv.number, notes: { invoiceId: String(inv._id), tenantId: String(inv.tenantId) }, payment_capture: 1 } })
    orderId = order.id
    // two tabs may race to make the order: keep the first one saved
    const saved = await SubscriptionInvoice.findOneAndUpdate({ _id: inv._id, gatewayOrderId: null }, { $set: { gatewayOrderId: orderId } }, { new: true }).lean()
    if (!saved) orderId = (await SubscriptionInvoice.findById(inv._id).select('gatewayOrderId').lean()).gatewayOrderId
  }
  const company = (await getPlatformSettings()).company?.name || 'SchoolGiant'
  return {
    keyId, orderId, amount: inv.total, currency: 'INR', name: company,
    description: `${inv.planName} · ${inv.number}`,
    prefill: { name: auth.user.name, email: auth.user.email, contact: auth.user.mobile },
  }
}

/** The checkout window came back: Razorpay's signature proves this payment is for this order. */
export async function confirmCheckout(auth, invoiceId, { orderId, paymentId, signature }) {
  const inv = await SubscriptionInvoice.findOne({ _id: invoiceId, tenantId: auth.tenantId }).lean()
  if (!inv) throw notFound('Invoice')
  const { keySecret } = await keys()
  if (!inv.gatewayOrderId || inv.gatewayOrderId !== orderId || !safeEqual(hmacHex(keySecret, `${orderId}|${paymentId}`), String(signature ?? '').toLowerCase())) {
    throw badRequest('We couldn’t confirm this payment. If money left your account, it will be matched automatically within a few minutes.')
  }
  return applyGatewayPayment(inv._id, { paymentId, amount: inv.total, via: 'checkout' })
}

/**
 * Apply a captured payment to an invoice, once. Returns { status: 'APPLIED' | 'ALREADY' | 'FLAGGED' }.
 * The amount is what Razorpay says arrived; less than the invoice is never marked paid.
 */
export async function applyGatewayPayment(invoiceId, { paymentId, amount, via }) {
  const inv = await SubscriptionInvoice.findById(invoiceId).lean()
  if (!inv) throw notFound('Invoice')
  if (inv.status === 'PAID' && inv.paymentRef === paymentId) return { status: 'ALREADY' }
  const flag = async (reason) => {
    await SubscriptionInvoice.updateOne({ _id: inv._id, 'refundFlags.paymentId': { $ne: paymentId } }, { $push: { refundFlags: { paymentId, amount, reason } } })
    await recordEvent(inv.tenantId, 'PAYMENT_NEEDS_REFUND', { to: inv.number, note: `${formatINR(amount)} · ${paymentId} · ${reason}` })
    logger.warn({ invoice: inv.number, paymentId, amount, reason }, 'subscription payment needs a refund')
    return { status: 'FLAGGED', reason }
  }
  if (inv.status === 'VOID') return flag('Invoice was void')
  if (inv.status === 'PAID') return flag('Invoice was already paid')
  if (amount < inv.total) return flag(`Paid ${formatINR(amount)} of ${formatINR(inv.total)}`)
  try {
    await recordPayment(inv._id, { method: 'RAZORPAY', reference: paymentId, recordedBy: `Razorpay (${via})` })
  } catch (err) {
    if (err.code !== 'NOT_DUE') throw err
    // someone else applied it a moment ago: the same payment is fine, another one is a double payment
    const now = await SubscriptionInvoice.findById(inv._id).select('paymentRef status').lean()
    if (now.paymentRef === paymentId) return { status: 'ALREADY' }
    return flag(now.status === 'VOID' ? 'Invoice was void' : 'Invoice was already paid')
  }
  await bumpAccessVersion(inv.tenantId)
  return { status: 'APPLIED' }
}

/** A Razorpay payment link for an invoice (platform owner), emailed by the caller. Reused while open. */
export async function paymentLinkFor(invoiceId) {
  const inv = await SubscriptionInvoice.findById(invoiceId).lean()
  if (!inv) throw notFound('Invoice')
  if (inv.status !== 'DUE') throw badRequest(`This invoice is already ${inv.status.toLowerCase()}.`)
  if (inv.paymentLinkUrl) return { url: inv.paymentLinkUrl, invoice: inv }
  const tenant = await Tenant.findById(inv.tenantId).lean()
  const owner = tenant.ownerUserId ? await runAsTenant(tenant._id, () => User.findById(tenant.ownerUserId).select('name email mobile').lean()) : null
  const link = await rzp('/payment_links', {
    method: 'POST',
    body: {
      amount: inv.total, currency: 'INR', accept_partial: false, reference_id: inv.number,
      description: `${tenant.name} · ${inv.planName} · ${inv.number}`.slice(0, 2048),
      customer: owner ? { name: owner.name, email: owner.email, ...(owner.mobile && { contact: owner.mobile }) } : undefined,
      notify: { sms: false, email: false }, // we send the email ourselves
      expire_by: Math.floor(Date.now() / 1000) + LINK_DAYS * 86400,
      notes: { invoiceId: String(inv._id), tenantId: String(inv.tenantId) },
    },
  })
  await SubscriptionInvoice.updateOne({ _id: inv._id }, { $set: { paymentLinkId: link.id, paymentLinkUrl: link.short_url } })
  return { url: link.short_url, invoice: inv, tenant, owner }
}

/**
 * POST /api/v1/hooks/platform/razorpay. Signed with the webhook secret; each event applies once
 * (payment_events), and a failure forgets the event so Razorpay's retry gets another go.
 * Returns [status, body].
 */
export async function handlePlatformWebhook(rawBody, headers) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
  const r = (await getPlatformSettings()).razorpay ?? {}
  const secret = decrypt(r.webhookSecret)
  if (!secret || !safeEqual(hmacHex(secret, raw), String(headers['x-razorpay-signature'] ?? '').toLowerCase())) {
    logger.warn({ hasSecret: !!secret }, 'platform razorpay webhook: bad signature')
    return [400, { message: 'Invalid signature' }]
  }
  let body
  try { body = JSON.parse(raw.toString('utf8')) } catch { return [400, { message: 'Not JSON' }] }
  const eventId = String(headers['x-razorpay-event-id'] ?? '').slice(0, 80) || createHash('sha256').update(raw).digest('hex')
  try {
    await PaymentEvent.create({ _id: eventId, type: body.event })
  } catch (err) {
    if (err?.code === 11000) return [200, { ok: true, duplicate: true }]
    throw err
  }
  try {
    const outcome = await onEvent(body)
    logger.info({ event: body.event, eventId, outcome }, 'platform razorpay webhook')
    return [200, { ok: true }]
  } catch (err) {
    await PaymentEvent.deleteOne({ _id: eventId })
    logger.error({ err, event: body.event }, 'platform razorpay webhook failed')
    return [500, { message: 'Could not process' }]
  }
}

async function onEvent(body) {
  if (!['payment.captured', 'order.paid', 'payment_link.paid'].includes(body.event)) return 'ignored'
  const payment = body.payload?.payment?.entity
  if (!payment?.id || (payment.status && payment.status !== 'captured')) return 'not captured'
  const link = body.payload?.payment_link?.entity
  const orderId = body.payload?.order?.entity?.id ?? payment.order_id
  const invoice = (link?.id && await SubscriptionInvoice.findOne({ paymentLinkId: link.id }).select('_id').lean())
    || (orderId && await SubscriptionInvoice.findOne({ gatewayOrderId: orderId }).select('_id').lean())
    || (payment.notes?.invoiceId && await SubscriptionInvoice.findById(payment.notes.invoiceId).select('_id').lean().catch(() => null))
  if (!invoice) return 'no matching invoice' // an institution's own payment can't land here: different account
  return (await applyGatewayPayment(invoice._id, { paymentId: payment.id, amount: payment.amount, via: link?.id ? 'payment link' : 'webhook' })).status
}
