import { Router } from 'express'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { commandCentre } from '../services/dashboard.js'

// Dashboard: /api/v1/dashboard/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('dashboard'))

router.get('/command', requirePermission('dashboard.command.view'), async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await commandCentre(req.auth) })
})

export default router
