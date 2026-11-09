import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import { publishYear, unpublishYear, yearOverview, yearSheet } from '../services/yearResults.js'

// Year-end results: /api/v1/exams/year-results/*  (the year report card prints through /documents/YEAR_REPORT_CARD/:studentId)
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('exams'))

const VIEW = 'exams.year-results.view'

router.get('/', requirePermission(VIEW), async (req, res) => {
  res.json({ data: await yearOverview(req.auth) })
})
router.get('/classes/:classId', requirePermission(VIEW), async (req, res) => {
  const { sectionId } = z.object({ sectionId: objectId.optional() }).parse(req.query)
  res.json({ data: await yearSheet(objectId.parse(req.params.classId), sectionId, req.auth) })
})
router.post('/classes/:classId/publish', requirePermission('exams.year-results.publish'), async (req, res) => {
  res.json({ data: await publishYear(objectId.parse(req.params.classId), req.auth, req) })
})
router.post('/classes/:classId/unpublish', requirePermission('exams.year-results.publish'), async (req, res) => {
  res.json({ data: await unpublishYear(objectId.parse(req.params.classId), req.auth, req) })
})

export default router
