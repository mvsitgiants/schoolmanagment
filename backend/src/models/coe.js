// Exam controller (module `coe`, higher education). Tenant-scoped.
//
//   CoeSession          an examination session: regular end-semester or supplementary (arrears), for some
//                       program-semesters of an academic year; results published once
//   CoeMarkSheet        a course's marks in a session — INTERNAL (per assessment component) or EXTERNAL (entered by dummy
//                       number; evaluators never see who wrote the script); moderation on the external sheet; locked when final
//   CoeResult           a student's result in a course for one attempt (grade, points, pass / arrear)
//   CoeSemesterResult   a student's semester in a session: SGPA, CGPA, credits, arrears — the grade card's record
//   CoeRevaluation      a re-evaluation of an external script: REQUESTED → APPROVED → REVALUED (or REJECTED), old and new marks
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const targetSchema = new Schema({
  programId: { type: ObjectId, ref: 'Program', required: true },
  semester: { type: Number, required: true },
}, { _id: false })

const sessionSchema = new Schema({
  name: { type: String, required: true, trim: true }, // "Nov 2026 end-semester"
  kind: { type: String, default: 'REGULAR' }, // COE_SESSION_KINDS
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  examMonth: { type: String, match: /^\d{4}-\d{2}$/ }, // printed as "NOV 2026"
  targets: { type: [targetSchema], default: [] },
  status: { type: String, default: 'OPEN' }, // COE_SESSION_STATUS
  revaluationFee: { type: Number, default: 0 }, // paise, per paper
  computedAt: Date,
  publishedAt: Date, publishedBy: String,
  createdBy: String,
}, { timestamps: true })
sessionSchema.plugin(tenantPlugin)
sessionSchema.index({ tenantId: 1, name: 1 }, { unique: true })
export const CoeSession = model('CoeSession', sessionSchema, 'coe_sessions')

const entrySchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  components: { type: Schema.Types.Mixed, default: undefined }, // INTERNAL: component code → marks
  marks: { type: Number, default: null }, // INTERNAL: scaled total; EXTERNAL: marks out of externalMax
  absent: { type: Boolean, default: false },
  dummyNo: String, // EXTERNAL
}, { _id: false })

const moderationSchema = new Schema({
  kind: String, // COE_MODERATION_KINDS
  value: Number,
  reason: String,
  status: String, // COE_MODERATION_STATUS
  proposedBy: String, proposedAt: Date,
  decidedBy: String, decidedAt: Date,
}, { _id: false })

const sheetSchema = new Schema({
  sessionId: { type: ObjectId, ref: 'CoeSession', required: true },
  courseId: { type: ObjectId, ref: 'ProgramCourse', required: true },
  programId: { type: ObjectId, ref: 'Program', required: true },
  semester: Number,
  part: { type: String, required: true }, // INTERNAL · EXTERNAL
  maxMarks: Number,
  entries: { type: [entrySchema], default: [] },
  moderation: { type: moderationSchema, default: undefined },
  status: { type: String, default: 'OPEN' }, // COE_SHEET_STATUS
  enteredBy: String, enteredAt: Date,
  lockedBy: String, lockedAt: Date,
  unlockedBy: String, unlockedAt: Date, unlockReason: String,
}, { timestamps: true })
sheetSchema.plugin(tenantPlugin)
sheetSchema.index({ tenantId: 1, sessionId: 1, courseId: 1, part: 1 }, { unique: true })
sheetSchema.index({ tenantId: 1, 'entries.dummyNo': 1 })
export const CoeMarkSheet = model('CoeMarkSheet', sheetSchema, 'coe_mark_sheets')

const resultSchema = new Schema({
  sessionId: { type: ObjectId, ref: 'CoeSession', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  programId: { type: ObjectId, ref: 'Program', required: true },
  courseId: { type: ObjectId, ref: 'ProgramCourse', required: true },
  semester: Number, // the course's semester
  credits: Number,
  attempt: { type: Number, default: 1 },
  kind: String, // REGULAR · SUPPLEMENTARY
  internal: Number, internalMax: Number,
  externalRaw: Number, // as entered, before moderation and revaluation
  external: Number, externalMax: Number,
  absent: { type: Boolean, default: false },
  total: Number, max: Number, pct: Number,
  grade: String, points: Number,
  pass: Boolean, reason: String,
  revalued: { type: Boolean, default: false },
  order: Number, // sort key of the attempt: the session's creation time
}, { timestamps: true })
resultSchema.plugin(tenantPlugin)
resultSchema.index({ tenantId: 1, sessionId: 1, studentId: 1, courseId: 1 }, { unique: true })
resultSchema.index({ tenantId: 1, studentId: 1, courseId: 1 })
resultSchema.index({ tenantId: 1, courseId: 1, sessionId: 1 })
export const CoeResult = model('CoeResult', resultSchema, 'coe_results')

const semesterResultSchema = new Schema({
  sessionId: { type: ObjectId, ref: 'CoeSession', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  enrolmentId: { type: ObjectId, ref: 'ProgramEnrolment' },
  programId: { type: ObjectId, ref: 'Program', required: true },
  semester: Number,
  courses: Number, passed: Number,
  creditsRegistered: Number, creditsEarned: Number,
  sgpa: Number, cgpa: Number, cumulativeCredits: Number,
  arrears: { type: Number, default: 0 }, // courses still not passed, all semesters
  result: String, // PASS · FAIL (has arrears in this session)
  published: { type: Boolean, default: false },
}, { timestamps: true })
semesterResultSchema.plugin(tenantPlugin)
semesterResultSchema.index({ tenantId: 1, sessionId: 1, studentId: 1, semester: 1 }, { unique: true })
semesterResultSchema.index({ tenantId: 1, studentId: 1 })
export const CoeSemesterResult = model('CoeSemesterResult', semesterResultSchema, 'coe_semester_results')

const revalHistorySchema = new Schema({ at: { type: Date, default: Date.now }, by: String, action: String, note: String }, { _id: false })

const revaluationSchema = new Schema({
  sessionId: { type: ObjectId, ref: 'CoeSession', required: true },
  resultId: { type: ObjectId, ref: 'CoeResult', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  courseId: { type: ObjectId, ref: 'ProgramCourse', required: true },
  status: { type: String, default: 'REQUESTED' }, // COE_REVAL_STATUS
  fee: { type: Number, default: 0 }, // paise
  feePaid: { type: Boolean, default: false },
  reason: String,
  oldMarks: Number, newMarks: Number,
  oldGrade: String, newGrade: String,
  note: String,
  requestedBy: String,
  history: { type: [revalHistorySchema], default: [] },
}, { timestamps: true })
revaluationSchema.plugin(tenantPlugin)
revaluationSchema.index({ tenantId: 1, resultId: 1 }, { unique: true })
revaluationSchema.index({ tenantId: 1, sessionId: 1, status: 1 })
export const CoeRevaluation = model('CoeRevaluation', revaluationSchema, 'coe_revaluations')
