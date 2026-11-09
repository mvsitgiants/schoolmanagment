import { Router } from 'express'
import {
  FO_COLLECTOR_TYPES, FO_COMPLAINT_CATEGORIES, FO_COMPLAINT_PRIORITIES, FO_COMPLAINT_SOURCES, FO_COMPLAINT_STATUS, FO_GATE_PASS_KINDS, FO_GATE_PASS_STATUS,
  FO_ID_TYPES, FO_VISIT_PURPOSES,
} from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, objectId, optionalText, z } from '../platform/validate.js'
import {
  cancelPass, checkInVisitor, checkOutVisitor, createPass, decidePass, enquiryFromVisit, findStudents, getPass, getVisitor, listPasses, listVisitors,
  markLeft, markReturned, staffOptions, studentPassHistory, visitorByMobile, visitorDesk,
} from '../services/frontOffice.js'
import {
  addComplaintNote, assignComplaint, getComplaint, listComplaints, raiseComplaint, setComplaintStatus,
} from '../services/frontOfficeComplaints.js'

// frontoffice: /api/v1/frontoffice/*  — visitor log, gate passes, complaints
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('frontoffice'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const optMobile = z.string().trim().regex(/^[+\d][\d\s-]{6,16}$/, 'Enter a valid mobile number').optional().or(z.literal('').transform(() => undefined))
const photo = z.string().max(400_000).optional().or(z.literal('').transform(() => undefined))
const values = (list) => list.map((x) => x.value)
const id = (req) => objectId.parse(req.params.id)
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true')

const ANY_FO = ['frontoffice.visitors.view', 'frontoffice.gate-pass.view', 'frontoffice.complaints.view']

// ───────────────────────────────────────────────────────── pickers

router.get('/staff', requirePermission(...ANY_FO), async (req, res) => {
  const { search } = z.object({ search: z.string().max(60).optional() }).parse(req.query)
  res.json({ data: await staffOptions(search) })
})
router.get('/students', requirePermission('frontoffice.gate-pass.view', 'frontoffice.complaints.view', 'frontoffice.visitors.view'), async (req, res) => {
  const { search } = z.object({ search: z.string().max(60).optional() }).parse(req.query)
  res.json({ data: await findStudents(search, req.auth) })
})

// ───────────────────────────────────────────────────────── visitor log

router.get('/visitors/desk', requirePermission('frontoffice.visitors.view'), async (req, res) => {
  res.json({ data: await visitorDesk(req.auth) })
})
router.get('/visitors', requirePermission('frontoffice.visitors.view'), async (req, res) => {
  const q = z.object({
    from: ymd.optional(), to: ymd.optional(), purpose: z.enum(values(FO_VISIT_PURPOSES)).optional(), status: z.enum(['IN', 'OUT']).optional(), search: z.string().max(60).optional(),
  }).parse(req.query)
  res.json({ data: await listVisitors(q, req.auth) })
})
router.get('/visitors/lookup', requirePermission('frontoffice.visitors.create'), async (req, res) => {
  const { mobile } = z.object({ mobile: z.string().max(20) }).parse(req.query)
  res.json({ data: await visitorByMobile(mobile) })
})
router.get('/visitors/:id', requirePermission('frontoffice.visitors.view'), async (req, res) => {
  res.json({ data: await getVisitor(id(req), req.auth) })
})
const visitorSchema = z.object({
  name: z.string().trim().min(2, 'Enter the visitor’s name').max(100),
  mobile: optMobile,
  purpose: z.enum(values(FO_VISIT_PURPOSES)),
  purposeNote: optionalText(200),
  from: optionalText(120),
  people: z.coerce.number().int().min(1).max(50).default(1),
  hostId: optId,
  hostName: optionalText(100),
  studentId: optId,
  idType: z.enum(values(FO_ID_TYPES)).optional().or(z.literal('').transform(() => undefined)),
  idNumber: optionalText(40),
  photo,
  badgeNo: optionalText(20),
  vehicleNo: optionalText(20),
  note: optionalText(300),
})
router.post('/visitors', requirePermission('frontoffice.visitors.create'), async (req, res) => {
  res.status(201).json({ data: await checkInVisitor(visitorSchema.parse(req.body), req.auth, req) })
})
router.post('/visitors/:id/checkout', requirePermission('frontoffice.visitors.checkout'), async (req, res) => {
  res.json({ data: await checkOutVisitor(id(req), req.auth, req) })
})
router.post('/visitors/:id/enquiry', requirePermission('frontoffice.visitors.create'), async (req, res) => {
  const input = z.object({ childName: z.string().trim().min(2, 'Enter the child’s name').max(100), classId: optId, dob: ymd.optional().or(z.literal('').transform(() => undefined)), note: optionalText(500) }).parse(req.body)
  res.status(201).json({ data: await enquiryFromVisit(id(req), input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── gate passes

router.get('/gate-passes', requirePermission('frontoffice.gate-pass.view', 'frontoffice.gate-pass.approve'), async (req, res) => {
  const q = z.object({
    date: ymd.optional(), status: z.enum(Object.keys(FO_GATE_PASS_STATUS)).optional(), kind: z.enum(values(FO_GATE_PASS_KINDS)).optional(),
    search: z.string().max(60).optional(), mine: flag,
  }).parse(req.query)
  res.json({ data: await listPasses(q, req.auth) })
})
/** Passes waiting for this user: a class teacher sees their own class's, an approver sees all. Any signed-in staff. */
router.get('/gate-passes/to-approve', async (req, res) => {
  res.json({ data: await listPasses({ mine: true }, req.auth) })
})
router.get('/gate-passes/history/:studentId', requirePermission('frontoffice.gate-pass.view'), async (req, res) => {
  res.json({ data: await studentPassHistory(objectId.parse(req.params.studentId)) })
})
router.get('/gate-passes/:id', requirePermission('frontoffice.gate-pass.view', 'frontoffice.gate-pass.approve'), async (req, res) => {
  res.json({ data: await getPass(id(req), req.auth) })
})
const passSchema = z.object({
  kind: z.enum(values(FO_GATE_PASS_KINDS)).default('STUDENT'),
  studentId: optId,
  staffId: optId,
  collector: z.object({
    type: z.enum(values(FO_COLLECTOR_TYPES)).default('GUARDIAN'),
    guardianId: optId, name: optionalText(100), relation: optionalText(40), mobile: optMobile, idNumber: optionalText(40), photo,
  }).optional(),
  reason: z.string().trim().min(2, 'Say why').max(300),
  leaveAt: hhmm.optional().or(z.literal('').transform(() => undefined)),
  returnBy: hhmm.optional().or(z.literal('').transform(() => undefined)),
  approveNow: z.boolean().optional(),
})
router.post('/gate-passes', requirePermission('frontoffice.gate-pass.create'), async (req, res) => {
  res.status(201).json({ data: await createPass(passSchema.parse(req.body), req.auth, req) })
})
/** Approve or refuse: the approve permission, or the student's class teacher (checked in the service). */
router.post('/gate-passes/:id/decide', async (req, res) => {
  const body = z.object({ approve: z.boolean(), note: optionalText(300) }).parse(req.body)
  res.json({ data: await decidePass(id(req), body, req.auth, req) })
})
router.post('/gate-passes/:id/left', requirePermission('frontoffice.gate-pass.create'), async (req, res) => {
  res.json({ data: await markLeft(id(req), req.auth, req) })
})
router.post('/gate-passes/:id/returned', requirePermission('frontoffice.gate-pass.create'), async (req, res) => {
  res.json({ data: await markReturned(id(req), req.auth, req) })
})
router.post('/gate-passes/:id/cancel', requirePermission('frontoffice.gate-pass.create'), async (req, res) => {
  const { reason } = z.object({ reason: optionalText(200) }).parse(req.body ?? {})
  res.json({ data: await cancelPass(id(req), reason, req.auth, req) })
})

// ───────────────────────────────────────────────────────── complaints

router.get('/complaints', requirePermission('frontoffice.complaints.view'), async (req, res) => {
  const q = z.object({
    status: z.enum(Object.keys(FO_COMPLAINT_STATUS)).optional(), category: z.enum(values(FO_COMPLAINT_CATEGORIES)).optional(),
    priority: z.enum(values(FO_COMPLAINT_PRIORITIES)).optional(), mine: flag, overdue: flag, open: flag, search: z.string().max(60).optional(),
  }).parse(req.query)
  res.json({ data: await listComplaints(q, req.auth) })
})
router.get('/complaints/:id', requirePermission('frontoffice.complaints.view'), async (req, res) => {
  res.json({ data: await getComplaint(id(req), req.auth) })
})
const complaintSchema = z.object({
  source: z.enum(values(FO_COMPLAINT_SOURCES).filter((s) => s !== 'FAMILY_APP')),
  category: z.enum(values(FO_COMPLAINT_CATEGORIES)),
  priority: z.enum(values(FO_COMPLAINT_PRIORITIES)).default('MEDIUM'),
  subject: z.string().trim().min(3, 'Say what it is about').max(150),
  description: optionalText(3000),
  complainant: z.object({ name: optionalText(100), mobile: optMobile, email: email.optional().or(z.literal('').transform(() => undefined)) }).default({}),
  complainantUserId: optId,
  studentId: optId,
  assignedToId: optId,
})
router.post('/complaints', requirePermission('frontoffice.complaints.create'), async (req, res) => {
  res.status(201).json({ data: await raiseComplaint(complaintSchema.parse(req.body), req.auth, req) })
})
router.post('/complaints/:id/assign', requirePermission('frontoffice.complaints.assign'), async (req, res) => {
  const body = z.object({ assignedToId: objectId, note: optionalText(300) }).parse(req.body)
  res.json({ data: await assignComplaint(id(req), body, req.auth, req) })
})
/** Move it along (IN_PROGRESS / RESOLVED / CLOSED): "resolve", or the person it is assigned to (checked in the service). */
router.post('/complaints/:id/status', requirePermission('frontoffice.complaints.view'), async (req, res) => {
  const body = z.object({ status: z.enum(Object.keys(FO_COMPLAINT_STATUS)), note: optionalText(500), resolution: optionalText(2000) }).parse(req.body)
  res.json({ data: await setComplaintStatus(id(req), body, req.auth, req) })
})
router.post('/complaints/:id/notes', requirePermission('frontoffice.complaints.view'), async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(1, 'Write the note').max(1000) }).parse(req.body)
  res.json({ data: await addComplaintNote(id(req), note, req.auth, req) })
})

export default router
