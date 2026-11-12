import { Router } from 'express'
import { QUESTION_KINDS, QUESTION_USES, SUBMISSION_STATUSES, TOPIC_STATUSES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  createHomework, deleteHomework, deletePlan, getHomework, getSyllabus, homeworkLookup, listHomework, listPlans, markTopics, myTeaching, planCalendar, savePlan,
  saveSubmissions, saveSyllabus, setPlanStatus, syllabusOverview, updateHomework,
} from '../services/homework.js'
import { getTopic, saveTopic, teachDay, updateTopicPlan } from '../services/homeworkTopics.js'

// Homework & lessons: /api/v1/homework/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('homework'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
// a month of the year plan; blank or null clears it
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM').nullish().or(z.literal('').transform(() => null))
const id = (req) => objectId.parse(req.params.id)
const ANY = ['homework.homework.view', 'homework.lesson-plans.view', 'homework.syllabus.view']

router.get('/lookup', requirePermission(...ANY), async (req, res) => {
  res.json({ data: await homeworkLookup(req.auth) })
})

// My workspace › My teaching: this week's lessons, homework to check, my classes against the year plan
router.get('/me', requirePermission(...ANY), async (req, res) => {
  res.json({ data: await myTeaching(req.auth) })
})

// ───────────────────────────────────────────────────────── syllabus

router.get('/syllabus/overview', requirePermission('homework.syllabus.view'), async (req, res) => {
  res.json({ data: await syllabusOverview(req.auth) })
})
router.get('/syllabus', requirePermission('homework.syllabus.view', 'homework.lesson-plans.view'), async (req, res) => {
  const q = z.object({ classId: objectId, subjectId: objectId }).parse(req.query)
  res.json({ data: await getSyllabus(q, req.auth) })
})
router.put('/syllabus', requirePermission('homework.syllabus.edit'), async (req, res) => {
  const input = z.object({
    classId: objectId, subjectId: objectId,
    units: z.array(z.object({
      id: z.string().optional(),
      name: z.string().trim().max(120),
      fromMonth: month, toMonth: month,
      topics: z.array(z.object({ id: z.string().optional(), name: z.string().trim().max(200), periods: z.coerce.number().int().min(0).max(200).optional(), month })).max(100).default([]),
    })).max(60),
  }).parse(req.body)
  res.json({ data: await saveSyllabus(input, req.auth, req) })
})
router.post('/syllabus/progress', requirePermission('homework.syllabus.edit', 'homework.lesson-plans.edit'), async (req, res) => {
  const input = z.object({ sectionId: objectId, subjectId: objectId, topicIds: z.array(objectId).min(1).max(300), done: z.boolean().default(true), date: ymd.optional() }).parse(req.body)
  res.json({ data: await markTopics(input, req.auth, req) })
})

// a topic's teaching material: book reference, how to teach it, questions and answers, homework suggestion
router.get('/syllabus/topics/:id', requirePermission('homework.syllabus.view', 'homework.lesson-plans.view'), async (req, res) => {
  res.json({ data: await getTopic(id(req), req.auth) })
})
const shortText = (n) => z.string().trim().max(n).optional().default('')
router.put('/syllabus/topics/:id', requirePermission('homework.syllabus.edit'), async (req, res) => {
  const input = z.object({
    book: z.object({ name: shortText(160), chapter: shortText(160), pages: shortText(120) }).optional(),
    howTo: optionalText(8000),
    keyPoints: z.array(z.string().trim().max(400)).max(40).default([]),
    questions: z.array(z.object({
      id: z.string().optional(), question: z.string().trim().max(2000), answer: z.string().max(4000).optional(),
      kind: z.enum(QUESTION_KINDS).default('SHORT'), options: z.array(z.string().trim().max(300)).max(8).optional(), use: z.enum(QUESTION_USES).default('CLASS'),
    })).max(80).default([]),
    homeworkHint: optionalText(2000),
  }).parse(req.body)
  res.json({ data: await saveTopic(id(req), input, req.auth, req) })
})

// a section's own record of a topic: taught / partly / not taught on its day, needs revision, its date, extra classes
router.post('/topic-plan', requirePermission('homework.syllabus.edit', 'homework.lesson-plans.edit'), async (req, res) => {
  const input = z.object({
    sectionId: objectId, subjectId: objectId, topicId: objectId,
    status: z.enum(TOPIC_STATUSES).optional(), date: ymd.optional(), notTaughtOn: ymd.optional(),
    needsRevision: z.boolean().optional(), revisionBy: ymd.nullish(), plannedDate: ymd.nullish(), notes: z.string().max(2000).optional(),
    addExtra: z.object({ date: ymd, period: z.coerce.number().int().min(1).max(15).optional(), note: optionalText(300) }).optional(),
    extraId: objectId.optional(), extraDone: z.boolean().optional(), removeExtra: z.boolean().optional(),
  }).parse(req.body)
  res.json({ data: await updateTopicPlan(input, req.auth, req) })
})

// the teacher's day: one class on one date, per subject what to teach, carried over, extra classes, revision
router.get('/teach', requirePermission('homework.syllabus.view', 'homework.lesson-plans.view'), async (req, res) => {
  const q = z.object({ sectionId: objectId.optional(), date: ymd.optional() }).parse(req.query)
  res.json({ data: await teachDay(q, req.auth) })
})

// ───────────────────────────────────────────────────────── lesson plans

const planSchema = z.object({
  sectionId: objectId, subjectId: objectId, date: ymd,
  period: z.coerce.number().int().min(1).max(15).optional().or(z.literal('').transform(() => undefined)),
  title: z.string().trim().min(2, 'Say what the lesson is about').max(160),
  topicIds: z.array(objectId).max(30).default([]),
  objectives: optionalText(2000), method: optionalText(4000), resources: optionalText(2000), homeworkNote: optionalText(1000),
  // teaching material: links (video, website, Drive) and notes; files are uploaded to the plan separately
  links: z.array(z.object({
    title: z.string().trim().max(120).optional().default(''),
    url: z.string().trim().max(1000).regex(/^https?:\/\/\S+$/i, 'Start the link with https://'),
  })).max(20).optional(),
  materialNotes: optionalText(4000),
})
const planQuery = z.object({
  from: ymd.optional(), to: ymd.optional(), sectionId: objectId.optional(), subjectId: objectId.optional(), topicId: objectId.optional(),
  mine: z.enum(['1', 'true']).optional().transform((v) => !!v),
})
// one page of the list: 50 rows by default, at most 100 (the platform's clamp)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }
router.get('/lesson-plans', requirePermission('homework.lesson-plans.view'), async (req, res) => {
  res.json({ data: await listPlans(planQuery.extend(paging).parse(req.query), req.auth) })
})
// the month view: per-day counts and the first few plans of each day, over at most six weeks
router.get('/lesson-plans/calendar', requirePermission('homework.lesson-plans.view'), async (req, res) => {
  const q = planQuery.extend({ from: ymd, to: ymd }).refine((x) => x.from <= x.to && (Date.parse(x.to) - Date.parse(x.from)) / 86_400_000 <= 42, { message: 'Pick at most six weeks', path: ['to'] }).parse(req.query)
  res.json({ data: await planCalendar(q, req.auth) })
})
router.post('/lesson-plans', requirePermission('homework.lesson-plans.create'), async (req, res) => {
  res.status(201).json({ data: await savePlan(null, planSchema.parse(req.body), req.auth, req) })
})
router.patch('/lesson-plans/:id', requirePermission('homework.lesson-plans.edit'), async (req, res) => {
  res.json({ data: await savePlan(id(req), planSchema.parse(req.body), req.auth, req) })
})
router.delete('/lesson-plans/:id', requirePermission('homework.lesson-plans.delete'), async (req, res) => {
  res.json({ data: await deletePlan(id(req), req.auth, req) })
})
router.post('/lesson-plans/:id/status', requirePermission('homework.lesson-plans.edit'), async (req, res) => {
  const input = z.object({ status: z.enum(['PLANNED', 'DONE', 'SKIPPED']), reflection: optionalText(2000) }).parse(req.body)
  res.json({ data: await setPlanStatus(id(req), input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── homework

router.get('/', requirePermission('homework.homework.view'), async (req, res) => {
  const q = z.object({
    sectionId: objectId.optional(), subjectId: objectId.optional(), when: z.enum(['OPEN', 'PAST']).optional(),
    mine: z.enum(['1', 'true']).optional().transform((v) => !!v),
  }).parse(req.query)
  res.json(await listHomework(q, pageParams(req.query), req.auth))
})
router.post('/', requirePermission('homework.homework.create'), async (req, res) => {
  const input = z.object({
    sectionIds: z.array(objectId).min(1, 'Pick at least one class').max(20), subjectId: objectId,
    title: z.string().trim().min(2, 'Say what the homework is').max(200), details: optionalText(4000),
    setDate: ymd.optional(), dueDate: ymd, needsSubmission: z.boolean().optional(), notify: z.boolean().optional(),
  }).parse(req.body)
  res.status(201).json({ data: await createHomework(input, req.auth, req) })
})
router.get('/:id', requirePermission('homework.homework.view'), async (req, res) => {
  res.json({ data: await getHomework(id(req), req.auth) })
})
router.patch('/:id', requirePermission('homework.homework.edit'), async (req, res) => {
  const input = z.object({ title: z.string().trim().min(2).max(200).optional(), details: z.string().max(4000).optional(), dueDate: ymd.optional(), needsSubmission: z.boolean().optional() }).parse(req.body)
  res.json({ data: await updateHomework(id(req), input, req.auth, req) })
})
router.delete('/:id', requirePermission('homework.homework.delete'), async (req, res) => {
  res.json({ data: await deleteHomework(id(req), req.auth, req) })
})
router.put('/:id/submissions', requirePermission('homework.homework.edit', 'homework.homework.create'), async (req, res) => {
  const { entries } = z.object({
    entries: z.array(z.object({ studentId: objectId, status: z.enum(SUBMISSION_STATUSES), remark: optionalText(300) })).min(1).max(300),
  }).parse(req.body)
  res.json({ data: await saveSubmissions(id(req), entries, req.auth, req) })
})

export default router
