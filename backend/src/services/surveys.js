import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import {
  SURVEY_AUDIENCE_LABEL, SURVEY_STARTER_FORMS, formFields, sectionLabel, summariseSurvey, surveyRate, surveyState,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { ClassLevel, Section } from '../models/academics.js'
import { FormTemplate, FormVersion } from '../models/forms.js'
import { Tenant } from '../models/platform.js'
import { Student } from '../models/students.js'
import { Survey, SurveyResponse } from '../models/surveys.js'
import { User } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { csvCell } from '../platform/csv.js'
import { institutionNow } from '../platform/time.js'
import { ensureStarterForms, formVersion, publishedForms } from './forms.js'
import { humanDate, notifyUsers } from './notify.js'

// Surveys & feedback. A survey sends a questionnaire from the form builder (use SURVEY) to an audience between two
// dates. Publishing freezes the questionnaire's version; answers are checked against it with the form engine
// (validateFormValues), one per person — per child for parents. The Responses page summarises each question.
// Filling (staff, family app, public link) is in services/surveysFill.js.

const actor = () => getContext()?.userName
const idStr = (v) => (v ? String(v) : null)
export const surveyToday = async () => (await institutionNow()).date

/** Teacher evaluation and parent satisfaction, added to the form builder the first time Surveys opens. */
export async function ensureSurveyStarters() {
  await ensureStarterForms() // the form builder's own starters first (it adds them only to an empty list)
  for (const f of SURVEY_STARTER_FORMS) {
    if (await FormTemplate.exists({ code: f.code })) continue
    const by = 'Starter set'
    const form = await FormTemplate.create({ ...f, status: 'PUBLISHED', version: 1, changedSincePublish: false, publishedAt: new Date(), publishedBy: by, updatedBy: by, starter: true })
    await FormVersion.create({ formId: form._id, version: 1, code: f.code, name: f.name, use: f.use, definition: f.definition, publishedBy: by })
  }
}

/** Questionnaires a survey can use: published forms of use SURVEY, at their latest version. */
export async function surveyForms() {
  await ensureSurveyStarters()
  return (await publishedForms(['SURVEY'])).map((f) => ({ ...f, questions: formFields(f.definition).filter((x) => !['INFO', 'CALC', 'TOTAL'].includes(x.type)).length }))
}

/** The questions a survey asks: its frozen version once published, else the form's latest published version. */
export async function surveyDefinition(s) {
  let version = s.formVersion
  if (!version) version = (await FormTemplate.findById(s.formId).select('version').lean())?.version
  const v = version ? await formVersion(String(s.formId), version) : null
  return v?.definition ?? null
}

/** Students a PARENTS / STUDENTS survey goes to. */
export function audienceStudentFilter(s) {
  const or = []
  if (s.classIds?.length) or.push({ classId: { $in: s.classIds } })
  if (s.sectionIds?.length) or.push({ sectionId: { $in: s.sectionIds } })
  return { status: 'ACTIVE', ...(or.length ? { $or: or } : {}) }
}

/** Is this student in the survey's audience? */
export const studentInAudience = (s, st) => (!s.classIds?.length && !s.sectionIds?.length)
  || (s.classIds ?? []).some((c) => String(c) === String(st.classId)) || (s.sectionIds ?? []).some((x) => String(x) === String(st.sectionId))

/** How many were asked: active students in the audience, or active staff; null for a public link. */
export async function invitedCount(s) {
  if (s.audience === 'STAFF') return User.countDocuments({ active: true })
  if (s.audience === 'PUBLIC') return null
  return Student.countDocuments(audienceStudentFilter(s))
}

/** The one-per-person key; hashed for an anonymous survey so the answer can't be traced back. */
export function respondentKey(s, raw) {
  return s.anonymous ? `H:${createHash('sha256').update(`${s._id}:${raw}`).digest('hex').slice(0, 40)}` : raw
}

async function slugOf() {
  return (await Tenant.findById(getContext()?.tenantId).select('slug').lean())?.slug ?? ''
}

export const publicPath = (slug, token) => `/s/${slug}/${token}`

async function dto(s, today, { invited } = {}) {
  const state = surveyState(s, today)
  const slug = s.publicToken ? await slugOf() : null
  return {
    id: String(s._id), title: s.title, intro: s.intro ?? null, formId: String(s.formId), formName: s.formName ?? null, formVersion: s.formVersion || null,
    audience: s.audience, audienceLabel: SURVEY_AUDIENCE_LABEL[s.audience] ?? s.audience,
    classIds: (s.classIds ?? []).map(String), sectionIds: (s.sectionIds ?? []).map(String), anonymous: !!s.anonymous,
    opensOn: s.opensOn ?? null, closesOn: s.closesOn ?? null, state, publishedAt: s.publishedAt ?? null, publishedBy: s.publishedBy ?? null,
    closedAt: s.closedAt ?? null, remindedAt: s.remindedAt ?? null, responses: s.responses ?? 0,
    invited: invited === undefined ? undefined : invited, rate: invited === undefined ? undefined : surveyRate(s.responses ?? 0, invited),
    publicUrl: s.publicToken && state !== 'DRAFT' ? `${config.appUrl}${publicPath(slug, s.publicToken)}` : null,
    createdBy: s.createdBy ?? null, createdAt: s.createdAt,
  }
}

// ───────────────────────────────────────────────────────── surveys (admin)

export async function listSurveys() {
  await ensureSurveyStarters()
  const today = await surveyToday()
  const rows = await Survey.find().sort({ createdAt: -1 }).limit(300).lean()
  const out = []
  for (const s of rows) out.push(await dto(s, today, { invited: s.publishedAt ? await invitedCount(s) : null }))
  return out
}

export async function getSurvey(id) {
  const s = isOid(id) ? await Survey.findById(id).lean() : null
  if (!s) throw notFound('Survey')
  return { ...(await dto(s, await surveyToday(), { invited: await invitedCount(s) })), definition: await surveyDefinition(s) }
}

async function checkAudience(input) {
  const classIds = input.classIds ?? []
  const sectionIds = input.sectionIds ?? []
  if (['STAFF', 'PUBLIC'].includes(input.audience)) return { classIds: [], sectionIds: [] }
  if (classIds.length && (await ClassLevel.countDocuments({ _id: { $in: classIds } })) !== new Set(classIds).size) throw badRequest('One of the classes was not found.', { fields: { classIds: 'Not found' } })
  if (sectionIds.length && (await Section.countDocuments({ _id: { $in: sectionIds } })) !== new Set(sectionIds).size) throw badRequest('One of the sections was not found.', { fields: { sectionIds: 'Not found' } })
  return { classIds, sectionIds }
}

function checkDates(input) {
  if (input.opensOn && input.closesOn && input.closesOn < input.opensOn) throw badRequest('The survey closes before it opens.', { fields: { closesOn: 'Before the opening day' } })
}

/** New survey, or a change. Once published only the title, the note and the closing day can change. */
export async function saveSurvey(id, input, req) {
  checkDates(input)
  if (!id) {
    const form = isOid(input.formId) ? await FormTemplate.findOne({ _id: input.formId, use: 'SURVEY', status: 'PUBLISHED' }).lean() : null
    if (!form) throw badRequest('Pick a published questionnaire from the form builder.', { fields: { formId: 'Pick a questionnaire' } })
    const aud = await checkAudience(input)
    const s = await Survey.create({
      title: input.title, intro: input.intro || undefined, formId: form._id, formName: form.name, audience: input.audience, ...aud,
      anonymous: !!input.anonymous, opensOn: input.opensOn || undefined, closesOn: input.closesOn || undefined, createdBy: actor(), updatedBy: actor(),
    })
    await audit({ action: 'CREATE', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: `Created the survey “${s.title}” (${SURVEY_AUDIENCE_LABEL[s.audience]})` }, req)
    return getSurvey(s._id)
  }
  const s = isOid(id) ? await Survey.findById(id) : null
  if (!s) throw notFound('Survey')
  const published = !!s.publishedAt
  if (published) {
    const norm = (k, v) => (k.endsWith('Ids') ? JSON.stringify([...(v ?? [])].map(String).sort()) : k === 'anonymous' ? String(!!v) : v ? String(v) : '')
    for (const k of ['formId', 'audience', 'classIds', 'sectionIds', 'anonymous', 'opensOn']) {
      if (input[k] !== undefined && norm(k, input[k]) !== norm(k, s[k])) {
        throw conflict('This survey has been sent — only its title, note and closing day can change now.', { fields: { [k]: 'Locked after publishing' } })
      }
    }
  } else {
    if (input.formId && String(input.formId) !== String(s.formId)) {
      const form = isOid(input.formId) ? await FormTemplate.findOne({ _id: input.formId, use: 'SURVEY', status: 'PUBLISHED' }).lean() : null
      if (!form) throw badRequest('Pick a published questionnaire from the form builder.', { fields: { formId: 'Pick a questionnaire' } })
      Object.assign(s, { formId: form._id, formName: form.name })
    }
    if (input.audience) s.audience = input.audience
    if (input.audience || input.classIds || input.sectionIds) Object.assign(s, await checkAudience({ audience: s.audience, classIds: input.classIds ?? s.classIds.map(String), sectionIds: input.sectionIds ?? s.sectionIds.map(String) }))
    if (input.anonymous !== undefined) s.anonymous = input.anonymous
    if (input.opensOn !== undefined) s.opensOn = input.opensOn || undefined
  }
  if (input.title) s.title = input.title
  if (input.intro !== undefined) s.intro = input.intro || undefined
  if (input.closesOn !== undefined) s.closesOn = input.closesOn || undefined
  checkDates({ opensOn: s.opensOn, closesOn: s.closesOn })
  s.updatedBy = actor()
  await s.save()
  await audit({ action: 'UPDATE', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: `Changed the survey “${s.title}”` }, req)
  return getSurvey(s._id)
}

export async function deleteSurvey(id, req) {
  const s = isOid(id) ? await Survey.findById(id) : null
  if (!s) throw notFound('Survey')
  if (await SurveyResponse.exists({ surveyId: s._id })) throw conflict('People have answered this survey — close it instead of deleting it.')
  await s.deleteOne()
  await audit({ action: 'DELETE', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: `Deleted the survey “${s.title}”` }, req)
  return { deleted: true }
}

/** Families (or staff) the survey goes to, who haven't answered yet. Families: student ids. Staff: user ids. */
async function notAnswered(s) {
  if (s.audience === 'PUBLIC') return []
  const done = await SurveyResponse.find({ surveyId: s._id }).select('respondentKey').lean()
  const keys = new Set(done.map((r) => r.respondentKey))
  if (s.audience === 'STAFF') {
    const users = await User.find({ active: true }).select('_id').lean()
    return users.map((u) => String(u._id)).filter((id) => !keys.has(respondentKey(s, `U:${id}`)))
  }
  const prefix = s.audience === 'STUDENTS' ? 'T' : 'S'
  const kids = await Student.find(audienceStudentFilter(s)).select('_id').limit(20000).lean()
  return kids.map((k) => String(k._id)).filter((id) => !keys.has(respondentKey(s, `${prefix}:${id}`)))
}

/** Ask people to fill it: families get the `surveys.request` message, staff a note in the app. */
async function invite(s, ids) {
  if (s.audience === 'PUBLIC' || !ids.length) return 0
  if (s.audience === 'STAFF') {
    await notifyUsers(ids, { event: 'surveys.request', title: `Survey: ${s.title}`, message: s.closesOn ? `Please answer by ${humanDate(s.closesOn)}` : 'Please take a minute to answer', link: `/surveys/forms?fill=${s._id}`, tone: 'info', entityType: 'survey', entityId: String(s._id) })
    return ids.length
  }
  const link = `${config.appUrl}/app/${await slugOf()}/surveys`
  for (const studentId of ids) {
    await emit('surveys.request', { studentId, entity: { type: 'survey', id: s._id }, data: { survey: { title: s.title, closes: s.closesOn ? humanDate(s.closesOn) : '', link } } })
  }
  return ids.length
}

/** Freeze the questionnaire's version and open the survey (on its opening day). `notify` asks the audience now. */
export async function publishSurvey(id, { notify = false } = {}, req) {
  const s = isOid(id) ? await Survey.findById(id) : null
  if (!s) throw notFound('Survey')
  if (s.publishedAt) throw conflict('This survey has already been published.')
  const form = await FormTemplate.findById(s.formId).lean()
  if (!form || form.status !== 'PUBLISHED' || !form.version) throw conflict('Publish the questionnaire in the form builder first.')
  const today = await surveyToday()
  if (s.closesOn && s.closesOn < today) throw badRequest('The closing day has passed — pick a later one.', { fields: { closesOn: 'In the past' } })
  Object.assign(s, { formVersion: form.version, formName: form.name, publishedAt: new Date(), publishedBy: actor() })
  if (s.audience === 'PUBLIC') s.publicToken = randomBytes(12).toString('base64url')
  await s.save()
  let invited = 0
  if (notify && surveyState(s, today) === 'OPEN') {
    invited = await invite(s, await notAnswered(s))
    s.remindedAt = new Date()
    await s.save()
  }
  await audit({ action: 'UPDATE', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: `Published the survey “${s.title}” (${form.name} v${form.version})${invited ? `, asked ${invited}` : ''}` }, req)
  return { ...(await getSurvey(s._id)), asked: invited }
}

/** A reminder to those who haven't answered. */
export async function remindSurvey(id, req) {
  const s = isOid(id) ? await Survey.findById(id) : null
  if (!s) throw notFound('Survey')
  if (surveyState(s, await surveyToday()) !== 'OPEN') throw conflict('Only an open survey can be sent a reminder.')
  if (s.audience === 'PUBLIC') throw conflict('A public-link survey has no list of people to remind.')
  const asked = await invite(s, await notAnswered(s))
  s.remindedAt = new Date()
  await s.save()
  await audit({ action: 'SEND', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: `Reminded ${asked} about the survey “${s.title}”` }, req)
  return { asked }
}

export async function closeSurvey(id, closed, req) {
  const s = isOid(id) ? await Survey.findById(id) : null
  if (!s) throw notFound('Survey')
  if (!s.publishedAt) throw conflict('This survey hasn’t been published.')
  s.closedAt = closed ? new Date() : undefined
  if (!closed && s.closesOn && s.closesOn < await surveyToday()) s.closesOn = undefined
  await s.save()
  await audit({ action: 'UPDATE', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: closed ? `Closed the survey “${s.title}”` : `Opened the survey “${s.title}” again` }, req)
  return getSurvey(s._id)
}

// ───────────────────────────────────────────────────────── responses

/** Response rate by section (parents / students), per-question summaries and, unless anonymous, who answered. */
export async function surveyResults(id, { sectionId } = {}) {
  const s = isOid(id) ? await Survey.findById(id).lean() : null
  if (!s) throw notFound('Survey')
  const today = await surveyToday()
  const definition = await surveyDefinition(s)
  const filter = { surveyId: s._id }
  if (sectionId && isOid(sectionId)) filter.sectionId = new mongoose.Types.ObjectId(sectionId)
  const responses = await SurveyResponse.find(filter).sort({ submittedAt: -1 }).limit(5000).lean()
  let bySection = []
  let invited = await invitedCount(s)
  if (['PARENTS', 'STUDENTS'].includes(s.audience)) {
    const asked = await Student.aggregate([{ $match: audienceStudentFilter(s) }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }])
    const answered = await SurveyResponse.aggregate([{ $match: { surveyId: s._id } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }])
    const got = new Map(answered.map((a) => [String(a._id), a.n]))
    const secs = await Section.find({ _id: { $in: asked.map((a) => a._id).filter(Boolean) } }).select('name classId').lean()
    const classes = new Map((await ClassLevel.find({ _id: { $in: secs.map((x) => x.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
    const secBy = new Map(secs.map((x) => [String(x._id), x]))
    bySection = asked.filter((a) => a._id).map((a) => {
      const sec = secBy.get(String(a._id))
      const cls = sec ? classes.get(String(sec.classId)) : null
      const n = got.get(String(a._id)) ?? 0
      return { sectionId: String(a._id), label: sec ? sectionLabel(cls, sec, { short: true }) : '—', order: cls?.order ?? 0, invited: a.n, responded: n, rate: surveyRate(n, a.n) }
    }).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    if (sectionId) invited = bySection.find((b) => b.sectionId === String(sectionId))?.invited ?? 0
  }
  const sectionLabels = new Map(bySection.map((b) => [b.sectionId, b.label]))
  const byKind = {}
  for (const r of responses) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
  return {
    survey: await dto(s, today, { invited: await invitedCount(s) }),
    definition,
    responded: responses.length, invited, rate: surveyRate(responses.length, invited),
    bySection, byKind,
    questions: summariseSurvey(definition, responses.map((r) => r.values)),
    responses: responses.slice(0, 500).map((r) => ({
      id: String(r._id), kind: r.kind, name: s.anonymous ? null : r.name ?? null, classLabel: sectionLabels.get(idStr(r.sectionId)) ?? null,
      submittedAt: r.submittedAt, values: r.values,
    })),
  }
}

/** Every answer as a CSV: one row per response, one column per question. */
export async function surveyCsv(id, req) {
  const s = isOid(id) ? await Survey.findById(id).lean() : null
  if (!s) throw notFound('Survey')
  const definition = await surveyDefinition(s)
  const fields = formFields(definition).filter((f) => f.type !== 'INFO')
  const responses = await SurveyResponse.find({ surveyId: s._id }).sort({ submittedAt: 1 }).lean()
  const secs = await Section.find({ _id: { $in: responses.map((r) => r.sectionId).filter(Boolean) } }).select('name classId').lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: secs.map((x) => x.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const label = new Map(secs.map((x) => [String(x._id), sectionLabel(classes.get(String(x.classId)), x, { short: true })]))
  const show = (f, v) => {
    if (v === undefined || v === null) return ''
    if (Array.isArray(v)) return v.join('; ')
    if (f.type === 'YESNO') return v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : v
    if (f.type === 'SCORE') return `${f.options?.find((o) => Number(o.points) === Number(v))?.label ?? ''} (${v})`
    return v
  }
  const head = ['Submitted', 'Respondent', ...(s.anonymous ? [] : ['Name']), 'Class', ...fields.map((f) => f.label)]
  const lines = [head.map(csvCell).join(',')]
  for (const r of responses) {
    lines.push([r.submittedAt.toISOString(), r.kind ?? '', ...(s.anonymous ? [] : [r.name ?? '']), label.get(idStr(r.sectionId)) ?? '', ...fields.map((f) => show(f, r.values?.[f.key]))].map(csvCell).join(','))
  }
  await audit({ action: 'EXPORT', module: 'surveys', entityType: 'survey', entityId: String(s._id), entityName: s.title, summary: `Exported ${responses.length} answers to “${s.title}”` }, req)
  return { name: `${s.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'survey'}-responses.csv`, text: lines.join('\n') }
}
