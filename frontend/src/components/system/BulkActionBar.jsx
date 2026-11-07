import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The strip that appears above a list when rows are ticked: how many are selected, the
 * actions that apply to them, and a way to clear the selection. Renders nothing at zero.
 */
export default function BulkActionBar({ count, onClear, children, noun }) {
  const { t } = useTranslation('ui')
  if (!count) return null
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 shadow-card">
      <span className="text-sm font-semibold text-brand-800 me-1">{noun == null ? t('ui.bulk.countSelected', { n: count }) : <>{count} {noun}</>}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button type="button" onClick={onClear}
        className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900">
        <X className="w-3.5 h-3.5" /> {t('ui.bulk.clearSelection')}
      </button>
    </div>
  )
}
