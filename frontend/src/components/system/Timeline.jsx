import clsx from 'clsx'
import { Circle } from 'lucide-react'
import { TONE } from './tokens'

/**
 * A vertical history: one dot (or icon) per event on a rail, title + time on the first line,
 * meta and a free body under it. `onClick` makes the whole row a tap target (keep `actions` out of
 * such rows — no buttons inside a button). `pending: true` draws a step that hasn't happened yet (hollow, faint). For visit history, sample journeys, approvals, audit trails.
 *
 *   <Timeline items={[
 *     { id, icon: ClipboardCheck, tone: 'brand', title: 'Half-yearly exam — 8-A', time: dateTime(v.at), meta: 'Results published', body: <…/>, actions: <Button…/>, aside: '+20', status: <StatusPill…/> },
 *   ]} />
 */
export default function Timeline({ items = [], className, dense = false }) {
  return (
    <ol className={clsx('relative', className)}>
      {items.map((it, i) => {
        const Icon = it.icon
        const t = TONE[it.tone] ?? TONE.neutral
        const last = i === items.length - 1
        return (
          <li key={it.id ?? i} className={clsx('relative flex gap-3', !last && (dense ? 'pb-3' : 'pb-5'))}>
            {!last && <span className="absolute start-[13px] top-7 bottom-0 w-px bg-border" aria-hidden />}
            <span className={clsx('relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface',
              it.pending ? 'border border-dashed border-ink-faint bg-surface text-ink-faint' : clsx(t.bg, t.text))}>
              {Icon ? <Icon className="w-3.5 h-3.5" aria-hidden /> : <Circle className="w-2 h-2 fill-current" aria-hidden />}
            </span>
            <div className={clsx('min-w-0 flex-1 pt-0.5', it.onClick && '-mx-2 -mt-1 cursor-pointer rounded-lg px-2 pb-1.5 pt-1.5 transition-colors hover:bg-black/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400')}
              {...(it.onClick && { role: 'button', tabIndex: 0, onClick: it.onClick, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.onClick(e) } } })}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className={clsx('text-sm break-words min-w-0', it.pending ? 'text-ink-faint' : 'font-medium text-ink')}>{it.title}</p>
                {(it.time || it.aside || it.status) && (
                  <span className="flex shrink-0 items-center gap-3">
                    {it.status}
                    {it.aside && <span className="text-sm font-medium tabular-nums">{it.aside}</span>}
                    {it.time && <span className="text-[11px] text-ink-faint tabular-nums">{it.time}</span>}
                  </span>
                )}
              </div>
              {it.meta && <p className="text-xs text-ink-muted mt-0.5 break-words">{it.meta}</p>}
              {it.body && <div className="mt-2">{it.body}</div>}
              {it.actions && <div className="mt-2 flex flex-wrap items-center gap-2">{it.actions}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
