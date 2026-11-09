import { Router } from 'express'
import { COMPANY_SECTORS, DRIVE_MODES, DRIVE_STATUS, OFFER_STATUS, ROUND_KINDS, ROUND_RESULTS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, mobile, objectId, optionalText, z } from '../platform/validate.js'
import { deleteCompany, findStudents, getCompany, listCompanies, placementsMeta, saveCompany } from '../services/placements.js'
import { driveEligible, getDrive, listDrives, registerStudents, saveDrive, saveRoundResults, selectCandidates, setDriveStatus, withdrawRegistration } from '../services/placementsDrives.js'
import { createOffer, decideOffer, exportOffers, getOffer, listOffers, offerStats } from '../services/placementsOffers.js'

// placements: /api/v1/placements/* — companies, drives (eligibility, registrations, rounds, selections), offers and
// the statistics. The family app's side is in routes/portal.js (services/placementsFamily.js).
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('placements'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const paise = z.coerce.number().int().min(0).max(1_000_000_000_00) // up to ₹100 crore a year
/** A number that may be left empty: '' or null → null (no limit), missing → left as it is. */
const optNum = (min, max) => z.any().transform((v, ctx) => {
  if (v === undefined) return undefined
  if (v === '' || v === null) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) { ctx.addIssue({ code: 'custom', message: `${min} to ${max}` }); return z.NEVER }
  return n
})
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}

const CO = 'placements.companies'
const DR = 'placements.drives'
const OF = 'placements.offers'
const ANY_VIEW = [`${CO}.view`, `${DR}.view`, `${OF}.view`]

router.get('/meta', requirePermission(...ANY_VIEW), async (req, res) => { res.json({ data: await placementsMeta() }) })
router.get('/students', requirePermission(`${DR}.edit`, `${OF}.create`), async (req, res) => {
  res.json({ data: await findStudents(z.string().max(80).optional().parse(req.query.search)) })
})

// ── companies
const contact = z.object({
  name: z.string().trim().min(1, 'Enter the name').max(120), designation: optionalText(120),
  email: email.optional().or(z.literal('').transform(() => undefined)), mobile: mobile.optional().or(z.literal('').transform(() => undefined)), primary: z.boolean().optional(),
})
const companyBody = z.object({
  name: z.string().trim().min(2, 'Enter the company name').max(160), sector: z.enum(COMPANY_SECTORS.map((s) => s.value)).default('OTHER'),
  website: z.string().trim().url('Enter a full link, starting with https://').max(300).optional().or(z.literal('').transform(() => undefined)),
  city: optionalText(80), about: optionalText(2000), notes: optionalText(4000), contacts: z.array(contact).max(20).default([]), active: z.boolean().default(true),
})
router.get('/companies', requirePermission(`${CO}.view`, `${DR}.view`), async (req, res) => {
  const q = z.object({ search: z.string().max(120).optional(), sector: z.string().max(30).optional(), active: z.enum(['active', 'inactive', 'all']).optional() }).parse(req.query)
  res.json(await listCompanies(q))
})
router.get('/companies/:id', requirePermission(`${CO}.view`, `${DR}.view`), async (req, res) => { res.json({ data: await getCompany(id(req)) }) })
router.post('/companies', requirePermission(`${CO}.create`), async (req, res) => { res.status(201).json({ data: await saveCompany(null, companyBody.parse(req.body), req.auth, req) }) })
router.patch('/companies/:id', requirePermission(`${CO}.edit`), async (req, res) => {
  const body = companyBody.partial().parse(req.body)
  for (const k of ['sector', 'contacts', 'active']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveCompany(id(req), body, req.auth, req) })
})
router.delete('/companies/:id', requirePermission(`${CO}.delete`), async (req, res) => { res.json({ data: await deleteCompany(id(req), req) }) })

// ── drives
const round = z.object({
  id: optId, name: z.string().trim().min(1, 'Name the round').max(80), kind: z.enum(ROUND_KINDS.map((k) => k.value)).default('OTHER'),
  date: optYmd, maxMarks: optNum(0, 1000), done: z.boolean().optional(),
})
const driveBody = z.object({
  companyId: objectId, title: z.string().trim().min(2, 'Name the drive, e.g. Campus hiring 2027').max(160),
  academicYearId: optId, mode: z.enum(DRIVE_MODES.map((m) => m.value)).default('ON_CAMPUS'),
  roles: z.array(z.object({ title: z.string().trim().min(1, 'Name the role').max(120), openings: optNum(0, 10000), ctc: paise.optional().nullable() })).max(20).default([]),
  ctcMin: paise.optional().nullable(), ctcMax: paise.optional().nullable(), location: optionalText(160),
  startDate: optYmd, endDate: optYmd,
  registration: z.object({ opensOn: optYmd, closesOn: optYmd }).default({}),
  eligibility: z.object({
    programIds: z.array(objectId).max(50).default([]), batches: z.array(z.coerce.number().int().min(1990).max(2100)).max(10).default([]),
    classIds: z.array(objectId).max(50).default([]), minCgpa: optNum(0, 10), maxBacklogs: optNum(0, 50), min10th: optNum(0, 100), min12th: optNum(0, 100),
    note: optionalText(500),
  }).default({}),
  rounds: z.array(round).max(12).default([]),
  description: optionalText(4000),
})
router.get('/drives', requirePermission(`${DR}.view`), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(DRIVE_STATUS)).optional(), yearId: optId, companyId: optId, search: z.string().max(120).optional() }).parse(req.query)
  res.json(await listDrives(q))
})
router.get('/drives/:id', requirePermission(`${DR}.view`), async (req, res) => { res.json({ data: await getDrive(id(req)) }) })
router.post('/drives', requirePermission(`${DR}.create`), async (req, res) => { res.status(201).json({ data: await saveDrive(null, driveBody.parse(req.body), req.auth, req) }) })
router.patch('/drives/:id', requirePermission(`${DR}.edit`), async (req, res) => {
  const body = driveBody.partial().parse(req.body)
  for (const k of ['mode', 'roles', 'registration', 'eligibility', 'rounds']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveDrive(id(req), body, req.auth, req) })
})
router.post('/drives/:id/status', requirePermission(`${DR}.edit`), async (req, res) => {
  const { status } = z.object({ status: z.enum(Object.keys(DRIVE_STATUS)) }).parse(req.body)
  res.json({ data: await setDriveStatus(id(req), status, req.auth, req) })
})
router.get('/drives/:id/eligible', requirePermission(`${DR}.view`), async (req, res) => { res.json(await driveEligible(id(req))) })
router.post('/drives/:id/registrations', requirePermission(`${DR}.edit`), async (req, res) => {
  const body = z.object({ studentIds: z.array(objectId).min(1).max(2000), tenthPct: optNum(0, 100), twelfthPct: optNum(0, 100), override: z.boolean().default(false) }).parse(req.body)
  res.status(201).json({ data: await registerStudents(id(req), { ...body, tenthPct: body.tenthPct ?? undefined, twelfthPct: body.twelfthPct ?? undefined }, req.auth, req) })
})
router.delete('/drives/:id/registrations/:regId', requirePermission(`${DR}.edit`), async (req, res) => {
  res.json({ data: await withdrawRegistration(id(req), objectId.parse(req.params.regId), req.auth, req) })
})
router.put('/drives/:id/rounds/:roundId/results', requirePermission(`${DR}.edit`), async (req, res) => {
  const body = z.object({
    results: z.array(z.object({ registrationId: objectId, marks: optNum(0, 1000), result: z.enum(Object.keys(ROUND_RESULTS)).optional().nullable(), note: optionalText(200) })).max(3000),
    done: z.boolean().optional(),
  }).parse(req.body)
  res.json({ data: await saveRoundResults(id(req), objectId.parse(req.params.roundId), body, req.auth, req) })
})
router.post('/drives/:id/select', requirePermission(`${DR}.edit`), async (req, res) => {
  const body = z.object({ registrationIds: z.array(objectId).min(1).max(2000), role: optionalText(120), ctc: paise.optional(), joiningDate: optYmd, offeredOn: optYmd, location: optionalText(160) }).parse(req.body)
  res.status(201).json({ data: await selectCandidates(id(req), body, req.auth, req) })
})

// ── offers
const offerQuery = (req) => z.object({
  status: z.enum(Object.keys(OFFER_STATUS)).optional(), companyId: optId, programId: optId, yearId: optId, search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
}).parse(req.query)
router.get('/offers', requirePermission(`${OF}.view`), async (req, res) => { res.json(await listOffers(offerQuery(req))) })
router.get('/offers/stats', requirePermission(`${OF}.view`), async (req, res) => { res.json({ data: await offerStats(z.object({ yearId: optId }).parse(req.query)) }) })
router.get('/offers/export', requirePermission(`${OF}.export`), async (req, res) => { csv(res, 'placement-offers.csv', await exportOffers(offerQuery(req))) })
router.get('/offers/:id', requirePermission(`${OF}.view`), async (req, res) => { res.json({ data: await getOffer(id(req)) }) })
router.post('/offers', requirePermission(`${OF}.create`), async (req, res) => {
  const body = z.object({
    studentId: objectId, companyId: objectId, driveId: optId, academicYearId: optId, role: optionalText(120), ctc: paise.refine((v) => v > 0, 'Enter the CTC'),
    location: optionalText(160), joiningDate: optYmd, offeredOn: optYmd, note: optionalText(500),
  }).parse(req.body)
  res.status(201).json({ data: await createOffer(body, req.auth, req) })
})
router.post('/offers/:id/decision', requirePermission(`${OF}.create`), async (req, res) => {
  const body = z.object({ status: z.enum(Object.keys(OFFER_STATUS)), note: optionalText(300), on: optYmd }).parse(req.body)
  res.json({ data: await decideOffer(id(req), body, req.auth, req) })
})

export default router
