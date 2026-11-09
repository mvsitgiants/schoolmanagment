// Integrations (docs/01 §I): provider configs, the integration log, online payments,
// API keys and outbound webhooks. All tenant-scoped.
//
// Secrets are only ever stored encrypted (platform/crypto.js encrypt) or hashed (API and
// device keys — shown once, never recoverable). Public endpoints find their institution by a
// random, non-secret lookup id (`hookKey`, key prefixes) that is unique across tenants.
import mongoose from 'mongoose'
import { INTEGRATION_LOG_RETENTION_DAYS } from '@schoolgiant/shared'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const Mixed = Schema.Types.Mixed

// ───────────────────────────────────────────────────────── provider config

const integrationConfigSchema = new Schema({
  provider: { type: String, required: true }, // INTEGRATION_PROVIDERS id
  enabled: { type: Boolean, default: false },
  mode: { type: String, default: 'SANDBOX' }, // SANDBOX · LIVE
  settings: { type: Mixed, default: {} }, // plain fields (key id, HIP id…)
  secrets: { type: Mixed, default: {} }, // key → { v: encrypted, last4 }
  hookKey: String, // public id in this institution's inbound webhook URLs
  health: {
    status: { type: String, default: 'UNKNOWN' }, // HEALTH_STATUSES
    checkedAt: Date,
    message: String,
    latencyMs: Number,
  },
  // what a provider's background job keeps between runs (the PACS change cursor, last sync…);
  // never sent to the screen as it is
  state: { type: Mixed, default: undefined },
  updatedBy: String,
}, { timestamps: true, minimize: false })
integrationConfigSchema.plugin(tenantPlugin)
integrationConfigSchema.index({ tenantId: 1, provider: 1 }, { unique: true })
integrationConfigSchema.index({ hookKey: 1 }, { unique: true, partialFilterExpression: { hookKey: { $type: 'string' } } })

export const IntegrationConfig = model('IntegrationConfig', integrationConfigSchema, 'integration_configs')

// ───────────────────────────────────────────────────────── log

/** One call to or from a provider. Summaries are redacted: no secrets, OTPs or personal details. */
const integrationLogSchema = new Schema({
  provider: { type: String, required: true },
  direction: { type: String, required: true }, // IN · OUT
  operation: { type: String, required: true },
  status: { type: String, required: true }, // LOG_STATUSES
  httpStatus: Number,
  latencyMs: Number,
  attempts: Number,
  requestId: String,
  ref: String, // provider reference (order id, message id…)
  entityType: String,
  entityId: String,
  summary: Mixed, // redacted request / response outline
  error: String,
}, { timestamps: true })
integrationLogSchema.plugin(tenantPlugin)
integrationLogSchema.index({ tenantId: 1, createdAt: -1 })
integrationLogSchema.index({ tenantId: 1, provider: 1, createdAt: -1 })
integrationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: INTEGRATION_LOG_RETENTION_DAYS * 24 * 3600 })

export const IntegrationLog = model('IntegrationLog', integrationLogSchema, 'integration_logs')

/** Inbound webhook ids already handled — a provider's retry of the same event is a no-op. */
const inboundEventSchema = new Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  type: String,
}, { timestamps: true })
inboundEventSchema.plugin(tenantPlugin)
inboundEventSchema.index({ tenantId: 1, provider: 1, eventId: 1 }, { unique: true })
inboundEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 45 * 24 * 3600 })

export const InboundEvent = model('InboundEvent', inboundEventSchema, 'integration_inbound_events')

// ───────────────────────────────────────────────────────── API keys & webhooks

const apiKeySchema = new Schema({
  name: { type: String, required: true, trim: true },
  prefix: { type: String, required: true }, // public half (lookup)
  keyHash: { type: String, required: true },
  last4: String,
  scopes: [String], // permission keys
  /** Websites whose pages may call with this key from the browser (https://example.com); none = server-side only. */
  allowedOrigins: { type: [String], default: undefined },
  expiresAt: Date,
  revokedAt: Date,
  revokedBy: String,
  lastUsedAt: Date,
  lastUsedIp: String,
  createdBy: String,
  createdById: ObjectId,
}, { timestamps: true })
apiKeySchema.plugin(tenantPlugin)
apiKeySchema.index({ prefix: 1 }, { unique: true })

export const ApiKey = model('ApiKey', apiKeySchema, 'api_keys')

const webhookEndpointSchema = new Schema({
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true },
  mode: { type: String, default: 'LIVE' }, // SANDBOX allows http://
  events: [String],
  secret: String, // encrypted HMAC signing secret
  secretLast4: String,
  active: { type: Boolean, default: true },
  failures: { type: Number, default: 0 }, // consecutive failed deliveries
  lastDeliveryAt: Date,
  lastStatus: String,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true })
webhookEndpointSchema.plugin(tenantPlugin)

export const WebhookEndpoint = model('WebhookEndpoint', webhookEndpointSchema, 'webhook_endpoints')

const webhookDeliverySchema = new Schema({
  endpointId: { type: ObjectId, required: true },
  endpointName: String,
  event: { type: String, required: true },
  deliveryId: { type: String, required: true }, // sent as X-Webhook-Id: receivers de-duplicate on it
  payload: Mixed,
  status: { type: String, default: 'PENDING' }, // WEBHOOK_DELIVERY_STATUSES
  attempts: { type: Number, default: 0 },
  nextAttemptAt: Date,
  responseStatus: Number,
  responseBody: String, // first 300 characters
  error: String,
  latencyMs: Number,
  test: { type: Boolean, default: false },
}, { timestamps: true })
webhookDeliverySchema.plugin(tenantPlugin)
webhookDeliverySchema.index({ tenantId: 1, endpointId: 1, createdAt: -1 })
webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 })
webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 })

export const WebhookDelivery = model('WebhookDelivery', webhookDeliverySchema, 'webhook_deliveries')

// ───────────────────────────────────────────────────────── online fee payments

/**
 * One try at paying fees online through the school's own gateway: a Checkout order (the parent app) or a payment
 * link (sent from the fee counter). Made for what the student owed then; a captured payment becomes ONE fee receipt.
 */
const gatewayOrderSchema = new Schema({
  provider: { type: String, required: true },
  kind: { type: String, required: true }, // ORDER · LINK
  source: { type: String, required: true }, // GATEWAY_ORDER_SOURCES: COUNTER · APP
  mode: String, // SANDBOX · LIVE when it was made
  studentId: { type: Schema.Types.ObjectId, required: true },
  studentName: String,
  admissionNo: String,
  branchId: Schema.Types.ObjectId,
  amount: { type: Number, required: true }, // paise
  currency: { type: String, default: 'INR' },
  providerOrderId: { type: String, required: true }, // order_… / plink_…
  providerPaymentId: String, // pay_…
  shortUrl: String,
  method: String, // upi · card · netbanking …
  status: { type: String, default: 'CREATED' }, // GATEWAY_ORDER_STATUSES
  paidAt: Date,
  appliedAt: Date,
  receiptNos: [String],
  error: String,
  refunds: [{ refundId: String, amount: Number, status: String, reason: String, by: String, at: Date }],
  refundingUntil: Date,
  expiresAt: Date,
  createdBy: String,
}, { timestamps: true })
gatewayOrderSchema.plugin(tenantPlugin)
gatewayOrderSchema.index({ tenantId: 1, provider: 1, providerOrderId: 1 }, { unique: true })
gatewayOrderSchema.index({ tenantId: 1, provider: 1, providerPaymentId: 1 }, { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string' } } })
gatewayOrderSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 })
gatewayOrderSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
export const GatewayOrder = model('GatewayOrder', gatewayOrderSchema, 'gateway_orders')

// ───────────────────────────────────────────────────────── devices (Integrations › Devices)

/**
 * A biometric / RFID / face / GPS device that pushes to POST /api/v1/hooks/devices/:key. The key is shown once and kept
 * only as a sha-256 hash; `keyPrefix` (its public half) finds the row across institutions.
 */
const deviceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  kind: { type: String, required: true }, // DEVICE_KINDS
  usedFor: { type: String, default: 'STAFF' }, // DEVICE_USED_FOR (GPS: n/a)
  serialNo: String,
  branchId: ObjectId,
  location: String,
  vehicleId: ObjectId, // GPS: the bus it rides on
  /** Students: a first IN at the gate before the "mark by" time marks the child present in today's register. */
  autoMarkAttendance: { type: Boolean, default: false },
  keyPrefix: { type: String, required: true },
  keyHash: { type: String, required: true },
  keyLast4: String,
  keyIssuedAt: Date,
  active: { type: Boolean, default: true },
  lastSeenAt: Date,
  lastIp: String,
  lastError: { at: Date, message: String },
  counts: { received: { type: Number, default: 0 }, accepted: { type: Number, default: 0 }, rejected: { type: Number, default: 0 } },
  notes: String,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true })
deviceSchema.plugin(tenantPlugin)
deviceSchema.index({ keyPrefix: 1 }, { unique: true })
deviceSchema.index({ tenantId: 1, name: 1 }, { unique: true })
export const Device = model('Device', deviceSchema, 'integration_devices')

/** One punch from a device: a staff member at the biometric, a student's card at the gate or on the bus. */
const devicePunchSchema = new Schema({
  deviceId: { type: ObjectId, required: true },
  deviceName: String,
  kind: String,
  usedFor: String,
  branchId: ObjectId,
  code: { type: String, required: true }, // employee code · card code · admission no
  at: { type: Date, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD, institution's clock
  time: String, // HH:MM
  direction: String, // IN · OUT · (none)
  personType: String, // STAFF · STUDENT
  personId: ObjectId,
  personName: String,
  outcome: { type: String, required: true }, // PUNCH_OUTCOMES
  note: String,
  test: { type: Boolean, default: false },
}, { timestamps: true })
devicePunchSchema.plugin(tenantPlugin)
// a device re-sending the same punch adds nothing
devicePunchSchema.index({ tenantId: 1, deviceId: 1, code: 1, at: 1 }, { unique: true })
devicePunchSchema.index({ tenantId: 1, date: 1, at: -1 })
devicePunchSchema.index({ tenantId: 1, personId: 1, date: 1 })
devicePunchSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 3600 })
export const DevicePunch = model('DevicePunch', devicePunchSchema, 'device_punches')
