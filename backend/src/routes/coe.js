import { Router } from 'express'
import { COE_MODERATION_KINDS, COE_REVAL_STATUS, COE_SESSION_KINDS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { programLookup } from '../services/programs.js'
import {
  computeSession, decideModeration, getSheet, listSessions, lockSheet, prepareSheets, proposeModeration, publishSession, saveSession,
  saveSheet, sessionBoard, unlockSheet,
} from '../services/coe.js'
import {
  actOnRevaluation, listRevaluations, listSemesterResults, requestRevaluation, revaluationCandidates, semesterResultDetail,
} from '../services/coeResults.js'

// Exam controller: /api/v1/coe/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('coe'))

const id = (req) => objectId.parse(req.params.id)
const VIEW_ANY = ['coe.marks.view', 'coe.revaluation.view', 'coe.grade-cards.view']
// one page of a list: 50 rows by default, at most 100 (the platform's clamp)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }

router.get('/lookup', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await programLookup(req.auth, 'coe') })
})

// ───────────────────────────────────────────────────────── sessions

const sessionSchema = z.object({
  name: z.string().trim().min(3, 'Name the session, e.g. Nov 2026 end-semester').max(80),
  kind: z.enum(Object.keys(COE_SESSION_KINDS)).default('REGULAR'),
  academicYearId: objectId.optional(),
  examMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional(),
  targets: z.array(z.object({ programId: objectId, semester: z.coerce.number().int().min(1).max(16) })).min(1, 'Pick at least one program-semester').max(60),
  revaluationFee: z.coerce.number().int().min(0).max(10_000_00).optional(), // paise
})

router.get('/sessions', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await listSessions(req.auth) })
})
router.post('/sessions', requirePermission('coe.marks.create'), async (req, res) => {
  res.status(201).json({ data: await saveSession(null, sessionSchema.parse(req.body), req.auth, req) })
})
router.patch('/sessions/:id', requirePermission('coe.marks.edit'), async (req, res) => {
  res.json({ data: await saveSession(id(req), sessionSchema.omit({ kind: true, academicYearId: true }).partial().parse(req.body), req.auth, req) })
})
router.get('/sessions/:id', requirePermission('coe.marks.view'), async (req, res) => {
  res.json({ data: await sessionBoard(id(req), req.auth) })
})
router.post('/sessions/:id/prepare', requirePermission('coe.marks.create'), async (req, res) => {
  res.json({ data: await prepareSheets(id(req), req.auth, req) })
})
router.post('/sessions/:id/compute', requirePermission('coe.marks.lock', 'coe.grade-cards.publish'), async (req, res) => {
  res.json({ data: await computeSession(id(req), req.auth, req) })
})
router.post('/sessions/:id/publish', requirePermission('coe.grade-cards.publish'), async (req, res) => {
  res.json({ data: await publishSession(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── mark sheets

router.get('/sheets/:id', requirePermission('coe.marks.view'), async (req, res) => {
  res.json({ data: await getSheet(id(req), req.auth, { reveal: req.query.reveal === '1' }) })
})
const mark = z.union([z.null(), z.literal(''), z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/, 'Enter a number').transform(Number)]).optional()
router.put('/sheets/:id', requirePermission('coe.marks.edit'), async (req, res) => {
  const { entries } = z.object({
    entries: z.array(z.object({
      studentId: objectId.optional(), dummyNo: z.string().trim().max(12).optional(),
      components: z.record(z.string(), mark).optional(), marks: mark, absent: z.boolean().optional(),
    })).max(2000),
  }).parse(req.body)
  res.json({ data: await saveSheet(id(req), entries, req.auth, req) })
})
router.post('/sheets/:id/lock', requirePermission('coe.marks.lock'), async (req, res) => {
  res.json({ data: await lockSheet(id(req), req.auth, req) })
})
router.post('/sheets/:id/unlock', requirePermission('coe.marks.lock'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why the marks are being reopened').max(300) }).parse(req.body)
  res.json({ data: await unlockSheet(id(req), reason, req.auth, req) })
})
router.post('/sheets/:id/moderation', requirePermission('coe.marks.edit'), async (req, res) => {
  const input = z.object({
    kind: z.enum(Object.keys(COE_MODERATION_KINDS)),
    value: z.coerce.number().positive().max(20),
    reason: z.string().trim().min(3, 'Say why').max(300),
  }).parse(req.body)
  res.json({ data: await proposeModeration(id(req), input, req.auth, req) })
})
router.post('/sheets/:id/moderation/decide', requirePermission('coe.marks.lock'), async (req, res) => {
  const { approve } = z.object({ approve: z.boolean() }).parse(req.body)
  res.json({ data: await decideModeration(id(req), approve, req.auth, req) })
})

// ───────────────────────────────────────────────────────── results and grade cards

router.get('/sessions/:id/results', requirePermission('coe.grade-cards.view', 'coe.revaluation.view'), async (req, res) => {
  const q = z.object({
    programId: objectId.optional(), semester: z.coerce.number().int().min(1).max(16).optional(), result: z.enum(['PASS', 'FAIL', 'ARREARS']).optional(),
    search: z.string().max(80).optional(), ...paging,
  }).parse(req.query)
  res.json({ data: await listSemesterResults(id(req), req.auth, q) })
})
router.get('/results/:id', requirePermission('coe.grade-cards.view', 'coe.revaluation.view'), async (req, res) => {
  res.json({ data: await semesterResultDetail(id(req), req.auth) })
})

// ───────────────────────────────────────────────────────── revaluation

router.get('/revaluations', requirePermission('coe.revaluation.view'), async (req, res) => {
  const q = z.object({ sessionId: objectId.optional(), status: z.enum(Object.keys(COE_REVAL_STATUS)).optional(), search: z.string().max(80).optional(), ...paging }).parse(req.query)
  res.json({ data: await listRevaluations(req.auth, q) })
})
router.get('/revaluations/candidates', requirePermission('coe.revaluation.create'), async (req, res) => {
  const q = z.object({ sessionId: objectId, search: z.string().max(60).optional() }).parse(req.query)
  res.json({ data: await revaluationCandidates(q.sessionId, q.search, req.auth) })
})
router.post('/revaluations', requirePermission('coe.revaluation.create'), async (req, res) => {
  const input = z.object({
    resultId: objectId, reason: optionalText(300),
    fee: z.coerce.number().int().min(0).max(10_000_00).optional(), feePaid: z.boolean().optional(),
  }).parse(req.body)
  res.status(201).json({ data: await requestRevaluation(input, req.auth, req) })
})
router.post('/revaluations/:id/act', requirePermission('coe.revaluation.approve'), async (req, res) => {
  const input = z.object({
    action: z.enum(['APPROVE', 'REJECT', 'REVALUE']),
    note: optionalText(300),
    newMarks: z.coerce.number().min(0).max(1000).optional(),
    feePaid: z.boolean().optional(),
  }).parse(req.body)
  res.json({ data: await actOnRevaluation(id(req), input, req.auth, req) })
})

export default router
