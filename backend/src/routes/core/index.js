import { Router } from 'express'
import { authenticate, subscriptionGate, tenantOnly } from '../../platform/middleware.js'
import approvals from './approvals.js'
import audit from './audit.js'
import config from './config.js'
import forms from './forms.js'
import notifications from './notifications.js'
import org from './org.js'
import roles from './roles.js'
import settings from './settings.js'
import subscription from './subscription.js'
import users from './users.js'
import masters from './masters.js'
import printing from './printing.js'
import apiKeys from './apiKeys.js'

// Institution workspace API: /api/v1/core/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate)
router.use(settings)
router.use(org)
router.use(users)
router.use(roles)
router.use(subscription)
router.use(audit)
router.use(config)
router.use(notifications)
router.use(approvals)
router.use(forms)
router.use(masters)
router.use(printing)
router.use(apiKeys)

export default router
