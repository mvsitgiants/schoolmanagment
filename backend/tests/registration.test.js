import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UGC_CBCS_REGULATION, checkRegistration } from '@schoolgiant/shared'
import { AcademicYear } from '../src/models/academics.js'
import { CoeResult, CoeSession } from '../src/models/coe.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { registeredCourses } from '../src/services/registration.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let program
let window
const course = {}
const st = {}
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
  const reg = (await admin.post('/api/v1/programs/regulations').send({ code: 'R2026', ...UGC_CBCS_REGULATION, semesterMinCredits: 10, semesterMaxCredits: 14 })).body.data
  program = (await admin.post('/api/v1/programs').send({ name: 'B.Sc Physics', code: 'BSCPH', level: 'UG', durationYears: 3, semesters: 6, regulationId: reg.id })).body.data
  const add = async (code, semester, credits, extra = {}) => {
    course[code] = (await admin.post('/api/v1/programs/courses').send({ programId: program.id, code, title: code, semester, credits, ...extra })).body.data
  }
  await add('PH101', 1, 4)
  await add('PH201', 2, 4, { prerequisiteIds: [course.PH101.id] })
  await add('MA201', 2, 4)
  await add('EL211', 2, 3, { type: 'ELECTIVE', electiveGroup: 'DSE' })
  await add('EL212', 2, 3, { type: 'ELECTIVE', electiveGroup: 'DSE' })
  await add('EL213', 2, 3, { type: 'ELECTIVE', electiveGroup: 'DSE' })
  const students = await runAsTenant(h.tenant._id, () => Student.create(['Asha', 'Bala', 'Chitra'].map((n, i) => ({ admissionNo: `P00${i + 1}`, firstName: n }))))
  for (const s of students) st[s.firstName] = String(s._id)
  await admin.post(`/api/v1/programs/${program.id}/students`).send({ studentIds: Object.values(st), batch: 2025, currentSemester: 2 }).expect(201)
  // Asha and Bala passed PH101 last year (published results); Chitra failed it
  await runAsTenant(h.tenant._id, async () => {
    const year = await AcademicYear.findOne({ isCurrent: true })
    const s = await CoeSession.create({ name: 'Nov 2025', academicYearId: year._id, status: 'PUBLISHED', targets: [{ programId: program.id, semester: 1 }] })
    for (const [name, pass] of [['Asha', true], ['Bala', true], ['Chitra', false]]) {
      await CoeResult.create({ sessionId: s._id, studentId: st[name], programId: program.id, courseId: course.PH101.id, semester: 1, credits: 4, pass, grade: pass ? 'A' : 'F', points: pass ? 8 : 0, order: 1 })
    }
  })
})
afterAll(stopDb)

const api = '/api/v1/registration'

describe('registration rules (shared)', () => {
  it('lists every problem with a selection', () => {
    const w = { minCredits: 10, maxCredits: 12, offerings: [{ courseId: 'a', mandatory: true }, { courseId: 'b', group: 'G' }, { courseId: 'c', group: 'G' }], groups: [{ code: 'G', name: 'Electives', minPick: 1, maxPick: 1 }] }
    const courses = { a: { code: 'A', credits: 4 }, b: { code: 'B', credits: 3 }, c: { code: 'C', credits: 3 }, z: { code: 'Z', credits: 9 } }
    expect(checkRegistration(w, courses, ['a', 'b', 'c']).errors.map((e) => e.code)).toEqual(['GROUP_MAX'])
    expect(checkRegistration(w, courses, ['b']).errors.map((e) => e.code)).toEqual(['MANDATORY', 'MIN_CREDITS'])
    expect(checkRegistration(w, courses, ['a', 'b', 'z']).errors.map((e) => e.code)).toEqual(['NOT_OFFERED', 'MAX_CREDITS'])
    expect(checkRegistration({ ...w, maxCredits: 20 }, courses, ['a', 'c'])).toEqual({ credits: 7, errors: [{ code: 'MIN_CREDITS', message: '7 credits — at least 10 needed' }] })
  })
})

describe('windows', () => {
  it('a new window offers the semester’s courses: core compulsory, electives in their group; credits from the regulation', async () => {
    const res = await admin.post(`${api}/windows`).send({ programId: program.id, semester: 2, opensOn: '2000-01-01', closesOn: '2099-12-31' })
    expect(res.status).toBe(201)
    window = res.body.data
    expect(window).toMatchObject({ status: 'OPEN', minCredits: 10, maxCredits: 14, requireApproval: true })
    expect(window.offerings.map((o) => [o.code, o.mandatory, o.group ?? null])).toEqual([['EL211', false, 'DSE'], ['EL212', false, 'DSE'], ['EL213', false, 'DSE'], ['MA201', true, null], ['PH201', true, null]])
    expect(window.groups).toEqual([{ code: 'DSE', name: 'DSE', minPick: 1, maxPick: 1 }])
    expect((await admin.post(`${api}/windows`).send({ programId: program.id, semester: 2, opensOn: '2000-01-01', closesOn: '2099-12-31' })).status).toBe(400)
    // one seat in EL211
    const offerings = window.offerings.map((o) => ({ courseId: o.courseId, mandatory: o.mandatory, group: o.group, seats: o.code === 'EL211' ? 1 : null }))
    const upd = (await admin.patch(`${api}/windows/${window.id}`).send({ offerings })).body.data
    expect(upd.offerings.find((o) => o.code === 'EL211').seats).toBe(1)
    const list = (await admin.get(`${api}/windows`)).body.data
    expect(list[0]).toMatchObject({ programCode: 'BSCPH', semester: 2, students: 3, submitted: 0, status: 'OPEN' })
  })
})

describe('a student’s course selection', () => {
  const pick = (...codes) => codes.map((c) => course[c].id)
  it('checks compulsory courses, group picks, credits, seats and prerequisites', async () => {
    const url = (s) => `${api}/windows/${window.id}/students/${st[s]}`
    const missing = await admin.put(url('Asha')).send({ courseIds: pick('MA201', 'EL211') })
    expect(missing.status).toBe(400)
    expect(missing.body.details.errors.map((e) => e.code)).toContain('MANDATORY')
    const twoElectives = await admin.put(url('Asha')).send({ courseIds: pick('PH201', 'MA201', 'EL211', 'EL212') })
    expect(twoElectives.body.details.errors.map((e) => e.code)).toEqual(['GROUP_MAX'])
    const ok = await admin.put(url('Asha')).send({ courseIds: pick('PH201', 'MA201', 'EL211') })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ status: 'SUBMITTED', credits: 11 })
    // EL211 had one seat — Asha has it
    const full = await admin.put(url('Bala')).send({ courseIds: pick('PH201', 'MA201', 'EL211') })
    expect(full.body.details.errors.map((e) => e.code)).toEqual(['SEATS_FULL'])
    await admin.put(url('Bala')).send({ courseIds: pick('PH201', 'MA201', 'EL212') }).expect(200)
    // Chitra has not passed PH101, which PH201 needs
    const pre = await admin.put(url('Chitra')).send({ courseIds: pick('PH201', 'MA201', 'EL213') })
    expect(pre.body.details.errors).toEqual([expect.objectContaining({ code: 'PREREQUISITE', message: 'PH201 needs PH101 passed first' })])
    const form = (await admin.get(url('Chitra'))).body.data
    expect(form.offerings.find((o) => o.code === 'PH201').prerequisitesMet).toBe(false)
    expect(form.offerings.find((o) => o.code === 'EL211').seatsLeft).toBe(0)
    expect(form.registration).toBeNull()
  })

  it('advisor approves (one or many) or rejects with a note; add / drop sends it back for approval', async () => {
    const { rows, summary } = (await admin.get(`${api}/windows/${window.id}/registrations`)).body.data
    expect(summary).toMatchObject({ total: 3, SUBMITTED: 2, NOT_REGISTERED: 1 })
    const asha = rows.find((r) => r.name === 'Asha')
    const bala = rows.find((r) => r.name === 'Bala')
    expect(asha.courses).toEqual(['PH201', 'MA201', 'EL211'])
    expect((await admin.post(`${api}/decide`).send({ ids: [bala.registrationId], action: 'REJECT' })).status).toBe(400) // needs a note
    const done = (await admin.post(`${api}/decide`).send({ ids: [asha.registrationId, bala.registrationId], action: 'APPROVE' })).body.data
    expect(done).toEqual({ done: 2, skipped: 0 })
    expect((await admin.post(`${api}/decide`).send({ ids: [asha.registrationId], action: 'APPROVE' })).body.data).toEqual({ done: 0, skipped: 1 })
    // Asha swaps her elective: back to waiting, the change is in the history
    const swap = (await admin.put(`${api}/windows/${window.id}/students/${st.Asha}`).send({ courseIds: pick('PH201', 'MA201', 'EL213') })).body.data
    expect(swap.status).toBe('SUBMITTED')
    expect(swap.history.at(-1)).toMatchObject({ action: 'CHANGED', added: ['EL213'], dropped: ['EL211'] })
    await admin.post(`${api}/decide`).send({ ids: [asha.registrationId], action: 'APPROVE' }).expect(200)
  })

  it('course rosters, and the approved courses the exam controller reads', async () => {
    const rosters = (await admin.get(`${api}/windows/${window.id}/rosters`)).body.data
    expect(rosters.find((r) => r.code === 'PH201')).toMatchObject({ registered: 2, approved: 2 })
    expect(rosters.find((r) => r.code === 'EL211')).toMatchObject({ registered: 0, seats: 1 })
    const roster = (await admin.get(`${api}/windows/${window.id}/rosters/${course.EL213.id}`)).body.data
    expect(roster.students.map((s) => s.name)).toEqual(['Asha'])
    const map = await runAsTenant(h.tenant._id, () => registeredCourses({ academicYearId: window.academicYearId, programId: program.id, semester: 2 }))
    expect(map.get(st.Asha).sort()).toEqual([course.PH201.id, course.MA201.id, course.EL213.id].sort())
    expect(map.has(st.Chitra)).toBe(false)
    expect(await runAsTenant(h.tenant._id, () => registeredCourses({ academicYearId: window.academicYearId, programId: program.id, semester: 4 }))).toBeNull()
  })

  it('no add / drop once the window closes; a course with students cannot leave the window', async () => {
    const remaining = window.offerings.filter((o) => o.code !== 'EL212').map((o) => ({ courseId: o.courseId, mandatory: o.mandatory, group: o.group }))
    expect((await admin.patch(`${api}/windows/${window.id}`).send({ offerings: remaining })).status).toBe(409)
    await admin.patch(`${api}/windows/${window.id}`).send({ closed: true }).expect(200)
    const late = await admin.put(`${api}/windows/${window.id}/students/${st.Bala}`).send({ courseIds: pick('PH201', 'MA201', 'EL213') })
    expect(late.status).toBe(409)
    expect(late.body.message).toMatch(/closed/)
  })
})
