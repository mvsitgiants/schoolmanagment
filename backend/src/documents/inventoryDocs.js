// Store & assets documents: the purchase order sent to a vendor (`?id=` the order) and the counter receipt of a
// uniform / book sale (`?id=` the sale). Data from services/inventoryPurchase.js and services/inventorySales.js.
import { GST_STATE_CODES, PO_STATUS, gstStateOf, stateCodeOf } from '@schoolgiant/shared'
import { StoreItem } from '../models/inventory.js'
import { latestPoId, poPrintData } from '../services/inventoryPurchase.js'
import { latestSaleId, salePrintData } from '../services/inventorySales.js'
import { assetLabelsData, latestAssetId } from '../services/inventoryAssets.js'
import { getLetterhead } from '../services/printing.js'

const MODE_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' }

// ───────────────────────────────────────────────────────── GST on printed bills

/** The HSN / SAC code and GST rate of each item on a sale or order (from the store item), and the institution. */
async function withTax(data, lines) {
  const ids = [...new Set(lines.map((l) => String(l.itemId)).filter(Boolean))]
  const items = ids.length ? await StoreItem.find({ _id: { $in: ids } }).select('hsn gstRate').lean() : []
  const { institution } = await getLetterhead()
  return { ...data, institution, itemTax: Object.fromEntries(items.map((i) => [String(i._id), { hsn: i.hsn || null, rate: typeof i.gstRate === 'number' ? i.gstRate : null }])) }
}
const taxOf = (itemTax, l) => itemTax?.[String(l.itemId)] ?? { hsn: null, rate: null }
/** The two-digit GST state code of the institution: its GSTIN, else its state. */
const homeState = (inst) => gstStateOf(inst?.gstin) ?? GST_STATE_CODES[stateCodeOf(inst?.state)] ?? null
const half = (n) => Math.round(n / 2)
/** "9%" for a rate that is the same on every taxed line ('' when they differ). */
const oneRate = (rates) => { const r = [...new Set(rates.filter((x) => x > 0))]; return r.length === 1 ? r[0] : null }

export function purchaseOrderModel({ po: p, vendor: v, branch, institution, itemTax }) {
  // GST: CGST + SGST when the vendor is in the institution's state (or unknown), IGST across states
  const home = homeState(institution)
  const vendorState = gstStateOf(v?.gstin)
  const inter = !!(home && vendorState && home !== vendorState)
  const lineRates = p.lines.map((l) => taxOf(itemTax, l).rate)
  const rate = oneRate(lineRates)
  const tax = p.tax ?? 0
  return {
    po: {
      no: p.poNo, date: p.date, expectedOn: p.expectedOn ?? null, status: p.status, statusLabel: PO_STATUS[p.status]?.label ?? p.status,
      draft: ['DRAFT', 'SUBMITTED'].includes(p.status), cancelled: p.status === 'CANCELLED', cancelReason: p.cancelled?.reason ?? null,
      subtotal: p.subtotal, tax: p.tax, total: p.total, terms: p.terms ?? null, note: p.note ?? null,
      raisedBy: p.created?.by ?? null, approvedBy: p.approved?.by ?? null, approvedAt: p.approved?.at ?? null, campus: branch?.name ?? null,
      deliverTo: [branch?.name, branch?.addressLine, branch?.city, branch?.pincode].filter(Boolean).join(', ') || null,
    },
    vendor: {
      name: v?.name ?? p.vendorName, contactPerson: v?.contactPerson ?? null, phone: v?.phone ?? null, email: v?.email ?? null,
      gstin: v?.gstin ?? null, address: v?.address ?? null,
    },
    lines: p.lines.map((l, i) => ({ n: i + 1, name: l.name, size: l.size || null, unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount, received: l.receivedQty ?? 0, hsn: taxOf(itemTax, l).hsn, gstRate: taxOf(itemTax, l).rate })),
    gst: {
      taxable: p.subtotal, tax, inter, intra: !inter, rate,
      cgst: inter ? 0 : half(tax), sgst: inter ? 0 : tax - half(tax), igst: inter ? tax : 0,
      cgstRate: !inter && rate ? rate / 2 : null, sgstRate: !inter && rate ? rate / 2 : null, igstRate: inter && rate ? rate : null,
      placeOfSupply: institution?.state ?? null, vendorState,
    },
    buyer: { gstin: institution?.gstin ?? null, pan: institution?.pan ?? null, legalName: institution?.legalName ?? null },
  }
}

export function storeSaleModel({ sale: s, branch, institution, itemTax }) {
  // sale prices include GST: the taxable value is taken back out of each line (CGST + SGST, a counter sale in the state)
  const lines = s.lines.map((l, i) => {
    const { hsn, rate } = taxOf(itemTax, l)
    const taxable = rate ? Math.round((l.amount * 100) / (100 + rate)) : l.amount
    const tax = l.amount - taxable
    return { sl: i + 1, name: l.name, size: l.size || null, qty: l.qty, rate: l.rate, amount: l.amount, hsn, gstRate: rate, taxable, cgst: half(tax), sgst: tax - half(tax), halfRate: rate ? rate / 2 : null }
  })
  const sum = (f) => lines.reduce((n, l) => n + (f(l) || 0), 0)
  const registered = !!institution?.gstin
  const taxed = lines.some((l) => l.gstRate > 0)
  const rate = oneRate(lines.map((l) => l.gstRate))
  return {
    gst: {
      registered, taxed, taxInvoice: registered && taxed, billOfSupply: registered && !taxed, cashMemo: !registered,
      taxable: sum((l) => l.taxable), cgst: sum((l) => l.cgst), sgst: sum((l) => l.sgst), tax: sum((l) => l.cgst + l.sgst),
      rate, halfRate: rate ? rate / 2 : null,
      // the tax rate by rate, as GST invoices summarise it: CGST @ 2.5% and SGST @ 2.5% on the 5% items, and so on
      byRate: [...new Set(lines.filter((l) => l.gstRate > 0).map((l) => l.gstRate))].sort((a, b) => a - b).map((r) => {
        const at = lines.filter((l) => l.gstRate === r)
        return { rate: r, half: r / 2, taxable: at.reduce((n, l) => n + l.taxable, 0), cgst: at.reduce((n, l) => n + l.cgst, 0), sgst: at.reduce((n, l) => n + l.sgst, 0) }
      }),
      placeOfSupply: institution?.state ?? null,
    },
    rows: lines,
    sale: {
      no: s.saleNo, date: s.date, at: s.at, mode: MODE_LABEL[s.mode] ?? s.mode, reference: s.reference ?? null, total: s.total, by: s.by,
      cancelled: s.status === 'CANCELLED', cancelReason: s.cancelled?.reason ?? null, campus: branch?.name ?? null,
    },
    student: { name: s.student?.name, admissionNo: s.student?.admissionNo, class: s.student?.class ?? '' },
    lines: s.lines.map((l) => ({ name: l.name, size: l.size || null, qty: l.qty, rate: l.rate, amount: l.amount })),
  }
}

export const INVENTORY_DOCS = {
  // asset tag labels: many at once (GET /documents/ASSET_LABEL?ids=…) — scanned in a physical audit (Scan › Verify)
  ASSET_LABEL: {
    perms: ['inventory.assets.view'],
    many: true,
    load: (ids) => assetLabelsData(ids),
    model: (d) => ({ ...d, count: d.labels.length }),
    title: (m) => `Asset labels (${m.count})`,
    sample: () => latestAssetId(),
    variables: ['institution.name', 'labels[] {tag, name, category, place} · count · {{barcode tag 9}}'],
  },
  PURCHASE_ORDER: {
    perms: ['inventory.purchase-orders.view', 'inventory.purchase-orders.print'],
    load: async (id, auth) => { const d = await poPrintData(id, auth); return withTax(d, d.po.lines) },
    model: purchaseOrderModel,
    title: (m) => `Purchase order ${m.po.no} · ${m.vendor.name}`,
    sample: () => latestPoId(),
    variables: ['institution.name …', 'po.no, po.date, po.expectedOn, po.status, po.statusLabel, po.draft, po.cancelled, po.subtotal, po.tax, po.total, po.terms, po.note, po.raisedBy, po.approvedBy, po.campus, po.deliverTo',
      'vendor.name, vendor.contactPerson, vendor.phone, vendor.email, vendor.gstin, vendor.address', 'lines[] {n, name, size, unit, qty, rate, amount, received, hsn, gstRate} · {{money x}} · {{words po.total}}',
      'gst {taxable, tax, intra, inter, rate, cgst, sgst, igst, cgstRate, sgstRate, igstRate, placeOfSupply} · buyer {gstin, pan, legalName}'],
  },
  STORE_SALE_RECEIPT: {
    perms: ['inventory.sales.view'],
    load: async (id, auth) => { const d = await salePrintData(id, auth); return withTax(d, d.sale.lines) },
    model: storeSaleModel,
    title: (m) => `Store receipt ${m.sale.no} · ${m.student.name}`,
    sample: () => latestSaleId(),
    variables: ['institution.name …', 'sale.no, sale.date, sale.at, sale.mode, sale.reference, sale.total, sale.by, sale.cancelled, sale.cancelReason, sale.campus',
      'student.name, student.admissionNo, student.class', 'lines[] {name, size, qty, rate, amount} · {{money x}} · {{words sale.total}}',
      'rows[] {sl, name, size, qty, rate, amount, hsn, gstRate, halfRate, taxable, cgst, sgst} · gst {registered, taxInvoice, billOfSupply, cashMemo, taxable, cgst, sgst, tax, rate, placeOfSupply, byRate[] {rate, half, taxable, cgst, sgst}}'],
  },
}
