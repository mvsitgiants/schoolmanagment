import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ControlChip } from '../system'
import { fetchCycles } from '../../api/admissions'

/** The admission cycle a screen works on: an open one first, else the newest. Returns the cycles and a chip to switch. */
export default function useCycle() {
  const { t } = useTranslation('admissions')
  const { data: cycles = [], isLoading } = useQuery({ queryKey: ['admission-cycles'], queryFn: fetchCycles })
  const [cycleId, setCycleId] = useState('')
  const cycle = useMemo(() => cycles.find((c) => c.id === cycleId) ?? cycles.find((c) => c.status === 'OPEN') ?? cycles[0] ?? null, [cycles, cycleId])
  const chip = cycles.length > 0 && (
    <ControlChip label={t('admissions.cycle')} value={cycle?.name ?? '—'} active={!!cycleId} options={cycles.map((c) => c.name)} onChange={(v) => setCycleId(cycles.find((c) => c.name === v)?.id ?? '')} />
  )
  return { cycles, cycle, setCycleId, chip, isLoading }
}
