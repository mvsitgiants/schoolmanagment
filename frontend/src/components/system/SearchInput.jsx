import { Search } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

/**
 * The rounded "pill" search box that sits on the left of a control row,
 * above a list. Controlled — pass `value` + `onChange(nextString)`.
 *
 *   <SearchInput value={query} onChange={setQuery} placeholder="Search SKU / name…" />
 */
export default function SearchInput({ value, onChange, placeholder, className }) {
  const { t } = useTranslation('ui')
  return (
    <div className={clsx('relative w-full sm:w-auto', className)}>
      <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder ?? t('ui.search.placeholder')}
        className="ps-9 pe-4 h-8 text-[13px] border border-border rounded-full bg-surface w-full sm:w-64 max-w-full
                   focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
      />
    </div>
  )
}

/**
 * The standard control row: search pill on the left, ViewControls (chips) on the
 * right, wrapping on narrow screens and never scrolling the page.
 *
 *   <FilterBar search={<SearchInput .../>}>
 *     <ControlChip .../> <ControlChip .../>
 *   </FilterBar>
 */
export function FilterBar({ search, children, className }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 flex-wrap', className)}>
      {search}
      {children && <div className="flex items-center gap-2 flex-wrap min-w-0">{children}</div>}
    </div>
  )
}
