import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import IconTile from './IconTile'

/**
 * One row of a non-table list (worklists, side lists, search results, drawer lists):
 * a leading icon / avatar, a title with a muted subtitle, a line of chips, and a trailing
 * value or action. Clickable rows get a hover state and a chevron.
 *
 *   <ListRow icon={GraduationCap} tone="info" title="Aarav Sharma" subtitle="8-A · Adm. no. 20261021"
 *     meta={<><Tag>EDTA</Tag><StatusPill>Pending</StatusPill></>} trailing="10:42" onClick={…} />
 *
 * Stack rows inside <ListRows> for hairline dividers.
 */
export default function ListRow({ icon, tone = 'neutral', leading, title, subtitle, meta, trailing, onClick, active = false, className }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx('group flex w-full items-center gap-3 px-3 py-2.5 text-start rounded-lg transition-colors',
        onClick && 'hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        active && 'bg-brand-50/70 ring-1 ring-brand-100', className)}
    >
      {leading ?? (icon && <IconTile icon={icon} tone={tone} size="sm" />)}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{title}</p>
        {subtitle && <p className="text-xs text-ink-muted truncate mt-0.5">{subtitle}</p>}
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</div>}
      </div>
      {trailing != null && <div className="shrink-0 text-end text-xs text-ink-muted tabular-nums">{trailing}</div>}
      {onClick && <ChevronRight className="w-4 h-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" aria-hidden />}
    </Comp>
  )
}

export function ListRows({ children, className }) {
  return <div className={clsx('flex flex-col divide-y divide-border', className)}>{children}</div>
}
