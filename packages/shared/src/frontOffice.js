// Front office (module `frontoffice`): the visitor log at the gate, gate passes for students (and staff) leaving
// early, and complaints / grievances from families, students and staff. Constants and pure helpers shared by the
// API and the web app. Names start with FO_ so they never clash with another module's exports.
import { addDaysYmd } from './dates.js'

/** Why someone came in. `tone` colours the chip; `enquiry` marks the one that can become an admission enquiry. */
export const FO_VISIT_PURPOSES = [
  { value: 'MEET_STAFF', label: 'Meet a staff member', tone: 'brand' },
  { value: 'ADMISSION_ENQUIRY', label: 'Admission enquiry', tone: 'violet', enquiry: true },
  { value: 'PARENT_MEETING', label: 'Parent meeting', tone: 'sky' },
  { value: 'VENDOR', label: 'Vendor / delivery', tone: 'orange' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]
export const FO_VISIT_PURPOSE_BY = Object.fromEntries(FO_VISIT_PURPOSES.map((p) => [p.value, p]))

/** Photo ID a visitor may show (optional). */
export const FO_ID_TYPES = [
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'DRIVING_LICENCE', label: 'Driving licence' },
  { value: 'VOTER_ID', label: 'Voter ID' },
  { value: 'PAN', label: 'PAN card' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'OTHER', label: 'Other' },
]

export const FO_GATE_PASS_KINDS = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'STAFF', label: 'Staff' },
]

/**
 * A gate pass: asked for (REQUESTED) → approved by the class teacher or an admin (APPROVED) → handed over at the gate
 * (LEFT). A staff pass can be marked RETURNED. Before leaving it can be REJECTED or CANCELLED.
 */
export const FO_GATE_PASS_STATUS = {
  REQUESTED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  LEFT: { label: 'Left school', tone: 'success' },
  RETURNED: { label: 'Back in school', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}
/** Passes still in play on the day (shown on the board). */
export const FO_GATE_PASS_ACTIVE = ['REQUESTED', 'APPROVED']

/** Who collects the student: a guardian on the student's record, or someone else (relation and photo noted). */
export const FO_COLLECTOR_TYPES = [
  { value: 'GUARDIAN', label: 'Guardian on record' },
  { value: 'OTHER', label: 'Someone else' },
]

/** Usual reasons, offered as quick picks (free text is allowed too). */
export const FO_GATE_PASS_REASONS = ['Unwell', 'Medical appointment', 'Family function', 'Emergency at home', 'Competition / event', 'Other']

export const FO_COMPLAINT_SOURCES = [
  { value: 'PARENT', label: 'Parent (phone / letter)' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'FAMILY_APP', label: 'Family app' },
]
export const FO_COMPLAINT_SOURCE_LABEL = Object.fromEntries(FO_COMPLAINT_SOURCES.map((s) => [s.value, s.label]))

export const FO_COMPLAINT_CATEGORIES = [
  { value: 'TRANSPORT', label: 'Transport', tone: 'orange' },
  { value: 'ACADEMICS', label: 'Academics', tone: 'brand' },
  { value: 'FEES', label: 'Fees', tone: 'violet' },
  { value: 'FACILITIES', label: 'Facilities', tone: 'sky' },
  { value: 'STAFF_BEHAVIOUR', label: 'Staff behaviour', tone: 'pink' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]
export const FO_COMPLAINT_CATEGORY_BY = Object.fromEntries(FO_COMPLAINT_CATEGORIES.map((c) => [c.value, c]))

export const FO_COMPLAINT_PRIORITIES = [
  { value: 'LOW', label: 'Low', tone: 'neutral' },
  { value: 'MEDIUM', label: 'Medium', tone: 'info' },
  { value: 'HIGH', label: 'High', tone: 'warning' },
  { value: 'URGENT', label: 'Urgent', tone: 'danger' },
]
export const FO_COMPLAINT_PRIORITY_BY = Object.fromEntries(FO_COMPLAINT_PRIORITIES.map((p) => [p.value, p]))

/** OPEN → IN_PROGRESS → RESOLVED → CLOSED. A resolved complaint can be reopened (back to IN_PROGRESS). */
export const FO_COMPLAINT_STATUS = {
  OPEN: { label: 'Open', tone: 'warning' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}
export const FO_COMPLAINT_FLOW = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
}
export const FO_COMPLAINT_OPEN = ['OPEN', 'IN_PROGRESS']

/** The day a complaint should be resolved by: the day it was raised plus the SLA (Settings › Front office). */
export const complaintDueOn = (raisedOn, slaDays) => addDaysYmd(raisedOn, Math.max(0, Number(slaDays) || 0))

/** Still open and past its due day? */
export const complaintOverdue = (c, today) => FO_COMPLAINT_OPEN.includes(c?.status) && !!c?.dueOn && today > c.dueOn

/** Whole minutes between two instants (a visit's length; a pass's time out). */
export function foMinutesBetween(from, to = new Date()) {
  if (!from) return 0
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000))
}

/** "1 h 25 min" / "40 min". */
export function foDurationLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** Monday of the week a YYYY-MM-DD falls in (the "this week" stat). */
export function foWeekStart(ymd) {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay() // 0 Sun … 6 Sat
  return addDaysYmd(ymd, day === 0 ? -6 : 1 - day)
}
