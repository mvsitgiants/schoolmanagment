// Academic setup (module `academics`): years and terms, classes, sections, subjects, grading
// schemes and teacher allocation. Tenant-scoped. Every academic record later (attendance, marks,
// homework, timetable) points at a section and a subject from here.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const termSchema = new Schema({
  name: { type: String, required: true, trim: true },
  startDate: { ...ymd, required: true },
  endDate: { ...ymd, required: true },
})

const academicYearSchema = new Schema({
  name: { type: String, required: true, trim: true }, // "2026-27"
  startDate: { ...ymd, required: true },
  endDate: { ...ymd, required: true },
  terms: { type: [termSchema], default: [] },
  /** Exactly one year is current; the app opens on it everywhere. */
  isCurrent: { type: Boolean, default: false },
  /** Closed years stay readable; nothing new is entered in them. */
  closed: { type: Boolean, default: false },
}, { timestamps: true })
academicYearSchema.plugin(tenantPlugin)
academicYearSchema.index({ tenantId: 1, name: 1 }, { unique: true })

export const AcademicYear = model('AcademicYear', academicYearSchema, 'academic_years')

const subjectSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  type: { type: String, default: 'THEORY' }, // SUBJECT_TYPES
  departmentId: { type: ObjectId, ref: 'Department' },
  active: { type: Boolean, default: true },
}, { timestamps: true })
subjectSchema.plugin(tenantPlugin)
subjectSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const Subject = model('Subject', subjectSchema, 'subjects')

const gradeBandSchema = new Schema({
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  grade: { type: String, required: true, trim: true },
  points: Number,
  remark: { type: String, trim: true },
}, { _id: false })

const gradingSchemeSchema = new Schema({
  name: { type: String, required: true, trim: true },
  kind: { type: String, default: 'GRADES' }, // GRADING_KINDS
  bands: { type: [gradeBandSchema], default: [] },
  /** Used by classes that don't name their own scheme. */
  isDefault: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true })
gradingSchemeSchema.plugin(tenantPlugin)
gradingSchemeSchema.index({ tenantId: 1, name: 1 }, { unique: true })

export const GradingScheme = model('GradingScheme', gradingSchemeSchema, 'grading_schemes')

/** A class (grade / standard): "Class 8". Its sections exist per academic year. */
const classSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true }, // "8" — short labels: 8-A
  order: { type: Number, default: 0 },
  departmentId: { type: ObjectId, ref: 'Department' }, // wing: Primary, Middle school …
  subjectIds: { type: [{ type: ObjectId, ref: 'Subject' }], default: [] },
  /** Of subjectIds, the ones a student picks (electives, second language). */
  optionalSubjectIds: { type: [{ type: ObjectId, ref: 'Subject' }], default: [] },
  gradingSchemeId: { type: ObjectId, ref: 'GradingScheme' },
  active: { type: Boolean, default: true },
}, { timestamps: true })
classSchema.plugin(tenantPlugin)
classSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const ClassLevel = model('ClassLevel', classSchema, 'classes')

/** A section of a class in one academic year, on one campus: "Class 8 – A" in 2026-27. */
const sectionSchema = new Schema({
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  branchId: { type: ObjectId, ref: 'Branch' },
  name: { type: String, required: true, trim: true, uppercase: true }, // "A"
  classTeacherId: { type: ObjectId, ref: 'User' },
  capacity: Number,
  room: { type: String, trim: true },
  // the room's seating (shared seating.js): benches or single desks, how many across and deep, how seats are numbered
  seating: {
    type: new Schema({ kind: String, perBench: Number, columns: Number, rows: Number, numbering: String }, { _id: false }),
    default: undefined,
  },
  // who sits where, when arranged by hand (shared seating.js placeStudents); empty: roll-number order
  seatAssignments: { type: [new Schema({ seat: String, studentId: ObjectId }, { _id: false })], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true })
sectionSchema.plugin(tenantPlugin)
sectionSchema.index({ tenantId: 1, academicYearId: 1, classId: 1, name: 1 }, { unique: true })
sectionSchema.index({ tenantId: 1, classTeacherId: 1 })

export const Section = model('Section', sectionSchema, 'sections')

/** Who teaches a subject to a section. One teacher per section and subject. */
const allocationSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true },
  teacherId: { type: ObjectId, ref: 'User', required: true },
  periodsPerWeek: Number,
}, { timestamps: true })
allocationSchema.plugin(tenantPlugin)
allocationSchema.index({ tenantId: 1, sectionId: 1, subjectId: 1 }, { unique: true })
allocationSchema.index({ tenantId: 1, teacherId: 1, academicYearId: 1 })

export const TeacherAllocation = model('TeacherAllocation', allocationSchema, 'teacher_allocations')

/**
 * A class's books, notebooks, stationery and uniform for a year (Academic setup › Books & uniform) — for one campus, or
 * every campus (branchId null). Families see it in the app from `visibleFrom` once it is published, with its files
 * (the publisher's book list, a uniform picture) as PDF or photos. An item may point at a store item (Store & assets),
 * whose code and sale price it shows.
 */
const kitItemSchema = new Schema({
  kind: { type: String, default: 'BOOK' }, // KIT_KINDS
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true }, // ISBN, the store's item code, or the shop's
  subject: { type: String, trim: true },
  publisher: { type: String, trim: true }, // books: publisher / author
  qty: { type: Number, default: 1 },
  price: Number, // paise, per piece — optional
  note: { type: String, trim: true }, // "Monday to Thursday", "sizes at the store", "cover in brown paper"
  storeItemId: ObjectId,
}, { _id: true })
// a shop the school sends families to (instead of, or besides, its own store): what it sells, where, how to reach it
const kitShopSchema = new Schema({
  name: { type: String, required: true, trim: true },
  sells: { type: [String], default: [] }, // KIT_KINDS it is for; empty = everything on the list
  address: { type: String, trim: true },
  phone: { type: String, trim: true },
  mapUrl: { type: String, trim: true },
  note: { type: String, trim: true }, // "show the school ID for 10% off", "open 10–7, closed Tuesday"
}, { _id: true })
const classKitSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  classId: { type: ObjectId, ref: 'ClassLevel', required: true },
  branchId: { type: ObjectId, ref: 'Branch', default: null },
  items: { type: [kitItemSchema], default: [] },
  shops: { type: [kitShopSchema], default: [] }, // where to buy
  instructions: { type: String, trim: true }, // a few lines above the list: where to buy, by when, how to label
  published: { type: Boolean, default: false },
  visibleFrom: String, // YYYY-MM-DD: families see it from this day (empty = as soon as it is published)
  updatedBy: String,
}, { timestamps: true })
classKitSchema.plugin(tenantPlugin)
classKitSchema.index({ tenantId: 1, academicYearId: 1, classId: 1, branchId: 1 }, { unique: true })
export const ClassKit = model('ClassKit', classKitSchema, 'class_kits')
