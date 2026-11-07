import clsx from 'clsx'
import { BadgeCheck } from 'lucide-react'

/**
 * A small "verified" tick beside a name: a patient's ABHA confirmed with ABDM, a staff member's
 * confirmed email, an institution checked by the platform. `title` says what was verified (hover and
 * screen readers); `label` shows it as text too. `tone="warning"` for verified-but-check (e.g. the
 * name on the ABHA differs from the record).
 */
export default function VerifiedBadge({ title, label, tone = 'success', size = 'sm', className }) {
  const color = tone === 'warning' ? 'text-amber-600' : 'text-success-600'
  const icon = size === 'xs' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-5 h-5' : 'w-4 h-4'
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 align-middle', color, className)} title={title}>
      <BadgeCheck className={icon} aria-hidden />
      {label ? <span className="text-[11px] font-medium">{label}</span> : <span className="sr-only">{title}</span>}
    </span>
  )
}
