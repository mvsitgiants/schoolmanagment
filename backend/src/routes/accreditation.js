import { Router } from 'express'
import { ACCR_DVV_STATUS, ACCR_FRAMEWORKS, ACCR_METRIC_STATUS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  accreditationMeta, deleteEvidence, exportReport, getEvidence, getReport, listEvidence, saveEvidence, saveMetric, setEvidenceDvv,
} from '../services/accreditation.js'

// accreditation: /api/v1/accreditation/*  — reports (NAAC, NIRF, AISHE) metric by metric, and the evidence repository
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('accreditation'))

const REP = 'accreditation.reports'
const EVI = 'accreditation.evidence'
const id = (req) => objectId.parse(req.params.id)
const framework = z.enum(ACCR_FRAMEWORKS.map((f) => f.value))
const year = z.string().regex(/^\d{4}-\d{2}$/, 'Use a year like 2025-26')
const metricCode = z.string().trim().min(1).max(12)
const clearEmpty = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined))
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}

router.get('/meta', requirePermission(`${REP}.view`, `${EVI}.view`), async (req, res) => {
  res.json({ data: await accreditationMeta() })
})

// ───────────────────────────────────────────────────────── reports

const reportQuery = z.object({ framework, year })

router.get('/reports', requirePermission(`${REP}.view`), async (req, res) => {
  const q = reportQuery.parse(req.query)
  res.json({ data: await getReport(q.framework, q.year) })
})
router.get('/reports/export', requirePermission(`${REP}.export`), async (req, res) => {
  const q = reportQuery.parse(req.query)
  csv(res, `${q.framework}-${q.year}.csv`, await exportReport(q.framework, q.year))
})
router.put('/reports/:framework/:year/metrics/:code', requirePermission(`${REP}.edit`), async (req, res) => {
  const p = z.object({ framework, year, code: metricCode }).parse(req.params)
  const body = z.object({
    status: z.enum(Object.keys(ACCR_METRIC_STATUS)).optional(),
    manualValue: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(-1e12).max(1e12).nullable().optional()),
    note: z.string().trim().max(1000).optional(),
    narrative: z.string().max(30000).optional(),
  }).parse(req.body)
  res.json({ data: await saveMetric(p.framework, p.year, p.code, body, req.auth, req) })
})

// ───────────────────────────────────────────────────────── evidence

const evidenceBody = z.object({
  framework,
  metricCodes: z.array(metricCode).min(1, 'Link it to at least one metric').max(20),
  checklist: z.array(z.string().trim().max(20)).max(60).default([]),
  year: year.optional().nullable().or(z.literal('').transform(() => null)),
  title: z.string().trim().min(2, 'Name the evidence').max(200),
  description: optionalText(2000),
  link: z.string().trim().url('Enter a web address').max(500).optional().nullable().or(z.literal('').transform(() => null)),
})

router.get('/evidence', requirePermission(`${EVI}.view`), async (req, res) => {
  const q = z.object({
    framework, year: year.optional(), metric: metricCode.optional(), criterion: z.string().max(8).optional(), search: z.string().trim().max(80).optional(),
  }).parse(clearEmpty(req.query))
  res.json({ data: await listEvidence(q) })
})
router.get('/evidence/:id', requirePermission(`${EVI}.view`), async (req, res) => {
  res.json({ data: await getEvidence(id(req)) })
})
router.post('/evidence', requirePermission(`${EVI}.create`), async (req, res) => {
  res.status(201).json({ data: await saveEvidence(null, evidenceBody.parse(req.body), req.auth, req) })
})
router.patch('/evidence/:id', requirePermission(`${EVI}.edit`), async (req, res) => {
  const body = evidenceBody.omit({ framework: true }).partial().parse(req.body)
  if (req.body?.checklist === undefined) delete body.checklist
  res.json({ data: await saveEvidence(id(req), body, req.auth, req) })
})
router.post('/evidence/:id/dvv', requirePermission(`${EVI}.edit`), async (req, res) => {
  const body = z.object({ status: z.enum(Object.keys(ACCR_DVV_STATUS)), note: optionalText(500) }).parse(req.body)
  res.json({ data: await setEvidenceDvv(id(req), body, req.auth, req) })
})
router.delete('/evidence/:id', requirePermission(`${EVI}.delete`), async (req, res) => {
  res.json({ data: await deleteEvidence(id(req), req.auth, req) })
})

export default router
