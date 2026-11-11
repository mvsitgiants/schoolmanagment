// Homework & lessons (module `homework`). Tenant-scoped.
//
//   Syllabus      a class's syllabus for a subject in a year: units, each with topics, and the month each is planned for
//   SyllabusDone  a topic taught in a section (ticked directly or from a lesson plan)
//   SectionTopicPlan  one section's own record of a topic: its date if the teacher moved it, partly
//                 taught, needs revision, extra classes (fully taught = a SyllabusDone row, kept in step)
//   LessonPlan    a teacher's plan for a lesson: section, subject, date, topics, how it went
//   Homework      homework set for one section and subject, with each student's submission
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const ym = { type: String, match: /^\d{4}-\d{2}$/ }
// the year plan: a unit runs fromMonth–toMonth; a topic may name its own month (shared/homework.js yearPlan)
// A topic's teaching material is shared by every section of the class: the book reference (files hang
// off the topic id as `syllabus_topic`), how to teach it, questions and answers, a homework suggestion.
const questionSchema = new Schema({
  question: { type: String, required: true, trim: true },
  answer: String,
  kind: { type: String, default: 'SHORT' }, // QUESTION_KINDS
  options: { type: [String], default: undefined }, // MCQ choices
  use: { type: String, default: 'CLASS' }, // QUESTION_USES: asked in class or set as homework
})
const topicSchema = new Schema({
  name: { type: String, required: true, trim: true }, periods: Number, month: ym,
  book: { name: String, chapter: String, pages: String },
  howTo: String,
  keyPoints: { type: [String], default: undefined },
  questions: { type: [questionSchema], default: undefined },
  homeworkHint: String,
  contentBy: String, contentAt: Date,
})
const unitSchema = new Schema({ name: { type: String, required: true, trim: true }, fromMonth: ym, toMonth: ym, topics: { type: [topicSchema], default: [] } })

const syllabusSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  units: { type: [unitSchema], default: [] },
  updatedBy: String,
}, { timestamps: true })
syllabusSchema.plugin(tenantPlugin)
syllabusSchema.index({ tenantId: 1, academicYearId: 1, classId: 1, subjectId: 1 }, { unique: true })
export const Syllabus = model('Syllabus', syllabusSchema, 'syllabi')

const doneSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  topicId: { type: ObjectId, required: true },
  date: ymd,
  by: String, byId: ObjectId,
  lessonPlanId: { type: ObjectId, ref: 'LessonPlan' },
}, { timestamps: true })
doneSchema.plugin(tenantPlugin)
doneSchema.index({ tenantId: 1, sectionId: 1, subjectId: 1, topicId: 1 }, { unique: true })
export const SyllabusDone = model('SyllabusDone', doneSchema, 'syllabus_done')

const extraClassSchema = new Schema({ date: { ...ymd, required: true }, period: Number, note: String, done: { type: Boolean, default: false }, doneAt: Date, by: String })
const sectionTopicSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  topicId: { type: ObjectId, required: true },
  plannedDate: ymd, // the teacher's own date for this section (else worked out from the year plan)
  status: { type: String, default: 'NOT_STARTED' }, // TOPIC_STATUS; TAUGHT mirrors SyllabusDone
  statusDate: ymd,
  carried: { type: Number, default: 0 }, // times it was not taught on its day and moved on
  needsRevision: { type: Boolean, default: false },
  revisionBy: String, // YYYY-MM-DD: when to revise it (it shows on the teacher's day from then); empty = straight away
  extraClasses: { type: [extraClassSchema], default: [] },
  notes: String,
  by: String,
}, { timestamps: true })
sectionTopicSchema.plugin(tenantPlugin)
sectionTopicSchema.index({ tenantId: 1, sectionId: 1, subjectId: 1, topicId: 1 }, { unique: true })
export const SectionTopicPlan = model('SectionTopicPlan', sectionTopicSchema, 'section_topic_plans')

const lessonPlanSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  date: { ...ymd, required: true },
  period: Number,
  title: { type: String, required: true, trim: true },
  topicIds: { type: [ObjectId], default: [] },
  objectives: String,
  method: String, // activities, teaching method
  resources: String,
  homeworkNote: String,
  // teaching material besides files (files hang off the plan in Files: entityType lesson_plan)
  links: { type: [{ title: String, url: String }], default: undefined }, // videos (YouTube…), websites, Drive / Docs
  materialNotes: String, // reading notes, questions to ask, board work
  status: { type: String, default: 'PLANNED' }, // LESSON_STATUS
  reflection: String, // how it went
  doneAt: Date,
  teacherId: { type: ObjectId, ref: 'User' },
  teacher: String,
}, { timestamps: true })
lessonPlanSchema.plugin(tenantPlugin)
lessonPlanSchema.index({ tenantId: 1, sectionId: 1, date: 1 })
lessonPlanSchema.index({ tenantId: 1, teacherId: 1, date: 1 })
export const LessonPlan = model('LessonPlan', lessonPlanSchema, 'lesson_plans')

const submissionSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  status: { type: String, default: 'PENDING' }, // SUBMISSION_STATUS
  remark: String,
  at: Date,
  by: String,
}, { _id: false })

const homeworkSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  title: { type: String, required: true, trim: true },
  details: String,
  setDate: { ...ymd, required: true },
  dueDate: { ...ymd, required: true },
  needsSubmission: { type: Boolean, default: true },
  entries: { type: [submissionSchema], default: [] },
  notifiedAt: Date,
  teacherId: { type: ObjectId, ref: 'User' },
  teacher: String,
}, { timestamps: true })
homeworkSchema.plugin(tenantPlugin)
homeworkSchema.index({ tenantId: 1, sectionId: 1, dueDate: -1 })
homeworkSchema.index({ tenantId: 1, teacherId: 1, setDate: -1 })
export const Homework = model('Homework', homeworkSchema, 'homework')
