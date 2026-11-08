import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { contextMiddleware } from '../platform/context.js'
import { handlePlatformWebhook } from '../services/platformPayments.js'
import { handleRazorpayWebhook } from '../services/feePayments.js'

// Inbound integrations: /api/v1/hooks — public (no sign-in), so each call proves itself with the
// provider's signature, checked on the raw body. Mounted BEFORE express.json() in app.js:
// signatures are computed over the exact bytes sent.
//
// Institution-level hooks (fee payments on the school's own Razorpay account, SMS / WhatsApp
// delivery reports, biometric and RFID devices, bus GPS) are added here with the Integrations module.
const router = Router()

const hookLimiter = rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 600, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many webhook calls.' } })

router.use(contextMiddleware)
router.use(express.raw({ type: () => true, limit: '2mb' }))

const send = (res, [status, body]) => (typeof body === 'string' ? res.status(status).type('text/plain').send(body) : res.status(status).json(body))

// ── payments
// the platform's own account (institutions paying subscription invoices), set in Superadmin › Settings
router.post('/platform/razorpay', hookLimiter, async (req, res) => {
  send(res, await handlePlatformWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers))
})
// the school's own account: fee payments from the parent app and payment links (Fees › Online payments)
router.post('/razorpay/:hookKey', hookLimiter, async (req, res) => {
  send(res, await handleRazorpayWebhook(req.params.hookKey, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers))
})

export default router
