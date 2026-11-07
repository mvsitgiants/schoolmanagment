import clsx from 'clsx'
import Avatar from './Avatar'

/**
 * The header block at the top of a record (drawer or page): who / what it is, at a glance.
 * `compact` shrinks it for bench / side-panel screens.
 * Plain white card: avatar (or `leading`, e.g. a large blood-group badge), the name with a few chips (IDs, age/sex), status on the far side,
 * and an optional row of headline facts underneath. Deliberately quiet — no tint, no gradient.
 *
 *   <RecordHero name={p.name} title={<Link…>{p.name}</Link>} subtitle="Signed by … · 12 Oct, 10:40"
 *     chips={<><CodeBadge>{p.uhid}</CodeBadge><Tag>34 M</Tag></>}
 *     status={<StatusPill>Dispensed</StatusPill>} aside={<CodeBadge>RX-1021</CodeBadge>}
 *     facts={[{ icon: Stethoscope, label: t('…doctor'), value: 'Dr Rao' }, …]} />
 */
export default function RecordHero({ name, photo, icon: Icon, leading, title, subtitle, chips, status, aside, facts, compact = false, className }) {
  const list = (facts ?? []).filter(Boolean)
  return (
    <div className={clsx('rounded-xl border border-border bg-surface', className)}>
      <div className={clsx('flex items-start gap-3', compact ? 'px-3 py-2.5' : 'p-4')}>
        {leading ?? (photo
          ? <img src={photo} alt="" className={clsx('shrink-0 rounded-full object-cover ring-1 ring-border', compact ? 'h-8 w-8' : 'h-11 w-11')} />
          : Icon
            ? <span className={clsx('flex shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-ink-muted', compact ? 'h-8 w-8' : 'h-11 w-11')}><Icon className={compact ? 'w-4 h-4' : 'w-5 h-5'} aria-hidden /></span>
            : <Avatar name={name} size={compact ? 32 : 44} soft />)}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <h3 className={clsx('font-semibold leading-tight text-ink break-words', compact ? 'text-sm' : 'text-base')}>{title ?? name}</h3>
              {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
            </div>
            {(status || aside) && <div className="flex shrink-0 flex-col items-end gap-1.5">{status}{aside}</div>}
          </div>
          {chips && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{chips}</div>}
        </div>
      </div>
      {list.length > 0 && (
        <dl className={clsx('grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border sm:grid-cols-3', compact ? 'px-3 py-2' : 'px-4 py-3')}>
          {list.map((f, i) => {
            const FIcon = f.icon
            return (
              <div key={f.key ?? i} className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                  {FIcon && <FIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />}<span className="truncate">{f.label}</span>
                </dt>
                <dd className={clsx('mt-0.5 line-clamp-2 break-words text-sm font-medium text-ink', f.mono && 'font-mono-num tabular-nums')} title={typeof f.value === 'string' ? f.value : undefined}>
                  {f.value ?? <span className="text-ink-faint">—</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
