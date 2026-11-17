import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'
import { setAiDriver } from '../src/services/aiClient.js'
import { localize } from '../src/services/localNames.js'

// Names in other languages: the English stays as saved; a glossary per language holds the local text, and a template
// printing in that language shows it (or both).
let app
let admin
let user
let cert
beforeAll(async () => {
  app = await startDb()
  const h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const cls = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '11')
  const garima = (await admin.post('/api/v1/students').send({ firstName: 'Garima', lastName: 'Maurya', gender: 'FEMALE', sectionId: cls.sections[0].id, guardians: [{ name: 'Vinod Maurya', relation: 'FATHER', mobile: '9845000071' }] })).body.data
  cert = (await admin.post('/api/v1/certificates').send({ kind: 'BONAFIDE', studentIds: [garima.id], purpose: 'Bank account' })).body.data
  cert = (await admin.get('/api/v1/certificates?kind=BONAFIDE')).body.data[0]
  // someone without the page
  const role = (await admin.post('/api/v1/core/roles').send({ name: 'Front desk', permissions: ['students.directory.view'] })).body.data
  await admin.post('/api/v1/core/users').send({ name: 'Front Desk', email: 'desk@ln.test', roleIds: [role.id], password: 'Desk@123' })
  user = await signIn(app, 'desk@ln.test', 'Desk@123')
})
afterAll(() => { setAiDriver(null); return stopDb() })

const api = '/api/v1/core/local-names'

describe('the glossary', () => {
  it('lists each kind’s English texts once, beside what is saved', async () => {
    const parents = (await admin.get(`${api}/hi?kind=parents`)).body.data
    expect(parents).toMatchObject({ total: 1, missing: 1 })
    expect(parents.rows[0]).toMatchObject({ english: 'Vinod Maurya', value: '', where: 'Father · Garima Maurya' })
    expect((await admin.get(`${api}/en?kind=students`)).status).toBe(400) // English is the saved text, not a glossary
    expect((await admin.get(`${api}/hi?kind=pets`)).status).toBe(400)
  })

  it('saves, finds by any case, and removes an emptied entry', async () => {
    const res = (await admin.put(`${api}/hi`).send({ kind: 'students', entries: [{ english: 'Garima  Maurya', value: 'गरिमा मौर्य' }] }).expect(200)).body.data
    expect(res).toEqual({ saved: 1, removed: 0 })
    const students = (await admin.get(`${api}/hi?kind=students`)).body.data
    expect(students.rows[0]).toMatchObject({ english: 'Garima Maurya', value: 'गरिमा मौर्य' })
    expect((await admin.get(`${api}/hi?kind=students&missing=true`)).body.data.rows).toHaveLength(0)
    await admin.put(`${api}/hi`).send({ kind: 'phrases', entries: [{ english: 'Bank account', value: 'बैंक खाता' }] }).expect(200)
    expect((await admin.get(`${api}/hi?kind=phrases`)).body.data.rows.map((r) => r.english)).toContain('Bank account')
    expect((await admin.put(`${api}/hi`).send({ kind: 'phrases', entries: [{ english: 'bank ACCOUNT', value: '' }] }).expect(200)).body.data.removed).toBe(1)
  })

  it('exports for Excel and imports a filled-in sheet', async () => {
    const csv = (await admin.get(`${api}/hi/export?kind=parents`).expect(200)).text
    expect(csv).toContain('English,Translation,Where')
    expect(csv).toContain('Vinod Maurya')
    const rows = [{ english: 'Vinod Maurya', value: 'विनोद मौर्य' }, { english: '', value: 'x' }]
    expect((await admin.post(`${api}/hi/import`).send({ kind: 'parents', rows, dryRun: true })).body.data).toMatchObject({ ready: 1, skipped: 1 })
    expect((await admin.post(`${api}/hi/import`).send({ kind: 'parents', rows, dryRun: false })).body.data).toMatchObject({ saved: 1 })
    expect((await admin.get(`${api}/hi?kind=parents`)).body.data.rows[0].value).toBe('विनोद मौर्य')
  })

  it('drafts missing names with the AI, without saving them', async () => {
    setAiDriver({ create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ items: [{ ref: 0, text: 'गणित' }] }) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }) })
    const res = (await admin.post(`${api}/hi/suggest`).send({ kind: 'subjects', texts: ['Mathematics'] }).expect(200)).body.data
    expect(res.suggestions).toEqual([{ english: 'Mathematics', value: 'गणित' }])
    expect((await admin.get(`${api}/hi?kind=subjects&q=mathematics`)).body.data.rows.every((r) => !r.value)).toBe(true)
  })

  it('needs the page’s permissions', async () => {
    expect((await user.get(`${api}/hi?kind=students`)).status).toBe(403)
    expect((await user.put(`${api}/hi`).send({ entries: [{ english: 'A', value: 'ए' }] })).status).toBe(403)
  })
})

describe('from the record forms', () => {
  it('saves and reads a name with the permissions of that kind of record', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Admissions desk', permissions: ['students.admit.create', 'students.directory.view'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Desk Two', email: 'admit@ln.test', roleIds: [role.id], password: 'Admit@123' })
    const desk = await signIn(app, 'admit@ln.test', 'Admit@123')
    await desk.put(`${api}/hi/record`).send({ kind: 'students', entries: [{ english: 'Aarav Srivastava', value: 'आरव श्रीवास्तव' }] }).expect(200)
    expect((await desk.post(`${api}/hi/lookup`).send({ kind: 'students', texts: ['aarav  srivastava', 'Nobody'] })).body.data).toEqual({ 'aarav srivastava': 'आरव श्रीवास्तव' })
    expect((await desk.put(`${api}/hi/record`).send({ kind: 'subjects', entries: [{ english: 'Mathematics', value: 'गणित' }] })).status).toBe(403)
    expect((await desk.get(`${api}/hi?kind=students`)).status).toBe(403) // the Administration page itself
  })
})

describe('printing', () => {
  it('prints the saved names in the template’s language — local, both, or as saved', async () => {
    const tpl = { docType: 'CERTIFICATE', name: 'Hindi', isDefault: true, language: 'hi', margins: { top: 12, right: 12, bottom: 16, left: 12 } }
    const saved = (await admin.post('/api/v1/core/print-templates').send(tpl).expect(201)).body.data
    expect(saved.namesIn).toBeNull() // empty = LOCAL
    const print = async () => (await admin.get(`/api/v1/documents/CERTIFICATE/${cert.id}?print=0`)).text
    let html = await print()
    expect(html).toContain('गरिमा मौर्य')
    expect(html).toContain('विनोद मौर्य')
    expect(html).not.toContain('Garima Maurya')
    await admin.patch(`/api/v1/core/print-templates/${saved.id}`).send({ namesIn: 'BOTH' }).expect(200)
    html = await print()
    expect(html).toContain('गरिमा मौर्य (Garima Maurya)')
    await admin.patch(`/api/v1/core/print-templates/${saved.id}`).send({ namesIn: 'SAVED' }).expect(200)
    html = await print()
    expect(html).toContain('Garima Maurya')
    expect(html).not.toContain('गरिमा मौर्य')
    // an English template never uses the glossary
    await admin.patch(`/api/v1/core/print-templates/${saved.id}`).send({ language: null, namesIn: null }).expect(200)
    expect(await print()).not.toContain('गरिमा')
  })

  it('swaps only exact texts, and leaves long ones alone', () => {
    const glossary = new Map([['garima maurya', 'गरिमा मौर्य'], ['mathematics', 'गणित']])
    const model = { student: { name: 'GARIMA MAURYA', note: 'Garima Maurya did well' }, subjects: [{ name: 'Mathematics' }], n: 5, at: new Date(0) }
    expect(localize(model, glossary)).toEqual({ student: { name: 'गरिमा मौर्य', note: 'Garima Maurya did well' }, subjects: [{ name: 'गणित' }], n: 5, at: new Date(0) })
    expect(localize(model, glossary, 'BOTH').subjects[0].name).toBe('गणित (Mathematics)')
    expect(localize(model, glossary, 'SAVED')).toBe(model)
    // codes the templates test are never swapped, even when a word matches
    expect(localize({ gender: 'FEMALE', label: 'Female' }, new Map([['female', 'महिला']]))).toEqual({ gender: 'FEMALE', label: 'महिला' })
  })
})
