import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { isSiteLink, parseRichText, siteSlug } from '@schoolgiant/shared'
import { Notice } from '../src/models/communication.js'
import { SchoolEvent } from '../src/models/events.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let home
let image
let unused
const api = '/api/v1/website'
const pub = (p = '') => `/api/v1/public/site/${h.tenant.slug}${p}`
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
// a 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
})
afterAll(stopDb)

describe('helpers', () => {
  it('makes addresses, checks links and parses rich text safely', () => {
    expect(siteSlug('About Us!')).toBe('about-us')
    expect(isSiteLink('/admissions')).toBe(true)
    expect(isSiteLink('https://example.org/x')).toBe(true)
    expect(isSiteLink('javascript:alert(1)')).toBe(false)
    const blocks = parseRichText('## Our story\n\nWe began in **1998**, see [our site](https://example.org).\n\n- one\n- two\n\n[bad](javascript:alert(1))')
    expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'ul', 'p'])
    expect(blocks[1].parts.find((p) => p.bold).text).toBe('1998')
    expect(blocks[3].parts[0]).toMatchObject({ text: 'bad', href: null })
  })
})

describe('pages', () => {
  it('a new site starts with draft Home, About, Admissions and Contact pages', async () => {
    const d = (await admin.get(`${api}/pages`).expect(200)).body.data
    expect(d.pages.map((p) => p.slug)).toEqual(['home', 'about', 'admissions', 'contact'])
    expect(d.pages.every((p) => p.status === 'DRAFT')).toBe(true)
    expect(d.site.live).toBe(false)
    expect(d.slug).toBe(h.tenant.slug)
    home = d.pages[0]
  })

  it('the public address answers 404 while the site is off', async () => {
    await request(app).get(pub()).expect(404)
  })

  it('uploads small pictures only', async () => {
    image = (await admin.post(`${api}/images`).send({ name: 'front.png', dataUrl: PNG }).expect(201)).body.data
    unused = (await admin.post(`${api}/images`).send({ name: 'spare.png', dataUrl: PNG }).expect(201)).body.data
    await admin.post(`${api}/images`).send({ dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' }).expect(400)
    const big = `data:image/jpeg;base64,${Buffer.alloc(320 * 1024, 1).toString('base64')}`
    await admin.post(`${api}/images`).send({ dataUrl: big }).expect(400)
    const res = await admin.get(`${api}/images/${image.id}`).expect(200)
    expect(res.headers['content-type']).toBe('image/png')
  })

  it('checks blocks: known types, safe links, pictures that exist', async () => {
    await admin.patch(`${api}/pages/${home.id}`).send({ blocks: [{ id: 'a', type: 'SCRIPT', data: {} }] }).expect(400)
    await admin.patch(`${api}/pages/${home.id}`).send({ blocks: [{ id: 'a', type: 'CTA', data: { buttonLink: 'javascript:alert(1)' } }] }).expect(400)
    await admin.patch(`${api}/pages/${home.id}`).send({ blocks: [{ id: 'a', type: 'HERO', data: { imageId: '64b7f0000000000000000000' } }] }).expect(400)
    const saved = (await admin.patch(`${api}/pages/${home.id}`).send({
      seo: { title: 'Green Valley — a school for life', description: 'CBSE school in Bengaluru' },
      blocks: [
        { id: 'hero', type: 'HERO', data: { heading: 'Welcome', subheading: 'Hello', imageId: image.id, buttonLabel: 'Apply', apply: true } },
        { id: 'text', type: 'TEXT', data: { heading: 'About', body: 'We **care**.' } },
        { id: 'notices', type: 'NOTICES', data: { heading: 'Notices', count: 5 } },
        { id: 'events', type: 'EVENTS', data: { heading: 'Events', count: 5 } },
      ],
    }).expect(200)).body.data
    expect(saved.blocks).toHaveLength(4)
    expect(saved.status).toBe('DRAFT')
  })

  it('publishing copies the draft live; the site shows only once switched on', async () => {
    const p = (await admin.post(`${api}/pages/${home.id}/publish`).expect(200)).body.data
    expect(p.status).toBe('PUBLISHED')
    await request(app).get(pub()).expect(404) // still switched off
    await admin.put(`${api}/site`).send({ live: true, tagline: 'Learning for life' }).expect(200)
    const site = (await request(app).get(pub()).expect(200)).body.data
    expect(site.site).toMatchObject({ name: h.tenant.name, tagline: 'Learning for life' })
    expect(site.site.menu.map((m) => m.slug)).toEqual(['home']) // About etc. are drafts
    expect(site.page.blocks.map((b) => b.id)).toEqual(['hero', 'text', 'notices', 'events'])
    expect(site.page.seo.title).toBe('Green Valley — a school for life')
    await request(app).get(pub('/pages/about')).expect(404)
  })

  it('later edits stay in the draft until published again', async () => {
    const p = (await admin.patch(`${api}/pages/${home.id}`).send({ blocks: [{ id: 'text', type: 'TEXT', data: { heading: 'Changed', body: 'New' } }] }).expect(200)).body.data
    expect(p.status).toBe('CHANGED')
    const live = (await request(app).get(pub()).expect(200)).body.data
    expect(live.page.blocks).toHaveLength(4)
    const preview = (await admin.get(`${api}/pages/${home.id}/preview`).expect(200)).body.data
    expect(preview.page.blocks.map((b) => b.data.heading)).toEqual(['Changed'])
  })

  it('serves only pictures a live page uses', async () => {
    const res = await request(app).get(pub(`/images/${image.id}`)).expect(200)
    expect(res.headers['content-type']).toBe('image/png')
    await request(app).get(pub(`/images/${unused.id}`)).expect(404)
    await admin.delete(`${api}/images/${image.id}`).expect(409) // still on a page
    await admin.delete(`${api}/images/${unused.id}`).expect(200)
  })

  it('latest notices: published ones for the whole school only; events: published ones for everyone', async () => {
    const { date } = await asTenant(() => institutionNow())
    await asTenant(async () => {
      await Notice.create({ title: 'Annual Day on Friday', body: 'All welcome.', status: 'PUBLISHED', audience: { kind: 'ALL' }, publishedAt: new Date() })
      await Notice.create({ title: 'Class 3 trip', status: 'PUBLISHED', audience: { kind: 'CLASSES', classIds: [] }, publishedAt: new Date() })
      await Notice.create({ title: 'Draft notice', status: 'DRAFT', audience: { kind: 'ALL' } })
      await SchoolEvent.create({ title: 'Sports Day', startDate: date, endDate: date, published: true, audience: 'EVERYONE' })
      await SchoolEvent.create({ title: 'Staff meeting', startDate: date, endDate: date, published: true, audience: 'STAFF' })
      await SchoolEvent.create({ title: 'Unpublished fair', startDate: date, endDate: date, published: false, audience: 'EVERYONE' })
    })
    const live = (await request(app).get(pub()).expect(200)).body.data
    expect(live.feeds.notices.map((n) => n.title)).toEqual(['Annual Day on Friday'])
    expect(live.feeds.events.map((e) => e.title)).toEqual(['Sports Day'])
  })

  it('adds custom pages at their own address, orders the menu, and keeps Home', async () => {
    const custom = (await admin.post(`${api}/pages`).send({ title: 'Sports & Clubs' }).expect(201)).body.data
    expect(custom.slug).toBe('sports-clubs')
    await admin.post(`${api}/pages`).send({ title: 'Another home', kind: 'HOME' }).expect(409)
    await admin.post(`${api}/pages/${custom.id}/publish`).expect(200)
    const page = (await request(app).get(pub('/pages/sports-clubs')).expect(200)).body.data
    expect(page.page.title).toBe('Sports & Clubs')
    const { pages } = (await admin.get(`${api}/pages`).expect(200)).body.data
    const ids = pages.map((p) => p.id)
    const reordered = (await admin.put(`${api}/pages/order`).send({ ids: [custom.id, ...ids.filter((x) => x !== custom.id)] }).expect(200)).body.data
    expect(reordered[0].id).toBe(custom.id)
    expect((await request(app).get(pub()).expect(200)).body.data.site.menu.map((m) => m.slug)).toEqual(['sports-clubs', 'home'])
    await admin.post(`${api}/pages/${custom.id}/unpublish`).expect(200)
    await request(app).get(pub('/pages/sports-clubs')).expect(404)
    await admin.delete(`${api}/pages/${home.id}`).expect(409)
    await admin.delete(`${api}/pages/${custom.id}`).expect(200)
  })

  it('another institution’s address shows nothing of this one', async () => {
    const h2 = await newInstitution('ENTERPRISE')
    await request(app).get(`/api/v1/public/site/${h2.tenant.slug}`).expect(404)
    await request(app).get(`/api/v1/public/site/${h2.tenant.slug}/images/${image.id}`).expect(404)
  })
})
