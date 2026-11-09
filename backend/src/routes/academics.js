import { Router } from 'express'
import { CLASS_PRESETS, GRADING_KINDS, SEATING_KINDS, SEATING_LIMITS, SEAT_NUMBERING, SUBJECT_TYPES } from '@schoolgiant/shared'
import { can } from '../platform/access.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  allocationGrid, classBoard, deleteClass, deleteGrading, deleteSection, deleteSubject, deleteYear, importClasses, importSubjects, listClasses, listGrading,
  listSubjects, listYears, lookup, quickSetup, saveClass, saveGrading, saveSection, saveSubject, saveYear, setAllocation, setCurrentYear,
  setDefaultGrading, teacherOptions,
} from '../services/academics.js'

// Academic setup: /api/v1/academics/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('academics'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const nullableId = objectId.optional().nullable().or(z.literal('').transform(() => null))
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, '1–12 letters, digits or dashes')
const importBody = z.object({ rows: z.array(z.record(z.string(), z.any())).max(5000), dryRun: z.boolean().default(true) })
const q = (req) => z.object({ yearId: objectId.optional(), classId: objectId.optional() }).parse(req.query)

/** Everything the other screens need to pick a year, class, section or subject. Any signed-in user. */
router.get('/lookup', async (req, res) => {
  res.json({ data: await lookup(req.auth) })
})

// ───────────────────────────────────────────────────────── years

const yearSchema = z.object({
  name: z.string().trim().min(2, 'Name the year, e.g. 2026-27').max(20),
  startDate: ymd,
  endDate: ymd,
  terms: z.array(z.object({ name: z.string().trim().min(1, 'Name the term').max(40), startDate: ymd, endDate: ymd })).max(6).default([]),
  closed: z.boolean().optional(),
})

router.get('/years', requirePermission('academics.years.view'), async (req, res) => {
  res.json({ data: await listYears() })
})
router.post('/years', requirePermission('academics.years.create'), async (req, res) => {
  res.status(201).json({ data: await saveYear(null, yearSchema.parse(req.body), req) })
})
router.patch('/years/:id', requirePermission('academics.years.edit'), async (req, res) => {
  res.json({ data: await saveYear(objectId.parse(req.params.id), yearSchema.parse(req.body), req) })
})
router.post('/years/:id/current', requirePermission('academics.years.edit'), async (req, res) => {
  res.json({ data: await setCurrentYear(objectId.parse(req.params.id), req) })
})
router.delete('/years/:id', requirePermission('academics.years.delete'), async (req, res) => {
  res.json({ data: await deleteYear(objectId.parse(req.params.id), req) })
})

// ───────────────────────────────────────────────────────── subjects

const subjectSchema = z.object({
  name: z.string().trim().min(2, 'Enter the subject name').max(80),
  code,
  type: z.enum(SUBJECT_TYPES.map((t) => t.value)).default('THEORY'),
  departmentId: nullableId,
  active: z.boolean().optional(),
})

router.get('/subjects', requirePermission('academics.subjects.view', 'academics.classes.view', 'academics.allocation.view'), async (req, res) => {
  res.json({ data: await listSubjects() })
})
router.post('/subjects/import', requirePermission('academics.subjects.import'), async (req, res) => {
  const { rows, dryRun } = importBody.parse(req.body)
  res.json({ data: await importSubjects(rows, { dryRun, schema: subjectSchema }, req) })
})
router.post('/subjects', requirePermission('academics.subjects.create'), async (req, res) => {
  res.status(201).json({ data: await saveSubject(null, subjectSchema.parse(req.body), req) })
})
router.patch('/subjects/:id', requirePermission('academics.subjects.edit'), async (req, res) => {
  res.json({ data: await saveSubject(objectId.parse(req.params.id), subjectSchema.partial().parse(req.body), req) })
})
router.delete('/subjects/:id', requirePermission('academics.subjects.delete'), async (req, res) => {
  res.json({ data: await deleteSubject(objectId.parse(req.params.id), req) })
})

// ───────────────────────────────────────────────────────── grading schemes

const bandSchema = z.object({
  min: z.coerce.number(), max: z.coerce.number(), grade: z.string().trim().max(10),
  points: z.coerce.number().min(0).max(100).optional().nullable(), remark: optionalText(60),
})
const gradingSchema = z.object({
  name: z.string().trim().min(2, 'Name the scheme').max(60),
  kind: z.enum(GRADING_KINDS.map((k) => k.value)).default('GRADES'),
  bands: z.array(bandSchema).max(20),
  active: z.boolean().optional(),
})

router.get('/grading', requirePermission('academics.grading.view', 'academics.classes.view'), async (req, res) => {
  res.json({ data: await listGrading() })
})
router.post('/grading', requirePermission('academics.grading.create'), async (req, res) => {
  res.status(201).json({ data: await saveGrading(null, gradingSchema.parse(req.body), req) })
})
router.patch('/grading/:id', requirePermission('academics.grading.edit'), async (req, res) => {
  res.json({ data: await saveGrading(objectId.parse(req.params.id), gradingSchema.parse(req.body), req) })
})
router.post('/grading/:id/default', requirePermission('academics.grading.edit'), async (req, res) => {
  res.json({ data: await setDefaultGrading(objectId.parse(req.params.id), req) })
})
router.delete('/grading/:id', requirePermission('academics.grading.delete'), async (req, res) => {
  res.json({ data: await deleteGrading(objectId.parse(req.params.id), req) })
})

// ───────────────────────────────────────────────────────── classes and sections

const classSchema = z.object({
  name: z.string().trim().min(1, 'Name the class').max(60),
  code,
  order: z.coerce.number().int().min(0).max(1000).optional(),
  departmentId: nullableId,
  subjectIds: z.array(objectId).max(60).default([]),
  optionalSubjectIds: z.array(objectId).max(60).default([]),
  gradingSchemeId: nullableId,
  active: z.boolean().optional(),
})
const sectionSchema = z.object({
  classId: objectId,
  academicYearId: objectId.optional(),
  name: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{0,9}$/, 'Up to 10 letters or digits, e.g. A'),
  branchId: nullableId,
  classTeacherId: nullableId,
  capacity: z.coerce.number().int().min(1).max(500).optional().nullable(),
  room: optionalText(30),
  seating: z.object({
    kind: z.enum(Object.keys(SEATING_KINDS)),
    perBench: z.coerce.number().int().min(SEATING_LIMITS.perBench[0]).max(SEATING_LIMITS.perBench[1]).optional(),
    columns: z.coerce.number().int().min(SEATING_LIMITS.columns[0]).max(SEATING_LIMITS.columns[1]),
    rows: z.coerce.number().int().min(SEATING_LIMITS.rows[0]).max(SEATING_LIMITS.rows[1]),
    numbering: z.enum(Object.keys(SEAT_NUMBERING)).default('ROW'),
  }).nullable().optional(),
  active: z.boolean().optional(),
})

router.get('/classes', requirePermission('academics.classes.view', 'academics.allocation.view'), async (req, res) => {
  res.json({ data: await listClasses(q(req).yearId) })
})
/** The Class board's extras: gender split and today's attendance per section (caller's data scope). */
router.get('/board', requirePermission('academics.classes.view'), async (req, res) => {
  res.json({ data: await classBoard(req.auth, q(req).yearId) })
})
router.post('/classes/import', requirePermission('academics.classes.import'), async (req, res) => {
  const { rows, dryRun } = importBody.parse(req.body)
  res.json({ data: await importClasses(rows, { dryRun, schema: classSchema }, req) })
})
router.post('/classes/quick-setup', requirePermission('academics.classes.create'), async (req, res) => {
  const input = z.object({
    preset: z.enum(CLASS_PRESETS.map((p) => p.value)),
    sectionsPerClass: z.coerce.number().int().min(1).max(10).default(1),
    addSubjects: z.boolean().default(true),
    academicYearId: objectId.optional(),
    branchId: nullableId,
  }).parse(req.body)
  res.status(201).json({ data: await quickSetup(input, req) })
})
router.post('/classes', requirePermission('academics.classes.create'), async (req, res) => {
  res.status(201).json({ data: await saveClass(null, classSchema.parse(req.body), req) })
})
router.patch('/classes/:id', requirePermission('academics.classes.edit'), async (req, res) => {
  res.json({ data: await saveClass(objectId.parse(req.params.id), classSchema.partial().parse(req.body), req) })
})
router.delete('/classes/:id', requirePermission('academics.classes.delete'), async (req, res) => {
  res.json({ data: await deleteClass(objectId.parse(req.params.id), req) })
})

router.post('/sections', requirePermission('academics.classes.create'), async (req, res) => {
  res.status(201).json({ data: await saveSection(null, sectionSchema.parse(req.body), req) })
})
router.patch('/sections/:id', requirePermission('academics.classes.edit', 'academics.allocation.edit'), async (req, res) => {
  // whoever only allocates teachers may change the class teacher, nothing else
  const canEdit = can(req.auth, 'academics.classes.edit')
  const schema = canEdit ? sectionSchema.partial() : sectionSchema.pick({ classTeacherId: true })
  res.json({ data: await saveSection(objectId.parse(req.params.id), schema.parse(req.body), req) })
})
router.delete('/sections/:id', requirePermission('academics.classes.delete'), async (req, res) => {
  res.json({ data: await deleteSection(objectId.parse(req.params.id), req) })
})

// ───────────────────────────────────────────────────────── teacher allocation

router.get('/allocation', requirePermission('academics.allocation.view'), async (req, res) => {
  const { yearId, classId } = q(req)
  if (!classId) return res.json({ data: null })
  res.json({ data: await allocationGrid({ classId, academicYearId: yearId }) })
})
router.put('/allocation', requirePermission('academics.allocation.edit'), async (req, res) => {
  const input = z.object({
    sectionId: objectId, subjectId: objectId, teacherId: nullableId,
    periodsPerWeek: z.coerce.number().int().min(0).max(60).optional().nullable(),
  }).parse(req.body)
  res.json({ data: await setAllocation(input, req) })
})
router.get('/teachers', requirePermission('academics.allocation.view', 'academics.classes.view'), async (req, res) => {
  res.json({ data: await teacherOptions() })
})

export default router
