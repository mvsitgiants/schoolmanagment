import { Router } from 'express'
import { APPROVAL_STATUSES, APPROVAL_TYPES } from '@schoolgiant/shared'
import { requirePermission } from '../../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../../platform/validate.js'
import { createRequest, decide, getRequest, listRequests, listRules, saveRule, withdraw } from '../../services/approvals.js'

// Approvals (docs/00 §7 E8). The inbox is personal — anyone can ask, and the engine
// decides who may approve — so only the rules and the "all requests" view need
// Administration › Workflows & approvals.
const router = Router()
const TYPES = APPROVAL_TYPES.map((t) => t.type)

router.get('/approvals', async (req, res) => {
  const q = z.object({ box: z.enum(['waiting', 'mine', 'all']).default('waiting'), status: z.enum(Object.keys(APPROVAL_STATUSES)).optional(), type: z.enum(TYPES).optional() }).parse(req.query)
  if (req.query.page) return res.json(await listRequests(q.box, q, req.auth, pageParams(req.query)))
  res.json({ data: await listRequests(q.box, q, req.auth) })
})

router.post('/approvals', async (req, res) => {
  const body = z.object({ type: z.enum(TYPES), payload: z.record(z.string(), z.any()).default({}), reason: optionalText(300) }).parse(req.body)
  res.status(201).json({ data: await createRequest(body, req.auth, req) })
})

router.get('/approvals/:id', async (req, res) => {
  res.json({ data: await getRequest(objectId.parse(req.params.id), req.auth) })
})

router.post('/approvals/:id/approve', async (req, res) => {
  const { note } = z.object({ note: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await decide(objectId.parse(req.params.id), 'APPROVE', note, req.auth, req) })
})

router.post('/approvals/:id/reject', async (req, res) => {
  const { note } = z.object({ note: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await decide(objectId.parse(req.params.id), 'REJECT', note, req.auth, req) })
})

router.post('/approvals/:id/withdraw', async (req, res) => {
  res.json({ data: await withdraw(objectId.parse(req.params.id), req.auth, req) })
})

router.get('/approval-rules', requirePermission('core.workflows.view'), async (req, res) => {
  res.json({ data: await listRules(req.auth) })
})

router.put('/approval-rules/:type', requirePermission('core.workflows.edit'), async (req, res) => {
  const type = z.enum(TYPES).parse(req.params.type)
  const body = z.object({
    enabled: z.boolean(),
    expiryHours: z.coerce.number().int().min(1, 'At least 1 hour').max(168, 'At most a week (168 hours)'),
    steps: z.array(z.object({
      label: optionalText(60),
      roleIds: z.array(objectId).max(20).default([]),
      // blank = applies to every request (z.coerce would turn null into 0)
      minValue: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number({ invalid_type_error: 'Enter a number' }).min(0).nullable()),
    })).min(1, 'Keep at least one step').max(3, 'Up to three steps'),
  }).parse(req.body)
  res.json({ data: await saveRule(type, body, req.auth, req) })
})

export default router
