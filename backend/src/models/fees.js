// Fees (module `fees`). Tenant-scoped; all amounts are integer paise.
//
//   FeeHead       what is charged (Tuition, Transport, Lab …)
//   FeeStructure  a year's fees for some classes: lines (head + yearly amount) and installments
//   FeeInvoice    one student's installment: what is due, its concession, paid, balance
//   FeePayment    a receipt: money in, allocated to invoices (oldest first)
//   FeeRefund     money back against a receipt
//   Concession    a student's concession for a year (needs approval), applied to their invoices
//   FeeDayEnd     one collector's day closed: what the receipts say vs. the cash counted
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { makeVerifyCode } from '@schoolgiant/shared'
import { tenantPlugin } from '../platform/db.js'

/** A receipt's check code (the QR on the printed receipt opens /verify/receipt/<code>); never the guessable receipt number. */
export const newReceiptCode = () => makeVerifyCode(() => crypto.randomInt(0, 2 ** 31) / 2 ** 31)

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }
const paise = { type: Number, default: 0 }

const feeHeadSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  refundable: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true })
feeHeadSchema.plugin(tenantPlugin)
feeHeadSchema.index({ tenantId: 1, code: 1 }, { unique: true })
export const FeeHead = model('FeeHead', feeHeadSchema, 'fee_heads')

const structureSchema = new Schema({
  name: { type: String, required: true, trim: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  classIds: { type: [{ type: ObjectId, ref: 'ClassLevel' }], default: [] },
  /** ALL students of the classes, or only NEW admissions (one-time admission fees). */
  appliesTo: { type: String, default: 'ALL' },
  lines: [{ _id: false, feeHeadId: { type: ObjectId, ref: 'FeeHead', required: true }, amount: { type: Number, required: true } }],
  /** Installments split the total; amounts add up to the sum of the lines. */
  installments: [{ _id: false, name: { type: String, required: true }, dueDate: { ...ymd, required: true }, amount: { type: Number, required: true } }],
  active: { type: Boolean, default: true },
}, { timestamps: true })
structureSchema.plugin(tenantPlugin)
structureSchema.index({ tenantId: 1, academicYearId: 1, name: 1 }, { unique: true })
export const FeeStructure = model('FeeStructure', structureSchema, 'fee_structures')

const invoiceLineSchema = new Schema({
  feeHeadId: ObjectId, name: String, amount: Number, concession: { type: Number, default: 0 },
}, { _id: false })

const invoiceSchema = new Schema({
  invoiceNo: { type: String, required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  sectionId: ObjectId, // the student's section when raised
  branchId: ObjectId,
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  structureId: { type: ObjectId, ref: 'FeeStructure' },
  installment: { type: String, required: true }, // its name, e.g. "Term 1"
  dueDate: { ...ymd, required: true },
  lines: { type: [invoiceLineSchema], default: [] },
  gross: paise,
  concession: paise,
  lateFee: paise, // charged when collected after the due date (Settings › Fees)
  net: paise, // gross − concession + lateFee
  paid: paise,
  balance: paise,
  status: { type: String, default: 'UNPAID' }, // INVOICE_STATUS
  cancelledAt: Date, cancelledBy: String, cancelReason: String,
}, { timestamps: true })
invoiceSchema.plugin(tenantPlugin)
invoiceSchema.index({ tenantId: 1, invoiceNo: 1 }, { unique: true })
invoiceSchema.index({ tenantId: 1, studentId: 1, dueDate: 1 })
invoiceSchema.index({ tenantId: 1, structureId: 1, studentId: 1, installment: 1 }, { unique: true, partialFilterExpression: { structureId: { $exists: true } } })
invoiceSchema.index({ tenantId: 1, status: 1, dueDate: 1 })
export const FeeInvoice = model('FeeInvoice', invoiceSchema, 'fee_invoices')

const paymentSchema = new Schema({
  receiptNo: { type: String, required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  branchId: ObjectId,
  date: { ...ymd, required: true }, // the institution's business date
  at: { type: Date, default: Date.now },
  mode: { type: String, required: true }, // PAYMENT_MODES
  reference: String,
  amount: { type: Number, required: true },
  allocations: [{ _id: false, invoiceId: ObjectId, amount: Number }],
  refunded: paise,
  collectedById: ObjectId,
  collectedBy: String,
  status: { type: String, default: 'VALID' }, // VALID · CANCELLED
  cancelledAt: Date, cancelledBy: String, cancelReason: String,
  dayEndId: ObjectId,
  note: String,
  verifyCode: { type: String, default: newReceiptCode },
}, { timestamps: true })
paymentSchema.plugin(tenantPlugin)
paymentSchema.index({ verifyCode: 1 }, { unique: true, partialFilterExpression: { verifyCode: { $type: 'string' } } })
paymentSchema.index({ tenantId: 1, receiptNo: 1 }, { unique: true })
paymentSchema.index({ tenantId: 1, studentId: 1, at: -1 })
paymentSchema.index({ tenantId: 1, date: 1, collectedById: 1 })
export const FeePayment = model('FeePayment', paymentSchema, 'fee_payments')

const refundSchema = new Schema({
  refundNo: { type: String, required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  paymentId: { type: ObjectId, ref: 'FeePayment', required: true },
  date: { ...ymd, required: true },
  amount: { type: Number, required: true },
  mode: { type: String, required: true },
  reference: String,
  reason: { type: String, required: true },
  by: String, byId: ObjectId,
}, { timestamps: true })
refundSchema.plugin(tenantPlugin)
refundSchema.index({ tenantId: 1, refundNo: 1 }, { unique: true })
export const FeeRefund = model('FeeRefund', refundSchema, 'fee_refunds')

const concessionSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  kind: { type: String, required: true }, // PCT · AMOUNT
  value: { type: Number, required: true }, // % or paise per installment
  feeHeadIds: { type: [ObjectId], default: [] }, // empty = every head
  reason: { type: String, required: true },
  note: String,
  status: { type: String, default: 'PENDING' }, // CONCESSION_STATUS
  requestedBy: String, requestedById: ObjectId,
  decidedBy: String, decidedAt: Date,
}, { timestamps: true })
concessionSchema.plugin(tenantPlugin)
concessionSchema.index({ tenantId: 1, studentId: 1, academicYearId: 1, status: 1 })
export const Concession = model('Concession', concessionSchema, 'fee_concessions')

const dayEndSchema = new Schema({
  date: { ...ymd, required: true },
  collectorId: { type: ObjectId, required: true },
  collector: String,
  byMode: { type: Schema.Types.Mixed, default: {} }, // { CASH: paise, UPI: paise, … } from the receipts
  receipts: Number,
  total: paise,
  cashCounted: paise,
  variance: paise, // counted − expected cash (negative = short)
  note: String,
  status: { type: String, default: 'CLOSED' }, // DAY_END_STATUS
  closedAt: Date,
  approvedBy: String, approvedAt: Date,
}, { timestamps: true, minimize: false })
dayEndSchema.plugin(tenantPlugin)
dayEndSchema.index({ tenantId: 1, date: 1, collectorId: 1 }, { unique: true })
export const FeeDayEnd = model('FeeDayEnd', dayEndSchema, 'fee_day_ends')
