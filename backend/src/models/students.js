// Students and their guardians (module `students`). Tenant-scoped.
//
// The core record the rest of the product hangs off: attendance, marks, fees, transport and
// messages all point at a student. A student is in one section at a time (`sectionId`, a
// section of one academic year); `history` keeps every year's section and what happened at
// its end. Aadhaar is stored encrypted, with a keyed hash to spot duplicates and the last
// four digits for the masked view.
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { makeVerifyCode } from '@schoolgiant/shared'
import { tenantPlugin } from '../platform/db.js'

/** A TC's check code: the QR on the printed TC opens /verify/tc/<code>. */
export const newTcCode = () => makeVerifyCode(() => crypto.randomInt(0, 2 ** 31) / 2 ** 31)

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'LEFT', 'PASSED_OUT']

const guardianSchema = new Schema({
  name: { type: String, required: true, trim: true },
  relation: { type: String, trim: true }, // GUARDIAN_RELATIONS
  mobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  occupation: { type: String, trim: true },
  /** Messages to the family go to the primary guardian (one per student). */
  isPrimary: { type: Boolean, default: false },
}, { _id: true })

const historySchema = new Schema({
  event: { type: String, required: true }, // HISTORY_EVENTS
  academicYearId: ObjectId,
  yearName: String,
  sectionId: ObjectId,
  classLabel: String, // "Class 8 – A" at the time
  note: String,
  at: { type: Date, default: Date.now },
  by: String,
}, { _id: false })

const studentSchema = new Schema({
  admissionNo: { type: String, required: true, trim: true },
  firstName: { type: String, required: true, trim: true },
  middleName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  gender: { type: String, trim: true }, // GENDERS
  dob: ymd,
  bloodGroup: String,
  category: String, // STUDENT_CATEGORIES
  religion: { type: String, trim: true },
  nationality: { type: String, trim: true, default: 'Indian' },
  motherTongue: { type: String, trim: true },
  admissionDate: ymd,
  branchId: { type: ObjectId, ref: 'Branch' },
  classId: { type: ObjectId, ref: 'ClassLevel' }, // the class of sectionId, kept for fast filters
  sectionId: { type: ObjectId, ref: 'Section' }, // current class section (Academic setup)
  rollNo: { type: String, trim: true },
  /** "<class order>|<section name>" — the directory's sort order, kept with the section (services/students.js). */
  placeKey: String,
  status: { type: String, enum: STUDENT_STATUSES, default: 'ACTIVE' },
  // the student's own contact (colleges, older students); schools mostly reach guardians
  mobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  address: { line: String, city: String, state: String, pincode: String },
  guardians: { type: [guardianSchema], default: [] },
  aadhaarEnc: String, // platform/crypto.js encrypt
  aadhaarLast4: String,
  aadhaarIndex: String, // blindIndex — duplicate check without decrypting
  apaarId: { type: String, trim: true },
  pen: { type: String, trim: true }, // UDISE+ Permanent Education Number
  // the school the student comes from, and its TC as written on it: name and date of birth are checked against the
  // student's (tcMismatch); a difference is kept with the office's note on why
  previousSchool: { name: String, board: String, lastClass: String, tcNo: String, tcDate: String, nameOnTc: String, dobOnTc: String, mismatchNote: String },
  medical: { allergies: String, conditions: String, notes: String },
  /** Language messages to this family are written in (SUPPORTED_LANGUAGES name or code). */
  language: { type: String, trim: true },
  consents: {
    // false = the family asked not to get messages on that channel (email needs an explicit yes)
    communication: { sms: Boolean, whatsapp: Boolean, email: Boolean },
  },
  history: { type: [historySchema], default: [] },
  leaving: { date: String, reason: String, tcId: ObjectId, tcNo: String },
  /** A small PNG / JPEG / WebP data URL (ID cards, the profile); left out of lists — ask for `+photo`. */
  photo: { type: String, select: false },
  /** The ID card's public check code (its QR), given the first time a card is printed and kept for reprints. */
  cardCode: String,
  customFields: { type: Schema.Types.Mixed, default: undefined },
}, { timestamps: true, minimize: false })
studentSchema.plugin(tenantPlugin)
studentSchema.index({ tenantId: 1, admissionNo: 1 }, { unique: true })
// the public card check looks a code up across institutions
studentSchema.index({ cardCode: 1 }, { unique: true, partialFilterExpression: { cardCode: { $type: 'string' } } })
studentSchema.index({ tenantId: 1, status: 1, sectionId: 1, rollNo: 1 })
studentSchema.index({ tenantId: 1, status: 1, placeKey: 1, rollNo: 1 })
studentSchema.index({ tenantId: 1, classId: 1, status: 1 })
studentSchema.index({ tenantId: 1, 'guardians.mobile': 1 })
studentSchema.index({ tenantId: 1, aadhaarIndex: 1 }, { sparse: true })
studentSchema.index({ tenantId: 1, firstName: 1, lastName: 1 })

export const Student = model('Student', studentSchema, 'students')

/** A transfer (leaving) certificate: requested, then issued by someone who may approve it. */
const tcSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  status: { type: String, default: 'REQUESTED' }, // TC_STATUS
  tcNo: String,
  verifyCode: { type: String, default: newTcCode },
  leavingDate: { ...ymd, required: true },
  reason: String, // LEAVING_REASONS
  reasonText: String,
  conduct: String,
  lastClassLabel: String,
  promotedTo: String, // "Qualified for promotion to Class 9" etc., free text
  feesPaidUpTo: String,
  remarks: String,
  // the rest of the CBSE-format TC (all optional; the printed TC leaves a blank line for whatever is empty)
  bookNo: String, // the TC book / register number the school writes on top
  applicationDate: ymd, // when the family applied for the TC
  lastExam: String, // "School annual examination, March 2026" / "AISSE (Class X), 2026"
  lastExamResult: String, // "Passed" / "Failed" / "Compartment in Mathematics"
  failed: String, // TC_FAILED: NO · ONCE · TWICE
  subjects: { type: [String], default: undefined },
  concession: String, // "No" or its nature: "RTE seat (100%)", "Sibling concession 10%"
  workingDays: Number, // in the academic session up to leaving
  presentDays: Number,
  nccScoutGuide: String, // "No" or the details
  games: String, // games / activities with the level reached
  // a copy of the student as it was, so a reprint reads the same after later edits
  snapshot: { type: Schema.Types.Mixed, default: {} },
  requestedBy: String,
  requestedById: ObjectId,
  issuedAt: Date,
  issuedBy: String,
  cancelledAt: Date,
  cancelledBy: String,
  cancelReason: String,
  // issued while the records showed dues (fees, library): the approver's reason and what was open at the time
  duesOverride: { type: new Schema({ reason: String, open: [String], by: String, byId: ObjectId, at: Date }, { _id: false }), default: undefined },
  // what issuing it wound up (studentLeaving.js WIND_UP_KEYS): DONE · PENDING · UNDONE, with the records it changed
  windUp: { type: [new Schema({ key: String, status: String, refs: [ObjectId], amount: Number, note: String, by: String, at: Date, undoneBy: String, undoneAt: Date }, { _id: false })], default: undefined },
}, { timestamps: true, minimize: false })
tcSchema.plugin(tenantPlugin)
tcSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
tcSchema.index({ tenantId: 1, studentId: 1 })
tcSchema.index({ verifyCode: 1 }, { unique: true, partialFilterExpression: { verifyCode: { $type: 'string' } } })

export const TransferCertificate = model('TransferCertificate', tcSchema, 'transfer_certificates')

/** "Aarav Kumar Sharma" */
export const studentName = (s) => [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(' ')

/** Where a message about this student goes: the primary guardian, else the first one, else the student. */
export function familyContact(s) {
  if (!s) return null
  const g = s.guardians?.find((x) => x.isPrimary) ?? s.guardians?.[0]
  return {
    name: g?.name ?? studentName(s),
    mobile: g?.mobile || s.mobile || null,
    email: g?.email || s.email || null,
  }
}

// ───────────────────────────────────────────────────────── admission forms filled by families

/**
 * New admission › Send form to family: a link (a random token; only its hash is kept) to fill in the child's admission
 * form and add the documents from a phone. What the family sends sits here until the office opens it on New admission,
 * checks it and admits; the files then move to the student.
 */
const admissionFormSchema = new Schema({
  tokenHash: { type: String, required: true },
  branchId: { type: ObjectId, ref: 'Branch' },
  sectionId: { type: ObjectId, ref: 'Section' }, // optional: the class and section the office has in mind
  classLabel: String,
  childName: { type: String, trim: true }, // as the office typed it, to start the form and the message with
  parentName: { type: String, trim: true },
  mobile: String, email: String,
  channels: { type: [String], default: [] }, // MESSAGE_CHANNELS it was sent on
  expiresOn: { type: String, required: true }, // YYYY-MM-DD, the last day the link works
  status: { type: String, default: 'SENT' }, // ADMISSION_FORM_STATUS (EXPIRED is worked out, not kept)
  data: { type: Schema.Types.Mixed, default: undefined }, // the form as the family filled it (StudentForm's fields)
  localNames: { type: Schema.Types.Mixed, default: undefined }, // { student: { hi: '…' }, guardians: [{ hi: '…' }] }
  openedAt: Date, submittedAt: Date, submitCount: { type: Number, default: 0 },
  studentId: { type: ObjectId, ref: 'Student' }, admittedAt: Date, admittedBy: String,
  cancelledAt: Date, cancelledBy: String,
  createdBy: String, createdById: ObjectId,
}, { timestamps: true, minimize: false })
admissionFormSchema.plugin(tenantPlugin)
admissionFormSchema.index({ tenantId: 1, tokenHash: 1 }, { unique: true })
admissionFormSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
export const AdmissionForm = model('AdmissionForm', admissionFormSchema, 'admission_forms')
