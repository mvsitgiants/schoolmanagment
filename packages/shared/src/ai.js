// AI assistant (module `ai`): constants and pure helpers shared by the API and the web app.
// Labels live in the web app's locales (locales/en/ai.json); these are the values only.

/** What each AI call was for — the usage log groups by it. */
export const AI_FEATURES = ['ASSISTANT', 'QUESTION_PAPERS', 'REMARKS']

/** Report card remarks: the institution's tone and how long a remark is. */
export const REMARK_TONES = ['WARM', 'FORMAL']
export const REMARK_LENGTHS = ['SHORT', 'MEDIUM'] // one sentence · two sentences

/** The assistant's tools (the web app shows a chip per call, labelled by name). */
export const AI_TOOLS = ['attendance_summary', 'fee_dues', 'exam_results', 'student_lookup', 'staff_on_leave', 'upcoming_events', 'timetable_today']

/** Question paper generator: at most this many questions in one draft. */
export const AI_MAX_QUESTIONS = 30
/** Remarks: students per model call (one call drafts a batch). */
export const AI_REMARK_BATCH = 20
/** Assistant: the most turns of history a request carries. */
export const AI_MAX_TURNS = 20

/** Percentage points between two percentages (null when either is missing), one decimal. */
export function pctChange(before, now) {
  if (before === null || before === undefined || now === null || now === undefined) return null
  return Math.round((Number(now) - Number(before)) * 10) / 10
}

/**
 * Split question counts by a difficulty mix (percentages, any total): { EASY: n, MEDIUM: n, HARD: n }
 * adding up to `count` (largest remainders get the leftovers).
 */
export function splitByMix(count, mix = {}) {
  const keys = ['EASY', 'MEDIUM', 'HARD']
  const total = keys.reduce((n, k) => n + Math.max(0, Number(mix[k]) || 0), 0)
  if (!count || !total) return { EASY: 0, MEDIUM: count || 0, HARD: 0 }
  const raw = keys.map((k) => ({ k, v: (count * Math.max(0, Number(mix[k]) || 0)) / total }))
  const out = Object.fromEntries(raw.map((r) => [r.k, Math.floor(r.v)]))
  let left = count - Object.values(out).reduce((a, b) => a + b, 0)
  for (const r of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left <= 0) break
    out[r.k]++
    left--
  }
  return out
}

/** "YYYY-MM" of a YYYY-MM-DD date — the usage month. */
export const aiMonthOf = (ymd) => String(ymd).slice(0, 7)
