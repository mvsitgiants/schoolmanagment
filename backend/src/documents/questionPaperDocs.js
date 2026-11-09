// Question paper documents (data from services/questionPapers.js questionPaperPrint): one set of a paper as the
// students get it (QUESTION_PAPER) and its answer key with the marking scheme (ANSWER_KEY). GET
// /documents/QUESTION_PAPER/<set id> (a paper's id prints set A). Both need `exams.question-papers.print` — the
// paper is confidential until the exam — and every print is written to the audit log by the loader.
import { answerText, numberQuestions, optionLetter, sectionMarks } from '@schoolgiant/shared'
import { latestQuestionPaperSet, questionPaperPrint } from '../services/questionPapers.js'

const PERMS = ['exams.question-papers.print']

/** The paper's heading facts, shared by both documents. */
function head({ paper, set, exam, year, cls, subject, examPaper }) {
  const min = paper.durationMin || null
  return {
    exam: { name: exam?.name ?? '', year: year?.name ?? '', term: exam?.term ?? '' },
    paper: {
      class: cls?.name ?? '', subject: subject?.name ?? '', subjectCode: subject?.code ?? '',
      date: examPaper?.date ?? null, startTime: examPaper?.startTime ?? null, endTime: examPaper?.endTime ?? null,
      durationMin: min, hours: min && min % 30 === 0 ? min / 60 : null, maxMarks: paper.maxMarks,
      instructions: String(paper.instructions ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
      set: set.letter, showSet: paper.setCount > 1, draft: paper.status !== 'APPROVED', status: paper.status,
      setterName: paper.setterName ?? null, approvedBy: paper.approvedBy ?? null, approvedAt: paper.approvedAt ?? null,
    },
  }
}

const sectionHead = (s) => {
  const m = sectionMarks(s)
  return {
    title: s.title, instructions: s.instructions || '', type: s.type, count: m.count, marks: m.marks, attempt: m.attempt, total: m.total,
    attemptAny: m.attempt < m.count, choice: !!s.choice,
  }
}

const printQ = (q) => ({
  text: q.text, type: q.type,
  options: q.type === 'TRUE_FALSE' ? [] : (q.options ?? []).map((o, i) => ({ letter: optionLetter(i), text: o.text })),
  hasOptions: ['MCQ', 'MULTI'].includes(q.type) && (q.options ?? []).length > 0,
  trueFalse: q.type === 'TRUE_FALSE', multi: q.type === 'MULTI',
})

/** QUESTION_PAPER: the sections with their questions numbered through the paper, marks on the right, OR pairs. */
export function questionPaperModel(raw) {
  const sections = numberQuestions(raw.paper, raw.set).map(({ section, items }) => ({
    ...sectionHead(section),
    questions: items.map(({ no, item }) => ({ no, marks: section.marks, ...printQ(item), or: item.or?.text ? printQ(item.or) : null })),
  }))
  return { ...head(raw), sections, rollBoxes: Array.from({ length: 8 }, (_, i) => i) }
}

const keyQ = (q) => ({ answer: answerText(q), scheme: q.explanation ?? '', chapter: q.chapter ?? '', difficulty: q.difficulty ?? '' })

/** ANSWER_KEY: per question the right option / answer / model answer, its marks and the marking scheme. */
export function answerKeyModel(raw) {
  const sections = numberQuestions(raw.paper, raw.set).map(({ section, items }) => ({
    ...sectionHead(section),
    rows: items.map(({ no, item }) => ({ no, marks: section.marks, ...keyQ(item), or: item.or?.text ? keyQ(item.or) : null })),
  }))
  return { ...head(raw), sections, total: sections.reduce((n, s) => n + s.total, 0) }
}

const title = (kind) => (m) => `${kind} · ${m.exam.name} · ${m.paper.class} · ${m.paper.subject}${m.paper.showSet ? ` · Set ${m.paper.set}` : ''}`
const VARS = [
  'exam.name, exam.year, exam.term',
  'paper.class, paper.subject, paper.subjectCode, paper.date, paper.startTime, paper.endTime, paper.durationMin, paper.hours, paper.maxMarks, paper.instructions[], paper.set, paper.showSet, paper.draft, paper.status, paper.setterName, paper.approvedBy',
]

export const QUESTION_PAPER_DOCS = {
  QUESTION_PAPER: {
    perms: PERMS,
    load: (id, auth) => questionPaperPrint(id, auth, 'QUESTION_PAPER'),
    model: questionPaperModel,
    title: title('Question paper'),
    sample: () => latestQuestionPaperSet(),
    variables: [...VARS, 'sections[] {title, instructions, count, marks, attempt, attemptAny, choice, total, questions[] {no, marks, text, hasOptions, options[] {letter, text}, trueFalse, multi, or {…}}} · rollBoxes[]', '{{#> letterhead}}corner{{/letterhead}} · {{> footer}} · {{lines text}}'],
  },
  ANSWER_KEY: {
    perms: PERMS,
    load: (id, auth) => questionPaperPrint(id, auth, 'ANSWER_KEY'),
    model: answerKeyModel,
    title: title('Answer key'),
    sample: () => latestQuestionPaperSet(),
    variables: [...VARS, 'sections[] {title, count, marks, attempt, attemptAny, choice, total, rows[] {no, marks, answer, scheme, chapter, difficulty, or {answer, scheme}}} · total', '{{#> letterhead}}corner{{/letterhead}} · {{> footer}} · {{lines answer}}'],
  },
}
