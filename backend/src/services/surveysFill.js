import { randomBytes } from 'node:crypto'
import { surveyState, validateFormValues } from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { studentName } from '../models/students.js'
import { Survey, SurveyResponse } from '../models/surveys.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { need, studentFor } from './portal.js'
import { respondentKey, studentInAudience, surveyDefinition, surveyToday } from './surveys.js'

// Filling a survey: staff in the staff app, families in the family app (once per child), anyone with a public link.
// Answers are checked against the survey's frozen questionnaire with the form engine; one answer per person.

const brief = (s, today, answered) => ({
  id: String(s._id), title: s.title, intro: s.intro ?? null, audience: s.audience, anonymous: !!s.anonymous,
  opensOn: s.opensOn ?? null, closesOn: s.closesOn ?? null, state: surveyState(s, today), answered: !!answered,
})

/** Check the answers and save them as one response. */
async function record(s, who, input) {
  const today = await surveyToday()
  if (surveyState(s, today) !== 'OPEN') throw conflict(surveyState(s, today) === 'SCHEDULED' ? 'This survey hasn’t opened yet.' : 'This survey has closed. Thank you all the same!')
  const definition = await surveyDefinition(s)
  if (!definition) throw conflict('This survey’s questions are missing.')
  const { values, errors } = validateFormValues(definition, input ?? {})
  if (Object.keys(errors).length) throw badRequest('Some answers need a look.', { fields: errors })
  const key = respondentKey(s, who.raw)
  if (await SurveyResponse.exists({ surveyId: s._id, respondentKey: key })) throw conflict('You have already answered this survey. Thank you!')
  try {
    await SurveyResponse.create({
      surveyId: s._id, formVersion: s.formVersion, respondentKey: key, kind: who.kind, values,
      ...(s.anonymous ? {} : { studentId: who.studentId, userId: who.userId, name: who.name }),
      classId: who.classId, sectionId: who.sectionId,
    })
  } catch (err) {
    if (err?.code === 11000) throw conflict('You have already answered this survey. Thank you!')
    throw err
  }
  await Survey.updateOne({ _id: s._id }, { $inc: { responses: 1 } })
  return { submitted: true }
}

// ───────────────────────────────────────────────────────── staff

/** Staff surveys open now, with whether this user has answered. */
export async function staffSurveys(auth) {
  const today = await surveyToday()
  const rows = (await Survey.find({ audience: 'STAFF', publishedAt: { $ne: null }, closedAt: null }).sort({ publishedAt: -1 }).lean()).filter((s) => surveyState(s, today) === 'OPEN')
  const out = []
  for (const s of rows) out.push(brief(s, today, await SurveyResponse.exists({ surveyId: s._id, respondentKey: respondentKey(s, `U:${auth.userId}`) })))
  return out
}

async function staffOne(id) {
  const s = isOid(id) ? await Survey.findOne({ _id: id, audience: 'STAFF', publishedAt: { $ne: null } }).lean() : null
  if (!s) throw notFound('Survey')
  return s
}

export async function staffSurvey(id, auth) {
  const s = await staffOne(id)
  const today = await surveyToday()
  const answered = await SurveyResponse.exists({ surveyId: s._id, respondentKey: respondentKey(s, `U:${auth.userId}`) })
  return { ...brief(s, today, answered), definition: await surveyDefinition(s) }
}

export async function staffRespond(id, values, auth) {
  const s = await staffOne(id)
  return record(s, { raw: `U:${auth.userId}`, kind: 'STAFF', userId: auth.userId, name: auth.user?.name }, values)
}

// ───────────────────────────────────────────────────────── family app › Surveys

/** Parents answer PARENTS surveys (per child); STUDENTS surveys can be answered by the student, or on a parent's phone. */
const kindsFor = (f) => (f.session.kind === 'STUDENT' ? ['STUDENTS'] : ['PARENTS', 'STUDENTS'])
const rawKey = (s, st) => `${s.audience === 'STUDENTS' ? 'T' : 'S'}:${st._id}`

export async function familySurveys(f, studentId) {
  need(f, 'SURVEYS')
  const st = studentFor(f, studentId)
  const today = await surveyToday()
  const rows = (await Survey.find({ audience: { $in: kindsFor(f) }, publishedAt: { $ne: null } }).sort({ publishedAt: -1 }).limit(50).lean())
    .filter((s) => studentInAudience(s, st) && surveyState(s, today) !== 'SCHEDULED')
  const out = []
  for (const s of rows) {
    const answered = await SurveyResponse.exists({ surveyId: s._id, respondentKey: respondentKey(s, rawKey(s, st)) })
    const state = surveyState(s, today)
    if (state === 'CLOSED' && !answered) continue // a closed one they missed is just noise
    out.push(brief(s, today, answered))
  }
  return out
}

async function familyOne(f, st, surveyId) {
  const s = isOid(surveyId) ? await Survey.findOne({ _id: surveyId, audience: { $in: kindsFor(f) }, publishedAt: { $ne: null } }).lean() : null
  if (!s || !studentInAudience(s, st)) throw notFound('Survey')
  return s
}

export async function familySurvey(f, studentId, surveyId) {
  need(f, 'SURVEYS')
  const st = studentFor(f, studentId)
  const s = await familyOne(f, st, surveyId)
  const answered = await SurveyResponse.exists({ surveyId: s._id, respondentKey: respondentKey(s, rawKey(s, st)) })
  return { ...brief(s, await surveyToday(), answered), definition: await surveyDefinition(s) }
}

export async function familyRespond(f, studentId, surveyId, values) {
  need(f, 'SURVEYS')
  const st = studentFor(f, studentId)
  const s = await familyOne(f, st, surveyId)
  const parent = s.audience === 'PARENTS'
  const g = parent ? (st.guardians ?? []).find((x) => String(x.mobile ?? '').replace(/\D/g, '').endsWith(String(f.session.mobile ?? '').slice(-10))) : null
  return record(s, {
    raw: rawKey(s, st), kind: parent ? 'PARENT' : 'STUDENT', studentId: st._id,
    name: parent ? `${g?.name ?? 'Parent'} (parent of ${studentName(st)})` : studentName(st),
    classId: st.classId, sectionId: st.sectionId,
  }, values)
}

// ───────────────────────────────────────────────────────── public link

async function publicOne(token) {
  const s = /^[\w-]{8,40}$/.test(String(token ?? '')) ? await Survey.findOne({ publicToken: token, audience: 'PUBLIC', publishedAt: { $ne: null } }).lean() : null
  if (!s) throw notFound('Survey')
  return s
}

/** The page anyone with the link opens: the institution, the survey and its questions. */
export async function publicSurvey(token) {
  const s = await publicOne(token)
  const t = await Tenant.findById(getContext()?.tenantId).select('name profile').lean()
  const today = await surveyToday()
  return {
    institution: { name: t?.name ?? '', logoUrl: t?.profile?.logoUrl ?? null, primaryColor: t?.profile?.primaryColor ?? null },
    ...brief(s, today, false), definition: surveyState(s, today) === 'OPEN' ? await surveyDefinition(s) : null,
  }
}

/** `clientKey`: a random id the browser keeps, so the same browser answers once (best effort — anyone can open the link). */
export async function publicRespond(token, { values, clientKey, name }) {
  const s = await publicOne(token)
  const key = /^[\w-]{8,64}$/.test(String(clientKey ?? '')) ? clientKey : randomBytes(12).toString('base64url')
  return record(s, { raw: `P:${key}`, kind: 'PUBLIC', name: name || undefined }, values)
}
