import { Router } from 'express'
import {
  DEVICE_KINDS, DEVICE_STATUSES, DEVICE_TYPES, DEVICE_USED_FOR, GATEWAY_ORDER_STATUSES, HEALTH_STATUSES, INTEGRATION_LOG_RETENTION_DAYS, INTEGRATION_MODES,
  LOG_DIRECTIONS, LOG_PROVIDERS, LOG_STATUSES, MESSAGE_STATUSES, PUNCH_DIRECTIONS, PUNCH_OUTCOMES,
} from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { idempotent } from '../platform/idempotency.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import { publicBaseUrl } from '../services/integrationsCommon.js'
import { savePaymentsConfig, testPayments } from '../services/feePayments.js'
import { paymentsHub } from '../services/integrationsPayments.js'
import { messagingUrls, messagingView, recentSends, saveMessagingWebhook, templateMap, testMessagingProvider } from '../services/integrationsMessaging.js'
import { logEntry, logsList, providerHealth, retryLog } from '../services/integrationsLogs.js'
import {
  createDevice, deleteDevice, deviceDetail, deviceOptions, gpsUrl, listDevices, listPunches, rotateDeviceKey, testPunch, updateDevice,
} from '../services/devices.js'

// Integrations: /api/v1/integrations. Credentials go in, never come out: every config answer has secrets replaced
// by { set, last4 }. Public pushes (payment webhooks, delivery reports, devices, GPS) are in routes/hooks.js and
// routes/deviceHooks.js, authenticated by signature or key.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('integrations'), idempotent())

const values = (list) => list.map((x) => x.value)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const secret = z.string().max(500).nullable().optional() // '' keeps the saved one, null clears it
const id = (req) => objectId.parse(req.params.id)

const ANY_VIEW = ['integrations.payments.view', 'integrations.messaging.view', 'integrations.devices.view', 'integrations.logs.view']
router.get('/meta', requirePermission(...ANY_VIEW), (req, res) => {
  res.json({ data: {
    modes: INTEGRATION_MODES, health: HEALTH_STATUSES, logStatuses: LOG_STATUSES, logProviders: LOG_PROVIDERS, logDirections: LOG_DIRECTIONS,
    retentionDays: INTEGRATION_LOG_RETENTION_DAYS, deviceTypes: DEVICE_TYPES, deviceKinds: DEVICE_KINDS, deviceUsedFor: DEVICE_USED_FOR,
    deviceStatuses: DEVICE_STATUSES, punchDirections: PUNCH_DIRECTIONS, punchOutcomes: PUNCH_OUTCOMES, baseUrl: publicBaseUrl(req),
  } })
})

// ───────────────────────────────────────────────────────── payment gateway (the school's own Razorpay)
// The same config Fees › Online payments edits (services/feePayments.js); orders and refunds stay on that screen.

const paymentsBody = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(values(INTEGRATION_MODES)).optional(),
  settings: z.object({ keyId: z.string().trim().max(200).optional() }).strict().default({}),
  secrets: z.object({ keySecret: secret, webhookSecret: secret }).strict().default({}),
}).strict()

router.get('/payments', requirePermission('integrations.payments.view'), async (req, res) => {
  res.json({ data: { ...(await paymentsHub(publicBaseUrl(req))), orderStatuses: GATEWAY_ORDER_STATUSES } })
})
router.put('/payments', requirePermission('integrations.payments.configure'), async (req, res) => {
  res.json({ data: await savePaymentsConfig(paymentsBody.parse(req.body), req) })
})
router.post('/payments/test', requirePermission('integrations.payments.configure'), async (req, res) => {
  res.json({ data: await testPayments(req) })
})

// ───────────────────────────────────────────────────────── SMS & WhatsApp
// Provider credentials are the notification engine's (PUT /core/notifications/messaging/:channel, which also
// accepts integrations.messaging.configure). Here: delivery-report webhooks, connection tests, templates, sends.

router.get('/messaging', requirePermission('integrations.messaging.view'), async (req, res) => {
  res.json({ data: await messagingView(publicBaseUrl(req)) })
})
router.post('/messaging/urls', requirePermission('integrations.messaging.configure'), async (req, res) => {
  res.json({ data: await messagingUrls(publicBaseUrl(req)) })
})
router.put('/messaging/webhook', requirePermission('integrations.messaging.configure'), async (req, res) => {
  const body = z.object({ secrets: z.object({ metaAppSecret: secret, metaVerifyToken: secret }).strict() }).strict().parse(req.body)
  res.json({ data: await saveMessagingWebhook(body, req) })
})
router.post('/messaging/test/:channel', requirePermission('integrations.messaging.configure'), async (req, res) => {
  const channel = z.enum(['SMS', 'WHATSAPP']).parse(req.params.channel)
  res.json({ data: await testMessagingProvider(channel, req) })
})
router.get('/messaging/templates', requirePermission('integrations.messaging.view'), async (req, res) => {
  res.json({ data: await templateMap(req.auth.enabledModules) })
})
router.get('/messaging/sends', requirePermission('integrations.messaging.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(MESSAGE_STATUSES)).optional(), channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL']).optional() }).parse(req.query)
  res.json(await recentSends(q, pageParams(req.query)))
})

// ───────────────────────────────────────────────────────── devices

const deviceBody = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  kind: z.enum(DEVICE_KINDS),
  usedFor: z.enum(values(DEVICE_USED_FOR)).optional(),
  serialNo: optionalText(60),
  branchId: objectId.optional().or(z.literal('').transform(() => undefined)),
  location: optionalText(120),
  vehicleId: objectId.optional().or(z.literal('').transform(() => undefined)),
  autoMarkAttendance: z.boolean().optional(),
  active: z.boolean().optional(),
  notes: optionalText(500),
}).strict()

router.get('/devices', requirePermission('integrations.devices.view'), async (req, res) => { res.json({ data: await listDevices() }) })
router.get('/devices/options', requirePermission('integrations.devices.view'), async (req, res) => { res.json({ data: await deviceOptions() }) })
router.get('/devices/punches', requirePermission('integrations.devices.view'), async (req, res) => {
  const q = z.object({
    date: ymd.optional(), deviceId: objectId.optional(), outcome: z.enum(Object.keys(PUNCH_OUTCOMES)).optional(), personType: z.enum(['STAFF', 'STUDENT']).optional(),
  }).parse(req.query)
  res.json(await listPunches(q, pageParams(req.query)))
})
router.post('/devices/gps-url', requirePermission('integrations.devices.create', 'integrations.devices.edit'), async (req, res) => {
  res.json({ data: await gpsUrl(publicBaseUrl(req)) })
})
router.get('/devices/:id', requirePermission('integrations.devices.view'), async (req, res) => { res.json({ data: await deviceDetail(id(req)) }) })
router.post('/devices', requirePermission('integrations.devices.create'), async (req, res) => {
  res.status(201).json({ data: await createDevice(deviceBody.parse(req.body), req.auth, req) })
})
router.patch('/devices/:id', requirePermission('integrations.devices.edit'), async (req, res) => {
  res.json({ data: await updateDevice(id(req), deviceBody.partial().parse(req.body), req.auth, req) })
})
router.post('/devices/:id/rotate-key', requirePermission('integrations.devices.edit'), async (req, res) => {
  res.json({ data: await rotateDeviceKey(id(req), req.auth, req) })
})
router.post('/devices/:id/test', requirePermission('integrations.devices.edit'), async (req, res) => {
  const body = z.object({
    code: optionalText(60), direction: z.enum(values(PUNCH_DIRECTIONS)).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
  }).strict().parse(req.body ?? {})
  res.json({ data: await testPunch(id(req), body, req.auth, req) })
})
router.delete('/devices/:id', requirePermission('integrations.devices.delete'), async (req, res) => {
  res.json({ data: await deleteDevice(id(req), req) })
})

// ───────────────────────────────────────────────────────── logs

router.get('/logs', requirePermission('integrations.logs.view'), async (req, res) => {
  const q = z.object({
    provider: z.enum(values(LOG_PROVIDERS)).optional(), status: z.enum(Object.keys(LOG_STATUSES)).optional(),
    direction: z.enum(values(LOG_DIRECTIONS)).optional(), from: ymd.optional(), to: ymd.optional(),
  }).parse(req.query)
  res.json(await logsList(q, pageParams(req.query)))
})
router.get('/logs/health', requirePermission('integrations.logs.view'), async (req, res) => { res.json({ data: await providerHealth() }) })
router.get('/logs/:id', requirePermission('integrations.logs.view'), async (req, res) => { res.json({ data: await logEntry(req.params.id) }) })
router.post('/logs/:id/retry', requirePermission('integrations.logs.view'), async (req, res) => {
  res.json({ data: await retryLog(id(req), req.auth, req) })
})

export default router
