import { Router } from 'express'
import { GATEWAY_ORDER_STATUSES, INTEGRATION_MODES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { idempotent } from '../platform/idempotency.js'
import { objectId, pageParams, z } from '../platform/validate.js'
import { publicBaseUrl } from '../services/integrationsCommon.js'
import {
  cancelGatewayLink, createPaymentLink, listGatewayOrders, onlinePaymentsOn, paymentsView, refundGatewayOrder, savePaymentsConfig, studentGatewayOrders,
  syncGatewayOrder, testPayments,
} from '../services/feePayments.js'

// Online fee payment on the school's own Razorpay account: /api/v1/fees/online/*  (the webhook is /api/v1/hooks/razorpay/:hookKey)
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('fees'), idempotent()) // repeated money writes replay, not redo

const secret = z.string().max(500).nullable().optional() // '' keeps the saved one, null clears it
const configBody = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(INTEGRATION_MODES.map((m) => m.value)).optional(),
  settings: z.object({ keyId: z.string().trim().max(200).optional() }).strict().default({}),
  secrets: z.object({ keySecret: secret, webhookSecret: secret }).strict().default({}),
}).strict()
const id = (req) => objectId.parse(req.params.id)

/** For the counter and the app: is online payment on? */
router.get('/status', requirePermission('fees.collect.view', 'fees.online.view'), async (req, res) => {
  res.json({ data: { on: await onlinePaymentsOn(req.auth.enabledModules) } })
})
router.get('/config', requirePermission('fees.online.view'), async (req, res) => {
  res.json({ data: await paymentsView(publicBaseUrl(req)) })
})
router.put('/config', requirePermission('fees.online.configure'), async (req, res) => {
  res.json({ data: await savePaymentsConfig(configBody.parse(req.body), req) })
})
router.post('/config/test', requirePermission('fees.online.configure'), async (req, res) => {
  res.json({ data: await testPayments(req) })
})

router.get('/orders', requirePermission('fees.online.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(GATEWAY_ORDER_STATUSES)).optional(), source: z.enum(['COUNTER', 'APP']).optional() }).parse(req.query)
  res.json(await listGatewayOrders(q, pageParams(req.query)))
})
router.post('/orders/:id/sync', requirePermission('fees.online.view'), async (req, res) => {
  res.json({ data: await syncGatewayOrder(id(req), req) })
})
router.post('/orders/:id/cancel', requirePermission('fees.online.configure', 'fees.collect.create'), async (req, res) => {
  res.json({ data: await cancelGatewayLink(id(req), req) })
})
router.post('/orders/:id/refund', requirePermission('fees.online.refund'), async (req, res) => {
  const input = z.object({ amount: z.coerce.number().int().min(100).optional(), reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.json({ data: await refundGatewayOrder(id(req), input, req) })
})

router.get('/students/:id', requirePermission('fees.collect.view'), async (req, res) => {
  res.json({ data: await studentGatewayOrders(id(req)) })
})
router.post('/students/:id/link', requirePermission('fees.collect.create'), async (req, res) => {
  const input = z.object({ notify: z.boolean().optional(), expiryHours: z.coerce.number().int().min(1).max(720).optional() }).parse(req.body ?? {})
  res.status(201).json({ data: await createPaymentLink(id(req), input, req.auth, req) })
})

export default router
