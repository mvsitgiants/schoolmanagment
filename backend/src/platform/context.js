import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

// Per-request context: who is calling and for which tenant. Every tenant-scoped
// query reads the tenant from here (see db.js tenantPlugin), so a handler can
// never forget to filter by tenant.
//
//   { requestId, tenantId, userId, userName, superadmin, system, session }

const als = new AsyncLocalStorage()

export const getContext = () => als.getStore() || null

// Mongoose queries are lazy thenables: they only run when awaited. Awaiting inside
// the context makes sure a callback like `() => User.find()` executes in it.
export const runWithContext = (ctx, fn) => als.run(ctx, async () => await fn())

/** Run `fn` as a background/system job for one tenant (listeners, schedulers, provisioning). */
export function runAsTenant(tenantId, fn, extra = {}) {
  const parent = getContext() || {}
  return als.run({ ...parent, ...extra, tenantId: String(tenantId), session: parent.session }, async () => await fn())
}

/** Run `fn` with no tenant, allowed to read across tenants (superadmin, billing job, login lookup). */
export function runAsSystem(fn) {
  const parent = getContext() || {}
  return als.run({ ...parent, tenantId: null, system: true }, async () => await fn())
}

export function contextMiddleware(req, res, next) {
  // a proxy's request id is kept so logs line up across hops — but only a sane one (it goes into every log line)
  const given = req.get('x-request-id')
  const requestId = given && /^[\w.:-]{8,100}$/.test(given) ? given : randomUUID()
  res.setHeader('x-request-id', requestId)
  als.run({ requestId, tenantId: null, userId: null, userName: null, superadmin: false, system: false }, next)
}
