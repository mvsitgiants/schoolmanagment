import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pageCss } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
})
afterAll(stopDb)

const tpl = (extra) => ({ docType: 'LAB_REPORT', name: 'Plain paper', paper: 'A4', margins: { top: 12, right: 12, bottom: 16, left: 12 }, ...extra })

describe('letterhead', () => {
  it('starts from the defaults and the institution profile, and saves the layout', async () => {
    const lh = (await admin.get('/api/v1/core/print/letterhead')).body.data
    expect(lh).toMatchObject({ align: 'LEFT', showLogo: true, ids: ['registrationNo', 'nabhNo'] })
    expect(lh.institution.name).toBe(h.tenant.name)
    const res = await admin.put('/api/v1/core/print/letterhead').send({ align: 'CENTER', tagline: 'Caring since 1998', accentColor: '#123456', ids: ['gstin'] })
    expect(res.body.data).toMatchObject({ align: 'CENTER', tagline: 'Caring since 1998', accentColor: '#123456', ids: ['gstin'], updatedBy: 'Admin 1' })
    expect((await admin.put('/api/v1/core/print/letterhead').send({ accentColor: 'teal' })).status).toBe(400)
  })
})

describe('print templates', () => {
  let plain
  let stationery
  it('a document without a template prints with the built-in layout', async () => {
    const eff = (await admin.get('/api/v1/core/print/effective/RX')).body.data
    expect(eff.template).toMatchObject({ builtIn: true, paper: 'A5', letterhead: 'FULL', showQr: true })
    expect(eff.letterhead.tagline).toBe('Caring since 1998')
    expect((await admin.get('/api/v1/core/print/effective/NOPE')).status).toBe(404)
  })

  it('the first template of a document becomes its default', async () => {
    const res = await admin.post('/api/v1/core/print-templates').send(tpl())
    expect(res.status).toBe(201)
    plain = res.body.data
    expect(plain.isDefault).toBe(true)
    const eff = (await admin.get('/api/v1/core/print/effective/LAB_REPORT')).body.data.template
    expect(eff).toMatchObject({ builtIn: false, name: 'Plain paper', id: plain.id })
  })

  it('making another the default moves the flag; names are unique per document', async () => {
    const res = await admin.post('/api/v1/core/print-templates').send(tpl({ name: 'Pre-printed stationery', letterhead: 'PREPRINTED', headerSpaceMm: 40, footerSpaceMm: 15, isDefault: true }))
    stationery = res.body.data
    expect(stationery.isDefault).toBe(true)
    const lab = (await admin.get('/api/v1/core/print-templates')).body.data.find((d) => d.value === 'LAB_REPORT')
    expect(lab.templates.map((t) => [t.name, t.isDefault])).toEqual([['Pre-printed stationery', true], ['Plain paper', false]])
    expect((await admin.post('/api/v1/core/print-templates').send(tpl())).status).toBe(409)
    expect((await admin.post('/api/v1/core/print-templates').send(tpl({ docType: 'RX' }))).status).toBe(201) // same name, other document
    const eff = (await admin.get('/api/v1/core/print/effective/LAB_REPORT')).body.data.template
    expect(pageCss(eff)).toBe('@page { size: A4; margin: 52mm 12mm 31mm 12mm }')
  })

  it('the default cannot be switched off or un-defaulted; deleting it hands over to the next', async () => {
    expect((await admin.patch(`/api/v1/core/print-templates/${stationery.id}`).send({ isDefault: false })).status).toBe(400)
    expect((await admin.patch(`/api/v1/core/print-templates/${stationery.id}`).send({ active: false })).status).toBe(400)
    await admin.delete(`/api/v1/core/print-templates/${stationery.id}`).expect(200)
    const lab = (await admin.get('/api/v1/core/print-templates')).body.data.find((d) => d.value === 'LAB_REPORT')
    expect(lab.templates.map((t) => [t.name, t.isDefault])).toEqual([['Plain paper', true]])
  })

  it('needs the print template permissions to change, not to print', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Lab printer', permissions: ['lab.reports.view'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Printer', email: 'printer@p.test', roleIds: [role.id], password: 'Print@123' })
    const user = await signIn(app, 'printer@p.test', 'Print@123')
    expect((await user.get('/api/v1/core/print/effective/LAB_REPORT')).body.data.template.name).toBe('Plain paper')
    expect((await user.get('/api/v1/core/print-templates')).status).toBe(403)
    expect((await user.put('/api/v1/core/print/letterhead').send({ align: 'LEFT' })).status).toBe(403)
    expect((await user.delete(`/api/v1/core/print-templates/${plain.id}`)).status).toBe(403)
  })
})
