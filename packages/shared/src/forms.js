// Form builder (engine E6): an institution designs its own forms — an admission section,
// a parent survey, a classroom-observation rubric — and staff or families fill them.
// A form is sections of fields; publishing freezes a numbered version, and every
// filled form keeps the version it was filled on, so old records always read right.
//
// Field keys are UPPER_SNAKE (e.g. WT, HT, BMI) so calculated fields can use them in
// formulas: "WT / ((HT / 100) * (HT / 100))".
import { evalFormula, formulaCodes } from './formula.js'

export const FORM_USES = [
  { value: 'ADMISSION', label: 'Admission form section', help: 'Extra questions on the online application and the admission desk.' },
  { value: 'SURVEY', label: 'Survey', help: 'Sent to parents, students or staff (Surveys & feedback).' },
  { value: 'ASSESSMENT', label: 'Assessment / rubric', help: 'A scored rubric: classroom observation, project or skill assessment.' },
  { value: 'HEALTH', label: 'Health record', help: 'Filled by the school nurse (Health & infirmary).' },
]
export const FORM_USE_LABEL = Object.fromEntries(FORM_USES.map((u) => [u.value, u.label]))

export const FORM_STATUSES = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
}

export const FIELD_TYPES = [
  { value: 'TEXT', label: 'Short text' },
  { value: 'TEXTAREA', label: 'Long text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'SELECT', label: 'Pick one' },
  { value: 'MULTI', label: 'Pick several' },
  { value: 'YESNO', label: 'Yes / no' },
  { value: 'SCORE', label: 'Scored question' },
  { value: 'CALC', label: 'Calculated' },
  { value: 'TOTAL', label: 'Score total' },
  { value: 'INFO', label: 'Note for the reader' },
]
export const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]))
/** Types the person filling in doesn't type into. */
export const COMPUTED_TYPES = ['CALC', 'TOTAL', 'INFO']

const KEY = /^[A-Z][A-Z0-9_]{0,23}$/
const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

export const formFields = (def) => (def?.sections ?? []).flatMap((s) => s.fields ?? [])

/** Is the field shown, given the answers so far? `showIf: { field, equals }` — equals may list several values. */
export function isVisible(field, values) {
  const c = field.showIf
  if (!c?.field) return true
  const want = [].concat(c.equals ?? '').map(String)
  const v = values?.[c.field]
  return Array.isArray(v) ? v.some((x) => want.includes(String(x))) : want.includes(String(v ?? ''))
}

/** Problems in a form design, as { 'sections.0.fields.2.key': 'message' }. Empty when it can be published. */
export function checkFormDefinition(def) {
  const errors = {}
  const sections = def?.sections ?? []
  if (!sections.length) errors.sections = 'Add at least one section'
  const seen = new Map()
  sections.forEach((s, si) => {
    if (!String(s.title ?? '').trim()) errors[`sections.${si}.title`] = 'Name the section'
    if (!(s.fields ?? []).length) errors[`sections.${si}.fields`] = 'Add at least one field'
    ;(s.fields ?? []).forEach((f, fi) => {
      const at = `sections.${si}.fields.${fi}`
      if (!KEY.test(f.key ?? '')) errors[`${at}.key`] = 'Use capitals, digits and _ (e.g. LMP_DATE), starting with a letter'
      else if (seen.has(f.key)) errors[`${at}.key`] = `Already used by “${seen.get(f.key).label}”`
      if (!FIELD_TYPE_LABEL[f.type]) errors[`${at}.type`] = 'Pick a field type'
      if (!String(f.label ?? '').trim()) errors[`${at}.label`] = 'Write the question or label'
      if (['SELECT', 'MULTI'].includes(f.type) && (f.options ?? []).filter((o) => String(o).trim()).length < 2) errors[`${at}.options`] = 'Give at least two choices'
      if (f.type === 'SCORE') {
        const opts = f.options ?? []
        if (opts.length < 2) errors[`${at}.options`] = 'Give at least two answers'
        else if (opts.some((o) => !String(o.label ?? '').trim() || !Number.isFinite(Number(o.points)))) errors[`${at}.options`] = 'Each answer needs words and points'
      }
      if (f.type === 'NUMBER' && f.min !== undefined && f.max !== undefined && f.min !== null && f.max !== null && Number(f.min) > Number(f.max)) errors[`${at}.max`] = 'Smaller than the minimum'
      if (f.type === 'CALC') {
        const codes = formulaCodes(f.formula)
        if (!codes.length) errors[`${at}.formula`] = 'Write a formula using other fields, e.g. WT / ((HT / 100) * (HT / 100))'
        const bad = codes.find((c) => !['NUMBER', 'CALC'].includes(seen.get(c)?.type))
        if (bad) errors[`${at}.formula`] = `${bad} is not a number field above this one`
        else if (codes.length && evalFormula(f.formula, Object.fromEntries(codes.map((c) => [c, 1]))) === null) errors[`${at}.formula`] = 'Only numbers, field codes and + − × ÷ ( ) are allowed'
      }
      if (f.type === 'TOTAL') {
        const scores = (f.of?.length ? f.of : [...seen.values()].filter((x) => x.type === 'SCORE').map((x) => x.key))
        if (!scores.length || scores.some((k) => seen.get(k)?.type !== 'SCORE')) errors[`${at}.of`] = 'Add scored questions above the total'
      }
      if (f.showIf?.field && !seen.has(f.showIf.field)) errors[`${at}.showIf`] = 'Show only after a field that comes earlier'
      if (f.key) seen.set(f.key, f)
    })
  })
  return errors
}

/** Answers with calculated fields and score totals filled in. */
export function computeForm(def, values = {}) {
  const out = { ...values }
  const fields = formFields(def)
  for (const f of fields) {
    if (f.type === 'CALC') {
      const v = evalFormula(f.formula, out)
      out[f.key] = v === null ? '' : String(Number(v.toFixed(f.decimals ?? 1)))
    }
    if (f.type === 'TOTAL') {
      const keys = f.of?.length ? f.of : fields.filter((x) => x.type === 'SCORE').map((x) => x.key)
      const answered = keys.filter((k) => !empty(out[k]))
      out[f.key] = answered.length ? String(answered.reduce((s, k) => s + Number(out[k]), 0)) : ''
    }
  }
  return out
}

/** The band a score total falls in: `bands: [{ min, max, label }]`. */
export function scoreBand(field, total) {
  if (total === '' || total === null || total === undefined) return null
  const n = Number(total)
  return (field.bands ?? []).find((b) => n >= Number(b.min ?? -Infinity) && n <= Number(b.max ?? Infinity)) ?? null
}

/** Check and clean answers against a design: { values, errors }. Hidden fields are dropped. */
export function validateFormValues(def, input = {}) {
  const values = {}
  const errors = {}
  for (const f of formFields(def)) {
    if (COMPUTED_TYPES.includes(f.type)) continue
    if (!isVisible(f, input)) continue
    const raw = input[f.key]
    if (empty(raw)) { if (f.required) errors[f.key] = `${f.label} is required`; continue }
    if (f.type === 'NUMBER') {
      const n = Number(raw)
      if (!Number.isFinite(n)) errors[f.key] = 'Enter a number'
      else if (f.min !== undefined && f.min !== null && f.min !== '' && n < Number(f.min)) errors[f.key] = `At least ${f.min}`
      else if (f.max !== undefined && f.max !== null && f.max !== '' && n > Number(f.max)) errors[f.key] = `At most ${f.max}`
      else values[f.key] = String(n)
    } else if (f.type === 'DATE') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors[f.key] = 'Enter a date'
      else values[f.key] = String(raw)
    } else if (f.type === 'SELECT') {
      if (!(f.options ?? []).includes(raw)) errors[f.key] = 'Pick one of the choices'
      else values[f.key] = raw
    } else if (f.type === 'MULTI') {
      const arr = [].concat(raw)
      if (!arr.every((v) => (f.options ?? []).includes(v))) errors[f.key] = 'Unknown choice'
      else values[f.key] = arr
    } else if (f.type === 'YESNO') {
      if (!['YES', 'NO'].includes(raw)) errors[f.key] = 'Answer yes or no'
      else values[f.key] = raw
    } else if (f.type === 'SCORE') {
      const n = Number(raw)
      if (!(f.options ?? []).some((o) => Number(o.points) === n)) errors[f.key] = 'Pick one of the answers'
      else values[f.key] = String(n)
    } else {
      values[f.key] = String(raw).slice(0, f.type === 'TEXTAREA' ? 4000 : 300)
    }
  }
  return { values: computeForm(def, values), errors }
}

/** Filled form as readable lines (print, past visits): [{ label, text }]. */
export function formSummary(def, values = {}) {
  const lines = []
  for (const f of formFields(def)) {
    if (f.type === 'INFO' || !isVisible(f, values)) continue
    const v = values[f.key]
    if (empty(v)) continue
    let text = Array.isArray(v) ? v.join(', ') : String(v)
    if (f.type === 'YESNO') text = v === 'YES' ? 'Yes' : 'No'
    if (f.type === 'SCORE') text = `${f.options?.find((o) => Number(o.points) === Number(v))?.label ?? v} (${v})`
    if (f.type === 'TOTAL') text = `${v}${scoreBand(f, v) ? ` — ${scoreBand(f, v).label}` : ''}`
    if ((f.type === 'NUMBER' || f.type === 'CALC') && f.unit) text = `${text} ${f.unit}`
    lines.push({ label: f.label, text, key: f.key })
  }
  return lines
}
