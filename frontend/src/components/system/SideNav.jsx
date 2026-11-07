import clsx from 'clsx'

/**
 * A page's own sub-navigation: a list down the left of the page on desktop (wards, zones,
 * sections) and a horizontally scrolling chip row on phones and portrait tablets.
 * Each item can carry a count and a small occupancy bar.
 *
 *   <SideNavLayout nav={<SideNav title={t('…wards')} value={ward} onChange={setWard} items={[
 *     { id: '', label: t('…allWards'), count: 42 },
 *     { id: w.id, label: w.name, hint: w.floor, count: '3/12', progress: { value: 9, max: 12 } },
 *   ]} />}>
 *     …page content…
 *   </SideNavLayout>
 */
export function SideNav({ title, items = [], value, onChange, className }) {
  return (
    <nav className={clsx('min-w-0', className)} aria-label={typeof title === 'string' ? title : undefined}>
      {title && <p className="hidden lg:block px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>}
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0 [scrollbar-width:thin]">
        {items.map((it) => {
          const active = value === it.id
          const Icon = it.icon
          const pct = it.progress?.max ? Math.min(100, (it.progress.value / it.progress.max) * 100) : null
          const full = pct !== null && pct >= 100
          const high = pct !== null && pct >= (it.progress.warnPct ?? 85)
          return (
            <li key={it.id ?? '_all'} className="shrink-0 lg:shrink">
              <button type="button" onClick={() => onChange?.(it.id)} aria-current={active ? 'page' : undefined}
                className={clsx('group flex w-full items-center gap-2.5 rounded-lg border text-start transition-colors',
                  'min-h-[40px] px-3 py-1.5 lg:py-2',
                  active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink lg:border-transparent lg:bg-transparent hover:bg-black/[0.03]')}>
                {Icon && <Icon className={clsx('w-4 h-4 shrink-0', active ? 'text-brand-600' : 'text-ink-faint')} aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium whitespace-nowrap">{it.label}</span>
                  {it.hint && <span className="hidden lg:block truncate text-[11px] text-ink-faint">{it.hint}</span>}
                  {pct !== null && (
                    <span className="mt-1 hidden lg:block h-1 w-full overflow-hidden rounded-full bg-black/[0.06]">
                      <span className={clsx('block h-full rounded-full', full ? 'bg-danger-500' : high ? 'bg-amber-400' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                {it.count != null && (
                  <span className={clsx('shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums',
                    it.countTone === 'danger' ? 'bg-danger-50 text-danger-600' : it.countTone === 'warning' ? 'bg-amber-50 text-amber-600' : active ? 'bg-surface text-brand-700' : 'bg-black/[0.06] text-ink-muted')}>
                    {it.count}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Side nav on the left (sticky) beside the content on desktop; stacked above it on phones/tablets. No `nav` → just the content. */
export function SideNavLayout({ nav, children, className }) {
  if (!nav) return <div className={clsx('flex flex-col gap-4', className)}>{children}</div>
  return (
    <div className={clsx('flex flex-col gap-4 lg:flex-row lg:items-start', className)}>
      <aside className="min-w-0 lg:sticky lg:top-4 lg:w-60 lg:shrink-0 lg:rounded-xl lg:border lg:border-border lg:bg-surface lg:p-2">
        {nav}
      </aside>
      <div className="min-w-0 flex-1 flex flex-col gap-4">{children}</div>
    </div>
  )
}
