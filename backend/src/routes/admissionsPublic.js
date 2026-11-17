import express, { Router } from 'express'
import { FILE_MAX_MB } from '@schoolgiant/shared'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { getContext } from '../platform/context.js'
import { AppError } from '../platform/errors.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { createApplication, createEnquiry, familyAcceptOffer, familyApplications, publicAdmissions, publicApplicationFile } from '../services/admissions.js'
import { readWhoPass, sendOtp, verifyOtpWho, whoPass } from '../services/otp.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { getSettings } from '../platform/settings.js'
import { applicationSchema } from './admissions.js'

// Families apply online: /api/v1/public/admissions/:slug/* — no sign-in. Applying takes the form straight away, unless
// the school asks for a code first (setting admissions.applyNeedsCode). Then — and always for checking or accepting —
// the mobile number is proven with a one-time code (services/otp.js, purpose ADMISSION), which gives a 30-minute pass
// sent with each later call. A family sees and
// accepts only the applications on the number it proved. The whole page answers 404 when the module is off or the
// school's subscription has stopped.
const router = Router({ mergeParams: true })
const limit = (windowMs, max, message) => rateLimit({ windowMs, limit: config.isTest ? 1000 : max, message: { message }, standardHeaders: true, legacyHeaders: false })
const pageLimiter = limit(60_000, 120, 'Too many requests. Try again in a minute.')
const writeLimiter = limit(15 * 60_000, 20, 'Too many tries from this network. Try again in a few minutes.')
const PURPOSE = 'ADMISSION'
const closed = () => new AppError(404, 'This school isn’t taking applications here.', { code: 'ADMISSIONS_OFF' })

async function school(req, res, next) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw closed()
  const tenant = await Tenant.findOne({ slug }).lean()
  if (!tenant || BLOCKED_STATUSES.includes(effectiveStatus(tenant))) throw closed()
  if (!(await enabledModuleIds(tenant._id)).includes('admissions')) throw closed()
  Object.assign(getContext(), { tenantId: String(tenant._id), userId: null, userName: 'Online admission' })
  req.school = { tenant, settings: await getSettings('admissions') }
  res.setHeader('Cache-Control', 'private, no-store')
  next()
}
router.use(pageLimiter, school)

router.get('/', async (req, res) => { res.json({ data: await publicAdmissions(req.school.tenant) }) })

router.post('/enquiry', writeLimiter, async (req, res) => {
  if (req.school.settings.websiteEnquiry === false) throw closed()
  const input = z.object({
    childName: z.string().trim().min(2).max(100), parentName: z.string().trim().min(2).max(100), mobile: z.string().trim().min(10).max(16),
    email: z.string().trim().max(120).optional(), classId: objectId.optional().or(z.literal('').transform(() => undefined)), dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
    note: z.string().trim().max(500).optional(), website: z.string().max(200).optional(), // honeypot: hidden from people, filled in by bots
  }).parse(req.body)
  if (input.website) { res.status(201).json({ data: { ok: true } }); return }
  const e = await createEnquiry({ ...input, website: undefined }, null, req, { website: true })
  res.status(201).json({ data: { ok: true, enquiryNo: e.enquiryNo } })
})

// a code to the family's mobile or email — whichever the school allows (Settings › Admissions › applyCodeBy)
router.post('/otp', writeLimiter, async (req, res) => {
  const { mobile, email } = z.object({ mobile: z.string().trim().min(10).max(16).optional(), email: z.string().trim().max(120).optional() }).parse(req.body)
  const by = req.school.settings.applyCodeBy ?? 'MOBILE'
  if (email && by === 'MOBILE') throw new AppError(400, 'This school confirms with a code to your mobile number.', { code: 'USE_MOBILE' })
  if (!email && by === 'EMAIL') throw new AppError(400, 'This school confirms with a code to your email address.', { code: 'USE_EMAIL' })
  res.json({ data: await sendOtp(email ? { email } : { mobile }, PURPOSE) })
})
router.post('/verify', writeLimiter, async (req, res) => {
  const { challengeId, code } = z.object({ challengeId: z.string().max(40), code: z.string().max(12) }).parse(req.body)
  const who = await verifyOtpWho(challengeId, code, PURPOSE)
  res.json({ data: { pass: whoPass(who, PURPOSE), ...(who.email ? { email: who.email } : { mobile: who.mobile.slice(-10) }) } })
})

/** What the family proved with the code: `{ mobile }` or `{ email }`. */
const passOf = (req) => readWhoPass(req.body?.pass, PURPOSE)

router.post('/apply', writeLimiter, async (req, res) => {
  if (!req.school.settings.onlineApplication) throw closed()
  const needsCode = !!req.school.settings.applyNeedsCode
  // hidden from people, filled in by bots: answer as if it went through, keep nothing
  if (!needsCode && req.body?.website) { res.status(201).json({ data: { applicationNo: '—', className: '', childName: '' } }); return }
  const input = applicationSchema.omit({ enquiryId: true, branchId: true }).parse(req.body)
  // with a code, the parent's number (or email) is the one just proven; without, what they typed
  const who = needsCode ? passOf(req) : {}
  const parent = { ...input.parent, ...(who.mobile && { mobile: who.mobile.slice(-10) }), ...(who.email && { email: who.email }) }
  const a = await createApplication({ ...input, parent }, null, req, { online: true })
  res.status(201).json({ data: { id: a.id, applicationNo: a.applicationNo, className: a.className, childName: a.childName, uploadKey: a.uploadKey } })
})
// the documents, right after sending: the file is the body, what it is rides in the query, the one-time key in a header
router.post('/applications/:id/files', writeLimiter, express.raw({ type: () => true, limit: `${FILE_MAX_MB}mb` }), async (req, res) => {
  const q = z.object({ category: optionalText(30), title: optionalText(120), side: z.enum(['FRONT', 'BACK']).optional() }).parse(req.query)
  let fileName = req.get('x-file-name') || 'file'
  try { fileName = decodeURIComponent(fileName) } catch { /* keep as sent */ }
  const f = await publicApplicationFile(objectId.parse(req.params.id), req.get('x-upload-key'), { ...q, fileName }, Buffer.isBuffer(req.body) ? req.body : null, req)
  res.status(201).json({ data: { id: f.id, fileName: f.fileName } })
})
router.post('/applications', async (req, res) => {
  res.json({ data: await familyApplications(passOf(req)) })
})
router.post('/applications/:id/accept', writeLimiter, async (req, res) => {
  res.json({ data: await familyAcceptOffer(passOf(req), req.params.id) })
})

export default router
