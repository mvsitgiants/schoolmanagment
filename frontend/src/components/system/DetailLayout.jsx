import clsx from 'clsx'
import { PANEL } from './tokens'

/**
 * The "record detail" pattern: a left sidebar nav + a content pane, inside one
 * card. Used by Work Center Details, Job Details, etc.
 *
 *   <DetailLayout
 *     tabs={[{ id: 'Overview', icon: FileText }, { id: 'Performance', icon: Activity }]}
 *     value={tab} onChange={setTab}
 *   >
 *     {tab === 'Overview' && <Overview .../>}
 *   </DetailLayout>
 */
export default function DetailLayout({ tabs = [], value, onChange, children, className, minHeight = 360 }) {
  return (
    <div className={clsx(PANEL, 'flex overflow-hidden', className)} style={{ minHeight }}>
      <nav className="w-56 shrink-0 border-e border-border bg-bg p-3 flex flex-col gap-1">
        {tabs.map((t) => {
          const id = typeof t === 'string' ? t : t.id
          const Icon = typeof t === 'string' ? null : t.icon
          const active = value === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange?.(id)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-start',
                active
                  ? 'bg-brand-50 text-brand-700 font-medium border border-brand-100'
                  : 'text-ink-muted hover:bg-black/5 hover:text-ink border border-transparent',
              )}
            >
              {Icon && <Icon size={16} className={active ? 'text-brand-600' : 'text-ink-faint'} />}
              {id}
            </button>
          )
        })}
      </nav>
      <div className="flex-1 p-6 min-w-0">{children}</div>
    </div>
  )
}

/** A label / value pair for detail grids. */
export function Field({ label, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-start text-sm">
      <span className="text-ink-muted col-span-1">{label}</span>
      <span className="font-medium text-ink col-span-2">{children}</span>
    </div>
  )
}
