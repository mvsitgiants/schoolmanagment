// Scholarships (module `scholarships`): lists and pure helpers shared by the API and the web app.
//
// The aim is one visit or none. A scheme says up front who can apply and which documents to bring; the
// student's documents are kept once checked (the document wallet) and used again for other schemes and
// next year until they expire; staff check each document online and only the wrong ones go back to the
// family, with the reason. Money is integer paise.

export const SCHOLARSHIP_PROVIDERS = [
  { value: 'INSTITUTION', label: 'The institution' },
  { value: 'GOVERNMENT', label: 'Government (central or state)' },
  { value: 'TRUST', label: 'Trust, donor or company' },
]
export const SCHOLARSHIP_PROVIDER_LABEL = Object.fromEntries(SCHOLARSHIP_PROVIDERS.map((p) => [p.value, p.label]))

/** How the scholarship reaches the student. */
export const SCHOLARSHIP_BENEFITS = [
  { value: 'FEE_WAIVER', label: 'Taken off the fees' },
  { value: 'PAID_TO_STUDENT', label: 'Paid into the student’s bank account' },
  { value: 'PAID_TO_INSTITUTION', label: 'Paid to the institution later, against the fees' },
]

/** Government scholarship portals the office works on. */
export const SCHOLARSHIP_PORTALS = [
  { value: 'NSP', label: 'National Scholarship Portal (NSP)' },
  { value: 'UP', label: 'UP Scholarship portal' },
  { value: 'STATE', label: 'Another state’s portal' },
  { value: 'OTHER', label: 'Other' },
]

/** Where a government application stands on the portal (the office updates it; the portal itself is outside). */
export const SCHOLARSHIP_PORTAL_STATUS = {
  NOT_APPLIED: { label: 'Not on the portal yet', tone: 'neutral' },
  APPLIED: { label: 'Applied — the institution to verify', tone: 'warning' },
  INSTITUTE_VERIFIED: { label: 'Verified by the institution', tone: 'info' },
  FORWARDED: { label: 'Sent on to the district / university', tone: 'info' },
  SANCTIONED: { label: 'Sanctioned', tone: 'success' },
  PAID: { label: 'Money paid', tone: 'success' },
  REJECTED: { label: 'Rejected on the portal', tone: 'danger' },
}

export const SCHOLARSHIP_KINDS = [
  { value: 'PCT', label: 'A percentage of the fees' },
  { value: 'AMOUNT', label: 'A fixed amount a year' },
]

export const SCHOLARSHIP_APPROVAL = [
  { value: 'AUTO', label: 'Approved on its own once every document is correct' },
  { value: 'APPROVER', label: 'Someone approves (principal or committee)' },
]

export const SCHOLARSHIP_RANK_BY = [
  { value: 'NONE', label: 'In the order they applied' },
  { value: 'MARKS', label: 'Higher marks first' },
  { value: 'INCOME', label: 'Lower family income first' },
]

/**
 * Documents a scheme can ask for. `validMonths`: how long one stays good from the day it was issued
 * (an income certificate is asked for again every year); null = it does not expire.
 */
export const SCHOLARSHIP_DOC_TYPES = [
  { value: 'INCOME_CERTIFICATE', label: 'Income certificate', validMonths: 12 },
  { value: 'CASTE_CERTIFICATE', label: 'Caste certificate', validMonths: null },
  { value: 'DOMICILE', label: 'Domicile / residence certificate', validMonths: null },
  { value: 'STUDENT_AADHAAR', label: 'Student’s Aadhaar card', validMonths: null },
  { value: 'PARENT_ID', label: 'Parent’s ID proof', validMonths: null },
  { value: 'BANK_PASSBOOK', label: 'Bank passbook (first page)', validMonths: null },
  { value: 'MARKSHEET', label: 'Last year’s mark sheet', validMonths: 12 },
  { value: 'PHOTO', label: 'Passport-size photo', validMonths: null },
  { value: 'DISABILITY_CERTIFICATE', label: 'Disability certificate (UDID)', validMonths: null },
  { value: 'BPL_CARD', label: 'BPL / ration card', validMonths: null },
  { value: 'MINORITY_DECLARATION', label: 'Minority community declaration', validMonths: 12 },
  { value: 'SPORTS_CERTIFICATE', label: 'Sports certificate', validMonths: null },
  { value: 'SELF_DECLARATION', label: 'Self-declaration form', validMonths: null }, // signed for the application; no issue date to track
  { value: 'OTHER', label: 'Other document', validMonths: null },
]
export const SCHOLARSHIP_DOC_TYPE_BY = Object.fromEntries(SCHOLARSHIP_DOC_TYPES.map((d) => [d.value, d]))

/** A checklist line's state for one student. */
export const SCHOLARSHIP_DOC_STATUS = {
  MISSING: { label: 'Not given yet', tone: 'neutral' },
  SUBMITTED: { label: 'Waiting to be checked', tone: 'info' },
  ORIGINAL_DUE: { label: 'Correct — original still to be seen', tone: 'info' },
  ACCEPTED: { label: 'Correct', tone: 'success' },
  NOT_ACCEPTED: { label: 'Needs fixing', tone: 'danger' },
  EXPIRED: { label: 'Expired — a new one is needed', tone: 'warning' },
}

/** Why a document was not accepted — the family is told this, so it says what to do. */
export const SCHOLARSHIP_REJECT_REASONS = [
  { value: 'BLURRED', label: 'Not clear — the photo or scan is blurred' },
  { value: 'NAME_MISMATCH', label: 'The name is different from the school record' },
  { value: 'TOO_OLD', label: 'Too old — a newer one is needed' },
  { value: 'WRONG_DOCUMENT', label: 'This is a different document' },
  { value: 'INCOMPLETE', label: 'A page or side is missing' },
  { value: 'NO_SEAL', label: 'The seal or signature is missing' },
  { value: 'DETAILS_WRONG', label: 'Some details are wrong' },
  { value: 'OTHER', label: 'Other reason' },
]
export const SCHOLARSHIP_REJECT_REASON_LABEL = Object.fromEntries(SCHOLARSHIP_REJECT_REASONS.map((r) => [r.value, r.label]))

export const SCHOLARSHIP_STATUS = {
  IN_PROGRESS: { label: 'Collecting documents', tone: 'info' },
  NEEDS_FIX: { label: 'Sent back to fix', tone: 'warning' },
  READY: { label: 'Ready for decision', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'success' },
  NOT_APPROVED: { label: 'Not approved', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
}
/** Applications still being worked on (their fees can be held). */
export const SCHOLARSHIP_OPEN = ['IN_PROGRESS', 'NEEDS_FIX', 'READY']

/** The eligibility checks, in the order they are shown. */
export const SCHOLARSHIP_CHECKS = [
  { key: 'class', label: 'Class' },
  { key: 'category', label: 'Category' },
  { key: 'gender', label: 'Gender' },
  { key: 'income', label: 'Family income' },
  { key: 'marks', label: 'Marks' },
  { key: 'attendance', label: 'Attendance' },
]

const addMonths = (ymd, months) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return dt.toISOString().slice(0, 10)
}

/** The last day a document is good for, from its type and the day it was issued (null = no end). */
export function scholarshipDocValidTill(type, issuedOn) {
  const months = SCHOLARSHIP_DOC_TYPE_BY[type]?.validMonths
  if (!months || !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn ?? '')) return null
  return addMonths(issuedOn, months)
}

/**
 * One checklist line's state from the student's document (or none): `doc` = { status, validTill, originalSeen,
 * files, lastFileAt, checkedAt }. A document sent back and then uploaded again counts as waiting to be checked.
 */
export function scholarshipDocState(doc, { originalNeeded = false } = {}, today) {
  if (!doc) return 'MISSING'
  if (doc.status === 'NEW') return doc.files > 0 ? 'SUBMITTED' : 'MISSING'
  if (doc.status === 'NOT_ACCEPTED') {
    const reuploaded = doc.lastFileAt && doc.checkedAt && new Date(doc.lastFileAt) > new Date(doc.checkedAt)
    return reuploaded ? 'SUBMITTED' : 'NOT_ACCEPTED'
  }
  if (doc.status === 'ACCEPTED') {
    if (doc.validTill && today && doc.validTill < today) {
      // a new photo or scan sent since it was checked: the new one waits to be checked
      const resent = doc.lastFileAt && doc.checkedAt && new Date(doc.lastFileAt) > new Date(doc.checkedAt)
      return resent ? 'SUBMITTED' : 'EXPIRED'
    }
    if (originalNeeded && !doc.originalSeen) return 'ORIGINAL_DUE'
    return 'ACCEPTED'
  }
  return 'SUBMITTED'
}

/** An open application's status from its required lines' states. */
export function scholarshipStatusFrom(states) {
  if (states.some((s) => s === 'NOT_ACCEPTED' || s === 'EXPIRED')) return 'NEEDS_FIX'
  if (states.every((s) => s === 'ACCEPTED')) return 'READY'
  return 'IN_PROGRESS'
}

/** Counts of a checklist's lines by state (`{ MISSING: 2, ACCEPTED: 3 … }`). */
export function scholarshipDocCounts(states) {
  const out = Object.fromEntries(Object.keys(SCHOLARSHIP_DOC_STATUS).map((k) => [k, 0]))
  for (const s of states) out[s] = (out[s] ?? 0) + 1
  return out
}

/**
 * Where an application stands for the family (the app's tracker): step 1 applied · 2 documents · 3 checking ·
 * 4 decision, and what the family should do next.
 *   GIVE_DOCS  documents still to give          FIX_DOCS     something was sent back (or expired)
 *   WAIT_CHECK the office is checking            SHOW_ORIGINALS  only originals are left: book a visit
 *   WAIT_DECISION every document is correct      APPROVED · NOT_APPROVED · WITHDRAWN
 */
export function scholarshipFamilyStep(status, states = []) {
  if (status === 'APPROVED') return { step: 4, next: 'APPROVED' }
  if (status === 'NOT_APPROVED') return { step: 4, next: 'NOT_APPROVED' }
  if (status === 'WITHDRAWN') return { step: 4, next: 'WITHDRAWN' }
  if (states.some((s) => s === 'NOT_ACCEPTED' || s === 'EXPIRED')) return { step: 2, next: 'FIX_DOCS' }
  if (states.some((s) => s === 'MISSING')) return { step: 2, next: 'GIVE_DOCS' }
  if (states.some((s) => s === 'SUBMITTED')) return { step: 3, next: 'WAIT_CHECK' }
  if (states.some((s) => s === 'ORIGINAL_DUE')) return { step: 3, next: 'SHOW_ORIGINALS' }
  return { step: 4, next: 'WAIT_DECISION' }
}

/** Times a visit day offers ('HH:MM'), every `slotMinutes` from `from` until `to`. */
export function scholarshipVisitTimes({ from, to, slotMinutes = 10 }) {
  const mins = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m }
  const out = []
  const step = Math.max(5, Number(slotMinutes) || 10)
  for (let m = mins(from); m + step <= mins(to); m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  return out
}

/** "50% of fees" / "₹12,000 a year" — the scheme's benefit as people read it. */
export function scholarshipValueText(scheme, formatAmount = (p) => `₹${(p / 100).toLocaleString('en-IN')}`) {
  if (!scheme) return ''
  return scheme.kind === 'PCT' ? `${scheme.value}% of fees` : `${formatAmount(scheme.value)} a year`
}
