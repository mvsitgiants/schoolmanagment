// Website (module `website`). Tenant-scoped.
//
//   WebsitePage   one page of the public site: its address (slug), menu place, SEO lines, and its blocks twice —
//                 `draft` (what staff edit) and `live` (what the public sees, copied from the draft on publish)
//   WebsiteImage  a picture used on the site (banner, gallery, cards): kept small (resized in the browser, ≤ 300 KB)
//                 and served by the public site at /api/v1/public/site/<slug>/images/<id>
//   WebsiteSite   the site as a whole: switched on or not, a tagline, the footer's contact lines
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose

const blockSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, required: true }, // SITE_BLOCK_TYPES
  data: { type: Schema.Types.Mixed, default: {} },
}, { _id: false, minimize: false })

const pageSchema = new Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true },
  kind: { type: String, default: 'CUSTOM' }, // SITE_PAGE_KINDS
  order: { type: Number, default: 0 },
  inMenu: { type: Boolean, default: true },
  seo: { title: String, description: String },
  draft: { type: [blockSchema], default: [] },
  live: { type: [blockSchema], default: undefined }, // none until first published
  liveTitle: String,
  liveSeo: { title: String, description: String },
  publishedAt: Date, publishedBy: String,
  draftAt: Date, // last draft save; > publishedAt means unpublished changes
  createdBy: String, updatedBy: String,
}, { timestamps: true, minimize: false })
pageSchema.plugin(tenantPlugin)
pageSchema.index({ tenantId: 1, slug: 1 }, { unique: true })
pageSchema.index({ tenantId: 1, order: 1 })
export const WebsitePage = model('WebsitePage', pageSchema, 'website_pages')

const imageSchema = new Schema({
  name: { type: String, trim: true },
  mime: { type: String, required: true }, // image/jpeg · image/png · image/webp
  size: { type: Number, required: true },
  data: { type: Buffer, required: true, select: false },
  createdBy: String,
}, { timestamps: true })
imageSchema.plugin(tenantPlugin)
imageSchema.index({ tenantId: 1, createdAt: -1 })
export const WebsiteImage = model('WebsiteImage', imageSchema, 'website_images')

const siteSchema = new Schema({
  live: { type: Boolean, default: false }, // the public address answers only when switched on
  tagline: String,
  footer: String,
  contact: { phone: String, email: String, address: String },
  social: { facebook: String, instagram: String, youtube: String, x: String },
  updatedBy: String,
}, { timestamps: true })
siteSchema.plugin(tenantPlugin)
siteSchema.index({ tenantId: 1 }, { unique: true, name: 'tenant_site_unique' })
export const WebsiteSite = model('WebsiteSite', siteSchema, 'website_sites')
