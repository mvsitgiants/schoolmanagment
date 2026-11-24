// Scholarships (module `scholarships`).
//   ScholarshipScheme       a scholarship the institution runs or helps with: who can apply, what it gives,
//                           the documents to bring, seats and budget, how it is approved
//   ScholarshipDocument     the student's document wallet: one record per kind of document, checked once and
//                           used again for every scheme and every year until it expires (files: Attachments,
//                           entityType 'scholarship_doc')
//   ScholarshipApplication  one student applying for one scheme in one academic year; its checklist points at
//                           the wallet documents
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }
const logSchema = new Schema({ at: { type: Date, default: Date.now }, by: String, text: String }, { _id: false })

const checklistItem = new Schema({
  key: { type: String, required: true }, // the type, or OTHER:<label> for a document the scheme names itself
  type: { type: String, required: true }, // SCHOLARSHIP_DOC_TYPES
  label: String, // for OTHER
  required: { type: Boolean, default: true },
  originalNeeded: { type: Boolean, default: false }, // the original must be seen at the office
  note: String, // e.g. "issued by the tehsildar"
}, { _id: false })

const schemeSchema = new Schema({
  name: { type: String, required: true, trim: true },
  provider: { type: String, default: 'INSTITUTION' }, // SCHOLARSHIP_PROVIDERS
  benefit: { type: String, default: 'FEE_WAIVER' }, // SCHOLARSHIP_BENEFITS
  kind: { type: String, default: 'PCT' }, // PCT · AMOUNT (a year)
  value: { type: Number, required: true }, // % or paise a year
  feeHeadIds: { type: [ObjectId], default: [] }, // empty = every head
  eligibility: {
    classIds: { type: [ObjectId], default: [] },
    categories: { type: [String], default: [] },
    genders: { type: [String], default: [] },
    maxIncome: Number, // paise a year
    minMarksPct: Number,
    minAttendancePct: Number,
  },
  seats: Number, // a year; none = no limit
  budget: Number, // paise a year; none = no limit
  approval: { type: String, default: 'APPROVER' }, // SCHOLARSHIP_APPROVAL
  rankBy: { type: String, default: 'NONE' }, // SCHOLARSHIP_RANK_BY
  /** While an application is open, its expected amount is kept out of fee reminders and no late fee is charged. */
  holdFees: { type: Boolean, default: true },
  lastDate: ymd, // last day to give documents this year
  /** A government scheme's portal: which one, its address, and the last day the institution must verify by. */
  portal: { name: String, url: String, verifyBy: ymd },
  /** Renewing next year: last year's scholars stay in if they still have these marks and attendance. */
  renewal: { minMarksPct: Number, minAttendancePct: Number },
  /** Last year's scholars come before new applicants in the merit list (so they keep their seats). */
  renewalsFirst: { type: Boolean, default: false },
  /** Families can apply from the parent / student app (otherwise only the office starts applications). */
  familyApply: { type: Boolean, default: true },
  documents: { type: [checklistItem], default: [] },
  description: String,
  active: { type: Boolean, default: true },
}, { timestamps: true })
schemeSchema.plugin(tenantPlugin)
schemeSchema.index({ tenantId: 1, name: 1 }, { unique: true })
export const ScholarshipScheme = model('ScholarshipScheme', schemeSchema, 'scholarship_schemes')

const documentSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  key: { type: String, required: true },
  type: { type: String, required: true },
  label: String,
  /** NEW (nothing given yet; files make it waiting) · SUBMITTED · ACCEPTED · NOT_ACCEPTED */
  status: { type: String, default: 'NEW' },
  number: { type: String, trim: true }, // certificate number
  issuedOn: ymd,
  validTill: ymd,
  paperCopy: { type: Boolean, default: false }, // a paper copy is kept in the office (no scan)
  originalSeen: { type: Boolean, default: false },
  originalSeenBy: String, originalSeenAt: Date,
  reason: String, // SCHOLARSHIP_REJECT_REASONS when not accepted
  reasonNote: String,
  checkedBy: String, checkedById: ObjectId, checkedAt: Date,
  log: { type: [logSchema], default: [] },
}, { timestamps: true })
documentSchema.plugin(tenantPlugin)
documentSchema.index({ tenantId: 1, studentId: 1, key: 1 }, { unique: true })
export const ScholarshipDocument = model('ScholarshipDocument', documentSchema, 'scholarship_documents')

const applicationSchema = new Schema({
  applicationNo: { type: String, required: true },
  schemeId: { type: ObjectId, ref: 'ScholarshipScheme', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  branchId: ObjectId,
  sectionId: ObjectId, // the student's section when applying
  source: { type: String, default: 'OFFICE' }, // OFFICE · FAMILY (the app, later)
  familyIncome: Number, // paise a year
  marksPct: Number,
  marksFrom: String, // EXAM (from published results) · ENTERED (typed from the mark sheet)
  attendancePct: Number,
  eligibility: { type: [{ _id: false, key: String, ok: Boolean, value: Schema.Types.Mixed, need: Schema.Types.Mixed }], default: [] },
  items: { type: [checklistItem], default: [] }, // the scheme's checklist when applying
  status: { type: String, default: 'IN_PROGRESS' }, // SCHOLARSHIP_STATUS
  expectedAmount: { type: Number, default: 0 }, // paise for the year (fees held, budget)
  holdFees: { type: Boolean, default: false },
  note: String,
  createdBy: String, createdById: ObjectId,
  decidedBy: String, decidedById: ObjectId, decidedAt: Date, decisionNote: String,
  concessionId: ObjectId, // the fee concession an approved fee waiver made
  familyToldAt: Date,
  /** On the government portal: the portal's own application id and where it stands (SCHOLARSHIP_PORTAL_STATUS). */
  portal: {
    applicationId: { type: String, trim: true }, status: String, statusOn: Date, sanctionedAmount: Number, note: String,
    previousId: String, // last year's portal application number (a renewal is made against it)
    history: { type: [{ _id: false, at: Date, by: String, status: String, note: String }], default: undefined },
  },
  /** Approved, paid to the institution later (benefit PAID_TO_INSTITUTION): the fees stay held until it comes. */
  awaitingMoney: { type: Boolean, default: false },
  received: { type: [{ _id: false, at: Date, date: String, amount: Number, receiptId: ObjectId, receiptNo: String, reference: String, by: String }], default: undefined },
  renewedFromId: ObjectId, // last year's approved application this one renews
  /** The family's booked time to show the originals (ScholarshipVisitDay), once every copy is checked online. */
  visit: { dayId: ObjectId, date: ymd, time: String, place: String, bookedBy: String, bookedAt: Date, attended: Boolean },
  log: { type: [logSchema], default: [] },
}, { timestamps: true })
applicationSchema.plugin(tenantPlugin)
applicationSchema.index({ tenantId: 1, applicationNo: 1 }, { unique: true })
applicationSchema.index({ tenantId: 1, schemeId: 1, academicYearId: 1, status: 1 })
applicationSchema.index({ tenantId: 1, studentId: 1, status: 1 })
applicationSchema.index({ tenantId: 1, 'visit.dayId': 1, 'visit.time': 1 })
export const ScholarshipApplication = model('ScholarshipApplication', applicationSchema, 'scholarship_applications')

/**
 * A day the office sees originals: families whose copies are all checked online book a time, so they come once,
 * at a set time, with only the originals still needed — no queue.
 */
const visitDaySchema = new Schema({
  date: { ...ymd, required: true },
  from: { type: String, required: true }, // 'HH:MM'
  to: { type: String, required: true },
  slotMinutes: { type: Number, default: 10 },
  perSlot: { type: Number, default: 2 }, // families seen at the same time
  place: { type: String, trim: true }, // e.g. "Scholarship desk, office block"
  note: String,
  branchId: ObjectId, // none = every campus
  active: { type: Boolean, default: true },
}, { timestamps: true })
visitDaySchema.plugin(tenantPlugin)
visitDaySchema.index({ tenantId: 1, date: 1 })
export const ScholarshipVisitDay = model('ScholarshipVisitDay', visitDaySchema, 'scholarship_visit_days')
