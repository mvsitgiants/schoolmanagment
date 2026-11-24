import { Router } from 'express'
import {
  GENDERS, SCHOLARSHIP_APPROVAL, SCHOLARSHIP_BENEFITS, SCHOLARSHIP_DOC_TYPES, SCHOLARSHIP_KINDS, SCHOLARSHIP_PROVIDERS, SCHOLARSHIP_RANK_BY,
  SCHOLARSHIP_PORTALS, SCHOLARSHIP_PORTAL_STATUS, SCHOLARSHIP_REJECT_REASONS, SCHOLARSHIP_STATUS, STUDENT_CATEGORIES,
} from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  checkDocument, createApplication, createApplications, decideApplications, deleteScheme, documentFor, eligibleStudents, getApplication, getScheme,
  listApplications, listSchemes, markOriginalSeen, previewApplication, saveDocument, saveScheme, scholarshipMeta, tellFamilies, updateApplication,
  withdrawApplication, markAllOriginalsSeen, listVisitDays, saveVisitDay, deleteVisitDay, visitDayBookings, updatePortal, recordMoney, scholarshipReport,
} from '../services/scholarships.js'

// scholarships: /api/v1/scholarships/*  — schemes and their document checklist, applications, checking documents, decisions
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('scholarships'))

const values = (list) => list.map((x) => x.value)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const key = (req) => z.string().min(1).max(80).parse(req.params.key)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 100)) }
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true')
const paise = z.coerce.number().int().min(0)
const optPaise = paise.nullable().optional()
const pct = z.coerce.number().min(0).max(100)
const ids = z.array(objectId).min(1).max(500)

const WORK = ['scholarships.applications.create', 'scholarships.applications.edit', 'scholarships.applications.verify']

// ───────────────────────────────────────────────────────── schemes

router.get('/meta', requirePermission('scholarships.applications.view', 'scholarships.schemes.view'), async (req, res) => {
  res.json({ data: await scholarshipMeta() })
})

router.get('/schemes', requirePermission('scholarships.schemes.view', 'scholarships.applications.view'), async (req, res) => {
  const { all } = z.object({ all: flag }).parse(req.query)
  res.json({ data: await listSchemes({ all }) })
})
router.get('/schemes/:id', requirePermission('scholarships.schemes.view'), async (req, res) => {
  res.json({ data: await getScheme(id(req)) })
})

const schemeSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(100),
  provider: z.enum(values(SCHOLARSHIP_PROVIDERS)).default('INSTITUTION'),
  benefit: z.enum(values(SCHOLARSHIP_BENEFITS)).default('FEE_WAIVER'),
  kind: z.enum(values(SCHOLARSHIP_KINDS)),
  value: z.coerce.number().positive('Enter the value'),
  feeHeadIds: z.array(objectId).max(50).default([]),
  eligibility: z.object({
    classIds: z.array(objectId).max(100).default([]),
    categories: z.array(z.enum(values(STUDENT_CATEGORIES))).max(20).default([]),
    genders: z.array(z.enum(values(GENDERS))).max(5).default([]),
    maxIncome: optPaise,
    minMarksPct: pct.nullable().optional(),
    minAttendancePct: pct.nullable().optional(),
  }).default({}),
  seats: z.coerce.number().int().min(1).nullable().optional(),
  budget: optPaise,
  approval: z.enum(values(SCHOLARSHIP_APPROVAL)).default('APPROVER'),
  rankBy: z.enum(values(SCHOLARSHIP_RANK_BY)).default('NONE'),
  holdFees: z.boolean().default(true),
  familyApply: z.boolean().default(true),
  renewalsFirst: z.boolean().default(false),
  portal: z.object({ name: z.enum(values(SCHOLARSHIP_PORTALS)).optional(), url: z.string().trim().url('Enter the full address (https://…)').max(300).optional().or(z.literal('').transform(() => undefined)), verifyBy: optYmd }).optional(),
  renewal: z.object({ minMarksPct: pct.nullable().optional(), minAttendancePct: pct.nullable().optional() }).optional(),
  lastDate: ymd.nullable().optional().or(z.literal('').transform(() => null)),
  documents: z.array(z.object({
    type: z.enum(values(SCHOLARSHIP_DOC_TYPES)),
    label: optionalText(80),
    required: z.boolean().default(true),
    originalNeeded: z.boolean().default(false),
    note: optionalText(200),
  })).max(30).default([]),
  description: optionalText(1000),
  active: z.boolean().default(true),
})
router.post('/schemes', requirePermission('scholarships.schemes.create'), async (req, res) => {
  res.status(201).json({ data: await saveScheme(null, schemeSchema.parse(req.body), req.auth, req) })
})
router.put('/schemes/:id', requirePermission('scholarships.schemes.edit'), async (req, res) => {
  res.json({ data: await saveScheme(id(req), schemeSchema.parse(req.body), req.auth, req) })
})
router.delete('/schemes/:id', requirePermission('scholarships.schemes.delete'), async (req, res) => {
  res.json({ data: await deleteScheme(id(req), req.auth, req) })
})

/** Students who can apply and haven't yet this year. */
router.get('/schemes/:id/eligible', requirePermission('scholarships.applications.create'), async (req, res) => {
  const q = z.object({ classId: optId, sectionId: optId, search: z.string().max(60).optional(), renewal: flag }).parse(req.query)
  res.json({ data: await eligibleStudents(id(req), q, req.auth) })
})

// ───────────────────────────────────────────────────────── applications

router.get('/applications', requirePermission('scholarships.applications.view'), async (req, res) => {
  const q = z.object({
    academicYearId: optId, schemeId: optId, status: z.enum(Object.keys(SCHOLARSHIP_STATUS)).optional().or(z.literal('').transform(() => undefined)),
    view: z.enum(['TO_CHECK', 'FAMILY', 'PORTAL_VERIFY', 'MONEY']).optional().or(z.literal('').transform(() => undefined)),
    tab: z.enum(['CHECK', 'FAMILY', 'DECIDE', 'APPROVED', 'CLOSED']).optional().or(z.literal('').transform(() => undefined)),
    renewal: z.enum(['RENEWAL', 'NEW']).optional().or(z.literal('').transform(() => undefined)),
    classId: optId, sectionId: optId, search: z.string().max(60).optional(), ...paging,
  }).parse(req.query)
  res.json({ data: await listApplications(q, req.auth) })
})

router.get('/applications/preview', requirePermission('scholarships.applications.create'), async (req, res) => {
  const q = z.object({ schemeId: objectId, studentId: objectId, familyIncome: optPaise, marksPct: pct.optional() }).parse(req.query)
  res.json({ data: await previewApplication(q, req.auth) })
})

router.post('/applications', requirePermission('scholarships.applications.create'), async (req, res) => {
  const input = z.object({
    schemeId: objectId, studentId: objectId, familyIncome: optPaise, marksPct: pct.nullable().optional(), note: optionalText(500), tellFamily: z.boolean().default(false),
  }).parse(req.body)
  res.status(201).json({ data: await createApplication(input, req.auth, req) })
})
router.post('/applications/bulk', requirePermission('scholarships.applications.create'), async (req, res) => {
  const input = z.object({ schemeId: objectId, studentIds: ids, tellFamily: z.boolean().default(false), renewal: z.boolean().default(false) }).parse(req.body)
  res.json({ data: await createApplications(input, req.auth, req) })
})
router.post('/applications/tell-family', requirePermission(...WORK), async (req, res) => {
  const { ids: list } = z.object({ ids }).parse(req.body)
  res.json({ data: await tellFamilies(list, req.auth, req) })
})
router.post('/applications/decide', requirePermission('scholarships.applications.approve'), async (req, res) => {
  const input = z.object({ ids, approve: z.boolean(), note: optionalText(500) }).parse(req.body)
  res.json({ data: await decideApplications(input.ids, input.approve, input.note, req.auth, req) })
})

/** Where applications stand on the government portal (one, or a list verified together). */
router.post('/applications/portal', requirePermission('scholarships.applications.portal'), async (req, res) => {
  const input = z.object({
    ids, status: z.enum(Object.keys(SCHOLARSHIP_PORTAL_STATUS)).optional(), applicationId: z.string().trim().max(60).optional(),
    sanctionedAmount: paise.optional(), note: z.string().trim().max(300).optional(),
  }).parse(req.body)
  const { ids: list, ...rest } = input
  res.json({ data: await updatePortal(list, rest, req.auth, req) })
})
/** Money a government or trust paid for approved students: a receipt each against their fees. */
router.post('/applications/money', requirePermission('scholarships.applications.money'), async (req, res) => {
  const input = z.object({
    rows: z.array(z.object({ id: objectId, amount: z.coerce.number().int().min(100, 'Enter the amount'), final: z.boolean().optional() })).min(1).max(500),
    date: optYmd, reference: optionalText(80), final: z.boolean().default(false),
  }).parse(req.body)
  res.json({ data: await recordMoney(input.rows, input, req.auth, req) })
})
router.get('/report', requirePermission('scholarships.reports.view'), async (req, res) => {
  const q = z.object({ academicYearId: optId }).parse(req.query)
  res.json({ data: await scholarshipReport(q, req.auth) })
})

router.get('/applications/:id', requirePermission('scholarships.applications.view'), async (req, res) => {
  res.json({ data: await getApplication(id(req), req.auth) })
})
router.put('/applications/:id', requirePermission(...WORK), async (req, res) => {
  const input = z.object({ familyIncome: optPaise, marksPct: pct.nullable().optional(), note: z.string().trim().max(500).optional() }).parse(req.body)
  res.json({ data: await updateApplication(id(req), input, req.auth, req) })
})
router.post('/applications/:id/withdraw', requirePermission('scholarships.applications.edit', 'scholarships.applications.approve'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) }).parse(req.body)
  res.json({ data: await withdrawApplication(id(req), reason, req.auth, req) })
})

// one checklist line: its wallet document (files go on it), details / paper copy, the check, the original seen
router.post('/applications/:id/items/:key/doc', requirePermission(...WORK), async (req, res) => {
  res.json({ data: await documentFor(id(req), key(req), req.auth) })
})
router.put('/applications/:id/items/:key', requirePermission(...WORK), async (req, res) => {
  const input = z.object({ number: z.string().trim().max(60).optional(), issuedOn: optYmd.or(z.null()), validTill: optYmd.or(z.null()), paperCopy: z.boolean().optional() }).parse(req.body)
  res.json({ data: await saveDocument(id(req), key(req), input, req.auth, req) })
})
router.post('/applications/:id/items/:key/check', requirePermission('scholarships.applications.verify'), async (req, res) => {
  const input = z.object({
    result: z.enum(['ACCEPT', 'NOT_ACCEPT']),
    reason: z.enum(values(SCHOLARSHIP_REJECT_REASONS)).optional(),
    note: optionalText(300),
    originalSeen: z.boolean().default(false),
    number: z.string().trim().max(60).optional(),
    issuedOn: optYmd, validTill: optYmd,
  }).parse(req.body)
  res.json({ data: await checkDocument(id(req), key(req), input, req.auth, req) })
})
router.post('/applications/:id/items/:key/original', requirePermission('scholarships.applications.verify'), async (req, res) => {
  res.json({ data: await markOriginalSeen(id(req), key(req), req.auth, req) })
})
/** At the desk: every original still to be seen on the application, seen — one click. */
router.post('/applications/:id/originals', requirePermission('scholarships.applications.verify'), async (req, res) => {
  res.json({ data: await markAllOriginalsSeen(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── visit times for originals

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const visitSchema = z.object({
  date: ymd, from: hhmm, to: hhmm,
  slotMinutes: z.coerce.number().int().min(5).max(120).default(10),
  perSlot: z.coerce.number().int().min(1).max(50).default(2),
  place: optionalText(120), note: optionalText(300), branchId: optId, active: z.boolean().default(true),
})
router.get('/visits', requirePermission('scholarships.visits.view'), async (req, res) => {
  const { all } = z.object({ all: flag }).parse(req.query)
  res.json({ data: await listVisitDays({ all }) })
})
router.get('/visits/:id/bookings', requirePermission('scholarships.visits.view', 'scholarships.applications.verify'), async (req, res) => {
  res.json({ data: await visitDayBookings(id(req), req.auth) })
})
router.post('/visits', requirePermission('scholarships.visits.create'), async (req, res) => {
  res.status(201).json({ data: await saveVisitDay(null, visitSchema.parse(req.body), req.auth, req) })
})
router.put('/visits/:id', requirePermission('scholarships.visits.edit'), async (req, res) => {
  res.json({ data: await saveVisitDay(id(req), visitSchema.parse(req.body), req.auth, req) })
})
router.delete('/visits/:id', requirePermission('scholarships.visits.delete'), async (req, res) => {
  res.json({ data: await deleteVisitDay(id(req), req.auth, req) })
})

export default router
