// Programs & OBE (module `programs`, higher education). Tenant-scoped.
//
//   Regulation        the rule book a batch is admitted under (R2026): credits, grading scale, pass rules,
//                     internal-assessment components, GPA rules, attainment targets
//   Program           B.Tech CSE, MBA … with its program outcomes (POs and PSOs)
//   ProgramCourse            a course of a program's curriculum, with its course outcomes (COs) and the CO–PO mapping
//   ProgramEnrolment  a student in a program: batch, regulation, current semester, advisor. Kept apart from the
//                     Student record so school data stays as it is; one enrolment per student.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const gradeBandSchema = new Schema({
  grade: { type: String, required: true, trim: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  points: { type: Number, required: true },
  label: { type: String, trim: true },
  pass: { type: Boolean, default: true },
}, { _id: false })

const componentSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  maxMarks: { type: Number, required: true },
}, { _id: false })

const regulationSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true }, // R2026
  name: { type: String, trim: true },
  effectiveFrom: Number, // first admission batch (year)
  minCredits: { type: Number, default: 160 }, // to graduate
  semesterMinCredits: { type: Number, default: 16 },
  semesterMaxCredits: { type: Number, default: 28 },
  gradeScale: { type: [gradeBandSchema], default: [] },
  passRules: {
    minInternalPct: { type: Number, default: 0 },
    minExternalPct: { type: Number, default: 40 },
    minTotalPct: { type: Number, default: 40 },
  },
  iaComponents: { type: [componentSchema], default: [] },
  gpa: {
    countFailed: { type: Boolean, default: true },
    decimals: { type: Number, default: 2 },
    pctMultiplier: { type: Number, default: 10 }, // CGPA → equivalent %
  },
  classification: { type: [new Schema({ min: Number, label: String }, { _id: false })], default: [] },
  attainment: {
    targetPct: { type: Number, default: 60 }, // a student "reaches" a CO at this %
    levels: { type: [new Schema({ level: Number, min: Number }, { _id: false })], default: [] },
    internalWeight: { type: Number, default: 30 }, // % of direct attainment from internal assessment
  },
  active: { type: Boolean, default: true },
}, { timestamps: true })
regulationSchema.plugin(tenantPlugin)
regulationSchema.index({ tenantId: 1, code: 1 }, { unique: true })
export const Regulation = model('Regulation', regulationSchema, 'regulations')

const outcomeSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true }, // PO1, PSO2
  kind: { type: String, default: 'PO' }, // PO · PSO
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
}, { _id: false })

const programSchema = new Schema({
  name: { type: String, required: true, trim: true }, // B.Tech Computer Science and Engineering
  code: { type: String, required: true, uppercase: true, trim: true }, // BTCSE
  level: { type: String, default: 'UG' }, // PROGRAM_LEVELS
  departmentId: { type: ObjectId, ref: 'Department' },
  branchId: { type: ObjectId, ref: 'Branch' },
  durationYears: { type: Number, default: 4 },
  semesters: { type: Number, default: 8 },
  intake: Number,
  regulationId: { type: ObjectId, ref: 'Regulation' },
  coordinatorId: { type: ObjectId, ref: 'User' },
  outcomes: { type: [outcomeSchema], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true })
programSchema.plugin(tenantPlugin)
programSchema.index({ tenantId: 1, code: 1 }, { unique: true })
export const Program = model('Program', programSchema, 'programs')

const courseOutcomeSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true }, // CO1
  statement: { type: String, required: true, trim: true },
  bloom: { type: String, default: 'L2' }, // OBE_BLOOM_LEVELS
}, { _id: false })

const courseSchema = new Schema({
  programId: { type: ObjectId, ref: 'Program', required: true },
  code: { type: String, required: true, uppercase: true, trim: true }, // CS301
  title: { type: String, required: true, trim: true },
  semester: { type: Number, required: true },
  type: { type: String, default: 'CORE' }, // PROGRAM_COURSE_TYPES
  /** Electives of one basket ("PE1", "OE2") — registration windows pick from it. */
  electiveGroup: { type: String, trim: true, uppercase: true },
  l: { type: Number, default: 3 }, t: { type: Number, default: 0 }, p: { type: Number, default: 0 },
  credits: { type: Number, required: true },
  internalMax: { type: Number, default: 40 },
  externalMax: { type: Number, default: 60 },
  prerequisiteIds: { type: [{ type: ObjectId, ref: 'ProgramCourse' }], default: [] },
  outcomes: { type: [courseOutcomeSchema], default: [] },
  /** CO–PO correlation 1–3 (0 is left out). */
  coPo: { type: [new Schema({ co: String, po: String, level: Number }, { _id: false })], default: [] },
  /** Which COs each internal component assesses (component code → CO codes); none listed: all of them. */
  componentCos: { type: [new Schema({ component: String, cos: [String] }, { _id: false })], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true })
courseSchema.plugin(tenantPlugin)
courseSchema.index({ tenantId: 1, code: 1 }, { unique: true })
courseSchema.index({ tenantId: 1, programId: 1, semester: 1 })
export const ProgramCourse = model('ProgramCourse', courseSchema, 'program_courses')

const enrolmentSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  programId: { type: ObjectId, ref: 'Program', required: true },
  regulationId: { type: ObjectId, ref: 'Regulation' },
  batch: { type: Number, required: true }, // admission year, e.g. 2026
  currentSemester: { type: Number, default: 1 },
  registerNo: { type: String, trim: true, uppercase: true }, // university register number
  advisorId: { type: ObjectId, ref: 'User' },
  status: { type: String, default: 'ACTIVE' }, // ENROLMENT_STATUS
}, { timestamps: true })
enrolmentSchema.plugin(tenantPlugin)
enrolmentSchema.index({ tenantId: 1, studentId: 1 }, { unique: true })
enrolmentSchema.index({ tenantId: 1, programId: 1, currentSemester: 1, status: 1 })
enrolmentSchema.index({ tenantId: 1, registerNo: 1 }, { unique: true, partialFilterExpression: { registerNo: { $type: 'string' } } })
export const ProgramEnrolment = model('ProgramEnrolment', enrolmentSchema, 'program_enrolments')
