import {
  COPY_SOURCES, COPY_STATUS, ITEM_TYPES, cleanIsbn, formatINR, hasCopies, isbn13, isValidIsbn, splitAuthors,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { ClassLevel } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { LibraryCopy, LibraryFine, LibraryLoan, LibraryTitle } from '../models/library.js'
import { Tenant } from '../models/platform.js'
import { Branch } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { nextNumber } from '../platform/numbering.js'
import { institutionNow } from '../platform/time.js'

// Library catalogue (module `library`): titles, their copies (one accession number — the barcode — each), the
// spreadsheet import that keeps the numbers already written in the books, the export, barcode labels, and filling a
// title from its ISBN (Open Library). The issue desk is services/libraryDesk.js, fines services/libraryFines.js.

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
export const today = async () => (await institutionNow()).date
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

/** Campus scope: someone on one campus works with its copies, loans and fines (and the ones on no campus). */
export function siteFilter(auth) {
  if (!auth || scopeOf(auth, 'library') === 'ALL' || !auth.user?.branchId) return {}
  return { branchId: { $in: [oid(auth.user.branchId), null] } }
}

const normIsbn = (s) => (s ? isbn13(s) ?? cleanIsbn(s) : undefined)

// ───────────────────────────────────────────────────────── titles

async function copyCounts(titleIds, auth) {
  const rows = await LibraryCopy.aggregate([{ $match: { titleId: { $in: titleIds }, ...siteFilter(auth) } }, { $group: { _id: { t: '$titleId', s: '$status' }, n: { $sum: 1 } } }])
  const out = new Map()
  for (const r of rows) {
    const c = out.get(String(r._id.t)) ?? { total: 0, available: 0, issued: 0 }
    if (r._id.s !== 'WITHDRAWN') c.total += r.n
    if (r._id.s === 'AVAILABLE') c.available += r.n
    if (r._id.s === 'ISSUED') c.issued += r.n
    out.set(String(r._id.t), c)
  }
  return out
}

const titleOut = (t, counts) => ({ ...clean(t), classIds: (t.classIds ?? []).map(String), copies: counts.get(String(t._id)) ?? { total: 0, available: 0, issued: 0 } })

/** The catalogue: search by title, author, ISBN, call number or an accession number; filter by type or category. */
export async function listTitles({ search, type, category, available, page = 1, pageSize = 50 }, auth) {
  const f = { active: true }
  if (type) f.type = type
  if (category) f.category = category
  const q = String(search ?? '').trim()
  if (q) {
    const byCopy = await LibraryCopy.find({ accessionNo: q.toUpperCase() }).select('titleId').lean()
    const isbn = cleanIsbn(q)
    f.$or = [{ title: rx(q) }, { authors: rx(q) }, { callNo: rx(q) }, { publisher: rx(q) }, ...(isbn.length >= 10 ? [{ isbn: normIsbn(isbn) }] : []), ...(byCopy.length ? [{ _id: { $in: byCopy.map((c) => c.titleId) } }] : [])]
  }
  if (available) f._id = { $in: await LibraryCopy.distinct('titleId', { status: 'AVAILABLE', ...siteFilter(auth) }) }
  const [rows, total] = await Promise.all([LibraryTitle.find(f).sort({ title: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), LibraryTitle.countDocuments(f)])
  const counts = await copyCounts(rows.map((r) => r._id), auth)
  return { data: rows.map((t) => titleOut(t, counts)), total, page, pageSize }
}

/** Categories, languages and publishers in use (for the pickers), and the catalogue's totals. */
export async function libraryMeta(auth) {
  const [categories, languages, titles, copies, issued, overdue, fines] = await Promise.all([
    LibraryTitle.distinct('category', { active: true }), LibraryTitle.distinct('language', { active: true }),
    LibraryTitle.countDocuments({ active: true }), LibraryCopy.countDocuments({ status: { $ne: 'WITHDRAWN' }, ...siteFilter(auth) }),
    LibraryLoan.countDocuments({ status: 'ISSUED', ...siteFilter(auth) }), LibraryLoan.countDocuments({ status: 'ISSUED', dueOn: { $lt: await today() }, ...siteFilter(auth) }),
    LibraryFine.aggregate([{ $match: { status: 'OPEN', ...siteFilter(auth) } }, { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ])
  const branches = await Branch.find({ active: { $ne: false } }).select('name code').sort({ name: 1 }).lean()
  return {
    categories: categories.filter(Boolean).sort(), languages: languages.filter(Boolean).sort(), branches: branches.map((b) => ({ id: String(b._id), name: b.name })),
    totals: { titles, copies, issued, overdue, fines: fines[0]?.n ?? 0, finesDue: fines[0]?.amount ?? 0 },
  }
}

export async function getTitle(id, auth) {
  const t = isOid(id) ? await LibraryTitle.findById(id).lean() : null
  if (!t) throw notFound('Title')
  const [copies, loans, files, classes] = await Promise.all([
    LibraryCopy.find({ titleId: t._id, ...siteFilter(auth) }).sort({ accessionNo: 1 }).lean(),
    LibraryLoan.find({ titleId: t._id, ...siteFilter(auth) }).sort({ issuedOn: -1 }).limit(30).lean(),
    Attachment.countDocuments({ entityType: 'library_title', entityId: String(t._id), 'deleted.at': null }),
    t.classIds?.length ? ClassLevel.find({ _id: { $in: t.classIds } }).select('name').lean() : [],
  ])
  const counts = await copyCounts([t._id], auth)
  const out = new Map(loans.filter((l) => l.status === 'ISSUED').map((l) => [String(l.copyId), l]))
  return {
    ...titleOut(t, counts), files, classNames: classes.map((c) => c.name),
    copyList: copies.map((c) => ({ ...clean(c), titleId: String(c.titleId), branchId: idStr(c.branchId), loanId: idStr(c.loanId), loan: out.has(String(c._id)) ? { borrower: out.get(String(c._id)).borrower?.name, dueOn: out.get(String(c._id)).dueOn } : null })),
    history: loans.map((l) => ({ id: String(l._id), accessionNo: l.accessionNo, borrower: l.borrower?.name, place: l.borrower?.place, issuedOn: l.issuedOn, dueOn: l.dueOn, returnedOn: l.returnedOn ?? null, status: l.status })),
  }
}

const TITLE_FIELDS = ['title', 'subtitle', 'authors', 'publisher', 'year', 'edition', 'language', 'type', 'category', 'callNo', 'description', 'ebookUrl', 'forFamilies', 'classIds', 'active']

export async function saveTitle(id, input, auth, req) {
  if (input.isbn && !isValidIsbn(input.isbn)) throw fieldsError({ isbn: 'Not a valid ISBN (check the digits)' })
  const isbn = normIsbn(input.isbn)
  if (isbn && await LibraryTitle.exists({ isbn, active: true, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ isbn: 'A title with this ISBN is in the catalogue — add copies to it instead' })
  if (input.type === 'EBOOK' && input.forFamilies && !input.ebookUrl && !id) throw fieldsError({ ebookUrl: 'Add the link (or save, then attach the file)' })
  const t = id ? await LibraryTitle.findById(id) : new LibraryTitle({ createdBy: auth.user?.name })
  if (!t) throw notFound('Title')
  if (id && input.type && input.type !== t.type && !hasCopies(input.type) && await LibraryCopy.exists({ titleId: t._id, status: { $ne: 'WITHDRAWN' } })) throw conflict('This title has copies on the shelf. Withdraw them before making it an e-book.')
  for (const k of TITLE_FIELDS) if (input[k] !== undefined) t[k] = input[k]
  t.isbn = isbn
  if (input.classIds && !input.classIds.length) t.classIds = undefined
  await t.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'library', entityType: 'library_title', entityId: String(t._id), entityName: t.title, summary: `${id ? 'Changed' : 'Added'} “${t.title}” in the catalogue` }, req)
  let added = []
  if (!id && input.copies?.count && hasCopies(t.type)) added = await addCopies(String(t._id), input.copies, auth, req, { quiet: true })
  return { ...(await getTitle(String(t._id), auth)), added: added.length }
}

export async function deleteTitle(id, auth, req) {
  const t = isOid(id) ? await LibraryTitle.findById(id) : null
  if (!t) throw notFound('Title')
  if (await LibraryLoan.exists({ titleId: t._id, status: 'ISSUED' })) throw conflict('Copies of this title are out. Take them back first.')
  if (await LibraryLoan.exists({ titleId: t._id })) {
    t.active = false
    await t.save()
    await LibraryCopy.updateMany({ titleId: t._id, status: { $in: ['AVAILABLE', 'DAMAGED'] } }, { $set: { status: 'WITHDRAWN', withdrawn: { on: await today(), reason: 'Title removed from the catalogue', by: auth.user?.name } } })
  } else {
    await LibraryCopy.deleteMany({ titleId: t._id })
    await LibraryTitle.deleteOne({ _id: t._id })
  }
  await audit({ action: 'DELETE', module: 'library', entityType: 'library_title', entityId: String(t._id), entityName: t.title, summary: `Removed “${t.title}” from the catalogue` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── copies

/**
 * Add copies of a title: `count` new ones numbered from the accession series, or the numbers given (`accessionNos`,
 * for books that already carry one). They go on the user's campus unless another is picked.
 */
export async function addCopies(titleId, input, auth, req, { quiet = false } = {}) {
  const t = isOid(titleId) ? await LibraryTitle.findById(titleId).lean() : null
  if (!t) throw notFound('Title')
  if (!hasCopies(t.type)) throw conflict('An e-book has no copies on the shelf.')
  const branchId = input.branchId || auth.user?.branchId || undefined
  const given = [...new Set((input.accessionNos ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))]
  if (given.length) {
    const taken = await LibraryCopy.find({ accessionNo: { $in: given } }).select('accessionNo').lean()
    if (taken.length) throw fieldsError({ accessionNos: `Already used: ${taken.map((x) => x.accessionNo).join(', ')}` })
  }
  const count = given.length || Math.min(200, Math.max(1, Number(input.count) || 1))
  const docs = []
  for (let i = 0; i < count; i++) {
    docs.push({
      titleId: t._id, accessionNo: given[i] ?? await nextNumber('LIBRARY_ACCESSION', { branchId }), branchId, status: 'AVAILABLE', shelf: input.shelf || undefined,
      price: input.price ?? undefined, acquiredOn: input.acquiredOn || await today(), source: input.source || 'PURCHASE', vendor: input.vendor || undefined, billNo: input.billNo || undefined, note: input.note || undefined,
    })
  }
  const made = await LibraryCopy.insertMany(docs)
  if (!quiet) await audit({ action: 'CREATE', module: 'library', entityType: 'library_title', entityId: String(t._id), entityName: t.title, summary: `Added ${made.length} cop${made.length === 1 ? 'y' : 'ies'} of “${t.title}” (${made[0].accessionNo}${made.length > 1 ? ` – ${made[made.length - 1].accessionNo}` : ''})` }, req)
  return made.map((c) => ({ id: String(c._id), accessionNo: c.accessionNo }))
}

export async function updateCopy(id, input, auth, req) {
  const c = isOid(id) ? await LibraryCopy.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!c) throw notFound('Copy')
  if (input.status && input.status !== c.status) {
    if (c.status === 'ISSUED' || input.status === 'ISSUED') throw conflict('Issue and return at the desk; a copy out on loan can be marked lost there.')
    if (input.status === 'WITHDRAWN') c.withdrawn = { on: await today(), reason: input.reason || undefined, by: auth.user?.name }
    c.status = input.status
  }
  for (const k of ['shelf', 'price', 'note', 'branchId', 'source', 'vendor', 'billNo', 'acquiredOn']) if (input[k] !== undefined) c[k] = input[k] === '' ? undefined : input[k]
  await c.save()
  await audit({ action: 'UPDATE', module: 'library', entityType: 'library_title', entityId: String(c.titleId), entityName: c.accessionNo, summary: `Changed copy ${c.accessionNo}${input.status ? ` (${COPY_STATUS[c.status].label.toLowerCase()})` : ''}` }, req)
  return { ...clean(c.toObject()), titleId: String(c.titleId) }
}

export async function deleteCopy(id, auth, req) {
  const c = isOid(id) ? await LibraryCopy.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!c) throw notFound('Copy')
  if (await LibraryLoan.exists({ copyId: c._id })) throw conflict('This copy has been lent before. Withdraw it instead, so its history stays.')
  await LibraryCopy.deleteOne({ _id: c._id })
  await audit({ action: 'DELETE', module: 'library', entityType: 'library_title', entityId: String(c.titleId), entityName: c.accessionNo, summary: `Deleted copy ${c.accessionNo}` }, req)
  return { deleted: true }
}

/** A copy by its barcode (accession number): the title, and the loan it is out on. */
export async function copyByCode(code, auth) {
  const c = await LibraryCopy.findOne({ accessionNo: String(code ?? '').trim().toUpperCase(), ...siteFilter(auth) }).lean()
  if (!c) throw notFound('Book with this number')
  const [t, loan] = await Promise.all([LibraryTitle.findById(c.titleId).lean(), c.status === 'ISSUED' ? LibraryLoan.findOne({ copyId: c._id, status: 'ISSUED' }).lean() : null])
  return {
    id: String(c._id), accessionNo: c.accessionNo, status: c.status, shelf: c.shelf ?? null, price: c.price ?? null,
    title: { id: String(t?._id), title: t?.title ?? '', authors: t?.authors ?? [], type: t?.type, callNo: t?.callNo ?? null },
    loan: loan && { id: String(loan._id), borrower: loan.borrower, issuedOn: loan.issuedOn, dueOn: loan.dueOn, renewals: loan.renewals },
  }
}

// ───────────────────────────────────────────────────────── labels (LIBRARY_LABEL document)

/** Spine / barcode labels for copies (`ids`: copy ids, or title ids for all their copies). */
export async function labelsPrint(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(isOid)
  const copies = await LibraryCopy.find({ $or: [{ _id: { $in: list } }, { titleId: { $in: list } }], status: { $ne: 'WITHDRAWN' } }).sort({ accessionNo: 1 }).limit(600).lean()
  if (!copies.length) throw notFound('Copy')
  const titles = new Map((await LibraryTitle.find({ _id: { $in: copies.map((c) => c.titleId) } }).select('title authors callNo').lean()).map((t) => [String(t._id), t]))
  const tenant = await Tenant.findById(getContext()?.tenantId).select('name profile').lean()
  return {
    institution: { name: tenant?.name, ...(tenant?.profile ?? {}) },
    labels: copies.map((c) => { const t = titles.get(String(c.titleId)); return { accessionNo: c.accessionNo, title: t?.title ?? '', author: t?.authors?.[0] ?? '', callNo: t?.callNo ?? '', shelf: c.shelf ?? '' } }),
  }
}
export const labelsModel = (raw) => ({ ...raw, count: raw.labels.length })
export const latestCopyId = async () => (await LibraryCopy.findOne().sort({ createdAt: -1 }).select('_id').lean())?._id

// ───────────────────────────────────────────────────────── ISBN lookup

/** What Open Library knows about an ISBN (title, authors, publisher, year), or null. Nothing leaves in tests. */
export async function isbnLookup(raw) {
  const isbn = isbn13(raw)
  if (!isbn) throw fieldsError({ isbn: 'Not a valid ISBN (check the digits)' })
  const existing = await LibraryTitle.findOne({ isbn, active: true }).select('title').lean()
  if (config.isTest) return { isbn, found: false, existing: existing && { id: String(existing._id), title: existing.title } }
  let found = null
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { signal: AbortSignal.timeout(6000), redirect: 'follow', headers: { accept: 'application/json' } })
    const body = res.ok ? await res.json() : {}
    const b = body[`ISBN:${isbn}`]
    if (b) {
      found = {
        title: b.title, subtitle: b.subtitle || undefined, authors: (b.authors ?? []).map((a) => a.name).filter(Boolean).slice(0, 6),
        publisher: b.publishers?.[0]?.name, year: Number(String(b.publish_date ?? '').match(/\d{4}/)?.[0]) || undefined,
        category: b.subjects?.[0]?.name?.slice(0, 60),
      }
    }
  } catch (err) { logger.info({ err: err.message, isbn }, 'ISBN lookup failed') }
  return { isbn, found: !!found, ...(found && { data: found }), existing: existing && { id: String(existing._id), title: existing.title } }
}

// ───────────────────────────────────────────────────────── import and export

const pick = (list, v) => {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  return list.find((x) => x.value === s.toUpperCase().replace(/[\s/-]+/g, '_') || x.label.toLowerCase() === s.toLowerCase())?.value ?? null
}

/**
 * The catalogue from a spreadsheet, one row per title. Columns: title, authors, isbn, publisher, year, edition,
 * language, type, category, callNo, copies (how many to number), accessionNos (the numbers already in the books,
 * separated by commas — instead of `copies`), price (₹ a copy), shelf, source. A row whose ISBN is already in the
 * catalogue adds its copies to that title. A dry run checks every row and saves nothing.
 */
export async function importCatalogue(rows, { dryRun }, auth, req) {
  const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const taken = new Set((await LibraryCopy.find().select('accessionNo').lean()).map((c) => c.accessionNo))
  const byIsbn = new Map((await LibraryTitle.find({ isbn: { $type: 'string' }, active: true }).select('isbn').lean()).map((t) => [t.isbn, String(t._id)]))
  const seen = new Set()
  const out = rows.map((f, i) => {
    const errors = []
    const type = pick(ITEM_TYPES, f.type) ?? 'BOOK'
    const accessionNos = cell(f.accessionNos ?? f.accessionNo).split(/[,;\s]+/).map((x) => x.toUpperCase()).filter(Boolean)
    const price = cell(f.price) ? Math.round(Number(cell(f.price).replace(/[₹,\s]/g, '')) * 100) : undefined
    const doc = {
      title: cell(f.title), authors: splitAuthors(f.authors ?? f.author), isbn: cell(f.isbn) || undefined, publisher: cell(f.publisher) || undefined,
      year: cell(f.year) ? Number(cell(f.year)) : undefined, edition: cell(f.edition) || undefined, language: cell(f.language) || undefined,
      type, category: cell(f.category) || undefined, callNo: cell(f.callNo) || undefined,
      copies: accessionNos.length ? 0 : (cell(f.copies) ? Number(cell(f.copies)) : hasCopies(type) ? 1 : 0), accessionNos, price, shelf: cell(f.shelf) || undefined,
      source: pick(COPY_SOURCES, f.source) ?? 'PURCHASE',
    }
    if (doc.title.length < 1) errors.push({ field: 'title', message: 'Enter the title' })
    if (pick(ITEM_TYPES, f.type) === null) errors.push({ field: 'type', message: `No type "${cell(f.type)}"` })
    if (pick(COPY_SOURCES, f.source) === null) errors.push({ field: 'source', message: `No source "${cell(f.source)}"` })
    if (doc.isbn && !isValidIsbn(doc.isbn)) errors.push({ field: 'isbn', message: 'Not a valid ISBN' })
    if (doc.year !== undefined && !(Number.isInteger(doc.year) && doc.year > 1400 && doc.year < 2100)) errors.push({ field: 'year', message: 'Use a year like 2019' })
    if (!Number.isInteger(doc.copies) || doc.copies < 0 || doc.copies > 200) errors.push({ field: 'copies', message: 'A number from 0 to 200' })
    if (price !== undefined && !(price >= 0)) errors.push({ field: 'price', message: 'Not an amount' })
    if (!hasCopies(type) && (doc.copies || accessionNos.length)) errors.push({ field: 'copies', message: 'An e-book has no copies' })
    for (const a of accessionNos) {
      if (taken.has(a) || seen.has(a)) { errors.push({ field: 'accessionNos', message: `${a} is ${taken.has(a) ? 'already used' : 'twice in this file'}` }); break }
    }
    accessionNos.forEach((a) => seen.add(a))
    const isbn = doc.isbn && isValidIsbn(doc.isbn) ? normIsbn(doc.isbn) : null
    return { row: i + 1, fields: f, errors, doc, existing: isbn ? byIsbn.get(isbn) ?? null : null, adds: accessionNos.length || doc.copies }
  })
  if (dryRun) return { rows: out.map(({ doc, existing, adds, ...r }) => ({ ...r, note: existing ? `Adds ${adds} cop${adds === 1 ? 'y' : 'ies'} to the title already in the catalogue` : undefined })) }
  let imported = 0
  let copies = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    try {
      const { copies: count, accessionNos, price, shelf, source, ...d } = r.doc
      let titleId = r.existing
      if (!titleId) {
        const t = await LibraryTitle.create({ ...d, isbn: normIsbn(d.isbn), createdBy: auth.user?.name })
        titleId = String(t._id)
        if (d.isbn) byIsbn.set(t.isbn, titleId)
        imported++
      }
      if (count || accessionNos.length) copies += (await addCopies(titleId, { count, accessionNos, price, shelf, source }, auth, req, { quiet: true })).length
    } catch (e) {
      errors.push({ row: r.row, field: e.details?.fields ? Object.keys(e.details.fields)[0] : 'title', message: e.message })
    }
  }
  if (imported || copies) await audit({ action: 'IMPORT', module: 'library', entityType: 'library_title', entityName: `${imported} titles`, summary: `Imported ${imported} title(s) and ${copies} copies from a file` }, req)
  return { imported, copies, errors }
}

/** Every copy with its title, for a spreadsheet (stock check, insurance, the accession register). */
export async function exportCatalogue(auth) {
  const copies = await LibraryCopy.find(siteFilter(auth)).sort({ accessionNo: 1 }).limit(100000).lean()
  const titles = new Map((await LibraryTitle.find({ _id: { $in: [...new Set(copies.map((c) => String(c.titleId)))] } }).lean()).map((t) => [String(t._id), t]))
  const ebooks = await LibraryTitle.find({ type: 'EBOOK', active: true }).lean()
  const head = ['Accession no.', 'Title', 'Authors', 'ISBN', 'Publisher', 'Year', 'Edition', 'Type', 'Category', 'Call no.', 'Shelf', 'Status', 'Price', 'Acquired', 'Source']
  const typeLabel = Object.fromEntries(ITEM_TYPES.map((x) => [x.value, x.label]))
  const rows = copies.map((c) => {
    const t = titles.get(String(c.titleId)) ?? {}
    return [c.accessionNo, t.title, (t.authors ?? []).join('; '), t.isbn, t.publisher, t.year, t.edition, typeLabel[t.type], t.category, t.callNo, c.shelf, COPY_STATUS[c.status]?.label, c.price != null ? formatINR(c.price) : '', c.acquiredOn, COPY_SOURCES.find((s) => s.value === c.source)?.label]
  })
  for (const t of ebooks) rows.push(['', t.title, (t.authors ?? []).join('; '), t.isbn, t.publisher, t.year, t.edition, typeLabel.EBOOK, t.category, t.callNo, '', '', '', '', ''])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

/** Files engine: who sees and adds an e-book's files. */
export async function libraryTitleRecord(id) {
  if (!isOid(id)) return null
  const t = await LibraryTitle.findById(id).select('title').lean()
  return t ? { name: t.title, canAdd: true } : null
}
