import { Router } from 'express'
import { INTEGRATION_MODES, WEBHOOK_EVENTS } from '@schoolgiant/shared'
import { requirePermission } from '../../platform/middleware.js'
import { pageParams, z } from '../../platform/validate.js'
import {
  apiKeysMeta, createApiKey, createWebhook, deleteWebhook, listApiKeys, listDeliveries, listWebhooks, redeliver, revokeApiKey, rotateWebhookSecret,
  testWebhook, updateApiKey, updateWebhook,
} from '../../services/apiKeys.js'

// Administration › API keys & webhooks: /api/v1/core/api-keys, /api/v1/core/webhooks.
// Secrets (the API key, a webhook's signing secret) are in the response of the call that
// makes them — and nowhere else, ever.
const router = Router()

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const keyBody = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  scopes: z.array(z.string().max(120)).max(500),
  expiresOn: ymd.nullable().optional(),
  allowedOrigins: z.array(z.string().max(200)).max(20).optional(), // websites that may call from the browser
}).strict()
const hookBody = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  url: z.string().trim().max(500),
  mode: z.enum(INTEGRATION_MODES.map((m) => m.value)).default('LIVE'),
  events: z.array(z.enum(WEBHOOK_EVENTS.map((e) => e.event))).max(WEBHOOK_EVENTS.length),
  active: z.boolean().optional(),
}).strict()

router.get('/api-keys/meta', requirePermission('core.api-keys.view'), async (req, res) => { res.json({ data: await apiKeysMeta(req.auth) }) })
router.get('/api-keys', requirePermission('core.api-keys.view'), async (req, res) => { res.json({ data: await listApiKeys() }) })
router.post('/api-keys', requirePermission('core.api-keys.create'), async (req, res) => {
  res.status(201).json({ data: await createApiKey(keyBody.parse(req.body), req.auth, req) })
})
router.patch('/api-keys/:id', requirePermission('core.api-keys.edit'), async (req, res) => {
  res.json({ data: await updateApiKey(req.params.id, keyBody.partial().parse(req.body), req.auth, req) })
})
router.delete('/api-keys/:id', requirePermission('core.api-keys.delete'), async (req, res) => {
  res.json({ data: await revokeApiKey(req.params.id, req.auth, req) })
})

router.get('/webhooks', requirePermission('core.api-keys.view'), async (req, res) => { res.json({ data: await listWebhooks() }) })
router.post('/webhooks', requirePermission('core.api-keys.create'), async (req, res) => {
  res.status(201).json({ data: await createWebhook(hookBody.parse(req.body), req.auth, req) })
})
router.patch('/webhooks/:id', requirePermission('core.api-keys.edit'), async (req, res) => {
  res.json({ data: await updateWebhook(req.params.id, hookBody.partial().parse(req.body), req.auth, req) })
})
router.delete('/webhooks/:id', requirePermission('core.api-keys.delete'), async (req, res) => {
  res.json({ data: await deleteWebhook(req.params.id, req) })
})
router.post('/webhooks/:id/rotate-secret', requirePermission('core.api-keys.edit'), async (req, res) => {
  res.json({ data: await rotateWebhookSecret(req.params.id, req.auth, req) })
})
router.post('/webhooks/:id/test', requirePermission('core.api-keys.edit'), async (req, res) => {
  res.json({ data: await testWebhook(req.params.id, req) })
})
router.get('/webhooks/:id/deliveries', requirePermission('core.api-keys.view'), async (req, res) => {
  res.json(await listDeliveries(req.params.id, pageParams(req.query)))
})
router.get('/webhook-deliveries', requirePermission('core.api-keys.view'), async (req, res) => {
  res.json(await listDeliveries(null, pageParams(req.query)))
})
router.post('/webhook-deliveries/:id/redeliver', requirePermission('core.api-keys.edit'), async (req, res) => {
  res.json({ data: await redeliver(req.params.id, req) })
})

export default router
