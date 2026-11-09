// Semester registration (module `registration`, higher education). Tenant-scoped.
//
//   RegistrationWindow  a program-semester's registration period in an academic year: dates, credit limits and the
//                       courses offered — core ones compulsory, electives in groups with a pick range and seat limits
//   CourseRegistration  one student's course selection in a window (staff enter it for the student); add / drop
//                       until the window closes; approved or rejected by the advisor
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const offeringSchema = new Schema({
  courseId: { type: ObjectId, ref: 'ProgramCourse', required: true },
  mandatory: { type: Boolean, default: false },
  group: { type: String, trim: true, uppercase: true }, // an elective group's code
  seats: Number, // null: no limit
}, { _id: false })

const groupSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, trim: true },
  minPick: { type: Number, default: 1 },
  maxPick: { type: Number, default: 1 },
}, { _id: false })

const windowSchema = new Schema({
  programId: { type: ObjectId, ref: 'Program', required: true },
  semester: { type: Number, required: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  opensOn: { ...ymd, required: true },
  closesOn: { ...ymd, required: true },
  minCredits: Number,
  maxCredits: Number,
  offerings: { type: [offeringSchema], default: [] },
  groups: { type: [groupSchema], default: [] },
  /** Registrations wait for the advisor's approval; off: approved on entry. */
  requireApproval: { type: Boolean, default: true },
  closed: { type: Boolean, default: false }, // closed early by hand
  notes: String,
  createdBy: String,
}, { timestamps: true })
windowSchema.plugin(tenantPlugin)
windowSchema.index({ tenantId: 1, academicYearId: 1, programId: 1, semester: 1 }, { unique: true })
export const RegistrationWindow = model('RegistrationWindow', windowSchema, 'registration_windows')

const historySchema = new Schema({
  at: { type: Date, default: Date.now },
  by: String,
  action: String, // SUBMITTED · CHANGED · APPROVED · REJECTED
  note: String,
  added: [String], dropped: [String], // course codes
}, { _id: false })

const registrationSchema = new Schema({
  windowId: { type: ObjectId, ref: 'RegistrationWindow', required: true },
  enrolmentId: { type: ObjectId, ref: 'ProgramEnrolment', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  programId: { type: ObjectId, ref: 'Program', required: true },
  academicYearId: { type: ObjectId, ref: 'AcademicYear', required: true },
  semester: { type: Number, required: true },
  courseIds: { type: [{ type: ObjectId, ref: 'ProgramCourse' }], default: [] },
  credits: { type: Number, default: 0 },
  status: { type: String, default: 'SUBMITTED' }, // REG_STATUS
  note: String, // the advisor's note on the decision
  decidedBy: String, decidedAt: Date,
  history: { type: [historySchema], default: [] },
}, { timestamps: true })
registrationSchema.plugin(tenantPlugin)
registrationSchema.index({ tenantId: 1, windowId: 1, studentId: 1 }, { unique: true })
registrationSchema.index({ tenantId: 1, academicYearId: 1, programId: 1, semester: 1, status: 1 })
registrationSchema.index({ tenantId: 1, courseIds: 1, status: 1 })
export const CourseRegistration = model('CourseRegistration', registrationSchema, 'course_registrations')
