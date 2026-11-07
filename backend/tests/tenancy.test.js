import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ROLE_NAME, MODULES, closeOverDependencies, DEFAULT_PLANS } from '@schoolgiant/shared'
import { Department, Role, TenantModule, User } from '../src/models/tenant.js'
import { runAsTenant } from '../src/platform/context.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
beforeAll(async () => { app = await startDb() })
afterAll(stopDb)

describe('tenant isolation', () => {
  it('refuses a tenant-scoped query with no tenant in context', async () => {
    await expect(User.find().lean()).rejects.toThrow(/Tenant context missing/)
  })

  it('only ever returns the current tenant\'s records', async () => {
    const a = await newInstitution()
    const b = await newInstitution()
    await runAsTenant(a.tenant._id, () => Department.create({ name: 'Cardiology', code: 'CARD', type: 'CLINICAL' }))
    await runAsTenant(b.tenant._id, () => Department.create({ name: 'Cardiology', code: 'CARD', type: 'CLINICAL' }))
    const seenByA = await runAsTenant(a.tenant._id, () => Department.find().lean())
    expect(seenByA).toHaveLength(1)
    expect(String(seenByA[0].tenantId)).toBe(String(a.tenant._id))
    const countAgg = await runAsTenant(b.tenant._id, () => Department.aggregate([{ $count: 'n' }]))
    expect(countAgg[0].n).toBe(1)
  })

  it('blocks writing a record into another tenant', async () => {
    const a = await newInstitution()
    const b = await newInstitution()
    await expect(runAsTenant(a.tenant._id, () => Department.create({ tenantId: b.tenant._id, name: 'X', code: 'XX', type: 'CLINICAL' })))
      .rejects.toThrow(/Cross-tenant/)
  })

  it('a user of institution A cannot read institution B through the API', async () => {
    const a = await newInstitution()
    const b = await newInstitution()
    const agent = await signIn(app, a.email, a.password)
    const res = await agent.get(`/api/v1/core/users/${b.user._id}`)
    expect(res.status).toBe(404)
  })
})

describe('provisioning a new institution', () => {
  it('creates exactly one role — Institution Admin, locked, full access — held by the first user', async () => {
    const h = await newInstitution('STARTER')
    const roles = await runAsTenant(h.tenant._id, () => Role.find().lean())
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({ name: ADMIN_ROLE_NAME, system: true, locked: true, fullAccess: true, permissions: ['*'] })
    expect(h.user.roleIds.map(String)).toEqual([String(roles[0]._id)])
    expect(h.tenant.status).toBe('TRIAL')
  })

  it('switches on exactly the plan modules (plus dependencies)', async () => {
    const h = await newInstitution('STARTER')
    const rows = await runAsTenant(h.tenant._id, () => TenantModule.find({ enabled: true }).lean())
    const expected = closeOverDependencies(DEFAULT_PLANS.find((p) => p.code === 'STARTER').modules).filter((id) => !MODULES.find((m) => m.id === id).mandatory)
    expect(rows.map((r) => r.moduleId).sort()).toEqual(expected.sort())
  })

  it('the admin sees every page of the plan', async () => {
    const h = await newInstitution('STARTER')
    const agent = await signIn(app, h.email, h.password)
    expect(agent.me.fullAccess).toBe(true)
    expect(agent.me.permissions).toEqual(['*'])
    const setup = await agent.get('/api/v1/core/setup')
    expect(setup.status).toBe(200)
    expect(setup.body.data.admin.pageCount).toBeGreaterThan(40)
  })
})
