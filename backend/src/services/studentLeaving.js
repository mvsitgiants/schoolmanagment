// A student leaving: what the school's records say is still open on the leaving date. Two kinds:
//   DUE     — the family owes the school: fee bills due by the leaving date, library books not returned, unpaid fines.
//             A TC is not issued over these unless the approver ticks "issue anyway" and says why.
//   TIDY    — the school has something to wind up: a hostel bed, a seat on a bus route, money left in the canteen
//             wallet (to pay back), fee bills due after the leaving date. Shown so nothing is forgotten; never blocks.
// Each check only runs when that module is switched on. Used by the TC screens and the student no-dues slip.
import { HostelAllotment, HostelBlock, HostelRoom } from '../models/hostel.js'
import { CanteenWallet } from '../models/canteen.js'
import { FeeInvoice } from '../models/fees.js'
import { LibraryFine, LibraryLoan } from '../models/library.js'
import { TransportAssignment, TransportRoute } from '../models/transport.js'
import { Outpass } from '../models/hostel.js'
import { studentName } from '../models/students.js'
import { can, moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { conflict, forbidden, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { refundWallet } from './canteen.js'
import { cancelUnpaidBills, reopenBills } from './fees.js'

const OPEN_BILL = { $in: ['UNPAID', 'PARTIAL'] }
const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0)

async function feesCheck(studentId, leavingDate) {
  const bills = await FeeInvoice.find({ studentId, status: OPEN_BILL }).select('invoiceNo installment dueDate balance').sort({ dueDate: 1 }).lean()
  const bill = (b) => ({ id: String(b._id), invoiceNo: b.invoiceNo, installment: b.installment, dueDate: b.dueDate, balance: b.balance })
  const due = bills.filter((b) => b.dueDate <= leavingDate)
  const later = bills.filter((b) => b.dueDate > leavingDate)
  return [
    { key: 'fees', kind: 'DUE', module: 'fees', ok: sum(due, 'balance') <= 0, total: sum(due, 'balance'), bills: due.map(bill) },
    // bills for after they leave: nothing is owed for them, but they stay open until someone cancels them
    ...(later.length ? [{ key: 'laterBills', kind: 'TIDY', module: 'fees', ok: false, total: sum(later, 'balance'), bills: later.map(bill) }] : []),
  ]
}

async function libraryCheck(studentId) {
  const [loans, fines] = await Promise.all([
    LibraryLoan.find({ 'borrower.kind': 'STUDENT', 'borrower.id': studentId, status: 'ISSUED' }).select('title accessionNo dueOn').lean(),
    LibraryFine.find({ 'borrower.kind': 'STUDENT', 'borrower.id': studentId, status: 'OPEN' }).select('amount').lean(),
  ])
  return {
    key: 'library', kind: 'DUE', module: 'library', ok: !loans.length && !fines.length,
    booksOut: loans.map((l) => ({ title: l.title, accessionNo: l.accessionNo, dueOn: l.dueOn })), fines: fines.length, fineTotal: sum(fines, 'amount'),
  }
}

async function hostelCheck(studentId) {
  const a = await HostelAllotment.findOne({ studentId, active: true }).lean()
  if (!a) return { key: 'hostel', kind: 'TIDY', module: 'hostel', ok: true }
  const [block, room] = await Promise.all([HostelBlock.findById(a.blockId).select('name').lean(), HostelRoom.findById(a.roomId).select('number beds').lean()])
  const bed = room?.beds?.find((b) => String(b._id) === String(a.bedId))
  return { key: 'hostel', kind: 'TIDY', module: 'hostel', ok: false, block: block?.name ?? null, room: room?.number ?? null, bed: bed?.label ?? null, from: a.from }
}

async function transportCheck(studentId) {
  const a = await TransportAssignment.findOne({ studentId, active: true }).lean()
  if (!a) return { key: 'transport', kind: 'TIDY', module: 'transport', ok: true }
  const route = await TransportRoute.findById(a.routeId).select('name stops').lean()
  const stop = route?.stops?.find((s) => String(s._id) === String(a.stopId))
  return { key: 'transport', kind: 'TIDY', module: 'transport', ok: false, route: route?.name ?? null, stop: stop?.name ?? null, from: a.from }
}

async function canteenCheck(studentId) {
  const w = await CanteenWallet.findOne({ studentId }).select('balance').lean()
  return { key: 'canteen', kind: 'TIDY', module: 'canteen', ok: !(w?.balance > 0), balance: w?.balance ?? 0 }
}

/**
 * Everything open for a student leaving on `leavingDate` (YYYY-MM-DD). The caller has already checked the student is
 * in its scope. `dues` counts the DUE checks not clear; `tidy` the TIDY ones.
 */
export async function leavingChecks(student, leavingDate, auth) {
  const id = student._id
  const on = (m) => moduleEnabled(auth, m)
  const parts = await Promise.all([
    on('fees') ? feesCheck(id, leavingDate) : [],
    on('library') ? libraryCheck(id) : null,
    on('hostel') ? hostelCheck(id) : null,
    on('transport') ? transportCheck(id) : null,
    on('canteen') ? canteenCheck(id) : null,
  ])
  const checks = parts.flat().filter(Boolean)
  return {
    leavingDate, checks,
    dues: checks.filter((c) => c.kind === 'DUE' && !c.ok).length,
    tidy: checks.filter((c) => c.kind === 'TIDY' && !c.ok).length,
  }
}

/** One line per open check, for the TC's record of what it was issued over ("Fees ₹12,000 due", …). */
export function openSummary({ checks }, money) {
  return checks.filter((c) => c.kind === 'DUE' && !c.ok).map((c) => {
    if (c.key === 'fees') return `Fees ${money(c.total)} due`
    if (c.key === 'library') return [c.booksOut.length && `${c.booksOut.length} library book(s) not returned`, c.fineTotal && `library fines ${money(c.fineTotal)}`].filter(Boolean).join(', ')
    return c.key
  })
}

// ───────────────────────────────────────────────────────── winding up after the TC

/**
 * The things a TC winds up (TIDY checks): bills for after the leaving date are cancelled, the bus seat and hostel bed
 * end on the leaving date — each when the approver ticks it, and each can be undone from the TC. Money left in the
 * canteen wallet is never paid back automatically: someone records how it was paid (cash / bank).
 */
export const WIND_UP_KEYS = ['laterBills', 'transport', 'hostel', 'canteen']
const stampOf = (auth) => ({ by: auth.user?.name ?? 'System', at: new Date() })
const later = (a, b) => (a > b ? a : b)

async function doItem(key, tc, s, auth, req, input = {}) {
  const leavingDate = tc.leavingDate
  if (key === 'laterBills') {
    const bills = await FeeInvoice.find({ studentId: s._id, status: OPEN_BILL, dueDate: { $gt: leavingDate } }).select('_id').lean()
    if (!bills.length) return { key, status: 'DONE', refs: [], note: 'No bills after the leaving date', ...stampOf(auth) }
    const r = await cancelUnpaidBills(bills.map((b) => b._id), `Left the school — TC ${tc.tcNo ?? ''}`.trim(), auth, req)
    const skipped = r.skipped.length ? ` · ${r.skipped.length} part-paid bill(s) left open: ${r.skipped.map((b) => b.installment).join(', ')} — refund or adjust at the fee office` : ''
    return { key, status: r.skipped.length && !r.cancelled.length ? 'PENDING' : 'DONE', refs: r.cancelled, amount: r.total, note: `${r.cancelled.length} bill(s) cancelled${skipped}`, ...stampOf(auth) }
  }
  if (key === 'transport') {
    const a = await TransportAssignment.findOne({ studentId: s._id, active: true })
    if (!a) return { key, status: 'DONE', refs: [], note: 'Not on a bus route', ...stampOf(auth) }
    const route = await TransportRoute.findById(a.routeId).select('name').lean()
    Object.assign(a, { active: false, to: later(leavingDate, a.from) })
    await a.save()
    await audit({ action: 'UPDATE', module: 'transport', entityType: 'transport_assignment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} taken off route ${route?.name ?? ''} from ${a.to} (left the school)` }, req)
    return { key, status: 'DONE', refs: [a._id], note: `Off route ${route?.name ?? ''} from ${a.to}`, ...stampOf(auth) }
  }
  if (key === 'hostel') {
    const a = await HostelAllotment.findOne({ studentId: s._id, active: true })
    if (!a) return { key, status: 'DONE', refs: [], note: 'No hostel bed', ...stampOf(auth) }
    if (await Outpass.exists({ studentId: s._id, status: 'OUT' })) return { key, status: 'PENDING', refs: [], note: 'Out on a hostel pass — mark them back in, then check out', ...stampOf(auth) }
    Object.assign(a, { active: false, to: later(leavingDate, a.from), endReason: 'LEFT_INSTITUTION', endNote: tc.tcNo ? `TC ${tc.tcNo}` : undefined, endedBy: auth.user?.name })
    await a.save()
    await Outpass.updateMany({ studentId: s._id, status: { $in: ['REQUESTED', 'APPROVED'] } }, { $set: { status: 'CANCELLED', decisionNote: 'Checked out of the hostel' } })
    await audit({ action: 'UPDATE', module: 'hostel', entityType: 'hostel_allotment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} checked out of the hostel on ${a.to} (left the school)` }, req)
    return { key, status: 'DONE', refs: [a._id], note: `Checked out on ${a.to}`, ...stampOf(auth) }
  }
  if (key === 'canteen') {
    const w = await CanteenWallet.findOne({ studentId: s._id }).select('balance').lean()
    if (!(w?.balance > 0)) return { key, status: 'DONE', refs: [], amount: 0, note: 'Nothing left in the wallet', ...stampOf(auth) }
    if (!input.mode) return { key, status: 'PENDING', refs: [], amount: w.balance, note: 'To pay back to the family', ...stampOf(auth) }
    if (!auth.fullAccess && !can(auth, 'canteen.wallet.refund')) throw forbidden('Your role can’t pay back canteen wallets.')
    const r = await refundWallet(s._id, { amount: w.balance, mode: input.mode, reference: input.reference, reason: `Left the school — TC ${tc.tcNo ?? ''}`.trim() }, req)
    return { key, status: 'DONE', refs: [r.txn?.id].filter((x) => isOid(x)), amount: w.balance, note: `Paid back (${input.mode === 'BANK' ? 'bank transfer' : 'cash'}${input.reference ? `, ${input.reference}` : ''})`, ...stampOf(auth) }
  }
  throw notFound('Wind-up item')
}

async function undoItem(item, s, auth, req) {
  if (item.key === 'laterBills') {
    if (item.refs?.length) await reopenBills(item.refs, 'the TC was undone', auth, req)
  } else if (item.key === 'transport') {
    const a = item.refs?.[0] ? await TransportAssignment.findById(item.refs[0]) : null
    if (a && !a.active) {
      if (await TransportAssignment.exists({ studentId: s._id, active: true })) throw conflict(`${studentName(s)} is already on another route.`)
      a.active = true; a.to = undefined
      await a.save()
      await audit({ action: 'UPDATE', module: 'transport', entityType: 'transport_assignment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} back on transport (taking-off undone)` }, req)
    }
  } else if (item.key === 'hostel') {
    const a = item.refs?.[0] ? await HostelAllotment.findById(item.refs[0]) : null
    if (a && !a.active) {
      if (await HostelAllotment.exists({ studentId: s._id, active: true })) throw conflict(`${studentName(s)} already has another bed.`)
      if (await HostelAllotment.exists({ bedId: a.bedId, active: true })) throw conflict('That bed has been given to someone else. Allot a bed in Hostel instead.')
      Object.assign(a, { active: true, to: undefined, endReason: undefined, endNote: undefined, endedBy: undefined })
      await a.save()
      await audit({ action: 'UPDATE', module: 'hostel', entityType: 'hostel_allotment', entityId: String(a._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)} back in the hostel bed (check-out undone)` }, req)
    }
  } else if (item.key === 'canteen') {
    throw conflict('Money paid back can’t be undone here. Use an adjustment in Canteen › wallets if it was a mistake.')
  }
  return { ...item, status: 'UNDONE', undoneBy: auth.user?.name, undoneAt: new Date() }
}

/**
 * Right after a TC is issued: wind up what the approver ticked (`chosen`), and list the rest as still to do. Never
 * fails the TC — a step that goes wrong is left to do, with what went wrong.
 */
export async function windUpOnIssue(tc, s, chosen, auth, req) {
  const { checks } = await leavingChecks(s, tc.leavingDate, auth)
  const open = checks.filter((c) => c.kind === 'TIDY' && !c.ok).map((c) => c.key)
  const out = []
  for (const key of open) {
    try {
      // the canteen step only records the amount to pay back; the others run when ticked
      if (key === 'canteen' || chosen.includes(key)) out.push(await doItem(key, tc, s, auth, req))
      else out.push({ key, status: 'PENDING', refs: [], note: 'Not done when the TC was issued', ...stampOf(auth) })
    } catch (err) {
      logger.warn({ err, key, tcId: String(tc._id) }, 'TC wind-up step failed')
      out.push({ key, status: 'PENDING', refs: [], note: err.message, ...stampOf(auth) })
    }
  }
  return out
}

/** One wind-up step from the TC afterwards: `do` it now (canteen: with how it was paid back) or `undo` it. */
export async function windUpStep(tc, s, key, action, input, auth, req) {
  if (!WIND_UP_KEYS.includes(key)) throw notFound('Wind-up item')
  const items = (tc.windUp ?? []).map((i) => (i.toObject ? i.toObject() : i))
  const k = items.findIndex((i) => i.key === key)
  const current = k >= 0 ? items[k] : null
  let next
  if (action === 'undo') {
    if (current?.status !== 'DONE') throw conflict('This step hasn’t been done.')
    next = await undoItem(current, s, auth, req)
  } else {
    if (current?.status === 'DONE') throw conflict('This step is already done.')
    next = await doItem(key, tc, s, auth, req, input)
  }
  if (k >= 0) items[k] = next; else items.push(next)
  return items
}

/** A TC cancelled after it was issued (the student stays): put back what its wind-up ended, where that still fits. */
export async function undoWindUp(tc, s, auth, req) {
  const items = (tc.windUp ?? []).map((i) => (i.toObject ? i.toObject() : i))
  const out = []
  for (const it of items) {
    if (it.status !== 'DONE' || it.key === 'canteen' || !it.refs?.length) { out.push(it); continue }
    try { out.push(await undoItem(it, s, auth, req)) } catch (err) { out.push({ ...it, note: `${it.note ?? ''} · not put back: ${err.message}` }) }
  }
  return out
}
