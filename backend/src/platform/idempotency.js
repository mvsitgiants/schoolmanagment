import { IdempotencyKey } from '../models/idempotency.js'
import { badRequest, conflict } from './errors.js'
import { logger } from './logger.js'

/**
 * Idempotency-Key for money writes (bills, payments, deposits, refunds, sales, GRNs).
 *
 * A bill that commits but whose reply never reaches the browser (Wi-Fi drop, a post-commit step
 * failing) used to be billed again when the cashier pressed Save once more. The app now sends the
 * same key when it repeats a request (api/client.js); here the first request with a key records
 * it, and any repeat gets the first answer back instead of doing the work twice — or a 409 while
 * the first is still running. A failed request frees its key so a genuine retry can proceed.
 * Requests without the header are untouched. Mount after authentication (keys are per tenant).
 */
export function idempotent() {
  return async (req, res, next) => {
    const key = req.get('idempotency-key')
    if (!key || req.method !== 'POST') return next()
    if (!/^[\w-]{16,100}$/.test(key)) throw badRequest('The request key is not valid.')
    const route = `${req.method} ${req.baseUrl}${req.path}`
    const userId = req.auth?.userId ? String(req.auth.userId) : null
    try {
      await IdempotencyKey.create({ key, userId, route })
    } catch (err) {
      if (err?.code !== 11000) throw err
      const row = await IdempotencyKey.findOne({ key }).lean()
      if (!row || row.route !== route || (row.userId ?? null) !== userId) throw conflict('This request key was already used for something else.')
      if (row.state === 'DONE') {
        res.set('Idempotent-Replayed', 'true')
        return res.status(row.status).json(row.body)
      }
      throw conflict('This is already being saved. Wait a moment, then refresh.')
    }
    const json = res.json.bind(res)
    res.json = (body) => {
      const done = res.statusCode < 400
        ? IdempotencyKey.updateOne({ key }, { $set: { state: 'DONE', status: res.statusCode, body } })
        : IdempotencyKey.deleteOne({ key }) // an error is not an answer to replay: let a retry run
      done.catch((err) => logger.warn({ err, route }, 'idempotency key update failed'))
      return json(body)
    }
    next()
  }
}
