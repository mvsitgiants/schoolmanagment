import { Router } from 'express'
import { DIFFICULTY, QUESTION_TYPES, RESULT_RELEASE, TEST_STATUS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  addQuestions, attemptDetail, closeTest, createTest, deleteTest, evaluateAttempt, exportResults, getTest, listTests, pickQuestions, publishTest, releaseResults,
  setQuestions, testAttempts, updateTest,
} from '../services/onlineTests.js'

// Online tests: /api/v1/online-tests — set tests from the question bank, publish, follow the attempts, mark.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('online-tests'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const when = z.object({ date: ymd, time: hhmm })

const testBody = z.object({
  title: z.string().trim().min(2, 'Name the test').max(160), instructions: optionalText(4000),
  classId: objectId, subjectId: objectId, sectionIds: z.array(objectId).max(30).default([]),
  durationMin: z.coerce.number().int().min(5).max(300).default(30), opens: when.optional(), closes: when.optional(),
  attemptsAllowed: z.coerce.number().int().min(1).max(10).default(1), passPct: z.coerce.number().min(0).max(100).default(33),
  shuffleQuestions: z.boolean().default(true), shuffleOptions: z.boolean().default(true), partialMarks: z.boolean().default(false),
  results: z.enum(RESULT_RELEASE.map((r) => r.value)).default('AFTER_CLOSE'), showAnswers: z.boolean().default(true),
  proctor: z.object({ fullscreen: z.boolean().default(false), maxTabSwitches: z.coerce.number().int().min(0).max(20).default(0) }).default({}),
})

router.get('/tests', requirePermission('online-tests.tests.view'), async (req, res) => {
  const q = z.object({
    status: z.enum(Object.keys(TEST_STATUS)).optional(), given: z.enum(['1', 'true']).optional().transform((v) => !!v), search: z.string().max(80).optional(),
    // one page: 50 rows by default, at most 100 (the platform's clamp)
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query)
  res.json({ data: await listTests(q, req.auth) })
})
router.post('/tests', requirePermission('online-tests.tests.create'), async (req, res) => { res.status(201).json({ data: await createTest(testBody.parse(req.body), req.auth, req) }) })
router.get('/tests/:id', requirePermission('online-tests.tests.view'), async (req, res) => { res.json({ data: await getTest(id(req), req.auth) }) })
router.patch('/tests/:id', requirePermission('online-tests.tests.edit', 'online-tests.tests.create'), async (req, res) => {
  const body = testBody.partial().parse(req.body)
  for (const k of ['shuffleQuestions', 'shuffleOptions', 'partialMarks', 'showAnswers', 'sectionIds', 'durationMin', 'attemptsAllowed', 'passPct', 'results', 'proctor']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await updateTest(id(req), body, req.auth, req) })
})
router.delete('/tests/:id', requirePermission('online-tests.tests.delete'), async (req, res) => { res.json({ data: await deleteTest(id(req), req.auth, req) }) })
router.post('/tests/:id/questions', requirePermission('online-tests.tests.edit', 'online-tests.tests.create'), async (req, res) => {
  res.json({ data: await addQuestions(id(req), z.object({ questionIds: z.array(objectId).min(1).max(200) }).parse(req.body), req.auth, req) })
})
router.post('/tests/:id/questions/pick', requirePermission('online-tests.tests.edit', 'online-tests.tests.create'), async (req, res) => {
  const body = z.object({ count: z.coerce.number().int().min(1).max(100), chapter: optionalText(120), difficulty: z.enum(Object.keys(DIFFICULTY)).optional(), type: z.enum(Object.keys(QUESTION_TYPES)).optional() }).parse(req.body)
  res.json({ data: await pickQuestions(id(req), body, req.auth, req) })
})
router.put('/tests/:id/questions', requirePermission('online-tests.tests.edit', 'online-tests.tests.create'), async (req, res) => {
  const body = z.object({ items: z.array(z.object({ index: z.coerce.number().int().min(0), marks: z.coerce.number().min(0.25).max(100).optional() })).max(300) }).parse(req.body)
  res.json({ data: await setQuestions(id(req), body, req.auth, req) })
})
router.post('/tests/:id/publish', requirePermission('online-tests.tests.publish'), async (req, res) => {
  res.json({ data: await publishTest(id(req), z.object({ notify: z.boolean().default(false) }).parse(req.body ?? {}), req.auth, req) })
})
router.post('/tests/:id/close', requirePermission('online-tests.tests.publish'), async (req, res) => { res.json({ data: await closeTest(id(req), req.auth, req) }) })
router.post('/tests/:id/release', requirePermission('online-tests.tests.publish', 'online-tests.attempts.evaluate'), async (req, res) => { res.json({ data: await releaseResults(id(req), req.auth, req) }) })

router.get('/tests/:id/attempts', requirePermission('online-tests.attempts.view'), async (req, res) => { res.json({ data: await testAttempts(id(req), req.auth) }) })
router.get('/tests/:id/attempts/export', requirePermission('online-tests.attempts.export'), async (req, res) => {
  const r = await exportResults(id(req), req.auth)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${r.name}"`)
  res.send(`﻿${r.body}`)
})
router.get('/attempts/:id', requirePermission('online-tests.attempts.view'), async (req, res) => { res.json({ data: await attemptDetail(id(req), req.auth) }) })
router.post('/attempts/:id/evaluate', requirePermission('online-tests.attempts.evaluate'), async (req, res) => {
  const body = z.object({ manual: z.record(z.string(), z.coerce.number().min(0).max(100).nullable()).default({}), feedback: z.record(z.string(), z.string().max(1000)).default({}) }).parse(req.body)
  res.json({ data: await evaluateAttempt(id(req), body, req.auth, req) })
})

export default router
