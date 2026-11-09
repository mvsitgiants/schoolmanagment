import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { commandCentre } from '../services/dashboard.js'
import { liveCampus } from '../services/liveCampus.js'
import { institutionOverview } from '../services/overview.js'
import { globalSearch } from '../services/search.js'
import { z } from '../platform/validate.js'

// Dashboard: /api/v1/dashboard/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

// The header search box: records across modules, each only where the caller may look (services/search.js).
router.get('/search', async (req, res) => {
  const { q } = z.object({ q: z.string().max(100).default('') }).parse(req.query)
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await globalSearch(q, req.auth) })
})

// Home: the institution at a glance for a period. Open to every signed-in member of staff — each block
// inside shows only for the modules and records the caller may see (services/overview.js).
router.get('/overview', async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await institutionOverview(req.auth, q) })
})

router.get('/command', requireModule('dashboard'), requirePermission('dashboard.live.view'), async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await commandCentre(req.auth) })
})

// Live campus: every section right now (period, teacher and their presence, substitute, attendance), the teachers,
// the syllabus against the plan, what needs attention and the next 7 days. `at` (HH:MM) looks at another time of the
// day; `date` at another day close by (yesterday, the next school day).
router.get('/live', requireModule('dashboard'), requirePermission('dashboard.live.view'), async (req, res) => {
  const q = z.object({ at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').optional(), date: ymd.optional(), branchId: z.string().optional() }).parse(req.query)
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await liveCampus(req.auth, q) })
})

export default router
