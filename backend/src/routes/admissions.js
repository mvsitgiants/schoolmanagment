import { Router } from 'express'
import { APPLICATION_STATUS, ENQUIRY_SOURCES, ENQUIRY_STAGES, FOLLOWUP_TYPES, GENDERS, GUARDIAN_RELATIONS, MERIT_BASES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  addFollowUp, admitApplicant, allotSeats, assignTest, createApplication, createEnquiry, deleteEnquiry, deleteTest, getApplication, getEnquiry, listApplications, listCycles, listEnquiries,
  listTests, meritList, publishMerit, saveCycle, saveTest, saveTestMarks, setApplicationStatus, setCycleStatus, testSheet, updateApplication, updateEnquiry,
} from '../services/admissions.js'

// Admissions: /api/v1/admissions/*  (families apply at /api/v1/public/admissions/:slug)
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('admissions'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const optId = objectId.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const values = (list) => list.map((x) => x.value)
const mobile = z.string().trim().min(10, 'Enter a 10-digit mobile number').max(16)

// ───────────────────────────────────────────────────────── cycles

const cycleSchema = z.object({
  name: z.string().trim().min(3, 'Name the cycle').max(80),
  academicYearId: optId, opensOn: optYmd, closesOn: optYmd, formId: optId, instructions: optionalText(2000),
  classes: z.array(z.object({
    classId: objectId, seats: z.coerce.number().int().min(0).max(5000),
    minAge: z.coerce.number().int().min(0).max(30).optional().or(z.literal('').transform(() => undefined)), maxAge: z.coerce.number().int().min(0).max(40).optional().or(z.literal('').transform(() => undefined)),
    meritBasis: z.enum(values(MERIT_BASES)).default('TEST'), testRequired: z.boolean().optional(),
  })).max(40),
})
router.get('/cycles', requirePermission('admissions.settings.view', 'admissions.applications.view', 'admissions.enquiries.view', 'admissions.merit.view', 'admissions.tests.view'), async (req, res) => {
  res.json({ data: await listCycles() })
})
router.post('/cycles', requirePermission('admissions.settings.edit'), async (req, res) => {
  res.status(201).json({ data: await saveCycle(null, cycleSchema.parse(req.body), req.auth, req) })
})
router.patch('/cycles/:id', requirePermission('admissions.settings.edit'), async (req, res) => {
  res.json({ data: await saveCycle(id(req), cycleSchema.parse(req.body), req.auth, req) })
})
router.post('/cycles/:id/status', requirePermission('admissions.settings.edit'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['DRAFT', 'OPEN', 'CLOSED']) }).parse(req.body)
  res.json({ data: await setCycleStatus(id(req), status, req) })
})

// ───────────────────────────────────────────────────────── enquiries

const enquirySchema = z.object({
  childName: z.string().trim().min(2, 'Enter the child’s name').max(100), dob: optYmd, gender: z.enum(values(GENDERS)).optional().or(z.literal('').transform(() => undefined)),
  parentName: optionalText(100), mobile, email: email.optional().or(z.literal('').transform(() => undefined)), locality: optionalText(120), currentSchool: optionalText(120),
  classId: optId, cycleId: optId, branchId: optId, source: z.enum(values(ENQUIRY_SOURCES)).default('WALK_IN'), campaign: optionalText(80),
  assignedToId: optId, assignedTo: optionalText(80), note: optionalText(1000),
})
router.get('/enquiries', requirePermission('admissions.enquiries.view'), async (req, res) => {
  const q = z.object({
    stage: z.enum(Object.keys(ENQUIRY_STAGES)).optional(), source: z.enum(values(ENQUIRY_SOURCES)).optional(), classId: objectId.optional(),
    open: z.enum(['1', 'true']).optional().transform((v) => !!v), due: z.enum(['1', 'true']).optional().transform((v) => !!v), mine: z.enum(['1', 'true']).optional().transform((v) => !!v),
  }).parse(req.query)
  res.json(await listEnquiries(q, pageParams(req.query), req.auth))
})
router.post('/enquiries', requirePermission('admissions.enquiries.create'), async (req, res) => {
  res.status(201).json({ data: await createEnquiry(enquirySchema.parse(req.body), req.auth, req) })
})
router.get('/enquiries/:id', requirePermission('admissions.enquiries.view'), async (req, res) => {
  res.json({ data: await getEnquiry(id(req), req.auth) })
})
router.patch('/enquiries/:id', requirePermission('admissions.enquiries.edit'), async (req, res) => {
  const input = enquirySchema.partial().extend({ stage: z.enum(Object.keys(ENQUIRY_STAGES)).optional(), lostReason: optionalText(120), nextFollowUpOn: optYmd }).parse(req.body)
  res.json({ data: await updateEnquiry(id(req), input, req.auth, req) })
})
router.delete('/enquiries/:id', requirePermission('admissions.enquiries.delete'), async (req, res) => {
  res.json({ data: await deleteEnquiry(id(req), req.auth, req) })
})
router.post('/enquiries/:id/follow-ups', requirePermission('admissions.enquiries.edit'), async (req, res) => {
  const input = z.object({ type: z.enum(values(FOLLOWUP_TYPES)), note: z.string().trim().min(1, 'Say what happened').max(1000), nextOn: optYmd, stage: z.enum(['NEW', 'CONTACTED', 'VISIT', 'VISITED', 'LOST']).optional() }).parse(req.body)
  res.json({ data: await addFollowUp(id(req), input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── applications

const person = z.object({ name: z.string().trim().min(2, 'Enter the name').max(100), relation: z.enum(values(GUARDIAN_RELATIONS)).optional().or(z.literal('').transform(() => undefined)), mobile, email: email.optional().or(z.literal('').transform(() => undefined)), occupation: optionalText(80) })
export const applicationSchema = z.object({
  cycleId: objectId, classId: objectId, enquiryId: optId, branchId: optId,
  child: z.object({
    firstName: z.string().trim().min(1, 'Enter the first name').max(60), middleName: optionalText(60), lastName: optionalText(60), dob: ymd,
    gender: z.enum(values(GENDERS)), bloodGroup: optionalText(5), category: optionalText(20), religion: optionalText(40), motherTongue: optionalText(40),
    previousSchool: z.object({ name: optionalText(120), board: optionalText(40), lastClass: optionalText(40) }).optional(),
  }),
  parent: person,
  otherParent: z.object({ name: optionalText(100), relation: z.enum(values(GUARDIAN_RELATIONS)).optional().or(z.literal('').transform(() => undefined)), mobile: optionalText(16) }).optional(),
  address: z.object({ line: optionalText(200), city: optionalText(60), state: optionalText(60), pincode: optionalText(10) }).optional(),
  answers: z.record(z.string(), z.any()).optional(),
})
router.get('/applications', requirePermission('admissions.applications.view'), async (req, res) => {
  const q = z.object({ cycleId: objectId.optional(), classId: objectId.optional(), testId: objectId.optional(), status: z.enum(Object.keys(APPLICATION_STATUS)).optional() }).parse(req.query)
  res.json(await listApplications(q, pageParams(req.query), req.auth))
})
router.post('/applications', requirePermission('admissions.applications.create'), async (req, res) => {
  res.status(201).json({ data: await createApplication(applicationSchema.parse(req.body), req.auth, req) })
})
router.get('/applications/:id', requirePermission('admissions.applications.view'), async (req, res) => {
  res.json({ data: await getApplication(id(req), req.auth) })
})
router.patch('/applications/:id', requirePermission('admissions.applications.edit'), async (req, res) => {
  const input = z.object({
    child: applicationSchema.shape.child.partial().optional(), parent: person.partial().optional(), otherParent: applicationSchema.shape.otherParent, address: applicationSchema.shape.address,
    score: z.coerce.number().min(0).max(1000).nullable().optional(), statusNote: optionalText(300),
  }).parse(req.body)
  res.json({ data: await updateApplication(id(req), input, req.auth, req) })
})
router.post('/applications/:id/status', requirePermission('admissions.applications.edit'), async (req, res) => {
  const input = z.object({ status: z.enum(['UNDER_REVIEW', 'SHORTLISTED', 'WAITLISTED', 'REJECTED', 'WITHDRAWN', 'ACCEPTED']), note: optionalText(300) }).parse(req.body)
  res.json({ data: await setApplicationStatus(id(req), input, req.auth, req) })
})
router.post('/applications/:id/admit', requirePermission('admissions.applications.approve'), async (req, res) => {
  const input = z.object({ sectionId: objectId, admissionNo: optionalText(30) }).parse(req.body)
  res.json({ data: await admitApplicant(id(req), input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── entrance tests

router.get('/tests', requirePermission('admissions.tests.view'), async (req, res) => {
  res.json({ data: await listTests(req.query.cycleId ? objectId.parse(req.query.cycleId) : undefined) })
})
const testSchema = z.object({
  cycleId: objectId, name: z.string().trim().min(2).max(80), classIds: z.array(objectId).min(1, 'Pick the classes').max(40), date: ymd,
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal('').transform(() => undefined)), venue: optionalText(120),
  maxMarks: z.coerce.number().int().min(1).max(1000).default(100), instructions: optionalText(1000),
})
router.post('/tests', requirePermission('admissions.tests.create'), async (req, res) => {
  res.status(201).json({ data: await saveTest(null, testSchema.parse(req.body), req.auth, req) })
})
router.patch('/tests/:id', requirePermission('admissions.tests.edit'), async (req, res) => {
  res.json({ data: await saveTest(id(req), testSchema.parse(req.body), req.auth, req) })
})
router.delete('/tests/:id', requirePermission('admissions.tests.delete'), async (req, res) => {
  res.json({ data: await deleteTest(id(req), req) })
})
router.post('/tests/:id/assign', requirePermission('admissions.tests.edit', 'admissions.tests.create'), async (req, res) => {
  const { applicationIds } = z.object({ applicationIds: z.array(objectId).max(2000).optional() }).parse(req.body ?? {})
  res.json({ data: await assignTest(id(req), applicationIds, req.auth, req) })
})
router.get('/tests/:id/marks', requirePermission('admissions.tests.view'), async (req, res) => {
  res.json({ data: await testSheet(id(req)) })
})
router.put('/tests/:id/marks', requirePermission('admissions.tests.edit'), async (req, res) => {
  const { entries } = z.object({ entries: z.array(z.object({ applicationId: objectId, marks: z.coerce.number().min(0).nullable().optional(), absent: z.boolean().optional() })).max(2000) }).parse(req.body)
  res.json({ data: await saveTestMarks(id(req), entries, req.auth, req) })
})

// ───────────────────────────────────────────────────────── merit lists and seats

const meritKey = (req) => z.object({ cycleId: objectId, classId: objectId }).parse({ cycleId: req.params.cycleId, classId: req.params.classId })
router.get('/merit/:cycleId/:classId', requirePermission('admissions.merit.view'), async (req, res) => {
  const k = meritKey(req)
  res.json({ data: await meritList(k.cycleId, k.classId) })
})
router.post('/merit/:cycleId/:classId/publish', requirePermission('admissions.merit.publish'), async (req, res) => {
  const k = meritKey(req)
  res.json({ data: await publishMerit(k.cycleId, k.classId, req.auth, req) })
})
router.post('/merit/:cycleId/:classId/allot', requirePermission('admissions.merit.allot'), async (req, res) => {
  const k = meritKey(req)
  res.json({ data: await allotSeats(k.cycleId, k.classId, req.auth, req) })
})

export default router
