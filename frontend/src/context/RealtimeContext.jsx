import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { API_BASE_URL } from '../api/client'
import { syncCurrentUser } from '../api/auth'

// Live updates for a signed-in member of staff: ONE socket per browser tab, opened by the
// authenticated app layout only (never on public pages, the parent app, kiosks or TV
// displays). The server pushes `<domain>:<verb>` events — notification:new, presence:changed,
// page:ring / page:update / page:stop / page:answer, chat:* next — and answers client actions
// sent with emit().
//
//   const { connected, on, emit, isOnline } = useRealtime()
//   useRealtimeEvent('notification:new', (n) => …)              // subscribe while mounted
//   const data = await emit('page:respond', { id, action: 'ACK', etaMinutes: 5 })
//
// Listeners survive reconnects (they hang off the provider, not the socket). Rooms do not:
// re-join anything you joined (e.g. `page:watch`) whenever `connected` turns true again.
// Auth is the httpOnly access cookie; when it has expired the provider refreshes it through
// the API (client.js) and reconnects.

const RealtimeContext = createContext(null)

/** Where the socket lives: the API's origin when it is on another host, else this one. */
function socketOrigin() {
  try {
    if (/^https?:\/\//i.test(API_BASE_URL)) return new URL(API_BASE_URL).origin
  } catch { /* fall back to same origin */ }
  return undefined
}

const NOOP = {
  connected: false,
  state: 'off',
  on: () => () => {},
  off: () => {},
  emit: () => Promise.reject(new Error('Live updates are not available here.')),
  isOnline: () => false,
  onlineIds: [],
}

export function RealtimeProvider({ userId, children }) {
  const [state, setState] = useState('connecting') // connecting · connected · reconnecting · offline
  const [online, setOnline] = useState(() => new Set())
  const socketRef = useRef(null)
  const listeners = useRef(new Map()) // event → Set(fn)

  const fire = useCallback((event, args) => {
    for (const fn of [...(listeners.current.get(event) ?? [])]) {
      try { fn(...args) } catch { /* one bad listener never breaks the others */ }
    }
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    setState('connecting')
    const socket = io(socketOrigin(), {
      path: '/socket.io',
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15_000,
      timeout: 15_000,
    })
    socketRef.current = socket
    let authTries = 0
    let retryTimer = null
    const retry = (ms) => { clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (!socket.connected) socket.connect() }, ms) }

    socket.onAny((event, ...args) => fire(event, args))
    socket.on('connect', () => {
      authTries = 0
      setState('connected')
      socket.timeout(8000).emit('presence:list', {}, (err, res) => {
        if (!err && res?.ok) setOnline(new Set(res.data?.online ?? []))
      })
    })
    socket.on('presence:changed', ({ userId: who, online: up } = {}) => {
      if (!who) return
      setOnline((prev) => {
        if (prev.has(who) === !!up) return prev
        const next = new Set(prev)
        if (up) next.add(who); else next.delete(who)
        return next
      })
    })
    // A refused handshake is not retried by socket.io itself.
    socket.on('connect_error', async (err) => {
      if (err?.message === 'UNAUTHORIZED') {
        // the access cookie ran out: re-read the profile (client.js refreshes on the 401), then retry
        if (authTries++ < 4) {
          setState('reconnecting')
          await syncCurrentUser()
          retry(1000 * authTries)
        } else setState('offline')
      } else if (err?.message === 'FORBIDDEN') {
        setState('offline')
      } else {
        setState('reconnecting') // network / server down: socket.io keeps retrying
      }
    })
    socket.on('disconnect', (reason) => {
      setState('reconnecting')
      // the server closed it (session ended, account changed): check the session, then try again
      if (reason === 'io server disconnect') syncCurrentUser().then(() => retry(2000))
    })
    // a laptop waking up or a phone coming back to the tab: reconnect straight away
    const wake = () => { if (document.visibilityState === 'visible' && !socket.connected) socket.connect() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)

    return () => {
      clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      socket.removeAllListeners()
      socket.offAny()
      socket.disconnect()
      socketRef.current = null
      setOnline(new Set())
    }
  }, [userId, fire])

  const on = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set())
    listeners.current.get(event).add(fn)
    return () => listeners.current.get(event)?.delete(fn)
  }, [])

  const off = useCallback((event, fn) => { listeners.current.get(event)?.delete(fn) }, [])

  /** Send an action; resolves with the server's `data`, rejects with its error message. */
  const emit = useCallback((event, payload = {}, { timeout = 8000 } = {}) => new Promise((resolve, reject) => {
    const socket = socketRef.current
    if (!socket?.connected) { reject(Object.assign(new Error('Not connected for live updates.'), { code: 'OFFLINE' })); return }
    socket.timeout(timeout).emit(event, payload, (err, res) => {
      if (err) reject(Object.assign(new Error('The server did not answer in time.'), { code: 'TIMEOUT' }))
      else if (!res?.ok) reject(Object.assign(new Error(res?.error || 'Something went wrong.'), { code: res?.code, details: res?.details }))
      else resolve(res.data)
    })
  }), [])

  const value = useMemo(() => ({
    connected: state === 'connected',
    state,
    on,
    off,
    emit,
    isOnline: (id) => online.has(String(id)),
    onlineIds: [...online],
  }), [state, on, off, emit, online])

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

/** The live connection (a harmless no-op outside the signed-in app). */
export function useRealtime() {
  return useContext(RealtimeContext) ?? NOOP
}

/** Subscribe to a server event while the component is mounted; the latest handler is always used. */
export function useRealtimeEvent(event, handler) {
  const { on } = useRealtime()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => on(event, (...args) => ref.current?.(...args)), [on, event])
}
