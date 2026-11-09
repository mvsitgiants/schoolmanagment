// Events & calendar (module `events`). Tenant-scoped.
//
//   SchoolEvent  something on the calendar: who it is for (everyone, classes, sections, staff), when, where, and a
//                reply families may be asked for (going / not going, or consent)
//   EventReply   one family's reply for one student
//   PtmSession   a parent–teacher meeting: the day, the hours, the teachers (hosts) and whose parents meet whom
//   PtmBooking   a slot booked with one teacher for one student
//   GalleryAlbum a photo album (the photos are files on it — files engine, record type gallery_album)
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const audience = {
  audience: { type: String, default: 'EVERYONE' }, // AUDIENCES
  classIds: { type: [ObjectId], default: [] },
  sectionIds: { type: [ObjectId], default: [] },
  branchIds: { type: [ObjectId], default: [] }, // none: every campus
}

const eventSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: String,
  kind: { type: String, default: 'EVENT' }, // EVENT_KINDS
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  startTime: String, endTime: String, // HH:MM; none = all day
  venue: { type: String, trim: true },
  ...audience,
  published: { type: Boolean, default: false }, // families see published events only
  reply: { kind: { type: String, default: 'NONE' }, question: String, by: String }, // REPLY_KINDS; by: last day
  remind: { type: Boolean, default: false }, // a reminder the day before
  remindedOn: String,
  notifiedAt: Date,
  createdBy: String, createdById: ObjectId,
}, { timestamps: true })
eventSchema.plugin(tenantPlugin)
eventSchema.index({ tenantId: 1, startDate: 1, endDate: 1 })
export const SchoolEvent = model('SchoolEvent', eventSchema, 'school_events')

const replySchema = new Schema({
  eventId: { type: ObjectId, required: true },
  studentId: { type: ObjectId, required: true },
  answer: { type: String, required: true }, // YES · NO
  note: String,
  by: String, // the guardian's name, or the staff member who noted it
  byStaff: { type: Boolean, default: false },
  at: Date,
  checkedInAt: Date, checkedInBy: String, // the family's event pass scanned at the gate (Scan)
}, { timestamps: true })
replySchema.plugin(tenantPlugin)
replySchema.index({ tenantId: 1, eventId: 1, studentId: 1 }, { unique: true })
export const EventReply = model('EventReply', replySchema, 'event_replies')

const hostSchema = new Schema({
  userId: ObjectId,
  name: { type: String, required: true, trim: true },
  role: String, // Class teacher 8-A, Mathematics …
  room: String,
  sectionIds: { type: [ObjectId], default: [] }, // whose parents may book this teacher (none: everyone invited)
  away: { type: [String], default: [] }, // slot times this teacher isn't free
})

const ptmSchema = new Schema({
  title: { type: String, required: true, trim: true },
  date: { type: String, required: true },
  startTime: { type: String, required: true }, endTime: { type: String, required: true },
  slotMinutes: { type: Number, default: 10 }, gapMinutes: { type: Number, default: 0 },
  mode: { type: String, default: 'IN_PERSON' }, // PTM_MODES
  classIds: { type: [ObjectId], default: [] }, sectionIds: { type: [ObjectId], default: [] }, // who is invited (none: everyone)
  hosts: { type: [hostSchema], default: [] },
  bookingCloses: String, // last day families can book (none: the day before)
  instructions: String,
  status: { type: String, default: 'DRAFT' }, // PTM_STATUS
  openedAt: Date, remindedOn: String,
  createdBy: String,
}, { timestamps: true })
ptmSchema.plugin(tenantPlugin)
ptmSchema.index({ tenantId: 1, date: -1 })
export const PtmSession = model('PtmSession', ptmSchema, 'ptm_sessions')

const bookingSchema = new Schema({
  sessionId: { type: ObjectId, required: true },
  hostId: { type: ObjectId, required: true },
  time: { type: String, required: true }, // HH:MM
  studentId: { type: ObjectId, required: true },
  sectionId: ObjectId,
  guardian: { name: String, mobile: String },
  status: { type: String, default: 'BOOKED' }, // BOOKING_STATUS
  bookedBy: String, byFamily: { type: Boolean, default: false },
  remarks: String, // what was discussed (the teacher's note)
  cancelledAt: Date, cancelledBy: String,
  arrivedAt: Date, arrivedBy: String, // the family's meeting pass scanned on arrival — the teacher sees who is waiting
}, { timestamps: true })
bookingSchema.plugin(tenantPlugin)
bookingSchema.index({ tenantId: 1, sessionId: 1, hostId: 1, time: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] } } })
bookingSchema.index({ tenantId: 1, sessionId: 1, hostId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] } } })
bookingSchema.index({ tenantId: 1, studentId: 1, sessionId: 1 })
export const PtmBooking = model('PtmBooking', bookingSchema, 'ptm_bookings')

const albumSchema = new Schema({
  title: { type: String, required: true, trim: true },
  date: String,
  description: String,
  eventId: ObjectId,
  ...audience,
  published: { type: Boolean, default: false },
  coverFileId: ObjectId,
  createdBy: String,
}, { timestamps: true })
albumSchema.plugin(tenantPlugin)
albumSchema.index({ tenantId: 1, date: -1 })
export const GalleryAlbum = model('GalleryAlbum', albumSchema, 'gallery_albums')
