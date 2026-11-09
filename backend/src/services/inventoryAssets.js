import { ASSET_CATEGORY_BY, ASSET_DISPOSAL_METHODS, bookValue, formatINR, warrantyState } from '@schoolgiant/shared'
import { StoreAsset, StoreVendor } from '../models/inventory.js'
import { TenantCounter, User } from '../models/tenant.js'
import { Room } from '../models/timetable.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { branchFor, branchQuery, fieldsError, rx, siteFilter, stampOf, today } from './inventory.js'

// Asset register (Store › Asset register): furniture, computers, smart boards, lab and sports equipment … Each asset
// has a tag (auto, by category: IT-00012), a place (a room from Timetable › Rooms, or a written location) on a campus,
// the staff member who has it, what it cost and when, its warranty, a maintenance log and, at the end, its disposal.
// Book value is straight-line: (cost − salvage) over the category's useful life (or the asset's own).

const idStr = (v) => (v ? String(v) : null)

/** The next tag for a category: its prefix and a running number (skipping any typed by hand). */
async function nextTag(category) {
  const prefix = ASSET_CATEGORY_BY[category]?.prefix ?? 'AST'
  for (let i = 0; i < 50; i++) {
    const c = await TenantCounter.findOneAndUpdate({ docType: 'ASSET_TAG', scope: prefix, period: 'ALL' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
    const tag = `${prefix}-${String(c.seq).padStart(5, '0')}`
    if (!await StoreAsset.exists({ assetTag: tag })) return tag
  }
  throw conflict('Could not find a free asset tag. Type one in.')
}

function assetOut(a, day) {
  const life = a.depreciation?.lifeYears ?? ASSET_CATEGORY_BY[a.category]?.lifeYears ?? 5
  const bv = a.status === 'DISPOSED'
    ? { depreciation: 0, bookValue: 0, pctWritten: 100 }
    : bookValue({ cost: a.purchase?.cost, purchaseDate: a.purchase?.date, lifeYears: life, salvagePct: a.depreciation?.salvagePct ?? 0 }, day)
  const maint = a.maintenance ?? []
  return {
    ...clean(a), branchId: idStr(a.branchId), roomId: idStr(a.roomId), vendorId: idStr(a.vendorId),
    assignedTo: a.assignedTo?.userId ? { userId: String(a.assignedTo.userId), name: a.assignedTo.name } : null,
    maintenance: maint.map((m) => ({ ...m, id: String(m._id), _id: undefined })).sort((x, y) => (y.date > x.date ? 1 : -1)),
    lifeYears: life, ...bv,
    warranty: warrantyState(a.warrantyEnd, day),
    maintenanceCost: maint.reduce((s, m) => s + (m.cost ?? 0), 0),
    nextDue: maint.map((m) => m.nextDue).filter((d) => d && d >= day).sort()[0] ?? null,
  }
}

/** The register with book values, and the totals for the board (by category, by place). */
export async function listAssets({ branchId, category, status, roomId, search, assignedTo }, auth) {
  const f = { ...branchQuery(auth, branchId) }
  if (category) f.category = category
  if (status === 'ACTIVE') f.status = { $ne: 'DISPOSED' }
  else if (status && status !== 'ALL') f.status = status
  if (roomId === 'NONE') f.roomId = null
  else if (roomId && isOid(roomId)) f.roomId = roomId
  if (assignedTo && isOid(assignedTo)) f['assignedTo.userId'] = assignedTo
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ assetTag: rx(q) }, { name: rx(q) }, { serialNo: rx(q) }, { make: rx(q) }, { model: rx(q) }, { location: rx(q) }, { roomName: rx(q) }, { 'assignedTo.name': rx(q) }]
  const day = await today()
  const rows = (await StoreAsset.find(f).sort({ category: 1, assetTag: 1 }).limit(5000).lean()).map((a) => assetOut(a, day))
  const all = category || (status && status !== 'ACTIVE') || roomId || q || assignedTo
    ? (await StoreAsset.find({ ...branchQuery(auth, branchId), status: { $ne: 'DISPOSED' } }).lean()).map((a) => assetOut(a, day))
    : rows.filter((a) => a.status !== 'DISPOSED')
  const byCategory = {}
  const byRoom = {}
  let cost = 0
  let book = 0
  for (const a of all) {
    const c = byCategory[a.category] ?? (byCategory[a.category] = { count: 0, cost: 0, bookValue: 0 })
    c.count++
    c.cost += a.purchase?.cost ?? 0
    c.bookValue += a.bookValue
    const k = a.roomId ?? 'NONE'
    const r = byRoom[k] ?? (byRoom[k] = { name: a.roomName ?? null, count: 0, bookValue: 0, repair: 0 })
    r.count++
    r.bookValue += a.bookValue
    if (a.status === 'UNDER_REPAIR') r.repair++
    cost += a.purchase?.cost ?? 0
    book += a.bookValue
  }
  return {
    data: rows,
    summary: {
      count: all.length, cost, bookValue: book,
      repair: all.filter((a) => a.status === 'UNDER_REPAIR').length,
      warrantySoon: all.filter((a) => a.warranty === 'SOON').length,
      serviceDue: all.filter((a) => a.nextDue && a.nextDue <= day).length,
      disposed: await StoreAsset.countDocuments({ ...branchQuery(auth, branchId), status: 'DISPOSED' }),
      byCategory, byRoom,
    },
  }
}

async function loadAsset(id, auth) {
  const a = isOid(id) ? await StoreAsset.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!a) throw notFound('Asset')
  return a
}

export async function getAsset(id, auth) {
  return assetOut((await loadAsset(id, auth)).toObject(), await today())
}

/** Place, person and vendor from their masters (never names from the request). */
async function resolveRefs(input) {
  const out = {}
  if (input.roomId !== undefined) {
    if (input.roomId) {
      const r = isOid(input.roomId) ? await Room.findById(input.roomId).select('name branchId').lean() : null
      if (!r) throw fieldsError({ roomId: 'Pick the room again' }, 'That room was not found.')
      Object.assign(out, { roomId: r._id, roomName: r.name, roomBranchId: r.branchId ?? null })
    } else Object.assign(out, { roomId: null, roomName: null })
  }
  if (input.assignedToId !== undefined) {
    if (input.assignedToId) {
      const u = isOid(input.assignedToId) ? await User.findById(input.assignedToId).select('name').lean() : null
      if (!u) throw fieldsError({ assignedToId: 'Pick the staff member again' }, 'That staff member was not found.')
      out.assignedTo = { userId: u._id, name: u.name }
    } else out.assignedTo = { userId: null, name: null }
  }
  if (input.vendorId !== undefined) {
    if (input.vendorId) {
      const v = isOid(input.vendorId) ? await StoreVendor.findById(input.vendorId).select('name').lean() : null
      if (!v) throw fieldsError({ vendorId: 'Pick the vendor again' }, 'That vendor was not found.')
      Object.assign(out, { vendorId: v._id, vendorName: v.name })
    } else Object.assign(out, { vendorId: null, vendorName: input.vendorName || null })
  }
  return out
}

export async function saveAsset(id, input, auth, req) {
  const { roomId, assignedToId, vendorId, vendorName, branchId, purchaseDate, cost, invoiceNo, poNo, lifeYears, salvagePct, assetTag, ...rest } = input
  const refs = await resolveRefs({ roomId, assignedToId, vendorId, vendorName })
  const { roomBranchId, ...set } = refs
  let a
  if (id) {
    a = await loadAsset(id, auth)
    if (a.status === 'DISPOSED') throw conflict('This asset has been disposed of.')
    if (assetTag && assetTag.toUpperCase() !== a.assetTag) {
      if (await StoreAsset.exists({ assetTag: assetTag.toUpperCase(), _id: { $ne: a._id } })) throw fieldsError({ assetTag: 'Already used' }, `Tag ${assetTag} is already used.`)
      a.assetTag = assetTag
    }
    Object.assign(a, rest, set)
    if (branchId !== undefined || roomBranchId) a.branchId = await branchFor(auth, branchId || roomBranchId)
    if (purchaseDate !== undefined) a.set('purchase.date', purchaseDate || undefined)
    if (cost !== undefined) a.set('purchase.cost', cost ?? undefined)
    if (invoiceNo !== undefined) a.set('purchase.invoiceNo', invoiceNo || undefined)
    if (poNo !== undefined) a.set('purchase.poNo', poNo || undefined)
    if (lifeYears !== undefined) a.set('depreciation.lifeYears', lifeYears ?? undefined)
    if (salvagePct !== undefined) a.set('depreciation.salvagePct', salvagePct ?? 0)
    await a.save()
  } else {
    const tag = assetTag?.trim().toUpperCase() || await nextTag(rest.category)
    if (assetTag && await StoreAsset.exists({ assetTag: tag })) throw fieldsError({ assetTag: 'Already used' }, `Tag ${tag} is already used.`)
    a = await StoreAsset.create({
      ...rest, ...set, assetTag: tag, branchId: await branchFor(auth, branchId || roomBranchId),
      purchase: { date: purchaseDate, cost, invoiceNo, poNo },
      depreciation: { lifeYears: lifeYears ?? ASSET_CATEGORY_BY[rest.category]?.lifeYears, salvagePct: salvagePct ?? 0 },
      createdBy: auth.user?.name,
    })
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'inventory', entityType: 'store_asset', entityId: String(a._id), entityName: a.assetTag, summary: `${id ? 'Updated' : 'Added'} asset ${a.assetTag} · ${a.name}${a.roomName ? ` in ${a.roomName}` : ''}${a.assignedTo?.name ? `, with ${a.assignedTo.name}` : ''}` }, req)
  return getAsset(a._id, auth)
}

/** A line in the maintenance log; `status` can put the asset under repair or back in use at the same time. */
export async function addMaintenance(id, { date, kind, description, cost, vendor, nextDue, status }, auth, req) {
  const a = await loadAsset(id, auth)
  if (a.status === 'DISPOSED') throw conflict('This asset has been disposed of.')
  const day = date || await today()
  if (day > await today()) throw fieldsError({ date: 'Pick today or earlier' })
  a.maintenance.push({ date: day, kind, description, cost: cost ?? 0, vendor, nextDue, ...stampOf(auth) })
  if (status && ['IN_USE', 'UNDER_REPAIR', 'IN_STORE'].includes(status)) a.status = status
  await a.save()
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'store_asset', entityId: String(a._id), entityName: a.assetTag, summary: `Maintenance on ${a.assetTag} (${kind.toLowerCase()}): ${description}${cost ? `, ${formatINR(cost)}` : ''}` }, req)
  return getAsset(a._id, auth)
}

export async function removeMaintenance(id, entryId, auth, req) {
  const a = await loadAsset(id, auth)
  const m = a.maintenance.id(entryId)
  if (!m) throw notFound('Maintenance entry')
  m.deleteOne()
  await a.save()
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'store_asset', entityId: String(a._id), entityName: a.assetTag, summary: `Removed a maintenance entry of ${a.assetTag} (${m.date}: ${m.description})` }, req)
  return getAsset(a._id, auth)
}

/** Dispose of an asset (sold, scrapped, donated, lost, written off). It stays in the register, greyed. */
export async function disposeAsset(id, { date, method, amount, reason }, auth, req) {
  if (!ASSET_DISPOSAL_METHODS.includes(method)) throw fieldsError({ method: 'Pick how' })
  const a = await loadAsset(id, auth)
  if (a.status === 'DISPOSED') throw conflict('This asset is already disposed of.')
  const day = date || await today()
  const before = assetOut(a.toObject(), day)
  a.status = 'DISPOSED'
  a.disposal = { date: day, method, amount: amount ?? 0, reason, ...stampOf(auth) }
  await a.save()
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'store_asset', entityId: String(a._id), entityName: a.assetTag, summary: `Disposed of ${a.assetTag} · ${a.name} (${method.toLowerCase()}${amount ? `, ${formatINR(amount)}` : ''}; book value was ${formatINR(before.bookValue)}): ${reason}` }, req)
  return getAsset(a._id, auth)
}

/** Delete an asset entered by mistake (one with a maintenance history or a disposal is kept). */
export async function deleteAsset(id, auth, req) {
  const a = await loadAsset(id, auth)
  if (a.maintenance.length || a.status === 'DISPOSED') throw badRequest('This asset has a history. Dispose of it instead of deleting it.')
  await a.deleteOne()
  await audit({ action: 'DELETE', module: 'inventory', entityType: 'store_asset', entityId: String(a._id), entityName: a.assetTag, summary: `Deleted asset ${a.assetTag} · ${a.name}` }, req)
  return { deleted: true }
}

/** Asset labels (ASSET_LABEL, many): the tag as a barcode with the asset's name and place. `ids`: asset ids. */
export async function assetLabelsData(ids) {
  const rows = await StoreAsset.find({ _id: { $in: ids } }).select('assetTag name category roomName location').sort({ assetTag: 1 }).lean()
  return { labels: rows.map((a) => ({ tag: a.assetTag, name: a.name, category: ASSET_CATEGORY_BY[a.category]?.label ?? a.category, place: a.roomName || a.location || '' })) }
}
export const latestAssetId = async () => (await StoreAsset.findOne().sort({ createdAt: -1 }).select('_id').lean())?._id ?? null

/** An asset's tag scanned in a physical audit: seen now, by whom. */
export async function verifyAsset(id, auth, req) {
  const a = await StoreAsset.findOneAndUpdate({ _id: id }, { $set: { lastVerified: { at: new Date(), by: auth.user?.name } } }, { new: true }).lean()
  if (!a) throw notFound('Asset')
  await audit({ action: 'UPDATE', module: 'inventory', entityType: 'asset', entityId: String(a._id), entityName: a.assetTag, summary: `Verified ${a.assetTag} (${a.name}) in a physical audit` }, req)
  return a
}
