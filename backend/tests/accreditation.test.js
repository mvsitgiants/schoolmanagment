import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accrCompletion, accrCriteria, accrMetric, accrMetrics, accrWordCount, accrYearRange } from '@schoolgiant/shared'
import { Employee } from '../src/models/hrms.js'
import { ResearchProject, ResearchPublication, ResearchScholar } from '../src/models/research.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
  // staff on roll in 2025-26: two full-time teachers (one with a Ph.D.), a visiting one, an office assistant
  await runAsTenant(h.tenant._id, async () => {
    await Employee.create({ employeeCode: 'T1', name: 'Dr. Kavya Rao', category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2015-06-01', qualifications: 'M.Sc., Ph.D.', experienceYears: 2 })
    await Employee.create({ employeeCode: 'T2', name: 'Arun Pillai', category: 'TEACHING', employmentType: 'CONTRACT', joiningDate: '2022-06-01', qualifications: 'M.Tech.' })
    await Employee.create({ employeeCode: 'T3', name: 'Guest Lecturer', category: 'TEACHING', employmentType: 'VISITING', joiningDate: '2024-06-01', qualifications: 'Ph.D.' })
    await Employee.create({ employeeCode: 'A1', name: 'Office Assistant', category: 'ADMIN', employmentType: 'PERMANENT', joiningDate: '2018-06-01' })
    await ResearchProject.create({ title: 'Grant', piId: h.user._id, agency: 'DST', status: 'ONGOING', sanctioned: 50_00_000_00, received: 20_00_000_00, sanctionedOn: '2025-08-01' })
    await ResearchProject.create({ title: 'Old grant', piId: h.user._id, agency: 'UGC', status: 'COMPLETED', sanctioned: 9_00_000_00, sanctionedOn: '2019-08-01' })
    await ResearchPublication.create({ title: 'A UGC-CARE paper', type: 'JOURNAL', authors: [{ name: 'X' }], year: 2025, indexing: ['UGC_CARE'] })
    await ResearchPublication.create({ title: 'A chapter', type: 'CHAPTER', authors: [{ name: 'X' }], year: 2025 })
    await ResearchScholar.create({ name: 'Scholar One', guideId: h.user._id, registrationDate: '2025-09-10' })
  })
})
afterAll(stopDb)

const api = '/api/v1/accreditation'
const YEAR = '2025-26'
const metricOf = (report, code) => report.criteria.flatMap((c) => c.metrics).find((m) => m.code === code)

describe('framework definition (shared)', () => {
  it('NAAC has the 7 criteria with real SSR codes; NIRF has its five parameters', () => {
    expect(accrCriteria('NAAC').map((c) => c.code)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'])
    expect(accrCriteria('NAAC').reduce((n, c) => n + c.weight, 0)).toBe(1000)
    expect(accrMetrics('NAAC').filter((m) => m.kind === 'QN').length).toBeGreaterThanOrEqual(25)
    expect(accrMetric('NAAC', '3.3.2')).toMatchObject({ kind: 'QN', source: 'research', auto: 'papersPerTeacher' })
    expect(accrCriteria('NIRF').map((c) => c.id)).toEqual(['TLR', 'RP', 'GO', 'OI', 'PR'])
    expect(new Set(accrMetrics('NAAC').map((m) => m.code)).size).toBe(accrMetrics('NAAC').length) // codes are unique
    expect(accrYearRange('2025-26')).toEqual({ from: '2025-06-01', to: '2026-05-31', startYear: 2025 })
    expect(accrWordCount('**Bold** words\n- one two')).toBe(4)
    expect(accrCompletion([{ code: 'a' }, { code: 'b' }], { a: { status: 'COMPLETE' }, b: { status: 'DRAFT' } })).toEqual({ total: 2, complete: 1, draft: 1, pct: 50 })
  })
})

describe('reports', () => {
  it('computes metrics from the institution’s records for the year', async () => {
    const r = (await admin.get(`${api}/reports`).query({ framework: 'NAAC', year: YEAR }).expect(200)).body.data
    expect(r.criteria).toHaveLength(7)
    expect(r.summary.total).toBe(accrMetrics('NAAC').length)
    expect(r.range).toEqual({ from: '2025-06-01', to: '2026-05-31' })
    expect(metricOf(r, '2.4.2')).toMatchObject({ computed: 50, value: 50, valueFrom: 'AUTO', unit: 'pct' }) // 1 of 2 full-time teachers
    expect(metricOf(r, '2.4.1').computed).toBe(2) // the visiting lecturer is not full-time
    expect(metricOf(r, '3.1.1')).toMatchObject({ computed: 50, unit: 'lakh' }) // ₹50 lakh sanctioned in the year; the 2019 grant is not counted
    expect(metricOf(r, '3.3.2').computed).toBe(0.5) // 1 UGC-CARE paper / 2 teachers
    expect(metricOf(r, '3.3.3').computed).toBe(0.5)
    expect(metricOf(r, '3.3.1').computed).toBe(1) // 1 registration / 1 guide
    expect(metricOf(r, '2.6.3').computed).toBeNull() // no exam results yet: entered by hand
    expect(metricOf(r, '1.1.1')).toMatchObject({ kind: 'QL', status: 'NOT_STARTED', words: 0 })
  })

  it('a manual value overrides the computed one; writing moves a metric to draft', async () => {
    const m = (await admin.put(`${api}/reports/NAAC/${YEAR}/metrics/3.1.1`).send({ manualValue: 52.5, note: 'Includes the DBT grant received in March' }).expect(200)).body.data
    expect(m).toMatchObject({ value: 52.5, computed: 50, valueFrom: 'MANUAL', status: 'DRAFT', note: 'Includes the DBT grant received in March' })
    const cleared = (await admin.put(`${api}/reports/NAAC/${YEAR}/metrics/3.1.1`).send({ manualValue: '' }).expect(200)).body.data
    expect(cleared).toMatchObject({ value: 50, valueFrom: 'AUTO' })
  })

  it('a qualitative metric takes a narrative, not a value; completing metrics fills the criterion bar', async () => {
    expect((await admin.put(`${api}/reports/NAAC/${YEAR}/metrics/1.1.1`).send({ manualValue: 3 })).status).toBe(400)
    expect((await admin.put(`${api}/reports/NAAC/${YEAR}/metrics/9.9.9`).send({ note: 'x' })).status).toBe(404)
    const n = (await admin.put(`${api}/reports/NAAC/${YEAR}/metrics/1.1.1`).send({ narrative: 'The college follows the **university calendar**.\n- Teaching plans\n- Reviews' }).expect(200)).body.data
    expect(n).toMatchObject({ status: 'DRAFT', words: 9 })
    await admin.put(`${api}/reports/NAAC/${YEAR}/metrics/1.1.1`).send({ status: 'COMPLETE' }).expect(200)
    const r = (await admin.get(`${api}/reports`).query({ framework: 'NAAC', year: YEAR })).body.data
    const c1 = r.criteria.find((c) => c.id === 'C1')
    expect(c1.completion).toMatchObject({ complete: 1, total: c1.metrics.length })
    expect(r.summary).toMatchObject({ complete: 1, draft: 1, narratives: 1 })
    // another year is its own return
    const other = (await admin.get(`${api}/reports`).query({ framework: 'NAAC', year: '2024-25' })).body.data
    expect(other.summary.complete).toBe(0)
  })

  it('exports the report as CSV', async () => {
    const res = await admin.get(`${api}/reports/export`).query({ framework: 'NAAC', year: YEAR }).expect(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.text).toMatch(/2\.4\.2,Full-time teachers with Ph\.D\.,QN,50,pct,Computed/)
    expect(res.text).toMatch(/university calendar/)
  })

  it('NIRF reads the same records', async () => {
    const r = (await admin.get(`${api}/reports`).query({ framework: 'NIRF', year: YEAR }).expect(200)).body.data
    expect(metricOf(r, 'FQE').computed).toBe(50)
    expect(metricOf(r, 'PU').computed).toBe(2)
    expect(metricOf(r, 'FPPP').computed).toBe(50)
  })
})

describe('evidence repository', () => {
  let ev
  it('adds evidence for a metric, answering a line of its DVV checklist', async () => {
    const bad = await admin.post(`${api}/evidence`).send({ framework: 'NAAC', metricCodes: ['3.1.1'], checklist: ['2.4.2#0'], title: 'Sanction letter' })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields.checklist).toBeTruthy()
    expect((await admin.post(`${api}/evidence`).send({ framework: 'NAAC', metricCodes: ['X.9'], title: 'Nothing' })).status).toBe(400)
    ev = (await admin.post(`${api}/evidence`).send({ framework: 'NAAC', metricCodes: ['3.1.1'], checklist: ['3.1.1#0'], year: YEAR, title: 'DST sanction letter' }).expect(201)).body.data
    expect(ev).toMatchObject({ files: 0, dvv: { status: 'PENDING' }, uploadedBy: h.user.name })
  })

  it('the checklist line is done once the evidence has a file or a link', async () => {
    let list = (await admin.get(`${api}/evidence`).query({ framework: 'NAAC', criterion: 'C3' }).expect(200)).body.data
    let line = list.checklist.find((c) => c.code === '3.1.1').items[0]
    expect(line).toMatchObject({ key: '3.1.1#0', evidence: 1, done: false })
    await admin.patch(`${api}/evidence/${ev.id}`).send({ link: 'https://college.example/naac/3.1.1/sanction.pdf' }).expect(200)
    list = (await admin.get(`${api}/evidence`).query({ framework: 'NAAC', metric: '3.1.1' })).body.data
    line = list.checklist[0].items[0]
    expect(line.done).toBe(true)
    expect(list.summary).toMatchObject({ items: 1, metricsCovered: 1, metrics: 1, checklistDone: 1 })
    const r = (await admin.get(`${api}/reports`).query({ framework: 'NAAC', year: YEAR })).body.data
    expect(metricOf(r, '3.1.1')).toMatchObject({ evidence: 1, checklist: { done: 1, total: 3 } })
  })

  it('DVV marks evidence verified or asks for clarification; delete removes it', async () => {
    const v = (await admin.post(`${api}/evidence/${ev.id}/dvv`).send({ status: 'CLARIFY', note: 'Letter is not signed' }).expect(200)).body.data
    expect(v.dvv).toMatchObject({ status: 'CLARIFY', note: 'Letter is not signed', by: h.user.name })
    await admin.post(`${api}/evidence/${ev.id}/dvv`).send({ status: 'VERIFIED' }).expect(200)
    expect((await admin.get(`${api}/evidence`).query({ framework: 'NAAC' })).body.data.summary.verified).toBe(1)
    await admin.delete(`${api}/evidence/${ev.id}`).expect(200)
    expect((await admin.get(`${api}/evidence/${ev.id}`)).status).toBe(404)
  })
})
