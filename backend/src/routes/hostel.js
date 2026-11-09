import { Router } from 'express'
import { BED_MANUAL_STATES, BLOCK_KINDS, CHECKOUT_REASONS, MEALS, MESS_DAYS, OUTPASS_KINDS, OUTPASS_STATUS, ROOM_TYPES } from '@schoolgiant/shared'
import { can } from '../platform/access.js'
import { badRequest } from '../platform/errors.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  addRooms, allot, board, cancelOutpass, checkout, clearMenu, createOutpass, decideOutpass, deleteBlock, deleteRoom, gateOutpass, listAllotments, listBlocks,
  listOutpasses, messView, moveAllotment, saveBlock, saveMealCount, saveMenu, saveRoom, setBedState, staffLogins, studentHistory,
} from '../services/hostel.js'

// hostel: /api/v1/hostel — blocks, rooms and beds (the bed board), allotment, outpasses and the mess.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('hostel'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const blank = (schema) => schema.optional().nullable().or(z.literal('').transform(() => undefined))
const mobile = z.string().trim().max(20).optional().or(z.literal('').transform(() => undefined))
// the screens send back what they were given: empty fields come as null
const dropNulls = (schema) => z.preprocess((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) : o), schema)

const blockBody = dropNulls(z.object({
  name: z.string().trim().min(1, 'Name the block').max(80),
  code: optionalText(10),
  kind: z.enum(BLOCK_KINDS.map((k) => k.value)).default('BOYS'),
  floors: z.coerce.number().int().min(1).max(40).default(1),
  warden: dropNulls(z.object({ name: optionalText(120), mobile, userId: blank(objectId) })).default({}),
  notes: optionalText(1000),
  active: z.boolean().optional(),
}))
const roomBody = dropNulls(z.object({
  blockId: objectId.optional(),
  floor: z.coerce.number().int().min(0).max(40).default(0),
  number: z.string().trim().min(1, 'Number the room').max(20),
  type: z.enum(ROOM_TYPES.map((r) => r.value)).default('DOUBLE'),
  ac: z.boolean().default(false),
  capacity: z.coerce.number().int().min(1, 'At least one bed').max(40),
  fee: z.coerce.number().int().min(0).optional(),
  notes: optionalText(500),
}))
const roomsBody = z.object({
  blockId: objectId,
  floor: z.coerce.number().int().min(0).max(40),
  from: z.coerce.number().int().min(0).max(99999), to: z.coerce.number().int().min(0).max(99999),
  prefix: optionalText(6),
  type: z.enum(ROOM_TYPES.map((r) => r.value)).default('DOUBLE'),
  ac: z.boolean().default(false),
  capacity: z.coerce.number().int().min(1).max(40),
  fee: z.coerce.number().int().min(0).optional().nullable(),
})
const outpassBody = z.object({
  studentId: objectId,
  kind: z.enum(OUTPASS_KINDS.map((k) => k.value)).default('DAY'),
  leaveDate: ymd, leaveTime: hhmm, returnDate: ymd, returnTime: hhmm,
  reason: z.string().trim().min(3, 'Give a reason').max(300),
  destination: optionalText(200),
  escort: z.object({ name: optionalText(120), relation: optionalText(30), mobile }).optional(),
  note: optionalText(500),
  approve: z.boolean().optional(),
})

// ── the bed board, blocks, rooms and beds
const anyHostel = ['hostel.rooms.view', 'hostel.allotment.view', 'hostel.outpass.view', 'hostel.mess.view']
router.get('/board', requirePermission('hostel.rooms.view', 'hostel.allotment.view'), async (req, res) => { res.json({ data: await board(req.auth) }) })
router.get('/blocks', requirePermission(...anyHostel), async (req, res) => { res.json({ data: await listBlocks(req.auth) }) })
router.post('/blocks', requirePermission('hostel.rooms.create'), async (req, res) => { res.status(201).json({ data: await saveBlock(null, blockBody.parse(req.body), req.auth, req) }) })
router.patch('/blocks/:id', requirePermission('hostel.rooms.edit'), async (req, res) => { res.json({ data: await saveBlock(id(req), blockBody.parse(req.body), req.auth, req) }) })
router.delete('/blocks/:id', requirePermission('hostel.rooms.delete'), async (req, res) => { res.json({ data: await deleteBlock(id(req), req.auth, req) }) })
router.get('/staff', requirePermission('hostel.rooms.create', 'hostel.rooms.edit'), async (req, res) => { res.json({ data: await staffLogins() }) })

router.post('/rooms', requirePermission('hostel.rooms.create'), async (req, res) => {
  const body = roomBody.parse(req.body)
  if (!body.blockId) throw badRequest('Pick a block', { fields: { blockId: 'Pick a block' } })
  res.status(201).json({ data: await saveRoom(null, body, req.auth, req) })
})
router.post('/rooms/bulk', requirePermission('hostel.rooms.create'), async (req, res) => { res.status(201).json({ data: await addRooms(roomsBody.parse(req.body), req.auth, req) }) })
router.patch('/rooms/:id', requirePermission('hostel.rooms.edit'), async (req, res) => { res.json({ data: await saveRoom(id(req), roomBody.parse(req.body), req.auth, req) }) })
router.delete('/rooms/:id', requirePermission('hostel.rooms.delete'), async (req, res) => { res.json({ data: await deleteRoom(id(req), req.auth, req) }) })
router.post('/rooms/:id/beds/:bedId/state', requirePermission('hostel.rooms.edit', 'hostel.allotment.allot'), async (req, res) => {
  const body = z.object({ state: z.enum(BED_MANUAL_STATES), note: optionalText(200) }).parse(req.body)
  res.json({ data: await setBedState(id(req), objectId.parse(req.params.bedId), body, req.auth, req) })
})

// ── allotment
router.get('/allotments', requirePermission('hostel.allotment.view'), async (req, res) => {
  const q = z.object({ blockId: objectId.optional(), search: z.string().max(80).optional(), history: z.enum(['0', '1']).optional() }).parse(req.query)
  res.json({ data: await listAllotments({ ...q, history: q.history === '1' }, req.auth) })
})
router.get('/students/:id/history', requirePermission('hostel.allotment.view'), async (req, res) => { res.json({ data: await studentHistory(id(req), req.auth) }) })
router.post('/allotments', requirePermission('hostel.allotment.allot'), async (req, res) => {
  const body = z.object({ studentId: objectId, bedId: objectId, from: ymd.optional(), note: optionalText(300) }).parse(req.body)
  res.status(201).json({ data: await allot(body, req.auth, req) })
})
router.post('/allotments/:id/move', requirePermission('hostel.allotment.allot'), async (req, res) => {
  const body = z.object({ bedId: objectId, from: ymd.optional(), note: optionalText(300) }).parse(req.body)
  res.json({ data: await moveAllotment(id(req), body, req.auth, req) })
})
router.post('/allotments/:id/checkout', requirePermission('hostel.allotment.checkout'), async (req, res) => {
  const body = z.object({ to: ymd.optional(), reason: z.enum(CHECKOUT_REASONS.map((r) => r.value)).default('LEFT_HOSTEL'), note: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await checkout(id(req), body, req.auth, req) })
})

// ── outpasses
router.get('/outpasses', requirePermission('hostel.outpass.view'), async (req, res) => {
  const q = z.object({
    view: z.enum(['OPEN', 'ALL']).default('OPEN'), status: z.enum(Object.keys(OUTPASS_STATUS)).optional(), blockId: objectId.optional(),
    search: z.string().max(80).optional(), from: ymd.optional(), to: ymd.optional(),
    // the ALL list comes a page at a time (50 rows by default, at most 100); the OPEN board ignores these
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query)
  res.json({ data: await listOutpasses(q, req.auth) })
})
router.post('/outpasses', requirePermission('hostel.outpass.create'), async (req, res) => {
  const body = outpassBody.parse(req.body)
  // approving while asking needs the approve permission too
  if (body.approve && !can(req.auth, 'hostel.outpass.approve')) body.approve = false
  res.status(201).json({ data: await createOutpass(body, req.auth, req) })
})
router.post('/outpasses/:id/decide', requirePermission('hostel.outpass.approve'), async (req, res) => {
  res.json({ data: await decideOutpass(id(req), z.object({ approve: z.boolean(), note: optionalText(300) }).parse(req.body), req.auth, req) })
})
router.post('/outpasses/:id/out', requirePermission('hostel.outpass.create', 'hostel.outpass.approve'), async (req, res) => { res.json({ data: await gateOutpass(id(req), 'OUT', req.auth, req) }) })
router.post('/outpasses/:id/in', requirePermission('hostel.outpass.create', 'hostel.outpass.approve'), async (req, res) => { res.json({ data: await gateOutpass(id(req), 'IN', req.auth, req) }) })
router.post('/outpasses/:id/cancel', requirePermission('hostel.outpass.create', 'hostel.outpass.approve'), async (req, res) => {
  res.json({ data: await cancelOutpass(id(req), z.object({ note: optionalText(300) }).parse(req.body ?? {}), req.auth, req) })
})

// ── mess
router.get('/mess', requirePermission('hostel.mess.view'), async (req, res) => {
  res.json({ data: await messView(z.object({ blockId: objectId.optional(), date: ymd.optional() }).parse(req.query), req.auth) })
})
router.put('/mess/menu', requirePermission('hostel.mess.edit'), async (req, res) => {
  const body = z.object({
    blockId: objectId.optional().nullable(),
    items: z.array(z.object({ day: z.enum(MESS_DAYS), meal: z.enum(MEALS.map((m) => m.value)), dishes: z.string().trim().max(300).default('') })).max(MESS_DAYS.length * MEALS.length),
  }).parse(req.body)
  res.json({ data: await saveMenu(body, req.auth, req) })
})
router.delete('/mess/menu/:id', requirePermission('hostel.mess.edit'), async (req, res) => { res.json({ data: await clearMenu(id(req), req.auth, req) }) })
router.put('/mess/counts', requirePermission('hostel.mess.edit'), async (req, res) => {
  const body = z.object({ blockId: objectId.optional().nullable(), date: ymd, meal: z.enum(MEALS.map((m) => m.value)), count: z.coerce.number().int().min(0).max(100000), note: optionalText(200) }).parse(req.body)
  res.json({ data: await saveMealCount(body, req.auth, req) })
})

export default router
