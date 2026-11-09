// Year-end result: every published exam of the year combined by its exam type's weightage (Exams › Exam setup).
// A subject's final % = Σ weight × that type's % ÷ Σ weights of the types the student has a mark in; several exams of
// one type (Unit test 1, 2, 3) are averaged, or the best one taken. Until every weighted type has a published exam the
// result is provisional ("so far"), with the weights scaled up over what there is.

export const YEAR_COMBINE = {
  AVERAGE: { label: 'Average them' },
  BEST: { label: 'Take the best one' },
}

export const YEAR_RESULT = {
  PASS: { label: 'Pass', tone: 'success' },
  COMPARTMENT: { label: 'Compartment', tone: 'warning' },
  FAIL: { label: 'Needs to improve', tone: 'danger' },
  INCOMPLETE: { label: 'Marks missing', tone: 'neutral' },
}

export const YEAR_STATUS = {
  OPEN: { label: 'So far', tone: 'info' },
  PUBLISHED: { label: 'Published', tone: 'success' },
}

const round2 = (n) => Math.round(n * 100) / 100

/**
 * The weighting for a class: one row per exam type with a weightage, the published exams of that type, and its share
 * of 100 over the types that have an exam. `missing` = weighted types with no published exam yet (→ provisional).
 *   types: [{ id, code, name, weightage }] · exams: [{ id, name, typeId }]
 */
export function weightPlan(types, exams) {
  const rows = types.filter((t) => Number(t.weightage) > 0).map((t) => ({
    typeId: String(t.id), code: t.code, name: t.name, weight: Number(t.weightage),
    exams: exams.filter((e) => String(e.typeId) === String(t.id)).map((e) => ({ id: String(e.id), name: e.name })),
  }))
  const used = rows.filter((r) => r.exams.length)
  const sum = used.reduce((n, r) => n + r.weight, 0)
  for (const r of rows) r.share = r.exams.length && sum ? round2((r.weight / sum) * 100) : 0
  return { rows, missing: rows.filter((r) => !r.exams.length).map((r) => r.code), provisional: rows.some((r) => !r.exams.length), total: rows.reduce((n, r) => n + r.weight, 0) }
}

/** One score on one paper as a % (null: no mark yet / exempt / grade-only). Absent counts as 0. */
export function paperPct(entry, paper) {
  if (!entry || entry.exempt || paper.gradeOnly || paper.countsInTotal === false || !Number(paper.maxMarks)) return null
  if (entry.absent) return 0
  if (entry.marks === null || entry.marks === undefined || entry.marks === '') return null
  return (Number(entry.marks) / Number(paper.maxMarks)) * 100
}

/**
 * One student's year: `scores` = { [subjectId]: { [examId]: pct } }. Returns per subject the % per exam type, the
 * weighted final and pass / fail, then the overall % (subjects counted equally), failed subjects and the result.
 */
export function yearResultFor(scores, plan, { combine = 'AVERAGE', passPct = 33, compartmentMax = 2, subjects = [] } = {}) {
  const out = []
  for (const s of subjects) {
    const byExam = scores[s.id] ?? {}
    const parts = []
    for (const r of plan.rows) {
      const vals = r.exams.map((e) => byExam[e.id]).filter((v) => v !== null && v !== undefined)
      if (!vals.length) { parts.push({ code: r.code, pct: null }); continue }
      const v = combine === 'BEST' ? Math.max(...vals) : vals.reduce((n, x) => n + x, 0) / vals.length
      parts.push({ code: r.code, pct: round2(v), weight: r.weight })
    }
    const have = parts.filter((p) => p.pct !== null)
    const w = have.reduce((n, p) => n + p.weight, 0)
    const pct = w ? round2(have.reduce((n, p) => n + p.pct * p.weight, 0) / w) : null
    out.push({ subjectId: s.id, subject: s.name, parts: parts.map(({ code, pct: p }) => ({ code, pct: p })), pct, pass: pct === null ? null : pct >= passPct })
  }
  const counted = out.filter((x) => x.pct !== null)
  const pct = counted.length ? round2(counted.reduce((n, x) => n + x.pct, 0) / counted.length) : null
  const failed = counted.filter((x) => !x.pass).map((x) => x.subject)
  const missing = out.length - counted.length
  const result = !counted.length || missing ? 'INCOMPLETE' : !failed.length ? 'PASS' : failed.length <= compartmentMax ? 'COMPARTMENT' : 'FAIL'
  return { subjects: out, pct, failed, missing, result }
}
