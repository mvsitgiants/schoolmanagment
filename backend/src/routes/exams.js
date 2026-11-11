import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  deleteExam, deleteType, getExam, getMarkSheet, listCandidates, listExams, listResults, listTypes, lockMarkSheet, marksBoard, publishResults, saveExam,
  saveMarkSheet, savePapers, saveRemarks, saveType, scheduleExam, sendReportCards, suggestPapers, unlockMarkSheet, unpublishResults, unscheduleExam,
} from '../services/exams.js'

// Exams & report cards: /api/v1/exams/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('exams'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const VIEW_ANY = ['exams.schedule.view', 'exams.marks.view', 'exams.results.view', 'exams.report-cards.view', 'exams.hall-tickets.view']

// ───────────────────────────────────────────────────────── setup: exam types

const typeSchema = z.object({
  name: z.string().trim().min(2, 'Name the exam type').max(60),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,8}$/, '1–8 letters, digits or dashes'),
  weightage: z.coerce.number().min(0).max(100).optional(),
  defaultMaxMarks: z.coerce.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
})
router.get('/types', requirePermission('exams.setup.view', 'exams.schedule.view'), async (req, res) => {
  res.json({ data: await listTypes() })
})
router.post('/types', requirePermission('exams.setup.create'), async (req, res) => {
  res.status(201).json({ data: await saveType(null, typeSchema.parse(req.body), req) })
})
router.patch('/types/:id', requirePermission('exams.setup.edit'), async (req, res) => {
  res.json({ data: await saveType(id(req), typeSchema.partial().parse(req.body), req) })
})
router.delete('/types/:id', requirePermission('exams.setup.delete'), async (req, res) => {
  res.json({ data: await deleteType(id(req), req) })
})

// ───────────────────────────────────────────────────────── exams and their papers

const examSchema = z.object({
  name: z.string().trim().min(2, 'Name the exam').max(80),
  academicYearId: objectId.optional(),
  examTypeId: objectId.optional().or(z.literal('').transform(() => undefined)),
  term: optionalText(40),
  classIds: z.array(objectId).min(1, 'Pick at least one class').max(60),
  gradingSchemeId: objectId.optional().or(z.literal('').transform(() => undefined)),
  instructions: optionalText(2000),
})
router.get('/', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await listExams({ yearId: req.query.yearId ? objectId.parse(req.query.yearId) : undefined }, req.auth) })
})
router.post('/', requirePermission('exams.schedule.create'), async (req, res) => {
  res.status(201).json({ data: await saveExam(null, examSchema.parse(req.body), req) })
})
router.get('/:id', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await getExam(id(req), req.auth) })
})
router.patch('/:id', requirePermission('exams.schedule.edit'), async (req, res) => {
  res.json({ data: await saveExam(id(req), examSchema.parse(req.body), req) })
})
router.delete('/:id', requirePermission('exams.schedule.delete'), async (req, res) => {
  res.json({ data: await deleteExam(id(req), req) })
})
router.get('/:id/classes/:classId/suggest', requirePermission('exams.schedule.edit', 'exams.schedule.create'), async (req, res) => {
  res.json({ data: await suggestPapers(id(req), objectId.parse(req.params.classId)) })
})
router.put('/:id/classes/:classId/papers', requirePermission('exams.schedule.edit', 'exams.schedule.create'), async (req, res) => {
  const { papers } = z.object({
    papers: z.array(z.object({
      subjectId: objectId,
      date: ymd.optional().or(z.literal('').transform(() => undefined)),
      startTime: hhmm.optional().or(z.literal('').transform(() => undefined)),
      endTime: hhmm.optional().or(z.literal('').transform(() => undefined)),
      maxMarks: z.coerce.number().min(0).max(1000).default(100),
      passMarks: z.coerce.number().min(0).max(1000).default(0),
      gradeOnly: z.boolean().optional(),
      countsInTotal: z.boolean().optional(),
    })).max(40),
  }).parse(req.body)
  res.json({ data: await savePapers(id(req), objectId.parse(req.params.classId), papers, req) })
})
router.post('/:id/schedule', requirePermission('exams.schedule.edit'), async (req, res) => {
  res.json({ data: await scheduleExam(id(req), req.auth, req) })
})
router.post('/:id/unschedule', requirePermission('exams.schedule.edit'), async (req, res) => {
  res.json({ data: await unscheduleExam(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── hall tickets / candidates

router.get('/:id/candidates', requirePermission('exams.hall-tickets.view', 'exams.report-cards.view'), async (req, res) => {
  res.json({ data: await listCandidates(id(req), objectId.parse(req.query.sectionId), req.auth) })
})

// ───────────────────────────────────────────────────────── marks

router.get('/:id/marks', requirePermission('exams.marks.view'), async (req, res) => {
  res.json({ data: await marksBoard(id(req), req.auth) })
})
const sheetKey = (req) => z.object({ paperId: objectId, sectionId: objectId }).parse({ paperId: req.params.paperId, sectionId: req.params.sectionId })
router.get('/marks/:paperId/:sectionId', requirePermission('exams.marks.view'), async (req, res) => {
  res.json({ data: await getMarkSheet(sheetKey(req), req.auth) })
})
router.put('/marks/:paperId/:sectionId', requirePermission('exams.marks.create', 'exams.marks.edit'), async (req, res) => {
  const { entries } = z.object({
    entries: z.array(z.object({
      studentId: objectId,
      marks: z.union([z.coerce.number(), z.null()]).optional(),
      grade: z.string().trim().max(4).optional(),
      absent: z.boolean().optional(),
      exempt: z.boolean().optional(),
    })).max(300),
  }).parse(req.body)
  res.json({ data: await saveMarkSheet({ ...sheetKey(req), entries }, req.auth, req) })
})
router.post('/marks/:paperId/:sectionId/lock', requirePermission('exams.marks.lock'), async (req, res) => {
  res.json({ data: await lockMarkSheet(sheetKey(req), req.auth, req) })
})
router.post('/marks/:paperId/:sectionId/unlock', requirePermission('exams.marks.unlock'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.json({ data: await unlockMarkSheet({ ...sheetKey(req), reason }, req.auth, req) })
})

// ───────────────────────────────────────────────────────── results and report cards

router.get('/:id/results', requirePermission('exams.results.view'), async (req, res) => {
  res.json({ data: await listResults(id(req), objectId.parse(req.query.sectionId), req.auth) })
})
router.post('/:id/publish', requirePermission('exams.results.publish'), async (req, res) => {
  res.json({ data: await publishResults(id(req), req.auth, req) })
})
router.post('/:id/unpublish', requirePermission('exams.results.publish'), async (req, res) => {
  res.json({ data: await unpublishResults(id(req), req.auth, req) })
})
router.put('/:id/remarks', requirePermission('exams.marks.create', 'exams.report-cards.publish'), async (req, res) => {
  const { sectionId, remarks } = z.object({
    sectionId: objectId,
    remarks: z.array(z.object({ candidateId: objectId, remark: optionalText(300) })).max(300),
  }).parse(req.body)
  res.json({ data: await saveRemarks(id(req), sectionId, remarks, req.auth, req) })
})
router.post('/:id/report-cards/send', requirePermission('exams.report-cards.publish'), async (req, res) => {
  const input = z.object({ sectionId: objectId.optional(), resend: z.boolean().optional() }).parse(req.body ?? {})
  res.json({ data: await sendReportCards(id(req), input, req.auth, req) })
})

export default router
