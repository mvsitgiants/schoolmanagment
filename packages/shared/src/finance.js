// Accounts (module `finance`, ported from the hospital ledger): the chart of accounts a school starts with, voucher
// types, the business events that post to the ledger, expenses and the Indian financial year (1 April – 31 March).
// Money is integer paise throughout. Fees are accounted when received (cash basis), as most schools keep books.

export const ACCOUNT_TYPES = [
  { value: 'ASSET', label: 'Asset', normal: 'DR' },
  { value: 'LIABILITY', label: 'Liability', normal: 'CR' },
  { value: 'EQUITY', label: 'Funds & reserves', normal: 'CR' },
  { value: 'INCOME', label: 'Income', normal: 'CR' },
  { value: 'EXPENSE', label: 'Expenditure', normal: 'DR' },
]
export const ACCOUNT_TYPE_LABEL = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t.label]))
export const NORMAL_SIDE = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t.normal]))

/**
 * The starter chart. `key` marks a system account: auto-posting finds it by that key, so it can be renamed or
 * renumbered but never deleted. `group: true` accounts only hold others. `expense: true` ledgers are offered as
 * expense heads.
 */
export const STARTER_ACCOUNTS = [
  { code: '1000', name: 'Assets', type: 'ASSET', group: true, key: 'G_ASSETS' },
  { code: '1100', name: 'Current assets', type: 'ASSET', group: true, parent: '1000', key: 'G_CURRENT_ASSETS' },
  { code: '1110', name: 'Cash in hand', type: 'ASSET', parent: '1100', key: 'CASH', cashBank: true },
  { code: '1120', name: 'Bank accounts', type: 'ASSET', group: true, parent: '1100', key: 'G_BANK' },
  { code: '1121', name: 'Main bank account', type: 'ASSET', parent: '1120', key: 'BANK', cashBank: true },
  { code: '1130', name: 'Payment gateway in transit', type: 'ASSET', parent: '1100', key: 'GATEWAY', hint: 'Online fee payments not yet settled to the bank.' },
  { code: '1140', name: 'Staff loans & advances', type: 'ASSET', parent: '1100', key: 'STAFF_ADVANCES' },
  { code: '1150', name: 'TDS receivable', type: 'ASSET', parent: '1100', key: 'TDS_RECEIVABLE' },
  { code: '1160', name: 'GST input credit', type: 'ASSET', parent: '1100', key: 'GST_INPUT' },
  { code: '1170', name: 'Advances to suppliers', type: 'ASSET', parent: '1100' },
  { code: '1180', name: 'Deposits & prepaid expenses', type: 'ASSET', parent: '1100' },
  { code: '1200', name: 'Fixed assets', type: 'ASSET', group: true, parent: '1000', key: 'G_FIXED_ASSETS' },
  { code: '1210', name: 'Land & buildings', type: 'ASSET', parent: '1200' },
  { code: '1220', name: 'Furniture & fixtures', type: 'ASSET', parent: '1200' },
  { code: '1230', name: 'Computers & smart classrooms', type: 'ASSET', parent: '1200' },
  { code: '1240', name: 'Laboratory equipment', type: 'ASSET', parent: '1200' },
  { code: '1250', name: 'Vehicles (school buses)', type: 'ASSET', parent: '1200' },
  { code: '1260', name: 'Library books', type: 'ASSET', parent: '1200' },
  { code: '1270', name: 'Sports equipment', type: 'ASSET', parent: '1200' },

  { code: '2000', name: 'Liabilities', type: 'LIABILITY', group: true, key: 'G_LIABILITIES' },
  { code: '2100', name: 'Current liabilities', type: 'LIABILITY', group: true, parent: '2000', key: 'G_CURRENT_LIABILITIES' },
  { code: '2110', name: 'Caution deposits (refundable)', type: 'LIABILITY', parent: '2100', key: 'CAUTION_DEPOSITS' },
  { code: '2120', name: 'Fees received in advance', type: 'LIABILITY', parent: '2100', key: 'FEE_ADVANCES' },
  { code: '2130', name: 'Expenses payable', type: 'LIABILITY', parent: '2100', key: 'EXPENSES_PAYABLE' },
  { code: '2140', name: 'TDS payable', type: 'LIABILITY', parent: '2100', key: 'TDS_PAYABLE' },
  { code: '2150', name: 'Salaries payable', type: 'LIABILITY', parent: '2100', key: 'SALARY_PAYABLE' },
  { code: '2160', name: 'PF payable', type: 'LIABILITY', parent: '2100', key: 'PF_PAYABLE' },
  { code: '2170', name: 'ESI payable', type: 'LIABILITY', parent: '2100', key: 'ESI_PAYABLE' },
  { code: '2180', name: 'Professional tax payable', type: 'LIABILITY', parent: '2100', key: 'PT_PAYABLE' },
  { code: '2185', name: 'Labour welfare fund payable', type: 'LIABILITY', parent: '2100', key: 'LWF_PAYABLE' },
  { code: '2190', name: 'GST payable', type: 'LIABILITY', parent: '2100', key: 'GST_OUTPUT' },
  { code: '2200', name: 'Loans', type: 'LIABILITY', group: true, parent: '2000' },
  { code: '2210', name: 'Bank loans (buses, buildings)', type: 'LIABILITY', parent: '2200' },

  { code: '3000', name: 'Funds & reserves', type: 'EQUITY', group: true, key: 'G_EQUITY' },
  { code: '3100', name: 'Corpus / capital fund', type: 'EQUITY', parent: '3000', key: 'CAPITAL' },
  { code: '3200', name: 'Accumulated surplus', type: 'EQUITY', parent: '3000', key: 'RETAINED' },
  { code: '3300', name: 'Opening balance adjustment', type: 'EQUITY', parent: '3000', key: 'OPENING' },

  { code: '4000', name: 'Income', type: 'INCOME', group: true, key: 'G_INCOME' },
  { code: '4100', name: 'Fee income', type: 'INCOME', group: true, parent: '4000', key: 'G_FEE_INCOME' },
  { code: '4110', name: 'Tuition fees', type: 'INCOME', parent: '4100', key: 'INC_TUITION' },
  { code: '4120', name: 'Admission fees', type: 'INCOME', parent: '4100', key: 'INC_ADMISSION' },
  { code: '4130', name: 'Annual & development charges', type: 'INCOME', parent: '4100', key: 'INC_ANNUAL' },
  { code: '4140', name: 'Examination fees', type: 'INCOME', parent: '4100', key: 'INC_EXAM' },
  { code: '4150', name: 'Transport fees', type: 'INCOME', parent: '4100', key: 'INC_TRANSPORT' },
  { code: '4160', name: 'Hostel fees', type: 'INCOME', parent: '4100', key: 'INC_HOSTEL' },
  { code: '4170', name: 'Lab, library & activity fees', type: 'INCOME', parent: '4100', key: 'INC_ACTIVITY' },
  { code: '4180', name: 'Late fees & fines', type: 'INCOME', parent: '4100', key: 'INC_LATE_FEE' },
  { code: '4190', name: 'Other fees', type: 'INCOME', parent: '4100', key: 'INC_OTHER_FEES' },
  { code: '4195', name: 'Fee refunds', type: 'INCOME', parent: '4100', key: 'FEE_REFUNDS', hint: 'Debited when fees are given back.' },
  { code: '4200', name: 'Other income', type: 'INCOME', group: true, parent: '4000' },
  { code: '4210', name: 'Donations & grants', type: 'INCOME', parent: '4200', key: 'INC_DONATIONS' },
  { code: '4220', name: 'Interest income', type: 'INCOME', parent: '4200' },
  { code: '4230', name: 'Uniform & book sales', type: 'INCOME', parent: '4200' },
  { code: '4240', name: 'Staff recoveries', type: 'INCOME', parent: '4200', key: 'STAFF_RECOVERIES' },
  { code: '4290', name: 'Round off', type: 'INCOME', parent: '4200', key: 'ROUND_OFF' },

  { code: '5000', name: 'Expenditure', type: 'EXPENSE', group: true, key: 'G_EXPENSES' },
  { code: '5100', name: 'Staff costs', type: 'EXPENSE', group: true, parent: '5000' },
  { code: '5110', name: 'Salaries & wages', type: 'EXPENSE', parent: '5100', key: 'SALARIES' },
  { code: '5120', name: 'Employer PF, ESI & LWF', type: 'EXPENSE', parent: '5100', key: 'EMPLOYER_CONTRIB' },
  { code: '5130', name: 'Staff welfare & training', type: 'EXPENSE', parent: '5100', expense: true },
  { code: '5200', name: 'Academic expenses', type: 'EXPENSE', group: true, parent: '5000' },
  { code: '5210', name: 'Books, stationery & printing', type: 'EXPENSE', parent: '5200', expense: true },
  { code: '5220', name: 'Laboratory consumables', type: 'EXPENSE', parent: '5200', expense: true },
  { code: '5230', name: 'Examination expenses', type: 'EXPENSE', parent: '5200', expense: true },
  { code: '5240', name: 'Events, sports & co-curricular', type: 'EXPENSE', parent: '5200', expense: true },
  { code: '5250', name: 'Scholarships & fee waivers', type: 'EXPENSE', parent: '5200', expense: true },
  { code: '5300', name: 'Transport expenses', type: 'EXPENSE', group: true, parent: '5000' },
  { code: '5310', name: 'Fuel', type: 'EXPENSE', parent: '5300', expense: true },
  { code: '5320', name: 'Vehicle repairs, insurance & permits', type: 'EXPENSE', parent: '5300', expense: true },
  { code: '5400', name: 'Administrative expenses', type: 'EXPENSE', group: true, parent: '5000' },
  { code: '5410', name: 'Rent', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5420', name: 'Electricity & water', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5430', name: 'Repairs & maintenance', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5440', name: 'Housekeeping & security services', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5450', name: 'Telephone & internet', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5460', name: 'Software & subscriptions', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5470', name: 'Advertising & admissions', type: 'EXPENSE', parent: '5400', expense: true },
  { code: '5480', name: 'Bank & payment gateway charges', type: 'EXPENSE', parent: '5400', key: 'BANK_CHARGES', expense: true },
  { code: '5490', name: 'Miscellaneous expenses', type: 'EXPENSE', parent: '5400', key: 'MISC_EXPENSE', expense: true },
]

/** Which income ledger a fee head goes to when nobody has said: by its code first, then its name. */
export function incomeKeyForHead(head) {
  if (head?.refundable) return 'CAUTION_DEPOSITS'
  const s = `${head?.code ?? ''} ${head?.name ?? ''}`.toUpperCase()
  if (/TUITION/.test(s)) return 'INC_TUITION'
  if (/ADMISSION|REGISTRATION/.test(s)) return 'INC_ADMISSION'
  if (/ANNUAL|DEVELOPMENT|BUILDING/.test(s)) return 'INC_ANNUAL'
  if (/EXAM/.test(s)) return 'INC_EXAM'
  if (/TRANSPORT|BUS|VAN/.test(s)) return 'INC_TRANSPORT'
  if (/HOSTEL|MESS|BOARDING/.test(s)) return 'INC_HOSTEL'
  if (/LAB|LIBRARY|SPORT|ACTIVIT|COMPUTER/.test(s)) return 'INC_ACTIVITY'
  if (/LATE|FINE/.test(s)) return 'INC_LATE_FEE'
  return 'INC_OTHER_FEES'
}

/** Voucher types: the number series each is numbered from (Administration › Number series). */
export const VOUCHER_TYPES = [
  { value: 'JOURNAL', label: 'Journal', docType: 'FIN_JOURNAL', manual: true },
  { value: 'RECEIPT', label: 'Receipt', docType: 'FIN_RECEIPT', manual: true },
  { value: 'PAYMENT', label: 'Payment', docType: 'FIN_PAYMENT', manual: true },
  { value: 'CONTRA', label: 'Contra', docType: 'FIN_CONTRA', manual: true, hint: 'Cash ↔ bank, bank ↔ bank.' },
]
export const VOUCHER_TYPE_BY = Object.fromEntries(VOUCHER_TYPES.map((t) => [t.value, t]))

export const JOURNAL_STATUSES = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  POSTED: { label: 'Posted', tone: 'success' },
}

/** Business events that post on their own. */
export const POSTING_SOURCES = {
  FEE_RECEIPT: { label: 'Fee receipt', module: 'fees' },
  FEE_REFUND: { label: 'Fee refund', module: 'fees' },
  PAYROLL_RUN: { label: 'Payroll', module: 'payroll' },
  EXPENSE: { label: 'Expense', module: 'finance' },
  LIBRARY_FINE: { label: 'Library fine', module: 'library' },
  MANUAL: { label: 'Manual', module: 'finance' },
}

/** Payment modes that move cash; ONLINE lands in the gateway account (or the bank); everything else the bank. */
export const CASH_MODES = ['CASH']

// ───────────────────────────────────────────────────────── expenses

export const EXPENSE_STATUSES = {
  SUBMITTED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved, to pay', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}
export const EXPENSE_PAY_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer (NEFT / IMPS / UPI)' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
]
export const TDS_SECTIONS = [
  { value: '194C', label: '194C — contractors (transport, housekeeping, printing)', pct: 2 },
  { value: '194J', label: '194J — professional / technical fees', pct: 10 },
  { value: '194I', label: '194I — rent', pct: 10 },
  { value: '194H', label: '194H — commission', pct: 2 },
]

// ───────────────────────────────────────────────────────── financial year (India)

/** '2026-10-08' → '2026-27' (the year runs 1 April – 31 March). */
export function fyOf(ymd) {
  const y = Number(String(ymd).slice(0, 4))
  const m = Number(String(ymd).slice(5, 7))
  const start = m >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
/** '2026-27' → { from: '2026-04-01', to: '2027-03-31' } */
export function fyRange(fy) {
  const start = Number(String(fy).slice(0, 4))
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` }
}
