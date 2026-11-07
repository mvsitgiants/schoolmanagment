import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeResult, rankBy } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let year
let cls
let section
let aarav
let diya
let exam
let eng
let pe
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  const add = async (firstName, rollNo, mobile) => (await admin.post('/api/v1/students').send({ firstName, rollNo, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, mobile }] })).body.data
  aarav = await add('Aarav', '1', '9845000031')
  diya = await add('Diya', '2', '9845000032')
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const api = '/api/v1/exams'

describe('result maths', () => {
  it('totals, percentage, absent counts as a fail, an exempt paper is left out', () => {
    const papers = [{ id: 'a', maxMarks: 80, passMarks: 27 }, { id: 'b', maxMarks: 80, passMarks: 27 }, { id: 'c', maxMarks: 50, passMarks: 17 }]
    expect(computeResult(papers, { a: { marks: 60 }, b: { marks: 40 }, c: { exempt: true } })).toMatchObject({ total: 100, max: 160, pct: 62.5, result: 'PASS' })
    expect(computeResult(papers, { a: { marks: 60 }, b: { absent: true }, c: { marks: 20 } })).toMatchObject({ total: 80, max: 210, result: 'FAIL', failed: ['b'] })
    expect(computeResult(papers, { a: { marks: 60 } }).result).toBe('INCOMPLETE')
  })
  it('ranks ties together', () => {
    expect(rankBy([{ pct: 90 }, { pct: 80 }, { pct: 90 }, { pct: null }, { pct: 70 }])).toEqual([1, 3, 1, null, 4])
  })
})

describe('setting up and scheduling an exam', () => {
  it('a new institution has the usual exam types', async () => {
    const types = (await admin.get(`${api}/types`)).body.data
    expect(types.map((t) => t.code)).toEqual(expect.arrayContaining(['UT', 'HY', 'AN']))
  })

  it('makes an exam, suggests papers from the class subjects, refuses clashing papers', async () => {
    const types = (await admin.get(`${api}/types`)).body.data
    exam = (await admin.post(api).send({ name: 'Half-yearly', examTypeId: types.find((t) => t.code === 'HY').id, classIds: [cls.id], instructions: 'Bring your hall ticket.' })).body.data
    expect(exam.status).toBe('DRAFT')
    const suggested = (await admin.get(`${api}/${exam.id}/classes/${cls.id}/suggest`)).body.data
    eng = suggested.find((s) => s.subject === 'English')
    pe = suggested.find((s) => s.subject === 'Physical Education')
    expect(eng).toMatchObject({ maxMarks: 80, gradeOnly: false })
    expect(pe.gradeOnly).toBe(true)
    const day = year.startDate
    const clash = await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send({ papers: [
      { subjectId: eng.subjectId, date: day, startTime: '09:00', endTime: '12:00', maxMarks: 80, passMarks: 27 },
      { subjectId: pe.subjectId, date: day, startTime: '10:00', endTime: '11:00', gradeOnly: true },
    ] })
    expect(clash.status).toBe(400)
    const saved = (await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send({ papers: [
      { subjectId: eng.subjectId, date: day, startTime: '09:00', endTime: '12:00', maxMarks: 80, passMarks: 27 },
      { subjectId: pe.subjectId, date: day, startTime: '13:00', endTime: '14:00', gradeOnly: true },
    ] })).body.data
    expect(saved.classes[0].papers).toHaveLength(2)
    expect(saved.startDate).toBe(day)
  })

  it('scheduling makes every student a candidate with a hall ticket', async () => {
    await admin.post(`${api}/${exam.id}/schedule`).expect(200)
    const candidates = (await admin.get(`${api}/${exam.id}/candidates?sectionId=${section.id}`)).body.data
    expect(candidates.map((c) => c.name)).toEqual(['Aarav', 'Diya'])
    const html = (await admin.get(`/api/v1/documents/HALL_TICKET/${candidates[0].id}?print=0`)).text
    expect(html).toContain('Half-yearly')
    expect(html).toContain('English')
  })
})

describe('marks, results and report cards', () => {
  const sheet = async () => {
    const full = (await admin.get(`${api}/${exam.id}`)).body.data
    const papers = full.classes[0].papers
    return { engPaper: papers.find((p) => p.subject === 'English'), pePaper: papers.find((p) => p.subject === 'Physical Education') }
  }

  it('checks marks against the max, and won’t lock with marks missing', async () => {
    const { engPaper } = await sheet()
    const url = `${api}/marks/${engPaper.id}/${section.id}`
    const bad = await admin.put(url).send({ entries: [{ studentId: aarav.id, marks: 95 }] })
    expect(bad.status).toBe(400)
    await admin.put(url).send({ entries: [{ studentId: aarav.id, marks: 72 }] }).expect(200)
    expect((await admin.post(`${url}/lock`)).status).toBe(409)
    await admin.put(url).send({ entries: [{ studentId: aarav.id, marks: 72 }, { studentId: diya.id, marks: 20 }] }).expect(200)
    const locked = (await admin.post(`${url}/lock`)).body.data
    expect(locked.status).toBe('LOCKED')
    expect((await admin.put(url).send({ entries: [{ studentId: aarav.id, marks: 70 }] })).status).toBe(409)
  })

  it('won’t publish while a sheet is open; then works out grades and rank', async () => {
    const { pePaper } = await sheet()
    expect((await admin.post(`${api}/${exam.id}/publish`)).status).toBe(409)
    const url = `${api}/marks/${pePaper.id}/${section.id}`
    await admin.put(url).send({ entries: [{ studentId: aarav.id, grade: 'a' }, { studentId: diya.id, grade: 'B' }] }).expect(200)
    await admin.post(`${url}/lock`).expect(200)
    await admin.post(`${api}/${exam.id}/publish`).expect(200)
    const res = (await admin.get(`${api}/${exam.id}/results?sectionId=${section.id}`)).body.data
    const a = res.rows.find((r) => r.name === 'Aarav')
    const d = res.rows.find((r) => r.name === 'Diya')
    expect(a).toMatchObject({ total: 72, max: 80, pct: 90, grade: 'A2', rank: 1, result: 'PASS' })
    expect(d).toMatchObject({ rank: 2, result: 'FAIL' })
    expect(res.summary).toMatchObject({ students: 2, passed: 1, failed: 1 })
  })

  it('remarks go on the report card, and sending it tells the family', async () => {
    const candidates = (await admin.get(`${api}/${exam.id}/candidates?sectionId=${section.id}`)).body.data
    const a = candidates.find((c) => c.name === 'Aarav')
    await admin.put(`${api}/${exam.id}/remarks`).send({ sectionId: section.id, remarks: [{ candidateId: a.id, remark: 'Keep it up.' }] }).expect(200)
    const html = (await admin.get(`/api/v1/documents/REPORT_CARD/${a.id}?print=0`)).text
    expect(html).toContain('Keep it up.')
    expect(html).toContain('A2')
    expect(html).not.toContain('PROVISIONAL')
    const sent = (await admin.post(`${api}/${exam.id}/report-cards/send`).send({ sectionId: section.id })).body.data
    expect(sent.sent).toBe(2)
    expect((await admin.post(`${api}/${exam.id}/report-cards/send`).send({ sectionId: section.id })).body.data.sent).toBe(0) // not twice
    const logs = await runAsTenant(h.tenant._id, () => MessageLog.countDocuments({ event: 'exams.results_published' }))
    expect(logs).toBeGreaterThan(0)
  })

  it('published marks are frozen until the results are unpublished', async () => {
    const { engPaper } = await sheet()
    const url = `${api}/marks/${engPaper.id}/${section.id}`
    expect((await admin.post(`${url}/unlock`).send({ reason: 'Re-check' })).status).toBe(409)
    await admin.post(`${api}/${exam.id}/unpublish`).expect(200)
    expect((await admin.post(`${url}/unlock`).send({ reason: 'Re-check' })).body.data.status).toBe('OPEN')
  })
})
