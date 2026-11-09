// Front office (module `frontoffice`): the visitor log, gate passes and complaints. Tenant-scoped.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

/** One visit: checked in at the desk, checked out when the visitor leaves (`outAt`). */
const visitorSchema = new Schema({
  date: { type: String, required: true }, // YYYY-MM-DD (institution time) of check-in
  branchId: { type: ObjectId, ref: 'Branch' },
  name: { type: String, required: true, trim: true },
  mobile: { type: String, trim: true },
  purpose: { type: String, required: true }, // FO_VISIT_PURPOSES
  purposeNote: { type: String, trim: true },
  from: { type: String, trim: true }, // company / address / "parent of …"
  people: { type: Number, default: 1 },
  hostId: { type: ObjectId, ref: 'User' }, // whom to meet
  hostName: String,
  studentId: { type: ObjectId, ref: 'Student' }, // a parent meeting: whose parent
  studentName: String,
  idType: String, // FO_ID_TYPES
  idNumber: { type: String, trim: true },
  /** A small JPEG data URL from the desk camera; left out of lists — ask for `+photo`. */
  photo: { type: String, select: false },
  hasPhoto: { type: Boolean, default: false },
  badgeNo: { type: String, trim: true },
  vehicleNo: { type: String, trim: true },
  note: { type: String, trim: true },
  inAt: { type: Date, required: true },
  outAt: Date,
  checkedInBy: String,
  checkedOutBy: String,
  enquiryId: { type: ObjectId }, // the admission enquiry made from this visit
  enquiryNo: String,
}, { timestamps: true })
visitorSchema.plugin(tenantPlugin)
visitorSchema.index({ tenantId: 1, date: -1, inAt: -1 })
visitorSchema.index({ tenantId: 1, outAt: 1 })
visitorSchema.index({ tenantId: 1, mobile: 1 })

export const Visitor = model('FoVisitor', visitorSchema, 'fo_visitors')

const collectorSchema = new Schema({
  type: { type: String, default: 'GUARDIAN' }, // FO_COLLECTOR_TYPES
  guardianId: ObjectId,
  name: { type: String, trim: true },
  relation: { type: String, trim: true },
  mobile: { type: String, trim: true },
  idNumber: { type: String, trim: true },
  photo: String, // small JPEG data URL (someone not on record)
}, { _id: false })

/** Leaving school during the day: a student collected early, or a staff member stepping out. */
const gatePassSchema = new Schema({
  passNo: { type: String, required: true },
  kind: { type: String, default: 'STUDENT' }, // STUDENT · STAFF
  date: { type: String, required: true }, // YYYY-MM-DD
  branchId: { type: ObjectId, ref: 'Branch' },
  studentId: { type: ObjectId, ref: 'Student' },
  studentName: String,
  admissionNo: String,
  sectionId: { type: ObjectId, ref: 'Section' },
  classLabel: String,
  staffId: { type: ObjectId, ref: 'User' },
  staffName: String,
  collector: { type: collectorSchema, default: undefined },
  reason: { type: String, required: true, trim: true },
  leaveAt: String, // HH:MM planned
  returnBy: String, // HH:MM (staff)
  status: { type: String, default: 'REQUESTED' }, // FO_GATE_PASS_STATUS
  requestedBy: String,
  requestedById: ObjectId,
  approvedBy: String,
  approvedById: ObjectId,
  approvedAt: Date,
  decisionNote: String,
  leftAt: Date,
  leftBy: String, // gate staff who let them out
  returnedAt: Date,
  cancelledReason: String,
}, { timestamps: true })
gatePassSchema.plugin(tenantPlugin)
gatePassSchema.index({ tenantId: 1, date: -1, status: 1 })
gatePassSchema.index({ tenantId: 1, studentId: 1, date: -1 })
gatePassSchema.index({ tenantId: 1, passNo: 1 }, { unique: true })

export const GatePass = model('FoGatePass', gatePassSchema, 'fo_gate_passes')

const stepSchema = new Schema({
  at: { type: Date, default: Date.now },
  by: String,
  action: String, // RAISED · ASSIGNED · STATUS · NOTE · RESOLVED · CLOSED · REOPENED
  status: String,
  note: String,
}, { _id: false })

/** A complaint or grievance, tracked to resolution against the SLA. */
const complaintSchema = new Schema({
  complaintNo: { type: String, required: true },
  date: { type: String, required: true }, // raised on, YYYY-MM-DD
  branchId: { type: ObjectId, ref: 'Branch' },
  source: { type: String, required: true }, // FO_COMPLAINT_SOURCES
  category: { type: String, required: true }, // FO_COMPLAINT_CATEGORIES
  priority: { type: String, default: 'MEDIUM' },
  subject: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  // who complained
  complainant: {
    name: { type: String, trim: true },
    mobile: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    userId: ObjectId, // a staff complainant
  },
  studentId: { type: ObjectId, ref: 'Student' }, // the child it is about / whose family raised it
  studentName: String,
  classLabel: String,
  familyMobile: String, // 10 digits — the family app number that raised it
  assignedToId: { type: ObjectId, ref: 'User' },
  assignedTo: String,
  status: { type: String, default: 'OPEN' },
  dueOn: String, // YYYY-MM-DD (date + SLA days)
  resolution: { type: String, trim: true },
  resolvedAt: Date,
  resolvedBy: String,
  closedAt: Date,
  rating: Number, // the family's 1–5 after resolution (family app)
  steps: { type: [stepSchema], default: [] },
  createdBy: String,
}, { timestamps: true })
complaintSchema.plugin(tenantPlugin)
complaintSchema.index({ tenantId: 1, status: 1, dueOn: 1 })
complaintSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })
complaintSchema.index({ tenantId: 1, assignedToId: 1, status: 1 })
complaintSchema.index({ tenantId: 1, complaintNo: 1 }, { unique: true })

export const Complaint = model('FoComplaint', complaintSchema, 'fo_complaints')
