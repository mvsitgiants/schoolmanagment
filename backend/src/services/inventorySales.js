import { STORE_SALE_MODES, formatINR, salePriceOf, sectionLabel } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { StoreItem, StoreSale } from '../models/inventory.js'
import { Student, studentName } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, withTransaction } from '../platform/db.js'
import { conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { applyMove, branchFor, branchQuery, fieldsError, itemsOf, rx, siteFilter, stampOf, today } from './inventory.js'

// Uniform & book sales (Store › Uniform & book sales): the counter sells sellable items (in their sizes) to a
// student, takes cash / UPI / card, gives a numbered receipt (STORE_SALE series, STORE_SALE_RECEIPT print). A sale
// taken in error is cancelled: its stock goes back. Each sale and cancel is an event (`inventory.sale`,
// `inventory.sale_cancelled`) that Accounts posts (cash / bank ⇄ "Uniform & book sales").

const idStr = (v) => (v ? String(v) : null)
const saleOut = (s) => ({ ...clean(s), branchId: idStr(s.branchId), studentId: String(s.studentId), lines: (s.lines ?? []).map((l) => ({ ...l, itemId: idStr(l.itemId) })) })

async function placeOf(students) {
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })]))
}

/** Find a student to sell to: by admission number (exact first) or name. */
export async function searchStudents(q, auth) {
  const s = String(q ?? '').trim()
  if (s.length < 2) return []
  const scoped = siteFilter(auth)
  const students = await Student.find({ status: 'ACTIVE', ...scoped, $or: [{ admissionNo: rx(s) }, { firstName: rx(s) }, { lastName: rx(s) }] })
    .select('firstName middleName lastName admissionNo sectionId branchId photo').limit(15).lean()
  students.sort((a, b) => (b.admissionNo?.toUpperCase() === s.toUpperCase()) - (a.admissionNo?.toUpperCase() === s.toUpperCase()))
  const places = await placeOf(students)
  return students.map((x) => ({ id: String(x._id), name: studentName(x), admissionNo: x.admissionNo, class: places.get(String(x.sectionId)) ?? '', branchId: idStr(x.branchId) }))
}

/** Sell to a student. Prices come from the items (a size's own price first), never from the request. */
export async function createSale({ studentId, branchId, lines, mode, reference, note }, auth, req) {
  if (!STORE_SALE_MODES.includes(mode)) throw fieldsError({ mode: 'Pick how they paid' })
  if (!lines?.length) throw fieldsError({ lines: 'Add an item' }, 'Add at least one item.')
  const student = isOid(studentId) ? await Student.findOne({ _id: studentId, ...siteFilter(auth) }).select('firstName middleName lastName admissionNo sectionId branchId status').lean() : null
  if (!student) throw fieldsError({ studentId: 'Pick the student' }, 'Pick the student.')
  if (student.status !== 'ACTIVE') throw conflict(`${studentName(student)} is not an active student.`)
  const branch = await branchFor(auth, branchId)
  const checked = await itemsOf(lines, { sellable: true })
  const priced = checked.map((l, n) => {
    const rate = salePriceOf(l.item, l.size)
    if (rate == null || rate <= 0) throw fieldsError({ [`lines.${n}.itemId`]: 'No sale price' }, `${l.item.name} has no sale price. Set it on the item first.`)
    return { ...l, rate, amount: rate * l.qty }
  })
  const total = priced.reduce((s, l) => s + l.amount, 0)
  const day = await today()
  const place = (await placeOf([student])).get(String(student.sectionId)) ?? ''
  const sale = await withTransaction(async () => {
    const saleNo = await nextNumber('STORE_SALE', { branchId: branch })
    const [s] = await StoreSale.create([{
      saleNo, branchId: branch, date: day, studentId: student._id, student: { name: studentName(student), admissionNo: student.admissionNo, class: place },
      lines: priced.map((l) => ({ itemId: l.item._id, name: l.item.name, category: l.item.category, size: l.size, qty: l.qty, rate: l.rate, amount: l.amount })),
      total, mode, reference: reference || undefined, note, ...(({ by, byId, at }) => ({ by, byId, at }))(stampOf(auth)),
    }])
    for (const l of priced) {
      await applyMove({ item: l.item, branchId: branch, size: l.size, type: 'SALE', qty: -l.qty, party: { kind: 'STUDENT', id: student._id, name: studentName(student) }, refType: 'SALE', refId: s._id, refNo: saleNo, date: day }, auth)
    }
    return s
  })
  await audit({ action: 'CREATE', module: 'inventory', entityType: 'store_sale', entityId: String(sale._id), entityName: sale.saleNo, studentId: student._id, summary: `Sold ${priced.map((l) => `${l.qty} × ${l.item.name}${l.size ? ` (${l.size})` : ''}`).join(', ')} to ${studentName(student)} for ${formatINR(total)} (${mode}), receipt ${sale.saleNo}` }, req)
  await emit('inventory.sale', { entity: { type: 'store_sale', id: sale._id }, saleNo: sale.saleNo, studentId: String(student._id), amount: total, mode, date: day, branchId: idStr(branch) })
  return saleOut(sale.toObject())
}

/** Cancel a sale taken in error: the stock goes back and Accounts reverses the money. */
export async function cancelSale(id, { reason }, auth, req) {
  const day = await today()
  const s = await withTransaction(async () => {
    const sale = isOid(id) ? await StoreSale.findOne({ _id: id, ...siteFilter(auth) }) : null
    if (!sale) throw notFound('Sale')
    if (sale.status === 'CANCELLED') throw conflict('This sale is already cancelled.')
    const r = await StoreSale.updateOne({ _id: sale._id, status: 'PAID' }, { $set: { status: 'CANCELLED', cancelled: { ...stampOf(auth), reason, on: day } } })
    if (!r.modifiedCount) throw conflict('This sale was just cancelled.')
    const items = new Map((await StoreItem.find({ _id: { $in: sale.lines.map((l) => l.itemId) } }).lean()).map((i) => [String(i._id), i]))
    for (const l of sale.lines) {
      const item = items.get(String(l.itemId))
      if (!item) continue
      await applyMove({ item, branchId: sale.branchId, size: l.size ?? '', type: 'SALE_CANCEL', qty: l.qty, party: { kind: 'STUDENT', id: sale.studentId, name: sale.student?.name }, refType: 'SALE', refId: sale._id, refNo: sale.saleNo, note: reason, date: day }, auth)
    }
    return sale
  })
  await audit({ action: 'CANCEL', module: 'inventory', entityType: 'store_sale', entityId: String(s._id), entityName: s.saleNo, studentId: s.studentId, summary: `Cancelled store sale ${s.saleNo} (${formatINR(s.total)}) of ${s.student?.name}: ${reason}` }, req)
  await emit('inventory.sale_cancelled', { entity: { type: 'store_sale', id: s._id }, saleNo: s.saleNo, studentId: String(s.studentId), amount: s.total, mode: s.mode, date: day, branchId: idStr(s.branchId) })
  return saleOut((await StoreSale.findById(s._id).lean()))
}

/** Sales of a day (default today) or a range, with the day's totals by payment mode. */
export async function listSales({ date, from, to, status, search, studentId, branchId, page = 1, pageSize = 50 }, auth) {
  const base = branchQuery(auth, branchId)
  const f = { ...base }
  const d = date || (!from && !to ? await today() : null)
  if (d) f.date = d
  else f.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  if (status && status !== 'ALL') f.status = status
  if (studentId && isOid(studentId)) f.studentId = studentId
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ saleNo: rx(q) }, { 'student.name': rx(q) }, { 'student.admissionNo': rx(q) }]
  const [rows, total, byMode, items] = await Promise.all([
    StoreSale.find(f).sort({ at: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    StoreSale.countDocuments(f),
    StoreSale.aggregate([{ $match: { ...base, date: f.date, status: 'PAID' } }, { $group: { _id: '$mode', n: { $sum: 1 }, amount: { $sum: '$total' } } }]),
    StoreSale.aggregate([{ $match: { ...base, date: f.date, status: 'PAID' } }, { $unwind: '$lines' }, { $group: { _id: { name: '$lines.name', category: '$lines.category' }, qty: { $sum: '$lines.qty' }, amount: { $sum: '$lines.amount' } } }, { $sort: { amount: -1 } }, { $limit: 8 }]),
  ])
  const modes = Object.fromEntries(STORE_SALE_MODES.map((m) => [m, { count: 0, amount: 0 }]))
  for (const m of byMode) modes[m._id] = { count: m.n, amount: m.amount }
  const cancelled = await StoreSale.countDocuments({ ...base, date: f.date, status: 'CANCELLED' })
  return {
    data: rows.map(saleOut), total, page, pageSize,
    day: { date: d, from, to, modes, amount: Object.values(modes).reduce((s, m) => s + m.amount, 0), count: Object.values(modes).reduce((s, m) => s + m.count, 0), cancelled },
    topItems: items.map((i) => ({ name: i._id.name, category: i._id.category, qty: i.qty, amount: i.amount })),
  }
}

export async function getSale(id, auth) {
  const s = isOid(id) ? await StoreSale.findOne({ _id: id, ...siteFilter(auth) }).lean() : null
  if (!s) throw notFound('Sale')
  return saleOut(s)
}

export async function exportSales(q, auth) {
  const { data } = await listSales({ ...q, page: 1, pageSize: 20000 }, auth)
  const head = ['Receipt', 'Date', 'Student', 'Admission no.', 'Class', 'Items', 'Amount', 'Mode', 'Reference', 'Status', 'By']
  return [head, ...data.map((s) => [s.saleNo, s.date, s.student?.name, s.student?.admissionNo, s.student?.class, s.lines.map((l) => `${l.qty} × ${l.name}${l.size ? ` (${l.size})` : ''}`).join('; '), (s.total / 100).toFixed(2), s.mode, s.reference, s.status, s.by])]
    .map((r) => r.map(csvCell).join(',')).join('\n')
}

// ───────────────────────────────────────────────────────── print

/** STORE_SALE_RECEIPT document data (documents/inventoryDocs.js). */
export async function salePrintData(id, auth) {
  const s = isOid(id) ? await StoreSale.findOne({ _id: id, ...siteFilter(auth) }).lean() : null
  if (!s) throw notFound('Sale')
  const branch = s.branchId ? await Branch.findById(s.branchId).select('name').lean() : null
  return { sale: s, branch }
}

export const latestSaleId = async () => (await StoreSale.findOne().sort({ at: -1 }).select('_id').lean())?._id
