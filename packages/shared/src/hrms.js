// Staff & HR: the lists and rules shared by the API and the web app.
// A staff record (Employee) is the person on the payroll: teachers, office staff, drivers, ayahs, guards — with or
// without a sign-in. Teachers who sign in are linked to their login (userId), so their timetable, classes and leave
// meet in one place. Staff attendance is one row a day per person; leave is counted on a ledger
// (balance = Σ days), as payroll will read it.

export const EMPLOYEE_CATEGORIES = [
  { value: 'TEACHING', label: 'Teaching' },
  { value: 'ADMIN', label: 'Administration / office' },
  { value: 'SUPPORT', label: 'Support (ayah, peon, housekeeping)' },
  { value: 'TRANSPORT', label: 'Transport (driver, attendant)' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'OTHER', label: 'Other' },
]

export const EMPLOYMENT_TYPES = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'PROBATION', label: 'On probation' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'PART_TIME', label: 'Part-time' },
  { value: 'VISITING', label: 'Visiting / guest faculty' },
  { value: 'TEMPORARY', label: 'Temporary' },
]

export const EMPLOYEE_STATUSES = {
  ACTIVE: { label: 'Working', tone: 'success' },
  NOTICE: { label: 'On notice', tone: 'warning' },
  EXITED: { label: 'Left', tone: 'neutral' },
}

export const EXIT_TYPES = [
  { value: 'RESIGNED', label: 'Resigned' },
  { value: 'RETIRED', label: 'Retired' },
  { value: 'CONTRACT_END', label: 'Contract ended' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'ABSCONDED', label: 'Stopped coming' },
  { value: 'DECEASED', label: 'Passed away' },
]

// genders and blood groups: students.js GENDERS / BLOOD_GROUPS
export const SALARY_MODES = ['BANK', 'CHEQUE', 'CASH']

// ───────────────────────────────────────────────────────── staff attendance

/** One day of one person. `payable` and `lop` (loss of pay) are what payroll counts. */
export const STAFF_ATTENDANCE = {
  PRESENT: { code: 'P', label: 'Present', tone: 'success', payable: 1, lop: 0 },
  HALF_DAY: { code: 'H', label: 'Half day', tone: 'warning', payable: 0.5, lop: 0.5 },
  ABSENT: { code: 'A', label: 'Absent', tone: 'danger', payable: 0, lop: 1 },
  ON_DUTY: { code: 'OD', label: 'On duty (outside)', tone: 'info', payable: 1, lop: 0 },
  LEAVE: { code: 'L', label: 'On leave', tone: 'brand', payable: 1, lop: 0 }, // unpaid leave: lop 1 (set from the leave)
  HOLIDAY: { code: 'HO', label: 'Holiday', tone: 'neutral', payable: 1, lop: 0 },
  WEEKLY_OFF: { code: 'WO', label: 'Weekly off', tone: 'neutral', payable: 1, lop: 0 },
}
/** What a person can be marked as by hand (leave, holidays and weekly offs come from their own records). */
export const MARKABLE = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_DUTY']

/** Payable and LOP for a day: a leave day is paid or not by its type; half a day's leave covers half. */
export function dayPay(status, { leavePaid = true, portion = 1 } = {}) {
  if (status === 'LEAVE') {
    if (leavePaid) return { payable: 1, lop: 0 }
    return { payable: 1 - portion, lop: portion }
  }
  const s = STAFF_ATTENDANCE[status] ?? STAFF_ATTENDANCE.ABSENT
  return { payable: s.payable, lop: s.lop }
}

/** A month's totals for one person: { PRESENT: n, …, payable, lop, late }. */
export function monthTotals(days = []) {
  const out = { payable: 0, lop: 0, late: 0 }
  for (const d of days) {
    out[d.status] = (out[d.status] ?? 0) + 1
    out.payable += d.payable ?? 0
    out.lop += d.lop ?? 0
    if (d.late) out.late++
  }
  return out
}

// ───────────────────────────────────────────────────────── leave

export const LEAVE_STATUSES = {
  PENDING: { label: 'Waiting', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

export const LEAVE_ACCRUALS = [
  { value: 'YEARLY', label: 'All at the start of the leave year' },
  { value: 'MONTHLY', label: 'A share every month' },
  { value: 'NONE', label: 'Given by HR when needed' },
]

/** CREDIT (yearly/given), ACCRUAL (monthly), TAKEN (−), REVERSAL (+, a cancelled leave), ADJUST (±), LAPSE (−), CARRY (+). */
export const LEAVE_LEDGER_KINDS = ['CREDIT', 'ACCRUAL', 'TAKEN', 'REVERSAL', 'ADJUST', 'LAPSE', 'CARRY']

/** The leave types a school starts with (Staff & HR › Leave › Types can change them). */
export const STARTER_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', paid: true, accrual: 'YEARLY', perYear: 12, carryForwardMax: 0, allowHalfDay: true, maxPerRequest: 3, tone: 'brand', order: 1 },
  { code: 'SL', name: 'Sick leave', paid: true, accrual: 'YEARLY', perYear: 10, carryForwardMax: 30, allowHalfDay: true, tone: 'warning', order: 2 },
  { code: 'EL', name: 'Earned leave', paid: true, accrual: 'MONTHLY', perYear: 15, carryForwardMax: 45, allowHalfDay: false, sandwich: true, categories: ['ADMIN', 'SUPPORT', 'TRANSPORT', 'SECURITY', 'OTHER'], tone: 'success', order: 3 },
  { code: 'ML', name: 'Maternity leave', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: false, genders: ['FEMALE'], tone: 'info', order: 4 },
  { code: 'DL', name: 'Duty leave (exam duty, training)', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: true, allowNegative: true, tone: 'neutral', order: 5 },
  { code: 'LOP', name: 'Leave without pay', paid: false, accrual: 'NONE', perYear: 0, allowHalfDay: true, allowNegative: true, tone: 'danger', order: 9 },
]

/** Does a leave type apply to this person (by gender and staff category)? */
export const leaveTypeFits = (type, emp) =>
  (!type.genders?.length || type.genders.includes(emp.gender)) && (!type.categories?.length || type.categories.includes(emp.category))

const isoDays = (from, to) => {
  const out = []
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length < 400; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
const dow = (ymd) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(`${ymd}T12:00:00Z`).getUTCDay()]

/**
 * The days a leave from→to counts: working days only, unless the type's sandwich rule counts the offs and holidays
 * that fall between leave days. `halfDay` (one date) counts 0.5.
 *   offDays ['SUN'] · holidays Set/array of YYYY-MM-DD · sandwich bool
 * → { dates: [{ date, portion }], days }
 */
export function leaveDates(from, to, { halfDay = false, offDays = ['SUN'], holidays = [], sandwich = false } = {}) {
  const hol = new Set(holidays)
  const all = isoDays(from, to)
  const off = (d) => offDays.includes(dow(d)) || hol.has(d)
  let dates = all.filter((d) => !off(d))
  if (sandwich && dates.length) {
    const first = dates[0]; const last = dates.at(-1)
    dates = all.filter((d) => d >= first && d <= last)
  }
  const portion = halfDay && all.length === 1 ? 0.5 : 1
  const rows = dates.map((date) => ({ date, portion }))
  return { dates: rows, days: rows.reduce((n, r) => n + r.portion, 0) }
}

/** The leave year a date falls in, starting in `startMonth` (1 = January, 4 = April). → { from, to, label } */
export function leaveYear(ymd, startMonth = 1) {
  const [y, m] = ymd.split('-').map(Number)
  const startY = m >= startMonth ? y : y - 1
  const pad = (n) => String(n).padStart(2, '0')
  const from = `${startY}-${pad(startMonth)}-01`
  const endY = startMonth === 1 ? startY : startY + 1
  const endM = startMonth === 1 ? 12 : startMonth - 1
  const to = `${endY}-${pad(endM)}-${pad(new Date(Date.UTC(endY, endM, 0)).getUTCDate())}`
  return { from, to, label: startMonth === 1 ? String(startY) : `${startY}-${String(endY).slice(2)}` }
}

/** Months of a leave year up to and including `ymd`'s month, as YYYY-MM. */
export function monthsSoFar(ymd, startMonth = 1) {
  const { from } = leaveYear(ymd, startMonth)
  const out = []
  let [y, m] = from.split('-').map(Number)
  const end = ymd.slice(0, 7)
  while (out.length < 12) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    out.push(k)
    if (k === end) break
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Monthly accrual, rounded to half days: 15 a year → 1.25 a month → credited as 1, 1.5, 1, 1.5 … in total halves. */
export const accrualUpTo = (perYear, months) => Math.floor((perYear * months) / 12 * 2) / 2

// ───────────────────────────────────────────────────────── recruitment

export const REQUISITION_STATUSES = {
  OPEN: { label: 'Open', tone: 'success' },
  ON_HOLD: { label: 'On hold', tone: 'warning' },
  FILLED: { label: 'Filled', tone: 'brand' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}

/** A school's hiring steps: a teacher usually gives a demo class before the interview. */
export const CANDIDATE_STAGES = {
  APPLIED: { label: 'Applied', tone: 'neutral', order: 1 },
  SHORTLISTED: { label: 'Shortlisted', tone: 'info', order: 2 },
  DEMO: { label: 'Demo class', tone: 'info', order: 3 },
  INTERVIEW: { label: 'Interview', tone: 'warning', order: 4 },
  OFFERED: { label: 'Offered', tone: 'brand', order: 5 },
  HIRED: { label: 'Joined', tone: 'success', order: 6 },
  REJECTED: { label: 'Not selected', tone: 'danger', order: 7 },
  WITHDRAWN: { label: 'Withdrew', tone: 'neutral', order: 8 },
}
export const OPEN_CANDIDATE_STAGES = ['APPLIED', 'SHORTLISTED', 'DEMO', 'INTERVIEW', 'OFFERED']
export const CANDIDATE_SOURCES = ['WEBSITE', 'REFERRAL', 'JOB_PORTAL', 'NEWSPAPER', 'WALK_IN', 'CAMPUS', 'OTHER']

// ───────────────────────────────────────────────────────── appraisal

export const APPRAISAL_CYCLE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  OPEN: { label: 'Open', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}
export const APPRAISAL_STATUS = {
  SELF: { label: 'Self review due', tone: 'warning' },
  MANAGER: { label: 'With the reviewer', tone: 'info' },
  DONE: { label: 'Done', tone: 'success' },
}
export const RATING_SCALE = [
  { value: 1, label: 'Needs improvement' },
  { value: 2, label: 'Below expectations' },
  { value: 3, label: 'Meets expectations' },
  { value: 4, label: 'Exceeds expectations' },
  { value: 5, label: 'Outstanding' },
]

/** What a teacher is usually reviewed on. A cycle copies these and can change them. */
export const TEACHER_CRITERIA = [
  { key: 'subject', label: 'Subject knowledge', weight: 20 },
  { key: 'teaching', label: 'Lesson planning and delivery', weight: 20 },
  { key: 'classroom', label: 'Classroom management', weight: 15 },
  { key: 'results', label: 'Student results and progress', weight: 20 },
  { key: 'punctuality', label: 'Punctuality and records', weight: 10 },
  { key: 'parents', label: 'Communication with parents', weight: 5 },
  { key: 'activities', label: 'Co-curricular and school duties', weight: 10 },
]

/** The weighted score (out of 5) from ratings { key: 1..5 }; null while any is missing. */
export function weightedScore(criteria = [], ratings = {}) {
  let sum = 0; let w = 0
  for (const c of criteria) {
    const r = Number(ratings?.[c.key])
    if (!(r >= 1 && r <= 5)) return null
    sum += r * (c.weight || 1); w += c.weight || 1
  }
  return w ? Math.round((sum / w) * 100) / 100 : null
}

/** The last four characters, for a masked identifier: "XXXX XXXX 1234". */
export const last4 = (s) => (s ? String(s).replace(/\s+/g, '').slice(-4) : '')
