import { createApp } from './app.js'
import { config } from './config.js'
import { connectDb } from './platform/db.js'
import { runAsSystem } from './platform/context.js'
import { logger } from './platform/logger.js'
import { schedule, stopJobs } from './platform/jobs.js'
import { access, mkdir } from 'node:fs/promises'
import { constants as fsc } from 'node:fs'
import mongoose from 'mongoose'
import { runBillingCycle } from './services/subscription.js'
import { processOutbox } from './services/notify.js'
import { processWebhookQueue } from './services/apiKeys.js'
import { closeRealtime, initRealtime } from './platform/realtime.js'

// A crash we didn't catch must at least be in the log; an uncaught exception leaves the process
// in an unknown state, so it exits and the supervisor (Docker / systemd / PM2) starts it again.
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'))
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'uncaught exception — exiting'); process.exit(1) })

// Uploads are written here: fail at start-up, not on the first document someone attaches.
if (config.storage === 'disk') {
  await mkdir(config.uploadDir, { recursive: true })
  await access(config.uploadDir, fsc.W_OK).catch(() => { throw new Error(`UPLOAD_DIR ${config.uploadDir} is not writable.`) })
}

await connectDb(config.mongoUrl)

const app = createApp()
const server = app.listen(config.port, () => logger.info(`API ready on http://localhost:${config.port}`))
// Background jobs below run through platform/jobs.js: with several instances, one runs each job
// at a time (a lease per job); RUN_JOBS=false keeps an instance out of them.
// Live updates for signed-in users (the bell, live boards). One instance only for
// now — several API instances need the socket.io Redis adapter (see platform/realtime.js).
initRealtime(server)

// Billing job: renewals, past-due and suspensions. Hourly is plenty; it is idempotent.
const billing = () => runAsSystem(() => runBillingCycle())
  .then((r) => (r.checked || r.reminders) && logger.info(r, 'billing cycle'))
  .catch((err) => logger.error({ err }, 'billing cycle failed'))
schedule('billing', billing, { firstMs: 10_000, everyMs: 60 * 60 * 1000 })

// Messages to parents, students and staff: new ones go out at once; this sweep sends retries
// and anything queued while the server was down.
const outbox = () => processOutbox().catch((err) => logger.error({ err }, 'outbox run failed'))
if (config.sendMessages) schedule('outbox', outbox, { firstMs: 5_000, everyMs: 30_000 })

// Outbound webhook retries (new events go out at once). Idempotent.
const webhooks = () => processWebhookQueue()
  .then((n) => n && logger.info({ webhooks: n }, 'webhook retries'))
  .catch((err) => logger.error({ err }, 'webhook retries failed'))
schedule('webhooks', webhooks, { firstMs: 15_000, everyMs: 60_000 })

// Module jobs (absence alerts, fee reminders, report schedules …) are scheduled here as
// each module is built — always through schedule() so only one instance runs each.

// ───────────────────────────────────────────────────────── graceful shutdown
// A deploy or restart sends SIGTERM. Stop taking new work, let requests in flight finish (their
// post-commit steps — finance posting, messages — included), then close the database. Anything
// still running after GRACE_MS is cut off so the orchestrator's own kill timeout isn't hit first.
const GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS) || 25_000
let stopping = false
async function shutdown(signal) {
  if (stopping) return
  stopping = true
  logger.info({ signal }, 'shutting down')
  const force = setTimeout(() => { logger.warn('shutdown grace ran out — exiting'); process.exit(1) }, GRACE_MS)
  force.unref()
  stopJobs()
  await closeRealtime().catch(() => {})
  await new Promise((done) => server.close(() => done())) // stops accepting; resolves when open requests end
  await mongoose.disconnect().catch(() => {})
  clearTimeout(force)
  logger.info('shut down cleanly')
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
