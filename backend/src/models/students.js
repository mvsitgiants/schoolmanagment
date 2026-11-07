// Students and their guardians. Tenant-scoped.
//
// This is the core record the rest of the product hangs off: attendance, marks, fees,
// transport and messages all point at a student. The Students module (Phase 1) adds the
// admission flow, documents, promotion and transfer on top of it; fields here are the ones
// the platform itself needs today — plan limits (active students) and messages to families.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'LEFT', 'PASSED_OUT']

const guardianSchema = new Schema({
  name: { type: String, required: true, trim: true },
  relation: { type: String, trim: true }, // FATHER | MOTHER | GUARDIAN | …
  mobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  /** Messages to the family go to the primary guardian (one per student). */
  isPrimary: { type: Boolean, default: false },
}, { _id: true })

const studentSchema = new Schema({
  admissionNo: { type: String, required: true, trim: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true },
  gender: { type: String, trim: true },
  dob: String, // YYYY-MM-DD
  branchId: { type: ObjectId, ref: 'Branch' },
  sectionId: { type: ObjectId, ref: 'Section' }, // current class section (Academic setup)
  status: { type: String, enum: STUDENT_STATUSES, default: 'ACTIVE' },
  // the student's own contact (colleges, older students); schools mostly reach guardians
  mobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  guardians: { type: [guardianSchema], default: [] },
  /** Language messages to this family are written in (SUPPORTED_LANGUAGES name or code). */
  language: { type: String, trim: true },
  consents: {
    // false = the family asked not to get messages on that channel (email needs an explicit yes)
    communication: { sms: Boolean, whatsapp: Boolean, email: Boolean },
  },
  customFields: { type: Schema.Types.Mixed, default: undefined },
}, { timestamps: true, minimize: false })
studentSchema.plugin(tenantPlugin)
studentSchema.index({ tenantId: 1, admissionNo: 1 }, { unique: true })
studentSchema.index({ tenantId: 1, status: 1, sectionId: 1 })
studentSchema.index({ tenantId: 1, 'guardians.mobile': 1 })

export const Student = model('Student', studentSchema, 'students')

/** "Aarav Sharma" */
export const studentName = (s) => [s?.firstName, s?.lastName].filter(Boolean).join(' ')

/** Where a message about this student goes: the primary guardian, else the first one, else the student. */
export function familyContact(s) {
  if (!s) return null
  const g = s.guardians?.find((x) => x.isPrimary) ?? s.guardians?.[0]
  return {
    name: g?.name ?? studentName(s),
    mobile: g?.mobile || s.mobile || null,
    email: g?.email || s.email || null,
  }
}
