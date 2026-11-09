import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { checkEligibility, ctcStats, driveFunnel, lpaToPaise, offerPolicyBlock } from '@schoolgiant/shared'
import { CoeSemesterResult } from '../src/models/coe.js'
import { Program, ProgramEnrolment } from '../src/models/programs.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { on } from '../src/platform/events.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
const api = '/api/v1/placements'
const st = {}
let program
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
const told = []

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
  on('placements.drive_open', (p) => { told.push(p.studentId) })
  await asTenant(async () => {
    program = await Program.create({ name: 'B.Tech Computer Science', code: 'BTCSE', semesters: 8, durationYears: 4 })
    const students = await Student.create(['Asha', 'Bala', 'Chitra', 'Dev'].map((n, i) => ({ admissionNo: `P00${i + 1}`, firstName: n })))
    for (const s of students) st[s.firstName] = s
    const sem = { Asha: 7, Bala: 7, Chitra: 7, Dev: 3 }
    await ProgramEnrolment.create(students.map((s) => ({ studentId: s._id, programId: program._id, batch: s.firstName === 'Dev' ? 2025 : 2023, currentSemester: sem[s.firstName] })))
    const sessionId = new mongoose.Types.ObjectId()
    const gpa = { Asha: [8.4, 0], Bala: [6.2, 0], Chitra: [7.6, 2], Dev: [9.1, 0] }
    await CoeSemesterResult.create(students.map((s) => ({ sessionId, studentId: s._id, programId: program._id, semester: 6, cgpa: gpa[s.firstName][0], arrears: gpa[s.firstName][1], published: true })))
  })
})
afterAll(stopDb)

describe('helpers', () => {
  it('checks criteria, the offer policy and works out CTC figures', () => {
    expect(checkEligibility({ minCgpa: 7, maxBacklogs: 0 }, { cgpa: 8, backlogs: 0 })).toMatchObject({ eligible: true })
    expect(checkEligibility({ minCgpa: 7 }, { cgpa: null }).reasons).toEqual(['NO_CGPA'])
    expect(checkEligibility({ min10th: 60 }, { cgpa: 8 }).pending).toEqual(['tenthPct'])
    expect(offerPolicyBlock({ policy: 'ONE', best: 500 })).toBe('PLACED')
    expect(offerPolicyBlock({ policy: 'DREAM', dreamCtc: 1000, best: 500, driveCtc: 800 })).toBe('NOT_DREAM')
    expect(offerPolicyBlock({ policy: 'DREAM', dreamCtc: 1000, best: 500, driveCtc: 1200 })).toBeNull()
    expect(offerPolicyBlock({ policy: 'DREAM', dreamCtc: 1000, best: 1100, driveCtc: 2000 })).toBe('DREAM_HELD')
    expect(ctcStats([300, 500, 1000])).toEqual({ count: 3, highest: 1000, median: 500, average: 600 })
    expect(driveFunnel([{ id: 'r1', name: 'Aptitude' }], [{ status: 'SELECTED', rounds: [{ roundId: 'r1', result: 'PASS' }] }, { status: 'REJECTED', rounds: [{ roundId: 'r1', result: 'FAIL' }] }], 1).map((s) => s.count)).toEqual([2, 1, 1, 1])
  })
})

describe('companies', () => {
  let company
  it('adds a company with HR contacts, refuses the same name twice', async () => {
    company = (await admin.post(`${api}/companies`).send({ name: 'Infosys', sector: 'IT', website: 'https://infosys.com', city: 'Bengaluru', contacts: [{ name: 'Ravi HR', email: 'ravi@infosys.test', mobile: '9845000111' }] }).expect(201)).body.data
    expect(company.contacts[0]).toMatchObject({ name: 'Ravi HR', primary: true })
    expect(company.visits).toMatchObject({ drives: 0, offers: 0 })
    await admin.post(`${api}/companies`).send({ name: 'infosys' }).expect(400)
    const list = (await admin.get(`${api}/companies`)).body
    expect(list.data.map((c) => c.name)).toEqual(['Infosys'])
    expect(list.sectors.IT).toBe(1)
  })
})

describe('a drive from opening to offers', () => {
  let company
  let drive
  beforeAll(async () => {
    company = (await admin.post(`${api}/companies`).send({ name: 'Acme Analytics', sector: 'ANALYTICS' }).expect(201)).body.data
  })

  it('creates a drive with criteria and rounds; opening needs the programs it is for', async () => {
    drive = (await admin.post(`${api}/drives`).send({
      companyId: company.id, title: 'Campus hiring 2027', roles: [{ title: 'Data analyst', openings: 5 }], ctcMin: lpaToPaise(6), ctcMax: lpaToPaise(8),
      startDate: '2026-12-01', registration: { opensOn: '2026-01-01', closesOn: '2099-12-31' },
      eligibility: { minCgpa: 7, maxBacklogs: 1, min10th: 60 },
      rounds: [{ name: 'Aptitude', kind: 'APTITUDE', maxMarks: 100 }, { name: 'HR', kind: 'HR' }],
    }).expect(201)).body.data
    expect(drive.status).toBe('DRAFT')
    expect(drive.rounds.map((r) => r.name)).toEqual(['Aptitude', 'HR'])
    await admin.post(`${api}/drives/${drive.id}/status`).send({ status: 'OPEN' }).expect(400)
    drive = (await admin.patch(`${api}/drives/${drive.id}`).send({ eligibility: { programIds: [String(program._id)], minCgpa: 7, maxBacklogs: 1, min10th: 60 } }).expect(200)).body.data
    expect(drive.rounds).toHaveLength(2)
  })

  it('works out who is eligible: final year of the program, CGPA and backlogs', async () => {
    const res = (await admin.get(`${api}/drives/${drive.id}/eligible`)).body
    const by = Object.fromEntries(res.data.map((s) => [s.name, s]))
    expect(Object.keys(by).sort()).toEqual(['Asha', 'Bala', 'Chitra']) // Dev is in semester 3
    expect(by.Asha).toMatchObject({ eligible: true, cgpa: 8.4, pending: ['tenthPct'] })
    expect(by.Bala.reasons).toEqual(['CGPA'])
    expect(by.Chitra.reasons).toEqual(['BACKLOGS'])
    expect(res.summary).toMatchObject({ pool: 3, eligible: 1 })
  })

  it('opening the drive tells the eligible students', async () => {
    told.length = 0
    const opened = (await admin.post(`${api}/drives/${drive.id}/status`).send({ status: 'OPEN' }).expect(200)).body.data
    expect(opened.status).toBe('OPEN')
    expect(opened.told).toBe(1)
    expect(told).toEqual([String(st.Asha._id)])
  })

  it('registers students: 10th marks needed, criteria checked unless overridden', async () => {
    let r = (await admin.post(`${api}/drives/${drive.id}/registrations`).send({ studentIds: [String(st.Asha._id)] }).expect(201)).body.data
    expect(r).toMatchObject({ added: 0, skipped: [{ reason: 'MISSING_TENTH' }] })
    r = (await admin.post(`${api}/drives/${drive.id}/registrations`).send({ studentIds: [String(st.Asha._id), String(st.Bala._id)], tenthPct: 82 }).expect(201)).body.data
    expect(r.added).toBe(1)
    expect(r.skipped).toMatchObject([{ reason: 'CGPA' }])
    r = (await admin.post(`${api}/drives/${drive.id}/registrations`).send({ studentIds: [String(st.Bala._id)], tenthPct: 70, override: true }).expect(201)).body.data
    expect(r.added).toBe(1)
  })

  it('round results shortlist; failing a round puts a student out; later rounds only for those still in', async () => {
    const d = (await admin.get(`${api}/drives/${drive.id}`)).body.data
    const reg = Object.fromEntries(d.registrations.map((x) => [x.name, x.id]))
    const [apt, hr] = d.rounds
    await admin.put(`${api}/drives/${drive.id}/rounds/${apt.id}/results`).send({ results: [{ registrationId: reg.Asha, marks: 150, result: 'PASS' }] }).expect(400)
    const out = (await admin.put(`${api}/drives/${drive.id}/rounds/${apt.id}/results`).send({ results: [{ registrationId: reg.Asha, marks: 78, result: 'PASS' }, { registrationId: reg.Bala, marks: 41, result: 'FAIL' }], done: true }).expect(200)).body.data
    expect(out.saved).toBe(2)
    expect(out.drive.status).toBe('IN_PROGRESS')
    expect(Object.fromEntries(out.drive.registrations.map((x) => [x.name, x.status]))).toEqual({ Asha: 'REGISTERED', Bala: 'REJECTED' })
    const hrRes = (await admin.put(`${api}/drives/${drive.id}/rounds/${hr.id}/results`).send({ results: [{ registrationId: reg.Asha, result: 'PASS' }, { registrationId: reg.Bala, result: 'PASS' }] }).expect(200)).body.data
    expect(hrRes.saved).toBe(1)
    expect(Object.keys(hrRes.errors)).toEqual([reg.Bala])
  })

  it('final selections become offers; the funnel counts each step', async () => {
    const d = (await admin.get(`${api}/drives/${drive.id}`)).body.data
    const reg = Object.fromEntries(d.registrations.map((x) => [x.name, x.id]))
    await admin.post(`${api}/drives/${drive.id}/select`).send({ registrationIds: [reg.Bala] }).expect(400)
    const sel = (await admin.post(`${api}/drives/${drive.id}/select`).send({ registrationIds: [reg.Asha], ctc: lpaToPaise(7.5), role: 'Data analyst', joiningDate: '2027-07-01' }).expect(201)).body.data
    expect(sel.offers).toBe(1)
    expect(sel.drive.funnel.map((s) => [s.label, s.count])).toEqual([['Registered', 2], ['Aptitude', 1], ['HR', 1], ['Selected', 1], ['Accepted', 0]])
    const offers = (await admin.get(`${api}/offers`)).body
    expect(offers.data).toHaveLength(1)
    expect(offers.data[0]).toMatchObject({ status: 'OFFERED', ctc: lpaToPaise(7.5), student: { name: 'Asha', program: 'BTCSE', batch: 2023 }, company: { name: 'Acme Analytics' } })
  })

  it('accepting follows the dream-offer policy; statistics count the placed', async () => {
    const offer = (await admin.get(`${api}/offers`)).body.data[0]
    await admin.post(`${api}/offers/${offer.id}/decision`).send({ status: 'OFFERED' }).expect(400)
    expect((await admin.post(`${api}/offers/${offer.id}/decision`).send({ status: 'ACCEPTED' }).expect(200)).body.data.status).toBe('ACCEPTED')
    // a second ordinary offer can't be accepted on top (dream CTC defaults to 10 LPA)
    const other = (await admin.post(`${api}/offers`).send({ studentId: String(st.Asha._id), companyId: company.id, ctc: lpaToPaise(6), role: 'Analyst' }).expect(201)).body.data
    expect(other.offCampus).toBe(true)
    await admin.post(`${api}/offers/${other.id}/decision`).send({ status: 'ACCEPTED' }).expect(409)
    // a dream offer can, and releases the earlier acceptance
    const dream = (await admin.post(`${api}/offers`).send({ studentId: String(st.Asha._id), companyId: company.id, ctc: lpaToPaise(14), role: 'Data scientist' }).expect(201)).body.data
    await admin.post(`${api}/offers/${dream.id}/decision`).send({ status: 'ACCEPTED' }).expect(200)
    expect((await admin.get(`${api}/offers/${offer.id}`)).body.data.status).toBe('DECLINED')
    await admin.post(`${api}/offers/${other.id}/decision`).send({ status: 'DECLINED' }).expect(200)

    const stats = (await admin.get(`${api}/offers/stats`)).body.data
    expect(stats.totals).toMatchObject({ pool: 2, placed: 1, placedPct: 50, accepted: 1 })
    expect(stats.ctc.highest).toBe(lpaToPaise(14))
    expect(stats.byCompany[0]).toMatchObject({ name: 'Acme Analytics', accepted: 1 })
    expect(stats.byProgram[0]).toMatchObject({ code: 'BTCSE', pool: 2, placed: 1, pct: 50 })
  })

  it('a placed student with a dream offer is kept out of further drives', async () => {
    const next = (await admin.post(`${api}/drives`).send({ companyId: company.id, title: 'Second round 2027', ctcMax: lpaToPaise(20), eligibility: { programIds: [String(program._id)] } }).expect(201)).body.data
    const by = Object.fromEntries((await admin.get(`${api}/drives/${next.id}/eligible`)).body.data.map((s) => [s.name, s]))
    expect(by.Asha.blocked).toBe('DREAM_HELD')
    expect(by.Bala.blocked).toBeNull()
  })

  it('exports the offers and refuses to delete a company with drives', async () => {
    const res = await admin.get(`${api}/offers/export`).expect(200)
    expect(res.text).toContain('Acme Analytics')
    expect(res.text.split('\n')[0]).toContain('CTC (LPA)')
    await admin.delete(`${api}/companies/${company.id}`).expect(409)
    const c = (await admin.get(`${api}/companies/${company.id}`)).body.data
    expect(c.visits.drives).toBe(2)
    expect(c.drives).toHaveLength(2)
  })
})
