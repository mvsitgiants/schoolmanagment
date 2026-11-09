import clsx from 'clsx'
import { TONE } from '../system'

/** Tone of a percentage where more is better: at/above `good` green, at/above `warn` amber, else red. */
export const pctTone = (value, good = 75, warn = 50) => (value == null ? 'neutral' : value >= good ? 'success' : value >= warn ? 'warning' : 'danger')

/** A percentage with a thin bar under it, coloured by how good it is (more is better). */
export default function PctBar({ value, good = 75, warn = 50, width = 'w-24', align = 'end', className }) {
  if (value == null) return <span className="text-ink-faint">—</span>
  const tone = pctTone(value, good, warn)
  return (
    <span className={clsx('inline-flex flex-col gap-1', align === 'start' ? 'items-start' : 'ms-auto items-end', width, className)}>
      <span className={clsx('text-[13px] font-semibold tabular-nums', tone === 'success' ? 'text-ink' : TONE[tone].text)}>{value}%</span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <span className={clsx('block h-full rounded-full', TONE[tone].fill)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
    </span>
  )
}
