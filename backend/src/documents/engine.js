// Document engine: Handlebars templates rendered on the server into a printable page.
// Every document type has a built-in template (defaults/<DOC_TYPE>.hbs); an institution can
// replace the body in Administration › Print templates. The engine adds the page size and
// margins, the letterhead and footer partials, and the helpers templates use.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Handlebars from 'handlebars'
import QRCode from 'qrcode'
import bwipjs from 'bwip-js'
import { LETTERHEAD_IDS, PAPER_BY, amountInWords, fixedPaper, formatINR, pageCss } from '@schoolgiant/shared'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'defaults')
const hb = Handlebars.create()
const esc = Handlebars.escapeExpression
const safe = (s) => new Handlebars.SafeString(s)

// ───────────────────────────────────────────────────────── helpers

/** Date parts on the institution's clock. */
function parts(value, timeZone) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]))
  const h = Number(p.hour === '24' ? 0 : p.hour)
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${String(h % 12 || 12).padStart(2, '0')}:${p.minute} ${h < 12 ? 'AM' : 'PM'}` }
}
const tz = (options) => options?.data?.root?.$tz || 'Asia/Kolkata'
// a plain YYYY-MM-DD is a calendar date, not an instant: print it as is
const ymd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** SVG QR code of a text (a verify link), `size` in mm. */
export function qrSvg(text, size = 20) {
  const { modules } = QRCode.create(String(text), { errorCorrectionLevel: 'M' })
  const n = modules.size
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" width="${size}mm" height="${size}mm" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`
}

/** SVG Code-128 barcode, `height` in mm. */
export function barcodeSvg(text, height = 9) {
  try {
    return bwipjs.toSVG({ bcid: 'code128', text: String(text), height, includetext: false, scale: 2 }).replace('<svg ', `<svg style="height:${height}mm;width:auto" `)
  } catch {
    return ''
  }
}

const LOCALES_DIR = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/src/i18n/locales'),
  path.resolve(process.cwd(), 'frontend/src/i18n/locales'),
  path.resolve(process.cwd(), '../frontend/src/i18n/locales'),
].find((d) => fs.existsSync(d)) || null

const bundleCache = new Map()
function getBundle(lang, ns) {
  if (!LOCALES_DIR) return null
  const cacheKey = `${lang}:${ns}`
  if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey)
  const file = path.join(LOCALES_DIR, lang, `${ns}.json`)
  let data = null
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  }
  bundleCache.set(cacheKey, data)
  return data
}

function getPath(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined
  let cur = obj
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in cur) cur = cur[k]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}

function lookupInNs(lang, ns, key) {
  const bundle = getBundle(lang, ns)
  if (!bundle) return null
  const parts = key.split('.')
  let val = getPath(bundle, parts)
  if (val) return val
  if (parts[0] === ns && parts.length > 1) {
    val = getPath(bundle, parts.slice(1))
    if (val) return val
  }
  if (bundle[ns]) {
    val = getPath(bundle[ns], parts)
    if (val) return val
    if (parts[0] === ns && parts.length > 1) {
      val = getPath(bundle[ns], parts.slice(1))
      if (val) return val
    }
  }
  return null
}

const COMMON_LOOKUP_NS = ['common', 'ui']

export function translateDoc(lang, key, fallback) {
  if (!key) return fallback ?? ''
  const parts = key.split('.')
  const candidateNs = parts.length > 1 ? parts[0] : null
  for (const l of [lang, 'en']) {
    if (!l) continue
    if (candidateNs) {
      const v = lookupInNs(l, candidateNs, key)
      if (v) return v
    }
    for (const ns of COMMON_LOOKUP_NS) {
      if (ns === candidateNs) continue
      const v = lookupInNs(l, ns, key)
      if (v) return v
    }
  }
  return fallback ?? key
}

const HELPERS = {
  /** Translate a string: `{{t "key" "fallback"}}` or `{{t "key"}}`. Values for `{{placeholders}}` in the text come
   *  from the hash: `{{t "hrms.print.offer.dear" "Dear {{name}}," name=employee.name}}` (escaped like any value).
   *  The text itself may bold a part with `<b>…</b>`; any other markup stays escaped. */
  t: (key, fallback, options) => {
    const opts = typeof fallback === 'object' && fallback !== null && 'hash' in fallback ? fallback : options
    const defaultText = typeof fallback === 'string' ? fallback : (opts?.hash?.default ?? key)
    const lang = opts?.data?.root?.$lang || opts?.data?.root?.student?.language || opts?.data?.root?.lang || 'en'
    const vars = opts?.hash ?? {}
    const text = esc(translateDoc(lang, key, defaultText)).replace(/&lt;(\/?)b&gt;/g, '<$1b>')
    return safe(text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => (n in vars ? esc(vars[n] ?? '') : m)))
  },
  /** Translate a code from a fixed list: `{{tc "emergency.erBits.outcome" er.outcome er.outcomeLabel}}` looks up
   *  `<prefix>.<code>` and falls back to the given label (or the code). */
  tc: (prefix, code, fallback, options) => {
    const opts = options ?? (typeof fallback === 'object' && fallback !== null && 'hash' in fallback ? fallback : null)
    const label = typeof fallback === 'string' ? fallback : null
    if (code === undefined || code === null || code === '') return label ?? ''
    const lang = opts?.data?.root?.$lang || opts?.data?.root?.student?.language || opts?.data?.root?.lang || 'en'
    return safe(esc(translateDoc(lang, `${prefix}.${String(code).replace(/\./g, '_')}`, label ?? String(code))))
  },
  /** ₹1,234.50 from paise. `{{money total}}`, `{{money total 0}}` for whole rupees. */
  money: (p, decimals, options) => (p === undefined || p === null || p === '' ? '' : formatINR(Number(p), { decimals: typeof decimals === 'number' ? decimals : 2 })),
  num: (n) => (n === undefined || n === null || n === '' ? '' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n))),
  words: (p) => (p ? amountInWords(Number(p)) : ''),
  // paise → "45,000.00" without the ₹ sign (table columns that already say what they hold)
  amount: (p) => (p === undefined || p === null || p === '' ? '' : new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(p) / 100)),
  date: (v, options) => (!v ? '' : ymd(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : parts(v, tz(options))?.date ?? ''),
  time: (v, options) => (!v ? '' : parts(v, tz(options))?.time ?? ''),
  dateTime: (v, options) => { if (!v) return ''; const p = parts(v, tz(options)); return p ? `${p.date}, ${p.time}` : '' },
  default: (v, fallback) => (v === undefined || v === null || v === '' ? fallback : v),
  inc: (i) => Number(i) + 1,
  abs: (n) => Math.abs(Number(n) || 0),
  /** `(array a b c)` — a list, e.g. for `{{join (array student.class student.section) " · "}}`. */
  array: (...a) => a.slice(0, -1),
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b),
  lt: (a, b) => Number(a) < Number(b),
  and: (...a) => a.slice(0, -1).every(Boolean),
  or: (...a) => a.slice(0, -1).some(Boolean),
  not: (v) => !v,
  join: (list, sep) => (Array.isArray(list) ? list.filter((x) => x !== undefined && x !== null && x !== '').join(typeof sep === 'string' ? sep : ', ') : ''),
  upper: (s) => String(s ?? '').toUpperCase(),
  lower: (s) => String(s ?? '').toLowerCase(),
  /** Text with line breaks kept. */
  lines: (s) => safe(esc(String(s ?? '')).replace(/\n/g, '<br/>')),
  /** One <p> per paragraph. */
  paras: (s) => safe(String(s ?? '').split(/\n+/).filter((x) => x.trim()).map((x) => `<p>${esc(x)}</p>`).join('')),
  qr: (text, size) => (text ? safe(qrSvg(text, typeof size === 'number' ? size : 20)) : ''),
  barcode: (text, height) => (text ? safe(barcodeSvg(text, typeof height === 'number' ? height : 9)) : ''),
}
for (const [name, fn] of Object.entries(HELPERS)) hb.registerHelper(name, fn)

// ───────────────────────────────────────────────────────── partials

/**
 * `{{#> letterhead}}…document corner…{{/letterhead}}` — the institution letterhead with the
 * document's own corner (number, date, title) on the right. `{{> footer}}` — the footer
 * text from the template (or `fallback=` the module's own footer) and the "printed on" line.
 */
hb.registerPartial('letterhead', `{{#if (eq @root.$layout.mode "PREPRINTED")}}<div class="head preprinted">{{#if @partial-block}}{{> @partial-block}}{{/if}}</div>{{else}}<div class="head{{#if @root.$layout.center}} center{{/if}}"><div class="lh">{{{@root.$layout.block}}}</div>{{#if @partial-block}}<div class="corner">{{> @partial-block}}</div>{{/if}}</div>{{/if}}`)
hb.registerPartial('footer', `{{#if (or @root.$layout.footerText fallback @root.$layout.showPrintedOn)}}<div class="doc-foot"><span>{{default @root.$layout.footerText fallback}}</span>{{#if @root.$layout.showPrintedOn}}<span>Printed {{dateTime @root.$now}}</span>{{/if}}</div>{{/if}}`)

// ───────────────────────────────────────────────────────── templates

const defaults = new Map()
/** The built-in template of a document type (read once). */
export function defaultTemplate(docType) {
  if (!defaults.has(docType)) {
    const file = path.join(DIR, `${docType}.hbs`)
    defaults.set(docType, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)
  }
  return defaults.get(docType)
}

const designs = new Map()
const DESIGN_ORDER = ['modern', 'classic', 'minimal', 'corporate']
/**
 * The starting designs of a document type: the built-in template (`<DOC_TYPE>.hbs`) first, then every
 * `<DOC_TYPE>.<key>.hbs` beside it. A design's key is the file's suffix, or `{{!-- design:<key> … --}}` on its first
 * line (the built-in one); [] when the type has only its built-in template.
 */
export function designsOf(docType) {
  if (!designs.has(docType)) {
    const keyOf = (src, fallback) => /^\{\{!--\s*design:([a-z0-9-]+)/.exec(src)?.[1] ?? fallback
    const extra = fs.readdirSync(DIR).map((f) => new RegExp(`^${docType}\\.([a-z0-9-]+)\\.hbs$`).exec(f)).filter(Boolean)
      .map((m) => { const source = fs.readFileSync(path.join(DIR, m[0]), 'utf8'); return { key: keyOf(source, m[1]), builtIn: false, source } })
    const base = defaultTemplate(docType)
    const rank = (k) => (DESIGN_ORDER.includes(k) ? DESIGN_ORDER.indexOf(k) : DESIGN_ORDER.length)
    const list = extra.length && base ? [{ key: keyOf(base, 'standard'), builtIn: true, source: base }, ...extra.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))] : []
    designs.set(docType, list)
  }
  return designs.get(docType)
}

const compiled = new Map()
function compile(source) {
  let fn = compiled.get(source)
  if (!fn) {
    fn = hb.compile(source, { strict: false })
    if (compiled.size > 300) compiled.clear()
    compiled.set(source, fn)
  }
  return fn
}

/** Check a template compiles; returns the error message or null. */
export function templateError(source) {
  try {
    hb.precompile(source)
    return null
  } catch (e) {
    return String(e.message).split('\n').slice(0, 4).join(' ')
  }
}

/** The letterhead block for the layout (logo, name, address, contacts, registration numbers). */
function letterheadBlock(lh, mode, h, accent) {
  if (mode === 'NONE') return `<div class="hn" style="font-size:11pt">${esc(h.name)}</div>`
  const ids = (lh.ids ?? []).filter((k) => h[k]).map((k) => `${esc(LETTERHEAD_IDS.find((x) => x.value === k)?.label)} ${esc(h[k])}`).join(' · ')
  return [
    lh.showLogo !== false && h.logoUrl ? `<img class="logo" src="${esc(h.logoUrl)}" alt="" />` : '',
    `<div class="hn" style="color:${esc(accent)}">${esc(h.name)}</div>`,
    lh.tagline ? `<div class="muted" style="font-style:italic">${esc(lh.tagline)}</div>` : '',
    `<div class="muted">${esc([h.addressLine, h.city, h.state, h.pincode].filter(Boolean).join(', '))}</div>`,
    lh.showContacts !== false ? `<div class="muted">${esc([h.phone, h.email, h.website].filter(Boolean).join(' · '))}</div>` : '',
    ids ? `<div class="muted">${ids}</div>` : '',
  ].filter(Boolean).join('')
}

/** Page layout from the print template and letterhead: what the partials and wrapper need. */
export function layoutFor(template, letterhead, institution) {
  const h = { ...(letterhead?.institution ?? {}), ...institution }
  const accent = letterhead?.accentColor || h.primaryColor || '#0E7C86'
  const paper = PAPER_BY[template.paper] ?? PAPER_BY.A4
  // an ID card draws its own header: no letterhead, edge to edge, at its own size
  const card = !!paper.card
  const mode = card ? 'NONE' : template.letterhead ?? 'FULL'
  return {
    mode,
    center: letterhead?.align === 'CENTER',
    accent,
    block: card ? '' : letterheadBlock(letterhead ?? {}, mode, h, accent),
    footerText: template.footerText || letterhead?.footerText || '',
    showQr: template.showQr !== false,
    showPrintedOn: !card && template.showPrintedOn !== false,
    paper: template.paper,
    thermal: template.paper === 'THERMAL_80',
    card,
    width: template.orientation === 'landscape' && !fixedPaper(template.paper) ? paper.height : paper.width,
    pageCss: pageCss(template),
    fontScale: card ? 100 : template.fontScale ?? 100,
  }
}

const BASE_CSS = (L) => `
  * { box-sizing: border-box }
  body { margin: 0; font-family: Inter, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Gujarati", "Noto Sans Gurmukhi", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Oriya", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Nastaliq Urdu", "Noto Sans Arabic", system-ui, sans-serif; color: #12141C; font-size: ${L.thermal ? '8.5pt' : '9.5pt'}; line-height: 1.38 }
  ${L.fontScale !== 100 ? `body { zoom: ${L.fontScale / 100} }` : ''}
  @media screen { body { background: #F5F6F8; padding: 24px } .page { background: #fff; max-width: ${L.width}mm; margin: 0 auto; padding: ${L.thermal ? '4mm' : '10mm'}; box-shadow: 0 4px 16px rgba(0,0,0,.12) } }
  .head { display: flex; justify-content: space-between; gap: 6mm; padding-bottom: 2.5mm; border-bottom: 0.7mm solid ${L.accent} }
  .head.center { display: block; text-align: center } .head.center .corner { display: flex; justify-content: flex-end; text-align: right; margin-top: 1.5mm }
  .head.preprinted { border-bottom-color: transparent; justify-content: flex-end }
  .head .corner { text-align: right } .logo { height: 11mm; margin-bottom: 1mm }
  .hn { font-size: ${L.thermal ? '11pt' : '13pt'}; font-weight: 700; color: ${L.accent} } .muted { color: #5B616E; font-size: 8pt }
  .mono { font-family: "JetBrains Mono", ui-monospace, monospace } .r { text-align: right; white-space: nowrap } .accent { color: ${L.accent} }
  .doc-foot { margin-top: 4mm; padding-top: 1.5mm; border-top: 0.3mm solid #E3E5EA; display: flex; justify-content: space-between; gap: 4mm; color: #5B616E; font-size: 7.6pt }
  table { width: 100%; border-collapse: collapse }
  ${L.card ? `* { -webkit-print-color-adjust: exact; print-color-adjust: exact } html, body { margin: 0; padding: 0 } .page { padding: 0 }
  @media screen { body { background: #E9ECF1; padding: 24px 12px } .page { background: transparent; max-width: none; padding: 0; box-shadow: none } }` : ''}
`

/**
 * Render a document: the template (institution's body or the built-in one) filled with the
 * model, inside a complete HTML page sized to the print template.
 */
/**
 * Nothing in a printed page may run. Print templates are institution-editable and the browser
 * writes the page into a window that shares the app's origin (frontend printDocument.js), so a
 * <script> or onload= in a template would run as every user who prints — with their session.
 * Unlike pdfSafeHtml() this keeps links and https images (logos), and only disarms what executes.
 * Blunt on purpose: repeated until nothing changes, so nested tricks (<scr<script>ipt>) don't survive.
 */
export function printSafeHtml(html) {
  let out = String(html).replace(/\u0000/g, '')
  for (let i = 0; i < 5; i += 1) {
    const next = out
      .replace(/<\s*(script|iframe|frame|frameset|object|embed|applet|portal|base|meta|link|noscript|template)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|portal|base|meta|link|noscript|template)\b[^>]*>?/gi, '')
      .replace(/(^|[\s"'/;])(on[a-z]{2,}\s*=)/gi, '$1x-$2')
      .replace(/(^|[\s"'/;])(srcdoc\s*=|formaction\s*=)/gi, '$1x-$2')
      .replace(/(java|vb)script\s*:/gi, 'blocked:')
      .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    if (next === out) break
    out = next
  }
  return out
}

export function renderPage({ title, source, model, layout, timeZone = 'Asia/Kolkata', autoPrint = true, lang }) {
  const effectiveLang = lang || model?.$lang || model?.student?.language || model?.lang || 'en'
  const isRtl = effectiveLang === 'ur'
  const body = compile(source)({ ...model, $layout: layout, $tz: timeZone, $now: new Date(), $accent: layout.accent, $lang: effectiveLang }, { allowProtoPropertiesByDefault: false })
  const rtlCss = isRtl ? `
  html, body { direction: rtl; text-align: right; }
  th { text-align: right !important; }
  .r { text-align: left !important; }
  .head .corner { text-align: left !important; }
  .tot { margin-right: auto !important; margin-left: 0 !important; }
` : ''
  const urduFontLink = isRtl ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap">' : ''
  // the template body and the CSS carry institution-edited content; the head and the auto-print are ours
  const css = printSafeHtml(`${layout.pageCss}${BASE_CSS(layout)}${rtlCss}`).replace(/<\/?style/gi, '')
  return `<!doctype html><html lang="${esc(effectiveLang)}" dir="${isRtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${urduFontLink}<title>${esc(title)}</title><style>${css}</style></head><body><div class="page">${printSafeHtml(body)}</div>${autoPrint ? '<script>window.onload = () => setTimeout(() => window.print(), 250)</script>' : ''}</body></html>`
}

export const HELPER_NAMES = Object.keys(HELPERS)
