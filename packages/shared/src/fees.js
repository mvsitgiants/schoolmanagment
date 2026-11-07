// Fees: lists and pure helpers shared by the API and the web app. Money is integer paise (money.js).

export const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque / DD' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer (NEFT / IMPS)' },
  { value: 'ONLINE', label: 'Online (payment gateway)' },
]
export const PAYMENT_MODE_LABEL = Object.fromEntries(PAYMENT_MODES.map((m) => [m.value, m.label]))
/** Modes that need a reference (UTR, cheque no., last 4 of the card). */
export const MODES_WITH_REFERENCE = ['UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'ONLINE']

export const INVOICE_STATUS = {
  UNPAID: { label: 'Unpaid', tone: 'warning' },
  PARTIAL: { label: 'Part paid', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

export const CONCESSION_STATUS = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
}

export const CONCESSION_KINDS = [
  { value: 'PCT', label: 'Percentage' },
  { value: 'AMOUNT', label: 'Fixed amount per installment' },
]

/** Common reasons for a concession (scholarship, sibling, staff child …). */
export const CONCESSION_REASONS = ['Sibling', 'Staff child', 'Merit scholarship', 'Financial need', 'Government scheme (RTE)', 'Sports', 'Other']

export const DAY_END_STATUS = {
  CLOSED: { label: 'Closed', tone: 'success' },
  VARIANCE: { label: 'Cash difference — waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Closed (difference approved)', tone: 'success' },
}

/** Split `total` paise into `n` installments that add up exactly (the remainder goes to the first). */
export function splitEqually(total, n) {
  const count = Math.max(1, Math.floor(n))
  const each = Math.floor(total / count / 100) * 100 // whole rupees
  const out = Array(count).fill(each)
  out[0] += total - each * count
  return out
}

/** A concession's amount on a line of `amount` paise. */
export function concessionOn(amount, c) {
  if (!c) return 0
  if (c.kind === 'PCT') return Math.round((amount * Math.min(100, Math.max(0, Number(c.value) || 0))) / 100)
  return Math.min(amount, Math.max(0, Math.round(Number(c.value) || 0)))
}

/** Late fee on an unpaid installment: `perDay` paise for each day past the due date beyond `graceDays`. */
export function lateFeeFor({ dueDate, balance }, today, { perDay = 0, graceDays = 0 } = {}) {
  if (!perDay || !balance || balance <= 0 || !dueDate || today <= dueDate) return 0
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 864e5) - graceDays
  return days > 0 ? days * perDay : 0
}

/** Pay `amount` into invoices oldest due first: [{ invoiceId, amount }] and what is left over. */
export function allocateOldestFirst(invoices, amount) {
  let left = amount
  const out = []
  for (const inv of [...invoices].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))) {
    if (left <= 0) break
    const take = Math.min(left, inv.balance)
    if (take > 0) { out.push({ invoiceId: inv.id, amount: take }); left -= take }
  }
  return { allocations: out, left }
}
