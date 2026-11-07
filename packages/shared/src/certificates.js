// Certificates: the kinds an institution issues, and small helpers shared by the API and the web app.
// Every certificate gets a number (series CERTIFICATE) and a verify code printed as a QR: anyone can
// scan it to check the certificate is genuine and not cancelled (/verify/<code>, no sign-in).
// The transfer / leaving certificate is issued from Students › Transfer & leaving (TC).

export const CERTIFICATE_KINDS = [
  { value: 'BONAFIDE', label: 'Bonafide certificate', hint: 'That the student studies here this year.', currentOnly: true },
  { value: 'CHARACTER', label: 'Character certificate', hint: 'The student’s conduct while here.' },
  { value: 'STUDY', label: 'Study certificate', hint: 'The classes and years the student studied here — for former students too.' },
  { value: 'FEE', label: 'Fee paid certificate', hint: 'Fees paid in a financial year, tuition shown separately (income tax, section 80C).', needsModule: 'fees' },
  { value: 'MERIT', label: 'Merit / participation certificate', hint: 'An achievement or event. Can be issued to many students at once.', many: true },
]
export const CERTIFICATE_KIND_BY = Object.fromEntries(CERTIFICATE_KINDS.map((k) => [k.value, k]))

export const CERTIFICATE_STATUS = {
  ISSUED: { label: 'Issued', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}

/** Usual reasons a family asks for a certificate (the purpose printed on it). */
export const CERTIFICATE_PURPOSES = ['Passport', 'Bank account', 'Scholarship', 'Income tax (80C)', 'Bus / rail concession', 'Visa', 'Aadhaar', 'Competition / sports', 'Other']

/** The Indian financial year (April–March) a date falls in: { label: '2026-27', from, to }. */
export function financialYearOf(ymd) {
  const [y, m] = String(ymd).split('-').map(Number)
  const start = m >= 4 ? y : y - 1
  return { label: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, from: `${start}-04-01`, to: `${start + 1}-03-31` }
}

/** The last few financial years up to the one `ymd` is in, newest first. */
export function recentFinancialYears(ymd, n = 4) {
  const first = financialYearOf(ymd)
  const startYear = Number(first.from.slice(0, 4))
  return Array.from({ length: n }, (_, i) => financialYearOf(`${startYear - i}-06-01`))
}

/** Fee-head codes counted as tuition on a fee certificate. */
export const TUITION_HEAD_CODES = ['TUITION']

/** A verify code: 12 characters with no look-alikes (0/O, 1/I/L). `random` returns 0 ≤ n < 1. */
export function makeVerifyCode(random = Math.random) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 12 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
}

