// Saves made with no connection, kept on this device and sent when the connection is back (the installed app is
// used in classrooms with poor signal). Only idempotent saves go here — attendance sheets: saving a sheet twice
// gives the same sheet. Each item: { id, kind, label, body, at, tries, error }.
const KEY = 'sg.offlineQueue.v1'
const listeners = new Set()

export function queued() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
  for (const fn of listeners) fn(list)
}
/** Subscribe to changes of the queue; returns the unsubscribe function. */
export function onQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Queue a save. The same `key` (e.g. one sheet) replaces the earlier one — only the latest marks are sent. */
export function enqueue({ kind, key, label, body }) {
  const list = queued().filter((x) => !(x.kind === kind && x.key === key))
  list.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, key, label, body, at: new Date().toISOString(), tries: 0 })
  write(list)
}

/** True when a request failed because there was no connection (not because the server said no). */
export const isOffline = (err) => (typeof navigator !== 'undefined' && navigator.onLine === false) || (!!err && !err.response && (err.code === 'ERR_NETWORK' || err.message === 'Network Error'))

const senders = {}
/** How each kind is sent: registerSender('attendance', (body) => saveSheet(body)). */
export function registerSender(kind, fn) { senders[kind] = fn }

let flushing = false
/** Send everything queued. Items the server refuses stay with their error (shown to the user); offline stops the run. */
export async function flushQueue() {
  if (flushing) return { sent: 0 }
  flushing = true
  let sent = 0
  try {
    for (const item of queued()) {
      const send = senders[item.kind]
      if (!send) continue
      try {
        await send(item.body)
        write(queued().filter((x) => x.id !== item.id))
        sent++
      } catch (err) {
        if (isOffline(err)) break
        write(queued().map((x) => (x.id === item.id ? { ...x, tries: x.tries + 1, error: err?.response?.data?.message || err.message } : x)))
      }
    }
  } finally { flushing = false }
  return { sent }
}

export function dropQueued(id) { write(queued().filter((x) => x.id !== id)) }
