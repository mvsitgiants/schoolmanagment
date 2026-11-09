import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSessions } from '../../api/coe'

/**
 * The exam session a screen works on, kept in the URL (`?session=`). `filter` narrows the list (published only for
 * revaluation); the latest session is picked first.
 */
export default function useSessionPick(filter) {
  const [params, setParams] = useSearchParams()
  const [sessionId, setSessionId] = useState(params.get('session') ?? '')
  const query = useQuery({ queryKey: ['coe-sessions'], queryFn: fetchSessions })
  const sessions = (query.data ?? []).filter((s) => !filter || filter(s))
  useEffect(() => {
    if (sessions.length && !sessions.some((s) => s.id === sessionId)) setSessionId(sessions[0].id)
  }, [sessions, sessionId])
  useEffect(() => { if (sessionId) setParams({ session: sessionId }, { replace: true }) }, [sessionId, setParams])
  return { sessions, sessionId, setSessionId, session: sessions.find((s) => s.id === sessionId) ?? null, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}
