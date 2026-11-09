import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { autoPick, blueprintTotals, checkBlueprint, setProgress, shuffleSet, starterBlueprint } from '@schoolgiant/shared'
import { AuditLog } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let cls
let section
let english
let exam
let examPaper
let paper

const api = '/api/v1/exams/question-papers'
const ids = (set) => set.sections.flatMap((s) => s.items.flatMap((it) => [it.questionId, it.or?.questionId])).filter(Boolean)
const BLUEPRINT = {
  durationMin: 60, maxMarks: 30, instructions: 'All questions are compulsory.',
  sections: [
    { title: 'Section A', instructions: 'Choose the correct option.', type: 'MCQ', count: 10, marks: 1 },
    { title: 'Section B', type: 'SHORT', count: 5, marks: 2, attempt: 4 },
    { title: 'Section C', type: 'LONG', count: 2, marks: 6, choice: true },
  ],
  difficulty: { EASY: 40, MEDIUM: 40, HARD: 20 },
  chapters: [{ chapter: 'Prose', weight: 60 }, { chapter: 'Poetry', weight: 40 }],
}

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const types = (await admin.get('/api/v1/exams/types')).body.data
  exam = (await admin.post('/api/v1/exams').send({ name: 'Half-yearly', examTypeId: types.find((t) => t.code === 'HY').id, classIds: [cls.id] })).body.data
  const suggested = (await admin.get(`/api/v1/exams/${exam.id}/classes/${cls.id}/suggest`)).body.data
  english = suggested.find((s) => s.subject === 'English')
  const saved = (await admin.put(`/api/v1/exams/${exam.id}/classes/${cls.id}/papers`).send({ papers: [
    { subjectId: english.subjectId, date: data.year.startDate, startTime: '09:00', endTime: '10:00', maxMarks: 80, passMarks: 27 },
  ] })).body.data
  examPaper = saved.classes[0].papers[0]
  // the bank: 12 MCQ, 6 short and 4 long answers of English for class 11
  const add = (q) => admin.post('/api/v1/lms/questions').send({ subjectId: english.subjectId, classId: cls.id, ...q }).expect(201)
  const diff = ['EASY', 'MEDIUM', 'HARD']
  for (let i = 0; i < 12; i++) await add({ type: 'MCQ', text: `MCQ question ${i + 1}`, options: [{ text: 'One', correct: true }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }], marks: 1, difficulty: diff[i % 3], chapter: i % 2 ? 'Poetry' : 'Prose' })
  for (let i = 0; i < 6; i++) await add({ type: 'SHORT', text: `Short question ${i + 1}`, answers: [`Model answer ${i + 1}`], marks: 2, difficulty: diff[i % 3], chapter: i % 2 ? 'Poetry' : 'Prose' })
  for (let i = 0; i < 4; i++) await add({ type: 'LONG', text: `Long question ${i + 1}`, answers: ['A long model answer'], explanation: 'Introduction 1, points 4, conclusion 1', marks: 6, difficulty: diff[i % 3], chapter: i % 2 ? 'Poetry' : 'Prose' })
})
afterAll(stopDb)

describe('blueprint and auto-pick maths', () => {
  const bp = { ...BLUEPRINT, sections: BLUEPRINT.sections.map((s, i) => ({ ...s, id: `s${i}` })) }
  const pool = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, type: 'MCQ', marks: 1, difficulty: ['EASY', 'MEDIUM', 'HARD'][i % 3], chapter: i % 2 ? 'Poetry' : 'Prose', used: i, text: `m${i}`, options: [{ text: 'a', correct: true }, { text: 'b' }, { text: 'c' }] })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, type: 'SHORT', marks: 2, difficulty: 'MEDIUM', chapter: 'Prose', used: 0, text: `s${i}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `l${i}`, type: 'LONG', marks: 6, difficulty: 'HARD', chapter: i % 2 ? 'Poetry' : 'Prose', used: 0, text: `l${i}` })),
  ]

  it('totals count "attempt any" and the OR alternatives as questions to set', () => {
    expect(blueprintTotals(bp)).toMatchObject({ total: 30, questions: 17, slots: 19 })
    expect(checkBlueprint(bp, 30).warnings).toEqual([])
    expect(checkBlueprint(bp, 80).warnings).toEqual([{ code: 'MARKS_MISMATCH', total: 30, maxMarks: 80 }])
    expect(checkBlueprint({ sections: [{ title: '', type: 'X', count: 0, marks: 0 }] }).errors).toMatchObject({ 'sections.0.title': expect.any(String), 'sections.0.type': expect.any(String) })
    const starter = starterBlueprint(80)
    expect(blueprintTotals({ sections: starter }).total).toBe(80)
  })

  it('fills every place with the right type, never twice, the same way for the same seed', () => {
    const a = autoPick({ blueprint: bp, set: { sections: [] }, pool, seed: 'one' })
    expect(a.short).toEqual([])
    expect(setProgress(bp, a).complete).toBe(true)
    const picked = ids(a)
    expect(new Set(picked).size).toBe(picked.length)
    expect(a.sections[0].items.every((q) => q.type === 'MCQ')).toBe(true)
    expect(a.sections[2].items.every((q) => q.or?.type === 'LONG')).toBe(true)
    expect(autoPick({ blueprint: bp, set: { sections: [] }, pool, seed: 'one' })).toEqual(a)
    // the least used MCQs win over the much used ones
    const usedOf = (id) => pool.find((q) => q.id === id).used
    expect(Math.max(...a.sections[0].items.map((q) => usedOf(q.questionId)))).toBeLessThan(11)
  })

  it('says what it couldn’t fill, and keeps away from other sets while it can', () => {
    const a = autoPick({ blueprint: bp, set: { sections: [] }, pool, seed: 'one' })
    const b = autoPick({ blueprint: bp, set: { sections: [] }, pool, avoid: ids(a), seed: 'two' })
    const mcqB = b.sections[0].items.map((q) => q.questionId)
    expect(mcqB.filter((x) => !ids(a).includes(x))).toHaveLength(2) // only 2 MCQs are left over; the rest repeat
    const tiny = autoPick({ blueprint: bp, set: { sections: [] }, pool: pool.filter((q) => q.type !== 'LONG'), seed: 'x' })
    expect(tiny.short).toEqual([{ sectionId: 's2', missing: 4 }])
  })

  it('a shuffled set has the same questions in another order, OR pairs kept together', () => {
    const a = autoPick({ blueprint: bp, set: { sections: [] }, pool, seed: 'one' })
    const b = shuffleSet(a, 'paper:B')
    expect(ids(b).sort()).toEqual(ids(a).sort())
    for (const [i, sec] of b.sections.entries()) {
      for (const it of sec.items) {
        const orig = a.sections[i].items.find((x) => x.questionId === it.questionId)
        expect(it.or?.questionId).toBe(orig.or?.questionId)
        expect(it.options.map((o) => o.text).sort()).toEqual(orig.options.map((o) => o.text).sort())
      }
    }
    expect(shuffleSet(a, 'paper:B')).toEqual(b)
  })
})

describe('setting a paper', () => {
  it('the board lists the exam’s papers, not started', async () => {
    const b = (await admin.get(`${api}/board?examId=${exam.id}`)).body.data
    expect(b.exam.id).toBe(exam.id)
    expect(b.rows).toEqual([expect.objectContaining({ examPaperId: examPaper.id, subject: 'English', status: 'NOT_STARTED', paper: null })])
    expect(b.summary).toMatchObject({ total: 1, NOT_STARTED: 1 })
  })

  it('starts a paper with a blueprint that adds up to the max marks; one per exam paper', async () => {
    paper = (await admin.post(api).send({ examPaperId: examPaper.id })).body.data
    expect(paper).toMatchObject({ status: 'DRAFT', maxMarks: 80, durationMin: 60, subject: 'English' })
    expect(paper.totals.total).toBe(80)
    expect(paper.sets.map((s) => s.letter)).toEqual(['A'])
    expect(paper.bank.count).toBe(22)
    expect((await admin.post(api).send({ examPaperId: examPaper.id })).status).toBe(409)
  })

  it('saves the blueprint and warns when it doesn’t add up', async () => {
    const off = (await admin.put(`${api}/${paper.id}/blueprint`).send({ ...BLUEPRINT, maxMarks: 80 })).body.data
    expect(off.warnings).toEqual([{ code: 'MARKS_MISMATCH', total: 30, maxMarks: 80 }])
    paper = (await admin.put(`${api}/${paper.id}/blueprint`).send({ ...BLUEPRINT, sections: off.sections })).body.data
    expect(paper.warnings).toEqual([])
    expect(paper.sections.map((s) => s.title)).toEqual(['Section A', 'Section B', 'Section C'])
    expect((await admin.put(`${api}/${paper.id}/blueprint`).send({ ...BLUEPRINT, sections: [] })).status).toBe(400)
  })

  it('auto-picks from the bank to fill set A', async () => {
    const r = (await admin.post(`${api}/${paper.id}/sets/${paper.sets[0].id}/auto-pick`).send({})).body.data
    expect(r.picked).toBe(19)
    expect(r.short).toEqual([])
    expect(r.sets[0].progress).toMatchObject({ picked: 19, needed: 19, complete: true })
    const all = ids(r.sets[0])
    expect(new Set(all).size).toBe(19)
    paper = r
  })

  it('suggests another question in place of one', async () => {
    const set = paper.sets[0]
    const before = set.sections[1].items[0].questionId
    const r = (await admin.post(`${api}/${paper.id}/sets/${set.id}/replace`).send({ sectionId: paper.sections[1].id, index: 0 })).body.data
    const after = r.sets[0].sections[1].items[0].questionId
    expect(after).not.toBe(before)
    expect(ids(r.sets[0]).filter((x) => x === after)).toHaveLength(1)
    paper = r
  })

  it('edits, reorders and removes questions; won’t take one twice', async () => {
    const set = paper.sets[0]
    const sections = set.sections.map((s) => ({ sectionId: s.sectionId, items: s.items }))
    const a = sections[0].items
    sections[0].items = [a[1], a[0], ...a.slice(2, 9)] // swap the first two, drop the last
    sections[0].items[0] = { ...sections[0].items[0], text: 'Pick the odd one out' }
    const r = (await admin.put(`${api}/${paper.id}/sets/${set.id}/questions`).send({ sections })).body.data
    expect(r.sets[0].sections[0].items[0]).toMatchObject({ questionId: a[1].questionId, text: 'Pick the odd one out' })
    expect(r.sets[0].progress.complete).toBe(false)
    const twice = structuredClone(sections)
    twice[0].items.push(twice[0].items[0])
    expect((await admin.put(`${api}/${paper.id}/sets/${set.id}/questions`).send({ sections: twice })).status).toBe(400)
    paper = r
  })

  it('writes a question inline and saves it to the bank too', async () => {
    const set = paper.sets[0]
    const r = (await admin.post(`${api}/${paper.id}/sets/${set.id}/write`).send({
      sectionId: paper.sections[0].id, saveToBank: true,
      question: { text: 'Who wrote “The Portrait of a Lady”?', options: [{ text: 'Khushwant Singh', correct: true }, { text: 'R. K. Narayan' }, { text: 'Ruskin Bond' }, { text: 'Premchand' }], chapter: 'Prose', difficulty: 'EASY' },
    })).body.data
    expect(r.sets[0].progress.complete).toBe(true)
    expect(r.sets[0].sections[0].items.at(-1).questionId).toBeTruthy()
    expect(r.bank.count).toBe(23)
    const noAnswer = await admin.post(`${api}/${paper.id}/sets/${set.id}/write`).send({ sectionId: paper.sections[0].id, question: { text: 'No answer marked', options: [{ text: 'a' }, { text: 'b' }] } })
    expect(noAnswer.status).toBe(400)
    const full = await admin.post(`${api}/${paper.id}/sets/${set.id}/write`).send({ sectionId: paper.sections[0].id, question: { text: 'One too many', options: [{ text: 'a', correct: true }, { text: 'b' }] } })
    expect(full.status).toBe(409) // the section has its 10
    paper = r
  })

  it('lists the bank for a section with where each question is used', async () => {
    const r = (await admin.get(`${api}/${paper.id}/bank?sectionId=${paper.sections[0].id}`)).body.data
    expect(r.rows.every((q) => q.type === 'MCQ')).toBe(true)
    expect(r.rows.filter((q) => q.inSets.includes('A'))).toHaveLength(10)
  })

  it('makes shuffled sets that follow set A and can’t be changed on their own', async () => {
    const r = (await admin.post(`${api}/${paper.id}/sets`).send({ count: 3, mode: 'SHUFFLE', shuffleOptions: true })).body.data
    expect(r.sets.map((s) => s.letter)).toEqual(['A', 'B', 'C'])
    expect(ids(r.sets[1]).sort()).toEqual(ids(r.sets[0]).sort())
    const b = r.sets[1]
    expect((await admin.put(`${api}/${paper.id}/sets/${b.id}/questions`).send({ sections: b.sections })).status).toBe(409)
    // a change to set A shows in set B
    const a = r.sets[0]
    const sections = a.sections.map((s) => ({ sectionId: s.sectionId, items: s.items }))
    sections[1].items[0] = { ...sections[1].items[0], text: 'Changed in set A' }
    const after = (await admin.put(`${api}/${paper.id}/sets/${a.id}/questions`).send({ sections })).body.data
    expect(after.sets[1].sections[1].items.some((q) => q.text === 'Changed in set A')).toBe(true)
    paper = after
  })
})

describe('approval and printing', () => {
  it('submit → send back with a note → submit → approve; locked once approved', async () => {
    const sub = (await admin.post(`${api}/${paper.id}/submit`).send({})).body.data
    expect(sub.status).toBe('SUBMITTED')
    expect((await admin.put(`${api}/${paper.id}/blueprint`).send(BLUEPRINT)).status).toBe(409)
    expect((await admin.post(`${api}/${paper.id}/send-back`).send({})).status).toBe(400)
    const back = (await admin.post(`${api}/${paper.id}/send-back`).send({ note: 'Section B is too easy' })).body.data
    expect(back.status).toBe('DRAFT')
    await admin.post(`${api}/${paper.id}/submit`).send({}).expect(200)
    const ok = (await admin.post(`${api}/${paper.id}/approve`).send({ note: 'Good paper' })).body.data
    expect(ok).toMatchObject({ status: 'APPROVED', can: expect.objectContaining({ edit: false, unlock: true }) })
    expect(ok.history.map((x) => x.action)).toEqual(['APPROVED', 'SUBMITTED', 'SENT_BACK', 'SUBMITTED', 'SETS', 'CREATED'])
    expect(ok.history.find((x) => x.action === 'SENT_BACK').note).toBe('Section B is too easy')
    expect((await admin.post(`${api}/${paper.id}/sets/${ok.sets[0].id}/auto-pick`).send({ refill: true })).status).toBe(409)
    expect((await admin.delete(`${api}/${paper.id}`)).status).toBe(409)
    const bank = (await admin.get(`/api/v1/lms/questions?subjectId=${english.subjectId}&pageSize=50`)).body.data
    expect(bank.filter((q) => q.used > 0)).toHaveLength(ids(ok.sets[0]).length)
    paper = ok
  })

  it('prints a set and its answer key, and the audit log says who printed', async () => {
    const b = paper.sets[1]
    const html = (await admin.get(`/api/v1/documents/QUESTION_PAPER/${b.id}?print=0`)).text
    expect(html).toContain('Half-yearly')
    expect(html).toContain('English')
    expect(html).toContain('Section C')
    expect(html).toContain('OR')
    expect(html).not.toContain('DRAFT')
    const key = (await admin.get(`/api/v1/documents/ANSWER_KEY/${b.id}?print=0`)).text
    expect(key).toMatch(/\([a-d]\) One/) // an MCQ answer is printed with its (shuffled) letter
    expect(key).toContain('Introduction 1, points 4, conclusion 1')
    const logs = await runAsTenant(h.tenant._id, () => AuditLog.find({ entityType: 'question_paper', action: 'PRINT' }).lean())
    expect(logs).toHaveLength(2)
    expect(logs[0].summary).toMatch(/set B/)
    const after = (await admin.get(`${api}/${paper.id}`)).body.data
    expect(after.printed).toBe(2)
  })

  it('unlocking needs a reason and makes it a draft again', async () => {
    expect((await admin.post(`${api}/${paper.id}/unlock`).send({})).status).toBe(400)
    const r = (await admin.post(`${api}/${paper.id}/unlock`).send({ reason: 'A typo in question 4' })).body.data
    expect(r).toMatchObject({ status: 'DRAFT', approvedBy: null })
    expect(r.history[0]).toMatchObject({ action: 'UNLOCKED', note: 'A typo in question 4' })
    const bank = (await admin.get(`/api/v1/lms/questions?subjectId=${english.subjectId}&pageSize=50`)).body.data
    expect(bank.filter((q) => q.used > 0)).toHaveLength(0)
  })
})

describe('who sees which papers', () => {
  let teacher
  let teacherId
  it('a teacher who doesn’t teach the subject sees nothing and can’t open or print it', async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    teacherId = (await admin.post('/api/v1/core/users').send({ name: 'Ms Rao', email: 'rao@qp.test', roleIds: [tpl.id], password: 'Teach@123' })).body.data.user.id
    teacher = await signIn(app, 'rao@qp.test', 'Teach@123')
    expect((await teacher.get(`${api}/board?examId=${exam.id}`)).body.data.rows).toEqual([])
    expect((await teacher.get(`${api}/${paper.id}`)).status).toBe(404)
    expect((await teacher.get(`/api/v1/documents/QUESTION_PAPER/${paper.sets[0].id}`)).status).toBe(404)
    expect((await teacher.post(api).send({ examPaperId: examPaper.id })).status).toBe(403)
  })

  it('once they teach English in the class they see it and can work on it, but not approve it', async () => {
    await admin.put('/api/v1/academics/allocation').send({ sectionId: section.id, subjectId: english.subjectId, teacherId }).expect(200)
    const rows = (await teacher.get(`${api}/board?examId=${exam.id}`)).body.data.rows
    expect(rows).toEqual([expect.objectContaining({ status: 'DRAFT' })])
    const p = (await teacher.get(`${api}/${paper.id}`)).body.data
    expect(p.can).toMatchObject({ edit: true, approve: false })
    await teacher.post(`${api}/${paper.id}/submit`).send({}).expect(200)
    expect((await teacher.post(`${api}/${paper.id}/approve`).send({})).status).toBe(403)
  })
})
