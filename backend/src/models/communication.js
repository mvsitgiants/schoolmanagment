// Communication hub (module `communication`). Tenant-scoped.
//
//   Notice        a notice or circular to families (whole school, classes, sections or students)
//   NoticeRead    a family opened a notice in the app (one row per notice and student)
//   Broadcast     a one-off message sent from Send messages; its MessageLog rows point back to it
//   Conversation  a family and a teacher about one student (parent–teacher chat)
//   ChatMessage   one message in a conversation
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const audienceSchema = new Schema({
  kind: { type: String, default: 'ALL' }, // AUDIENCE_KINDS
  classIds: { type: [ObjectId], default: [] },
  sectionIds: { type: [ObjectId], default: [] },
  studentIds: { type: [ObjectId], default: [] },
}, { _id: false })

const noticeSchema = new Schema({
  title: { type: String, required: true, trim: true },
  body: { type: String, default: '' },
  category: { type: String, default: 'General' },
  audience: { type: audienceSchema, default: () => ({ kind: 'ALL' }) },
  academicYearId: { type: ObjectId, ref: 'AcademicYear' },
  status: { type: String, default: 'DRAFT' }, // NOTICE_STATUS
  pinned: { type: Boolean, default: false },
  expiresOn: String, // YYYY-MM-DD: off the app's list after this day
  channels: { type: [String], default: [] }, // ticked when published: SMS · WHATSAPP · EMAIL
  publishedAt: Date, publishedBy: String,
  withdrawnAt: Date, withdrawnBy: String,
  recipients: Number, // students it reached when published
  createdBy: String, createdById: ObjectId,
}, { timestamps: true })
noticeSchema.plugin(tenantPlugin)
noticeSchema.index({ tenantId: 1, status: 1, publishedAt: -1 })
export const Notice = model('Notice', noticeSchema, 'notices')

const noticeReadSchema = new Schema({
  noticeId: { type: ObjectId, ref: 'Notice', required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  readAt: { type: Date, default: Date.now },
}, { timestamps: false })
noticeReadSchema.plugin(tenantPlugin)
noticeReadSchema.index({ tenantId: 1, noticeId: 1, studentId: 1 }, { unique: true })
export const NoticeRead = model('NoticeRead', noticeReadSchema, 'notice_reads')

const broadcastSchema = new Schema({
  subject: String,
  text: { type: String, required: true },
  audience: { type: audienceSchema, default: () => ({ kind: 'ALL' }) },
  channels: { type: [String], default: [] },
  recipients: Number, // students
  queued: Number, skipped: Number, // message rows at the time of sending
  sentBy: String, sentById: ObjectId,
}, { timestamps: true })
broadcastSchema.plugin(tenantPlugin)
broadcastSchema.index({ tenantId: 1, createdAt: -1 })
export const Broadcast = model('Broadcast', broadcastSchema, 'broadcasts')

const conversationSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  sectionId: { type: ObjectId, ref: 'Section' },
  staffUserId: { type: ObjectId, ref: 'User', required: true },
  staffName: String,
  subjectName: String, // what the teacher teaches the child (or "Class teacher")
  familyMobile: String, // the number that started it (10 digits)
  lastAt: Date,
  lastText: String,
  lastFrom: String, // CHAT_SIDES
  unreadStaff: { type: Number, default: 0 },
  unreadFamily: { type: Number, default: 0 },
  closed: { type: Boolean, default: false },
}, { timestamps: true })
conversationSchema.plugin(tenantPlugin)
conversationSchema.index({ tenantId: 1, studentId: 1, staffUserId: 1 }, { unique: true })
conversationSchema.index({ tenantId: 1, staffUserId: 1, lastAt: -1 })
export const Conversation = model('Conversation', conversationSchema, 'conversations')

const chatMessageSchema = new Schema({
  conversationId: { type: ObjectId, ref: 'Conversation', required: true },
  from: { type: String, required: true }, // CHAT_SIDES
  byName: String,
  byId: ObjectId, // the staff user, for staff messages
  text: { type: String, required: true },
  hidden: { type: Boolean, default: false }, // removed by a moderator
  hiddenBy: String, hiddenAt: Date,
}, { timestamps: true })
chatMessageSchema.plugin(tenantPlugin)
chatMessageSchema.index({ tenantId: 1, conversationId: 1, createdAt: 1 })
export const ChatMessage = model('ChatMessage', chatMessageSchema, 'chat_messages')
