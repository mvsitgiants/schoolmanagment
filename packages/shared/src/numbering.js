// Number series (engine E9). Every human-facing number — admission number, receipt,
// certificate, employee code — comes from one of these, with a pattern the institution
// edits in Administration › Number series. Tokens:
//   {BR}     campus code (MAIN, NORTH…)       {YYYY} {YY} {MM} {DD}   date parts
//   {SEQ:n}  running number, zero-padded to n digits
//   {FY}     Indian financial year (April–March), e.g. 2627 for 2026-27

export const RESETS = {
  NEVER: 'Never',
  YEAR: 'Every year',
  FY: 'Every financial / academic year (April)',
  MONTH: 'Every month',
  DAY: 'Every day',
}

export const DOC_TYPES = [
  { code: 'ADMISSION_NO', label: 'Admission number', module: 'students', pattern: '{YYYY}{SEQ:4}', reset: 'NEVER', perBranch: false, hint: 'One per student for life, shared by every campus.' },
  { code: 'ENQUIRY', label: 'Admission enquiry', module: 'admissions', pattern: 'ENQ{YY}{SEQ:5}', reset: 'YEAR', perBranch: true },
  { code: 'APPLICATION', label: 'Admission application', module: 'admissions', pattern: 'APP{YY}{SEQ:5}', reset: 'YEAR', perBranch: true },
  { code: 'TC', label: 'Transfer certificate', module: 'students', pattern: 'TC/{YYYY}/{SEQ:4}', reset: 'YEAR', perBranch: true },
  { code: 'CERTIFICATE', label: 'Certificate', module: 'certificates', pattern: 'CRT{YY}{SEQ:5}', reset: 'YEAR', perBranch: true },
  { code: 'FEE_INVOICE', label: 'Fee invoice / challan', module: 'fees', pattern: 'FI{FY}{SEQ:6}', reset: 'FY', perBranch: true },
  { code: 'RECEIPT', label: 'Fee receipt', module: 'fees', pattern: 'RC{FY}{SEQ:6}', reset: 'FY', perBranch: true },
  { code: 'REFUND', label: 'Fee refund', module: 'fees', pattern: 'RF{FY}{SEQ:4}', reset: 'FY', perBranch: true },
  { code: 'GATE_PASS', label: 'Gate pass', module: 'frontoffice', pattern: 'GP{YY}{MM}{SEQ:4}', reset: 'MONTH', perBranch: true },
  { code: 'COMPLAINT', label: 'Complaint', module: 'frontoffice', pattern: 'CMP{YY}{SEQ:5}', reset: 'YEAR', perBranch: false },
  { code: 'EMPLOYEE', label: 'Employee code', module: 'hrms', pattern: 'EMP{SEQ:5}', reset: 'NEVER', perBranch: false, hint: 'One per employee, shared by every campus.' },
  { code: 'REQUISITION', label: 'Vacancy', module: 'hrms', pattern: 'VAC{YY}{SEQ:4}', reset: 'YEAR', perBranch: false },
  { code: 'PAYROLL_RUN', label: 'Payroll run', module: 'payroll', pattern: 'PR{YY}{MM}{SEQ:3}', reset: 'MONTH', perBranch: false },
  { code: 'PAYROLL_LOAN', label: 'Staff loan / advance', module: 'payroll', pattern: 'SL{YY}{SEQ:4}', reset: 'YEAR', perBranch: false },
  { code: 'PAYSLIP', label: 'Payslip', module: 'payroll', pattern: 'PS{YY}{MM}{SEQ:5}', reset: 'MONTH', perBranch: false, hint: 'Dated by the payroll month, not the day it is calculated.' },
  { code: 'LIBRARY_ACCESSION', label: 'Library accession number', module: 'library', pattern: 'LIB{SEQ:6}', reset: 'NEVER', perBranch: true, hint: 'Printed as the barcode on each copy. Keep the numbers already written in your books by importing them.' },
  { code: 'LIBRARY_FINE', label: 'Library fine receipt', module: 'library', pattern: 'LF{YY}{SEQ:5}', reset: 'YEAR', perBranch: true },
  { code: 'OUTPASS', label: 'Hostel outpass', module: 'hostel', pattern: 'OP{YY}{MM}{SEQ:4}', reset: 'MONTH', perBranch: true },
  { code: 'PO', label: 'Purchase order', module: 'inventory', pattern: 'PO{YY}{SEQ:5}', reset: 'YEAR', perBranch: true },
  { code: 'STORE_SALE', label: 'Uniform / book sale', module: 'inventory', pattern: 'SS{YY}{MM}{SEQ:5}', reset: 'MONTH', perBranch: true },
  { code: 'FIN_JOURNAL', label: 'Journal voucher', module: 'finance', pattern: 'JV{FY}{SEQ:5}', reset: 'FY', perBranch: false },
  { code: 'FIN_PAYMENT', label: 'Payment voucher', module: 'finance', pattern: 'PV{FY}{SEQ:5}', reset: 'FY', perBranch: false },
  { code: 'FIN_RECEIPT', label: 'Receipt voucher', module: 'finance', pattern: 'RV{FY}{SEQ:6}', reset: 'FY', perBranch: false },
  { code: 'FIN_CONTRA', label: 'Contra voucher', module: 'finance', pattern: 'CV{FY}{SEQ:4}', reset: 'FY', perBranch: false },
  { code: 'EXPENSE', label: 'Expense', module: 'finance', pattern: 'EXP{FY}{SEQ:5}', reset: 'FY', perBranch: false },
]

export const DOC_TYPE_BY_CODE = Object.fromEntries(DOC_TYPES.map((d) => [d.code, d]))

const pad = (n, w) => String(n).padStart(w, '0')

/** Date parts in a timezone (business dates follow the institution's clock). */
export function dateParts(date = new Date(), timeZone = 'Asia/Kolkata') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map((p) => [p.type, p.value]))
  const fy = Number(parts.month) >= 4 ? Number(parts.year) : Number(parts.year) - 1
  return { YYYY: parts.year, YY: parts.year.slice(2), MM: parts.month, DD: parts.day, FY: `${String(fy % 100).padStart(2, '0')}${String((fy + 1) % 100).padStart(2, '0')}`, FYKEY: `FY${fy}` }
}

/** The counter bucket a number falls into, e.g. '2026-10' for a monthly reset. */
export function periodKey(reset, date, timeZone) {
  const d = dateParts(date, timeZone)
  if (reset === 'YEAR') return d.YYYY
  if (reset === 'FY') return d.FYKEY
  if (reset === 'MONTH') return `${d.YYYY}-${d.MM}`
  if (reset === 'DAY') return `${d.YYYY}-${d.MM}-${d.DD}`
  return 'ALL'
}

export function formatDocNumber(pattern, { seq, date = new Date(), timeZone, branchCode = '' }) {
  const d = dateParts(date, timeZone)
  return pattern
    .replace(/\{SEQ:(\d+)\}/g, (_, w) => pad(seq, Number(w)))
    .replace(/\{SEQ\}/g, String(seq))
    .replace(/\{YYYY\}/g, d.YYYY).replace(/\{YY\}/g, d.YY).replace(/\{MM\}/g, d.MM).replace(/\{DD\}/g, d.DD).replace(/\{FY\}/g, d.FY)
    .replace(/\{BR\}/g, branchCode)
}

/** Pattern must contain a running number and only known tokens. */
export function validatePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return 'Enter a pattern'
  if (pattern.length > 40) return 'Keep it under 40 characters'
  if (!/\{SEQ(:\d+)?\}/.test(pattern)) return 'Include a running number, e.g. {SEQ:5}'
  const unknown = (pattern.match(/\{[^}]*\}/g) || []).filter((t) => !/^\{(SEQ(:\d{1,2})?|YYYY|YY|MM|DD|BR|FY)\}$/.test(t))
  if (unknown.length) return `Unknown token ${unknown[0]}`
  if (!/^[A-Za-z0-9\-/{}:]+$/.test(pattern)) return 'Use letters, digits, - and / only'
  return null
}
