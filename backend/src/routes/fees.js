import { Router } from 'express'
import { CONCESSION_KINDS, CONCESSION_STATUS, PAYMENT_MODES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  approveVariance, cancelReceipt, closeDay, collect, daySummary, decideConcession, deleteStructure, generateInvoices, listConcessions,
  deleteHead, dueStudentIds, listDayEnds, listDues, listHeads, listInvoices, listReceipts, listRefunds, listStructures, refundReceipt, requestConcession, saveHead,
  saveStructure, sendReminders, studentLedger, withdrawConcession,
} from '../services/fees.js'

// Fees: /api/v1/fees/*  — every amount in the API is integer paise.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('fees'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const paise = z.coerce.number().int().min(0).max(1e11)
const modes = z.enum(PAYMENT_MODES.map((m) => m.value))
// the refunds, dues and concessions lists: page 1.., 50 rows by default, 100 at most
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }
const search = z.string().trim().max(80).optional()

// ───────────────────────────────────────────────────────── heads and structures

const headSchema = z.object({
  name: z.string().trim().min(2, 'Name the fee').max(60),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, '1–12 letters, digits or dashes'),
  refundable: z.boolean().optional(),
  active: z.boolean().optional(),
})
router.get('/heads', requirePermission('fees.structures.view', 'fees.collect.view', 'fees.concessions.view'), async (req, res) => {
  res.json({ data: await listHeads() })
})
router.post('/heads', requirePermission('fees.structures.create'), async (req, res) => {
  res.status(201).json({ data: await saveHead(null, headSchema.parse(req.body), req) })
})
router.patch('/heads/:id', requirePermission('fees.structures.edit'), async (req, res) => {
  res.json({ data: await saveHead(objectId.parse(req.params.id), headSchema.partial().parse(req.body), req) })
})
router.delete('/heads/:id', requirePermission('fees.structures.delete'), async (req, res) => {
  res.json({ data: await deleteHead(objectId.parse(req.params.id), req) })
})

const structureSchema = z.object({
  name: z.string().trim().min(2, 'Name the structure').max(80),
  academicYearId: objectId.optional(),
  classIds: z.array(objectId).min(1, 'Pick at least one class').max(60),
  appliesTo: z.enum(['ALL', 'NEW']).default('ALL'),
  lines: z.array(z.object({ feeHeadId: objectId, amount: paise.min(1, 'Enter the amount') })).max(30),
  installments: z.array(z.object({ name: z.string().trim().min(1, 'Name it').max(40), dueDate: ymd, amount: paise })).max(24),
  active: z.boolean().optional(),
})
router.get('/structures', requirePermission('fees.structures.view'), async (req, res) => {
  res.json({ data: await listStructures(req.query.yearId ? objectId.parse(req.query.yearId) : undefined) })
})
router.post('/structures', requirePermission('fees.structures.create'), async (req, res) => {
  res.status(201).json({ data: await saveStructure(null, structureSchema.parse(req.body), req) })
})
router.patch('/structures/:id', requirePermission('fees.structures.edit'), async (req, res) => {
  res.json({ data: await saveStructure(objectId.parse(req.params.id), structureSchema.parse(req.body), req) })
})
router.delete('/structures/:id', requirePermission('fees.structures.delete'), async (req, res) => {
  res.json({ data: await deleteStructure(objectId.parse(req.params.id), req) })
})
router.post('/structures/:id/generate', requirePermission('fees.structures.create'), async (req, res) => {
  res.json({ data: await generateInvoices(objectId.parse(req.params.id), req.auth, req) })
})

// ───────────────────────────────────────────────────────── a student's account and collection

router.get('/students/:id', requirePermission('fees.collect.view', 'fees.invoices.view'), async (req, res) => {
  res.json({ data: await studentLedger(objectId.parse(req.params.id), req.auth) })
})
router.post('/collect', requirePermission('fees.collect.create'), async (req, res) => {
  const input = z.object({
    studentId: objectId, amount: paise.min(1, 'Enter the amount received'), mode: modes, reference: optionalText(60),
    waiveLateFee: z.boolean().optional(), note: optionalText(200), invoiceIds: z.array(objectId).max(50).optional(),
    // a cheque / DD: the bank it is drawn on and its date, printed on the receipt
    chequeBank: optionalText(80), chequeDate: ymd.optional(),
  }).refine((v) => v.mode === 'CASH' || !!v.reference, { message: 'Enter the reference (UTR, cheque no. or card last 4)', path: ['reference'] }).parse(req.body)
  res.status(201).json({ data: await collect(input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── invoices, receipts, refunds

router.get('/invoices', requirePermission('fees.invoices.view', 'fees.dues.view'), async (req, res) => {
  const q = z.object({ status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED']).optional(), sectionId: objectId.optional(), overdue: z.coerce.boolean().optional() }).parse(req.query)
  res.json(await listInvoices(q, pageParams(req.query), req.auth))
})
router.get('/receipts', requirePermission('fees.invoices.view', 'fees.collect.view'), async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional(), mode: modes.optional(), status: z.enum(['VALID', 'CANCELLED']).optional() }).parse(req.query)
  res.json(await listReceipts(q, pageParams(req.query), req.auth))
})
router.post('/receipts/:id/cancel', requirePermission('fees.invoices.cancel'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.json({ data: await cancelReceipt(objectId.parse(req.params.id), reason, req.auth, req) })
})
router.post('/receipts/:id/refund', requirePermission('fees.refunds.refund'), async (req, res) => {
  const input = z.object({ amount: paise.min(1), mode: modes, reference: optionalText(60), reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.status(201).json({ data: await refundReceipt(objectId.parse(req.params.id), input, req.auth, req) })
})
router.get('/refunds', requirePermission('fees.refunds.view'), async (req, res) => {
  const q = z.object({ search, ...paging }).parse(req.query)
  res.json({ data: await listRefunds(q, req.auth) })
})

// ───────────────────────────────────────────────────────── dues

const duesQuery = z.object({ sectionId: objectId.optional(), classId: objectId.optional(), overdueOnly: z.coerce.boolean().optional(), search })
router.get('/dues', requirePermission('fees.dues.view'), async (req, res) => {
  const q = duesQuery.extend(paging).parse(req.query)
  res.json({ data: await listDues(q, req.auth) })
})
// picked families (`studentIds`), or `all`: the dues list's filter — everyone in it on the server, not just the page shown
router.post('/dues/remind', requirePermission('fees.dues.send'), async (req, res) => {
  const body = z.object({ studentIds: z.array(objectId).min(1).max(2000).optional(), all: duesQuery.optional() })
    .refine((b) => b.studentIds || b.all, { message: 'Pick the families to remind', path: ['studentIds'] }).parse(req.body)
  const ids = body.studentIds ?? await dueStudentIds(body.all, req.auth)
  res.json({ data: await sendReminders(ids, req.auth, req) })
})

// ───────────────────────────────────────────────────────── concessions

router.get('/concessions', requirePermission('fees.concessions.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(CONCESSION_STATUS)).optional(), search, ...paging }).parse(req.query)
  res.json({ data: await listConcessions(q, req.auth) })
})
router.post('/concessions', requirePermission('fees.concessions.create'), async (req, res) => {
  const input = z.object({
    studentId: objectId, academicYearId: objectId.optional(), kind: z.enum(CONCESSION_KINDS.map((k) => k.value)),
    value: z.coerce.number().positive(), feeHeadIds: z.array(objectId).max(30).default([]),
    reason: z.string().trim().min(2, 'Give the reason').max(80), note: optionalText(300),
  }).parse(req.body)
  res.status(201).json({ data: await requestConcession(input, req.auth, req) })
})
router.post('/concessions/:id/decide', requirePermission('fees.concessions.approve'), async (req, res) => {
  const { approve } = z.object({ approve: z.boolean() }).parse(req.body)
  res.json({ data: await decideConcession(objectId.parse(req.params.id), approve, req.auth, req) })
})
router.post('/concessions/:id/withdraw', requirePermission('fees.concessions.create', 'fees.concessions.approve'), async (req, res) => {
  res.json({ data: await withdrawConcession(objectId.parse(req.params.id), req.auth, req) })
})

// ───────────────────────────────────────────────────────── day-end

router.get('/day-end', requirePermission('fees.day-end.view'), async (req, res) => {
  const q = z.object({ date: ymd.optional(), collectorId: objectId.optional() }).parse(req.query)
  res.json({ data: await daySummary(q, req.auth) })
})
router.get('/day-end/closings', requirePermission('fees.day-end.view'), async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
  res.json({ data: await listDayEnds(q) })
})
router.post('/day-end/close', requirePermission('fees.day-end.close'), async (req, res) => {
  const input = z.object({ date: ymd.optional(), cashCounted: paise, note: optionalText(300) }).parse(req.body)
  res.status(201).json({ data: await closeDay(input, req.auth, req) })
})
router.post('/day-end/:id/approve', requirePermission('fees.day-end.approve_variance'), async (req, res) => {
  res.json({ data: await approveVariance(objectId.parse(req.params.id), req.auth, req) })
})

export default router
