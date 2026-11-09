import mongoose from 'mongoose'
import {
  STORE_ADJUST_REASONS, STORE_CATEGORIES, STORE_CATEGORY_BY, STORE_UNITS, formatINR, normSize, stockLevel,
} from '@schoolgiant/shared'
import { StoreCount, StoreItem, StoreMove, StorePurchaseOrder, StoreSale, StoreStock, StoreVendor } from '../models/inventory.js'
import { Room } from '../models/timetable.js'
import { Branch, Department, User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { institutionNow } from '../platform/time.js'

// Store & assets (module `inventory`) — items, stock and the stock ledger, stock counts, imports and exports.
// Purchase orders and vendors: services/inventoryPurchase.js · counter sales: services/inventorySales.js ·
// asset register: services/inventoryAssets.js.
//
// Stock is kept per campus store (branchId) and per size (uniforms; '' for everything else). Every change goes
// through applyMove(), inside a transaction: the stock row moves with one atomic $inc (never below zero) and the
// ledger gets its line with the balance after it.

export const today = async () => (await institutionNow()).date
export const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
export const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
export const stampOf = (auth) => ({ by: auth?.user?.name ?? 'System', byId: auth?.userId && isOid(auth.userId) ? oid(auth.userId) : undefined, at: new Date() })
const idStr = (v) => (v ? String(v) : null)

/** Campus scope: someone on one campus works with that campus's store (and records on no campus). */
export function siteFilter(auth) {
  if (!auth || scopeOf(auth, 'inventory') === 'ALL' || !auth.user?.branchId) return {}
  return { branchId: { $in: [oid(auth.user.branchId), null] } }
}

/**
 * The campus a write goes to: the caller's own when their scope is one campus, else the one picked, else their
 * own, else the institution's default campus.
 */
export async function branchFor(auth, branchId) {
  const mine = auth?.user?.branchId ? String(auth.user.branchId) : null
  if (scopeOf(auth, 'inventory') !== 'ALL' && mine) {
    if (branchId && String(branchId) !== mine) throw forbidden('You work with your own campus store only.')
    return oid(mine)
  }
  if (branchId) {
    const b = isOid(branchId) ? await Branch.findById(branchId).select('_id').lean() : null
    if (!b) throw fieldsError({ branchId: 'Pick the campus again' }, 'That campus was not found.')
    return b._id
  }
  if (mine) return oid(mine)
  return (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id ?? (await Branch.findOne().select('_id').lean())?._id ?? null
}

/** A read's campus filter: the one asked for (when in scope), else everything in scope. */
export function branchQuery(auth, branchId) {
  if (branchId && isOid(branchId)) {
    const scoped = siteFilter(auth)
    if (scoped.branchId && !scoped.branchId.$in.some((b) => String(b) === String(branchId))) throw forbidden('You work with your own campus store only.')
    return { branchId: oid(branchId) }
  }
  return siteFilter(auth)
}

// ───────────────────────────────────────────────────────── meta

/** Pickers for every screen: campuses, departments, rooms, staff, vendors, the categories in use, my limits. */
export async function inventoryMeta(auth) {
  const [branches, departments, rooms, users, vendors, date] = await Promise.all([
    Branch.find({ active: { $ne: false } }).select('name code isDefault').sort({ isDefault: -1, name: 1 }).lean(),
    Department.find({ active: { $ne: false } }).select('name code').sort({ name: 1 }).lean(),
    Room.find({ active: { $ne: false } }).select('name code kind branchId').sort({ name: 1 }).lean(),
    User.find({ active: true }).select('name designation branchId').sort({ name: 1 }).limit(2000).lean(),
    StoreVendor.find({ active: true }).select('name phone contactPerson categories').sort({ name: 1 }).limit(2000).lean(),
    today(),
  ])
  const scoped = scopeOf(auth, 'inventory') !== 'ALL' && !!auth.user?.branchId
  const mine = idStr(auth.user?.branchId)
  const limit = auth.limits?.['inventory.poApproveMax']
  const id = (x) => String(x._id)
  return {
    today: date,
    myBranchId: mine ?? (branches.find((b) => b.isDefault) ? id(branches.find((b) => b.isDefault)) : null),
    branchLocked: scoped,
    branches: (scoped ? branches.filter((b) => id(b) === mine) : branches).map((b) => ({ id: id(b), name: b.name, code: b.code, isDefault: !!b.isDefault })),
    departments: departments.map((d) => ({ id: id(d), name: d.name, code: d.code })),
    rooms: rooms.map((r) => ({ id: id(r), name: r.name, code: r.code, kind: r.kind, branchId: idStr(r.branchId) })),
    staff: users.map((u) => ({ id: id(u), name: u.name, designation: u.designation ?? null, branchId: idStr(u.branchId) })),
    vendors: vendors.map((v) => ({ id: id(v), name: v.name, phone: v.phone ?? null, contactPerson: v.contactPerson ?? null, categories: v.categories ?? [] })),
    poApproveMax: auth.fullAccess || limit == null || limit === '' ? null : Number(limit) * 100, // paise; null: no limit
  }
}

// ───────────────────────────────────────────────────────── items

const itemOut = (i) => ({ ...clean(i), sizes: (i.sizes ?? []).map((s) => ({ size: s.size, salePrice: s.salePrice ?? null })) })

/** Stock of these items, per item: total and per size (in the campus filter given). */
async function stockOf(itemIds, filter) {
  const rows = await StoreStock.find({ itemId: { $in: itemIds }, ...filter }).lean()
  const out = new Map()
  for (const r of rows) {
    const k = String(r.itemId)
    const t = out.get(k) ?? { qty: 0, sizes: {}, expiry: null }
    t.qty += r.qty
    t.sizes[r.size || ''] = (t.sizes[r.size || ''] ?? 0) + r.qty
    if (r.qty > 0 && r.expiry && (!t.expiry || r.expiry < t.expiry)) t.expiry = r.expiry
    out.set(k, t)
  }
  return out
}

/** The item list (Items page, pickers): search by name or code, by category; with stock in the campus asked for. */
export async function listItems({ search, category, sellable, active = 'ACTIVE', branchId, page = 1, pageSize = 100 }, auth) {
  const f = {}
  if (active === 'ACTIVE') f.active = true
  else if (active === 'INACTIVE') f.active = false
  if (category) f.category = category
  if (sellable) f.sellable = true
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ name: rx(q) }, { code: q.toUpperCase() }, { code: rx(q) }]
  const [rows, total, byCategory] = await Promise.all([
    StoreItem.find(f).sort({ category: 1, name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    StoreItem.countDocuments(f),
    StoreItem.aggregate([{ $match: { active: true } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
  ])
  const stock = await stockOf(rows.map((r) => r._id), branchQuery(auth, branchId))
  return {
    data: rows.map((i) => {
      const s = stock.get(String(i._id)) ?? { qty: 0, sizes: {}, expiry: null }
      return { ...itemOut(i), stock: s.qty, stockBySize: s.sizes, expiry: s.expiry, level: stockLevel(s.qty, i.reorderLevel), value: s.qty * (i.rate ?? 0) }
    }),
    total, page, pageSize,
    categories: Object.fromEntries(byCategory.map((c) => [c._id, c.n])),
  }
}

export async function getItem(id, auth, { branchId } = {}) {
  const i = isOid(id) ? await StoreItem.findById(id).lean() : null
  if (!i) throw notFound('Item')
  const filter = branchQuery(auth, branchId)
  const [rows, moves, branches] = await Promise.all([
    StoreStock.find({ itemId: i._id, ...filter }).lean(),
    StoreMove.find({ itemId: i._id, ...filter }).sort({ at: -1 }).limit(40).lean(),
    Branch.find().select('name').lean(),
  ])
  const bName = new Map(branches.map((b) => [String(b._id), b.name]))
  return {
    ...itemOut(i),
    stockRows: rows.map((r) => ({ branchId: idStr(r.branchId), branch: bName.get(String(r.branchId)) ?? null, size: r.size, qty: r.qty, expiry: r.expiry ?? null })),
    stock: rows.reduce((s, r) => s + r.qty, 0),
    moves: moves.map(moveOut),
  }
}

function cleanSizes(sizes = []) {
  const seen = new Set()
  const out = []
  for (const s of sizes) {
    const size = normSize(typeof s === 'string' ? s : s?.size)
    if (!size || seen.has(size)) continue
    seen.add(size)
    out.push({ size, salePrice: typeof s === 'object' && s?.salePrice != null && s.salePrice !== '' ? Math.round(Number(s.salePrice)) : undefined })
  }
  return out
}

/** Add or change an item. Sizes that hold stock can't be taken off. */
export async function saveItem(id, input, auth, req) {
  const data = { ...input }
  if (data.code) data.code = data.code.trim().toUpperCase()
  if (data.sizes) data.sizes = cleanSizes(data.sizes)
  if (data.category && data.sellable === undefined && !id) data.sellable = !!STORE_CATEGORY_BY[data.category]?.sellable
  if (data.code && await StoreItem.exists({ code: data.code, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: 'Already used by another item' }, `Item code ${data.code} is already used.`)
  let item
  if (id) {
    item = isOid(id) ? await StoreItem.findById(id) : null
    if (!item) throw notFound('Item')
    if (data.sizes) {
      const keep = new Set(data.sizes.map((s) => s.size))
      const dropped = item.sizes.map((s) => s.size).filter((s) => !keep.has(s))
      if (dropped.length && await StoreStock.exists({ itemId: item._id, size: { $in: dropped }, qty: { $gt: 0 } })) throw fieldsError({ sizes: 'A size you removed still has stock' }, `Size ${dropped.join(', ')} still has stock — issue or adjust it first.`)
      if (!item.sizes.length && data.sizes.length && await StoreStock.exists({ itemId: item._id, size: '', qty: { $gt: 0 } })) throw fieldsError({ sizes: 'This item has stock without a size' }, 'This item has stock kept without a size. Adjust it to zero before adding sizes.')
    }
    Object.assign(item, data)
    await item.save()
  } else {
    item = await StoreItem.create({ ...data, createdBy: auth.user?.name })
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'inventory', entityType: 'store_item', entityId: String(item._id), entityName: item.name, summary: `${id ? 'Updated' : 'Added'} store item ${item.code} · ${item.name}` }, req)
  return itemOut(item.toObject())
}

/** Delete an item nothing has happened to; one with a history is switched off instead. */
export async function deleteItem(id, auth, req) {
  const item = isOid(id) ? await StoreItem.findById(id) : null
  if (!item) throw notFound('Item')
  const used = await StoreMove.exists({ itemId: item._id }) || await StorePurchaseOrder.exists({ 'lines.itemId': item._id })
  if (used) {
    if (await StoreStock.exists({ itemId: item._id, qty: { $gt: 0 } })) throw conflict('This item still has stock. Issue or adjust it to zero first.')
    item.active = false
    await item.save()
    await audit({ action: 'UPDATE', module: 'inventory', entityType: 'store_item', entityId: String(item._id), entityName: item.name, summary: `Switched off store item ${item.code} (it has a history)` }, req)
    return { deleted: false, deactivated: true }
  }
  await StoreStock.deleteMany({ itemId: item._id })
  await item.deleteOne()
  await audit({ action: 'DELETE', module: 'inventory', entityType: 'store_item', entityId: String(item._id), entityName: item.name, summary: `Deleted store item ${item.code} · ${item.name}` }, req)
  return { deleted: true }
}

const pick = (list, v) => {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  const hit = list.find((x) => x.value === s.toUpperCase() || x.label.toLowerCase() === s.toLowerCase())
  return hit ? hit.value : null
}
const rupeesCell = (v) => {
  const s = String(v ?? '').replace(/[₹,\s]/g, '')
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN
}

/** Items from a spreadsheet. Dry run: each row with its problems. A code already there updates that item. */
export async function importItems(rows, { dryRun }, auth, req) {
  const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const existing = new Map((await StoreItem.find().select('code').lean()).map((i) => [i.code, String(i._id)]))
  const seen = new Set()
  const out = rows.map((f, i) => {
    const errors = []
    const code = cell(f.code).toUpperCase()
    const category = pick(STORE_CATEGORIES, f.category)
    const unit = cell(f.unit).toUpperCase() || 'PCS'
    const rate = rupeesCell(f.rate)
    const salePrice = rupeesCell(f.salePrice)
    const reorderLevel = cell(f.reorderLevel) ? Number(cell(f.reorderLevel)) : 0
    const sizes = cleanSizes(cell(f.sizes).split(/[,;|/]+/))
    const doc = {
      code, name: cell(f.name), category: category ?? 'OTHER', unit, rate: rate ?? 0, salePrice, reorderLevel, sizes,
      location: cell(f.location) || undefined, sellable: ['yes', 'y', 'true', '1'].includes(cell(f.sellable).toLowerCase()) || (!cell(f.sellable) && !!STORE_CATEGORY_BY[category]?.sellable),
    }
    if (!code) errors.push({ field: 'code', message: 'Enter the item code' })
    else if (!/^[A-Z0-9][A-Z0-9-_/.]{0,29}$/.test(code)) errors.push({ field: 'code', message: 'Letters, digits and - _ / . only' })
    else if (seen.has(code)) errors.push({ field: 'code', message: 'Twice in this file' })
    seen.add(code)
    if (!doc.name) errors.push({ field: 'name', message: 'Enter the item name' })
    if (category === null || category === undefined) errors.push({ field: 'category', message: `Use one of ${STORE_CATEGORIES.map((c) => c.value).join(', ')}` })
    if (!STORE_UNITS.includes(unit)) errors.push({ field: 'unit', message: `Use one of ${STORE_UNITS.join(', ')}` })
    if (Number.isNaN(rate)) errors.push({ field: 'rate', message: 'Not an amount' })
    if (Number.isNaN(salePrice)) errors.push({ field: 'salePrice', message: 'Not an amount' })
    if (!(Number.isInteger(reorderLevel) && reorderLevel >= 0)) errors.push({ field: 'reorderLevel', message: 'A whole number' })
    return { row: i + 1, fields: f, errors, doc, existing: existing.get(code) ?? null }
  })
  if (dryRun) return { rows: out.map(({ doc, existing, ...r }) => ({ ...r, note: existing ? 'Updates the item already there' : undefined })) }
  let imported = 0
  let updated = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    try {
      if (r.existing) {
        const { code, ...rest } = r.doc
        if (!rest.sizes.length) delete rest.sizes
        await saveItem(r.existing, rest, auth, null)
        updated++
      } else {
        await StoreItem.create({ ...r.doc, createdBy: auth.user?.name })
        imported++
      }
    } catch (e) {
      errors.push({ row: r.row, field: e.details?.fields ? Object.keys(e.details.fields)[0] : 'code', message: e.message })
    }
  }
  if (imported || updated) await audit({ action: 'IMPORT', module: 'inventory', entityType: 'store_item', entityName: `${imported + updated} items`, summary: `Imported store items from a file: ${imported} added, ${updated} updated` }, req)
  return { imported: imported + updated, added: imported, updated, errors }
}

export async function exportItems(auth, { branchId } = {}) {
  const { data } = await listItems({ active: 'ALL', branchId, pageSize: 100000 }, auth)
  const head = ['code', 'name', 'category', 'unit', 'rate', 'salePrice', 'sellable', 'sizes', 'reorderLevel', 'location', 'stock', 'active']
  const rupees = (p) => (p == null ? '' : (p / 100).toFixed(2))
  return [head, ...data.map((i) => [i.code, i.name, i.category, i.unit, rupees(i.rate), rupees(i.salePrice), i.sellable ? 'yes' : 'no', i.sizes.map((s) => s.size).join(', '), i.reorderLevel, i.location, i.stock, i.active ? 'yes' : 'no'])]
    .map((r) => r.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── the ledger

export const moveOut = (m) => ({ ...clean(m), itemId: String(m.itemId), branchId: idStr(m.branchId), refId: idStr(m.refId), party: m.party ? { ...m.party, id: idStr(m.party.id) } : null })

/** The size a line is in: one of the item's sizes, or '' for an item without sizes. */
export function sizeFor(item, size, field = 'size') {
  const s = normSize(size)
  if (!item.sizes?.length) return ''
  if (!s) throw fieldsError({ [field]: 'Pick the size' }, `Pick the size of ${item.name}.`)
  if (!item.sizes.some((x) => x.size === s)) throw fieldsError({ [field]: 'Not one of its sizes' }, `${item.name} has no size ${s}.`)
  return s
}

/**
 * Move stock: +qty in, −qty out (refused when the store holds less), and write the ledger line. Call inside
 * withTransaction(); awaits one by one.
 */
export async function applyMove({ item, branchId, size = '', type, qty, party, reason, refType, refId, refNo, note, date, expiry, rate }, auth) {
  if (!qty) return null
  const filter = { itemId: item._id, branchId: branchId ?? null, size }
  const set = { lastMovedAt: new Date() }
  const row = qty > 0
    ? await StoreStock.findOneAndUpdate(filter, { $inc: { qty }, $set: set }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })
    : await StoreStock.findOneAndUpdate({ ...filter, qty: { $gte: -qty } }, { $inc: { qty }, $set: set }, { returnDocument: 'after' })
  if (!row) {
    const have = (await StoreStock.findOne(filter).select('qty').lean())?.qty ?? 0
    throw conflict(`Not enough ${item.name}${size ? ` (size ${size})` : ''} in the store: ${have} left, ${-qty} needed.`, { itemId: String(item._id), size, have })
  }
  if (expiry && qty > 0 && (!row.expiry || expiry < row.expiry)) await StoreStock.updateOne({ _id: row._id }, { $set: { expiry } })
  const r = rate ?? item.rate ?? 0
  const s = stampOf(auth)
  const [m] = await StoreMove.create([{
    itemId: item._id, itemName: item.name, category: item.category, unit: item.unit, branchId: branchId ?? null, size, type, qty, balance: row.qty,
    rate: r, value: Math.abs(qty) * r, party, reason, refType, refId, refNo, note, date: date ?? await today(), by: s.by, byId: s.byId, at: s.at,
  }])
  return m
}

/** Items of the lines, checked: each active, and the size right. */
export async function itemsOf(lines, { sellable = false } = {}) {
  const ids = [...new Set(lines.map((l) => String(l.itemId)))].filter(isOid)
  const items = new Map((await StoreItem.find({ _id: { $in: ids } }).lean()).map((i) => [String(i._id), i]))
  return lines.map((l, n) => {
    const item = items.get(String(l.itemId))
    if (!item) throw fieldsError({ [`lines.${n}.itemId`]: 'Pick the item again' }, 'An item on this list was not found.')
    if (!item.active) throw fieldsError({ [`lines.${n}.itemId`]: 'Switched off' }, `${item.name} is switched off.`)
    if (sellable && !item.sellable) throw fieldsError({ [`lines.${n}.itemId`]: 'Not sold at the counter' }, `${item.name} isn't sold at the counter.`)
    return { ...l, item, size: sizeFor(item, l.size, `lines.${n}.size`) }
  })
}

/** Who stock goes to (or comes back from), from the masters — never a name from the body, except OTHER. */
export async function resolveParty({ kind, id, name } = {}) {
  if (kind === 'OTHER') {
    if (!name?.trim()) throw fieldsError({ 'to.name': 'Say who it is for' })
    return { kind, name: name.trim() }
  }
  const Model = { DEPARTMENT: Department, STAFF: User, CLASSROOM: Room }[kind]
  if (!Model) throw fieldsError({ 'to.kind': 'Pick who it is for' })
  const x = isOid(id) ? await Model.findById(id).select('name').lean() : null
  if (!x) throw fieldsError({ 'to.id': 'Pick again — not found' }, 'Pick who it is for again — not found.')
  return { kind, id: x._id, name: x.name }
}

/** Stock handed out (ISSUE) or brought back (RETURN): several lines on one slip. */
export async function issueOrReturn(type, { branchId, to, date, lines, note }, auth, req) {
  if (!lines?.length) throw fieldsError({ lines: 'Add an item' })
  const day = date || await today()
  if (day > await today()) throw fieldsError({ date: 'Pick today or earlier' }, 'The date is in the future.')
  const branch = await branchFor(auth, branchId)
  const party = await resolveParty(to)
  const checked = await itemsOf(lines)
  const refId = new mongoose.Types.ObjectId()
  const moves = await withTransaction(async () => {
    const out = []
    for (const l of checked) {
      out.push(await applyMove({ item: l.item, branchId: branch, size: l.size, type, qty: type === 'ISSUE' ? -l.qty : l.qty, party, refType: 'SLIP', refId, note, date: day }, auth))
    }
    return out
  })
  const what = checked.map((l) => `${l.qty} × ${l.item.name}${l.size ? ` (${l.size})` : ''}`).join(', ')
  await audit({ action: 'CREATE', module: 'inventory', entityType: 'store_move', entityId: String(refId), entityName: party.name, summary: `${type === 'ISSUE' ? 'Issued' : 'Took back'} ${what} ${type === 'ISSUE' ? 'to' : 'from'} ${party.name}` }, req)
  return moves.map((m) => moveOut(m.toObject()))
}

/** Correct the stock of one item (in one size) by +/− qty, with the reason. */
export async function adjustStock({ branchId, itemId, size, qty, reason, note }, auth, req) {
  if (!STORE_ADJUST_REASONS.some((r) => r.value === reason)) throw fieldsError({ reason: 'Pick the reason' })
  const branch = await branchFor(auth, branchId)
  const [l] = await itemsOf([{ itemId, size, qty }])
  const m = await withTransaction(() => applyMove({ item: l.item, branchId: branch, size: l.size, type: 'ADJUSTMENT', qty, reason, note }, auth))
  const label = STORE_ADJUST_REASONS.find((r) => r.value === reason)?.label
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'store_item', entityId: String(l.item._id), entityName: l.item.name, summary: `Adjusted ${l.item.name}${l.size ? ` (${l.size})` : ''} by ${qty > 0 ? '+' : ''}${qty} — ${label}${note ? `: ${note}` : ''}` }, req)
  return moveOut(m.toObject())
}

/** The stock ledger: newest first, filtered by campus, item, type, dates. */
export async function listMoves({ branchId, itemId, type, from, to, search, page = 1, pageSize = 50 }, auth) {
  const f = { ...branchQuery(auth, branchId) }
  if (itemId && isOid(itemId)) f.itemId = oid(itemId)
  if (type) f.type = type
  if (from || to) f.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ itemName: rx(q) }, { 'party.name': rx(q) }, { refNo: rx(q) }]
  const [rows, total] = await Promise.all([StoreMove.find(f).sort({ at: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), StoreMove.countDocuments(f)])
  return { data: rows.map(moveOut), total, page, pageSize }
}

/**
 * Current stock, per item, for the Stock page: total and per size, the level against the reorder level, value at
 * rate; with counts per category for the side list and the totals.
 */
export async function stockBoard({ branchId, category, search, level }, auth) {
  const f = { active: true }
  if (category) f.category = category
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ name: rx(q) }, { code: rx(q) }]
  const items = await StoreItem.find(f).sort({ name: 1 }).limit(5000).lean()
  const all = category || q ? await StoreItem.find({ active: true }).select('category reorderLevel rate').lean() : items
  const filter = branchQuery(auth, branchId)
  const stock = await stockOf(all.map((i) => i._id), filter)
  const cats = {}
  let value = 0
  let low = 0
  let out = 0
  for (const i of all) {
    const s = stock.get(String(i._id))?.qty ?? 0
    const lv = stockLevel(s, i.reorderLevel)
    const c = cats[i.category] ?? (cats[i.category] = { items: 0, low: 0, out: 0, value: 0 })
    c.items++
    c.value += s * (i.rate ?? 0)
    if (lv === 'LOW') { c.low++; low++ }
    if (lv === 'OUT') { c.out++; out++ }
    value += s * (i.rate ?? 0)
  }
  let rows = items.map((i) => {
    const s = stock.get(String(i._id)) ?? { qty: 0, sizes: {}, expiry: null }
    return {
      id: String(i._id), code: i.code, name: i.name, category: i.category, unit: i.unit, rate: i.rate ?? 0, reorderLevel: i.reorderLevel ?? 0, location: i.location ?? null,
      sellable: !!i.sellable, salePrice: i.salePrice ?? null, hasExpiry: !!i.hasExpiry,
      qty: s.qty, value: s.qty * (i.rate ?? 0), level: stockLevel(s.qty, i.reorderLevel), expiry: s.expiry,
      sizes: (i.sizes ?? []).map((z) => ({ size: z.size, qty: s.sizes[z.size] ?? 0 })),
    }
  })
  if (level) rows = rows.filter((r) => (level === 'REORDER' ? r.level !== 'OK' : r.level === level))
  const [movesToday, openPos] = await Promise.all([
    StoreMove.countDocuments({ ...filter, date: await today() }),
    StorePurchaseOrder.countDocuments({ ...filter, status: { $in: ['SUBMITTED', 'APPROVED', 'PARTIAL'] } }),
  ])
  return { rows, categories: cats, totals: { items: all.length, value, low, out, movesToday, openPos } }
}

export async function exportStock(params, auth) {
  const { rows } = await stockBoard(params, auth)
  const head = ['Code', 'Item', 'Category', 'Unit', 'Size', 'Quantity', 'Reorder level', 'Rate', 'Value', 'Status', 'Location']
  const rupees = (p) => (p / 100).toFixed(2)
  const lines = rows.flatMap((r) => (r.sizes.length
    ? r.sizes.map((s) => [r.code, r.name, STORE_CATEGORY_BY[r.category]?.label ?? r.category, r.unit, s.size, s.qty, r.reorderLevel, rupees(r.rate), rupees(s.qty * r.rate), r.level, r.location])
    : [[r.code, r.name, STORE_CATEGORY_BY[r.category]?.label ?? r.category, r.unit, '', r.qty, r.reorderLevel, rupees(r.rate), rupees(r.value), r.level, r.location]]))
  return [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\n')
}

/** Opening stock from a spreadsheet (code, size, qty, rate): each row adds an OPENING entry. */
export async function importOpeningStock(rows, { dryRun, branchId }, auth, req) {
  const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const branch = await branchFor(auth, branchId)
  const items = new Map((await StoreItem.find({ active: true }).lean()).map((i) => [i.code, i]))
  const out = rows.map((f, i) => {
    const errors = []
    const item = items.get(cell(f.code).toUpperCase())
    const qty = Number(cell(f.qty))
    const rate = rupeesCell(f.rate)
    let size = ''
    if (!item) errors.push({ field: 'code', message: `No item with code "${cell(f.code)}"` })
    else {
      try { size = sizeFor(item, f.size) } catch (e) { errors.push({ field: 'size', message: e.message }) }
    }
    if (!(Number.isInteger(qty) && qty > 0)) errors.push({ field: 'qty', message: 'A whole number above 0' })
    if (Number.isNaN(rate)) errors.push({ field: 'rate', message: 'Not an amount' })
    return { row: i + 1, fields: f, errors, item, size, qty, rate }
  })
  if (dryRun) return { rows: out.map(({ row, fields, errors }) => ({ row, fields, errors })) }
  const good = out.filter((r) => !r.errors.length)
  const errors = out.filter((r) => r.errors.length).flatMap((r) => r.errors.map((e) => ({ ...e, row: r.row })))
  let imported = 0
  for (const r of good) {
    try {
      await withTransaction(async () => {
        if (r.rate !== undefined) await StoreItem.updateOne({ _id: r.item._id }, { $set: { rate: r.rate } })
        await applyMove({ item: r.item, branchId: branch, size: r.size, type: 'OPENING', qty: r.qty, rate: r.rate, note: 'Imported opening stock' }, auth)
      })
      imported++
    } catch (e) {
      errors.push({ row: r.row, field: 'qty', message: e.message })
    }
  }
  if (imported) await audit({ action: 'IMPORT', module: 'inventory', entityType: 'store_move', entityName: `${imported} rows`, summary: `Imported opening stock: ${imported} line(s)` }, req)
  return { imported, errors }
}

// ───────────────────────────────────────────────────────── stock counts

const countOut = (c) => ({ ...clean(c), branchId: idStr(c.branchId), lines: (c.lines ?? []).map((l) => ({ ...l, itemId: String(l.itemId) })) })

export async function listCounts({ branchId }, auth) {
  const rows = await StoreCount.find(branchQuery(auth, branchId)).sort({ createdAt: -1 }).limit(50).select('-lines').lean()
  const counts = await StoreCount.aggregate([{ $match: { _id: { $in: rows.map((r) => r._id) } } }, { $project: { n: { $size: '$lines' }, counted: { $size: { $filter: { input: '$lines', cond: { $ne: [{ $ifNull: ['$$this.countedQty', null] }, null] } } } } } }])
  const by = new Map(counts.map((c) => [String(c._id), c]))
  return rows.map((r) => ({ ...countOut(r), lineCount: by.get(String(r._id))?.n ?? 0, countedCount: by.get(String(r._id))?.counted ?? 0 }))
}

export async function getCount(id, auth) {
  const c = isOid(id) ? await StoreCount.findOne({ _id: id, ...siteFilter(auth) }).lean() : null
  if (!c) throw notFound('Stock count')
  // what the store holds now, so a count that took a while shows what moved meanwhile
  const now = await StoreStock.find({ branchId: c.branchId, itemId: { $in: c.lines.map((l) => l.itemId) } }).lean()
  const cur = new Map(now.map((r) => [`${r.itemId}:${r.size}`, r.qty]))
  return { ...countOut(c), lines: c.lines.map((l) => ({ ...l, itemId: String(l.itemId), currentQty: cur.get(`${l.itemId}:${l.size}`) ?? 0 })) }
}

/** Start a count: every active item (in sizes) of the campus store, optionally one category, with what the books say. */
export async function startCount({ branchId, category, note }, auth, req) {
  const branch = await branchFor(auth, branchId)
  if (await StoreCount.exists({ branchId: branch, status: 'OPEN', ...(category ? { $or: [{ category }, { category: null }] } : {}) })) throw conflict('A count is already open for this store. Post or cancel it first.')
  const items = await StoreItem.find({ active: true, ...(category && { category }) }).sort({ category: 1, name: 1 }).lean()
  if (!items.length) throw badRequest('There are no items to count.')
  const stock = await StoreStock.find({ branchId: branch, itemId: { $in: items.map((i) => i._id) } }).lean()
  const have = new Map(stock.map((r) => [`${r.itemId}:${r.size}`, r.qty]))
  const lines = items.flatMap((i) => (i.sizes?.length ? i.sizes.map((s) => s.size) : ['']).map((size) => ({
    itemId: i._id, name: i.name, category: i.category, unit: i.unit, size, systemQty: have.get(`${i._id}:${size}`) ?? 0,
  })))
  const c = await StoreCount.create({ branchId: branch, category: category || undefined, date: await today(), lines, note, created: stampOf(auth) })
  await audit({ action: 'CREATE', module: 'inventory', entityType: 'store_count', entityId: String(c._id), entityName: c.date, summary: `Started a stock count of ${lines.length} line(s)${category ? ` (${STORE_CATEGORY_BY[category]?.label ?? category})` : ''}` }, req)
  return getCount(c._id, auth)
}

/** Save counted quantities (any number of lines, as often as needed while the count is open). */
export async function saveCountLines(id, { lines }, auth) {
  const c = isOid(id) ? await StoreCount.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!c) throw notFound('Stock count')
  if (c.status !== 'OPEN') throw conflict('This count is already closed.')
  const by = new Map(lines.map((l) => [`${l.itemId}:${normSize(l.size)}`, l.countedQty]))
  for (const l of c.lines) {
    const k = `${l.itemId}:${l.size}`
    if (by.has(k)) l.countedQty = by.get(k) === null || by.get(k) === '' ? undefined : Number(by.get(k))
  }
  c.markModified('lines')
  await c.save()
  return getCount(c._id, auth)
}

/** Post a count: each counted line's stock is set to what was counted (an ADJUSTMENT, reason COUNT). */
export async function postCount(id, auth, req) {
  const c = isOid(id) ? await StoreCount.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!c) throw notFound('Stock count')
  if (c.status !== 'OPEN') throw conflict('This count is already closed.')
  const counted = c.lines.filter((l) => l.countedQty !== undefined && l.countedQty !== null)
  if (!counted.length) throw badRequest('Nothing has been counted yet.')
  const items = new Map((await StoreItem.find({ _id: { $in: counted.map((l) => l.itemId) } }).lean()).map((i) => [String(i._id), i]))
  const result = await withTransaction(async () => {
    let adjusted = 0
    let value = 0
    for (const l of counted) {
      const item = items.get(String(l.itemId))
      if (!item) continue
      const now = (await StoreStock.findOne({ itemId: l.itemId, branchId: c.branchId, size: l.size }).select('qty').lean())?.qty ?? 0
      const diff = l.countedQty - now
      if (!diff) continue
      await applyMove({ item, branchId: c.branchId, size: l.size, type: 'ADJUSTMENT', qty: diff, reason: 'COUNT', refType: 'COUNT', refId: c._id, refNo: `Count ${c.date}`, note: c.note }, auth)
      adjusted++
      value += diff * (item.rate ?? 0)
    }
    c.status = 'POSTED'
    c.posted = { ...stampOf(auth), adjusted, value }
    await c.save()
    return { adjusted, value }
  })
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'store_count', entityId: String(c._id), entityName: c.date, summary: `Posted a stock count: ${result.adjusted} line(s) adjusted, net ${formatINR(result.value)}` }, req)
  return getCount(c._id, auth)
}

export async function cancelCount(id, auth, req) {
  const c = isOid(id) ? await StoreCount.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!c) throw notFound('Stock count')
  if (c.status !== 'OPEN') throw conflict('This count is already closed.')
  c.status = 'CANCELLED'
  c.cancelled = stampOf(auth)
  await c.save()
  await audit({ action: 'CANCEL', module: 'inventory', entityType: 'store_count', entityId: String(c._id), entityName: c.date, summary: 'Cancelled a stock count' }, req)
  return { ok: true }
}

/** Store day at a glance (counter sales today, for the stock header): used by the sales page too. */
export async function salesToday(auth, branchId) {
  const f = { ...branchQuery(auth, branchId), date: await today(), status: 'PAID' }
  const [r] = await StoreSale.aggregate([{ $match: f }, { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: '$total' } } }])
  return { count: r?.n ?? 0, amount: r?.amount ?? 0 }
}

