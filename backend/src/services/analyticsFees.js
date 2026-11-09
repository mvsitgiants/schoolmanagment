import { AGEING_BUCKETS, PAYMENT_MODE_LABEL, ageingBucket, daysBetweenYmd, monthsInRange, pctOf } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { Concession, FeeInvoice, FeePayment, FeeRefund } from '../models/fees.js'
import { Student } from '../models/students.js'
import { oid } from '../platform/db.js'
import { badRequest } from '../platform/errors.js'
import { currentYear } from './academics.js'
import { analyticsScope, recordMatch, scopedSections, studentCards, today } from './analytics.js'

// Analytics › Fee collection over a date range (default: the current academic year): what fell
// due (billed) against what came in, month by month, by payment mode, fee head and class; the
// ageing of what is overdue, the biggest defaulters, concessions and refunds. Read-only.
//
// "Billed" = invoices (not cancelled) due in the range, after concession, with any late fee.
// "Collected" = receipts dated in the range (money in, whichever invoice it paid).
// "Outstanding" = what is still unpaid on the invoices due in the range.

/** Payments and refunds carry no section: a class-scoped caller's are found by their students. */
async function paymentMatch(scope) {
  if (scope.all || scope.branchId) return recordMatch(scope)
  const ids = await Student.find({ sectionId: { $in: (scope.sectionIds ?? []).map(oid) } }).distinct('_id')
  return { studentId: { $in: ids } }
}

export async function feesAnalytics({ from, to }, auth) {
  const [scope, t, year] = await Promise.all([analyticsScope(auth), today(), currentYear()])
  if (!from || !to) {
    from = year?.startDate ?? `${t.slice(0, 4)}-01-01`
    to = year?.endDate ?? t
  }
  if (from > to) throw badRequest('The start date is after the end date.')

  const scoped = recordMatch(scope)
  const payScope = await paymentMatch(scope)
  const inv = { ...scoped, status: { $ne: 'CANCELLED' }, dueDate: { $gte: from, $lte: to } }
  const pay = { ...payScope, status: 'VALID', date: { $gte: from, $lte: to } }
  const month = (field) => ({ $substrCP: [field, 0, 7] })

  const [billedByMonth, paidByMonthMode, heads, bySection, dueDates, defaulters, refunds, concessionStudents] = await Promise.all([
    FeeInvoice.aggregate([
      { $match: inv },
      { $group: { _id: month('$dueDate'), billed: { $sum: '$net' }, outstanding: { $sum: '$balance' }, gross: { $sum: '$gross' }, concession: { $sum: '$concession' }, lateFee: { $sum: '$lateFee' }, invoices: { $sum: 1 } } },
    ]),
    FeePayment.aggregate([
      { $match: pay },
      { $group: { _id: { m: month('$date'), mode: '$mode' }, amount: { $sum: '$amount' }, receipts: { $sum: 1 } } },
    ]),
    // a head's share of what is paid on an invoice follows its share of the invoice
    FeeInvoice.aggregate([
      { $match: inv },
      { $project: { lines: 1, ratio: { $cond: [{ $gt: ['$net', 0] }, { $min: [{ $divide: ['$paid', '$net'] }, 1] }, 0] } } },
      { $unwind: '$lines' },
      { $project: { key: { $ifNull: ['$lines.feeHeadId', '$lines.name'] }, name: '$lines.name', concession: { $ifNull: ['$lines.concession', 0] }, net: { $subtract: [{ $ifNull: ['$lines.amount', 0] }, { $ifNull: ['$lines.concession', 0] }] }, ratio: 1 } },
      { $group: { _id: '$key', name: { $first: '$name' }, billed: { $sum: '$net' }, concession: { $sum: '$concession' }, collected: { $sum: { $multiply: ['$net', '$ratio'] } } } },
      { $sort: { billed: -1 } },
    ]),
    FeeInvoice.aggregate([
      { $match: inv },
      { $group: { _id: { sectionId: '$sectionId', studentId: '$studentId' }, billed: { $sum: '$net' }, outstanding: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', t] }, '$balance', 0] } } } },
      { $group: { _id: '$_id.sectionId', students: { $sum: 1 }, owing: { $sum: { $cond: [{ $gt: ['$outstanding', 0] }, 1, 0] } }, billed: { $sum: '$billed' }, outstanding: { $sum: '$outstanding' }, overdue: { $sum: '$overdue' } } },
    ]),
    FeeInvoice.aggregate([
      { $match: { ...inv, balance: { $gt: 0 } } },
      { $group: { _id: '$dueDate', amount: { $sum: '$balance' }, invoices: { $sum: 1 }, students: { $addToSet: '$studentId' } } },
    ]),
    FeeInvoice.aggregate([
      { $match: { ...inv, balance: { $gt: 0 }, dueDate: { $gte: from, $lte: to, $lt: t } } },
      { $group: { _id: '$studentId', overdue: { $sum: '$balance' }, billed: { $sum: '$net' }, oldest: { $min: '$dueDate' }, invoices: { $sum: 1 } } },
      { $sort: { overdue: -1 } },
      { $limit: 25 },
    ]),
    FeeRefund.aggregate([
      { $match: { date: { $gte: from, $lte: to }, ...(payScope.studentId && { studentId: payScope.studentId }) } },
      ...(payScope.branchId ? [
        // refunds follow the campus of the receipt they pay back (same institution: ids are unique)
        { $lookup: { from: 'fee_payments', localField: 'paymentId', foreignField: '_id', as: 'p', pipeline: [{ $project: { branchId: 1 } }] } },
        { $match: { 'p.branchId': payScope.branchId } },
      ] : []),
      { $group: { _id: '$mode', amount: { $sum: '$amount' }, refunds: { $sum: 1 } } },
    ]),
    FeeInvoice.aggregate([
      { $match: { ...inv, concession: { $gt: 0 } } },
      { $group: { _id: '$studentId', amount: { $sum: '$concession' } } },
    ]),
  ])

  // ── month by month
  const months = monthsInRange(from, to).map((m) => {
    const b = billedByMonth.find((x) => x._id === m)
    const collected = paidByMonthMode.filter((x) => x._id.m === m).reduce((n, x) => n + x.amount, 0)
    return { month: m, billed: b?.billed ?? 0, collected, outstanding: b?.outstanding ?? 0 }
  })

  // ── by mode
  const modes = new Map()
  for (const x of paidByMonthMode) {
    const r = modes.get(x._id.mode) ?? { mode: x._id.mode, label: PAYMENT_MODE_LABEL[x._id.mode] ?? x._id.mode, amount: 0, receipts: 0 }
    r.amount += x.amount; r.receipts += x.receipts
    modes.set(x._id.mode, r)
  }

  // ── by class
  const sections = year ? await scopedSections(scope.all || scope.branchId ? { sectionIds: null } : scope, year._id) : []
  const sectionsById = new Map(sections.map((s) => [String(s._id), s]))
  // sections of other years (invoices raised last year) are looked up as needed
  const unknown = bySection.map((r) => String(r._id)).filter((id) => id !== 'null' && !sectionsById.has(id))
  if (unknown.length) {
    const extra = await Section.find({ _id: { $in: unknown.map(oid) } }).select('classId name').lean()
    const cls = new Map((await ClassLevel.find({ _id: { $in: extra.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
    for (const s of extra) sectionsById.set(String(s._id), { ...s, cls: cls.get(String(s.classId)) })
  }
  const classes = new Map()
  for (const r of bySection) {
    const sec = sectionsById.get(String(r._id))
    const key = sec?.cls ? String(sec.classId) : 'none'
    const c = classes.get(key) ?? { classId: sec?.cls ? key : null, name: sec?.cls?.name ?? null, order: sec?.cls?.order ?? 9999, students: 0, owing: 0, billed: 0, outstanding: 0, overdue: 0 }
    c.students += r.students; c.owing += r.owing; c.billed += r.billed; c.outstanding += r.outstanding; c.overdue += r.overdue
    classes.set(key, c)
  }
  const classRows = [...classes.values()].map((c) => ({ ...c, collected: c.billed - c.outstanding, collectionPct: pctOf(c.billed - c.outstanding, c.billed) })).sort((a, b) => a.order - b.order)

  // ── ageing (as of today) of what is due in the range
  const ageing = [{ key: 'NOT_DUE', amount: 0, invoices: 0, students: new Set() }, ...AGEING_BUCKETS.map((b) => ({ key: b.key, tone: b.tone, min: b.min, max: Number.isFinite(b.max) ? b.max : null, amount: 0, invoices: 0, students: new Set() }))]
  for (const d of dueDates) {
    const row = ageing.find((a) => a.key === (ageingBucket(d._id, t) ?? 'NOT_DUE'))
    row.amount += d.amount; row.invoices += d.invoices
    for (const s of d.students) row.students.add(String(s))
  }

  // ── concessions by reason (each student's amount under their approved concession's reason)
  const reasons = new Map()
  if (concessionStudents.length) {
    const approved = await Concession.find({ studentId: { $in: concessionStudents.map((c) => c._id) }, status: 'APPROVED' }).sort({ createdAt: 1 }).select('studentId reason').lean()
    const reasonOf = new Map()
    for (const c of approved) if (!reasonOf.has(String(c.studentId))) reasonOf.set(String(c.studentId), c.reason)
    for (const c of concessionStudents) {
      const k = reasonOf.get(String(c._id)) ?? null
      const r = reasons.get(k) ?? { reason: k, amount: 0, students: 0 }
      r.amount += c.amount; r.students += 1
      reasons.set(k, r)
    }
  }

  // ── defaulters
  const cards = await studentCards(defaulters.map((d) => d._id), sectionsById)
  const guardians = new Map((await Student.find({ _id: { $in: defaulters.map((d) => d._id) } }).select('guardians').lean())
    .map((s) => [String(s._id), s.guardians?.find((g) => g.isPrimary) ?? s.guardians?.[0] ?? null]))

  const sum = (list, k) => list.reduce((n, x) => n + (x[k] ?? 0), 0)
  const billed = sum(billedByMonth, 'billed')
  const outstanding = sum(billedByMonth, 'outstanding')
  const overdue = ageing.filter((a) => a.key !== 'NOT_DUE').reduce((n, a) => n + a.amount, 0)
  const lateFee = sum(billedByMonth, 'lateFee')
  const headRows = heads.map((h) => ({ key: String(h._id), name: h.name, billed: h.billed, collected: Math.round(h.collected), outstanding: h.billed - Math.round(h.collected), concession: h.concession, collectionPct: pctOf(Math.round(h.collected), h.billed) }))
  if (lateFee) headRows.push({ key: 'LATE_FEE', name: null, lateFee: true, billed: lateFee, collected: null, outstanding: null, concession: 0, collectionPct: null })
  return {
    range: { from, to }, today: t,
    year: year ? { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate } : null,
    summary: {
      billed, collected: sum([...modes.values()], 'amount'), realised: billed - outstanding, outstanding, overdue,
      collectionPct: pctOf(billed - outstanding, billed), gross: sum(billedByMonth, 'gross'), concession: sum(billedByMonth, 'concession'), lateFee,
      invoices: sum(billedByMonth, 'invoices'), receipts: sum([...modes.values()], 'receipts'),
      refunded: sum(refunds, 'amount'), refunds: sum(refunds, 'refunds'),
      concessionStudents: concessionStudents.length,
      defaulters: ageing.filter((a) => a.key !== 'NOT_DUE').reduce((set, a) => { for (const s of a.students) set.add(s); return set }, new Set()).size,
    },
    months,
    modes: [...modes.values()].sort((a, b) => b.amount - a.amount),
    heads: headRows,
    classes: classRows,
    ageing: ageing.map((a) => ({ key: a.key, tone: a.tone ?? 'info', min: a.min ?? null, max: a.max ?? null, amount: a.amount, invoices: a.invoices, students: a.students.size })),
    defaulters: defaulters.map((d) => {
      const s = cards.get(String(d._id))
      const g = guardians.get(String(d._id))
      return { studentId: String(d._id), name: s?.name ?? '?', admissionNo: s?.admissionNo ?? null, classShort: s?.classShort ?? null, classId: s?.classId ?? null, overdue: d.overdue, billed: d.billed, oldestDue: d.oldest, daysOverdue: daysBetweenYmd(d.oldest, t), invoices: d.invoices, guardianName: g?.name ?? null, guardianMobile: g?.mobile ?? null }
    }),
    concessions: [...reasons.values()].sort((a, b) => b.amount - a.amount),
    refunds: refunds.map((r) => ({ mode: r._id, label: PAYMENT_MODE_LABEL[r._id] ?? r._id, amount: r.amount, refunds: r.refunds })).sort((a, b) => b.amount - a.amount),
  }
}
