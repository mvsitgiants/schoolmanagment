import { Router } from 'express'
import { SEAT_FILL, SEAT_MIX, SEATING_KINDS, SEATING_LIMITS, SEAT_NUMBERING } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import {
  autoInvigilators, deletePlan, generateAll, generateSession, getSession, listSessions, markHallAttendance, moveSeats, myDuties, publishPlan, setInvigilators, unlockSeats,
} from '../services/examSeating.js'

// Exam seating & invigilation: /api/v1/exams/seating/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('exams'))

const VIEW = 'exams.seating.view'
const EDIT = ['exams.seating.create', 'exams.seating.edit']
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const hhmm = z.string().regex(/^\d{2}:\d{2}$/)
const rules = z.object({
  mix: z.enum(Object.keys(SEAT_MIX)).optional(),
  gap: z.boolean().optional(),
  spread: z.boolean().optional(),
  fill: z.enum(Object.keys(SEAT_FILL)).optional(),
  perInvigilator: z.coerce.number().int().min(5).max(200).optional(),
  maxInvigilators: z.coerce.number().int().min(1).max(6).optional(),
}).partial()
const layout = z.object({
  kind: z.enum(Object.keys(SEATING_KINDS)),
  perBench: z.coerce.number().int().min(SEATING_LIMITS.perBench[0]).max(SEATING_LIMITS.perBench[1]).optional(),
  columns: z.coerce.number().int().min(SEATING_LIMITS.columns[0]).max(SEATING_LIMITS.columns[1]),
  rows: z.coerce.number().int().min(SEATING_LIMITS.rows[0]).max(SEATING_LIMITS.rows[1]),
  numbering: z.enum(Object.keys(SEAT_NUMBERING)).default('ROW'),
})
const generate = z.object({
  date: ymd, startTime: hhmm,
  roomIds: z.array(objectId).max(60).optional(),
  rooms: z.array(z.object({ roomId: objectId, layout: layout.nullable().optional() })).max(60).optional(),
  rules: rules.optional(),
  keepLocked: z.boolean().optional(),
})

router.get('/mine', requirePermission(VIEW), async (req, res) => {
  res.json({ data: await myDuties(req.auth) })
})
router.get('/exams/:examId', requirePermission(VIEW), async (req, res) => {
  res.json({ data: await listSessions(req.params.examId) })
})
router.get('/exams/:examId/session', requirePermission(VIEW), async (req, res) => {
  const q = z.object({ date: ymd, startTime: hhmm }).parse(req.query)
  res.json({ data: await getSession(req.params.examId, q, req.auth) })
})
router.post('/exams/:examId/generate', requirePermission(...EDIT), async (req, res) => {
  res.json({ data: await generateSession(req.params.examId, generate.parse(req.body), req.auth, req) })
})
router.post('/exams/:examId/generate-all', requirePermission(...EDIT), async (req, res) => {
  res.json({ data: await generateAll(req.params.examId, generate.omit({ date: true, startTime: true }).parse(req.body), req.auth, req) })
})
router.post('/plans/:id/moves', requirePermission(...EDIT), async (req, res) => {
  const { moves } = z.object({ moves: z.array(z.object({ studentId: objectId, roomId: objectId, seat: z.string().trim().min(1).max(10) })).min(1).max(400) }).parse(req.body)
  res.json({ data: await moveSeats(req.params.id, moves, req.auth, req) })
})
router.post('/plans/:id/unlock', requirePermission(...EDIT), async (req, res) => {
  const body = z.object({ all: z.boolean().optional(), seats: z.array(z.object({ roomId: objectId, seat: z.string() })).optional() }).parse(req.body)
  res.json({ data: await unlockSeats(req.params.id, body, req.auth) })
})
router.put('/plans/:id/invigilators', requirePermission(...EDIT), async (req, res) => {
  const body = z.object({ roomId: objectId, teacherIds: z.array(objectId).max(6).default([]), auto: z.boolean().optional() }).parse(req.body)
  res.json({ data: await setInvigilators(req.params.id, body, req.auth, req) })
})
router.post('/plans/:id/invigilators/auto', requirePermission(...EDIT), async (req, res) => {
  res.json({ data: await autoInvigilators(req.params.id, req.auth, req) })
})
router.put('/plans/:id/attendance', requirePermission(VIEW), async (req, res) => {
  const body = z.object({ roomId: objectId, absent: z.array(objectId).max(500).default([]) }).parse(req.body)
  res.json({ data: await markHallAttendance(req.params.id, body, req.auth, req) })
})
router.post('/plans/:id/publish', requirePermission('exams.seating.publish'), async (req, res) => {
  res.json({ data: await publishPlan(req.params.id, true, req.auth, req) })
})
router.post('/plans/:id/unpublish', requirePermission('exams.seating.publish'), async (req, res) => {
  res.json({ data: await publishPlan(req.params.id, false, req.auth, req) })
})
router.delete('/plans/:id', requirePermission('exams.seating.delete'), async (req, res) => {
  res.json({ data: await deletePlan(req.params.id, req) })
})

export default router
