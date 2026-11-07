import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PAPER_BY, PRINT_DOC_BY } from '@schoolgiant/shared'
import { letterheadHtml } from './printLayout'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const MM = 96 / 25.4 // CSS px per mm

/** Made-up rows that look like the document, so margins and the letterhead can be judged. */
function sampleBody(docType) {
  const rows = {
    RX: [['Tab. Dolo 650', '1-0-1 · after food · 5 days'], ['Cap. Pan 40', '1-0-0 · before food · 5 days'], ['Syp. Mucolite', '5 ml · 1-1-1 · 5 days']],
    LAB_REPORT: [['Haemoglobin', '13.4 g/dL', '13.0 – 17.0'], ['Total WBC count', '11,800 /µL  H', '4,000 – 11,000'], ['Platelets', '2.6 lakh/µL', '1.5 – 4.1']],
    RAD_REPORT: [['Findings', 'Both lung fields are clear. Cardiac size is normal.'], ['Impression', 'No abnormality detected.']],
    PHARMACY_BILL: [['Dolo 650 · B2024 · 06/27', '10', '₹30.00'], ['Pan 40 · P118 · 11/26', '10', '₹125.00']],
    OPD_BILL: [['Consultation — Dr. Ravi Prasad', '1', '₹500'], ['Complete blood count', '1', '₹350']],
    IPD_BILL: [['Room — semi-private × 3 days', '3', '₹7,500'], ['Surgeon fee', '1', '₹25,000']],
    DISCHARGE_SUMMARY: [['Diagnosis', 'Acute appendicitis'], ['Procedure', 'Laparoscopic appendicectomy'], ['Advice', 'Soft diet, review in 7 days']],
    CERTIFICATE: [['This is to certify that', 'Mr. Prakash Pillai was under my treatment from 01/10/2026 to 05/10/2026 and is fit to resume work.']],
  }[docType] ?? [['Item', 'Detail']]
  return `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`
}

/**
 * A scaled sheet of paper showing what a template prints: margins, the letterhead (or the
 * space kept for pre-printed stationery), a sample body and the footer.
 */
export default function PrintPreview({ template: tpl, letterhead: lh, docType, height = 520 }) {
  const { t } = useTranslation('ui')
  const box = useRef(null)
  const [width, setWidth] = useState(360)
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const paper = PAPER_BY[tpl.paper] ?? PAPER_BY.A4
  const landscape = tpl.orientation === 'landscape' && tpl.paper !== 'THERMAL_80'
  const wMm = landscape ? paper.height : paper.width
  const hMm = tpl.paper === 'THERMAL_80' ? 150 : landscape ? paper.width : paper.height
  const zoom = (width - 16) / (wMm * MM)
  const m = tpl.margins ?? {}
  const pre = tpl.letterhead === 'PREPRINTED'
  const h = lh?.institution ?? {}
  const accent = lh?.accentColor || h.primaryColor || '#0E7C86'
  const doc = PRINT_DOC_BY[docType]
  const right = `<div style="text-align:right"><div class="title">${esc(doc ? t(`ui.printPreview.docs.${docType}`, { defaultValue: doc.label }) : t('ui.printPreview.document'))}</div><div class="muted">No. 26000381 · 07/10/2026</div></div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box } html, body { margin: 0; background: #E9EBEF } body { zoom: ${zoom}; padding: 8px; font-family: Inter, system-ui, sans-serif; color: #12141C; font-size: 9.5pt; line-height: 1.35 }
    .sheet { position: relative; width: ${wMm}mm; min-height: ${hMm}mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15);
      padding: ${(m.top ?? 12) + (pre ? tpl.headerSpaceMm ?? 0 : 0)}mm ${m.right ?? 12}mm ${(m.bottom ?? 12) + (pre ? tpl.footerSpaceMm ?? 0 : 0)}mm ${m.left ?? 12}mm; ${tpl.fontScale && tpl.fontScale !== 100 ? `font-size: ${9.5 * tpl.fontScale / 100}pt;` : ''} }
    .reserved { position: absolute; left: 0; right: 0; background: repeating-linear-gradient(45deg, #f4f5f7, #f4f5f7 6px, #eceef2 6px, #eceef2 12px); color: #8B90A0; font-size: 8pt; display: flex; align-items: center; justify-content: center; letter-spacing: .08em; text-transform: uppercase }
    .head { display: flex; justify-content: space-between; gap: 6mm; padding-bottom: 3mm; border-bottom: 0.7mm solid ${accent} }
    .hn { font-size: 14pt; font-weight: 700; color: ${accent} } .muted { color: #5B616E; font-size: 8pt } .title { font-weight: 700; letter-spacing: .1em; font-size: 9pt; color: #5B616E; text-transform: uppercase }
    .pt { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1mm 6mm; padding: 3mm 0; border-bottom: 0.3mm solid #E3E5EA; font-size: 8.8pt } .k { color: #8B90A0 }
    table { width: 100%; border-collapse: collapse; margin-top: 3mm } td { padding: 1.6mm 1.5mm; border-bottom: 0.2mm solid #F0F1F4; vertical-align: top }
    .foot { margin-top: 8mm; padding-top: 3mm; border-top: 0.3mm solid #E3E5EA; display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm }
    .qr { width: 18mm; height: 18mm; border: 0.3mm dashed #8B90A0; display: flex; align-items: center; justify-content: center; font-size: 7pt; color: #8B90A0 }
  </style></head><body><div class="sheet">
    ${pre ? `<div class="reserved" style="top:0;height:${tpl.headerSpaceMm ?? 0}mm">${esc(t('ui.printPreview.preprintedHeader'))}</div><div class="reserved" style="bottom:0;height:${tpl.footerSpaceMm ?? 0}mm">${esc(t('ui.printPreview.preprintedFooter'))}</div>` : ''}
    ${letterheadHtml(lh ?? {}, tpl, { name: t('ui.printPreview.yourInstitution'), ...h }, accent, right)}
    <div class="pt"><div><b>Prakash Pillai</b><div class="muted">60 Y / Male</div></div><div><span class="k">UHID</span> CC26000016</div><div><span class="k">${esc(t('common.doctor'))}</span> Dr. Ravi Prasad</div></div>
    ${sampleBody(docType)}
    <div class="foot"><div class="muted">${esc(tpl.footerText || lh?.footerText || '')}${tpl.showPrintedOn !== false ? `${tpl.footerText || lh?.footerText ? '<br/>' : ''}${esc(t('ui.printPreview.printedOn', { date: '07/10/2026' }))}` : ''}</div>
      ${tpl.showQr !== false ? '<div class="qr">QR</div>' : ''}</div>
  </div></body></html>`

  return (
    <div ref={box} className="rounded-xl border border-border bg-[#E9EBEF] overflow-hidden">
      <iframe title={t('ui.printPreview.title')} srcDoc={html} className="block w-full border-0" style={{ height }} sandbox="" />
    </div>
  )
}
