import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PRINT_DOC_BY, UGC_CBCS_REGULATION } from '@schoolgiant/shared'
import { COE_DOCS } from '../src/documents/coeDocs.js'
import { PROGRAM_DOCS } from '../src/documents/programDocs.js'
import { defaultTemplate, layoutFor, renderPage } from '../src/documents/engine.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let program
let session
let board
const course = {}
const st = {}
beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('HIGHER_ED')
  admin = await signIn(app, h.email, h.password)
  const reg = (await admin.post('/api/v1/programs/regulations').send({ code: 'R2026', ...UGC_CBCS_REGULATION })).body.data
  program = (await admin.post('/api/v1/programs').send({ name: 'B.Com', code: 'BCOM', level: 'UG', durationYears: 3, semesters: 6, regulationId: reg.id })).body.data
  for (const [code, credits] of [['AC101', 4], ['EC101', 3]]) {
    course[code] = (await admin.post('/api/v1/programs/courses').send({ programId: program.id, code, title: code === 'AC101' ? 'Financial accounting' : 'Business economics', semester: 1, credits, internalMax: 40, externalMax: 60 })).body.data
  }
  await admin.put(`/api/v1/programs/${program.id}/outcomes`).send({ outcomes: [{ code: 'PO1', title: 'Disciplinary knowledge' }, { code: 'PO2', title: 'Critical thinking' }] }).expect(200)
  await admin.put(`/api/v1/programs/courses/${course.AC101.id}/outcomes`).send({
    outcomes: [{ code: 'CO1', statement: 'Prepare final accounts', bloom: 'L3' }, { code: 'CO2', statement: 'Analyse depreciation methods', bloom: 'L4' }],
    coPo: [{ co: 'CO1', po: 'PO1', level: 3 }, { co: 'CO2', po: 'PO2', level: 2 }, { co: 'CO2', po: 'PO1', level: 1 }],
    componentCos: [{ component: 'CIA1', cos: ['CO1'] }, { component: 'CIA2', cos: ['CO2'] }],
  }).expect(200)
  const students = await runAsTenant(h.tenant._id, () => Student.create(['Asha', 'Bala', 'Chitra'].map((n, i) => ({ admissionNo: `B00${i + 1}`, firstName: n }))))
  for (const s of students) st[s.firstName] = String(s._id)
  await admin.post(`/api/v1/programs/${program.id}/students`).send({ studentIds: Object.values(st), batch: 2026, currentSemester: 1 }).expect(201)
})
afterAll(stopDb)

const api = '/api/v1/coe'
const sheetOf = (code, part) => board.rows.find((r) => r.code === code)[part.toLowerCase()].id

describe('exam session and mark sheets', () => {
  it('a session prepares an internal and an external sheet per course for the students who take it', async () => {
    const res = await admin.post(`${api}/sessions`).send({ name: 'Nov 2026 end-semester', kind: 'REGULAR', examMonth: '2026-11', targets: [{ programId: program.id, semester: 1 }], revaluationFee: 50000 })
    expect(res.status).toBe(201)
    session = res.body.data
    // no registration window for the semester: everyone in it takes the core courses
    expect((await admin.post(`${api}/sessions/${session.id}/prepare`)).body.data).toEqual({ created: 4, students: 6 })
    expect((await admin.post(`${api}/sessions/${session.id}/prepare`)).body.data).toEqual({ created: 0, students: 6 })
    board = (await admin.get(`${api}/sessions/${session.id}`)).body.data
    expect(board.session.monthLabel).toBe('NOV 2026')
    expect(board.rows.map((r) => [r.code, r.students, r.internal.total, r.external.total])).toEqual([['AC101', 3, 3, 3], ['EC101', 3, 3, 3]])
    expect(board.summary).toMatchObject({ sheets: 4, locked: 0, entries: 12, entered: 0 })
  })

  it('internal marks per component, scaled to the course’s internal maximum', async () => {
    const id = sheetOf('AC101', 'INTERNAL')
    const comps = { Asha: [20, 18, 5, 5], Bala: [15, 15, 4, 4], Chitra: [10, 8, 3, 3] }
    const entries = Object.entries(comps).map(([n, [a, b, c, d]]) => ({ studentId: st[n], components: { CIA1: a, CIA2: b, ASG: c, ATT: d } }))
    const bad = await admin.put(`${api}/sheets/${id}`).send({ entries: [{ studentId: st.Asha, components: { CIA1: 25 } }] })
    expect(bad.status).toBe(400)
    expect(bad.body.message).toMatch(/CIA1: 0 to 20/)
    const sheet = (await admin.put(`${api}/sheets/${id}`).send({ entries })).body.data
    expect(Object.fromEntries(sheet.entries.map((e) => [e.name, e.marks]))).toEqual({ Asha: 38.4, Bala: 30.4, Chitra: 19.2 })
    const ec = sheetOf('EC101', 'INTERNAL')
    await admin.put(`${api}/sheets/${ec}`).send({ entries: Object.values(st).map((s) => ({ studentId: s, components: { CIA1: 15, CIA2: 15, ASG: 5, ATT: 5 } })) }).expect(200)
  })

  it('external marks are entered against dummy numbers; only the controller can reveal who is who', async () => {
    const id = sheetOf('AC101', 'EXTERNAL')
    const masked = (await admin.get(`${api}/sheets/${id}`)).body.data
    expect(masked.masked).toBe(true)
    expect(masked.entries[0]).not.toHaveProperty('studentId')
    expect(masked.entries[0]).not.toHaveProperty('name')
    expect(masked.entries.every((e) => /^D\d{6}$/.test(e.dummyNo))).toBe(true)
    // an evaluator (may view and enter marks, not lock) never sees names, even when asking
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Evaluator', permissions: ['coe.marks.view', 'coe.marks.edit'], dataScopes: { coe: 'ALL' } })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Dr Evaluator', email: 'eval@coe.test', roleIds: [role.id], password: 'Eval@1234' }).expect(201)
    const evaluator = await signIn(app, 'eval@coe.test', 'Eval@1234')
    const theirs = (await evaluator.get(`${api}/sheets/${id}`).query({ reveal: '1' })).body.data
    expect(theirs.masked).toBe(true)
    expect(theirs.canLock).toBe(false)
    expect(theirs.entries.some((e) => e.name)).toBe(false)
    const revealed = (await admin.get(`${api}/sheets/${id}`).query({ reveal: '1' })).body.data
    expect(revealed.masked).toBe(false)
    const dummy = Object.fromEntries(revealed.entries.map((e) => [e.name, e.dummyNo]))
    // the evaluator enters by dummy number
    await evaluator.put(`${api}/sheets/${id}`).send({ entries: [{ dummyNo: dummy.Asha, marks: 55 }, { dummyNo: dummy.Bala, marks: '40' }] }).expect(200)
    expect((await evaluator.put(`${api}/sheets/${id}`).send({ entries: [{ dummyNo: dummy.Chitra, marks: 61 }] })).status).toBe(400)
    expect((await evaluator.post(`${api}/sheets/${id}/lock`)).status).toBe(403)
    // not every script has marks yet
    expect((await admin.post(`${api}/sheets/${id}/lock`)).status).toBe(409)
    await evaluator.put(`${api}/sheets/${id}`).send({ entries: [{ dummyNo: dummy.Chitra, marks: 20 }] }).expect(200)

    const ec = sheetOf('EC101', 'EXTERNAL')
    const ecDummy = Object.fromEntries((await admin.get(`${api}/sheets/${ec}`).query({ reveal: '1' })).body.data.entries.map((e) => [e.name, e.dummyNo]))
    await admin.put(`${api}/sheets/${ec}`).send({ entries: [{ dummyNo: ecDummy.Asha, marks: 50 }, { dummyNo: ecDummy.Bala, absent: true }, { dummyNo: ecDummy.Chitra, marks: 30 }] }).expect(200)
  })

  it('moderation is proposed, then approved by someone who may lock marks, and applied to the external marks', async () => {
    const ec = sheetOf('EC101', 'EXTERNAL')
    const evaluator = await signIn(app, 'eval@coe.test', 'Eval@1234')
    const proposed = (await evaluator.post(`${api}/sheets/${ec}/moderation`).send({ kind: 'ADD', value: 2, reason: 'Question 7 was out of syllabus' })).body.data
    expect(proposed.moderation).toMatchObject({ kind: 'ADD', value: 2, status: 'PROPOSED', proposedBy: 'Dr Evaluator' })
    expect((await admin.post(`${api}/sheets/${ec}/lock`)).status).toBe(409) // a moderation is waiting
    expect((await evaluator.post(`${api}/sheets/${ec}/moderation/decide`).send({ approve: true })).status).toBe(403)
    const approved = (await admin.post(`${api}/sheets/${ec}/moderation/decide`).send({ approve: true })).body.data
    expect(approved.moderation.status).toBe('APPROVED')
    expect(approved.entries.map((e) => e.moderated).filter((v) => v !== null).sort()).toEqual([32, 52])
  })
})

describe('results', () => {
  it('works out grades, SGPA and arrears; publishing needs every sheet locked', async () => {
    const out = (await admin.post(`${api}/sessions/${session.id}/compute`)).body.data
    expect(out).toEqual({ results: 6, missing: 0, students: 3 })
    expect((await admin.post(`${api}/sessions/${session.id}/publish`)).status).toBe(409)
    for (const r of board.rows) for (const part of ['internal', 'external']) await admin.post(`${api}/sheets/${r[part].id}/lock`).expect(200)
    const pub = await admin.post(`${api}/sessions/${session.id}/publish`)
    expect(pub.status).toBe(200)
    expect(pub.body.data.status).toBe('PUBLISHED')
    // published: marks no longer change
    expect((await admin.post(`${api}/sheets/${sheetOf('AC101', 'EXTERNAL')}/unlock`).send({ reason: 'Typo' })).status).toBe(409)

    const { rows, summary } = (await admin.get(`${api}/sessions/${session.id}/results`)).body.data
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    // Asha: AC101 38.4 + 55 = 93.4 → O (10); EC101 32 + 52 = 84 → A+ (9) → (40 + 27) / 7
    expect(by.Asha).toMatchObject({ sgpa: 9.57, cgpa: 9.57, creditsEarned: 7, arrears: 0, result: 'PASS', published: true })
    // Bala: AC101 70.4 → A (8); EC101 absent → Ab → 32 / 7
    expect(by.Bala).toMatchObject({ sgpa: 4.57, creditsEarned: 4, arrears: 1, result: 'FAIL' })
    // Chitra: AC101 external 20 / 60 is below the 40 % minimum → F; EC101 32 + 32 = 64 → B+ (7) → 21 / 7
    expect(by.Chitra).toMatchObject({ sgpa: 3, arrears: 1, result: 'FAIL' })
    expect(summary).toMatchObject({ students: 3, passed: 1, passPct: 33.3, withArrears: 2 })
    expect(summary.grades).toEqual([{ grade: 'O', count: 1 }, { grade: 'A+', count: 1 }, { grade: 'A', count: 1 }, { grade: 'B+', count: 1 }, { grade: 'F', count: 1 }, { grade: 'Ab', count: 1 }])
    // the list is paged and filtered on the server; the tiles still count the whole session
    const results = (q) => admin.get(`${api}/sessions/${session.id}/results`).query(q).then((r) => r.body.data)
    expect(await results({ result: 'ARREARS' })).toMatchObject({ total: 2, summary: { students: 3, passed: 1 } })
    expect((await results({ search: 'bala' })).rows.map((r) => r.name)).toEqual(['Bala'])
    const second = await results({ page: 2, pageSize: 2 })
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 })
    expect(second.rows).toHaveLength(1)
    const detail = (await admin.get(`${api}/results/${by.Chitra.id}`)).body.data
    expect(detail.courses.find((c) => c.code === 'AC101')).toMatchObject({ grade: 'F', reason: 'EXTERNAL', internal: 19.2, external: 20 })
    expect(detail.trend).toEqual([expect.objectContaining({ semester: 1, sgpa: 3 })])
  })

  it('revaluation: requested → approved → revalued; the higher marks count and the SGPA follows', async () => {
    const cands = (await admin.get(`${api}/revaluations/candidates`).query({ sessionId: session.id, search: 'chitra' })).body.data
    const ac = cands.find((c) => c.courseCode === 'AC101')
    expect(ac).toMatchObject({ external: 20, grade: 'F' })
    const req = (await admin.post(`${api}/revaluations`).send({ resultId: ac.id, reason: 'Expected a higher score', feePaid: true })).body.data
    expect(req).toMatchObject({ status: 'REQUESTED', fee: 50000, oldMarks: 20, oldGrade: 'F' })
    expect((await admin.post(`${api}/revaluations`).send({ resultId: ac.id })).status).toBe(409)
    expect((await admin.post(`${api}/revaluations/${req.id}/act`).send({ action: 'REVALUE', newMarks: 26 })).status).toBe(409) // approve first
    await admin.post(`${api}/revaluations/${req.id}/act`).send({ action: 'APPROVE' }).expect(200)
    const done = (await admin.post(`${api}/revaluations/${req.id}/act`).send({ action: 'REVALUE', newMarks: 26 })).body.data
    // 19.2 + 26 = 45.2 % and 43 % in the external → C (5)
    expect(done).toMatchObject({ status: 'REVALUED', oldMarks: 20, newMarks: 26, oldGrade: 'F', newGrade: 'C' })
    expect(done.history.map((x) => x.action)).toEqual(['REQUESTED', 'APPROVED', 'REVALUED'])
    const chitra = (await admin.get(`${api}/sessions/${session.id}/results`)).body.data.rows.find((r) => r.name === 'Chitra')
    expect(chitra).toMatchObject({ sgpa: 5.86, arrears: 0, result: 'PASS' }) // (20 + 21) / 7
    const list = (await admin.get(`${api}/revaluations`)).body.data
    expect(list.summary).toMatchObject({ total: 1, REVALUED: 1, improved: 1, fees: 50000 })
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 50 })
    // a status filter picks rows; the tiles still count every request
    const requested = (await admin.get(`${api}/revaluations`).query({ status: 'REQUESTED' })).body.data
    expect(requested).toMatchObject({ rows: [], total: 0, summary: { total: 1, REVALUED: 1 } })
  })

  it('a supplementary session re-examines arrears; the pass replaces the failed attempt in the CGPA', async () => {
    const sup = (await admin.post(`${api}/sessions`).send({ name: 'Apr 2027 supplementary', kind: 'SUPPLEMENTARY', examMonth: '2027-04', targets: [{ programId: program.id, semester: 1 }] })).body.data
    expect((await admin.post(`${api}/sessions/${sup.id}/prepare`)).body.data).toEqual({ created: 1, students: 1 })
    const b = (await admin.get(`${api}/sessions/${sup.id}`)).body.data
    expect(b.rows.map((r) => [r.code, r.internal, r.external.total])).toEqual([['EC101', null, 1]])
    const sheet = (await admin.get(`${api}/sheets/${b.rows[0].external.id}`)).body.data
    await admin.put(`${api}/sheets/${sheet.id}`).send({ entries: [{ dummyNo: sheet.entries[0].dummyNo, marks: 45 }] }).expect(200)
    await admin.post(`${api}/sheets/${sheet.id}/lock`).expect(200)
    await admin.post(`${api}/sessions/${sup.id}/publish`).expect(200)
    const bala = (await admin.get(`${api}/sessions/${sup.id}/results`)).body.data.rows[0]
    // internal 32 carried over + 45 = 77 → A (8); CGPA (32 + 24) / 7 = 8
    expect(bala).toMatchObject({ name: 'Bala', sgpa: 8, cgpa: 8, arrears: 0, result: 'PASS', creditsRegistered: 3 })
    const detail = (await admin.get(`${api}/results/${bala.id}`)).body.data
    expect(detail.courses[0]).toMatchObject({ code: 'EC101', attempt: 2, internal: 32, grade: 'A' })
    expect(detail.trend.map((t) => t.cgpa)).toEqual([4.57, 8])
  })
})

describe('printed documents and attainment', () => {
  const render = (def, id, docType) => runAsTenant(h.tenant._id, async () => {
    const model = def.model(await def.load(id, { fullAccess: true, userId: h.user._id }))
    const layout = layoutFor({ paper: 'A4', orientation: 'portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 }, letterhead: 'FULL' }, null, { name: 'Test College' })
    return { model, html: renderPage({ title: def.title(model), source: defaultTemplate(docType), model, layout, autoPrint: false }) }
  })

  it('grade card and consolidated transcript', async () => {
    const rows = (await admin.get(`${api}/sessions/${session.id}/results`)).body.data.rows
    const asha = rows.find((r) => r.name === 'Asha')
    const card = await render(COE_DOCS.GRADE_CARD, asha.id, 'GRADE_CARD')
    expect(card.model.result).toMatchObject({ sgpa: 9.57, pass: true })
    expect(card.html).toMatch(/Grade card/)
    expect(card.html).toMatch(/AC101/)
    expect(card.html).toMatch(/9\.57/)
    expect(card.html).not.toMatch(/PROVISIONAL/)
    const bala = rows.find((r) => r.name === 'Bala')
    const tr = await render(COE_DOCS.TRANSCRIPT, bala.enrolmentId, 'TRANSCRIPT')
    expect(tr.model.result).toMatchObject({ cgpa: 8, earned: 7, arrears: 0, pct: 80, classification: 'First class with distinction' })
    expect(tr.model.semesters[0].courses.find((c) => c.code === 'EC101')).toMatchObject({ attempt: 2, grade: 'A', session: 'APR 2027' })
    expect(tr.html).toMatch(/PROVISIONAL/) // 7 of 160 credits
    // served by /documents once GRADE_CARD is listed in PRINT_DOCS (packages/shared/src/printing.js)
    if (PRINT_DOC_BY.GRADE_CARD) expect((await admin.get(`/api/v1/documents/GRADE_CARD/${asha.id}`).query({ print: '0' })).status).toBe(200)
  })

  it('CO and PO attainment from the session’s marks', async () => {
    const a = (await admin.get(`/api/v1/programs/${program.id}/attainment`).query({ sessionId: session.id })).body.data
    const ac = a.courses.find((c) => c.code === 'AC101')
    // CO1 (CIA1, target 60 %): Asha 20/20, Bala 15/20 reach it, Chitra 10/20 does not → 66.7 % → level 2
    // external (all COs): Asha 55, Bala 40 (66.7 %) reach 60 %, Chitra 20 does not → 66.7 % → level 2
    expect(ac.cos[0]).toMatchObject({ code: 'CO1', internalPct: 66.7, internalLevel: 2, externalPct: 66.7, externalLevel: 2, attainment: 2 })
    // CO2 (CIA2): 18/20, 15/20 reach it → level 2 again
    expect(ac.cos[1]).toMatchObject({ code: 'CO2', internalLevel: 2, attainment: 2 })
    expect(a.po).toEqual({ PO1: 2, PO2: 2 })
    expect(a.summary).toMatchObject({ courses: 2, cos: 2, cosAttained: 2 })
    const report = await runAsTenant(h.tenant._id, async () => {
      const def = PROGRAM_DOCS.ATTAINMENT_REPORT
      return def.model(await def.load(program.id))
    })
    expect(report.po).toEqual([{ code: 'PO1', value: 2 }, { code: 'PO2', value: 2 }])
  })
})
