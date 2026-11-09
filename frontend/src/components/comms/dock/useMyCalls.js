import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchActiveCalls, fetchIncomingCalls, fetchPageCall } from '../../../api/comms'
import { hasPermission } from '../../../api/auth'
import { useRealtime, useRealtimeEvent } from '../../../context/RealtimeContext'

// What the dock knows about calls, kept live from page:* events:
//   calls    — calls I sent, newest first; a finished one stays (saying how it ended) until closed
//   incoming — ids of calls ringing me that I have not answered (IncomingCalls shows them)
// Re-read after a reload and whenever the live connection comes back.

const KEEP = 12

export default function useMyCalls(me) {
  const { connected } = useRealtime()
  const canView = hasPermission('comms.calls.view')
  const [calls, setCalls] = useState([])
  const [incoming, setIncoming] = useState(() => new Set())
  const callsRef = useRef(calls)
  callsRef.current = calls

  const upsert = useCallback((call) => {
    if (!call?.id) return
    setCalls((prev) => {
      const i = prev.findIndex((c) => c.id === call.id)
      if (i === -1) return [call, ...prev].slice(0, KEEP)
      const next = [...prev]
      next[i] = { ...prev[i], ...call }
      return next
    })
  }, [])
  const dismiss = useCallback((id) => setCalls((prev) => prev.filter((c) => c.id !== id)), [])
  const dropIncoming = useCallback((id) => setIncoming((s) => {
    if (!s.has(id)) return s
    const n = new Set(s)
    n.delete(id)
    return n
  }), [])

  useEffect(() => {
    if (!me) return undefined
    let alive = true
    if (canView) {
      fetchActiveCalls().then((rows) => {
        if (!alive) return
        const mine = (rows ?? []).filter((c) => c.from?.userId === me)
        const live = new Set(mine.map((c) => c.id))
        // one I was following ended while I was away: fetch how it ended
        callsRef.current.filter((c) => c.status === 'ACTIVE' && !live.has(c.id)).forEach((c) => fetchPageCall(c.id).then(upsert).catch(() => dismiss(c.id)))
        setCalls((prev) => [...mine, ...prev.filter((c) => !live.has(c.id))].slice(0, KEEP))
      }).catch(() => {})
    }
    fetchIncomingCalls().then((rows) => { if (alive) setIncoming(new Set((rows ?? []).map((c) => c.id))) }).catch(() => {})
    return () => { alive = false }
  }, [me, canView, connected, upsert, dismiss])

  useRealtimeEvent('page:update', ({ call } = {}) => {
    if (!call?.id) return
    if (call.from?.userId === me) upsert(call)
    if (call.status !== 'ACTIVE') dropIncoming(call.id)
  })
  useRealtimeEvent('page:ring', ({ call } = {}) => {
    if (call?.id) setIncoming((s) => (s.has(call.id) ? s : new Set(s).add(call.id)))
  })
  // answered (here, from the incoming-call card, or on another device), missed, passed on, closed
  useRealtimeEvent('page:stop', ({ id } = {}) => { if (id) dropIncoming(id) })

  const active = calls.filter((c) => c.status === 'ACTIVE')
  return { calls, active, incoming: incoming.size, add: upsert, dismiss }
}
