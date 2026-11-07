import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

describe('masters hub', () => {
  it('lists the set-up pages of enabled modules with record counts', async () => {
    await admin.post('/api/v1/core/departments').send({ name: 'Cardiology', code: 'CARD', type: 'CLINICAL' })
    const res = await admin.get('/api/v1/core/masters')
    expect(res.status).toBe(200)
    const by = Object.fromEntries(res.body.data.map((r) => [r.key, r]))
    expect(by['core.departments'].total).toBeGreaterThanOrEqual(1)
    expect(by['core.departments'].updatedAt).toBeTruthy()
    expect(by['core.users']).toMatchObject({ total: 1, active: 1 })
    expect(by['billing.services'].total).toBeGreaterThan(0) // starter services come with the institution
    expect(by['core.profile']).toEqual({ key: 'core.profile', moduleId: 'core', pageId: 'profile' }) // no list behind it
    expect(by['core.masters']).toBeUndefined()
    expect(by['ipd.wards']).toBeUndefined() // IPD is not in the Clinic plan
  })

  it('shows only the pages the role can open', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Masters keeper', permissions: ['core.masters.view', 'lab.tests.view', 'core.departments.view'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Keeper', email: 'keeper@m.test', roleIds: [role.id], password: 'Keep@1234' })
    const keeper = await signIn(app, 'keeper@m.test', 'Keep@1234')
    const keys = (await keeper.get('/api/v1/core/masters')).body.data.map((r) => r.key).sort()
    expect(keys).toEqual(['core.departments', 'lab.tests'])
    const role2 = (await admin.post('/api/v1/core/roles').send({ name: 'No hub', permissions: ['lab.tests.view'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Nohub', email: 'nohub@m.test', roleIds: [role2.id], password: 'Keep@1234' })
    expect((await (await signIn(app, 'nohub@m.test', 'Keep@1234')).get('/api/v1/core/masters')).status).toBe(403)
  })
})
