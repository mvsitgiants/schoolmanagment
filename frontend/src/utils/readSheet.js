// Spreadsheet import helper shared by the master-data screens.

/** Parse a CSV or Excel sheet in the browser into row objects keyed by the header row. */
export async function readSheet(file) {
  let table
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsx } = await import('read-excel-file/browser')
    table = await readXlsx(file)
  } else {
    const text = await file.text()
    table = text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
      const out = []
      let cur = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"' && line[i + 1] === '"' && quoted) { cur += '"'; i++ } else if (ch === '"') quoted = !quoted
        else if (ch === ',' && !quoted) { out.push(cur); cur = '' } else cur += ch
      }
      out.push(cur)
      return out
    })
  }
  const [head, ...rest] = table
  const keys = head.map((h) => String(h).trim())
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] === null || r[i] === undefined ? '' : String(r[i]).trim()])))
}
