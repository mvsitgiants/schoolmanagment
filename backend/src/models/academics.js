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
