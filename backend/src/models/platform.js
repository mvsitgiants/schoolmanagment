// Platform-level collections: shared by the whole SaaS, NOT tenant-scoped.
import mongoose from 'mongoose'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']

const limitsShape = {
  users: Number, branches: Number, beds: Number, storageGb: Number,
}

const tenantSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: TENANT_STATUSES, default: 'TRIAL', index: true },
  planCode: { type: String, required: true },
  billingCycle: { type: String, enum: ['MONTHLY', 'YEARLY'], default: 'MONTHLY' },
  trialEndsAt: Date,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  graceDays: { type: Number, default: 7 },
  limitsOverride: { type: limitsShape, default: undefined },
  profile: {
    legalName: String, email: String, phone: String, website: String,
    addressLine: String, city: String, state: String, pincode: String, country: { type: String, default: 'India' },
    gstin: String, pan: String, registrationNo: String, nabhNo: String, hfrId: String,
    logoUrl: String, primaryColor: String, sidebarColor: String,
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
  },
  /** Bumped whenever roles, users or modules change, so cached access is rebuilt. */
  accessVersion: { type: Number, default: 1 },
  ownerUserId: ObjectId,
  /** A deal the platform owner gave this institution: % off every invoice, until a date (or always). */
  discount: { pct: Number, note: String, until: Date },
  /** Billing emails already sent (services/billingReminders.js), e.g. "trial:2026-11-07:3". */
  remindersSent: { type: [String], default: undefined },
  createdVia: { type: String, enum: ['SIGNUP', 'SUPERADMIN', 'SEED'], default: 'SUPERADMIN' },
  /**
   * The platform checked this institution's identity (legal name, GSTIN, registration, HFR id).
   * Cleared when the institution changes one of those fields (routes/core/settings.js).
   */
  verification: { at: Date, by: String, note: String },
  notes: String,
}, { timestamps: true })

export const Tenant = model('Tenant', tenantSchema, 'tenants')

const planSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  tagline: String,
  priceMonthly: { type: Number, required: true, min: 0 }, // paise
  priceYearly: { type: Number, required: true, min: 0 },  // paise
  trialDays: { type: Number, default: 14 },
  modules: [String],
  limits: limitsShape,
  features: [String],
  isPublic: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  highlight: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
  /** A retired (inactive) plan's institutions move to this plan at their next renewal. */
  renewsInto: String,
}, { timestamps: true })

export const Plan = model('Plan', planSchema, 'plans')

const invoiceSchema = new Schema({
  tenantId: { type: ObjectId, required: true, index: true },
  number: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['NEW', 'RENEWAL', 'PLAN_CHANGE'], default: 'NEW' },
  planCode: String,
  planName: String,
  cycle: { type: String, enum: ['MONTHLY', 'YEARLY'] },
  periodStart: Date,
  periodEnd: Date,
  listAmount: Number, // paise, the plan price before any discount
  discount: Number, // paise off: the institution's deal, then a coupon
  discountNote: String,
  couponCode: String,
  amount: Number, // paise, before GST (after discount)
  gstPct: Number,
  gst: Number,
  // GST split by place of supply: CGST + SGST inside the platform's state, IGST outside it
  cgst: Number,
  sgst: Number,
  igst: Number,
  placeOfSupply: String, // GST state code
  total: Number,
  /** Who billed whom, as on the day it was issued (the printed invoice never changes). */
  seller: { name: String, legalName: String, gstin: String, stateCode: String, address: String },
  billedTo: { name: String, address: String, gstin: String },
  status: { type: String, enum: ['DUE', 'PAID', 'VOID'], default: 'DUE', index: true },
  issuedAt: { type: Date, default: Date.now },
  dueDate: Date,
  paidAt: Date,
  paymentMethod: String,
  paymentRef: String,
  recordedBy: String,
  notes: String,
  // online payment (services/platformPayments.js)
  gatewayOrderId: { type: String, index: { sparse: true } }, // Razorpay order for in-app checkout
  paymentLinkId: { type: String, index: { sparse: true } },
  paymentLinkUrl: String,
  /** Money that arrived but couldn't be applied (paid twice, invoice void, wrong amount): refund it. */
  refundFlags: [{ _id: false, paymentId: String, amount: Number, reason: String, at: { type: Date, default: Date.now } }],
  /** Reminder emails already sent for it: "issued", "due", "overdue:1"… */
  remindersSent: { type: [String], default: undefined },
}, { timestamps: true })

export const SubscriptionInvoice = model('SubscriptionInvoice', invoiceSchema, 'subscription_invoices')

const subscriptionEventSchema = new Schema({
  tenantId: { type: ObjectId, required: true, index: true },
  type: { type: String, required: true }, // TRIAL_STARTED, PLAN_CHANGED, STATUS_CHANGED, INVOICE_ISSUED, PAYMENT_RECORDED, TRIAL_EXTENDED …
  from: String,
  to: String,
  note: String,
  by: String,
  at: { type: Date, default: Date.now },
})

export const SubscriptionEvent = model('SubscriptionEvent', subscriptionEventSchema, 'subscription_events')

const platformUserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  /** OWNER | BILLING | SUPPORT | READONLY (shared PLATFORM_ROLES); unset = owner (the seeded account). */
  role: { type: String, default: 'OWNER' },
  active: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  tempPasswordExpiresAt: Date,
  lastLoginAt: Date,
}, { timestamps: true })

export const PlatformUser = model('PlatformUser', platformUserSchema, 'platform_users')

const sessionSchema = new Schema({
  kind: { type: String, enum: ['TENANT', 'PLATFORM'], required: true },
  userId: { type: ObjectId, required: true, index: true },
  tenantId: { type: ObjectId, index: true },
  refreshHash: { type: String, required: true, unique: true },
  // The refresh token this one replaced, and when. Two tabs refreshing at once send the same old
  // token; inside a short window that is a race, after it the old token has leaked (routes/auth.js).
  prevRefreshHash: { type: String, index: { sparse: true } },
  rotatedAt: Date,
  userAgent: String,
  ip: String,
  lastUsedAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now }, // the person last used the app (idle sign-out, platform/middleware.js)
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  revokeReason: String, // LOGOUT | LOGOUT_ALL | PASSWORD_CHANGED | REUSE_DETECTED | USER_INACTIVE | …
}, { timestamps: true })
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const AuthSession = model('AuthSession', sessionSchema, 'auth_sessions')

const roleTemplateSchema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: String,
  icon: String,
  permissions: [String],
  dataScopes: { type: Schema.Types.Mixed, default: {} },
  limits: { type: Schema.Types.Mixed, default: {} },
  homePage: String,
  sortOrder: Number,
  active: { type: Boolean, default: true },
}, { timestamps: true, minimize: false })

export const RoleTemplate = model('RoleTemplate', roleTemplateSchema, 'role_templates')

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
})

export const Counter = model('Counter', counterSchema, 'counters')

/** Atomic platform-wide sequence, e.g. nextSeq('INV-2026') → 7. */
export async function nextSeq(key) {
  const doc = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  return doc.seq
}

// One row per background job (server.js): which server copy is running it and until when. With
// several API instances only the holder of an unexpired lease runs that job (platform/jobs.js).
const jobLeaseSchema = new Schema({
  _id: String, // the job's name
  owner: String,
  until: Date,
}, { versionKey: false })
export const JobLease = model('JobLease', jobLeaseSchema, 'job_leases')

// Wrong-password count per sign-in email (platform/auth/lockout.js). Per email, not per institution:
// one email can sign in to several institutions, and the guess is against the email.
const loginThrottleSchema = new Schema({
  _id: String, // lower-case email
  fails: { type: Number, default: 0 },
  windowStart: Date,
  lockedUntil: Date,
}, { versionKey: false, timestamps: { createdAt: false, updatedAt: true } })
loginThrottleSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 })
export const LoginThrottle = model('LoginThrottle', loginThrottleSchema, 'login_throttles')

// The platform's own settings (Superadmin › Settings): one row, _id 'platform'. Read through
// services/platformSettings.js. The SMTP password is encrypted (platform/crypto.js).
const platformSettingSchema = new Schema({
  _id: { type: String, default: 'platform' },
  /** Who sends the emails and, later, the subscription invoices. */
  company: {
    name: String, legalName: String, gstin: String, stateCode: String, address: String,
    supportEmail: String, supportPhone: String,
  },
  email: {
    host: String, port: Number, secure: Boolean, user: String, pass: String,
    fromName: String, fromEmail: String, replyTo: String,
    /** Last successful test send with the current server settings; cleared when they change. */
    verifiedAt: Date,
  },
  /**
   * The platform's own SMS account, for one-time codes of institutions that haven't connected their
   * own (portal sign-in, online booking, kiosk). MSG91 + an Indian DLT template for the code text.
   * Auth key encrypted. TEST: development only, nothing is sent. verifiedAt: last good test send.
   */
  sms: {
    provider: { type: String, enum: ['NONE', 'MSG91', 'TEST'], default: 'NONE' },
    senderId: String, msg91: { authKey: String, route: String },
    otpTemplateId: String, otpText: String,
    verifiedAt: Date,
  },
  /** Self sign-up open; unset = the SIGNUP_ENABLED environment default. */
  signupEnabled: Boolean,
  /** Maintenance / announcement banner on every signed-in screen and the sign-in page. */
  notice: { message: String, tone: { type: String, enum: ['info', 'warning'], default: 'info' }, active: Boolean, until: Date },
  /** The platform's own Razorpay account, for subscription invoices (not any institution's). Secrets encrypted. */
  razorpay: { keyId: String, keySecret: String, webhookSecret: String },
  /**
   * The platform's ABDM integrator account: one client id for every institution, which only adds
   * its HIP id (Integrations › ABDM). Secret encrypted. verifiedAt: last good session, cleared on change.
   */
  updatedBy: String,
}, { timestamps: true, versionKey: false, minimize: false })
export const PlatformSetting = model('PlatformSetting', platformSettingSchema, 'platform_settings')

// Emailed six-digit codes (platform/auth/codes.js): the second step of sign-in, proving an
// email address, resetting a forgotten password, and confirming a new sign-up before the
// institution is created. Hashed, 10 minutes, 5 tries; removed by Mongo a day after they expire.
const authCodeSchema = new Schema({
  purpose: { type: String, enum: ['LOGIN', 'VERIFY_EMAIL', 'RESET_PASSWORD', 'SIGNUP'], required: true },
  email: { type: String, required: true, lowercase: true, index: true },
  kind: { type: String, enum: ['TENANT', 'PLATFORM'] },
  userId: ObjectId,
  tenantId: ObjectId,
  /** SIGNUP: the form (password already hashed), created only once the code is entered. */
  payload: Schema.Types.Mixed,
  /** Switching institution with a code: the session to end once the new one opens. */
  endsSessionId: ObjectId,
  /** VERIFY_EMAIL: the "Confirm my email" link sent with the code (hash only), valid longer than the code. */
  linkHash: { type: String, index: { sparse: true } },
  linkExpiresAt: Date,
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  sends: { type: Number, default: 1 },
  sentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
}, { timestamps: true, versionKey: false })
authCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 })
export const AuthCode = model('AuthCode', authCodeSchema, 'auth_codes')

// Platform payment webhooks already handled (Razorpay retries; each event applies once).
const paymentEventSchema = new Schema({
  _id: String, // Razorpay x-razorpay-event-id (or the body hash)
  type: String,
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
paymentEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 })
export const PaymentEvent = model('PaymentEvent', paymentEventSchema, 'payment_events')

// Coupon codes (Superadmin › Coupons): % off one invoice when an institution subscribes or changes plan.
const discountCodeSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  pct: { type: Number, required: true, min: 1, max: 100 },
  description: String,
  planCodes: [String], // empty: every plan
  validUntil: Date,
  maxUses: Number, // empty: unlimited
  uses: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true })
export const DiscountCode = model('DiscountCode', discountCodeSchema, 'discount_codes')

// Every change made in the platform console (and platform sign-ins): who, what, on which record,
// how it ended. Written by services/platformAudit.js; kept two years.
const platformAuditSchema = new Schema({
  at: { type: Date, default: Date.now }, // indexed by the TTL index below
  actorId: ObjectId,
  actorName: String,
  role: String,
  action: { type: String, required: true },
  method: String,
  path: String,
  target: String,
  fields: [String], // which fields the request changed (names only, never values)
  status: Number,
  ip: String,
}, { versionKey: false })
platformAuditSchema.index({ at: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 3600 })
export const PlatformAuditLog = model('PlatformAuditLog', platformAuditSchema, 'platform_audit_logs')
