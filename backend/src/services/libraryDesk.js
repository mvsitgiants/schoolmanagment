import { addDaysYmd, dayDiff, formatINR, lateDays, lateFine, loanState, sectionLabel } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { Employee } from '../models/hrms.js'
import { LibraryCopy, LibraryFine, LibraryLoan, LibraryTitle } from '../models/library.js'
import { Student, studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { runAsSystem, runAsTenant } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { siteFilter, today } from './library.js'
import { humanDate } from './notify.js'

// The issue desk (Library › Issue & return): find the borrower (scan the ID card — admission number or staff code —
// or search), scan the books to issue; scan a book to take it back, which works out the late fine. Renew, mark lost.
// Reminders: the families of students are told a day before a book is due, and every few days once it is overdue.

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
const exact = (s) => new RegExp(`^${String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
const rupees = (n) => Math.round((Number(n) || 0) * 100)

async function placeOfStudents(students) {
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).lean()
  const cls = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), sectionLabel(cls.get(String(s.classId)), s, { short: true })]))
}

const asStudent = (s, place) => ({ kind: 'STUDENT', id: s._id, name: studentName(s), code: s.admissionNo, place: place ?? '', branchId: s.branchId, status: s.status })
const asStaff = (e) => ({ kind: 'STAFF', id: e._id, name: e.name, code: e.employeeCode, place: e.designation ?? '', branchId: e.branchId, status: e.status })

/** A borrower by what the card's barcode holds (admission number or staff code), or by kind and id. */
async function findBorrower({ kind, id, code }) {
  if (kind && isOid(id)) {
    if (kind === 'STUDENT') {
      const s = await Student.findById(id).select('firstName middleName lastName admissionNo sectionId branchId status').lean()
      return s && asStudent(s, (await placeOfStudents([s])).get(String(s.sectionId)))
    }
    const e = await Employee.findById(id).select('name employeeCode designation branchId status').lean()
    return e && asStaff(e)
  }
  const c = String(code ?? '').trim()
  if (!c) return null
  const s = await Student.findOne({ admissionNo: exact(c) }).select('firstName middleName lastName admissionNo sectionId branchId status').lean()
  if (s) return asStudent(s, (await placeOfStudents([s])).get(String(s.sectionId)))
  const e = await Employee.findOne({ employeeCode: c.toUpperCase() }).select('name employeeCode designation branchId status').lean()
  return e && asStaff(e)
}

/** Students and staff matching a name or number (the desk's search box). */
export async function searchBorrowers(q) {
  const s = String(q ?? '').trim()
  if (s.length < 2) return []
  const [students, staff] = await Promise.all([
    Student.find({ status: 'ACTIVE', $or: [{ firstName: rx(s) }, { lastName: rx(s) }, { admissionNo: rx(s) }] }).select('firstName middleName lastName admissionNo sectionId branchId status').limit(10).lean(),
    Employee.find({ status: { $in: ['ACTIVE', 'NOTICE'] }, $or: [{ name: rx(s) }, { employeeCode: rx(s) }] }).select('name employeeCode designation branchId status').limit(6).lean(),
  ])
  const places = await placeOfStudents(students)
  return [...students.map((x) => asStudent(x, places.get(String(x.sectionId)))), ...staff.map(asStaff)].map((b) => ({ ...b, id: String(b.id), branchId: b.branchId ? String(b.branchId) : null }))
}

const rules = (settings, kind) => ({
  limit: kind === 'STAFF' ? settings.staffLimit ?? 5 : settings.studentLimit ?? 2,
  days: kind === 'STAFF' ? settings.staffDays ?? 30 : settings.studentDays ?? 14,
  fines: kind !== 'STAFF' || settings.staffFines === true,
})
const fineRule = (settings) => ({ perDay: rupees(settings.finePerDay ?? 1), max: rupees(settings.fineMax ?? 0) })

/** The fine a loan has run up so far (or on the day given). */
export function fineSoFar(loan, day, settings) {
  if (!rules(settings, loan.borrower?.kind).fines) return 0
  return lateFine(lateDays(loan.dueOn, day, settings.graceDays ?? 0), fineRule(settings))
}

const loanOut = (l, t, settings) => {
  const state = loanState(l, t)
  return {
    ...clean(l), copyId: String(l.copyId), titleId: String(l.titleId), studentId: l.studentId ? String(l.studentId) : null, borrower: l.borrower && { ...l.borrower, id: String(l.borrower.id) },
    fineIds: (l.fineIds ?? []).map(String), state, daysLate: state === 'OVERDUE' ? dayDiff(l.dueOn, t) : 0, fineSoFar: state === 'OVERDUE' ? fineSoFar(l, t, settings) : 0,
  }
}

/** Everything the desk shows for a borrower: what they have out, what they owe, and whether they can take more. */
export async function borrowerCard(query, auth) {
  const b = await findBorrower(query)
  if (!b) throw notFound('Student or staff member with this number')
  const [settings, t] = await Promise.all([getSettings('library'), today()])
  const [loans, fines] = await Promise.all([
    LibraryLoan.find({ 'borrower.kind': b.kind, 'borrower.id': b.id, status: 'ISSUED' }).sort({ dueOn: 1 }).lean(),
    LibraryFine.find({ 'borrower.kind': b.kind, 'borrower.id': b.id, status: 'OPEN' }).sort({ date: 1 }).lean(),
  ])
  const r = rules(settings, b.kind)
  const out = loans.map((l) => loanOut(l, t, settings))
  const owed = fines.reduce((n, f) => n + f.amount, 0)
  const blocked = []
  if (b.kind === 'STUDENT' && b.status !== 'ACTIVE') blocked.push('NOT_ACTIVE')
  if (b.kind === 'STAFF' && b.status === 'EXITED') blocked.push('NOT_ACTIVE')
  if (out.length >= r.limit) blocked.push('LIMIT')
  if (settings.blockOverdue !== false && out.some((l) => l.state === 'OVERDUE')) blocked.push('OVERDUE')
  if (settings.blockWithFines !== false && owed > 0) blocked.push('FINES')
  return {
    borrower: { ...b, id: String(b.id), branchId: b.branchId ? String(b.branchId) : null },
    loans: out, fines: fines.map((f) => ({ ...clean(f), loanId: f.loanId ? String(f.loanId) : null })), owed,
    limit: r.limit, days: r.days, canTake: Math.max(0, r.limit - out.length), dueOn: addDaysYmd(t, r.days), blocked,
  }
}

const BLOCK_TEXT = { NOT_ACTIVE: 'they are no longer at the institution', LIMIT: 'they have as many books as they may', OVERDUE: 'a book of theirs is overdue', FINES: 'they have a fine to pay' }

/**
 * Issue books (by their barcodes) to a borrower. `override` issues past the limit, an overdue book or an unpaid fine
 * (the librarian's call — it is written in the audit log); someone who has left can't borrow at all.
 */
export async function issueBooks({ kind, id, codes, dueOn, override = false }, auth, req) {
  const card = await borrowerCard({ kind, id }, auth)
  const b = card.borrower
  if (card.blocked.includes('NOT_ACTIVE')) throw conflict(`Can’t issue: ${BLOCK_TEXT.NOT_ACTIVE}.`)
  const list = [...new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
  if (!list.length) throw badRequest('Scan or type the book numbers.')
  const reasons = card.blocked.filter((x) => x !== 'LIMIT')
  if (card.loans.length + list.length > card.limit) reasons.push('LIMIT')
  if (reasons.length && !override) throw conflict(`Can’t issue: ${reasons.map((x) => BLOCK_TEXT[x]).join(', ')}.`, { code: 'BLOCKED', reasons })
  const t = await today()
  const due = dueOn || card.dueOn
  if (due < t) throw badRequest('The due date has passed.', { fields: { dueOn: 'Pick a later date' } })
  const copies = await LibraryCopy.find({ accessionNo: { $in: list }, ...siteFilter(auth) }).lean()
  const missing = list.filter((c) => !copies.some((x) => x.accessionNo === c))
  if (missing.length) throw notFound(`Book ${missing.join(', ')}`)
  const titles = new Map((await LibraryTitle.find({ _id: { $in: copies.map((c) => c.titleId) } }).select('title type').lean()).map((x) => [String(x._id), x]))
  for (const c of copies) {
    if (c.status !== 'AVAILABLE') throw conflict(`${c.accessionNo} is ${c.status === 'ISSUED' ? 'already out — take it back first' : `marked ${c.status.toLowerCase()}`}.`)
    if (titles.get(String(c.titleId))?.type === 'REFERENCE' && !override) throw conflict(`${c.accessionNo} is a reference book, read in the library.`, { code: 'REFERENCE' })
  }
  const made = []
  for (const c of copies) {
    const claimed = await LibraryCopy.findOneAndUpdate({ _id: c._id, status: 'AVAILABLE' }, { $set: { status: 'ISSUED' } }, { returnDocument: 'after' })
    if (!claimed) throw conflict(`${c.accessionNo} was just issued at another desk.`)
    try {
      const loan = await LibraryLoan.create({
        copyId: c._id, titleId: c.titleId, accessionNo: c.accessionNo, title: titles.get(String(c.titleId))?.title,
        borrower: { kind: b.kind, id: b.id, name: b.name, code: b.code, place: b.place }, studentId: b.kind === 'STUDENT' ? b.id : undefined,
        branchId: c.branchId, issuedOn: t, dueOn: due, issuedBy: auth.user?.name,
      })
      await LibraryCopy.updateOne({ _id: c._id }, { $set: { loanId: loan._id } })
      made.push(loan)
    } catch (e) {
      await LibraryCopy.updateOne({ _id: c._id }, { $set: { status: 'AVAILABLE' } })
      throw e
    }
  }
  await audit({ action: 'CREATE', module: 'library', entityType: 'library_loan', entityId: String(made[0]._id), entityName: b.name, ...(b.kind === 'STUDENT' && { studentId: b.id }), summary: `Issued ${made.map((l) => l.accessionNo).join(', ')} to ${b.name} (${b.code}), due ${due}${reasons.length ? ` — allowed although ${reasons.map((x) => BLOCK_TEXT[x]).join(', ')}` : ''}` }, req)
  return borrowerCard({ kind, id }, auth)
}

async function addFine(loan, { reason, amount, days, note }, auth, { waived } = {}) {
  const f = await LibraryFine.create({
    loanId: loan._id, borrower: loan.borrower, studentId: loan.studentId, branchId: loan.branchId, reason, amount, days, title: loan.title, accessionNo: loan.accessionNo, note,
    date: await today(), createdBy: auth.user?.name, ...(waived && { status: 'WAIVED', waived: { reason: waived, by: auth.user?.name, at: new Date() } }),
  })
  await LibraryLoan.updateOne({ _id: loan._id }, { $push: { fineIds: f._id } })
  return f
}

/**
 * Take a book back by its barcode. Late: the fine is worked out (and can be waived there and then). Damaged: the copy
 * is set aside, with a charge if one is given.
 */
export async function returnBook({ code, damaged = false, damageCharge, waiveLate = false, waiveReason, note }, auth, req) {
  const c = await LibraryCopy.findOne({ accessionNo: String(code).trim().toUpperCase(), ...siteFilter(auth) })
  if (!c) throw notFound('Book with this number')
  const loan = await LibraryLoan.findOne({ copyId: c._id, status: 'ISSUED' })
  if (!loan) throw conflict(`${c.accessionNo} isn’t out on loan.`, { code: 'NOT_OUT' })
  const [settings, t] = await Promise.all([getSettings('library'), today()])
  const days = lateDays(loan.dueOn, t, settings.graceDays ?? 0)
  const amount = fineSoFar(loan, t, settings)
  loan.status = 'RETURNED'
  loan.returnedOn = t
  loan.returnedBy = auth.user?.name
  if (damaged) loan.condition = note || 'Damaged'
  await loan.save()
  c.status = damaged ? 'DAMAGED' : 'AVAILABLE'
  c.loanId = undefined
  if (damaged && note) c.note = note
  await c.save()
  const fines = []
  if (amount > 0) fines.push(await addFine(loan, { reason: 'LATE', amount, days }, auth, { waived: waiveLate ? waiveReason || 'Waived at return' : null }))
  if (damaged && damageCharge > 0) fines.push(await addFine(loan, { reason: 'DAMAGED', amount: damageCharge, note }, auth))
  await audit({ action: 'UPDATE', module: 'library', entityType: 'library_loan', entityId: String(loan._id), entityName: loan.borrower?.name, ...(loan.studentId && { studentId: loan.studentId }), summary: `Took back ${c.accessionNo} from ${loan.borrower?.name}${days ? `, ${days} day(s) late` : ''}${fines.length ? ` — fine ${fines.map((f) => `${formatINR(f.amount)}${f.status === 'WAIVED' ? ' (waived)' : ''}`).join(' + ')}` : ''}${damaged ? ', damaged' : ''}` }, req)
  return {
    loan: loanOut(loan.toObject(), t, settings), copy: { id: String(c._id), accessionNo: c.accessionNo, status: c.status },
    daysLate: days, fines: fines.map((f) => ({ ...clean(f.toObject()), loanId: String(f.loanId) })),
    owed: (await LibraryFine.aggregate([{ $match: { 'borrower.kind': loan.borrower.kind, 'borrower.id': loan.borrower.id, status: 'OPEN' } }, { $group: { _id: null, n: { $sum: '$amount' } } }]))[0]?.n ?? 0,
  }
}

/** Another loan period from today (up to the renewals allowed; not once it is overdue — return it and settle the fine). */
export async function renewLoan(id, auth, req) {
  const loan = isOid(id) ? await LibraryLoan.findOne({ _id: id, status: 'ISSUED', ...siteFilter(auth) }) : null
  if (!loan) throw notFound('Loan')
  const [settings, t] = await Promise.all([getSettings('library'), today()])
  if (loan.renewals >= (settings.renewals ?? 1)) throw conflict('This book has been renewed as many times as allowed.')
  if (loan.dueOn < t) throw conflict('This book is overdue. Take it back (the fine is worked out), then issue it again.')
  loan.dueOn = addDaysYmd(t, rules(settings, loan.borrower.kind).days)
  loan.renewals += 1
  loan.reminded = {}
  await loan.save()
  await audit({ action: 'UPDATE', module: 'library', entityType: 'library_loan', entityId: String(loan._id), entityName: loan.borrower?.name, ...(loan.studentId && { studentId: loan.studentId }), summary: `Renewed ${loan.accessionNo} for ${loan.borrower?.name}, now due ${loan.dueOn}` }, req)
  return loanOut(loan.toObject(), t, settings)
}

/** The borrower lost the book: the copy is written off and charged (its price unless another amount is given). */
export async function markLost(id, { charge, note }, auth, req) {
  const loan = isOid(id) ? await LibraryLoan.findOne({ _id: id, status: 'ISSUED', ...siteFilter(auth) }) : null
  if (!loan) throw notFound('Loan')
  const [settings, t] = await Promise.all([getSettings('library'), today()])
  const c = await LibraryCopy.findById(loan.copyId)
  const late = fineSoFar(loan, t, settings)
  loan.status = 'LOST'
  loan.returnedOn = t
  loan.returnedBy = auth.user?.name
  await loan.save()
  if (c) { c.status = 'LOST'; c.loanId = undefined; c.note = note || c.note; await c.save() }
  const amount = charge ?? c?.price ?? 0
  const fines = []
  if (amount > 0) fines.push(await addFine(loan, { reason: 'LOST', amount, note }, auth))
  if (late > 0) fines.push(await addFine(loan, { reason: 'LATE', amount: late, days: lateDays(loan.dueOn, t, settings.graceDays ?? 0) }, auth))
  await audit({ action: 'UPDATE', module: 'library', entityType: 'library_loan', entityId: String(loan._id), entityName: loan.borrower?.name, ...(loan.studentId && { studentId: loan.studentId }), summary: `${loan.accessionNo} lost by ${loan.borrower?.name}${fines.length ? ` — charged ${formatINR(fines.reduce((n, f) => n + f.amount, 0))}` : ''}` }, req)
  return { loan: loanOut(loan.toObject(), t, settings), fines: fines.map((f) => clean(f.toObject())) }
}

/** Loans for the desk's lists: out, overdue, returned or lost; a borrower's or a book's; searched by name or number. */
export async function listLoans({ state = 'OUT', search, kind, from, to, page = 1, pageSize = 50 }, auth) {
  const [settings, t] = await Promise.all([getSettings('library'), today()])
  const f = { ...siteFilter(auth) }
  if (state === 'OUT') f.status = 'ISSUED'
  if (state === 'OVERDUE') Object.assign(f, { status: 'ISSUED', dueOn: { $lt: t } })
  if (state === 'DUE_TODAY') Object.assign(f, { status: 'ISSUED', dueOn: t })
  if (state === 'RETURNED') f.status = 'RETURNED'
  if (state === 'LOST') f.status = 'LOST'
  if (kind) f['borrower.kind'] = kind
  if (from || to) f.issuedOn = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const q = String(search ?? '').trim()
  if (q) f.$or = [{ 'borrower.name': rx(q) }, { 'borrower.code': rx(q) }, { accessionNo: q.toUpperCase() }, { title: rx(q) }]
  const sort = state === 'OVERDUE' || state === 'OUT' ? { dueOn: 1 } : { issuedOn: -1 }
  const [rows, total] = await Promise.all([LibraryLoan.find(f).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(), LibraryLoan.countDocuments(f)])
  return { data: rows.map((l) => loanOut(l, t, settings)), total, page, pageSize }
}

/** The day at the desk: issued and returned today, due today, overdue. */
export async function deskSummary(auth) {
  const t = await today()
  const s = siteFilter(auth)
  const [issued, returned, dueToday, overdue] = await Promise.all([
    LibraryLoan.countDocuments({ issuedOn: t, ...s }), LibraryLoan.countDocuments({ returnedOn: t, status: 'RETURNED', ...s }),
    LibraryLoan.countDocuments({ status: 'ISSUED', dueOn: t, ...s }), LibraryLoan.countDocuments({ status: 'ISSUED', dueOn: { $lt: t }, ...s }),
  ])
  return { date: t, issued, returned, dueToday, overdue }
}

// ───────────────────────────────────────────────────────── reminders (job 'library-reminders')

/** This institution's reminders for today — from 8 am its time, each loan at most once a day. */
export async function sendReminders({ anyTime = false } = {}) {
  const now = await institutionNow()
  if (!anyTime && now.minutes < 8 * 60) return 0
  const t = now.date
  const settings = await getSettings('library')
  let sent = 0
  const before = settings.remindDaysBefore ?? 1
  if (before > 0) {
    const due = await LibraryLoan.find({ status: 'ISSUED', studentId: { $type: 'objectId' }, dueOn: addDaysYmd(t, before), 'reminded.due': { $exists: false } }).limit(2000).lean()
    for (const l of due) {
      await emit('library.due', { studentId: String(l.studentId), entity: { type: 'library_loan', id: l._id }, data: { library: { title: l.title, dueDate: humanDate(l.dueOn) } } })
      await LibraryLoan.updateOne({ _id: l._id }, { $set: { 'reminded.due': t } })
      sent++
    }
  }
  const every = settings.overdueEveryDays ?? 3
  if (every > 0) {
    const late = await LibraryLoan.find({ status: 'ISSUED', studentId: { $type: 'objectId' }, dueOn: { $lt: t } }).limit(5000).lean()
    for (const l of late) {
      if (l.reminded?.overdue && dayDiff(l.reminded.overdue, t) < every) continue
      await emit('library.overdue', { studentId: String(l.studentId), entity: { type: 'library_loan', id: l._id }, data: { library: { title: l.title, dueDate: humanDate(l.dueOn), days: dayDiff(l.dueOn, t), fine: formatINR(fineSoFar(l, t, settings)) } } })
      await LibraryLoan.updateOne({ _id: l._id }, { $set: { 'reminded.overdue': t } })
      sent++
    }
  }
  return sent
}

/** Every institution with books out. */
export async function sendAllReminders() {
  const tenants = await runAsSystem(() => LibraryLoan.distinct('tenantId', { status: 'ISSUED', studentId: { $type: 'objectId' } }).setOptions({ allTenants: true }))
  let n = 0
  for (const id of tenants) n += await runAsTenant(id, () => sendReminders())
  return n
}
