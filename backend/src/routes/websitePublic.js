import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { getContext } from '../platform/context.js'
import { AppError } from '../platform/errors.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { publicImage, publicPage } from '../services/website.js'

// The institution's public website: /api/v1/public/site/:slug — no sign-in. The institution is found by its slug
// (never by an id from the request); everything answers 404 while the module is off, the site is switched off, the
// page isn't published, or the subscription has stopped. Only `live` (published) content is ever read here.
const router = Router({ mergeParams: true })
const pageLimiter = rateLimit({ windowMs: 60_000, limit: config.isTest ? 1000 : 240, message: { message: 'Too many requests. Try again in a minute.' }, standardHeaders: true, legacyHeaders: false })
const gone = () => new AppError(404, 'This website isn’t available.', { code: 'SITE_OFF' })

async function school(req, res, next) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw gone()
  const tenant = await Tenant.findOne({ slug }).lean()
  if (!tenant || BLOCKED_STATUSES.includes(effectiveStatus(tenant))) throw gone()
  if (!(await enabledModuleIds(tenant._id)).includes('website')) throw gone()
  Object.assign(getContext(), { tenantId: String(tenant._id), userId: null, userName: 'Website' })
  req.school = { tenant }
  next()
}
router.use(pageLimiter, school)

const send = async (req, res, page) => {
  const out = await publicPage(req.school.tenant, page)
  if (!out) throw page ? new AppError(404, 'Page not found.', { code: 'PAGE_NOT_FOUND' }) : gone()
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.json({ data: out })
}
router.get('/', async (req, res) => { await send(req, res, null) })
router.get('/pages/:page', async (req, res) => {
  const page = String(req.params.page ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,40}$/.test(page)) throw new AppError(404, 'Page not found.')
  await send(req, res, page)
})
router.get('/images/:id', async (req, res) => {
  const img = await publicImage(String(req.params.id))
  res.setHeader('Content-Type', img.mime)
  res.setHeader('Content-Length', String(img.data.length))
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.end(img.data)
})

export default router
