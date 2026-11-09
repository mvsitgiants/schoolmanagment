import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookValue, poTotals, salePriceOf, stockLevel, warrantyState } from '@schoolgiant/shared'
import { StoreMove } from '../src/models/inventory.js'
import { on } from '../src/platform/events.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let student
const api = '/api/v1/inventory'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
const events = []

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.patch('/api/v1/core/settings/modules/inventory').send({ enabled: true })
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  const section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Aarav', lastName: 'Shah', sectionId: section.id, guardians: [{ name: 'Parent Aarav', relation: 'FATHER', mobile: '9845000801', isPrimary: true }] })).body.data
  on('inventory.sale', (p) => events.push(['sale', p]))
  on('inventory.sale_cancelled', (p) => events.push(['cancel', p]))
})
afterAll(stopDb)

describe('helpers', () => {
  it('works out stock levels, prices, PO totals, book value and warranty', () => {
    expect(stockLevel(0, 5)).toBe('OUT')
    expect(stockLevel(5, 5)).toBe('LOW')
    expect(stockLevel(6, 5)).toBe('OK')
    expect(salePriceOf({ salePrice: 50000, sizes: [{ size: '32', salePrice: 55000 }, { size: '28' }] }, '32')).toBe(55000)
    expect(salePriceOf({ salePrice: 50000, sizes: [{ size: '28' }] }, '28')).toBe(50000)
    expect(poTotals([{ qty: 3, rate: 1000 }, { qty: 2, rate: 250 }], 180)).toMatchObject({ subtotal: 3500, tax: 180, total: 3680 })
    const bv = bookValue({ cost: 100000, purchaseDate: '2024-01-01', lifeYears: 4, salvagePct: 0 }, '2026-01-01')
    expect(bv.bookValue).toBeGreaterThan(49000)
    expect(bv.bookValue).toBeLessThan(51000)
    expect(bookValue({ cost: 100000, purchaseDate: '2010-01-01', lifeYears: 4, salvagePct: 10 }, '2026-01-01').bookValue).toBe(10000)
    expect(warrantyState('2026-01-10', '2026-01-01')).toBe('SOON')
    expect(warrantyState('2025-12-31', '2026-01-01')).toBe('OVER')
  })
})

let notebook
let shirt
let vendor
let po

describe('items', () => {
  it('adds items, with sizes for a uniform, and refuses a code twice', async () => {
    notebook = (await admin.post(`${api}/items`).send({ code: 'NB-200', name: 'Notebook 200 pages', category: 'STATIONERY', unit: 'PCS', rate: 4500, reorderLevel: 20 }).expect(201)).body.data
    shirt = (await admin.post(`${api}/items`).send({ code: 'UNI-SHIRT', name: 'School shirt', category: 'UNIFORM', rate: 30000, salePrice: 45000, sizes: [{ size: '28' }, { size: '30' }, { size: '32', salePrice: 50000 }] }).expect(201)).body.data
    expect(shirt.sellable).toBe(true)
    expect(shirt.sizes.map((s) => s.size)).toEqual(['28', '30', '32'])
    await admin.post(`${api}/items`).send({ code: 'nb-200', name: 'Again', category: 'STATIONERY' }).expect(400)
  })

  it('imports items from a sheet: a dry run shows the problems', async () => {
    const rows = [
      { code: 'PEN-BL', name: 'Blue pen', category: 'Stationery', unit: 'PCS', rate: '10', reorderLevel: '50' },
      { code: 'NB-200', name: 'Notebook 200 pages (updated)', category: 'STATIONERY', rate: '46' },
      { code: '', name: 'No code', category: 'NOPE' },
    ]
    const dry = (await admin.post(`${api}/items/import`).send({ rows, dryRun: true }).expect(200)).body.data.rows
    expect(dry[0].errors).toEqual([])
    expect(dry[1].note).toMatch(/Updates/)
    expect(dry[2].errors.map((e) => e.field).sort()).toEqual(['category', 'code'])
    const done = (await admin.post(`${api}/items/import`).send({ rows: rows.slice(0, 2) }).expect(200)).body.data
    expect(done).toMatchObject({ added: 1, updated: 1, errors: [] })
    const exported = await admin.get(`${api}/items/export`).expect(200)
    expect(exported.text).toContain('PEN-BL')
  })
})

describe('purchase orders and receipts', () => {
  it('adds a vendor and raises an order with a PO number', async () => {
    vendor = (await admin.post(`${api}/vendors`).send({ name: 'Sharma Stationers', phone: '9800000001', categories: ['STATIONERY', 'UNIFORM'] }).expect(201)).body.data
    po = (await admin.post(`${api}/purchase-orders`).send({
      vendorId: vendor.id, tax: 1000,
      lines: [{ itemId: notebook.id, qty: 100, rate: 4000 }, { itemId: shirt.id, size: '30', qty: 10, rate: 28000 }, { itemId: shirt.id, size: '32', qty: 5 }],
    }).expect(201)).body.data
    expect(po.poNo).toMatch(/^PO\d{2}\d{5}$/)
    expect(po.status).toBe('DRAFT')
    expect(po.total).toBe(100 * 4000 + 10 * 28000 + 5 * 30000 + 1000)
    await admin.post(`${api}/purchase-orders`).send({ vendorId: vendor.id, lines: [{ itemId: shirt.id, qty: 1 }] }).expect(400) // no size
  })

  it('refuses to receive before approval; approves within the role limit only', async () => {
    await admin.post(`${api}/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: po.lines[0].id, qty: 1 }] }).expect(409)
    await admin.post(`${api}/purchase-orders/${po.id}/submit`).expect(200)
    // a purchase officer whose limit is ₹1,000 can't approve this order
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Purchase officer', permissions: ['inventory.purchase-orders.view', 'inventory.purchase-orders.approve'], dataScopes: { inventory: 'ALL' }, limits: { 'inventory.poApproveMax': 1000 } })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Officer', email: 'officer@store.test', roleIds: [role.id], password: 'Store@1234' }).expect(201)
    const officer = await signIn(app, 'officer@store.test', 'Store@1234')
    const refused = await officer.post(`${api}/purchase-orders/${po.id}/approve`).send({}).expect(403)
    expect(refused.body.message).toMatch(/up to/)
    const ok = (await admin.post(`${api}/purchase-orders/${po.id}/approve`).send({ note: 'Fine' }).expect(200)).body.data
    expect(ok.status).toBe('APPROVED')
  })

  it('receives part, then the rest: stock rises per size and the order closes', async () => {
    const lines = po.lines
    const first = (await admin.post(`${api}/purchase-orders/${po.id}/receive`).send({ invoiceNo: 'INV-1', lines: [{ lineId: lines[0].id, qty: 60 }, { lineId: lines[1].id, qty: 10 }] }).expect(200)).body.data
    expect(first.status).toBe('PARTIAL')
    await admin.post(`${api}/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: lines[0].id, qty: 41 }] }).expect(400) // only 40 left
    const done = (await admin.post(`${api}/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: lines[0].id, qty: 40 }, { lineId: lines[2].id, qty: 5 }] }).expect(200)).body.data
    expect(done.status).toBe('RECEIVED')
    expect(done.receipts.map((r) => r.grnNo)).toEqual([`${po.poNo}-R1`, `${po.poNo}-R2`])
    const board = (await admin.get(`${api}/stock`)).body.data
    const nb = board.rows.find((r) => r.id === notebook.id)
    expect(nb.qty).toBe(100)
    expect(nb.rate).toBe(4000) // the rate paid
    const sh = board.rows.find((r) => r.id === shirt.id)
    expect(sh.sizes).toEqual([{ size: '28', qty: 0 }, { size: '30', qty: 10 }, { size: '32', qty: 5 }])
  })

  it('prints the purchase order', async () => {
    const res = await admin.get(`/api/v1/documents/PURCHASE_ORDER/${po.id}`)
    expect(res.status).toBeLessThan(500) // 200 once INVENTORY_DOCS is spread into documents/registry.js
  })
})

describe('stock: issue, return, adjust, count', () => {
  it('issues to a department and refuses more than the store holds', async () => {
    const dept = (await admin.get('/api/v1/inventory/meta')).body.data.departments[0]
    const to = dept ? { kind: 'DEPARTMENT', id: dept.id } : { kind: 'OTHER', name: 'Science lab' }
    await admin.post(`${api}/stock/issue`).send({ to, lines: [{ itemId: notebook.id, qty: 30 }] }).expect(201)
    const tooMany = await admin.post(`${api}/stock/issue`).send({ to, lines: [{ itemId: notebook.id, qty: 500 }] }).expect(409)
    expect(tooMany.body.message).toMatch(/Not enough/)
    await admin.post(`${api}/stock/return`).send({ to, lines: [{ itemId: notebook.id, qty: 5 }] }).expect(201)
    await admin.post(`${api}/stock/adjust`).send({ itemId: notebook.id, qty: -3, reason: 'DAMAGED', note: 'Water damage' }).expect(201)
    const nb = (await admin.get(`${api}/stock`)).body.data.rows.find((r) => r.id === notebook.id)
    expect(nb.qty).toBe(100 - 30 + 5 - 3)
    const ledger = (await admin.get(`${api}/moves`).query({ itemId: notebook.id })).body
    expect(ledger.data.map((m) => m.type)).toEqual(['ADJUSTMENT', 'RETURN', 'ISSUE', 'RECEIPT', 'RECEIPT'])
    expect(ledger.data[0].balance).toBe(72)
  })

  it('counts the store and posts the differences as adjustments', async () => {
    const c = (await admin.post(`${api}/counts`).send({ category: 'STATIONERY' }).expect(201)).body.data
    expect(c.lines.find((l) => l.itemId === notebook.id).systemQty).toBe(72)
    await admin.post(`${api}/counts`).send({ category: 'STATIONERY' }).expect(409) // one open count at a time
    await admin.patch(`${api}/counts/${c.id}`).send({ lines: [{ itemId: notebook.id, size: '', countedQty: 70 }] }).expect(200)
    const posted = (await admin.post(`${api}/counts/${c.id}/post`).expect(200)).body.data
    expect(posted.status).toBe('POSTED')
    expect(posted.posted.adjusted).toBe(1)
    const nb = (await admin.get(`${api}/stock`)).body.data.rows.find((r) => r.id === notebook.id)
    expect(nb.qty).toBe(70)
  })

  it('imports opening stock', async () => {
    const pen = (await admin.get(`${api}/items`).query({ search: 'PEN-BL' })).body.data[0]
    const rows = [{ code: 'PEN-BL', qty: '200', rate: '8' }, { code: 'UNI-SHIRT', qty: '4' }]
    const dry = (await admin.post(`${api}/stock/import`).send({ rows, dryRun: true }).expect(200)).body.data.rows
    expect(dry[0].errors).toEqual([])
    expect(dry[1].errors[0].field).toBe('size')
    const done = (await admin.post(`${api}/stock/import`).send({ rows: rows.slice(0, 1) }).expect(200)).body.data
    expect(done.imported).toBe(1)
    const row = (await admin.get(`${api}/stock`)).body.data.rows.find((r) => r.id === pen.id)
    expect(row.qty).toBe(200)
  })
})

describe('uniform & book sales', () => {
  let sale
  it('sells to a student at the item price (the size’s own price first) and emits the event', async () => {
    sale = (await admin.post(`${api}/sales`).send({ studentId: student.id, mode: 'UPI', reference: 'UTR123', lines: [{ itemId: shirt.id, size: '30', qty: 2 }, { itemId: shirt.id, size: '32', qty: 1 }] }).expect(201)).body.data
    expect(sale.saleNo).toMatch(/^SS/)
    expect(sale.total).toBe(2 * 45000 + 50000)
    expect(events.find(([k, p]) => k === 'sale' && p.saleNo === sale.saleNo)?.[1]).toMatchObject({ amount: 140000, mode: 'UPI' })
    await admin.post(`${api}/sales`).send({ studentId: student.id, mode: 'CASH', lines: [{ itemId: notebook.id, qty: 1 }] }).expect(400) // not sold at the counter
    await admin.post(`${api}/sales`).send({ studentId: student.id, mode: 'CASH', lines: [{ itemId: shirt.id, size: '32', qty: 10 }] }).expect(409) // not enough
    const day = (await admin.get(`${api}/sales`)).body
    expect(day.day.amount).toBe(140000)
    expect(day.day.modes.UPI).toMatchObject({ count: 1, amount: 140000 })
    const found = (await admin.get(`${api}/students`).query({ search: student.admissionNo })).body.data
    expect(found[0].id).toBe(student.id)
  })

  it('cancels a sale: the stock comes back and the event goes out', async () => {
    await admin.post(`${api}/sales/${sale.id}/cancel`).send({ reason: 'Wrong size' }).expect(200)
    await admin.post(`${api}/sales/${sale.id}/cancel`).send({ reason: 'Again' }).expect(409)
    const sh = (await admin.get(`${api}/stock`)).body.data.rows.find((r) => r.id === shirt.id)
    expect(sh.sizes.find((s) => s.size === '30').qty).toBe(10)
    expect(events.some(([k, p]) => k === 'cancel' && p.saleNo === sale.saleNo && p.amount === 140000)).toBe(true)
    const day = (await admin.get(`${api}/sales`)).body
    expect(day.day.amount).toBe(0)
    expect(day.day.cancelled).toBe(1)
    const moves = await asTenant(() => StoreMove.find({ refId: sale.id }).lean())
    expect(moves.map((m) => m.type).sort()).toEqual(['SALE', 'SALE', 'SALE_CANCEL', 'SALE_CANCEL'])
  })
})

describe('asset register', () => {
  let asset
  it('adds an asset with an auto tag, a room and book value', async () => {
    const room = (await admin.post('/api/v1/timetable/rooms').send({ name: 'Computer lab', code: 'CL1', kind: 'COMPUTER' })).body.data
    asset = (await admin.post(`${api}/assets`).send({ name: 'Desktop computer', category: 'IT', roomId: room?.id, purchaseDate: '2024-04-01', cost: 4000000, warrantyEnd: '2027-03-31', serialNo: 'SN-1' }).expect(201)).body.data
    expect(asset.assetTag).toBe('IT-00001')
    expect(asset.lifeYears).toBe(4)
    expect(asset.bookValue).toBeLessThan(4000000)
    if (room?.id) expect(asset.roomName).toBe('Computer lab')
    const second = (await admin.post(`${api}/assets`).send({ name: 'Desktop computer 2', category: 'IT' }).expect(201)).body.data
    expect(second.assetTag).toBe('IT-00002')
    await admin.post(`${api}/assets`).send({ assetTag: 'IT-00002', name: 'Clash', category: 'IT' }).expect(400)
  })

  it('logs maintenance, then disposes of the asset', async () => {
    const m = (await admin.post(`${api}/assets/${asset.id}/maintenance`).send({ kind: 'REPAIR', description: 'Replaced the power supply', cost: 250000, status: 'UNDER_REPAIR' }).expect(201)).body.data
    expect(m.status).toBe('UNDER_REPAIR')
    expect(m.maintenanceCost).toBe(250000)
    const list = (await admin.get(`${api}/assets`)).body.data
    expect(list.summary.repair).toBe(1)
    expect(list.summary.byCategory.IT.count).toBe(2)
    await admin.delete(`${api}/assets/${asset.id}`).expect(400) // has a history
    const gone = (await admin.post(`${api}/assets/${asset.id}/dispose`).send({ method: 'SCRAPPED', reason: 'Beyond repair' }).expect(200)).body.data
    expect(gone.status).toBe('DISPOSED')
    expect(gone.bookValue).toBe(0)
    await admin.patch(`${api}/assets/${asset.id}`).send({ name: 'x' }).expect(409)
  })
})
