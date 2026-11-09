// Staff & HR (module `hrms`). Tenant-scoped.
//
//   Employee         the staff record: personal, job, exit; salary / bank / statutory ids hidden (select: false)
//   Holiday          the institution's holidays (all campuses or some)
//   StaffAttendance  one row a day per person: status, in/out, payable and loss of pay (payroll reads these)
//   LeaveType        a kind of leave and its policy
//   LeaveLedger      append-only; a type's balance = Σ days
//   Leave            a leave request and its decision
//   Requisition      a vacancy to fill
//   Candidate        a person applying for one, through the hiring steps
//   AppraisalCycle   a review round with its criteria
//   Appraisal        one person's review in a round: self, then the reviewer
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const by = { by: String, byId: ObjectId, at: Date }
/** An encrypted id with its last four characters kept for the masked display. */
const secret = new Schema({ enc: String, last4: String }, { _id: false })

// ───────────────────────────────────────────────────────── employees

const employeeSchema = new Schema({
  employeeCode: { type: String, required: true, trim: true, uppercase: true },
  userId: ObjectId, // sign-in account — self-service, timetable and classes find the person by it
  name: { type: String, required: true, trim: true },
  gender: String, // students.js GENDERS
  dob: String, // YYYY-MM-DD
  bloodGroup: String,
  mobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  address: { line: String, city: String, state: String, pincode: String },
  emergencyContact: { name: String, relation: String, phone: String },
  qualifications: { type: String, trim: true }, // "M.Sc. Physics, B.Ed."
  experienceYears: Number, // before joining
  subjects: { type: [String], default: undefined }, // what a teacher can teach (free text)

  departmentId: ObjectId,
  designation: { type: String, trim: true },
  category: { type: String, required: true }, // EMPLOYEE_CATEGORIES
  employmentType: { type: String, required: true }, // EMPLOYMENT_TYPES
  branchId: ObjectId,
  reportingManagerId: ObjectId, // another Employee — approves their leave and reviews them
  joiningDate: { type: String, required: true },
  confirmationDate: String,
  weeklyOffDays: { type: [String], default: undefined }, // own weekly off (else Settings › Staff & HR)

  status: { type: String, default: 'ACTIVE' }, // EMPLOYEE_STATUSES — only the exit actions move it
  geofenceExempt: { type: Boolean, default: false }, // field staff: may mark themselves in and out anywhere
  exit: { type: { type: String }, noticeDate: String, lastWorkingDate: String, reason: String, deactivateLogin: Boolean, ...by },

  statutory: { type: new Schema({ pan: secret, aadhaar: secret, uan: secret, esi: secret }, { _id: false }), select: false },
  bank: { type: new Schema({ bankName: String, ifsc: String, accountName: String, account: secret }, { _id: false }), select: false },
  salary: {
    type: new Schema({
      paymentMode: { type: String, default: 'BANK' },
      ctcAnnual: Number, grossMonthly: Number, basicMonthly: Number, // paise
      pf: { type: Boolean, default: true }, esi: { type: Boolean, default: false }, pt: { type: Boolean, default: true },
      effectiveFrom: String, revisedBy: String, revisedAt: Date,
    }, { _id: false }),
    select: false,
  },

  jobHistory: [{ type: { type: String }, date: String, from: String, to: String, note: String, by: String, at: Date, _id: false }],
  leaveAccruedTo: String, // YYYY-MM — monthly leave has been credited up to this month
  leaveYearDone: String, // the leave year whose yearly credit has been made ('2026-27')
  candidateId: ObjectId, // hired through Recruitment
  notes: String,
  createdBy: String,
}, { timestamps: true })
employeeSchema.plugin(tenantPlugin)
employeeSchema.index({ tenantId: 1, employeeCode: 1 }, { unique: true })
employeeSchema.index({ tenantId: 1, userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } })
employeeSchema.index({ tenantId: 1, status: 1, departmentId: 1 })
employeeSchema.index({ tenantId: 1, reportingManagerId: 1 })
employeeSchema.index({ tenantId: 1, name: 1 })
export const Employee = model('Employee', employeeSchema, 'employees')

// ───────────────────────────────────────────────────────── holidays

const holidaySchema = new Schema({
  date: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  branchIds: { type: [ObjectId], default: [] }, // empty = every campus
  optional: { type: Boolean, default: false }, // restricted holiday — not a day off for everyone
  forStudents: { type: Boolean, default: true }, // also a holiday for students (staff may still come in)
  createdBy: String,
}, { timestamps: true })
holidaySchema.plugin(tenantPlugin)
holidaySchema.index({ tenantId: 1, date: 1 })
export const Holiday = model('Holiday', holidaySchema, 'hr_holidays')

// ───────────────────────────────────────────────────────── staff attendance

const staffAttendanceSchema = new Schema({
  employeeId: { type: ObjectId, required: true },
  date: { type: String, required: true },
  status: { type: String, required: true }, // STAFF_ATTENDANCE
  inTime: String, outTime: String, // HH:MM
  late: { type: Boolean, default: false },
  payable: { type: Number, default: 0 }, // 0 · 0.5 · 1
  lop: { type: Number, default: 0 },
  leave: { leaveId: ObjectId, code: String, portion: Number, paid: Boolean },
  source: { type: String, default: 'MANUAL' }, // MANUAL · IMPORT · LEAVE
  note: String,
  markedBy: String, markedAt: Date,
}, { timestamps: true })
staffAttendanceSchema.plugin(tenantPlugin)
staffAttendanceSchema.index({ tenantId: 1, employeeId: 1, date: 1 }, { unique: true })
staffAttendanceSchema.index({ tenantId: 1, date: 1 })
export const StaffAttendance = model('StaffAttendance', staffAttendanceSchema, 'hr_attendance')

// ───────────────────────────────────────────────────────── leave

const leaveTypeSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  paid: { type: Boolean, default: true },
  accrual: { type: String, default: 'YEARLY' }, // LEAVE_ACCRUALS
  perYear: { type: Number, default: 0 },
  carryForwardMax: { type: Number, default: 0 }, // days kept into the next leave year
  allowHalfDay: { type: Boolean, default: true },
  sandwich: { type: Boolean, default: false }, // offs and holidays between leave days count
  allowNegative: { type: Boolean, default: false }, // may be taken without a balance
  maxPerRequest: Number,
  genders: { type: [String], default: [] }, categories: { type: [String], default: [] }, // empty = everyone
  tone: { type: String, default: 'neutral' },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true })
leaveTypeSchema.plugin(tenantPlugin)
leaveTypeSchema.index({ tenantId: 1, code: 1 }, { unique: true })
export const LeaveType = model('LeaveType', leaveTypeSchema, 'hr_leave_types')

const leaveLedgerSchema = new Schema({
  employeeId: { type: ObjectId, required: true },
  leaveTypeId: { type: ObjectId, required: true }, leaveCode: String,
  kind: { type: String, required: true }, // LEAVE_LEDGER_KINDS
  date: { type: String, required: true },
  days: { type: Number, required: true },
  period: String, // '2026-10' (monthly accrual), '2026-27' (yearly credit / lapse / carry) — a rerun adds nothing twice
  leaveId: ObjectId,
  note: String,
  by: String, byId: ObjectId,
}, { timestamps: true })
leaveLedgerSchema.plugin(tenantPlugin)
leaveLedgerSchema.index({ tenantId: 1, employeeId: 1, leaveTypeId: 1, date: 1 })
leaveLedgerSchema.index({ tenantId: 1, employeeId: 1, leaveTypeId: 1, kind: 1, period: 1 }, { unique: true, partialFilterExpression: { period: { $type: 'string' } } })
export const LeaveLedger = model('LeaveLedger', leaveLedgerSchema, 'hr_leave_ledger')

const leaveSchema = new Schema({
  employeeId: { type: ObjectId, required: true },
  employeeName: String, employeeCode: String, departmentId: ObjectId, branchId: ObjectId, userId: ObjectId,
  leaveTypeId: { type: ObjectId, required: true }, leaveCode: String, leaveName: String, paid: Boolean,
  from: { type: String, required: true }, to: { type: String, required: true },
  halfDay: { type: Boolean, default: false }, half: String, // FIRST · SECOND
  days: { type: Number, required: true },
  dates: [{ date: String, portion: Number, _id: false }],
  reason: String,
  arrangement: String, // who takes the classes (a teacher's note for the substitution desk)
  status: { type: String, default: 'PENDING' }, // LEAVE_STATUSES
  applied: { ...by, onBehalf: Boolean },
  decided: { ...by, note: String },
  cancelled: { ...by, reason: String, afterApproval: Boolean },
  pendingWith: [ObjectId], // the reporting manager's login ("waiting on me"); HR approvers see every request
}, { timestamps: true })
leaveSchema.plugin(tenantPlugin)
leaveSchema.index({ tenantId: 1, pendingWith: 1, status: 1 })
leaveSchema.index({ tenantId: 1, employeeId: 1, from: 1 })
leaveSchema.index({ tenantId: 1, status: 1, from: 1 })
leaveSchema.index({ tenantId: 1, 'dates.date': 1 })
export const Leave = model('Leave', leaveSchema, 'hr_leaves')

// ───────────────────────────────────────────────────────── recruitment

const requisitionSchema = new Schema({
  requisitionNo: { type: String, required: true },
  title: { type: String, required: true, trim: true }, // "PGT Physics", "Transport attendant"
  departmentId: ObjectId, branchId: ObjectId,
  category: { type: String, required: true }, // EMPLOYEE_CATEGORIES
  employmentType: { type: String, default: 'PERMANENT' },
  subjects: { type: [String], default: undefined },
  count: { type: Number, required: true, min: 1 },
  description: String, // duties, qualifications
  salaryRange: { min: Number, max: Number }, // paise a month
  targetDate: String,
  status: { type: String, default: 'OPEN' }, // REQUISITION_STATUSES
  statusHistory: [{ status: String, note: String, ...by, _id: false }],
  filled: { type: Number, default: 0 },
  createdBy: String,
}, { timestamps: true })
requisitionSchema.plugin(tenantPlugin)
requisitionSchema.index({ tenantId: 1, requisitionNo: 1 }, { unique: true })
requisitionSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
export const Requisition = model('Requisition', requisitionSchema, 'hr_requisitions')

const candidateSchema = new Schema({
  requisitionId: { type: ObjectId, required: true },
  name: { type: String, required: true, trim: true },
  mobile: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true },
  gender: String,
  qualifications: String, experienceYears: Number, currentEmployer: String,
  expectedSalary: Number, // paise a month
  source: { type: String, default: 'OTHER' }, // CANDIDATE_SOURCES
  stage: { type: String, default: 'APPLIED' }, // CANDIDATE_STAGES
  // a step booked: the demo class or the interview
  next: { kind: String, date: String, time: String, panel: String, note: String },
  evaluations: [{ stage: String, rating: Number, note: String, by: String, byId: ObjectId, at: Date }],
  offer: { salary: Number, joiningDate: String, designation: String, note: String, at: Date, by: String },
  history: [{ stage: String, note: String, by: String, at: Date, _id: false }],
  employeeId: ObjectId, // made when they join
  createdBy: String,
}, { timestamps: true })
candidateSchema.plugin(tenantPlugin)
candidateSchema.index({ tenantId: 1, requisitionId: 1, stage: 1 })
candidateSchema.index({ tenantId: 1, mobile: 1 })
export const Candidate = model('Candidate', candidateSchema, 'hr_candidates')

// ───────────────────────────────────────────────────────── appraisal

const criterionSchema = new Schema({ key: String, label: String, weight: { type: Number, default: 1 } }, { _id: false })
const cycleSchema = new Schema({
  name: { type: String, required: true, trim: true }, // "2026-27 annual review"
  from: String, to: String, // the period reviewed
  dueDate: String,
  criteria: { type: [criterionSchema], default: [] },
  categories: { type: [String], default: [] }, // staff it covers; empty = everyone
  selfReview: { type: Boolean, default: true },
  status: { type: String, default: 'DRAFT' }, // APPRAISAL_CYCLE_STATUS
  launchedAt: Date, closedAt: Date,
  createdBy: String,
}, { timestamps: true })
cycleSchema.plugin(tenantPlugin)
export const AppraisalCycle = model('AppraisalCycle', cycleSchema, 'hr_appraisal_cycles')

const reviewPart = { ratings: { type: Schema.Types.Mixed, default: undefined }, comments: String, score: Number, by: String, byId: ObjectId, at: Date }
const appraisalSchema = new Schema({
  cycleId: { type: ObjectId, required: true },
  employeeId: { type: ObjectId, required: true }, employeeName: String, employeeCode: String, designation: String, departmentId: ObjectId,
  userId: ObjectId, // the person's login (self review)
  reviewerUserId: ObjectId, reviewerName: String, // the reporting manager's login; else HR
  status: { type: String, default: 'SELF' }, // APPRAISAL_STATUS
  self: reviewPart,
  manager: { ...reviewPart, strengths: String, improve: String, goals: String },
  finalScore: Number,
}, { timestamps: true, minimize: false })
appraisalSchema.plugin(tenantPlugin)
appraisalSchema.index({ tenantId: 1, cycleId: 1, employeeId: 1 }, { unique: true })
appraisalSchema.index({ tenantId: 1, reviewerUserId: 1, status: 1 })
appraisalSchema.index({ tenantId: 1, userId: 1 })
export const Appraisal = model('Appraisal', appraisalSchema, 'hr_appraisals')
