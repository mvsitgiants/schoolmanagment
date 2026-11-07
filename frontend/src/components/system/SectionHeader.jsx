import clsx from 'clsx'
import { TONE } from './tokens'

/**
 * A heading for one block inside a drawer, modal or record page: a small tinted icon,
 * the title, an optional count bubble and hint, and actions on the far side.
 *
 *   <SectionHeader icon={BookOpen} title={t('…subjects')} count={lines.length} actions={<Button size="sm">…</Button>} />
 *   <MedicineList>…</MedicineList>
 */
export default function SectionHeader({ icon: Icon, title, count, hint, actions, tone = 'brand', divider = false, className }) {
  const t = TONE[tone] ?? TONE.brand
  return (
    <div className={clsx('flex items-center justify-between gap-3 mb-3', divider && 'pb-2.5 border-b border-border', className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', t.bg, t.text)}>
            <Icon className="w-3.5 h-3.5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="truncate">{title}</span>
            {count != null && (
              <span className="rounded-full bg-black/[0.06] px-1.5 py-px text-[11px] font-semibold text-ink-muted tabular-nums">{count}</span>
            )}
          </h4>
          {hint && <p className="text-[11px] text-ink-faint truncate">{hint}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * A boxed section — the way to divide a drawer or record page into clear parts. White card,
 * a quiet header row (icon, title, count, actions) over a hairline, then the body, and an optional
 * `footer` row (an action bar: Save / Sign …). The icon
 * takes the tone only when it means something (danger for allergies, warning for alerts).
 *
 *   <SectionCard icon={BookOpen} title={t('…subjects')} count={3}>…</SectionCard>
 *   <SectionCard icon={ShieldAlert} tone="danger" title={t('…allergies')}>…</SectionCard>
 */
export function SectionCard({ icon: Icon, title, count, hint, actions, footer, tone = 'neutral', flush = false, className, bodyClassName, children }) {
  const iconColor = tone === 'danger' ? 'text-danger-600' : tone === 'warning' ? 'text-amber-600' : 'text-ink-muted'
  return (
    <section className={clsx('rounded-xl border border-border bg-surface', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <h4 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
          {Icon && <Icon className={clsx('w-4 h-4 shrink-0', iconColor)} aria-hidden />}
          <span className="truncate">{title}</span>
          {count != null && <span className="rounded-full bg-black/[0.06] px-1.5 py-px text-[11px] font-semibold text-ink-muted tabular-nums">{count}</span>}
          {hint && <span className="basis-full break-words text-[11px] font-normal text-ink-faint sm:basis-auto">{hint}</span>}
        </h4>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={clsx(!flush && !/(^|\s)p-\d/.test(bodyClassName ?? '') && 'p-4', bodyClassName)}>{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
    </section>
  )
}
