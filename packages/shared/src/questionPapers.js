// Question papers (Exams › Question papers): the printed paper of one exam paper (exam + class + subject).
// A paper has a blueprint — duration, max marks, general instructions and sections ("Section A — MCQ, 10 × 1",
// "Section B — Short answer, 5 × 3, attempt any 4", internal choice "OR") with an optional chapter weightage and a
// difficulty mix — and one or more sets (A, B, C …), each holding the questions of every section. Questions are
// copies (from the LMS question bank, or written for the paper), so the bank can change without changing a paper.
// Everything here is pure and deterministic: the same seed always gives the same pick and the same shuffle.
import { QUESTION_TYPES } from './lms.js'
import { seededOrder } from './onlineTests.js'

/** DRAFT → SUBMITTED (setter) → APPROVED (approver; locked). Sending back or unlocking returns it to DRAFT. */
export const QP_STATUS = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  DRAFT: { label: 'Draft', tone: 'warning' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'success' },
}

/** What happened to a paper, for its history. */
export const QP_ACTIONS = {
  CREATED: 'Started',
  SUBMITTED: 'Submitted for approval',
  RECALLED: 'Taken back by the setter',
  SENT_BACK: 'Sent back',
  APPROVED: 'Approved',
  UNLOCKED: 'Unlocked',
  SETS: 'Sets made',
}

/** How sets B, C … differ from set A. */
export const QP_SET_MODES = {
  SHUFFLE: { label: 'Same questions, shuffled', hint: 'Questions within each section and the MCQ options are shuffled.' },
  DIFFERENT: { label: 'Different questions', hint: 'Each set gets its own questions from the bank, to the same blueprint.' },
}
export const QP_SET_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
export const QP_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD']

/** Option letter: 0 → "a". */
export const optionLetter = (i) => String.fromCharCode(97 + i)

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const sid = (s) => String(s?.id ?? s?._id ?? s?.sectionId ?? '')

/** Questions a section asks for and the marks it counts: "attempt any 4 of 5 × 3" counts 12. */
export function sectionMarks(section) {
  const count = Math.max(0, Math.floor(num(section?.count)))
  const attempt = section?.attempt ? Math.min(count, Math.floor(num(section.attempt))) : count
  return { count, attempt, marks: num(section?.marks), total: attempt * num(section?.marks), slots: count * (section?.choice ? 2 : 1) }
}

/** The blueprint's totals: marks counted, questions to set (OR alternatives included). */
export function blueprintTotals(blueprint) {
  const sections = (blueprint?.sections ?? []).map((s) => ({ id: sid(s), ...sectionMarks(s) }))
  return {
    sections,
    total: sections.reduce((n, s) => n + s.total, 0),
    questions: sections.reduce((n, s) => n + s.count, 0),
    slots: sections.reduce((n, s) => n + s.slots, 0),
    // all the marks on the paper (every question, before "attempt any") — what chapter and difficulty shares are of
    written: sections.reduce((n, s) => n + s.count * s.marks, 0),
  }
}

/** A first blueprint for a paper out of `maxMarks`: MCQ, 2-mark and 3-mark short answers, 5-mark long answers. */
export function starterBlueprint(maxMarks = 80) {
  const max = Math.max(1, Math.round(num(maxMarks) || 80))
  let mcq = Math.round(max * 0.2)
  const two = Math.round((max * 0.3) / 2)
  const three = Math.round((max * 0.3) / 3)
  let rest = max - mcq - two * 2 - three * 3
  const five = Math.max(0, Math.floor(rest / 5))
  rest -= five * 5
  mcq += rest // what doesn't divide goes to the 1-mark questions
  return [
    { title: 'Section A', instructions: 'Choose the correct option.', type: 'MCQ', count: mcq, marks: 1 },
    { title: 'Section B', instructions: 'Answer in about 30 words.', type: 'SHORT', count: two, marks: 2 },
    { title: 'Section C', instructions: 'Answer in about 60 words.', type: 'SHORT', count: three, marks: 3 },
    { title: 'Section D', instructions: 'Answer in about 120 words.', type: 'LONG', count: five, marks: 5, choice: five > 1 },
  ].filter((s) => s.count > 0)
}

/**
 * Problems with a blueprint. `errors` (field → message) stop it being saved; `warnings` ({ code, … }) are shown:
 * MARKS_MISMATCH (the sections don't add up to the max marks), MIX_NOT_100 (difficulty mix), WEIGHT_NOT_100 (chapters).
 */
export function checkBlueprint(blueprint, maxMarks) {
  const errors = {}
  const warnings = []
  const sections = blueprint?.sections ?? []
  if (!sections.length) errors.sections = 'Add at least one section'
  sections.forEach((s, i) => {
    if (!String(s.title ?? '').trim()) errors[`sections.${i}.title`] = 'Name the section'
    if (!QUESTION_TYPES[s.type]) errors[`sections.${i}.type`] = 'Pick the question type'
    if (!(num(s.count) >= 1 && num(s.count) <= 100)) errors[`sections.${i}.count`] = '1 to 100 questions'
    if (!(num(s.marks) > 0)) errors[`sections.${i}.marks`] = 'Give each question marks'
    if (s.attempt && (num(s.attempt) < 1 || num(s.attempt) > num(s.count))) errors[`sections.${i}.attempt`] = 'Between 1 and the number of questions'
  })
  if (num(blueprint?.durationMin) < 0) errors.durationMin = 'Can’t be negative'
  const max = num(maxMarks ?? blueprint?.maxMarks)
  const { total } = blueprintTotals(blueprint)
  if (max > 0 && sections.length && total !== max) warnings.push({ code: 'MARKS_MISMATCH', total, maxMarks: max })
  const mix = blueprint?.difficulty ?? {}
  const mixSum = QP_DIFFICULTIES.reduce((n, d) => n + num(mix[d]), 0)
  if (mixSum > 0 && mixSum !== 100) warnings.push({ code: 'MIX_NOT_100', sum: mixSum })
  const weights = (blueprint?.chapters ?? []).filter((c) => String(c.chapter ?? '').trim())
  const wSum = weights.reduce((n, c) => n + num(c.weight), 0)
  if (weights.length && wSum !== 100) warnings.push({ code: 'WEIGHT_NOT_100', sum: wSum })
  return { errors, warnings }
}

// ───────────────────────────────────────────────────────── a set's questions

/** The set's questions of a section (sets keep their sections by the blueprint section id). */
export const setSection = (set, sectionId) => (set?.sections ?? []).find((x) => String(x.sectionId) === String(sectionId)) ?? { sectionId, items: [] }

/** Questions picked vs asked for, per section and in all (an OR alternative is a question to set too). */
export function setProgress(blueprint, set) {
  const sections = (blueprint?.sections ?? []).map((s) => {
    const { count, slots } = sectionMarks(s)
    const items = setSection(set, sid(s)).items ?? []
    const main = Math.min(count, items.length)
    const alts = s.choice ? items.slice(0, count).filter((it) => it?.or?.text).length : 0
    return { id: sid(s), picked: main + alts, needed: slots, missing: Math.max(0, slots - main - alts), extra: Math.max(0, items.length - count) }
  })
  return { sections, picked: sections.reduce((n, s) => n + s.picked, 0), needed: sections.reduce((n, s) => n + s.needed, 0), complete: sections.every((s) => !s.missing && !s.extra) }
}

/**
 * Marks by difficulty or by chapter in a set — what was actually picked, to show against the targets. `by`:
 * 'difficulty' | 'chapter'. OR alternatives are left out (a student answers one of the two). → { [value]: marks }
 */
export function marksMix(blueprint, set, by = 'difficulty') {
  const out = {}
  for (const s of blueprint?.sections ?? []) {
    for (const it of setSection(set, sid(s)).items ?? []) {
      const k = (by === 'chapter' ? String(it.chapter ?? '').trim() : it.difficulty) || '—'
      out[k] = (out[k] ?? 0) + num(s.marks)
    }
  }
  return out
}

/** Every question numbered through the paper (1, 2, 3 … across sections; an OR alternative shares its number). */
export function numberQuestions(blueprint, set) {
  let n = 0
  return (blueprint?.sections ?? []).map((s) => ({
    section: s,
    items: (setSection(set, sid(s)).items ?? []).map((it) => ({ no: ++n, item: it })),
  }))
}

/** The answer to one question as printed in the answer key: "(b) Newton", "True", "4 / four", a model answer. */
export function answerText(q) {
  if (!q) return ''
  const opts = q.options ?? []
  if (q.type === 'MCQ' || q.type === 'MULTI') {
    return opts.map((o, i) => (o.correct ? `(${optionLetter(i)}) ${o.text}` : null)).filter(Boolean).join('; ')
  }
  if (q.type === 'TRUE_FALSE') return opts.find((o) => o.correct)?.text ?? ''
  return (q.answers ?? []).filter(Boolean).join(q.type === 'FILL' ? ' / ' : '\n')
}

// ───────────────────────────────────────────────────────── auto-pick

/** A small seeded random generator. */
function rng(seed) {
  let a = [...String(seed)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The running tally of a paper being filled: marks so far per chapter and per difficulty, against the targets. */
function tally(blueprint) {
  const { written } = blueprintTotals(blueprint)
  const weights = (blueprint?.chapters ?? []).filter((c) => String(c.chapter ?? '').trim() && num(c.weight) > 0)
  const wSum = weights.reduce((n, c) => n + num(c.weight), 0)
  const chapterTarget = new Map(weights.map((c) => [String(c.chapter).trim().toLowerCase(), (num(c.weight) / wSum) * written]))
  const mix = blueprint?.difficulty ?? {}
  const mixSum = QP_DIFFICULTIES.reduce((n, d) => n + num(mix[d]), 0)
  const diffTarget = mixSum > 0 ? new Map(QP_DIFFICULTIES.map((d) => [d, (num(mix[d]) / mixSum) * written])) : null
  return { chapterTarget: chapterTarget.size ? chapterTarget : null, diffTarget, chapter: new Map(), diff: new Map() }
}
const chapKey = (q) => String(q?.chapter ?? '').trim().toLowerCase()
function count(t, q, marks) {
  t.chapter.set(chapKey(q), (t.chapter.get(chapKey(q)) ?? 0) + marks)
  t.diff.set(q.difficulty, (t.diff.get(q.difficulty) ?? 0) + marks)
}

/**
 * How well a bank question fits a slot (higher is better). In order of weight: the right marks; the chapter and
 * difficulty furthest below their targets; the least used; for an OR alternative, the same chapter and difficulty
 * as the question it pairs with. A little seeded noise breaks ties so different seeds give different papers.
 */
function fit(q, section, t, maxUsed, rand, partner) {
  let s = 0
  const marks = num(section.marks)
  if (num(q.marks) !== marks) s -= 2 + Math.abs(num(q.marks) - marks) / Math.max(marks, 1)
  if (partner) {
    if (chapKey(q) === chapKey(partner)) s += 1.2
    if (q.difficulty === partner.difficulty) s += 0.8
  } else {
    if (t.chapterTarget) {
      const target = t.chapterTarget.get(chapKey(q))
      if (!target) s -= 1.5
      else s += 1.2 * Math.max(-1, Math.min(1, (target - (t.chapter.get(chapKey(q)) ?? 0)) / target))
    }
    if (t.diffTarget) {
      const target = t.diffTarget.get(q.difficulty) ?? 0
      if (!target) s -= 1
      else s += 1 * Math.max(-1, Math.min(1, (target - (t.diff.get(q.difficulty) ?? 0)) / target))
    }
  }
  s -= 0.6 * (num(q.used) / (maxUsed || 1))
  return s + rand() * 0.3
}

/** A bank question as a paper's copy. */
export function paperItemFrom(q) {
  if (!q) return null
  return {
    questionId: String(q.id ?? q._id), type: q.type, text: q.text,
    options: (q.options ?? []).map((o) => ({ text: o.text, correct: !!o.correct })),
    answers: q.answers ? [...q.answers] : undefined,
    explanation: q.explanation ?? undefined, chapter: q.chapter ?? undefined, difficulty: q.difficulty ?? 'MEDIUM', bloom: q.bloom ?? undefined,
  }
}

const usedIds = (sections, skip) => {
  const out = new Set()
  for (const sec of sections ?? []) {
    for (const it of sec.items ?? []) {
      if (it === skip) continue
      if (it?.questionId) out.add(String(it.questionId))
      if (it?.or?.questionId) out.add(String(it.or.questionId))
    }
  }
  return out
}

/**
 * Fill a set's sections from the question bank. `pool`: bank questions of the paper's subject and class
 * ({ id, type, marks, chapter, difficulty, used, … }). Only questions of the section's type are taken; never one
 * already in the set; `avoid` (ids in the paper's other sets) only once nothing else is left. `sectionId` limits it
 * to one section; `refill` throws away that section's (or every section's) questions first — otherwise only the
 * empty places are filled and what is there counts towards the chapter and difficulty targets.
 * → { sections: [{ sectionId, items }], picked, short: [{ sectionId, missing }] }
 */
export function autoPick({ blueprint, set, pool = [], avoid = [], seed = 'qp', sectionId, refill = false }) {
  const rand = rng(seed)
  const t = tally(blueprint)
  const candidates = [...pool].sort((a, b) => String(a.id ?? a._id).localeCompare(String(b.id ?? b._id)))
  const maxUsed = Math.max(0, ...candidates.map((q) => num(q.used)))
  const avoidSet = new Set(avoid.map(String))
  const only = sectionId ? String(sectionId) : null
  const sections = (blueprint?.sections ?? []).map((s) => {
    const items = setSection(set, sid(s)).items ?? []
    const clear = refill && (!only || only === sid(s))
    return { sectionId: sid(s), items: clear ? [] : items.map((it) => ({ ...it, ...(it.or && { or: { ...it.or } }) })) }
  })
  const taken = usedIds(sections)
  // what stays counts towards the targets
  for (const [i, s] of (blueprint?.sections ?? []).entries()) {
    for (const it of sections[i].items) count(t, it, num(s.marks))
  }
  const best = (section, partner) => {
    let top = null
    let topScore = -Infinity
    for (const pass of [false, true]) { // first without the other sets' questions, then with them
      for (const q of candidates) {
        const id = String(q.id ?? q._id)
        if (q.type !== section.type || taken.has(id) || (!pass && avoidSet.has(id))) continue
        const sc = fit(q, section, t, maxUsed, rand, partner)
        if (sc > topScore) { top = q; topScore = sc }
      }
      if (top) break
    }
    return top
  }
  let picked = 0
  const short = []
  for (const [i, s] of (blueprint?.sections ?? []).entries()) {
    if (only && only !== sid(s)) continue
    const { count: n } = sectionMarks(s)
    const items = sections[i].items
    let missing = 0
    for (let k = 0; k < n; k++) {
      if (!items[k]) {
        const q = best(s)
        if (!q) { missing += s.choice ? 2 : 1; continue }
        items[k] = paperItemFrom(q)
        taken.add(String(q.id ?? q._id))
        count(t, q, num(s.marks))
        picked++
      }
      if (s.choice && !items[k].or?.text) {
        const alt = best(s, items[k])
        if (!alt) { missing++; continue }
        items[k] = { ...items[k], or: paperItemFrom(alt) }
        taken.add(String(alt.id ?? alt._id))
        picked++
      }
    }
    if (missing) short.push({ sectionId: sid(s), missing })
  }
  return { sections, picked, short }
}

/**
 * "Suggest another": the best bank question to put in place of one (`index` in the section, `part` 'main' or 'or'),
 * leaving out every question already in the set and the one being replaced. Prefers the same chapter and
 * difficulty as the question it replaces. null when the bank has nothing else.
 */
export function suggestQuestion({ blueprint, set, pool = [], avoid = [], sectionId, index, part = 'main', seed = 'qp' }) {
  const section = (blueprint?.sections ?? []).find((s) => sid(s) === String(sectionId))
  if (!section) return null
  const items = setSection(set, sectionId).items ?? []
  const current = part === 'or' ? items[index]?.or : items[index]
  const taken = usedIds([{ items }])
  if (current?.questionId) taken.add(String(current.questionId))
  const rand = rng(seed)
  const t = tally(blueprint)
  for (const s of blueprint.sections) for (const it of setSection(set, sid(s)).items ?? []) if (it !== items[index]) count(t, it, num(s.marks))
  const like = part === 'or' ? items[index] : current
  const maxUsed = Math.max(0, ...pool.map((q) => num(q.used)))
  const avoidSet = new Set(avoid.map(String))
  let top = null
  let topScore = -Infinity
  for (const q of [...pool].sort((a, b) => String(a.id ?? a._id).localeCompare(String(b.id ?? b._id)))) {
    const id = String(q.id ?? q._id)
    if (q.type !== section.type || taken.has(id)) continue
    let sc = fit(q, section, t, maxUsed, rand, like?.text ? like : null)
    if (avoidSet.has(id)) sc -= 3
    if (sc > topScore) { top = q; topScore = sc }
  }
  return top ? paperItemFrom(top) : null
}

// ───────────────────────────────────────────────────────── sets

const shuffleOptions = (q, seed) => {
  if (!q || !['MCQ', 'MULTI'].includes(q.type) || (q.options ?? []).length < 2) return q
  const order = seededOrder(q.options.length, seed)
  return { ...q, options: order.map((i) => q.options[i]) }
}

/**
 * Another set with the same questions: the questions of each section in a new order (an OR pair stays together)
 * and, with `options`, the MCQ options too — so the set's answer key changes with it. Same seed, same set.
 */
export function shuffleSet(set, seed, { options = true } = {}) {
  return {
    sections: (set?.sections ?? []).map((sec) => {
      const items = sec.items ?? []
      const order = seededOrder(items.length, `${seed}:${sec.sectionId}`)
      return {
        sectionId: String(sec.sectionId),
        items: order.map((i, k) => {
          const it = items[i]
          if (!options) return { ...it }
          const out = shuffleOptions(it, `${seed}:${sec.sectionId}:${k}`)
          return it.or ? { ...out, or: shuffleOptions(it.or, `${seed}:${sec.sectionId}:${k}:or`) } : out
        }),
      }
    }),
  }
}
