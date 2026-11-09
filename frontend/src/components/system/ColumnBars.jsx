import clsx from 'clsx'
import { PANEL, TONE, hueTone } from './tokens'

/**
 * A compact column chart in a card: one coloured column per item, its count on top and its name underneath —
 * students per class, books per subject, staff per department. Each item keeps its own colour (from its name).
 * With `onPick`, a column is a button (pick again to clear); `activeId` lifts the picked one and dims the rest.
 *
 *   <ColumnBars title="Class strength" items={[{ id, label: 'Nursery', short: 'NUR', value: 15 }]}
 *     activeId={classId} onPick={(it) => setClassId(it?.id ?? '')} />
 */
export default function ColumnBars({ title, subtitle, items = [], activeId, onPick, height = 64, className, right }) {
  const peak = Math.max(1, ...items.map((i) => Number(i.value) || 0))
  return (
    <div className={clsx(PANEL, 'flex min-w-0 flex-col p-4 sm:p-5', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:text-xs">{title}</p>}
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-ink-faint">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scroll-hide sm:gap-1.5">
        {items.map((it) => {
          const v = Number(it.value) || 0
          const t = TONE[it.tone ?? hueTone(it.label)]
          const active = activeId != null && activeId !== '' && it.id === activeId
          const dim = activeId != null && activeId !== '' && !active
          const Cell = onPick ? 'button' : 'div'
          return (
            <Cell key={it.id ?? it.label} type={onPick ? 'button' : undefined}
              onClick={onPick ? () => onPick(active ? null : it) : undefined}
              title={`${it.label}: ${v}`}
              aria-pressed={onPick ? active : undefined}
              className={clsx('group flex min-w-[26px] flex-1 flex-col items-center gap-1 rounded-md transition-opacity', dim && 'opacity-35 hover:opacity-80', onPick && 'cursor-pointer')}>
              <span className={clsx('text-[11px] font-semibold tabular-nums', active ? t.text : 'text-ink-muted')}>{v}</span>
              <span className="flex w-full items-end justify-center" style={{ height }}>
                <span className={clsx('w-full max-w-[34px] rounded-t-md rounded-b-sm transition-all duration-500 group-hover:brightness-110', t.fill, active && 'ring-2 ring-black/15 ring-offset-2 ring-offset-surface')}
                  style={{ height: `${Math.max(4, (v / peak) * 100)}%` }} />
              </span>
              <span className={clsx('w-full truncate text-center text-[10.5px] font-medium', active ? t.text : 'text-ink-faint')}>{it.short ?? it.label}</span>
            </Cell>
          )
        })}
      </div>
    </div>
  )
}
