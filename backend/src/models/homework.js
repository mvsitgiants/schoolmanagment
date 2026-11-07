// Homework & lessons (module `homework`). Tenant-scoped.
//
//   Syllabus      a class's syllabus for a subject in a year: units, each with topics
//   SyllabusDone  a topic taught in a section (ticked directly or from a lesson plan)
//   LessonPlan    a teacher's plan for a lesson: section, subject, date, topics, how it went
//   Homework      homework set for one section and subject, with each student's submission
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const topicSchema = new Schema({ name: { type: String, required: true, trim: true }, periods: Number })
const unitSchema = new Schema({ name: { type: String, required: true, trim: true }, topics: { type: [topicSchema], default: [] } })

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
