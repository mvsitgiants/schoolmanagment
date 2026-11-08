import mongoose from 'mongoose'
import { getContext, runWithContext } from './context.js'
import { AppError } from './errors.js'
import { logger } from './logger.js'

mongoose.set('strictQuery', true)

const QUERY_OPS = [
  'countDocuments', 'deleteMany', 'deleteOne', 'distinct', 'find', 'findOne',
  'findOneAndDelete', 'findOneAndReplace', 'findOneAndUpdate', 'replaceOne',
  'updateMany', 'updateOne',
]

// ───────────────────────────────────────────────────────────── session plugin
// Applied to every schema: inside withTransaction() the context carries the
// session, and every query/save joins it automatically.
function sessionPlugin(schema) {
  schema.pre(QUERY_OPS, function () {
    const session = getContext()?.session
    if (session && !this.getOptions().session) this.session(session)
  })
  schema.pre('aggregate', function () {
    const session = getContext()?.session
    if (session && !this.options.session) this.session(session)
  })
  schema.pre('save', function () {
    const session = getContext()?.session
    if (session && !this.$session()) this.$session(session)
  })
  // Model.bulkWrite has no query middleware: join the transaction through its options
  schema.pre('bulkWrite', function (ops, options) {
    const session = getContext()?.session
    if (session && !options?.session) return mongoose.overwriteMiddlewareArguments(ops, { ...(options ?? {}), session })
  })
}
mongoose.plugin(sessionPlugin)

// ───────────────────────────────────────────────────────────── tenant plugin
// Fail-closed tenant isolation (docs/00_MASTER_PLAN.md §8.3):
//   · every query is filtered by the context tenant;
//   · no tenant in context → error, unless the caller is a system/superadmin job
//     that opted out with `.setOptions({ allTenants: true })`.
function tenantScope(op) {
  const ctx = getContext()
  if (ctx?.tenantId) return ctx.tenantId
  if (op?.allTenants && (ctx?.system || ctx?.superadmin || !ctx)) return null
  throw new AppError(500, 'Tenant context missing for a tenant-scoped query.', { code: 'NO_TENANT_CONTEXT' })
}

export function tenantPlugin(schema) {
  schema.add({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, immutable: true } })

  schema.pre(QUERY_OPS, function () {
    const tenantId = tenantScope(this.getOptions())
    if (tenantId) this.where({ tenantId })
  })

  schema.pre('aggregate', function () {
    const tenantId = tenantScope(this.options)
    if (tenantId) this.pipeline().unshift({ $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)) } })
  })

  // Model.bulkWrite skips query and document middleware: every operation is scoped to the context tenant here —
  // filters get the tenant (so an upsert inserts it too), inserted and replacing documents carry it.
  schema.pre('bulkWrite', function (ops, options) {
    const tenantId = tenantScope(options)
    if (!tenantId) return
    const tid = new mongoose.Types.ObjectId(String(tenantId))
    for (const op of ops) {
      const [kind] = Object.keys(op)
      const body = op[kind]
      if (kind === 'insertOne') {
        if (body.document.tenantId && String(body.document.tenantId) !== String(tid)) throw new AppError(403, 'Cross-tenant write blocked.', { code: 'CROSS_TENANT' })
        body.document.tenantId = tid
        continue
      }
      body.filter = { ...(body.filter ?? {}), tenantId: tid }
      if (kind === 'replaceOne') body.replacement = { ...body.replacement, tenantId: tid }
    }
  })

  // 'validate' runs before 'save' (and before the required check), so stamp here.
  schema.pre('validate', function () {
    const ctxTenant = getContext()?.tenantId
    if (!this.tenantId && ctxTenant) this.tenantId = ctxTenant
    if (!this.tenantId) throw new AppError(500, 'Cannot save a tenant record without a tenant.', { code: 'NO_TENANT_CONTEXT' })
    if (ctxTenant && String(this.tenantId) !== String(ctxTenant)) {
      throw new AppError(403, 'Cross-tenant write blocked.', { code: 'CROSS_TENANT' })
    }
  })
}

// ───────────────────────────────────────────────────────────── helpers

/**
 * Run `fn` in a MongoDB transaction; nested calls join the outer one.
 * Inside `fn`, await operations one by one — never Promise.all — because parallel
 * operations on one session race to start the transaction (MongoServerError 117).
 */
export async function withTransaction(fn) {
  const ctx = getContext() || {}
  if (ctx.session) return fn(ctx.session)
  const session = await mongoose.startSession()
  try {
    let result
    await session.withTransaction(async () => {
      result = await runWithContext({ ...ctx, session }, () => fn(session))
    })
    return result
  } finally {
    await session.endSession()
  }
}

/** Common JSON shape: `id` instead of `_id`, no `__v`. */
export function toJSONPlugin(schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = String(ret._id)
      delete ret._id
      delete ret.passwordHash
      return ret
    },
  })
}
mongoose.plugin(toJSONPlugin)

/** Lean documents → API shape (id instead of _id). */
export function clean(doc) {
  if (!doc) return doc
  if (Array.isArray(doc)) return doc.map(clean)
  const { _id, __v, passwordHash, inviteTokenHash, ...rest } = doc
  return { id: String(_id), ...rest }
}

export async function connectDb(url) {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 })
  // Build indexes up front so unique rules hold from the first request.
  for (const model of Object.values(mongoose.models)) await model.init()
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected')
}

export const disconnectDb = () => mongoose.disconnect()

export const oid = (v) => new mongoose.Types.ObjectId(String(v))
export const isOid = (v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(String(v))
