// Alumni (module `alumni`): the alumni directory — made from students who left or passed out (import a year's leavers)
// and added by hand — with where they work now and whether they agree to be contacted; and donations from alumni and
// other well-wishers, each with a receipt (80G when the institution has it), totalled by fund and by batch. A donation
// emits `alumni.donation` so Accounts posts it. Money in paise.

export const ALUMNI_SOURCES = {
  IMPORT: { label: 'From student records', tone: 'info' },
  MANUAL: { label: 'Added by hand', tone: 'neutral' },
}

/** Student statuses that make someone a leaver (they can be imported into the directory). */
export const LEAVER_STATUSES = ['LEFT', 'PASSED_OUT']

/** Funds a donation can go to; any other name can be typed too. */
export const DONATION_FUNDS = [
  { value: 'GENERAL', label: 'General fund' },
  { value: 'SCHOLARSHIP', label: 'Scholarships' },
  { value: 'INFRASTRUCTURE', label: 'Buildings and infrastructure' },
  { value: 'LIBRARY', label: 'Library' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'EVENTS', label: 'Alumni events' },
]
export const DONATION_FUND_LABEL = Object.fromEntries(DONATION_FUNDS.map((f) => [f.value, f.label]))
/** A fund's name: one of the list, else as typed. */
export const donationFundLabel = (v) => DONATION_FUND_LABEL[v] ?? v ?? '—'

export const DONOR_KINDS = [
  { value: 'ALUMNUS', label: 'Alumnus' },
  { value: 'OTHER', label: 'Other donor' },
]

export const DONATION_STATUS = {
  RECEIVED: { label: 'Received', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}

/** PAN: five letters, four digits, a letter. */
export const isValidDonorPan = (s) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(s ?? '').trim().toUpperCase())

/** "https://linkedin.com/in/…" or "linkedin.com/in/…" → a full link. */
export function linkedInUrl(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`
}

/** The batch (passing-out year) of a leaver: the year of their leaving date, else of the day given. */
export function alumniBatchOf(leavingDate, fallbackYmd) {
  const d = leavingDate || fallbackYmd
  const y = Number(String(d ?? '').slice(0, 4))
  return Number.isInteger(y) && y > 1900 ? y : null
}
