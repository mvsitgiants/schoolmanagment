import { Router } from 'express'
import { CO_PO_STRENGTH, ENROLMENT_STATUS, OBE_BLOOM_LEVELS, PROGRAM_COURSE_TYPES, PROGRAM_LEVELS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  attainmentSessions, deleteCourse, deleteEnrolment, deleteProgram, deleteRegulation, enrolStudents, enrolmentCandidates, getProgram,
  listEnrolments, listPrograms, listRegulations, outcomesBoard, programAttainment, programLookup, saveCourse, saveCourseOutcomes,
  saveProgram, saveProgramOutcomes, saveRegulation, staffOptions, updateEnrolments,
} from '../services/programs.js'

// Programs & OBE: /api/v1/programs/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('programs'))

const id = (req) => objectId.parse(req.params.id)
const nullableId = objectId.optional().nullable().or(z.literal('').transform(() => null))
const code = (max = 12) => z.string().trim().toUpperCase().regex(new RegExp(`^[A-Z0-9][A-Z0-9-]{0,${max - 1}}$`), `1–${max} letters, digits or dashes`)
const num = (min, max) => z.coerce.number().min(min).max(max)
const VIEW_ANY = ['programs.programs.view', 'programs.outcomes.view', 'programs.attainment.view']

/** Programs and regulations for pickers (registration, exam controller). */
router.get('/lookup', async (req, res) => {
  res.json({ data: await programLookup(req.auth) })
})
router.get('/staff', requirePermission('programs.programs.view'), async (req, res) => {
  res.json({ data: await staffOptions() })
})

// ───────────────────────────────────────────────────────── regulations

const bandSchema = z.object({
  grade: z.string().trim().min(1).max(4), min: num(0, 100), max: num(0, 100), points: num(0, 10),
  label: optionalText(40), pass: z.boolean().default(true),
})
const regulationSchema = z.object({
  code: code(10),
  name: optionalText(80),
  effectiveFrom: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
  minCredits: num(0, 400),
  semesterMinCredits: num(0, 60),
  semesterMaxCredits: num(1, 60),
  gradeScale: z.array(bandSchema).min(2).max(15),
  passRules: z.object({ minInternalPct: num(0, 100), minExternalPct: num(0, 100), minTotalPct: num(0, 100) }),
  iaComponents: z.array(z.object({ code: code(8), name: z.string().trim().min(1).max(40), maxMarks: num(1, 200) })).min(1).max(10),
  gpa: z.object({ countFailed: z.boolean(), decimals: z.coerce.number().int().min(1).max(3), pctMultiplier: num(1, 10) }).partial().optional(),
  classification: z.array(z.object({ min: num(0, 10), label: z.string().trim().min(1).max(60) })).max(8).optional(),
  attainment: z.object({
    targetPct: num(1, 100), internalWeight: num(0, 100),
    levels: z.array(z.object({ level: z.coerce.number().int().min(1).max(3), min: num(0, 100) })).max(3),
  }).partial().optional(),
  active: z.boolean().optional(),
})

router.get('/regulations', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await listRegulations() })
})
router.post('/regulations', requirePermission('programs.programs.create'), async (req, res) => {
  res.status(201).json({ data: await saveRegulation(null, regulationSchema.parse(req.body), req) })
})
router.patch('/regulations/:id', requirePermission('programs.programs.edit'), async (req, res) => {
  res.json({ data: await saveRegulation(id(req), regulationSchema.partial().parse(req.body), req) })
})
router.delete('/regulations/:id', requirePermission('programs.programs.delete'), async (req, res) => {
  res.json({ data: await deleteRegulation(id(req), req) })
})

// ───────────────────────────────────────────────────────── courses

const courseBase = z.object({
  programId: objectId,
  code: code(12),
  title: z.string().trim().min(2, 'Enter the course title').max(120),
  semester: z.coerce.number().int().min(1).max(16),
  type: z.enum(Object.keys(PROGRAM_COURSE_TYPES)).default('CORE'),
  electiveGroup: z.string().trim().toUpperCase().max(10).optional().nullable().or(z.literal('').transform(() => null)),
  l: num(0, 20).default(3), t: num(0, 20).default(0), p: num(0, 20).default(0),
  credits: num(0.5, 30),
  internalMax: num(0, 200).default(40),
  externalMax: num(0, 200).default(60),
  prerequisiteIds: z.array(objectId).max(10).default([]),
  active: z.boolean().optional(),
})
const courseSchema = courseBase.refine((c) => c.internalMax + c.externalMax > 0, { message: 'Give the course some marks', path: ['externalMax'] })

router.post('/courses', requirePermission('programs.programs.create', 'programs.programs.edit'), async (req, res) => {
  res.status(201).json({ data: await saveCourse(null, courseSchema.parse(req.body), req) })
})
router.patch('/courses/:id', requirePermission('programs.programs.edit'), async (req, res) => {
  res.json({ data: await saveCourse(id(req), courseBase.omit({ programId: true }).partial().parse(req.body), req) })
})
router.delete('/courses/:id', requirePermission('programs.programs.delete', 'programs.programs.edit'), async (req, res) => {
  res.json({ data: await deleteCourse(id(req), req) })
})

const courseOutcomesSchema = z.object({
  outcomes: z.array(z.object({
    code: z.string().trim().toUpperCase().regex(/^CO\d{1,2}$/, 'CO1, CO2 …'),
    statement: z.string().trim().min(3, 'Write the outcome').max(400),
    bloom: z.enum(OBE_BLOOM_LEVELS.map((b) => b.value)).default('L2'),
  })).max(12),
  coPo: z.array(z.object({ co: z.string().trim().toUpperCase(), po: z.string().trim().toUpperCase(), level: z.coerce.number().int().refine((v) => CO_PO_STRENGTH.includes(v)) })).max(400).default([]),
  componentCos: z.array(z.object({ component: z.string().trim().toUpperCase(), cos: z.array(z.string().trim().toUpperCase()).max(12) })).max(10).optional(),
})
router.put('/courses/:id/outcomes', requirePermission('programs.outcomes.edit'), async (req, res) => {
  res.json({ data: await saveCourseOutcomes(id(req), courseOutcomesSchema.parse(req.body), req) })
})

// ───────────────────────────────────────────────────────── enrolments (students in a program)

const enrolmentPatch = z.object({
  currentSemester: z.coerce.number().int().min(1).max(16).optional(),
  status: z.enum(Object.keys(ENROLMENT_STATUS)).optional(),
  registerNo: z.string().trim().toUpperCase().max(20).optional().nullable(),
  advisorId: nullableId,
  batch: z.coerce.number().int().min(2000).max(2100).optional(),
  regulationId: objectId.optional(),
})
router.patch('/enrolments', requirePermission('programs.programs.edit'), async (req, res) => {
  const { ids, ...rest } = enrolmentPatch.extend({ ids: z.array(objectId).min(1).max(500) }).parse(req.body)
  res.json({ data: await updateEnrolments(ids, rest, req) })
})
router.patch('/enrolments/:id', requirePermission('programs.programs.edit'), async (req, res) => {
  res.json({ data: await updateEnrolments([id(req)], enrolmentPatch.parse(req.body), req) })
})
router.delete('/enrolments/:id', requirePermission('programs.programs.delete', 'programs.programs.edit'), async (req, res) => {
  res.json({ data: await deleteEnrolment(id(req), req) })
})
router.get('/candidates', requirePermission('programs.programs.edit'), async (req, res) => {
  res.json({ data: await enrolmentCandidates(z.string().max(60).optional().parse(req.query.search)) })
})

// ───────────────────────────────────────────────────────── programs

const programSchema = z.object({
  name: z.string().trim().min(2, 'Name the program').max(120),
  code: code(12),
  level: z.enum(Object.keys(PROGRAM_LEVELS)).default('UG'),
  departmentId: nullableId,
  branchId: nullableId,
  durationYears: num(1, 8),
  semesters: z.coerce.number().int().min(1).max(16),
  intake: z.coerce.number().int().min(0).max(5000).optional().nullable(),
  regulationId: nullableId,
  coordinatorId: nullableId,
  active: z.boolean().optional(),
})

router.get('/', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await listPrograms() })
})
router.post('/', requirePermission('programs.programs.create'), async (req, res) => {
  res.status(201).json({ data: await saveProgram(null, programSchema.parse(req.body), req) })
})
router.get('/:id', requirePermission(...VIEW_ANY), async (req, res) => {
  res.json({ data: await getProgram(id(req)) })
})
router.patch('/:id', requirePermission('programs.programs.edit'), async (req, res) => {
  res.json({ data: await saveProgram(id(req), programSchema.partial().parse(req.body), req) })
})
router.delete('/:id', requirePermission('programs.programs.delete'), async (req, res) => {
  res.json({ data: await deleteProgram(id(req), req) })
})

router.get('/:id/students', requirePermission('programs.programs.view'), async (req, res) => {
  const q = z.object({ semester: z.coerce.number().int().min(1).max(16).optional(), status: z.enum(Object.keys(ENROLMENT_STATUS)).optional() }).parse(req.query)
  res.json({ data: await listEnrolments(id(req), q) })
})
router.post('/:id/students', requirePermission('programs.programs.edit'), async (req, res) => {
  const input = z.object({
    studentIds: z.array(objectId).min(1, 'Pick the students').max(500),
    batch: z.coerce.number().int().min(2000).max(2100),
    currentSemester: z.coerce.number().int().min(1).max(16).default(1),
    regulationId: objectId.optional(),
    advisorId: objectId.optional(),
  }).parse(req.body)
  res.status(201).json({ data: await enrolStudents(id(req), input, req) })
})

// outcomes
router.get('/:id/outcomes', requirePermission('programs.outcomes.view', 'programs.attainment.view'), async (req, res) => {
  res.json({ data: await outcomesBoard(id(req)) })
})
router.put('/:id/outcomes', requirePermission('programs.outcomes.edit'), async (req, res) => {
  const { outcomes } = z.object({
    outcomes: z.array(z.object({
      code: z.string().trim().toUpperCase().regex(/^P(S)?O\d{1,2}$/, 'PO1 … or PSO1 …'),
      kind: z.enum(['PO', 'PSO']).optional(),
      title: z.string().trim().min(2, 'Name the outcome').max(120),
      description: optionalText(600),
    })).max(30),
  }).parse(req.body)
  res.json({ data: await saveProgramOutcomes(id(req), outcomes.map((o) => ({ ...o, kind: o.code.startsWith('PSO') ? 'PSO' : 'PO' })), req) })
})

// attainment
router.get('/:id/attainment', requirePermission('programs.attainment.view'), async (req, res) => {
  res.json({ data: await programAttainment(id(req), req.query.sessionId ? objectId.parse(req.query.sessionId) : undefined) })
})
router.get('/:id/attainment/sessions', requirePermission('programs.attainment.view'), async (req, res) => {
  res.json({ data: await attainmentSessions(id(req)) })
})

export default router
