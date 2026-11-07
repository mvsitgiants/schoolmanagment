import clsx from 'clsx'

/**
 * A row of filter pills (All · CT · MRI …, benches, templates): calm outline pills, the chosen
 * one in soft brand. Scrolls sideways on phones (40px tap targets), wraps from `sm` up.
 *
 *   <PillRow>
 *     <button type="button" onClick={() => setX('')} aria-pressed={!x} className={pillClass(!x)}>{t('…all')}</button>
 *     …
 *   </PillRow>
 */
export const pillClass = (active) => clsx(
  'inline-flex min-h-[40px] sm:min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted hover:bg-black/[0.03] hover:text-ink',
)

export function PillRow({ children, className }) {
  return (
    <div className={clsx('flex min-w-0 gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0 [scrollbar-width:thin]', className)}>
      {children}
    </div>
  )
}
