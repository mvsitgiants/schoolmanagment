import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('GROWTH')
  admin = await signIn(app, h.email, h.password)
})
afterAll(stopDb)

async function makeUser(roleId, email) {
  const res = await admin.post('/api/v1/core/users').send({ name: 'Staff Person', email, roleIds: [roleId], password: 'Staff@123' })
  expect(res.status).toBe(201)
  return res.body.data.user
}

describe('role designer rules', () => {
  it('the Institution Admin role is locked', async () => {
    const roles = (await admin.get('/api/v1/core/roles')).body.data
    const sys = roles.find((r) => r.system)
    const res = await admin.patch(`/api/v1/core/roles/${sys.id}`).send({ permissions: ['core.users.view'] })
    expect(res.status).toBe(403)
    const del = await admin.delete(`/api/v1/core/roles/${sys.id}`)
    expect(del.status).toBe(403)
  })

  it('keeps a page view whenever an action on that page is granted', async () => {
    const res = await admin.post('/api/v1/core/roles').send({ name: 'Ward nurse', permissions: ['nursing.chart.mar_give'] })
    expect(res.status).toBe(201)
    expect(res.body.data.permissions).toEqual(['nursing.chart.mar_give', 'nursing.chart.view'])
  })

  it('drops unknown permission keys', async () => {
    const res = await admin.post('/api/v1/core/roles').send({ name: 'Junk role', permissions: ['made.up.key', 'core.users.view'] })
    expect(res.body.data.permissions).toEqual(['core.users.view'])
  })

  it('creates recommended roles from templates, once', async () => {
    const first = await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['FRONT_DESK', 'CASHIER'] })
    expect(first.status).toBe(201)
    expect(first.body.data.created.map((r) => r.name)).toEqual(['Front Desk', 'Cashier'])
    const again = await admin.post('/api/v1/core/roles/from-templates').send({ codes: ['FRONT_DESK'] })
    expect(again.body.data.created).toHaveLength(0)
    expect(again.body.data.skipped[0].reason).toMatch(/already exists/)
  })
})

describe('permissions are enforced on the API', () => {
  it('a limited user is allowed what the role grants and refused the rest', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Viewer', permissions: ['core.departments.view', 'core.users.view'] })).body.data
    await makeUser(role.id, 'viewer@test.test')
    const viewer = await signIn(app, 'viewer@test.test', 'Staff@123')
    expect(viewer.me.permissions).toEqual(['core.departments.view', 'core.users.view'])
    expect((await viewer.get('/api/v1/core/users')).status).toBe(200)
    const denied = await viewer.post('/api/v1/core/departments').send({ name: 'X-ray', code: 'XRAY', type: 'DIAGNOSTIC' })
    expect(denied.status).toBe(403)
    expect(denied.body.details.missing).toEqual(['core.departments.create'])
  })

  it('a role change applies on the next request, without signing in again', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Grows', permissions: ['core.users.view'] })).body.data
    await makeUser(role.id, 'grows@test.test')
    const user = await signIn(app, 'grows@test.test', 'Staff@123')
    expect((await user.get('/api/v1/core/departments')).status).toBe(200) // list is open to every user
    expect((await user.post('/api/v1/core/departments').send({ name: 'ENT', code: 'ENT', type: 'CLINICAL' })).status).toBe(403)
    await admin.patch(`/api/v1/core/roles/${role.id}`).send({ permissions: ['core.users.view', 'core.departments.create'] })
    expect((await user.post('/api/v1/core/departments').send({ name: 'ENT', code: 'ENT', type: 'CLINICAL' })).status).toBe(201)
  })

  it('no escalation: a role manager cannot grant what they do not hold', async () => {
    const managerRole = (await admin.post('/api/v1/core/roles').send({ name: 'Role manager', permissions: ['core.roles.view', 'core.roles.create', 'core.roles.edit', 'core.users.view'] })).body.data
    await makeUser(managerRole.id, 'rm@test.test')
    const rm = await signIn(app, 'rm@test.test', 'Staff@123')
    const ok = await rm.post('/api/v1/core/roles').send({ name: 'Small', permissions: ['core.users.view'] })
    expect(ok.status).toBe(201)
    const bad = await rm.post('/api/v1/core/roles').send({ name: 'Bigger', permissions: ['billing.invoices.cancel'] })
    expect(bad.status).toBe(403)
    const full = await rm.post('/api/v1/core/roles').send({ name: 'Boss', fullAccess: true })
    expect(full.status).toBe(403)
    const own = await rm.patch(`/api/v1/core/roles/${managerRole.id}`).send({ permissions: [...managerRole.permissions, 'core.users.view'] })
    expect(own.status).toBe(403)
  })

  it('always keeps one active full-access user', async () => {
    const res = await admin.post(`/api/v1/core/users/${h.user._id}/deactivate`)
    expect(res.status).toBe(403) // can't deactivate yourself
    const roles = (await admin.get('/api/v1/core/roles')).body.data
    const sys = roles.find((r) => r.system)
    const viewer = roles.find((r) => r.name === 'Viewer')
    const strip = await admin.patch(`/api/v1/core/users/${h.user._id}`).send({ roleIds: [viewer.id] })
    expect(strip.status).toBe(403) // can't change your own roles
    expect(sys.userCount).toBe(1)
  })

  it('a switched-off module hides its pages from every role', async () => {
    const off = await admin.post('/api/v1/core/modules/diet').send({ enabled: false })
    expect(off.status).toBe(200)
    const me = (await admin.get('/api/v1/auth/me')).body.data
    expect(me.enabledModules).not.toContain('diet')
    const blocked = await admin.post('/api/v1/core/modules/ipd').send({ enabled: false })
    expect(blocked.status).toBe(409) // nursing, ot … still need it
  })

  it('cannot switch on a module outside the plan', async () => {
    const res = await admin.post('/api/v1/core/modules/payroll').send({ enabled: true })
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/not part of the Institution plan/)
  })
})
