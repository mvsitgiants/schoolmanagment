import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { config } from '../config.js'
import { JobLease } from '../models/platform.js'
import { logger } from './logger.js'

// Background jobs that are safe with more than one API instance.
//
// Each tick first takes the job's lease (one row in job_leases, keyed by the job name). Only the
// holder of an unexpired lease runs it; everyone else skips that tick. So two instances never run
// the same job at the same moment — the jobs are idempotent run after run, but not against a copy
// of themselves running alongside (the billing cycle's find-then-issue made duplicate renewal
// invoices that way). The lease is released when the run ends, and expires on its own (`ttlMs`)
// if the instance dies mid-run. RUN_JOBS=false keeps an instance out of the jobs altogether.

const OWNER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
const timers = []

async function acquire(name, ttlMs) {
  const now = new Date()
  try {
    // matches only an expired (or released) lease; a live one makes the upsert collide on _id
    const row = await JobLease.findOneAndUpdate(
      { _id: name, until: { $lt: now } },
      { $set: { owner: OWNER, until: new Date(now.getTime() + ttlMs) } },
      { upsert: true, new: true },
    ).lean()
    return row?.owner === OWNER
  } catch (err) {
    if (err?.code === 11000) return false // someone else holds it
    throw err
  }
}

const release = (name) => JobLease.updateOne({ _id: name, owner: OWNER }, { $set: { until: new Date(0) } })

/**
 * Run `fn` after `firstMs`, then every `everyMs` — on whichever instance holds the lease.
 * `ttlMs`: the longest a run may take before another instance may assume it died.
 */
export function schedule(name, fn, { firstMs, everyMs, ttlMs = 15 * 60_000 }) {
  if (!config.runJobs) return
  let running = false // a slow run on this instance isn't overlapped by its own next tick either
  const tick = async () => {
    if (running) return
    running = true
    try {
      if (!await acquire(name, ttlMs)) return
      try { await fn() } finally { await release(name) }
    } catch (err) {
      logger.error({ err, job: name }, 'job failed')
    } finally {
      running = false
    }
  }
  timers.push(setTimeout(tick, firstMs), setInterval(tick, everyMs))
}

/** Stop scheduling new runs (shutdown). Runs already going finish on their own. */
export function stopJobs() {
  for (const t of timers.splice(0)) clearTimeout(t)
}
