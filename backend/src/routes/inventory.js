import { Router } from 'express'
import {
  ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_DISPOSAL_METHODS, ASSET_MAINTENANCE_KINDS, ASSET_STATUS, PO_STATUS, STORE_ADJUST_REASONS,
  STORE_CATEGORIES, STORE_ISSUE_TO, STORE_MOVE_TYPES, STORE_SALE_MODES, STORE_UNITS,
} from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  adjustStock, cancelCount, deleteItem, exportItems, exportStock, getCount, getItem, importItems, importOpeningStock, inventoryMeta, issueOrReturn,
  listCounts, listItems, listMoves, postCount, saveCountLines, saveItem, startCount, stockBoard,
} from '../services/inventory.js'
import { approvePo, cancelPo, deleteVendor, exportPos, getPo, listPos, listVendors, receivePo, savePo, saveVendor, sendBackPo, submitPo } from '../services/inventoryPurchase.js'
import { cancelSale, createSale, exportSales, getSale, listSales, searchStudents } from '../services/inventorySales.js'
import { addMaintenance, deleteAsset, disposeAsset, getAsset, listAssets, removeMaintenance, saveAsset } from '../services/inventoryAssets.js'

// inventory: /api/v1/inventory/* — items, stock (ledger, issue / return, adjustments, counts), vendors and purchase
// orders, uniform & book sales, the asset register.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('inventory'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const paise = z.coerce.number().int().min(0).max(1_000_000_000)
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const qty = z.coerce.number().int().min(1, 'At least 1').max(100000)
const size = z.string().trim().max(12).optional().default('')
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50) }
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}
const rows = z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(5000), dryRun: z.boolean().default(false), branchId: optId })

const ITEMS = 'inventory.items'
const STOCK = 'inventory.stock'
const PO = 'inventory.purchase-orders'
const SALES = 'inventory.sales'
const ASSETS = 'inventory.assets'
// moving stock (issue, return, adjust, count) is the store keeper's work: whoever may edit items (the stock page's
// catalog actions are view / export / import only)
const MOVE = [`${ITEMS}.edit`]
const ANY = [`${ITEMS}.view`, `${STOCK}.view`, `${PO}.view`, `${SALES}.view`, `${ASSETS}.view`]

router.get('/meta', requirePermission(...ANY), async (req, res) => { res.json({ data: await inventoryMeta(req.auth) }) })

// ── items
const sizeBody = z.object({ size: z.string().trim().min(1).max(12), salePrice: paise.optional().nullable() })
const itemBody = z.object({
  code: z.string().trim().min(1, 'Enter a code').max(30).regex(/^[A-Za-z0-9][A-Za-z0-9-_/.]*$/, 'Letters, digits and - _ / . only'),
  name: z.string().trim().min(1, 'Enter the name').max(160),
  category: z.enum(STORE_CATEGORIES.map((c) => c.value)),
  unit: z.enum(STORE_UNITS).default('PCS'),
  rate: paise.default(0),
  sellable: z.boolean().optional(),
  salePrice: paise.optional().nullable(),
  sizes: z.array(sizeBody).max(40).default([]),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000).default(0),
  location: optionalText(60),
  hasExpiry: z.boolean().default(false),
  // GST: the HSN / SAC code and the rate (%) — printed on tax invoices and purchase orders
  hsn: z.string().trim().max(12).regex(/^[0-9A-Za-z]*$/, 'Digits only').optional(),
  gstRate: z.coerce.number().min(0).max(40).optional().nullable(),
  description: optionalText(1000),
  active: z.boolean().default(true),
})
const itemQuery = z.object({ search: z.string().max(120).optional(), category: z.enum(STORE_CATEGORIES.map((c) => c.value)).optional(), sellable: z.enum(['0', '1']).optional(), active: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'), branchId: optId, ...paging, pageSize: z.coerce.number().int().min(1).max(1000).default(100) })

router.get('/items', requirePermission(...ANY), async (req, res) => {
  const q = itemQuery.parse(req.query)
  res.json(await listItems({ ...q, sellable: q.sellable === '1' }, req.auth))
})
router.get('/items/export', requirePermission(`${ITEMS}.export`), async (req, res) => { csv(res, 'store-items.csv', await exportItems(req.auth, { branchId: optId.parse(req.query.branchId) })) })
router.post('/items/import', requirePermission(`${ITEMS}.import`), async (req, res) => {
  const { rows: r, dryRun } = rows.parse(req.body)
  res.json({ data: await importItems(r, { dryRun }, req.auth, req) })
})
router.get('/items/:id', requirePermission(...ANY), async (req, res) => { res.json({ data: await getItem(id(req), req.auth, { branchId: optId.parse(req.query.branchId) }) }) })
router.post('/items', requirePermission(`${ITEMS}.create`), async (req, res) => { res.status(201).json({ data: await saveItem(null, itemBody.parse(req.body), req.auth, req) }) })
router.patch('/items/:id', requirePermission(`${ITEMS}.edit`), async (req, res) => {
  const body = itemBody.partial().parse(req.body)
  for (const k of ['unit', 'rate', 'sizes', 'reorderLevel', 'hasExpiry', 'active']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveItem(id(req), body, req.auth, req) })
})
router.delete('/items/:id', requirePermission(`${ITEMS}.delete`), async (req, res) => { res.json({ data: await deleteItem(id(req), req.auth, req) }) })

// ── stock
const boardQuery = z.object({ branchId: optId, category: z.enum(STORE_CATEGORIES.map((c) => c.value)).optional(), search: z.string().max(120).optional(), level: z.enum(['OUT', 'LOW', 'OK', 'REORDER']).optional() })
router.get('/stock', requirePermission(`${STOCK}.view`), async (req, res) => { res.json({ data: await stockBoard(boardQuery.parse(req.query), req.auth) }) })
router.get('/stock/export', requirePermission(`${STOCK}.export`), async (req, res) => { csv(res, 'store-stock.csv', await exportStock(boardQuery.parse(req.query), req.auth)) })
router.post('/stock/import', requirePermission(`${STOCK}.import`), async (req, res) => {
  const { rows: r, dryRun, branchId } = rows.parse(req.body)
  res.json({ data: await importOpeningStock(r, { dryRun, branchId }, req.auth, req) })
})
router.get('/moves', requirePermission(`${STOCK}.view`), async (req, res) => {
  const q = z.object({ branchId: optId, itemId: optId, type: z.enum(Object.keys(STORE_MOVE_TYPES)).optional(), from: ymd.optional(), to: ymd.optional(), search: z.string().max(120).optional(), ...paging }).parse(req.query)
  res.json(await listMoves(q, req.auth))
})
const slipBody = z.object({
  branchId: optId, date: optYmd, note: optionalText(300),
  to: z.object({ kind: z.enum(STORE_ISSUE_TO), id: optId, name: optionalText(120) }),
  lines: z.array(z.object({ itemId: objectId, size, qty })).min(1, 'Add an item').max(100),
})
router.post('/stock/issue', requirePermission(...MOVE), async (req, res) => { res.status(201).json({ data: await issueOrReturn('ISSUE', slipBody.parse(req.body), req.auth, req) }) })
router.post('/stock/return', requirePermission(...MOVE), async (req, res) => { res.status(201).json({ data: await issueOrReturn('RETURN', slipBody.parse(req.body), req.auth, req) }) })
router.post('/stock/adjust', requirePermission(...MOVE), async (req, res) => {
  const body = z.object({
    branchId: optId, itemId: objectId, size, qty: z.coerce.number().int().min(-100000).max(100000).refine((n) => n !== 0, 'Enter how many more or fewer'),
    reason: z.enum(STORE_ADJUST_REASONS.map((r) => r.value)), note: optionalText(300),
  }).parse(req.body)
  res.status(201).json({ data: await adjustStock(body, req.auth, req) })
})

// ── stock counts
router.get('/counts', requirePermission(`${STOCK}.view`), async (req, res) => { res.json({ data: await listCounts({ branchId: optId.parse(req.query.branchId) }, req.auth) }) })
router.get('/counts/:id', requirePermission(`${STOCK}.view`), async (req, res) => { res.json({ data: await getCount(id(req), req.auth) }) })
router.post('/counts', requirePermission(...MOVE), async (req, res) => {
  const body = z.object({ branchId: optId, category: z.enum(STORE_CATEGORIES.map((c) => c.value)).optional().or(z.literal('').transform(() => undefined)), note: optionalText(300) }).parse(req.body ?? {})
  res.status(201).json({ data: await startCount(body, req.auth, req) })
})
router.patch('/counts/:id', requirePermission(...MOVE), async (req, res) => {
  const body = z.object({ lines: z.array(z.object({ itemId: objectId, size, countedQty: z.coerce.number().int().min(0).max(1_000_000).nullable() })).max(5000) }).parse(req.body)
  res.json({ data: await saveCountLines(id(req), body, req.auth) })
})
router.post('/counts/:id/post', requirePermission(...MOVE), async (req, res) => { res.json({ data: await postCount(id(req), req.auth, req) }) })
router.post('/counts/:id/cancel', requirePermission(...MOVE), async (req, res) => { res.json({ data: await cancelCount(id(req), req.auth, req) }) })

// ── vendors
const vendorBody = z.object({
  name: z.string().trim().min(1, 'Enter the name').max(160), contactPerson: optionalText(120), phone: optionalText(30),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('').transform(() => undefined)),
  gstin: optionalText(20), address: optionalText(500), categories: z.array(z.enum(STORE_CATEGORIES.map((c) => c.value))).max(10).default([]),
  note: optionalText(500), active: z.boolean().default(true),
})
router.get('/vendors', requirePermission(`${PO}.view`, `${ITEMS}.view`, `${ASSETS}.view`), async (req, res) => {
  const q = z.object({ search: z.string().max(120).optional(), active: z.enum(['ACTIVE', 'ALL']).default('ACTIVE') }).parse(req.query)
  res.json({ data: await listVendors(q) })
})
router.post('/vendors', requirePermission(`${PO}.create`, `${ITEMS}.create`), async (req, res) => { res.status(201).json({ data: await saveVendor(null, vendorBody.parse(req.body), req.auth, req) }) })
router.patch('/vendors/:id', requirePermission(`${PO}.edit`, `${ITEMS}.edit`), async (req, res) => {
  const body = vendorBody.partial().parse(req.body)
  for (const k of ['categories', 'active']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveVendor(id(req), body, req.auth, req) })
router.delete('/vendors/:id', requirePermission(`${ITEMS}.delete`, `${ASSETS}.delete`), async (req, res) => { res.json({ data: await deleteVendor(id(req), req) }) })
})

// ── purchase orders
const poLine = z.object({ itemId: objectId, size, qty, rate: paise.optional() })
const poBody = z.object({
  branchId: optId, vendorId: objectId, date: optYmd, expectedOn: optYmd, lines: z.array(poLine).min(1, 'Add an item').max(200),
  tax: paise.default(0), terms: optionalText(2000), note: optionalText(1000),
})
const poQuery = z.object({ status: z.enum([...Object.keys(PO_STATUS), 'OPEN', 'ALL']).default('ALL'), vendorId: optId, search: z.string().max(120).optional(), from: ymd.optional(), to: ymd.optional(), branchId: optId, ...paging })
const reason = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) })

router.get('/purchase-orders', requirePermission(`${PO}.view`), async (req, res) => { res.json(await listPos(poQuery.parse(req.query), req.auth)) })
router.get('/purchase-orders/export', requirePermission(`${PO}.view`), async (req, res) => { csv(res, 'purchase-orders.csv', await exportPos(poQuery.parse(req.query), req.auth)) })
router.get('/purchase-orders/:id', requirePermission(`${PO}.view`), async (req, res) => { res.json({ data: await getPo(id(req), req.auth) }) })
router.post('/purchase-orders', requirePermission(`${PO}.create`), async (req, res) => { res.status(201).json({ data: await savePo(null, poBody.parse(req.body), req.auth, req) }) })
router.patch('/purchase-orders/:id', requirePermission(`${PO}.edit`, `${PO}.create`), async (req, res) => {
  const body = poBody.partial().parse(req.body)
  if (req.body?.tax === undefined) delete body.tax
  res.json({ data: await savePo(id(req), body, req.auth, req) })
})
router.post('/purchase-orders/:id/submit', requirePermission(`${PO}.create`, `${PO}.edit`), async (req, res) => { res.json({ data: await submitPo(id(req), req.auth, req) }) })
router.post('/purchase-orders/:id/approve', requirePermission(`${PO}.approve`), async (req, res) => {
  res.json({ data: await approvePo(id(req), z.object({ note: optionalText(300) }).parse(req.body ?? {}), req.auth, req) })
})
router.post('/purchase-orders/:id/send-back', requirePermission(`${PO}.approve`), async (req, res) => { res.json({ data: await sendBackPo(id(req), reason.parse(req.body), req.auth, req) }) })
router.post('/purchase-orders/:id/cancel', requirePermission(`${PO}.cancel`), async (req, res) => { res.json({ data: await cancelPo(id(req), reason.parse(req.body), req.auth, req) }) })
router.post('/purchase-orders/:id/receive', requirePermission(`${PO}.edit`, ...MOVE), async (req, res) => {
  const body = z.object({
    date: optYmd, invoiceNo: optionalText(40), note: optionalText(300),
    lines: z.array(z.object({ lineId: objectId, qty: z.coerce.number().int().min(0).max(100000), expiry: optYmd })).min(1).max(200),
  }).parse(req.body)
  res.json({ data: await receivePo(id(req), body, req.auth, req) })
})

// ── uniform & book sales
const saleQuery = z.object({ date: ymd.optional(), from: ymd.optional(), to: ymd.optional(), status: z.enum(['PAID', 'CANCELLED', 'ALL']).default('ALL'), search: z.string().max(120).optional(), studentId: optId, branchId: optId, ...paging })
router.get('/students', requirePermission(`${SALES}.create`, `${SALES}.view`), async (req, res) => { res.json({ data: await searchStudents(z.string().max(80).default('').parse(req.query.search), req.auth) }) })
router.get('/sales', requirePermission(`${SALES}.view`), async (req, res) => { res.json(await listSales(saleQuery.parse(req.query), req.auth)) })
router.get('/sales/export', requirePermission(`${SALES}.view`), async (req, res) => { csv(res, 'store-sales.csv', await exportSales(saleQuery.parse(req.query), req.auth)) })
router.get('/sales/:id', requirePermission(`${SALES}.view`), async (req, res) => { res.json({ data: await getSale(id(req), req.auth) }) })
router.post('/sales', requirePermission(`${SALES}.create`), async (req, res) => {
  const body = z.object({
    studentId: objectId, branchId: optId, mode: z.enum(STORE_SALE_MODES), reference: optionalText(60), note: optionalText(300),
    lines: z.array(z.object({ itemId: objectId, size, qty: z.coerce.number().int().min(1).max(500) })).min(1, 'Add an item').max(50),
  }).parse(req.body)
  res.status(201).json({ data: await createSale(body, req.auth, req) })
})
router.post('/sales/:id/cancel', requirePermission(`${SALES}.cancel`), async (req, res) => { res.json({ data: await cancelSale(id(req), reason.parse(req.body), req.auth, req) }) })

// ── assets
const assetBody = z.object({
  assetTag: optionalText(30), name: z.string().trim().min(1, 'Enter the name').max(160), category: z.enum(ASSET_CATEGORIES.map((c) => c.value)),
  make: optionalText(80), model: optionalText(80), serialNo: optionalText(80), branchId: optId,
  roomId: objectId.optional().nullable().or(z.literal('').transform(() => null)), location: optionalText(120),
  assignedToId: objectId.optional().nullable().or(z.literal('').transform(() => null)),
  vendorId: objectId.optional().nullable().or(z.literal('').transform(() => null)), vendorName: optionalText(160),
  purchaseDate: optYmd, cost: paise.optional().nullable(), invoiceNo: optionalText(40), poNo: optionalText(40),
  warrantyEnd: optYmd, lifeYears: z.coerce.number().min(1).max(60).optional().nullable(), salvagePct: z.coerce.number().min(0).max(100).optional().nullable(),
  condition: z.enum(Object.keys(ASSET_CONDITIONS)).default('GOOD'),
  status: z.enum(Object.keys(ASSET_STATUS).filter((s) => s !== 'DISPOSED')).default('IN_USE'),
  note: optionalText(1000),
})
router.get('/assets', requirePermission(`${ASSETS}.view`), async (req, res) => {
  const q = z.object({ branchId: optId, category: z.enum(ASSET_CATEGORIES.map((c) => c.value)).optional(), status: z.enum([...Object.keys(ASSET_STATUS), 'ACTIVE', 'ALL']).default('ACTIVE'), roomId: z.string().max(30).optional(), search: z.string().max(120).optional(), assignedTo: optId }).parse(req.query)
  res.json({ data: await listAssets(q, req.auth) })
})
router.get('/assets/:id', requirePermission(`${ASSETS}.view`), async (req, res) => { res.json({ data: await getAsset(id(req), req.auth) }) })
router.post('/assets', requirePermission(`${ASSETS}.create`), async (req, res) => { res.status(201).json({ data: await saveAsset(null, assetBody.parse(req.body), req.auth, req) }) })
router.patch('/assets/:id', requirePermission(`${ASSETS}.edit`), async (req, res) => {
  const body = assetBody.partial().parse(req.body)
  for (const k of Object.keys(body)) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveAsset(id(req), body, req.auth, req) })
})
router.delete('/assets/:id', requirePermission(`${ASSETS}.delete`), async (req, res) => { res.json({ data: await deleteAsset(id(req), req.auth, req) }) })
router.post('/assets/:id/maintenance', requirePermission(`${ASSETS}.edit`), async (req, res) => {
  const body = z.object({
    date: optYmd, kind: z.enum(ASSET_MAINTENANCE_KINDS).default('REPAIR'), description: z.string().trim().min(2, 'Say what was done').max(500),
    cost: paise.optional().nullable(), vendor: optionalText(160), nextDue: optYmd, status: z.enum(['IN_USE', 'UNDER_REPAIR', 'IN_STORE']).optional(),
  }).parse(req.body)
  res.status(201).json({ data: await addMaintenance(id(req), body, req.auth, req) })
})
router.delete('/assets/:id/maintenance/:entryId', requirePermission(`${ASSETS}.edit`), async (req, res) => {
  res.json({ data: await removeMaintenance(id(req), objectId.parse(req.params.entryId), req.auth, req) })
})
router.post('/assets/:id/dispose', requirePermission(`${ASSETS}.edit`, `${ASSETS}.delete`), async (req, res) => {
  const body = z.object({ date: optYmd, method: z.enum(ASSET_DISPOSAL_METHODS), amount: paise.optional().nullable(), reason: z.string().trim().min(3, 'Say why').max(300) }).parse(req.body)
  res.json({ data: await disposeAsset(id(req), body, req.auth, req) })
})

export default router
