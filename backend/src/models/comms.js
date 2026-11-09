// Staff chat & call bell (module `comms`). Tenant-scoped. Ported from the hospital product.
//
//   PageCall          a call from one member of staff to a person, a role, a department or (alerts) everyone
//   PageCode          an institution's own wording / colour for an emergency alert
//   StaffChatChannel  a staff chat: whole staff (per campus), department, group or direct
//   StaffChatMember   one person in one chat (read pointer, preferences)
//   StaffChatMessage  one message
//
// The chat collections are `staff_chat_*` (and the models `StaffChat*`): `chat_messages` / `ChatMessage`
// already belong to parent–teacher chat (models/communication.js).
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

/** One person a call rings, and how they answered. */
const recipientSchema = new Schema({
  userId: { type: ObjectId, required: true },
  name: String,
  designation: String,
  status: { type: String, default: 'RINGING' }, // PAGE_RECIPIENT_STATUSES
  etaMinutes: Number, // ACKNOWLEDGED: "on my way, N min"
  reason: String, // BUSY: why
  step: { type: Number, default: 0 }, // escalation step that added them (0 = the original call)
  rings: { type: Number, default: 1 },
  firstRungAt: Date,
  lastRungAt: Date,
  respondedAt: Date,
  respondSeconds: Number, // from the moment they were first rung
}, { _id: false })

/** One escalation step or re-ring sweep, kept for the record. */
const stepSchema = new Schema({
  step: Number,
  at: { type: Date, default: Date.now },
  action: String, // ESCALATE · RERING · NO_ONE · AUTO_CLOSE
  to: String, // escalation target (DEPARTMENT_HEAD, DEPARTMENT, EVERYONE)
  label: String,
  added: Number, // people added
  note: String,
}, { _id: false })

/**
 * A call: from one member of staff to a person, a role, a department or (alerts) everyone on
 * a campus. Recipients are resolved when it is sent, so the record shows who was actually
 * rung even if departments change later.
 */
const pageCallSchema = new Schema({
  callNo: { type: String, required: true },
  branchId: ObjectId,
  from: { userId: ObjectId, name: String, designation: String, phone: String },
  target: {
    type: { type: String, required: true }, // PAGE_TARGET_TYPES
    ids: [String],
    label: String,
    departmentId: ObjectId, // the department escalation works from, when there is one
  },
  priority: { type: String, required: true }, // ROUTINE · URGENT · CODE
  code: String, // PAGE_CODES (CODE only)
  codeLabel: String,
  codeColor: String,
  location: {
    branchId: ObjectId, branchName: String, // the campus (alerts ring everyone there)
    room: String, text: String,
    label: String,
  },
  message: String,
  recipients: [recipientSchema],
  status: { type: String, default: 'ACTIVE' }, // PAGE_CALL_STATUSES
  escalation: {
    step: { type: Number, default: 0 },
    stepAt: Date, // when the current step started
    history: [stepSchema],
  },
  nextCheckAt: Date, // when the paging job should look at it again (null: nothing due)
  firstAckAt: Date,
  firstAckSeconds: Number,
  closed: { by: String, byId: ObjectId, at: Date, note: String },
}, { timestamps: true, optimisticConcurrency: true })
pageCallSchema.plugin(tenantPlugin)
pageCallSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
pageCallSchema.index({ tenantId: 1, 'recipients.userId': 1, createdAt: -1 })
pageCallSchema.index({ tenantId: 1, 'from.userId': 1, createdAt: -1 })
pageCallSchema.index({ status: 1, nextCheckAt: 1 }) // the paging job, across institutions

export const PageCall = model('PageCall', pageCallSchema, 'page_calls')

/** An institution's own wording / colour for an emergency alert (defaults in packages/shared comms.js). */
const pageCodeSchema = new Schema({
  code: { type: String, required: true },
  label: String,
  meaning: String,
  color: String,
  enabled: { type: Boolean, default: true },
  updatedBy: String,
}, { timestamps: true })
pageCodeSchema.plugin(tenantPlugin)
pageCodeSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const PageCode = model('PageCode', pageCodeSchema, 'page_codes')

// ───────────────────────────────────────────────────────── staff chat

/**
 * A chat channel. INSTITUTION (the whole staff, and one per campus when there are several) and
 * DEPARTMENT channels are kept by the server from users' campus / departments; GROUP channels are
 * made by staff; DIRECT is two people (unique per pair through `key`). `key` is set for every type but GROUP.
 */
const chatChannelSchema = new Schema({
  type: { type: String, required: true }, // CHAT_CHANNEL_TYPES
  key: String, // INSTITUTION:ALL · INSTITUTION:<branchId> · DEPARTMENT:<id> · DIRECT:<userA>:<userB>
  sourceId: ObjectId, // the campus / department an automatic channel follows
  branchId: ObjectId,
  name: String, // empty for DIRECT (each side sees the other person's name)
  description: String,
  directUserIds: [ObjectId], // DIRECT: the two people
  createdBy: { userId: ObjectId, name: String },
  archived: { type: Boolean, default: false }, // its campus / department went away; read-only
  memberCount: { type: Number, default: 0 },
  lastMessage: { id: ObjectId, at: Date, senderId: ObjectId, senderName: String, preview: String },
  lastMessageAt: Date,
}, { timestamps: true })
chatChannelSchema.plugin(tenantPlugin)
chatChannelSchema.index({ tenantId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } })
chatChannelSchema.index({ tenantId: 1, type: 1 })

export const StaffChatChannel = model('StaffChatChannel', chatChannelSchema, 'staff_chat_channels')

/** One person in one channel: role, read pointer and their own preferences. */
const chatMemberSchema = new Schema({
  channelId: { type: ObjectId, required: true },
  userId: { type: ObjectId, required: true },
  role: { type: String, default: 'MEMBER' }, // CHAT_MEMBER_ROLES (GROUP); MEMBER elsewhere
  auto: { type: Boolean, default: false }, // put there by the campus / department rule
  active: { type: Boolean, default: true }, // false: left or removed (the row keeps their read pointer)
  joinedAt: Date,
  leftAt: Date,
  lastReadAt: Date,
  lastReadMessageId: ObjectId,
  muted: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  notify: { type: String, default: 'ALL' }, // CHAT_NOTIFY_LEVELS
}, { timestamps: true })
chatMemberSchema.plugin(tenantPlugin)
chatMemberSchema.index({ tenantId: 1, channelId: 1, userId: 1 }, { unique: true })
chatMemberSchema.index({ tenantId: 1, userId: 1, active: 1 })
chatMemberSchema.index({ tenantId: 1, channelId: 1, active: 1 })

export const StaffChatMember = model('StaffChatMember', chatMemberSchema, 'staff_chat_members')

const chatAttachmentSchema = new Schema({
  fileId: ObjectId, fileName: String, contentType: String, size: Number,
}, { _id: false })

/**
 * One message. A student is only a chip (name + admission no.); opening it goes through the
 * reader's own access to student records. Deleting keeps a tombstone.
 */
const chatMessageSchema = new Schema({
  channelId: { type: ObjectId, required: true },
  kind: { type: String, default: 'TEXT' }, // TEXT · SYSTEM
  senderId: ObjectId,
  senderName: String,
  clientId: String, // the sender's own id for the message, so a resend is not posted twice
  text: String,
  mentions: [ObjectId],
  mentionNames: [String], // as written, to highlight them
  mentionChannel: { type: Boolean, default: false }, // @channel
  attachments: [chatAttachmentSchema],
  replyTo: { id: ObjectId, senderName: String, preview: String },
  student: { id: ObjectId, display: String },
  system: { action: String, actorName: String, names: [String] }, // JOINED · LEFT · ADDED · REMOVED · RENAMED · CREATED
  editedAt: Date,
  deleted: { at: Date, by: String, byId: ObjectId, moderated: Boolean },
  pinned: { at: Date, by: String },
  reactions: [new Schema({ emoji: String, userIds: [ObjectId] }, { _id: false })],
}, { timestamps: true })
chatMessageSchema.plugin(tenantPlugin)
chatMessageSchema.index({ tenantId: 1, channelId: 1, createdAt: -1, _id: -1 })
chatMessageSchema.index({ tenantId: 1, channelId: 1, 'pinned.at': -1 }, { partialFilterExpression: { 'pinned.at': { $type: 'date' } } })
chatMessageSchema.index({ tenantId: 1, senderId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } })
chatMessageSchema.index({ tenantId: 1, createdAt: 1 }) // the retention job

export const StaffChatMessage = model('StaffChatMessage', chatMessageSchema, 'staff_chat_messages')
