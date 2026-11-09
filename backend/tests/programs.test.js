import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  UGC_CBCS_REGULATION, classificationOf, courseResultOf, creditsFromLtp, cumulativeGpa, directAttainment, gradePointAverage,
  internalTotalOf, poAttainmentOf,
} from '@schoolgiant/shared'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
})
afterAll(stopDb)

const api = '/api/v1/programs'

describe('grading rules (shared helpers)', () => {
  it('grades a course by the UGC CBCS scale and the pass rules', () => {
    const reg = UGC_CBCS_REGULATION
    expect(courseResultOf({ internal: 36, internalMax: 40, external: 56, externalMax: 60 }, reg)).toMatchObject({ total: 92, pct: 92, grade: 'O', points: 10, pass: true })
    expect(courseResultOf({ internal: 30, internalMax: 40, external: 42, externalMax: 60 }, reg)).toMatchObject({ pct: 72, grade: 'A', points: 8, pass: true })
    // 40 % overall, but only 20/60 (33 %) in the end-semester exam: below the 40 % external minimum
    expect(courseResultOf({ internal: 20, internalMax: 40, external: 20, externalMax: 60 }, reg)).toMatchObject({ grade: 'F', points: 0, pass: false, reason: 'EXTERNAL' })
    expect(courseResultOf({ internal: 35, internalMax: 40, external: null, externalMax: 60, absent: true }, reg)).toMatchObject({ grade: 'Ab', pass: false, reason: 'ABSENT' })
  })

  it('SGPA = Σ(credits × points) / Σ credits; CGPA counts the latest attempt of each course', () => {
    const sem = [{ credits: 4, points: 10, pass: true }, { credits: 3, points: 8, pass: true }, { credits: 3, points: 0, pass: false }]
    expect(gradePointAverage(sem)).toBe(6.4) // (40 + 24 + 0) / 10
    expect(gradePointAverage(sem, { countFailed: false })).toBe(9.14) // 64 / 7
    const attempts = [
      { courseId: 'A', credits: 4, points: 10, pass: true, order: 1 },
      { courseId: 'B', credits: 3, points: 0, pass: false, order: 1 },
      { courseId: 'B', credits: 3, points: 6, pass: true, order: 2 }, // supplementary pass replaces the fail
    ]
    expect(cumulativeGpa(attempts)).toEqual({ cgpa: 8.29, creditsEarned: 7, creditsCounted: 7, arrears: [] })
    expect(classificationOf(8.29)).toBe('First class with distinction')
    expect(creditsFromLtp(3, 1, 2)).toBe(5)
    expect(internalTotalOf({ CIA1: 18, CIA2: 16, ASG: 5, ATT: 5 }, UGC_CBCS_REGULATION.iaComponents, 40)).toBe(35.2) // 44 / 50 × 40
  })

  it('attainment: levels weighted internal / external, PO from the CO–PO strengths', () => {
    expect(directAttainment(3, 2, 30)).toBe(2.3)
    expect(directAttainment(null, 2, 30)).toBe(2)
    const po = poAttainmentOf([{ key: 'CO1', attainment: 3 }, { key: 'CO2', attainment: 1 }], [{ co: 'CO1', po: 'PO1', level: 3 }, { co: 'CO2', po: 'PO1', level: 1 }, { co: 'CO2', po: 'PO2', level: 2 }], ['PO1', 'PO2', 'PO3'])
    expect(po).toEqual({ PO1: 2.5, PO2: 1, PO3: null })
  })
})

describe('regulations and programs', () => {
  let reg
  let program
  it('a new regulation starts from the UGC CBCS rules; a broken grading scale is refused', async () => {
    const bad = await admin.post(`${api}/regulations`).send({
      code: 'R2025', minCredits: 160, semesterMinCredits: 16, semesterMaxCredits: 26,
      gradeScale: [{ grade: 'A', min: 50, max: 100, points: 10 }, { grade: 'F', min: 20, max: 49.99, points: 0, pass: false }],
      passRules: { minInternalPct: 0, minExternalPct: 40, minTotalPct: 40 }, iaComponents: UGC_CBCS_REGULATION.iaComponents,
    })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields.gradeScale).toMatch(/start at 0/)
    const res = await admin.post(`${api}/regulations`).send({ code: 'r2026', ...UGC_CBCS_REGULATION, name: 'Regulation 2026', effectiveFrom: 2026 })
    expect(res.status).toBe(201)
    reg = res.body.data
    expect(reg).toMatchObject({ code: 'R2026', minCredits: 160, usedBy: 0 })
    expect(reg.gradeScale.map((b) => b.grade)).toEqual(['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'])
    expect((await admin.post(`${api}/regulations`).send({ code: 'R2026', ...UGC_CBCS_REGULATION })).status).toBe(400)
  })

  it('a program follows a regulation; its courses are checked (semester, prerequisites, codes)', async () => {
    program = (await admin.post(api).send({ name: 'B.Tech Computer Science', code: 'btcse', level: 'UG', durationYears: 4, semesters: 8, intake: 60, regulationId: reg.id })).body.data
    expect(program).toMatchObject({ code: 'BTCSE', semesters: 8 })
    const c1 = await admin.post(`${api}/courses`).send({ programId: program.id, code: 'CS101', title: 'Programming in C', semester: 1, type: 'CORE', l: 3, t: 0, p: 2, credits: 4 })
    expect(c1.status).toBe(201)
    const c2 = (await admin.post(`${api}/courses`).send({ programId: program.id, code: 'CS201', title: 'Data structures', semester: 2, credits: 4, prerequisiteIds: [c1.body.data.id] })).body.data
    expect(c2.prerequisiteIds).toEqual([c1.body.data.id])
    const late = await admin.post(`${api}/courses`).send({ programId: program.id, code: 'CS901', title: 'Too late', semester: 9, credits: 3 })
    expect(late.body.details.fields.semester).toMatch(/8 semesters/)
    const backwards = await admin.post(`${api}/courses`).send({ programId: program.id, code: 'CS102', title: 'Backwards', semester: 1, credits: 3, prerequisiteIds: [c2.id] })
    expect(backwards.body.details.fields.prerequisiteIds).toMatch(/earlier semesters/)
    expect((await admin.post(`${api}/courses`).send({ programId: program.id, code: 'CS101', title: 'Again', semester: 1, credits: 3 })).status).toBe(400)
    // a prerequisite cannot be deleted while another course needs it
    expect((await admin.delete(`${api}/courses/${c1.body.data.id}`)).status).toBe(409)
    const detail = (await admin.get(`${api}/${program.id}`)).body.data
    expect(detail.regulation.code).toBe('R2026')
    expect(detail.semesterSummary[0]).toMatchObject({ semester: 1, courses: 1, credits: 4 })
    expect(detail.courses.find((c) => c.code === 'CS201').prerequisites).toEqual(['CS101'])
    const list = (await admin.get(api)).body.data
    expect(list[0]).toMatchObject({ code: 'BTCSE', courseCount: 2, totalCredits: 8, regulationCode: 'R2026' })
    expect((await admin.delete(`${api}/regulations/${reg.id}`)).status).toBe(409)
  })

  it('students join a program through an enrolment (the student record is not changed)', async () => {
    const [a, b] = await runAsTenant(h.tenant._id, () => Student.create([
      { admissionNo: 'C001', firstName: 'Ananya', lastName: 'Rao' },
      { admissionNo: 'C002', firstName: 'Vikram', lastName: 'Iyer' },
    ]))
    const cands = (await admin.get(`${api}/candidates`).query({ search: 'ana' })).body.data
    expect(cands.map((c) => c.name)).toEqual(['Ananya Rao'])
    const res = await admin.post(`${api}/${program.id}/students`).send({ studentIds: [String(a._id), String(b._id)], batch: 2026, currentSemester: 1 })
    expect(res.status).toBe(201)
    expect((await admin.post(`${api}/${program.id}/students`).send({ studentIds: [String(a._id)], batch: 2026 })).status).toBe(409)
    const page = (await admin.get(`${api}/${program.id}/students`)).body.data
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 50 })
    const { rows } = page
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.admissionNo)).toEqual(['C001', 'C002']) // no register no. yet: admission-number order
    expect(rows[0]).toMatchObject({ regulationCode: 'R2026', currentSemester: 1, status: 'ACTIVE' })
    await admin.patch(`${api}/enrolments/${rows[0].id}`).send({ registerNo: 'cse26001' }).expect(200)
    expect((await admin.patch(`${api}/enrolments/${rows[1].id}`).send({ registerNo: 'CSE26001' })).status).toBe(400)
    await admin.patch(`${api}/enrolments`).send({ ids: rows.map((r) => r.id), currentSemester: 2 }).expect(200)
    expect((await admin.get(`${api}/${program.id}/students`).query({ semester: 2 })).body.data.rows).toHaveLength(2)
    // search runs on the server (name or register no.), and pages are cut there too
    expect((await admin.get(`${api}/${program.id}/students`).query({ search: 'vikram' })).body.data.rows.map((r) => r.name)).toEqual(['Vikram Iyer'])
    expect((await admin.get(`${api}/${program.id}/students`).query({ search: 'cse26' })).body.data.rows.map((r) => r.registerNo)).toEqual(['CSE26001'])
    const second = (await admin.get(`${api}/${program.id}/students`).query({ page: 2, pageSize: 1 })).body.data
    expect(second).toMatchObject({ total: 2, page: 2, pageSize: 1 })
    expect(second.rows.map((r) => r.name)).toEqual(['Ananya Rao']) // Vikram's C002 (no register no.) sorts before CSE26001
    expect((await admin.get(`${api}/candidates`)).body.data.map((c) => c.name)).not.toContain('Ananya Rao')
  })

  it('program outcomes, course outcomes and the CO–PO matrix', async () => {
    const pos = [{ code: 'PO1', title: 'Engineering knowledge' }, { code: 'PO2', title: 'Problem analysis' }, { code: 'PSO1', title: 'Software systems' }]
    const saved = (await admin.put(`${api}/${program.id}/outcomes`).send({ outcomes: pos })).body.data
    expect(saved.outcomes.map((o) => o.kind)).toEqual(['PO', 'PO', 'PSO'])
    const board = (await admin.get(`${api}/${program.id}/outcomes`)).body.data
    const cs101 = board.courses.find((c) => c.code === 'CS101')
    const res = await admin.put(`${api}/courses/${cs101.id}/outcomes`).send({
      outcomes: [{ code: 'CO1', statement: 'Write C programs with loops and functions', bloom: 'L3' }, { code: 'CO2', statement: 'Explain memory and pointers', bloom: 'L2' }],
      coPo: [{ co: 'CO1', po: 'PO1', level: 3 }, { co: 'CO1', po: 'PSO1', level: 2 }, { co: 'CO2', po: 'PO2', level: 1 }, { co: 'CO2', po: 'PO9', level: 3 }, { co: 'CO1', po: 'PO2', level: 0 }],
      componentCos: [{ component: 'CIA1', cos: ['CO1'] }, { component: 'CIA2', cos: ['CO2'] }],
    })
    expect(res.status).toBe(200)
    expect(res.body.data.coPo).toHaveLength(3) // PO9 does not exist, level 0 is left out
    const after = (await admin.get(`${api}/${program.id}/outcomes`)).body.data
    expect(after.coverage).toEqual({ PO1: { courses: 1, strength: 3 }, PO2: { courses: 1, strength: 1 }, PSO1: { courses: 1, strength: 2 } })
    expect(after.iaComponents.map((c) => c.code)).toEqual(['CIA1', 'CIA2', 'ASG', 'ATT'])
    // taking a PO off the program drops its mappings
    await admin.put(`${api}/${program.id}/outcomes`).send({ outcomes: pos.filter((p) => p.code !== 'PSO1') }).expect(200)
    const again = (await admin.get(`${api}/${program.id}/outcomes`)).body.data.courses.find((c) => c.code === 'CS101')
    expect(again.coPo.map((m) => m.po)).toEqual(['PO1', 'PO2'])
  })

  it('needs the module on the plan', async () => {
    const school = await newInstitution('GROWTH')
    const other = await signIn(app, school.email, school.password)
    const res = await other.get(api)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('MODULE_DISABLED')
  })
})
