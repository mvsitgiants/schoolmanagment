// Transport (module `transport`). Tenant-scoped.
//
//   Vehicle              a bus or van: papers with expiry dates, driver and attendant, its GPS device
//   TransportRoute       a route's stops in order, with times and the yearly fee for each stop
//   TransportAssignment  which student rides which route, from which stop (one in force per student)
//   Trip                 one run of a route on a day (pickup or drop): stops reached, who got on and off
//   VehiclePosition      where a vehicle was (kept 30 days)
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const person = { name: String, mobile: String, licenceNo: String, licenceExpiry: String, userId: ObjectId }

const vehicleSchema = new Schema({
  regNo: { type: String, required: true, trim: true, uppercase: true },
  type: { type: String, default: 'BUS' }, // VEHICLE_TYPES
  capacity: { type: Number, default: 40 },
  make: String,
  branchId: ObjectId,
  gpsDeviceId: { type: String, trim: true }, // the tracker's id / IMEI
  docs: [{ kind: String, number: String, expiry: String, _id: false }],
  driver: person,
  attendant: person,
  status: { type: String, default: 'ACTIVE' }, // VEHICLE_STATUS
  notes: String,
  lastPosition: { lat: Number, lng: Number, speed: Number, heading: Number, at: Date, source: String },
}, { timestamps: true })
vehicleSchema.plugin(tenantPlugin)
vehicleSchema.index({ tenantId: 1, regNo: 1 }, { unique: true })
vehicleSchema.index({ tenantId: 1, gpsDeviceId: 1 }, { unique: true, partialFilterExpression: { gpsDeviceId: { $type: 'string' } } })
export const Vehicle = model('Vehicle', vehicleSchema, 'transport_vehicles')

const stopSchema = new Schema({
  name: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },
  lat: Number, lng: Number,
  pickupTime: String, dropTime: String, // HH:MM
  fee: Number, // paise a year for students at this stop
  landmark: String,
})

const routeSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  vehicleId: ObjectId,
  branchId: ObjectId,
  stops: { type: [stopSchema], default: [] },
  active: { type: Boolean, default: true },
  notes: String,
}, { timestamps: true })
routeSchema.plugin(tenantPlugin)
routeSchema.index({ tenantId: 1, name: 1 }, { unique: true })
export const TransportRoute = model('TransportRoute', routeSchema, 'transport_routes')

const assignmentSchema = new Schema({
  studentId: { type: ObjectId, required: true },
  routeId: { type: ObjectId, required: true },
  stopId: { type: ObjectId, required: true },
  mode: { type: String, default: 'BOTH' }, // RIDE_MODES
  from: { type: String, required: true }, // YYYY-MM-DD
  to: String, // when it ended (moved route, left)
  active: { type: Boolean, default: true },
  note: String,
  by: String,
}, { timestamps: true })
assignmentSchema.plugin(tenantPlugin)
assignmentSchema.index({ tenantId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { active: true } })
assignmentSchema.index({ tenantId: 1, routeId: 1, active: 1 })
export const TransportAssignment = model('TransportAssignment', assignmentSchema, 'transport_assignments')

const tripSchema = new Schema({
  routeId: { type: ObjectId, required: true },
  vehicleId: ObjectId,
  date: { type: String, required: true },
  kind: { type: String, required: true }, // TRIP_KINDS
  status: { type: String, default: 'RUNNING' }, // TRIP_STATUS
  startedAt: Date, endedAt: Date,
  startedBy: String, startedById: ObjectId,
  lastPosition: { lat: Number, lng: Number, speed: Number, at: Date },
  reached: [{ stopId: ObjectId, at: Date, _id: false }],
  alerted: [ObjectId], // stops whose families were told the bus is near
  rides: [{ studentId: ObjectId, stopId: ObjectId, event: String, at: Date, by: String, _id: false }],
}, { timestamps: true })
tripSchema.plugin(tenantPlugin)
tripSchema.index({ tenantId: 1, routeId: 1, date: 1, kind: 1 }, { unique: true })
tripSchema.index({ tenantId: 1, status: 1, vehicleId: 1 })
export const Trip = model('Trip', tripSchema, 'transport_trips')

const positionSchema = new Schema({
  vehicleId: { type: ObjectId, required: true },
  tripId: ObjectId,
  lat: { type: Number, required: true }, lng: { type: Number, required: true },
  speed: Number, heading: Number, accuracy: Number,
  at: { type: Date, required: true },
  source: String, // PHONE · DEVICE
}, { timestamps: false })
positionSchema.plugin(tenantPlugin)
positionSchema.index({ tenantId: 1, vehicleId: 1, at: -1 })
positionSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 86400 })
export const VehiclePosition = model('VehiclePosition', positionSchema, 'transport_positions')
