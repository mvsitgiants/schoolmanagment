// Rich text that teachers write (bold, italic, underline, lists, links, alignment) and students read. One allow-list,
// used by the editor as it saves, by the server before it stores, and by the screens before they show it:
//   b i u strong em ul ol li p br, a[href] (https:// or mailto: only), p[style=text-align:center|right|justify].
// Everything else is dropped (script / style blocks with their content); text is escaped.

const KEEP = new Set(['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'p', 'br', 'a'])
const AS_P = new Set(['div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'])
const DROP_BLOCKS = /<(script|style|iframe|object|embed|noscript|template|svg|math|head|title|textarea|select|xmp|noembed|noframes)\b[\s\S]*?(<\/\1\s*>|$)/gi
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const ENTITY_OK = /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g

const escText = (s) => s.replace(ENTITY_OK, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '' })
    .replace(/&#(\d{1,7});?/g, (_, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '' })
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
}

const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null
}

/** A link a student may follow: https:// or mailto: only, no spaces or control characters. */
export function safeHref(href) {
  const h = String(href ?? '').trim()
  if (!h || h.length > 1000 || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(h)) return null
  return /^https:\/\/[^/?#]+\.[^/?#]+/i.test(h) || /^mailto:[^@]+@[^@]+$/i.test(h) ? h : null
}

function openTag(tag, attrs) {
  if (tag === 'a') {
    const href = safeHref(attr(attrs, 'href'))
    return href ? `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">` : '<a>'
  }
  if (tag === 'p') {
    const align = (attr(attrs, 'style') ?? '').match(/text-align\s*:\s*(center|right|justify)/i)?.[1] ?? attr(attrs, 'align')
    return /^(center|right|justify)$/i.test(align ?? '') ? `<p style="text-align:${align.toLowerCase()}">` : '<p>'
  }
  return `<${tag}>`
}

/** Clean HTML: only the allowed tags, attributes and link kinds; text escaped; tags balanced. */
export function sanitizeHtml(input, { max = 50000 } = {}) {
  const s = String(input ?? '').slice(0, max).replace(/<!--[\s\S]*?(-->|$)/g, '').replace(DROP_BLOCKS, '')
  const out = []
  const open = []
  const closeTo = (at) => { while (open.length > at) out.push(`</${open.pop()}>`) }
  let last = 0
  let m
  TAG.lastIndex = 0
  while ((m = TAG.exec(s))) {
    out.push(escText(s.slice(last, m.index)))
    last = TAG.lastIndex
    const closing = !!m[1]
    let tag = m[2].toLowerCase()
    if (AS_P.has(tag)) tag = 'p'
    if (!KEEP.has(tag)) continue
    if (tag === 'br') { if (!closing) out.push('<br>'); continue }
    if (closing) { const at = open.lastIndexOf(tag); if (at !== -1) closeTo(at); continue }
    if (tag === 'p' || tag === 'a') { const at = open.lastIndexOf(tag); if (at !== -1) closeTo(at) } // no p in p, no a in a
    if (tag === 'li') { const at = open.lastIndexOf('li'); if (at !== -1 && at > Math.max(open.lastIndexOf('ul'), open.lastIndexOf('ol'))) closeTo(at) }
    open.push(tag)
    out.push(openTag(tag, m[3] ?? ''))
  }
  out.push(escText(s.slice(last)))
  closeTo(0)
  return out.join('').replace(/<(p|b|strong|i|em|u|li|a)>\s*<\/\1>/g, '').trim()
}

/** The words of rich text, one line per paragraph or list item (for search, previews and plain-text fallbacks). */
export function htmlToText(html) {
  return decode(String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Does the rich text have any words in it? */
export const isBlankHtml = (html) => !htmlToText(html).trim()
