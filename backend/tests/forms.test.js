import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkFormDefinition, computeForm, formSummary, nowIn, validateFormValues } from '@schoolgiant/shared'
import { Appointment } from '../src/models/frontoffice.js'
import { runAsTenant } from '../src/platform/context.js'
import { nextNumber } from '../src/platform/numbering.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let doctor
const today = () => nowIn('Asia/Kolkata').date
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '12:00', slotMinutes: 15 }))

const ASTHMA = { sections: [
  { title: 'Control', columns: 2, fields: [
    { key: 'PEFR', label: 'Peak flow', type: 'NUMBER', unit: 'L/min', min: 50, max: 900, required: true },
    { key: 'PRED', label: 'Predicted peak flow', type: 'NUMBER', unit: 'L/min' },
    { key: 'PCT', label: 'Peak flow, % of predicted', type: 'CALC', formula: 'PEFR / PRED * 100', decimals: 0, unit: '%' },
    { key: 'NIGHT', label: 'Woken at night', type: 'YESNO' },
    { key: 'NIGHTS', label: 'Nights a week', type: 'NUMBER', showIf: { field: 'NIGHT', equals: 'YES' }, required: true },
  ] },
  { title: 'Score', columns: 1, fields: [
    { key: 'S1', label: 'Daytime symptoms', type: 'SCORE', options: [{ label: 'None', points: 0 }, { label: 'Some', points: 1 }, { label: 'Daily', points: 2 }] },
    { key: 'S2', label: 'Reliever use', type: 'SCORE', options: [{ label: 'None', points: 0 }, { label: 'Some', points: 1 }, { label: 'Daily', points: 2 }] },
    { key: 'TOTAL', label: 'Control score', type: 'TOTAL', bands: [{ min: 0, max: 1, label: 'Controlled' }, { min: 2, max: 4, label: 'Not controlled' }] },
  ] },
] }

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  doctor = (await admin.post('/api/v1/appointments/doctors').send({ name: 'Dr. Forms', sessions: ALL_WEEK })).body.data
  await admin.post('/api/v1/auth/sign-pin').send({ password: h.password, pin: '4826' })
})
afterAll(stopDb)

describe('the form engine', () => {
  it('checks a design, works out calculations and totals, hides what doesn’t apply', () => {
    expect(checkFormDefinition(ASTHMA)).toEqual({})
    const bad = checkFormDefinition({ sections: [{ title: 'X', fields: [{ key: 'a', label: 'A', type: 'NUMBER' }, { key: 'B', label: 'B', type: 'CALC', formula: 'ZZ * 2' }, { key: 'C', label: 'C', type: 'SELECT', options: ['only one'] }] }] })
    expect(Object.keys(bad).sort()).toEqual(['sections.0.fields.0.key', 'sections.0.fields.1.formula', 'sections.0.fields.2.options'])
    expect(computeForm(ASTHMA, { PEFR: '300', PRED: '400', S1: '1', S2: '2' })).toMatchObject({ PCT: '75', TOTAL: '3' })
    const { values, errors } = validateFormValues(ASTHMA, { PEFR: '300', NIGHT: 'YES' })
    expect(errors).toEqual({ NIGHTS: 'Nights a week is required' })
    expect(validateFormValues(ASTHMA, { PEFR: '300', NIGHT: 'NO', NIGHTS: '9' }).values.NIGHTS).toBeUndefined() // hidden → dropped
    expect(values.PEFR).toBe('300')
    expect(formSummary(ASTHMA, computeForm(ASTHMA, { PEFR: '300', PRED: '400', S1: '1', S2: '2' })).map((l) => `${l.label}: ${l.text}`))
      .toEqual(['Peak flow: 300 L/min', 'Predicted peak flow: 400 L/min', 'Peak flow, % of predicted: 75 %', 'Daytime symptoms: Some (1)', 'Reliever use: Daily (2)', 'Control score: 3 — Not controlled'])
  })
})

describe('form builder', () => {
  let formId
  it('gives every institution the starter forms, published', async () => {
    const forms = (await admin.get('/api/v1/core/forms')).body.data
    expect(forms.map((f) => f.code).sort()).toEqual(['ANC', 'DM_REVIEW', 'GROWTH', 'HTN_REVIEW', 'PHQ9'])
    expect(forms.every((f) => f.status === 'PUBLISHED' && f.version === 1)).toBe(true)
  })

  it('a new form is a draft until published; publishing refuses a broken design', async () => {
    const f = (await admin.post('/api/v1/core/forms').send({ code: 'ASTHMA', name: 'Asthma review', use: 'OPD_CONSULT' })).body.data
    formId = f.id
    expect(f).toMatchObject({ status: 'DRAFT', version: 0 })
    const broken = await admin.post(`/api/v1/core/forms/${formId}/publish`)
    expect(broken.status).toBe(400)
    expect(broken.body.details.fields).toHaveProperty(['sections.0.fields'])
    await admin.put(`/api/v1/core/forms/${formId}`).send({ definition: ASTHMA }).expect(200)
    const pub = (await admin.post(`/api/v1/core/forms/${formId}/publish`)).body.data
    expect(pub).toMatchObject({ status: 'PUBLISHED', version: 1, changedSincePublish: false })
    expect((await admin.post('/api/v1/core/forms').send({ code: 'ASTHMA', name: 'Again' })).status).toBe(409)
  })

  it('editing after publishing keeps the published version until the next publish', async () => {
    const changed = { sections: [...ASTHMA.sections, { title: 'Inhaler', columns: 1, fields: [{ key: 'TECHNIQUE', label: 'Inhaler technique checked', type: 'YESNO', required: true }] }] }
    const saved = (await admin.put(`/api/v1/core/forms/${formId}`).send({ definition: changed })).body.data
    expect(saved).toMatchObject({ version: 1, changedSincePublish: true })
    let live = (await admin.get('/api/v1/opd/forms')).body.data.find((f) => f.formId === formId)
    expect(live.version).toBe(1)
    await admin.post(`/api/v1/core/forms/${formId}/publish`).expect(200)
    live = (await admin.get('/api/v1/opd/forms')).body.data.find((f) => f.formId === formId)
    expect(live.version).toBe(2)
    expect((await admin.get(`/api/v1/opd/forms/${formId}/versions/1`)).body.data.definition.sections).toHaveLength(2)
  })

  it('in the consult: required answers are checked at signing, and the summary is kept with the note', async () => {
    const p = (await admin.post('/api/v1/patients').send({ firstName: 'Form', lastName: 'Filler', gender: 'MALE', age: { years: 40 }, mobile: '9000011111', address: { pincode: '560001' }, consents: { dataProcessing: true } })).body.data
    const apptId = await runAsTenant(h.tenant._id, async () => String((await Appointment.create({ apptNo: await nextNumber('APPOINTMENT'), studentId: p.id, patient: { name: p.name }, doctorId: doctor.id, doctorName: doctor.name, date: today(), time: '08:00', status: 'BOOKED' }))._id))
    const visit = (await admin.post(`/api/v1/appointments/${apptId}/check-in`).send({})).body.data.visit
    await admin.post(`/api/v1/opd/visits/${visit.id}/start`).expect(200)
    const entry = (values) => ({ formId, version: 2, code: 'ASTHMA', name: 'Asthma review', values })
    await admin.put(`/api/v1/opd/visits/${visit.id}/draft`).send({ data: { complaints: [{ text: 'Wheeze' }], forms: [entry({ PEFR: '280', PRED: '400', NIGHT: 'YES' })] } }).expect(200)
    const missing = await admin.post(`/api/v1/opd/visits/${visit.id}/sign`).send({ pin: '4826' })
    expect(missing.status).toBe(400)
    expect(missing.body.details.forms).toEqual({ 0: { NIGHTS: 'Nights a week is required', TECHNIQUE: 'Inhaler technique checked is required' } })
    await admin.put(`/api/v1/opd/visits/${visit.id}/draft`).send({ data: { complaints: [{ text: 'Wheeze' }], forms: [entry({ PEFR: '280', PRED: '400', NIGHT: 'YES', NIGHTS: '2', S1: '1', S2: '1', TECHNIQUE: 'YES' })] } }).expect(200)
    await admin.post(`/api/v1/opd/visits/${visit.id}/sign`).send({ pin: '4826' }).expect(200)
    const ws = (await admin.get(`/api/v1/opd/visits/${visit.id}`)).body.data
    const saved = ws.note.data.forms[0]
    expect(saved.values).toMatchObject({ PCT: '70', TOTAL: '2' })
    expect(saved.summary.find((l) => l.key === 'TOTAL').text).toBe('2 — Not controlled')
  })
})
