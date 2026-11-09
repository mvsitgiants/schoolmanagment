// Website (module `website`): the institution's public site — pages made of blocks, kept as a draft until someone with
// website.pages.publish puts them live. The public site is at <app>/site/<institution slug>[/<page>].

/** The standard pages a site starts with; CUSTOM ones are added freely. */
export const SITE_PAGE_KINDS = [
  { value: 'HOME', label: 'Home', slug: 'home' },
  { value: 'ABOUT', label: 'About us', slug: 'about' },
  { value: 'ACADEMICS', label: 'Academics', slug: 'academics' },
  { value: 'ADMISSIONS', label: 'Admissions', slug: 'admissions' },
  { value: 'FACILITIES', label: 'Facilities', slug: 'facilities' },
  { value: 'CONTACT', label: 'Contact', slug: 'contact' },
  { value: 'CUSTOM', label: 'Custom page', slug: '' },
]
export const SITE_PAGE_KIND_BY = Object.fromEntries(SITE_PAGE_KINDS.map((k) => [k.value, k]))

/** What a page is built from. `max` caps the list items inside a block. */
export const SITE_BLOCK_TYPES = [
  { value: 'HERO', label: 'Banner with image' },
  { value: 'TEXT', label: 'Text' },
  { value: 'GALLERY', label: 'Image gallery', max: 12 },
  { value: 'STATS', label: 'Numbers', max: 6 },
  { value: 'CARDS', label: 'Cards', max: 9 },
  { value: 'CTA', label: 'Call to action' },
  { value: 'CONTACT', label: 'Contact and map' },
  { value: 'NOTICES', label: 'Latest notices' },
  { value: 'EVENTS', label: 'Upcoming events' },
]
export const SITE_BLOCK_VALUES = SITE_BLOCK_TYPES.map((b) => b.value)
export const SITE_BLOCK_BY = Object.fromEntries(SITE_BLOCK_TYPES.map((b) => [b.value, b]))

/** A page's state: never published, live as saved, or live with unpublished changes. */
export const SITE_PAGE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  CHANGED: { label: 'Unpublished changes', tone: 'warning' },
}

export const SITE_LIMITS = { pages: 30, blocksPerPage: 30, imageBytes: 300 * 1024, textChars: 8000 }

/** 'About Us!' → 'about-us' (a page's address). */
export const siteSlug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/** A link a block may carry: another page of the site, an https / http address, mail or phone. */
export const isSiteLink = (v) => !v || /^(https?:\/\/[^\s]+|\/[a-z0-9/_-]*|#[a-z0-9-]*|mailto:[^\s]+|tel:[+\d\s-]+)$/i.test(String(v))

/** A new block of a type, with sensible starting content. */
export function newSiteBlock(type, id = Math.random().toString(36).slice(2, 10)) {
  const data = {
    HERO: { heading: '', subheading: '', imageId: null, buttonLabel: '', buttonLink: '', apply: false },
    TEXT: { heading: '', body: '' },
    GALLERY: { heading: '', images: [] },
    STATS: { heading: '', items: [{ value: '', label: '' }] },
    CARDS: { heading: '', items: [{ title: '', text: '', imageId: null, link: '' }] },
    CTA: { heading: '', text: '', buttonLabel: '', buttonLink: '', apply: true },
    CONTACT: { heading: '', address: '', phone: '', email: '', lat: null, lng: null, showMap: true },
    NOTICES: { heading: '', count: 5 },
    EVENTS: { heading: '', count: 5 },
  }[type] ?? {}
  return { id, type, data }
}

// ───────────────────────────────────────────────────────── rich text

/**
 * A small, safe "rich text": paragraphs separated by a blank line, `## ` headings, `- ` bullet lists, **bold**,
 * *italic* and [links](https://…). Parsed to plain data — the page renders it as elements, never as HTML.
 *   → [{ kind: 'h' | 'p' | 'ul', parts | items: [[{ text, bold?, italic?, href? }]] }]
 */
export function parseRichText(src) {
  const blocks = []
  const paras = String(src ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  for (const raw of paras) {
    const lines = raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
    if (!lines.length) continue
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      blocks.push({ kind: 'ul', items: lines.map((l) => inline(l.replace(/^\s*[-*]\s+/, ''))) })
    } else if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
      blocks.push({ kind: 'h', parts: inline(lines[0].replace(/^#{1,3}\s+/, '')) })
    } else {
      blocks.push({ kind: 'p', parts: inline(lines.join('\n')) })
    }
  }
  return blocks
}

function inline(text) {
  const out = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[1]) out.push({ text: m[1], bold: true })
    else if (m[2]) out.push({ text: m[2], italic: true })
    else out.push({ text: m[3], href: isSiteLink(m[4]) ? m[4] : null })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
