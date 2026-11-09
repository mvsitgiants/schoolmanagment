// Health & infirmary (module `health`). Tenant-scoped.
//
//   HealthRecord    one per student: blood group, growth, allergies, vaccinations, doctor — and the sensitive part
//                   (conditions, medicines, emergency notes) only `health.records.view_sensitive` reads
//   SickVisit       a student or staff member in the sick room: complaint, vitals, what was given, how it ended
//   HealthIncident  an injury / incident report: where, when, what happened, first aid, guardian told, follow-up
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const recordSchema = new Schema({
  studentId: { type: ObjectId, required: true },
  branchId: ObjectId,
  bloodGroup: String,
  measurements: [{ date: String, heightCm: Number, weightKg: Number, by: String, _id: false }],
  allergies: [String],
  vaccinations: [{ name: String, date: String, dose: String, note: String }],
  doctor: { name: String, phone: String, hospital: String },
  // sensitive
  conditions: [String],
  medications: [{ name: String, dose: String, schedule: String, _id: false }],
  emergencyNotes: String,
  updatedBy: String,
}, { timestamps: true })
recordSchema.plugin(tenantPlugin)
recordSchema.index({ tenantId: 1, studentId: 1 }, { unique: true })
export const HealthRecord = model('HealthRecord', recordSchema, 'health_records')

const visitSchema = new Schema({
  personType: { type: String, default: 'STUDENT' }, // STUDENT · STAFF
  studentId: ObjectId,
  staffUserId: ObjectId,
  staffName: String,
  branchId: ObjectId,
  date: { type: String, required: true }, // YYYY-MM-DD
  inAt: { type: Date, default: Date.now },
  outAt: Date,
  complaint: { type: String, required: true }, // COMPLAINTS
  complaintNote: String,
  vitals: { tempC: Number, pulse: Number, bp: String, spo2: Number },
  treatment: String,
  medicines: [{ name: String, dose: String, _id: false }],
  outcome: { type: String, default: 'IN_ROOM' }, // VISIT_OUTCOMES
  outcomeNote: String,
  referredTo: String,
  pickedUpBy: String,
  guardianNotified: { type: Boolean, default: false },
  by: String, closedBy: String,
}, { timestamps: true })
visitSchema.plugin(tenantPlugin)
visitSchema.index({ tenantId: 1, date: -1, inAt: -1 })
visitSchema.index({ tenantId: 1, studentId: 1, date: -1 })
visitSchema.index({ tenantId: 1, outcome: 1 })
export const SickVisit = model('SickVisit', visitSchema, 'health_visits')

const incidentSchema = new Schema({
  personType: { type: String, default: 'STUDENT' },
  studentId: ObjectId,
  staffUserId: ObjectId,
  staffName: String,
  branchId: ObjectId,
  kind: { type: String, default: 'INJURY' }, // INCIDENT_KINDS
  date: { type: String, required: true },
  time: String, // HH:MM
  place: String,
  description: { type: String, required: true },
  injury: String,
  firstAid: String,
  witnesses: [String],
  severity: { type: String, default: 'MINOR' }, // INCIDENT_SEVERITY
  visitId: ObjectId,
  guardianInformed: { at: Date, by: String, how: String, note: String },
  followUp: String,
  followUpDate: String,
  status: { type: String, default: 'OPEN' }, // INCIDENT_STATUS
  resolvedAt: Date, resolvedBy: String, resolution: String,
  reportedBy: String,
}, { timestamps: true })
incidentSchema.plugin(tenantPlugin)
incidentSchema.index({ tenantId: 1, status: 1, date: -1 })
incidentSchema.index({ tenantId: 1, studentId: 1, date: -1 })
export const HealthIncident = model('HealthIncident', incidentSchema, 'health_incidents')
