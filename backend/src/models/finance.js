// Accounts (module `finance`, ported from the hospital): chart of accounts, vouchers, bank accounts and statements,
// expenses, and which ledger each fee head goes to. Money is integer paise.
//
// The ledger is append-only: a posted voucher's lines never change. A mistake is undone by a reversal voucher (lines
// mirrored) that points back at it. Auto-posted vouchers carry the business event that made them in `postingKey`
// (`<source>:<id>:<event>`), unique per tenant, so posting the same event twice posts it once.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const stamp = { by: String, byId: ObjectId, at: Date }
const party = { type: { type: String }, id: ObjectId, name: String } // STUDENT · SUPPLIER · EMPLOYEE · OTHER

const accountSchema = new Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true }, // ACCOUNT_TYPES
  parentId: ObjectId,
  isGroup: { type: Boolean, default: false }, // holds other accounts; nothing posts to it
  systemKey: String, // set on the starter accounts auto-posting uses — they can't be deleted
  cashBank: { type: Boolean, default: false }, // cash in hand and bank ledgers (receipts, payments, contra)
  expenseHead: { type: Boolean, default: false }, // offered when recording an expense
  description: String,
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true })
accountSchema.plugin(tenantPlugin)
accountSchema.index({ tenantId: 1, code: 1 }, { unique: true })
accountSchema.index({ tenantId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } })
export const Account = model('Account', accountSchema, 'fin_accounts')

const journalLineSchema = new Schema({
  accountId: { type: ObjectId, required: true },
  accountCode: String,
  accountName: String,
  debit: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
  party,
  note: String,
}, { _id: false })

const journalSchema = new Schema({
  voucherNo: String, // issued when posted
  type: { type: String, required: true }, // VOUCHER_TYPES
  date: { type: String, required: true }, // YYYY-MM-DD
  fy: { type: String, required: true }, // '2026-27'
  narration: String,
  status: { type: String, default: 'DRAFT' }, // DRAFT · POSTED
  lines: [journalLineSchema],
  total: Number, // Σ debit = Σ credit
  source: { type: { type: String }, id: ObjectId, no: String, event: String, module: String }, // POSTING_SOURCES
  postingKey: String,
  auto: { type: Boolean, default: false },
  reference: String,
  branchId: ObjectId,
  reversalOf: { id: ObjectId, voucherNo: String },
  reversedBy: { id: ObjectId, voucherNo: String, reason: String, ...stamp },
  created: stamp,
  posted: stamp,
}, { timestamps: true })
journalSchema.plugin(tenantPlugin)
journalSchema.index({ tenantId: 1, postingKey: 1 }, { unique: true, partialFilterExpression: { postingKey: { $type: 'string' } } })
journalSchema.index({ tenantId: 1, voucherNo: 1 }, { unique: true, partialFilterExpression: { voucherNo: { $type: 'string' } } })
journalSchema.index({ tenantId: 1, status: 1, date: 1 })
journalSchema.index({ tenantId: 1, 'lines.accountId': 1, date: 1 })
journalSchema.index({ tenantId: 1, 'source.type': 1, 'source.id': 1 })
export const Journal = model('Journal', journalSchema, 'fin_journals')

/** A bank account the institution holds; its book side is a ledger account under Bank accounts. */
const bankAccountSchema = new Schema({
  name: { type: String, required: true, trim: true },
  bankName: String,
  accountNoLast4: String,
  ifsc: String,
  branch: String,
  accountId: { type: ObjectId, required: true }, // the ledger
  isDefault: { type: Boolean, default: false }, // card, UPI, cheque and online fee receipts land here
  active: { type: Boolean, default: true },
  statementBalance: Number, // closing balance on the last imported statement
  statementDate: String,
}, { timestamps: true })
bankAccountSchema.plugin(tenantPlugin)
bankAccountSchema.index({ tenantId: 1, accountId: 1 }, { unique: true })
export const BankAccount = model('BankAccount', bankAccountSchema, 'fin_bank_accounts')

/** One line of an imported bank statement, matched (or not) to a book entry on that bank's ledger. */
const bankLineSchema = new Schema({
  bankAccountId: { type: ObjectId, required: true },
  importId: String,
  date: { type: String, required: true },
  description: String,
  reference: String,
  deposit: { type: Number, default: 0 },
  withdrawal: { type: Number, default: 0 },
  balance: Number,
  fingerprint: { type: String, required: true }, // the same line imported twice is skipped
  status: { type: String, default: 'UNRECONCILED' }, // UNRECONCILED · RECONCILED
  match: { journalId: ObjectId, line: Number, voucherNo: String, date: String, ...stamp },
}, { timestamps: true })
bankLineSchema.plugin(tenantPlugin)
bankLineSchema.index({ tenantId: 1, bankAccountId: 1, fingerprint: 1 }, { unique: true })
bankLineSchema.index({ tenantId: 1, bankAccountId: 1, status: 1, date: 1 })
bankLineSchema.index({ tenantId: 1, 'match.journalId': 1, 'match.line': 1 }, { unique: true, partialFilterExpression: { 'match.journalId': { $type: 'objectId' } } })
export const BankLine = model('BankLine', bankLineSchema, 'fin_bank_lines')

/** An expense: a bill to pay (electricity, fuel, repairs, an event). Submitted → approved → paid (posts then). */
const expenseSchema = new Schema({
  expenseNo: { type: String, required: true },
  date: { type: String, required: true }, // the bill's date
  accountId: { type: ObjectId, required: true }, accountCode: String, accountName: String, // the expense head
  payee: { type: { type: String, default: 'SUPPLIER' }, name: { type: String, required: true }, employeeId: ObjectId, gstin: String },
  description: { type: String, required: true },
  billNo: String,
  amount: { type: Number, required: true }, // the bill, GST included
  tds: { section: String, pct: Number, amount: { type: Number, default: 0 } },
  payable: Number, // amount − TDS
  status: { type: String, default: 'SUBMITTED' }, // EXPENSE_STATUSES
  branchId: ObjectId,
  submitted: stamp,
  approved: { ...stamp, note: String },
  rejected: { ...stamp, reason: String },
  cancelled: { ...stamp, reason: String },
  paid: { ...stamp, date: String, mode: String, bankAccountId: ObjectId, reference: String, journalId: ObjectId, voucherNo: String },
}, { timestamps: true })
expenseSchema.plugin(tenantPlugin)
expenseSchema.index({ tenantId: 1, expenseNo: 1 }, { unique: true })
expenseSchema.index({ tenantId: 1, status: 1, date: -1 })
expenseSchema.index({ tenantId: 1, accountId: 1, date: -1 })
export const Expense = model('Expense', expenseSchema, 'fin_expenses')

/** One per institution: which income ledger each fee head posts to (heads not listed: by incomeKeyForHead). */
const configSchema = new Schema({
  key: { type: String, default: 'MAIN' },
  feeHeads: { type: Schema.Types.Mixed, default: {} }, // { [feeHeadId]: accountId }
  updatedBy: String,
}, { timestamps: true, minimize: false })
configSchema.plugin(tenantPlugin)
configSchema.index({ tenantId: 1, key: 1 }, { unique: true })
export const FinanceConfig = model('FinanceConfig', configSchema, 'fin_config')
