// Students (SIS): the lists and checks shared by the API and the web app.

export const GENDERS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
]

export const STUDENT_CATEGORIES = [
  { value: 'GENERAL', label: 'General' },
  { value: 'OBC', label: 'OBC' },
  { value: 'SC', label: 'SC' },
  { value: 'ST', label: 'ST' },
  { value: 'EWS', label: 'EWS' },
  { value: 'OTHER', label: 'Other' },
]

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

export const GUARDIAN_RELATIONS = [
  { value: 'FATHER', label: 'Father' },
  { value: 'MOTHER', label: 'Mother' },
  { value: 'GUARDIAN', label: 'Guardian' },
  { value: 'GRANDPARENT', label: 'Grandparent' },
  { value: 'SIBLING', label: 'Brother / sister' },
  { value: 'OTHER', label: 'Other' },
]

export const STUDENT_STATUS = {
  ACTIVE: { label: 'Studying', tone: 'success' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
  LEFT: { label: 'Left', tone: 'warning' },
  PASSED_OUT: { label: 'Passed out', tone: 'info' },
}

/** What happens to a student at year end (Students › Promotion). */
export const PROMOTION_OUTCOMES = [
  { value: 'PROMOTE', label: 'Promote to the next class' },
  { value: 'DETAIN', label: 'Stay in the same class' },
  { value: 'PASS_OUT', label: 'Passed out (final class)' },
  { value: 'LEAVE', label: 'Leaving the school' },
]

/** Entries in a student's enrolment history. */
export const HISTORY_EVENTS = {
  ADMITTED: 'Admitted',
  MOVED: 'Moved section',
  PROMOTE: 'Promoted',
  DETAIN: 'Detained',
  PASS_OUT: 'Passed out',
  LEAVE: 'Left at year end',
  TC_ISSUED: 'Transfer certificate issued',
  READMITTED: 'Re-admitted',
}

export const LEAVING_REASONS = [
  { value: 'TRANSFER', label: 'Moving to another school' },
  { value: 'RELOCATION', label: 'Family relocating' },
  { value: 'COMPLETED', label: 'Completed the final class' },
  { value: 'FEES', label: 'Unable to pay fees' },
  { value: 'HEALTH', label: 'Health reasons' },
  { value: 'OTHER', label: 'Other' },
]

export const CONDUCT_OPTIONS = ['Excellent', 'Very good', 'Good', 'Satisfactory']

/** TC row 10 — "Whether failed, if so once / twice in the same class". */
export const TC_FAILED = [
  { value: 'NO', label: 'No' },
  { value: 'ONCE', label: 'Once' },
  { value: 'TWICE', label: 'Twice' },
]

export const TC_STATUS = {
  REQUESTED: { label: 'Waiting for approval', tone: 'warning' },
  ISSUED: { label: 'Issued', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

/** "Aarav Kumar Sharma" from the name parts. */
export const fullName = (s) => [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(' ')

/** Whole years of age on a date (YYYY-MM-DD), or null. */
export function ageYears(dob, onYmd = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob ?? '')) return null
  const [by, bm, bd] = dob.split('-').map(Number)
  const [y, m, d] = onYmd.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

/** Aadhaar: 12 digits, not starting with 0 or 1, passing the Verhoeff check digit. */
const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
export function isValidAadhaar(v) {
  const s = String(v ?? '').replace(/\s+/g, '')
  if (!/^[2-9]\d{11}$/.test(s)) return false
  let c = 0
  s.split('').reverse().map(Number).forEach((n, i) => { c = VD[c][VP[i % 8][n]] })
  return c === 0
}

// ───────────────────────────────────────────────────────── student ID cards

/** What a student ID card can show besides the name, class and admission number (always printed). */
export const STUDENT_ID_CARD_FIELDS = [
  { value: 'PHOTO', label: 'Photo' },
  { value: 'ROLL', label: 'Roll number' },
  { value: 'DOB', label: 'Date of birth' },
  { value: 'BLOOD_GROUP', label: 'Blood group' },
  { value: 'GUARDIAN', label: 'Parent / guardian' },
  { value: 'GUARDIAN_PHONE', label: 'Parent’s phone' },
  { value: 'ADDRESS', label: 'Home address' },
  { value: 'VALID_UNTIL', label: 'Valid until (end of the academic year)' },
  { value: 'QR', label: 'QR code (check the card online)' },
]
export const ID_CARD_ORIENTATIONS = [
  { value: 'PORTRAIT', label: 'Portrait — upright, 54 × 85.6 mm' },
  { value: 'LANDSCAPE', label: 'Landscape — sideways, 85.6 × 54 mm' },
]
/** A photo kept on the record: a small PNG / JPEG / WebP data URL (shrunk in the browser before upload). */
export const PHOTO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
export const PHOTO_MAX_CHARS = 280_000
