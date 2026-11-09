import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchPrograms } from '../../api/programs'

/** The programs list and the picked one, kept in the URL (`?program=`) so a link opens the same view. */
export default function useProgramList() {
  const [params, setParams] = useSearchParams()
  const [programId, setProgramId] = useState(params.get('program') ?? '')
  const query = useQuery({ queryKey: ['programs'], queryFn: fetchPrograms })
  const programs = query.data ?? []
  useEffect(() => {
    if (programs.length && !programs.some((p) => p.id === programId)) setProgramId(programs[0].id)
  }, [programs, programId])
  useEffect(() => {
    if (programId) setParams({ program: programId }, { replace: true })
  }, [programId, setParams])
  return { programs, programId, setProgramId, program: programs.find((p) => p.id === programId) ?? null, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}
