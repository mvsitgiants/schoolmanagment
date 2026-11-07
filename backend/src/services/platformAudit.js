import { PlatformAuditLog } from '../models/platform.js'
import { logger } from '../platform/logger.js'

// The platform console's own audit log (Superadmin › Audit log). Every request that changes
// something is written when its response finishes — refused ones too — plus platform sign-ins.
// Request bodies are not kept, only which fields were sent.

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

// "METHOD route" (as mounted under /superadmin) → what it did, in words
const ACTIONS = {
  'POST /tenants': 'Created an institution',
  'PATCH /tenants/:id': 'Updated an institution',
  'POST /tenants/:id/change-plan': 'Changed an institution’s plan',
  'POST /tenants/:id/invoices/:invoiceId/pay': 'Recorded a payment',
  'POST /tenants/:id/invoices/:invoiceId/payment-link': 'Sent a payment link',
  'POST /tenants/:id/invoices/:invoiceId/void': 'Voided an invoice',
  'POST /billing/run': 'Ran the billing job',
  'POST /plans': 'Created a plan',
  'PATCH /plans/:code': 'Updated a plan',
  'PATCH /settings': 'Changed platform settings',
  'POST /settings/test-email': 'Sent a test email',
  'POST /coupons': 'Created a coupon',
  'PATCH /coupons/:id': 'Updated a coupon',
  'PATCH /role-templates/:code': 'Updated a role template',
  'POST /staff': 'Added platform staff',
  'PATCH /staff/:id': 'Updated platform staff',
  'POST /staff/:id/reset-password': 'Reset a staff password',
}

/** Write one entry. Never throws: the change itself already happened. */
export function logPlatform({ actor, action, method, path, target, fields, status, ip }) {
  PlatformAuditLog.create({
    actorId: actor?._id, actorName: actor?.name, role: actor?.role || 'OWNER',
    action, method, path: path?.slice(0, 200), target: target ? String(target).slice(0, 120) : undefined, fields, status, ip,
  }).catch((err) => logger.warn({ err, action }, 'platform audit write failed'))
}

/** Router middleware: log each console request that changes something, once it has been answered. */
export function platformAudit(req, res, next) {
  if (SAFE.has(req.method)) return next()
  res.on('finish', () => {
    const route = req.route?.path
    const key = route ? `${req.method} ${route}` : null
    logPlatform({
      actor: req.auth?.user,
      action: (key && ACTIONS[key]) || `${req.method} ${req.path}`,
      method: req.method,
      path: req.originalUrl,
      target: req.params?.invoiceId || req.params?.id || req.params?.code || req.body?.code || req.body?.email || req.body?.institutionName,
      fields: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 30) : undefined,
      status: res.statusCode,
      ip: req.ip,
    })
  })
  next()
}
