import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { commandCentre } from '../services/dashboard.js'
import { institutionOverview } from '../services/overview.js'
import { z } from '../platform/validate.js'

// Dashboard: /api/v1/dashboard/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

// Home: the institution at a glance for a period. Open to every signed-in member of staff — each block
// inside shows only for the modules and records the caller may see (services/overview.js).
router.get('/overview', async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await institutionOverview(req.auth, q) })
})

router.get('/command', requireModule('dashboard'), requirePermission('dashboard.command.view'), async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await commandCentre(req.auth) })
})

export default router
