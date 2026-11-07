/**
 * One CSV cell, safe to open in Excel / Sheets. Text that starts with = + - @ (or a tab / CR)
 * is read as a formula there — a patient name like `=HYPERLINK("http://evil",…)` typed into
 * online booking would run when staff open the export. Such text gets a leading apostrophe;
 * plain numbers (including negative amounts, as numbers or as text like "-12.50") pass as they are.
 */
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
