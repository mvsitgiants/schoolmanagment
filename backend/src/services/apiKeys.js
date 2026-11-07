import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import {
  API_KEY_PREFIX, WEBHOOK_DELIVERY_STATUSES, WEBHOOK_EVENTS, WEBHOOK_EVENT_BY, WEBHOOK_RETRY_MINUTES, apiKeyScopeOptions, isApiKeyScope, isKnownPermission,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { ApiKey, WebhookDelivery, WebhookEndpoint } from '../models/integrations.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { decrypt, encrypt } from '../platform/crypto.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { on } from '../platform/events.js'
import { logger } from '../platform/logger.js'
import { listResponse } from '../platform/validate.js'
import { effectiveStatus } from './subscription.js'
import { assertOutboundUrl, guardedLookup, keyPrefixOf, newKey, safeEqual, sha256, writeLog } from './integrationsCommon.js'

// Administration › API keys & webhooks.
//
// API keys: `hk_<lookup>_<secret>`, shown once, stored as a sha-256 hash. A key acts as a
// pseudo-user whose permissions are exactly its scopes (never sensitive actions, never
// user / role / key / subscription admin), limited to the modules the institution has on.
//
// Webhooks: the institution's own HTTPS endpoints get the domain events it picks, signed:
//   X-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
// with X-Webhook-Id (de-duplicate on it), retried with backoff, every attempt in the log.
// URLs are checked against private / loopback / link-local addresses on save AND on every
// connection (DNS answers are checked as they are used — no rebinding window).

// ───────────────────────────────────────────────────────── API keys

const keyView = (k) => {
  const { keyHash, ...rest } = clean(k)
  const state = k.revokedAt ? 'REVOKED' : k.expiresAt && new Date(k.expiresAt) < new Date() ? 'EXPIRED' : 'ACTIVE'
  return { ...rest, hint: `${k.prefix}_…${k.last4 ?? ''}`, state }
}

export async function apiKeysMeta(auth) {
  return { scopes: apiKeyScopeOptions(auth.enabledModules), events: WEBHOOK_EVENTS.filter((e) => auth.enabledModules.includes(e.module)), deliveryStatuses: WEBHOOK_DELIVERY_STATUSES, retryMinutes: WEBHOOK_RETRY_MINUTES }
}

export async function listApiKeys() {
  return (await ApiKey.find().sort({ revokedAt: 1, createdAt: -1 }).lean()).map(keyView)
}

function checkScopes(scopes, auth) {
  const bad = scopes.filter((s) => !isKnownPermission(s) || !isApiKeyScope(s) || !auth.enabledModules.includes(s.split('.')[0]))
  if (bad.length) throw badRequest(`These can’t be given to an API key: ${bad.slice(0, 3).join(', ')}`, { fields: { scopes: 'Not allowed' } })
  if (!scopes.length) throw badRequest('Choose at least one permission.', { fields: { scopes: 'Required' } })
}

/**
 * Websites allowed to use a key from their pages, as browser origins (`https://host[:port]`,
 * no path). http only for localhost, for testing. Returns the cleaned list (undefined = none).
 */
function cleanOrigins(list) {
  if (!list) return undefined
  const out = []
  for (const raw of list) {
    const s = String(raw).trim()
    if (!s) continue
    let u
    try { u = new URL(s) } catch { throw badRequest(`“${s.slice(0, 60)}” is not a website address. Use https://yourschool.edu.in`, { fields: { allowedOrigins: 'Not valid' } }) }
    const local = ['localhost', '127.0.0.1'].includes(u.hostname)
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw badRequest(`${u.host}: use https:// (http only for localhost).`, { fields: { allowedOrigins: 'Use https' } })
    out.push(u.origin)
  }
  return out.length ? [...new Set(out)] : undefined
}

const futureOrNull = (d) => {
  if (!d) return undefined
  const at = new Date(`${d}T23:59:59`)
  if (at < new Date()) throw badRequest('The expiry date has passed.', { fields: { expiresAt: 'In the past' } })
  return at
}

/** Returns { apiKey, key } — the key is never shown again. */
export async function createApiKey({ name, scopes, expiresOn, allowedOrigins }, auth, req) {
  checkScopes(scopes, auth)
  const k = newKey(API_KEY_PREFIX)
  const row = await ApiKey.create({ name, scopes: [...new Set(scopes)].sort(), allowedOrigins: cleanOrigins(allowedOrigins), prefix: k.prefix, keyHash: k.hash, last4: k.last4, expiresAt: futureOrNull(expiresOn), createdBy: auth.user?.name, createdById: auth.userId })
  await audit({ action: 'CREATE', module: 'core', entityType: 'api_key', entityId: String(row._id), entityName: name, summary: `Created API key “${name}” with ${row.scopes.length} permission(s)${row.expiresAt ? `, expiring ${expiresOn}` : ''}` }, req)
  return { apiKey: keyView(row.toObject()), key: k.key }
}

export async function updateApiKey(id, { name, scopes, expiresOn, allowedOrigins }, auth, req) {
  const row = isOid(id) ? await ApiKey.findById(id) : null
  if (!row) throw notFound('API key')
  if (row.revokedAt) throw conflict('This key is revoked.')
  if (scopes) { checkScopes(scopes, auth); row.scopes = [...new Set(scopes)].sort() }
  if (name) row.name = name
  if (expiresOn !== undefined) row.expiresAt = expiresOn ? futureOrNull(expiresOn) : undefined
  if (allowedOrigins !== undefined) row.allowedOrigins = cleanOrigins(allowedOrigins)
  await row.save()
  forgetKey(row.prefix) // the 30-second cache would keep the old websites
  await audit({ action: 'UPDATE', module: 'core', entityType: 'api_key', entityId: String(row._id), entityName: row.name, summary: `Changed API key “${row.name}”` }, req)
  return keyView(row.toObject())
}

export async function revokeApiKey(id, auth, req) {
  const row = isOid(id) ? await ApiKey.findOneAndUpdate({ _id: id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedBy: auth.user?.name } }, { returnDocument: 'after' }).lean() : null
  if (!row) throw notFound('Active API key')
  forgetKey(row.prefix)
  await audit({ action: 'DELETE', module: 'core', entityType: 'api_key', entityId: String(row._id), entityName: row.name, summary: `Revoked API key “${row.name}”` }, req)
  return keyView(row)
}

const keyCache = new Map() // prefix → { at, auth }
const forgetKey = (prefix) => keyCache.delete(prefix)

export const looksLikeApiKey = (token) => typeof token === 'string' && token.startsWith(API_KEY_PREFIX)

/**
 * The request's auth for an API key (see platform/middleware.js authenticate), or null.
 * Shaped like a user's: permissions = scopes on enabled modules, whole-institution data scope.
 */
export async function authenticateApiKey(token, ip) {
  const prefix = keyPrefixOf(token, API_KEY_PREFIX)
  if (!prefix) return null
  const hit = keyCache.get(prefix)
  let row
  if (hit && Date.now() - hit.at < 30_000) row = hit.row
  else {
    row = await runAsSystem(() => ApiKey.findOne({ prefix }).setOptions({ allTenants: true }).lean())
    keyCache.set(prefix, { at: Date.now(), row })
  }
  if (!row || !safeEqual(row.keyHash, sha256(token)) || row.revokedAt || (row.expiresAt && new Date(row.expiresAt) < new Date())) return null
  const tenant = await Tenant.findById(row.tenantId).lean()
  if (!tenant) return null
  const enabledModules = await enabledModuleIds(row.tenantId)
  const permissions = row.scopes.filter((s) => isKnownPermission(s) && isApiKeyScope(s) && enabledModules.includes(s.split('.')[0]))
  if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt) > 60_000) {
    runAsTenant(row.tenantId, () => ApiKey.updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date(), lastUsedIp: ip } })).catch(() => {})
    row.lastUsedAt = new Date()
  }
  return {
    apiKey: { id: String(row._id), name: row.name, allowedOrigins: row.allowedOrigins ?? [] },
    tenantId: String(row.tenantId), tenant, userId: null, sessionId: null,
    user: { _id: null, name: `API key: ${row.name}`, active: true },
    roles: [], enabledModules, fullAccess: false, permissions, dataScopes: { default: 'ALL' }, limits: {}, homePage: null,
    status: effectiveStatus(tenant),
  }
}

// ───────────────────────────────────────────────────────── webhook endpoints

const endpointView = (e) => {
  const { secret, ...rest } = clean(e)
  return { ...rest, secretHint: e.secretLast4 ? `whsec_…${e.secretLast4}` : null }
}

export async function listWebhooks() {
  return (await WebhookEndpoint.find().sort({ createdAt: -1 }).lean()).map(endpointView)
}

function checkWebhook({ url, mode, events }, auth) {
  assertOutboundUrl(url, { allowHttp: mode === 'SANDBOX' })
  const bad = (events ?? []).filter((e) => !WEBHOOK_EVENT_BY[e] || !auth.enabledModules.includes(WEBHOOK_EVENT_BY[e].module))
  if (bad.length) throw badRequest(`Unknown event: ${bad[0]}`, { fields: { events: 'Not available' } })
  if (events && !events.length) throw badRequest('Choose at least one event.', { fields: { events: 'Required' } })
}

const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`

/** Returns { webhook, secret } — the signing secret is shown once (rotate to see a new one). */
export async function createWebhook(input, auth, req) {
  checkWebhook(input, auth)
  const secret = newSecret()
  const row = await WebhookEndpoint.create({ ...input, secret: encrypt(secret), secretLast4: secret.slice(-4), createdBy: auth.user?.name })
  await audit({ action: 'CREATE', module: 'core', entityType: 'webhook', entityId: String(row._id), entityName: row.name, summary: `Added webhook “${row.name}” → ${new URL(row.url).host} (${row.events.length} event(s))` }, req)
  return { webhook: endpointView(row.toObject()), secret }
}

export async function updateWebhook(id, input, auth, req) {
  const row = isOid(id) ? await WebhookEndpoint.findById(id) : null
  if (!row) throw notFound('Webhook')
  checkWebhook({ url: input.url ?? row.url, mode: input.mode ?? row.mode, events: input.events ?? row.events }, auth)
  row.set({ ...input, updatedBy: auth.user?.name })
  if (input.active === true) row.failures = 0
  await row.save()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'webhook', entityId: String(row._id), entityName: row.name, summary: `Changed webhook “${row.name}” (${Object.keys(input).join(', ')})` }, req)
  return endpointView(row.toObject())
}

export async function rotateWebhookSecret(id, auth, req) {
  const secret = newSecret()
  const row = isOid(id) ? await WebhookEndpoint.findOneAndUpdate({ _id: id }, { $set: { secret: encrypt(secret), secretLast4: secret.slice(-4), updatedBy: auth.user?.name } }, { returnDocument: 'after' }).lean() : null
  if (!row) throw notFound('Webhook')
  await audit({ action: 'UPDATE', module: 'core', entityType: 'webhook', entityId: String(row._id), entityName: row.name, summary: `New signing secret for webhook “${row.name}”` }, req)
  return { webhook: endpointView(row), secret }
}

export async function deleteWebhook(id, req) {
  const row = isOid(id) ? await WebhookEndpoint.findByIdAndDelete(id).lean() : null
  if (!row) throw notFound('Webhook')
  await WebhookDelivery.deleteMany({ endpointId: row._id, status: { $in: ['PENDING', 'RETRYING'] } })
  await audit({ action: 'DELETE', module: 'core', entityType: 'webhook', entityId: String(row._id), entityName: row.name, summary: `Removed webhook “${row.name}”` }, req)
  return { id: String(row._id) }
}

export async function listDeliveries(endpointId, paging) {
  const filter = isOid(endpointId) ? { endpointId } : {}
  const [rows, total] = await Promise.all([
    WebhookDelivery.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    WebhookDelivery.countDocuments(filter),
  ])
  return listResponse(clean(rows), total, paging)
}

/** Send a `webhook.test` event now and report what the endpoint answered. */
export async function testWebhook(id, req) {
  const ep = isOid(id) ? await WebhookEndpoint.findById(id).lean() : null
  if (!ep) throw notFound('Webhook')
  const d = await WebhookDelivery.create({ endpointId: ep._id, endpointName: ep.name, event: 'webhook.test', deliveryId: randomUUID(), payload: { message: 'Test event from Administration › API keys & webhooks.' }, test: true, attempts: 1 })
  const result = await deliverOnce(ep, d.toObject())
  await WebhookDelivery.updateOne({ _id: d._id }, { $set: { ...result, status: result.ok ? 'SUCCESS' : 'FAILED' } })
  await audit({ action: 'SEND', module: 'core', entityType: 'webhook', entityId: String(ep._id), entityName: ep.name, summary: `Test webhook: ${result.ok ? `delivered (${result.responseStatus})` : result.error ?? `HTTP ${result.responseStatus}`}` }, req)
  return clean(await WebhookDelivery.findById(d._id).lean())
}

/** Send a delivery again (after the receiving side was fixed). */
export async function redeliver(id, req) {
  const d = isOid(id) ? await WebhookDelivery.findById(id) : null
  if (!d) throw notFound('Delivery')
  if (d.test) throw conflict('Use “Send test” again instead.')
  Object.assign(d, { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), error: undefined })
  await d.save()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'webhook_delivery', entityId: String(d._id), entityName: d.event, summary: `Queued webhook delivery ${d.deliveryId} again` }, req)
  kickWebhooks()
  return clean(d.toObject())
}

// ───────────────────────────────────────────────────────── delivery

// never out: codes, secrets, contact details, and family share links (bearer URLs to documents)
const SAFE_OUT = /otp|password|secret|token|aadhaar|^to$|^mobile$|^email$|link$/i
function sanitize(v, depth = 0) {
  if (depth > 5 || v === null || v === undefined) return v
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => sanitize(x, depth + 1))
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    if (v._bsontype === 'ObjectId' || v.constructor?.name === 'ObjectId') return String(v)
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SAFE_OUT.test(k)).map(([k, x]) => [k, sanitize(x, depth + 1)]))
  }
  return v
}

/** One POST to the endpoint. Never throws. */
function deliverOnce(ep, d) {
  const started = Date.now()
  return new Promise((resolve) => {
    let url
    try { url = assertOutboundUrl(ep.url, { allowHttp: ep.mode === 'SANDBOX' }) } catch (err) { return resolve({ ok: false, error: err.message, latencyMs: 0 }) }
    const secret = decrypt(ep.secret)
    if (!secret) return resolve({ ok: false, error: 'The signing secret could not be read — rotate it.', latencyMs: 0 })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: d.deliveryId, event: d.event, createdAt: new Date(d.createdAt ?? Date.now()).toISOString(), test: !!d.test, data: d.payload })
    const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, {
      method: 'POST', lookup: guardedLookup, timeout: 10_000,
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'SchoolGiant-Webhooks/1.0',
        'X-Webhook-Id': d.deliveryId, 'X-Webhook-Event': d.event, 'X-Webhook-Timestamp': String(ts), 'X-Webhook-Signature': `t=${ts},v1=${signature}`,
      },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { if (text.length < 2000) text += c })
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, responseStatus: res.statusCode, responseBody: text.slice(0, 300), latencyMs: Date.now() - started, error: res.statusCode >= 300 ? `Endpoint answered ${res.statusCode}` : undefined }))
      res.on('error', (err) => resolve({ ok: false, error: err.message, latencyMs: Date.now() - started }))
    })
    req.on('timeout', () => req.destroy(new Error('No answer within 10s')))
    req.on('error', (err) => resolve({ ok: false, error: err.code === 'EBLOCKED' ? err.message : `Could not connect: ${err.code ?? err.message}`, latencyMs: Date.now() - started }))
    req.end(body)
  })
}

const AUTO_DISABLE_AFTER = 25 // consecutive failed deliveries

async function sendDelivery(d) {
  const ep = await WebhookEndpoint.findById(d.endpointId).lean()
  if (!ep || !ep.active) {
    await WebhookDelivery.updateOne({ _id: d._id }, { $set: { status: 'FAILED', error: ep ? 'Webhook is switched off' : 'Webhook was removed', nextAttemptAt: undefined } })
    return
  }
  const r = await deliverOnce(ep, d)
  const retryIn = WEBHOOK_RETRY_MINUTES[d.attempts - 1]
  const status = r.ok ? 'SUCCESS' : retryIn ? 'RETRYING' : 'FAILED'
  await WebhookDelivery.updateOne({ _id: d._id }, { $set: { status, responseStatus: r.responseStatus, responseBody: r.responseBody, error: r.error, latencyMs: r.latencyMs, nextAttemptAt: status === 'RETRYING' ? new Date(Date.now() + retryIn * 60_000) : undefined } })
  const failures = r.ok ? 0 : (ep.failures ?? 0) + (status === 'FAILED' ? 1 : 0)
  await WebhookEndpoint.updateOne({ _id: ep._id }, { $set: { lastDeliveryAt: new Date(), lastStatus: status, failures, ...(failures >= AUTO_DISABLE_AFTER && { active: false }) } })
  await writeLog({ provider: 'WEBHOOK', direction: 'OUT', operation: d.event, status: r.ok ? 'OK' : 'ERROR', httpStatus: r.responseStatus, latencyMs: r.latencyMs, attempts: d.attempts, requestId: d.deliveryId, ref: ep.name, entityType: 'webhook', entityId: String(ep._id), error: r.error, summary: { url: `${new URL(ep.url).host}`, event: d.event } })
}

/** Deliver what is due, across institutions. Each row is leased for 2 minutes while it is sent. */
export async function processWebhookQueue({ limit = 50 } = {}) {
  return runAsSystem(async () => {
    let sent = 0
    for (let i = 0; i < limit; i++) {
      const now = new Date()
      const d = await WebhookDelivery.findOneAndUpdate(
        { status: { $in: ['PENDING', 'RETRYING'] }, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
        { $set: { nextAttemptAt: new Date(now.getTime() + 2 * 60_000) }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      ).setOptions({ allTenants: true }).lean()
      if (!d) break
      await runAsTenant(d.tenantId, () => sendDelivery(d))
      sent++
    }
    return sent
  })
}

let running = false
let again = false
export function kickWebhooks() {
  if (config.isTest) return
  if (running) { again = true; return }
  running = true
  setImmediate(async () => {
    try {
      do { again = false; await processWebhookQueue() } while (again)
    } catch (err) {
      logger.error({ err }, 'webhook run failed')
    } finally {
      running = false
    }
  })
}

let registered = false
/** Every domain event an institution's webhooks subscribe to becomes one delivery per endpoint. */
export function registerWebhookListeners() {
  if (registered) return
  registered = true
  on('*', async (payload, event) => {
    if (!WEBHOOK_EVENT_BY[event] || !getContext()?.tenantId) return
    const endpoints = await WebhookEndpoint.find({ active: true, events: event }).select('_id name').lean()
    if (!endpoints.length) return
    const data = sanitize(payload)
    await WebhookDelivery.insertMany(endpoints.map((ep) => ({ endpointId: ep._id, endpointName: ep.name, event, deliveryId: randomUUID(), payload: data, nextAttemptAt: new Date() })))
    kickWebhooks()
  })
}
