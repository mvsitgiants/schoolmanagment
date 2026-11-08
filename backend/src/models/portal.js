// Parent & student app (module `portal`). Tenant-scoped. Families are never staff users:
//
//   PortalOtp      a one-time sign-in code to a mobile number (only its HMAC is kept); one is also
//                  stored, never sent, for a number with no student on it, so the reply looks the same
//   PortalSession  a family signed in with one mobile number. Which children it reaches is worked out
//                  on every request from the records on that number, so a changed number drops out at once
//   PortalContent  what the school shows in the app: a welcome line, contact details, office timings
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose

const otpSchema = new Schema({
  mobile: { type: String, required: true }, // 10 digits
  ip: String,
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  usedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true })
otpSchema.plugin(tenantPlugin)
otpSchema.index({ tenantId: 1, mobile: 1, createdAt: -1 })
otpSchema.index({ tenantId: 1, ip: 1, createdAt: -1 })
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })
export const PortalOtp = model('PortalOtp', otpSchema, 'portal_otps')

const sessionSchema = new Schema({
  mobile: { type: String, required: true },
  kind: { type: String, default: 'PARENT' }, // PARENT · STUDENT
  studentId: Schema.Types.ObjectId, // a student's own sign-in: just this record
  ip: String,
  userAgent: String,
  expiresAt: { type: Date, required: true },
  lastSeenAt: Date,
  revokedAt: Date,
}, { timestamps: true })
sessionSchema.plugin(tenantPlugin)
sessionSchema.index({ tenantId: 1, mobile: 1, createdAt: -1 })
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 })
export const PortalSession = model('PortalSession', sessionSchema, 'portal_sessions')

const contentSchema = new Schema({
  welcome: String,
  contact: { phone: String, whatsapp: String, email: String, address: String, mapUrl: String },
  timings: [{ _id: false, label: String, hours: String }],
  help: String, // shown under "Need help?"
  updatedBy: String,
}, { timestamps: true })
contentSchema.plugin(tenantPlugin)
export const PortalContent = model('PortalContent', contentSchema, 'portal_content')
