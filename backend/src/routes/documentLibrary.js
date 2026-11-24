import { Router } from 'express'
import { FILE_CATEGORIES, FILE_VERIFY_STATUS, RECORD_TYPES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import {
  documentsMeta, expiringDocuments, issuedDocuments, listDocuments, missingDocuments, removedDocuments, restoreDocument, storageUse, tellMissing, zipDocuments,
} from '../services/documentLibrary.js'

// The document library: /api/v1/document-library/*  — every file in one place, and many downloaded as one ZIP.
// (/api/v1/documents is the print engine.)
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('documents'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const opt = (s) => s.optional().or(z.literal('').transform(() => undefined))
const kind = z.enum(FILE_CATEGORIES.map((c) => c.value))
const filters = {
  search: z.string().max(80).optional(),
  kind: opt(kind),
  source: opt(z.enum(Object.keys(RECORD_TYPES))),
  person: opt(z.enum(['STUDENT', 'STAFF', 'APPLICANT', 'SCHOOL'])),
  checked: opt(z.enum(Object.keys(FILE_VERIFY_STATUS))),
  classId: opt(objectId), sectionId: opt(objectId), studentId: opt(objectId), employeeId: opt(objectId),
  from: opt(ymd), to: opt(ymd),
}

router.get('/meta', requirePermission('documents.library.view'), async (req, res) => {
  res.json({ data: await documentsMeta(req.auth) })
})

router.get('/', requirePermission('documents.library.view'), async (req, res) => {
  const q = z.object({
    ...filters,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 200)),
  }).parse(req.query)
  res.json({ data: await listDocuments(q, req.auth) })
})

/** Picked files, a student's everything, a staff member's, or a class (some kinds only) — as one ZIP. */
router.post('/zip', requirePermission('documents.library.export'), async (req, res) => {
  const q = z.object({
    ...filters,
    ids: z.array(objectId).max(2000).optional(),
    kinds: z.array(kind).max(20).optional(),
    name: z.string().trim().max(60).optional(),
  }).parse(req.body ?? {})
  await zipDocuments(q, req.auth, req, res)
})

const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 200)) }

router.get('/storage', requirePermission('documents.library.view', 'documents.bin.view'), async (req, res) => {
  res.json({ data: await storageUse(req.auth) })
})

// what is still to come: the admission checklist, and checked papers about to run out
router.get('/missing', requirePermission('documents.missing.view'), async (req, res) => {
  const q = z.object({ classId: opt(objectId), sectionId: opt(objectId), kind: opt(kind), ...paging }).parse(req.query)
  res.json({ data: await missingDocuments(q, req.auth) })
})
router.get('/expiring', requirePermission('documents.missing.view'), async (req, res) => {
  const q = z.object({ days: z.coerce.number().int().min(0).max(365).default(60), ...paging }).parse(req.query)
  res.json({ data: await expiringDocuments(q, req.auth) })
})
router.post('/missing/tell', requirePermission('documents.missing.send'), async (req, res) => {
  const { studentIds } = z.object({ studentIds: z.array(objectId).min(1).max(2000) }).parse(req.body)
  res.json({ data: await tellMissing(studentIds, req.auth, req) })
})

// what the school issued: certificates, TCs, receipts, staff letters
router.get('/issued', requirePermission('documents.issued.view'), async (req, res) => {
  const q = z.object({ type: opt(z.enum(['CERTIFICATE', 'TC', 'RECEIPT', 'LETTER'])), from: opt(ymd), to: opt(ymd), search: z.string().max(80).optional(), ...paging }).parse(req.query)
  res.json({ data: await issuedDocuments(q, req.auth) })
})

// removed files: never destroyed, put back from here
router.get('/bin', requirePermission('documents.bin.view'), async (req, res) => {
  const q = z.object({ search: z.string().max(80).optional(), ...paging }).parse(req.query)
  res.json({ data: await removedDocuments(q, req.auth) })
})
router.post('/bin/:id/restore', requirePermission('documents.bin.restore'), async (req, res) => {
  res.json({ data: await restoreDocument(objectId.parse(req.params.id), req.auth, req) })
})

export default router
