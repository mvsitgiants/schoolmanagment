import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { FILE_MAX_MB } from '@schoolgiant/shared'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { getContext } from '../platform/context.js'
import { AppError } from '../platform/errors.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { publicAdmissionForm, publicRemoveAdmissionFile, publicSubmitAdmissionForm, publicUploadAdmissionFile } from '../services/admissionForms.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { studentSchema } from './students.js'

// A family's admission form: /api/v1/public/admission-form/:slug/:token — no sign-in; the link's token is the key
// (services/admissionForms.js). The family reads what is there, adds and removes document files, and sends the form.
// The whole page answers 404 when the school's subscription has stopped or the students module is off.
const router = Router({ mergeParams: true })
const limit = (windowMs, max, message) => rateLimit({ windowMs, limit: config.isTest ? 1000 : max, message: { message }, standardHeaders: true, legacyHeaders: false })
const pageLimiter = limit(60_000, 120, 'Too many requests. Try again in a minute.')
const writeLimiter = limit(15 * 60_000, 120, 'Too many tries from this network. Try again in a few minutes.')
const gone = () => new AppError(404, 'This form isn’t available.', { code: 'FORM_OFF' })

async function school(req, res, next) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw gone()
  const tenant = await Tenant.findOne({ slug }).lean()
  if (!tenant || BLOCKED_STATUSES.includes(effectiveStatus(tenant))) throw gone()
  if (!(await enabledModuleIds(tenant._id)).includes('students')) throw gone()
  Object.assign(getContext(), { tenantId: String(tenant._id), userId: null, userName: 'Family (admission form)' })
  req.school = { tenant }
  res.setHeader('Cache-Control', 'private, no-store')
  next()
}
router.use(pageLimiter, school)

router.get('/:token', async (req, res) => {
  res.json({ data: await publicAdmissionForm(req.school.tenant, req.params.token) })
})

// what a family fills: the office's admission form without the office's own fields (class, numbers, dates)
const familySchema = studentSchema.omit({ admissionNo: true, sectionId: true, rollNo: true, admissionDate: true }).extend({
  localNames: z.object({
    student: z.record(z.string().max(5), z.string().max(300)).optional(),
    guardians: z.array(z.record(z.string().max(5), z.string().max(300)).nullable()).max(6).optional(),
  }).optional(),
})

router.post('/:token', writeLimiter, async (req, res) => {
  res.json({ data: await publicSubmitAdmissionForm(req.params.token, familySchema.parse(req.body), req) })
})

// the file itself is the body (as /api/v1/files); what it is rides in the query
router.post('/:token/files', writeLimiter, express.raw({ type: () => true, limit: `${FILE_MAX_MB}mb` }), async (req, res) => {
  const q = z.object({ category: optionalText(30), title: optionalText(120), side: z.enum(['FRONT', 'BACK']).optional() }).parse(req.query)
  let fileName = req.get('x-file-name') || 'file'
  try { fileName = decodeURIComponent(fileName) } catch { /* keep as sent */ }
  res.status(201).json({ data: await publicUploadAdmissionFile(req.params.token, { ...q, fileName }, Buffer.isBuffer(req.body) ? req.body : null, req) })
})
router.delete('/:token/files/:fileId', writeLimiter, async (req, res) => {
  res.json({ data: await publicRemoveAdmissionFile(req.params.token, objectId.parse(req.params.fileId)) })
})

export default router
