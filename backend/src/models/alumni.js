// Alumni (module `alumni`). Tenant-scoped.
//
//   Alumnus          one former student: batch (passing-out year), program or class, where they work now, contact
//                    details and whether they agree to be contacted. Made from a student who left (studentId kept) or
//                    added by hand.
//   AlumniDonation   a donation with its receipt number: donor (an alumnus or anyone), amount, mode, fund, 80G and
//                    PAN. Emits `alumni.donation` — Accounts posts it (Dr cash / bank, Cr donations).
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const alumnusSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student' },
  name: { type: String, required: true, trim: true },
  gender: String,
  admissionNo: { type: String, trim: true },
  batch: { type: Number, required: true }, // passing-out year
  programId: { type: ObjectId, ref: 'Program' },
  program: { type: String, trim: true }, // program name, or the last class ("Class 12 – A")
  branchId: { type: ObjectId, ref: 'Branch' },
  email: { type: String, trim: true, lowercase: true },
  mobile: { type: String, trim: true },
  city: { type: String, trim: true },
  country: { type: String, trim: true },
  organisation: { type: String, trim: true },
  designation: { type: String, trim: true },
  linkedIn: { type: String, trim: true },
  consent: { type: Boolean, default: false }, // agrees to be contacted
  notes: { type: String, trim: true },
  source: { type: String, default: 'MANUAL' }, // ALUMNI_SOURCES
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true })
alumnusSchema.plugin(tenantPlugin)
alumnusSchema.index({ tenantId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { studentId: { $type: 'objectId' } } })
alumnusSchema.index({ tenantId: 1, batch: 1, name: 1 })
export const Alumnus = model('Alumnus', alumnusSchema, 'alumni')

const donationSchema = new Schema({
  receiptNo: { type: String, required: true },
  date: { ...ymd, required: true },
  donor: {
    kind: { type: String, default: 'ALUMNUS' }, // DONOR_KINDS
    alumnusId: ObjectId,
    name: { type: String, required: true, trim: true },
    batch: Number,
    email: { type: String, trim: true, lowercase: true },
    mobile: { type: String, trim: true },
    pan: { type: String, trim: true, uppercase: true },
    address: { type: String, trim: true },
  },
  amount: { type: Number, required: true }, // paise
  mode: { type: String, required: true }, // PAYMENT_MODES
  reference: { type: String, trim: true },
  fund: { type: String, default: 'GENERAL', trim: true }, // DONATION_FUNDS or a name typed
  purpose: { type: String, trim: true },
  is80G: { type: Boolean, default: false },
  branchId: { type: ObjectId, ref: 'Branch' },
  status: { type: String, default: 'RECEIVED' }, // DONATION_STATUS
  note: { type: String, trim: true },
  receivedBy: String,
}, { timestamps: true })
donationSchema.plugin(tenantPlugin)
donationSchema.index({ tenantId: 1, receiptNo: 1 }, { unique: true })
donationSchema.index({ tenantId: 1, date: -1 })
donationSchema.index({ tenantId: 1, 'donor.alumnusId': 1 })
export const AlumniDonation = model('AlumniDonation', donationSchema, 'alumni_donations')
