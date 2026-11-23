import { Router } from 'express'
import { BLOOD_GROUPS, CONDUCT_OPTIONS, GENDERS, GUARDIAN_RELATIONS, LEAVING_REASONS, PHOTO_DATA_URL, PHOTO_MAX_CHARS, PROMOTION_OUTCOMES, STUDENT_CATEGORIES, TC_FAILED, TC_STATUS } from '@schoolgiant/shared'
import { can } from '../platform/access.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, mobile, objectId, optionalText, pageParams, z } from '../platform/validate.js'
import { getStudentPhoto, idCardList, setStudentPhoto } from '../services/students.js'
import { studentOverview } from '../services/student360.js'
import { cancelAdmissionForm, createAdmissionForm, getAdmissionForm, listAdmissionForms, resendAdmissionForm } from '../services/admissionForms.js'
import {
  admitStudent, cancelTc, getStudent, importStudents, issueTc, listGuardians, listStudents, listTcs, promotionPreview, requestTc,
  runPromotion, setStudentStatus, tcChecks, tcPrefill, tcWindUpStep, updateStudent, updateTc,
} from '../services/students.js'

// Students: /api/v1/students/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('students'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined))
const values = (list) => list.map((x) => x.value)
const optEnum = (list) => z.enum(list).optional().or(z.literal('').transform(() => undefined))
// one page of a list: 50 rows by default, at most 100 (the platform's clamp)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }

const guardianSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(100),
  relation: optEnum(values(GUARDIAN_RELATIONS)),
  mobile: mobile.optional().or(z.literal('').transform(() => undefined)),
  email: email.optional().or(z.literal('').transform(() => undefined)),
  occupation: optionalText(80),
  isPrimary: z.boolean().optional(),
})

export const studentSchema = z.object({
  admissionNo: optionalText(30),
  firstName: z.string().trim().min(1, 'Enter the first name').max(60),
  middleName: optionalText(60),
  lastName: optionalText(60),
  gender: optEnum(values(GENDERS)),
  dob: optYmd,
  bloodGroup: optEnum(BLOOD_GROUPS),
  category: optEnum(values(STUDENT_CATEGORIES)),
  religion: optionalText(40),
  nationality: optionalText(40),
  motherTongue: optionalText(40),
  admissionDate: optYmd,
  sectionId: objectId,
  rollNo: optionalText(10),
  mobile: mobile.optional().or(z.literal('').transform(() => undefined)),
  email: email.optional().or(z.literal('').transform(() => undefined)),
  address: z.object({ line: optionalText(200), city: optionalText(60), state: optionalText(60), pincode: optionalText(10) }).optional(),
  guardians: z.array(guardianSchema).max(6).default([]),
  aadhaar: z.string().trim().max(20).optional(),
  apaarId: optionalText(20),
  pen: optionalText(20),
  previousSchool: z.object({
    name: optionalText(120), board: optionalText(40), lastClass: optionalText(30), tcNo: optionalText(30),
    tcDate: optYmd, nameOnTc: optionalText(120), dobOnTc: optYmd, mismatchNote: optionalText(300),
  }).optional(),
  medical: z.object({ allergies: optionalText(200), conditions: optionalText(200), notes: optionalText(500) }).optional(),
  language: optionalText(20),
  consents: z.object({ communication: z.object({ sms: z.boolean(), whatsapp: z.boolean(), email: z.boolean() }).partial() }).optional(),
})

router.get('/', requirePermission('students.directory.view', 'students.profile.view'), async (req, res) => {
  const q = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'LEFT', 'PASSED_OUT', 'ALL']).optional(), sectionId: objectId.optional(), classId: objectId.optional(), gender: z.string().optional() }).parse(req.query)
  res.json(await listStudents(q, pageParams(req.query), req.auth))
})

router.post('/', requirePermission('students.admit.create'), async (req, res) => {
  // fromFormId: the admission form a family filled from a link — its files move to the student, the form closes
  const { fromFormId, ...body } = studentSchema.extend({ fromFormId: objectId.optional() }).parse(req.body)
  res.status(201).json({ data: await admitStudent(body, req.auth, req, { fromFormId }) })
})

// ───────────────────────────────────────────────────────── admission forms sent to families (New admission)

const channelsIn = z.array(z.enum(['SMS', 'WHATSAPP', 'EMAIL'])).max(3).default([])
router.get('/admission-forms', requirePermission('students.admit.create'), async (req, res) => {
  const q = z.object({ status: z.enum(['SENT', 'SUBMITTED', 'ADMITTED', 'CANCELLED', 'EXPIRED']).optional() }).parse(req.query)
  res.json({ data: await listAdmissionForms(q) })
})
router.post('/admission-forms', requirePermission('students.admit.create'), async (req, res) => {
  const input = z.object({
    childName: optionalText(100), parentName: optionalText(100),
    mobile: mobile.optional().or(z.literal('').transform(() => undefined)), email: email.optional().or(z.literal('').transform(() => undefined)),
    sectionId: objectId.optional().or(z.literal('').transform(() => undefined)), branchId: objectId.optional().or(z.literal('').transform(() => undefined)),
    channels: channelsIn,
  }).parse(req.body)
  res.status(201).json({ data: await createAdmissionForm(input, req.auth, req) })
})
router.get('/admission-forms/:id', requirePermission('students.admit.create'), async (req, res) => {
  res.json({ data: await getAdmissionForm(objectId.parse(req.params.id), req.auth) })
})
router.post('/admission-forms/:id/resend', requirePermission('students.admit.create'), async (req, res) => {
  const input = z.object({ channels: channelsIn, mobile: z.string().max(16).optional(), email: z.string().max(120).optional() }).parse(req.body ?? {})
  res.json({ data: await resendAdmissionForm(objectId.parse(req.params.id), input, req.auth, req) })
})
router.post('/admission-forms/:id/cancel', requirePermission('students.admit.create'), async (req, res) => {
  res.json({ data: await cancelAdmissionForm(objectId.parse(req.params.id), req.auth, req) })
})

router.post('/import', requirePermission('students.directory.import'), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).max(5000), dryRun: z.boolean().default(true) }).parse(req.body)
  res.json({ data: await importStudents(rows, { dryRun, schema: studentSchema }, req.auth, req) })
})

router.get('/guardians', requirePermission('students.guardians.view'), async (req, res) => {
  const q = z.object({ search: z.string().max(80).optional(), ...paging }).parse(req.query)
  res.json({ data: await listGuardians(q, req.auth) })
})

// ───────────────────────────────────────────────────────── promotion

router.get('/promotion', requirePermission('students.promotion.view'), async (req, res) => {
  const q = z.object({ fromSectionId: objectId, toYearId: objectId.optional() }).parse(req.query)
  res.json({ data: await promotionPreview(q) })
})
router.post('/promotion', requirePermission('students.promotion.promote'), async (req, res) => {
  const input = z.object({
    fromSectionId: objectId,
    decisions: z.array(z.object({ studentId: objectId, outcome: z.enum(values(PROMOTION_OUTCOMES)), toSectionId: objectId.optional().nullable() })).min(1).max(500),
  }).parse(req.body)
  res.json({ data: await runPromotion(input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── transfer certificates

router.get('/tc', requirePermission('students.transfer.view'), async (req, res) => {
  const q = z.object({ status: optEnum(Object.keys(TC_STATUS)), search: z.string().max(80).optional(), from: optYmd, to: optYmd, ...paging }).parse(req.query)
  res.json({ data: await listTcs(q, req.auth) })
})
// the rest of the CBSE-format TC: all optional, a blank line is printed for whatever is left empty
const optDays = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().min(0).max(400)]).optional()
const tcDetails = {
  bookNo: optionalText(30), applicationDate: optYmd, lastExam: optionalText(120), lastExamResult: optionalText(80), failed: optEnum(values(TC_FAILED)),
  subjects: z.array(z.string().trim().min(1).max(60)).max(20).optional(), concession: optionalText(120), workingDays: optDays, presentDays: optDays,
  nccScoutGuide: optionalText(120), games: optionalText(200),
}
router.get('/tc/prefill', requirePermission('students.transfer.create', 'students.transfer.approve'), async (req, res) => {
  res.json({ data: await tcPrefill(objectId.parse(req.query.studentId), req.auth) })
})
// what the records say is still open on the leaving date (fees, library, hostel, bus, canteen wallet)
router.get('/tc/checks', requirePermission('students.transfer.view', 'students.transfer.create', 'students.transfer.approve'), async (req, res) => {
  const q = z.object({ studentId: objectId, leavingDate: ymd }).parse(req.query)
  res.json({ data: await tcChecks(q.studentId, q.leavingDate, req.auth) })
})
router.post('/tc', requirePermission('students.transfer.create'), async (req, res) => {
  const input = z.object({
    studentId: objectId, leavingDate: ymd, reason: z.enum(values(LEAVING_REASONS)), reasonText: optionalText(200),
    conduct: z.enum(CONDUCT_OPTIONS).default('Good'), promotedTo: optionalText(120), feesPaidUpTo: optionalText(40), remarks: optionalText(500),
    ...tcDetails,
  }).parse(req.body)
  res.status(201).json({ data: await requestTc(input, req.auth, req) })
})
router.patch('/tc/:id', requirePermission('students.transfer.create', 'students.transfer.approve'), async (req, res) => {
  const input = z.object({
    leavingDate: ymd.optional(), reason: z.enum(values(LEAVING_REASONS)).optional(), reasonText: optionalText(200),
    conduct: z.enum(CONDUCT_OPTIONS).optional(), promotedTo: optionalText(120), feesPaidUpTo: optionalText(40), remarks: optionalText(500),
    ...tcDetails,
  }).parse(req.body)
  res.json({ data: await updateTc(objectId.parse(req.params.id), input, req.auth, req) })
})
router.post('/tc/:id/issue', requirePermission('students.transfer.approve'), async (req, res) => {
  // with dues open on the leaving date the TC is only issued "anyway", with a reason
  // windUp: what to wind up as it is issued — bills after leaving cancelled, off the bus route, out of the hostel
  const { override, windUp } = z.object({
    override: z.object({ reason: z.string().trim().min(5, 'Say why').max(300) }).optional(),
    windUp: z.array(z.enum(['laterBills', 'transport', 'hostel'])).max(3).default([]),
  }).parse(req.body ?? {})
  res.json({ data: await issueTc(objectId.parse(req.params.id), req.auth, req, { override, windUp }) })
})
router.post('/tc/:id/wind-up/:key', requirePermission('students.transfer.approve'), async (req, res) => {
  const key = z.enum(['laterBills', 'transport', 'hostel', 'canteen']).parse(req.params.key)
  const body = z.object({ action: z.enum(['do', 'undo']), mode: z.enum(['CASH', 'BANK']).optional(), reference: optionalText(60) }).parse(req.body ?? {})
  res.json({ data: await tcWindUpStep(objectId.parse(req.params.id), key, body.action, { mode: body.mode, reference: body.reference }, req.auth, req) })
})
router.post('/tc/:id/cancel', requirePermission('students.transfer.create', 'students.transfer.approve'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.json({ data: await cancelTc(objectId.parse(req.params.id), reason, req.auth, req) })
})

// ───────────────────────────────────────────────────────── one student

// ───────────────────────────────────────────────────────── ID cards and photos

router.get('/id-cards', requirePermission('students.id-cards.view'), async (req, res) => {
  res.json({ data: await idCardList(objectId.parse(req.query.sectionId), req.auth) })
})
const photo = z.literal('').or(z.string().max(PHOTO_MAX_CHARS, 'The photo is too large — use one under 200 KB').regex(PHOTO_DATA_URL, 'Upload a PNG, JPG or WebP image'))
router.get('/:id/photo', requirePermission('students.profile.view', 'students.id-cards.view'), async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await getStudentPhoto(objectId.parse(req.params.id), req.auth) })
})
router.put('/:id/photo', requirePermission('students.profile.edit', 'students.id-cards.print'), async (req, res) => {
  res.json({ data: await setStudentPhoto(objectId.parse(req.params.id), z.object({ photo }).parse(req.body).photo, req.auth, req) })
})

// Student 360: the student's school life in one read — a section per module the caller may see (services/student360.js)
router.get('/:id/overview', requirePermission('students.profile.view'), async (req, res) => {
  res.json({ data: await studentOverview(objectId.parse(req.params.id), req.auth) })
})

router.get('/:id', requirePermission('students.profile.view'), async (req, res) => {
  res.json({ data: await getStudent(req.params.id, req.auth, req, { reveal: req.query.reveal === '1' }) })
})

router.patch('/:id', requirePermission('students.profile.edit', 'students.guardians.edit'), async (req, res) => {
  // someone who only keeps parents' details may change the guardians, nothing else
  const schema = can(req.auth, 'students.profile.edit') ? studentSchema.partial() : studentSchema.pick({ guardians: true })
  res.json({ data: await updateStudent(objectId.parse(req.params.id), schema.parse(req.body), req.auth, req) })
})

router.post('/:id/status', requirePermission('students.profile.edit'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body)
  res.json({ data: await setStudentStatus(objectId.parse(req.params.id), status, req.auth, req) })
})

export default router
