import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, LayoutPanelTop } from 'lucide-react'
import { hasPermission } from '../../api/auth'

/**
 * "Build lessons in the Subject hub →" — the banner older screens (syllabus, LMS content) show at the top, so the
 * hub is the main path. Opens the hub at this class and subject when known. Nothing without the hub's view right.
 */
export default function HubBanner({ classId, subjectId, className = '' }) {
  const { t } = useTranslation('hub')
  if (!hasPermission('homework.hub.view')) return null
  const q = classId && subjectId ? `?${new URLSearchParams({ classId, subjectId })}` : ''
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-3 sm:flex-row sm:items-center sm:px-4 ${className}`}>
      <LayoutPanelTop className="hidden h-5 w-5 shrink-0 text-brand-600 sm:block" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-ink">{t('hub.banner.text')}</p>
      <Link to={`/teaching/hub${q}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
        {t('hub.banner.action')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
      </Link>
    </div>
  )
}
