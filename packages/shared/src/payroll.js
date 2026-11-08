// Payroll shared by the API and the web app (ported from the hospital's payroll engine): salary components and the
// declarative rules a structure uses for them, the statutory defaults (PF, ESI, PT, LWF, TDS, gratuity) and the pure
// calculation of one payslip. Money is in paise; every computed line is rounded to whole rupees. Nothing here evaluates
// user text — a rule is one of a few shapes ({ type: 'PCT', of: 'BASIC', pct: 40 }), never a formula.
//
// The statutory numbers are DEFAULTS the institution must check against the current notifications (EPFO, ESIC, the
// state's PT and LWF acts, the Finance Act) before paying real salaries. They are copied into the institution's own
// rules on first use and edited in Payroll › Statutory rules.

export const PAYROLL_RUN_STATUSES = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  CALCULATED: { label: 'Calculated', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
}

/** Which statuses each run action starts from. */
export const PAYROLL_RUN_ACTIONS = {
  calculate: ['DRAFT', 'CALCULATED'],
  reopen: ['CALCULATED'],
  approve: ['CALCULATED'],
  pay: ['APPROVED'],
}

export const PAYROLL_PAY_MODES = [
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'IMPS', label: 'IMPS' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer (within bank)' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
]
export const PAYROLL_PAY_MODE_LABEL = Object.fromEntries(PAYROLL_PAY_MODES.map((m) => [m.value, m.label]))
export const ELECTRONIC_PAY_MODES = ['NEFT', 'RTGS', 'IMPS', 'BANK_TRANSFER']

export const PAY_DAY_BASES = [
  { value: 'CALENDAR', label: 'Calendar days of the month (28–31)' },
  { value: 'FIXED_30', label: 'A fixed 30 days' },
]

export const LOAN_TYPES = [
  { value: 'ADVANCE', label: 'Salary advance' },
  { value: 'LOAN', label: 'Staff loan' },
]
export const LOAN_STATUSES = {
  ACTIVE: { label: 'Being recovered', tone: 'info' },
  CLOSED: { label: 'Closed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

// ───────────────────────────────────────────────────────── components and rules

/**
 * Rule types:
 *   EMPLOYEE   — the basic on the staff member's salary record (BASIC only)
 *   FIXED      — { amount } a monthly amount
 *   PCT        — { of: BASIC | GROSS | CTC, pct } a share of the computed basic, the monthly gross or CTC ÷ 12
 *   BALANCE    — what is left of the monthly gross after the other fixed earnings (one per structure)
 *   STATUTORY  — PF, ESI, PT, LWF, TDS from Statutory rules
 *   LOANS      — the month's instalments of the person's loans and advances
 *   NONE       — (personal override only) leave this component out for them
 */
export const PAY_RULE_TYPES = {
  EMPLOYEE: 'From the salary record',
  FIXED: 'Fixed amount',
  PCT: 'Percentage',
  BALANCE: 'Balance of the gross',
  STATUTORY: 'Statutory',
  LOANS: 'Loan instalments',
  NONE: 'Not paid',
}
export const PCT_BASES = [
  { value: 'BASIC', label: 'of basic' },
  { value: 'GROSS', label: 'of monthly gross' },
  { value: 'CTC', label: 'of CTC ÷ 12' },
]

export const PAY_COMPONENTS = [
  { code: 'BASIC', label: 'Basic', kind: 'EARNING', rules: ['EMPLOYEE', 'PCT', 'FIXED'], pfWage: true, required: true },
  { code: 'DA', label: 'Dearness allowance', kind: 'EARNING', rules: ['PCT', 'FIXED'], pfWage: true },
  { code: 'HRA', label: 'House rent allowance', kind: 'EARNING', rules: ['PCT', 'FIXED'] },
  { code: 'CONVEYANCE', label: 'Conveyance allowance', kind: 'EARNING', rules: ['FIXED', 'PCT'] },
  { code: 'ACADEMIC', label: 'Academic / research allowance', kind: 'EARNING', rules: ['FIXED', 'PCT'], hint: 'Books, journals, courses for teaching staff.' },
  { code: 'DUTY', label: 'Duty allowance', kind: 'EARNING', rules: ['FIXED', 'PCT'], hint: 'Hostel warden, exam, transport in-charge and similar duties.' },
  { code: 'SPECIAL', label: 'Special allowance', kind: 'EARNING', rules: ['BALANCE', 'FIXED', 'PCT'] },
  { code: 'PF', label: 'Provident fund', kind: 'DEDUCTION', rules: ['STATUTORY'] },
  { code: 'ESI', label: 'ESI', kind: 'DEDUCTION', rules: ['STATUTORY'] },
  { code: 'PT', label: 'Professional tax', kind: 'DEDUCTION', rules: ['STATUTORY'] },
  { code: 'LWF', label: 'Labour welfare fund', kind: 'DEDUCTION', rules: ['STATUTORY'] },
  { code: 'TDS', label: 'Income tax (TDS)', kind: 'DEDUCTION', rules: ['STATUTORY'] },
  { code: 'LOAN', label: 'Loan / advance recovery', kind: 'DEDUCTION', rules: ['LOANS'] },
  { code: 'OTHER_DEDUCTION', label: 'Other deduction', kind: 'DEDUCTION', rules: ['FIXED'], hint: 'Staff quarters, mess, ward’s fee concession recovery…' },
]
export const PAY_COMPONENT_BY = Object.fromEntries(PAY_COMPONENTS.map((c) => [c.code, c]))

/** Lines a payslip can carry that are not structure components. */
export const PAY_EXTRA_LINES = {
  ARREARS: { label: 'Arrears', kind: 'EARNING' },
  OTHER_EARNING: { label: 'Other earning', kind: 'EARNING' },
  LEAVE_ENCASHMENT: { label: 'Leave encashment', kind: 'EARNING', fnf: true },
  GRATUITY: { label: 'Gratuity', kind: 'EARNING', fnf: true },
  NOTICE_RECOVERY: { label: 'Notice-period recovery', kind: 'DEDUCTION', fnf: true },
  ADJUSTMENT_DEDUCTION: { label: 'Other deduction', kind: 'DEDUCTION' },
}
/** Manual lines payroll can add to a payslip before approval. */
export const PAY_ADJUSTMENT_CODES = [
  { value: 'ARREARS', label: 'Arrears' },
  { value: 'OTHER_EARNING', label: 'Other earning (extra classes, exam duty, bonus…)' },
  { value: 'ADJUSTMENT_DEDUCTION', label: 'Other deduction' },
]
export const lineLabel = (code) => PAY_COMPONENT_BY[code]?.label ?? PAY_EXTRA_LINES[code]?.label ?? code

export const EMPLOYER_LINES = {
  EPF_ER: 'Employer PF (EPF)',
  EPS_ER: 'Employer pension (EPS)',
  EDLI: 'EDLI',
  PF_ADMIN: 'PF admin charges',
  ESI_ER: 'Employer ESI',
  LWF_ER: 'Employer LWF',
}

const inr = (p) => {
  const n = String(Math.abs(Math.round((p ?? 0) / 100)))
  const head = n.slice(0, -3)
  return `₹${head ? `${head.replace(/\B(?=(\d{2})+$)/g, ',')},` : ''}${n.slice(-3)}`
}

/** "40% of basic", "₹1,600", "Balance of the gross"… */
export function ruleText(rule, money = inr) {
  if (!rule) return '—'
  if (rule.type === 'FIXED') return money(rule.amount ?? 0)
  if (rule.type === 'PCT') return `${rule.pct}% ${PCT_BASES.find((b) => b.value === rule.of)?.label ?? ''}`.trim()
  return PAY_RULE_TYPES[rule.type] ?? rule.type
}

/** A structure's components are valid (null) or the first problem. */
export function structureProblem(components = []) {
  const codes = components.map((c) => c.code)
  if (new Set(codes).size !== codes.length) return 'A component appears twice.'
  if (!codes.includes('BASIC')) return 'A structure needs a basic.'
  if (components.filter((c) => c.rule?.type === 'BALANCE').length > 1) return 'Only one component can take the balance of the gross.'
  for (const c of components) {
    const def = PAY_COMPONENT_BY[c.code]
    if (!def) return `Unknown component ${c.code}.`
    if (!def.rules.includes(c.rule?.type)) return `${def.label} cannot be “${PAY_RULE_TYPES[c.rule?.type] ?? c.rule?.type}”.`
    if (c.rule.type === 'PCT' && c.code === 'BASIC' && c.rule.of === 'BASIC') return 'Basic cannot be a share of itself.'
    if (c.rule.type === 'PCT' && !(c.rule.pct > 0 && c.rule.pct <= 100)) return `Give ${def.label} a percentage between 0 and 100.`
    if (c.rule.type === 'FIXED' && !(c.rule.amount >= 0)) return `Give ${def.label} an amount.`
  }
  return null
}

/** Structures an institution starts with (Payroll › Salary structures can change them). */
export const STARTER_STRUCTURES = [
  {
    code: 'TEACHING', name: 'Teaching staff', categories: ['TEACHING'],
    components: [
      { code: 'BASIC', rule: { type: 'PCT', of: 'GROSS', pct: 50 } }, { code: 'HRA', rule: { type: 'PCT', of: 'BASIC', pct: 40 } },
      { code: 'CONVEYANCE', rule: { type: 'FIXED', amount: 160000 } }, { code: 'SPECIAL', rule: { type: 'BALANCE' } },
      { code: 'PF', rule: { type: 'STATUTORY' } }, { code: 'ESI', rule: { type: 'STATUTORY' } }, { code: 'PT', rule: { type: 'STATUTORY' } },
      { code: 'TDS', rule: { type: 'STATUTORY' } }, { code: 'LOAN', rule: { type: 'LOANS' } },
    ],
  },
  {
    code: 'STAFF', name: 'Office and support staff', categories: ['ADMIN', 'SUPPORT', 'TRANSPORT', 'SECURITY', 'OTHER'],
    components: [
      { code: 'BASIC', rule: { type: 'PCT', of: 'GROSS', pct: 60 } }, { code: 'HRA', rule: { type: 'PCT', of: 'BASIC', pct: 20 } },
      { code: 'SPECIAL', rule: { type: 'BALANCE' } },
      { code: 'PF', rule: { type: 'STATUTORY' } }, { code: 'ESI', rule: { type: 'STATUTORY' } }, { code: 'PT', rule: { type: 'STATUTORY' } },
      { code: 'LWF', rule: { type: 'STATUTORY' } }, { code: 'LOAN', rule: { type: 'LOANS' } },
    ],
  },
]

// ───────────────────────────────────────────────────────── statutory defaults

const R = (rupees) => Math.round(rupees * 100) // rupees → paise

/** Professional tax by state. `from` = monthly gross (paise) at and above which the amount applies. */
export const DEFAULT_PT_STATES = [
  { code: 'KA', name: 'Karnataka', period: 'MONTH', slabs: [{ from: 0, amount: 0 }, { from: R(25000), amount: R(200), febAmount: R(300) }] },
  {
    code: 'MH', name: 'Maharashtra', period: 'MONTH',
    slabs: [{ from: 0, amount: 0 }, { from: R(7501), amount: R(175) }, { from: R(10001), amount: R(200), febAmount: R(300) }],
    femaleSlabs: [{ from: 0, amount: 0 }, { from: R(25001), amount: R(200), febAmount: R(300) }],
  },
  {
    code: 'TN', name: 'Tamil Nadu', period: 'HALF_YEAR', months: [9, 3], // half-year income = monthly gross × 6
    slabs: [{ from: 0, amount: 0 }, { from: R(21001), amount: R(180) }, { from: R(30001), amount: R(425) }, { from: R(45001), amount: R(930) }, { from: R(60001), amount: R(1025) }, { from: R(75001), amount: R(1250) }],
  },
  { code: 'WB', name: 'West Bengal', period: 'MONTH', slabs: [{ from: 0, amount: 0 }, { from: R(10001), amount: R(110) }, { from: R(15001), amount: R(130) }, { from: R(25001), amount: R(150) }, { from: R(40001), amount: R(200) }] },
  { code: 'TG', name: 'Telangana', period: 'MONTH', slabs: [{ from: 0, amount: 0 }, { from: R(15001), amount: R(150) }, { from: R(20001), amount: R(200) }] },
  { code: 'AP', name: 'Andhra Pradesh', period: 'MONTH', slabs: [{ from: 0, amount: 0 }, { from: R(15001), amount: R(150) }, { from: R(20001), amount: R(200) }] },
  { code: 'GJ', name: 'Gujarat', period: 'MONTH', slabs: [{ from: 0, amount: 0 }, { from: R(12000), amount: R(200) }] },
]

/** Labour welfare fund: deducted in `months` (6 = June, 12 = December). */
export const DEFAULT_LWF_STATES = [
  { code: 'KA', name: 'Karnataka', months: [12], employee: R(50), employer: R(100) },
  { code: 'MH', name: 'Maharashtra', months: [6, 12], employee: R(25), employer: R(75) },
  { code: 'TN', name: 'Tamil Nadu', months: [12], employee: R(20), employer: R(40) },
  { code: 'WB', name: 'West Bengal', months: [6, 12], employee: R(3), employer: R(15) },
  { code: 'TG', name: 'Telangana', months: [12], employee: R(2), employer: R(5) },
  { code: 'AP', name: 'Andhra Pradesh', months: [12], employee: R(30), employer: R(70) },
  { code: 'GJ', name: 'Gujarat', months: [6, 12], employee: R(6), employer: R(12) },
]

/** Everything payroll reads from Statutory rules. Copied into the institution's own rules on first use. */
export const DEFAULT_PAYROLL_STATUTORY = {
  pf: { employeePct: 12, employerPct: 12, epsPct: 8.33, edliPct: 0.5, adminPct: 0.5, wageCeiling: R(15000), restrictToCeiling: true },
  esi: { employeePct: 0.75, employerPct: 3.25, grossCeiling: R(21000) },
  pt: { defaultState: 'KA', states: DEFAULT_PT_STATES },
  lwf: { states: DEFAULT_LWF_STATES },
  tds: {
    regime: 'NEW', financialYear: '2026-27', standardDeduction: R(75000),
    slabs: [{ upTo: R(400000), pct: 0 }, { upTo: R(800000), pct: 5 }, { upTo: R(1200000), pct: 10 }, { upTo: R(1600000), pct: 15 }, { upTo: R(2000000), pct: 20 }, { upTo: R(2400000), pct: 25 }, { upTo: null, pct: 30 }],
    rebateUpTo: R(1200000), rebateMax: R(60000), marginalRelief: true, cessPct: 4,
    surcharge: [{ above: R(5000000), pct: 10 }, { above: R(10000000), pct: 15 }, { above: R(20000000), pct: 25 }],
  },
  gratuity: { minYears: 5, factor: 15, divisor: 26, cap: R(2000000) },
  encashment: { leaveCodes: ['EL'], divisor: 30 },
  notice: { days: 30 },
  payDayBasis: 'CALENDAR',
  separateDuties: true,
}
export const STATUTORY_SECTIONS = ['pf', 'esi', 'pt', 'lwf', 'tds', 'gratuity', 'encashment', 'notice']

// ───────────────────────────────────────────────────────── calculation (pure)

/** Round paise to whole rupees. */
const rupee = (p) => Math.round(Number(p || 0) / 100) * 100
export const roundToRupee = rupee
const ceilRupee = (p) => Math.ceil(Math.round(Number(p || 0)) / 100) * 100
export const monthDayCount = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
export const monthEndOf = (ym) => `${ym}-${String(monthDayCount(ym)).padStart(2, '0')}`
const monthNumber = (ym) => Number(ym.slice(5, 7))
/** Financial year (April–March) a month falls in: '2026-10' → { start: '2026-04', end: '2027-03', label: '2026-27' }. */
export function payrollYearOf(ym) {
  const [y, m] = ym.split('-').map(Number)
  const s = m >= 4 ? y : y - 1
  return { start: `${s}-04`, end: `${s + 1}-03`, label: `${s}-${String((s + 1) % 100).padStart(2, '0')}` }
}
/** ESI contribution period: April–September or October–March. */
export function esiPeriodOf(ym) {
  const [y, m] = ym.split('-').map(Number)
  if (m >= 4 && m <= 9) return { start: `${y}-04`, end: `${y}-09` }
  return m >= 10 ? { start: `${y}-10`, end: `${y + 1}-03` } : { start: `${y - 1}-10`, end: `${y}-03` }
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const payrollMonthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}` }
/** Days from one date to another, both counted ('2026-11-01' → '2026-11-30' = 30). */
export const daysInclusive = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1

/** Full-month amounts of the structure's fixed earnings, in order. */
export function fixedEarnings(components, { gross = 0, basic = 0, ctcAnnual = 0 }) {
  const fixed = components.filter((c) => PAY_COMPONENT_BY[c.code]?.kind === 'EARNING' && c.rule?.type !== 'NONE')
  const base = { GROSS: gross, CTC: Math.round(ctcAnnual / 12) }
  const amountOf = (rule, basicFull) => {
    if (rule.type === 'FIXED') return rupee(rule.amount)
    if (rule.type === 'EMPLOYEE') return rupee(basic || gross / 2)
    if (rule.type === 'PCT') return rupee(((rule.of === 'BASIC' ? basicFull : base[rule.of] ?? 0) * rule.pct) / 100)
    return 0
  }
  const b = fixed.find((c) => c.code === 'BASIC')
  const basicFull = b ? amountOf(b.rule, 0) : 0
  const out = fixed.map((c) => ({ code: c.code, full: c.code === 'BASIC' ? basicFull : c.rule.type === 'BALANCE' ? 0 : amountOf(c.rule, basicFull) }))
  const bal = out.find((x) => fixed.find((c) => c.code === x.code).rule.type === 'BALANCE')
  if (bal) bal.full = Math.max(0, rupee(gross - out.reduce((s, x) => s + x.full, 0)))
  return out
}

/** Professional tax for a month on `wages` (the month's gross). */
export function professionalTax(state, wages, { month, gender } = {}) {
  if (!state) return 0
  const slabs = gender === 'FEMALE' && state.femaleSlabs?.length ? state.femaleSlabs : state.slabs
  const m = monthNumber(month)
  let basis = wages
  if (state.period === 'HALF_YEAR') {
    if (!(state.months ?? []).includes(m)) return 0
    basis = wages * 6
  }
  const slab = [...(slabs ?? [])].sort((a, b) => a.from - b.from).filter((s) => basis >= s.from).pop()
  if (!slab) return 0
  return m === 2 && slab.febAmount ? slab.febAmount : slab.amount
}

/** Income tax for a year's income under the configured regime (paise, whole rupees). */
export function annualIncomeTax(annualIncome, tds) {
  const taxable = Math.max(0, annualIncome - (tds.standardDeduction ?? 0))
  let tax = 0
  let lower = 0
  for (const s of tds.slabs ?? []) {
    const upper = s.upTo ?? Infinity
    if (taxable > lower) tax += ((Math.min(taxable, upper) - lower) * s.pct) / 100
    lower = upper
    if (taxable <= upper) break
  }
  if (tds.rebateUpTo && taxable <= tds.rebateUpTo) tax = Math.max(0, tax - (tds.rebateMax ?? tax))
  else if (tds.rebateUpTo && tds.marginalRelief) tax = Math.min(tax, taxable - tds.rebateUpTo)
  const sur = [...(tds.surcharge ?? [])].sort((a, b) => a.above - b.above).filter((s) => taxable > s.above).pop()
  const surcharge = sur ? (tax * sur.pct) / 100 : 0
  const total = (tax + surcharge) * (1 + (tds.cessPct ?? 0) / 100)
  return { taxable, tax: rupee(tax), surcharge: rupee(surcharge), total: rupee(total) }
}

/** Completed years of service, a fraction above six months counting as a year (Payment of Gratuity Act). */
export function serviceYears(joiningDate, lastDate) {
  if (!joiningDate || !lastDate) return { years: 0, months: 0, counted: 0, exact: 0 }
  const [y1, m1, d1] = joiningDate.split('-').map(Number)
  const [y2, m2, d2] = lastDate.split('-').map(Number)
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
  if (months < 0) months = 0
  const years = Math.floor(months / 12)
  const rest = months % 12
  const moreThanSix = rest > 6 || (rest === 6 && d2 > d1)
  return { years, months: rest, counted: years + (moreThanSix ? 1 : 0), exact: months / 12 }
}

/** Gratuity on exit: factor/divisor × last (basic + DA) × counted years, from `minYears` (waived on death). */
export function gratuityFor({ joiningDate, lastWorkingDate, basicDaMonthly, exitType }, g) {
  const s = serviceYears(joiningDate, lastWorkingDate)
  const eligible = s.exact >= g.minYears || exitType === 'DECEASED'
  if (!eligible || !(basicDaMonthly > 0)) return { amount: 0, eligible: false, ...s }
  const amount = Math.min(rupee((g.factor * basicDaMonthly * s.counted) / g.divisor), g.cap ?? Infinity)
  return { amount, eligible: true, ...s }
}

/**
 * One person's pay for a month. Inputs:
 *   month 'YYYY-MM' · employee { gross, basic, ctcAnnual, pf, pt, gender } · components (structure + overrides)
 *   stat (statutory rules) · ptState / lwfState (the state's entries)
 *   attendance { lop, notEmployedDays }
 *   extras { arrears[{month,amount}], adjustments[{code,label,amount}], loans[{loanId,amount,label}],
 *            fnf {leaveEncashment, gratuity, noticeRecovery}, tdsMonthly (override), esiContinuing }
 */
export function computePayslip({ month, employee, components, stat, ptState, lwfState, attendance = {}, extras = {} }) {
  const has = (code) => components.some((c) => c.code === code && c.rule?.type !== 'NONE')
  const dim = monthDayCount(month)
  const baseDays = stat.payDayBasis === 'FIXED_30' ? 30 : dim
  const lop = Math.max(0, Number(attendance.lop || 0))
  const notEmployed = Math.max(0, Number(attendance.notEmployedDays || 0))
  const payDays = Math.max(0, Math.min(baseDays, baseDays - notEmployed - lop))
  const factor = baseDays ? payDays / baseDays : 0
  const warnings = []
  const num = (p) => String(Math.round(p / 100))

  // fixed earnings, prorated by the days paid
  const fixed = fixedEarnings(components, employee)
  const earnings = fixed.map((f) => ({ code: f.code, label: lineLabel(f.code), full: f.full, amount: rupee(f.full * factor) }))
  const fixedEarned = earnings.reduce((s, e) => s + e.amount, 0)
  const fixedFull = fixed.reduce((s, f) => s + f.full, 0)

  for (const a of extras.arrears ?? []) if (a.amount) earnings.push({ code: 'ARREARS', label: `Arrears ${payrollMonthLabel(a.month)}`, amount: rupee(a.amount), month: a.month })
  const fnf = extras.fnf ?? {}
  if (fnf.leaveEncashment > 0) earnings.push({ code: 'LEAVE_ENCASHMENT', label: lineLabel('LEAVE_ENCASHMENT'), amount: rupee(fnf.leaveEncashment), basis: fnf.encashmentBasis })
  if (fnf.gratuity > 0) earnings.push({ code: 'GRATUITY', label: lineLabel('GRATUITY'), amount: rupee(fnf.gratuity), basis: fnf.gratuityBasis })
  for (const a of extras.adjustments ?? []) if (PAY_EXTRA_LINES[a.code]?.kind === 'EARNING' && a.amount) earnings.push({ code: a.code, label: a.label || lineLabel(a.code), amount: rupee(a.amount), note: a.note, manual: true })
  const gross = earnings.reduce((s, e) => s + e.amount, 0)
  const fnfEarnings = (fnf.leaveEncashment > 0 ? rupee(fnf.leaveEncashment) : 0) + (fnf.gratuity > 0 ? rupee(fnf.gratuity) : 0)
  const salaryGross = gross - fnfEarnings // what PT and ESI are on

  const deductions = []
  const employer = []
  // provident fund on basic + DA earned
  const pfWages = earnings.filter((e) => PAY_COMPONENT_BY[e.code]?.pfWage).reduce((s, e) => s + e.amount, 0)
  if (has('PF') && employee.pf !== false && pfWages > 0) {
    const p = stat.pf
    const ceilingWages = Math.min(pfWages, p.wageCeiling)
    const wages = p.restrictToCeiling ? ceilingWages : pfWages
    const ee = rupee((wages * p.employeePct) / 100)
    const eps = rupee((ceilingWages * p.epsPct) / 100)
    const er = rupee((wages * p.employerPct) / 100)
    deductions.push({ code: 'PF', label: lineLabel('PF'), amount: ee, basis: `${p.employeePct}% of ${num(wages)}` })
    employer.push({ code: 'EPF_ER', label: EMPLOYER_LINES.EPF_ER, amount: Math.max(0, er - eps) }, { code: 'EPS_ER', label: EMPLOYER_LINES.EPS_ER, amount: eps })
    if (p.edliPct) employer.push({ code: 'EDLI', label: EMPLOYER_LINES.EDLI, amount: rupee((ceilingWages * p.edliPct) / 100) })
    if (p.adminPct) employer.push({ code: 'PF_ADMIN', label: EMPLOYER_LINES.PF_ADMIN, amount: rupee((wages * p.adminPct) / 100) })
  }
  // ESI: covered when the monthly gross is within the ceiling (or already covered in this contribution period)
  let esiWages = 0
  const esiCovered = has('ESI') && (fixedFull <= stat.esi.grossCeiling || !!extras.esiContinuing)
  if (esiCovered && salaryGross > 0) {
    esiWages = salaryGross
    deductions.push({ code: 'ESI', label: lineLabel('ESI'), amount: ceilRupee((esiWages * stat.esi.employeePct) / 100), basis: `${stat.esi.employeePct}% of ${num(esiWages)}` })
    employer.push({ code: 'ESI_ER', label: EMPLOYER_LINES.ESI_ER, amount: ceilRupee((esiWages * stat.esi.employerPct) / 100) })
  }
  // professional tax
  if (has('PT') && employee.pt !== false && ptState) {
    const pt = professionalTax(ptState, salaryGross, { month, gender: employee.gender })
    if (pt > 0) deductions.push({ code: 'PT', label: lineLabel('PT'), amount: pt, basis: ptState.name })
  }
  // labour welfare fund
  if (has('LWF') && lwfState && (lwfState.months ?? []).includes(monthNumber(month)) && payDays > 0) {
    deductions.push({ code: 'LWF', label: lineLabel('LWF'), amount: lwfState.employee, basis: lwfState.name })
    employer.push({ code: 'LWF_ER', label: EMPLOYER_LINES.LWF_ER, amount: lwfState.employer })
  }
  // income tax: the year's tax on the projected annual salary ÷ 12, unless set for the person
  let tdsInfo = null
  if (has('TDS')) {
    const set = extras.tdsMonthly !== null && extras.tdsMonthly !== undefined
    let tds
    if (set) tds = rupee(extras.tdsMonthly)
    else {
      tdsInfo = annualIncomeTax(fixedFull * 12, stat.tds)
      tds = payDays > 0 ? rupee(tdsInfo.total / 12) : 0
    }
    if (tds > 0) deductions.push({ code: 'TDS', label: lineLabel('TDS'), amount: tds, basis: set ? 'Set for this person' : `Projected tax ${num(tdsInfo.total)} ÷ 12` })
  }
  if (has('OTHER_DEDUCTION')) {
    const c = components.find((x) => x.code === 'OTHER_DEDUCTION')
    if (c.rule.type === 'FIXED' && c.rule.amount > 0) deductions.push({ code: 'OTHER_DEDUCTION', label: lineLabel('OTHER_DEDUCTION'), amount: rupee(c.rule.amount) })
  }
  if (fnf.noticeRecovery > 0) deductions.push({ code: 'NOTICE_RECOVERY', label: lineLabel('NOTICE_RECOVERY'), amount: rupee(fnf.noticeRecovery), basis: fnf.noticeBasis })
  for (const a of extras.adjustments ?? []) if (PAY_EXTRA_LINES[a.code]?.kind === 'DEDUCTION' && a.amount) deductions.push({ code: a.code, label: a.label || lineLabel(a.code), amount: rupee(a.amount), note: a.note, manual: true })
  // loans last, and never more than what is left to pay
  const loans = []
  if (has('LOAN')) {
    let room = gross - deductions.reduce((s, d) => s + d.amount, 0)
    for (const l of extras.loans ?? []) {
      const amt = Math.max(0, Math.min(rupee(l.amount), room))
      if (amt < l.amount) warnings.push(`Only ${num(amt)} of the ${l.label ?? 'loan'} instalment fits in this month’s pay.`)
      if (amt > 0) { loans.push({ loanId: l.loanId, amount: amt, label: l.label }); room -= amt }
    }
    const total = loans.reduce((s, l) => s + l.amount, 0)
    if (total > 0) deductions.push({ code: 'LOAN', label: lineLabel('LOAN'), amount: total, basis: loans.map((l) => l.label).filter(Boolean).join(', ') })
  }
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0)
  let net = gross - totalDeductions
  if (net < 0) { warnings.push('Deductions are more than the earnings: net pay is shown as zero.'); net = 0 }
  if (payDays === 0 && !fnfEarnings) warnings.push('No paid days this month.')
  const employerTotal = employer.reduce((s, x) => s + x.amount, 0)
  return {
    baseDays, daysInMonth: dim, payDays, factor,
    earnings, deductions, employer, loans,
    gross, totalDeductions, net, employerContribution: employerTotal, employerCost: gross + employerTotal,
    fixedFull, fixedEarned, pfWages, esiWages, salaryGross, tds: tdsInfo, warnings,
  }
}

/** The total of the lines with a code: lineAmount(payslip.deductions, 'PF'). */
export const lineAmount = (lines, code) => (lines ?? []).filter((l) => l.code === code).reduce((s, l) => s + (l.amount ?? 0), 0)
