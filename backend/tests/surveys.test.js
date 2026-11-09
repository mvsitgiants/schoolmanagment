import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { SURVEY_STARTER_FORMS, checkFormDefinition, summariseSurvey, surveyState } from '@schoolgiant/shared'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { SurveyResponse } from '../src/models/surveys.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let classes
let s1
let s2
let s3
const api = '/api/v1/surveys'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  classes = (await admin.get('/api/v1/academics/classes')).body.data.classes
  const add = async (firstName, sec, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: sec.id, guardians: [{ name: `Parent of ${firstName}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  s1 = await add('Asha', classes[3].sections[0], '9845001001')
  s2 = await add('Bilal', classes[3].sections[0], '9845001002')
  s3 = await add('Chitra', classes[4].sections[0], '9845001003')
  await asTenant(() => MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true }))
  await admin.patch('/api/v1/core/settings/modules/portal').send({ enabled: true }).expect(200)
})
afterAll(stopDb)

const fam = (p) => `/api/v1/family/${h.tenant.slug}${p}`
async function familyAgent(mobile) {
  const agent = request.agent(app)
  const sent = (await agent.post(fam('/otp')).send({ mobile })).body.data
  await agent.post(fam('/verify')).send({ challengeId: sent.challengeId, code: sent.testCode }).expect(200)
  return agent
}
const satisfied = { TEACHING: '5', PROGRESS: '4', COMMUNICATION: '4', SAFETY: '5', RECOMMEND: 'YES', BEST: ['Teachers', 'Results'], COMMENTS: 'Very happy' }

describe('helpers', () => {
  it('the starter questionnaires are valid forms', () => {
    for (const f of SURVEY_STARTER_FORMS) expect(checkFormDefinition(f.definition)).toEqual({})
  })
  it('a survey is a draft, opens, and closes by its dates', () => {
    expect(surveyState({}, '2026-11-09')).toBe('DRAFT')
    expect(surveyState({ publishedAt: new Date(), opensOn: '2026-11-10' }, '2026-11-09')).toBe('SCHEDULED')
    expect(surveyState({ publishedAt: new Date(), closesOn: '2026-11-08' }, '2026-11-09')).toBe('CLOSED')
    expect(surveyState({ publishedAt: new Date() }, '2026-11-09')).toBe('OPEN')
  })
  it('summarises choices, ratings and text', () => {
    const def = SURVEY_STARTER_FORMS.find((f) => f.code === 'PARENT_SATISFACTION').definition
    const q = summariseSurvey(def, [satisfied, { ...satisfied, TEACHING: '3', RECOMMEND: 'NO', COMMENTS: '' }])
    const teaching = q.find((x) => x.key === 'TEACHING')
    expect(teaching).toMatchObject({ kind: 'RATING', answered: 2, average: 4, max: 5 })
    expect(teaching.options.find((o) => o.points === 3).count).toBe(1)
    expect(q.find((x) => x.key === 'RECOMMEND').options).toEqual([{ value: 'YES', label: 'Yes', count: 1 }, { value: 'NO', label: 'No', count: 1 }])
    expect(q.find((x) => x.key === 'BEST').options.find((o) => o.value === 'Teachers').count).toBe(2)
    expect(q.find((x) => x.key === 'COMMENTS')).toMatchObject({ kind: 'TEXT', answered: 1, answers: ['Very happy'] })
  })
})

describe('a parent survey', () => {
  let survey
  let form
  it('offers the starter questionnaires from the form builder', async () => {
    const forms = (await admin.get(`${api}/questionnaires`)).body.data
    expect(forms.map((f) => f.code)).toEqual(expect.arrayContaining(['TEACHER_EVALUATION', 'PARENT_SATISFACTION', 'PARENT_FEEDBACK']))
    form = forms.find((f) => f.code === 'PARENT_SATISFACTION')
    expect(form.questions).toBeGreaterThan(5)
    // they are ordinary forms in Administration › Form builder
    const builder = (await admin.get('/api/v1/core/forms?use=SURVEY')).body.data
    expect(builder.map((f) => f.code)).toContain('TEACHER_EVALUATION')
  })

  it('a draft for chosen classes; publishing freezes the version and asks the families', async () => {
    const res = await admin.post(api).send({ title: 'Parent satisfaction 2026', formId: form.formId, audience: 'PARENTS', classIds: [classes[3].id] })
    expect(res.status).toBe(201)
    survey = res.body.data
    expect(survey).toMatchObject({ state: 'DRAFT', invited: 2, formVersion: null })
    expect(survey.definition.sections.length).toBe(1)
    const pub = (await admin.post(`${api}/${survey.id}/publish`).send({ notify: true }).expect(200)).body.data
    expect(pub).toMatchObject({ state: 'OPEN', formVersion: 1, asked: 2 })
    expect(await asTenant(() => MessageLog.countDocuments({ event: 'surveys.request' }))).toBeGreaterThanOrEqual(2)
    expect((await admin.post(`${api}/${survey.id}/publish`)).status).toBe(409)
    // the audience is locked now; the title isn't
    expect((await admin.patch(`${api}/${survey.id}`).send({ audience: 'STAFF' })).status).toBe(409)
    expect((await admin.patch(`${api}/${survey.id}`).send({ title: 'Parent satisfaction — 2026' })).body.data.title).toBe('Parent satisfaction — 2026')
  })

  it('a parent in the class answers once in the app; a parent of another class doesn’t see it', async () => {
    const a = await familyAgent('9845001001')
    const list = (await a.get(fam(`/students/${s1.id}/surveys`))).body.data
    expect(list.map((x) => x.id)).toEqual([survey.id])
    expect(list[0].answered).toBe(false)
    const one = (await a.get(fam(`/students/${s1.id}/surveys/${survey.id}`))).body.data
    expect(one.definition.sections[0].fields.length).toBeGreaterThan(5)
    const missing = await a.post(fam(`/students/${s1.id}/surveys/${survey.id}`)).send({ values: { TEACHING: '5' } })
    expect(missing.status).toBe(400)
    expect(missing.body.details.fields.RECOMMEND).toBeTruthy()
    await a.post(fam(`/students/${s1.id}/surveys/${survey.id}`)).send({ values: satisfied }).expect(201)
    expect((await a.post(fam(`/students/${s1.id}/surveys/${survey.id}`)).send({ values: satisfied })).status).toBe(409)
    expect((await a.get(fam(`/students/${s1.id}/surveys`))).body.data[0].answered).toBe(true)
    const c = await familyAgent('9845001003')
    expect((await c.get(fam(`/students/${s3.id}/surveys`))).body.data).toEqual([])
    expect((await c.post(fam(`/students/${s3.id}/surveys/${survey.id}`)).send({ values: satisfied })).status).toBe(404)
  })

  it('the results: rate by section, per-question summaries, who answered; a CSV; a reminder to the rest', async () => {
    const r = (await admin.get(`${api}/${survey.id}/results`)).body.data
    expect(r).toMatchObject({ responded: 1, invited: 2, rate: 50 })
    expect(r.bySection).toEqual([expect.objectContaining({ sectionId: classes[3].sections[0].id, invited: 2, responded: 1, rate: 50 })])
    expect(r.questions.find((q) => q.key === 'RECOMMEND').options[0]).toMatchObject({ value: 'YES', count: 1 })
    expect(r.responses[0].name).toMatch(/Parent of Asha/)
    const csv = await admin.get(`${api}/${survey.id}/responses.csv`)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('Quality of teaching')
    expect(csv.text).toContain('Very happy')
    const before = await asTenant(() => MessageLog.countDocuments({ event: 'surveys.request' }))
    expect((await admin.post(`${api}/${survey.id}/remind`).expect(200)).body.data.asked).toBe(1) // only Bilal's family
    expect(await asTenant(() => MessageLog.countDocuments({ event: 'surveys.request' }))).toBeGreaterThan(before)
    expect((await admin.delete(`${api}/${survey.id}`)).status).toBe(409) // answered: close instead
    const closed = (await admin.post(`${api}/${survey.id}/close`).send({ closed: true }).expect(200)).body.data
    expect(closed.state).toBe('CLOSED')
    const b = await familyAgent('9845001002')
    expect((await b.post(fam(`/students/${s2.id}/surveys/${survey.id}`)).send({ values: satisfied })).status).toBe(409)
  })
})

describe('staff and public surveys', () => {
  let form
  beforeAll(async () => {
    form = (await admin.get(`${api}/questionnaires`)).body.data.find((f) => f.code === 'PARENT_FEEDBACK')
  })

  it('an anonymous staff survey: staff fill it in the app, no names are kept', async () => {
    const s = (await admin.post(api).send({ title: 'Staff wellbeing', formId: form.formId, audience: 'STAFF', anonymous: true }).expect(201)).body.data
    await admin.post(`${api}/${s.id}/publish`).send({ notify: true }).expect(200)
    const mine = (await admin.get(`${api}/mine`)).body.data
    expect(mine.find((x) => x.id === s.id)).toMatchObject({ answered: false, anonymous: true })
    await admin.post(`${api}/mine/${s.id}/respond`).send({ values: { TEACHING: '4', COMMENTS: 'More breaks' } }).expect(201)
    expect((await admin.post(`${api}/mine/${s.id}/respond`).send({ values: { TEACHING: '4' } })).status).toBe(409)
    const r = (await admin.get(`${api}/${s.id}/results`)).body.data
    expect(r.responded).toBe(1)
    expect(r.responses[0].name).toBeNull()
    const row = await asTenant(() => SurveyResponse.findOne({ surveyId: s.id }).lean())
    expect(row.userId).toBeUndefined()
    expect(row.respondentKey).toMatch(/^H:/)
  })

  it('a public link anyone can answer', async () => {
    const s = (await admin.post(api).send({ title: 'Open day feedback', formId: form.formId, audience: 'PUBLIC' }).expect(201)).body.data
    expect(s.publicUrl).toBeNull()
    const pub = (await admin.post(`${api}/${s.id}/publish`).send({}).expect(200)).body.data
    expect(pub.publicUrl).toMatch(new RegExp(`/s/${h.tenant.slug}/`))
    const token = pub.publicUrl.split('/').pop()
    const anon = request(app)
    const page = (await anon.get(`/api/v1/public/surveys/${h.tenant.slug}/${token}`).expect(200)).body.data
    expect(page).toMatchObject({ title: 'Open day feedback', state: 'OPEN', institution: { name: expect.any(String) } })
    await anon.post(`/api/v1/public/surveys/${h.tenant.slug}/${token}`).send({ values: { TEACHING: '3' }, clientKey: 'browser-12345' }).expect(201)
    expect((await anon.post(`/api/v1/public/surveys/${h.tenant.slug}/${token}`).send({ values: { TEACHING: '3' }, clientKey: 'browser-12345' })).status).toBe(409)
    expect((await anon.get(`/api/v1/public/surveys/${h.tenant.slug}/not-a-real-token`)).status).toBe(404)
    // a draft that never had responses can be deleted
    const draft = (await admin.post(api).send({ title: 'Scrap me', formId: form.formId, audience: 'STAFF' }).expect(201)).body.data
    await admin.delete(`${api}/${draft.id}`).expect(200)
  })
})
