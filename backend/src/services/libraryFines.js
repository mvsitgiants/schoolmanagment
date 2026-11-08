import { FINE_REASONS, PAYMENT_MODE_LABEL, formatINR } from '@schoolgiant/shared'
import { LibraryFine, LibraryLoan } from '../models/library.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { siteFilter, today } from './library.js'
import { borrowerCard } from './libraryDesk.js'

// Library fines: what borrowers owe — late returns (made at the desk), lost and damaged books, anything else the
// librarian charges. Collected at the desk with one receipt number for what is paid together (each fine posts to
// Accounts › "Late fees & fines" when Accounts is on); waived with a reason; a payment taken in error is cancelled.

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
const fineOut = (f) => ({ ...clean(f), loanId: f.loanId ? String(f.loanId) : null, studentId: f.studentId ? String(f.studentId) : null, borrower: f.borrower && { ...f.borrower, id: String(f.borrower.id) } })

export async function listFines({ status = 'OPEN', search, reason, from, to, page = 1, pageSize = 50 }, auth) {
  const f = { ...siteFilter(auth) }
  if (status && status !== 'ALL') f.status = status
  if (reason) f.reason = reason
  if (from || to) f[status === 'PAID' ? 'paid.date' : 'date'] = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ 'borrower.name': rx(q) }, { 'borrower.code': rx(q) }, { accessionNo: q.toUpperCase() }, { 'paid.receiptNo': q.toUpperCase() }]
  const [rows, total, sums] = await Promise.all([
    LibraryFine.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    LibraryFine.countDocuments(f),
    LibraryFine.aggregate([{ $match: { ...siteFilter(auth) } }, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ])
  const totals = Object.fromEntries(sums.map((s) => [s._id, { count: s.n, amount: s.amount }]))
  return { data: rows.map(fineOut), total, page, pageSize, totals }
}

/** A charge the librarian adds by hand (a torn page, a lost card …), against a borrower. */
export async function createFine({ kind, id, reason, amount, note }, auth, req) {
  const card = await borrowerCard({ kind, id }, auth)
  const b = card.borrower
  const f = await LibraryFine.create({
    borrower: { kind: b.kind, id: b.id, name: b.name, code: b.code, place: b.place }, studentId: b.kind === 'STUDENT' ? b.id : undefined, branchId: auth.user?.branchId || b.branchId || undefined,
    reason, amount, note, date: await today(), createdBy: auth.user?.name,
  })
  await audit({ action: 'CREATE', module: 'library', entityType: 'library_fine', entityId: String(f._id), entityName: b.name, ...(b.kind === 'STUDENT' && { studentId: b.id }), summary: `Fine of ${formatINR(amount)} on ${b.name}: ${FINE_REASONS.find((r) => r.value === reason)?.label ?? reason}${note ? ` — ${note}` : ''}` }, req)
  return fineOut(f.toObject())
}

/** Take payment for one or more open fines of one borrower: one receipt number for them all. */
export async function collectFines({ ids, mode, reference, date }, auth, req) {
  const fines = await LibraryFine.find({ _id: { $in: ids.filter(isOid) }, ...siteFilter(auth) }).lean()
  if (fines.length !== ids.length) throw notFound('Fine')
  if (fines.some((f) => f.status !== 'OPEN')) throw conflict('Some of these are already paid or waived.')
  const who = new Set(fines.map((f) => `${f.borrower.kind}:${f.borrower.id}`))
  if (who.size > 1) throw badRequest('Collect one borrower’s fines at a time.')
  const day = date || await today()
  if (day > await today()) throw badRequest('The payment date is in the future.', { fields: { date: 'Pick today or earlier' } })
  const receiptNo = await nextNumber('LIBRARY_FINE', { branchId: fines[0].branchId ?? auth.user?.branchId, date: new Date(`${day}T12:00:00Z`) })
  const paid = { receiptNo, date: day, mode, reference: reference || undefined, by: auth.user?.name, at: new Date() }
  const r = await LibraryFine.updateMany({ _id: { $in: fines.map((f) => f._id) }, status: 'OPEN' }, { $set: { status: 'PAID', paid } })
  if (r.modifiedCount !== fines.length) throw conflict('Some of these fines were just collected at another desk.')
  for (const f of fines) await emit('library.fine_paid', { entity: { type: 'library_fine', id: f._id } })
  const total = fines.reduce((n, f) => n + f.amount, 0)
  await audit({ action: 'CREATE', module: 'library', entityType: 'library_fine', entityId: String(fines[0]._id), entityName: fines[0].borrower.name, ...(fines[0].studentId && { studentId: fines[0].studentId }), summary: `Collected ${formatINR(total)} in library fines from ${fines[0].borrower.name} (${PAYMENT_MODE_LABEL[mode] ?? mode}), receipt ${receiptNo}` }, req)
  return { receiptNo, date: day, mode, total, count: fines.length, borrower: fines[0].borrower.name }
}

/** Let an open fine go, with the reason. */
export async function waiveFine(id, { reason }, auth, req) {
  const f = isOid(id) ? await LibraryFine.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!f) throw notFound('Fine')
  if (f.status !== 'OPEN') throw conflict(f.status === 'PAID' ? 'This fine is paid. Cancel the payment first.' : 'This fine is already waived.')
  f.status = 'WAIVED'
  f.waived = { reason, by: auth.user?.name, at: new Date() }
  await f.save()
  await audit({ action: 'UPDATE', module: 'library', entityType: 'library_fine', entityId: String(f._id), entityName: f.borrower.name, ...(f.studentId && { studentId: f.studentId }), summary: `Waived a ${formatINR(f.amount)} library fine of ${f.borrower.name}: ${reason}` }, req)
  return fineOut(f.toObject())
}

/** A payment taken in error: the fine is open again (and the voucher reversed in Accounts). */
export async function cancelPayment(id, { reason }, auth, req) {
  const f = isOid(id) ? await LibraryFine.findOne({ _id: id, ...siteFilter(auth) }) : null
  if (!f) throw notFound('Fine')
  if (f.status !== 'PAID') throw conflict('This fine isn’t paid.')
  const was = { ...f.paid.toObject?.() ?? f.paid }
  f.status = 'OPEN'
  f.cancelled = [...(f.cancelled ?? []), { ...was, reason, cancelledBy: auth.user?.name, cancelledAt: new Date(), on: await today() }]
  f.paid = undefined
  await f.save()
  await emit('library.fine_cancelled', { entity: { type: 'library_fine', id: f._id } })
  await audit({ action: 'UPDATE', module: 'library', entityType: 'library_fine', entityId: String(f._id), entityName: f.borrower.name, ...(f.studentId && { studentId: f.studentId }), summary: `Cancelled the payment of a ${formatINR(f.amount)} library fine (receipt ${was.receiptNo}): ${reason}` }, req)
  return fineOut(f.toObject())
}

export async function exportFines(q, auth) {
  const { data } = await listFines({ ...q, page: 1, pageSize: 20000 }, auth)
  const head = ['Date', 'Borrower', 'Number', 'Class / designation', 'Reason', 'Book', 'Accession no.', 'Days late', 'Amount', 'Status', 'Receipt', 'Paid on', 'Mode', 'Waived because']
  const reason = Object.fromEntries(FINE_REASONS.map((r) => [r.value, r.label]))
  return [head, ...data.map((f) => [f.date, f.borrower?.name, f.borrower?.code, f.borrower?.place, reason[f.reason], f.title, f.accessionNo, f.days, formatINR(f.amount), f.status, f.paid?.receiptNo, f.paid?.date, PAYMENT_MODE_LABEL[f.paid?.mode] ?? f.paid?.mode, f.waived?.reason])].map((r) => r.map(csvCell).join(',')).join('\n')
}

/** A loan's fines (the desk's return screen). */
export async function finesOfLoan(loanId) {
  const loan = isOid(loanId) ? await LibraryLoan.findById(loanId).select('fineIds').lean() : null
  if (!loan) throw notFound('Loan')
  return (await LibraryFine.find({ _id: { $in: loan.fineIds } }).lean()).map(fineOut)
}
