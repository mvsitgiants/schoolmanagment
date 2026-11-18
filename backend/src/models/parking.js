// Parking (module `parking`): areas, vehicles with a parking pass, and the gate's in / out log. Tenant-scoped.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

/** A place to park: the staff car park, the students' cycle stand, visitor parking … with how many it holds. */
const areaSchema = new Schema({
  name: { type: String, required: true, trim: true },
  branchId: { type: ObjectId, ref: 'Branch' },
  for: { type: String, default: 'ANY' }, // PARKING_AREA_FOR
  kinds: { type: [String], default: [] }, // PARKING_VEHICLE_KINDS it takes; empty = every kind
  capacity: { type: Number, default: 0 }, // 0 = no limit
  note: { type: String, trim: true },
  active: { type: Boolean, default: true },
}, { timestamps: true })
areaSchema.plugin(tenantPlugin)
areaSchema.index({ tenantId: 1, branchId: 1, name: 1 })
export const ParkingArea = model('ParkingArea', areaSchema, 'parking_areas')

/** A vehicle allowed to park, with its pass (the QR sticker carries passNo). One live pass per number plate. */
const vehicleSchema = new Schema({
  passNo: { type: String, required: true },
  branchId: { type: ObjectId, ref: 'Branch' },
  ownerKind: { type: String, required: true }, // PARKING_OWNERS
  studentId: { type: ObjectId, ref: 'Student' }, // a student's vehicle, or the child of a parent's
  employeeId: { type: ObjectId, ref: 'Employee' },
  ownerName: { type: String, required: true, trim: true },
  ownerMobile: { type: String, trim: true },
  relation: { type: String, trim: true }, // a parent: Father, Mother …
  studentName: String, // a parent: whose parent; a student: the student
  classLabel: String,
  plate: { type: String, required: true, trim: true }, // as shown: "UP 32 AB 1234"
  plateKey: { type: String, required: true }, // UP32AB1234 — what matching uses
  kind: { type: String, required: true }, // PARKING_VEHICLE_KINDS
  model: { type: String, trim: true }, // "Honda Activa"
  colour: { type: String, trim: true },
  licenceNo: { type: String, trim: true },
  areaId: { type: ObjectId, ref: 'ParkingArea' },
  validFrom: { type: String, required: true }, // YYYY-MM-DD
  validTo: { type: String, required: true },
  status: { type: String, default: 'ACTIVE' }, // ACTIVE · REVOKED (EXPIRED is read from validTo)
  revokedAt: Date,
  revokedBy: String,
  revokeReason: { type: String, trim: true },
  note: { type: String, trim: true },
  createdBy: String,
}, { timestamps: true })
vehicleSchema.plugin(tenantPlugin)
vehicleSchema.index({ tenantId: 1, passNo: 1 }, { unique: true })
vehicleSchema.index({ tenantId: 1, plateKey: 1, status: 1 })
vehicleSchema.index({ tenantId: 1, studentId: 1 })
vehicleSchema.index({ tenantId: 1, employeeId: 1 })
export const ParkingVehicle = model('ParkingVehicle', vehicleSchema, 'parking_vehicles')

/** One stay at the gate: in, and out when it leaves (`outAt`). A pass holder's links the vehicle; a visitor's doesn't. */
const entrySchema = new Schema({
  date: { type: String, required: true }, // YYYY-MM-DD (institution time) it came in
  branchId: { type: ObjectId, ref: 'Branch' },
  areaId: { type: ObjectId, ref: 'ParkingArea' },
  vehicleId: { type: ObjectId, ref: 'ParkingVehicle' },
  passNo: String,
  parker: { type: String, required: true }, // PARKING_PARKERS
  plate: { type: String, required: true },
  plateKey: { type: String, required: true },
  kind: { type: String, required: true },
  name: { type: String, trim: true },
  mobile: { type: String, trim: true },
  purpose: { type: String, trim: true }, // a visitor: why, whom to meet
  inAt: { type: Date, required: true },
  outAt: Date,
  inBy: String,
  outBy: String,
  overFull: { type: Boolean, default: undefined }, // let in when the area was already full
  note: { type: String, trim: true },
}, { timestamps: true })
entrySchema.plugin(tenantPlugin)
entrySchema.index({ tenantId: 1, outAt: 1, areaId: 1 })
entrySchema.index({ tenantId: 1, date: -1, inAt: -1 })
entrySchema.index({ tenantId: 1, plateKey: 1, outAt: 1 })
export const ParkingEntry = model('ParkingEntry', entrySchema, 'parking_entries')
