// Certificates (module `certificates`). Tenant-scoped.
//
//   Certificate  one issued certificate: its number, kind, the student, what it says (a snapshot taken
//                when issued, so a reprint years later reads the same), and the verify code behind its QR.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const certificateSchema = new Schema({
  certificateNo: { type: String, required: true },
  kind: { type: String, required: true }, // CERTIFICATE_KINDS
  studentId: { type: ObjectId, ref: 'Student', required: true },
  branchId: { type: ObjectId, ref: 'Branch' },
  academicYearId: { type: ObjectId, ref: 'AcademicYear' },
  issueDate: { type: String, required: true }, // YYYY-MM-DD, the institution's date
  purpose: String,
  /**
   * What the certificate states, frozen at issue: the student's details and the kind's own facts —
   * conduct (CHARACTER), from / to (STUDY), financial year and fees (FEE), event and achievement (MERIT).
   */
  snapshot: { type: Schema.Types.Mixed, default: {} },
  remarks: String,
  status: { type: String, default: 'ISSUED' }, // CERTIFICATE_STATUS
  verifyCode: { type: String, required: true },
  issuedBy: String, issuedById: ObjectId,
  prints: { type: Number, default: 0 },
  lastPrintedAt: Date,
  cancelledAt: Date, cancelledBy: String, cancelReason: String,
}, { timestamps: true, minimize: false })
certificateSchema.plugin(tenantPlugin)
certificateSchema.index({ tenantId: 1, certificateNo: 1 }, { unique: true })
certificateSchema.index({ tenantId: 1, studentId: 1, issueDate: -1 })
certificateSchema.index({ tenantId: 1, kind: 1, issueDate: -1 })
// the public verify page looks a code up across institutions
certificateSchema.index({ verifyCode: 1 }, { unique: true })

export const Certificate = model('Certificate', certificateSchema, 'certificates')
