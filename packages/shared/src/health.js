// Health & infirmary: a health record per student (blood group, growth, allergies, vaccinations — and, for those
// allowed, conditions, medicines and notes), sick-room visits (student or staff) and incident reports.

export const HEALTH_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/** Record fields only `health.records.view_sensitive` sees and changes. */
export const HEALTH_SENSITIVE = ['conditions', 'medications', 'emergencyNotes']

export const VISIT_OUTCOMES = {
  IN_ROOM: { label: 'In the sick room', tone: 'warning' },
  BACK_TO_CLASS: { label: 'Back to class', tone: 'success' },
  REST: { label: 'Resting', tone: 'info' },
  SENT_HOME: { label: 'Sent home', tone: 'violet' },
  REFERRED: { label: 'Referred to hospital', tone: 'danger' },
}
/** Visits that keep the person in the sick room (the "now" board). */
export const VISIT_IN_ROOM = ['IN_ROOM', 'REST']
/** How a visit can end. */
export const VISIT_CLOSE = ['BACK_TO_CLASS', 'SENT_HOME', 'REFERRED']

export const COMPLAINTS = ['FEVER', 'HEADACHE', 'STOMACH_ACHE', 'VOMITING', 'INJURY', 'COLD_COUGH', 'DIZZINESS', 'ALLERGY', 'OTHER']

export const PERSON_TYPES = ['STUDENT', 'STAFF']

export const INCIDENT_SEVERITY = {
  MINOR: { label: 'Minor', tone: 'success', rank: 1 },
  MODERATE: { label: 'Moderate', tone: 'warning', rank: 2 },
  SERIOUS: { label: 'Serious', tone: 'orange', rank: 3 },
  CRITICAL: { label: 'Critical', tone: 'danger', rank: 4 },
}
export const INCIDENT_STATUS = {
  OPEN: { label: 'Open', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
}
export const INCIDENT_KINDS = ['INJURY', 'FALL', 'SPORTS', 'FIGHT', 'ALLERGIC_REACTION', 'BURN', 'OTHER']
export const INFORMED_HOW = ['CALL', 'IN_PERSON', 'MESSAGE', 'APP']

/** Common school vaccinations (the list on a record can hold any name). */
export const VACCINES = ['BCG', 'Hepatitis B', 'OPV / IPV', 'DPT', 'MMR', 'Typhoid', 'Varicella', 'Hepatitis A', 'HPV', 'Tdap', 'Influenza', 'COVID-19']

/** Body-mass index from cm and kg, one decimal; null without both. */
export function bmi(heightCm, weightKg) {
  const h = Number(heightCm) / 100
  const w = Number(weightKg)
  if (!h || !w || h <= 0 || w <= 0) return null
  return Math.round((w / (h * h)) * 10) / 10
}

/** A rough BMI band (adult cut-offs; for children a growth chart is the real measure). */
export function bmiBand(value) {
  if (value == null) return null
  if (value < 18.5) return 'UNDER'
  if (value < 25) return 'NORMAL'
  if (value < 30) return 'OVER'
  return 'OBESE'
}
export const BMI_BANDS = {
  UNDER: { label: 'Under weight', tone: 'warning' },
  NORMAL: { label: 'Healthy', tone: 'success' },
  OVER: { label: 'Over weight', tone: 'warning' },
  OBESE: { label: 'Obese', tone: 'danger' },
}

/** Temperature check (°C): 'HIGH' from 38, 'MILD' from 37.5, else 'OK'; null when not taken. */
export function feverLevel(tempC) {
  const t = Number(tempC)
  if (!tempC || !t) return null
  if (t >= 38) return 'HIGH'
  if (t >= 37.5) return 'MILD'
  return 'OK'
}
