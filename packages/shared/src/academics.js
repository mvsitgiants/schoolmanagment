// Academic setup: the structure every other academic module hangs off — academic years and
// terms, classes and their sections (per year and campus), subjects, grading schemes and which
// teacher teaches what. Shared by the API (validation, starter data) and the web app.

export const YEAR_STATUSES = {
  PLANNED: { label: 'Planned', tone: 'info' },
  ACTIVE: { label: 'Current', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}

export const SUBJECT_TYPES = [
  { value: 'THEORY', label: 'Theory' },
  { value: 'PRACTICAL', label: 'Practical / lab' },
  { value: 'LANGUAGE', label: 'Language' },
  { value: 'ACTIVITY', label: 'Activity / co-scholastic' },
]
export const SUBJECT_TYPE_LABEL = Object.fromEntries(SUBJECT_TYPES.map((t) => [t.value, t.label]))

export const GRADING_KINDS = [
  { value: 'GRADES', label: 'Grades from percentage' },
  { value: 'GPA', label: 'Grade points (GPA / CGPA)' },
]

/** CBSE-style 9-point scale (percentage → grade), the starting scheme of every new institution. */
export const DEFAULT_GRADING_BANDS = [
  { min: 91, max: 100, grade: 'A1', points: 10, remark: 'Outstanding' },
  { min: 81, max: 90.99, grade: 'A2', points: 9, remark: 'Excellent' },
  { min: 71, max: 80.99, grade: 'B1', points: 8, remark: 'Very good' },
  { min: 61, max: 70.99, grade: 'B2', points: 7, remark: 'Good' },
  { min: 51, max: 60.99, grade: 'C1', points: 6, remark: 'Above average' },
  { min: 41, max: 50.99, grade: 'C2', points: 5, remark: 'Average' },
  { min: 33, max: 40.99, grade: 'D', points: 4, remark: 'Pass' },
  { min: 0, max: 32.99, grade: 'E', points: 0, remark: 'Needs improvement' },
]

/**
 * The band a percentage falls in: the highest band whose minimum it reaches, so fractional
 * marks never fall in the gap between 32.99 and 33. Null for no number or below every band.
 */
export function gradeFor(bands = [], pct) {
  const n = Number(pct)
  if (!Number.isFinite(n) || pct === '' || pct === null) return null
  return [...bands].sort((a, b) => Number(b.min) - Number(a.min)).find((b) => n >= Number(b.min)) ?? null
}

/**
 * Problems in a band list, keyed by row (`bands.<i>.<field>`) or `bands` for the whole list:
 * every band needs a grade and min ≤ max inside 0–100, and no two bands may overlap.
 */
export function checkGradingBands(bands = []) {
  const errors = {}
  if (!bands.length) errors.bands = 'Add at least one grade'
  bands.forEach((b, i) => {
    if (!String(b.grade ?? '').trim()) errors[`bands.${i}.grade`] = 'Enter the grade'
    const min = Number(b.min)
    const max = Number(b.max)
    if (!Number.isFinite(min) || min < 0 || min > 100) errors[`bands.${i}.min`] = '0 to 100'
    if (!Number.isFinite(max) || max < 0 || max > 100) errors[`bands.${i}.max`] = '0 to 100'
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) errors[`bands.${i}.max`] = 'Must be at least the minimum'
  })
  const sorted = bands.map((b, i) => ({ ...b, i, min: Number(b.min), max: Number(b.max) })).sort((a, b) => a.min - b.min)
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].min <= sorted[k - 1].max) errors[`bands.${sorted[k].i}.min`] = `Overlaps grade ${sorted[k - 1].grade || k}`
  }
  return errors
}

/**
 * The academic year a date falls in, for a year that starts in `startMonth` (1–12):
 * ('2026-11-07', 4) → { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }.
 */
export function academicYearFor(ymd, startMonth = 4) {
  const [y, m] = String(ymd).split('-').map(Number)
  const startYear = m >= startMonth ? y : y - 1
  const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 0)).toISOString().slice(0, 10)
  const name = startMonth === 1 ? String(startYear) : `${startYear}-${String(startYear + 1).slice(2)}`
  return { name, startDate: start, endDate }
}

/** Two equal terms inside a year (the starter split; institutions edit it). */
export function defaultTerms({ startDate, endDate }) {
  const s = Date.parse(`${startDate}T00:00:00Z`)
  const e = Date.parse(`${endDate}T00:00:00Z`)
  const mid = new Date(s + Math.floor((e - s) / 2 / 864e5) * 864e5)
  const midYmd = mid.toISOString().slice(0, 10)
  const next = new Date(mid.getTime() + 864e5).toISOString().slice(0, 10)
  return [
    { name: 'Term 1', startDate, endDate: midYmd },
    { name: 'Term 2', startDate: next, endDate },
  ]
}

/** Problems with a year's dates and terms, keyed like a form (`startDate`, `terms.<i>.endDate` …). */
export function checkYearDates({ startDate, endDate, terms = [] }) {
  const errors = {}
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  if (!ymd.test(startDate ?? '')) errors.startDate = 'Enter the first day'
  if (!ymd.test(endDate ?? '')) errors.endDate = 'Enter the last day'
  if (!errors.startDate && !errors.endDate && startDate >= endDate) errors.endDate = 'Must be after the first day'
  const sorted = terms.map((t, i) => ({ ...t, i })).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
  sorted.forEach((t, k) => {
    if (!String(t.name ?? '').trim()) errors[`terms.${t.i}.name`] = 'Name the term'
    if (!ymd.test(t.startDate ?? '')) errors[`terms.${t.i}.startDate`] = 'Enter the first day'
    if (!ymd.test(t.endDate ?? '')) errors[`terms.${t.i}.endDate`] = 'Enter the last day'
    if (ymd.test(t.startDate ?? '') && ymd.test(t.endDate ?? '')) {
      if (t.startDate > t.endDate) errors[`terms.${t.i}.endDate`] = 'Must be after its first day'
      if (startDate && t.startDate < startDate) errors[`terms.${t.i}.startDate`] = 'Before the year starts'
      if (endDate && t.endDate > endDate) errors[`terms.${t.i}.endDate`] = 'After the year ends'
      if (k > 0 && t.startDate <= sorted[k - 1].endDate) errors[`terms.${t.i}.startDate`] = `Overlaps ${sorted[k - 1].name || 'the term before'}`
    }
  })
  return errors
}

/** "Class 8 – A"; `short` gives "8-A" from the class code. */
export const sectionLabel = (cls, section, { short = false } = {}) => (short
  ? `${cls?.code ?? ''}-${section?.name ?? ''}`
  : `${cls?.name ?? ''} – ${section?.name ?? ''}`)

// ───────────────────────────────────────────────────────── quick setup presets

/** Ready-made class lists for Academic setup › Classes › Quick setup. `order` sorts them. */
export const CLASS_PRESETS = [
  {
    value: 'K12', label: 'Pre-primary to Class 12',
    classes: [['Nursery', 'NUR'], ['LKG', 'LKG'], ['UKG', 'UKG'], ...Array.from({ length: 12 }, (_, i) => [`Class ${i + 1}`, String(i + 1)])],
  },
  {
    value: 'PRIMARY', label: 'Pre-primary to Class 5',
    classes: [['Nursery', 'NUR'], ['LKG', 'LKG'], ['UKG', 'UKG'], ...Array.from({ length: 5 }, (_, i) => [`Class ${i + 1}`, String(i + 1)])],
  },
  {
    value: 'SECONDARY', label: 'Class 1 to Class 10',
    classes: Array.from({ length: 10 }, (_, i) => [`Class ${i + 1}`, String(i + 1)]),
  },
  {
    value: 'SENIOR', label: 'Class 11 and 12',
    classes: [['Class 11', '11'], ['Class 12', '12']],
  },
]
export const CLASS_PRESET_BY = Object.fromEntries(CLASS_PRESETS.map((p) => [p.value, p]))

/** Common subjects of Indian schools, added by Quick setup when asked. */
export const SUBJECT_PRESET = [
  ['English', 'ENG', 'LANGUAGE'], ['Hindi', 'HIN', 'LANGUAGE'], ['Mathematics', 'MATH', 'THEORY'], ['Science', 'SCI', 'THEORY'],
  ['Social Science', 'SST', 'THEORY'], ['Environmental Studies', 'EVS', 'THEORY'], ['Computer Science', 'CS', 'PRACTICAL'],
  ['Physical Education', 'PE', 'ACTIVITY'], ['Art & Craft', 'ART', 'ACTIVITY'], ['Music', 'MUS', 'ACTIVITY'],
  ['Physics', 'PHY', 'THEORY'], ['Chemistry', 'CHEM', 'THEORY'], ['Biology', 'BIO', 'THEORY'],
]

/** Section names A, B, C … for the first `n` sections. */
export const sectionNames = (n) => Array.from({ length: Math.max(0, Math.min(26, n)) }, (_, i) => String.fromCharCode(65 + i))
