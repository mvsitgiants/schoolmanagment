import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { getContext } from '../platform/context.js'
import { AppError } from '../platform/errors.js'
import { objectId, z } from '../platform/validate.js'
import { createApplication, createEnquiry, familyAcceptOffer, familyApplications, publicAdmissions } from '../services/admissions.js'
import { mobilePass, readMobilePass, sendOtp, verifyOtp } from '../services/otp.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { getSettings } from '../platform/settings.js'
import { applicationSchema } from './admissions.js'

// Families apply online: /api/v1/public/admissions/:slug/* — no sign-in. The mobile number is proven with a one-time
// code (services/otp.js, purpose ADMISSION), which gives a 30-minute pass sent with each later call. A family sees and
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

router.post('/otp', writeLimiter, async (req, res) => {
  const { mobile } = z.object({ mobile: z.string().trim().min(10).max(16) }).parse(req.body)
  res.json({ data: await sendOtp(mobile, PURPOSE) })
})
router.post('/verify', writeLimiter, async (req, res) => {
  const { challengeId, code } = z.object({ challengeId: z.string().max(40), code: z.string().max(12) }).parse(req.body)
  const mobile = await verifyOtp(challengeId, code, PURPOSE)
  res.json({ data: { pass: mobilePass(mobile, PURPOSE) } })
})

const passOf = (req) => readMobilePass(req.body?.pass, PURPOSE)

router.post('/apply', writeLimiter, async (req, res) => {
  if (!req.school.settings.onlineApplication) throw closed()
  const mobile = passOf(req)
  const input = applicationSchema.omit({ enquiryId: true, branchId: true }).parse(req.body)
  // the parent's number is the one just proven
  const a = await createApplication({ ...input, parent: { ...input.parent, mobile: mobile.slice(-10) } }, null, req, { online: true })
  res.status(201).json({ data: { applicationNo: a.applicationNo, className: a.className, childName: a.childName } })
})
router.post('/applications', async (req, res) => {
  res.json({ data: await familyApplications(passOf(req)) })
})
router.post('/applications/:id/accept', writeLimiter, async (req, res) => {
  res.json({ data: await familyAcceptOffer(passOf(req), req.params.id) })
})

export default router
