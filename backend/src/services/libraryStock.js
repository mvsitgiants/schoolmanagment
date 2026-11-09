import { LibraryCopy, LibraryStockCheck, LibraryTitle } from '../models/library.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { conflict, notFound } from '../platform/errors.js'
import { siteFilter } from './library.js'

// Library › Stock check: scan every book on the shelves (camera or a scanner gun). A copy that should be on a shelf
// (AVAILABLE) and was never scanned is missing; copies out on loan are counted apart, not missing. Nothing changes a
// copy's status — the librarian decides what to mark lost from the list.

const ON_SHELF = ['AVAILABLE', 'DAMAGED']
const MISSING_SHOWN = 400

function shelfMatch(check) {
  return check.shelf ? { shelf: check.shelf } : {}
}

async function checkFor(id) {
  if (!isOid(id)) throw notFound('Stock check')
  const c = await LibraryStockCheck.findById(id)
  if (!c) throw notFound('Stock check')
  return c
}

export async function listStockChecks(auth) {
  const rows = await LibraryStockCheck.find(siteFilter(auth)).sort({ startedAt: -1 }).limit(30).select('-seen -unknown').lean()
  return rows.map((r) => ({ id: String(r._id), name: r.name, shelf: r.shelf ?? null, status: r.status, startedAt: r.startedAt, startedBy: r.startedBy, closedAt: r.closedAt ?? null, summary: r.summary ?? null }))
}

export async function startStockCheck({ name, shelf }, auth, req) {
  const site = siteFilter(auth)
  if (await LibraryStockCheck.exists({ ...site, status: 'OPEN' })) throw conflict('A stock check is already open — finish it first.')
  const c = await LibraryStockCheck.create({ name, shelf: shelf || undefined, branchId: auth.user?.branchId || undefined, startedBy: auth.user?.name })
  await audit({ action: 'CREATE', module: 'library', entityType: 'stock_check', entityId: String(c._id), entityName: name, summary: `Started stock check “${name}”${shelf ? ` (shelf ${shelf})` : ''}` }, req)
  return stockCheckDetail(c._id, auth)
}

/** Where a check stands: expected on the shelves, scanned, missing (by shelf), out on loan. */
export async function stockCheckDetail(id, auth) {
  const c = (await checkFor(id)).toObject()
  const base = { ...siteFilter(auth), ...shelfMatch(c) }
  const seen = new Set(c.seen.map(String))
  const [shelfCopies, onLoan] = await Promise.all([
    LibraryCopy.find({ ...base, status: { $in: ON_SHELF } }).select('accessionNo shelf titleId status').lean(),
    LibraryCopy.countDocuments({ ...base, status: 'ISSUED' }),
  ])
  const missing = shelfCopies.filter((x) => !seen.has(String(x._id)))
  const shelves = new Map()
  for (const x of shelfCopies) {
    const k = x.shelf || ''
    const row = shelves.get(k) ?? { shelf: k || null, expected: 0, seen: 0 }
    row.expected++
    if (seen.has(String(x._id))) row.seen++
    shelves.set(k, row)
  }
  const titles = new Map((await LibraryTitle.find({ _id: { $in: missing.slice(0, MISSING_SHOWN).map((x) => x.titleId) } }).select('title authors').lean()).map((t) => [String(t._id), t]))
  return {
    id: String(c._id), name: c.name, shelf: c.shelf ?? null, status: c.status, startedAt: c.startedAt, startedBy: c.startedBy, closedAt: c.closedAt ?? null,
    expected: shelfCopies.length, seen: shelfCopies.length - missing.length, scanned: c.seen.length, missingCount: missing.length, onLoan, unknown: c.unknown.slice(-50),
    shelves: [...shelves.values()].sort((a, b) => String(a.shelf ?? '~').localeCompare(String(b.shelf ?? '~'), 'en', { numeric: true })),
    missing: missing.slice(0, MISSING_SHOWN).map((x) => ({ id: String(x._id), accessionNo: x.accessionNo, shelf: x.shelf ?? null, title: titles.get(String(x.titleId))?.title ?? '' })),
  }
}

/** One book scanned during the check. */
export async function scanForStock(id, code, auth) {
  const c = await checkFor(id)
  if (c.status !== 'OPEN') throw conflict('This stock check is finished.')
  const accessionNo = String(code ?? '').trim().toUpperCase()
  const copy = await LibraryCopy.findOne({ accessionNo, ...siteFilter(auth) }).lean()
  if (!copy) {
    await LibraryStockCheck.updateOne({ _id: c._id }, { $addToSet: { unknown: accessionNo } })
    return { found: false, code: accessionNo }
  }
  const already = c.seen.some((x) => String(x) === String(copy._id))
  if (!already) await LibraryStockCheck.updateOne({ _id: c._id }, { $addToSet: { seen: copy._id } })
  const t = await LibraryTitle.findById(copy.titleId).select('title').lean()
  return {
    found: true, already, accessionNo: copy.accessionNo, title: t?.title ?? '', shelf: copy.shelf ?? null, status: copy.status,
    // a book scanned on the wrong shelf (when the check is for one shelf), or one the system thinks is out on loan
    wrongShelf: !!(c.shelf && copy.shelf && copy.shelf !== c.shelf), onLoan: copy.status === 'ISSUED',
  }
}

export async function closeStockCheck(id, auth, req) {
  const c = await checkFor(id)
  if (c.status !== 'OPEN') throw conflict('This stock check is already finished.')
  const d = await stockCheckDetail(id, auth)
  Object.assign(c, { status: 'CLOSED', closedAt: new Date(), closedBy: auth.user?.name, summary: { expected: d.expected, seen: d.seen, missing: d.missingCount, onLoan: d.onLoan } })
  await c.save()
  await audit({ action: 'UPDATE', module: 'library', entityType: 'stock_check', entityId: String(c._id), entityName: c.name, summary: `Finished stock check “${c.name}”: ${d.seen} of ${d.expected} found, ${d.missingCount} missing` }, req)
  return stockCheckDetail(id, auth)
}
