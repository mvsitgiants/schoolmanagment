import { LETTERHEAD_DEFAULTS, LETTERHEAD_IDS, PAPER_BY, pageCss, printDefaults } from '@schoolgiant/shared'
import { fetchEffectivePrint } from '../../api/printing'
import { getCurrentUser } from '../../api/auth'

// The print layout of one document (Administration › Print templates): page size and
// margins, the letterhead and the footer. Printers call printLayout() while building
// their HTML (after window.open(), never before it) and drop its pieces in:
//
//   const L = await printLayout('LAB_REPORT', d.institution)
//   `<style>${L.css} …`  ·  `${L.header('<div class="title">Lab report</div>')}`
//   `${L.footerText(d.footer)}`  ·  `${L.showQr && qr ? … : ''}`
//
// The printer keeps its own classes: .head (flex row with a bottom rule), .hn (institution
// name) and .muted. A failed lookup falls back to the built-in layout, so printing never breaks.

const TTL = 60_000
const cache = new Map()
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** Forget cached layouts (after Print templates saves). */
export const forgetPrintLayouts = () => cache.clear()

async function effective(docType) {
  const fallback = { letterhead: { ...LETTERHEAD_DEFAULTS, institution: {} }, template: printDefaults(docType) }
  // the patient's link page renders documents with nobody signed in
  if (!getCurrentUser()) return fallback
  const hit = cache.get(docType)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  try {
    const value = await fetchEffectivePrint(docType)
    cache.set(docType, { at: Date.now(), value })
    return value
  } catch {
    return fallback
  }
}

/** The letterhead block. `right` is the document's own corner (title, doctor, bill no…). */
export function letterheadHtml(lh, t, h, accent, right = '') {
  if (t.letterhead === 'PREPRINTED') return right ? `<div class="head" style="border-bottom-color:transparent;justify-content:flex-end">${right}</div>` : ''
  if (t.letterhead === 'NONE') return `<div class="head"><div class="hn" style="font-size:11pt">${esc(h.name)}</div>${right}</div>`
  const ids = (lh.ids ?? []).filter((k) => h[k]).map((k) => `${esc(LETTERHEAD_IDS.find((x) => x.value === k)?.label)} ${esc(h[k])}`).join(' · ')
  const block = [
    lh.showLogo !== false && h.logoUrl ? `<img src="${esc(h.logoUrl)}" alt="" style="height:11mm;margin-bottom:1mm" />` : '',
    `<div class="hn" style="color:${esc(accent)}">${esc(h.name)}</div>`,
    lh.tagline ? `<div class="muted" style="font-style:italic">${esc(lh.tagline)}</div>` : '',
    `<div class="muted">${esc([h.addressLine, h.city, h.state, h.pincode].filter(Boolean).join(', '))}</div>`,
    lh.showContacts !== false ? `<div class="muted">${esc([h.phone, h.email, h.website].filter(Boolean).join(' · '))}</div>` : '',
    ids ? `<div class="muted">${ids}</div>` : '',
  ].filter(Boolean).join('')
  if (lh.align === 'CENTER') return `<div class="head" style="display:block;text-align:center;border-bottom-color:${esc(accent)}"><div>${block}</div>${right ? `<div style="display:flex;justify-content:flex-end;text-align:right;margin-top:1.5mm">${right}</div>` : ''}</div>`
  return `<div class="head" style="border-bottom-color:${esc(accent)}"><div>${block}</div>${right}</div>`
}

export async function printLayout(docType, institution = {}) {
  const { letterhead: lh, template: t } = await effective(docType)
  const h = { ...lh.institution, ...institution }
  const accent = lh.accentColor || h.primaryColor || '#0E7C86'
  const paper = PAPER_BY[t.paper] ?? PAPER_BY.A4
  const width = t.orientation === 'landscape' && t.paper !== 'THERMAL_80' ? paper.height : paper.width
  return {
    template: t,
    accent,
    /** @page rule, the font scale, and the on-screen sheet at the template's paper width. */
    css: `${pageCss(t)}${t.fontScale && t.fontScale !== 100 ? ` body { zoom: ${t.fontScale / 100} }` : ''} @media screen { .page { max-width: ${width}mm !important } }`,
    header: (right) => letterheadHtml(lh, t, h, accent, right),
    footerText: (fallback) => t.footerText || lh.footerText || fallback || '',
    showQr: t.showQr !== false,
    showPrintedOn: t.showPrintedOn !== false,
  }
}
