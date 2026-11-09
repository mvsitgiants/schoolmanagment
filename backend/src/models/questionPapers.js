// Question papers (Exams › Question papers). Tenant-scoped.
//
//   QuestionPaper  the printed paper of one exam paper (exam + class + subject): its blueprint (duration, max marks,
//                  general instructions, sections, chapter weightage, difficulty mix), its sets (A, B, C …) with the
//                  questions of every section, and its workflow (DRAFT → SUBMITTED → APPROVED, with history).
//                  Questions are copies — from the LMS question bank (questionId) or written for the paper — so a
//                  bank edit never changes a paper that has been set.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const questionFields = {
  questionId: ObjectId, // where it came from in the bank (none: written for this paper)
  type: { type: String, required: true }, // QUESTION_TYPES
  text: { type: String, required: true },
  options: [{ text: String, correct: { type: Boolean, default: false }, _id: false }],
  answers: { type: [String], default: undefined }, // FILL: accepted answers; SHORT / LONG: the model answer
  explanation: String, // marking scheme / value points
  chapter: String,
  difficulty: { type: String, default: 'MEDIUM' },
  bloom: String,
}
const altSchema = new Schema(questionFields, { _id: false })
const itemSchema = new Schema({ ...questionFields, or: altSchema }, { _id: false }) // `or`: the internal-choice alternative

const blueprintSectionSchema = new Schema({
  title: { type: String, required: true, trim: true }, // "Section A"
  instructions: String, // "Choose the correct option."
  type: { type: String, required: true }, // QUESTION_TYPES
  count: { type: Number, required: true }, // questions on the paper
  marks: { type: Number, required: true }, // each
  attempt: Number, // "attempt any N" (empty: all)
  choice: { type: Boolean, default: false }, // every question has an OR alternative
})

const setSchema = new Schema({
  letter: { type: String, required: true }, // A, B, C …
  sections: [{ sectionId: ObjectId, items: { type: [itemSchema], default: [] }, _id: false }],
})

const historySchema = new Schema({
  action: { type: String, required: true }, // QP_ACTIONS
  status: String, // the status it moved to
  note: String,
  by: String, byId: ObjectId,
  at: { type: Date, default: Date.now },
}, { _id: false })

const questionPaperSchema = new Schema({
  examId: { type: ObjectId, ref: 'Exam', required: true },
  examPaperId: { type: ObjectId, ref: 'ExamPaper', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true }, // from the exam paper, for scope and the bank
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  status: { type: String, default: 'DRAFT' }, // QP_STATUS
  durationMin: Number,
  maxMarks: { type: Number, required: true },
  instructions: String, // general instructions
  sections: { type: [blueprintSectionSchema], default: [] },
  chapters: [{ chapter: String, weight: Number, _id: false }], // weightage, % of the marks
  difficulty: { EASY: Number, MEDIUM: Number, HARD: Number }, // target mix, % of the marks
  setMode: { type: String, default: 'SHUFFLE' }, // QP_SET_MODES
  shuffleOptions: { type: Boolean, default: true },
  sets: { type: [setSchema], default: [] }, // always at least set A
  setterId: ObjectId, setterName: String, // who set it (the creator)
  submittedAt: Date,
  approvedAt: Date, approvedBy: String, approvedById: ObjectId,
  history: { type: [historySchema], default: [] },
  printed: { type: Number, default: 0 }, lastPrintedAt: Date, lastPrintedBy: String,
}, { timestamps: true })
questionPaperSchema.plugin(tenantPlugin)
questionPaperSchema.index({ tenantId: 1, examPaperId: 1 }, { unique: true })
questionPaperSchema.index({ tenantId: 1, examId: 1 })
questionPaperSchema.index({ tenantId: 1, 'sets._id': 1 })
export const QuestionPaper = model('QuestionPaper', questionPaperSchema, 'question_papers')
