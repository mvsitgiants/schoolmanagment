// Fee documents beyond the receipt's base model (registry.js FEE_RECEIPT): what the Indian-format receipt adds — the
// father's name for "S/o / D/o", class and section apart, the academic year, a numbered fee table with its totals, and
// the cheque details — and the fee invoice printed as the bank challan / fee demand slip (FEE_INVOICE, `id`: the invoice).
import { INVOICE_STATUS, PAYMENT_MODE_LABEL } from '@schoolgiant/shared'
import { invoicePrintData, latestInvoiceId } from '../services/fees.js'

const nameOf = (s) => [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(' ')
const guardianOf = (s, rel) => s?.guardians?.find((g) => g.relation === rel)?.name ?? null

/** The student lines every fee document prints: name, "S/o / D/o <father>", class and section, roll no. */
export function feeStudent(s, place, year) {
  const father = guardianOf(s, 'FATHER')
  const mother = guardianOf(s, 'MOTHER')
  const guardian = (s?.guardians?.find((g) => g.isPrimary) ?? s?.guardians?.[0])?.name ?? null
  const kid = s?.gender === 'MALE' ? 'm' : s?.gender === 'FEMALE' ? 'f' : 'x'
  const parent = father || mother || guardian
  return {
    name: nameOf(s), admissionNo: s?.admissionNo, rollNo: s?.rollNo ?? null, class: place?.label ?? '',
    className: place?.className ?? null, section: place?.section ?? null, year: year ?? null,
    father, mother, guardian, parent, kid,
    // S/o, D/o — or "Ward of" when the child's gender isn't recorded or the name isn't the father's / mother's
    relation: !parent ? null : father || mother ? (kid === 'm' ? 'S/o' : kid === 'f' ? 'D/o' : 'Ward of') : 'Ward of',
    parentIs: father ? 'FATHER' : mother ? 'MOTHER' : parent ? 'GUARDIAN' : null,
  }
}

/** The receipt's numbered fee table and totals, the cheque details and the student's extra lines. */
export function withReceiptExtras(base, { payment: p, student: s, place, invoices, balance, year }) {
  const paidFor = new Map(p.allocations.map((a) => [String(a.invoiceId), a.amount]))
  const rows = []
  for (const i of invoices) for (const l of i.lines) rows.push({ sl: rows.length + 1, name: l.name, period: i.installment, amount: l.amount, concession: l.concession ?? 0 })
  const sum = (f) => invoices.reduce((n, i) => n + (Number(f(i)) || 0), 0)
  const total = sum((i) => i.net)
  const paidNow = sum((i) => paidFor.get(String(i._id)) ?? 0)
  // what other receipts paid on these installments (an earlier part payment, or one after this)
  const paidElsewhere = p.status === 'CANCELLED' ? 0 : Math.max(0, sum((i) => i.paid) - paidNow)
  return {
    ...base,
    student: { ...base.student, ...feeStudent(s, place, year) },
    receipt: {
      ...base.receipt, modeCode: p.mode, cash: p.mode === 'CASH', cheque: p.mode === 'CHEQUE', upi: p.mode === 'UPI', card: p.mode === 'CARD', bank: ['BANK_TRANSFER', 'ONLINE'].includes(p.mode),
      chequeBank: p.instrument?.bank ?? null, chequeDate: p.instrument?.date ?? null, year: year ?? null,
    },
    rows,
    summary: {
      subtotal: sum((i) => i.gross), concession: sum((i) => i.concession), lateFee: sum((i) => i.lateFee), total,
      paidEarlier: paidElsewhere, paid: p.amount, balance,
    },
  }
}

function invoiceModel({ invoice: inv, student: s, place, year, today, lateFeeDue, lateFee, upiId, bank, arrears }) {
  const lines = inv.lines.map((l, i) => ({ sl: i + 1, name: l.name, amount: l.amount, concession: l.concession ?? 0, net: (l.amount ?? 0) - (l.concession ?? 0) }))
  const payable = Math.max(0, inv.balance ?? 0)
  const withLate = payable + (lateFeeDue > (inv.lateFee ?? 0) ? lateFeeDue - (inv.lateFee ?? 0) : 0)
  const upiUrl = upiId && payable > 0 ? `upi://pay?pa=${encodeURIComponent(upiId)}&am=${(payable / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoiceNo)}` : null
  return {
    invoice: {
      no: inv.invoiceNo, installment: inv.installment, dueDate: inv.dueDate, issued: inv.createdAt ?? today, today,
      status: inv.status, statusLabel: INVOICE_STATUS[inv.status]?.label ?? inv.status, cancelled: inv.status === 'CANCELLED', paidUp: inv.status === 'PAID',
      gross: inv.gross, concession: inv.concession, lateFee: inv.lateFee ?? 0, net: inv.net, paid: inv.paid ?? 0, balance: inv.balance, payable,
      overdue: payable > 0 && inv.dueDate < today, lateFeeDue, payableNow: withLate, year: year ?? null,
    },
    student: feeStudent(s, place, year),
    lines,
    lateFee: { perDay: lateFee.perDay, graceDays: lateFee.graceDays, on: lateFee.perDay > 0 },
    arrears,
    pay: {
      upiId, upiUrl,
      bank: bank && { name: bank.name, bankName: bank.bankName ?? null, branch: bank.branch ?? null, ifsc: bank.ifsc ?? null, last4: bank.last4 ?? null },
    },
    modes: PAYMENT_MODE_LABEL,
  }
}

export const FEE_DOCS = {
  FEE_INVOICE: {
    perms: ['fees.invoices.print', 'fees.invoices.view', 'fees.collect.view'],
    load: (id, auth) => invoicePrintData(id, auth),
    model: invoiceModel,
    title: (m) => `Fee challan ${m.invoice.no} · ${m.student.name}`,
    sample: () => latestInvoiceId(),
    variables: [
      'institution.name, institution.addressLine, institution.phone …',
      'invoice.no, invoice.installment, invoice.dueDate, invoice.issued, invoice.year, invoice.gross, invoice.concession, invoice.lateFee, invoice.net, invoice.paid, invoice.balance, invoice.payable, invoice.overdue, invoice.lateFeeDue, invoice.payableNow, invoice.cancelled, invoice.paidUp',
      'student.name, student.relation (S/o · D/o · Ward of), student.parent, student.father, student.mother, student.admissionNo, student.rollNo, student.class, student.className, student.section, student.year',
      'lines[] {sl, name, amount, concession, net} · arrears (earlier installments still unpaid)',
      'lateFee.on, lateFee.perDay, lateFee.graceDays · pay.upiId, pay.upiUrl ({{qr pay.upiUrl 18}}) · pay.bank {name, bankName, branch, ifsc, last4}',
      '{{money x}} · {{words invoice.payable}}',
    ],
  },
}
