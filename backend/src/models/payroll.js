// Payroll (module `payroll`, ported from the hospital): statutory rules, salary structures and who is on which, staff
// loans and advances, monthly runs and their payslips. Money in paise. Staff, attendance and the leave ledger are read
// from Staff & HR (models/hrms.js), never copied back.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const Mixed = Schema.Types.Mixed
const by = { by: String, byId: ObjectId, at: Date }
const rule = new Schema({ type: { type: String, required: true }, of: String, pct: Number, amount: Number }, { _id: false })

// ───────────────────────────────────────────────────────── statutory rules (one per institution)

const statutorySchema = new Schema({
  key: { type: String, default: 'MAIN' },
  pf: Mixed, esi: Mixed, pt: Mixed, lwf: Mixed, tds: Mixed, gratuity: Mixed, encashment: Mixed, notice: Mixed,
  payDayBasis: { type: String, default: 'CALENDAR' },
  separateDuties: { type: Boolean, default: true },
  verified: { ...by, note: String }, // the institution confirmed these against current notifications
  updatedBy: String,
}, { timestamps: true, minimize: false })
statutorySchema.plugin(tenantPlugin)
statutorySchema.index({ tenantId: 1, key: 1 }, { unique: true })
export const PayrollStatutory = model('PayrollStatutory', statutorySchema, 'payroll_statutory')

// ───────────────────────────────────────────────────────── salary structures

const structureSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  categories: [String], // EMPLOYEE_CATEGORIES it is meant for (a hint when assigning)
  components: [{ code: { type: String, required: true }, rule: { type: rule, required: true }, _id: false }],
  active: { type: Boolean, default: true },
  createdBy: String, updatedBy: String,
}, { timestamps: true })
structureSchema.plugin(tenantPlugin)
structureSchema.index({ tenantId: 1, code: 1 }, { unique: true })
export const PayrollStructure = model('PayrollStructure', structureSchema, 'payroll_structures')

/** A staff member on a structure from a date. The latest one on or before a month's end applies. */
const assignmentSchema = new Schema({
  employeeId: { type: ObjectId, required: true },
  employeeName: String, employeeCode: String,
  structureId: { type: ObjectId, required: true }, structureName: String,
  effectiveFrom: { type: String, required: true }, // YYYY-MM-DD
  grossMonthly: Number, // paise; empty = the gross on the salary record
  overrides: [{ code: String, rule: rule, _id: false }],
  tdsMonthly: Number, // paise; empty = projected by the TDS rules
  notes: String,
  createdBy: String,
}, { timestamps: true })
assignmentSchema.plugin(tenantPlugin)
assignmentSchema.index({ tenantId: 1, employeeId: 1, effectiveFrom: 1 }, { unique: true })
export const PayrollAssignment = model('PayrollAssignment', assignmentSchema, 'payroll_assignments')

// ───────────────────────────────────────────────────────── loans and advances

const loanSchema = new Schema({
  loanNo: { type: String, required: true },
  employeeId: { type: ObjectId, required: true }, employeeName: String, employeeCode: String,
  type: { type: String, default: 'ADVANCE' }, // LOAN_TYPES
  amount: { type: Number, required: true }, // paise
  instalment: { type: Number, required: true }, // paise a month
  startMonth: { type: String, required: true }, // YYYY-MM — first month recovered
  disbursedOn: String, reason: String,
  skipMonths: [String], // months with no instalment
  status: { type: String, default: 'ACTIVE' }, // LOAN_STATUSES
  // appended when a run is paid; one per payslip, so paying twice adds nothing
  recoveries: [{ payslipId: ObjectId, runId: ObjectId, month: String, amount: Number, at: Date, _id: false }],
  closed: { ...by, note: String },
  createdBy: String,
}, { timestamps: true })
loanSchema.plugin(tenantPlugin)
loanSchema.index({ tenantId: 1, loanNo: 1 }, { unique: true })
loanSchema.index({ tenantId: 1, employeeId: 1, status: 1 })
export const PayrollLoan = model('PayrollLoan', loanSchema, 'payroll_loans')

// ───────────────────────────────────────────────────────── runs and payslips

const runSchema = new Schema({
  runNo: { type: String, required: true },
  month: { type: String, required: true }, // YYYY-MM
  branchId: ObjectId, branchName: String, // empty = the whole institution
  scopeKey: { type: String, required: true }, // 'ALL' or the branch id — one run per month per scope
  status: { type: String, default: 'DRAFT' }, // PAYROLL_RUN_STATUSES — only the run actions move it
  version: { type: Number, default: 0 },
  totals: { employees: Number, gross: Number, deductions: Number, net: Number, employerContribution: Number, employerCost: Number, pf: Number, esi: Number, pt: Number, lwf: Number, tds: Number, loans: Number, lop: Number },
  exceptions: [{ employeeId: ObjectId, employeeName: String, employeeCode: String, reason: String, _id: false }],
  created: by,
  calculated: { ...by, count: Number },
  preparers: [ObjectId], // everyone who calculated or changed a payslip — none of them may approve (separation of duties)
  approved: { ...by, note: String },
  paid: { ...by, date: String, mode: String, reference: String, note: String },
  reopened: [{ ...by, reason: String, _id: false }],
  notes: String,
}, { timestamps: true })
runSchema.plugin(tenantPlugin)
runSchema.index({ tenantId: 1, runNo: 1 }, { unique: true })
runSchema.index({ tenantId: 1, month: 1, scopeKey: 1 }, { unique: true })
export const PayrollRun = model('PayrollRun', runSchema, 'payroll_runs')

const line = { code: String, label: String, amount: Number, full: Number, basis: String, note: String, month: String, manual: Boolean, _id: false }

const payslipSchema = new Schema({
  payslipNo: { type: String, required: true },
  runId: { type: ObjectId, required: true }, runNo: String,
  month: { type: String, required: true },
  status: { type: String, default: 'CALCULATED' }, // the run's status, copied on every move
  employeeId: { type: ObjectId, required: true },
  userId: ObjectId, // the person's login (self-service finds own payslips by it)
  employee: {
    code: String, name: String, designation: String, departmentName: String, branchId: ObjectId, branchName: String, category: String, gender: String,
    joiningDate: String, lastWorkingDate: String, exitType: String, paymentMode: String,
    pan: String, uan: String, esi: String, // last four only
    bankName: String, ifsc: String, accountLast4: String,
  },
  structureId: ObjectId, structureName: String, assignmentId: ObjectId,
  grossMonthly: Number,
  state: String, // PT / LWF state code
  attendance: {
    daysInMonth: Number, baseDays: Number, notEmployedDays: Number, payDays: Number,
    lop: Number, lopAuto: Number, unmarked: Number,
    present: Number, halfDays: Number, absent: Number, leave: Number, late: Number,
  },
  lopOverride: { days: Number, reason: String, ...by },
  adjustments: [{ code: String, label: String, amount: Number, note: String, by: String, at: Date, _id: false }],
  earnings: [line], deductions: [line], employer: [line],
  loans: [{ loanId: ObjectId, label: String, amount: Number, _id: false }],
  arrearsFor: [{ month: String, amount: Number, _id: false }],
  fnf: { lastWorkingDate: String, exitType: String, leaveDays: Number, leaveEncashment: Number, gratuity: Number, serviceYears: Number, countedYears: Number, noticeDays: Number, noticeServed: Number, noticeShortfall: Number, noticeRecovery: Number, note: String },
  gross: Number, totalDeductions: Number, net: Number, employerContribution: Number, employerCost: Number,
  fixedFull: Number, fixedEarned: Number, pfWages: Number, esiWages: Number,
  ytd: { gross: Number, pf: Number, esi: Number, pt: Number, tds: Number, net: Number },
  warnings: [String],
  paid: { date: String, mode: String, reference: String },
  calculatedAt: Date,
}, { timestamps: true })
payslipSchema.plugin(tenantPlugin)
payslipSchema.index({ tenantId: 1, runId: 1, employeeId: 1 }, { unique: true })
payslipSchema.index({ tenantId: 1, payslipNo: 1 }, { unique: true })
payslipSchema.index({ tenantId: 1, employeeId: 1, month: -1 })
payslipSchema.index({ tenantId: 1, userId: 1, month: -1 })
export const Payslip = model('Payslip', payslipSchema, 'payroll_payslips')
