import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

/**
 * Standalone empty state for screens that aren't a plain table (boards, card
 * grids, custom lists). Tables get this look built in via <DataTable>.
 */
/**
 * `error` (+ `onRetry`): the load failed — say so, with a Retry, instead of the empty message.
 * A board that reads "Nothing waiting" while the server is down sends staff away from real work.
 */
export default function EmptyState({ icon: Icon = Inbox, title, hint, action, className, error, onRetry }) {
  const { t } = useTranslation('ui')
  const Shown = error ? AlertTriangle : Icon
  return (
    <div role={error ? 'alert' : undefined} className={clsx('border border-dashed border-border rounded-xl bg-surface py-14 px-6 text-center', className)}>
      <span className={clsx('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ring-8', error ? 'bg-danger-50 text-danger-600 ring-danger-50/40' : 'bg-brand-50 text-brand-600 ring-brand-50/40')}>
        <Shown className="w-5 h-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">{error ? t('ui.table.loadFailed', 'Couldn’t load this list') : title}</p>
      {(error ? error.message : hint) && <p className="text-xs text-ink-muted max-w-md mx-auto mt-1 leading-relaxed">{error ? error.message : hint}</p>}
      {error
        ? onRetry && <div className="mt-4"><button type="button" onClick={() => onRetry()} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium text-ink hover:bg-bg"><RefreshCw className="w-4 h-4" />{t('ui.table.retry', 'Retry')}</button></div>
        : action && <div className="mt-4">{action}</div>}
    </div>
  )
}
