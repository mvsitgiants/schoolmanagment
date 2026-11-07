import clsx from 'clsx'

/**
 * Underline tab bar.
 *
 *   <Tabs tabs={["Planned Orders", "Material Plan"]} value={tab} onChange={setTab} />
 *
 * `tabs` items may be strings or { value, label }.
 */
export default function Tabs({ tabs = [], value, onChange, className }) {
  const norm = tabs.map((t) => (typeof t === 'string' ? { value: t, label: t } : t))
  return (
    <div role="tablist" className={clsx('flex border-b border-border overflow-x-auto scroll-hide', className)}>
      {norm.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange?.(t.value)}
          className={clsx(
            'px-4 py-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap',
            value === t.value
              ? 'border-brand-500 text-brand-700'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
