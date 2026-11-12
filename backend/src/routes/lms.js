import { Router } from 'express'
import { BLOOM_LEVELS, CONTENT_STATUS, CONTENT_TYPES, CONTENT_VISIBILITY, COURSE_STATUS, DIFFICULTY, ITEM_KINDS, LIVE_PROVIDERS, LIVE_STATUS, QUESTION_TYPES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  cancelLive, courseProgressReport, createCourse, createLive, deleteCourse, deleteQuestion, endLive, getCourse, getQuestion, importQuestions, questionsFromTopics, listCourses, listLive,
  listQuestions, liveAttendance, lmsLookup, saveOutline, saveQuestion, setCourseStatus, startLive, updateCourse, updateLive,
} from '../services/lms.js'
import { contentStudents, contentTopics, createContent, deleteContent, getContent, listContent, topicContentCount, updateContent } from '../services/lmsContent.js'

// Learning (LMS): /api/v1/lms — courses and material, live classes, the question bank.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('lms'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const ANY = ['lms.courses.view', 'lms.live-classes.view', 'lms.question-bank.view', 'lms.create-content.view', 'lms.my-content.view', 'lms.content-library.view']

router.get('/lookup', requirePermission(...ANY), async (req, res) => { res.json({ data: await lmsLookup(req.auth) }) })

// ───────────────────────────────────────────────────────── courses

const courseBody = z.object({
  title: z.string().trim().min(2, 'Name the course').max(120), description: optionalText(2000),
  classId: objectId, subjectId: objectId, sectionIds: z.array(objectId).max(30).default([]), teacherIds: z.array(objectId).max(10).optional(),
  firstUnit: optionalText(120),
})
const itemBody = z.object({
  id: z.string().optional(), kind: z.enum(Object.keys(ITEM_KINDS)), title: z.string().trim().min(1, 'Name it').max(160),
  body: z.string().max(20000).optional(), url: z.string().trim().max(1000).optional(), published: z.boolean().default(true),
  minutes: z.coerce.number().int().min(0).max(600).optional().nullable(),
})
router.get('/courses', requirePermission('lms.courses.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(COURSE_STATUS)).optional(), classId: objectId.optional(), subjectId: objectId.optional() }).parse(req.query)
  res.json({ data: await listCourses(q, req.auth) })
})
router.post('/courses', requirePermission('lms.courses.create'), async (req, res) => { res.status(201).json({ data: await createCourse(courseBody.parse(req.body), req.auth, req) }) })
router.get('/courses/:id', requirePermission('lms.courses.view'), async (req, res) => { res.json({ data: await getCourse(id(req), req.auth) }) })
router.patch('/courses/:id', requirePermission('lms.courses.edit', 'lms.courses.create'), async (req, res) => { res.json({ data: await updateCourse(id(req), courseBody.partial().parse(req.body), req.auth, req) }) })
router.put('/courses/:id/outline', requirePermission('lms.courses.edit', 'lms.courses.create'), async (req, res) => {
  const { units } = z.object({ units: z.array(z.object({ id: z.string().optional(), title: z.string().trim().min(1, 'Name the unit').max(160), items: z.array(itemBody).max(200) })).max(60) }).parse(req.body)
  res.json({ data: await saveOutline(id(req), units, req.auth, req) })
})
router.post('/courses/:id/status', requirePermission('lms.courses.edit', 'lms.courses.create'), async (req, res) => {
  const { status } = z.object({ status: z.enum(Object.keys(COURSE_STATUS)) }).parse(req.body)
  res.json({ data: await setCourseStatus(id(req), status, req.auth, req) })
})
router.delete('/courses/:id', requirePermission('lms.courses.delete'), async (req, res) => { res.json({ data: await deleteCourse(id(req), req.auth, req) }) })
router.get('/courses/:id/progress', requirePermission('lms.courses.view'), async (req, res) => { res.json({ data: await courseProgressReport(id(req), req.auth) }) })

// ───────────────────────────────────────────────────────── teaching content (create / my content / library)

const CONTENT_VIEW = ['lms.create-content.view', 'lms.my-content.view', 'lms.content-library.view']
const contentBody = z.object({
  type: z.enum(Object.keys(CONTENT_TYPES).filter((k) => CONTENT_TYPES[k].kind)), classId: objectId, subjectId: objectId, topicId: objectId,
  title: z.string().trim().min(1, 'Give it a title').max(160), descriptionHtml: z.string().max(50000).optional().default(''),
  url: z.string().trim().max(1000).optional().default(''), publish: z.enum(['NOW', 'LATER']).default('NOW'),
  publishDate: ymd.optional().nullable(), publishTime: hhmm.optional().nullable(),
  visibility: z.enum(CONTENT_VISIBILITY).default('ALL'), studentIds: z.array(objectId).max(2000).default([]),
})
const contentQuery = z.object({
  classId: objectId.optional(), subjectId: objectId.optional(), topicId: objectId.optional(), teacherId: objectId.optional(),
  type: z.enum(Object.keys(CONTENT_TYPES).filter((k) => CONTENT_TYPES[k].kind)).optional(), status: z.enum(Object.keys(CONTENT_STATUS)).optional(),
})
router.get('/content/topics', requirePermission('lms.create-content.view', 'lms.my-content.edit'), async (req, res) => {
  res.json({ data: await contentTopics(z.object({ classId: objectId, subjectId: objectId }).parse(req.query), req.auth) })
})
router.get('/content/students', requirePermission('lms.create-content.view', 'lms.my-content.edit'), async (req, res) => {
  res.json({ data: await contentStudents(z.object({ classId: objectId }).parse(req.query), req.auth) })
})
router.get('/content/topic-count', requirePermission(...CONTENT_VIEW, 'lms.courses.view'), async (req, res) => {
  res.json({ data: await topicContentCount(objectId.parse(req.query.topicId), req.auth) })
})
router.get('/content/mine', requirePermission('lms.my-content.view'), async (req, res) => { res.json(await listContent(contentQuery.parse(req.query), pageParams(req.query), req.auth, { mine: true })) })
router.get('/content', requirePermission('lms.content-library.view'), async (req, res) => { res.json(await listContent(contentQuery.parse(req.query), pageParams(req.query), req.auth)) })
router.post('/content', requirePermission('lms.create-content.create'), async (req, res) => { res.status(201).json({ data: await createContent(contentBody.parse(req.body), req.auth, req) }) })
router.get('/content/:id', requirePermission(...CONTENT_VIEW), async (req, res) => { res.json({ data: await getContent(id(req), req.auth) }) })
router.put('/content/:id', requirePermission('lms.my-content.edit', 'lms.content-library.edit'), async (req, res) => { res.json({ data: await updateContent(id(req), contentBody.parse(req.body), req.auth, req) }) })
router.delete('/content/:id', requirePermission('lms.my-content.delete', 'lms.content-library.delete'), async (req, res) => { res.json({ data: await deleteContent(id(req), req.auth, req) }) })

// ───────────────────────────────────────────────────────── live classes

const liveBody = z.object({
  title: z.string().trim().min(2, 'Name the class').max(160), classId: objectId, subjectId: objectId.optional(), courseId: objectId.optional(),
  sectionIds: z.array(objectId).max(30).default([]), date: ymd, start: hhmm, durationMin: z.coerce.number().int().min(10).max(240).default(40),
  provider: z.enum(LIVE_PROVIDERS.map((p) => p.value)).default('JITSI'), joinUrl: optionalText(1000), notes: optionalText(1000), notify: z.boolean().default(false),
})
router.get('/live', requirePermission('lms.live-classes.view'), async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional(), status: z.enum(Object.keys(LIVE_STATUS)).optional() }).parse(req.query)
  res.json({ data: await listLive(q, req.auth) })
})
router.post('/live', requirePermission('lms.live-classes.create'), async (req, res) => { res.status(201).json({ data: await createLive(liveBody.parse(req.body), req.auth, req) }) })
router.patch('/live/:id', requirePermission('lms.live-classes.create'), async (req, res) => {
  res.json({ data: await updateLive(id(req), liveBody.pick({ title: true, date: true, start: true, durationMin: true, joinUrl: true, notes: true }).partial().parse(req.body), req.auth, req) })
})
router.post('/live/:id/start', requirePermission('lms.live-classes.start'), async (req, res) => { res.json({ data: await startLive(id(req), req.auth, req) }) })
router.post('/live/:id/end', requirePermission('lms.live-classes.start'), async (req, res) => {
  res.json({ data: await endLive(id(req), z.object({ recordingUrl: optionalText(1000) }).parse(req.body ?? {}), req.auth, req) })
})
router.post('/live/:id/cancel', requirePermission('lms.live-classes.create'), async (req, res) => {
  res.json({ data: await cancelLive(id(req), z.object({ reason: optionalText(300), notify: z.boolean().default(false) }).parse(req.body ?? {}), req.auth, req) })
})
router.get('/live/:id/attendance', requirePermission('lms.live-classes.view'), async (req, res) => { res.json({ data: await liveAttendance(id(req), req.auth) }) })

// ───────────────────────────────────────────────────────── question bank

const questionBody = z.object({
  subjectId: objectId, classId: objectId.optional().nullable(), chapter: optionalText(120), type: z.enum(Object.keys(QUESTION_TYPES)),
  text: z.string().trim().min(3, 'Write the question').max(5000),
  options: z.array(z.object({ text: z.string().trim().max(1000).default(''), correct: z.boolean().default(false) })).max(8).default([]),
  answers: z.array(z.string().trim().max(2000)).max(10).optional(), explanation: optionalText(3000),
  marks: z.coerce.number().min(0.25).max(100).default(1), negative: z.coerce.number().min(0).max(100).default(0),
  difficulty: z.enum(Object.keys(DIFFICULTY)).default('MEDIUM'), bloom: z.enum(BLOOM_LEVELS).optional().or(z.literal('').transform(() => undefined)),
  tags: z.array(z.string().trim().max(40)).max(10).default([]), active: z.boolean().default(true),
})
router.get('/questions', requirePermission('lms.question-bank.view'), async (req, res) => {
  const q = z.object({ subjectId: objectId.optional(), classId: objectId.optional(), type: z.enum(Object.keys(QUESTION_TYPES)).optional(), difficulty: z.enum(Object.keys(DIFFICULTY)).optional(), chapter: optionalText(120), search: optionalText(100), inactive: z.enum(['1']).optional() }).parse(req.query)
  res.json(await listQuestions(q, pageParams(req.query)))
})
router.post('/questions', requirePermission('lms.question-bank.create'), async (req, res) => { res.status(201).json({ data: await saveQuestion(null, questionBody.parse(req.body), req.auth, req) }) })
// the questions already written on a class's syllabus topics (Teaching hub), copied into the bank for that class and subject
router.post('/questions/from-topics', requirePermission('lms.question-bank.create'), async (req, res) => {
  res.json({ data: await questionsFromTopics(z.object({ classId: objectId, subjectId: objectId }).parse(req.body), req.auth, req) })
})
router.post('/questions/import', requirePermission('lms.question-bank.import'), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(3000), dryRun: z.boolean().default(true) }).parse(req.body)
  res.json({ data: await importQuestions(rows, { dryRun }, req.auth, req) })
})
router.get('/questions/:id', requirePermission('lms.question-bank.view'), async (req, res) => { res.json({ data: await getQuestion(id(req)) }) })
router.put('/questions/:id', requirePermission('lms.question-bank.edit'), async (req, res) => { res.json({ data: await saveQuestion(id(req), questionBody.parse(req.body), req.auth, req) }) })
router.delete('/questions/:id', requirePermission('lms.question-bank.delete'), async (req, res) => { res.json({ data: await deleteQuestion(id(req), req) }) })

export default router
