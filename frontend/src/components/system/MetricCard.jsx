import clsx from 'clsx'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

export default function MetricCard({ label, value, delta, deltaDirection = 'up', icon: Icon, tone = 'brand' }) {
  const TONE_BG = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    info: 'bg-info-50 text-info-600',
    danger: 'bg-danger-50 text-danger-600'
  }
  return (
    <div className="bg-surface border border-border rounded-lg p-5 shadow-card">
      <div className="flex items-start justify-between">
        <p className="text-sm text-ink-muted">{label}</p>
        {Icon && (
          <span className={clsx('w-8 h-8 rounded-md flex items-center justify-center', TONE_BG[tone])}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <p className="font-mono-num font-display text-2xl font-semibold text-ink mt-2">{value}</p>
      {delta && (
        <div className={clsx(
          'inline-flex items-center gap-1 text-xs font-medium mt-2',
          deltaDirection === 'up' ? 'text-success-600' : 'text-danger-600'
        )}>
          {deltaDirection === 'up' ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
          {delta}
        </div>
      )}
    </div>
  )
}
