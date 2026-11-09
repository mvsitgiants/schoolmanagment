// Training & placements (module `placements`, higher education; schools can use it for their final year too).
// Companies visit in drives; a drive has its roles, CTC range, who may apply (programs and batches, or classes for a
// school; minimum CGPA, most active backlogs, 10th / 12th marks) and its rounds (aptitude, GD, technical, HR). Students
// register (staff, or the student / parent in the app), each round shortlists, the final selections become offers.
// Money in paise; a CTC is paise per year.

export const COMPANY_SECTORS = [
  { value: 'IT', label: 'IT and software' },
  { value: 'CORE', label: 'Core engineering' },
  { value: 'BFSI', label: 'Banking, finance and insurance' },
  { value: 'CONSULTING', label: 'Consulting' },
  { value: 'ANALYTICS', label: 'Analytics and data' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
  { value: 'HEALTHCARE', label: 'Healthcare and pharma' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'RETAIL', label: 'Retail and FMCG' },
  { value: 'GOVERNMENT', label: 'Government and PSU' },
  { value: 'STARTUP', label: 'Start-up' },
  { value: 'OTHER', label: 'Other' },
]
export const COMPANY_SECTOR_LABEL = Object.fromEntries(COMPANY_SECTORS.map((s) => [s.value, s.label]))

export const DRIVE_MODES = [
  { value: 'ON_CAMPUS', label: 'On campus' },
  { value: 'VIRTUAL', label: 'Virtual' },
  { value: 'POOL', label: 'Pool campus' },
]

export const DRIVE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  OPEN: { label: 'Registration open', tone: 'info' },
  IN_PROGRESS: { label: 'Rounds on', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}
/** Which statuses a drive may move to from each. */
export const DRIVE_FLOW = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['IN_PROGRESS', 'DRAFT', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'OPEN', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['DRAFT'],
}

export const ROUND_KINDS = [
  { value: 'APTITUDE', label: 'Aptitude test' },
  { value: 'CODING', label: 'Coding test' },
  { value: 'GD', label: 'Group discussion' },
  { value: 'TECHNICAL', label: 'Technical interview' },
  { value: 'HR', label: 'HR interview' },
  { value: 'OTHER', label: 'Other' },
]
export const ROUND_RESULTS = {
  PASS: { label: 'Shortlisted', tone: 'success' },
  FAIL: { label: 'Not shortlisted', tone: 'danger' },
  ABSENT: { label: 'Absent', tone: 'warning' },
}

export const REGISTRATION_STATUS = {
  REGISTERED: { label: 'In the running', tone: 'info' },
  REJECTED: { label: 'Out', tone: 'neutral' },
  SELECTED: { label: 'Selected', tone: 'success' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
}

export const OFFER_STATUS = {
  OFFERED: { label: 'Offered', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
  REVOKED: { label: 'Revoked', tone: 'danger' },
}
/** Offers that count a student as placed. */
export const LIVE_OFFER = ['OFFERED', 'ACCEPTED']

/** How many offers a student may hold (Settings › Placements). */
export const OFFER_POLICIES = [
  { value: 'ONE', label: 'One offer — a placed student applies no more' },
  { value: 'DREAM', label: 'Dream offer — a placed student applies only to drives paying the dream CTC or more' },
  { value: 'OPEN', label: 'No limit' },
]

/** "Tata Consultancy Services" → "TC". */
export function companyInitials(name) {
  const words = String(name ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase()
}

/** paise a year → lakh a year (12.5). */
export const lpa = (paise) => Math.round((Number(paise) || 0) / 100 / 1000) / 100
/** paise a year → "12.5 LPA". */
export const formatLpa = (paise) => (paise ? `${lpa(paise)} LPA` : '—')
/** lakh a year → paise. */
export const lpaToPaise = (lakhs) => Math.round((Number(lakhs) || 0) * 100000 * 100)

export function ctcMedian(values = []) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
}

/** Highest, median and average of CTCs (paise). */
export function ctcStats(values = []) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0)
  if (!v.length) return { count: 0, highest: 0, median: 0, average: 0 }
  return { count: v.length, highest: Math.max(...v), median: ctcMedian(v), average: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }
}

/**
 * Who meets a drive's criteria. `facts`: { cgpa, backlogs, tenthPct, twelfthPct } (null = not known). A criterion the
 * drive sets and the student has no figure for counts as not met — except 10th / 12th, which the student gives when
 * registering (`pending` lists them).
 */
export function checkEligibility(criteria = {}, facts = {}) {
  const reasons = []
  const pending = []
  if (criteria.minCgpa != null) {
    if (facts.cgpa == null) reasons.push('NO_CGPA')
    else if (facts.cgpa < criteria.minCgpa) reasons.push('CGPA')
  }
  if (criteria.maxBacklogs != null && (facts.backlogs ?? 0) > criteria.maxBacklogs) reasons.push('BACKLOGS')
  for (const [k, f] of [['min10th', 'tenthPct'], ['min12th', 'twelfthPct']]) {
    if (criteria[k] == null) continue
    if (facts[f] == null) pending.push(f)
    else if (facts[f] < criteria[k]) reasons.push(k === 'min10th' ? 'TENTH' : 'TWELFTH')
  }
  return { eligible: reasons.length === 0, reasons, pending }
}

/**
 * The offer policy for a student who already has offers. `best`: their best live offer's CTC (0: none). `driveCtc`: the
 * most the drive pays. → null when they may apply, else the reason (PLACED: one-offer rule; DREAM_HELD: already holds a
 * dream offer; NOT_DREAM: placed, and this drive pays below the dream CTC).
 */
export function offerPolicyBlock({ policy = 'DREAM', dreamCtc = 0, best = 0, driveCtc = 0 }) {
  if (!best || policy === 'OPEN') return null
  if (policy === 'ONE') return 'PLACED'
  if (dreamCtc && best >= dreamCtc) return 'DREAM_HELD'
  if (!dreamCtc || driveCtc < dreamCtc) return 'NOT_DREAM'
  return null
}

/** Registration window state on a day. */
export function driveWindowState(drive, today) {
  const r = drive?.registration ?? {}
  if (drive?.status !== 'OPEN') return 'CLOSED'
  if (r.opensOn && today < r.opensOn) return 'NOT_YET'
  if (r.closesOn && today > r.closesOn) return 'CLOSED'
  return 'OPEN'
}

/**
 * The drive's funnel: registered → each round (those who passed it) → selected → accepted.
 * `registrations`: [{ status, rounds: [{ roundId, result }] }] (withdrawn ones left out by the caller).
 */
export function driveFunnel(rounds = [], registrations = [], accepted = 0) {
  const steps = [{ key: 'REGISTERED', label: 'Registered', count: registrations.length }]
  for (const r of rounds) {
    const id = String(r.id ?? r._id)
    steps.push({ key: id, label: r.name, kind: r.kind, count: registrations.filter((g) => (g.rounds ?? []).some((x) => String(x.roundId) === id && x.result === 'PASS')).length })
  }
  steps.push({ key: 'SELECTED', label: 'Selected', count: registrations.filter((g) => g.status === 'SELECTED').length })
  steps.push({ key: 'ACCEPTED', label: 'Accepted', count: accepted })
  return steps
}

/** The rounds a registration has cleared, and whether it is still in the running at `round` (all earlier passed). */
export function inRunningFor(rounds = [], reg, roundId) {
  if (!reg || reg.status === 'WITHDRAWN' || reg.status === 'REJECTED') return false
  for (const r of rounds) {
    const id = String(r.id ?? r._id)
    if (id === String(roundId)) return true
    const res = (reg.rounds ?? []).find((x) => String(x.roundId) === id)
    if (res?.result !== 'PASS') return false
  }
  return false
}
