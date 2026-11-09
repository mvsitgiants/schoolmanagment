import { Router } from 'express'
import { closeStockCheck, listStockChecks, scanForStock, startStockCheck, stockCheckDetail } from '../services/libraryStock.js'
import { BORROWER_KINDS, COPY_SOURCES, COPY_STATUS, FINE_REASONS, FINE_STATUS, ITEM_TYPES, PAYMENT_MODES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  addCopies, copyByCode, deleteCopy, deleteTitle, exportCatalogue, getTitle, importCatalogue, isbnLookup, libraryMeta, listTitles, saveTitle, updateCopy,
} from '../services/library.js'
import { borrowerCard, deskSummary, issueBooks, listLoans, markLost, renewLoan, returnBook, searchBorrowers } from '../services/libraryDesk.js'
import { cancelPayment, collectFines, createFine, exportFines, finesOfLoan, listFines, waiveFine } from '../services/libraryFines.js'

// Library: /api/v1/library — the catalogue and copies, the issue desk, fines.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('library'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const paise = z.coerce.number().int().min(0).max(100_000_00)
const kind = z.enum(BORROWER_KINDS.map((k) => k.value))
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}

const CAT = 'library.catalogue'
const DESK = 'library.circulation'
const FINES = 'library.fines'

// ── catalogue
const copiesBody = z.object({
  count: z.coerce.number().int().min(1).max(200).optional(), accessionNos: z.array(z.string().trim().min(1).max(30)).max(200).optional(),
  branchId: objectId.optional().or(z.literal('').transform(() => undefined)), shelf: optionalText(40), price: paise.optional().nullable(), acquiredOn: optYmd,
  source: z.enum(COPY_SOURCES.map((s) => s.value)).optional(), vendor: optionalText(120), billNo: optionalText(40), note: optionalText(300),
})
const titleBody = z.object({
  title: z.string().trim().min(1, 'Enter the title').max(300), subtitle: optionalText(300), authors: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  isbn: optionalText(20), publisher: optionalText(160), year: z.coerce.number().int().min(1400).max(2100).optional().nullable(), edition: optionalText(40),
  language: optionalText(40), type: z.enum(ITEM_TYPES.map((x) => x.value)).default('BOOK'), category: optionalText(80), callNo: optionalText(40), description: optionalText(4000),
  ebookUrl: z.string().trim().url('Enter a full link, starting with https://').max(1000).optional().or(z.literal('').transform(() => undefined)),
  forFamilies: z.boolean().default(false), classIds: z.array(objectId).max(40).default([]), active: z.boolean().default(true),
  copies: copiesBody.optional(),
})

router.get('/meta', requirePermission(`${CAT}.view`, `${DESK}.view`, `${FINES}.view`), async (req, res) => { res.json({ data: await libraryMeta(req.auth) }) })
router.get('/titles', requirePermission(`${CAT}.view`, `${DESK}.view`), async (req, res) => {
  const q = z.object({ search: z.string().max(120).optional(), type: z.enum(ITEM_TYPES.map((x) => x.value)).optional(), category: z.string().max(80).optional(), available: z.enum(['0', '1']).optional(), ...paging }).parse(req.query)
  res.json(await listTitles({ ...q, available: q.available === '1' }, req.auth))
})
router.get('/titles/export', requirePermission(`${CAT}.export`), async (req, res) => { csv(res, 'library-catalogue.csv', await exportCatalogue(req.auth)) })
router.post('/titles/import', requirePermission(`${CAT}.import`), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(5000), dryRun: z.boolean().default(false) }).parse(req.body)
  res.json({ data: await importCatalogue(rows, { dryRun }, req.auth, req) })
})
router.get('/isbn/:isbn', requirePermission(`${CAT}.create`, `${CAT}.edit`), async (req, res) => { res.json({ data: await isbnLookup(z.string().max(20).parse(req.params.isbn)) }) })
router.get('/titles/:id', requirePermission(`${CAT}.view`, `${DESK}.view`), async (req, res) => { res.json({ data: await getTitle(id(req), req.auth) }) })
router.post('/titles', requirePermission(`${CAT}.create`), async (req, res) => { res.status(201).json({ data: await saveTitle(null, titleBody.parse(req.body), req.auth, req) }) })
router.patch('/titles/:id', requirePermission(`${CAT}.edit`), async (req, res) => {
  const body = titleBody.omit({ copies: true }).partial().parse(req.body)
  for (const k of ['authors', 'type', 'forFamilies', 'classIds', 'active']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveTitle(id(req), body, req.auth, req) })
})
router.delete('/titles/:id', requirePermission(`${CAT}.delete`), async (req, res) => { res.json({ data: await deleteTitle(id(req), req.auth, req) }) })
router.post('/titles/:id/copies', requirePermission(`${CAT}.create`, `${CAT}.edit`), async (req, res) => {
  const body = copiesBody.refine((b) => b.count || b.accessionNos?.length, 'Say how many copies, or give their numbers').parse(req.body)
  res.status(201).json({ data: await addCopies(id(req), body, req.auth, req) })
})
router.patch('/copies/:id', requirePermission(`${CAT}.edit`), async (req, res) => {
  const body = z.object({
    status: z.enum(Object.keys(COPY_STATUS)).optional(), reason: optionalText(200), shelf: z.string().max(40).optional(), price: paise.optional().nullable(),
    note: z.string().max(300).optional(), branchId: objectId.optional().or(z.literal('')), source: z.enum(COPY_SOURCES.map((s) => s.value)).optional(),
    vendor: z.string().max(120).optional(), billNo: z.string().max(40).optional(), acquiredOn: ymd.optional().or(z.literal('')),
  }).parse(req.body)
  res.json({ data: await updateCopy(id(req), body, req.auth, req) })
})
router.delete('/copies/:id', requirePermission(`${CAT}.delete`), async (req, res) => { res.json({ data: await deleteCopy(id(req), req.auth, req) }) })

// ── the issue desk
router.get('/desk', requirePermission(`${DESK}.view`), async (req, res) => { res.json({ data: await deskSummary(req.auth) }) })
router.get('/borrowers', requirePermission(`${DESK}.view`, `${FINES}.create`), async (req, res) => { res.json({ data: await searchBorrowers(z.string().max(80).default('').parse(req.query.search)) }) })
router.get('/borrower', requirePermission(`${DESK}.view`, `${FINES}.view`), async (req, res) => {
  const q = z.object({ code: z.string().max(40).optional(), kind: kind.optional(), id: objectId.optional() }).refine((x) => x.code || (x.kind && x.id), 'Scan the card or pick the borrower').parse(req.query)
  res.json({ data: await borrowerCard(q, req.auth) })
})
// stock check: scan the shelves, see what is missing (Library › Catalogue › Stock check)
router.get('/stock-checks', requirePermission(`${CAT}.view`), async (req, res) => { res.json({ data: await listStockChecks(req.auth) }) })
router.post('/stock-checks', requirePermission(`${CAT}.edit`), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(80), shelf: z.string().trim().max(40).optional() }).parse(req.body)
  res.status(201).json({ data: await startStockCheck(body, req.auth, req) })
})
router.get('/stock-checks/:id', requirePermission(`${CAT}.view`), async (req, res) => { res.json({ data: await stockCheckDetail(objectId.parse(req.params.id), req.auth) }) })
router.post('/stock-checks/:id/scan', requirePermission(`${CAT}.edit`), async (req, res) => {
  res.json({ data: await scanForStock(objectId.parse(req.params.id), z.object({ code: z.string().trim().min(1).max(40) }).parse(req.body).code, req.auth) })
})
router.post('/stock-checks/:id/close', requirePermission(`${CAT}.edit`), async (req, res) => { res.json({ data: await closeStockCheck(objectId.parse(req.params.id), req.auth, req) }) })
router.get('/copies/by-code/:code', requirePermission(`${DESK}.view`, `${CAT}.view`), async (req, res) => { res.json({ data: await copyByCode(z.string().min(1).max(30).parse(req.params.code), req.auth) }) })
router.post('/issue', requirePermission(`${DESK}.issue`), async (req, res) => {
  const body = z.object({ kind, id: objectId, codes: z.array(z.string().trim().min(1).max(30)).min(1).max(20), dueOn: optYmd, override: z.boolean().default(false) }).parse(req.body)
  res.json({ data: await issueBooks(body, req.auth, req) })
})
router.post('/return', requirePermission(`${DESK}.receive`), async (req, res) => {
  const body = z.object({ code: z.string().trim().min(1).max(30), damaged: z.boolean().default(false), damageCharge: paise.optional(), waiveLate: z.boolean().default(false), waiveReason: optionalText(200), note: optionalText(300) }).parse(req.body)
  res.json({ data: await returnBook(body, req.auth, req) })
})
router.get('/loans', requirePermission(`${DESK}.view`), async (req, res) => {
  const q = z.object({ state: z.enum(['OUT', 'OVERDUE', 'DUE_TODAY', 'RETURNED', 'LOST', 'ALL']).default('OUT'), search: z.string().max(80).optional(), kind: kind.optional(), from: ymd.optional(), to: ymd.optional(), ...paging }).parse(req.query)
  res.json(await listLoans(q, req.auth))
})
router.post('/loans/:id/renew', requirePermission(`${DESK}.issue`), async (req, res) => { res.json({ data: await renewLoan(id(req), req.auth, req) }) })
router.post('/loans/:id/lost', requirePermission(`${DESK}.receive`), async (req, res) => {
  res.json({ data: await markLost(id(req), z.object({ charge: paise.optional(), note: optionalText(300) }).parse(req.body ?? {}), req.auth, req) })
})
router.get('/loans/:id/fines', requirePermission(`${DESK}.view`, `${FINES}.view`), async (req, res) => { res.json({ data: await finesOfLoan(id(req)) }) })

// ── fines
const fineQuery = z.object({ status: z.enum([...Object.keys(FINE_STATUS), 'ALL']).default('OPEN'), search: z.string().max(80).optional(), reason: z.enum(FINE_REASONS.map((r) => r.value)).optional(), from: ymd.optional(), to: ymd.optional(), ...paging })
router.get('/fines', requirePermission(`${FINES}.view`), async (req, res) => { res.json(await listFines(fineQuery.parse(req.query), req.auth)) })
router.get('/fines/export', requirePermission(`${FINES}.view`), async (req, res) => { csv(res, 'library-fines.csv', await exportFines(fineQuery.parse(req.query), req.auth)) })
router.post('/fines', requirePermission(`${FINES}.create`), async (req, res) => {
  const body = z.object({ kind, id: objectId, reason: z.enum(FINE_REASONS.map((r) => r.value)), amount: paise.refine((n) => n > 0, 'Enter the amount'), note: optionalText(300) }).parse(req.body)
  res.status(201).json({ data: await createFine(body, req.auth, req) })
})
router.post('/fines/collect', requirePermission(`${FINES}.create`, `${DESK}.receive`), async (req, res) => {
  const body = z.object({ ids: z.array(objectId).min(1).max(50), mode: z.enum(PAYMENT_MODES.filter((m) => m.value !== 'ONLINE').map((m) => m.value)).default('CASH'), reference: optionalText(80), date: optYmd }).parse(req.body)
  res.json({ data: await collectFines(body, req.auth, req) })
})
router.post('/fines/:id/waive', requirePermission(`${FINES}.cancel`), async (req, res) => {
  res.json({ data: await waiveFine(id(req), z.object({ reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body), req.auth, req) })
})
router.post('/fines/:id/cancel-payment', requirePermission(`${FINES}.cancel`), async (req, res) => {
  res.json({ data: await cancelPayment(id(req), z.object({ reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body), req.auth, req) })
})

export default router
