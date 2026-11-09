// Integrations: payment gateway, SMS / WhatsApp / email delivery, devices (biometric, RFID,
// GPS), API keys and outbound webhooks. Product defaults only — what an institution switches
// on, and its credentials, live in its IntegrationConfig.

import { MODULES } from './catalog.js'

export const INTEGRATION_MODES = [
  { value: 'SANDBOX', label: 'Sandbox / test' },
  { value: 'LIVE', label: 'Live' },
]

export const HEALTH_STATUSES = {
  UNKNOWN: { label: 'Not checked', tone: 'neutral' },
  OK: { label: 'Connected', tone: 'success' },
  DEGRADED: { label: 'Errors lately', tone: 'warning' },
  DOWN: { label: 'Not connecting', tone: 'danger' },
}

/**
 * Providers with an IntegrationConfig. `secrets` are stored encrypted and never sent to the
 * browser (the screen sees "set" and the last 4); `fields` are plain settings.
 */
export const INTEGRATION_PROVIDERS = [
  {
    id: 'RAZORPAY', kind: 'PAYMENTS', label: 'Razorpay', available: true,
    desc: 'Cards, UPI, net banking and wallets. Fee payment links and checkout in the parent app.',
    fields: [{ key: 'keyId', label: 'Key id', placeholder: 'rzp_test_…' }],
    secrets: [{ key: 'keySecret', label: 'Key secret' }, { key: 'webhookSecret', label: 'Webhook secret', hint: 'The secret you typed when adding the webhook in the Razorpay dashboard.' }],
  },
  { id: 'PAYU', kind: 'PAYMENTS', label: 'PayU', available: false, desc: 'Coming later.', fields: [], secrets: [] },
  {
    id: 'ANTHROPIC', kind: 'AI', label: 'Anthropic (Claude)', available: true,
    desc: 'The institution’s own Claude API key for the AI assistant, question papers and remarks. Without one, the platform’s key is used (when set).',
    fields: [], secrets: [{ key: 'apiKey', label: 'API key', hint: 'From console.anthropic.com › API keys.' }],
  },
  { id: 'CASHFREE', kind: 'PAYMENTS', label: 'Cashfree', available: false, desc: 'Coming later.', fields: [], secrets: [] },
  {
    id: 'GPS', kind: 'DEVICES', label: 'Bus GPS devices', available: true,
    desc: 'GPS trackers on the buses post their position here (generic JSON, or the OsmAnd / Traccar protocol most trackers speak).',
    fields: [], secrets: [],
  },
  {
    id: 'MESSAGING', kind: 'MESSAGING', label: 'Delivery reports', available: true,
    desc: 'Receives delivery and read receipts from the SMS and WhatsApp providers.',
    fields: [],
    secrets: [
      { key: 'metaAppSecret', label: 'Meta app secret', hint: 'Signs WhatsApp webhooks (X-Hub-Signature-256).' },
      { key: 'metaVerifyToken', label: 'Meta webhook verify token', hint: 'Any long random text; type the same in the Meta app’s webhook setup.' },
    ],
  },
]

export const INTEGRATION_PROVIDER_BY = Object.fromEntries(INTEGRATION_PROVIDERS.map((p) => [p.id, p]))
export const PAYMENT_PROVIDERS = INTEGRATION_PROVIDERS.filter((p) => p.kind === 'PAYMENTS')

// ───────────────────────────────────────────────────────── integration log

export const LOG_DIRECTIONS = [
  { value: 'OUT', label: 'Outgoing' },
  { value: 'IN', label: 'Incoming' },
]
export const LOG_STATUSES = {
  OK: { label: 'OK', tone: 'success' },
  ERROR: { label: 'Error', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'warning' },
  DUPLICATE: { label: 'Duplicate', tone: 'neutral' },
}
/** Every provider / source a log row can name. */
export const LOG_PROVIDERS = [
  { value: 'RAZORPAY', label: 'Razorpay' },
  { value: 'GPS', label: 'Bus GPS' },
  { value: 'MSG91', label: 'MSG91' },
  { value: 'WHATSAPP', label: 'WhatsApp Cloud API' },
  { value: 'DEVICE', label: 'Devices' },
  { value: 'WEBHOOK', label: 'Outbound webhooks' },
]
/** Integration log rows are deleted after this many days. */
export const INTEGRATION_LOG_RETENTION_DAYS = 90

// ───────────────────────────────────────────────────────── devices

/** Hardware that sends data in: staff and student attendance, gate access, bus location. */
export const DEVICE_TYPES = [
  { value: 'BIOMETRIC', label: 'Biometric attendance device' },
  { value: 'RFID', label: 'RFID card reader / gate' },
  { value: 'FACE', label: 'Face recognition camera' },
  { value: 'GPS', label: 'Bus GPS tracker' },
]
export const DEVICE_TYPE_LABEL = Object.fromEntries(DEVICE_TYPES.map((d) => [d.value, d.label]))

export const API_KEY_PREFIX = 'sg_'
export const DEVICE_KEY_PREFIX = 'sgd_'

/** Pages an API key may never be granted (it must not manage people, roles, keys or billing of the workspace). */
const API_KEY_BLOCKED_PAGES = new Set(['core.users', 'core.roles', 'core.api-keys', 'core.subscription', 'core.modules', 'core.audit', 'integrations.payments', 'integrations.messaging'])

/** Administration: an API key may only read the org structure, never change settings. */
const API_KEY_CORE_PAGES = new Set(['branches', 'departments', 'masters'])
const API_KEY_CORE_ACTIONS = new Set(['view', 'export'])

const allowedAction = (m, p, a) => !a.sensitive && !API_KEY_BLOCKED_PAGES.has(`${m}.${p}`)
  && (m !== 'core' || (API_KEY_CORE_PAGES.has(p) && API_KEY_CORE_ACTIONS.has(a.id)))

/** Permission keys an API key can carry, grouped by module, for the scope picker. */
export function apiKeyScopeOptions(enabledModuleIds) {
  const on = enabledModuleIds ? new Set(enabledModuleIds) : null
  return MODULES.filter((m) => !on || on.has(m.id) || m.mandatory).map((m) => ({
    module: m.id, name: m.name,
    pages: m.pages.map((p) => ({
      page: p.id, name: p.name,
      actions: p.actions.filter((a) => allowedAction(m.id, p.id, a)).map((a) => ({ key: `${m.id}.${p.id}.${a.id}`, label: a.label })),
    })).filter((p) => p.actions.length),
  })).filter((m) => m.pages.length)
}

/** Can an API key carry this permission key? (sensitive actions and admin pages: never) */
export function isApiKeyScope(key) {
  const [m, p, a] = String(key).split('.')
  const action = MODULES.find((x) => x.id === m)?.pages.find((x) => x.id === p)?.actions.find((x) => x.id === a)
  return !!action && allowedAction(m, p, action)
}

// ───────────────────────────────────────────────────────── outbound webhooks

/** Domain events a webhook can subscribe to (the names modules emit; one-time codes never leave). */
export const WEBHOOK_EVENTS = [
  { event: 'students.admitted', module: 'students', label: 'Student admitted' },
  { event: 'students.left', module: 'students', label: 'Student left / TC issued' },
  { event: 'attendance.absent', module: 'attendance', label: 'Student marked absent' },
  { event: 'exams.results_published', module: 'exams', label: 'Results published' },
  { event: 'fees.receipt', module: 'fees', label: 'Fee received' },
  { event: 'fees.refund', module: 'fees', label: 'Fee refunded' },
  { event: 'admissions.application_submitted', module: 'admissions', label: 'Application submitted' },
  { event: 'hrms.employee_onboarded', module: 'hrms', label: 'Employee joined' },
  { event: 'hrms.employee_terminated', module: 'hrms', label: 'Employee exited' },
  { event: 'payroll.paid', module: 'payroll', label: 'Payroll paid' },
  { event: 'integrations.payment_captured', module: 'integrations', label: 'Online payment captured' },
]
export const WEBHOOK_EVENT_BY = Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e.event, e]))

export const WEBHOOK_DELIVERY_STATUSES = {
  PENDING: { label: 'Pending', tone: 'info' },
  RETRYING: { label: 'Retrying', tone: 'warning' },
  SUCCESS: { label: 'Delivered', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
}
/** Minutes before each retry of a failed delivery. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 720]

/** Who a device's punches are for: staff attendance (HR) or the student gate log. */
export const DEVICE_USED_FOR = [
  { value: 'STAFF', label: 'Staff attendance' },
  { value: 'STUDENTS', label: 'Students (gate / bus)' },
]
/** Kinds a device can be registered as here (bus GPS trackers can also be set on the vehicle in Transport). */
export const DEVICE_KINDS = ['BIOMETRIC', 'RFID', 'FACE', 'GPS']
/** A device's state, worked out from when it last called in. */
export const DEVICE_STATUSES = {
  OK: { label: 'Online', tone: 'success' },
  IDLE: { label: 'Quiet', tone: 'warning' },
  ERROR: { label: 'Errors', tone: 'danger' },
  NEVER: { label: 'Never connected', tone: 'neutral' },
  DISABLED: { label: 'Switched off', tone: 'neutral' },
}
/** No call for this many hours → IDLE. */
export const DEVICE_IDLE_HOURS = 24
export const PUNCH_DIRECTIONS = [
  { value: 'IN', label: 'In' },
  { value: 'OUT', label: 'Out' },
]
/** What one punch did. */
export const PUNCH_OUTCOMES = {
  ATTENDANCE: { label: 'Staff attendance', tone: 'success' },
  GATE: { label: 'Gate log', tone: 'info' },
  MARKED_PRESENT: { label: 'Marked present', tone: 'success' },
  POSITION: { label: 'Bus position', tone: 'info' },
  UNKNOWN: { label: 'Unknown code', tone: 'warning' },
  SKIPPED: { label: 'Not saved', tone: 'warning' },
  DUPLICATE: { label: 'Already received', tone: 'neutral' },
  TEST: { label: 'Test', tone: 'violet' },
}
/** Punches (or positions) one push may carry. */
export const DEVICE_PUSH_MAX = 500
