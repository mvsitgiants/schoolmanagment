import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { HEALTH_STATUSES, INTEGRATION_PROVIDER_BY, LOG_PROVIDERS, LOG_STATUSES } from '@schoolgiant/shared'
import { IntegrationConfig, IntegrationLog } from '../models/integrations.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { decrypt, encrypt } from '../platform/crypto.js'
import { clean } from '../platform/db.js'
import { AppError, badRequest, conflict, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { escapeRegex, listResponse } from '../platform/validate.js'

// The integration framework every adapter shares:
//   · IntegrationConfig per institution per provider — settings in clear, secrets encrypted,
//     never sent back (the screen sees `set` and the last 4);
//   · callProvider() — every outgoing call: timeout, retry for idempotent calls, and one
//     IntegrationLog row with a redacted outline (never secrets, OTPs or clinical values);
//   · logInbound() — the same row for webhooks and device pushes;
//   · keys — random, shown once, stored as a sha-256 hash; compared in constant time;
//   · outbound URL guard — blocks private, loopback and link-local addresses (SSRF).

// ───────────────────────────────────────────────────────── keys & hashing

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

/** Constant-time equality of two strings (false when lengths differ). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

/** `<prefix><lookup>_<secret>` — the lookup half finds the row, the whole key is checked by hash. */
export function newKey(prefix) {
  const lookup = randomBytes(6).toString('hex') // 12 chars
  const secret = randomBytes(24).toString('base64url') // 32 chars
  const key = `${prefix}${lookup}_${secret}`
  return { key, prefix: `${prefix}${lookup}`, hash: sha256(key), last4: secret.slice(-4) }
}

/** Split a presented key into its lookup prefix, or null when it isn't shaped like one. */
export function keyPrefixOf(key, prefix) {
  const s = String(key ?? '')
  const m = s.match(new RegExp(`^(${escapeRegex(prefix)}[a-f0-9]{12})_[A-Za-z0-9_-]{32}$`))
  return m ? m[1] : null
}

export const newHookKey = () => randomBytes(18).toString('base64url')

// ───────────────────────────────────────────────────────── redaction

// secrets, and the personal details providers echo back (contact, email, customer, prefill)
const SECRET_KEY = /secret|password|passwd|pass$|token|otp|authkey|auth_key|api[-_]?key|authorization|signature|pin$|aadhaar|loginid|otpvalue|cvv|card_?number|vpa|contact|email|mobile|phone|customer|prefill|^mobiles$|^address$/i
const CLINICAL_KEY = /^(value|values|result|results|obx|comment|diagnosis|notes?)$/i

/** Outline of a payload for the log: secrets and clinical values masked, long text cut. */
export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value
  if (depth > 4) return '…'
  if (Array.isArray(value)) {
    const out = value.slice(0, 10).map((v) => redact(v, depth + 1))
    if (value.length > 10) out.push(`… ${value.length - 10} more`)
    return out
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      if (SECRET_KEY.test(k)) out[k] = v === '' || v == null ? v : '•••'
      else if (CLINICAL_KEY.test(k) && typeof v !== 'object') out[k] = '•••'
      else out[k] = redact(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string') {
    // a 12-digit run is an Aadhaar-shaped number; a 4–8 digit run on its own may be an OTP
    const s = value.replace(/\b\d{12}\b/g, '••••••••••••').replace(/^\d{4,8}$/, '••••')
    return s.length > 200 ? `${s.slice(0, 200)}…` : s
  }
  return value
}

// ───────────────────────────────────────────────────────── config

const blankConfig = (provider) => ({ provider, enabled: false, mode: 'SANDBOX', settings: {}, secrets: {}, health: { status: 'UNKNOWN' } })

export async function getConfig(provider) {
  return (await IntegrationConfig.findOne({ provider }).lean()) ?? blankConfig(provider)
}

/** A secret's clear value (server side only). */
export const secretOf = (cfg, key) => decrypt(cfg?.secrets?.[key]?.v) ?? null

/** The config for the screen: every secret replaced by { set, last4 }. */
export function maskConfig(cfg) {
  const def = INTEGRATION_PROVIDER_BY[cfg.provider]
  const secrets = {}
  for (const s of def?.secrets ?? []) secrets[s.key] = { set: !!cfg.secrets?.[s.key]?.v, last4: cfg.secrets?.[s.key]?.last4 ?? null }
  return {
    provider: cfg.provider, enabled: !!cfg.enabled, mode: cfg.mode ?? 'SANDBOX', settings: cfg.settings ?? {}, secrets,
    health: { ...(cfg.health ?? { status: 'UNKNOWN' }), label: HEALTH_STATUSES[cfg.health?.status ?? 'UNKNOWN']?.label },
    hasHookKey: !!cfg.hookKey, updatedBy: cfg.updatedBy, updatedAt: cfg.updatedAt,
  }
}

/**
 * Save a provider's settings. Only the provider's declared fields and secrets are kept; an
 * empty secret keeps the saved one, `null` clears it.
 */
export async function saveConfig(provider, { enabled, mode, settings = {}, secrets = {} }, req, { validate } = {}) {
  const def = INTEGRATION_PROVIDER_BY[provider]
  if (!def) throw notFound('Integration')
  if (!def.available) throw conflict(`${def.label} isn’t available yet.`)
  const current = await getConfig(provider)
  const nextSettings = { ...(current.settings ?? {}) }
  for (const f of def.fields) if (f.key in settings) nextSettings[f.key] = String(settings[f.key] ?? '').trim() || undefined
  const nextSecrets = { ...(current.secrets ?? {}) }
  const changedSecrets = []
  for (const s of def.secrets) {
    if (!(s.key in secrets)) continue
    const v = secrets[s.key]
    if (v === null) { delete nextSecrets[s.key]; changedSecrets.push(s.label); continue }
    if (!String(v ?? '').trim()) continue
    nextSecrets[s.key] = { v: encrypt(String(v).trim()), last4: String(v).trim().slice(-4) }
    changedSecrets.push(s.label)
  }
  const next = { enabled: enabled ?? current.enabled ?? false, mode: mode ?? current.mode ?? 'SANDBOX', settings: nextSettings, secrets: nextSecrets }
  if (validate) await validate(next)
  const $set = { ...next, updatedBy: getContext()?.userName }
  if (!current.hookKey) $set.hookKey = newHookKey()
  // credentials changed: the last health check no longer says anything
  if (changedSecrets.length || next.mode !== current.mode || JSON.stringify(nextSettings) !== JSON.stringify(current.settings ?? {})) $set.health = { status: 'UNKNOWN' }
  await IntegrationConfig.updateOne({ provider }, { $set }, { upsert: true })
  const bits = [`${next.enabled ? 'on' : 'off'}`, next.mode === 'LIVE' ? 'live' : 'sandbox', changedSecrets.length ? `changed ${changedSecrets.join(', ')}` : null].filter(Boolean)
  await audit({ action: 'UPDATE', module: 'integrations', entityType: 'integration', entityId: provider, entityName: def.label, summary: `${def.label}: ${bits.join(', ')}` }, req)
  return maskConfig(await getConfig(provider))
}

/** Config of an enabled provider, or a clear error for the caller. */
export async function requireConfig(provider) {
  const cfg = await getConfig(provider)
  const def = INTEGRATION_PROVIDER_BY[provider]
  if (!cfg.enabled) throw new AppError(409, `${def?.label ?? provider} isn’t switched on (Integrations).`, { code: 'INTEGRATION_OFF' })
  return cfg
}

export async function setHealth(provider, status, { message, latencyMs } = {}) {
  if (!INTEGRATION_PROVIDER_BY[provider]) return
  try {
    await IntegrationConfig.updateOne({ provider }, { $set: { health: { status, checkedAt: new Date(), message: message?.slice(0, 300), latencyMs } } })
  } catch (err) {
    logger.warn({ err, provider }, 'integration health update failed')
  }
}

/** The public URL for one of this institution's inbound webhooks. */
export async function hookUrl(provider, path, baseUrl) {
  let cfg = await getConfig(provider)
  if (!cfg.hookKey) {
    await IntegrationConfig.updateOne({ provider }, { $setOnInsert: { enabled: false, mode: 'SANDBOX', settings: {}, secrets: {} }, $set: { hookKey: newHookKey() } }, { upsert: true })
    cfg = await getConfig(provider)
  }
  return `${baseUrl}/api/v1/hooks/${path}/${cfg.hookKey}`
}

/** Find the institution a public webhook belongs to, and run `fn` as that institution. */
export async function asHookOwner(provider, hookKey, fn) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(String(hookKey ?? ''))) throw notFound('Webhook')
  const cfg = await runAsSystem(() => IntegrationConfig.findOne({ provider, hookKey }).setOptions({ allTenants: true }).lean())
  if (!cfg) throw notFound('Webhook')
  return runAsTenant(cfg.tenantId, () => fn(cfg), { userId: null, userName: `${INTEGRATION_PROVIDER_BY[provider]?.label ?? provider} webhook` })
}

// ───────────────────────────────────────────────────────── log

export async function writeLog(row) {
  // the integration log belongs to an institution; platform-level calls (the ABDM account test,
  // callbacks not yet matched to an institution) go to the server log
  if (!getContext()?.tenantId) {
    logger.info({ provider: row.provider, operation: row.operation, status: row.status, httpStatus: row.httpStatus, error: row.error }, 'platform integration call')
    return
  }
  try {
    await IntegrationLog.create({ ...row, summary: row.summary === undefined ? undefined : redact(row.summary), error: row.error ? String(row.error).slice(0, 500) : undefined })
  } catch (err) {
    logger.warn({ err, provider: row.provider }, 'integration log write failed')
  }
}

export const logInbound = (row) => writeLog({ direction: 'IN', requestId: getContext()?.requestId, ...row })

export class ProviderError extends Error {
  constructor(message, { httpStatus, body, retryable } = {}) {
    super(message)
    this.httpStatus = httpStatus
    this.body = body
    this.retryable = !!retryable
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Pull a readable message out of a provider's error body. */
function providerMessage(body, status) {
  if (body && typeof body === 'object') {
    const e = body.error ?? body.errors?.[0] ?? body
    const msg = e?.description ?? e?.message ?? e?.error_description ?? body.message ?? body.msg ?? body.type
    if (msg) return String(typeof msg === 'object' ? JSON.stringify(msg) : msg).slice(0, 300)
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 300)
  return `HTTP ${status}`
}

/**
 * One outgoing call to a provider. Retries network errors, 429 and 5xx — but only when the
 * call is idempotent (a GET, or a POST the provider de-duplicates). Logs once, at the end.
 * Returns { status, data, latencyMs, requestId }; throws ProviderError.
 */
export async function callProvider({
  provider, operation, url, method = 'GET', headers = {}, body, form, timeoutMs = 15_000, retries = 2, idempotent = method === 'GET',
  summary, entity, healthOf, requestId = randomUUID(), refOf,
}) {
  const started = Date.now()
  let attempt = 0
  let lastErr
  const payload = form ? new URLSearchParams(form).toString() : body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  const h = { Accept: 'application/json', ...headers }
  if (payload !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json'
  const maxAttempts = idempotent ? 1 + retries : 1
  while (attempt < maxAttempts) {
    attempt++
    try {
      const res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
      const text = await res.text().catch(() => '')
      let data = text
      try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
      if (!res.ok) throw new ProviderError(providerMessage(data, res.status), { httpStatus: res.status, body: data, retryable: res.status === 429 || res.status >= 500 })
      const latencyMs = Date.now() - started
      await writeLog({
        provider, direction: 'OUT', operation, status: 'OK', httpStatus: res.status, latencyMs, attempts: attempt, requestId,
        ref: refOf ? String(refOf(data) ?? '').slice(0, 120) || undefined : undefined,
        entityType: entity?.type, entityId: entity?.id ? String(entity.id) : undefined,
        summary: summary ?? { request: method === 'GET' ? undefined : body ?? form, response: data },
      })
      if (healthOf) await setHealth(healthOf, 'OK', { latencyMs })
      return { status: res.status, data, latencyMs, requestId }
    } catch (err) {
      lastErr = err instanceof ProviderError ? err : new ProviderError(err?.name === 'TimeoutError' ? `No answer within ${timeoutMs / 1000}s` : `Could not reach the provider: ${err?.cause?.code ?? err?.message ?? err}`, { retryable: true })
      if (!lastErr.retryable || attempt >= maxAttempts) break
      await sleep(400 * 2 ** (attempt - 1))
    }
  }
  const latencyMs = Date.now() - started
  await writeLog({
    provider, direction: 'OUT', operation, status: 'ERROR', httpStatus: lastErr.httpStatus, latencyMs, attempts: attempt, requestId,
    entityType: entity?.type, entityId: entity?.id ? String(entity.id) : undefined,
    // A caller's summary.response describes success ("token issued"); on failure `error` says what happened.
    summary: summary ? { ...summary, response: undefined } : { request: method === 'GET' ? undefined : body ?? form, response: lastErr.body }, error: lastErr.message,
  })
  if (healthOf) await setHealth(healthOf, lastErr.httpStatus && lastErr.httpStatus < 500 ? 'DEGRADED' : 'DOWN', { message: lastErr.message, latencyMs })
  throw lastErr
}

/** A provider failure as an API error the screen can show. */
export const providerFailed = (label, err) => new AppError(502, `${label}: ${err?.message ?? err}`, { code: 'PROVIDER_ERROR' })

export async function listLogs(q, paging) {
  const filter = {}
  if (q.provider) filter.provider = q.provider
  if (q.status) filter.status = q.status
  if (q.direction) filter.direction = q.direction
  if (q.from || q.to) {
    filter.createdAt = {}
    if (q.from) filter.createdAt.$gte = new Date(`${q.from}T00:00:00`)
    if (q.to) filter.createdAt.$lte = new Date(`${q.to}T23:59:59.999`)
  }
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ operation: re }, { ref: re }, { requestId: re }, { error: re }, { entityId: re }]
  }
  const since = new Date(Date.now() - 86_400_000)
  const [rows, total, day] = await Promise.all([
    IntegrationLog.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    IntegrationLog.countDocuments(filter),
    IntegrationLog.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  const res = listResponse(clean(rows), total, paging)
  res.meta.last24h = Object.fromEntries(day.map((d) => [d._id, d.n]))
  res.meta.providers = LOG_PROVIDERS
  res.meta.statuses = LOG_STATUSES
  return res
}

export async function logDetail(id) {
  const row = await IntegrationLog.findById(id).lean()
  if (!row) throw notFound('Log entry')
  return clean(row)
}

// ───────────────────────────────────────────────────────── outbound URL guard (SSRF)

const blocked = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) blocked.addSubnet(net, bits, 'ipv6')

/** Is this address private, loopback, link-local, multicast or otherwise not on the internet? */
export function isBlockedAddress(addr) {
  let a = String(addr ?? '').replace(/^\[|\]$/g, '')
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) a = mapped[1]
  const fam = isIP(a)
  if (!fam) return true
  if (fam === 6 && /^::ffff:/i.test(a)) return true // hex-form IPv4-mapped: refuse rather than decode
  return blocked.check(a, fam === 4 ? 'ipv4' : 'ipv6')
}

/** Check a URL typed by an admin before the server ever calls it. */
export function assertOutboundUrl(raw, { allowHttp = false } = {}) {
  let u
  try { u = new URL(raw) } catch { throw badRequest('Enter a full URL, starting with https://', { fields: { url: 'Not a valid URL' } }) }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw badRequest(allowHttp ? 'The URL must start with https:// or http://' : 'The URL must use https:// (http is allowed only for sandbox endpoints).', { fields: { url: 'Use https://' } })
  if (u.username || u.password) throw badRequest('Don’t put a user name or password in the URL — the request is signed instead.', { fields: { url: 'No credentials in the URL' } })
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && isBlockedAddress(host))) {
    throw badRequest('The URL points to a private or local network address.', { fields: { url: 'Private address' } })
  }
  return u
}

/**
 * dns.lookup that refuses private answers. Passed to http.request, so the address that is
 * checked is the address that is connected to (no DNS-rebinding window).
 */
export function guardedLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback
  const opts = typeof options === 'object' && options ? options : {}
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || isIP(addresses) }]
    const bad = list.find((a) => isBlockedAddress(a.address))
    if (bad || !list.length) {
      const e = new Error(`${hostname} resolves to a private network address`)
      e.code = 'EBLOCKED'
      return cb(e)
    }
    if (opts.all) return cb(null, list)
    return cb(null, list[0].address, list[0].family)
  })
}

/** Where providers reach this API from outside: PUBLIC_API_URL when set (behind a proxy), else this request's origin. */
export const publicBaseUrl = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')
