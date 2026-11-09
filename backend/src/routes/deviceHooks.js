import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { contextMiddleware } from '../platform/context.js'
import { asDevice, receive } from '../services/devices.js'
import { handleMsg91Report, handleWhatsAppWebhook, verifyWhatsAppSubscription } from '../services/integrationsMessaging.js'

// Integrations' public pushes, next to routes/hooks.js under /api/v1/hooks (mounted BEFORE express.json() in
// app.js: the WhatsApp signature is computed over the exact bytes sent).
//
//   POST /devices/:key       biometric / RFID / face punches, or GPS positions — the device key (sgd_…, shown once
//                            when the device is registered, kept as a hash) is the credential
//   POST /msg91/:hookKey     MSG91 SMS delivery reports
//   GET  /whatsapp/:hookKey  Meta's webhook subscription check (hub.challenge)
//   POST /whatsapp/:hookKey  WhatsApp Cloud API status updates, signed with the Meta app secret
const router = Router()

const limit = (max, message) => rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : max, standardHeaders: true, legacyHeaders: false, message: { message } })
const hookLimiter = limit(600, 'Too many webhook calls.')
const deviceLimiter = limit(240, 'Too many device calls. Send punches in batches.')

router.use(contextMiddleware)
router.use(express.raw({ type: () => true, limit: '2mb' }))

const raw = (req) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
const send = (res, [status, body]) => (typeof body === 'string' ? res.status(status).type('text/plain').send(body) : res.status(status).json(body))

/** A form-encoded or JSON body as an object (MSG91 posts either). */
function parsed(req) {
  const text = raw(req).toString('utf8')
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { /* form */ }
  return Object.fromEntries(new URLSearchParams(text))
}

// ── devices
router.post('/devices/:key', deviceLimiter, async (req, res) => {
  const out = await asDevice(req.params.key, req.ip, (device, auth) => receive(device, auth, raw(req)))
  res.json({ data: { received: out.received, accepted: out.accepted, duplicates: out.duplicates ?? 0, rejected: out.rejected, errors: out.errors } })
})

// ── SMS / WhatsApp delivery reports
router.post('/msg91/:hookKey', hookLimiter, async (req, res) => {
  send(res, await handleMsg91Report(req.params.hookKey, parsed(req)))
})
router.get('/whatsapp/:hookKey', hookLimiter, async (req, res) => {
  send(res, await verifyWhatsAppSubscription(req.params.hookKey, req.query))
})
router.post('/whatsapp/:hookKey', hookLimiter, async (req, res) => {
  send(res, await handleWhatsAppWebhook(req.params.hookKey, raw(req), req.headers))
})

export default router
