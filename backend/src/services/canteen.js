import {
  CANTEEN_DEFAULTS, CANTEEN_TAG_VALUES, DOC_TYPE_BY_CODE, canteenBlockReason, canteenSoldOn, canteenTotal, canteenWalletCheck, formatINR, sectionLabel, weekdayCode,
} from '@schoolgiant/shared'
import mongoose from 'mongoose'
import { ClassLevel, Section } from '../models/academics.js'
import { CanteenItem, CanteenOrder, CanteenSpecial, CanteenTopup, CanteenWallet, WalletTxn } from '../models/canteen.js'
import { Student, studentName } from '../models/students.js'
import { TenantCounter } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'

// Canteen & wallet (module `canteen`): the menu and daily specials, the counter (find a student by card, admission
// number or name; sell from the wallet or for cash), pre-orders (placed by families in the app, made ready and
// collected at the counter), and one wallet per student.
//
// The wallet: the balance lives on CanteenWallet and every change is ONE append-only WalletTxn row written in the same
// transaction (balanceAfter on each row), so the ledger always adds up to the balance. A debit is a conditional
// update (balance ≥ amount) — two counters can't overspend the same wallet. The family's controls (a daily spend limit,
// items or kinds of food ruled out) apply at the counter and to pre-orders alike. Finance hears canteen.topup,
// canteen.refund and canteen.sale (see the wiring note); the family hears canteen.low_balance once per dip.

const MODULE = 'canteen'
const idStr = (v) => (v ? String(v) : null)
const who = () => getContext()?.userName ?? 'Staff'

/** Code defaults (paise), overridden by Settings › Canteen once wired (rupee keys: lowBalanceRs …; see canteen.md). */
export async function canteenSettings() {
  const own = (await getSettings(MODULE).catch(() => ({}))) ?? {}
  const out = { ...CANTEEN_DEFAULTS }
  for (const k of ['lowBalance', 'minTopUp', 'maxTopUp', 'maxBalance']) if (Number.isFinite(own[`${k}Rs`])) out[k] = Math.round(own[`${k}Rs`] * 100)
  if (Number.isInteger(own.preorderDays)) out.preorderDays = own.preorderDays
  if (typeof own.preorderCutoff === 'string' && /^\d{2}:\d{2}$/.test(own.preorderCutoff)) out.preorderCutoff = own.preorderCutoff
  return out
}

export const today = async () => institutionNow()

/** A human number from the number-series engine; falls back to a plain yearly counter until the series is set up. */
async function numberFor(docType, prefix, date) {
  if (DOC_TYPE_BY_CODE?.[docType]) return nextNumber(docType, { date: new Date(`${date}T12:00:00Z`) })
  const yy = date.slice(2, 4)
  const c = await TenantCounter.findOneAndUpdate({ docType, scope: 'ALL', period: date.slice(0, 4) }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  return `${prefix}${yy}${String(c.seq).padStart(6, '0')}`
}

async function placesOf(students) {
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })]))
}

// ───────────────────────────────────────────────────────── menu

const soldOutToday = (it, day) => !!it.soldOut && it.soldOutOn === day

export const itemView = (it, day) => ({
  id: String(it._id), name: it.name, category: it.category, price: it.price, mark: it.mark, tags: it.tags ?? [], days: it.days ?? [],
  description: it.description ?? null, active: it.active !== false, order: it.order ?? 0, soldOut: day ? soldOutToday(it, day) : !!it.soldOut,
})

export async function listMenu() {
  const { date } = await today()
  const [items, sold] = await Promise.all([
    CanteenItem.find().sort({ category: 1, order: 1, name: 1 }).lean(),
    CanteenOrder.aggregate([
      { $match: { status: { $ne: 'CANCELLED' }, date: { $gte: addDays(date, -30) } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.itemId', qty: { $sum: '$lines.qty' } } },
    ]),
  ])
  const qty = new Map(sold.map((s) => [String(s._id), s.qty]))
  return { date, items: items.map((it) => ({ ...itemView(it, date), sold30: qty.get(String(it._id)) ?? 0 })) }
}

export async function saveItem(id, input, req) {
  const before = id ? (isOid(id) ? await CanteenItem.findById(id).lean() : null) : null
  if (id && !before) throw notFound('Menu item')
  if (input.tags) input.tags = [...new Set(input.tags.filter((t) => CANTEEN_TAG_VALUES.includes(t)))]
  if (input.name && await CanteenItem.exists({ name: new RegExp(`^${escapeRegex(input.name)}$`, 'i'), ...(id && { _id: { $ne: id } }) })) {
    throw badRequest('There is already an item with this name.', { fields: { name: 'Already on the menu' } })
  }
  let doc
  if (id) {
    doc = await CanteenItem.findByIdAndUpdate(id, { $set: { ...input, updatedBy: who() } }, { new: true }).lean()
  } else {
    doc = (await CanteenItem.create({ ...input, createdBy: who() })).toObject()
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: MODULE, entityType: 'canteen_item', entityId: String(doc._id), entityName: doc.name, summary: `${id ? 'Changed' : 'Added'} menu item ${doc.name} (${formatINR(doc.price)})` }, req)
  return itemView(doc, (await today()).date)
}

export async function deleteItem(id, req) {
  const it = isOid(id) ? await CanteenItem.findById(id).lean() : null
  if (!it) throw notFound('Menu item')
  if (await CanteenOrder.exists({ 'lines.itemId': it._id })) {
    // past orders keep their own copy of the line; the item is only taken off the menu
    await CanteenItem.updateOne({ _id: it._id }, { $set: { active: false, updatedBy: who() } })
    await audit({ action: 'UPDATE', module: MODULE, entityType: 'canteen_item', entityId: String(it._id), entityName: it.name, summary: `Took ${it.name} off the menu (it has past orders, so it is kept)` }, req)
    return { deleted: false, deactivated: true }
  }
  await CanteenItem.deleteOne({ _id: it._id })
  await CanteenSpecial.deleteMany({ itemId: it._id })
  await audit({ action: 'DELETE', module: MODULE, entityType: 'canteen_item', entityId: String(it._id), entityName: it.name, summary: `Deleted menu item ${it.name}` }, req)
  return { deleted: true }
}

/** Today's counter: switch an item off when it runs out (it is back on by itself tomorrow). */
export async function setSoldOut(id, soldOut, req) {
  const it = isOid(id) ? await CanteenItem.findById(id).lean() : null
  if (!it) throw notFound('Menu item')
  const { date } = await today()
  await CanteenItem.updateOne({ _id: it._id }, soldOut ? { $set: { soldOut: true, soldOutOn: date } } : { $set: { soldOut: false }, $unset: { soldOutOn: 1 } })
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'canteen_item', entityId: String(it._id), entityName: it.name, summary: soldOut ? `${it.name} sold out for today` : `${it.name} back on sale` }, req)
  return itemView(await CanteenItem.findById(it._id).lean(), date)
}

// ───────────────────────────────────────────────────────── daily specials

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function listSpecials({ from, to } = {}) {
  const { date } = await today()
  const f = from ?? date
  const t = to ?? addDays(f, 6)
  const rows = await CanteenSpecial.find({ date: { $gte: f, $lte: t } }).sort({ date: 1 }).lean()
  const items = new Map((await CanteenItem.find({ _id: { $in: rows.map((r) => r.itemId) } }).lean()).map((i) => [String(i._id), i]))
  return rows.filter((r) => items.has(String(r.itemId))).map((r) => {
    const it = items.get(String(r.itemId))
    return { id: String(r._id), date: r.date, itemId: String(r.itemId), name: it.name, category: it.category, mark: it.mark, menuPrice: it.price, price: r.price ?? it.price, note: r.note ?? null }
  })
}

export async function saveSpecial({ date, itemId, price, note }, req) {
  const it = isOid(itemId) ? await CanteenItem.findById(itemId).lean() : null
  if (!it || it.active === false) throw badRequest('Pick an item on the menu.', { fields: { itemId: 'Not on the menu' } })
  const row = await CanteenSpecial.findOneAndUpdate({ date, itemId: it._id }, { $set: { price: price ?? undefined, note: note || undefined, createdBy: who() } }, { upsert: true, new: true }).lean()
  await audit({ action: 'CREATE', module: MODULE, entityType: 'canteen_special', entityId: String(row._id), entityName: it.name, summary: `${it.name} is the special on ${date}${price != null ? ` at ${formatINR(price)}` : ''}` }, req)
  return (await listSpecials({ from: date, to: date })).find((s) => s.id === String(row._id))
}

export async function deleteSpecial(id, req) {
  const row = isOid(id) ? await CanteenSpecial.findById(id).lean() : null
  if (!row) throw notFound('Special')
  await CanteenSpecial.deleteOne({ _id: row._id })
  await audit({ action: 'DELETE', module: MODULE, entityType: 'canteen_special', entityId: String(row._id), entityName: row.date, summary: `Removed a special on ${row.date}` }, req)
  return { deleted: true }
}

/** What is on sale on a day: the items sold that weekday, at the special price where there is one. */
export async function menuFor(date, { forFamily = false } = {}) {
  const { date: now } = await today()
  const wd = weekdayCode(date)
  const [items, specials] = await Promise.all([CanteenItem.find({ active: true }).sort({ category: 1, order: 1, name: 1 }).lean(), CanteenSpecial.find({ date }).lean()])
  const sp = new Map(specials.map((s) => [String(s.itemId), s]))
  return items.filter((it) => canteenSoldOn(it, wd) || sp.has(String(it._id))).map((it) => {
    const s = sp.get(String(it._id))
    const v = itemView(it, now)
    return { ...v, soldOut: date === now && v.soldOut, price: s?.price ?? it.price, menuPrice: it.price, special: !!s, specialNote: s?.note ?? null, ...(forFamily && { order: undefined }) }
  })
}

// ───────────────────────────────────────────────────────── wallets

const controlsOf = (w) => ({ dailyLimit: w?.dailyLimit ?? null, blockedItemIds: (w?.blockedItemIds ?? []).map(String), blockedTags: w?.blockedTags ?? [] })

/** What a student has spent from the wallet on a day (pre-orders count on the day they are for). */
export async function spentOn(studentId, date) {
  const [r] = await CanteenOrder.aggregate([
    { $match: { studentId: new mongoose.Types.ObjectId(String(studentId)), date, payMode: 'WALLET', status: { $ne: 'CANCELLED' } } },
    { $group: { _id: null, total: { $sum: '$total' } } },
  ])
  return r?.total ?? 0
}

export async function walletFor(studentId) {
  return (await CanteenWallet.findOne({ studentId }).lean()) ?? { studentId, balance: 0, dailyLimit: null, blockedItemIds: [], blockedTags: [] }
}

/**
 * Move money in or out of a wallet: the balance and its ledger row together, in one transaction.
 * `amount` is signed (+ in, − out); out never takes the balance below 0, in never above `max` (when given).
 */
export async function moveWallet({ student, type, amount, mode, reference, orderId, orderNo, gatewayPaymentId, note, date, max }) {
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('Enter an amount.')
  return withTransaction(async () => {
    await CanteenWallet.updateOne({ studentId: student._id }, { $setOnInsert: { balance: 0 } }, { upsert: true })
    const filter = { studentId: student._id, ...(amount < 0 && { balance: { $gte: -amount } }), ...(amount > 0 && max && { balance: { $lte: max - amount } }) }
    const set = { lastTxnAt: new Date(), ...(type === 'TOP_UP' && { lowAlertSent: false }) }
    const wallet = await CanteenWallet.findOneAndUpdate(filter, { $inc: { balance: amount }, $set: set }, { new: true }).lean()
    if (!wallet) {
      const w = await CanteenWallet.findOne({ studentId: student._id }).lean()
      if (amount < 0) throw conflict(`Not enough in the wallet: ${formatINR(w?.balance ?? 0)} left.`, { code: 'NO_BALANCE', balance: w?.balance ?? 0 })
      throw conflict(`A wallet can hold at most ${formatINR(max)}; it has ${formatINR(w?.balance ?? 0)}.`, { code: 'OVER_MAX' })
    }
    const [txn] = await WalletTxn.create([{
      studentId: student._id, branchId: student.branchId, type, amount, balanceAfter: wallet.balance, date, mode, reference: reference || undefined,
      orderId, orderNo, gatewayPaymentId, note: note || undefined, by: who(),
    }])
    return { wallet, txn: txn.toObject() }
  })
}

/** Told once when the wallet falls below the school's low-balance mark (again after the next top-up). */
export async function lowBalanceCheck(studentId) {
  const s = await canteenSettings()
  const w = await CanteenWallet.findOneAndUpdate({ studentId, balance: { $lt: s.lowBalance }, lowAlertSent: { $ne: true } }, { $set: { lowAlertSent: true } }, { new: true }).lean()
  if (!w) return false
  await emit('canteen.low_balance', { studentId: String(studentId), entity: { type: 'canteen_wallet', id: w._id }, data: { canteen: { balance: formatINR(w.balance), threshold: formatINR(s.lowBalance) } } })
  return true
}

export const txnView = (t) => ({
  id: String(t._id), type: t.type, amount: t.amount, balanceAfter: t.balanceAfter, date: t.date, mode: t.mode ?? null, reference: t.reference ?? null,
  orderNo: t.orderNo ?? null, note: t.note ?? null, by: t.by ?? null, at: t.createdAt,
})

async function studentOr404(studentId, { active = false } = {}) {
  const s = isOid(studentId) ? await Student.findById(studentId).lean() : null
  if (!s) throw notFound('Student')
  if (active && s.status !== 'ACTIVE') throw conflict(`${studentName(s)} is not a current student.`)
  return s
}

/** Counter search: a card swipe (the ID card's code), an admission number, or part of a name. */
export async function findStudents(q) {
  const term = String(q ?? '').trim()
  if (!term) return []
  let rows = await Student.find({ status: 'ACTIVE', $or: [{ cardCode: term }, { cardCode: term.toUpperCase() }, { admissionNo: new RegExp(`^${escapeRegex(term)}$`, 'i') }] }).select('+photo').limit(2).lean()
  const exact = rows.length === 1
  if (!rows.length && term.length >= 2) {
    const re = new RegExp(escapeRegex(term), 'i')
    rows = await Student.find({ status: 'ACTIVE', $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }).sort({ firstName: 1 }).limit(8).lean()
  }
  return studentCards(rows, { withPhoto: exact })
}

async function studentCards(rows, { withPhoto = false } = {}) {
  if (!rows.length) return []
  const { date } = await today()
  const [places, wallets, spent] = await Promise.all([
    placesOf(rows),
    CanteenWallet.find({ studentId: { $in: rows.map((s) => s._id) } }).lean(),
    CanteenOrder.aggregate([{ $match: { studentId: { $in: rows.map((s) => s._id) }, date, payMode: 'WALLET', status: { $ne: 'CANCELLED' } } }, { $group: { _id: '$studentId', total: { $sum: '$total' } } }]),
  ])
  const w = new Map(wallets.map((x) => [String(x.studentId), x]))
  const sp = new Map(spent.map((x) => [String(x._id), x.total]))
  return rows.map((s) => ({
    id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, place: places.get(String(s.sectionId)) ?? null, photo: withPhoto ? (s.photo ?? null) : null,
    balance: w.get(String(s._id))?.balance ?? 0, spentToday: sp.get(String(s._id)) ?? 0, ...controlsOf(w.get(String(s._id))),
  }))
}

export async function listWallets({ search, filter, page = 1, pageSize = 50 }) {
  const s = await canteenSettings()
  const { date } = await today()
  let rows
  let total
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i')
    const students = await Student.find({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }, { cardCode: search }] }).sort({ firstName: 1 }).limit(pageSize).lean()
    rows = await studentCards(students)
    total = rows.length
  } else {
    const f = filter === 'LOW' ? { balance: { $lt: s.lowBalance } } : filter === 'LIMITED' ? { $or: [{ dailyLimit: { $gt: 0 } }, { 'blockedTags.0': { $exists: true } }, { 'blockedItemIds.0': { $exists: true } }] } : {}
    const [wallets, n] = await Promise.all([CanteenWallet.find(f).sort({ balance: filter === 'LOW' ? 1 : -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), CanteenWallet.countDocuments(f)])
    const students = new Map((await Student.find({ _id: { $in: wallets.map((w) => w.studentId) } }).lean()).map((x) => [String(x._id), x]))
    const cards = new Map((await studentCards([...students.values()])).map((c) => [c.id, c]))
    rows = wallets.map((w) => cards.get(String(w.studentId))).filter(Boolean)
    total = n
  }
  const [held] = await CanteenWallet.aggregate([{ $group: { _id: null, total: { $sum: '$balance' }, n: { $sum: 1 }, low: { $sum: { $cond: [{ $lt: ['$balance', s.lowBalance] }, 1, 0] } } } }])
  const todayTx = await WalletTxn.aggregate([{ $match: { date } }, { $group: { _id: '$type', amount: { $sum: '$amount' }, n: { $sum: 1 } } }])
  const by = Object.fromEntries(todayTx.map((x) => [x._id, { amount: Math.abs(x.amount), count: x.n }]))
  const review = await CanteenTopup.countDocuments({ status: 'NEEDS_REVIEW' })
  return {
    rows: rows.map((r) => ({ ...r, low: r.balance < s.lowBalance })), total, page, pageSize,
    stats: { held: held?.total ?? 0, wallets: held?.n ?? 0, low: held?.low ?? 0, topUpsToday: by.TOP_UP?.amount ?? 0, spentToday: by.PURCHASE?.amount ?? 0, refundsToday: by.REFUND?.amount ?? 0, needsReview: review },
    lowBalance: s.lowBalance,
  }
}

export async function walletDetail(studentId) {
  const s = isOid(studentId) ? await Student.findById(studentId).select('+photo').lean() : null
  if (!s) throw notFound('Student')
  const [card] = await studentCards([s], { withPhoto: true })
  const [ledger, orders, online, settings] = await Promise.all([
    WalletTxn.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(100).lean(),
    CanteenOrder.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(15).lean(),
    CanteenTopup.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(10).lean(),
    canteenSettings(),
  ])
  return {
    student: card, ledger: ledger.map(txnView), orders: orders.map(orderView),
    online: online.map((o) => ({ id: String(o._id), amount: o.amount, status: o.status, paymentId: o.providerPaymentId ?? null, error: o.error ?? null, at: o.createdAt })),
    settings: { lowBalance: settings.lowBalance, minTopUp: settings.minTopUp, maxTopUp: settings.maxTopUp, maxBalance: settings.maxBalance },
  }
}

/** Counter top-up (cash or UPI at the counter). */
export async function topUpAtCounter(studentId, { amount, mode, reference }, req) {
  const s = await studentOr404(studentId, { active: true })
  const set = await canteenSettings()
  if (amount < set.minTopUp || amount > set.maxTopUp) throw badRequest(`Top up between ${formatINR(set.minTopUp)} and ${formatINR(set.maxTopUp)}.`, { fields: { amount: 'Out of range' } })
  const { date } = await today()
  const { wallet, txn } = await moveWallet({ student: s, type: 'TOP_UP', amount, mode, reference, date, max: set.maxBalance, note: 'At the counter' })
  await emit('canteen.topup', { studentId: String(s._id), entity: { type: 'wallet_txn', id: txn._id }, data: { canteen: { amount: formatINR(amount), balance: formatINR(wallet.balance) } } })
  await audit({ action: 'CREATE', module: MODULE, entityType: 'wallet_txn', entityId: String(txn._id), entityName: s.admissionNo, studentId: s._id, summary: `Topped up ${studentName(s)}'s canteen wallet with ${formatINR(amount)} (${mode}); balance ${formatINR(wallet.balance)}` }, req)
  return { balance: wallet.balance, txn: txnView(txn) }
}

/** Give wallet money back to the family (cash or bank) — sensitive: canteen.wallet.refund. */
export async function refundWallet(studentId, { amount, mode, reference, reason }, req) {
  const s = await studentOr404(studentId)
  const w = await walletFor(s._id)
  const amt = amount ?? w.balance
  if (!amt || amt <= 0) throw conflict('There is nothing in this wallet to refund.')
  if (amt > w.balance) throw badRequest(`You can refund up to ${formatINR(w.balance)}.`, { fields: { amount: 'More than the balance' } })
  const { date } = await today()
  const { wallet, txn } = await moveWallet({ student: s, type: 'REFUND', amount: -amt, mode, reference, date, note: reason })
  await emit('canteen.refund', { studentId: String(s._id), entity: { type: 'wallet_txn', id: txn._id }, data: { canteen: { amount: formatINR(amt), balance: formatINR(wallet.balance) } } })
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'wallet_txn', entityId: String(txn._id), entityName: s.admissionNo, studentId: s._id, summary: `Refunded ${formatINR(amt)} from ${studentName(s)}'s canteen wallet (${mode}): ${reason}` }, req)
  return { balance: wallet.balance, txn: txnView(txn) }
}

/** Put a mistake right: a signed ADJUSTMENT row (the ledger itself is never edited). */
export async function adjustWallet(studentId, { amount, reason }, req) {
  const s = await studentOr404(studentId)
  const { date } = await today()
  const { wallet, txn } = await moveWallet({ student: s, type: 'ADJUSTMENT', amount, date, note: reason })
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'wallet_txn', entityId: String(txn._id), entityName: s.admissionNo, studentId: s._id, summary: `Adjusted ${studentName(s)}'s canteen wallet by ${amount > 0 ? '+' : ''}${formatINR(amount)}: ${reason}` }, req)
  if (amount < 0) await lowBalanceCheck(s._id)
  return { balance: wallet.balance, txn: txnView(txn) }
}

/** The family's controls: a daily spend limit and food ruled out (by item or by kind). */
export async function setControls(studentId, { dailyLimit, blockedItemIds, blockedTags }, by, req) {
  const s = await studentOr404(studentId)
  const set = { controlsBy: by, controlsAt: new Date() }
  if (dailyLimit !== undefined) set.dailyLimit = dailyLimit && dailyLimit > 0 ? dailyLimit : null
  if (blockedTags !== undefined) set.blockedTags = [...new Set(blockedTags.filter((t) => CANTEEN_TAG_VALUES.includes(t)))]
  if (blockedItemIds !== undefined) {
    const ids = [...new Set(blockedItemIds.filter(isOid))]
    set.blockedItemIds = (await CanteenItem.find({ _id: { $in: ids } }).select('_id').lean()).map((x) => x._id)
  }
  const w = await CanteenWallet.findOneAndUpdate({ studentId: s._id }, { $set: set, $setOnInsert: { balance: 0 } }, { upsert: true, new: true }).lean()
  const parts = [set.dailyLimit !== undefined && (set.dailyLimit ? `daily limit ${formatINR(set.dailyLimit)}` : 'no daily limit'), set.blockedTags && `blocked kinds: ${set.blockedTags.join(', ') || 'none'}`, set.blockedItemIds && `${set.blockedItemIds.length} item(s) blocked`].filter(Boolean)
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'canteen_wallet', entityId: String(w._id), entityName: s.admissionNo, studentId: s._id, summary: `Canteen controls for ${studentName(s)} by ${by}: ${parts.join('; ')}` }, req)
  return controlsOf(w)
}

// ───────────────────────────────────────────────────────── orders

export const orderView = (o) => ({
  id: String(o._id), orderNo: o.orderNo, date: o.date, source: o.source, status: o.status, payMode: o.payMode, total: o.total,
  studentId: idStr(o.studentId), studentName: o.studentName ?? null, admissionNo: o.admissionNo ?? null,
  lines: (o.lines ?? []).map((l) => ({ itemId: idStr(l.itemId), name: l.name, category: l.category, mark: l.mark, price: l.price, qty: l.qty })),
  placedBy: o.placedBy ?? null, at: o.createdAt, readyAt: o.readyAt ?? null, collectedAt: o.collectedAt ?? null, cancelledAt: o.cancelledAt ?? null, cancelReason: o.cancelReason ?? null,
})

/**
 * Price and check an order: every item on sale that day (and not sold out, for today), nothing the family ruled out,
 * and — paid from the wallet — enough balance and room under the day's limit. Returns { lines, total }.
 */
async function priceOrder({ student, wallet, lines, date, payMode }) {
  const { date: now } = await today()
  const menu = new Map((await menuFor(date)).map((m) => [m.id, m]))
  const merged = new Map()
  for (const l of lines) merged.set(String(l.itemId), (merged.get(String(l.itemId)) ?? 0) + l.qty)
  const out = []
  const problems = []
  const controls = controlsOf(wallet)
  for (const [itemId, qty] of merged) {
    const m = menu.get(itemId)
    if (!m) { problems.push(`an item that isn't on the menu that day`); continue }
    if (m.soldOut && date === now) { problems.push(`${m.name} is sold out`); continue }
    if (student && canteenBlockReason(m, controls)) { problems.push(`${m.name} is blocked by the family`); continue }
    out.push({ itemId: m.id, name: m.name, category: m.category, mark: m.mark, price: m.price, qty })
  }
  if (problems.length) throw badRequest(`This order can't go through: ${problems.join(', ')}.`, { code: 'ORDER_REFUSED', problems })
  if (!out.length) throw badRequest('Add at least one item.')
  const total = canteenTotal(out)
  if (payMode === 'WALLET') {
    const why = canteenWalletCheck({ balance: wallet.balance ?? 0, dailyLimit: wallet.dailyLimit, spentToday: await spentOn(student._id, date) }, total)
    if (why?.code === 'NO_BALANCE') throw conflict(`Not enough in the wallet: ${formatINR(wallet.balance ?? 0)} for an order of ${formatINR(total)}.`, { code: 'NO_BALANCE', short: why.short })
    if (why?.code === 'OVER_LIMIT') throw conflict(`Over the daily limit the family set: ${formatINR(why.left)} left for ${date === now ? 'today' : date}.`, { code: 'OVER_LIMIT', left: why.left })
  }
  return { lines: out, total }
}

/** Make an order (counter sale or pre-order) and, from the wallet, take the money — together. */
export async function placeOrder({ studentId, lines, payMode, date, source = 'COUNTER', placedBy }, req) {
  const student = studentId ? await studentOr404(studentId, { active: true }) : null
  if (payMode === 'WALLET' && !student) throw badRequest('Find the student to pay from the wallet, or take cash.')
  const wallet = student ? await walletFor(student._id) : null
  const priced = await priceOrder({ student, wallet, lines, date, payMode })
  const order = await withTransaction(async () => {
    const orderNo = await numberFor('CANTEEN_ORDER', 'CN', date)
    const [o] = await CanteenOrder.create([{
      orderNo, date, source, studentId: student?._id, studentName: student ? studentName(student) : undefined, admissionNo: student?.admissionNo, branchId: student?.branchId,
      lines: priced.lines, total: priced.total, payMode, status: source === 'PREORDER' ? 'PLACED' : 'SERVED', placedBy: placedBy ?? who(),
    }])
    if (payMode === 'WALLET') {
      const { txn } = await moveWallet({ student, type: 'PURCHASE', amount: -priced.total, date: (await today()).date, orderId: o._id, orderNo, note: source === 'PREORDER' ? `Pre-order for ${date}` : undefined })
      o.txnId = txn._id
      await o.save()
    }
    return o.toObject()
  })
  await emit('canteen.sale', { entity: { type: 'canteen_order', id: order._id } })
  if (payMode === 'WALLET') await lowBalanceCheck(student._id)
  await audit({ action: 'CREATE', module: MODULE, entityType: 'canteen_order', entityId: String(order._id), entityName: order.orderNo, ...(student && { studentId: student._id }), summary: `${source === 'PREORDER' ? `Pre-order for ${date}` : 'Counter sale'} ${order.orderNo}: ${formatINR(order.total)} (${payMode === 'WALLET' ? 'wallet' : 'cash'})${student ? ` — ${studentName(student)}` : ''}` }, req)
  return orderView(order)
}

export async function counterSale({ studentId, lines, payMode }, req) {
  const { date } = await today()
  return placeOrder({ studentId, lines, payMode, date, source: 'COUNTER' }, req)
}

/** Orders with the student's class / section (place). */
async function withPlaces(rows) {
  const students = await Student.find({ _id: { $in: rows.map((r) => r.studentId).filter(Boolean) } }).select('sectionId').lean()
  const places = await placesOf(students)
  const secOf = new Map(students.map((s) => [String(s._id), places.get(String(s.sectionId)) ?? null]))
  return rows.map((o) => ({ ...orderView(o), place: secOf.get(String(o.studentId)) ?? null }))
}

/** One page of a day's orders, newest first. The day's totals are daySummary (over the whole day). */
export async function listOrders({ date, source, status, page = 1, pageSize = 50 }) {
  const d = date ?? (await today()).date
  const f = { date: d, ...(source && { source }), ...(status && { status }) }
  const [rows, total] = await Promise.all([
    CanteenOrder.find(f).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    CanteenOrder.countDocuments(f),
  ])
  return { date: d, rows: await withPlaces(rows), total, page, pageSize }
}

/** Every pre-order for a day, for the counter's board (unpaged: at most a few per student). */
export async function preorderBoard(date) {
  const d = date ?? (await today()).date
  const rows = await CanteenOrder.find({ date: d, source: 'PREORDER' }).sort({ createdAt: -1, _id: -1 }).lean()
  return { date: d, rows: await withPlaces(rows) }
}

/** Pre-order at the counter: PLACED → READY → COLLECTED. */
export async function moveOrder(id, to, req) {
  const o = isOid(id) ? await CanteenOrder.findById(id).lean() : null
  if (!o) throw notFound('Order')
  const from = to === 'READY' ? ['PLACED'] : ['PLACED', 'READY']
  if (o.source !== 'PREORDER' || !from.includes(o.status)) throw conflict(to === 'READY' ? 'Only a placed pre-order can be made ready.' : 'This pre-order was already collected or cancelled.')
  const set = to === 'READY' ? { status: 'READY', readyAt: new Date(), readyBy: who() } : { status: 'COLLECTED', collectedAt: new Date(), collectedBy: who() }
  const done = await CanteenOrder.findOneAndUpdate({ _id: o._id, status: { $in: from } }, { $set: set }, { new: true }).lean()
  if (!done) throw conflict('Someone else just changed this order. Refresh.')
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'canteen_order', entityId: String(o._id), entityName: o.orderNo, ...(o.studentId && { studentId: o.studentId }), summary: `Pre-order ${o.orderNo} ${to === 'READY' ? 'ready' : 'collected'}` }, req)
  return orderView(done)
}

/** Cancel a pre-order still PLACED: the wallet gets the money back (an ADJUSTMENT row). */
export async function cancelPreorder(o, reason, req) {
  const claimed = await CanteenOrder.findOneAndUpdate({ _id: o._id, status: 'PLACED', source: 'PREORDER' }, { $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: who(), cancelReason: reason } }, { new: true }).lean()
  if (!claimed) throw conflict('Only a pre-order that isn’t ready yet can be cancelled.')
  if (o.payMode === 'WALLET' && o.studentId) {
    const student = await Student.findById(o.studentId).lean()
    const { txn } = await moveWallet({ student, type: 'ADJUSTMENT', amount: o.total, date: (await today()).date, orderId: o._id, orderNo: o.orderNo, note: `Pre-order ${o.orderNo} cancelled` })
    await CanteenOrder.updateOne({ _id: o._id }, { $set: { refundTxnId: txn._id } })
  }
  await emit('canteen.sale_cancelled', { entity: { type: 'canteen_order', id: o._id } })
  await audit({ action: 'CANCEL', module: MODULE, entityType: 'canteen_order', entityId: String(o._id), entityName: o.orderNo, ...(o.studentId && { studentId: o.studentId }), summary: `Pre-order ${o.orderNo} for ${o.date} cancelled (${formatINR(o.total)} back to the wallet)${reason ? `: ${reason}` : ''}` }, req)
  return orderView(await CanteenOrder.findById(o._id).lean())
}

// ───────────────────────────────────────────────────────── the day's summary

export async function daySummary(date) {
  const d = date ?? (await today()).date
  const [orders, txns] = await Promise.all([CanteenOrder.find({ date: d }).lean(), WalletTxn.find({ date: d }).lean()])
  const live = orders.filter((o) => o.status !== 'CANCELLED')
  const items = new Map()
  for (const o of live) for (const l of o.lines) {
    const k = String(l.itemId)
    const x = items.get(k) ?? { itemId: k, name: l.name, category: l.category, mark: l.mark, qty: 0, amount: 0 }
    x.qty += l.qty
    x.amount += l.qty * l.price
    items.set(k, x)
  }
  const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0)
  const status = {}
  for (const o of orders.filter((x) => x.source === 'PREORDER')) status[o.status] = (status[o.status] ?? 0) + 1
  const topUps = txns.filter((t) => t.type === 'TOP_UP')
  const byMode = {}
  for (const t of topUps) byMode[t.mode ?? 'CASH'] = (byMode[t.mode ?? 'CASH'] ?? 0) + t.amount
  return {
    date: d,
    sales: { total: sum(live, (o) => o.total), count: live.length, wallet: sum(live.filter((o) => o.payMode === 'WALLET'), (o) => o.total), cash: sum(live.filter((o) => o.payMode === 'CASH'), (o) => o.total), preorders: sum(live.filter((o) => o.source === 'PREORDER'), (o) => o.total) },
    items: [...items.values()].sort((a, b) => b.amount - a.amount),
    preorders: status,
    topUps: { total: sum(topUps, (t) => t.amount), count: topUps.length, byMode },
    refunds: sum(txns.filter((t) => t.type === 'REFUND'), (t) => -t.amount),
    cashInHand: sum(live.filter((o) => o.payMode === 'CASH'), (o) => o.total) + (byMode.CASH ?? 0) - sum(txns.filter((t) => t.type === 'REFUND' && t.mode === 'CASH'), (t) => -t.amount),
  }
}
