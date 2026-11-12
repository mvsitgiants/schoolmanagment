import { Router } from 'express'
import { QUESTION_KINDS, QUESTION_USES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import {
  addTopic, copyTopicFiles, deleteTopic, deleteUnit, ensureHubItem, getHub, hubStudents, orderTopics, publishUnit, saveHubTopic, saveUnit,
} from '../services/teachingHub.js'

// Subject hub: /api/v1/teaching/hub/* (catalog page homework.hub). Which classes and subjects someone works on
// follows their `homework` data scope (services/teachingHub.js placeFor).
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('homework'))

const id = (req) => objectId.parse(req.params.id)
const place = { classId: objectId, subjectId: objectId }
const placeQ = z.object(place)
// a month of the year plan; blank or null clears it
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM').nullish().or(z.literal('').transform(() => null))
const text = (n) => z.string().max(n).optional() // '' clears; left out = unchanged

router.get('/hub', requirePermission('homework.hub.view'), async (req, res) => {
  const blank = objectId.optional().or(z.literal('').transform(() => undefined))
  const q = z.object({ ...place, unitId: blank, topicId: blank }).parse(req.query)
  res.json({ data: await getHub(q, req.auth) })
})
router.get('/hub/students', requirePermission('homework.hub.view'), async (req, res) => {
  res.json({ data: await hubStudents(placeQ.parse(req.query), req.auth) })
})

// units: add, rename (and months), remove
const unitBody = z.object({ ...place, name: z.string().trim().max(120), fromMonth: month, toMonth: month })
router.post('/hub/units', requirePermission('homework.hub.create'), async (req, res) => {
  res.status(201).json({ data: await saveUnit(null, unitBody.parse(req.body), req.auth, req) })
})
router.put('/hub/units/:id', requirePermission('homework.hub.edit'), async (req, res) => {
  res.json({ data: await saveUnit(id(req), unitBody.parse(req.body), req.auth, req) })
})
router.delete('/hub/units/:id', requirePermission('homework.hub.delete'), async (req, res) => {
  res.json({ data: await deleteUnit(id(req), placeQ.parse(req.query), req.auth, req) })
})
router.put('/hub/units/:id/order', requirePermission('homework.hub.edit'), async (req, res) => {
  res.json({ data: await orderTopics(id(req), z.object({ ...place, topicIds: z.array(objectId).max(200) }).parse(req.body), req.auth, req) })
})
// publish every topic of the unit (now or later, all or chosen students) — or `publish: false` to take it back to draft
router.post('/hub/units/:id/publish', requirePermission('homework.hub.edit'), async (req, res) => {
  const input = z.object({
    ...place, publish: z.boolean(), when: z.enum(['NOW', 'LATER']).default('NOW'),
    publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), publishTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    visibility: z.enum(['ALL', 'STUDENTS']).default('ALL'), studentIds: z.array(objectId).max(2000).optional(),
  }).parse(req.body)
  res.json({ data: await publishUnit(id(req), input, req.auth, req) })
})

// topics: add, save everything on one, remove (refused once taught)
router.post('/hub/topics', requirePermission('homework.hub.create'), async (req, res) => {
  res.status(201).json({ data: await addTopic(z.object({ ...place, unitId: objectId, name: z.string().trim().max(200) }).parse(req.body), req.auth, req) })
})
router.put('/hub/topics/:id', requirePermission('homework.hub.edit'), async (req, res) => {
  const input = z.object({
    ...place,
    name: z.string().trim().max(200).optional(),
    periods: z.coerce.number().int().min(0).max(200).nullish(),
    book: z.object({ name: text(160), chapter: text(160), pages: text(120) }).optional(),
    howTo: text(8000), homeworkHint: text(2000),
    keyPoints: z.array(z.string().trim().max(400)).max(40).optional(),
    questions: z.array(z.object({
      id: z.string().optional(), question: z.string().trim().max(2000), answer: z.string().max(4000).optional(),
      kind: z.enum(QUESTION_KINDS).default('SHORT'), options: z.array(z.string().trim().max(300)).max(8).optional(), use: z.enum(QUESTION_USES).default('CLASS'),
    })).max(80).optional(),
    contentHtml: z.string().max(60000).optional(),
    subTopics: z.array(z.object({ id: z.string().optional(), name: z.string().trim().max(200), contentHtml: z.string().max(60000).optional() })).max(30).optional(),
  }).parse(req.body)
  res.json({ data: await saveHubTopic(id(req), input, req.auth, req) })
})
router.delete('/hub/topics/:id', requirePermission('homework.hub.delete'), async (req, res) => {
  res.json({ data: await deleteTopic(id(req), placeQ.parse(req.query), req.auth, req) })
})
// the LMS item of a topic / sub-topic (made as a draft if missing) — before adding files or pictures to it;
// `copyFrom`: another item whose files are copied onto it (Add from library)
router.post('/hub/topics/:id/item', requirePermission('homework.hub.edit', 'homework.hub.create'), async (req, res) => {
  res.json({ data: await ensureHubItem(id(req), z.object({ ...place, subTopicId: objectId.optional(), copyFrom: objectId.optional() }).parse(req.body), req.auth) })
})
// copy the topic's own files (from the syllabus page's topic drawer) to its student content
router.post('/hub/topics/:id/copy-files', requirePermission('homework.hub.edit'), async (req, res) => {
  res.json({ data: await copyTopicFiles(id(req), z.object({ ...place, fileIds: z.array(objectId).max(50).optional() }).parse(req.body), req.auth, req) })
})

export default router
