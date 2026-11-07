import clsx from 'clsx'
import IconTile from './IconTile'
import { PANEL } from './tokens'

/**
 * A white card. Optional header (title + actions) and a flush body.
 *
 *   <Panel title="Demand Overview" actions={<button>...</button>}>
 *     <table>...</table>
 *   </Panel>
 *
 * Pass `icon` for a small tinted icon before the title.
 * Pass `flush` to remove body padding (for tables / charts that manage their own).
 */
export default function Panel({ title, subtitle, icon: Icon, iconTone = 'brand', actions, children, flush = false, className, bodyClassName }) {
  return (
    <div className={clsx(PANEL, 'flex flex-col min-w-0', className)}>
      {(title || actions) && (
        <div className="ui-panel-head flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && <IconTile icon={Icon} tone={iconTone} size="xs" />}
            <div className="min-w-0">
              {title && <h3 className="font-display text-base font-semibold text-ink truncate">{title}</h3>}
              {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={clsx('ui-panel-body', flush ? '' : 'p-5', 'flex-1 min-w-0', bodyClassName)}>{children}</div>
    </div>
  )
}
