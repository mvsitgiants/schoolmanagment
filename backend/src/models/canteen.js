// Canteen & wallet (module `canteen`). Tenant-scoped.
//
//   CanteenItem     a thing on the menu: price (paise), veg / non-veg / egg mark, tags a parent can rule out
//                   (fried, sugary …), the days it is sold, and a sold-out switch for today's counter
//   CanteenSpecial  today's (or any day's) special: an item, optionally at a special price
//   CanteenWallet   one per student: the balance and the family's controls (daily limit, blocked items / tags)
//   WalletTxn       the wallet's ledger — append-only (TOP_UP, PURCHASE, REFUND, ADJUSTMENT); balanceAfter on each row
//   CanteenOrder    a counter sale (SERVED at once) or a pre-order from the family app (PLACED → READY → COLLECTED);
//                   with tokens on, each order has a token (1, 2, 3 … a day per campus) and a counter sale goes
//                   PLACED (preparing) → READY → COLLECTED too
//   CanteenTopup    one online top-up try through the school's own Razorpay account (exactly-once credit)
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'
import { AppError } from '../platform/errors.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const itemSchema = new Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'SNACK' }, // CANTEEN_CATEGORIES
  price: { type: Number, required: true, min: 0 }, // paise
  mark: { type: String, default: 'VEG' }, // CANTEEN_MARKS
  tags: { type: [String], default: [] }, // CANTEEN_TAGS
  days: { type: [String], default: [] }, // CANTEEN_DAYS; none = every day
  description: { type: String, trim: true },
  soldOut: { type: Boolean, default: false }, // today's counter: out of stock
  soldOutOn: String, // the day it was switched off; next day it is back on its own
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true })
itemSchema.plugin(tenantPlugin)
itemSchema.index({ tenantId: 1, name: 1 }, { unique: true })
export const CanteenItem = model('CanteenItem', itemSchema, 'canteen_items')

const specialSchema = new Schema({
  date: { ...ymd, required: true },
  itemId: { type: ObjectId, required: true, ref: 'CanteenItem' },
  price: { type: Number, min: 0 }, // a special price that day; none = the menu price
  note: { type: String, trim: true },
  createdBy: String,
}, { timestamps: true })
specialSchema.plugin(tenantPlugin)
specialSchema.index({ tenantId: 1, date: 1, itemId: 1 }, { unique: true })
export const CanteenSpecial = model('CanteenSpecial', specialSchema, 'canteen_specials')

const walletSchema = new Schema({
  studentId: { type: ObjectId, required: true, ref: 'Student' },
  balance: { type: Number, default: 0 }, // paise; never below 0
  dailyLimit: { type: Number, default: null }, // paise; null = no limit
  blockedItemIds: { type: [ObjectId], default: [] },
  blockedTags: { type: [String], default: [] },
  controlsBy: String, // who last changed the controls (a parent in the app, or staff)
  controlsAt: Date,
  lowAlertSent: { type: Boolean, default: false }, // told the family once; reset by the next top-up
  lastTxnAt: Date,
}, { timestamps: true })
walletSchema.plugin(tenantPlugin)
walletSchema.index({ tenantId: 1, studentId: 1 }, { unique: true })
walletSchema.index({ tenantId: 1, balance: 1 })
export const CanteenWallet = model('CanteenWallet', walletSchema, 'canteen_wallets')

const txnSchema = new Schema({
  studentId: { type: ObjectId, required: true, ref: 'Student' },
  branchId: ObjectId,
  type: { type: String, required: true }, // CANTEEN_TXN_TYPES
  amount: { type: Number, required: true }, // signed paise: + into the wallet, − out of it
  balanceAfter: { type: Number, required: true },
  date: { ...ymd, required: true }, // the institution's day
  mode: String, // TOP_UP: CASH · UPI · ONLINE; REFUND: CASH · BANK
  reference: String,
  orderId: { type: ObjectId, ref: 'CanteenOrder' },
  orderNo: String,
  gatewayPaymentId: String, // online top-ups: pay_… (one wallet credit per payment)
  note: String,
  by: String,
}, { timestamps: { createdAt: true, updatedAt: false } })
txnSchema.plugin(tenantPlugin)
txnSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })
txnSchema.index({ tenantId: 1, date: 1, type: 1 })
txnSchema.index({ tenantId: 1, gatewayPaymentId: 1 }, { unique: true, partialFilterExpression: { gatewayPaymentId: { $type: 'string' } } })
// Append-only: no row is ever changed or removed (a correction is a new ADJUSTMENT row).
const appendOnly = function () { if (!this.getOptions()?.allowLedgerWrite) throw new AppError(409, 'The wallet ledger cannot be changed; add an adjustment instead.', { code: 'LEDGER_APPEND_ONLY' }) }
txnSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'], appendOnly)
export const WalletTxn = model('WalletTxn', txnSchema, 'canteen_wallet_txns')

const lineSchema = new Schema({
  itemId: { type: ObjectId, ref: 'CanteenItem' },
  name: String,
  category: String,
  mark: String,
  price: Number, // paise each, as charged
  qty: { type: Number, min: 1 },
}, { _id: false })

const orderSchema = new Schema({
  orderNo: { type: String, required: true },
  date: { ...ymd, required: true }, // the day it is eaten (a pre-order's day; a counter sale's day)
  source: { type: String, default: 'COUNTER' }, // CANTEEN_ORDER_SOURCES
  studentId: { type: ObjectId, ref: 'Student' }, // none: a walk-in cash sale
  studentName: String,
  admissionNo: String,
  branchId: ObjectId,
  lines: { type: [lineSchema], default: [] },
  total: { type: Number, required: true },
  payMode: { type: String, default: 'WALLET' }, // CANTEEN_PAY_MODES
  status: { type: String, default: 'SERVED' }, // CANTEEN_ORDER_STATUS
  token: Number, // tokens on: the day's number at this campus (TenantCounter CANTEEN_TOKEN, scope = campus, period = date)
  txnId: { type: ObjectId, ref: 'WalletTxn' }, // the PURCHASE row
  refundTxnId: { type: ObjectId, ref: 'WalletTxn' }, // a cancelled pre-order: the ADJUSTMENT row that gave it back
  placedBy: String,
  readyAt: Date, readyBy: String,
  collectedAt: Date, collectedBy: String,
  cancelledAt: Date, cancelledBy: String, cancelReason: String,
}, { timestamps: true })
orderSchema.plugin(tenantPlugin)
orderSchema.index({ tenantId: 1, orderNo: 1 }, { unique: true })
orderSchema.index({ tenantId: 1, date: 1, status: 1 })
orderSchema.index({ tenantId: 1, studentId: 1, date: -1 })
orderSchema.index({ tenantId: 1, date: 1, branchId: 1, token: 1 })
export const CanteenOrder = model('CanteenOrder', orderSchema, 'canteen_orders')

const topupSchema = new Schema({
  provider: { type: String, default: 'RAZORPAY' },
  mode: String, // SANDBOX · LIVE when it was made
  studentId: { type: ObjectId, required: true, ref: 'Student' },
  studentName: String,
  admissionNo: String,
  amount: { type: Number, required: true }, // paise
  providerOrderId: { type: String, required: true }, // order_…
  providerPaymentId: String, // pay_…
  method: String,
  status: { type: String, default: 'CREATED' }, // CANTEEN_TOPUP_STATUS
  txnId: { type: ObjectId, ref: 'WalletTxn' },
  appliedAt: Date,
  error: String,
  createdBy: String,
}, { timestamps: true })
topupSchema.plugin(tenantPlugin)
topupSchema.index({ tenantId: 1, provider: 1, providerOrderId: 1 }, { unique: true })
topupSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })
export const CanteenTopup = model('CanteenTopup', topupSchema, 'canteen_topups')
