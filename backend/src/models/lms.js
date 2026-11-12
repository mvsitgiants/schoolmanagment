// Learning (module `lms`). Tenant-scoped.
//
//   Course          a class's subject for some or all of its sections: units of items (notes, files, links, videos)
//   CourseProgress  which items a student has ticked off
//   LiveClass       a scheduled online class: Jitsi room or the school's own Zoom / Meet link; who joined
//   Question        the question bank (online tests draw from it)
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const itemSchema = new Schema({
  kind: { type: String, required: true }, // ITEM_KINDS
  title: { type: String, required: true, trim: true },
  body: String, // NOTE text (plain, line breaks kept)
  url: String, // LINK / VIDEO
  published: { type: Boolean, default: true },
  minutes: Number, // roughly how long it takes
  // shared from "Create content" (items made on the course page leave these empty)
  topicId: ObjectId, // the syllabus topic (Syllabus.units.topics._id) of the course's class + subject
  // Subject hub: the one item that holds a topic's (or a sub-topic's) student content; published false = draft
  hub: Boolean,
  subTopicId: ObjectId, // Syllabus.units.topics.subTopics._id
  descriptionHtml: String, // rich text, sanitised (shared richText.js); `body` keeps its words for older screens
  publishAt: Date, // null = shown at once; later = students see it from then
  visibility: { type: String, default: 'ALL' }, // CONTENT_VISIBILITY
  studentIds: { type: [ObjectId], default: undefined }, // visibility STUDENTS
  views: { type: Number, default: 0 }, // students who opened it (each counted once)
  createdBy: String, createdById: ObjectId, createdAt: Date, updatedAt: Date,
})
const unitSchema = new Schema({
  title: { type: String, required: true, trim: true },
  items: { type: [itemSchema], default: [] },
})

const courseSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  sectionIds: { type: [ObjectId], default: [] }, // empty = every section of the class
  title: { type: String, required: true, trim: true },
  description: String,
  teacherIds: { type: [ObjectId], default: [] }, // who may change it (besides wide-scope staff)
  status: { type: String, default: 'DRAFT' }, // COURSE_STATUS
  units: { type: [unitSchema], default: [] },
  publishedAt: Date,
  createdBy: String, createdById: ObjectId,
}, { timestamps: true })
courseSchema.plugin(tenantPlugin)
courseSchema.index({ tenantId: 1, academicYearId: 1, classId: 1, subjectId: 1 })
courseSchema.index({ tenantId: 1, 'units.items._id': 1 })
courseSchema.index({ tenantId: 1, 'units.items.createdById': 1 })
courseSchema.index({ tenantId: 1, 'units.items.topicId': 1 })
export const Course = model('Course', courseSchema, 'lms_courses')

const progressSchema = new Schema({
  courseId: { type: ObjectId, required: true },
  studentId: { type: ObjectId, required: true },
  done: { type: [ObjectId], default: [] },
  viewed: { type: [ObjectId], default: [] }, // items opened (counted once in the item's views)
  lastAt: Date,
}, { timestamps: true })
progressSchema.plugin(tenantPlugin)
progressSchema.index({ tenantId: 1, courseId: 1, studentId: 1 }, { unique: true })
export const CourseProgress = model('CourseProgress', progressSchema, 'lms_progress')

const liveSchema = new Schema({
  title: { type: String, required: true, trim: true },
  courseId: ObjectId,
  classId: { type: ObjectId, required: true },
  subjectId: ObjectId,
  sectionIds: { type: [ObjectId], default: [] },
  date: { type: String, required: true }, // YYYY-MM-DD
  start: { type: String, required: true }, // HH:MM
  durationMin: { type: Number, default: 40 },
  provider: { type: String, default: 'JITSI' }, // LIVE_PROVIDERS
  joinUrl: String, // the school's link (Zoom / Meet / Teams / other)
  room: String, // JITSI room name
  hostUserId: ObjectId, hostName: String,
  status: { type: String, default: 'SCHEDULED' }, // LIVE_STATUS
  startedAt: Date, endedAt: Date,
  recordingUrl: String,
  notes: String,
  cancelReason: String,
  joins: [{ studentId: ObjectId, at: Date, _id: false }], // first join of each student
  notifiedAt: Date,
  createdBy: String,
}, { timestamps: true })
liveSchema.plugin(tenantPlugin)
liveSchema.index({ tenantId: 1, date: 1, start: 1 })
liveSchema.index({ tenantId: 1, sectionIds: 1, date: 1 })
liveSchema.index({ tenantId: 1, hostUserId: 1, date: 1 })
export const LiveClass = model('LiveClass', liveSchema, 'lms_live_classes')

const questionSchema = new Schema({
  subjectId: { type: ObjectId, required: true },
  classId: ObjectId, // the class it is pitched at
  chapter: { type: String, trim: true },
  type: { type: String, required: true }, // QUESTION_TYPES
  text: { type: String, required: true },
  options: [{ text: String, correct: { type: Boolean, default: false }, _id: false }],
  answers: { type: [String], default: undefined }, // FILL: accepted answers; SHORT / LONG: a model answer
  explanation: String,
  marks: { type: Number, default: 1 },
  negative: { type: Number, default: 0 },
  difficulty: { type: String, default: 'MEDIUM' }, // DIFFICULTY
  bloom: String, // BLOOM_LEVELS
  tags: { type: [String], default: [] },
  active: { type: Boolean, default: true },
  used: { type: Number, default: 0 }, // how many tests have it
  createdBy: String, createdById: ObjectId,
}, { timestamps: true })
questionSchema.plugin(tenantPlugin)
questionSchema.index({ tenantId: 1, subjectId: 1, classId: 1, chapter: 1 })
questionSchema.index({ tenantId: 1, text: 'text', chapter: 'text', tags: 'text' })
export const Question = model('Question', questionSchema, 'lms_questions')
