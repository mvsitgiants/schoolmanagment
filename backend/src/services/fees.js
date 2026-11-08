import {
  CONCESSION_STATUS, INVOICE_STATUS, PAYMENT_MODE_LABEL, allocateOldestFirst, concessionOn, formatINR, lateFeeFor, sectionLabel,
} from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, Section } from '../models/academics.js'
import { Concession, FeeDayEnd, FeeHead, FeeInvoice, FeePayment, FeeRefund, FeeStructure } from '../models/fees.js'
import { Student, studentName } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { can, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear, yearOrCurrent } from './academics.js'
import { humanDate } from './notify.js'
import { familyLink } from './familyLink.js'

// Fees (module `fees`). A structure says what a year costs for some classes and when it is due;
// "Generate invoices" raises one invoice per student per installment (approved concessions
// applied). Collecting money creates a receipt that pays the oldest dues first. Who sees whose
// fees follows the role's data scope for `fees`: ALL, BRANCH (the user's campus) or OWN (on lists
// of receipts: only the ones they collected). All amounts are paise.

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const idStr = (v) => (v ? String(v) : null)
const today = async () => (await institutionNow()).date

async function feeSettings() {
  const s = await getSettings('fees')
  return { ...s, perDay: Math.round((Number(s.lateFeePerDay) || 0) * 100), graceDays: Number(s.graceDays) || 0 }
}

// ───────────────────────────────────────────────────────── scope

/** Filter on a document's `branchId` for the caller's campus (null = every campus). */
async function branchFilter(auth) {
  const scope = scopeOf(auth, 'fees')
  if (scope === 'ALL' || !auth.user?.branchId) return null
  const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
  return String(auth.user.branchId) === String(main) ? { branchId: { $in: [auth.user.branchId, null] } } : { branchId: auth.user.branchId }
}

async function studentInScope(studentId, auth) {
  if (!isOid(studentId)) throw notFound('Student')
  const s = await Student.findById(studentId).lean()
  if (!s) throw notFound('Student')
  const f = await branchFilter(auth)
  if (f && !(f.branchId.$in ? f.branchId.$in.some((b) => String(b ?? '') === String(s.branchId ?? '')) : String(f.branchId) === String(s.branchId))) throw notFound('Student')
  return s
}

async function placeOf(sectionId) {
  if (!sectionId) return null
  const s = await Section.findById(sectionId).lean()
  if (!s) return null
  const c = await ClassLevel.findById(s.classId).select('name code').lean()
  return { label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }) }
}

// ───────────────────────────────────────────────────────── invoices: totals and concessions

/** Totals and status from lines, late fee and paid. */
function recompute(inv) {
  inv.gross = inv.lines.reduce((n, l) => n + (l.amount ?? 0), 0)
  inv.concession = inv.lines.reduce((n, l) => n + (l.concession ?? 0), 0)
  inv.net = inv.gross - inv.concession + (inv.lateFee ?? 0)
  inv.balance = inv.net - (inv.paid ?? 0)
  if (inv.status !== 'CANCELLED') inv.status = inv.balance <= 0 ? 'PAID' : inv.paid > 0 ? 'PARTIAL' : 'UNPAID'
  return inv
}

/** Put a student's approved concessions on invoice lines (percent of each line, or an amount per installment). */
function applyConcessions(lines, concessions) {
  for (const l of lines) l.concession = 0
  for (const c of concessions) {
    const eligible = lines.filter((l) => !c.feeHeadIds?.length || c.feeHeadIds.some((h) => String(h) === String(l.feeHeadId)))
    if (c.kind === 'PCT') {
      for (const l of eligible) l.concession = Math.min(l.amount, l.concession + concessionOn(l.amount, c))
    } else {
      let left = Math.round(c.value)
      for (const l of eligible) {
        const take = Math.min(left, l.amount - l.concession)
        l.concession += take
        left -= take
      }
    }
  }
  return lines
}

const invoiceDto = (inv, t, cfg) => ({
  ...clean(inv), studentId: String(inv.studentId), structureId: idStr(inv.structureId),
  statusLabel: INVOICE_STATUS[inv.status]?.label,
  lateFeeDue: inv.status === 'CANCELLED' ? 0 : lateFeeFor({ dueDate: inv.dueDate, balance: inv.balance }, t, cfg),
  overdue: inv.balance > 0 && inv.dueDate < t && inv.status !== 'CANCELLED',
})

// ───────────────────────────────────────────────────────── starter data

const STARTER_HEADS = [
  ['Tuition fee', 'TUITION', false], ['Admission fee', 'ADMISSION', false], ['Annual charges', 'ANNUAL', false], ['Examination fee', 'EXAM', false],
  ['Computer / lab fee', 'LAB', false], ['Library fee', 'LIBRARY', false], ['Sports & activities', 'SPORTS', false], ['Transport fee', 'TRANSPORT', false],
  ['Caution deposit', 'CAUTION', true],
]

/** Every new institution starts with the usual fee heads (edited later in Fees › Fee structures). */
export async function ensureFeeSetup() {
  if (await FeeHead.exists({})) return
  await FeeHead.insertMany(STARTER_HEADS.map(([name, code, refundable]) => ({ name, code, refundable })))
}

// ───────────────────────────────────────────────────────── heads

export async function listHeads() {
  await ensureFeeSetup() // institutions made before the starter heads existed get them now
  return clean(await FeeHead.find().sort({ active: -1, name: 1 }).lean())
}

export async function saveHead(id, input, req) {
  if (await FeeHead.exists({ code: input.code, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: `Another head uses ${input.code}` })
  const head = id ? await FeeHead.findById(id) : new FeeHead()
  if (!head) throw notFound('Fee head')
  Object.assign(head, input)
  await head.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'fees', entityType: 'fee_head', entityId: String(head._id), entityName: head.name, summary: `${id ? 'Updated' : 'Added'} fee head ${head.name}` }, req)
  return clean(head.toObject())
}

// ───────────────────────────────────────────────────────── structures

export async function listStructures(yearId) {
  const year = await yearOrCurrent(yearId)
  const [rows, heads, classes, counts] = await Promise.all([
    FeeStructure.find({ academicYearId: year._id }).sort({ name: 1 }).lean(),
    FeeHead.find().select('name code').lean(),
    ClassLevel.find().select('name code order').lean(),
    FeeInvoice.aggregate([{ $match: { academicYearId: year._id, status: { $ne: 'CANCELLED' } } }, { $group: { _id: '$structureId', n: { $sum: 1 }, students: { $addToSet: '$studentId' }, net: { $sum: '$net' }, paid: { $sum: '$paid' } } }]),
  ])
  const head = new Map(heads.map((h) => [String(h._id), h]))
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const stat = new Map(counts.map((c) => [String(c._id), c]))
  return {
    year: { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate, closed: !!year.closed },
    structures: rows.map((s) => {
      const st = stat.get(String(s._id))
      return {
        ...clean(s), classIds: s.classIds.map(String),
        classes: s.classIds.map((id) => cls.get(String(id))).filter(Boolean).sort((a, b) => a.order - b.order).map((c) => ({ id: String(c._id), name: c.name, code: c.code })),
        lines: s.lines.map((l) => ({ feeHeadId: String(l.feeHeadId), amount: l.amount, name: head.get(String(l.feeHeadId))?.name ?? '?', code: head.get(String(l.feeHeadId))?.code })),
        total: s.lines.reduce((n, l) => n + l.amount, 0),
        invoices: st?.n ?? 0, students: st?.students.length ?? 0, billed: st?.net ?? 0, collected: st?.paid ?? 0,
      }
    }),
  }
}

function checkStructure(input, year) {
  const errors = {}
  if (!input.lines.length) errors.lines = 'Add at least one fee'
  if (!input.installments.length) errors.installments = 'Add at least one installment'
  const total = input.lines.reduce((n, l) => n + l.amount, 0)
  const split = input.installments.reduce((n, i) => n + i.amount, 0)
  if (input.lines.length && input.installments.length && total !== split) errors.installments = `Installments add up to ${formatINR(split)}, the fees to ${formatINR(total)}`
  input.installments.forEach((i, k) => { if (i.dueDate < year.startDate || i.dueDate > year.endDate) errors[`installments.${k}.dueDate`] = `Outside ${year.name}` })
  if (new Set(input.lines.map((l) => String(l.feeHeadId))).size !== input.lines.length) errors.lines = 'A fee head is listed twice'
  if (new Set(input.installments.map((i) => i.name.trim().toLowerCase())).size !== input.installments.length) errors.installments = 'Two installments have the same name'
  if (Object.keys(errors).length) throw fieldsError(errors)
}

export async function saveStructure(id, input, req) {
  const year = await yearOrCurrent(input.academicYearId)
  checkStructure(input, year)
  if (await FeeHead.countDocuments({ _id: { $in: input.lines.map((l) => l.feeHeadId) } }) !== input.lines.length) throw fieldsError({ lines: 'Unknown fee head' })
  if (input.classIds.length && await ClassLevel.countDocuments({ _id: { $in: input.classIds } }) !== new Set(input.classIds).size) throw fieldsError({ classIds: 'Unknown class' })
  if (await FeeStructure.exists({ academicYearId: year._id, name: input.name, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: `Another structure of ${year.name} has this name` })
  let s
  if (id) {
    s = await FeeStructure.findById(id)
    if (!s) throw notFound('Fee structure')
    // once invoiced, the money can't change underneath the invoices: only name, classes and active
    if (await FeeInvoice.exists({ structureId: s._id, status: { $ne: 'CANCELLED' } })) {
      const same = JSON.stringify(s.lines.map((l) => [String(l.feeHeadId), l.amount])) === JSON.stringify(input.lines.map((l) => [String(l.feeHeadId), l.amount]))
        && JSON.stringify(s.installments.map((i) => [i.name, i.dueDate, i.amount])) === JSON.stringify(input.installments.map((i) => [i.name, i.dueDate, i.amount]))
      if (!same) throw conflict('Invoices are already raised from this structure, so its amounts and installments are fixed. Make a new structure for the change.')
    }
    Object.assign(s, { ...input, academicYearId: year._id })
    await s.save()
  } else {
    s = await FeeStructure.create({ ...input, academicYearId: year._id })
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'fees', entityType: 'fee_structure', entityId: String(s._id), entityName: s.name, summary: `${id ? 'Updated' : 'Added'} fee structure ${s.name} (${year.name})` }, req)
  return clean(s.toObject())
}

export async function deleteStructure(id, req) {
  const s = await FeeStructure.findById(id)
  if (!s) throw notFound('Fee structure')
  if (await FeeInvoice.exists({ structureId: s._id })) throw conflict('Invoices are raised from this structure. Make it inactive instead.')
  await s.deleteOne()
  await audit({ action: 'DELETE', module: 'fees', entityType: 'fee_structure', entityId: String(s._id), entityName: s.name, summary: `Deleted fee structure ${s.name}` }, req)
  return { deleted: true }
}

/**
 * Raise the structure's invoices: one per student of its classes (current section in the
 * structure's year) per installment. Students who already have an installment are skipped, so
 * running it again after new admissions only adds theirs.
 */
export async function generateInvoices(id, auth, req) {
  const s = await FeeStructure.findById(id).lean()
  if (!s) throw notFound('Fee structure')
  if (!s.active) throw conflict('This structure is inactive.')
  const year = await AcademicYear.findById(s.academicYearId).lean()
  if (year?.closed) throw conflict(`${year.name} is closed.`)
  const sections = await Section.find({ academicYearId: s.academicYearId, classId: { $in: s.classIds } }).select('_id branchId').lean()
  const filter = { status: 'ACTIVE', sectionId: { $in: sections.map((x) => x._id) } }
  if (s.appliesTo === 'NEW') filter.admissionDate = { $gte: year.startDate }
  const students = await Student.find(filter).select('_id sectionId branchId').lean()
  const heads = new Map((await FeeHead.find({ _id: { $in: s.lines.map((l) => l.feeHeadId) } }).lean()).map((h) => [String(h._id), h]))
  const total = s.lines.reduce((n, l) => n + l.amount, 0)
  const existing = new Set((await FeeInvoice.find({ structureId: s._id }).select('studentId installment').lean()).map((i) => `${i.studentId}:${i.installment}`))
  const concessions = await Concession.find({ studentId: { $in: students.map((x) => x._id) }, academicYearId: s.academicYearId, status: 'APPROVED' }).lean()
  let created = 0
  let skipped = 0
  for (const st of students) {
    const mine = concessions.filter((c) => String(c.studentId) === String(st._id))
    for (const ins of s.installments) {
      if (existing.has(`${st._id}:${ins.name}`)) { skipped++; continue }
      // each line's share of this installment, rounded so the lines add up to the installment exactly
      let given = 0
      const lines = s.lines.map((l, k) => {
        const share = k === s.lines.length - 1 ? ins.amount - given : Math.round((l.amount * ins.amount) / total)
        given += share
        return { feeHeadId: l.feeHeadId, name: heads.get(String(l.feeHeadId))?.name ?? '', amount: share, concession: 0 }
      })
      applyConcessions(lines, mine)
      const inv = recompute({ lines, lateFee: 0, paid: 0, status: 'UNPAID' })
      await FeeInvoice.create({
        ...inv, invoiceNo: await nextNumber('FEE_INVOICE', { branchId: st.branchId }), studentId: st._id, sectionId: st.sectionId, branchId: st.branchId,
        academicYearId: s.academicYearId, structureId: s._id, installment: ins.name, dueDate: ins.dueDate,
      })
      created++
    }
  }
  await audit({ action: 'CREATE', module: 'fees', entityType: 'fee_structure', entityId: String(s._id), entityName: s.name, summary: `Raised ${created} invoice(s) from ${s.name} for ${students.length} student(s)` }, req)
  return { created, skipped, students: students.length }
}

// ───────────────────────────────────────────────────────── a student's account

/** What a student owes right now, late fees included: { due, lateFee, student } — for online payment. */
export async function amountDueNow(studentId) {
  const s = isOid(studentId) ? await Student.findById(studentId).lean() : null
  if (!s) throw notFound('Student')
  const [cfg, t] = await Promise.all([feeSettings(), today()])
  const open = await FeeInvoice.find({ studentId: s._id, status: { $in: ['UNPAID', 'PARTIAL'] } }).lean()
  const lateFee = open.reduce((n, i) => n + Math.max(0, lateFeeFor({ dueDate: i.dueDate, balance: i.balance }, t, cfg) - (i.lateFee ?? 0)), 0)
  return { due: open.reduce((n, i) => n + i.balance, 0) + lateFee, lateFee, student: s }
}

export async function studentLedger(studentId, auth) {
  const s = await studentInScope(studentId, auth)
  const [cfg, t, place] = await Promise.all([feeSettings(), today(), placeOf(s.sectionId)])
  const [invoices, payments, refunds, concessions] = await Promise.all([
    FeeInvoice.find({ studentId: s._id }).sort({ dueDate: 1, invoiceNo: 1 }).lean(),
    FeePayment.find({ studentId: s._id }).sort({ at: -1 }).lean(),
    FeeRefund.find({ studentId: s._id }).sort({ createdAt: -1 }).lean(),
    Concession.find({ studentId: s._id }).sort({ createdAt: -1 }).lean(),
  ])
  const open = invoices.filter((i) => i.status !== 'CANCELLED')
  const rows = invoices.map((i) => invoiceDto(i, t, cfg))
  return {
    student: { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, status: s.status, classLabel: place?.label ?? null, classShort: place?.short ?? null },
    invoices: rows,
    payments: payments.map((p) => ({ ...clean(p), studentId: String(p.studentId), modeLabel: PAYMENT_MODE_LABEL[p.mode] ?? p.mode })),
    refunds: clean(refunds),
    concessions: concessions.map((c) => ({ ...clean(c), statusLabel: CONCESSION_STATUS[c.status]?.label })),
    totals: {
      billed: open.reduce((n, i) => n + i.net, 0),
      paid: open.reduce((n, i) => n + i.paid, 0),
      balance: open.reduce((n, i) => n + Math.max(0, i.balance), 0),
      overdue: rows.filter((i) => i.overdue).reduce((n, i) => n + i.balance, 0),
      lateFeeDue: rows.reduce((n, i) => n + i.lateFeeDue, 0),
    },
    today: t,
  }
}

// ───────────────────────────────────────────────────────── collecting money

/**
 * Take a payment. The late fee due on each overdue installment is charged first (unless waived by
 * someone who may give concessions at the counter), then the money pays installments oldest first.
 */
export async function collect({ studentId, amount, mode, reference, waiveLateFee = false, note, invoiceIds, online = false }, auth, req) {
  const s = await studentInScope(studentId, auth)
  if (amount <= 0) throw fieldsError({ amount: 'Enter the amount received' })
  if (waiveLateFee && !can(auth, 'fees.collect.discount')) throw forbidden('Your role can’t waive late fees.')
  const [cfg, t] = await Promise.all([feeSettings(), today()])
  const payment = await withTransaction(async () => {
    const filter = { studentId: s._id, status: { $in: ['UNPAID', 'PARTIAL'] }, ...(invoiceIds?.length && { _id: { $in: invoiceIds } }) }
    const invoices = await FeeInvoice.find(filter).sort({ dueDate: 1 })
    if (!invoices.length) throw conflict(`${studentName(s)} has nothing due.`)
    if (!waiveLateFee) {
      for (const inv of invoices) {
        const fee = lateFeeFor({ dueDate: inv.dueDate, balance: inv.balance }, t, cfg)
        if (fee > inv.lateFee) { inv.lateFee = fee; recompute(inv) }
      }
    }
    const due = invoices.reduce((n, i) => n + i.balance, 0)
    if (amount > due) throw fieldsError({ amount: `More than the ${formatINR(due)} due` })
    // an online payment was made for what was due when it started; a late fee added since doesn't refuse it
    if (!online && !cfg.allowPartial && amount < due) throw fieldsError({ amount: `Collect the full ${formatINR(due)} (part payments are switched off)` })
    const { allocations } = allocateOldestFirst(invoices.map((i) => ({ id: String(i._id), dueDate: i.dueDate, balance: i.balance })), amount)
    for (const a of allocations) {
      const inv = invoices.find((i) => String(i._id) === a.invoiceId)
      inv.paid += a.amount
      recompute(inv)
    }
    for (const inv of invoices) if (inv.isModified()) await inv.save()
    const [p] = await FeePayment.create([{
      receiptNo: await nextNumber('RECEIPT', { branchId: s.branchId }), studentId: s._id, branchId: s.branchId, date: t, mode, reference: reference || undefined,
      amount, allocations, collectedById: auth.userId, collectedBy: auth.user?.name, note: note || undefined,
    }])
    return p
  })
  const after = await FeeInvoice.find({ studentId: s._id, status: { $in: ['UNPAID', 'PARTIAL'] } }).select('balance').lean()
  const balance = after.reduce((n, i) => n + i.balance, 0)
  await audit({ action: 'CREATE', module: 'fees', entityType: 'fee_payment', entityId: String(payment._id), entityName: payment.receiptNo, studentId: s._id, summary: `Received ${formatINR(amount)} (${PAYMENT_MODE_LABEL[mode]}) from ${studentName(s)} — receipt ${payment.receiptNo}` }, req)
  const place = await placeOf(s.sectionId)
  await emit('fees.receipt', {
    studentId: String(s._id), entity: { type: 'fee_payment', id: payment._id },
    data: { student: { class: place?.short ?? '' }, receipt: { no: payment.receiptNo, amount: formatINR(amount), date: humanDate(t) }, fees: { due: formatINR(balance) } },
  })
  return { ...clean(payment.toObject()), studentId: String(s._id), balance }
}

/** Cancel a receipt (a mistake at the counter): its money comes off the invoices it paid. */
export async function cancelReceipt(id, reason, auth, req) {
  const p = await FeePayment.findById(id)
  if (!p) throw notFound('Receipt')
  await studentInScope(p.studentId, auth)
  if (p.status === 'CANCELLED') throw conflict('This receipt is already cancelled.')
  if (p.refunded) throw conflict('Money has been refunded on this receipt, so it can’t be cancelled.')
  if (p.dayEndId) throw conflict('This receipt is in a closed day. Refund it instead.')
  await withTransaction(async () => {
    for (const a of p.allocations) {
      const inv = await FeeInvoice.findById(a.invoiceId)
      if (!inv) continue
      inv.paid -= a.amount
      recompute(inv)
      await inv.save()
    }
    Object.assign(p, { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.user?.name, cancelReason: reason })
    await p.save()
  })
  await audit({ action: 'CANCEL', module: 'fees', entityType: 'fee_payment', entityId: String(p._id), entityName: p.receiptNo, studentId: p.studentId, summary: `Cancelled receipt ${p.receiptNo} (${formatINR(p.amount)}): ${reason}` }, req)
  await emit('fees.receipt_cancelled', { entity: { type: 'fee_payment', id: p._id } }) // the books mirror its voucher
  return clean(p.toObject())
}

/** Pay money back against a receipt; the latest installments it paid become due again. */
export async function refundReceipt(id, { amount, mode, reference, reason }, auth, req) {
  const p = await FeePayment.findById(id)
  if (!p) throw notFound('Receipt')
  await studentInScope(p.studentId, auth)
  if (p.status === 'CANCELLED') throw conflict('This receipt is cancelled.')
  const left = p.amount - p.refunded
  if (amount <= 0 || amount > left) throw fieldsError({ amount: `Up to ${formatINR(left)}` })
  const limit = auth.limits?.['fees.refundMax']
  if (!auth.fullAccess && limit != null && amount > Number(limit) * 100) throw forbidden(`Your role can refund up to ${formatINR(Number(limit) * 100)} without approval.`)
  const refund = await withTransaction(async () => {
    let rest = amount
    for (const a of [...p.allocations].reverse()) {
      if (rest <= 0) break
      const inv = await FeeInvoice.findById(a.invoiceId)
      if (!inv) continue
      const back = Math.min(rest, a.amount, inv.paid)
      inv.paid -= back
      recompute(inv)
      await inv.save()
      rest -= back
    }
    p.refunded += amount
    await p.save()
    const [r] = await FeeRefund.create([{ refundNo: await nextNumber('REFUND', { branchId: p.branchId }), studentId: p.studentId, paymentId: p._id, date: await today(), amount, mode, reference: reference || undefined, reason, by: auth.user?.name, byId: auth.userId }])
    return r
  })
  await audit({ action: 'CREATE', module: 'fees', entityType: 'fee_refund', entityId: String(refund._id), entityName: refund.refundNo, studentId: p.studentId, summary: `Refunded ${formatINR(amount)} on receipt ${p.receiptNo}: ${reason}` }, req)
  await emit('fees.refund', { studentId: String(p.studentId), entity: { type: 'fee_refund', id: refund._id }, refundNo: refund.refundNo, amount })
  return clean(refund.toObject())
}

// ───────────────────────────────────────────────────────── lists

async function studentLabels(ids) {
  const students = await Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo sectionId').lean()
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId).filter(Boolean) } }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((x) => x.classId) } }).select('code name').lean()).map((c) => [String(c._id), c]))
  const short = new Map(sections.map((x) => [String(x._id), sectionLabel(classes.get(String(x.classId)), x, { short: true })]))
  return new Map(students.map((s) => [String(s._id), { name: studentName(s), admissionNo: s.admissionNo, classShort: short.get(idStr(s.sectionId)) ?? null }]))
}

async function studentIdsMatching(search) {
  const re = new RegExp(escapeRegex(search), 'i')
  return (await Student.find({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }).select('_id').limit(500).lean()).map((s) => s._id)
}

export async function listInvoices(q, paging, auth) {
  const [cfg, t] = await Promise.all([feeSettings(), today()])
  const filter = { ...(await branchFilter(auth)) }
  if (q.status) filter.status = q.status
  if (q.sectionId) filter.sectionId = q.sectionId
  if (q.overdue) { filter.status = { $in: ['UNPAID', 'PARTIAL'] }; filter.dueDate = { $lt: t } }
  if (paging.search) filter.$or = [{ invoiceNo: new RegExp(escapeRegex(paging.search), 'i') }, { studentId: { $in: await studentIdsMatching(paging.search) } }]
  const [rows, total] = await Promise.all([FeeInvoice.find(filter).sort({ dueDate: -1, invoiceNo: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), FeeInvoice.countDocuments(filter)])
  const names = await studentLabels(rows.map((r) => r.studentId))
  return listResponse(rows.map((r) => ({ ...invoiceDto(r, t, cfg), student: names.get(String(r.studentId)) ?? null })), total, paging)
}

export async function listReceipts(q, paging, auth) {
  const filter = { ...(await branchFilter(auth)) }
  if (scopeOf(auth, 'fees') === 'OWN') filter.collectedById = auth.userId
  if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) }
  if (q.mode) filter.mode = q.mode
  if (q.status) filter.status = q.status
  if (paging.search) filter.$or = [{ receiptNo: new RegExp(escapeRegex(paging.search), 'i') }, { reference: new RegExp(escapeRegex(paging.search), 'i') }, { studentId: { $in: await studentIdsMatching(paging.search) } }]
  const [rows, total] = await Promise.all([FeePayment.find(filter).sort({ at: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), FeePayment.countDocuments(filter)])
  const names = await studentLabels(rows.map((r) => r.studentId))
  return listResponse(rows.map((r) => ({ ...clean(r), studentId: String(r.studentId), modeLabel: PAYMENT_MODE_LABEL[r.mode] ?? r.mode, student: names.get(String(r.studentId)) ?? null })), total, paging)
}

export async function listRefunds(auth) {
  const filter = { ...(await branchFilter(auth)) }
  const rows = await FeeRefund.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  const names = await studentLabels(rows.map((r) => r.studentId))
  const receipts = new Map((await FeePayment.find({ _id: { $in: rows.map((r) => r.paymentId) } }).select('receiptNo').lean()).map((p) => [String(p._id), p.receiptNo]))
  return rows.map((r) => ({ ...clean(r), studentId: String(r.studentId), student: names.get(String(r.studentId)) ?? null, receiptNo: receipts.get(String(r.paymentId)) ?? null, modeLabel: PAYMENT_MODE_LABEL[r.mode] ?? r.mode }))
}

// ───────────────────────────────────────────────────────── dues and reminders

/** Students with fees outstanding: total due, how much is overdue, the oldest due date. */
export async function listDues({ sectionId, overdueOnly }, auth) {
  const t = await today()
  const match = { status: { $in: ['UNPAID', 'PARTIAL'] }, ...(await branchFilter(auth)), ...(sectionId && { sectionId: oid(sectionId) }) }
  if (overdueOnly) match.dueDate = { $lt: t }
  const rows = await FeeInvoice.aggregate([
    { $match: match },
    { $group: { _id: '$studentId', due: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', t] }, '$balance', 0] } }, oldest: { $min: '$dueDate' }, invoices: { $sum: 1 } } },
    { $sort: { overdue: -1, due: -1 } },
    { $limit: 2000 },
  ])
  const names = await studentLabels(rows.map((r) => r._id))
  const guardians = new Map((await Student.find({ _id: { $in: rows.map((r) => r._id) } }).select('guardians').lean()).map((s) => [String(s._id), s.guardians?.find((g) => g.isPrimary) ?? s.guardians?.[0]]))
  return rows.map((r) => ({
    studentId: String(r._id), ...names.get(String(r._id)), due: r.due, overdue: r.overdue, oldestDue: r.oldest, invoices: r.invoices,
    guardianName: guardians.get(String(r._id))?.name ?? null, guardianMobile: guardians.get(String(r._id))?.mobile ?? null,
  }))
}

/** "Fee due reminder" to each family (by the channels set in Notification rules). */
export async function sendReminders(studentIds, auth, req) {
  const t = await today()
  const payLink = await familyLink('fees')
  let sent = 0
  for (const id of studentIds) {
    const s = await studentInScope(id, auth).catch(() => null)
    if (!s) continue
    const open = await FeeInvoice.find({ studentId: s._id, status: { $in: ['UNPAID', 'PARTIAL'] } }).sort({ dueDate: 1 }).lean()
    const due = open.reduce((n, i) => n + i.balance, 0)
    if (!due) continue
    const place = await placeOf(s.sectionId)
    const next = open.find((i) => i.dueDate >= t) ?? open[0]
    await emit('fees.due_reminder', { studentId: String(s._id), data: { student: { class: place?.short ?? '' }, fees: { due: formatINR(due), dueDate: humanDate(next.dueDate) }, pay: { link: payLink } } })
    sent++
  }
  await audit({ action: 'SEND', module: 'fees', entityType: 'fee_reminder', entityId: 'reminders', entityName: 'Fee reminders', summary: `Sent fee reminders to ${sent} famil${sent === 1 ? 'y' : 'ies'}` }, req)
  return { sent }
}

// ───────────────────────────────────────────────────────── concessions

export async function listConcessions({ status }, auth) {
  const filter = status ? { status } : {}
  const f = await branchFilter(auth)
  if (f) filter.studentId = { $in: (await Student.find(f).select('_id').lean()).map((s) => s._id) }
  const rows = await Concession.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  const names = await studentLabels(rows.map((r) => r.studentId))
  const years = new Map((await AcademicYear.find({ _id: { $in: rows.map((r) => r.academicYearId) } }).select('name').lean()).map((y) => [String(y._id), y.name]))
  const heads = new Map((await FeeHead.find().select('name').lean()).map((h) => [String(h._id), h.name]))
  return rows.map((r) => ({
    ...clean(r), studentId: String(r.studentId), student: names.get(String(r.studentId)) ?? null, yearName: years.get(String(r.academicYearId)) ?? null,
    heads: (r.feeHeadIds ?? []).map((h) => heads.get(String(h))).filter(Boolean), statusLabel: CONCESSION_STATUS[r.status]?.label,
  }))
}

export async function requestConcession(input, auth, req) {
  const s = await studentInScope(input.studentId, auth)
  const year = input.academicYearId ? await yearOrCurrent(input.academicYearId) : await currentYear()
  if (input.kind === 'PCT' && (input.value <= 0 || input.value > 100)) throw fieldsError({ value: '1 to 100%' })
  if (input.kind === 'AMOUNT' && input.value <= 0) throw fieldsError({ value: 'Enter the amount' })
  const c = await Concession.create({ ...input, studentId: s._id, academicYearId: year._id, status: 'PENDING', requestedBy: auth.user?.name, requestedById: auth.userId })
  await audit({ action: 'CREATE', module: 'fees', entityType: 'concession', entityId: String(c._id), entityName: studentName(s), studentId: s._id, summary: `Asked for a ${c.kind === 'PCT' ? `${c.value}%` : formatINR(c.value)} concession for ${studentName(s)} (${c.reason})` }, req)
  return clean(c.toObject())
}

/** Re-apply a student's approved concessions to their unpaid invoices of a year (never below what is paid). */
async function reapply(studentId, academicYearId) {
  const concessions = await Concession.find({ studentId, academicYearId, status: 'APPROVED' }).lean()
  const invoices = await FeeInvoice.find({ studentId, academicYearId, status: { $in: ['UNPAID', 'PARTIAL'] } })
  for (const inv of invoices) {
    applyConcessions(inv.lines, concessions)
    recompute(inv)
    if (inv.balance < 0) { // a concession bigger than what is still due: keep it to what is left
      const over = -inv.balance
      for (const l of [...inv.lines].reverse()) { const back = Math.min(over, l.concession); l.concession -= back; if (back) break }
      recompute(inv)
    }
    inv.markModified('lines')
    await inv.save()
  }
  return invoices.length
}

export async function decideConcession(id, approve, auth, req) {
  const c = await Concession.findById(id)
  if (!c) throw notFound('Concession')
  if (c.status !== 'PENDING') throw conflict('This concession has already been decided.')
  if (String(c.requestedById) === String(auth.userId) && !auth.fullAccess) throw forbidden('Someone other than the person who asked must approve a concession.')
  await studentInScope(c.studentId, auth)
  const updated = await withTransaction(async () => {
    Object.assign(c, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: auth.user?.name, decidedAt: new Date() })
    await c.save()
    return approve ? reapply(c.studentId, c.academicYearId) : 0
  })
  await audit({ action: approve ? 'APPROVE' : 'REJECT', module: 'fees', entityType: 'concession', entityId: String(c._id), entityName: String(c.studentId), studentId: c.studentId, summary: `${approve ? 'Approved' : 'Refused'} a concession (${c.reason})${updated ? `; ${updated} invoice(s) updated` : ''}` }, req)
  return { ...clean(c.toObject()), invoicesUpdated: updated }
}

export async function withdrawConcession(id, auth, req) {
  const c = await Concession.findById(id)
  if (!c) throw notFound('Concession')
  await studentInScope(c.studentId, auth)
  if (c.status === 'WITHDRAWN' || c.status === 'REJECTED') throw conflict('This concession is not active.')
  if (c.status === 'APPROVED' && !can(auth, 'fees.concessions.approve')) throw forbidden('Only someone who approves concessions can withdraw an approved one.')
  const was = c.status
  await withTransaction(async () => {
    c.status = 'WITHDRAWN'
    await c.save()
    if (was === 'APPROVED') await reapply(c.studentId, c.academicYearId)
  })
  await audit({ action: 'UPDATE', module: 'fees', entityType: 'concession', entityId: String(c._id), entityName: String(c.studentId), studentId: c.studentId, summary: `Withdrew a concession (${c.reason})` }, req)
  return clean(c.toObject())
}

// ───────────────────────────────────────────────────────── day-end

/** One collector's receipts for a day, by mode, and whether the day is closed. */
export async function daySummary({ date, collectorId }, auth) {
  const day = date || await today()
  const who = collectorId && can(auth, 'fees.day-end.approve_variance') ? collectorId : auth.userId
  const receipts = await FeePayment.find({ date: day, collectedById: who, status: 'VALID' }).sort({ at: 1 }).lean()
  const refunds = await FeeRefund.find({ date: day, byId: who }).lean()
  const byMode = {}
  for (const r of receipts) byMode[r.mode] = (byMode[r.mode] ?? 0) + r.amount
  for (const r of refunds) byMode[r.mode] = (byMode[r.mode] ?? 0) - r.amount
  const closing = await FeeDayEnd.findOne({ date: day, collectorId: who }).lean()
  const names = await studentLabels(receipts.map((r) => r.studentId))
  return {
    date: day, collectorId: String(who), byMode, total: Object.values(byMode).reduce((n, v) => n + v, 0), expectedCash: byMode.CASH ?? 0,
    receipts: receipts.map((r) => ({ id: String(r._id), receiptNo: r.receiptNo, amount: r.amount, mode: r.mode, modeLabel: PAYMENT_MODE_LABEL[r.mode], at: r.at, student: names.get(String(r.studentId)) ?? null })),
    refunds: refunds.length, closing: closing ? clean(closing) : null,
  }
}

/** Close the caller's day: the cash counted against the cash receipts. A difference waits for approval. */
export async function closeDay({ date, cashCounted, note }, auth, req) {
  const sum = await daySummary({ date }, auth)
  if (sum.closing) throw conflict(`${sum.date} is already closed.`)
  if (!sum.receipts.length) throw conflict('No receipts to close for this day.')
  const variance = cashCounted - sum.expectedCash
  const d = await withTransaction(async () => {
    const [row] = await FeeDayEnd.create([{
      date: sum.date, collectorId: auth.userId, collector: auth.user?.name, byMode: sum.byMode, receipts: sum.receipts.length, total: sum.total,
      cashCounted, variance, note: note || undefined, status: variance === 0 ? 'CLOSED' : 'VARIANCE', closedAt: new Date(),
    }])
    await FeePayment.updateMany({ _id: { $in: sum.receipts.map((r) => r.id) } }, { $set: { dayEndId: row._id } })
    return row
  })
  await audit({ action: 'CREATE', module: 'fees', entityType: 'day_end', entityId: String(d._id), entityName: `${sum.date} · ${auth.user?.name}`, summary: `Closed ${sum.date}: ${sum.receipts.length} receipt(s), ${formatINR(sum.total)}${variance ? `, cash ${variance > 0 ? 'over' : 'short'} by ${formatINR(Math.abs(variance))}` : ''}` }, req)
  return clean(d.toObject())
}

export async function listDayEnds({ from, to }) {
  const filter = from || to ? { date: { ...(from && { $gte: from }), ...(to && { $lte: to }) } } : {}
  return clean(await FeeDayEnd.find(filter).sort({ date: -1, collector: 1 }).limit(200).lean())
}

export async function approveVariance(id, auth, req) {
  const d = await FeeDayEnd.findById(id)
  if (!d) throw notFound('Day-end')
  if (d.status !== 'VARIANCE') throw conflict('Nothing to approve on this day.')
  if (String(d.collectorId) === String(auth.userId) && !auth.fullAccess) throw forbidden('Someone else must approve your own cash difference.')
  Object.assign(d, { status: 'APPROVED', approvedBy: auth.user?.name, approvedAt: new Date() })
  await d.save()
  await audit({ action: 'APPROVE', module: 'fees', entityType: 'day_end', entityId: String(d._id), entityName: `${d.date} · ${d.collector}`, summary: `Approved a cash difference of ${formatINR(d.variance)} on ${d.date} (${d.collector})` }, req)
  return clean(d.toObject())
}

// ───────────────────────────────────────────────────────── printing

/** The data a receipt prints from (documents/registry.js FEE_RECEIPT). */
export async function receiptPrintData(id, auth) {
  const p = await FeePayment.findById(id).lean()
  if (!p) throw notFound('Receipt')
  const s = await studentInScope(p.studentId, auth)
  const invoices = await FeeInvoice.find({ _id: { $in: p.allocations.map((a) => a.invoiceId) } }).lean()
  const open = await FeeInvoice.find({ studentId: s._id, status: { $in: ['UNPAID', 'PARTIAL'] } }).select('balance').lean()
  return { payment: p, student: s, place: await placeOf(s.sectionId), invoices, balance: open.reduce((n, i) => n + i.balance, 0) }
}
