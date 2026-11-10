import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchHrmsMeta } from '../../api/hrms'

// Bits every Staff & HR screen uses.

export const useHrMeta = (enabled = true) => useQuery({ queryKey: ['hrms-meta'], queryFn: fetchHrmsMeta, enabled, staleTime: 60_000 })

/** Translated labels for the shared lists (category, employment type, statuses …). */
export function useHrLabels() {
  const { t } = useTranslation('hrms')
  return useMemo(() => ({
    category: (v) => (v ? t(`hrms.categories.${v}`, v) : '—'),
    employment: (v) => (v ? t(`hrms.employmentTypes.${v}`, v) : '—'),
    status: (v) => t(`hrms.statuses.${v}`, v),
    exit: (v) => t(`hrms.exitTypes.${v}`, v),
    att: (v) => t(`hrms.attendance.statuses.${v}`, v),
    attCode: (v) => t(`hrms.attendance.codes.${v}`, v),
    leaveStatus: (v) => t(`hrms.leave.statuses.${v}`, v),
    stage: (v) => t(`hrms.hiring.stages.${v}`, v),
    reqStatus: (v) => t(`hrms.hiring.reqStatuses.${v}`, v),
    review: (v) => t(`hrms.performance.statuses.${v}`, v),
    cycle: (v) => t(`hrms.performance.cycleStatuses.${v}`, v),
    day: (v) => t(`hrms.days.${v}`, v),
  }), [t])
}

// leave pieces (apply with preview, the approval chain, balances): components/hrms/leave/*
