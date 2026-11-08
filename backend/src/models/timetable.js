// Timetable (module `timetable`). Tenant-scoped.
//
//   BellSchedule    the day's periods and breaks with their times; classes follow one (the default otherwise)
//   Room            a classroom, lab or hall; a section may have a home room
//   Timetable       one version of a year's timetable (draft → published; the published one before it is archived)
//   TimetableEntry  one cell: a section, a day and period, the subject, teacher and room
//   Substitution    a teacher standing in for an absent one, for one period on one date
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const hhmm = { type: String, match: /^\d{2}:\d{2}$/ }

const slotSchema = new Schema({ no: { type: Number, default: 0 }, kind: { type: String, default: 'PERIOD' }, label: String, start: hhmm, end: hhmm }, { _id: false })
const bellSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slots: { type: [slotSchema], default: [] },
  classIds: { type: [ObjectId], default: [] }, // empty on the default schedule = every class not on another
  isDefault: { type: Boolean, default: false },
}, { timestamps: true })
bellSchema.plugin(tenantPlugin)
export const BellSchedule = model('BellSchedule', bellSchema, 'bell_schedules')

const roomSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  kind: { type: String, default: 'CLASSROOM' }, // ROOM_KINDS
  capacity: Number,
  sectionId: { type: ObjectId, ref: 'Section' }, // home room of a section (this year)
  branchId: { type: ObjectId, ref: 'Branch' },
  active: { type: Boolean, default: true },
}, { timestamps: true })
roomSchema.plugin(tenantPlugin)
export const Room = model('Room', roomSchema, 'rooms')

const blockedSchema = new Schema({ teacherId: ObjectId, day: String, period: Number }, { _id: false })
const timetableSchema = new Schema({
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  version: { type: Number, required: true },
  status: { type: String, default: 'DRAFT' }, // TIMETABLE_STATUS
  effectiveFrom: String, // YYYY-MM-DD
  rules: { maxSamePerDay: { type: Number, default: 2 }, teacherMaxPerDay: { type: Number, default: 6 } },
  blocked: { type: [blockedSchema], default: [] }, // teachers' unavailable periods
  generatedAt: Date, generatedBy: String,
  unplaced: { type: Schema.Types.Mixed, default: [] }, // what the last run couldn't place
  publishedAt: Date, publishedBy: String,
  note: String,
}, { timestamps: true, minimize: false })
timetableSchema.plugin(tenantPlugin)
timetableSchema.index({ tenantId: 1, academicYearId: 1, version: 1 }, { unique: true })
export const Timetable = model('Timetable', timetableSchema, 'timetables')

const entrySchema = new Schema({
  timetableId: { type: ObjectId, ref: 'Timetable', required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  day: { type: String, required: true }, // WEEK_DAYS
  period: { type: Number, required: true },
  subjectId: { type: ObjectId, ref: 'Subject' },
  teacherId: { type: ObjectId, ref: 'User' },
  roomId: { type: ObjectId, ref: 'Room' },
  locked: { type: Boolean, default: false }, // kept when the timetable is generated again
}, { timestamps: false })
entrySchema.plugin(tenantPlugin)
entrySchema.index({ tenantId: 1, timetableId: 1, sectionId: 1, day: 1, period: 1 }, { unique: true })
entrySchema.index({ tenantId: 1, timetableId: 1, teacherId: 1, day: 1, period: 1 })
export const TimetableEntry = model('TimetableEntry', entrySchema, 'timetable_entries')

const substitutionSchema = new Schema({
  date: { type: String, required: true },
  sectionId: { type: ObjectId, ref: 'Section', required: true },
  period: { type: Number, required: true },
  subjectId: ObjectId,
  absentTeacherId: { type: ObjectId, ref: 'User', required: true },
  substituteId: { type: ObjectId, ref: 'User', required: true },
  note: String,
  by: String,
}, { timestamps: true })
substitutionSchema.plugin(tenantPlugin)
substitutionSchema.index({ tenantId: 1, date: 1, sectionId: 1, period: 1 }, { unique: true })
substitutionSchema.index({ tenantId: 1, substituteId: 1, date: 1 })
export const Substitution = model('Substitution', substitutionSchema, 'substitutions')
