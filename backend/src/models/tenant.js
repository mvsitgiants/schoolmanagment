// Tenant-scoped collections (a tenant = one school, college or trust; a branch = a campus). The tenant plugin adds `tenantId` and filters
// every query by the request's tenant (platform/db.js).
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const branchSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  isDefault: { type: Boolean, default: false },
  addressLine: String, city: String, state: String, pincode: String,
  phone: String, gstin: String,
  // Where staff and students may mark their own attendance (Settings › Staff & HR / Attendance › self attendance).
  // A site is a circle (centre + radius) or a drawn outline (polygon corners); services/attendanceSites.js.
  attendanceSites: [new Schema({
    name: { type: String, trim: true },
    shape: { type: String, default: 'CIRCLE' }, // SITE_SHAPES
    lat: { type: Number, required: true }, lng: { type: Number, required: true },
    radiusM: { type: Number, default: 200 },
    polygon: { type: [[Number]], default: undefined }, // [[lat, lng], …] — POLYGON only
    active: { type: Boolean, default: true },
  })],
  active: { type: Boolean, default: true },
}, { timestamps: true })
branchSchema.plugin(tenantPlugin)
branchSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const Branch = model('Branch', branchSchema, 'branches')

export const DEPARTMENT_TYPES = ['ACADEMIC', 'ADMINISTRATIVE', 'SUPPORT']

const departmentSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  type: { type: String, enum: DEPARTMENT_TYPES, default: 'ACADEMIC' },
  headUserId: ObjectId,
  description: String,
  active: { type: Boolean, default: true },
}, { timestamps: true })
departmentSchema.plugin(tenantPlugin)
departmentSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const Department = model('Department', departmentSchema, 'departments')

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  mobile: { type: String, trim: true },
  passwordHash: { type: String, required: true },
  designation: { type: String, trim: true },
  roleIds: [{ type: ObjectId, ref: 'Role' }],
  departmentIds: [{ type: ObjectId, ref: 'Department' }],
  sectionIds: [{ type: ObjectId, ref: 'Section' }], // class sections a "My classes" data scope covers
  branchId: { type: ObjectId, ref: 'Branch' },
  active: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  tempPasswordExpiresAt: Date, // a temporary password stops working after this (services/users.js tempPassword)
  lastLoginAt: Date,
  /** The user proved they read this email (a code or an invite link); cleared when the email changes. */
  emailVerifiedAt: Date,
  /** Asked for an emailed code after the password at every sign-in (their roles may require it anyway). */
  twoStep: { type: Boolean, default: false },
  // invite by email (services/users.js): a one-time link to set their own password
  inviteTokenHash: String,
  inviteExpiresAt: Date,
  // interface language chosen by the user (SUPPORTED_LANGUAGES code); unset = institution default
  language: { type: String, trim: true },
}, { timestamps: true })
userSchema.plugin(tenantPlugin)
userSchema.index({ tenantId: 1, email: 1 }, { unique: true })
userSchema.index({ email: 1 })
userSchema.index({ inviteTokenHash: 1 }, { sparse: true })

export const User = model('User', userSchema, 'users')

const roleSchema = new Schema({
  name: { type: String, required: true, trim: true },
  nameLower: { type: String, required: true },
  description: { type: String, trim: true },
  icon: String,
  /** Built-in role created with the tenant (Institution Admin). */
  system: { type: Boolean, default: false },
  /** Cannot be renamed, reduced or deleted. */
  locked: { type: Boolean, default: false },
  fullAccess: { type: Boolean, default: false },
  permissions: [String],
  dataScopes: { type: Schema.Types.Mixed, default: {} },
  limits: { type: Schema.Types.Mixed, default: {} },
  homePage: String,
  security: {
    require2fa: { type: Boolean, default: false },
    /** Sign-out after this many idle minutes; unset = the institution default (Settings › core › sessionIdleMinutes). */
    idleMinutes: Number,
  },
  templateCode: String,
}, { timestamps: true, minimize: false })
roleSchema.plugin(tenantPlugin)
roleSchema.index({ tenantId: 1, nameLower: 1 }, { unique: true })
roleSchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.trim().toLowerCase()
})

export const Role = model('Role', roleSchema, 'roles')

const tenantModuleSchema = new Schema({
  moduleId: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  changedAt: { type: Date, default: Date.now },
  changedBy: String,
}, { timestamps: true })
tenantModuleSchema.plugin(tenantPlugin)
tenantModuleSchema.index({ tenantId: 1, moduleId: 1 }, { unique: true })

export const TenantModule = model('TenantModule', tenantModuleSchema, 'tenant_modules')

const auditSchema = new Schema({
  at: { type: Date, default: Date.now },
  userId: ObjectId,
  userName: String,
  action: { type: String, required: true }, // CREATE | UPDATE | DELETE | LOGIN | PLAN_CHANGE …
  module: String,
  entityType: String,
  entityId: String,
  entityName: String,
  summary: String,
  changes: [{ _id: false, field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }],
  added: [String],
  removed: [String],
  /** Set on student records, so a student's access log can be shown (who opened it, when). */
  studentId: ObjectId,
  ip: String,
})
auditSchema.plugin(tenantPlugin)
auditSchema.index({ tenantId: 1, at: -1 })
auditSchema.index({ tenantId: 1, entityId: 1, at: -1 })
auditSchema.index({ tenantId: 1, studentId: 1, at: -1 }, { sparse: true })

export const AuditLog = model('AuditLog', auditSchema, 'audit_logs')

// ───────────────────────────────────────────── engines: numbering, settings, custom fields

const numberSeriesSchema = new Schema({
  docType: { type: String, required: true },
  pattern: { type: String, required: true },
  reset: { type: String, enum: ['NEVER', 'YEAR', 'MONTH', 'DAY'], required: true },
  updatedBy: String,
}, { timestamps: true })
numberSeriesSchema.plugin(tenantPlugin)
numberSeriesSchema.index({ tenantId: 1, docType: 1 }, { unique: true })

export const NumberSeries = model('NumberSeries', numberSeriesSchema, 'number_series')

/** Running counters per (docType, branch, period) — updated atomically with $inc. */
const tenantCounterSchema = new Schema({
  docType: { type: String, required: true },
  scope: { type: String, required: true }, // branch code or 'ALL'
  period: { type: String, required: true },
  seq: { type: Number, default: 0 },
})
tenantCounterSchema.plugin(tenantPlugin)
tenantCounterSchema.index({ tenantId: 1, docType: 1, scope: 1, period: 1 }, { unique: true })

export const TenantCounter = model('TenantCounter', tenantCounterSchema, 'tenant_counters')

const settingSchema = new Schema({
  module: { type: String, required: true },
  key: { type: String, required: true },
  value: Schema.Types.Mixed,
  updatedBy: String,
}, { timestamps: true })
settingSchema.plugin(tenantPlugin)
settingSchema.index({ tenantId: 1, module: 1, key: 1 }, { unique: true })

export const Setting = model('Setting', settingSchema, 'settings')

const customFieldSchema = new Schema({
  entity: { type: String, required: true },
  code: { type: String, required: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: ['TEXT', 'NUMBER', 'DATE', 'BOOL', 'SELECT', 'MULTI'], required: true },
  options: [String],
  required: { type: Boolean, default: false },
  showInList: { type: Boolean, default: false },
  help: String,
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true })
customFieldSchema.plugin(tenantPlugin)
customFieldSchema.index({ tenantId: 1, entity: 1, code: 1 }, { unique: true })

export const CustomFieldDef = model('CustomFieldDef', customFieldSchema, 'custom_field_defs')
