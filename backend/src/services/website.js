import { SITE_LIMITS, SITE_PAGE_KIND_BY, newSiteBlock, siteSlug } from '@schoolgiant/shared'
import { Notice } from '../models/communication.js'
import { SchoolEvent } from '../models/events.js'
import { Tenant } from '../models/platform.js'
import { WebsiteImage, WebsitePage, WebsiteSite } from '../models/website.js'
import { enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'

// Website (module `website`): the institution's public site. Staff edit each page's blocks as a draft; publishing
// (website.pages.publish) copies the draft to `live`, which is all the public ever sees. The theme comes from the
// institution profile (logo, brand colour). "Latest notices" shows published Communication-hub notices addressed to
// the whole school; "Upcoming events" shows published calendar events for everyone. Pictures are WebsiteImage rows
// (resized in the browser) served by the public router.

const MODULE = 'website'
const who = () => getContext()?.userName ?? 'Staff'

export const pageStatus = (p) => (!p.live ? 'DRAFT' : p.draftAt && p.publishedAt && p.draftAt > p.publishedAt ? 'CHANGED' : 'PUBLISHED')

const pageRow = (p) => ({
  id: String(p._id), title: p.title, slug: p.slug, kind: p.kind, order: p.order ?? 0, inMenu: p.inMenu !== false, status: pageStatus(p),
  blocks: (p.draft ?? []).length, publishedAt: p.publishedAt ?? null, publishedBy: p.publishedBy ?? null, draftAt: p.draftAt ?? null, updatedBy: p.updatedBy ?? null,
})
const pageFull = (p) => ({ ...pageRow(p), seo: { title: p.seo?.title ?? '', description: p.seo?.description ?? '' }, blocks: p.draft ?? [], liveBlocks: p.live?.length ?? 0 })

// ───────────────────────────────────────────────────────── starter pages

/** A new site starts with Home, About, Admissions and Contact as drafts, filled from the institution profile. */
export async function ensureStarterPages() {
  if (await WebsitePage.exists({})) return
  const t = await Tenant.findById(getContext().tenantId).select('name profile').lean()
  const p = t?.profile ?? {}
  const address = [p.addressLine, p.city, p.state, p.pincode].filter(Boolean).join(', ')
  const b = (type, data) => { const x = newSiteBlock(type); return { ...x, data: { ...x.data, ...data } } }
  const pages = [
    { kind: 'HOME', title: 'Home', blocks: [
      b('HERO', { heading: `Welcome to ${t?.name ?? 'our institution'}`, subheading: 'Learning, character and care — every day.', buttonLabel: 'Apply online', apply: true }),
      b('STATS', { heading: '', items: [{ value: '25+', label: 'Years' }, { value: '1,200', label: 'Students' }, { value: '80', label: 'Teachers' }] }),
      b('NOTICES', { heading: 'Latest notices', count: 5 }),
      b('EVENTS', { heading: 'Upcoming events', count: 5 }),
    ] },
    { kind: 'ABOUT', title: 'About us', blocks: [b('TEXT', { heading: 'About us', body: `${t?.name ?? 'We'} — tell visitors your story: when you started, what you believe in and what makes you different.` })] },
    { kind: 'ADMISSIONS', title: 'Admissions', blocks: [b('TEXT', { heading: 'Admissions', body: 'How admission works, the classes open this year, and what to bring.' }), b('CTA', { heading: 'Ready to apply?', text: 'Fill in the form online — it takes about ten minutes.', buttonLabel: 'Apply online', apply: true })] },
    { kind: 'CONTACT', title: 'Contact', blocks: [b('CONTACT', { heading: 'Contact us', address, phone: p.phone ?? '', email: p.email ?? '' })] },
  ]
  let order = 0
  for (const pg of pages) {
    await WebsitePage.create({ title: pg.title, slug: SITE_PAGE_KIND_BY[pg.kind].slug, kind: pg.kind, order: order++, draft: pg.blocks, draftAt: new Date(), createdBy: 'Starter pages' }).catch((err) => { if (err?.code !== 11000) throw err })
  }
}

// ───────────────────────────────────────────────────────── pages

export async function listPages() {
  await ensureStarterPages()
  const [pages, site, tenant] = await Promise.all([WebsitePage.find().sort({ order: 1, createdAt: 1 }).lean(), siteSettings(), Tenant.findById(getContext().tenantId).select('slug').lean()])
  return { pages: pages.map(pageRow), site, slug: tenant?.slug ?? null }
}

export async function getPage(id) {
  const p = isOid(id) ? await WebsitePage.findById(id).lean() : null
  if (!p) throw notFound('Page')
  return pageFull(p)
}

async function freeSlug(slug, exceptId) {
  if (!slug) throw badRequest('Give the page an address.', { fields: { slug: 'Required' } })
  if (await WebsitePage.exists({ slug, ...(exceptId && { _id: { $ne: exceptId } }) })) throw badRequest('Another page already uses this address.', { fields: { slug: 'Taken' } })
  return slug
}

export async function createPage({ title, kind = 'CUSTOM', slug }, req) {
  if (await WebsitePage.countDocuments() >= SITE_LIMITS.pages) throw conflict(`A site can have up to ${SITE_LIMITS.pages} pages.`)
  if (kind !== 'CUSTOM' && await WebsitePage.exists({ kind })) throw conflict(`There is already a ${SITE_PAGE_KIND_BY[kind]?.label ?? kind} page.`)
  const s = await freeSlug(siteSlug(slug || (kind !== 'CUSTOM' ? SITE_PAGE_KIND_BY[kind]?.slug : '') || title))
  const last = await WebsitePage.findOne().sort({ order: -1 }).select('order').lean()
  const p = await WebsitePage.create({ title, slug: s, kind, order: (last?.order ?? -1) + 1, draft: [newSiteBlock('TEXT')].map((x) => ({ ...x, data: { ...x.data, heading: title } })), draftAt: new Date(), createdBy: who() })
  await audit({ action: 'CREATE', module: MODULE, entityType: 'website_page', entityId: String(p._id), entityName: p.title, summary: `Added the page "${p.title}" (/${p.slug})` }, req)
  return pageFull(p.toObject())
}

async function checkImages(blocks) {
  const ids = new Set()
  for (const b of blocks) {
    const d = b.data ?? {}
    if (d.imageId) ids.add(d.imageId)
    for (const it of [...(d.images ?? []), ...(d.items ?? [])]) if (it?.imageId) ids.add(it.imageId)
  }
  const list = [...ids]
  if (!list.length) return
  if (list.some((x) => !isOid(x))) throw badRequest('A picture on this page is missing. Upload it again.')
  const n = await WebsiteImage.countDocuments({ _id: { $in: list } })
  if (n !== list.length) throw badRequest('A picture on this page was deleted. Pick another one.')
}

export async function savePage(id, input, req) {
  const p = isOid(id) ? await WebsitePage.findById(id).lean() : null
  if (!p) throw notFound('Page')
  const set = { updatedBy: who() }
  if (input.title !== undefined) set.title = input.title
  if (input.inMenu !== undefined) set.inMenu = input.inMenu
  if (input.seo !== undefined) set.seo = { title: input.seo.title || undefined, description: input.seo.description || undefined }
  if (input.slug !== undefined && input.slug !== p.slug) {
    if (p.kind === 'HOME') throw badRequest('The home page’s address can’t change.', { fields: { slug: 'Fixed' } })
    set.slug = await freeSlug(siteSlug(input.slug), p._id)
  }
  if (input.blocks !== undefined) {
    if (input.blocks.length > SITE_LIMITS.blocksPerPage) throw badRequest(`A page can have up to ${SITE_LIMITS.blocksPerPage} blocks.`)
    if (new Set(input.blocks.map((b) => b.id)).size !== input.blocks.length) throw badRequest('Two blocks have the same id.')
    await checkImages(input.blocks)
    set.draft = input.blocks
    set.draftAt = new Date()
  }
  const doc = await WebsitePage.findByIdAndUpdate(p._id, { $set: set }, { new: true }).lean()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'website_page', entityId: String(p._id), entityName: doc.title, summary: `Saved the draft of "${doc.title}"${input.blocks ? ` (${input.blocks.length} blocks)` : ''}` }, req)
  return pageFull(doc)
}

export async function deletePage(id, req) {
  const p = isOid(id) ? await WebsitePage.findById(id).lean() : null
  if (!p) throw notFound('Page')
  if (p.kind === 'HOME') throw conflict('The home page can’t be deleted.')
  await WebsitePage.deleteOne({ _id: p._id })
  await audit({ action: 'DELETE', module: MODULE, entityType: 'website_page', entityId: String(p._id), entityName: p.title, summary: `Deleted the page "${p.title}" (/${p.slug})` }, req)
  return { deleted: true }
}

/** The menu's order: page ids, top to bottom. */
export async function reorderPages(ids, req) {
  const pages = await WebsitePage.find().select('_id').lean()
  const known = new Set(pages.map((p) => String(p._id)))
  const list = ids.filter((x) => known.has(x))
  for (const [i, id] of list.entries()) await WebsitePage.updateOne({ _id: id }, { $set: { order: i } })
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'website_page', entityName: 'Menu', summary: `Changed the order of the site's menu (${list.length} pages)` }, req)
  return (await listPages()).pages
}

export async function publishPage(id, req) {
  const p = isOid(id) ? await WebsitePage.findById(id).lean() : null
  if (!p) throw notFound('Page')
  if (!p.draft?.length) throw conflict('Add at least one block before publishing.')
  await checkImages(p.draft)
  const now = new Date()
  const doc = await WebsitePage.findByIdAndUpdate(p._id, { $set: { live: p.draft, liveTitle: p.title, liveSeo: p.seo ?? {}, publishedAt: now, publishedBy: who(), draftAt: p.draftAt && p.draftAt > now ? p.draftAt : now } }, { new: true }).lean()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'website_page', entityId: String(p._id), entityName: p.title, summary: `Published "${p.title}" (/${p.slug})` }, req)
  return pageFull(doc)
}

export async function unpublishPage(id, req) {
  const p = isOid(id) ? await WebsitePage.findById(id).lean() : null
  if (!p) throw notFound('Page')
  const doc = await WebsitePage.findByIdAndUpdate(p._id, { $unset: { live: 1, liveTitle: 1, liveSeo: 1, publishedAt: 1, publishedBy: 1 } }, { new: true }).lean()
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'website_page', entityId: String(p._id), entityName: p.title, summary: `Took "${p.title}" off the site` }, req)
  return pageFull(doc)
}

// ───────────────────────────────────────────────────────── site settings

export async function siteSettings() {
  const s = await WebsiteSite.findOne().lean()
  return { live: !!s?.live, tagline: s?.tagline ?? '', footer: s?.footer ?? '', contact: { phone: s?.contact?.phone ?? '', email: s?.contact?.email ?? '', address: s?.contact?.address ?? '' }, social: { facebook: s?.social?.facebook ?? '', instagram: s?.social?.instagram ?? '', youtube: s?.social?.youtube ?? '', x: s?.social?.x ?? '' } }
}

/** Switching the site on (live) needs website.pages.publish — checked by the route. */
export async function saveSiteSettings(input, req) {
  const before = await siteSettings()
  await WebsiteSite.updateOne({}, { $set: { ...input, updatedBy: who() } }, { upsert: true })
  const after = await siteSettings()
  const what = before.live !== after.live ? (after.live ? 'Switched the website on' : 'Switched the website off') : 'Changed the website’s details'
  await audit({ action: 'UPDATE', module: MODULE, entityType: 'website_site', entityName: 'Website', summary: what }, req)
  return after
}

// ───────────────────────────────────────────────────────── images

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/

export async function uploadImage({ name, dataUrl }, req) {
  const m = DATA_URL.exec(String(dataUrl ?? ''))
  if (!m) throw badRequest('Upload a JPEG, PNG or WebP picture.', { fields: { dataUrl: 'Not a picture' } })
  const data = Buffer.from(m[2], 'base64')
  if (data.length > SITE_LIMITS.imageBytes) throw badRequest(`Pictures must be under ${Math.round(SITE_LIMITS.imageBytes / 1024)} KB after resizing.`, { fields: { dataUrl: 'Too large' } })
  const img = await WebsiteImage.create({ name: name || 'picture', mime: m[1], size: data.length, data, createdBy: who() })
  await audit({ action: 'CREATE', module: MODULE, entityType: 'website_image', entityId: String(img._id), entityName: img.name, summary: `Uploaded a picture for the website (${Math.round(data.length / 1024)} KB)` }, req)
  return { id: String(img._id), name: img.name, size: img.size, mime: img.mime, at: img.createdAt }
}

export async function listImages() {
  return (await WebsiteImage.find().sort({ createdAt: -1 }).limit(200).lean()).map((x) => ({ id: String(x._id), name: x.name, size: x.size, mime: x.mime, at: x.createdAt }))
}

export async function deleteImage(id, req) {
  const img = isOid(id) ? await WebsiteImage.findById(id).lean() : null
  if (!img) throw notFound('Picture')
  const used = await WebsitePage.find().select('title draft live').lean()
  const needle = String(img._id)
  const user = used.find((p) => JSON.stringify([p.draft, p.live]).includes(needle))
  if (user) throw conflict(`This picture is used on "${user.title}". Remove it there first.`)
  await WebsiteImage.deleteOne({ _id: img._id })
  await audit({ action: 'DELETE', module: MODULE, entityType: 'website_image', entityId: String(img._id), entityName: img.name, summary: 'Deleted a website picture' }, req)
  return { deleted: true }
}

/** The picture's bytes (staff preview and the public site). */
export async function imageFile(id) {
  const img = isOid(id) ? await WebsiteImage.findById(id).select('+data').lean() : null
  if (!img) throw notFound('Picture')
  return { mime: img.mime, size: img.size, data: img.data.buffer ? Buffer.from(img.data.buffer) : Buffer.from(img.data) }
}

// ───────────────────────────────────────────────────────── what the site shows

/** Latest notices and upcoming events, for the blocks that ask for them. */
export async function siteFeeds(blocks) {
  const types = new Set((blocks ?? []).map((b) => b.type))
  const count = (t) => Math.min(10, Math.max(1, ...(blocks ?? []).filter((b) => b.type === t).map((b) => Number(b.data?.count) || 5)))
  const { date } = await institutionNow()
  const out = { notices: [], events: [] }
  const enabled = await enabledModuleIds(getContext().tenantId)
  if (types.has('NOTICES') && enabled.includes('communication')) {
    // Notices carry no "public" flag: only published ones for the whole school (audience ALL), not expired.
    const rows = await Notice.find({ status: 'PUBLISHED', 'audience.kind': 'ALL', $or: [{ expiresOn: null }, { expiresOn: { $exists: false } }, { expiresOn: { $gte: date } }] })
      .sort({ pinned: -1, publishedAt: -1 }).limit(count('NOTICES')).select('title body category publishedAt pinned').lean()
    out.notices = rows.map((n) => ({ id: String(n._id), title: n.title, excerpt: String(n.body ?? '').replace(/\s+/g, ' ').slice(0, 220), category: n.category ?? null, date: n.publishedAt ?? null, pinned: !!n.pinned }))
  }
  if (types.has('EVENTS') && enabled.includes('events')) {
    const rows = await SchoolEvent.find({ published: true, audience: 'EVERYONE', endDate: { $gte: date } }).sort({ startDate: 1, startTime: 1 }).limit(count('EVENTS')).lean()
    out.events = rows.map((e) => ({ id: String(e._id), title: e.title, kind: e.kind, startDate: e.startDate, endDate: e.endDate, startTime: e.startTime ?? null, endTime: e.endTime ?? null, venue: e.venue ?? null }))
  }
  return out
}

/** The site's frame: name, logo, colour, menu, footer and whether "Apply online" leads anywhere. */
async function siteFrame(tenant, { draft = false } = {}) {
  const [pages, site, enabled] = await Promise.all([WebsitePage.find(draft ? {} : { live: { $exists: true, $ne: null } }).sort({ order: 1, createdAt: 1 }).select('title liveTitle slug kind inMenu').lean(), siteSettings(), enabledModuleIds(tenant._id)])
  let apply = false
  if (enabled.includes('admissions')) {
    const a = await getSettings('admissions')
    apply = !!a.onlineApplication || a.websiteEnquiry !== false
  }
  const p = tenant.profile ?? {}
  return {
    name: tenant.name, slug: tenant.slug, logoUrl: p.logoUrl ?? null, primaryColor: p.primaryColor ?? null, tagline: site.tagline || null, footer: site.footer || null,
    contact: { phone: site.contact.phone || p.phone || null, email: site.contact.email || p.email || null, address: site.contact.address || [p.addressLine, p.city, p.state, p.pincode].filter(Boolean).join(', ') || null },
    social: Object.fromEntries(Object.entries(site.social).filter(([, v]) => v)),
    menu: pages.filter((x) => x.inMenu !== false).map((x) => ({ slug: x.slug, title: (draft ? x.title : x.liveTitle) || x.title, home: x.kind === 'HOME' })),
    applyOnline: apply, live: site.live,
  }
}

/** Staff › Preview: the page's DRAFT inside the site's frame, with live notices and events. */
export async function previewPage(id) {
  const p = isOid(id) ? await WebsitePage.findById(id).lean() : null
  if (!p) throw notFound('Page')
  const tenant = await Tenant.findById(getContext().tenantId).lean()
  return { site: await siteFrame(tenant, { draft: true }), page: { title: p.title, slug: p.slug, kind: p.kind, seo: p.seo ?? {}, blocks: p.draft ?? [] }, feeds: await siteFeeds(p.draft), preview: true }
}

/** The public site: a live page (home when no page is named) — 404 until the site is switched on and published. */
export async function publicPage(tenant, slug) {
  const site = await WebsiteSite.findOne().lean()
  if (!site?.live) return null
  const p = slug ? await WebsitePage.findOne({ slug: String(slug).toLowerCase(), live: { $exists: true, $ne: null } }).lean()
    : (await WebsitePage.findOne({ kind: 'HOME', live: { $exists: true, $ne: null } }).lean()) ?? await WebsitePage.findOne({ live: { $exists: true, $ne: null } }).sort({ order: 1 }).lean()
  if (!p) return null
  return { site: await siteFrame(tenant), page: { title: p.liveTitle || p.title, slug: p.slug, kind: p.kind, seo: p.liveSeo ?? {}, blocks: p.live ?? [] }, feeds: await siteFeeds(p.live) }
}

/** A picture on the live site (only pictures a live page uses are served). */
export async function publicImage(id) {
  if (!isOid(id)) throw notFound('Picture')
  const used = await WebsitePage.exists({ live: { $exists: true, $ne: null }, $or: [{ 'live.data.imageId': id }, { 'live.data.images.imageId': id }, { 'live.data.items.imageId': id }] })
  if (!used) throw notFound('Picture')
  return imageFile(id)
}
