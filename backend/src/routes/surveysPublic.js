import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { getContext } from '../platform/context.js'
import { AppError } from '../platform/errors.js'
import { z } from '../platform/validate.js'
import { publicRespond, publicSurvey } from '../services/surveysFill.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'

// A survey's public link: /api/v1/public/surveys/:slug/:token — no sign-in. Only surveys sent to "anyone with the
// link" (audience PUBLIC) answer here; the whole page is 404 when the module is off or the subscription has stopped.
const router = Router({ mergeParams: true })
const limit = (windowMs, max, message) => rateLimit({ windowMs, limit: config.isTest ? 1000 : max, message: { message }, standardHeaders: true, legacyHeaders: false })
const pageLimiter = limit(60_000, 120, 'Too many requests. Try again in a minute.')
const writeLimiter = limit(15 * 60_000, 30, 'Too many answers from this network. Try again in a few minutes.')
const gone = () => new AppError(404, 'This survey isn’t available.', { code: 'SURVEY_OFF' })

async function school(req, res, next) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw gone()
  const tenant = await Tenant.findOne({ slug }).lean()
  if (!tenant || BLOCKED_STATUSES.includes(effectiveStatus(tenant))) throw gone()
  if (!(await enabledModuleIds(tenant._id)).includes('surveys')) throw gone()
  Object.assign(getContext(), { tenantId: String(tenant._id), userId: null, userName: 'Survey link' })
  res.setHeader('Cache-Control', 'private, no-store')
  next()
}
router.use(pageLimiter, school)

router.get('/:token', async (req, res) => {
  res.json({ data: await publicSurvey(req.params.token) })
})
router.post('/:token', writeLimiter, async (req, res) => {
  const body = z.object({
    values: z.record(z.string(), z.any()).default({}),
    clientKey: z.string().max(64).optional(),
    name: z.string().trim().max(100).optional(),
    website: z.string().max(200).optional(), // honeypot: hidden from people, filled in by bots
  }).parse(req.body)
  if (body.website) { res.status(201).json({ data: { submitted: true } }); return }
  res.status(201).json({ data: await publicRespond(req.params.token, body) })
})

export default router
