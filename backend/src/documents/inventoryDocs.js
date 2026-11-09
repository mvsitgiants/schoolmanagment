// Store & assets documents: the purchase order sent to a vendor (`?id=` the order) and the counter receipt of a
// uniform / book sale (`?id=` the sale). Data from services/inventoryPurchase.js and services/inventorySales.js.
import { PO_STATUS } from '@schoolgiant/shared'
import { latestPoId, poPrintData } from '../services/inventoryPurchase.js'
import { latestSaleId, salePrintData } from '../services/inventorySales.js'
import { assetLabelsData, latestAssetId } from '../services/inventoryAssets.js'

const MODE_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' }

export function purchaseOrderModel({ po: p, vendor: v, branch }) {
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
    lines: p.lines.map((l, i) => ({ n: i + 1, name: l.name, size: l.size || null, unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount, received: l.receivedQty ?? 0 })),
  }
}

export function storeSaleModel({ sale: s, branch }) {
  return {
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
    load: (id, auth) => poPrintData(id, auth),
    model: purchaseOrderModel,
    title: (m) => `Purchase order ${m.po.no} · ${m.vendor.name}`,
    sample: () => latestPoId(),
    variables: ['institution.name …', 'po.no, po.date, po.expectedOn, po.status, po.statusLabel, po.draft, po.cancelled, po.subtotal, po.tax, po.total, po.terms, po.note, po.raisedBy, po.approvedBy, po.campus, po.deliverTo',
      'vendor.name, vendor.contactPerson, vendor.phone, vendor.email, vendor.gstin, vendor.address', 'lines[] {n, name, size, unit, qty, rate, amount, received} · {{money x}} · {{words po.total}}'],
  },
  STORE_SALE_RECEIPT: {
    perms: ['inventory.sales.view'],
    load: (id, auth) => salePrintData(id, auth),
    model: storeSaleModel,
    title: (m) => `Store receipt ${m.sale.no} · ${m.student.name}`,
    sample: () => latestSaleId(),
    variables: ['institution.name …', 'sale.no, sale.date, sale.at, sale.mode, sale.reference, sale.total, sale.by, sale.cancelled, sale.cancelReason, sale.campus',
      'student.name, student.admissionNo, student.class', 'lines[] {name, size, qty, rate, amount} · {{money x}} · {{words sale.total}}'],
  },
}
