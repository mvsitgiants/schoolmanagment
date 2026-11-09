import clsx from 'clsx'
import { CalendarRange } from 'lucide-react'
import useCrudPerms from '../../hooks/useCrudPerms'

/**
 * The operations-screen header row: an icon tile, title + subtitle, and a
 * right-aligned actions cluster (date chip, Filters, primary CTA).
 *
 *   <PageHeader
 *     icon={CalendarRange}
 *     title="Production Schedule"
 *     subtitle="Every shop-floor job, dispatched to a machine and operator."
 *     actions={<>
 *       <DateChip>27 Aug 2026</DateChip>
 *       <HeaderButton icon={Filter}>Filters</HeaderButton>
 *       <HeaderButton variant="primary" icon={Plus}>New Schedule</HeaderButton>
 *     </>}
 *   />
 */
export default function PageHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="mt-0.5 h-10 w-10 shrink-0 rounded-lg bg-brand-50 text-brand-600 border border-brand-100 flex items-center justify-center">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-[13px] sm:text-sm text-ink-muted mt-0.5 sm:mt-1 max-w-2xl max-sm:line-clamp-2">{subtitle}</p>}
        </div>
      </div>
      {/* phones: the buttons wrap inside the screen instead of running off it */}
      {actions && <div className="flex flex-wrap items-center gap-2 sm:gap-3 max-w-full sm:shrink-0">{actions}</div>}
    </div>
  )
}

export function DateChip({ children, icon: Icon = CalendarRange }) {
  return (
    <span className="flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-1.5 shadow-card text-sm font-medium text-ink">
      {children}
      <Icon size={16} className="text-ink-faint" />
    </span>
  )
}

const HEADER_BTN = {
  default: 'bg-surface border border-border text-ink hover:bg-bg shadow-card',
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-card',
}

/**
 * `requires` — 'create' | 'edit' | 'delete' (the route module's matching
 * "<module>.<action>", or "<module>.edit"), an exact permission string, or an
 * array of them (any-of). The button renders only when allowed. Omit for
 * unguarded actions (Export, Run…, Refresh).
 */
export function HeaderButton({ children, icon: Icon, variant = 'default', requires, ...props }) {
  const { allows } = useCrudPerms()
  if (!allows(requires)) return null

  return (
    <button
      type="button"
      className={clsx(
        'flex items-center gap-2 px-3 py-1.5 [@media(pointer:coarse)]:py-2.5 rounded-lg text-sm font-medium transition-colors',
        HEADER_BTN[variant],
      )}
      {...props}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  )
}
