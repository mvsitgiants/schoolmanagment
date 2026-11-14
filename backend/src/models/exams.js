// Exams & report cards (module `exams`). Tenant-scoped.
//
//   ExamType       Unit test, Half-yearly, Annual … with its share of the year's result (setup)
//   Exam           one exam of a year ("Half-yearly 2026") for some classes
//   ExamPaper      a class's paper in an exam: subject, date and time, max / pass marks
//   MarkSheet      the marks of one paper for one section; locked when final
//   ExamCandidate  a student sitting an exam: the hall ticket and, once worked out, the result
//                  (total, %, grade, rank) with the class teacher's remark — the report card's record
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { makeVerifyCode } from '@schoolgiant/shared'
import { tenantPlugin } from '../platform/db.js'

/** A candidate's check code: the QR on the hall ticket and the report card opens /verify/exam/<code>. */
export const newCandidateCode = () => makeVerifyCode(() => crypto.randomInt(0, 2 ** 31) / 2 ** 31)

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }
const hhmm = { type: String, match: /^\d{2}:\d{2}$/ }

const examTypeSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  weightage: { type: Number, default: 0 }, // % of the year's final result
  defaultMaxMarks: { type: Number, default: 100 },
  active: { type: Boolean, default: true },
}, { timestamps: true })
examTypeSchema.plugin(tenantPlugin)
examTypeSchema.index({ tenantId: 1, code: 1 }, { unique: true })
export const ExamType = model('ExamType', examTypeSchema, 'exam_types')

const examSchema = new Schema({
  name: { type: String, required: true, trim: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  examTypeId: { type: ObjectId, ref: 'ExamType' },
  term: String, // the year's term it belongs to, by name
  classIds: { type: [{ type: ObjectId, ref: 'ClassLevel' }], default: [] },
  /** Overrides each class's grading scheme for this exam. */
  gradingSchemeId: { type: ObjectId, ref: 'GradingScheme' },
  instructions: String, // printed on the hall ticket
  startDate: ymd, endDate: ymd, // from the papers
  status: { type: String, default: 'DRAFT' }, // EXAM_STATUS
  scheduledAt: Date, scheduledBy: String,
  publishedAt: Date, publishedBy: String,
  createdBy: String,
}, { timestamps: true })
examSchema.plugin(tenantPlugin)
examSchema.index({ tenantId: 1, academicYearId: 1, name: 1 }, { unique: true })
export const Exam = model('Exam', examSchema, 'exams')

const paperSchema = new Schema({
  examId: { type: ObjectId, ref: 'Exam', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  date: ymd,
  startTime: hhmm,
  endTime: hhmm,
  maxMarks: { type: Number, default: 100 },
  passMarks: { type: Number, default: 33 },
  /** Co-scholastic: a grade is entered, not marks; never in the total. */
  gradeOnly: { type: Boolean, default: false },
  countsInTotal: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { timestamps: true })
paperSchema.plugin(tenantPlugin)
paperSchema.index({ tenantId: 1, examId: 1, classId: 1, subjectId: 1 }, { unique: true })
export const ExamPaper = model('ExamPaper', paperSchema, 'exam_papers')

const markEntrySchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  marks: { type: Number, default: null },
  grade: String, // grade-only papers
  absent: { type: Boolean, default: false },
  exempt: { type: Boolean, default: false }, // doesn't take this subject
}, { _id: false })

const markSheetSchema = new Schema({
  examId: { type: ObjectId, ref: 'Exam', required: true },
  paperId: { type: ObjectId, ref: 'ExamPaper', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  entries: { type: [markEntrySchema], default: [] },
  status: { type: String, default: 'OPEN' }, // OPEN · LOCKED
  enteredBy: String, enteredById: ObjectId, enteredAt: Date,
  lockedBy: String, lockedAt: Date,
  unlockedBy: String, unlockedAt: Date, unlockReason: String,
}, { timestamps: true })
markSheetSchema.plugin(tenantPlugin)
markSheetSchema.index({ tenantId: 1, paperId: 1, sectionId: 1 }, { unique: true })
markSheetSchema.index({ tenantId: 1, examId: 1, sectionId: 1 })
export const MarkSheet = model('MarkSheet', markSheetSchema, 'mark_sheets')

const candidateSchema = new Schema({
  examId: { type: ObjectId, ref: 'Exam', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  rollNo: String,
  // the result, worked out from the mark sheets (services/exams.js computeResults)
  total: Number, max: Number, pct: Number, grade: String, rank: Number,
  result: String, // RESULT_STATUS
  failedSubjects: { type: [String], default: [] },
  computedAt: Date,
  remark: String, remarkBy: String,
  notifiedAt: Date, // report card sent to the family
  verifyCode: { type: String, default: newCandidateCode },
  // held by hand (services/examHolds.js): the admit card and/or the result, why, and whether the family is told why
  hold: { admitCard: Boolean, result: Boolean, reason: String, showReason: Boolean, by: String, at: Date },
  // let through although a rule (fees overdue, low attendance) would hold it
  released: { admitCard: Boolean, result: Boolean, by: String, at: Date },
}, { timestamps: true })
candidateSchema.plugin(tenantPlugin)
candidateSchema.index({ verifyCode: 1 }, { unique: true, partialFilterExpression: { verifyCode: { $type: 'string' } } })
candidateSchema.index({ tenantId: 1, examId: 1, studentId: 1 }, { unique: true })
candidateSchema.index({ tenantId: 1, examId: 1, sectionId: 1 })
export const ExamCandidate = model('ExamCandidate', candidateSchema, 'exam_candidates')

// ───────────────────────────────────────────────────────── year-end result (services/yearResults.js)

/**
 * A class's year-end result once published: the weighting used and every student's subjects, final %, grade, rank and
 * result, frozen so later changes to marks or weightage don't move a published result. Until then it is worked out live.
 */
const yearResultSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  status: { type: String, default: 'PUBLISHED' }, // YEAR_STATUS (a row exists only once published)
  plan: { type: Schema.Types.Mixed }, // weightPlan() at publishing
  rules: { combine: String, passPct: Number, compartmentMax: Number },
  students: {
    type: [{
      _id: false, studentId: ObjectId, sectionId: ObjectId,
      subjects: [{ _id: false, subjectId: String, subject: String, parts: [{ _id: false, code: String, pct: Number }], pct: Number, grade: String, pass: Boolean }],
      pct: Number, grade: String, rank: Number, result: String, failed: [String],
    }],
    default: [],
  },
  publishedAt: Date, publishedBy: String,
}, { timestamps: true })
yearResultSchema.plugin(tenantPlugin)
yearResultSchema.index({ tenantId: 1, academicYearId: 1, classId: 1 }, { unique: true })
export const YearResult = model('YearResult', yearResultSchema, 'exam_year_results')
