import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * A drill-down panel that expands in the page flow instead of a modal —
 * for "view more about this record" content (e.g. a journey timeline).
 * Modals stay reserved for short, single-purpose forms.
 */
export default function InlinePanel({ icon: Icon, title, onClose, children }) {
  const { t } = useTranslation('ui')
  return (
    <div className="bg-surface border border-border rounded-lg shadow-card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-ink-muted" />}
          <h4 className="text-sm font-medium text-ink">{title}</h4>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label={t('ui.common.close')} className="text-ink-faint hover:text-ink p-1 rounded hover:bg-bg">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}
