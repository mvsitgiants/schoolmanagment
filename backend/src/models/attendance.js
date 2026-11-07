// Student attendance (module `attendance`). Tenant-scoped.
//
// One sheet per section per day — or per period when the institution takes attendance every
// period (Settings › Attendance › mode). A sheet holds every student's mark, so a class register
// for a month is ~25 small documents, not ~1,000 rows.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const entrySchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  status: { type: String, required: true }, // ATTENDANCE_MARKS: P · A · L · HD · LV
  note: { type: String, trim: true },
}, { _id: false })

const sheetSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  date: { ...ymd, required: true },
  /** 0 = the day's attendance; 1, 2, … = that period (period-wise mode). */
  period: { type: Number, default: 0 },
  subjectId: { type: ObjectId, ref: 'Subject' },
  entries: { type: [entrySchema], default: [] },
  counts: { P: Number, A: Number, L: Number, HD: Number, LV: Number, total: Number },
  takenById: ObjectId,
  takenBy: String,
  takenAt: Date,
  updatedBy: String,
}, { timestamps: true })
sheetSchema.plugin(tenantPlugin)
sheetSchema.index({ tenantId: 1, sectionId: 1, date: 1, period: 1 }, { unique: true })
sheetSchema.index({ tenantId: 1, date: 1 })
sheetSchema.index({ tenantId: 1, 'entries.studentId': 1, date: 1 })

export const AttendanceSheet = model('AttendanceSheet', sheetSchema, 'attendance_sheets')

/** A student's leave: asked for by staff (or, later, a parent in the app), then approved or not. */
const leaveSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  sectionId: { type: ObjectId, ref: 'Section' },
  from: { ...ymd, required: true },
  to: { ...ymd, required: true },
  reason: { type: String, required: true, trim: true },
  status: { type: String, default: 'PENDING' }, // LEAVE_STATUS
  appliedBy: { type: String, default: 'STAFF' }, // STAFF · PARENT
  appliedByName: String,
  appliedById: ObjectId,
  decidedBy: String,
  decidedAt: Date,
  decisionNote: String,
}, { timestamps: true })
leaveSchema.plugin(tenantPlugin)
leaveSchema.index({ tenantId: 1, status: 1, from: -1 })
leaveSchema.index({ tenantId: 1, studentId: 1, from: 1, to: 1 })

export const StudentLeave = model('StudentLeave', leaveSchema, 'student_leaves')
