// Admissions (module `admissions`). Tenant-scoped.
//
//   AdmissionCycle  one admission season for a year: classes open with their seats, dates, merit basis, extra form
//   Enquiry         a family's interest (desk, phone, website …) and its follow-ups — the CRM pipeline
//   Application     a child applying for a class in a cycle: child, parent, answers, documents, test, rank, offer
//   EntranceTest    a test or interaction for some classes of a cycle; marks are kept on each application
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const cycleClassSchema = new Schema({
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  seats: { type: Number, default: 0 },
  minAge: Number, maxAge: Number, // on the age cut-off day (Settings › Admissions)
  meritBasis: { type: String, default: 'TEST' }, // MERIT_BASES
  testRequired: { type: Boolean, default: false },
  meritPublishedAt: Date, meritPublishedBy: String,
}, { _id: false })

const cycleSchema = new Schema({
  name: { type: String, required: true, trim: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear' }, // the year the children join
  yearName: String,
  opensOn: ymd, closesOn: ymd,
  classes: { type: [cycleClassSchema], default: [] },
  formId: { type: ObjectId, ref: 'Form' }, // extra questions (Forms › Admission form section)
  instructions: String, // shown on the online application
  status: { type: String, default: 'DRAFT' }, // CYCLE_STATUS
  createdBy: String,
}, { timestamps: true })
cycleSchema.plugin(tenantPlugin)
export const AdmissionCycle = model('AdmissionCycle', cycleSchema, 'admission_cycles')

const followUpSchema = new Schema({
  type: { type: String, default: 'CALL' }, // FOLLOWUP_TYPES
  note: String,
  at: { type: Date, default: Date.now },
  by: String, byId: ObjectId,
}, { _id: true })

const enquirySchema = new Schema({
  enquiryNo: { type: String, required: true },
  cycleId: { type: ObjectId, ref: 'AdmissionCycle' },
  classId: { type: ObjectId, ref: 'ClassLevel' },
  branchId: { type: ObjectId, ref: 'Branch' },
  childName: { type: String, required: true, trim: true },
  dob: ymd,
  gender: String,
  parentName: { type: String, trim: true },
  mobile: { type: String, required: true }, // 10 digits
  email: String,
  locality: String,
  currentSchool: String,
  source: { type: String, default: 'WALK_IN' }, // ENQUIRY_SOURCES
  campaign: String,
  stage: { type: String, default: 'NEW' }, // ENQUIRY_STAGES
  lostReason: String,
  assignedToId: { type: ObjectId, ref: 'User' }, assignedTo: String,
  nextFollowUpOn: ymd,
  followUps: { type: [followUpSchema], default: [] },
  applicationId: { type: ObjectId, ref: 'Application' },
  createdBy: String,
}, { timestamps: true })
enquirySchema.plugin(tenantPlugin)
enquirySchema.index({ tenantId: 1, enquiryNo: 1 }, { unique: true })
enquirySchema.index({ tenantId: 1, stage: 1, nextFollowUpOn: 1 })
enquirySchema.index({ tenantId: 1, mobile: 1 })
export const Enquiry = model('Enquiry', enquirySchema, 'enquiries')

const applicationSchema = new Schema({
  applicationNo: { type: String, required: true },
  cycleId: { type: ObjectId, ref: 'AdmissionCycle', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  branchId: { type: ObjectId, ref: 'Branch' },
  enquiryId: { type: ObjectId, ref: 'Enquiry' },
  channel: { type: String, default: 'DESK' }, // DESK · ONLINE
  child: {
    firstName: { type: String, required: true, trim: true }, middleName: String, lastName: String,
    dob: ymd, gender: String, bloodGroup: String, category: String, religion: String, motherTongue: String, aadhaarLast4: String,
    previousSchool: { name: String, board: String, lastClass: String },
  },
  parent: { name: { type: String, required: true }, relation: String, mobile: { type: String, required: true }, email: String, occupation: String },
  otherParent: { name: String, relation: String, mobile: String },
  address: { line: String, city: String, state: String, pincode: String },
  siblingStudentId: { type: ObjectId, ref: 'Student' },
  answers: { type: Schema.Types.Mixed, default: undefined }, // the cycle's extra form
  formId: ObjectId, formVersion: Number,
  status: { type: String, default: 'SUBMITTED' }, // APPLICATION_STATUS
  statusNote: String,
  testId: { type: ObjectId, ref: 'EntranceTest' },
  testMarks: Number, testAbsent: Boolean,
  score: Number, // merit score: test marks % or one entered (MERIT_BASES)
  rank: Number,
  offer: { at: Date, by: String, until: String, note: String },
  acceptedAt: Date,
  studentId: { type: ObjectId, ref: 'Student' }, admittedAt: Date, admittedBy: String,
  submittedAt: { type: Date, default: Date.now },
  createdBy: String,
}, { timestamps: true, minimize: false })
applicationSchema.plugin(tenantPlugin)
applicationSchema.index({ tenantId: 1, applicationNo: 1 }, { unique: true })
applicationSchema.index({ tenantId: 1, cycleId: 1, classId: 1, status: 1 })
applicationSchema.index({ tenantId: 1, 'parent.mobile': 1 })
export const Application = model('Application', applicationSchema, 'applications')

const testSchema = new Schema({
  cycleId: { type: ObjectId, ref: 'AdmissionCycle', required: true },
  name: { type: String, required: true, trim: true },
  classIds: { type: [ObjectId], default: [] },
  date: { ...ymd, required: true },
  time: String, // HH:MM
  venue: String,
  maxMarks: { type: Number, default: 100 },
  instructions: String,
  marksLocked: { type: Boolean, default: false },
  createdBy: String,
}, { timestamps: true })
testSchema.plugin(tenantPlugin)
export const EntranceTest = model('EntranceTest', testSchema, 'entrance_tests')
