// Training & placements (module `placements`). Tenant-scoped.
//
//   Company                 a recruiter: sector, website, HR contacts, notes (its visits are its drives)
//   PlacementDrive          a company's hiring drive: roles, CTC range, dates, who may apply (programs and batches, or
//                           classes; CGPA, backlogs, 10th / 12th), the registration window and its rounds
//   PlacementRegistration   a student in a drive: the figures they applied with and each round's marks and result
//   PlacementOffer          an offer to a student (from a drive's selections, or off campus): CTC in paise a year,
//                           role, joining date; OFFERED → ACCEPTED / DECLINED, or REVOKED. The accreditation reports
//                           read it (placed students per program and year) — keep its name and fields.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const contactSchema = new Schema({
  name: { type: String, required: true, trim: true },
  designation: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  mobile: { type: String, trim: true },
  primary: { type: Boolean, default: false },
}, { _id: true })

const companySchema = new Schema({
  name: { type: String, required: true, trim: true },
  sector: { type: String, default: 'OTHER' }, // COMPANY_SECTORS
  website: { type: String, trim: true },
  city: { type: String, trim: true },
  about: { type: String, trim: true },
  notes: { type: String, trim: true },
  contacts: { type: [contactSchema], default: [] },
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true })
companySchema.plugin(tenantPlugin)
companySchema.index({ tenantId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })
export const Company = model('Company', companySchema, 'placement_companies')

const roundSchema = new Schema({
  name: { type: String, required: true, trim: true },
  kind: { type: String, default: 'OTHER' }, // ROUND_KINDS
  date: ymd,
  maxMarks: Number,
  done: { type: Boolean, default: false }, // results entered and final
}, { _id: true })

const roleSchema = new Schema({
  title: { type: String, required: true, trim: true },
  openings: Number,
  ctc: Number, // paise a year, when the role has its own figure
}, { _id: false })

const driveSchema = new Schema({
  companyId: { type: ObjectId, ref: 'Company', required: true },
  title: { type: String, required: true, trim: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear' },
  branchId: { type: ObjectId, ref: 'Branch' },
  mode: { type: String, default: 'ON_CAMPUS' }, // DRIVE_MODES
  roles: { type: [roleSchema], default: [] },
  ctcMin: Number, ctcMax: Number, // paise a year
  location: { type: String, trim: true },
  startDate: ymd, endDate: ymd,
  registration: { opensOn: ymd, closesOn: ymd },
  eligibility: {
    programIds: { type: [ObjectId], default: [] },
    batches: { type: [Number], default: [] }, // admission years; none: the final year
    classIds: { type: [ObjectId], default: [] }, // schools: students of these classes
    minCgpa: Number,
    maxBacklogs: Number,
    min10th: Number, min12th: Number, // per cent; the student gives theirs when registering
    note: { type: String, trim: true },
  },
  rounds: { type: [roundSchema], default: [] },
  description: { type: String, trim: true },
  status: { type: String, default: 'DRAFT' }, // DRIVE_STATUS
  openedAt: Date,
  notified: { type: Number, default: 0 }, // students told when it opened
  createdBy: String,
}, { timestamps: true })
driveSchema.plugin(tenantPlugin)
driveSchema.index({ tenantId: 1, status: 1, startDate: -1 })
driveSchema.index({ tenantId: 1, companyId: 1 })
driveSchema.index({ tenantId: 1, academicYearId: 1 })
export const PlacementDrive = model('PlacementDrive', driveSchema, 'placement_drives')

const roundResultSchema = new Schema({
  roundId: { type: ObjectId, required: true },
  marks: Number,
  result: String, // ROUND_RESULTS
  note: String,
}, { _id: false })

const registrationSchema = new Schema({
  driveId: { type: ObjectId, ref: 'PlacementDrive', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  programId: { type: ObjectId, ref: 'Program' },
  batch: Number,
  cgpa: Number, backlogs: Number, tenthPct: Number, twelfthPct: Number, // as at registration
  status: { type: String, default: 'REGISTERED' }, // REGISTRATION_STATUS
  via: { type: String, default: 'STAFF' }, // STAFF · APP
  registeredOn: ymd,
  rounds: { type: [roundResultSchema], default: [] },
  offerId: ObjectId,
  by: String,
}, { timestamps: true })
registrationSchema.plugin(tenantPlugin)
registrationSchema.index({ tenantId: 1, driveId: 1, studentId: 1 }, { unique: true })
registrationSchema.index({ tenantId: 1, studentId: 1 })
export const PlacementRegistration = model('PlacementRegistration', registrationSchema, 'placement_registrations')

const offerSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  companyId: { type: ObjectId, ref: 'Company', required: true },
  driveId: { type: ObjectId, ref: 'PlacementDrive' }, // none: off campus
  registrationId: ObjectId,
  programId: { type: ObjectId, ref: 'Program' },
  classId: { type: ObjectId, ref: 'ClassLevel' }, // schools
  batch: Number,
  academicYearId: { type: ObjectId, ref: 'AcademicYear' },
  branchId: { type: ObjectId, ref: 'Branch' },
  role: { type: String, trim: true },
  ctc: { type: Number, required: true }, // paise a year
  location: { type: String, trim: true },
  joiningDate: ymd,
  offeredOn: { ...ymd, required: true },
  status: { type: String, default: 'OFFERED' }, // OFFER_STATUS
  decidedOn: ymd,
  note: { type: String, trim: true },
  offCampus: { type: Boolean, default: false },
  by: String,
}, { timestamps: true })
offerSchema.plugin(tenantPlugin)
offerSchema.index({ tenantId: 1, studentId: 1, status: 1 })
offerSchema.index({ tenantId: 1, academicYearId: 1, status: 1 })
offerSchema.index({ tenantId: 1, companyId: 1 })
offerSchema.index({ tenantId: 1, driveId: 1 })
export const PlacementOffer = model('PlacementOffer', offerSchema, 'placement_offers')
