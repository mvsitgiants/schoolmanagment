import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import { campusAnalytics } from '../services/analytics.js'
import { academicsAnalytics } from '../services/analyticsAcademics.js'
import { feesAnalytics } from '../services/analyticsFees.js'

// Analytics dashboards: /api/v1/analytics/* — read-only, within the caller's data scope for `analytics`.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('analytics'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const blank = (v) => (v === '' ? undefined : v)

const academicsQuery = z.object({
  yearId: z.preprocess(blank, objectId.optional()),
  examId: z.preprocess(blank, objectId.optional()),
  riskPct: z.preprocess(blank, z.coerce.number().min(0).max(100).optional()),
})
router.get('/academics', requirePermission('analytics.academics.view'), async (req, res) => {
  res.json({ data: await academicsAnalytics(academicsQuery.parse(req.query), req.auth) })
})

const feesQuery = z.object({
  from: z.preprocess(blank, ymd.optional()),
  to: z.preprocess(blank, ymd.optional()),
})
router.get('/fees', requirePermission('analytics.fees.view'), async (req, res) => {
  res.json({ data: await feesAnalytics(feesQuery.parse(req.query), req.auth) })
})

const campusQuery = z.object({ yearId: z.preprocess(blank, objectId.optional()) })
router.get('/campuses', requirePermission('analytics.campuses.view'), async (req, res) => {
  res.json({ data: await campusAnalytics(campusQuery.parse(req.query), req.auth) })
})

export default router
