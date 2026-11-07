import { createRequire } from 'node:module'
import pino from 'pino'
import { config } from '../config.js'
import { getContext } from './context.js'

// Pretty, coloured lines on a dev machine — but only when pino-pretty is installed: it is a
// dev dependency, and `npm ci --omit=dev` on a server without NODE_ENV=production used to
// crash at start-up looking for it. Everywhere else: one JSON object per line.
const hasPretty = (() => { try { createRequire(import.meta.url).resolve('pino-pretty'); return true } catch { return false } })()

export const logger = pino({
  level: config.isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
  // every line written while handling a request says which request, institution and user it was for
  mixin() {
    const c = getContext()
    return c ? { reqId: c.requestId, tenantId: c.tenantId ?? undefined, userId: c.userId ?? undefined } : {}
  },
  ...(config.isProd || config.isTest || !hasPretty
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
})
