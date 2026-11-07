// Safe arithmetic on named values, for calculated form fields (BMI, totals):
// evalFormula('WT / ((HT / 100) * (HT / 100))', { WT: 40, HT: 150 }) → 17.8

/** Evaluate "MARKS / MAX * 100" with the entered values. Only numbers and + − × ÷ ( ) are allowed. */
export function evalFormula(formula, values) {
  let missing = false
  const expr = String(formula).replace(/[A-Z][A-Z0-9_]*/g, (code) => {
    const v = Number(values[code])
    if (values[code] === '' || values[code] === undefined || values[code] === null || !Number.isFinite(v)) { missing = true; return '0' }
    return `(${v})`
  })
  if (missing || !/^[\d\s.+\-*/()]+$/.test(expr)) return null
  try {
    // eslint-disable-next-line no-new-func
    const out = Function(`"use strict"; return (${expr})`)()
    return Number.isFinite(out) ? out : null
  } catch {
    return null
  }
}

/** Field codes a formula refers to — the form builder checks they exist. */
export const formulaCodes = (formula) => [...new Set(String(formula ?? '').match(/[A-Z][A-Z0-9_]*/g) ?? [])]
