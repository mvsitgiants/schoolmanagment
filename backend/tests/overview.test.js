import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deltaPct, priorRange, splitRange } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let admin
let section
beforeAll(async () => {
  app = await startDb()
  const h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
  section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  await admin.post('/api/v1/students').send({ firstName: 'Aarav', rollNo: '1', gender: 'MALE', sectionId: section.id, guardians: [{ name: 'Parent', mobile: '9845000071' }] }).expect(201)
})
afterAll(stopDb)

const api = '/api/v1/dashboard/overview'

describe('helpers', () => {
  it('finds the period before, cuts a period for sparklines, and works out the change', () => {
    expect(priorRange('2026-11-01', '2026-11-09')).toEqual({ from: '2026-10-23', to: '2026-10-31' })
    expect(splitRange('2026-11-01', '2026-11-03')).toEqual([{ from: '2026-11-01', to: '2026-11-01' }, { from: '2026-11-02', to: '2026-11-02' }, { from: '2026-11-03', to: '2026-11-03' }])
    const year = splitRange('2026-01-01', '2026-12-31', 12)
    expect(year).toHaveLength(12)
    expect(year[0].from).toBe('2026-01-01')
    expect(year.at(-1).to).toBe('2026-12-31')
    expect(deltaPct(150, 100)).toBe(50)
    expect(deltaPct(5, 0)).toBeNull()
  })
})

describe('Home overview', () => {
  it('gives an administrator the institution at a glance for the period', async () => {
    const d = (await admin.get(api)).body.data
    expect(d.range.to).toBe(d.today)
    expect(d.range.from).toBe(`${d.today.slice(0, 7)}-01`)
    expect(d.kpis.students).toMatchObject({ value: 1, boys: 1 })
    expect(d.kpis.students.spark).toHaveLength(d.buckets.length)
    expect(d.kpis.attendance.today).toMatchObject({ sections: expect.any(Number), marked: 0 })
    expect(d.kpis.fees).toMatchObject({ value: 0, position: expect.any(Object) })
    expect(Array.isArray(d.pulse)).toBe(true)
    expect(Array.isArray(d.approvals)).toBe(true)
    expect(Array.isArray(d.activity)).toBe(true) // the administrator may read the audit log
  })

  it('takes a period (either way round) and refuses a bad date', async () => {
    const d = (await admin.get(`${api}?from=2026-03-31&to=2026-03-01`)).body.data
    expect(d.range).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(d.prev).toEqual({ from: '2026-01-29', to: '2026-02-28' })
    expect((await admin.get(`${api}?from=yesterday`)).status).toBe(400)
  })

  it('shows a teacher only what their role can see, within their classes', async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    await admin.post('/api/v1/core/users').send({ name: 'Teacher', email: 'teacher@overview.test', roleIds: [tpl.id], password: 'Teach@123' }).expect(201)
    const tc = await signIn(app, 'teacher@overview.test', 'Teach@123')
    const d = (await tc.get(api)).body.data
    expect(d.activity).toBeNull() // no audit log for a teacher
    expect(d.kpis.fees).toBeUndefined()
    expect(d.kpis.expenses).toBeUndefined()
    if (d.kpis.students) expect(d.kpis.students.value).toBe(0) // teaches no class yet
  })
})
