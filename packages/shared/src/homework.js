// Homework & lessons: lists and pure helpers shared by the API and the web app.
// A class's syllabus for a subject is a list of units, each with topics; each section ticks topics
// off as they are taught (from a lesson plan or directly). Homework is set per section and subject;
// the teacher records who submitted it.

export const SUBMISSION_STATUS = {
  PENDING: { label: 'Not yet', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  LATE: { label: 'Submitted late', tone: 'warning' },
  CHECKED: { label: 'Checked', tone: 'success' },
  MISSING: { label: 'Not done', tone: 'danger' },
}
export const SUBMISSION_STATUSES = Object.keys(SUBMISSION_STATUS)

export const LESSON_STATUS = {
  PLANNED: { label: 'Planned', tone: 'info' },
  DONE: { label: 'Taught', tone: 'success' },
  SKIPPED: { label: 'Not taken', tone: 'neutral' },
}

/** Counts of a homework's entries by status, for `total` students. Students with no entry are PENDING. */
export function submissionCounts(entries = [], total = entries.length) {
  const out = Object.fromEntries(SUBMISSION_STATUSES.map((s) => [s, 0]))
  for (const e of entries) if (out[e.status] !== undefined) out[e.status]++
  out.PENDING += Math.max(0, total - entries.length)
  out.total = total
  out.handedIn = out.SUBMITTED + out.LATE + out.CHECKED
  return out
}

/** How much of a syllabus is done: per unit and overall. `done` is a Set (or array) of topic ids. */
export function syllabusProgress(units = [], done = []) {
  const set = done instanceof Set ? done : new Set(done.map(String))
  let topics = 0
  let finished = 0
  const perUnit = units.map((u) => {
    const ids = (u.topics ?? []).map((t) => String(t.id ?? t._id))
    const n = ids.filter((id) => set.has(id)).length
    topics += ids.length
    finished += n
    return { id: String(u.id ?? u._id), topics: ids.length, done: n, pct: ids.length ? Math.round((n / ids.length) * 100) : 0 }
  })
  return { topics, done: finished, pct: topics ? Math.round((finished / topics) * 100) : 0, perUnit }
}

/** Monday–Sunday of the week a YYYY-MM-DD date falls in. */
export function weekOf(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  const from = new Date(d.getTime() - day * 864e5).toISOString().slice(0, 10)
  const to = new Date(d.getTime() + (6 - day) * 864e5).toISOString().slice(0, 10)
  return { from, to }
}

/** Turn a pasted list into units and topics: a line starting with "#" or ending with ":" starts a unit. */
export function parseSyllabusText(text = '') {
  const units = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#') || line.endsWith(':')) {
      const name = line.replace(/^#+\s*/, '').replace(/:$/, '').trim()
      if (name) units.push({ name, topics: [] })
      continue
    }
    const topic = line.replace(/^([-*•]|\d+[.)])\s*/, '').trim()
    if (!topic) continue
    if (!units.length) units.push({ name: 'Unit 1', topics: [] })
    units.at(-1).topics.push({ name: topic })
  }
  return units
}
