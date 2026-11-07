import clsx from 'clsx'

// Same tone vocabulary as Badge, so a status computed once (e.g. from statusTone())
// can drive both the pill and the icon badge next to it without a second mapping.
const TONES = {
  neutral: { bg: 'bg-black/5', color: 'text-ink-muted' },
  brand: { bg: 'bg-brand-50', color: 'text-brand-600' },
  success: { bg: 'bg-success-50', color: 'text-success-600' },
  warning: { bg: 'bg-amber-50', color: 'text-amber-600' },
  danger: { bg: 'bg-danger-50', color: 'text-danger-600' },
  info: { bg: 'bg-info-50', color: 'text-info-600' },
}

const SIZES = {
  xs: { box: 'w-7 h-7 rounded-md', icon: 'w-3.5 h-3.5' },
  sm: { box: 'w-9 h-9 rounded-md', icon: 'w-4 h-4' },
  md: { box: 'w-10 h-10 rounded-md', icon: 'w-5 h-5' },
  lg: { box: 'w-16 h-16 rounded-2xl', icon: 'w-8 h-8' },
}

export default function IconTile({ icon: Icon, tone = 'neutral', size = 'sm', className }) {
  const t = TONES[tone] || TONES.neutral
  const s = SIZES[size] || SIZES.sm
  return (
    <div className={clsx('flex items-center justify-center flex-shrink-0', s.box, t.bg, className)}>
      <Icon className={clsx(s.icon, t.color)} />
    </div>
  )
}
