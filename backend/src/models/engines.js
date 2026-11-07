// Engine collections shared by every module: notifications and messages (E12),
// approvals (E8), attachments and comments (E15). All tenant-scoped.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const Mixed = Schema.Types.Mixed

// ───────────────────────────────────────────────────────── notifications (E12)

/** In-app notification for one staff user (the bell). Kept 90 days. */
const notificationSchema = new Schema({
  userId: { type: ObjectId, required: true },
  event: String,
  title: { type: String, required: true },
  message: String,
  link: String,
  tone: { type: String, default: 'info' },
  entityType: String,
  entityId: String,
  readAt: Date,
}, { timestamps: true })
notificationSchema.plugin(tenantPlugin)
notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 })
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 })

export const Notification = model('Notification', notificationSchema, 'notifications')

/**
 * One outgoing SMS / WhatsApp / email. Doubles as the outbox: the sender picks up
 * QUEUED rows, so a message survives a restart and failed sends are retried.
 */
const messageLogSchema = new Schema({
  event: String,
  channel: { type: String, required: true }, // SMS · WHATSAPP · EMAIL
  to: String,
  studentId: ObjectId,
  studentName: String,
  entityType: String,
  entityId: String,
  subject: String,
  body: String,
  /** WhatsApp Cloud API template (business-initiated messages need one). */
  waTemplate: { name: String, language: String, params: [String] },
  templateId: String, // SMS DLT template id
  provider: String,
  status: { type: String, default: 'QUEUED' }, // QUEUED · SENDING · SENT · FAILED · SKIPPED
  reason: String, // why it was skipped or failed
  attempts: { type: Number, default: 0 },
  nextAttemptAt: Date,
  providerRef: String,
  sentAt: Date,
  /** What the provider reported afterwards (delivery-report webhooks, Integrations › SMS & WhatsApp). */
  delivery: { status: String, at: Date, error: String }, // DELIVERED · READ · FAILED
  test: { type: Boolean, default: false },
  createdBy: String,
}, { timestamps: true })
messageLogSchema.plugin(tenantPlugin)
messageLogSchema.index({ tenantId: 1, createdAt: -1 })
messageLogSchema.index({ status: 1, nextAttemptAt: 1 })
messageLogSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })
messageLogSchema.index({ tenantId: 1, providerRef: 1 }, { sparse: true })

export const MessageLog = model('MessageLog', messageLogSchema, 'message_log')

const keyValue = new Schema({ name: String, value: String }, { _id: false })
const httpGateway = {
  method: { type: String, default: 'POST' },
  url: String,
  bodyType: { type: String, default: 'JSON' }, // JSON · FORM
  body: String,
  headers: [keyValue],
  apiKey: String, // encrypted; templates refer to it as {{apiKey}}
}

/** How this institution sends each channel. Secrets are stored encrypted. */
const messagingConfigSchema = new Schema({
  sms: {
    provider: { type: String, default: 'NONE' }, senderId: String, http: httpGateway,
    msg91: { authKey: String, route: { type: String, default: '4' } }, // authKey encrypted; sender id is sms.senderId
  },
  whatsapp: {
    provider: { type: String, default: 'NONE' },
    meta: { phoneNumberId: String, token: String, apiVersion: { type: String, default: 'v21.0' } },
    http: httpGateway,
  },
  email: {
    provider: { type: String, default: 'NONE' },
    smtp: { host: String, port: Number, secure: Boolean, user: String, pass: String, from: String },
  },
  updatedBy: String,
}, { timestamps: true, minimize: false })
messagingConfigSchema.plugin(tenantPlugin) // one row per institution, always written with an upsert

export const MessagingConfig = model('MessagingConfig', messagingConfigSchema, 'messaging_config')

/** An institution's changes to an event's default wording / channels. */
const notificationRuleSchema = new Schema({
  event: { type: String, required: true },
  channels: { type: Mixed, default: {} }, // { SMS: { enabled, body, templateId }, WHATSAPP: { enabled, body, templateName, language, params }, EMAIL: { enabled, subject, body } }
  updatedBy: String,
}, { timestamps: true, minimize: false })
notificationRuleSchema.plugin(tenantPlugin)
notificationRuleSchema.index({ tenantId: 1, event: 1 }, { unique: true })

export const NotificationRule = model('NotificationRule', notificationRuleSchema, 'notification_rules')

/**
 * A link sent to a patient for one document (prescription, lab report). The token is
 * the only key: long, random, expiring, and every opening is logged on the patient.
 */
const shareLinkSchema = new Schema({
  token: { type: String, required: true },
  kind: { type: String, required: true }, // RX · LAB_REPORT
  entityId: { type: String, required: true },
  studentId: ObjectId,
  expiresAt: { type: Date, required: true },
  views: { type: Number, default: 0 },
  lastViewedAt: Date,
  revokedAt: Date,
  createdBy: String,
}, { timestamps: true })
shareLinkSchema.plugin(tenantPlugin)
shareLinkSchema.index({ token: 1 }, { unique: true })
shareLinkSchema.index({ tenantId: 1, kind: 1, entityId: 1 }, { unique: true })

export const ShareLink = model('ShareLink', shareLinkSchema, 'share_links')

/** A one-time code sent by SMS to prove someone holds a mobile number. */
const otpSchema = new Schema({
  purpose: { type: String, required: true }, // BOOKING · KIOSK
  // one of the two: what the code was sent to (the kiosk is mobile only)
  mobile: String, // 91XXXXXXXXXX
  email: String, // lower-case
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  verifiedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true })
otpSchema.plugin(tenantPlugin)
otpSchema.index({ tenantId: 1, mobile: 1, createdAt: -1 })
otpSchema.index({ tenantId: 1, email: 1, createdAt: -1 }, { sparse: true })
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })

export const OtpChallenge = model('OtpChallenge', otpSchema, 'otp_challenges')

// ───────────────────────────────────────────────────────── approvals (E8)

const approvalStepSchema = new Schema({
  label: String,
  roleIds: [ObjectId],
  minValue: Number,
}, { _id: false })

/** An institution's rule for one approval type. Without a row, the default applies. */
const approvalRuleSchema = new Schema({
  type: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  expiryHours: { type: Number, default: 24 },
  steps: [approvalStepSchema],
  updatedBy: String,
}, { timestamps: true })
approvalRuleSchema.plugin(tenantPlugin)
approvalRuleSchema.index({ tenantId: 1, type: 1 }, { unique: true })

export const ApprovalRule = model('ApprovalRule', approvalRuleSchema, 'approval_rules')

const requestStepSchema = new Schema({
  label: String,
  roleIds: [ObjectId],
  roleNames: [String],
  status: { type: String, default: 'PENDING' }, // PENDING · APPROVED · REJECTED
  decidedById: ObjectId,
  decidedBy: String,
  decidedAt: Date,
  note: String,
}, { _id: false })

const approvalRequestSchema = new Schema({
  type: { type: String, required: true },
  module: String,
  mode: String, // PERMIT · EXECUTE
  title: { type: String, required: true },
  summary: String,
  measure: String, // PCT · AMOUNT
  value: Number, // % or paise
  entityType: String,
  entityId: String,
  entityName: String,
  studentId: ObjectId,
  payload: { type: Mixed, default: {} },
  reason: String,
  requestedById: { type: ObjectId, required: true },
  requestedBy: String,
  steps: [requestStepSchema],
  currentStep: { type: Number, default: 0 },
  status: { type: String, default: 'PENDING' },
  decidedAt: Date,
  expiresAt: Date,
  usedAt: Date,
  usedRef: String,
  result: Mixed,
  error: String,
}, { timestamps: true, minimize: false })
approvalRequestSchema.plugin(tenantPlugin)
approvalRequestSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
approvalRequestSchema.index({ tenantId: 1, requestedById: 1, createdAt: -1 })
approvalRequestSchema.index({ tenantId: 1, type: 1, entityId: 1, status: 1 })

export const ApprovalRequest = model('ApprovalRequest', approvalRequestSchema, 'approval_requests')

// ───────────────────────────────────────────────────────── attachments & comments (E15)

/** A stored file on a record. Never removed: deleting hides it and keeps who and why. */
const attachmentSchema = new Schema({
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  studentId: ObjectId,
  category: { type: String, default: 'OTHER' },
  title: String,
  fileName: { type: String, required: true },
  mime: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: String,
  storageKey: { type: String, required: true },
  uploadedById: ObjectId,
  uploadedBy: String,
  deleted: { at: Date, by: String, reason: String },
}, { timestamps: true })
attachmentSchema.plugin(tenantPlugin)
attachmentSchema.index({ tenantId: 1, entityType: 1, entityId: 1, createdAt: -1 })
attachmentSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })

export const Attachment = model('Attachment', attachmentSchema, 'attachments')

const commentSchema = new Schema({
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  studentId: ObjectId,
  parentId: ObjectId,
  body: { type: String, required: true },
  authorId: ObjectId,
  authorName: String,
  editedAt: Date,
  deletedAt: Date,
}, { timestamps: true })
commentSchema.plugin(tenantPlugin)
commentSchema.index({ tenantId: 1, entityType: 1, entityId: 1, createdAt: 1 })

export const Comment = model('Comment', commentSchema, 'comments')
