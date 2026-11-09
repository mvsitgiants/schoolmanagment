// Hostel (module `hostel`). Tenant-scoped.
//
//   HostelBlock      a building: boys / girls / mixed / staff, on a campus, with its warden
//   HostelRoom       a room on a floor of a block: type, AC or not, its beds (each FREE / RESERVED / BLOCKED)
//   HostelAllotment  which student sleeps in which bed, from a date (one in force per student and per bed)
//   Outpass          leave to go out and come back: asked, approved, out, back in (late or not)
//   MessMenu         the weekly menu (day × meal), for one block or common to all
//   MessCount        how many ate a meal on a day
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const blockSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  kind: { type: String, default: 'BOYS' }, // BLOCK_KINDS
  branchId: ObjectId,
  floors: { type: Number, default: 1 },
  warden: { name: String, mobile: String, userId: ObjectId },
  notes: String,
  active: { type: Boolean, default: true },
}, { timestamps: true })
blockSchema.plugin(tenantPlugin)
blockSchema.index({ tenantId: 1, name: 1 }, { unique: true })
export const HostelBlock = model('HostelBlock', blockSchema, 'hostel_blocks')

const bedSchema = new Schema({
  label: { type: String, required: true }, // A, B, C …
  state: { type: String, default: 'FREE' }, // FREE · RESERVED · BLOCKED (OCCUPIED comes from the allotment)
  note: String, // why it is blocked, or who it is held for
})

const roomSchema = new Schema({
  blockId: { type: ObjectId, required: true },
  floor: { type: Number, default: 0 }, // 0 = ground
  number: { type: String, required: true, trim: true, uppercase: true },
  type: { type: String, default: 'DOUBLE' }, // ROOM_TYPES
  ac: { type: Boolean, default: false },
  fee: Number, // paise a year for a bed in this room (optional; the fee module bills it)
  beds: { type: [bedSchema], default: [] },
  notes: String,
  active: { type: Boolean, default: true },
}, { timestamps: true })
roomSchema.plugin(tenantPlugin)
roomSchema.index({ tenantId: 1, blockId: 1, number: 1 }, { unique: true })
export const HostelRoom = model('HostelRoom', roomSchema, 'hostel_rooms')

const allotmentSchema = new Schema({
  studentId: { type: ObjectId, required: true },
  blockId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  bedId: { type: ObjectId, required: true },
  branchId: ObjectId,
  from: { type: String, required: true }, // YYYY-MM-DD
  to: String, // the last night, once ended
  active: { type: Boolean, default: true },
  endReason: String, // MOVED or CHECKOUT_REASONS
  endNote: String,
  note: String,
  by: String,
  endedBy: String,
  feeInvoiceId: ObjectId, // when a hostel fee invoice was raised for it
}, { timestamps: true })
allotmentSchema.plugin(tenantPlugin)
allotmentSchema.index({ tenantId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { active: true } })
allotmentSchema.index({ tenantId: 1, bedId: 1 }, { unique: true, partialFilterExpression: { active: true } })
allotmentSchema.index({ tenantId: 1, blockId: 1, active: 1 })
export const HostelAllotment = model('HostelAllotment', allotmentSchema, 'hostel_allotments')

const outpassSchema = new Schema({
  outpassNo: { type: String, required: true },
  studentId: { type: ObjectId, required: true },
  blockId: ObjectId,
  branchId: ObjectId,
  kind: { type: String, default: 'DAY' }, // OUTPASS_KINDS
  leaveDate: { type: String, required: true }, leaveTime: { type: String, required: true }, // wall clock, institution timezone
  returnDate: { type: String, required: true }, returnTime: { type: String, required: true },
  leaveAt: Date, returnBy: Date, // the same as instants
  reason: { type: String, required: true },
  destination: String,
  escort: { name: String, relation: String, mobile: String },
  status: { type: String, default: 'REQUESTED' }, // OUTPASS_STATUS
  requestedBy: { type: String, default: 'WARDEN' }, // WARDEN · PARENT
  requestedByName: String,
  decidedBy: String, decidedAt: Date, decisionNote: String,
  outAt: Date, outBy: String,
  inAt: Date, inBy: String,
  late: { type: Boolean, default: false },
  lateMinutes: Number,
  note: String,
}, { timestamps: true })
outpassSchema.plugin(tenantPlugin)
outpassSchema.index({ tenantId: 1, outpassNo: 1 }, { unique: true })
outpassSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })
outpassSchema.index({ tenantId: 1, status: 1, leaveDate: 1 })
export const Outpass = model('Outpass', outpassSchema, 'hostel_outpasses')

const menuSchema = new Schema({
  blockId: ObjectId, // none = the common menu for every block
  branchId: ObjectId,
  items: [{ day: String, meal: String, dishes: String, _id: false }], // MESS_DAYS × MEALS
  updatedBy: String,
}, { timestamps: true })
menuSchema.plugin(tenantPlugin)
menuSchema.index({ tenantId: 1, blockId: 1 }, { unique: true })
export const MessMenu = model('MessMenu', menuSchema, 'hostel_mess_menus')

const countSchema = new Schema({
  blockId: ObjectId, // none = everyone in the hostel
  date: { type: String, required: true },
  meal: { type: String, required: true },
  count: { type: Number, default: 0 },
  note: String,
  by: String,
}, { timestamps: true })
countSchema.plugin(tenantPlugin)
countSchema.index({ tenantId: 1, blockId: 1, date: 1, meal: 1 }, { unique: true })
export const MessCount = model('MessCount', countSchema, 'hostel_mess_counts')
