// Library: the catalogue (titles and their copies — each copy has an accession number, printed as its barcode),
// the issue desk (scan the borrower's ID card, then the books), returns with late fines, and the e-library (e-books
// and links families open in the app). Students and staff borrow; each has a limit and a loan period (Settings).

export const ITEM_TYPES = [
  { value: 'BOOK', label: 'Book' },
  { value: 'REFERENCE', label: 'Reference (not lent)' },
  { value: 'TEXTBOOK', label: 'Textbook' },
  { value: 'MAGAZINE', label: 'Magazine' },
  { value: 'JOURNAL', label: 'Journal' },
  { value: 'MEDIA', label: 'CD / DVD' },
  { value: 'EBOOK', label: 'E-book / link' },
]
/** Types that are physical copies on a shelf (an e-book has none). */
export const hasCopies = (type) => type !== 'EBOOK'

export const COPY_STATUS = {
  AVAILABLE: { label: 'On the shelf', tone: 'success' },
  ISSUED: { label: 'Issued', tone: 'info' },
  LOST: { label: 'Lost', tone: 'danger' },
  DAMAGED: { label: 'Damaged', tone: 'warning' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
}
export const COPY_SOURCES = [
  { value: 'PURCHASE', label: 'Bought' },
  { value: 'DONATION', label: 'Donated' },
  { value: 'GRANT', label: 'Grant / scheme' },
]

export const BORROWER_KINDS = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'STAFF', label: 'Staff' },
]

export const LOAN_STATUS = {
  ISSUED: { label: 'Out', tone: 'info' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  RETURNED: { label: 'Returned', tone: 'neutral' },
  LOST: { label: 'Lost', tone: 'danger' },
}

export const FINE_REASONS = [
  { value: 'LATE', label: 'Late return' },
  { value: 'LOST', label: 'Lost book' },
  { value: 'DAMAGED', label: 'Damaged book' },
  { value: 'OTHER', label: 'Other' },
]
export const FINE_STATUS = {
  OPEN: { label: 'To pay', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  WAIVED: { label: 'Waived', tone: 'neutral' },
}

// ───────────────────────────────────────────────────────── dates and fines

const ms = (ymd) => Date.parse(`${ymd}T00:00:00Z`)
/** Whole days from a to b, YYYY-MM-DD (b later → positive). */
export const dayDiff = (a, b) => Math.round((ms(b) - ms(a)) / 864e5)

/** A loan as of a day: out, overdue, returned or lost. */
export function loanState(loan, today) {
  if (loan.status === 'RETURNED' || loan.status === 'LOST') return loan.status
  return loan.dueOn < today ? 'OVERDUE' : 'ISSUED'
}

/** Days late on a return (after the grace days), never below 0. */
export const lateDays = (dueOn, returnedOn, graceDays = 0) => Math.max(0, dayDiff(dueOn, returnedOn) - Math.max(0, graceDays))

/** The late fine in paise: `perDay` paise a day late, capped at `max` paise (0 = no cap). */
export function lateFine(days, { perDay = 0, max = 0 } = {}) {
  const f = Math.max(0, days) * Math.max(0, perDay)
  return max > 0 ? Math.min(f, max) : f
}

// ───────────────────────────────────────────────────────── ISBN

/** Digits (and a final X) only. */
export const cleanIsbn = (s) => String(s ?? '').toUpperCase().replace(/[^0-9X]/g, '')

/** True for a valid ISBN-10 or ISBN-13 (check digit included). */
export function isValidIsbn(raw) {
  const s = cleanIsbn(raw)
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (10 - i), 0)
    return sum % 11 === 0
  }
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0)
    return sum % 10 === 0
  }
  return false
}

/** ISBN-13 for any valid ISBN (an ISBN-10 gets the 978 prefix and a new check digit); null when not valid. */
export function isbn13(raw) {
  const s = cleanIsbn(raw)
  if (!isValidIsbn(s)) return null
  if (s.length === 13) return s
  const body = `978${s.slice(0, 9)}`
  const sum = [...body].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** "Last, First; Other" or "A, B and C" → a list of authors. */
export const splitAuthors = (s) => String(s ?? '').split(/;|\band\b|&|\|/i).map((x) => x.trim()).filter(Boolean)
