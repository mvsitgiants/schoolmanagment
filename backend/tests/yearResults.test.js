import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { addDaysYmd, weightPlan, yearResultFor } from '@schoolgiant/shared'
import { MessagingConfig } from '../src/models/engines.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let year
let cls
let section
let types
let subjects
const kids = {}
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  const data = (await admin.get('/api/v1/academics/classes')).body.data
  year = data.year
  cls = data.classes.find((c) => c.code === '11')
  section = cls.sections[0]
  for (const [name, roll, mobile] of [['Asha', '1', '9845000091'], ['Bharat', '2', '9845000092'], ['Chetan', '3', '9845000093']]) {
    kids[name] = (await admin.post('/api/v1/students').send({ firstName: name, rollNo: roll, sectionId: section.id, guardians: [{ name: `Parent ${name}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  }
  types = (await admin.get('/api/v1/exams/types')).body.data
  await runAsTenant(h.tenant._id, () => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true }))
})
afterAll(stopDb)

const api = '/api/v1/exams'
const yr = `${api}/year-results`
const typeId = (code) => types.find((t) => t.code === code).id

/** An exam of a type with English and Maths papers, marks entered and locked, results published. marks: { Asha: [eng, maths] … } */
async function runExam(name, code, day, max, marks) {
  const exam = (await admin.post(api).send({ name, examTypeId: typeId(code), classIds: [cls.id] })).body.data
  const suggested = (await admin.get(`${api}/${exam.id}/classes/${cls.id}/suggest`)).body.data
  subjects ??= ['English', 'Mathematics'].map((n) => suggested.find((s) => s.subject === n))
  const saved = (await admin.put(`${api}/${exam.id}/classes/${cls.id}/papers`).send({ papers: subjects.map((s, i) => ({ subjectId: s.subjectId, date: addDaysYmd(day, i), startTime: '09:00', endTime: '11:00', maxMarks: max, passMarks: Math.round(max / 3) })) })).body.data
  await admin.post(`${api}/${exam.id}/schedule`).expect(200)
  for (const [i, p] of saved.classes[0].papers.entries()) {
    const entries = Object.entries(marks).map(([kid, m]) => (m[i] === 'AB' ? { studentId: kids[kid].id, absent: true } : { studentId: kids[kid].id, marks: m[i] }))
    await admin.put(`${api}/marks/${p.id}/${section.id}`).send({ entries }).expect(200)
    await admin.post(`${api}/marks/${p.id}/${section.id}/lock`).expect(200)
  }
  await admin.post(`${api}/${exam.id}/publish`).expect(200)
  return exam
}

describe('the maths', () => {
  const T = [{ id: 'ut', code: 'UT', name: 'Unit test', weightage: 10 }, { id: 'hy', code: 'HY', name: 'Half-yearly', weightage: 30 }, { id: 'an', code: 'AN', name: 'Annual', weightage: 60 }, { id: 'pb', code: 'PB', name: 'Pre-board', weightage: 0 }]
  it('weights only the types with a weightage, scaled over the ones that have an exam', () => {
    const p = weightPlan(T, [{ id: 'e1', name: 'UT 1', typeId: 'ut' }, { id: 'e2', name: 'UT 2', typeId: 'ut' }, { id: 'e3', name: 'Half-yearly', typeId: 'hy' }])
    expect(p.rows.map((r) => [r.code, r.share])).toEqual([['UT', 25], ['HY', 75], ['AN', 0]])
    expect(p).toMatchObject({ provisional: true, missing: ['AN'], total: 100 })
  })
  it('averages (or takes the best of) the exams of one type, then weighs the types', () => {
    const p = weightPlan(T, [{ id: 'e1', name: 'UT 1', typeId: 'ut' }, { id: 'e2', name: 'UT 2', typeId: 'ut' }, { id: 'e3', name: 'HY', typeId: 'hy' }, { id: 'e4', name: 'AN', typeId: 'an' }])
    const subjects = [{ id: 'm', name: 'Maths' }, { id: 'e', name: 'English' }]
    const scores = { m: { e1: 40, e2: 80, e3: 70, e4: 50 }, e: { e1: 90, e3: 20, e4: 25 } }
    const avg = yearResultFor(scores, p, { subjects })
    // maths: UT avg 60 × 10 + 70 × 30 + 50 × 60 = 5700 / 100
    expect(avg.subjects[0]).toMatchObject({ pct: 57, pass: true, parts: [{ code: 'UT', pct: 60 }, { code: 'HY', pct: 70 }, { code: 'AN', pct: 50 }] })
    // english: 90 × 10 + 20 × 30 + 25 × 60 = 3000 / 100 → below 33
    expect(avg.subjects[1]).toMatchObject({ pct: 30, pass: false })
    expect(avg).toMatchObject({ pct: 43.5, failed: ['English'], result: 'COMPARTMENT' })
    expect(yearResultFor(scores, p, { subjects, combine: 'BEST' }).subjects[0].parts[0].pct).toBe(80)
    expect(yearResultFor(scores, p, { subjects, compartmentMax: 0 }).result).toBe('FAIL')
    expect(yearResultFor({ m: scores.m }, p, { subjects }).result).toBe('INCOMPLETE')
  })
})

describe('a class’s year', () => {
  it('works out the result so far from the published exams, and won’t publish until every weighted exam is', async () => {
    // compartment for one subject below the pass mark; two or more need to improve
    await admin.patch('/api/v1/core/settings/modules/exams').send({ compartmentMax: 1 }).expect(200)
    // unit test out of 25, half-yearly out of 80
    await runExam('Unit test 1', 'UT', year.startDate, 25, { Asha: [20, 25], Bharat: [10, 5], Chetan: [15, 'AB'] })
    await runExam('Half-yearly', 'HY', addDaysYmd(year.startDate, 60), 80, { Asha: [72, 64], Bharat: [40, 20], Chetan: [8, 10] })
    const ov = (await admin.get(yr)).body.data
    const row = ov.classes.find((c) => c.id === cls.id)
    expect(row).toMatchObject({ exams: 2, provisional: true, status: 'OPEN', missing: expect.arrayContaining(['PT', 'AN']) })

    const sheet = (await admin.get(`${yr}/classes/${cls.id}`)).body.data
    expect(sheet.plan.rows.find((r) => r.code === 'UT').share).toBe(25) // 10 of the 40 there is so far
    expect(sheet.subjects.map((s) => s.name)).toEqual(['English', 'Mathematics'])
    const asha = sheet.rows.find((r) => r.name.startsWith('Asha'))
    // English: UT 80% × 10 + HY 90% × 30 = 3500 / 40 = 87.5 · Maths: 100 × 10 + 80 × 30 = 3400 / 40 = 85
    expect(asha.subjects.map((s) => s.pct)).toEqual([87.5, 85])
    expect(asha).toMatchObject({ pct: 86.25, result: 'PASS', rank: 1 })
    const bharat = sheet.rows.find((r) => r.name.startsWith('Bharat'))
    // Maths: 20 × 10 + 25 × 30 = 950 / 40 = 23.75 → below 33; English 40 × 10 + 50 × 30 = 47.5
    expect(bharat).toMatchObject({ result: 'COMPARTMENT', failed: ['Mathematics'] })
    const chetan = sheet.rows.find((r) => r.name.startsWith('Chetan'))
    expect(chetan.subjects[1].parts.find((p) => p.code === 'UT').pct).toBe(0) // absent counts as 0
    expect(chetan.result).toBe('FAIL')
    expect(sheet.summary).toMatchObject({ students: 3, PASS: 1, COMPARTMENT: 1, FAIL: 1 })

    const refused = await admin.post(`${yr}/classes/${cls.id}/publish`)
    expect(refused.status).toBe(409)
    expect(refused.body.message).toMatch(/Periodic test|Annual/)
  })

  it('prints a provisional annual report card before publishing', async () => {
    const html = (await admin.get(`/api/v1/documents/YEAR_REPORT_CARD/${kids.Asha.id}?print=0`)).text
    expect(html).toContain('PROVISIONAL')
    expect(html).toContain('87.5')
  })

  it('publishes once the weighted exams are in, freezes it, and families see it', async () => {
    // this school counts only unit tests and the half-yearly
    for (const code of ['PT', 'AN']) await admin.patch(`${api}/types/${typeId(code)}`).send({ weightage: 0 }).expect(200)
    await admin.post(`${yr}/classes/${cls.id}/publish`).expect(200)
    const frozen = (await admin.get(`${yr}/classes/${cls.id}`)).body.data
    expect(frozen.status).toBe('PUBLISHED')
    // a later weightage change doesn't move a published result
    await admin.patch(`${api}/types/${typeId('UT')}`).send({ weightage: 50 }).expect(200)
    expect((await admin.get(`${yr}/classes/${cls.id}`)).body.data.rows.find((r) => r.name.startsWith('Asha')).pct).toBe(86.25)
    expect((await admin.get(`/api/v1/documents/YEAR_REPORT_CARD/${kids.Asha.id}?print=0`)).text).not.toContain('PROVISIONAL')

    await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
    const fam = (path) => `/api/v1/family/${h.tenant.slug}${path}`
    const agent = request.agent(app)
    const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000092' })).body.data
    await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
    const res = (await agent.get(fam(`/students/${kids.Bharat.id}/results`))).body.data
    expect(res.year).toMatchObject({ result: 'COMPARTMENT', failed: ['Mathematics'], subjects: [expect.objectContaining({ subject: 'English' }), expect.objectContaining({ subject: 'Mathematics', pass: false })] })
    expect((await agent.get(fam(`/doc/YEAR_REPORT_CARD/${kids.Bharat.id}`))).status).toBe(200)
    expect((await agent.get(fam(`/doc/YEAR_REPORT_CARD/${kids.Asha.id}`))).status).toBe(404) // not their child

    await admin.post(`${yr}/classes/${cls.id}/unpublish`).expect(200)
    expect((await agent.get(fam(`/students/${kids.Bharat.id}/results`))).body.data.year).toBeNull()
  })
})
