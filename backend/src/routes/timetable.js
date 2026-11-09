import { Router } from 'express'
import { ROOM_KINDS, SLOT_KINDS, WEEK_DAYS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  awayOn, createSubstitution, deleteBell, deleteRoom, deleteSubstitution, generate, grid, listBells, listRooms, listSubstitutions, lockSection, myWeek,
  overview, publish, roomBoard, saveBell, saveRoom, saveRules, setCell, startDraft, substitutionNeeds, teacherLoad, teachers,
} from '../services/timetable.js'

// Timetable: /api/v1/timetable/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('timetable'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const day = z.enum(WEEK_DAYS)
const period = z.coerce.number().int().min(1).max(15)
const VIEW = 'timetable.timetable.view'
const EDIT = 'timetable.timetable.edit'
const ANY = [VIEW, 'timetable.substitutions.view', 'timetable.rooms.view']

router.get('/teachers', requirePermission(...ANY), async (req, res) => {
  res.json({ data: await teachers(req.query.yearId) })
})
router.get('/mine', requirePermission(VIEW), async (req, res) => {
  res.json({ data: await myWeek(req.auth) })
})

// ───────────────────────────────────────────────────────── bell schedules

const bellSchema = z.object({
  name: z.string().trim().min(2, 'Name the schedule').max(80),
  slots: z.array(z.object({
    no: z.coerce.number().int().min(0).max(15).default(0),
    kind: z.enum(Object.keys(SLOT_KINDS)).default('PERIOD'),
    label: optionalText(40), start: hhmm, end: hhmm,
  })).min(1).max(20),
  classIds: z.array(objectId).max(100).default([]),
  isDefault: z.boolean().default(false),
})
router.get('/bells', requirePermission(...ANY), async (req, res) => {
  res.json({ data: await listBells() })
})
router.post('/bells', requirePermission(EDIT), async (req, res) => {
  res.status(201).json({ data: await saveBell(null, bellSchema.parse(req.body), req) })
})
router.put('/bells/:id', requirePermission(EDIT), async (req, res) => {
  res.json({ data: await saveBell(id(req), bellSchema.parse(req.body), req) })
})
router.delete('/bells/:id', requirePermission(EDIT), async (req, res) => {
  res.json({ data: await deleteBell(id(req), req) })
})

// ───────────────────────────────────────────────────────── rooms

const roomSchema = z.object({
  name: z.string().trim().min(1, 'Name the room').max(80),
  code: optionalText(12),
  kind: z.enum(ROOM_KINDS.map((k) => k.value)).default('CLASSROOM'),
  capacity: z.coerce.number().int().min(0).max(5000).optional().or(z.literal('').transform(() => undefined)),
  sectionId: objectId.optional().or(z.literal('').transform(() => undefined)).nullable(),
  active: z.boolean().default(true),
})
router.get('/rooms/board', requirePermission('timetable.rooms.view', EDIT), async (req, res) => {
  res.json({ data: await roomBoard({ at: typeof req.query.at === 'string' ? req.query.at : undefined }) })
})
router.get('/rooms', requirePermission('timetable.rooms.view', EDIT), async (req, res) => {
  res.json({ data: await listRooms() })
})
router.post('/rooms', requirePermission('timetable.rooms.create'), async (req, res) => {
  res.status(201).json({ data: await saveRoom(null, roomSchema.parse(req.body), req) })
})
router.put('/rooms/:id', requirePermission('timetable.rooms.edit'), async (req, res) => {
  res.json({ data: await saveRoom(id(req), roomSchema.parse(req.body), req) })
})
router.delete('/rooms/:id', requirePermission('timetable.rooms.delete'), async (req, res) => {
  res.json({ data: await deleteRoom(id(req), req) })
})

// ───────────────────────────────────────────────────────── versions & the grid

router.get('/', requirePermission(VIEW), async (req, res) => {
  res.json({ data: await overview(req.query.yearId) })
})
router.post('/draft', requirePermission(EDIT), async (req, res) => {
  const { yearId } = z.object({ yearId: objectId.optional() }).parse(req.body ?? {})
  res.status(201).json({ data: await startDraft(yearId, req.auth, req) })
})
router.put('/:id/rules', requirePermission(EDIT), async (req, res) => {
  const input = z.object({
    rules: z.object({ maxSamePerDay: z.coerce.number().int().min(1).max(4).optional(), teacherMaxPerDay: z.coerce.number().int().min(1).max(12).optional() }).optional(),
    blocked: z.array(z.object({ teacherId: objectId, day, period })).max(2000).optional(),
    note: optionalText(500),
  }).parse(req.body)
  res.json({ data: await saveRules(id(req), input, req) })
})
router.post('/:id/generate', requirePermission(EDIT), async (req, res) => {
  const { seed } = z.object({ seed: z.coerce.number().int().min(1).max(1e9).optional() }).parse(req.body ?? {})
  res.json({ data: await generate(id(req), { seed }, req.auth, req) })
})
router.get('/:id/grid', requirePermission(VIEW), async (req, res) => {
  const q = z.object({ view: z.enum(['section', 'teacher', 'room']).default('section'), of: objectId }).parse(req.query)
  res.json({ data: await grid(id(req), q, req.auth) })
})
router.get('/:id/load', requirePermission(VIEW), async (req, res) => {
  res.json({ data: await teacherLoad(id(req)) })
})
router.put('/:id/cell', requirePermission(EDIT), async (req, res) => {
  const input = z.object({
    sectionId: objectId, day, period,
    subjectId: objectId.optional().nullable(), teacherId: objectId.optional().nullable(), roomId: objectId.optional().nullable(),
    locked: z.boolean().default(true), clear: z.boolean().default(false),
  }).parse(req.body)
  res.json({ data: await setCell(id(req), input, req.auth, req) })
})
router.post('/:id/lock', requirePermission(EDIT), async (req, res) => {
  const { sectionId, locked } = z.object({ sectionId: objectId, locked: z.boolean() }).parse(req.body)
  res.json({ data: await lockSection(id(req), sectionId, locked, req) })
})
router.post('/:id/publish', requirePermission('timetable.timetable.publish'), async (req, res) => {
  const { effectiveFrom } = z.object({ effectiveFrom: ymd.optional() }).parse(req.body ?? {})
  res.json({ data: await publish(id(req), { effectiveFrom }, req.auth, req) })
})

// ───────────────────────────────────────────────────────── substitutions

router.get('/substitutions', requirePermission('timetable.substitutions.view'), async (req, res) => {
  const { date } = z.object({ date: ymd }).parse(req.query)
  res.json({ data: await listSubstitutions(date) })
})
router.get('/substitutions/away', requirePermission('timetable.substitutions.view'), async (req, res) => {
  const { date } = z.object({ date: ymd }).parse(req.query)
  res.json({ data: await awayOn(date, req.auth) })
})
router.post('/substitutions/needs', requirePermission('timetable.substitutions.view'), async (req, res) => {
  const { date, absentIds } = z.object({ date: ymd, absentIds: z.array(objectId).min(1).max(50) }).parse(req.body)
  res.json({ data: await substitutionNeeds(date, absentIds) })
})
router.post('/substitutions', requirePermission('timetable.substitutions.create'), async (req, res) => {
  const input = z.object({ date: ymd, sectionId: objectId, period, substituteId: objectId, note: optionalText(200) }).parse(req.body)
  res.status(201).json({ data: await createSubstitution(input, req.auth, req) })
})
router.delete('/substitutions/:id', requirePermission('timetable.substitutions.create'), async (req, res) => {
  res.json({ data: await deleteSubstitution(id(req), req) })
})

export default router
