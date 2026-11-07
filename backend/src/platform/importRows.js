// Shared by the master-data imports: a file row ({ column: text }) checked against the same zod
// schema the add/edit form uses, so an imported record obeys the same rules as a typed one.

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
export const cell = str

/** "yes" / "true" / "1" / "y" → true; "no" / "false" / "0" / "n" → false; blank → undefined. */
export function yesNo(v) {
  const s = str(v).toLowerCase()
  if (!s) return undefined
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return v
}

/** Blank cells are left out (so the schema's defaults apply) rather than sent as "". */
export const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))

/**
 * Check one row: `shape(fields)` maps the file's columns onto the schema's input; the result is
 * { doc, errors } where errors are [{ field, message }] named by file column (`columnOf`).
 */
export function checkRow(schema, input, columnOf = {}) {
  const r = schema.safeParse(input)
  if (r.success) return { doc: r.data, errors: [] }
  return { doc: null, errors: r.error.issues.map((i) => ({ field: columnOf[i.path[0]] ?? String(i.path[0] ?? ''), message: i.message })) }
}

/** YYYY-MM from "2027-03", "03/2027", "3-2027" or "Mar-27"; null otherwise. */
export function parseMonth(v) {
  const s = str(v)
  let m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, '0')}` : null
  m = s.match(/^(\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) { const y = m[2].length === 2 ? `20${m[2]}` : m[2]; return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${y}-${m[1].padStart(2, '0')}` : null }
  m = s.match(/^([A-Za-z]{3})[\s/.-]?(\d{2}|\d{4})$/)
  if (m) {
    const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase())
    if (i < 0) return null
    return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(i + 1).padStart(2, '0')}`
  }
  return null
}

/** Rupees in a cell ("₹1,250.50", "1250") → paise; NaN when it isn't a number. */
export const paiseOf = (v) => Math.round(Number(str(v).replace(/[₹,\s]/g, '')) * 100)
