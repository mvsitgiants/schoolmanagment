import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'

/**
 * The filter row above a table: a search box, some selects, and a right-aligned
 * slot (usually a SegmentedControl for view switching).
 *
 *   <Toolbar
 *     search={query} onSearch={setQuery} searchPlaceholder="Search jobs…"
 *     filters={[
 *       { value: status, onChange: setStatus, options: ['Status: All','Active','Idle'] },
 *     ]}
 *     right={<SegmentedControl ... />}
 *   />
 */
export default function Toolbar({
  search, onSearch, searchPlaceholder, searchDisabled = false,
  filters = [], right, className, children,
}) {
  const { t } = useTranslation('ui')
  return (
    <div className={clsx('flex items-center justify-between gap-3 flex-wrap', className)}>
      <div className="flex w-full items-center gap-3 flex-wrap sm:w-auto">
        {onSearch && (
          <div className="relative w-full sm:w-auto">
            <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={search ?? ''}
              onChange={(e) => onSearch(e.target.value)}
              disabled={searchDisabled}
              placeholder={searchPlaceholder ?? t('ui.search.placeholder')}
              className="ps-9 pe-4 py-2 text-sm border border-border rounded-lg bg-surface shadow-card w-full sm:w-64
                         focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                         disabled:bg-bg disabled:text-ink-faint"
            />
          </div>
        )}
        {filters.map((f, i) => (
          <select
            key={i}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            disabled={f.disabled}
            className="border border-border rounded-lg px-3 py-2 text-sm text-ink bg-surface shadow-card font-medium
                       focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-bg disabled:text-ink-faint"
          >
            {f.options.map((o) => {
              const opt = typeof o === 'string' ? { value: o, label: o } : o
              return <option key={opt.value} value={opt.value}>{opt.label}</option>
            })}
          </select>
        ))}
        {children}
      </div>
      {/* may shrink to the card's width so filter chips wrap onto the next line instead of running off the edge */}
      {right && <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">{right}</div>}
    </div>
  )
}
