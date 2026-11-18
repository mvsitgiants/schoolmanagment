import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accrCriteria, accrMarks, accrMetrics, accrPerProgram } from '@schoolgiant/shared'
import { Employee } from '../src/models/hrms.js'
import { Program, ProgramCourse, ProgramEnrolment } from '../src/models/programs.js'
import { ResearchPublication } from '../src/models/research.js'
import { Student } from '../src/models/students.js'
import { Department } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// NBA: one SAR per programme, its figures from that programme and its department, self-assessed marks per criterion.
let app
let h
let admin
let cse
let me
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
  await runAsTenant(h.tenant._id, async () => {
    const dCse = await Department.create({ name: 'Computer Science', code: 'CSE' })
    const dMe = await Department.create({ name: 'Mechanical', code: 'ME' })
    cse = await Program.create({ name: 'B.Tech Computer Science', code: 'BTCSE', departmentId: dCse._id, intake: 60, semesters: 8 })
    me = await Program.create({ name: 'B.Tech Mechanical', code: 'BTME', departmentId: dMe._id, intake: 60, semesters: 8 })
    // CSE: two full-time teachers (one with a Ph.D.); ME: one
    await Employee.create({ employeeCode: 'C1', name: 'Dr. Asha', category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2015-06-01', qualifications: 'M.Tech., Ph.D.', departmentId: dCse._id })
    await Employee.create({ employeeCode: 'C2', name: 'Ravi', category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2019-06-01', qualifications: 'M.Tech.', departmentId: dCse._id })
    await Employee.create({ employeeCode: 'M1', name: 'Dr. Mohan', category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2016-06-01', qualifications: 'Ph.D.', departmentId: dMe._id })
    // CSE: three admitted in 2025; ME: one
    for (const [i, programId] of [cse._id, cse._id, cse._id, me._id].entries()) {
      const s = await Student.create({ firstName: `Student${i}`, admissionNo: `A${i}`, status: 'ACTIVE' })
      await ProgramEnrolment.create({ studentId: s._id, programId, batch: 2025, currentSemester: 3 })
    }
    // CSE: two courses, one mapped to the POs
    await ProgramCourse.create({ programId: cse._id, code: 'CS201', title: 'Data structures', semester: 3, credits: 4, coPo: [{ co: 'CO1', po: 'PO1', level: 3 }] })
    await ProgramCourse.create({ programId: cse._id, code: 'CS202', title: 'Discrete maths', semester: 3, credits: 3 })
    await ResearchPublication.create({ title: 'A CSE paper', type: 'JOURNAL', authors: [{ name: 'Asha' }], year: 2025, departmentId: dCse._id })
    await ResearchPublication.create({ title: 'An ME paper', type: 'JOURNAL', authors: [{ name: 'Mohan' }], year: 2025, departmentId: dMe._id })
  })
})
afterAll(stopDb)

const api = '/api/v1/accreditation'
const YEAR = '2025-26'
const metricOf = (r, code) => r.criteria.flatMap((c) => c.metrics).find((m) => m.code === code)
const report = async (programId) => (await admin.get(`${api}/reports`).query({ framework: 'NBA', year: YEAR, programId }).expect(200)).body.data

describe('NBA (shared)', () => {
  it('has the ten SAR criteria worth 1000 marks, and is per programme', () => {
    expect(accrCriteria('NBA').map((c) => c.code)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    expect(accrCriteria('NBA').reduce((n, c) => n + c.weight, 0)).toBe(1000)
    expect(new Set(accrMetrics('NBA').map((m) => m.code)).size).toBe(accrMetrics('NBA').length)
    expect(accrPerProgram('NBA')).toBe(true)
    expect(accrPerProgram('NAAC')).toBe(false)
    expect(accrMarks(accrCriteria('NBA'), { N1: 50, N4: 120 })).toEqual({ max: 1000, claimed: 170, scored: 2 })
  })
})

describe('NBA reports', () => {
  it('asks for the programme', async () => {
    await admin.get(`${api}/reports`).query({ framework: 'NBA', year: YEAR }).expect(400)
    const meta = (await admin.get(`${api}/meta`).expect(200)).body.data
    expect(meta.programs.map((p) => p.code).sort()).toEqual(['BTCSE', 'BTME'])
  })

  it('computes the figures of one programme and its department', async () => {
    const r = await report(String(cse._id))
    expect(r.program).toMatchObject({ code: 'BTCSE' })
    expect(r.criteria).toHaveLength(10)
    expect(r.marks).toEqual({ max: 1000, claimed: 0, scored: 0 })
    expect(metricOf(r, '4.1')).toMatchObject({ computed: 5, unit: 'pct' }) // 3 admitted of 60
    expect(metricOf(r, '5.1').computed).toBe(1.5) // 3 students / 2 CSE teachers
    expect(metricOf(r, '5.3').computed).toBe(50) // 1 of 2 with a Ph.D.
    expect(metricOf(r, '5.7').computed).toBe(0.5) // the CSE paper only
    expect(metricOf(r, '2.1.3').computed).toBe(50) // 1 of 2 courses mapped
    const m = await report(String(me._id))
    expect(metricOf(m, '4.1').computed).toBe(1.67)
    expect(metricOf(m, '5.3').computed).toBe(100)
  })

  it('keeps each programme’s answers and marks apart', async () => {
    await admin.put(`${api}/reports/NBA/${YEAR}/metrics/1.1`).send({ programId: String(cse._id), narrative: 'To be a centre of excellence in computing.', status: 'COMPLETE' }).expect(200)
    await admin.put(`${api}/reports/NBA/${YEAR}/metrics/1.1`).send({ narrative: 'No programme' }).expect(400)
    const s = (await admin.put(`${api}/reports/NBA/${YEAR}/scores/N1`).send({ programId: String(cse._id), marks: 55, note: 'PEOs well published' }).expect(200)).body.data
    expect(s.criterion.score).toMatchObject({ marks: 55, note: 'PEOs well published' })
    expect(s.marks).toMatchObject({ claimed: 55, scored: 1 })
    await admin.put(`${api}/reports/NBA/${YEAR}/scores/N1`).send({ programId: String(cse._id), marks: 61 }).expect(400) // out of 60
    await admin.put(`${api}/reports/NAAC/${YEAR}/scores/C1`).send({ marks: 10 }).expect(400) // NAAC isn't scored here
    const c = await report(String(cse._id))
    expect(metricOf(c, '1.1').status).toBe('COMPLETE')
    const m = await report(String(me._id))
    expect(metricOf(m, '1.1').status).toBe('NOT_STARTED')
    expect(m.marks.claimed).toBe(0)
    // NAAC for the same year still works beside the NBA reports
    await admin.get(`${api}/reports`).query({ framework: 'NAAC', year: YEAR }).expect(200)
  })

  it('keeps evidence per programme, and prints the programme with its marks', async () => {
    await admin.post(`${api}/evidence`).send({ framework: 'NBA', programId: String(cse._id), metricCodes: ['1.1'], title: 'Vision board photo' }).expect(201)
    await admin.post(`${api}/evidence`).send({ framework: 'NBA', metricCodes: ['1.1'], title: 'No programme' }).expect(400)
    expect((await admin.get(`${api}/evidence`).query({ framework: 'NBA', programId: String(cse._id) })).body.data.rows).toHaveLength(1)
    expect((await admin.get(`${api}/evidence`).query({ framework: 'NBA', programId: String(me._id) })).body.data.rows).toHaveLength(0)
    const r = await report(String(cse._id))
    const html = (await admin.get(`/api/v1/documents/ACCREDITATION_SSR/${r.id}?print=0`).expect(200)).text
    expect(html).toContain('B.Tech Computer Science')
    expect(html).toContain('55')
    const csv = (await admin.get(`${api}/reports/export`).query({ framework: 'NBA', year: YEAR, programId: String(cse._id) }).expect(200)).text
    expect(csv).toContain('Total,55,1000')
  })
})
