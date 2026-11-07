import { Router } from 'express'
import { REPORT_FREQUENCIES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, objectId, z } from '../platform/validate.js'
import { deleteSaved, libraryFor, listSaved, runReport, runSaved, saveSaved } from '../services/reports.js'

// Reports: /api/v1/reports/*  — the library (run any report the role may) and saved reports.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('reports'))

const params = z.record(z.string(), z.any()).default({})

router.get('/library', requirePermission('reports.library.view'), async (req, res) => {
  res.json({ data: libraryFor(req.auth) })
})
router.post('/run/:id', requirePermission('reports.library.run'), async (req, res) => {
  const body = z.object({ params, columns: z.array(z.string()).max(40).optional() }).parse(req.body ?? {})
  res.json({ data: await runReport(req.params.id, body.params, req.auth, { columns: body.columns }) })
})

const savedSchema = z.object({
  name: z.string().trim().min(2, 'Name it').max(80),
  reportId: z.string().min(1),
  params,
  columns: z.array(z.string()).max(40).default([]),
  sharedRoleIds: z.array(objectId).max(30).default([]),
  schedule: z.object({
    active: z.boolean().default(false),
    frequency: z.enum(REPORT_FREQUENCIES.map((f) => f.value)).default('WEEKLY'),
    hour: z.coerce.number().int().min(0).max(23).default(7),
    userIds: z.array(objectId).max(50).default([]),
    emails: z.array(email).max(20).default([]),
  }).optional(),
})
router.get('/saved', requirePermission('reports.builder.view', 'reports.library.view'), async (req, res) => {
  res.json({ data: await listSaved(req.auth) })
})
router.post('/saved', requirePermission('reports.builder.create'), async (req, res) => {
  res.status(201).json({ data: await saveSaved(null, savedSchema.parse(req.body), req.auth, req) })
})
router.patch('/saved/:id', requirePermission('reports.builder.edit'), async (req, res) => {
  res.json({ data: await saveSaved(objectId.parse(req.params.id), savedSchema.parse(req.body), req.auth, req) })
})
router.delete('/saved/:id', requirePermission('reports.builder.delete'), async (req, res) => {
  res.json({ data: await deleteSaved(objectId.parse(req.params.id), req.auth, req) })
})
router.post('/saved/:id/run', requirePermission('reports.library.run', 'reports.builder.view'), async (req, res) => {
  res.json({ data: await runSaved(objectId.parse(req.params.id), req.auth) })
})

export default router
