import { Router } from 'express'
import { AuditLog } from '../../models/tenant.js'
import { clean } from '../../platform/db.js'
import { requirePermission } from '../../platform/middleware.js'
import { listResponse, pageParams, searchFilter } from '../../platform/validate.js'

const router = Router()

router.get('/audit', requirePermission('core.audit.view'), async (req, res) => {
  const paging = pageParams(req.query)
  const filter = { ...searchFilter(paging.search, ['summary', 'entityName', 'userName']) }
  if (req.query.entityType) filter.entityType = String(req.query.entityType)
  if (req.query.action) filter.action = String(req.query.action)
  if (req.query.from || req.query.to) {
    filter.at = {}
    if (req.query.from) filter.at.$gte = new Date(`${req.query.from}T00:00:00`)
    if (req.query.to) filter.at.$lte = new Date(`${req.query.to}T23:59:59.999`)
  }
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    AuditLog.countDocuments(filter),
  ])
  res.json(listResponse(clean(rows), total, paging))
})

/** One record's history (RecordHistory component). */
router.get('/audit/entity/:entityId', requirePermission('core.audit.view', 'core.roles.view', 'core.users.view'), async (req, res) => {
  const rows = await AuditLog.find({ entityId: req.params.entityId }).sort({ at: -1 }).limit(100).lean()
  res.json({ data: clean(rows) })
})

export default router
