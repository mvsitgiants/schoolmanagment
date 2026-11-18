// Exams & report cards: lists and pure helpers shared by the API and the web app.
// An exam ("Half-yearly 2026") has a paper per class and subject; marks are entered per paper and
// section on a mark sheet, locked when final, and the results (totals, grades, rank) come from them.

export const EXAM_STATUS = {
  DRAFT: { label: 'Being set up', tone: 'neutral' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  PUBLISHED: { label: 'Results published', tone: 'success' },
}

export const SHEET_STATUS = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  OPEN: { label: 'In progress', tone: 'warning' },
  LOCKED: { label: 'Locked', tone: 'success' },
}

export const RESULT_STATUS = {
  PASS: { label: 'Pass', tone: 'success' },
  FAIL: { label: 'Needs to improve', tone: 'danger' },
  INCOMPLETE: { label: 'Marks missing', tone: 'warning' },
}

/** The exam types a new institution starts with (Exams › Exam setup). Weightage: share of the year's final result. */
export const STARTER_EXAM_TYPES = [
  { name: 'Unit test', code: 'UT', weightage: 10, defaultMaxMarks: 25 },
  { name: 'Periodic test', code: 'PT', weightage: 10, defaultMaxMarks: 40 },
  { name: 'Half-yearly', code: 'HY', weightage: 30, defaultMaxMarks: 80 },
  { name: 'Annual', code: 'AN', weightage: 50, defaultMaxMarks: 80 },
  { name: 'Pre-board', code: 'PB', weightage: 0, defaultMaxMarks: 80 },
]

// ───────────────────────────────────────────────────────── theory and practical
//
// A paper can be marked in parts — Theory 70 + Practical 30 (CBSE and state boards, classes 9–12), or Theory 80 +
// Internal assessment 20. Each part has its own maximum and pass marks; the paper's maximum is their sum, and a
// student passes the paper only by passing every part and reaching the paper's pass marks overall.

/** The usual ways to split a paper (Exams › paper setup › "In parts"). */
export const PAPER_PART_PRESETS = [
  { value: 'TH_PR', label: 'Theory + Practical', parts: [{ name: 'Theory', maxMarks: 70, passMarks: 23 }, { name: 'Practical', maxMarks: 30, passMarks: 10 }] },
  { value: 'TH_IA', label: 'Theory + Internal assessment', parts: [{ name: 'Theory', maxMarks: 80, passMarks: 26 }, { name: 'Internal assessment', maxMarks: 20, passMarks: 7 }] },
  { value: 'TH_PR_IA', label: 'Theory + Practical + Internal', parts: [{ name: 'Theory', maxMarks: 60, passMarks: 20 }, { name: 'Practical', maxMarks: 30, passMarks: 10 }, { name: 'Internal assessment', maxMarks: 10, passMarks: 0 }] },
]
export const MAX_PAPER_PARTS = 4
/** Stable keys for a paper's parts, by position: p1, p2 … (marks are stored under them). */
export const partKey = (i) => 'p' + (i + 1)
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

/** A marked-in-parts paper's parts with keys, or [] for a paper marked as one. */
export const partsOf = (paper) => (Array.isArray(paper?.parts) && paper.parts.length >= 2 ? paper.parts.map((p, i) => ({ ...p, key: p.key ?? partKey(i) })) : [])

/** The paper's total from its parts' marks, or null while any part is still blank. */
export function sumParts(entry, paper) {
  const parts = partsOf(paper)
  if (!parts.length) return num(entry?.marks)
  const values = parts.map((p) => num(entry?.parts?.[p.key]))
  return values.some((v) => v === null) ? null : Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100
}

/** The parts a student hasn't passed ([] when all are passed or the paper isn't in parts). */
export function failedParts(entry, paper) {
  return partsOf(paper).filter((p) => (Number(p.passMarks) || 0) > 0 && num(entry?.parts?.[p.key]) !== null && num(entry?.parts?.[p.key]) < Number(p.passMarks))
}

/** One student's entry on a paper: what counts towards the total. */
export function paperScore(entry, paper) {
  if (!entry || entry.exempt) return { counts: false, marks: null, absent: false, pass: true }
  if (entry.absent) return { counts: paper.countsInTotal !== false && !paper.gradeOnly, marks: 0, absent: true, pass: false }
  if (paper.gradeOnly) return { counts: false, marks: null, absent: false, pass: true, grade: entry.grade ?? null }
  const marks = partsOf(paper).length ? sumParts(entry, paper) : num(entry.marks)
  // in parts: pass every part (its own pass marks) and the paper overall
  const pass = marks === null ? false : marks >= (Number(paper.passMarks) || 0) && !failedParts(entry, paper).length
  return { counts: paper.countsInTotal !== false, marks, absent: false, pass }
}

const round2 = (n) => Math.round(n * 100) / 100

/**
 * A student's result over the papers of their class: total, out of, percentage, failed papers and
 * PASS / FAIL / INCOMPLETE (a paper with no marks yet). `round` rounds the total to whole marks.
 */
export function computeResult(papers, entriesByPaper, { round = true } = {}) {
  let total = 0
  let max = 0
  let missing = 0
  const failed = []
  for (const p of papers) {
    const s = paperScore(entriesByPaper[p.id], p)
    if (!entriesByPaper[p.id]) { if (!p.gradeOnly) missing++; continue }
    if (p.gradeOnly || !s.counts) continue
    if (s.marks === null) { missing++; continue }
    total += s.marks
    max += Number(p.maxMarks) || 0
    if (!s.pass) failed.push(p.id)
  }
  if (round) total = Math.round(total)
  const pct = max ? round2((total / max) * 100) : null
  const result = missing ? 'INCOMPLETE' : failed.length ? 'FAIL' : 'PASS'
  return { total: round2(total), max, pct, failed, missing, result }
}

/** Competition ranking (1, 2, 2, 4) by `key` descending; rows without a number get no rank. */
export function rankBy(rows, key = 'pct') {
  const ranked = rows.filter((r) => Number.isFinite(r[key])).sort((a, b) => b[key] - a[key])
  const out = new Map()
  ranked.forEach((r, i) => out.set(r, i > 0 && ranked[i - 1][key] === r[key] ? out.get(ranked[i - 1]) : i + 1))
  return rows.map((r) => out.get(r) ?? null)
}

/** Problems with one mark entry against its paper, or null. */
export function checkMark(entry, paper) {
  if (!entry || entry.absent || entry.exempt) return null
  if (paper.gradeOnly) return entry.grade && String(entry.grade).length > 4 ? 'Up to 4 characters' : null
  const parts = partsOf(paper)
  if (parts.length) {
    for (const p of parts) {
      const v = num(entry.parts?.[p.key])
      if (v === null) continue
      if (!Number.isFinite(v) || v < 0) return 'Enter 0 or more'
      if (v > Number(p.maxMarks)) return p.name + ': out of ' + p.maxMarks
    }
    return null
  }
  if (entry.marks === null || entry.marks === undefined || entry.marks === '') return null
  const n = Number(entry.marks)
  if (!Number.isFinite(n) || n < 0) return 'Enter 0 or more'
  if (n > Number(paper.maxMarks)) return `Out of ${paper.maxMarks}`
  return null
}

/** "09:30" + minutes → "11:00" */
export function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  const t = (h * 60 + m + Number(minutes || 0)) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Papers of one class that clash: same date, overlapping times. [[a, b], …] by index. */
export function clashes(papers) {
  const out = []
  for (let i = 0; i < papers.length; i++) {
    for (let j = i + 1; j < papers.length; j++) {
      const a = papers[i]
      const b = papers[j]
      if (!a.date || a.date !== b.date || !a.startTime || !b.startTime) continue
      if (a.startTime < (b.endTime || b.startTime) && b.startTime < (a.endTime || a.startTime)) out.push([i, j])
    }
  }
  return out
}
