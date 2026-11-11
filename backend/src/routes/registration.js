import { Router } from 'express'
import { REG_STATUS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { programLookup } from '../services/programs.js'
import {
  courseRoster, decideRegistrations, getWindow, listRegistrations, listWindows, registrationForm, saveRegistration, deleteWindow, saveWindow, windowRosters,
} from '../services/registration.js'

// Semester registration: /api/v1/registration/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('registration'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const id = (req) => objectId.parse(req.params.id)
const VIEW_ANY = ['registration.windows.view', 'registration.requests.view']
// staff enter a selection for the student: whoever sets windows up, or the advisor who approves
const ENTER = ['registration.windows.edit', 'registration.requests.approve']

/** Programs in the caller's scope, for the pickers. */
router.get('/lookup', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await programLookup(req.auth, 'registration') })
})

// ───────────────────────────────────────────────────────── windows

const credits = z.coerce.number().min(0).max(80).optional().nullable()
const windowSchema = z.object({
  programId: objectId,
  semester: z.coerce.number().int().min(1).max(16),
  academicYearId: objectId.optional(),
  opensOn: ymd,
  closesOn: ymd,
  minCredits: credits,
  maxCredits: credits,
  offerings: z.array(z.object({
    courseId: objectId,
    mandatory: z.boolean().default(false),
    group: z.string().trim().toUpperCase().max(10).optional().nullable().or(z.literal('').transform(() => null)),
    seats: z.coerce.number().int().min(1).max(5000).optional().nullable(),
  })).max(80).optional(),
  groups: z.array(z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, '1–10 letters or digits'),
    name: optionalText(60),
    minPick: z.coerce.number().int().min(0).max(10).default(1),
    maxPick: z.coerce.number().int().min(1).max(10).default(1),
  })).max(20).optional(),
  requireApproval: z.boolean().optional(),
  closed: z.boolean().optional(),
  notes: optionalText(1000),
})

router.get('/windows', requirePermission(...VIEW_ANY), async (req, res) => {
  const q = z.object({ academicYearId: objectId.optional(), programId: objectId.optional() }).parse(req.query)
  res.json({ data: await listWindows(req.auth, q) })
})
router.post('/windows', requirePermission('registration.windows.create'), async (req, res) => {
  res.status(201).json({ data: await saveWindow(null, windowSchema.parse(req.body), req.auth, req) })
})
router.get('/windows/:id', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await getWindow(id(req), req.auth) })
})
router.delete('/windows/:id', requirePermission('registration.windows.delete'), async (req, res) => {
  res.json({ data: await deleteWindow(id(req), req.auth, req) })
})
router.patch('/windows/:id', requirePermission('registration.windows.edit'), async (req, res) => {
  res.json({ data: await saveWindow(id(req), windowSchema.omit({ programId: true, academicYearId: true }).partial().parse(req.body), req.auth, req) })
})

// rosters
router.get('/windows/:id/rosters', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await windowRosters(id(req), req.auth) })
})
router.get('/windows/:id/rosters/:courseId', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await courseRoster(id(req), objectId.parse(req.params.courseId), req.auth) })
})

// ───────────────────────────────────────────────────────── registrations

router.get('/windows/:id/registrations', requirePermission('registration.requests.view'), async (req, res) => {
  const { status } = z.object({ status: z.enum([...Object.keys(REG_STATUS), 'NOT_REGISTERED']).optional() }).parse(req.query)
  res.json({ data: await listRegistrations(id(req), req.auth, { status }) })
})
router.get('/windows/:id/students/:studentId', requirePermission('registration.requests.view'), async (req, res) => {
  res.json({ data: await registrationForm(id(req), objectId.parse(req.params.studentId), req.auth) })
})
router.put('/windows/:id/students/:studentId', requirePermission(...ENTER), async (req, res) => {
  const { courseIds } = z.object({ courseIds: z.array(objectId).max(40) }).parse(req.body)
  res.json({ data: await saveRegistration(id(req), { studentId: objectId.parse(req.params.studentId), courseIds }, req.auth, req) })
})
router.post('/decide', requirePermission('registration.requests.approve'), async (req, res) => {
  const { ids, ...input } = z.object({
    ids: z.array(objectId).min(1).max(500),
    action: z.enum(['APPROVE', 'REJECT']),
    note: optionalText(500),
  }).parse(req.body)
  res.json({ data: await decideRegistrations(ids, input, req.auth, req) })
})

export default router
