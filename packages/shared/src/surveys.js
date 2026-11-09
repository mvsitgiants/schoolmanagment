// Surveys & feedback (module `surveys`). A survey sends one questionnaire from the form builder (forms.js, use
// SURVEY) to an audience — parents, students, staff, or anyone with a public link — between two dates. Publishing
// the survey freezes the questionnaire's version, so every answer reads against the questions that were asked.
// One answer per person (per child for parents); an anonymous survey keeps no name with the answers.
import { formFields } from './forms.js'

export const SURVEY_AUDIENCES = [
  { value: 'PARENTS', label: 'Parents', help: 'In the family app, once for each child (all, or chosen classes / sections).' },
  { value: 'STUDENTS', label: 'Students', help: 'Students signed in to the family app (all, or chosen classes / sections).' },
  { value: 'STAFF', label: 'Staff', help: 'Every staff member with a login, in the staff app.' },
  { value: 'PUBLIC', label: 'Anyone with the link', help: 'A public page — alumni, visitors, the community. No sign-in.' },
]
export const SURVEY_AUDIENCE_LABEL = Object.fromEntries(SURVEY_AUDIENCES.map((a) => [a.value, a.label]))

export const SURVEY_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SCHEDULED: { label: 'Opens soon', tone: 'info' },
  OPEN: { label: 'Open', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}

/** Where a survey is today: DRAFT until published, SCHEDULED before it opens, CLOSED after it closes (or was closed). */
export function surveyState(s, today) {
  if (!s?.publishedAt) return 'DRAFT'
  if (s.closedAt) return 'CLOSED'
  if (s.closesOn && today > s.closesOn) return 'CLOSED'
  if (s.opensOn && today < s.opensOn) return 'SCHEDULED'
  return 'OPEN'
}

/** How a question is summarised on the Responses page. */
export function surveyQuestionKind(field) {
  if (['SELECT', 'MULTI', 'YESNO'].includes(field?.type)) return 'CHOICE'
  if (field?.type === 'SCORE') return 'RATING'
  if (['NUMBER', 'CALC', 'TOTAL'].includes(field?.type)) return 'NUMBER'
  if (['TEXT', 'TEXTAREA', 'DATE'].includes(field?.type)) return 'TEXT'
  return null
}

const blank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/**
 * Per-question summary of a list of answers (each a form's values):
 *   CHOICE → options [{ label, count }] · RATING → average, max and options [{ label, points, count }]
 *   NUMBER → average, min, max · TEXT → the answers (newest first, up to `textLimit`).
 */
export function summariseSurvey(definition, answers = [], { textLimit = 200 } = {}) {
  const out = []
  for (const f of formFields(definition)) {
    const kind = surveyQuestionKind(f)
    if (!kind) continue
    const given = answers.map((a) => a?.[f.key]).filter((v) => !blank(v))
    const q = { key: f.key, label: f.label, type: f.type, kind, answered: given.length }
    if (kind === 'CHOICE') {
      const opts = f.type === 'YESNO' ? ['YES', 'NO'] : (f.options ?? []).map(String)
      const counts = Object.fromEntries(opts.map((o) => [o, 0]))
      for (const v of given) for (const x of [].concat(v)) if (x in counts) counts[x]++
      q.options = opts.map((o) => ({ value: o, label: f.type === 'YESNO' ? (o === 'YES' ? 'Yes' : 'No') : o, count: counts[o] }))
    } else if (kind === 'RATING') {
      const opts = (f.options ?? []).map((o) => ({ label: o.label, points: Number(o.points), count: 0 }))
      let sum = 0
      for (const v of given) {
        const n = Number(v)
        sum += n
        const o = opts.find((x) => x.points === n)
        if (o) o.count++
      }
      q.options = opts
      q.max = opts.length ? Math.max(...opts.map((o) => o.points)) : 0
      q.average = given.length ? round(sum / given.length) : null
    } else if (kind === 'NUMBER') {
      const nums = given.map(Number).filter(Number.isFinite)
      q.average = nums.length ? round(nums.reduce((s, n) => s + n, 0) / nums.length) : null
      q.min = nums.length ? Math.min(...nums) : null
      q.max = nums.length ? Math.max(...nums) : null
    } else {
      q.answers = given.slice(0, textLimit).map(String)
    }
    out.push(q)
  }
  return out
}

/** Response rate in whole percent (null when nobody was asked — a public link). */
export const surveyRate = (responded, invited) => (invited ? Math.min(100, Math.round((responded / invited) * 100)) : null)

const RATE = [{ label: 'Poor', points: 1 }, { label: 'Fair', points: 2 }, { label: 'Good', points: 3 }, { label: 'Very good', points: 4 }, { label: 'Excellent', points: 5 }]
const AGREE = [{ label: 'Strongly disagree', points: 1 }, { label: 'Disagree', points: 2 }, { label: 'Neutral', points: 3 }, { label: 'Agree', points: 4 }, { label: 'Strongly agree', points: 5 }]

/**
 * Starter questionnaires the Surveys page adds to the form builder the first time it opens (use SURVEY, published as
 * version 1). Ordinary forms: an institution edits, republishes or archives them in Administration › Form builder.
 */
export const SURVEY_STARTER_FORMS = [
  {
    code: 'TEACHER_EVALUATION', name: 'Teacher evaluation', use: 'SURVEY',
    description: 'Students rate a teacher’s teaching: clarity, pace, fairness and support.',
    definition: { sections: [
      { title: 'About the class', columns: 2, fields: [
        { key: 'TEACHER', label: 'Teacher’s name', type: 'TEXT', required: true },
        { key: 'SUBJECT', label: 'Subject', type: 'TEXT' },
      ] },
      { title: 'How much do you agree?', columns: 1, fields: [
        { key: 'EXPLAINS', label: 'Explains things clearly', type: 'SCORE', options: AGREE, required: true },
        { key: 'PACE', label: 'Teaches at a pace I can follow', type: 'SCORE', options: AGREE, required: true },
        { key: 'QUESTIONS', label: 'Is happy to answer questions', type: 'SCORE', options: AGREE, required: true },
        { key: 'FAIR', label: 'Marks and treats students fairly', type: 'SCORE', options: AGREE, required: true },
        { key: 'FEEDBACK', label: 'Gives useful feedback on my work', type: 'SCORE', options: AGREE, required: true },
        { key: 'OVERALL', label: 'Overall, how would you rate this teacher?', type: 'SCORE', options: RATE, required: true },
        { key: 'GOOD', label: 'What does this teacher do well?', type: 'TEXTAREA' },
        { key: 'BETTER', label: 'What could be better?', type: 'TEXTAREA' },
      ] },
    ] },
  },
  {
    code: 'PARENT_SATISFACTION', name: 'Parent satisfaction', use: 'SURVEY',
    description: 'A yearly survey of how happy parents are with the school.',
    definition: { sections: [
      { title: 'Your experience', columns: 1, fields: [
        { key: 'TEACHING', label: 'Quality of teaching', type: 'SCORE', options: RATE, required: true },
        { key: 'PROGRESS', label: 'Information about your child’s progress', type: 'SCORE', options: RATE, required: true },
        { key: 'COMMUNICATION', label: 'Communication from the school', type: 'SCORE', options: RATE, required: true },
        { key: 'SAFETY', label: 'Safety and care of your child', type: 'SCORE', options: RATE, required: true },
        { key: 'FACILITIES', label: 'Classrooms, labs and play areas', type: 'SCORE', options: RATE },
        { key: 'TRANSPORT', label: 'School transport', type: 'SELECT', options: ['Very happy', 'Happy', 'Not happy', 'We don’t use it'] },
        { key: 'BEST', label: 'What do you like most about the school?', type: 'MULTI', options: ['Teachers', 'Discipline', 'Activities and sports', 'Results', 'Facilities', 'Values'] },
        { key: 'RECOMMEND', label: 'Would you recommend the school to other parents?', type: 'YESNO', required: true },
        { key: 'COMMENTS', label: 'Anything else you would like to tell us?', type: 'TEXTAREA' },
      ] },
    ] },
  },
]
