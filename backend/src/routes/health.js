import { Router } from 'express'
import { COMPLAINTS, HEALTH_BLOOD_GROUPS, INCIDENT_KINDS, INCIDENT_SEVERITY, INCIDENT_STATUS, INFORMED_HOW, PERSON_TYPES, VISIT_OUTCOMES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  createIncident, createVisit, deleteMeasurement, getRecord, healthBrief, listIncidents, listRecords, listVisits, resolveIncident, saveRecord, staffLogins,
  updateIncident, updateVisit, visitBoard,
} from '../services/health.js'

// health: /api/v1/health — health records, sick-room visits and incident reports.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('health'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const optYmd = ymd.optional().nullable().or(z.literal('').transform(() => undefined))
const optNum = (min, max) => z.coerce.number().min(min).max(max).optional().nullable()
const list = (max, len = 120) => z.array(z.string().trim().min(1).max(len)).max(max)

const recordBody = z.object({
  bloodGroup: z.enum(HEALTH_BLOOD_GROUPS).optional().nullable().or(z.literal('').transform(() => null)),
  allergies: list(30).optional(),
  vaccinations: z.array(z.object({ name: z.string().trim().min(1, 'Name the vaccine').max(80), date: optYmd, dose: optionalText(30), note: optionalText(200) })).max(60).optional(),
  doctor: z.object({ name: optionalText(120), phone: optionalText(20), hospital: optionalText(120) }).optional().nullable(),
  conditions: list(30, 200).optional(),
  medications: z.array(z.object({ name: z.string().trim().min(1).max(120), dose: optionalText(60), schedule: optionalText(120) })).max(30).optional(),
  emergencyNotes: optionalText(2000).nullable(),
  measurement: z.object({ date: optYmd, heightCm: optNum(30, 250), weightKg: optNum(2, 250) }).refine((m) => m.heightCm || m.weightKg, 'Enter a height or a weight').optional(),
})

const person = {
  personType: z.enum(PERSON_TYPES).default('STUDENT'),
  studentId: objectId.optional().nullable().or(z.literal('').transform(() => undefined)),
  staffUserId: objectId.optional().nullable().or(z.literal('').transform(() => undefined)),
  staffName: optionalText(120),
}
const visitFields = {
  complaint: z.enum(COMPLAINTS),
  complaintNote: optionalText(300),
  vitals: z.object({ tempC: optNum(30, 45), pulse: optNum(20, 250), bp: optionalText(15), spo2: optNum(50, 100) }).optional(),
  treatment: optionalText(500),
  medicines: z.array(z.object({ name: z.string().trim().min(1).max(120), dose: optionalText(60) })).max(10).optional(),
  outcome: z.enum(Object.keys(VISIT_OUTCOMES)).optional(),
  outcomeNote: optionalText(300),
  referredTo: optionalText(200),
  pickedUpBy: optionalText(120),
  notifyGuardian: z.boolean().optional(),
}
const visitBody = z.object({ ...person, ...visitFields })
const visitPatch = z.object({ ...visitFields, complaint: z.enum(COMPLAINTS).optional() })

const incidentFields = {
  kind: z.enum(INCIDENT_KINDS).default('INJURY'),
  date: ymd.optional(), time: hhmm.optional().or(z.literal('').transform(() => undefined)),
  place: optionalText(200),
  description: z.string().trim().min(3, 'Say what happened').max(3000),
  injury: optionalText(500), firstAid: optionalText(1000),
  witnesses: list(10).optional(),
  severity: z.enum(Object.keys(INCIDENT_SEVERITY)).default('MINOR'),
  followUp: optionalText(1000), followUpDate: optYmd,
  guardianInformed: z.object({ how: z.enum(INFORMED_HOW), note: optionalText(300) }).optional().nullable(),
}
const incidentBody = z.object({ ...person, ...incidentFields, visitId: objectId.optional(), notifyGuardian: z.boolean().optional() })
const incidentPatch = z.object(Object.fromEntries(Object.entries(incidentFields).map(([k, v]) => [k, v.optional()])))

// ── health records
router.get('/records', requirePermission('health.records.view'), async (req, res) => {
  const q = z.object({ search: z.string().max(80).optional(), sectionId: objectId.optional(), filter: z.enum(['ALLERGIES', 'CONDITIONS', 'NO_RECORD']).optional() }).parse(req.query)
  res.json({ data: await listRecords(q, req.auth) })
})
router.get('/records/:id', requirePermission('health.records.view'), async (req, res) => { res.json({ data: await getRecord(id(req), req.auth) }) })
router.put('/records/:id', requirePermission('health.records.edit'), async (req, res) => { res.json({ data: await saveRecord(id(req), recordBody.parse(req.body), req.auth, req) }) })
router.delete('/records/:id/measurements/:date', requirePermission('health.records.edit'), async (req, res) => { res.json({ data: await deleteMeasurement(id(req), ymd.parse(req.params.date), req.auth, req) }) })
router.get('/brief/:id', requirePermission('health.visits.view', 'health.records.view', 'health.incidents.view'), async (req, res) => { res.json({ data: await healthBrief(id(req), req.auth) }) })
router.get('/staff', requirePermission('health.visits.create', 'health.incidents.create'), async (req, res) => { res.json({ data: await staffLogins() }) })

// ── sick-room visits
router.get('/visits/board', requirePermission('health.visits.view'), async (req, res) => { res.json({ data: await visitBoard(req.auth) }) })
router.get('/visits', requirePermission('health.visits.view'), async (req, res) => {
  const q = z.object({ date: ymd.optional(), from: ymd.optional(), to: ymd.optional(), search: z.string().max(80).optional(), personType: z.enum(PERSON_TYPES).optional() }).parse(req.query)
  res.json({ data: await listVisits(q, req.auth) })
})
router.post('/visits', requirePermission('health.visits.create'), async (req, res) => { res.status(201).json({ data: await createVisit(visitBody.parse(req.body), req.auth, req) }) })
router.patch('/visits/:id', requirePermission('health.visits.create'), async (req, res) => { res.json({ data: await updateVisit(id(req), visitPatch.parse(req.body), req.auth, req) }) })

// ── incidents
router.get('/incidents', requirePermission('health.incidents.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(INCIDENT_STATUS)).optional(), severity: z.enum(Object.keys(INCIDENT_SEVERITY)).optional(), from: ymd.optional(), to: ymd.optional(), search: z.string().max(80).optional() }).parse(req.query)
  res.json({ data: await listIncidents(q, req.auth) })
})
router.post('/incidents', requirePermission('health.incidents.create'), async (req, res) => { res.status(201).json({ data: await createIncident(incidentBody.parse(req.body), req.auth, req) }) })
router.patch('/incidents/:id', requirePermission('health.incidents.create'), async (req, res) => { res.json({ data: await updateIncident(id(req), incidentPatch.parse(req.body), req.auth, req) }) })
router.post('/incidents/:id/resolve', requirePermission('health.incidents.resolve'), async (req, res) => {
  res.json({ data: await resolveIncident(id(req), z.object({ resolution: z.string().trim().min(3, 'Say how it was resolved').max(1000) }).parse(req.body), req.auth, req) })
})

export default router
