import clsx from 'clsx'

/**
 * Tabs for status filters and view switches (Open / Done / All, Day / Week / Month): one grey track, the chosen tab
 * filled in the brand colour — deliberately unlike the outlined filter chips (FilterChip) that sit next to it.
 *
 *   <SegmentedControl options={["Day", "Week", "Month"]} value={scale} onChange={setScale} />
 *   <SegmentedControl options={[{ value: 'OPEN', label: 'Open', count: 12 }, …]} value={v} onChange={setV} />
 *
 * `options` items may be strings or { value, label, icon, count, iconClassName }. A `count` shows as a small badge
 * after the label (hidden when undefined/null).
 */
export default function SegmentedControl({ options = [], value, onChange, size = 'sm', className }) {
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  // a finger needs more than a mouse: taller tabs on touch screens
  const pad = size === 'md' ? 'px-3.5 py-1.5 [@media(pointer:coarse)]:py-2.5 text-[13px]' : 'px-3 py-1.5 [@media(pointer:coarse)]:py-2.5 text-xs'
  return (
    // w-fit: inside a flex column (PageContainer) a child is stretched to full width, which ran the
    // grey track across the whole page; a definite width opts out of the stretch.
    <div role="tablist" className={clsx('inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-xl bg-black/[0.05] p-1', className)}>
      {norm.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(o.value)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              pad,
              active ? 'bg-brand-600 text-white' : 'text-ink-muted hover:text-ink hover:bg-surface',
            )}
          >
            {o.icon && <o.icon size={14} className={clsx('shrink-0', active ? 'text-white' : o.iconClassName ?? 'text-ink-faint')} />}
            <span className="inline-block first-letter:uppercase">{o.label}</span>
            {o.count != null && (
              <span className={clsx(
                'min-w-[1.25rem] px-1.5 py-px rounded-full text-[11px] leading-4 text-center tabular-nums font-semibold',
                active ? 'bg-white/20 text-white' : 'bg-surface text-ink-muted',
              )}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
