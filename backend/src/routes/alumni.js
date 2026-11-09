import { Router } from 'express'
import { DONATION_STATUS, DONOR_KINDS, PAYMENT_MODES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, mobile, objectId, optionalText, z } from '../platform/validate.js'
import { alumniMeta, exportAlumni, getAlumnus, importLeavers, leaverYears, leaversPreview, listAlumni, saveAlumnus } from '../services/alumni.js'
import { createDonation, donationSummary, exportDonations, getDonation, listDonations } from '../services/alumniDonations.js'

// alumni: /api/v1/alumni/* — the directory (import a year's leavers, add by hand, search by batch, export) and donations
// (receipts, totals by fund and batch, export). The receipt prints as DONATION_RECEIPT (documents/alumniDocs.js).
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('alumni'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const year = z.coerce.number().int().min(1950).max(2100)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }
const optEmail = email.optional().or(z.literal('').transform(() => undefined))
const optMobile = mobile.optional().or(z.literal('').transform(() => undefined))
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}

const DIR = 'alumni.directory'
const DON = 'alumni.donations'

router.get('/meta', requirePermission(`${DIR}.view`, `${DON}.view`), async (req, res) => { res.json({ data: await alumniMeta() }) })

// ── directory
const dirQuery = (req) => z.object({
  batch: year.optional(), search: z.string().max(120).optional(), consent: z.enum(['0', '1']).optional(), program: z.string().max(160).optional(), ...paging,
}).parse(req.query)
const alumnusBody = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(160), gender: optionalText(20), admissionNo: optionalText(40), batch: year,
  programId: optId, program: optionalText(160), email: optEmail, mobile: optMobile, city: optionalText(80), country: optionalText(80),
  organisation: optionalText(160), designation: optionalText(120),
  linkedIn: z.string().trim().max(300).regex(/linkedin\.com\//i, 'Enter a LinkedIn profile link').optional().or(z.literal('').transform(() => undefined)),
  consent: z.boolean().default(false), notes: optionalText(2000), active: z.boolean().default(true),
})
router.get('/directory', requirePermission(`${DIR}.view`, `${DON}.view`), async (req, res) => { res.json(await listAlumni(dirQuery(req))) })
router.get('/directory/export', requirePermission(`${DIR}.export`), async (req, res) => { csv(res, 'alumni.csv', await exportAlumni(dirQuery(req))) })
router.get('/directory/leavers', requirePermission(`${DIR}.create`), async (req, res) => {
  const q = z.object({ year: year.optional() }).parse(req.query)
  res.json({ data: q.year ? await leaversPreview(q.year) : { years: await leaverYears() } })
})
router.post('/directory/import-leavers', requirePermission(`${DIR}.create`), async (req, res) => {
  const body = z.object({ year, studentIds: z.array(objectId).max(5000).optional() }).parse(req.body)
  res.json({ data: await importLeavers(body, req.auth, req) })
})
router.get('/directory/:id', requirePermission(`${DIR}.view`), async (req, res) => { res.json({ data: await getAlumnus(id(req)) }) })
router.post('/directory', requirePermission(`${DIR}.create`), async (req, res) => { res.status(201).json({ data: await saveAlumnus(null, alumnusBody.parse(req.body), req.auth, req) }) })
router.patch('/directory/:id', requirePermission(`${DIR}.edit`), async (req, res) => {
  const body = alumnusBody.partial().parse(req.body)
  for (const k of ['consent', 'active']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveAlumnus(id(req), body, req.auth, req) })
})

// ── donations
const donQuery = (req) => z.object({
  fund: z.string().max(80).optional(), batch: year.optional(), from: optYmd, to: optYmd, search: z.string().max(120).optional(),
  status: z.enum(Object.keys(DONATION_STATUS)).optional(), alumnusId: optId, is80G: z.enum(['0', '1']).optional(), ...paging,
}).parse(req.query)
router.get('/donations', requirePermission(`${DON}.view`), async (req, res) => { res.json(await listDonations(donQuery(req))) })
router.get('/donations/summary', requirePermission(`${DON}.view`), async (req, res) => {
  res.json({ data: await donationSummary(z.object({ from: optYmd, to: optYmd }).parse(req.query)) })
})
router.get('/donations/export', requirePermission(`${DON}.export`), async (req, res) => { csv(res, 'alumni-donations.csv', await exportDonations(donQuery(req))) })
router.get('/donations/:id', requirePermission(`${DON}.view`), async (req, res) => { res.json({ data: await getDonation(id(req)) }) })
router.post('/donations', requirePermission(`${DON}.create`), async (req, res) => {
  const body = z.object({
    donorKind: z.enum(DONOR_KINDS.map((k) => k.value)).default('ALUMNUS'), alumnusId: optId, name: optionalText(160),
    email: optEmail, mobile: optMobile, pan: optionalText(10), address: optionalText(400),
    amount: z.coerce.number().int().min(100, 'Enter the amount').max(1_000_000_000_00), mode: z.enum(PAYMENT_MODES.map((m) => m.value)),
    reference: optionalText(80), fund: optionalText(80), purpose: optionalText(300), is80G: z.boolean().default(false), date: optYmd, note: optionalText(500),
  }).parse(req.body)
  res.status(201).json({ data: await createDonation(body, req.auth, req) })
})

export default router
