import { Router } from 'express'
import { SITE_BLOCK_BY, SITE_PAGE_KINDS, isSiteLink } from '@schoolgiant/shared'
import { can } from '../platform/access.js'
import { forbidden } from '../platform/errors.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, z } from '../platform/validate.js'
import {
  createPage, deleteImage, deletePage, getPage, imageFile, listImages, listPages, previewPage, publishPage, reorderPages, savePage, saveSiteSettings,
  siteSettings, unpublishPage, uploadImage,
} from '../services/website.js'

// website: /api/v1/website/*  — the public site's pages (draft → publish), pictures and the site's details
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('website'))

const text = (max) => z.string().trim().max(max).default('')
const link = z.string().trim().max(500).refine(isSiteLink, 'Use a page of the site (/…), an https:// address, mailto: or tel:').default('')
const imageId = objectId.nullable().optional().default(null)
const count = z.coerce.number().int().min(1).max(10).default(5)
const latLng = (min, max) => z.coerce.number().min(min).max(max).nullable().optional().default(null)

const blockData = {
  HERO: z.object({ heading: text(120), subheading: text(300), imageId, buttonLabel: text(40), buttonLink: link, apply: z.boolean().default(false) }),
  TEXT: z.object({ heading: text(120), body: text(8000) }),
  GALLERY: z.object({ heading: text(120), images: z.array(z.object({ imageId: objectId, caption: text(120) })).max(SITE_BLOCK_BY.GALLERY.max).default([]) }),
  STATS: z.object({ heading: text(120), items: z.array(z.object({ value: text(20), label: text(60) })).max(SITE_BLOCK_BY.STATS.max).default([]) }),
  CARDS: z.object({ heading: text(120), items: z.array(z.object({ title: text(80), text: text(400), imageId, link })).max(SITE_BLOCK_BY.CARDS.max).default([]) }),
  CTA: z.object({ heading: text(120), text: text(300), buttonLabel: text(40), buttonLink: link, apply: z.boolean().default(false) }),
  CONTACT: z.object({ heading: text(120), address: text(300), phone: text(40), email: text(120), lat: latLng(-90, 90), lng: latLng(-180, 180), showMap: z.boolean().default(true) }),
  NOTICES: z.object({ heading: text(120), count }),
  EVENTS: z.object({ heading: text(120), count }),
}
export const blockSchema = z.discriminatedUnion('type', Object.entries(blockData).map(([type, data]) => z.object({ id: z.string().trim().min(1).max(40), type: z.literal(type), data })))

const pageInput = z.object({
  title: z.string().trim().min(1, 'Give the page a title').max(80),
  slug: z.string().trim().max(40).optional(),
  inMenu: z.boolean().optional(),
  seo: z.object({ title: text(70), description: text(160) }).optional(),
  blocks: z.array(blockSchema).max(30).optional(),
})

router.get('/pages', requirePermission('website.pages.view'), async (req, res) => { res.json({ data: await listPages() }) })
router.post('/pages', requirePermission('website.pages.create'), async (req, res) => {
  const input = z.object({ title: z.string().trim().min(1, 'Give the page a title').max(80), kind: z.enum(SITE_PAGE_KINDS.map((k) => k.value)).default('CUSTOM'), slug: z.string().trim().max(40).optional() }).parse(req.body)
  res.status(201).json({ data: await createPage(input, req) })
})
router.put('/pages/order', requirePermission('website.pages.edit'), async (req, res) => {
  const { ids } = z.object({ ids: z.array(objectId).max(100) }).parse(req.body)
  res.json({ data: await reorderPages(ids, req) })
})
router.get('/pages/:id', requirePermission('website.pages.view'), async (req, res) => { res.json({ data: await getPage(objectId.parse(req.params.id)) }) })
router.patch('/pages/:id', requirePermission('website.pages.edit'), async (req, res) => {
  res.json({ data: await savePage(objectId.parse(req.params.id), pageInput.partial().parse(req.body), req) })
})
router.delete('/pages/:id', requirePermission('website.pages.delete'), async (req, res) => { res.json({ data: await deletePage(objectId.parse(req.params.id), req) }) })
router.get('/pages/:id/preview', requirePermission('website.pages.view'), async (req, res) => { res.json({ data: await previewPage(objectId.parse(req.params.id)) }) })
router.post('/pages/:id/publish', requirePermission('website.pages.publish'), async (req, res) => { res.json({ data: await publishPage(objectId.parse(req.params.id), req) }) })
router.post('/pages/:id/unpublish', requirePermission('website.pages.publish'), async (req, res) => { res.json({ data: await unpublishPage(objectId.parse(req.params.id), req) }) })

// the site as a whole
router.get('/site', requirePermission('website.pages.view'), async (req, res) => { res.json({ data: await siteSettings() }) })
router.put('/site', requirePermission('website.pages.edit'), async (req, res) => {
  const input = z.object({
    live: z.boolean().optional(),
    tagline: text(160).optional(), footer: text(300).optional(),
    contact: z.object({ phone: text(40), email: text(120), address: text(300) }).optional(),
    social: z.object({ facebook: link, instagram: link, youtube: link, x: link }).optional(),
  }).parse(req.body)
  if (input.live !== undefined && input.live !== (await siteSettings()).live && !can(req.auth, 'website.pages.publish')) throw forbidden('Switching the website on or off needs website.pages.publish.', { missing: ['website.pages.publish'] })
  res.json({ data: await saveSiteSettings(input, req) })
})

// pictures (resized in the browser; ≤ 300 KB each)
router.get('/images', requirePermission('website.pages.view'), async (req, res) => { res.json({ data: await listImages() }) })
router.post('/images', requirePermission('website.pages.create', 'website.pages.edit'), async (req, res) => {
  const input = z.object({ name: z.string().trim().max(120).optional(), dataUrl: z.string().max(450_000, 'Picture too large') }).parse(req.body)
  res.status(201).json({ data: await uploadImage(input, req) })
})
router.get('/images/:id', requirePermission('website.pages.view'), async (req, res) => {
  const img = await imageFile(objectId.parse(req.params.id))
  res.setHeader('Content-Type', img.mime)
  res.setHeader('Content-Length', String(img.data.length))
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.end(img.data)
})
router.delete('/images/:id', requirePermission('website.pages.edit', 'website.pages.delete'), async (req, res) => { res.json({ data: await deleteImage(objectId.parse(req.params.id), req) }) })

export default router
