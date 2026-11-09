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

// ── The year plan: when each part of the syllabus is meant to be taught.
// A unit is spread over months fromMonth–toMonth (YYYY-MM); a topic may name its own month. A topic
// without one is due by the unit's last month. A topic is "behind" in a section once its month is
// over and it still isn't ticked.

/** The month (YYYY-MM) a topic should be finished by, or null when nothing is planned. */
export const topicMonth = (unit, topic) => topic?.month || unit?.toMonth || unit?.fromMonth || null

/**
 * The year plan against what a section has done, as of `month` (YYYY-MM, usually this month).
 *   byMonth  { 'YYYY-MM': [{ unitId, topicId, name, unit, done }] } — every planned topic under its month
 *   behind   topics whose month is over and still not taught
 *   due      topics planned for `month` itself, not taught yet
 *   planned  topics with a month at all
 */
export function yearPlan(units = [], done = [], month) {
  const set = done instanceof Set ? done : new Set(done.map(String))
  const byMonth = {}
  const behind = []
  const due = []
  let planned = 0
  for (const u of units) {
    for (const t of u.topics ?? []) {
      const m = topicMonth(u, t)
      if (!m) continue
      planned++
      const row = { unitId: String(u.id ?? u._id), topicId: String(t.id ?? t._id), name: t.name, unit: u.name, done: set.has(String(t.id ?? t._id)) }
      ;(byMonth[m] ??= []).push(row)
      if (row.done || !month) continue
      if (m < month) behind.push(row)
      else if (m === month) due.push(row)
    }
  }
  return { byMonth, behind, due, planned }
}

/**
 * A first draft of the year plan: spread the units over `months` (YYYY-MM, in order) in syllabus
 * order, each getting a share of months by its number of topics. Returns the units with
 * fromMonth / toMonth set; topic months are left alone.
 */
export function spreadUnits(units = [], months = []) {
  if (!months.length || !units.length) return units
  const weight = units.map((u) => Math.max(1, (u.topics ?? []).length))
  const total = weight.reduce((a, b) => a + b, 0)
  // unit i runs from boundary(i) to boundary(i + 1) - 1, so neighbours never share a month
  // (unless there are more units than months)
  const boundary = (n) => Math.round((n / total) * months.length)
  let before = 0
  return units.map((u, i) => {
    const start = Math.min(months.length - 1, boundary(before))
    before += weight[i]
    const end = Math.min(months.length - 1, Math.max(start, boundary(before) - 1))
    return { ...u, fromMonth: months[start], toMonth: months[end] }
  })
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
