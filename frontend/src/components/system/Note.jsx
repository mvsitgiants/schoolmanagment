import clsx from 'clsx'
import { Info, AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react'

const TONES = {
  info: { wrap: 'bg-info-50 border-info-500/20 text-info-700', icon: Info },
  warning: { wrap: 'bg-amber-50 border-amber-400/30 text-amber-700', icon: AlertTriangle },
  danger: { wrap: 'bg-danger-50 border-danger-500/20 text-danger-700', icon: OctagonAlert },
  success: { wrap: 'bg-success-50 border-success-500/20 text-success-700', icon: CheckCircle2 },
}

/**
 * A one-line explanation of the rule a screen works by — what this list counts,
 * what an action will do, why a figure looks the way it does. Cheap to add and it
 * answers most of the "what does this screen actually do" questions before they
 * get asked.
 *
 *   <Note>Scrap logged before a work order is completed is never credited to stock.</Note>
 *   <Note tone="warning" icon={Clock}>Three POs are past their promised date.</Note>
 */
export default function Note({ tone = 'info', icon: Icon, children, className, actions }) {
  const t = TONES[tone] ?? TONES.info
  const Glyph = Icon || t.icon
  return (
    <div className={clsx('rounded-lg border px-4 py-2.5 text-xs flex items-start gap-2', t.wrap, className)}>
      <Glyph className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  )
}
