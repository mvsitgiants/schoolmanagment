// Homework & lessons: lists and pure helpers shared by the API and the web app.
// A class's syllabus for a subject is a list of units, each with topics; each section ticks topics
// off as they are taught (from a lesson plan or directly). Homework is set per section and subject;
// the teacher records who submitted it.
import { addDaysYmd } from './dates.js'

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

// ── Topics per section: content, planned dates, how far each section has got.
// A topic carries the teacher's material (book reference, how to teach it, questions and answers,
// a homework suggestion), shared by every section of the class. Each section has its own planned
// date for a topic, worked out from the unit's months and the subject's periods in the timetable.

export const TOPIC_STATUS = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  PARTLY: { label: 'Partly taught', tone: 'warning' },
  TAUGHT: { label: 'Taught', tone: 'success' },
}
export const TOPIC_STATUSES = Object.keys(TOPIC_STATUS)
export const QUESTION_KINDS = ['SHORT', 'LONG', 'MCQ']
export const QUESTION_USES = ['CLASS', 'HOMEWORK']

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const codeOf = (ymd) => DAY_CODES[new Date(`${ymd}T12:00:00Z`).getUTCDay()]
const lastOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/**
 * The days a subject is taught between two dates, each date once per period that day.
 *   weekly       { MON: 2, WED: 1 } from the timetable; empty or null = one a day on the working days.
 *                weekly._adjust { 'YYYY-MM-DD': ±n }: periods gained or lost that day to substitutions (another subject
 *                taught in this subject's period, or this subject taught in another's)
 *   workingDays  ['MON', …] (settings), holidays: Set or array of YYYY-MM-DD
 */
export function teachingSlots(from, to, { weekly, workingDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], holidays = [] } = {}) {
  const off = holidays instanceof Set ? holidays : new Set(holidays)
  const perWeek = weekly && Object.values(weekly).some((n) => n > 0) ? weekly : null
  const slots = []
  if (!from || !to) return slots
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) {
    if (off.has(d)) continue
    const code = codeOf(d)
    const n = perWeek ? Math.max(0, (perWeek[code] ?? 0) + (weekly._adjust?.[d] ?? 0)) : workingDays.includes(code) ? 1 : 0
    for (let i = 0; i < n; i++) slots.push(d)
  }
  return slots
}

/** The next day after `date` the subject is taught (within six weeks), or the next day. */
export function nextTeachingDay(date, opts = {}) {
  return teachingSlots(addDaysYmd(date, 1), addDaysYmd(date, 42), opts)[0] ?? addDaysYmd(date, 1)
}

/**
 * When each topic is planned for one section: { [topicId]: { start, end, override } }.
 * A unit's topics are spread evenly over the subject's periods in the unit's months (a topic
 * takes `periods`, default 1); a topic with its own month starts on its first teaching day in it.
 * `overrides` { topicId: YYYY-MM-DD } are the teacher's own dates. Topics with no month at all
 * are left out. opts: { weekly, workingDays, holidays, from, to (the year), overrides }.
 */
export function topicSchedule(units = [], opts = {}) {
  const out = {}
  const clip = (from, to) => [opts.from && from < opts.from ? opts.from : from, opts.to && to > opts.to ? opts.to : to]
  for (const u of units) {
    const topics = u.topics ?? []
    if (!topics.length) continue
    const fromM = u.fromMonth || u.toMonth
    const toM = u.toMonth || u.fromMonth
    let slots = []
    if (fromM) {
      const [from, to] = clip(`${fromM}-01`, lastOfMonth(toM))
      slots = teachingSlots(from, to, opts)
      if (!slots.length) slots = teachingSlots(from, to, { ...opts, weekly: null })
    }
    const need = topics.map((t) => Math.max(1, Number(t.periods) || 1))
    const total = need.reduce((a, b) => a + b, 0)
    const f = slots.length / total
    let before = 0
    topics.forEach((t, i) => {
      const id = String(t.id ?? t._id)
      let start = null
      let end = null
      if (slots.length) {
        const a = Math.min(slots.length - 1, Math.floor(before * f))
        const b = Math.max(a, Math.min(slots.length - 1, a + need[i] - 1, Math.ceil((before + need[i]) * f) - 1))
        start = slots[a]
        end = slots[b]
      }
      before += need[i]
      if (t.month && !(start && start.startsWith(t.month))) {
        const [from, to] = clip(`${t.month}-01`, lastOfMonth(t.month))
        const own = teachingSlots(from, to, opts)
        start = own[0] ?? `${t.month}-01`
        end = own[Math.min(own.length - 1, need[i] - 1)] ?? start
      }
      const o = opts.overrides?.[id]
      if (o) { start = o; end = o }
      if (start) out[id] = { start, end: end && end >= start ? end : start, override: !!o }
    })
  }
  return out
}

/**
 * How a section stands on a subject as of `date`, from its topic rows
 * ({ status, end, needsRevision, extraClasses }): taught / total, behind (planned date over, not
 * taught), revisions pending, extra classes taken and still to take.
 */
export function topicProgress(rows = [], date) {
  const out = { total: rows.length, taught: 0, partly: 0, behind: 0, revision: 0, extraDone: 0, extraDue: 0, pct: 0 }
  for (const r of rows) {
    if (r.status === 'TAUGHT') out.taught++
    else if (r.status === 'PARTLY') out.partly++
    if (r.status !== 'TAUGHT' && r.end && date && r.end < date) out.behind++
    if (r.needsRevision) out.revision++
    for (const x of r.extraClasses ?? []) { if (x.done) out.extraDone++; else out.extraDue++ }
  }
  out.pct = out.total ? Math.round((out.taught / out.total) * 100) : 0
  return out
}
