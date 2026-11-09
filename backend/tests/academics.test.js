import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AttendanceSheet } from '../src/models/attendance.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
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

  it('a section’s seating layout sets its capacity; clearing it keeps the capacity as typed', async () => {
    const c4 = (await admin.get(`${api}/classes`)).body.data.classes.find((c) => c.code === '4')
    const made = await admin.post(`${api}/sections`).send({ classId: c4.id, name: 'S', seating: { kind: 'BENCH', perBench: 3, columns: 3, rows: 6, numbering: 'CODE' } })
    expect(made.status).toBe(201)
    expect(made.body.data.capacity).toBe(54)
    expect(made.body.data.seating).toMatchObject({ kind: 'BENCH', perBench: 3, columns: 3, rows: 6, numbering: 'CODE' })
    // single desks seat one each, whatever perBench says
    const desks = await admin.patch(`${api}/sections/${made.body.data.id}`).send({ seating: { kind: 'DESK', perBench: 4, columns: 5, rows: 6 } })
    expect(desks.body.data.capacity).toBe(30)
    expect(desks.body.data.seating).toMatchObject({ kind: 'DESK', perBench: 1, numbering: 'ROW' })
    expect((await admin.patch(`${api}/sections/${made.body.data.id}`).send({ seating: { kind: 'BENCH', columns: 20, rows: 6 } })).status).toBe(400)
    // seat labels: one per seat of the room, free seats included
    const labels = await admin.get('/api/v1/documents/SEAT_LABEL').query({ ids: made.body.data.id, print: '0' })
    expect(labels.status).toBe(200)
    expect((labels.text.match(/class="label/g) ?? []).length).toBe(30)
    expect(labels.text).toMatch(/Free seat/) // the new section has no students
    const cleared = await admin.patch(`${api}/sections/${made.body.data.id}`).send({ seating: null, capacity: 35 })
    expect(cleared.body.data.capacity).toBe(35)
    expect(cleared.body.data.seating).toBeUndefined()
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

describe('class board', () => {
  it('gives each section its boys / girls split and today\'s attendance', async () => {
    const { year, classes } = (await admin.get(`${api}/classes`)).body.data
    const c5 = classes.find((c) => c.code === '5')
    const [secA, secB] = c5.sections
    const today = await runAsTenant(h.tenant._id, async () => {
      const [boy, girl, girl2] = await Student.create([
        { admissionNo: 'B1', firstName: 'Kabir', gender: 'MALE', sectionId: secA.id, classId: c5.id },
        { admissionNo: 'B2', firstName: 'Anika', gender: 'FEMALE', sectionId: secA.id, classId: c5.id },
        { admissionNo: 'B3', firstName: 'Zoya', gender: 'FEMALE', sectionId: secA.id, classId: c5.id },
      ])
      await Student.create({ admissionNo: 'B4', firstName: 'Gone', gender: 'MALE', sectionId: secA.id, classId: c5.id, status: 'LEFT' })
      const date = (await institutionNow()).date
      await AttendanceSheet.create({
        academicYearId: year.id, sectionId: secA.id, date, period: 0,
        entries: [{ studentId: boy._id, status: 'P' }, { studentId: girl._id, status: 'P' }, { studentId: girl2._id, status: 'A' }],
        counts: { P: 2, A: 1, L: 0, HD: 0, LV: 0, total: 3 }, takenBy: 'Admin',
      })
      return date
    })
    const board = (await admin.get(`${api}/board?yearId=${year.id}`)).body.data
    expect(board).toMatchObject({ date: today, yearId: year.id })
    const a = board.sections.find((s) => s.id === secA.id)
    const b = board.sections.find((s) => s.id === secB.id)
    expect(a.genders).toEqual({ MALE: 1, FEMALE: 2, OTHER: 0, UNSET: 0 }) // the student who left is not counted
    expect(a.attendance).toMatchObject({ taken: true, pct: 66.7, takenBy: 'Admin' })
    expect(b.genders).toEqual({ MALE: 0, FEMALE: 0, OTHER: 0, UNSET: 0 })
    if (board.inYear && board.workingDay && !b.holiday) expect(b.attendance).toMatchObject({ taken: false, pct: null })
    else expect(b.attendance).toBeNull()
    // needs academics.classes.view — an accountant has no Academic setup access
    const tpl = (await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['ACCOUNTANT'] })).body.data.created[0]
    await admin.post('/api/v1/core/users').send({ name: 'Board Outsider', email: 'outsider@school.test', roleIds: [tpl.id], password: 'Outs@1234' })
    const o = await signIn(app, 'outsider@school.test', 'Outs@1234')
    expect((await o.get(`${api}/board`)).status).toBe(403)
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
