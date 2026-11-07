import { formatINR } from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { getPlatformSettings } from './platformSettings.js'

// The subscription tax invoice as one HTML page: printed from Subscription & billing, turned into
// a PDF by Gotenberg (platform/pdf.js) and attached to the invoice email. Invoices carry a copy
// of the seller and buyer from the day they were issued; older ones fall back to today's details.

const SAC = '998314' // IT infrastructure and network management services (SaaS)

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const day = (d) => (d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(d)) : '—')
const STATUS = { DUE: 'Unpaid', PAID: 'Paid', VOID: 'Void' }

async function partiesOf(inv) {
  let seller = inv.seller?.name ? inv.seller : null
  if (!seller) {
    const c = (await getPlatformSettings()).company ?? {}
    seller = { name: c.name || 'SchoolGiant', legalName: c.legalName, gstin: c.gstin, stateCode: c.stateCode, address: c.address }
  }
  let billedTo = inv.billedTo?.name ? inv.billedTo : null
  if (!billedTo) {
    const t = await Tenant.findById(inv.tenantId).select('name profile').lean()
    const p = t?.profile ?? {}
    billedTo = { name: p.legalName || t?.name, address: [p.addressLine, p.city, p.state, p.pincode].filter(Boolean).join(', '), gstin: p.gstin }
  }
  return { seller, billedTo }
}

/** The invoice page (A4). */
export async function renderInvoiceHtml(inv) {
  const { seller, billedTo } = await partiesOf(inv)
  const row = (label, value, { strong, muted } = {}) => `<tr${strong ? ' class="strong"' : ''}><td${muted ? ' class="muted"' : ''}>${label}</td><td class="num">${value}</td></tr>`
  const split = inv.igst
    ? row(`IGST ${inv.gstPct}%`, formatINR(inv.igst))
    : inv.cgst || inv.sgst
      ? row(`CGST ${inv.gstPct / 2}%`, formatINR(inv.cgst)) + row(`SGST ${inv.gstPct / 2}%`, formatINR(inv.sgst))
      : row(`GST ${inv.gstPct}%`, formatINR(inv.gst))
  const list = inv.listAmount ?? inv.amount
  const paid = inv.status === 'PAID'
    ? `<p class="muted">Paid on ${day(inv.paidAt)}${inv.paymentMethod ? ` · ${esc(String(inv.paymentMethod).replace('_', ' ').toLowerCase())}` : ''}${inv.paymentRef ? ` · ${esc(inv.paymentRef)}` : ''}</p>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>
@page { size: A4; margin: 16mm }
body { font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #12141C; font-size: 13px; margin: 0 }
h1 { font-size: 20px; margin: 0 }
.muted { color: #5B616E }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px }
.right { text-align: right }
.box { border-top: 2px solid #12141C; margin-top: 20px; padding-top: 14px }
table { width: 100%; border-collapse: collapse }
td { padding: 7px 0; vertical-align: top }
td.num { text-align: right; white-space: nowrap }
tr.strong td { font-weight: 600; border-top: 1px solid #D5D8DE }
p { margin: 2px 0 }
</style></head><body>
<div class="top">
  <div><h1>Tax invoice</h1><p class="muted">${esc(inv.number)} · ${STATUS[inv.status] ?? esc(inv.status)}</p></div>
  <div class="right"><strong>${esc(seller.legalName || seller.name)}</strong>${seller.address ? `<p class="muted">${esc(seller.address)}</p>` : ''}${seller.gstin ? `<p class="muted">GSTIN ${esc(seller.gstin)}</p>` : ''}<p class="muted">SAC ${SAC}</p></div>
</div>
<div class="box top">
  <div><p class="muted">Billed to</p><strong>${esc(billedTo.name)}</strong>${billedTo.address ? `<p class="muted">${esc(billedTo.address)}</p>` : ''}${billedTo.gstin ? `<p class="muted">GSTIN ${esc(billedTo.gstin)}</p>` : ''}</div>
  <div class="right"><p class="muted">Issued ${day(inv.issuedAt)}</p><p class="muted">Due ${day(inv.dueDate)}</p>${inv.placeOfSupply ? `<p class="muted">Place of supply: state ${esc(inv.placeOfSupply)}</p>` : ''}</div>
</div>
<table class="box">
  ${row(`${esc(inv.planName)} plan · ${inv.cycle === 'YEARLY' ? 'yearly' : 'monthly'}<br><span class="muted">${day(inv.periodStart)} – ${day(inv.periodEnd)}</span>`, formatINR(list))}
  ${inv.discount ? row(`Discount${inv.discountNote ? ` <span class="muted">(${esc(inv.discountNote)})</span>` : ''}`, `− ${formatINR(inv.discount)}`) + row('Taxable value', formatINR(inv.amount), { muted: true }) : ''}
  ${split}
  ${row('Total', formatINR(inv.total), { strong: true })}
</table>
${paid}
</body></html>`
}

export const invoiceFileName = (inv) => `${inv.number}.pdf`
