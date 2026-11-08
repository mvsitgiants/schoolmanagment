import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { addDaysYmd, isbn13, isValidIsbn, lateDays, lateFine, loanState } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { LibraryLoan } from '../src/models/library.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { sendReminders } from '../src/services/libraryDesk.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let student
let t
const api = '/api/v1/library'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  const section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Meera', sectionId: section.id, guardians: [{ name: 'Parent Meera', relation: 'MOTHER', mobile: '9845000701', isPrimary: true }] })).body.data
  await asTenant(() => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
  t = (await asTenant(() => institutionNow())).date
})
afterAll(stopDb)

describe('helpers', () => {
  it('checks ISBNs and works out fines', () => {
    expect(isValidIsbn('978-0-306-40615-7')).toBe(true)
    expect(isValidIsbn('978-0-306-40615-8')).toBe(false)
    expect(isbn13('0-306-40615-2')).toBe('9780306406157')
    expect(lateDays('2026-01-10', '2026-01-15')).toBe(5)
    expect(lateDays('2026-01-10', '2026-01-15', 2)).toBe(3)
    expect(lateDays('2026-01-10', '2026-01-08')).toBe(0)
    expect(lateFine(5, { perDay: 100, max: 300 })).toBe(300)
    expect(lateFine(5, { perDay: 100 })).toBe(500)
    expect(loanState({ status: 'ISSUED', dueOn: '2026-01-10' }, '2026-01-11')).toBe('OVERDUE')
  })
})

describe('the catalogue', () => {
  let title
  it('adds a title with numbered copies, and refuses the same ISBN twice', async () => {
    title = (await admin.post(`${api}/titles`).send({ title: 'The Jungle Book', authors: ['Rudyard Kipling'], isbn: '0-306-40615-2', category: 'Fiction', callNo: '823 KIP', copies: { count: 2, price: 25000, shelf: 'A3' } }).expect(201)).body.data
    expect(title.isbn).toBe('9780306406157')
    expect(title.copyList.map((c) => c.accessionNo)).toEqual(['LIB000001', 'LIB000002'])
    expect(title.copies).toMatchObject({ total: 2, available: 2 })
    await admin.post(`${api}/titles`).send({ title: 'Again', isbn: '9780306406157' }).expect(400)
    await admin.post(`${api}/titles`).send({ title: 'Bad', isbn: '9780306406158' }).expect(400)
  })

  it('adds copies that already carry a number, and finds a title by it', async () => {
    const added = (await admin.post(`${api}/titles/${title.id}/copies`).send({ accessionNos: ['OLD-17'] }).expect(201)).body.data
    expect(added[0].accessionNo).toBe('OLD-17')
    await admin.post(`${api}/titles/${title.id}/copies`).send({ accessionNos: ['old-17'] }).expect(400)
    const found = (await admin.get(`${api}/titles`).query({ search: 'OLD-17' })).body.data
    expect(found.map((x) => x.id)).toEqual([title.id])
  })

  it('imports a spreadsheet: checks rows on a dry run, adds copies to a title already there', async () => {
    const rows = [
      { title: 'Wings of Fire', authors: 'A. P. J. Abdul Kalam; Arun Tiwari', isbn: '', copies: '3', price: '199', category: 'Biography' },
      { title: 'The Jungle Book', isbn: '9780306406157', accessionNos: 'OLD-18, OLD-19' },
      { title: 'Broken', isbn: '123', accessionNos: 'OLD-17' },
    ]
    const dry = (await admin.post(`${api}/titles/import`).send({ rows, dryRun: true }).expect(200)).body.data.rows
    expect(dry[0].errors).toEqual([])
    expect(dry[1].note).toMatch(/Adds 2 copies/)
    expect(dry[2].errors.map((e) => e.field).sort()).toEqual(['accessionNos', 'isbn'])
    const done = (await admin.post(`${api}/titles/import`).send({ rows: rows.slice(0, 2) }).expect(200)).body.data
    expect(done).toMatchObject({ imported: 1, copies: 5, errors: [] })
    const jungle = (await admin.get(`${api}/titles/${title.id}`)).body.data
    expect(jungle.copies.total).toBe(5)
  })

  it('prints barcode labels and exports the accession register', async () => {
    const html = (await admin.get(`/api/v1/documents/LIBRARY_LABEL?ids=${title.id}&print=0`).expect(200)).text
    expect(html).toContain('LIB000001')
    expect(html).toContain('<svg')
    const csv = (await admin.get(`${api}/titles/export`).expect(200)).text
    expect(csv).toContain('OLD-19')
    expect(csv).toContain('Wings of Fire')
  })
})

describe('the issue desk', () => {
  it('finds the borrower by admission number and issues up to the limit', async () => {
    const card = (await admin.get(`${api}/borrower`).query({ code: student.admissionNo }).expect(200)).body.data
    expect(card.borrower).toMatchObject({ kind: 'STUDENT', id: student.id })
    expect(card).toMatchObject({ limit: 2, canTake: 2, blocked: [] })
    const after = (await admin.post(`${api}/issue`).send({ kind: 'STUDENT', id: student.id, codes: ['LIB000001', 'LIB000002'] }).expect(200)).body.data
    expect(after.loans).toHaveLength(2)
    expect(after.blocked).toContain('LIMIT')
    await admin.post(`${api}/issue`).send({ kind: 'STUDENT', id: student.id, codes: ['OLD-17'] }).expect(409)
    // the same copy can't go out twice
    const card2 = (await admin.get(`${api}/borrower`).query({ code: student.admissionNo })).body.data
    expect(card2.loans.map((l) => l.accessionNo).sort()).toEqual(['LIB000001', 'LIB000002'])
  })

  it('takes a late book back with its fine, and blocks issues until it is paid', async () => {
    await asTenant(() => LibraryLoan.updateOne({ accessionNo: 'LIB000001', status: 'ISSUED' }, { $set: { dueOn: addDaysYmd(t, -5) } }))
    const r = (await admin.post(`${api}/return`).send({ code: 'lib000001' }).expect(200)).body.data
    expect(r.daysLate).toBe(5)
    expect(r.fines[0]).toMatchObject({ reason: 'LATE', amount: 500, status: 'OPEN' })
    expect(r.owed).toBe(500)
    await admin.post(`${api}/return`).send({ code: 'LIB000001' }).expect(409)
    const card = (await admin.get(`${api}/borrower`).query({ kind: 'STUDENT', id: student.id })).body.data
    expect(card.blocked).toContain('FINES')
    await admin.post(`${api}/issue`).send({ kind: 'STUDENT', id: student.id, codes: ['LIB000001'] }).expect(409)
  })

  it('collects the fine with a receipt that posts to Accounts; a payment cancelled opens it again', async () => {
    const open = (await admin.get(`${api}/fines`)).body
    expect(open.totals.OPEN).toMatchObject({ count: 1, amount: 500 })
    const paid = (await admin.post(`${api}/fines/collect`).send({ ids: [open.data[0].id], mode: 'CASH' }).expect(200)).body.data
    expect(paid.receiptNo).toMatch(/^LF/)
    expect(paid.total).toBe(500)
    const j = (await admin.get('/api/v1/finance/journals').query({ source: 'LIBRARY_FINE' })).body.data
    expect(j).toHaveLength(1)
    await admin.post(`${api}/fines/collect`).send({ ids: [open.data[0].id] }).expect(409)
    await admin.post(`${api}/fines/${open.data[0].id}/cancel-payment`).send({ reason: 'Wrong student' }).expect(200)
    expect((await admin.get('/api/v1/finance/journals').query({ source: 'LIBRARY_FINE' })).body.data).toHaveLength(2)
    await admin.post(`${api}/fines/${open.data[0].id}/waive`).send({ reason: 'First time' }).expect(200)
    expect((await admin.get(`${api}/fines`)).body.data).toHaveLength(0)
  })

  it('renews, then marks a book lost at its price', async () => {
    const loan = (await admin.get(`${api}/loans`).query({ state: 'OUT' })).body.data.find((l) => l.accessionNo === 'LIB000002')
    const renewed = (await admin.post(`${api}/loans/${loan.id}/renew`).expect(200)).body.data
    expect(renewed.renewals).toBe(1)
    await admin.post(`${api}/loans/${loan.id}/renew`).expect(409)
    const lost = (await admin.post(`${api}/loans/${loan.id}/lost`).send({}).expect(200)).body.data
    expect(lost.fines[0]).toMatchObject({ reason: 'LOST', amount: 25000 })
    const copy = (await admin.get(`${api}/copies/by-code/LIB000002`)).body.data
    expect(copy.status).toBe('LOST')
  })

  it('reminds the family before the due date and when overdue, once a day', async () => {
    const fine = (await admin.get(`${api}/fines`)).body.data[0]
    await admin.post(`${api}/fines/${fine.id}/waive`).send({ reason: 'Book found later' }).expect(200)
    await admin.post(`${api}/issue`).send({ kind: 'STUDENT', id: student.id, codes: ['OLD-17'] }).expect(200)
    await asTenant(() => LibraryLoan.updateOne({ accessionNo: 'OLD-17', status: 'ISSUED' }, { $set: { dueOn: addDaysYmd(t, 1) } }))
    expect(await asTenant(() => sendReminders({ anyTime: true }))).toBe(1)
    expect(await asTenant(() => sendReminders({ anyTime: true }))).toBe(0)
    await asTenant(() => LibraryLoan.updateOne({ accessionNo: 'OLD-17', status: 'ISSUED' }, { $set: { dueOn: addDaysYmd(t, -2) } }))
    expect(await asTenant(() => sendReminders({ anyTime: true }))).toBe(1)
    expect(await asTenant(() => MessageLog.countDocuments({ event: 'library.overdue' }))).toBeGreaterThan(0)
  })
})

describe('the family app', () => {
  it('shows the books out, fines and the e-library', async () => {
    await admin.post(`${api}/titles`).send({ title: 'Panchatantra stories', type: 'EBOOK', ebookUrl: 'https://example.org/panchatantra', forFamilies: true }).expect(201)
    await admin.post(`${api}/titles`).send({ title: 'Staff handbook', type: 'EBOOK', ebookUrl: 'https://example.org/handbook' }).expect(201)
    const fam = (p) => `/api/v1/family/${h.tenant.slug}${p}`
    const agent = request.agent(app)
    const sent = (await agent.post(fam('/otp')).send({ mobile: '9845000701' })).body.data
    await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
    const lib = (await agent.get(fam(`/students/${student.id}/library`)).expect(200)).body.data
    expect(lib.out).toHaveLength(1)
    expect(lib.out[0]).toMatchObject({ accessionNo: 'OLD-17', state: 'OVERDUE', daysLate: 2, fineSoFar: 200 })
    expect(lib.past.length).toBeGreaterThan(0)
    expect(lib.ebooks.map((e) => e.title)).toEqual(['Panchatantra stories'])
  })
})
