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

/**
 * How a leave type's days are given. Older types say YEARLY — read as ANNUAL_UPFRONT (normalizeAccrual).
 * ON_CONFIRMATION: nothing while on probation; from the confirmation date the rest of that leave year, then every year in full.
 */
export const LEAVE_ACCRUALS = [
  { value: 'ANNUAL_UPFRONT', label: 'All at the start of the leave year' },
  { value: 'MONTHLY', label: 'A share every month' },
  { value: 'ON_CONFIRMATION', label: 'After probation, then every year' },
  { value: 'NONE', label: 'Not credited (given by HR, or no balance needed)' },
]
export const normalizeAccrual = (a) => (a === 'YEARLY' ? 'ANNUAL_UPFRONT' : a || 'NONE')

/**
 * The leave ledger (balance = Σ days). The automatic postings keep their kind and period (CREDIT '2026-27',
 * ACCRUAL '2026-10', LAPSE '2026-27'), so running them again adds nothing twice. ADJUST is the older name of ADJUSTMENT.
 */
export const LEAVE_LEDGER_KINDS = {
  OPENING: 'Opening balance',
  CREDIT: 'Credited for the year',
  ACCRUAL: 'Monthly credit',
  TAKEN: 'Leave taken',
  REVERSAL: 'Leave cancelled — days given back',
  ADJUSTMENT: 'Corrected by HR',
  ADJUST: 'Corrected by HR',
  COMP_OFF: 'Compensatory off for a day worked',
  LAPSE: 'Lapsed at the year end',
  CARRY: 'Carried forward',
}

/**
 * The leave types a school starts with (Leave › Setup › Leave policies changes them). An institution that already
 * has leave types keeps them; codes it doesn't have yet are added once (merge by code, nothing overwritten).
 *   categoryQuota   a different number of days a year for some staff categories
 *   pauseInVacation monthly credit stops in a month that is mostly school vacation (Setup › No-leave days)
 *   blackoutExempt  the no-leave days (exams, annual day) don't apply — sickness and maternity can't wait
 *   noticeDays      ask this many days ahead (a warning for the approver, not a block)
 *   compOff         the type HR credits for a day worked on a holiday
 */
export const STARTER_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', paid: true, accrual: 'ANNUAL_UPFRONT', perYear: 12, carryForwardMax: 0, allowHalfDay: true, maxPerRequest: 3, tone: 'brand', order: 1,
    description: 'For personal work and short absences. Unused days lapse at the year end.' },
  { code: 'SL', name: 'Sick / medical leave', paid: true, accrual: 'ANNUAL_UPFRONT', perYear: 10, carryForwardMax: 30, allowHalfDay: true, blackoutExempt: true, tone: 'warning', order: 2,
    description: 'When unwell. A medical certificate may be asked for longer absences.' },
  { code: 'EL', name: 'Earned leave', paid: true, accrual: 'MONTHLY', perYear: 15, carryForwardMax: 45, allowHalfDay: false, sandwich: true, noticeDays: 7, pauseInVacation: true,
    categories: ['ADMIN', 'SUPPORT', 'TRANSPORT', 'SECURITY', 'OTHER'], tone: 'success', order: 3,
    description: 'Earned month by month by staff who work through the school vacations.' },
  { code: 'ML', name: 'Maternity leave', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: false, allowNegative: true, sandwich: true, maxPerRequest: 182, blackoutExempt: true, genders: ['FEMALE'], tone: 'info', order: 4,
    description: 'Up to 26 weeks around childbirth.' },
  { code: 'PL', name: 'Paternity leave', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: false, allowNegative: true, sandwich: true, maxPerRequest: 15, blackoutExempt: true, genders: ['MALE'], tone: 'info', order: 5,
    description: 'Up to 15 days around the birth or adoption of a child.' },
  { code: 'CCL', name: 'Child-care leave', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: false, sandwich: false, tone: 'info', order: 6,
    description: 'To look after a child (illness, exams). HR gives the days when it is granted.' },
  { code: 'DL', name: 'Duty leave', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: true, allowNegative: true, blackoutExempt: true, tone: 'neutral', order: 7,
    description: 'Exam invigilation, evaluation, training or other official duty away from school. Doesn’t use up any balance.' },
  { code: 'CO', name: 'Compensatory off', paid: true, accrual: 'NONE', perYear: 0, allowHalfDay: true, compOff: true, tone: 'neutral', order: 8,
    description: 'A day off in return for working on a holiday or at a school event. HR credits it.' },
  { code: 'LOP', name: 'Leave without pay', paid: false, accrual: 'NONE', perYear: 0, allowHalfDay: true, allowNegative: true, tone: 'danger', order: 9,
    description: 'When no other leave is left. The days are cut from the salary.' },
]
export const DEFAULT_LEAVE_TYPES = STARTER_LEAVE_TYPES

/** Does a leave type apply to this person (by gender and staff category)? */
export const leaveTypeFits = (type, emp) =>
  (!type.genders?.length || type.genders.includes(emp.gender)) && (!type.categories?.length || type.categories.includes(emp.category))

/** Days a year of a type for this person: their category's own number when the policy sets one. */
export function quotaFor(type, emp) {
  const own = (type?.categoryQuota ?? []).find((q) => q.category === emp?.category)
  return Number(own ? own.perYear : type?.perYear) || 0
}

/** Round to the nearest half day (balances and pro-rated credits move in halves). */
export const toHalfDays = (n) => Math.round(Number(n || 0) * 2) / 2

/**
 * Count leave days. `days` is [{ date, working }] for every date in the range (working = the person would otherwise be
 * at work: not a weekly off, holiday or their school vacation). Non-working dates are free, except under the sandwich
 * rule, where offs and holidays between two leave days count too. A half day is 0.5.
 *   → { days, dates: [{ date, portion, working, sandwiched }] }
 */
export function countLeaveDays(days, { halfDay = false, sandwich = false } = {}) {
  const first = days.findIndex((d) => d.working)
  const last = days.length - 1 - [...days].reverse().findIndex((d) => d.working)
  const out = days.map((d, i) => {
    let portion = d.working ? 1 : 0
    if (!d.working && sandwich && first !== -1 && i > first && i < last) portion = 1
    return { date: d.date, portion, working: d.working, sandwiched: !d.working && portion > 0 }
  })
  if (halfDay) for (const d of out) if (d.portion) d.portion = 0.5
  return { days: out.reduce((s, d) => s + d.portion, 0), dates: out }
}

/**
 * Days in the institution's leave calendar (Leave › Setup › No-leave days):
 *   NO_LEAVE  exams, annual day, parent–teacher meetings — leave asked for on them is warned about, needs the
 *             principal / HR, or is refused (the day's `mode`)
 *   VACATION  school vacation — not a working day for the staff it covers, so leave isn't counted on it, and
 *             monthly credit pauses in a month that is mostly vacation (types with pauseInVacation)
 */
export const LEAVE_CALENDAR_KINDS = {
  NO_LEAVE: { label: 'No-leave days' },
  VACATION: { label: 'School vacation' },
}
export const NO_LEAVE_MODES = [
  { value: 'WARN', label: 'Allow, with a warning to the approver' },
  { value: 'HR', label: 'Allow only with the principal’s or HR’s approval' },
  { value: 'BLOCK', label: 'Don’t allow — only HR can enter leave on these days' },
]
/** A month with at least this many vacation days for a person earns no monthly credit (pauseInVacation). */
export const VACATION_MONTH_DAYS = 15

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
