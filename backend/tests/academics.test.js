import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { mySectionIds } from '../src/services/academics.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
})
afterAll(stopDb)

const api = '/api/v1/academics'

describe('academic years', () => {
  it('a new institution starts with the current year (two terms) and a default grading scheme', async () => {
    const years = (await admin.get(`${api}/years`)).body.data
    expect(years).toHaveLength(1)
    expect(years[0]).toMatchObject({ isCurrent: true })
    expect(years[0].terms.map((t) => t.name)).toEqual(['Term 1', 'Term 2'])
    expect(years[0].name).toMatch(/^\d{4}-\d{2}$/)
    const grading = (await admin.get(`${api}/grading`)).body.data
    expect(grading).toHaveLength(1)
    expect(grading[0]).toMatchObject({ isDefault: true })
    expect(grading[0].bands[0]).toMatchObject({ grade: 'A1', min: 91 })
  })

  it('checks the dates: terms inside the year, no overlaps with another year', async () => {
    const bad = await admin.post(`${api}/years`).send({ name: '2030-31', startDate: '2030-04-01', endDate: '2031-03-31', terms: [{ name: 'T1', startDate: '2030-03-01', endDate: '2030-09-30' }] })
    expect(bad.status).toBe(400)
    expect(bad.body.details.fields['terms.0.startDate']).toBe('Before the year starts')
    const current = (await admin.get(`${api}/years`)).body.data[0]
    const overlap = await admin.post(`${api}/years`).send({ name: 'Overlap', startDate: current.startDate, endDate: current.endDate })
    expect(overlap.status).toBe(400)
    expect(overlap.body.details.fields.startDate).toMatch(/Overlaps/)
  })

  it('one year is current at a time; the current one cannot be deleted', async () => {
    const next = (await admin.post(`${api}/years`).send({ name: '2040-41', startDate: '2040-04-01', endDate: '2041-03-31' })).body.data
    expect(next.isCurrent).toBe(false)
    const old = (await admin.get(`${api}/years`)).body.data.find((y) => y.isCurrent)
    await admin.post(`${api}/years/${next.id}/current`).expect(200)
    const years = (await admin.get(`${api}/years`)).body.data
    expect(years.filter((y) => y.isCurrent).map((y) => y.id)).toEqual([next.id])
    expect((await admin.delete(`${api}/years/${next.id}`)).status).toBe(409)
    await admin.post(`${api}/years/${old.id}/current`).expect(200)
    expect((await admin.delete(`${api}/years/${next.id}`)).status).toBe(200)
  })
})

describe('classes, sections and subjects', () => {
  it('quick setup adds the preset classes, sections and subjects — and running it again adds nothing', async () => {
    const res = await admin.post(`${api}/classes/quick-setup`).send({ preset: 'PRIMARY', sectionsPerClass: 2, addSubjects: true })
    expect(res.status).toBe(201)
    expect(res.body.data).toEqual({ classes: 8, sections: 16, subjects: 10 })
    const again = (await admin.post(`${api}/classes/quick-setup`).send({ preset: 'PRIMARY', sectionsPerClass: 2 })).body.data
    expect(again).toEqual({ classes: 0, sections: 0, subjects: 0 })
    const { classes } = (await admin.get(`${api}/classes`)).body.data
    expect(classes.map((c) => c.code)).toEqual(['NUR', 'LKG', 'UKG', '1', '2', '3', '4', '5'])
    const c3 = classes.find((c) => c.code === '3')
    expect(c3.sections.map((s) => s.short)).toEqual(['3-A', '3-B'])
    expect(c3.subjects.map((s) => s.code)).toContain('EVS')
  })

  it('refuses a duplicate class code and a section that already exists', async () => {
    expect((await admin.post(`${api}/classes`).send({ name: 'Another three', code: '3' })).status).toBe(400)
    const c3 = (await admin.get(`${api}/classes`)).body.data.classes.find((c) => c.code === '3')
    const dup = await admin.post(`${api}/sections`).send({ classId: c3.id, name: 'a' })
    expect(dup.status).toBe(400)
    expect(dup.body.details.fields.name).toMatch(/already has section A/)
    expect((await admin.post(`${api}/sections`).send({ classId: c3.id, name: 'C', capacity: 40 })).status).toBe(201)
  })

  it('keeps records that are in use: a section with students, a class with sections, a subject on a class', async () => {
    const c3 = (await admin.get(`${api}/classes`)).body.data.classes.find((c) => c.code === '3')
    const sec = c3.sections.find((s) => s.name === 'A')
    await runAsTenant(h.tenant._id, () => Student.create({ admissionNo: 'A1', firstName: 'Riya', sectionId: sec.id }))
    expect((await admin.delete(`${api}/sections/${sec.id}`)).status).toBe(409)
    expect((await admin.delete(`${api}/classes/${c3.id}`)).status).toBe(409)
    const evs = (await admin.get(`${api}/subjects`)).body.data.find((s) => s.code === 'EVS')
    expect(evs.classCount).toBeGreaterThan(0)
    expect((await admin.delete(`${api}/subjects/${evs.id}`)).status).toBe(409)
    const listed = (await admin.get(`${api}/classes`)).body.data.classes.find((c) => c.code === '3').sections.find((s) => s.name === 'A')
    expect(listed.studentCount).toBe(1)
  })

  it('imports subjects from a file: dry run first, then the real run', async () => {
    const rows = [{ name: 'Sanskrit', code: 'SKT', type: 'language' }, { name: 'Bad', code: '' }]
    const dry = (await admin.post(`${api}/subjects/import`).send({ rows, dryRun: true })).body.data
    expect(dry.rows[0].errors).toEqual([])
    expect(dry.rows[1].errors.map((e) => e.field)).toContain('code')
    const real = (await admin.post(`${api}/subjects/import`).send({ rows: [rows[0]], dryRun: false })).body.data
    expect(real.imported).toBe(1)
    expect((await admin.get(`${api}/subjects`)).body.data.find((s) => s.code === 'SKT')).toMatchObject({ type: 'LANGUAGE' })
  })
})

describe('grading schemes', () => {
  it('refuses overlapping bands and keeps the default', async () => {
    const bad = await admin.post(`${api}/grading`).send({ name: 'Pass / fail', bands: [{ min: 0, max: 40, grade: 'F' }, { min: 35, max: 100, grade: 'P' }] })
    expect(bad.status).toBe(400)
    const ok = (await admin.post(`${api}/grading`).send({ name: 'Pass / fail', bands: [{ min: 0, max: 34.99, grade: 'F' }, { min: 35, max: 100, grade: 'P' }] })).body.data
    expect(ok.bands.map((b) => b.grade)).toEqual(['P', 'F']) // highest first
    const def = (await admin.get(`${api}/grading`)).body.data.find((g) => g.isDefault)
    expect((await admin.delete(`${api}/grading/${def.id}`)).status).toBe(409)
    await admin.post(`${api}/grading/${ok.id}/default`).expect(200)
    expect((await admin.delete(`${api}/grading/${def.id}`)).status).toBe(200)
  })
})

describe('teacher allocation', () => {
  it('sets who teaches what; the teacher’s sections make up their “My classes”', async () => {
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['SUBJECT_TEACHER'] })).body.data.created[0]
    const teacher = (await admin.post('/api/v1/core/users').send({ name: 'Meera Teacher', email: 'meera@school.test', roleIds: [tpl.id], password: 'Teach@123' })).body.data.user
    const c4 = (await admin.get(`${api}/classes`)).body.data.classes.find((c) => c.code === '4')
    const grid = (await admin.get(`${api}/allocation?classId=${c4.id}`)).body.data
    expect(grid.sections).toHaveLength(2)
    const math = grid.subjects.find((s) => s.code === 'MATH')
    const [secA, secB] = grid.sections
    await admin.put(`${api}/allocation`).send({ sectionId: secA.id, subjectId: math.id, teacherId: teacher.id }).expect(200)
    await admin.patch(`${api}/sections/${secB.id}`).send({ classTeacherId: teacher.id }).expect(200)
    const after = (await admin.get(`${api}/allocation?classId=${c4.id}`)).body.data
    expect(after.allocations).toEqual([expect.objectContaining({ sectionId: secA.id, subjectId: math.id, teacherId: teacher.id })])
    const mine = await runAsTenant(h.tenant._id, () => mySectionIds(teacher.id))
    expect(mine.sort()).toEqual([secA.id, secB.id].sort())
    // a subject not on the class can't be allocated
    const skt = (await admin.get(`${api}/subjects`)).body.data.find((s) => s.code === 'SKT')
    expect((await admin.put(`${api}/allocation`).send({ sectionId: secA.id, subjectId: skt.id, teacherId: teacher.id })).status).toBe(400)
    // the teacher sees their sections marked in the lookup, and can't change the setup
    const t = await signIn(app, 'meera@school.test', 'Teach@123')
    const lookup = (await t.get(`${api}/lookup`)).body.data
    expect(lookup.sections.filter((s) => s.mine).map((s) => s.id).sort()).toEqual([secA.id, secB.id].sort())
    expect((await t.post(`${api}/subjects`).send({ name: 'Mine', code: 'MINE' })).status).toBe(403)
    // clearing the cell removes the allocation
    await admin.put(`${api}/allocation`).send({ sectionId: secA.id, subjectId: math.id, teacherId: null }).expect(200)
    expect((await admin.get(`${api}/allocation?classId=${c4.id}`)).body.data.allocations).toEqual([])
  })
})
