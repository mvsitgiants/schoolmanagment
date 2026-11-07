import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import nodemailer from 'nodemailer'
import { renderTemplate } from '@schoolgiant/shared'
import { config } from '../config.js'
import { decrypt } from '../platform/crypto.js'
import { logger } from '../platform/logger.js'

// Delivery providers for SMS, WhatsApp and email (docs/00 §8.6). Each takes the
// institution's channel config and one message, and either returns the provider's
// reference or throws an Error whose message is shown in the message log.
//
//   TEST  log only — demo and training institutions
//   HTTP  any Indian SMS / WhatsApp gateway: the institution fills URL, headers and body
//         with {{to}}, {{message}}, {{templateId}}, {{apiKey}} …
//   META  WhatsApp Cloud API (graph.facebook.com)
//   SMTP  any mail server

const TIMEOUT_MS = 15_000

/** Indian mobile → 91XXXXXXXXXX (digits only). Other countries: digits as given. */
export function normalizeMobile(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10) d = `91${d}`
  return d.length >= 11 && d.length <= 15 ? d : null
}

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? ''))

// A gateway URL is typed in by an institution admin, and the server calls it — so in
// production it must be https and must not point inside our own network.
const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(10|127|169\.254|192\.168)\./i]
export async function assertPublicUrl(url) {
  let u
  try { u = new URL(url) } catch { throw new Error('The gateway URL is not valid.') }
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('The gateway URL must start with https://')
  if (!config.isProd) return u
  if (u.protocol !== 'https:') throw new Error('The gateway URL must use https://')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (host === 'localhost' || addrs.some((a) => PRIVATE.some((re) => re.test(a)))) throw new Error('The gateway URL points to a private network address.')
  return u
}

async function httpCall(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`Gateway answered ${res.status}: ${text.slice(0, 200) || res.statusText}`)
  return text
}

const gatewayRef = (text) => {
  try {
    const j = JSON.parse(text)
    return String(j.request_id ?? j.messageId ?? j.message_id ?? j.id ?? j.data?.id ?? j.messages?.[0]?.id ?? '').slice(0, 120) || undefined
  } catch { return text.trim().slice(0, 120) || undefined }
}

async function sendHttp(gw, msg) {
  if (!gw?.url) throw new Error('The gateway URL is not set.')
  const vars = {
    to: msg.to, to10: msg.to.slice(-10), message: msg.body, subject: msg.subject ?? '',
    templateId: msg.templateId ?? '', apiKey: decrypt(gw.apiKey) ?? '',
  }
  const url = renderTemplate(gw.url, vars, encodeURIComponent)
  await assertPublicUrl(url)
  const headers = {}
  for (const h of gw.headers ?? []) if (h.name?.trim()) headers[h.name.trim()] = renderTemplate(h.value, vars)
  const method = gw.method === 'GET' ? 'GET' : 'POST'
  let body
  if (method === 'POST') {
    if (gw.bodyType === 'FORM') {
      body = renderTemplate(gw.body, vars, encodeURIComponent)
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
    } else {
      // values are JSON-escaped so a quote or newline in the message keeps the body valid
      body = renderTemplate(gw.body, vars, (v) => JSON.stringify(v).slice(1, -1))
      headers['Content-Type'] ??= 'application/json'
    }
  }
  return { ref: gatewayRef(await httpCall(url, { method, headers, body })) }
}

async function sendMeta(meta, msg) {
  const token = decrypt(meta?.token)
  if (!meta?.phoneNumberId || !token) throw new Error('Set the WhatsApp phone number id and access token.')
  const payload = msg.waTemplate?.name
    ? {
        messaging_product: 'whatsapp', to: msg.to, type: 'template',
        template: {
          name: msg.waTemplate.name,
          language: { code: msg.waTemplate.language || 'en' },
          components: msg.waTemplate.params?.length ? [{ type: 'body', parameters: msg.waTemplate.params.map((text) => ({ type: 'text', text })) }] : undefined,
        },
      }
    : { messaging_product: 'whatsapp', to: msg.to, type: 'text', text: { body: msg.body, preview_url: false } }
  const text = await httpCall(`https://graph.facebook.com/${meta.apiVersion || 'v21.0'}/${encodeURIComponent(meta.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { ref: gatewayRef(text) }
}

async function sendSmtp(smtp, msg) {
  if (!smtp?.host || !smtp?.from) throw new Error('Set the SMTP server and the “from” address.')
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port || (smtp.secure ? 465 : 587), secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: decrypt(smtp.pass) ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
  })
  const info = await transport.sendMail({ from: smtp.from, to: msg.to, subject: msg.subject || '(no subject)', text: msg.body })
  return { ref: info.messageId }
}

/**
 * MSG91 (Indian SMS, DLT). Uses the send-HTTP API, which takes the rendered text plus the
 * DLT template id, so the wording stays the institution's rule (no MSG91-side flow needed).
 */
// VERIFY: endpoint, parameter names (route, DLT_TE_ID, response=json) and the success shape against MSG91's current docs.
export const MSG91_SEND_URL = 'https://api.msg91.com/api/sendhttp.php'
async function sendMsg91(sms, msg) {
  const authKey = decrypt(sms?.msg91?.authKey)
  if (!authKey || !sms?.senderId) throw new Error('Set the MSG91 auth key and the sender id.')
  if (!msg.templateId) throw new Error('This message has no DLT template id (Notification rules › SMS).')
  const q = new URLSearchParams({
    authkey: authKey, mobiles: msg.to, message: msg.body, sender: sms.senderId, route: sms.msg91?.route || '4',
    country: msg.to.startsWith('91') ? '91' : '0', DLT_TE_ID: msg.templateId, response: 'json', unicode: /[^\x00-\x7F]/.test(msg.body) ? '1' : '0',
  })
  const text = await httpCall(`${MSG91_SEND_URL}?${q}`, { method: 'GET' })
  let j = null
  try { j = JSON.parse(text) } catch { /* plain request id */ }
  if (j && j.type && j.type !== 'success') throw new Error(`MSG91: ${String(j.message ?? 'rejected').slice(0, 200)}`)
  return { ref: String(j?.message ?? text).trim().slice(0, 120) || undefined }
}

/** Channel config section for a channel. */
export const channelConfig = (cfg, channel) => ({ SMS: cfg?.sms, WHATSAPP: cfg?.whatsapp, EMAIL: cfg?.email }[channel] ?? {})

/** Send one message. `cfg` is the institution's MessagingConfig; returns { ref }. */
export async function deliver(cfg, msg) {
  const ch = channelConfig(cfg, msg.channel)
  switch (ch.provider) {
    case 'TEST':
      logger.info({ channel: msg.channel, to: msg.to, subject: msg.subject, body: msg.body }, 'message (test mode, not sent)')
      return { ref: `test-${Date.now().toString(36)}` }
    case 'HTTP': return sendHttp(ch.http, msg)
    case 'MSG91': return sendMsg91(ch, msg)
    case 'META': return sendMeta(ch.meta, msg)
    case 'SMTP': return sendSmtp(ch.smtp, msg)
    default: throw new Error('No provider is set up for this channel.')
  }
}
