import { createHmac } from 'node:crypto'
import { MESSAGE_PROVIDERS } from '@schoolgiant/shared'
import { MessageLog } from '../models/engines.js'
import { audit } from '../platform/audit.js'
import { decrypt } from '../platform/crypto.js'
import { conflict } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { asHookOwner, callProvider, getConfig, hookUrl, logInbound, maskConfig, safeEqual, saveConfig, secretOf } from './integrationsCommon.js'
import { listMessages, listRules, messagingConfig } from './notify.js'

// Integrations › SMS & WhatsApp. Sending is the notification engine's job (services/notify.js + messaging.js, one
// MessagingConfig per institution — the page edits that same config through /core/notifications/messaging, which
// accepts integrations.messaging.*). What lives here: the provider connection test, the delivery-report webhooks
// that say a message was delivered, read or dropped, and the recent sends with what the provider reported.
//
// Webhook URLs carry the institution's random hook key (IntegrationConfig MESSAGING). WhatsApp webhooks are also
// signed (X-Hub-Signature-256 with the Meta app secret). Ported from the hospital product.

const CFG = 'MESSAGING'

export async function messagingView(baseUrl) {
  const [cfg, msgCfg] = await Promise.all([getConfig(CFG), messagingConfig()])
  const since = new Date(Date.now() - 7 * 86_400_000)
  const delivery = await MessageLog.aggregate([
    { $match: { createdAt: { $gte: since }, status: { $in: ['SENT', 'FAILED'] } } },
    { $group: { _id: { channel: '$channel', status: { $ifNull: ['$delivery.status', '$status'] } }, n: { $sum: 1 } } },
  ])
  return {
    webhook: maskConfig(cfg),
    providers: { SMS: msgCfg?.sms?.provider ?? 'NONE', WHATSAPP: msgCfg?.whatsapp?.provider ?? 'NONE', EMAIL: msgCfg?.email?.provider ?? 'NONE' },
    senderId: msgCfg?.sms?.senderId ?? null,
    providerOptions: MESSAGE_PROVIDERS,
    urls: cfg.hookKey ? { msg91: await hookUrl(CFG, 'msg91', baseUrl), whatsapp: await hookUrl(CFG, 'whatsapp', baseUrl) } : null,
    last7Days: delivery.map((d) => ({ channel: d._id.channel, status: d._id.status, count: d.n })),
  }
}

/** The delivery-report addresses (made the first time they are asked for). */
export async function messagingUrls(baseUrl) {
  return { msg91: await hookUrl(CFG, 'msg91', baseUrl), whatsapp: await hookUrl(CFG, 'whatsapp', baseUrl) }
}

/** Meta app secret / verify token. Stored on the MESSAGING integration config, encrypted. */
export const saveMessagingWebhook = (input, req) => saveConfig(CFG, { enabled: true, ...input }, req)

/** Which template each family message uses on SMS (DLT id) and WhatsApp (template name) — set in Notification rules. */
export async function templateMap(enabledModules) {
  const rules = await listRules(enabledModules)
  return rules.map((r) => ({
    event: r.event, label: r.label, module: r.module,
    sms: { enabled: !!r.channels.SMS?.enabled, templateId: r.channels.SMS?.templateId || null },
    whatsapp: { enabled: !!r.channels.WHATSAPP?.enabled, templateName: r.channels.WHATSAPP?.templateName || null, language: r.channels.WHATSAPP?.language || null },
  }))
}

/** The latest SMS and WhatsApp messages with the provider's delivery report. */
export function recentSends(q, paging) {
  return listMessages(q, paging)
}

/** Check the SMS / WhatsApp credentials without sending anything to a family. */
export async function testMessagingProvider(channel, req) {
  const cfg = await messagingConfig()
  let result
  if (channel === 'SMS') {
    if (cfg?.sms?.provider !== 'MSG91') throw conflict('The connection test is for MSG91. For an HTTP gateway, send a test message.')
    const authKey = decrypt(cfg.sms.msg91?.authKey)
    if (!authKey) throw conflict('Save the MSG91 auth key first.')
    // VERIFY: MSG91 balance endpoint and its `type` (route) parameter.
    result = await callProvider({
      provider: 'MSG91', operation: 'test_connection', url: `https://control.msg91.com/api/balance.json?${new URLSearchParams({ authkey: authKey, type: cfg.sms.msg91?.route || '4' })}`,
      summary: { request: 'balance check' }, healthOf: CFG,
    }).then((r) => ({ ok: true, latencyMs: r.latencyMs, message: `MSG91 accepted the key. Balance: ${typeof r.data === 'object' ? JSON.stringify(r.data) : r.data}` }), (err) => ({ ok: false, message: err.message }))
  } else if (channel === 'WHATSAPP') {
    if (cfg?.whatsapp?.provider !== 'META') throw conflict('The connection test is for the WhatsApp Cloud API. For an HTTP provider, send a test message.')
    const token = decrypt(cfg.whatsapp.meta?.token)
    if (!token || !cfg.whatsapp.meta?.phoneNumberId) throw conflict('Save the phone number id and access token first.')
    // GET /{phone-number-id} returns the number's display name and quality rating.
    result = await callProvider({
      provider: 'WHATSAPP', operation: 'test_connection', url: `https://graph.facebook.com/${cfg.whatsapp.meta.apiVersion || 'v21.0'}/${encodeURIComponent(cfg.whatsapp.meta.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
      headers: { Authorization: `Bearer ${token}` }, healthOf: CFG,
    }).then((r) => ({ ok: true, latencyMs: r.latencyMs, message: `Connected: ${r.data?.verified_name ?? ''} ${r.data?.display_phone_number ?? ''} (quality ${r.data?.quality_rating ?? 'unknown'}).` }), (err) => ({ ok: false, message: err.message }))
  } else {
    throw conflict('Use “Send test” for email.')
  }
  await audit({ action: 'UPDATE', module: 'integrations', entityType: 'integration', entityId: channel, entityName: channel === 'SMS' ? 'MSG91' : 'WhatsApp Cloud API', summary: `Tested the connection: ${result.ok ? 'OK' : result.message}` }, req)
  return result
}

// ───────────────────────────────────────────────────────── delivery reports

const ORDER = { DELIVERED: 1, READ: 2, FAILED: 3 }

async function markDelivery(channel, ref, status, at, error) {
  if (!ref) return 0
  const set = { 'delivery.status': status, 'delivery.at': at && !Number.isNaN(at.getTime()) ? at : new Date() }
  if (error) set['delivery.error'] = String(error).slice(0, 300)
  // a report never moves a message backwards (read → delivered arrives out of order)
  const notAfter = Object.keys(ORDER).filter((s) => ORDER[s] >= ORDER[status] && s !== status)
  const filter = { channel, providerRef: String(ref), 'delivery.status': { $nin: notAfter } }
  if (status === 'FAILED') {
    set.status = 'FAILED'
    set.reason = `Provider reported: ${error ?? 'not delivered'}`.slice(0, 300)
  }
  const r = await MessageLog.updateMany(filter, { $set: set })
  return r.modifiedCount ?? 0
}

// VERIFY: MSG91 delivery-report status codes (1 delivered, 2 failed, 9 NDNC, 16/17/25/26 rejected or blocked).
const MSG91_STATUS = { 1: 'DELIVERED', 2: 'FAILED', 9: 'FAILED', 16: 'FAILED', 17: 'FAILED', 25: 'FAILED', 26: 'FAILED' }

/**
 * MSG91 delivery reports: `data=<json>` (form) or JSON [{ requestId, report: [{ number, status, desc, date }] }].
 * MSG91 doesn't sign these; the unguessable hook key in the URL is the authentication.
 */
// VERIFY: MSG91 DLR webhook body shape (form field `data` vs JSON array) for the account's configured format.
export async function handleMsg91Report(hookKey, body) {
  return asHookOwner(CFG, hookKey, async () => {
    let data = body?.data ?? body
    if (typeof data === 'string') { try { data = JSON.parse(data) } catch { data = null } }
    const items = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []
    let updated = 0
    for (const item of items.slice(0, 500)) {
      for (const r of [].concat(item.report ?? item).slice(0, 100)) {
        const status = MSG91_STATUS[Number(r?.status)]
        if (!status) continue
        updated += await markDelivery('SMS', item.requestId ?? item.request_id, status, r.date ? new Date(r.date) : undefined, status === 'FAILED' ? r.desc : undefined)
      }
    }
    await logInbound({ provider: 'MSG91', operation: 'delivery_report', status: items.length ? 'OK' : 'REJECTED', summary: { reports: items.length, updated }, error: items.length ? undefined : 'Body not understood' })
    return [200, { ok: true }]
  })
}

/** Meta's subscription check: echo hub.challenge when the verify token matches. */
export async function verifyWhatsAppSubscription(hookKey, query) {
  return asHookOwner(CFG, hookKey, async (cfg) => {
    const expected = secretOf(cfg, 'metaVerifyToken')
    const ok = query['hub.mode'] === 'subscribe' && !!expected && safeEqual(expected, query['hub.verify_token'])
    await logInbound({ provider: 'WHATSAPP', operation: 'webhook_subscribe', status: ok ? 'OK' : 'REJECTED', error: ok ? undefined : 'Verify token does not match' })
    return ok ? [200, String(query['hub.challenge'] ?? '')] : [403, 'Forbidden']
  })
}

const WA_STATUS = { delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }

/** WhatsApp Cloud API status webhooks, signed with the app secret over the raw body. */
export async function handleWhatsAppWebhook(hookKey, rawBody, headers) {
  return asHookOwner(CFG, hookKey, async (cfg) => {
    const secret = secretOf(cfg, 'metaAppSecret')
    const sig = String(headers['x-hub-signature-256'] ?? '').replace(/^sha256=/, '').toLowerCase()
    if (!secret || !safeEqual(createHmac('sha256', secret).update(rawBody).digest('hex'), sig)) {
      await logInbound({ provider: 'WHATSAPP', operation: 'webhook', status: 'REJECTED', error: secret ? 'Signature does not match' : 'No Meta app secret saved' })
      return [401, { message: 'Invalid signature' }]
    }
    let body
    try { body = JSON.parse(rawBody.toString('utf8')) } catch { return [400, { message: 'Not JSON' }] }
    let updated = 0
    let seen = 0
    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const s of change.value?.statuses ?? []) {
            seen++
            const status = WA_STATUS[s.status]
            if (!status) continue
            updated += await markDelivery('WHATSAPP', s.id, status, s.timestamp ? new Date(Number(s.timestamp) * 1000) : undefined, s.errors?.[0] ? `${s.errors[0].code} ${s.errors[0].title ?? ''}`.trim() : undefined)
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'whatsapp webhook failed')
      await logInbound({ provider: 'WHATSAPP', operation: 'webhook', status: 'ERROR', error: err.message })
      return [500, { message: 'Could not process' }]
    }
    // replies from families (value.messages) are not read here: they would have nowhere to go yet
    await logInbound({ provider: 'WHATSAPP', operation: 'webhook', status: 'OK', summary: { statuses: seen, updated } })
    return [200, { ok: true }]
  })
}
