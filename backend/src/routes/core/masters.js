import { Router } from 'express'
import { requirePermission } from '../../platform/middleware.js'
import { mastersHub } from '../../services/masters.js'

// Masters hub: /api/v1/core/masters — set-up pages with their record counts.
const router = Router()

router.get('/masters', requirePermission('core.masters.view'), async (req, res) => {
  res.json({ data: await mastersHub(req.auth) })
})

export default router
