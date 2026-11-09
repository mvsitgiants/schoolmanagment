import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isValidIssn, normDoi, projectUtilisation, researchHIndex } from '@schoolgiant/shared'
import { Department } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let physics
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE') // research is an Enterprise module
  admin = await signIn(app, h.email, h.password)
  physics = await runAsTenant(h.tenant._id, () => Department.create({ name: 'Physics', code: 'PHY', type: 'ACADEMIC' }))
})
afterAll(stopDb)

const api = '/api/v1/research'

describe('shared helpers', () => {
  it('DOI, ISSN, h-index and utilisation', () => {
    expect(normDoi('https://doi.org/10.1016/J.PHYSA.2020.1')).toBe('10.1016/j.physa.2020.1')
    expect(normDoi('doi: 10.1000/xyz')).toBe('10.1000/xyz')
    expect(normDoi('not a doi')).toBeNull()
    expect(isValidIssn('0378-5955')).toBe(true)
    expect(isValidIssn('0378-5954')).toBe(false)
    expect(researchHIndex([10, 8, 5, 4, 3])).toBe(4)
    expect(researchHIndex([])).toBe(0)
    expect(projectUtilisation({ sanctioned: 1000, received: 800, utilised: 600 })).toEqual({ receivedPct: 80, utilisedPct: 75, pending: 200, unspent: 200 })
  })
})

describe('publications', () => {
  let pub
  it('adds a journal article with a staff author and an outside author; the department comes from the picker', async () => {
    const res = await admin.post(`${api}/publications`).send({
      title: 'Phonon transport in layered materials', type: 'JOURNAL',
      authors: [{ userId: String(h.user._id) }, { name: 'R. Iyer' }],
      venue: 'Physical Review B', year: 2025, volume: '111', issue: '4', pages: '045301',
      doi: 'https://doi.org/10.1103/PhysRevB.111.045301', issn: '2469-9950', indexing: ['SCOPUS', 'WOS'], impactFactor: 3.7, citations: 6,
      departmentId: String(physics._id),
    })
    expect(res.status).toBe(201)
    pub = res.body.data
    expect(pub.doi).toBe('10.1103/physrevb.111.045301')
    expect(pub.authors).toEqual([{ userId: String(h.user._id), name: h.user.name }, { userId: null, name: 'R. Iyer' }])
    expect(pub.department).toMatchObject({ code: 'PHY' })
  })

  it('refuses a DOI already in the list and a broken ISSN', async () => {
    const dup = await admin.post(`${api}/publications`).send({ title: 'Same paper again', authors: [{ name: 'X' }], year: 2025, doi: '10.1103/PhysRevB.111.045301' })
    expect(dup.status).toBe(400)
    expect(dup.body.details.fields.doi).toMatch(/Another publication/)
    const issn = await admin.post(`${api}/publications`).send({ title: 'Bad ISSN', authors: [{ name: 'X' }], year: 2025, issn: '1234-5678' })
    expect(issn.status).toBe(400)
    expect(issn.body.details.fields.issn).toBeTruthy()
  })

  it('imports a sheet: a dry run checks the rows, the import saves the good ones', async () => {
    const rows = [
      { title: 'A survey of thin films', type: 'Conference paper', authors: `${h.user.name}; S. Rao`, venue: 'ICTF 2024', year: '2024', indexing: 'Scopus', department: 'PHY', citations: '2' },
      { title: 'Optics primer', type: 'BOOK', authors: 'K. Menon', venue: 'Springer', year: '2023', isbn: '9783030000000' },
      { title: 'Duplicate', authors: 'Y', year: '2025', doi: '10.1103/PhysRevB.111.045301' },
      { title: 'Bad year', authors: 'Z', year: '25' },
    ]
    const dry = (await admin.post(`${api}/publications/import`).send({ rows, dryRun: true }).expect(200)).body.data
    expect(dry.rows.map((r) => r.errors.map((e) => e.field))).toEqual([[], [], ['doi'], ['year']])
    expect(dry.rows[0].note).toMatch(/1 author/)
    const done = (await admin.post(`${api}/publications/import`).send({ rows, dryRun: false }).expect(200)).body.data
    expect(done.imported).toBe(2)
    expect(done.errors.map((e) => e.row)).toEqual([3, 4])
  })

  it('lists with figures: per year, per department, h-index; filters by department, year and indexing', async () => {
    const all = (await admin.get(`${api}/publications`).expect(200)).body.data
    expect(all.summary.total).toBe(3)
    expect(all.summary.byYear.map((y) => y.year)).toEqual([2023, 2024, 2025])
    expect(all.summary.byDepartment.find((d) => d.departmentId === String(physics._id)).n).toBe(2)
    expect(all.summary.citations).toBe(8)
    expect(all.summary.hIndex).toBe(2)
    expect((await admin.get(`${api}/publications`).query({ departmentId: String(physics._id) })).body.data.rows).toHaveLength(2)
    expect((await admin.get(`${api}/publications`).query({ year: 2024 })).body.data.rows.map((r) => r.type)).toEqual(['CONFERENCE'])
    expect((await admin.get(`${api}/publications`).query({ indexing: 'WOS' })).body.data.rows.map((r) => r.id)).toEqual([pub.id])
    expect((await admin.get(`${api}/publications`).query({ departmentId: 'none' })).body.data.rows.map((r) => r.title)).toEqual(['Optics primer'])
  })

  it('edits, exports as CSV and deletes', async () => {
    const res = await admin.patch(`${api}/publications/${pub.id}`).send({ citations: 12 })
    expect(res.status).toBe(200)
    expect(res.body.data.citations).toBe(12)
    const csv = await admin.get(`${api}/publications/export`).expect(200)
    expect(csv.headers['content-type']).toMatch(/text\/csv/)
    expect(csv.text).toMatch(/Phonon transport in layered materials/)
    expect(csv.text).toMatch(/Scopus; Web of Science/)
    await admin.delete(`${api}/publications/${pub.id}`).expect(200)
    expect((await admin.get(`${api}/publications/${pub.id}`)).status).toBe(404)
  })
})

describe('projects & grants, Ph.D. scholars', () => {
  it('a sanctioned project needs its amount; utilisation can’t exceed what was received', async () => {
    const base = { title: 'Perovskite solar cells', piId: String(h.user._id), agency: 'SERB', status: 'SANCTIONED', sanctionedOn: '2025-08-01', startDate: '2025-09-01', endDate: '2028-08-31' }
    const noMoney = await admin.post(`${api}/projects`).send(base)
    expect(noMoney.status).toBe(400)
    expect(noMoney.body.details.fields.sanctioned).toBeTruthy()
    const over = await admin.post(`${api}/projects`).send({ ...base, sanctioned: 25_00_000_00, received: 10_00_000_00, utilised: 12_00_000_00 })
    expect(over.body.details.fields.utilised).toMatch(/More than was received/)
    const ok = await admin.post(`${api}/projects`).send({ ...base, sanctioned: 25_00_000_00, received: 10_00_000_00, utilised: 4_00_000_00, departmentId: String(physics._id) })
    expect(ok.status).toBe(201)
    expect(ok.body.data).toMatchObject({ agencyLabel: 'SERB / ANRF', receivedPct: 40, utilisedPct: 40, pi: { id: String(h.user._id) } })
    await admin.post(`${api}/projects`).send({ title: 'Industry consultancy', piId: String(h.user._id), agency: 'INDUSTRY', status: 'APPLIED' }).expect(201)
    const list = (await admin.get(`${api}/projects`).expect(200)).body.data
    expect(list.summary).toMatchObject({ total: 2, funded: 1, sanctioned: 25_00_000_00, received: 10_00_000_00, utilised: 4_00_000_00 })
    expect(list.summary.byAgency).toEqual([{ agency: 'SERB', label: 'SERB / ANRF', amount: 25_00_000_00 }])
    expect((await admin.get(`${api}/projects`).query({ status: 'APPLIED' })).body.data.rows).toHaveLength(1)
  })

  it('registers a scholar with a guide; an award needs its date', async () => {
    const s = (await admin.post(`${api}/scholars`).send({ name: 'Anita Desai', guideId: String(h.user._id), registrationDate: '2024-01-15', topic: 'Thin-film optics' }).expect(201)).body.data
    expect(s).toMatchObject({ status: 'REGISTERED', guide: { id: String(h.user._id) } })
    const bad = await admin.patch(`${api}/scholars/${s.id}`).send({ status: 'AWARDED' })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields.awardedOn).toBeTruthy()
    await admin.patch(`${api}/scholars/${s.id}`).send({ status: 'AWARDED', awardedOn: '2026-07-01' }).expect(200)
    const list = (await admin.get(`${api}/scholars`).expect(200)).body.data
    expect(list.summary.byStatus.find((x) => x.status === 'AWARDED').n).toBe(1)
    await admin.delete(`${api}/scholars/${s.id}`).expect(200)
  })

  it('is not there for an institution without the module', async () => {
    const other = await newInstitution('HIGHER_ED')
    const agent = await signIn(app, other.email, other.password)
    expect((await agent.get(`${api}/publications`)).status).toBe(404)
  })
})
