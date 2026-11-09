import { Router } from 'express'
import { MARK_VALUES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  applyLeave, attendanceReport, cancelLeave, decideLeave, getSheet, listLeave, monthRegister, saveSheet, subjectReport, todayBoard,
} from '../services/attendance.js'

// Student attendance: /api/v1/attendance/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('attendance'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const period = z.coerce.number().int().min(0).max(12).default(0)

/** The sections the caller may mark and whether today's (or `date`'s) attendance is taken. */
router.get('/board', requirePermission('attendance.mark.view', 'attendance.register.view'), async (req, res) => {
  const { date } = z.object({ date: ymd.optional() }).parse(req.query)
  res.json({ data: await todayBoard(req.auth, { date }) })
})

router.get('/sheet', requirePermission('attendance.mark.view'), async (req, res) => {
  const q = z.object({ sectionId: objectId, date: ymd.optional(), period }).parse(req.query)
  res.json({ data: await getSheet(q, req.auth) })
})

router.put('/sheet', requirePermission('attendance.mark.create', 'attendance.mark.edit'), async (req, res) => {
  const input = z.object({
    sectionId: objectId, date: ymd, period, subjectId: objectId.optional().nullable(),
    entries: z.array(z.object({ studentId: objectId, status: z.enum(MARK_VALUES), note: optionalText(120) })).max(300),
  }).parse(req.body)
  res.json({ data: await saveSheet(input, req.auth, req) })
})

router.get('/register', requirePermission('attendance.register.view'), async (req, res) => {
  const q = z.object({ sectionId: objectId, subjectId: objectId.optional(), month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM') }).parse(req.query)
  res.json({ data: await monthRegister(q, req.auth) })
})

router.get('/reports', requirePermission('attendance.reports.view'), async (req, res) => {
  const q = z.object({ from: ymd, to: ymd, sectionId: objectId.optional() }).parse(req.query)
  res.json({ data: await attendanceReport(q, req.auth) })
})
router.get('/subject-report', requirePermission('attendance.reports.view'), async (req, res) => {
  const q = z.object({ from: ymd, to: ymd, sectionId: objectId }).parse(req.query)
  res.json({ data: await subjectReport(q, req.auth) })
})

// ───────────────────────────────────────────────────────── student leave

router.get('/leave', requirePermission('attendance.leave.view'), async (req, res) => {
  const q = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), sectionId: objectId.optional(), search: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query)
  res.json({ data: await listLeave(q, req.auth) })
})
router.post('/leave', requirePermission('attendance.leave.view'), async (req, res) => {
  const input = z.object({ studentId: objectId, from: ymd, to: ymd, reason: z.string().trim().min(3, 'Give a reason').max(300) }).parse(req.body)
  res.status(201).json({ data: await applyLeave(input, req.auth, req) })
})
router.post('/leave/:id/decide', requirePermission('attendance.leave.approve'), async (req, res) => {
  const input = z.object({ approve: z.boolean(), note: optionalText(200) }).parse(req.body)
  res.json({ data: await decideLeave(objectId.parse(req.params.id), input, req.auth, req) })
})
router.post('/leave/:id/cancel', requirePermission('attendance.leave.view'), async (req, res) => {
  res.json({ data: await cancelLeave(objectId.parse(req.params.id), req.auth, req) })
})

export default router
