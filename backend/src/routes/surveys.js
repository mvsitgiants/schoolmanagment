import { Router } from 'express'
import { SURVEY_AUDIENCES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  closeSurvey, deleteSurvey, getSurvey, listSurveys, publishSurvey, remindSurvey, saveSurvey, surveyCsv, surveyForms, surveyResults,
} from '../services/surveys.js'
import { staffRespond, staffSurvey, staffSurveys } from '../services/surveysFill.js'

// surveys: /api/v1/surveys/*  — surveys built on the form builder, staff filling them, and the results
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('surveys'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const answers = z.object({ values: z.record(z.string(), z.any()).default({}) })

// ───────────────────────────────────────────────────────── for staff to fill (any signed-in staff member)

router.get('/mine', async (req, res) => {
  res.json({ data: await staffSurveys(req.auth) })
})
router.get('/mine/:id', async (req, res) => {
  res.json({ data: await staffSurvey(id(req), req.auth) })
})
router.post('/mine/:id/respond', async (req, res) => {
  res.status(201).json({ data: await staffRespond(id(req), answers.parse(req.body).values, req.auth) })
})

// ───────────────────────────────────────────────────────── surveys

/** Questionnaires (published form-builder forms of use SURVEY) a survey can send. */
router.get('/questionnaires', requirePermission('surveys.forms.view'), async (req, res) => {
  res.json({ data: await surveyForms() })
})
router.get('/', requirePermission('surveys.forms.view', 'surveys.responses.view'), async (req, res) => {
  res.json({ data: await listSurveys() })
})
router.get('/:id', requirePermission('surveys.forms.view', 'surveys.responses.view'), async (req, res) => {
  res.json({ data: await getSurvey(id(req)) })
})
const surveySchema = z.object({
  title: z.string().trim().min(3, 'Name the survey').max(150),
  intro: optionalText(1000),
  formId: objectId,
  audience: z.enum(SURVEY_AUDIENCES.map((a) => a.value)),
  classIds: z.array(objectId).max(100).default([]),
  sectionIds: z.array(objectId).max(300).default([]),
  anonymous: z.boolean().default(false),
  opensOn: optYmd,
  closesOn: optYmd,
})
router.post('/', requirePermission('surveys.forms.create'), async (req, res) => {
  res.status(201).json({ data: await saveSurvey(null, surveySchema.parse(req.body), req) })
})
router.patch('/:id', requirePermission('surveys.forms.edit'), async (req, res) => {
  const input = surveySchema.partial().extend({ classIds: z.array(objectId).max(100).optional(), sectionIds: z.array(objectId).max(300).optional(), anonymous: z.boolean().optional() }).parse(req.body)
  res.json({ data: await saveSurvey(id(req), input, req) })
})
router.delete('/:id', requirePermission('surveys.forms.delete'), async (req, res) => {
  res.json({ data: await deleteSurvey(id(req), req) })
})
router.post('/:id/publish', requirePermission('surveys.forms.publish'), async (req, res) => {
  const { notify } = z.object({ notify: z.boolean().default(true) }).parse(req.body ?? {})
  res.json({ data: await publishSurvey(id(req), { notify }, req) })
})
router.post('/:id/remind', requirePermission('surveys.forms.publish'), async (req, res) => {
  res.json({ data: await remindSurvey(id(req), req) })
})
router.post('/:id/close', requirePermission('surveys.forms.publish'), async (req, res) => {
  const { closed } = z.object({ closed: z.boolean().default(true) }).parse(req.body ?? {})
  res.json({ data: await closeSurvey(id(req), closed, req) })
})

// ───────────────────────────────────────────────────────── responses

router.get('/:id/results', requirePermission('surveys.responses.view'), async (req, res) => {
  const q = z.object({ sectionId: objectId.optional() }).parse(req.query)
  res.json({ data: await surveyResults(id(req), q) })
})
router.get('/:id/responses.csv', requirePermission('surveys.responses.export'), async (req, res) => {
  const { name, text } = await surveyCsv(id(req), req)
  res.type('text/csv').attachment(name).send(`﻿${text}`)
})

export default router
