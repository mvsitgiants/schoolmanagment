import { Router } from 'express'
import { SUBMISSION_STATUSES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  createHomework, deleteHomework, deletePlan, getHomework, getSyllabus, homeworkLookup, listHomework, listPlans, markTopics, myTeaching, savePlan,
  saveSubmissions, saveSyllabus, setPlanStatus, syllabusOverview, updateHomework,
} from '../services/homework.js'

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

// ───────────────────────────────────────────────────────── lesson plans

const planSchema = z.object({
  sectionId: objectId, subjectId: objectId, date: ymd,
  period: z.coerce.number().int().min(1).max(15).optional().or(z.literal('').transform(() => undefined)),
  title: z.string().trim().min(2, 'Say what the lesson is about').max(160),
  topicIds: z.array(objectId).max(30).default([]),
  objectives: optionalText(2000), method: optionalText(4000), resources: optionalText(2000), homeworkNote: optionalText(1000),
})
router.get('/lesson-plans', requirePermission('homework.lesson-plans.view'), async (req, res) => {
  const q = z.object({
    from: ymd.optional(), to: ymd.optional(), sectionId: objectId.optional(), subjectId: objectId.optional(),
    mine: z.enum(['1', 'true']).optional().transform((v) => !!v),
  }).parse(req.query)
  res.json({ data: await listPlans(q, req.auth) })
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
