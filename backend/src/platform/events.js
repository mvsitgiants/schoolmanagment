import { getContext, runWithContext } from './context.js'
import { logger } from './logger.js'

// Event bus (E13), in-process. A module emits a domain event once its write has
// committed — `appointments.booked`, `billing.bill_created` — and listeners react
// (patient messages today; webhooks later) without the module knowing about them.
//
// A listener runs in the caller's tenant context but outside any transaction, and a
// failing listener is logged, never thrown: the user's work is already saved.

const listeners = new Map() // event → Set(fn); '*' hears every event

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(fn)
  return () => listeners.get(event)?.delete(fn)
}

export async function emit(event, payload = {}) {
  const fns = [...(listeners.get(event) ?? []), ...(listeners.get('*') ?? [])]
  if (!fns.length) return
  const ctx = getContext() || {}
  await runWithContext({ ...ctx, session: undefined }, async () => {
    for (const fn of fns) {
      try {
        await fn(payload, event)
      } catch (err) {
        logger.error({ err, event }, 'event listener failed')
      }
    }
  })
}
