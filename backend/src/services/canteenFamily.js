import { createHmac } from 'node:crypto'
import { CANTEEN_TAGS, CANTEEN_TOPUP_PRESETS, CANTEEN_TOPUP_STATUS, formatINR, mobile10, weekdayCode } from '@schoolgiant/shared'
import { CanteenItem, CanteenOrder, CanteenSpecial, CanteenTopup, WalletTxn } from '../models/canteen.js'
import { studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { withTransaction, isOid } from '../platform/db.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { logger } from '../platform/logger.js'
import { callProvider, getConfig, logInbound, safeEqual, secretOf } from './integrationsCommon.js'
import { need, studentFor } from './portal.js'
import {
  addDays, canteenSettings, cancelPreorder, itemView, moveWallet, orderView, placeOrder, setControls, spentOn, today, txnView, walletFor,
} from './canteen.js'

// The family app › Canteen: the child's wallet (balance and ledger), topping it up online through the school's own
// Razorpay account (the one Fees › Online payments sets up), the parent's controls (a daily limit; food ruled out by
// kind or by item) and pre-orders for the coming days.
//
// Online top-up, exactly once: Checkout's signed reply (or the Razorpay webhook — handed over by feePayments.js onEvent; see the wiring note) finds
// the CanteenTopup row by its Razorpay order id; ONE transaction flips it CREATED/FAILED → APPLIED and writes the wallet
// credit. A second reply for the same payment finds nothing to claim, and the ledger's unique gatewayPaymentId would
// refuse a second credit anyway. A payment that doesn't match the row (amount, currency) waits as NEEDS_REVIEW.

const RZP = 'https://api.razorpay.com/v1'
const PROVIDER = 'RAZORPAY'
const FEATURE = 'CANTEEN'

const parentOnly = (f) => { if (f.session?.kind === 'STUDENT') throw forbidden('Only a parent can change this.') }

// ───────────────────────────────────────────────────────── the canteen screen

export async function familyCanteen(f, id) {
  need(f, FEATURE)
  const s = studentFor(f, id)
  const [{ date, time }, set] = await Promise.all([today(), canteenSettings()])
  const until = addDays(date, set.preorderDays)
  const [wallet, ledger, items, specials, preorders, spent, cfg] = await Promise.all([
    walletFor(s._id),
    WalletTxn.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(30).lean(),
    CanteenItem.find({ active: true }).sort({ category: 1, order: 1, name: 1 }).lean(),
    CanteenSpecial.find({ date: { $gte: date, $lte: until } }).lean(),
    CanteenOrder.find({ studentId: s._id, source: 'PREORDER', date: { $gte: addDays(date, -7) } }).sort({ date: -1, createdAt: -1 }).limit(30).lean(),
    spentOn(s._id, date),
    getConfig(PROVIDER),
  ])
  const days = []
  for (let d = date; d <= until; d = addDays(d, 1)) days.push({ date: d, weekday: weekdayCode(d), open: d > date || time < set.preorderCutoff })
  return {
    date, cutoff: set.preorderCutoff,
    wallet: {
      balance: wallet.balance ?? 0, spentToday: spent, dailyLimit: wallet.dailyLimit ?? null, blockedItemIds: (wallet.blockedItemIds ?? []).map(String), blockedTags: wallet.blockedTags ?? [],
      low: (wallet.balance ?? 0) < set.lowBalance, lowBalance: set.lowBalance,
    },
    ledger: ledger.map(txnView),
    items: items.map((it) => itemView(it, date)),
    specials: specials.map((x) => ({ date: x.date, itemId: String(x.itemId), price: x.price ?? null, note: x.note ?? null })),
    days,
    preorders: preorders.map((o) => ({ ...orderView(o), canCancel: o.status === 'PLACED' && (o.date > date || time < set.preorderCutoff) })),
    tags: CANTEEN_TAGS.map((t) => t.value),
    topUp: { online: onlineOn(cfg), min: set.minTopUp, max: set.maxTopUp, presets: CANTEEN_TOPUP_PRESETS },
    canControl: f.session?.kind !== 'STUDENT',
  }
}

export async function familyControls(f, id, input, req) {
  need(f, FEATURE)
  parentOnly(f)
  const s = studentFor(f, id)
  return setControls(s._id, input, 'Parent (family app)', req)
}

export async function familyPreorder(f, id, { date, lines }, req) {
  need(f, FEATURE)
  const s = studentFor(f, id)
  const [{ date: now, time }, set] = await Promise.all([today(), canteenSettings()])
  if (date < now || date > addDays(now, set.preorderDays)) throw badRequest(`Pre-order for today up to ${set.preorderDays} days ahead.`, { fields: { date: 'Out of range' } })
  if (date === now && time >= set.preorderCutoff) throw conflict(`Pre-orders for today close at ${set.preorderCutoff}.`)
  return placeOrder({ studentId: s._id, lines, payMode: 'WALLET', date, source: 'PREORDER', placedBy: f.session?.kind === 'STUDENT' ? 'Student (family app)' : 'Parent (family app)' }, req)
}

export async function familyCancelPreorder(f, id, orderId, req) {
  need(f, FEATURE)
  const s = studentFor(f, id)
  const o = isOid(orderId) ? await CanteenOrder.findOne({ _id: orderId, studentId: s._id, source: 'PREORDER' }).lean() : null
  if (!o) throw notFound('Pre-order')
  const [{ date: now, time }, set] = await Promise.all([today(), canteenSettings()])
  if (o.date < now || (o.date === now && time >= set.preorderCutoff)) throw conflict('It is too late to cancel this pre-order.')
  return cancelPreorder(o, 'Cancelled in the family app', req)
}

// ───────────────────────────────────────────────────────── online top-up (the school's Razorpay)

const onlineOn = (cfg) => !!(cfg?.enabled && cfg.settings?.keyId && secretOf(cfg, 'keySecret'))
const off = () => new AppError(404, 'Online top-up isn’t switched on at your school. Top up at the canteen counter.', { code: 'INTEGRATION_OFF' })
const basic = (cfg) => `Basic ${Buffer.from(`${cfg.settings?.keyId ?? ''}:${secretOf(cfg, 'keySecret') ?? ''}`).toString('base64')}`
const rzp = (cfg, { operation, path, method = 'GET', body, idempotent, studentId }) => callProvider({
  provider: PROVIDER, operation, url: `${RZP}${path}`, method, body, idempotent, entity: { type: 'student', id: studentId }, healthOf: PROVIDER, headers: { Authorization: basic(cfg) }, refOf: (d) => d?.id,
})
const providerDown = (err) => {
  if (err instanceof AppError) return err
  logger.warn({ err: err?.message }, 'canteen top-up: gateway call failed')
  return new AppError(502, 'The payment service didn’t answer. Please try again in a minute.', { code: 'PROVIDER_ERROR' })
}

/** Parent app: start Razorpay Checkout for a wallet top-up. */
export async function familyTopupStart(f, id, { amount }) {
  need(f, FEATURE)
  const s = studentFor(f, id)
  const cfg = await getConfig(PROVIDER)
  if (!onlineOn(cfg)) throw off()
  const set = await canteenSettings()
  if (!Number.isInteger(amount) || amount < set.minTopUp || amount > set.maxTopUp) throw badRequest(`Top up between ${formatINR(set.minTopUp)} and ${formatINR(set.maxTopUp)}.`, { fields: { amount: 'Out of range' } })
  const w = await walletFor(s._id)
  if ((w.balance ?? 0) + amount > set.maxBalance) throw conflict(`A wallet can hold at most ${formatINR(set.maxBalance)}; it has ${formatINR(w.balance ?? 0)}.`)
  let row = await CanteenTopup.findOne({ studentId: s._id, status: 'CREATED', amount, createdAt: { $gte: new Date(Date.now() - 30 * 60_000) } }).lean()
  if (!row) {
    let made
    try {
      const { data } = await rzp(cfg, {
        operation: 'create_order', path: '/orders', method: 'POST', idempotent: false, studentId: String(s._id),
        body: { amount, currency: 'INR', receipt: `CW-${s.admissionNo}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 40), notes: { purpose: 'CANTEEN_TOPUP', studentId: String(s._id), admissionNo: s.admissionNo }, payment_capture: 1 },
      })
      made = data
    } catch (err) { throw providerDown(err) }
    row = (await CanteenTopup.create({ provider: PROVIDER, mode: cfg.mode, studentId: s._id, studentName: studentName(s), admissionNo: s.admissionNo, amount, providerOrderId: made.id, createdBy: 'Family app' })).toObject()
  }
  return {
    provider: PROVIDER, keyId: cfg.settings.keyId, orderId: row.providerOrderId, amount: row.amount, currency: 'INR',
    name: f.tenant?.name, description: `Canteen wallet · ${studentName(s)} (${s.admissionNo})`, prefill: { ...(mobile10(f.session?.mobile) && { contact: mobile10(f.session.mobile) }) },
  }
}

/** Parent app: Checkout's reply. The signature first, then Razorpay's own record of the payment. */
export async function familyTopupVerify(f, id, { orderId, paymentId, signature }) {
  need(f, FEATURE)
  const s = studentFor(f, id)
  const cfg = await getConfig(PROVIDER)
  if (!onlineOn(cfg)) throw off()
  const row = await CanteenTopup.findOne({ provider: PROVIDER, providerOrderId: String(orderId), studentId: s._id }).lean()
  if (!row) throw notFound('Top-up')
  const ok = safeEqual(createHmac('sha256', secretOf(cfg, 'keySecret')).update(`${row.providerOrderId}|${paymentId}`).digest('hex'), String(signature ?? '').toLowerCase())
  if (!ok) {
    await logInbound({ provider: PROVIDER, operation: 'canteen_checkout_callback', status: 'REJECTED', ref: row.providerOrderId, error: 'Signature does not match', entityType: 'student', entityId: String(s._id) })
    throw badRequest('We couldn’t confirm this payment. If money was taken, it will show in the wallet within a few minutes.')
  }
  let payment
  try { payment = (await rzp(cfg, { operation: 'fetch_payment', path: `/payments/${encodeURIComponent(paymentId)}`, studentId: String(s._id) })).data } catch (err) { throw providerDown(err) }
  if (payment?.order_id !== row.providerOrderId) throw badRequest('This payment belongs to another order.')
  const done = await applyTopup(cfg, row, payment)
  const w = await walletFor(s._id)
  return { status: done.status, statusLabel: CANTEEN_TOPUP_STATUS[done.status]?.label, balance: w.balance ?? 0 }
}

/** A payment Razorpay reports for a top-up row: capture an authorised one, then credit the wallet — once. */
async function applyTopup(cfg, row, payment) {
  if (!payment?.id) return row
  if (payment.status === 'authorized') {
    try { payment = (await rzp(cfg, { operation: 'capture_payment', path: `/payments/${encodeURIComponent(payment.id)}/capture`, method: 'POST', idempotent: false, body: { amount: payment.amount, currency: 'INR' }, studentId: String(row.studentId) })).data } catch (err) { logger.warn({ err: err?.message }, 'canteen capture failed') }
  }
  if (payment.status !== 'captured') {
    if (payment.status === 'failed') await CanteenTopup.updateOne({ _id: row._id, status: 'CREATED' }, { $set: { status: 'FAILED', error: String(payment.error_description ?? 'Payment failed').slice(0, 300) } })
    return CanteenTopup.findById(row._id).lean()
  }
  if ((payment.currency && payment.currency !== 'INR') || payment.amount !== row.amount) {
    await CanteenTopup.updateOne({ _id: row._id, status: { $in: ['CREATED', 'FAILED'] } }, { $set: { status: 'NEEDS_REVIEW', providerPaymentId: payment.id, error: `Paid ${formatINR(payment.amount)} ${payment.currency ?? ''} for a top-up of ${formatINR(row.amount)}.`.slice(0, 300) } })
    return CanteenTopup.findById(row._id).lean()
  }
  let txn = null
  try {
    txn = await withTransaction(async () => {
      const claimed = await CanteenTopup.findOneAndUpdate(
        { _id: row._id, status: { $in: ['CREATED', 'FAILED'] } },
        { $set: { status: 'APPLIED', providerPaymentId: payment.id, method: String(payment.method ?? ''), appliedAt: new Date(), error: undefined } },
        { new: true },
      ).lean()
      if (!claimed) return null // already applied (the other of webhook / browser got there first)
      const student = { _id: row.studentId, branchId: undefined }
      const r = await moveWallet({ student, type: 'TOP_UP', amount: payment.amount, mode: 'ONLINE', reference: payment.id, gatewayPaymentId: payment.id, date: (await today()).date, note: `Online (${payment.method ?? 'gateway'})` })
      await CanteenTopup.updateOne({ _id: row._id }, { $set: { txnId: r.txn._id } })
      return r.txn
    })
  } catch (err) {
    if (err?.code === 11000) return CanteenTopup.findById(row._id).lean() // this payment is already in the ledger
    await CanteenTopup.updateOne({ _id: row._id, status: { $in: ['CREATED', 'FAILED'] } }, { $set: { status: 'NEEDS_REVIEW', providerPaymentId: payment.id, error: String(err?.message ?? err).slice(0, 300) } })
    return CanteenTopup.findById(row._id).lean()
  }
  if (txn) {
    await emit('canteen.topup', { studentId: String(row.studentId), entity: { type: 'wallet_txn', id: txn._id }, data: { canteen: { amount: formatINR(txn.amount), balance: formatINR(txn.balanceAfter) } } })
    await logInbound({ provider: PROVIDER, operation: 'canteen_topup', status: 'OK', ref: payment.id, entityType: 'student', entityId: String(row.studentId), summary: { amount: payment.amount } })
    await audit({ action: 'CREATE', module: 'canteen', entityType: 'wallet_txn', entityId: String(txn._id), entityName: row.admissionNo, studentId: row.studentId, summary: `Online top-up of ${formatINR(txn.amount)} for ${row.studentName} (${payment.id}); balance ${formatINR(txn.balanceAfter)}` })
  }
  return CanteenTopup.findById(row._id).lean()
}

/**
 * Razorpay webhook hand-off (called from feePayments.js onEvent for an order that isn't a fee order — see the wiring
 * note). Runs inside the institution the hook belongs to. Returns { studentId, note } when the order is a canteen
 * top-up, else null.
 */
export async function canteenRazorpayEvent(cfg, body) {
  const payment = body?.payload?.payment?.entity
  if (!payment?.order_id) return null
  const row = await CanteenTopup.findOne({ provider: PROVIDER, providerOrderId: payment.order_id }).lean()
  if (!row) return null
  if (body.event === 'payment.failed') {
    await CanteenTopup.updateOne({ _id: row._id, status: 'CREATED' }, { $set: { error: String(payment.error_description ?? 'Payment failed').slice(0, 300) } })
    return { studentId: String(row.studentId), note: 'canteen top-up attempt failed' }
  }
  if (!['payment.captured', 'payment.authorized', 'order.paid'].includes(body.event)) return { studentId: String(row.studentId), note: 'ignored (canteen)' }
  const done = await applyTopup(cfg, row, payment)
  return { studentId: String(row.studentId), note: `canteen ${done?.status}` }
}

/** Wallets › an online top-up waiting for review: ask Razorpay again (a missed webhook, a mismatch put right). */
export async function recheckTopup(id, req) {
  const row = isOid(id) ? await CanteenTopup.findById(id).lean() : null
  if (!row) throw notFound('Online top-up')
  const cfg = await getConfig(PROVIDER)
  if (!onlineOn(cfg)) throw off()
  let payments
  try { payments = (await rzp(cfg, { operation: 'fetch_order_payments', path: `/orders/${encodeURIComponent(row.providerOrderId)}/payments`, studentId: String(row.studentId) })).data?.items ?? [] } catch (err) { throw providerDown(err) }
  const captured = payments.find((p) => p.status === 'captured') ?? payments.find((p) => p.status === 'authorized')
  if (captured && row.status !== 'APPLIED') {
    if (row.status === 'NEEDS_REVIEW') await CanteenTopup.updateOne({ _id: row._id, status: 'NEEDS_REVIEW' }, { $set: { status: 'FAILED' } }) // claimable again
    await applyTopup(cfg, { ...row, status: 'FAILED' }, captured)
  }
  await audit({ action: 'UPDATE', module: 'canteen', entityType: 'canteen_topup', entityId: String(row._id), entityName: row.admissionNo, studentId: row.studentId, summary: `Checked online top-up ${row.providerOrderId} with Razorpay` }, req)
  return CanteenTopup.findById(row._id).lean()
}
