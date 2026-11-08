// Online tests: a test is a set of questions copied from the question bank (so later edits to the bank don't change
// a test already given), a time limit and a window to start in. A student's attempt is timed on the server; objective
// answers are marked as soon as it is submitted (scoreAnswer in lms.js), short and long answers by the teacher.

import { QUESTION_TYPES, scoreAnswer } from './lms.js'

export const TEST_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}

export const ATTEMPT_STATUS = {
  IN_PROGRESS: { label: 'Writing', tone: 'info' },
  SUBMITTED: { label: 'To evaluate', tone: 'warning' }, // has answers a teacher marks
  EVALUATED: { label: 'Marked', tone: 'success' },
}

/** When students see their marks: as soon as they submit, after the test closes, or when the teacher releases them. */
export const RESULT_RELEASE = [
  { value: 'IMMEDIATE', label: 'As soon as they submit' },
  { value: 'AFTER_CLOSE', label: 'After the test closes' },
  { value: 'MANUAL', label: 'When I release them' },
]

/** Why an attempt ended. */
export const SUBMIT_REASONS = { STUDENT: 'Submitted', TIME: 'Time up', PROCTOR: 'Left the test too often', CLOSED: 'The test closed' }

/** A small seeded random generator (the same student sees the same order every time they reopen the test). */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

/** 0…n−1 shuffled by a seed. */
export function seededOrder(n, seed) {
  const rand = mulberry32(hash(seed))
  const out = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const testTotal = (questions = []) => questions.reduce((s, q) => s + (Number(q.marks) || 0), 0)

/** Does the test need a teacher to mark anything (short / long answers)? */
export const needsManual = (questions = []) => questions.some((q) => !QUESTION_TYPES[q.type]?.auto)

/**
 * Mark an attempt. `questions` are the test's copies; `answers` { [index]: value }; `manual` { [index]: marks } for
 * the teacher-marked ones. → { lines: [{ index, marks, max, correct, auto, pending }], auto, manual, total, pending }
 */
export function markAttempt(questions = [], answers = {}, manual = {}, { partial = false } = {}) {
  const lines = questions.map((q, index) => {
    const max = Number(q.marks) || 0
    const r = scoreAnswer(q, answers[index], { partial })
    if (r) return { index, marks: r.marks, max, correct: r.correct, auto: true, blank: !!r.blank }
    const given = manual[index]
    const blank = answers[index] === undefined || answers[index] === null || String(answers[index]).trim() === ''
    if (blank) return { index, marks: 0, max, auto: false, blank: true }
    return { index, marks: given === undefined || given === null ? 0 : Number(given), max, auto: false, pending: given === undefined || given === null }
  })
  const sum = (f) => Math.round(lines.filter(f).reduce((s, l) => s + l.marks, 0) * 100) / 100
  return { lines, auto: sum((l) => l.auto), manual: sum((l) => !l.auto), total: Math.max(0, sum(() => true)), pending: lines.filter((l) => l.pending).length }
}

/** A question as a student sees it while writing: no correct options, no accepted answers, no explanation. */
export function questionForStudent(q, optionOrder) {
  const options = (q.options ?? []).map((o, i) => ({ i, text: o.text }))
  return {
    type: q.type, text: q.text, marks: q.marks, negative: q.negative ?? 0,
    options: optionOrder ? optionOrder.map((i) => options[i]).filter(Boolean) : options,
  }
}
