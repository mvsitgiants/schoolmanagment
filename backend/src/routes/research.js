import { Router } from 'express'
import { RESEARCH_AGENCIES, RESEARCH_INDEXING, RESEARCH_PROJECT_STATUS, RESEARCH_PUB_TYPES, RESEARCH_SCHOLAR_MODES, RESEARCH_SCHOLAR_STATUS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  deleteProject, deletePublication, deleteScholar, exportPublications, getPublication, importPublications, listProjects, listPublications,
  listScholars, researchMeta, saveProject, savePublication, saveScholar,
} from '../services/research.js'

// research: /api/v1/research/*  — publications (and patents), projects & grants, Ph.D. scholars
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('research'))

const PUB = 'research.publications'
const PRJ = 'research.projects'
const id = (req) => objectId.parse(req.params.id)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().nullable().or(z.literal('').transform(() => null))
const nullableId = objectId.optional().nullable().or(z.literal('').transform(() => null))
const paise = z.coerce.number().int('Whole paise').min(0).max(1_000_000_000_00)
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}

router.get('/meta', requirePermission(`${PUB}.view`, `${PRJ}.view`), async (req, res) => {
  res.json({ data: await researchMeta() })
})

// ───────────────────────────────────────────────────────── publications

const pubQuery = z.object({
  departmentId: objectId.or(z.literal('none')).optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  indexing: z.enum(RESEARCH_INDEXING.map((x) => x.value)).optional(),
  type: z.enum(RESEARCH_PUB_TYPES.map((x) => x.value)).optional(),
  authorId: objectId.optional(),
  search: z.string().trim().max(80).optional(),
})
const clearEmpty = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined))

const pubBody = z.object({
  title: z.string().trim().min(3, 'Enter the title').max(400),
  type: z.enum(RESEARCH_PUB_TYPES.map((x) => x.value)).default('JOURNAL'),
  authors: z.array(z.object({ userId: objectId.optional().nullable(), name: z.string().trim().max(120).optional() })
    .refine((a) => a.userId || a.name, 'Name the author')).min(1, 'Add at least one author').max(60),
  venue: optionalText(300),
  year: z.coerce.number().int().min(1950, 'Use a year like 2024').max(2100),
  volume: optionalText(20), issue: optionalText(20), pages: optionalText(30),
  doi: z.string().trim().max(200).optional().nullable(),
  issn: optionalText(20), isbn: optionalText(20), patentNo: optionalText(40),
  indexing: z.array(z.enum(RESEARCH_INDEXING.map((x) => x.value))).max(5).default([]),
  impactFactor: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(999).nullable().optional()),
  citations: z.coerce.number().int().min(0).max(1_000_000).default(0),
  departmentId: nullableId,
  url: z.string().trim().url('Enter a web address').max(500).optional().nullable().or(z.literal('').transform(() => null)),
})

router.get('/publications', requirePermission(`${PUB}.view`), async (req, res) => {
  res.json({ data: await listPublications(pubQuery.parse(clearEmpty(req.query)), req.auth) })
})
router.get('/publications/export', requirePermission(`${PUB}.export`), async (req, res) => {
  csv(res, 'publications.csv', await exportPublications(pubQuery.parse(clearEmpty(req.query)), req.auth))
})
router.post('/publications/import', requirePermission(`${PUB}.create`), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(5000), dryRun: z.boolean().default(false) }).parse(req.body)
  res.json({ data: await importPublications(rows, { dryRun }, req.auth, req) })
})
router.get('/publications/:id', requirePermission(`${PUB}.view`), async (req, res) => {
  res.json({ data: await getPublication(id(req), req.auth) })
})
router.post('/publications', requirePermission(`${PUB}.create`), async (req, res) => {
  res.status(201).json({ data: await savePublication(null, pubBody.parse(req.body), req.auth, req) })
})
router.patch('/publications/:id', requirePermission(`${PUB}.edit`), async (req, res) => {
  const body = pubBody.partial().parse(req.body)
  for (const k of ['type', 'indexing', 'citations']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await savePublication(id(req), body, req.auth, req) })
})
router.delete('/publications/:id', requirePermission(`${PUB}.delete`), async (req, res) => {
  res.json({ data: await deletePublication(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── projects & grants

const projectBody = z.object({
  title: z.string().trim().min(3, 'Enter the title').max(300),
  piId: objectId,
  coPiIds: z.array(objectId).max(10).default([]),
  agency: z.enum(RESEARCH_AGENCIES.map((x) => x.value)),
  agencyName: optionalText(160), scheme: optionalText(160), referenceNo: optionalText(80),
  departmentId: nullableId,
  sanctioned: paise.default(0), received: paise.default(0), utilised: paise.default(0),
  appliedOn: optYmd, sanctionedOn: optYmd, startDate: optYmd, endDate: optYmd,
  status: z.enum(Object.keys(RESEARCH_PROJECT_STATUS)).default('APPLIED'),
  notes: optionalText(2000),
})

router.get('/projects', requirePermission(`${PRJ}.view`), async (req, res) => {
  const q = z.object({
    status: z.enum(Object.keys(RESEARCH_PROJECT_STATUS)).optional(),
    agency: z.enum(RESEARCH_AGENCIES.map((x) => x.value)).optional(),
    departmentId: objectId.optional(),
    search: z.string().trim().max(80).optional(),
  }).parse(clearEmpty(req.query))
  res.json({ data: await listProjects(q, req.auth) })
})
router.post('/projects', requirePermission(`${PRJ}.create`), async (req, res) => {
  res.status(201).json({ data: await saveProject(null, projectBody.parse(req.body), req.auth, req) })
})
router.patch('/projects/:id', requirePermission(`${PRJ}.edit`), async (req, res) => {
  const body = projectBody.partial().parse(req.body)
  for (const k of ['coPiIds', 'sanctioned', 'received', 'utilised', 'status']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveProject(id(req), body, req.auth, req) })
})
router.delete('/projects/:id', requirePermission(`${PRJ}.delete`), async (req, res) => {
  res.json({ data: await deleteProject(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── Ph.D. scholars (a tab of Projects & grants)

const scholarBody = z.object({
  name: z.string().trim().min(2, 'Enter the scholar’s name').max(120),
  enrolmentNo: optionalText(30),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional().nullable().or(z.literal('').transform(() => null)),
  guideId: objectId,
  coGuideId: nullableId,
  departmentId: nullableId,
  topic: optionalText(400),
  mode: z.enum(RESEARCH_SCHOLAR_MODES.map((x) => x.value)).default('FULL_TIME'),
  registrationDate: ymd,
  status: z.enum(Object.keys(RESEARCH_SCHOLAR_STATUS)).default('REGISTERED'),
  awardedOn: optYmd,
  fellowship: optionalText(80),
})

router.get('/scholars', requirePermission(`${PRJ}.view`), async (req, res) => {
  const q = z.object({
    status: z.enum(Object.keys(RESEARCH_SCHOLAR_STATUS)).optional(),
    guideId: objectId.optional(),
    search: z.string().trim().max(80).optional(),
  }).parse(clearEmpty(req.query))
  res.json({ data: await listScholars(q, req.auth) })
})
router.post('/scholars', requirePermission(`${PRJ}.create`), async (req, res) => {
  res.status(201).json({ data: await saveScholar(null, scholarBody.parse(req.body), req.auth, req) })
})
router.patch('/scholars/:id', requirePermission(`${PRJ}.edit`), async (req, res) => {
  const body = scholarBody.partial().parse(req.body)
  for (const k of ['mode', 'status']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveScholar(id(req), body, req.auth, req) })
})
router.delete('/scholars/:id', requirePermission(`${PRJ}.delete`), async (req, res) => {
  res.json({ data: await deleteScholar(id(req), req.auth, req) })
})

export default router
