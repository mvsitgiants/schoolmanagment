import { KIT_KINDS, KIT_KIND_BY } from '@schoolgiant/shared'
import { AcademicYear, ClassKit, ClassLevel, Section } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { StoreItem } from '../models/inventory.js'
import { Branch } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { readStream } from '../platform/storage.js'
import { institutionNow } from '../platform/time.js'
import { listFiles } from './files.js'
import { need, studentFor } from './portal.js'

// Academic setup › Books & uniform: each class's list for the year — books, notebooks, stationery, uniform, shoes and
// anything else to bring — with a few lines of instructions and files (the publisher's book list as a PDF, a uniform
// picture). Published lists reach families in the app (feature KIT) from their "visible from" day, usually a few
// weeks before the session starts, so the shopping is done before the first day.

const idStr = (v) => (v ? String(v) : null)
const today = async () => (await institutionNow()).date

function kitDto(k, classes, branches, fileCount) {
  return {
    id: String(k._id), academicYearId: String(k.academicYearId), classId: String(k.classId), className: classes?.get(String(k.classId))?.name ?? '?',
    branchId: idStr(k.branchId), branchName: k.branchId ? branches?.get(String(k.branchId))?.name ?? '?' : null,
    items: (k.items ?? []).map((i) => ({ ...i, id: String(i._id), _id: undefined, storeItemId: idStr(i.storeItemId) })),
    shops: (k.shops ?? []).map(({ _id, ...s }) => ({ ...s, id: String(_id) })),
    instructions: k.instructions ?? '', published: !!k.published, visibleFrom: k.visibleFrom ?? null,
    updatedBy: k.updatedBy ?? null, updatedAt: k.updatedAt, fileCount: fileCount ?? undefined,
  }
}

async function lookups() {
  const [classes, branches] = await Promise.all([
    ClassLevel.find().select('name order').lean(),
    Branch.find().select('name').lean(),
  ])
  return { classes: new Map(classes.map((c) => [String(c._id), c])), branches: new Map(branches.map((b) => [String(b._id), b])) }
}

/** Every list of a year (the current one when none is given), with how many files each has. */
export async function listKits({ academicYearId } = {}) {
  const year = academicYearId ? await AcademicYear.findById(academicYearId).lean() : await AcademicYear.findOne({ isCurrent: true }).lean()
  if (!year) return { year: null, kits: [] }
  const rows = await ClassKit.find({ academicYearId: year._id }).lean()
  const { classes, branches } = await lookups()
  const counts = new Map((await Attachment.aggregate([
    { $match: { entityType: 'class_kit', entityId: { $in: rows.map((r) => String(r._id)) }, 'deleted.at': null } },
    { $group: { _id: '$entityId', n: { $sum: 1 } } },
  ])).map((c) => [c._id, c.n]))
  const kits = rows.map((k) => kitDto(k, classes, branches, counts.get(String(k._id)) ?? 0))
    .sort((a, b) => (classes.get(a.classId)?.order ?? 0) - (classes.get(b.classId)?.order ?? 0) || String(a.branchName ?? '').localeCompare(String(b.branchName ?? '')))
  // every shop named on this year's lists, once — to pick again on another class's list
  const seen = new Map()
  for (const k of kits) for (const s of k.shops) { const key = s.name.trim().toLowerCase(); if (!seen.has(key)) seen.set(key, { ...s, id: undefined }) }
  return { year: { id: String(year._id), name: year.name, startDate: year.startDate }, kits, shops: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

export async function getKit(id, auth) {
  const k = await ClassKit.findById(id).lean()
  if (!k) throw notFound('List')
  const { classes, branches } = await lookups()
  return { ...kitDto(k, classes, branches), files: await listFiles({ entityType: 'class_kit', entityId: String(k._id) }, auth) }
}

function cleanItems(items = []) {
  return items.filter((i) => i.name?.trim()).map((i) => ({
    kind: KIT_KIND_BY[i.kind] ? i.kind : 'OTHER', name: i.name.trim(), code: i.code?.trim() || undefined, subject: i.subject?.trim() || undefined,
    publisher: i.publisher?.trim() || undefined, qty: Math.max(1, Math.round(Number(i.qty) || 1)), price: i.price == null || i.price === '' ? undefined : Math.max(0, Math.round(Number(i.price))),
    note: i.note?.trim() || undefined, storeItemId: isOid(i.storeItemId) ? i.storeItemId : undefined,
  }))
}

function cleanShops(shops = []) {
  return shops.filter((s) => s.name?.trim()).map((s) => ({
    name: s.name.trim(), sells: [...new Set((s.sells ?? []).filter((x) => KIT_KIND_BY[x]))], address: s.address?.trim() || undefined,
    phone: s.phone?.trim() || undefined, mapUrl: s.mapUrl?.trim() || undefined, note: s.note?.trim() || undefined,
  }))
}

/** Save a class's list (one per year, class and campus — or all campuses). */
export async function saveKit(input, auth, req, id = null) {
  const year = await AcademicYear.findById(input.academicYearId).lean()
  if (!year) throw badRequest('Pick the academic year', { fields: { academicYearId: 'Pick the academic year' } })
  if (!(await ClassLevel.exists({ _id: input.classId }))) throw badRequest('Pick the class', { fields: { classId: 'Pick the class' } })
  const key = { academicYearId: input.academicYearId, classId: input.classId, branchId: input.branchId || null }
  let k = id ? await ClassKit.findById(id) : null
  if (id && !k) throw notFound('List')
  const clash = await ClassKit.findOne(key).select('_id').lean()
  if (clash && String(clash._id) !== String(k?._id ?? '')) throw conflict('This class already has a list for that campus this year. Open it instead.')
  if (!k) k = new ClassKit(key)
  Object.assign(k, key, {
    items: cleanItems(input.items), shops: cleanShops(input.shops), instructions: input.instructions?.trim() || undefined,
    published: !!input.published, visibleFrom: input.visibleFrom || undefined, updatedBy: auth.user?.name,
  })
  await k.save()
  const cls = await ClassLevel.findById(k.classId).select('name').lean()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'academics', entityType: 'class_kit', entityId: String(k._id), entityName: `${cls?.name} books & uniform`, summary: `${id ? 'Updated' : 'Made'} the books & uniform list of ${cls?.name} (${k.items.length} items${k.published ? ', published' : ''})` }, req)
  return getKit(k._id, auth)
}

export async function deleteKit(id, auth, req) {
  const k = await ClassKit.findById(id)
  if (!k) throw notFound('List')
  await k.deleteOne()
  await Attachment.updateMany({ entityType: 'class_kit', entityId: String(id), 'deleted.at': null }, { $set: { deleted: { at: new Date(), by: auth.user?.name, reason: 'The list was deleted' } } })
  const cls = await ClassLevel.findById(k.classId).select('name').lean()
  await audit({ action: 'DELETE', module: 'academics', entityType: 'class_kit', entityId: String(id), entityName: `${cls?.name} books & uniform`, summary: `Deleted the books & uniform list of ${cls?.name}` }, req)
  return { ok: true }
}

/**
 * Start other classes' lists (or next year's) from this one: items and instructions are copied, not published;
 * a class that already has a list is left alone. Files are not copied — each class adds its own.
 */
export async function copyKit(id, { classIds, academicYearId, branchId }, auth, req) {
  const from = await ClassKit.findById(id).lean()
  if (!from) throw notFound('List')
  const yearId = academicYearId || from.academicYearId
  let made = 0
  let skipped = 0
  for (const classId of classIds) {
    const key = { academicYearId: yearId, classId, branchId: branchId === undefined ? from.branchId : branchId || null }
    if (await ClassKit.exists(key)) { skipped++; continue }
    await ClassKit.create({ ...key, items: from.items.map(({ _id, ...i }) => i), shops: (from.shops ?? []).map(({ _id, ...s }) => s), instructions: from.instructions, published: false, updatedBy: auth.user?.name })
    made++
  }
  await audit({ action: 'CREATE', module: 'academics', entityType: 'class_kit', entityId: String(id), entityName: 'books & uniform', summary: `Copied a books & uniform list to ${made} class${made === 1 ? '' : 'es'}` }, req)
  return { made, skipped }
}

/** The store's items sold at the counter (uniform, books), to pick from with their code and price. */
export async function kitStoreItems() {
  const rows = await StoreItem.find({ active: true, sellable: true }).select('code name category salePrice sizes').sort({ category: 1, name: 1 }).limit(1000).lean()
  return rows.map((r) => ({ id: String(r._id), code: r.code, name: r.name, category: r.category, salePrice: r.salePrice ?? null, sizes: (r.sizes ?? []).map((s) => s.size ?? s.label ?? s).filter(Boolean) }))
}

// ───────────────────────────────────────────────────────── the family app (feature KIT)

/** The list a family sees: the child's class this year, their campus's own list before the all-campus one. */
async function kitOf(s) {
  if (!s.sectionId) return null
  const sec = await Section.findById(s.sectionId).select('classId academicYearId branchId').lean()
  if (!sec) return null
  const branchId = s.branchId ?? sec.branchId ?? null
  const rows = await ClassKit.find({ academicYearId: sec.academicYearId, classId: sec.classId, branchId: { $in: [branchId, null] }, published: true }).lean()
  const on = await today()
  const live = rows.filter((k) => !k.visibleFrom || k.visibleFrom <= on)
  return live.find((k) => String(k.branchId) === String(branchId)) ?? live.find((k) => !k.branchId) ?? null
}

export async function familyKit(f, id) {
  need(f, 'KIT')
  const s = studentFor(f, id)
  const k = await kitOf(s)
  if (!k) return null
  const [cls, year, files] = await Promise.all([
    ClassLevel.findById(k.classId).select('name').lean(),
    AcademicYear.findById(k.academicYearId).select('name').lean(),
    Attachment.find({ entityType: 'class_kit', entityId: String(k._id), 'deleted.at': null }).sort({ createdAt: 1 }).lean(),
  ])
  const shops = (k.shops ?? []).map((s) => ({ name: s.name, sells: s.sells ?? [], address: s.address ?? null, phone: s.phone ?? null, mapUrl: s.mapUrl ?? null, note: s.note ?? null }))
  const groups = KIT_KINDS.map((kind) => ({
    kind: kind.value,
    // where to buy this kind: the shops for it (a shop with nothing ticked is for everything)
    shops: shops.filter((s) => !s.sells.length || s.sells.includes(kind.value)).map((s) => s.name),
    items: k.items.filter((i) => i.kind === kind.value).map((i) => ({ name: i.name, code: i.code ?? null, subject: i.subject ?? null, publisher: i.publisher ?? null, qty: i.qty ?? 1, price: i.price ?? null, note: i.note ?? null })),
  })).filter((g) => g.items.length)
  const priced = k.items.filter((i) => i.price != null)
  return {
    className: cls?.name ?? '', yearName: year?.name ?? '', instructions: k.instructions ?? null, updatedAt: k.updatedAt, groups, shops,
    total: priced.length ? priced.reduce((t, i) => t + i.price * (i.qty ?? 1), 0) : null,
    files: files.map((a) => ({ id: String(a._id), fileName: a.fileName, title: a.title ?? null, contentType: a.mime, size: a.size })),
  }
}

export async function familyKitFile(f, id, fileId) {
  need(f, 'KIT')
  const s = studentFor(f, id)
  if (!isOid(fileId)) throw notFound('File')
  const k = await kitOf(s)
  if (!k) throw notFound('File')
  const file = await Attachment.findOne({ _id: fileId, entityType: 'class_kit', entityId: String(k._id), 'deleted.at': null }).lean()
  if (!file) throw notFound('File')
  return { file, stream: readStream(file.storageKey) }
}
