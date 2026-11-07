import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import { connectDb } from '../src/platform/db.js'
import { forgetAccess } from '../src/platform/access.js'
import { runWithContext } from '../src/platform/context.js'
import { seedPlatform } from '../src/seed/seed.js'
import { provisionTenant } from '../src/services/provisioning.js'

let replSet

export async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await connectDb(replSet.getUri('schoolgiant-test'))
  await runWithContext({ system: true, userName: 'Test' }, seedPlatform)
  return createApp()
}

export async function stopDb() {
  forgetAccess()
  await mongoose.disconnect()
  await replSet?.stop()
}

export const asSystem = (fn) => runWithContext({ system: true, userName: 'Test', tenantId: null }, fn)

let n = 0
export async function newInstitution(planCode = 'GROWTH', extra = {}) {
  n++
  const email = `admin${n}@h${n}.test`
  const { tenant, user, role } = await asSystem(() => provisionTenant({
    institutionName: `Test Institution ${n}`, planCode,
    admin: { name: `Admin ${n}`, email, password: 'Admin@123' }, ...extra,
  }))
  return { tenant, user, role, email, password: 'Admin@123' }
}

/** A supertest agent that keeps cookies, signed in as `email`. */
export async function signIn(app, email, password, tenantId) {
  const agent = request.agent(app).set('Origin', 'http://localhost:5190') // the app's origin — cookie writes need it (CSRF guard)
  const res = await agent.post('/api/v1/auth/login').send({ email, password, tenantId })
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`)
  agent.me = res.body.data
  return agent
}
