import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PAPER_BY, PRINT_DOC_BY } from '@schoolgiant/shared'
import { letterheadHtml } from './printLayout'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const MM = 96 / 25.4 // CSS px per mm

/** Made-up rows that look like the document, so margins and the letterhead can be judged. */
function sampleBody(docType) {
  const rows = {
    FEE_RECEIPT: [['Tuition fee — Term 2', '1', '₹18,000'], ['Transport fee — Term 2', '1', '₹6,500'], ['Total paid (UPI)', '', '₹24,500']],
    FEE_INVOICE: [['Tuition fee — Term 2', '₹18,000'], ['Transport fee — Term 2', '₹6,500'], ['Due by 10/10/2026', '₹24,500']],
    REPORT_CARD: [['English', '86 / 100', 'A2'], ['Mathematics', '92 / 100', 'A1'], ['Science', '78 / 100', 'B1']],
    HALL_TICKET: [['English', '14/10/2026', '9:30 AM'], ['Mathematics', '16/10/2026', '9:30 AM'], ['Science', '18/10/2026', '9:30 AM']],
    TRANSFER_CERTIFICATE: [['Date of admission', '02/04/2019'], ['Class last studied', 'VIII'], ['Conduct', 'Good']],
    BONAFIDE: [['This is to certify that', 'Aarav Sharma is a bonafide student of this school, studying in Class VIII-A in the year 2026-27.']],
    PAYSLIP: [['Basic', '₹32,000'], ['Dearness allowance', '₹6,400'], ['Provident fund', '−₹3,840']],
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
    <div class="pt"><div><b>Aarav Sharma</b><div class="muted">${esc(t('common.class'))} VIII-A</div></div><div><span class="k">${esc(t('common.admissionNo'))}</span> 20260142</div><div><span class="k">${esc(t('common.guardian'))}</span> Neha Sharma</div></div>
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
