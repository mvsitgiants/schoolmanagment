import { Router } from 'express'
import { RIDE_EVENTS, RIDE_MODES, TRIP_KINDS, VEHICLE_DOCS, VEHICLE_STATUS, VEHICLE_TYPES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { publicBaseUrl } from '../services/integrationsCommon.js'
import {
  assignStudent, board, deleteRoute, deleteVehicle, endAssignment, endTrip, exportAssignments, getRoute, gpsHook, listAssignments, listRoutes, listVehicles, markRide,
  myRoutes, phonePosition, saveRoute, saveVehicle, staffLogins, startTrip, tripDetail, vehicleTrail,
} from '../services/transport.js'

// Transport: /api/v1/transport — vehicles, routes and stops, students on routes, today's trips and live positions.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('transport'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const mobile = z.string().trim().max(20).optional().or(z.literal('').transform(() => undefined))
const lat = z.coerce.number().min(-90).max(90)
const lng = z.coerce.number().min(-180).max(180)
const person = z.object({
  name: optionalText(120), mobile, licenceNo: optionalText(40), licenceExpiry: ymd.optional().or(z.literal('').transform(() => undefined)), userId: objectId.optional().nullable(),
}).default({})

const vehicleBody = z.object({
  regNo: z.string().trim().min(4, 'Enter the registration number').max(20),
  type: z.enum(VEHICLE_TYPES.map((x) => x.value)).default('BUS'),
  capacity: z.coerce.number().int().min(1).max(120).default(40),
  make: optionalText(80),
  gpsDeviceId: z.string().trim().max(60).optional().or(z.literal('')),
  docs: z.array(z.object({ kind: z.enum(VEHICLE_DOCS.map((d) => d.value)), number: optionalText(60), expiry: ymd.optional().or(z.literal('').transform(() => undefined)) })).max(20).default([]),
  driver: person, attendant: person,
  status: z.enum(Object.keys(VEHICLE_STATUS)).default('ACTIVE'),
  notes: optionalText(1000),
})

// the screens send back what they were given: empty fields come as null
const dropNulls = (schema) => z.preprocess((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) : o), schema)
const stopBody = dropNulls(z.object({
  id: z.string().optional(), name: z.string().trim().min(1, 'Name the stop').max(120), lat: lat.optional().nullable(), lng: lng.optional().nullable(),
  pickupTime: hhmm.optional().or(z.literal('')), dropTime: hhmm.optional().or(z.literal('')),
  fee: z.coerce.number().int().min(0).optional().nullable(), landmark: optionalText(200),
}))
const routeBody = dropNulls(z.object({
  name: z.string().trim().min(2, 'Name the route').max(80), code: optionalText(20), vehicleId: objectId.optional().nullable().or(z.literal('')),
  stops: z.array(stopBody).max(80).default([]), active: z.boolean().default(true), notes: optionalText(1000),
}))

const positionBody = z.object({
  lat, lng, speed: z.coerce.number().min(0).max(200).optional().nullable(), heading: z.coerce.number().min(0).max(360).optional().nullable(),
  accuracy: z.coerce.number().min(0).max(100000).optional().nullable(), at: z.string().datetime({ offset: true }).optional(),
})

// ── vehicles
router.get('/vehicles', requirePermission('transport.vehicles.view', 'transport.routes.view', 'transport.tracking.view'), async (req, res) => { res.json({ data: await listVehicles(req.auth) }) })
router.post('/vehicles', requirePermission('transport.vehicles.create'), async (req, res) => { res.status(201).json({ data: await saveVehicle(null, vehicleBody.parse(req.body), req.auth, req) }) })
router.patch('/vehicles/:id', requirePermission('transport.vehicles.edit'), async (req, res) => { res.json({ data: await saveVehicle(id(req), vehicleBody.parse(req.body), req.auth, req) }) })
router.delete('/vehicles/:id', requirePermission('transport.vehicles.delete'), async (req, res) => { res.json({ data: await deleteVehicle(id(req), req.auth, req) }) })
router.get('/vehicles/:id/trail', requirePermission('transport.tracking.view'), async (req, res) => {
  const { hours } = z.object({ hours: z.coerce.number().min(0.25).max(24).default(3) }).parse(req.query)
  res.json({ data: await vehicleTrail(id(req), { hours }) })
})
router.get('/staff', requirePermission('transport.vehicles.edit', 'transport.vehicles.create'), async (req, res) => { res.json({ data: await staffLogins() }) })
router.get('/gps-hook', requirePermission('transport.vehicles.edit', 'transport.vehicles.create'), async (req, res) => { res.json({ data: await gpsHook(publicBaseUrl(req)) }) })

// ── routes and stops
router.get('/routes', requirePermission('transport.routes.view', 'transport.assignments.view', 'transport.tracking.view'), async (req, res) => {
  const { all } = z.object({ all: z.enum(['0', '1']).optional() }).parse(req.query)
  res.json({ data: await listRoutes(req.auth, { all: all === '1' }) })
})
router.get('/routes/:id', requirePermission('transport.routes.view'), async (req, res) => { res.json({ data: await getRoute(id(req), req.auth) }) })
router.post('/routes', requirePermission('transport.routes.create'), async (req, res) => { res.status(201).json({ data: await saveRoute(null, routeBody.parse(req.body), req.auth, req) }) })
router.patch('/routes/:id', requirePermission('transport.routes.edit'), async (req, res) => { res.json({ data: await saveRoute(id(req), routeBody.parse(req.body), req.auth, req) }) })
router.delete('/routes/:id', requirePermission('transport.routes.delete'), async (req, res) => { res.json({ data: await deleteRoute(id(req), req.auth, req) }) })

// ── students on routes
const assignQuery = z.object({ routeId: objectId.optional(), search: z.string().max(80).optional() })
router.get('/assignments', requirePermission('transport.assignments.view'), async (req, res) => { res.json({ data: await listAssignments(assignQuery.parse(req.query), req.auth) }) })
router.get('/assignments/export', requirePermission('transport.assignments.export'), async (req, res) => {
  const body = await exportAssignments(assignQuery.parse(req.query), req.auth)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="transport-students.csv"')
  res.send(`﻿${body}`)
})
router.post('/assignments', requirePermission('transport.assignments.create', 'transport.assignments.edit'), async (req, res) => {
  const body = z.object({ studentId: objectId, routeId: objectId, stopId: objectId, mode: z.enum(RIDE_MODES.map((m) => m.value)).default('BOTH'), from: ymd.optional(), note: optionalText(300) }).parse(req.body)
  res.status(201).json({ data: await assignStudent(body, req.auth, req) })
})
router.post('/assignments/:id/end', requirePermission('transport.assignments.edit'), async (req, res) => {
  res.json({ data: await endAssignment(id(req), z.object({ to: ymd.optional() }).parse(req.body ?? {}), req.auth, req) })
})

// ── today's trips (the transport office, and the driver / attendant on their phone)
router.get('/board', requirePermission('transport.tracking.view'), async (req, res) => {
  const { date } = z.object({ date: ymd.optional() }).parse(req.query)
  res.json({ data: await board(req.auth, { date }) })
})
router.get('/my-routes', requirePermission('transport.tracking.track'), async (req, res) => { res.json({ data: await myRoutes(req.auth) }) })
router.post('/trips', requirePermission('transport.tracking.track'), async (req, res) => {
  res.json({ data: await startTrip(z.object({ routeId: objectId, kind: z.enum(Object.keys(TRIP_KINDS)) }).parse(req.body), req.auth, req) })
})
router.get('/trips/:id', requirePermission('transport.tracking.view', 'transport.tracking.track'), async (req, res) => { res.json({ data: await tripDetail(id(req)) }) })
router.post('/trips/:id/end', requirePermission('transport.tracking.track'), async (req, res) => { res.json({ data: await endTrip(id(req), req.auth, req) }) })
router.post('/trips/:id/position', requirePermission('transport.tracking.track'), async (req, res) => { res.json({ data: await phonePosition(id(req), positionBody.parse(req.body)) }) })
router.post('/trips/:id/rides', requirePermission('transport.tracking.track'), async (req, res) => {
  res.json({ data: await markRide(id(req), z.object({ studentId: objectId, event: z.enum(Object.keys(RIDE_EVENTS)) }).parse(req.body), req.auth, req) })
})

export default router
