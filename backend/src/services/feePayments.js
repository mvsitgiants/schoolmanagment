import { createHmac } from 'node:crypto'
import { GATEWAY_ORDER_STATUSES, GATEWAY_RECEIPT_MODE, GATEWAY_WEBHOOK_EVENTS, PAYMENT_PROVIDERS, formatINR, mobile10 } from '@schoolgiant/shared'
import { FeePayment } from '../models/fees.js'
import { GatewayOrder, InboundEvent } from '../models/integrations.js'
import { Tenant } from '../models/platform.js'
import { studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { amountDueNow, collect } from './fees.js'
import {
  asHookOwner, callProvider, getConfig, hookUrl, logInbound, maskConfig, providerFailed, requireConfig, safeEqual, saveConfig, secretOf, setHealth, sha256,
} from './integrationsCommon.js'

// Online fee payment (Fees › Online payments) on the school's OWN Razorpay account — ported from the hospital's
// integrationsPayments.js. The gateway never decides what is owed: an order or a link is made for what the student owes
// at that moment (late fee included), and a payment the gateway reports as captured becomes ONE fee receipt through
// fees' own collect() — oldest installment first, the family's receipt message, the audit line, as at the counter.
//
// Exactly once: a captured payment first claims its GatewayOrder row (CREATED/PAID/… → APPLYING, one conditional
// update — a second webhook or the browser's callback for the same payment finds nothing to claim), then collect()
// runs, then APPLIED. A crash in between is settled by the sweep (a receipt carrying the payment id means APPLIED).
// Anything that can't be receipted (paid more than is owed now, another currency) waits as NEEDS_REVIEW for a person.

const RZP = 'https://api.razorpay.com/v1'
const PROVIDER = 'RAZORPAY'
const MIN = 100 // ₹1

// ───────────────────────────────────────────────────────── Razorpay adapter

const basic = (cfg) => `Basic ${Buffer.from(`${cfg.settings?.keyId ?? ''}:${secretOf(cfg, 'keySecret') ?? ''}`).toString('base64')}`
const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex')

const razorpay = {
  label: 'Razorpay',
  call(cfg, { operation, path, method = 'GET', body, idempotent, entity }) {
    if (!cfg.settings?.keyId || !secretOf(cfg, 'keySecret')) throw conflict('Enter the Razorpay key id and key secret first.')
    return callProvider({ provider: PROVIDER, operation, url: `${RZP}${path}`, method, body, idempotent, entity, healthOf: PROVIDER, headers: { Authorization: basic(cfg) }, refOf: (d) => d?.id })
  },
  testConnection: (cfg) => razorpay.call(cfg, { operation: 'test_connection', path: '/orders?count=1' }),
  async createOrder(cfg, { amount, receipt, notes }) {
    const { data } = await razorpay.call(cfg, { operation: 'create_order', path: '/orders', method: 'POST', idempotent: false, entity: { type: 'student', id: notes.studentId }, body: { amount, currency: 'INR', receipt: receipt.slice(0, 40), notes, payment_capture: 1 } })
    return { id: data.id, status: data.status }
  },
  async createLink(cfg, { amount, referenceId, description, customer, notify, expireBy, notes }) {
    const { data } = await razorpay.call(cfg, {
      operation: 'create_payment_link', path: '/payment_links', method: 'POST', idempotent: false, entity: { type: 'student', id: notes.studentId },
      body: { amount, currency: 'INR', accept_partial: false, reference_id: referenceId.slice(0, 40), description: description.slice(0, 2048), customer, notify, reminder_enable: !!notify?.sms, expire_by: expireBy, notes },
    })
    return { id: data.id, shortUrl: data.short_url, status: data.status }
  },
  async fetchPayment(cfg, paymentId) {
    return (await razorpay.call(cfg, { operation: 'fetch_payment', path: `/payments/${encodeURIComponent(paymentId)}` })).data
  },
  async orderPayments(cfg, orderId) {
    return (await razorpay.call(cfg, { operation: 'fetch_order_payments', path: `/orders/${encodeURIComponent(orderId)}/payments` })).data?.items ?? []
  },
  async linkPayments(cfg, linkId) {
    const { data } = await razorpay.call(cfg, { operation: 'fetch_payment_link', path: `/payment_links/${encodeURIComponent(linkId)}` })
    const out = []
    for (const p of data?.payments ?? []) if (p.payment_id) out.push(await razorpay.fetchPayment(cfg, p.payment_id))
    return { status: data?.status, payments: out }
  },
  async capture(cfg, paymentId, amount) {
    return (await razorpay.call(cfg, { operation: 'capture_payment', path: `/payments/${encodeURIComponent(paymentId)}/capture`, method: 'POST', idempotent: false, body: { amount, currency: 'INR' } })).data
  },
  async cancelLink(cfg, linkId) {
    await razorpay.call(cfg, { operation: 'cancel_payment_link', path: `/payment_links/${encodeURIComponent(linkId)}/cancel`, method: 'POST', idempotent: false })
  },
  async refund(cfg, paymentId, { amount, notes, receipt }) {
    const { data } = await razorpay.call(cfg, { operation: 'refund', path: `/payments/${encodeURIComponent(paymentId)}/refund`, method: 'POST', idempotent: false, body: { amount, speed: 'normal', notes, receipt: receipt?.slice(0, 40) } })
    return { id: data.id, status: data.status, amount: data.amount }
  },
  /** Checkout handler signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret), hex. */
  verifyCheckout(cfg, { orderId, paymentId, signature }) {
    const secret = secretOf(cfg, 'keySecret')
    return !!secret && safeEqual(hmacHex(secret, `${orderId}|${paymentId}`), String(signature ?? '').toLowerCase())
  },
  /** Webhook signature: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret), hex. */
  verifyWebhook(cfg, rawBody, signature) {
    const secret = secretOf(cfg, 'webhookSecret')
    return !!secret && safeEqual(hmacHex(secret, rawBody), String(signature ?? '').toLowerCase())
  },
}
const notYet = (label) => new Proxy({ label }, { get: (t, k) => (k === 'label' ? label : () => { throw conflict(`${label} isn’t available yet.`) }) })
const ADAPTERS = { RAZORPAY: razorpay, PAYU: notYet('PayU'), CASHFREE: notYet('Cashfree') }

/** The school's switched-on gateway, or null. */
async function activeGateway() {
  for (const p of PAYMENT_PROVIDERS.filter((x) => x.available)) {
    const cfg = await getConfig(p.id)
    if (cfg.enabled) return { cfg, adapter: ADAPTERS[p.id], provider: p.id }
  }
  return null
}

/** Can families pay fees online here? */
export async function onlinePaymentsOn(enabledModules) {
  if (enabledModules && !enabledModules.includes('fees')) return false
  return !!(await activeGateway())
}

// ───────────────────────────────────────────────────────── setup

export async function paymentsView(baseUrl) {
  const cfg = await getConfig(PROVIDER)
  const since = new Date(Date.now() - 30 * 86_400_000)
  const stats = await GatewayOrder.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }])
  return {
    providers: PAYMENT_PROVIDERS, config: maskConfig(cfg), webhookUrl: await hookUrl(PROVIDER, 'razorpay', baseUrl), webhookEvents: GATEWAY_WEBHOOK_EVENTS,
    last30Days: Object.fromEntries(stats.map((s) => [s._id, { count: s.n, amount: s.amount }])),
  }
}

export function savePaymentsConfig(input, req) {
  return saveConfig(PROVIDER, input, req, {
    validate: async (next) => {
      const keyId = next.settings.keyId ?? ''
      if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(keyId)) throw badRequest('A Razorpay key id looks like rzp_test_… or rzp_live_…', { fields: { 'settings.keyId': 'Not a Razorpay key id' } })
      if (keyId && (next.mode === 'LIVE') !== keyId.startsWith('rzp_live_')) throw badRequest(next.mode === 'LIVE' ? 'Live mode needs a live key (rzp_live_…).' : 'Sandbox mode needs a test key (rzp_test_…).', { fields: { 'settings.keyId': 'Doesn’t match the mode' } })
      if (next.enabled && (!keyId || !next.secrets.keySecret?.v)) throw badRequest('Enter the key id and key secret before switching online payment on.', { fields: { 'secrets.keySecret': 'Required' } })
    },
  })
}

export async function testPayments(req) {
  const cfg = await getConfig(PROVIDER)
  try {
    const r = await razorpay.testConnection(cfg)
    await audit({ action: 'UPDATE', module: 'fees', entityType: 'integration', entityId: PROVIDER, entityName: 'Razorpay', summary: 'Tested the Razorpay connection: OK' }, req)
    return { ok: true, latencyMs: r.latencyMs, message: `Razorpay accepted the ${cfg.mode === 'LIVE' ? 'live' : 'test'} keys.` }
  } catch (err) {
    if (err instanceof AppError) throw err
    return { ok: false, message: err.message }
  }
}

// ───────────────────────────────────────────────────────── orders and links for a student's fees

const orderView = (o) => ({ ...clean(o), studentId: String(o.studentId), statusLabel: GATEWAY_ORDER_STATUSES[o.status]?.label, tone: GATEWAY_ORDER_STATUSES[o.status]?.tone })
const shortId = () => Math.random().toString(36).slice(2, 8)
const off = (status = 409) => new AppError(status, 'Online payment isn’t switched on (Fees › Online payments).', { code: 'INTEGRATION_OFF' })

async function payable(studentId) {
  const { due, student } = await amountDueNow(studentId)
  if (student.status !== 'ACTIVE') throw conflict('This student has left; take any payment at the counter.')
  if (due < MIN) throw conflict(`${studentName(student)} has nothing due.`)
  return { due, student }
}

/** Fee counter: a payment link for what a student owes now, optionally sent to the parent by SMS from Razorpay. */
export async function createPaymentLink(studentId, { notify = false, expiryHours = 72 } = {}, auth, req) {
  const gw = await activeGateway()
  if (!gw) throw off()
  const { due, student } = await payable(studentId)
  const open = await GatewayOrder.findOne({ studentId: student._id, kind: 'LINK', status: 'CREATED', amount: due, expiresAt: { $gt: new Date() } }).lean()
  if (open) return orderView(open)
  const tenant = await Tenant.findById(getContext().tenantId).select('name').lean()
  const g = student.guardians?.find((x) => x.isPrimary) ?? student.guardians?.[0]
  const mobile = mobile10(g?.mobile)
  let link
  try {
    link = await gw.adapter.createLink(gw.cfg, {
      amount: due, referenceId: `${student.admissionNo}-${shortId()}`, description: `${tenant?.name ?? 'School'} — fees of ${studentName(student)} (${student.admissionNo})`,
      customer: { name: (g?.name ?? studentName(student)).slice(0, 60), ...(mobile && { contact: `+91${mobile}` }) },
      notify: { sms: !!notify && !!mobile, email: false },
      expireBy: Math.floor(Date.now() / 1000) + Math.min(Math.max(expiryHours, 1), 24 * 30) * 3600,
      notes: { studentId: String(student._id), admissionNo: student.admissionNo },
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    throw providerFailed('Razorpay', err)
  }
  const order = await GatewayOrder.create({
    provider: gw.provider, kind: 'LINK', source: 'COUNTER', mode: gw.cfg.mode, studentId: student._id, studentName: studentName(student), admissionNo: student.admissionNo,
    branchId: student.branchId, amount: due, providerOrderId: link.id, shortUrl: link.shortUrl, expiresAt: new Date(Date.now() + expiryHours * 3600_000), createdBy: auth?.user?.name,
  })
  await audit({ action: 'CREATE', module: 'fees', entityType: 'gateway_order', entityId: String(order._id), entityName: student.admissionNo, studentId: student._id, summary: `Payment link for ${formatINR(due)} for ${studentName(student)}${notify ? ' (sent to the parent by SMS)' : ''}` }, req)
  return orderView(order.toObject())
}

/** Online tries for one student (the counter's ledger view). */
export async function studentGatewayOrders(studentId) {
  if (!isOid(studentId)) return []
  return (await GatewayOrder.find({ studentId }).sort({ createdAt: -1 }).limit(20).lean()).map(orderView)
}

/** Parent app: start Razorpay Checkout for one of the family's children. `f` is the family request (its students only). */
export async function createAppOrder(f, studentId) {
  if (!f.features.includes('FEES')) throw off(404)
  if (!f.students.some((s) => String(s._id) === String(studentId))) throw notFound('Student')
  const gw = await activeGateway()
  if (!gw) throw off(404)
  const { due, student } = await payable(studentId)
  let order = await GatewayOrder.findOne({ studentId: student._id, kind: 'ORDER', source: 'APP', status: 'CREATED', amount: due, createdAt: { $gte: new Date(Date.now() - 30 * 60_000) } }).lean()
  if (!order) {
    let made
    try {
      made = await gw.adapter.createOrder(gw.cfg, { amount: due, receipt: `${student.admissionNo}-${shortId()}`, notes: { studentId: String(student._id), admissionNo: student.admissionNo } })
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.warn({ err: err.message }, 'app fee order failed')
      throw new AppError(502, 'The payment service didn’t answer. Please try again in a minute.', { code: 'PROVIDER_ERROR' })
    }
    order = (await GatewayOrder.create({
      provider: gw.provider, kind: 'ORDER', source: 'APP', mode: gw.cfg.mode, studentId: student._id, studentName: studentName(student), admissionNo: student.admissionNo,
      branchId: student.branchId, amount: due, providerOrderId: made.id, createdBy: 'Parent app',
    })).toObject()
  }
  return {
    provider: gw.provider, keyId: gw.cfg.settings.keyId, orderId: order.providerOrderId, amount: order.amount, currency: 'INR',
    name: f.tenant?.name, description: `Fees · ${studentName(student)} (${student.admissionNo})`, prefill: { ...(mobile10(f.session?.mobile) && { contact: mobile10(f.session.mobile) }) },
  }
}

/** Parent app: Checkout's response. Signature first, then the gateway's own record of the payment. */
export async function verifyAppPayment(f, studentId, { orderId, paymentId, signature }) {
  if (!f.students.some((s) => String(s._id) === String(studentId))) throw notFound('Student')
  const gw = await activeGateway()
  if (!gw) throw off(404)
  const order = await GatewayOrder.findOne({ provider: gw.provider, providerOrderId: String(orderId), studentId: isOid(studentId) ? studentId : null }).lean()
  if (!order) throw notFound('Payment')
  if (!gw.adapter.verifyCheckout(gw.cfg, { orderId: order.providerOrderId, paymentId, signature })) {
    await logInbound({ provider: gw.provider, operation: 'checkout_callback', status: 'REJECTED', ref: order.providerOrderId, error: 'Signature does not match', entityType: 'student', entityId: String(order.studentId) })
    throw badRequest('We couldn’t confirm this payment. If money was taken, it will show in the app within a few minutes.')
  }
  await logInbound({ provider: gw.provider, operation: 'checkout_callback', status: 'OK', ref: paymentId, entityType: 'student', entityId: String(order.studentId) })
  const payment = await gw.adapter.fetchPayment(gw.cfg, paymentId)
  if (payment?.order_id !== order.providerOrderId) throw badRequest('This payment belongs to another order.')
  const done = await applyCapture(gw, order, payment)
  return { status: done.status, statusLabel: GATEWAY_ORDER_STATUSES[done.status]?.label, receiptNos: done.receiptNos ?? [] }
}

// ───────────────────────────────────────────────────────── applying a captured payment

const CLAIMABLE = ['CREATED', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED']

/** A payment the gateway reports for `order`: capture an authorised one, then make the fee receipt — once. */
async function applyCapture(gw, order, payment) {
  if (!payment?.id) return order
  if (payment.status === 'authorized') {
    try { payment = await gw.adapter.capture(gw.cfg, payment.id, payment.amount) } catch (err) { logger.warn({ err: err.message, payment: payment.id }, 'capture failed') }
  }
  if (payment.status !== 'captured') {
    if (payment.status === 'failed') await GatewayOrder.updateOne({ _id: order._id, status: 'CREATED' }, { $set: { status: 'FAILED', error: String(payment.error_description ?? 'Payment failed').slice(0, 300) } })
    return GatewayOrder.findById(order._id).lean()
  }
  const claimed = await GatewayOrder.findOneAndUpdate(
    { _id: order._id, status: { $in: CLAIMABLE } },
    { $set: { status: 'APPLYING', providerPaymentId: payment.id, method: String(payment.method ?? ''), paidAt: payment.created_at ? new Date(payment.created_at * 1000) : new Date(), error: undefined } },
    { new: true },
  ).lean()
  if (!claimed) return GatewayOrder.findById(order._id).lean() // someone else is applying it, or it is done
  return receipt(claimed, payment)
}

async function receipt(claimed, payment) {
  const review = async (msg) => {
    await GatewayOrder.updateOne({ _id: claimed._id, status: 'APPLYING' }, { $set: { status: 'NEEDS_REVIEW', error: msg.slice(0, 300) } })
    await logInbound({ provider: claimed.provider, operation: 'apply_payment', status: 'ERROR', ref: payment.id, entityType: 'student', entityId: String(claimed.studentId), error: msg })
    return GatewayOrder.findById(claimed._id).lean()
  }
  if (payment.currency && payment.currency !== 'INR') return review(`Paid in ${payment.currency}; only INR is receipted automatically.`)
  if (payment.amount !== claimed.amount) return review(`Paid ${formatINR(payment.amount)} but the order was for ${formatINR(claimed.amount)}.`)
  const existing = await FeePayment.find({ studentId: claimed.studentId, reference: payment.id }).select('receiptNo').lean()
  if (existing.length) {
    await GatewayOrder.updateOne({ _id: claimed._id }, { $set: { status: 'APPLIED', appliedAt: new Date(), receiptNos: existing.map((p) => p.receiptNo) } })
    return GatewayOrder.findById(claimed._id).lean()
  }
  // the school's own receipt, as at the counter; no collector, so it is in nobody's day-end cash
  const auth = { fullAccess: true, permissions: ['*'], userId: undefined, user: { name: `${ADAPTERS[claimed.provider]?.label ?? 'Gateway'} (online)` } }
  try {
    const r = await collect({
      studentId: String(claimed.studentId), amount: payment.amount, mode: GATEWAY_RECEIPT_MODE, reference: payment.id, waiveLateFee: false, online: true,
      note: `Online (${payment.method ?? 'gateway'}) · ${claimed.providerOrderId}`,
    }, auth, null)
    await GatewayOrder.updateOne({ _id: claimed._id }, { $set: { status: 'APPLIED', appliedAt: new Date(), receiptNos: [r.receiptNo] } })
    await logInbound({ provider: claimed.provider, operation: 'apply_payment', status: 'OK', ref: payment.id, entityType: 'student', entityId: String(claimed.studentId), summary: { admissionNo: claimed.admissionNo, amount: payment.amount, receiptNo: r.receiptNo } })
  } catch (err) {
    return review(err?.message ?? String(err))
  }
  return GatewayOrder.findById(claimed._id).lean()
}

// ───────────────────────────────────────────────────────── webhook

/** POST /api/v1/hooks/razorpay/:hookKey with the raw body → [httpStatus, body]. Signature on the raw bytes; each event once. */
export async function handleRazorpayWebhook(hookKey, rawBody, headers) {
  return asHookOwner(PROVIDER, hookKey, async (cfg) => {
    const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
    if (!razorpay.verifyWebhook(cfg, raw, headers['x-razorpay-signature'])) {
      await logInbound({ provider: PROVIDER, operation: 'webhook', status: 'REJECTED', error: secretOf(cfg, 'webhookSecret') ? 'Signature does not match' : 'No webhook secret saved' })
      return [400, { message: 'Invalid signature' }]
    }
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return [400, { message: 'Not JSON' }] }
    const eventId = String(headers['x-razorpay-event-id'] ?? '').slice(0, 80) || sha256(raw)
    try {
      await InboundEvent.create({ provider: PROVIDER, eventId, type: body.event })
    } catch (err) {
      if (err?.code !== 11000) throw err
      await logInbound({ provider: PROVIDER, operation: `webhook:${body.event}`, status: 'DUPLICATE', ref: eventId })
      return [200, { ok: true, duplicate: true }]
    }
    try {
      const outcome = await onEvent(cfg, body)
      await logInbound({ provider: PROVIDER, operation: `webhook:${body.event}`, status: 'OK', ref: eventId, entityType: outcome?.studentId ? 'student' : undefined, entityId: outcome?.studentId, summary: { event: body.event, outcome: outcome?.note } })
      await setHealth(PROVIDER, 'OK')
      return [200, { ok: true }]
    } catch (err) {
      await InboundEvent.deleteOne({ provider: PROVIDER, eventId }) // let Razorpay retry
      await logInbound({ provider: PROVIDER, operation: `webhook:${body.event}`, status: 'ERROR', ref: eventId, error: err?.message })
      logger.error({ err }, 'razorpay webhook failed')
      return [500, { message: 'Could not process' }]
    }
  })
}

async function onEvent(cfg, body) {
  const gw = { cfg, adapter: razorpay, provider: PROVIDER }
  const payment = body.payload?.payment?.entity
  const link = body.payload?.payment_link?.entity
  const refund = body.payload?.refund?.entity
  const find = async () => {
    if (link?.id) return GatewayOrder.findOne({ provider: PROVIDER, providerOrderId: link.id }).lean()
    if (payment?.order_id) return GatewayOrder.findOne({ provider: PROVIDER, providerOrderId: payment.order_id }).lean()
    return null
  }
  switch (body.event) {
    case 'payment.captured': case 'payment.authorized': case 'order.paid': case 'payment_link.paid': {
      const order = await find()
      if (!order) return { note: 'not one of ours' }
      const done = await applyCapture(gw, order, payment)
      return { studentId: String(order.studentId), note: done?.status }
    }
    case 'payment.failed': {
      const order = await find()
      if (!order) return { note: 'not one of ours' }
      await GatewayOrder.updateOne({ _id: order._id, status: 'CREATED' }, { $set: { error: String(payment?.error_description ?? 'Payment failed').slice(0, 300) } })
      return { studentId: String(order.studentId), note: 'attempt failed' }
    }
    case 'payment_link.expired': case 'payment_link.cancelled': {
      const order = await find()
      if (!order) return { note: 'not one of ours' }
      await GatewayOrder.updateOne({ _id: order._id, status: 'CREATED' }, { $set: { status: body.event.endsWith('expired') ? 'EXPIRED' : 'CANCELLED' } })
      return { studentId: String(order.studentId), note: body.event }
    }
    case 'refund.processed': case 'refund.failed': case 'refund.created': {
      if (!refund?.payment_id) return { note: 'no payment' }
      const order = await GatewayOrder.findOne({ provider: PROVIDER, providerPaymentId: refund.payment_id }).lean()
      if (!order) return { note: 'not one of ours' }
      const status = body.event.split('.')[1].toUpperCase()
      const known = (order.refunds ?? []).some((r) => r.refundId === refund.id)
      if (known) await GatewayOrder.updateOne({ _id: order._id, 'refunds.refundId': refund.id }, { $set: { 'refunds.$.status': status } })
      else await GatewayOrder.updateOne({ _id: order._id }, { $push: { refunds: { refundId: refund.id, amount: refund.amount, status, reason: 'From the Razorpay dashboard', by: 'Razorpay', at: new Date() } } })
      return { studentId: String(order.studentId), note: `refund ${status.toLowerCase()}` }
    }
    default:
      return { note: 'ignored' }
  }
}

// ───────────────────────────────────────────────────────── transactions (Fees › Online payments)

export async function listGatewayOrders(q, paging) {
  const filter = {}
  if (q.status) filter.status = q.status
  if (q.source) filter.source = q.source
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ admissionNo: re }, { studentName: re }, { providerOrderId: re }, { providerPaymentId: re }]
  }
  const [rows, total] = await Promise.all([GatewayOrder.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), GatewayOrder.countDocuments(filter)])
  return listResponse(rows.map(orderView), total, paging)
}

/** Ask the gateway what happened (a missed webhook, or a payment waiting for review). */
export async function syncGatewayOrder(id, req) {
  const order = isOid(id) ? await GatewayOrder.findById(id).lean() : null
  if (!order) throw notFound('Online payment')
  const cfg = await requireConfig(order.provider)
  const gw = { cfg, adapter: ADAPTERS[order.provider], provider: order.provider }
  let payments = []
  try {
    if (order.kind === 'LINK') {
      const r = await gw.adapter.linkPayments(cfg, order.providerOrderId)
      payments = r.payments
      if (!payments.length && ['expired', 'cancelled'].includes(r.status)) await GatewayOrder.updateOne({ _id: order._id, status: 'CREATED' }, { $set: { status: r.status === 'expired' ? 'EXPIRED' : 'CANCELLED' } })
    } else {
      payments = await gw.adapter.orderPayments(cfg, order.providerOrderId)
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    throw providerFailed('Razorpay', err)
  }
  const captured = payments.find((p) => p.status === 'captured') ?? payments.find((p) => p.status === 'authorized')
  if (captured) {
    if (order.status === 'NEEDS_REVIEW') await GatewayOrder.updateOne({ _id: order._id, status: 'NEEDS_REVIEW' }, { $set: { status: 'PAID' } })
    await applyCapture(gw, { ...order, status: 'PAID' }, captured)
  }
  await audit({ action: 'UPDATE', module: 'fees', entityType: 'gateway_order', entityId: String(order._id), entityName: order.admissionNo, studentId: order.studentId, summary: `Checked online payment ${order.providerOrderId} with the gateway` }, req)
  return orderView(await GatewayOrder.findById(order._id).lean())
}

export async function cancelGatewayLink(id, req) {
  const order = isOid(id) ? await GatewayOrder.findById(id).lean() : null
  if (!order) throw notFound('Online payment')
  if (order.kind !== 'LINK' || order.status !== 'CREATED') throw conflict('Only an unpaid payment link can be cancelled.')
  const cfg = await requireConfig(order.provider)
  try { await ADAPTERS[order.provider].cancelLink(cfg, order.providerOrderId) } catch (err) { if (err instanceof AppError) throw err; throw providerFailed('Razorpay', err) }
  await GatewayOrder.updateOne({ _id: order._id, status: 'CREATED' }, { $set: { status: 'CANCELLED' } })
  await audit({ action: 'CANCEL', module: 'fees', entityType: 'gateway_order', entityId: String(order._id), entityName: order.admissionNo, studentId: order.studentId, summary: `Cancelled payment link ${order.providerOrderId}` }, req)
  return orderView(await GatewayOrder.findById(order._id).lean())
}

/**
 * Return money at the gateway. This moves money only — record the refund in Fees › Refunds too, so the receipts and
 * the bank agree.
 */
export async function refundGatewayOrder(id, { amount, reason }, req) {
  if (!isOid(id) || !await GatewayOrder.exists({ _id: id })) throw notFound('Online payment')
  const now = new Date()
  const order = await GatewayOrder.findOneAndUpdate({ _id: id, $or: [{ refundingUntil: null }, { refundingUntil: { $lt: now } }] }, { $set: { refundingUntil: new Date(now.getTime() + 2 * 60_000) } }, { new: true }).lean()
  if (!order) throw conflict('A refund on this payment is already in progress. Wait a moment and refresh.')
  try {
    if (!order.providerPaymentId || !['APPLIED', 'NEEDS_REVIEW', 'REFUNDED'].includes(order.status)) throw conflict('Only a captured payment can be refunded.')
    const refunded = (order.refunds ?? []).filter((r) => r.status !== 'FAILED').reduce((s, r) => s + (r.amount ?? 0), 0)
    const left = order.amount - refunded
    const amt = amount ?? left
    if (amt < MIN || amt > left) throw badRequest(`You can refund up to ${formatINR(left)}.`, { fields: { amount: 'Too much' } })
    const cfg = await requireConfig(order.provider)
    let r
    try {
      r = await ADAPTERS[order.provider].refund(cfg, order.providerPaymentId, { amount: amt, notes: { admissionNo: order.admissionNo, reason: reason.slice(0, 200) }, receipt: `${order.admissionNo}-R${(order.refunds?.length ?? 0) + 1}` })
    } catch (err) {
      if (err instanceof AppError) throw err
      throw providerFailed('Razorpay', err)
    }
    await GatewayOrder.updateOne({ _id: order._id }, { $push: { refunds: { refundId: r.id, amount: amt, status: String(r.status ?? 'created').toUpperCase(), reason, by: getContext()?.userName, at: new Date() } }, ...(amt === left && { $set: { status: 'REFUNDED' } }) })
    await audit({ action: 'UPDATE', module: 'fees', entityType: 'gateway_order', entityId: String(order._id), entityName: order.admissionNo, studentId: order.studentId, summary: `Refunded ${formatINR(amt)} of online payment ${order.providerPaymentId}: ${reason}` }, req)
    return orderView(await GatewayOrder.findById(order._id).lean())
  } finally {
    await GatewayOrder.updateOne({ _id: order._id }, { $unset: { refundingUntil: 1 } })
  }
}

// ───────────────────────────────────────────────────────── sweep

/** Rows left APPLYING by a crash: a receipt with the payment id means it was applied; otherwise a person looks at it. */
export async function settleStuckPayments() {
  return runAsSystem(async () => {
    const stuck = await GatewayOrder.find({ status: 'APPLYING', updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }).limit(50).setOptions({ allTenants: true }).lean()
    for (const o of stuck) {
      await runAsTenant(o.tenantId, async () => {
        const paid = await FeePayment.find({ studentId: o.studentId, reference: o.providerPaymentId }).select('receiptNo').lean()
        await GatewayOrder.updateOne({ _id: o._id, status: 'APPLYING' }, paid.length
          ? { $set: { status: 'APPLIED', appliedAt: new Date(), receiptNos: paid.map((p) => p.receiptNo) } }
          : { $set: { status: 'NEEDS_REVIEW', error: 'Receipting was interrupted. Check the student’s fees, then use “Check with gateway”.' } })
      })
    }
    return stuck.length
  })
}
