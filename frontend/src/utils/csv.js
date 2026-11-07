/**
 * Saves rows as a CSV the browser downloads. `rows` is an array of arrays; the first row is
 * usually the header. Values are escaped, so commas, quotes and newlines survive the trip.
 *
 *   downloadCsv('headcount.csv', [['Department', 'People'], ...byDept.map(d => [d.department, d.count])])
 */
export function downloadCsv(filename, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob([rows.map((r) => r.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
