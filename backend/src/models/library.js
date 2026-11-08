// Library (module `library`). Tenant-scoped.
//
//   LibraryTitle  a book (or magazine, e-book …): what the catalogue lists. An e-book has a link or files, no copies.
//   LibraryCopy   one physical copy, known by its accession number (the barcode on it), on one campus
//   LibraryLoan   a copy out with a student or staff member: issued, due, renewed, returned or lost
//   LibraryFine   what a borrower owes (late, lost, damaged): to pay, paid with a receipt, or waived
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const titleSchema = new Schema({
  title: { type: String, required: true, trim: true },
  subtitle: { type: String, trim: true },
  authors: { type: [String], default: [] },
  isbn: { type: String, trim: true }, // ISBN-13 when valid, else as typed
  publisher: { type: String, trim: true },
  year: Number,
  edition: { type: String, trim: true },
  language: { type: String, trim: true },
  type: { type: String, default: 'BOOK' }, // ITEM_TYPES
  category: { type: String, trim: true }, // Fiction, Science, Reference … (free text, suggested from what's in use)
  callNo: { type: String, trim: true }, // shelf mark / DDC, e.g. 823.912 KIP
  description: String,
  // e-library: a link, or files on the title (files engine, record type library_title)
  ebookUrl: String,
  forFamilies: { type: Boolean, default: false }, // shown in the family app's e-library
  classIds: { type: [ObjectId], default: undefined }, // only these classes (none: everyone)
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true })
titleSchema.plugin(tenantPlugin)
titleSchema.index({ tenantId: 1, isbn: 1 })
titleSchema.index({ tenantId: 1, title: 1 })
export const LibraryTitle = model('LibraryTitle', titleSchema, 'library_titles')

const copySchema = new Schema({
  titleId: { type: ObjectId, required: true },
  accessionNo: { type: String, required: true, trim: true, uppercase: true },
  branchId: ObjectId,
  status: { type: String, default: 'AVAILABLE' }, // COPY_STATUS
  shelf: { type: String, trim: true },
  price: Number, // paise — what a lost copy is charged at
  acquiredOn: String,
  source: { type: String, default: 'PURCHASE' }, // COPY_SOURCES
  vendor: String, billNo: String,
  note: String,
  withdrawn: { on: String, reason: String, by: String },
  loanId: ObjectId, // the loan it is out on
}, { timestamps: true })
copySchema.plugin(tenantPlugin)
copySchema.index({ tenantId: 1, accessionNo: 1 }, { unique: true })
copySchema.index({ tenantId: 1, titleId: 1, status: 1 })
export const LibraryCopy = model('LibraryCopy', copySchema, 'library_copies')

const borrower = { kind: String, id: ObjectId, name: String, code: String, place: String } // STUDENT · STAFF; admission no / employee code; class or designation

const loanSchema = new Schema({
  copyId: { type: ObjectId, required: true },
  titleId: { type: ObjectId, required: true },
  accessionNo: String, title: String, // as they were
  borrower,
  studentId: ObjectId, // for students — family app and messages find the loan by it
  branchId: ObjectId,
  issuedOn: { type: String, required: true },
  dueOn: { type: String, required: true },
  returnedOn: String,
  status: { type: String, default: 'ISSUED' }, // ISSUED · RETURNED · LOST
  renewals: { type: Number, default: 0 },
  issuedBy: String, returnedBy: String,
  condition: String, // noted on return
  reminded: { due: String, overdue: String }, // the days the reminders went
  fineIds: { type: [ObjectId], default: [] },
}, { timestamps: true })
loanSchema.plugin(tenantPlugin)
loanSchema.index({ tenantId: 1, copyId: 1 }, { unique: true, partialFilterExpression: { status: 'ISSUED' } })
loanSchema.index({ tenantId: 1, status: 1, dueOn: 1 })
loanSchema.index({ tenantId: 1, 'borrower.kind': 1, 'borrower.id': 1, status: 1 })
loanSchema.index({ tenantId: 1, studentId: 1, issuedOn: -1 })
export const LibraryLoan = model('LibraryLoan', loanSchema, 'library_loans')

const fineSchema = new Schema({
  loanId: ObjectId,
  borrower,
  studentId: ObjectId,
  branchId: ObjectId,
  reason: { type: String, required: true }, // FINE_REASONS
  amount: { type: Number, required: true }, // paise
  days: Number, // late days, for LATE
  title: String, accessionNo: String,
  note: String,
  status: { type: String, default: 'OPEN' }, // FINE_STATUS
  date: { type: String, required: true },
  paid: { receiptNo: String, date: String, mode: String, reference: String, by: String, at: Date },
  waived: { reason: String, by: String, at: Date },
  // payments taken in error and cancelled (the voucher is reversed in Accounts)
  cancelled: [{ receiptNo: String, date: String, mode: String, reference: String, by: String, at: Date, reason: String, cancelledBy: String, cancelledAt: Date, on: String, _id: false }],
  createdBy: String,
}, { timestamps: true })
fineSchema.plugin(tenantPlugin)
fineSchema.index({ tenantId: 1, status: 1, date: -1 })
fineSchema.index({ tenantId: 1, 'borrower.kind': 1, 'borrower.id': 1, status: 1 })
fineSchema.index({ tenantId: 1, 'paid.receiptNo': 1 }, { sparse: true })
export const LibraryFine = model('LibraryFine', fineSchema, 'library_fines')
