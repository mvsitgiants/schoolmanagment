// Admissions (module `admissions`): the enquiry CRM, online application, entrance tests, merit lists and seat
// allotment. An admission cycle ("Admissions 2027-28") says which classes take how many new students and when the
// online application is open; enquiries become applications, applications are tested and ranked, the top of each
// merit list gets an offer, and an accepted offer becomes a student (Students › admission).

export const ENQUIRY_SOURCES = [
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'Phone call' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'SOCIAL', label: 'Social media / ads' },
  { value: 'REFERRAL', label: 'Referral (parent / staff)' },
  { value: 'NEWSPAPER', label: 'Newspaper' },
  { value: 'HOARDING', label: 'Hoarding / banner' },
  { value: 'EVENT', label: 'School event / open house' },
  { value: 'OTHER', label: 'Other' },
]
export const ENQUIRY_SOURCE_LABEL = Object.fromEntries(ENQUIRY_SOURCES.map((s) => [s.value, s.label]))

/** The enquiry pipeline, in order. */
export const ENQUIRY_STAGES = {
  NEW: { label: 'New', tone: 'info', order: 1 },
  CONTACTED: { label: 'Contacted', tone: 'info', order: 2 },
  VISIT: { label: 'Visit planned', tone: 'warning', order: 3 },
  VISITED: { label: 'Visited', tone: 'warning', order: 4 },
  APPLIED: { label: 'Applied', tone: 'success', order: 5 },
  ADMITTED: { label: 'Admitted', tone: 'success', order: 6 },
  LOST: { label: 'Lost', tone: 'neutral', order: 7 },
}
export const OPEN_STAGES = ['NEW', 'CONTACTED', 'VISIT', 'VISITED']

export const LOST_REASONS = ['Chose another school', 'Fees too high', 'Distance / transport', 'No seat in the class', 'Not reachable', 'Not interested now', 'Other']

export const FOLLOWUP_TYPES = [
  { value: 'CALL', label: 'Call' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'VISIT', label: 'Campus visit' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'NOTE', label: 'Note' },
]

export const APPLICATION_STATUS = {
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info' },
  SHORTLISTED: { label: 'Shortlisted', tone: 'warning' },
  OFFERED: { label: 'Seat offered', tone: 'success' },
  ACCEPTED: { label: 'Offer accepted', tone: 'success' },
  ADMITTED: { label: 'Admitted', tone: 'success' },
  WAITLISTED: { label: 'Waitlisted', tone: 'warning' },
  REJECTED: { label: 'Not offered', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
}
/** Still in the running for a seat. */
export const LIVE_APPLICATION = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'WAITLISTED']

export const CYCLE_STATUS = {
  DRAFT: { label: 'Being set up', tone: 'neutral' },
  OPEN: { label: 'Open for applications', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}

export const MERIT_BASES = [
  { value: 'TEST', label: 'Entrance test marks' },
  { value: 'SCORE', label: 'A score entered for each applicant (interview, assessment)' },
  { value: 'FIRST_COME', label: 'Order of application (first come, first served)' },
]

/**
 * Rank applicants for a merit list. `rows` [{ id, score, submittedAt }] — higher score first; ties (and FIRST_COME)
 * by who applied first. Returns ids with their rank (1, 2, 3 … no gaps, so seats are counted plainly).
 */
export function rankApplicants(rows, basis) {
  const sorted = [...rows].sort((a, b) => {
    if (basis !== 'FIRST_COME') {
      const sa = Number.isFinite(a.score) ? a.score : -Infinity
      const sb = Number.isFinite(b.score) ? b.score : -Infinity
      if (sb !== sa) return sb - sa
    }
    return String(a.submittedAt).localeCompare(String(b.submittedAt))
  })
  return sorted.map((r, i) => ({ id: r.id, rank: i + 1 }))
}
