import { Router } from 'express'
import { PARKING_AREA_FOR, PARKING_OWNERS, PARKING_PARKERS, PARKING_VEHICLE_KINDS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  deleteArea, deleteVehicle, findPeople, gateScanCode, parkingMeta, gateDesk, gateLookup, getVehicle, listAreas, listEntries, listVehicles, markIn, markOut,
  registerVehicle, renewVehicle, revokeVehicle, saveArea, updateVehicle,
} from '../services/parking.js'

// parking: /api/v1/parking/*  — areas, vehicles & passes, the gate
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('parking'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const values = (list) => list.map((x) => x.value)
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const optMobile = z.string().trim().regex(/^[+\d][\d\s-]{6,16}$/, 'Enter a valid mobile number').optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 100)) }
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true')
const kind = z.enum(values(PARKING_VEHICLE_KINDS))
const plate = z.string().trim().min(1, 'Enter the number plate').max(20)

// ───────────────────────────────────────────────────────── areas

router.get('/meta', requirePermission('parking.areas.view', 'parking.gate.view', 'parking.vehicles.view'), async (req, res) => {
  res.json({ data: await parkingMeta(req.auth) })
})

router.get('/areas', requirePermission('parking.areas.view', 'parking.gate.view', 'parking.vehicles.view'), async (req, res) => {
  const { all } = z.object({ all: flag }).parse(req.query)
  res.json({ data: await listAreas(req.auth, { all }) })
})
const areaSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(60),
  for: z.enum(values(PARKING_AREA_FOR)).default('ANY'),
  kinds: z.array(kind).max(4).default([]),
  capacity: z.coerce.number().int().min(0).max(5000).default(0),
  note: optionalText(200),
  active: z.boolean().default(true),
  branchId: optId,
})
router.post('/areas', requirePermission('parking.areas.create'), async (req, res) => {
  res.status(201).json({ data: await saveArea(null, areaSchema.parse(req.body), req.auth, req) })
})
router.put('/areas/:id', requirePermission('parking.areas.edit'), async (req, res) => {
  res.json({ data: await saveArea(id(req), areaSchema.parse(req.body), req.auth, req) })
})
router.delete('/areas/:id', requirePermission('parking.areas.delete'), async (req, res) => {
  res.json({ data: await deleteArea(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── vehicles & passes

router.get('/people', requirePermission('parking.vehicles.create', 'parking.vehicles.edit'), async (req, res) => {
  const q = z.object({ kind: z.enum(['STAFF', 'STUDENT']), search: z.string().max(60).optional() }).parse(req.query)
  res.json({ data: await findPeople(q.kind, q.search, req.auth) })
})
router.get('/vehicles', requirePermission('parking.vehicles.view'), async (req, res) => {
  const q = z.object({
    state: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']).optional(), ownerKind: z.enum(values(PARKING_OWNERS)).optional(), kind: kind.optional(),
    areaId: optId, search: z.string().max(60).optional(), ...paging,
  }).parse(req.query)
  res.json({ data: await listVehicles(q, req.auth) })
})
router.get('/vehicles/:id', requirePermission('parking.vehicles.view', 'parking.gate.view'), async (req, res) => {
  res.json({ data: await getVehicle(id(req), req.auth) })
})
const vehicleSchema = z.object({
  ownerKind: z.enum(values(PARKING_OWNERS)),
  employeeId: optId,
  studentId: optId,
  ownerName: optionalText(100),
  ownerMobile: optMobile,
  relation: optionalText(30),
  plate,
  kind,
  model: optionalText(60),
  colour: optionalText(30),
  licenceNo: optionalText(30),
  areaId: optId,
  validTo: ymd.optional().or(z.literal('').transform(() => undefined)),
  note: optionalText(300),
})
router.post('/vehicles', requirePermission('parking.vehicles.create'), async (req, res) => {
  res.status(201).json({ data: await registerVehicle(vehicleSchema.parse(req.body), req.auth, req) })
})
router.put('/vehicles/:id', requirePermission('parking.vehicles.edit'), async (req, res) => {
  res.json({ data: await updateVehicle(id(req), vehicleSchema.parse(req.body), req.auth, req) })
})
router.post('/vehicles/:id/renew', requirePermission('parking.vehicles.edit'), async (req, res) => {
  res.json({ data: await renewVehicle(id(req), req.auth, req) })
})
router.post('/vehicles/:id/revoke', requirePermission('parking.vehicles.edit'), async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(3, 'Say why the pass is cancelled').max(200) }).parse(req.body ?? {})
  res.json({ data: await revokeVehicle(id(req), body, req.auth, req) })
})
router.delete('/vehicles/:id', requirePermission('parking.vehicles.delete'), async (req, res) => {
  res.json({ data: await deleteVehicle(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── the gate

router.get('/gate', requirePermission('parking.gate.view'), async (req, res) => {
  res.json({ data: await gateDesk(req.auth) })
})
router.get('/gate/lookup', requirePermission('parking.gate.view'), async (req, res) => {
  const { q } = z.object({ q: z.string().max(40) }).parse(req.query)
  res.json({ data: await gateLookup(q, req.auth) })
})
router.get('/gate/log', requirePermission('parking.gate.view'), async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional(), parker: z.enum(values(PARKING_PARKERS)).optional(), areaId: optId, search: z.string().max(60).optional(), ...paging }).parse(req.query)
  res.json({ data: await listEntries(q, req.auth) })
})
const inSchema = z.object({
  vehicleId: optId,
  plate: plate.optional(),
  kind: kind.default('CAR'),
  name: optionalText(100),
  mobile: optMobile,
  purpose: optionalText(120),
  areaId: optId,
  overFull: z.boolean().optional(),
  note: optionalText(200),
})
router.post('/gate/in', requirePermission('parking.gate.create'), async (req, res) => {
  res.status(201).json({ data: await markIn(inSchema.parse(req.body), req.auth, req) })
})
router.post('/gate/scan', requirePermission('parking.gate.create'), async (req, res) => {
  const body = z.object({ code: z.string().trim().min(1).max(80), direction: z.enum(['IN', 'OUT', 'AUTO']).default('AUTO') }).parse(req.body ?? {})
  res.json({ data: await gateScanCode(body, req.auth, req) })
})
router.post('/gate/:id/out', requirePermission('parking.gate.create'), async (req, res) => {
  res.json({ data: await markOut(id(req), req.auth, req) })
})

export default router
