import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeResult, failedParts, paperScore, sumParts } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// A paper marked in parts: Theory 70 + Practical 30. The paper's max is their sum; a student passes it only by
// passing every part and the paper overall.
let app
let admin
let year
let cls
let section
let aarav
let diya
let exam
let physics
let english
beforeAll(async () => {
  app = await startDb()
  const h = await newInstitution('GROWTH') // analytics is on Growth
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const add = async (firstName, rollNo, mobile) => (await admin.post('/api/v1/students').send({ firstName, rollNo, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', '1', '9845000041')
  diya = await add('Diya', '2', '9845000042')
})
afterAll(stopDb)

const api = '/api/v1/exams'
const TH_PR = [{ name: 'Theory', maxMarks: 70, passMarks: 23 }, { name: 'Practical', maxMarks: 30, passMarks: 10 }]

describe('the maths', () => {
  const paper = { id: 'p', maxMarks: 100, passMarks: 33, parts: TH_PR }
  it('adds the parts, and fails a paper whose theory is failed even when the total passes', () => {
    expect(sumParts({ parts: { p1: 54, p2: 28 } }, paper)).toBe(82)
    expect(sumParts({ parts: { p1: 54 } }, paper)).toBeNull() // practical not in yet
    expect(paperScore({ parts: { p1: 54, p2: 28 } }, paper)).toMatchObject({ marks: 82, pass: true })
    expect(paperScore({ parts: { p1: 20, p2: 28 } }, paper)).toMatchObject({ marks: 48, pass: false })
    expect(failedParts({ parts: { p1: 20, p2: 28 } }, paper).map((p) => p.name)).toEqual(['Theory'])
    expect(computeResult([paper], { p: { parts: { p1: 54 } } }).result).toBe('INCOMPLETE')
  })
})

describe('setting up, marking and printing', () => {
  it('saves a paper in parts with its max as their sum, and refuses a broken split', async () => {
    const types = (await admin.get(`${api}/types`)).body.data
    exam = (await admin.post(api).send({ name: 'Annual', examTypeId: types.find((t) => t.code === 'AN').id, classIds: [cls.id] })).body.data
    const suggested = (await admin.get(`${api}/${exam.id}/classes/${cls.id}/suggest`)).body.data
    physics = suggested.find((s) => s.subject === 'Physics') ?? suggested.find((s) => !s.gradeOnly && s.subject !== 'English')
    english = suggested.find((s) => s.subject === 'English')
    const day = year.startDate
    const papers = (physicsParts) => ({ papers: [
      { subjectId: physics.subjectId, date: day, startTime: '09:00', endTime: '12:00', maxMarks: 0, passMarks: 0, parts: physicsParts },
      { subjectId: english.subjectId, date: day, startTime: '13:00', endTime: '15:00', maxMarks: 80, passMarks: 27 },
    ] })
    expect((await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send(papers([TH_PR[0]]))).status).toBe(400) // one part
    expect((await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send(papers([{ ...TH_PR[0], passMarks: 90 }, TH_PR[1]]))).status).toBe(400) // pass > max
    const saved = (await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send(papers(TH_PR)).expect(200)).body.data
    const p = saved.classes[0].papers.find((x) => x.subjectId === physics.subjectId)
    expect(p).toMatchObject({ maxMarks: 100, passMarks: 33 })
    expect(p.parts.map((x) => [x.key, x.name, x.maxMarks])).toEqual([['p1', 'Theory', 70], ['p2', 'Practical', 30]])
    physics = p
    await admin.post(`${api}/${exam.id}/schedule`).expect(200)
  })

  it('takes marks per part, totals them, and checks each against its own max', async () => {
    const url = `${api}/marks/${physics.id}/${section.id}`
    const sheet = (await admin.get(url)).body.data
    expect(sheet.paper.parts).toHaveLength(2)
    expect((await admin.put(url).send({ entries: [{ studentId: aarav.id, parts: { p1: 75, p2: 20 } }] })).status).toBe(400) // theory out of 70
    const saved = (await admin.put(url).send({ entries: [{ studentId: aarav.id, parts: { p1: 54, p2: 28 } }, { studentId: diya.id, parts: { p1: 20, p2: 28 } }] }).expect(200)).body.data
    expect(saved.students.find((s) => s.id === aarav.id)).toMatchObject({ marks: 82, parts: { p1: 54, p2: 28 } })
    await admin.post(`${url}/lock`).expect(200)
    const eng = (await admin.get(`${api}/${exam.id}`)).body.data.classes[0].papers.find((x) => x.subjectId === english.subjectId)
    await admin.put(`${api}/marks/${eng.id}/${section.id}`).send({ entries: [{ studentId: aarav.id, marks: 60 }, { studentId: diya.id, marks: 60 }] }).expect(200)
    await admin.post(`${api}/marks/${eng.id}/${section.id}/lock`).expect(200)
  })

  it('a failed part fails the student, though the total is above the pass marks', async () => {
    const res = (await admin.get(`${api}/${exam.id}/results?sectionId=${section.id}`)).body.data
    expect(res.rows.find((r) => r.name === 'Aarav')).toMatchObject({ total: 142, max: 180, result: 'PASS' })
    const d = res.rows.find((r) => r.name === 'Diya')
    expect(d).toMatchObject({ total: 108, result: 'FAIL' })
    expect(d.marks[physics.id]).toMatchObject({ marks: 48, parts: { p1: 20, p2: 28 }, pass: false })
  })

  it('a marked paper can’t be joined back into one mark', async () => {
    const back = await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send({ papers: [
      { subjectId: physics.subjectId, date: year.startDate, startTime: '09:00', endTime: '12:00', maxMarks: 100, passMarks: 33 },
      { subjectId: english.subjectId, date: year.startDate, startTime: '13:00', endTime: '15:00', maxMarks: 80, passMarks: 27 },
    ] })
    expect(back.status).toBe(409)
  })

  it('a draft exam with papers can be deleted', async () => {
    const types = (await admin.get(`${api}/types`)).body.data
    const draft = (await admin.post(api).send({ name: 'Unit test', examTypeId: types.find((t) => t.code === 'UT').id, classIds: [cls.id] })).body.data
    await admin.put(`${api}/${draft.id}/classes/${cls.id}/papers`).send({ papers: [{ subjectId: english.subjectId, maxMarks: 25, passMarks: 9 }] }).expect(200)
    await admin.delete(`${api}/${draft.id}`).expect(200)
  })

  it('a practical on its own day gets its own row on the hall ticket', async () => {
    const day = year.startDate
    const later = (await admin.get(`${api}/${exam.id}`)).body.data
    const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 3)
    const practicalDay = next.toISOString().slice(0, 10)
    await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send({ papers: [
      { subjectId: physics.subjectId, date: day, startTime: '09:00', endTime: '12:00', maxMarks: 0, passMarks: 33, parts: [TH_PR[0], { ...TH_PR[1], date: practicalDay, startTime: '10:00', endTime: '12:00' }] },
      { subjectId: english.subjectId, date: day, startTime: '13:00', endTime: '15:00', maxMarks: 80, passMarks: 27 },
    ] }).expect(200)
    const updated = (await admin.get(`${api}/${exam.id}`)).body.data
    expect(updated.endDate).toBe(practicalDay) // the exam now runs to the practical
    expect(later.endDate).toBe(day)
    const candidates = (await admin.get(`${api}/${exam.id}/candidates?sectionId=${section.id}`)).body.data
    const html = (await admin.get(`/api/v1/documents/HALL_TICKET/${candidates[0].id}?print=0`)).text
    expect(html).toContain('Physics (Theory)')
    expect(html).toContain('Physics (Practical)')
    expect(html.indexOf('Physics (Theory)')).toBeLessThan(html.indexOf('Physics (Practical)')) // by date
  })

  it('analytics counts a failed part as a failed subject', async () => {
    await admin.post(`${api}/${exam.id}/publish`).expect(200)
    const a = (await admin.get('/api/v1/analytics/academics').query({ examId: exam.id })).body.data
    const phy = a.subjects.find((x) => x.subjectId === physics.subjectId)
    expect(phy).toMatchObject({ students: 2, passPct: 50, failed: 1 }) // Diya passed overall (48) but not theory
  })

  it('the report card shows the break-up, the failed part marked', async () => {
    const candidates = (await admin.get(`${api}/${exam.id}/candidates?sectionId=${section.id}`)).body.data
    const html = (await admin.get(`/api/v1/documents/REPORT_CARD/${candidates.find((c) => c.name === 'Diya').id}?print=0`)).text
    expect(html).toContain('Break-up')
    expect(html).toContain('Theory 20/70')
    expect(html).toContain('Practical 28/30')
    expect(html).toMatch(/class="low">Theory 20\/70/)
  })
})
