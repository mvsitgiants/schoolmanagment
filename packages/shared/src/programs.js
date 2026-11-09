// Programs & OBE (module `programs`, higher education): lists and pure helpers shared by the API and the web app.
//
//   Regulation  the rule book a batch is admitted under (R2026): credits to graduate, credits per semester,
//               the grading scale with grade points, pass marks, internal-assessment components, GPA rules
//   Program     B.Tech CSE, MBA … — level, department, years, semesters, intake, its regulation, POs and PSOs
//   Course      a course of a program's curriculum: credits (L-T-P), type, semester, internal / external marks,
//               prerequisites, course outcomes (COs) and the CO–PO mapping (0–3)
//
// Grading follows the UGC CBCS guidelines: a 10-point scale (O, A+, A, B+, B, C, P, F, Ab), SGPA = Σ(Ci × Gi) / ΣCi
// over the semester's courses, CGPA = the same over every course's latest attempt.

export const PROGRAM_LEVELS = {
  UG: { label: 'Undergraduate', years: 3 },
  PG: { label: 'Postgraduate', years: 2 },
  DIPLOMA: { label: 'Diploma', years: 3 },
}

export const PROGRAM_COURSE_TYPES = {
  CORE: { label: 'Core', tone: 'brand' },
  ELECTIVE: { label: 'Elective', tone: 'violet' },
  OPEN_ELECTIVE: { label: 'Open elective', tone: 'sky' },
  LAB: { label: 'Lab / practical', tone: 'teal' },
  PROJECT: { label: 'Project', tone: 'orange' },
}
/** Electives are picked at registration; the rest are taken by everyone in the semester. */
export const isElectiveType = (type) => type === 'ELECTIVE' || type === 'OPEN_ELECTIVE'

export const ENROLMENT_STATUS = {
  ACTIVE: { label: 'Studying', tone: 'success' },
  DETAINED: { label: 'Detained', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'info' },
  DISCONTINUED: { label: 'Discontinued', tone: 'neutral' },
}

/** Bloom's taxonomy levels a course outcome is written at. */
export const OBE_BLOOM_LEVELS = [
  { value: 'L1', label: 'Remember' },
  { value: 'L2', label: 'Understand' },
  { value: 'L3', label: 'Apply' },
  { value: 'L4', label: 'Analyse' },
  { value: 'L5', label: 'Evaluate' },
  { value: 'L6', label: 'Create' },
]

/** CO–PO correlation: 0 none, 1 low, 2 medium, 3 high. */
export const CO_PO_STRENGTH = [0, 1, 2, 3]

/** The twelve NBA graduate attributes — a starting point for an engineering program's POs. */
export const NBA_PROGRAM_OUTCOMES = [
  { code: 'PO1', title: 'Engineering knowledge' },
  { code: 'PO2', title: 'Problem analysis' },
  { code: 'PO3', title: 'Design / development of solutions' },
  { code: 'PO4', title: 'Conduct investigations of complex problems' },
  { code: 'PO5', title: 'Modern tool usage' },
  { code: 'PO6', title: 'The engineer and society' },
  { code: 'PO7', title: 'Environment and sustainability' },
  { code: 'PO8', title: 'Ethics' },
  { code: 'PO9', title: 'Individual and team work' },
  { code: 'PO10', title: 'Communication' },
  { code: 'PO11', title: 'Project management and finance' },
  { code: 'PO12', title: 'Life-long learning' },
]

/** UGC CBCS 10-point letter grades: % band → grade point. `pass: false` grades are a fail (arrear). */
export const UGC_GRADE_SCALE = [
  { grade: 'O', min: 90, max: 100, points: 10, label: 'Outstanding', pass: true },
  { grade: 'A+', min: 80, max: 89.99, points: 9, label: 'Excellent', pass: true },
  { grade: 'A', min: 70, max: 79.99, points: 8, label: 'Very good', pass: true },
  { grade: 'B+', min: 60, max: 69.99, points: 7, label: 'Good', pass: true },
  { grade: 'B', min: 50, max: 59.99, points: 6, label: 'Above average', pass: true },
  { grade: 'C', min: 45, max: 49.99, points: 5, label: 'Average', pass: true },
  { grade: 'P', min: 40, max: 44.99, points: 4, label: 'Pass', pass: true },
  { grade: 'F', min: 0, max: 39.99, points: 0, label: 'Fail', pass: false },
]
export const ABSENT_GRADE = 'Ab'

/** Continuous internal assessment components a new regulation starts with (marks out of `maxMarks`). */
export const DEFAULT_IA_COMPONENTS = [
  { code: 'CIA1', name: 'Internal test 1', maxMarks: 20 },
  { code: 'CIA2', name: 'Internal test 2', maxMarks: 20 },
  { code: 'ASG', name: 'Assignment', maxMarks: 5 },
  { code: 'ATT', name: 'Attendance', maxMarks: 5 },
]

/** Final classification on the transcript from the CGPA (highest first). */
export const DEFAULT_CLASSIFICATION = [
  { min: 7.5, label: 'First class with distinction' },
  { min: 6, label: 'First class' },
  { min: 5, label: 'Second class' },
  { min: 0, label: 'Pass' },
]

/** CO attainment: the % of students reaching the target that earns each level (highest first). */
export const DEFAULT_ATTAINMENT_LEVELS = [
  { level: 3, min: 70 },
  { level: 2, min: 60 },
  { level: 1, min: 50 },
]

/** A ready-made UGC CBCS regulation: Programs › Regulations › "Start from the UGC CBCS template". */
export const UGC_CBCS_REGULATION = {
  name: 'UGC CBCS',
  minCredits: 160,
  semesterMinCredits: 16,
  semesterMaxCredits: 28,
  gradeScale: UGC_GRADE_SCALE,
  passRules: { minInternalPct: 0, minExternalPct: 40, minTotalPct: 40 },
  iaComponents: DEFAULT_IA_COMPONENTS,
  gpa: { countFailed: true, decimals: 2, pctMultiplier: 10 },
  classification: DEFAULT_CLASSIFICATION,
  attainment: { targetPct: 60, levels: DEFAULT_ATTAINMENT_LEVELS, internalWeight: 30 },
}

const round = (n, d = 2) => Math.round((Number(n) + Number.EPSILON) * 10 ** d) / 10 ** d

/** Suggested credits from the weekly hours: lecture and tutorial 1 each, practical ½. */
export const creditsFromLtp = (l = 0, t = 0, p = 0) => round((Number(l) || 0) + (Number(t) || 0) + (Number(p) || 0) / 2, 1)

/** The band a percentage falls in, on a regulation's scale (highest band first wins). */
export function scaleGradeFor(scale = UGC_GRADE_SCALE, pct) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null
  const v = Number(pct)
  const sorted = [...scale].sort((a, b) => b.min - a.min)
  return sorted.find((b) => v >= b.min) ?? sorted.at(-1) ?? null
}

/** Problems with a grading scale (field → message): bands from 0 to 100 with no gaps, one passing band at least. */
export function checkGradeScale(scale = []) {
  const errors = {}
  if (!scale.length) return { gradeScale: 'Add the grades' }
  const sorted = [...scale].map((b, i) => ({ ...b, i })).sort((a, b) => a.min - b.min)
  if (sorted[0].min > 0) errors.gradeScale = 'The lowest grade must start at 0%'
  const seen = new Set()
  for (const b of sorted) {
    if (!String(b.grade ?? '').trim()) errors[`gradeScale.${b.i}.grade`] = 'Name the grade'
    if (seen.has(b.grade)) errors[`gradeScale.${b.i}.grade`] = 'Used twice'
    seen.add(b.grade)
    if (!(Number(b.max) >= Number(b.min))) errors[`gradeScale.${b.i}.max`] = 'Up to must be at least From'
    if (!(Number(b.points) >= 0 && Number(b.points) <= 10)) errors[`gradeScale.${b.i}.points`] = '0 to 10'
  }
  if (!scale.some((b) => b.pass !== false && Number(b.points) > 0)) errors.gradeScale = 'At least one grade must be a pass'
  return errors
}

/**
 * A course's result for one attempt, by the regulation.
 *   internal / external — marks obtained (null: not entered); absent — missed the end-semester exam
 * → { total, max, pct, grade, points, pass, reason } — reason: why it is a fail ('ABSENT' · 'INTERNAL' · 'EXTERNAL' · 'TOTAL' · 'GRADE')
 */
export function courseResultOf({ internal, internalMax, external, externalMax, absent = false }, regulation = UGC_CBCS_REGULATION) {
  const scale = regulation.gradeScale?.length ? regulation.gradeScale : UGC_GRADE_SCALE
  const rules = { minInternalPct: 0, minExternalPct: 0, minTotalPct: 0, ...(regulation.passRules ?? {}) }
  const iMax = Number(internalMax) || 0
  const eMax = Number(externalMax) || 0
  const i = Number(internal) || 0
  const e = absent ? 0 : Number(external) || 0
  const total = round(i + e)
  const max = iMax + eMax
  const pct = max ? round((total / max) * 100) : 0
  if (absent && eMax) return { total, max, pct, grade: ABSENT_GRADE, points: 0, pass: false, reason: 'ABSENT' }
  const band = scaleGradeFor(scale, pct)
  let reason = null
  if (iMax && (i / iMax) * 100 < rules.minInternalPct) reason = 'INTERNAL'
  else if (eMax && (e / eMax) * 100 < rules.minExternalPct) reason = 'EXTERNAL'
  else if (pct < rules.minTotalPct) reason = 'TOTAL'
  else if (band && band.pass === false) reason = 'GRADE'
  if (reason) {
    const fail = [...scale].sort((a, b) => a.min - b.min).find((b) => b.pass === false) ?? { grade: 'F', points: 0 }
    return { total, max, pct, grade: fail.grade, points: 0, pass: false, reason }
  }
  return { total, max, pct, grade: band?.grade ?? null, points: Number(band?.points) || 0, pass: true, reason: null }
}

/**
 * Grade point average over course results [{ credits, points, pass }]: Σ(credits × points) / Σcredits.
 * `countFailed` (UGC): a failed course counts with 0 points; otherwise only passed courses count.
 */
export function gradePointAverage(rows = [], { countFailed = true, decimals = 2 } = {}) {
  let credits = 0
  let weighted = 0
  for (const r of rows) {
    if (!countFailed && !r.pass) continue
    const c = Number(r.credits) || 0
    credits += c
    weighted += c * (r.pass ? Number(r.points) || 0 : 0)
  }
  return credits ? round(weighted / credits, decimals) : null
}

/**
 * CGPA over every attempt [{ courseId, credits, points, pass, attempt|order }]: the latest attempt of each course counts
 * (a supplementary pass replaces the failed one). → { cgpa, creditsEarned, creditsCounted, arrears: [courseId] }
 */
export function cumulativeGpa(attempts = [], opts = {}) {
  const latest = new Map()
  for (const a of attempts) {
    const k = String(a.courseId)
    const prev = latest.get(k)
    if (!prev || (a.order ?? a.attempt ?? 0) >= (prev.order ?? prev.attempt ?? 0)) latest.set(k, a)
  }
  const rows = [...latest.values()]
  return {
    cgpa: gradePointAverage(rows, opts),
    creditsEarned: rows.filter((r) => r.pass).reduce((n, r) => n + (Number(r.credits) || 0), 0),
    creditsCounted: rows.reduce((n, r) => n + (Number(r.credits) || 0), 0),
    arrears: rows.filter((r) => !r.pass).map((r) => String(r.courseId)),
  }
}

/** "First class with distinction" … from the CGPA. */
export function classificationOf(cgpa, classes = DEFAULT_CLASSIFICATION) {
  if (cgpa === null || cgpa === undefined) return null
  return [...classes].sort((a, b) => b.min - a.min).find((c) => Number(cgpa) >= c.min)?.label ?? null
}

/** Attainment level (0–3) for the % of students who reached the target. */
export function attainmentLevelOf(pctReached, levels = DEFAULT_ATTAINMENT_LEVELS) {
  if (pctReached === null || pctReached === undefined) return null
  return [...levels].sort((a, b) => b.min - a.min).find((l) => Number(pctReached) >= l.min)?.level ?? 0
}

/**
 * Direct CO attainment: the internal and external levels weighted (`internalWeight` % internal, the rest external).
 * Either side missing → the other alone.
 */
export function directAttainment(internalLevel, externalLevel, internalWeight = 30) {
  const hasI = internalLevel !== null && internalLevel !== undefined
  const hasE = externalLevel !== null && externalLevel !== undefined
  if (!hasI && !hasE) return null
  if (!hasI) return round(externalLevel)
  if (!hasE) return round(internalLevel)
  const w = Math.max(0, Math.min(100, Number(internalWeight) || 0)) / 100
  return round(internalLevel * w + externalLevel * (1 - w))
}

/**
 * PO attainment from CO attainments and the CO–PO matrix: for each PO, Σ(CO attainment × strength) / Σ strength over
 * the COs mapped to it. `cos` [{ key, attainment }], `mapping` [{ co: key, po, level }] → { [po]: value | null }
 */
export function poAttainmentOf(cos = [], mapping = [], poCodes = []) {
  const att = new Map(cos.map((c) => [c.key, c.attainment]))
  const out = {}
  for (const po of poCodes) {
    let w = 0
    let sum = 0
    for (const m of mapping) {
      if (m.po !== po || !(m.level > 0)) continue
      const a = att.get(m.co)
      if (a === null || a === undefined) continue
      w += m.level
      sum += a * m.level
    }
    out[po] = w ? round(sum / w) : null
  }
  return out
}

/** Internal marks scaled to the course's internal maximum from the components entered. */
export function internalTotalOf(components = {}, iaComponents = DEFAULT_IA_COMPONENTS, internalMax = 0) {
  let got = 0
  let max = 0
  let any = false
  for (const c of iaComponents) {
    max += Number(c.maxMarks) || 0
    const v = components?.[c.code]
    if (v === null || v === undefined || v === '') continue
    any = true
    got += Number(v) || 0
  }
  if (!any) return null
  if (!max || !internalMax) return round(got)
  return round((got / max) * internalMax)
}
