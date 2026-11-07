import https from 'node:https'
import { config } from '../config.js'
import { assertOutboundUrl, guardedLookup } from '../services/integrationsCommon.js'
import { logger } from './logger.js'

// Server-side PDF: our printed HTML (documents/engine.js) turned into a PDF by Gotenberg's
// Chromium route. Gotenberg is an internal service (docker/docker-compose.yml) — only this API
// talks to it, never the browser — started with JavaScript disabled and an allow-list that
// lets Chromium load nothing but the request's own files.
//
// Belt and braces on our side, so an institution's own print template can't make Gotenberg fetch
// anything either:
//   1. inlineImages(): the few pictures a print carries (institution logo, a consent signature)
//      are fetched here — https only, public addresses only (the same SSRF guard as every
//      integration), images only, small — and put into the page as data: URIs;
//   2. pdfSafeHtml(): strips <script>, on*= handlers, javascript:, <iframe>/<object>/<embed>/
//      <link>/<base>/<meta refresh>, and every resource URL that is not a data: image
//      (src, srcset, href outside <a>, CSS url(), @import).
// We never send cookies or credentials of the user; the only header is Gotenberg's own basic
// auth when configured.
//
// Not configured (GOTENBERG_URL unset) or unreachable → pdfAvailable() is false and callers
// fall back to the HTML they serve today.

const DOWN_MS = 60_000 // after a failure, treat Gotenberg as down this long
const PROBE_MS = 60_000 // health probe at most this often
const MAX_PDF_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_BYTES = 1024 * 1024
const MAX_IMAGES = 8
const IMAGE_CACHE_MS = 10 * 60_000
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)$/

export class PdfUnavailable extends Error {}

const state = { downUntil: 0, probedAt: 0, probing: null }

const configured = () => !!config.gotenberg.url
const authHeader = () => (config.gotenberg.username ? { Authorization: `Basic ${Buffer.from(`${config.gotenberg.username}:${config.gotenberg.password}`).toString('base64')}` } : {})

function markDown(err) {
  if (Date.now() >= state.downUntil) logger.warn({ err: err?.message ?? String(err) }, 'gotenberg unavailable — prints fall back to HTML')
  state.downUntil = Date.now() + DOWN_MS
}

/** Ask Gotenberg's /health in the background (never more than once a minute). */
function probe() {
  if (!configured() || state.probing || Date.now() - state.probedAt < PROBE_MS) return
  state.probedAt = Date.now()
  state.probing = fetch(`${config.gotenberg.url}/health`, { headers: authHeader(), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5_000) })
    .then((r) => { r.body?.cancel?.().catch(() => {}); if (r.ok) state.downUntil = 0; else markDown(new Error(`health ${r.status}`)) })
    .catch((err) => markDown(err))
    .finally(() => { state.probing = null })
}

/** Can a PDF be made right now? Configured, and not failed in the last minute. */
export function pdfAvailable() {
  if (!configured()) return false
  probe()
  return Date.now() >= state.downUntil
}

// ───────────────────────────────────────────────────────── images → data: URIs

const imageCache = new Map() // url → { at, data }

/** One picture over https from a public address, as a data: URI (null when it can't be had). */
function fetchImage(raw) {
  return new Promise((resolve) => {
    let u
    try { u = assertOutboundUrl(raw) } catch { resolve(null); return }
    const req = https.get(u, { lookup: guardedLookup, timeout: 5_000, headers: { Accept: 'image/*', 'User-Agent': 'SchoolGiant-Print/1.0' } }, (res) => {
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (res.statusCode !== 200 || !IMAGE_TYPES.test(type) || Number(res.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) { res.resume(); resolve(null); return }
      const parts = []
      let size = 0
      res.on('data', (c) => { size += c.length; if (size > MAX_IMAGE_BYTES) { req.destroy(); resolve(null) } else parts.push(c) })
      res.on('end', () => { if (size <= MAX_IMAGE_BYTES) resolve(`data:${type};base64,${Buffer.concat(parts).toString('base64')}`) })
      res.on('error', () => resolve(null))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(null))
  })
}

async function imageData(url) {
  const hit = imageCache.get(url)
  if (hit && Date.now() - hit.at < IMAGE_CACHE_MS) return hit.data
  const data = await fetchImage(url)
  if (imageCache.size > 100) imageCache.clear()
  imageCache.set(url, { at: Date.now(), data })
  return data
}

const fromCode = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')
const decodeAttr = (s) => String(s)
  .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => fromCode(Number.parseInt(h, 16)))
  .replace(/&#(\d{1,7});/g, (m, d) => fromCode(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * Put the page's https pictures (<img src>, CSS url()) into it as data: URIs. Pictures that
 * can't be fetched are left for pdfSafeHtml() to remove.
 */
export async function inlineImages(html) {
  const urls = new Set()
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(["'])(https:\/\/[^"']+)\1/gi)) urls.add(decodeAttr(m[2]))
  for (const m of html.matchAll(/url\(\s*(["']?)(https:\/\/[^"')\s]+)\1\s*\)/gi)) urls.add(decodeAttr(m[2]))
  if (!urls.size) return html
  const list = [...urls].slice(0, MAX_IMAGES)
  const data = new Map(await Promise.all(list.map(async (u) => [u, await imageData(u)])))
  const swap = (whole, raw) => { const d = data.get(decodeAttr(raw)); return d ? whole.replace(raw, d) : whole }
  return html
    .replace(/(<img\b[^>]*?\ssrc\s*=\s*["'])(https:\/\/[^"']+)/gi, (whole, pre, raw) => swap(whole, raw))
    .replace(/url\(\s*(["']?)(https:\/\/[^"')\s]+)\1\s*\)/gi, (whole, q, raw) => swap(whole, raw))
}

// ───────────────────────────────────────────────────────── the strict guard

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i
const RESOURCE_ATTRS = new Set(['src', 'poster', 'background', 'data', 'codebase', 'action', 'formaction', 'xlink:href', 'href', 'lowsrc', 'dynsrc', 'ping', 'longdesc', 'manifest', 'cite', 'archive', 'profile', 'usemap', 'icon'])
const DROP_TAGS = /<\s*(script|iframe|frame|frameset|object|embed|applet|portal|template|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi
const DROP_VOID = /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|portal|link|base|meta\s+http-equiv|source|track)\b[^>]*>/gi
const ATTR_NAMES = 'src|href|poster|background|data|codebase|action|formaction|lowsrc|dynsrc|ping|longdesc|manifest|cite|archive|icon|usemap|profile'

/** CSS with every url() that is not a data: image, every @import and every absolute URL removed. */
function safeCss(css) {
  return String(css)
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (whole, q, u) => (DATA_IMAGE.test(u.trim()) ? whole : 'none'))
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/(?:https?|ftps?|file|wss?|blob):[^\s"');,]*/gi, '')
    .replace(/(["'(\s,])(?:\/\/|\\\\)[^\s"');,]+/g, '$1')
}

function safeAttrs(tag, attrs) {
  return attrs.replace(/(\s)([^\s=/>]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g, (whole, sp, rawName, rawValue) => {
    const name = rawName.toLowerCase()
    if (name.startsWith('on') || name === 'srcset' || name === 'imagesrcset') return '' // handlers; srcset can list several URLs
    if (!rawValue) return whole
    let value = rawValue.replace(/^\s*=\s*/, '')
    const q = value[0] === '"' || value[0] === "'" ? value[0] : ''
    if (q) value = value.slice(1, -1)
    const raw = value.trim() // undecoded on purpose: "&#104;ttps:" is not a data: image
    if (/^(javascript|vbscript)/i.test(decodeAttr(raw).replace(/[\u0000-\u0020]/g, ''))) return ''
    if (name === 'style') return `${sp}style="${safeCss(value).replace(/"/g, '&quot;')}"`
    if (RESOURCE_ATTRS.has(name)) return DATA_IMAGE.test(raw) || (name === 'href' && /^#[\w-]*$/.test(raw)) ? whole : ''
    return whole
  })
}

/**
 * The strict guard run on every page before it goes to Gotenberg: nothing in it can run, and
 * nothing in it can make Chromium load a URL (only data: images survive). Two passes: a
 * structural one (tags and attributes), then a blunt one over the whole text, so markup the
 * first pass misreads still can't carry a URL or a handler — at worst some text is mangled.
 */
export function pdfSafeHtml(html) {
  const structural = String(html)
    .replace(/\u0000/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_TAGS, '')
    .replace(DROP_VOID, '')
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (whole, open, css, close) => `${open}${safeCss(css)}${close}`)
    .replace(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/?)>/g, (whole, tag, attrs = '', slash) => `<${tag}${attrs ? safeAttrs(tag.toLowerCase(), attrs) : ''}${slash}>`)
  // data: images are set aside first, so the blunt pass can't mistake base64 for markup
  const kept = []
  const parked = structural.replace(/data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,][^"'\s)<>]*/gi, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000` })
  const OK = '\\u0000\\d+\\u0000'
  return parked
    .replace(/<\s*\/?\s*(script|iframe|frame|object|embed|applet|portal|link|base)\b/gi, '<x-blocked')
    .replace(new RegExp(`(^|[\\s"'/;:])((?:xlink:)?(?:${ATTR_NAMES})\\s*=\\s*["']?\\s*)`, 'gi'), (m, pre, attr, at, all) => {
      const rest = all.slice(at + m.length, at + m.length + 80)
      return new RegExp(`^(?:${OK}|#[\\w-]*["'\\s>])`).test(rest) ? m : `${pre}${attr}blocked:`
    })
    .replace(/(^|[\s"'/;])((?:image)?srcset\s*=)/gi, '$1x-$2')
    .replace(/(^|[\s"'/;])(on[a-z]{2,}\s*=)/gi, '$1x-$2')
    .replace(/url\(\s*["']?\s*/gi, (m, at, all) => (new RegExp(`^${OK}`).test(all.slice(at + m.length, at + m.length + 40)) ? m : `${m}blocked:`))
    .replace(/@import\b/gi, '@x-import')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/\u0000(\d+)\u0000/g, (m, i) => kept[Number(i)] ?? '')
}

// ───────────────────────────────────────────────────────── rendering

const MM_PER_IN = 25.4
const PAPER_MM = { A4: [210, 297], A5: [148, 210], LETTER: [215.9, 279.4], THERMAL_80: [80, 297], CARD_PORTRAIT: [54, 85.6], CARD_LANDSCAPE: [85.6, 54] }

/**
 * HTML → PDF through Gotenberg. `paper`/`margins`/`landscape` are fallbacks: our pages carry
 * an @page rule (size + margins), which wins (preferCssPageSize).
 * Throws PdfUnavailable when Gotenberg is not configured, down, or fails.
 */
export async function renderPdf(html, { paper = 'A4', margins = {}, landscape = false, fileName = 'document.pdf' } = {}) {
  if (!configured()) throw new PdfUnavailable('PDF is not set up on this server.')
  if (Date.now() < state.downUntil) throw new PdfUnavailable('The PDF service is not reachable just now.')
  const page = pdfSafeHtml(await inlineImages(String(html)))
  const [w, h] = PAPER_MM[paper] ?? PAPER_MM.A4
  const inch = (mm) => (Number(mm) / MM_PER_IN).toFixed(3)

  const form = new FormData()
  // VERIFY: Gotenberg 8 — the HTML route needs exactly one file named "index.html" (form field "files").
  form.append('files', new Blob([page], { type: 'text/html' }), 'index.html')
  // VERIFY: Gotenberg 8 page-property field names; plain numbers are inches (units like "210mm" are also accepted in 8.x).
  form.append('paperWidth', inch(w))
  form.append('paperHeight', inch(h))
  form.append('marginTop', inch(margins.top ?? 0))
  form.append('marginBottom', inch(margins.bottom ?? 0))
  form.append('marginLeft', inch(margins.left ?? 0))
  form.append('marginRight', inch(margins.right ?? 0))
  form.append('preferCssPageSize', 'true') // VERIFY: our @page { size; margin } wins over the fallbacks above
  form.append('printBackground', 'true') // VERIFY: field name (accent rules, table shading)
  form.append('landscape', landscape ? 'true' : 'false')
  form.append('emulatedMediaType', 'print') // VERIFY: drops the grey @media screen frame
  // VERIFY: Gotenberg 8 waits for "network idle" unless told not to; nothing here loads from the network.
  form.append('skipNetworkIdleEvent', 'true')
  form.append('failOnConsoleExceptions', 'false')

  let res
  try {
    res = await fetch(`${config.gotenberg.url}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      headers: { ...authHeader(), 'Gotenberg-Output-Filename': String(fileName).replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document' },
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(config.gotenberg.timeoutMs),
    })
  } catch (err) {
    markDown(err)
    throw new PdfUnavailable('The PDF service is not reachable just now.')
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    if (res.status >= 500 || res.status === 429) markDown(new Error(`gotenberg ${res.status}: ${detail}`))
    else logger.warn({ status: res.status, detail }, 'gotenberg refused the page')
    throw new PdfUnavailable('The PDF could not be made.')
  }
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_PDF_BYTES) { await res.body?.cancel?.(); throw new PdfUnavailable('The PDF is too large.') }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_PDF_BYTES || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new PdfUnavailable('The PDF service sent something that is not a PDF.')
  state.downUntil = 0
  return buf
}

/** renderPdf, or null when PDF can't be made (the caller keeps its HTML). */
export async function pdfOrNull(html, opts) {
  if (!pdfAvailable()) return null
  try {
    return await renderPdf(html, opts)
  } catch (err) {
    if (!(err instanceof PdfUnavailable)) logger.warn({ err }, 'pdf render failed')
    return null
  }
}

/** Send a PDF buffer as a download (or inline). */
export function sendPdf(res, buf, fileName, { inline = false } = {}) {
  const name = String(fileName || 'document.pdf').replace(/[\r\n"]/g, '_')
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(buf.length))
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(buf)
}
