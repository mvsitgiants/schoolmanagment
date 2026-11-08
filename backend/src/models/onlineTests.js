// Online tests (module `online-tests`). Tenant-scoped.
//
//   OnlineTest   the questions (copies from the bank), time limit, window, and how results are shown
//   TestAttempt  one student's go at a test: timed on the server, answers saved as they go, marks
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const Mixed = Schema.Types.Mixed

const testQuestionSchema = new Schema({
  questionId: ObjectId, // where it came from in the bank (the copy below is what is asked)
  type: { type: String, required: true },
  text: { type: String, required: true },
  options: [{ text: String, correct: Boolean, _id: false }],
  answers: { type: [String], default: undefined },
  explanation: String,
  marks: { type: Number, required: true },
  negative: { type: Number, default: 0 },
  chapter: String,
}, { _id: false })

const testSchema = new Schema({
  title: { type: String, required: true, trim: true },
  academicYearId: ObjectId,
  classId: { type: ObjectId, required: true },
  subjectId: { type: ObjectId, required: true },
  sectionIds: { type: [ObjectId], default: [] }, // empty = every section of the class
  instructions: String,
  questions: { type: [testQuestionSchema], default: [] },
  totalMarks: { type: Number, default: 0 },
  passPct: { type: Number, default: 33 },
  durationMin: { type: Number, default: 30 },
  opens: { date: String, time: String }, // the institution's clock
  closes: { date: String, time: String },
  opensAt: Date, closesAt: Date, // the same instants
  attemptsAllowed: { type: Number, default: 1 },
  shuffleQuestions: { type: Boolean, default: true },
  shuffleOptions: { type: Boolean, default: true },
  partialMarks: { type: Boolean, default: false }, // multi-answer questions: credit for some right, none wrong
  results: { type: String, default: 'AFTER_CLOSE' }, // RESULT_RELEASE
  resultsReleasedAt: Date,
  showAnswers: { type: Boolean, default: true }, // with the result: the correct answers and explanations
  proctor: { fullscreen: { type: Boolean, default: false }, maxTabSwitches: { type: Number, default: 0 } }, // 0 = not counted
  status: { type: String, default: 'DRAFT' }, // TEST_STATUS
  publishedAt: Date, closedAt: Date,
  teacherIds: { type: [ObjectId], default: [] },
  createdBy: String, createdById: ObjectId,
}, { timestamps: true })
testSchema.plugin(tenantPlugin)
testSchema.index({ tenantId: 1, status: 1, opensAt: 1 })
testSchema.index({ tenantId: 1, classId: 1, subjectId: 1 })
export const OnlineTest = model('OnlineTest', testSchema, 'online_tests')

const attemptSchema = new Schema({
  testId: { type: ObjectId, required: true },
  studentId: { type: ObjectId, required: true },
  sectionId: ObjectId,
  attemptNo: { type: Number, default: 1 },
  status: { type: String, default: 'IN_PROGRESS' }, // ATTEMPT_STATUS
  startedAt: { type: Date, required: true },
  deadline: { type: Date, required: true }, // start + duration, or when the test closes if sooner
  submittedAt: Date,
  submitReason: String, // SUBMIT_REASONS
  order: [Number], // question indexes in the order this student sees them
  optionOrder: { type: Mixed, default: {} }, // { [questionIndex]: [option indexes] }
  answers: { type: Mixed, default: {} }, // { [questionIndex]: value }
  manual: { type: Mixed, default: {} }, // { [questionIndex]: marks } given by the teacher
  feedback: { type: Mixed, default: {} }, // { [questionIndex]: note }
  tabSwitches: { type: Number, default: 0 },
  events: [{ type: { type: String }, at: Date, _id: false }],
  score: { auto: Number, manual: Number, total: Number, pct: Number, pending: Number },
  passed: Boolean,
  evaluatedBy: String, evaluatedAt: Date,
}, { timestamps: true, minimize: false })
attemptSchema.plugin(tenantPlugin)
attemptSchema.index({ tenantId: 1, testId: 1, studentId: 1, attemptNo: 1 }, { unique: true })
attemptSchema.index({ tenantId: 1, studentId: 1, status: 1 })
attemptSchema.index({ tenantId: 1, status: 1, deadline: 1 })
export const TestAttempt = model('TestAttempt', attemptSchema, 'online_test_attempts')
