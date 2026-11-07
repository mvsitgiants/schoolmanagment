import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

/**
 * A compact right-rail list panel: a titled card whose body is a short list of
 * "label — value" rows, each optionally a bar or a click target. For secondary
 * context beside a main table (top offenders, next-to-expire, usage counts…).
 *
 *   <RailList
 *     title="Next to expire"
 *     rows={[{ id, label: 'BATCH-014', value: '3d', tone: 'danger', bar: 0.2 }]}
 *     onRowClick={(row) => ...}
 *     footer={<button>View all →</button>}
 *   />
 */
export default function RailList({ title, subtitle, icon: Icon, rows = [], onRowClick, empty, footer, className, maxHeight = 260 }) {
  const { t } = useTranslation('ui')
  return (
    <div className={clsx('bg-surface border border-border rounded-xl shadow-card flex flex-col min-w-0', className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-ink truncate">{title}</h3>
            {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {Icon && <Icon size={16} className="text-ink-faint shrink-0" />}
        </div>
      )}
      <div className="flex-1 overflow-auto scroll-thin px-2 py-2" style={{ maxHeight }}>
        {rows.length === 0 && <p className="px-3 py-6 text-center text-xs text-ink-faint">{empty ?? t('ui.railList.empty')}</p>}
        {rows.map((row) => (
          <button
            key={row.id ?? row.label}
            type="button"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={clsx(
              'w-full text-start px-3 py-2 rounded-lg flex items-center gap-3 group',
              onRowClick ? 'hover:bg-bg cursor-pointer' : 'cursor-default',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink truncate">{row.label}</span>
                <span className={clsx('text-[13px] font-mono-num shrink-0', TONE_TEXT[row.tone] ?? 'text-ink-muted')}>{row.value}</span>
              </div>
              {row.sub && <p className="text-[11px] text-ink-faint truncate mt-0.5">{row.sub}</p>}
              {row.bar != null && (
                <div className="h-1.5 rounded-full bg-black/5 overflow-hidden mt-1.5">
                  <div className={clsx('h-full rounded-full', TONE_BAR[row.tone] ?? 'bg-brand-500')} style={{ width: `${Math.max(2, Math.min(100, row.bar * 100))}%` }} />
                </div>
              )}
            </div>
            {onRowClick && <ChevronRight size={14} className="text-ink-faint group-hover:text-ink-muted shrink-0 rtl:rotate-180" />}
          </button>
        ))}
      </div>
      {footer && <div className="px-5 py-3 border-t border-border flex justify-center">{footer}</div>}
    </div>
  )
}

const TONE_TEXT = {
  danger: 'text-danger-600', warning: 'text-amber-600', success: 'text-success-600', info: 'text-info-600', brand: 'text-brand-700',
}
const TONE_BAR = {
  danger: 'bg-danger-500', warning: 'bg-amber-400', success: 'bg-success-500', info: 'bg-info-500', brand: 'bg-brand-500',
}
