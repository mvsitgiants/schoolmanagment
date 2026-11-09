import { PO_STATUS, formatINR, poTotals } from '@schoolgiant/shared'
import { StoreItem, StorePurchaseOrder, StoreVendor } from '../models/inventory.js'
import { Branch } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { applyMove, branchFor, branchQuery, fieldsError, itemsOf, rx, siteFilter, stampOf, today } from './inventory.js'

// Vendors and purchase orders (Store › Purchase orders).
//
//   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──receive──▶ PARTIAL ──receive──▶ RECEIVED
//     ▲                   │ send back                                  │
//     └───────────────────┘                     cancel (any time before fully received; receipts stay)
//
// Approving checks the approver's role limit `inventory.poApproveMax` (rupees, like fees.refundMax): an order above
// it waits for someone with a higher limit. Each receipt (GRN) raises stock in the order's campus store and sets the
// item's rate to the price paid.

const idStr = (v) => (v ? String(v) : null)

// ───────────────────────────────────────────────────────── vendors

const vendorOut = (v) => clean(v)

export async function listVendors({ search, active = 'ACTIVE' } = {}) {
  const f = {}
  if (active === 'ACTIVE') f.active = true
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ name: rx(q) }, { contactPerson: rx(q) }, { phone: rx(q) }, { gstin: rx(q) }]
  const rows = await StoreVendor.find(f).sort({ name: 1 }).limit(2000).lean()
  const stats = await StorePurchaseOrder.aggregate([
    { $match: { vendorId: { $in: rows.map((r) => r._id) }, status: { $ne: 'CANCELLED' } } },
    { $group: { _id: '$vendorId', orders: { $sum: 1 }, value: { $sum: '$total' }, last: { $max: '$date' } } },
  ])
  const by = new Map(stats.map((s) => [String(s._id), s]))
  return rows.map((v) => ({ ...vendorOut(v), orders: by.get(String(v._id))?.orders ?? 0, ordered: by.get(String(v._id))?.value ?? 0, lastOrderOn: by.get(String(v._id))?.last ?? null }))
}

export async function saveVendor(id, input, auth, req) {
  let v
  if (id) {
    v = isOid(id) ? await StoreVendor.findById(id) : null
    if (!v) throw notFound('Vendor')
    Object.assign(v, input)
    await v.save()
  } else {
    if (await StoreVendor.exists({ name: new RegExp(`^${String(input.name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw fieldsError({ name: 'Already in the list' }, `${input.name} is already a vendor.`)
    v = await StoreVendor.create(input)
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'inventory', entityType: 'store_vendor', entityId: String(v._id), entityName: v.name, summary: `${id ? 'Updated' : 'Added'} vendor ${v.name}` }, req)
  return vendorOut(v.toObject())
}

// ───────────────────────────────────────────────────────── purchase orders

const poOut = (p) => ({
  ...clean(p), branchId: idStr(p.branchId), vendorId: idStr(p.vendorId),
  lines: (p.lines ?? []).map((l) => ({ ...l, id: String(l._id), _id: undefined, itemId: String(l.itemId), pending: Math.max(0, l.qty - (l.receivedQty ?? 0)) })),
  receipts: (p.receipts ?? []).map((r) => ({ ...r, id: String(r._id), _id: undefined, lines: (r.lines ?? []).map((l) => ({ ...l, lineId: idStr(l.lineId), itemId: idStr(l.itemId) })) })),
  received: (p.lines ?? []).reduce((s, l) => s + (l.receivedQty ?? 0), 0),
  ordered: (p.lines ?? []).reduce((s, l) => s + l.qty, 0),
})

export async function listPos({ status, vendorId, search, from, to, branchId, page = 1, pageSize = 50 }, auth) {
  const base = branchQuery(auth, branchId)
  const f = { ...base }
  if (status === 'OPEN') f.status = { $in: ['SUBMITTED', 'APPROVED', 'PARTIAL'] }
  else if (status && status !== 'ALL') f.status = status
  if (vendorId && isOid(vendorId)) f.vendorId = vendorId
  if (from || to) f.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ poNo: rx(q) }, { vendorName: rx(q) }, { 'lines.name': rx(q) }]
  const [rows, total, sums] = await Promise.all([
    StorePurchaseOrder.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    StorePurchaseOrder.countDocuments(f),
    StorePurchaseOrder.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 }, value: { $sum: '$total' } } }]),
  ])
  return { data: rows.map(poOut), total, page, pageSize, totals: Object.fromEntries(sums.map((s) => [s._id, { count: s.n, value: s.value }])) }
}

async function loadPo(id, auth) {
  const p = isOid(id) ? await StorePurchaseOrder.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!p) throw notFound('Purchase order')
  return p
}

export async function getPo(id, auth) {
  const p = await loadPo(id, auth)
  const branch = p.branchId ? await Branch.findById(p.branchId).select('name').lean() : null
  return { ...poOut(p.toObject()), branchName: branch?.name ?? null, canApprove: canApprove(auth, p.total) }
}

/** May this person approve an order of `total` paise? (Their role's poApproveMax, in rupees; none set: no cap.) */
export function canApprove(auth, total) {
  if (auth?.fullAccess) return true
  const limit = auth?.limits?.['inventory.poApproveMax']
  return limit == null || limit === '' || total <= Number(limit) * 100
}

async function buildLines(lines) {
  const checked = await itemsOf(lines)
  const { lines: priced, subtotal } = poTotals(checked.map((l) => ({ ...l, rate: l.rate ?? l.item.rate ?? 0 })))
  return {
    subtotal,
    lines: priced.map((l) => ({ itemId: l.item._id, name: l.item.name, unit: l.item.unit, size: l.size, qty: l.qty, rate: l.rate, amount: l.amount, receivedQty: 0 })),
  }
}

/** Raise (or change, while a draft) a purchase order. */
export async function savePo(id, input, auth, req) {
  const vendor = isOid(input.vendorId) ? await StoreVendor.findById(input.vendorId).lean() : null
  if (input.vendorId !== undefined && !vendor) throw fieldsError({ vendorId: 'Pick the vendor' }, 'Pick the vendor.')
  const built = input.lines ? await buildLines(input.lines) : null
  let p
  if (id) {
    p = await loadPo(id, auth)
    if (p.status !== 'DRAFT') throw conflict('Only a draft can be changed. Send it back to draft first.')
    if (vendor) Object.assign(p, { vendorId: vendor._id, vendorName: vendor.name })
    for (const k of ['date', 'expectedOn', 'terms', 'note']) if (input[k] !== undefined) p[k] = input[k]
    if (input.branchId !== undefined) p.branchId = await branchFor(auth, input.branchId)
    if (built) p.lines = built.lines
    if (input.tax !== undefined) p.tax = input.tax
    const t = poTotals(p.lines.map((l) => ({ qty: l.qty, rate: l.rate })), p.tax)
    Object.assign(p, { subtotal: t.subtotal, total: t.total })
    await p.save()
  } else {
    if (!vendor) throw fieldsError({ vendorId: 'Pick the vendor' }, 'Pick the vendor.')
    if (!built?.lines.length) throw fieldsError({ lines: 'Add an item' }, 'Add at least one item.')
    const branchId = await branchFor(auth, input.branchId)
    const date = input.date || await today()
    const t = poTotals(built.lines, input.tax)
    p = await StorePurchaseOrder.create({
      poNo: await nextNumber('PO', { branchId, date: new Date(`${date}T12:00:00Z`) }), branchId, vendorId: vendor._id, vendorName: vendor.name, date,
      expectedOn: input.expectedOn, lines: built.lines, subtotal: t.subtotal, tax: t.tax, total: t.total, terms: input.terms, note: input.note, created: stampOf(auth),
    })
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'inventory', entityType: 'purchase_order', entityId: String(p._id), entityName: p.poNo, summary: `${id ? 'Changed' : 'Raised'} purchase order ${p.poNo} on ${p.vendorName} for ${formatINR(p.total)}` }, req)
  return getPo(p._id, auth)
}

/** Move an order from one status to the next, guarded by the status it must be in now. */
async function step(id, from, to, set, auth) {
  const p = await loadPo(id, auth)
  if (!from.includes(p.status)) throw conflict(`This order is ${PO_STATUS[p.status]?.label.toLowerCase() ?? p.status}.`)
  const r = await StorePurchaseOrder.updateOne({ _id: p._id, status: p.status }, { $set: { status: to, ...set } })
  if (!r.modifiedCount) throw conflict('Someone else just changed this order. Open it again.')
  return p
}

export async function submitPo(id, auth, req) {
  const p = await loadPo(id, auth)
  if (!p.lines.length) throw badRequest('Add at least one item.')
  await step(id, ['DRAFT'], 'SUBMITTED', { submitted: stampOf(auth) }, auth)
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'purchase_order', entityId: String(p._id), entityName: p.poNo, summary: `Sent purchase order ${p.poNo} (${formatINR(p.total)}) for approval` }, req)
  return getPo(id, auth)
}

export async function approvePo(id, { note }, auth, req) {
  const p = await loadPo(id, auth)
  if (!canApprove(auth, p.total)) {
    throw forbidden(`Your role can approve purchase orders up to ${formatINR(Number(auth.limits['inventory.poApproveMax']) * 100)}. This one is ${formatINR(p.total)} — someone with a higher limit approves it.`, { code: 'PO_LIMIT' })
  }
  await step(id, ['SUBMITTED'], 'APPROVED', { approved: { ...stampOf(auth), note } }, auth)
  await audit({ action: 'APPROVE', module: 'inventory', entityType: 'purchase_order', entityId: String(p._id), entityName: p.poNo, summary: `Approved purchase order ${p.poNo} on ${p.vendorName} for ${formatINR(p.total)}${note ? ` — ${note}` : ''}` }, req)
  return getPo(id, auth)
}

/** The approver sends an order back to its maker as a draft, with the reason. */
export async function sendBackPo(id, { reason }, auth, req) {
  const p = await step(id, ['SUBMITTED', 'APPROVED'], 'DRAFT', { note: reason }, auth)
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'purchase_order', entityId: String(p._id), entityName: p.poNo, summary: `Sent purchase order ${p.poNo} back to draft: ${reason}` }, req)
  return getPo(id, auth)
}

export async function cancelPo(id, { reason }, auth, req) {
  const p = await step(id, ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIAL'], 'CANCELLED', { cancelled: { ...stampOf(auth), reason } }, auth)
  await audit({ action: 'CANCEL', module: 'inventory', entityType: 'purchase_order', entityId: String(p._id), entityName: p.poNo, summary: `Cancelled purchase order ${p.poNo}${p.status === 'PARTIAL' ? ' (the rest of it)' : ''}: ${reason}` }, req)
  return getPo(id, auth)
}

/**
 * Receive goods against an approved order (a GRN): any part of each line still pending. Stock goes up in the order's
 * campus store, the item's rate becomes the order's rate, and the order is PARTIAL until every line is in.
 */
export async function receivePo(id, { date, invoiceNo, note, lines }, auth, req) {
  const day = date || await today()
  if (day > await today()) throw fieldsError({ date: 'Pick today or earlier' }, 'The date is in the future.')
  const want = lines.filter((l) => l.qty > 0)
  if (!want.length) throw fieldsError({ lines: 'Enter what came' }, 'Enter how many of each item came.')
  const result = await withTransaction(async () => {
    const p = await loadPo(id, auth)
    if (!['APPROVED', 'PARTIAL'].includes(p.status)) throw conflict(p.status === 'RECEIVED' ? 'Everything on this order is already received.' : 'Only an approved order can be received.')
    const items = new Map((await StoreItem.find({ _id: { $in: p.lines.map((l) => l.itemId) } }).lean()).map((i) => [String(i._id), i]))
    const grnNo = `${p.poNo}-R${p.receipts.length + 1}`
    const got = []
    let value = 0
    for (const w of want) {
      const line = p.lines.id(w.lineId)
      if (!line) throw fieldsError({ lines: 'A line was not found' }, 'A line of this order was not found. Open it again.')
      const pending = line.qty - (line.receivedQty ?? 0)
      if (w.qty > pending) throw fieldsError({ [`lines.${w.lineId}`]: `Up to ${pending}` }, `Only ${pending} of ${line.name}${line.size ? ` (${line.size})` : ''} are still to come.`)
      const item = items.get(String(line.itemId))
      if (!item) throw notFound(`Item ${line.name}`)
      line.receivedQty = (line.receivedQty ?? 0) + w.qty
      await applyMove({ item, branchId: p.branchId, size: line.size ?? '', type: 'RECEIPT', qty: w.qty, rate: line.rate, refType: 'PO', refId: p._id, refNo: grnNo, note: invoiceNo ? `Invoice ${invoiceNo}` : undefined, date: day, expiry: w.expiry }, auth)
      if (item.rate !== line.rate) await StoreItem.updateOne({ _id: item._id }, { $set: { rate: line.rate } })
      got.push({ lineId: line._id, itemId: line.itemId, name: line.name, size: line.size, qty: w.qty, expiry: w.expiry })
      value += w.qty * line.rate
    }
    p.receipts.push({ grnNo, date: day, invoiceNo, note, lines: got, value, ...stampOf(auth) })
    p.status = p.lines.every((l) => (l.receivedQty ?? 0) >= l.qty) ? 'RECEIVED' : 'PARTIAL'
    await p.save()
    return { p, grnNo, value, count: got.length }
  })
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'purchase_order', entityId: String(result.p._id), entityName: result.p.poNo, summary: `Received ${result.count} line(s) worth ${formatINR(result.value)} against ${result.p.poNo} (${result.grnNo})${invoiceNo ? `, invoice ${invoiceNo}` : ''}` }, req)
  return getPo(id, auth)
}

export async function exportPos(q, auth) {
  const { data } = await listPos({ ...q, page: 1, pageSize: 20000 }, auth)
  const head = ['PO no.', 'Date', 'Vendor', 'Status', 'Lines', 'Subtotal', 'Tax', 'Total', 'Expected on', 'Approved by']
  const rupees = (p) => ((p ?? 0) / 100).toFixed(2)
  return [head, ...data.map((p) => [p.poNo, p.date, p.vendorName, PO_STATUS[p.status]?.label ?? p.status, p.lines.length, rupees(p.subtotal), rupees(p.tax), rupees(p.total), p.expectedOn, p.approved?.by])]
    .map((r) => r.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── print

/** PURCHASE_ORDER document data (documents/inventoryDocs.js). */
export async function poPrintData(id, auth) {
  const p = await loadPo(id, auth)
  const [vendor, branch] = await Promise.all([StoreVendor.findById(p.vendorId).lean(), p.branchId ? Branch.findById(p.branchId).lean() : null])
  return { po: p.toObject(), vendor, branch }
}

export const latestPoId = async () => (await StorePurchaseOrder.findOne({ status: { $ne: 'DRAFT' } }).sort({ createdAt: -1 }).select('_id').lean())?._id
  ?? (await StorePurchaseOrder.findOne().sort({ createdAt: -1 }).select('_id').lean())?._id
