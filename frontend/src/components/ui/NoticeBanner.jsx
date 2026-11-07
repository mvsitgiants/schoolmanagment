import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Info, TriangleAlert } from 'lucide-react'
import { fetchNotice } from '../../api/public'

/**
 * The platform's maintenance / announcement banner (Superadmin › Settings › Notice), on the
 * sign-in page and every signed-in screen. Re-read every few minutes; nothing shows without one.
 */
export default function NoticeBanner({ className }) {
  const { data: notice } = useQuery({ queryKey: ['platform-notice'], queryFn: fetchNotice, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false })
  if (!notice) return null
  const warning = notice.tone === 'warning'
  const Icon = warning ? TriangleAlert : Info
  return (
    <div role="status" className={clsx('shrink-0 border-b px-4 sm:px-6 py-2 text-sm flex items-center gap-3', warning ? 'bg-amber-50 text-amber-600 border-amber-400/30' : 'bg-info-50 text-info-600 border-info-500/20', className)}>
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0">{notice.message}</span>
    </div>
  )
}
