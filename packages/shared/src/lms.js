// Learning (LMS): courses and their material, live classes, and the question bank online tests draw from.
// A course is a class's subject (for all its sections, or some), laid out in units of items — notes, files, links,
// videos. Students see the published items in the family app and tick them off. Live classes run on Jitsi (a room
// made for each class, nothing to set up) or on the school's own Zoom / Meet / Teams link.

export const COURSE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
}

export const ITEM_KINDS = {
  NOTE: { label: 'Note', icon: 'FileText' },
  FILE: { label: 'Files', icon: 'Paperclip' },
  LINK: { label: 'Link', icon: 'Link' },
  VIDEO: { label: 'Video', icon: 'PlayCircle' },
}

/** A YouTube or Vimeo link → the address to embed it, or null (other links open in a new tab). */
export function videoEmbed(url) {
  const s = String(url ?? '').trim()
  let m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`
  m = s.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/)
  if (m) return `https://player.vimeo.com/video/${m[1]}`
  return null
}

// ───────────────────────────────────────────────────────── teaching content ("Create content")

/**
 * The tiles on "Create content". Study material, video and link are saved as course items (`kind`) in the class's
 * subject course, in the unit named after the syllabus topic's unit; assignment opens the homework form and quiz the
 * online-test form. `tone` is the calm colour of its chip.
 */
export const CONTENT_TYPES = {
  MATERIAL: { kind: 'NOTE', icon: 'BookOpen', tone: 'brand' },
  ASSIGNMENT: { icon: 'ClipboardList', tone: 'warning' },
  QUIZ: { icon: 'ListChecks', tone: 'violet' },
  VIDEO: { kind: 'VIDEO', icon: 'PlayCircle', tone: 'danger' },
  LINK: { kind: 'LINK', icon: 'Link', tone: 'teal' },
}
/** A course item kind → its tile (items made on the course page show up as study material). */
export const contentTypeOfKind = (kind) => (kind === 'VIDEO' ? 'VIDEO' : kind === 'LINK' ? 'LINK' : 'MATERIAL')

export const CONTENT_VISIBILITY = ['ALL', 'STUDENTS']
export const CONTENT_STATUS = {
  PUBLISHED: { tone: 'success' },
  SCHEDULED: { tone: 'info' },
  HIDDEN: { tone: 'neutral' },
}
/** Largest file a teacher adds to content (the files engine allows a little more). */
export const CONTENT_FILE_MAX_MB = 10

/** PUBLISHED (students see it), SCHEDULED (shows from publishAt) or HIDDEN (switched off on the course page). */
export function contentStatus(item, now = new Date()) {
  if (item?.published === false) return 'HIDDEN'
  if (item?.publishAt && new Date(item.publishAt) > now) return 'SCHEDULED'
  return 'PUBLISHED'
}

/** Does this student see the item now? Published, its time has come, and meant for everyone or for them. */
export const itemVisibleTo = (item, studentId, now = new Date()) => contentStatus(item, now) === 'PUBLISHED'
  && (item.visibility !== 'STUDENTS' || (item.studentIds ?? []).some((s) => String(s) === String(studentId)))

/** Is this a web address (http or https)? */
export const isWebUrl = (s) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(String(s ?? '').trim())

/** How much of a course a student has done: items ticked over published items. */
export function courseProgress(units = [], done = []) {
  const ids = units.flatMap((u) => (u.items ?? []).filter((i) => i.published !== false).map((i) => String(i.id ?? i._id)))
  const set = new Set(done.map(String))
  const n = ids.filter((id) => set.has(id)).length
  return { done: n, total: ids.length, pct: ids.length ? Math.round((n / ids.length) * 100) : 0 }
}

// ───────────────────────────────────────────────────────── live classes

export const LIVE_PROVIDERS = [
  { value: 'JITSI', label: 'Jitsi Meet (made for you, free)' },
  { value: 'ZOOM', label: 'Zoom' },
  { value: 'MEET', label: 'Google Meet' },
  { value: 'TEAMS', label: 'Microsoft Teams' },
  { value: 'OTHER', label: 'Another link' },
]
export const LIVE_STATUS = {
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  LIVE: { label: 'Live now', tone: 'success' },
  ENDED: { label: 'Ended', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}

/** The Jitsi room of a live class (public server; a long random room name keeps strangers out). */
export const jitsiUrl = (room) => `https://meet.jit.si/${room}`

/** Minutes since midnight of 'HH:MM'. */
const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m }

/**
 * Can students join now? From `early` minutes before the start until the end (start + duration), on the day.
 * `now` = { date: 'YYYY-MM-DD', time: 'HH:MM' } in the institution's time.
 */
export function joinWindow({ date, start, durationMin }, now, early = 10) {
  if (now.date !== date) return { open: false, reason: now.date < date ? 'LATER' : 'OVER' }
  const t = mins(now.time)
  const from = mins(start) - early
  const to = mins(start) + (durationMin || 40)
  if (t < from) return { open: false, reason: 'LATER', inMinutes: from - t }
  if (t > to) return { open: false, reason: 'OVER' }
  return { open: true }
}

// ───────────────────────────────────────────────────────── question bank

/** `auto`: an online test marks it on its own. */
export const QUESTION_TYPES = {
  MCQ: { label: 'Multiple choice (one answer)', auto: true, options: true },
  MULTI: { label: 'Multiple choice (more than one)', auto: true, options: true },
  TRUE_FALSE: { label: 'True or false', auto: true, options: true },
  FILL: { label: 'Fill in the blank', auto: true },
  SHORT: { label: 'Short answer', auto: false },
  LONG: { label: 'Long answer', auto: false },
}
export const DIFFICULTY = {
  EASY: { label: 'Easy', tone: 'success' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HARD: { label: 'Hard', tone: 'danger' },
}
/** Bloom's levels, the way CBSE competency papers tag questions. */
export const BLOOM_LEVELS = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE']

/** Problems with a question (field → message). */
export function checkQuestion(q) {
  const errors = {}
  const type = QUESTION_TYPES[q.type]
  if (!type) errors.type = 'Pick the type'
  if (String(q.text ?? '').trim().length < 3) errors.text = 'Write the question'
  if (!(q.marks > 0)) errors.marks = 'Give it marks'
  if (q.type === 'TRUE_FALSE') {
    if ((q.options ?? []).length !== 2 || (q.options ?? []).filter((o) => o.correct).length !== 1) errors.options = 'Mark True or False as the answer'
  } else if (type?.options) {
    const opts = (q.options ?? []).filter((o) => String(o.text ?? '').trim())
    const right = opts.filter((o) => o.correct).length
    if (opts.length < 2) errors.options = 'Give at least two options'
    else if (q.type === 'MCQ' && right !== 1) errors.options = 'Mark exactly one option correct'
    else if (q.type === 'MULTI' && right < 1) errors.options = 'Mark the correct options'
  }
  if (q.type === 'FILL' && !(q.answers ?? []).some((a) => String(a).trim())) errors.answers = 'Give the answer (or answers that count)'
  if ((q.negative ?? 0) < 0 || (q.negative ?? 0) > (q.marks ?? 0)) errors.negative = 'Between 0 and the marks'
  return errors
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Marks for an answer to an objective question: MCQ / TRUE_FALSE an option index, MULTI the indexes (all right,
 * none wrong — partial credit when `partial` is on), FILL the text (any accepted answer, case and spaces ignored).
 * → { marks, correct } ; null for SHORT / LONG (a teacher marks those).
 */
export function scoreAnswer(q, answer, { partial = false } = {}) {
  const t = QUESTION_TYPES[q.type]
  if (!t?.auto) return null
  const negative = Number(q.negative ?? 0)
  const blank = answer === undefined || answer === null || answer === '' || (Array.isArray(answer) && !answer.length)
  if (blank) return { marks: 0, correct: false, blank: true }
  if (q.type === 'MCQ' || q.type === 'TRUE_FALSE') {
    const ok = !!q.options?.[Number(answer)]?.correct
    return { marks: ok ? q.marks : -negative, correct: ok }
  }
  if (q.type === 'MULTI') {
    const picked = new Set([].concat(answer).map(Number))
    const right = new Set((q.options ?? []).map((o, i) => (o.correct ? i : null)).filter((i) => i !== null))
    const wrongPicked = [...picked].filter((i) => !right.has(i)).length
    const rightPicked = [...picked].filter((i) => right.has(i)).length
    if (!wrongPicked && rightPicked === right.size) return { marks: q.marks, correct: true }
    if (partial && !wrongPicked && rightPicked) return { marks: Math.round(((q.marks * rightPicked) / right.size) * 100) / 100, correct: false, partial: true }
    return { marks: -negative, correct: false }
  }
  const ok = (q.answers ?? []).some((a) => norm(a) === norm(answer))
  return { marks: ok ? q.marks : -negative, correct: ok }
}
