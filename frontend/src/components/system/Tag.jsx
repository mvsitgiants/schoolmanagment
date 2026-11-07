import clsx from 'clsx'
import { TONE } from './tokens'

/**
 * A soft, square-ish chip for a fact about a record — a class, a house, a batch, a route —
 * as opposed to <StatusPill>, which is for lifecycle status. Same tone vocabulary.
 *
 *   <Tag icon={Clock3}>5 days</Tag>   <Tag tone="info" mono>B-2291</Tag>
 */
export default function Tag({ tone = 'neutral', icon: Icon, mono = false, size = 'sm', title, className, children }) {
  const t = TONE[tone] ?? TONE.neutral
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex max-w-full items-center gap-1 rounded-md border font-medium whitespace-nowrap align-middle',
        size === 'xs' ? 'px-1.5 py-px text-[10.5px]' : 'px-2 py-0.5 text-[11.5px]',
        mono && 'font-mono tabular-nums tracking-tight',
        t.bg, t.text, t.border, className,
      )}
    >
      {Icon && <Icon className={clsx('shrink-0', size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5')} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  )
}
