import clsx from 'clsx'

export default function Card({ children, className, padded = true }) {
  return (
    <div className={clsx('bg-surface border border-border rounded-lg shadow-card', padded && 'p-5', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
