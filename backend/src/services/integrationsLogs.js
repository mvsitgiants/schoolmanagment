import { HEALTH_STATUSES, LOG_PROVIDERS } from '@schoolgiant/shared'
import { IntegrationConfig, IntegrationLog, WebhookDelivery } from '../models/integrations.js'
import { can } from '../platform/access.js'
import { forbidden, conflict, notFound } from '../platform/errors.js'
import { institutionNow, timeZoneOf, zonedDate } from '../platform/time.js'
import { isOid } from '../platform/db.js'
import { redeliver } from './apiKeys.js'
import { testPayments } from './feePayments.js'
import { listLogs, logDetail } from './integrationsCommon.js'
import { testMessagingProvider } from './integrationsMessaging.js'

// Integrations › Integration logs: every call to and from a provider, device or webhook (IntegrationLog, written by
// integrationsCommon callProvider / logInbound), health per provider, and "try again" for the failed outgoing calls
// that are safe to repeat. The log keeps only a redacted outline — never the request itself — so a call is repeated
// by doing the same thing again, not by replaying the row:
//   · a connection test (Razorpay, MSG91, WhatsApp)  → the test runs again;
//   · an outbound webhook delivery                   → the delivery is queued again (it carries the same X-Webhook-Id,
//                                                      so the receiver de-duplicates).
// Payments, refunds and messages are never repeated from here (not idempotent, or retried by their own screens).

/** Config ids whose health is kept, by log provider. */
const HEALTH_OF = { RAZORPAY: 'RAZORPAY', GPS: 'GPS', MSG91: 'MESSAGING', WHATSAPP: 'MESSAGING' }
const CHANNEL_OF = { MSG91: 'SMS', WHATSAPP: 'WHATSAPP' }

function retryKind(row) {
  if (row.direction !== 'OUT' || row.status !== 'ERROR') return null
  if (row.provider === 'WEBHOOK' && row.requestId) return 'REDELIVER'
  if (row.operation === 'test_connection' && ['RAZORPAY', 'MSG91', 'WHATSAPP'].includes(row.provider)) return 'TEST'
  return null
}

export async function logsList(q, paging) {
  const res = await listLogs(q, paging)
  res.data = res.data.map((r) => ({ ...r, retry: retryKind(r) }))
  return res
}

export async function logEntry(id) {
  if (!isOid(id)) throw notFound('Log entry')
  const row = await logDetail(id)
  return { ...row, retry: retryKind(row) }
}

/** Today (institution's clock) per provider: calls, failures, the last error, and the provider's health check. */
export async function providerHealth() {
  const [now, tz] = await Promise.all([institutionNow(), timeZoneOf()])
  const since = zonedDate(now.date, '00:00', tz)
  const [day, lastErrors, configs] = await Promise.all([
    IntegrationLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$provider', calls: { $sum: 1 }, failures: { $sum: { $cond: [{ $in: ['$status', ['ERROR', 'REJECTED']] }, 1, 0] } }, lastAt: { $max: '$createdAt' }, latency: { $avg: '$latencyMs' } } },
    ]),
    IntegrationLog.aggregate([
      { $match: { status: { $in: ['ERROR', 'REJECTED'] }, createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$provider', at: { $first: '$createdAt' }, error: { $first: '$error' }, operation: { $first: '$operation' }, id: { $first: '$_id' } } },
    ]),
    IntegrationConfig.find({ provider: { $in: [...new Set(Object.values(HEALTH_OF))] } }).select('provider enabled health').lean(),
  ])
  const d = new Map(day.map((x) => [x._id, x]))
  const e = new Map(lastErrors.map((x) => [x._id, x]))
  const c = new Map(configs.map((x) => [x.provider, x]))
  return {
    since: now.date,
    providers: LOG_PROVIDERS.map((p) => {
      const cfg = c.get(HEALTH_OF[p.value])
      const today = d.get(p.value)
      const err = e.get(p.value)
      const health = cfg?.health?.status ?? null
      return {
        provider: p.value, label: p.label, calls: today?.calls ?? 0, failures: today?.failures ?? 0, lastAt: today?.lastAt ?? null,
        avgLatencyMs: today?.latency ? Math.round(today.latency) : null,
        lastError: err ? { at: err.at, message: err.error ?? null, operation: err.operation, id: String(err.id) } : null,
        health: health ? { status: health, label: HEALTH_STATUSES[health]?.label, checkedAt: cfg.health.checkedAt ?? null, message: cfg.health.message ?? null } : null,
      }
    }),
  }
}

/** Try a failed outgoing call again — only those that are safe to repeat (see the note at the top). */
export async function retryLog(id, auth, req) {
  const row = await logEntry(id)
  if (!row.retry) throw conflict('This call can’t be repeated from here.')
  if (row.retry === 'REDELIVER') {
    if (!can(auth, 'core.api-keys.edit') && !can(auth, 'core.api-keys.create')) throw forbidden('Your role can’t resend webhooks (API keys & webhooks).')
    const delivery = await WebhookDelivery.findOne({ deliveryId: row.requestId }).select('_id status').lean()
    if (!delivery) throw conflict('That delivery is no longer kept (30 days).')
    if (delivery.status === 'SUCCESS') throw conflict('That delivery has gone through since.')
    const d = await redeliver(String(delivery._id), req)
    return { ok: true, kind: 'REDELIVER', status: d.status }
  }
  if (row.provider === 'RAZORPAY') {
    if (!can(auth, 'integrations.payments.configure') && !can(auth, 'fees.online.configure')) throw forbidden('Your role can’t test the payment gateway.')
    return { kind: 'TEST', ...(await testPayments(req)) }
  }
  if (!can(auth, 'integrations.messaging.configure')) throw forbidden('Your role can’t test the messaging providers.')
  return { kind: 'TEST', ...(await testMessagingProvider(CHANNEL_OF[row.provider], req)) }
}
