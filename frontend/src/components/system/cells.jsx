import clsx from 'clsx'
import { ArrowDown, ArrowUp, CalendarClock } from 'lucide-react'
import { useFormat } from '../../context/SettingsContext'
import Avatar from './Avatar'
import Tag from './Tag'
import { daysUntil, useTimeAgo } from './timeAgo'
import { TONE } from './tokens'

// Cell renderers for <DataTable> columns (and anywhere a list shows the same kind of value).
// Each one is the house style for that kind of value, so every table reads the same:
//   { key: 'name', render: (_, r) => <PersonCell name={r.name} sub={r.uhid} /> }
//   { key: 'amount', align: 'right', render: (v) => <Money value={v} /> }

/** Avatar (photo or initials) + name, with a muted second line (ID, phone, role). */
export function PersonCell({ name, sub, photo, size = 30, onClick, className }) {
  const body = (
    <span className={clsx('inline-flex max-w-full items-center gap-2.5 min-w-0 align-middle', className)}>
      {photo
        ? <img src={photo} alt="" className="shrink-0 rounded-full object-cover ring-1 ring-border" style={{ width: size, height: size }} />
        : <Avatar name={name} size={size} soft />}
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink">{name || '—'}</span>
        {sub && <span className="block truncate text-[11.5px] text-ink-faint">{sub}</span>}
      </span>
    </span>
  )
  return onClick
    ? <button type="button" onClick={onClick} className="max-w-full text-start hover:[&_span.font-medium]:text-brand-700">{body}</button>
    : body
}

/** Two-line cell: the main value, then a muted line under it. */
export function StackCell({ title, sub, mono = false, subMono = false, wrap = false, className }) {
  return (
    <span className={clsx('block min-w-0 leading-tight', className)}>
      <span className={clsx('block text-ink', wrap ? 'break-words' : 'truncate', mono ? 'font-mono text-[12.5px]' : 'font-medium')}>{title ?? '—'}</span>
      {sub && <span className={clsx('block text-ink-faint mt-0.5', wrap ? 'break-words' : 'truncate', subMono ? 'font-mono-num text-[11px]' : 'text-[11.5px]')}>{sub}</span>}
    </span>
  )
}

/**
 * An amount in the institution currency, with equal-width digits. Negative → red; `signed` adds +/−.
 * `tone` forces a meaning colour (e.g. 'danger' for an amount due).
 * `plain` keeps a negative in ink (a discount in a bill summary is not bad news).
 * Pass `paise` when the value is stored in paise (most ERP amounts are) — it is divided by 100.
 */
export function Money({ value, paise = false, currency, compact = false, signed = false, muted = false, plain = false, tone, className }) {
  const { currencyValue } = useFormat()
  if (value == null || value === '') return <span className="text-ink-faint">—</span>
  const n = Number(value) / (paise ? 100 : 1)
  const text = currencyValue(Math.abs(n), { ...(currency && { currency }), compact })
  return (
    <span className={clsx('font-mono-num tabular-nums whitespace-nowrap',
      tone ? clsx(TONE[tone]?.text, 'font-medium') : muted || n === 0 ? 'text-ink-faint' : plain ? 'text-ink' : n < 0 ? 'text-danger-600' : signed && n > 0 ? 'text-success-600' : 'text-ink', className)}>
      {n < 0 ? '−' : signed && n > 0 ? '+' : ''}{text}
    </span>
  )
}

/** A date (or date-time) with "3 days ago" / "in 2 months" underneath. `tone="danger"` for overdue. */
export function DateCell({ value, time = false, relative = true, tone, className }) {
  const { date, dateTime } = useFormat()
  const ago = useTimeAgo()
  if (!value) return <span className="text-ink-faint">—</span>
  return (
    <span className={clsx('block leading-tight whitespace-nowrap', className)}>
      <span className={clsx('block tabular-nums', tone ? clsx(TONE[tone]?.text, 'font-medium') : 'text-ink')}>{time ? dateTime(value) : date(value)}</span>
      {relative && <span className="block text-[11px] text-ink-faint mt-0.5">{ago(value)}</span>}
    </span>
  )
}

/** A code / number / ID (UHID, invoice no., batch) as a monospace badge. */
export function CodeBadge({ children, tone = 'neutral', title, onClick, className }) {
  if (children == null || children === '') return <span className="text-ink-faint">—</span>
  const badge = <Tag tone={tone} mono size="xs" title={title} className={clsx('text-[11.5px]', onClick && 'hover:border-brand-400 hover:text-brand-700', className)}>{children}</Tag>
  return onClick
    ? <button type="button" onClick={(e) => { e.stopPropagation(); onClick(e) }} className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">{badge}</button>
    : badge
}

/**
 * An expiry (or due) date as a coloured chip (full date, or month-only "YYYY-MM" for batches): red once past or within `dangerDays`,
 * amber within `warnDays`, else neutral. Shows the date and how far away it is.
 */
export function ExpiryBadge({ value, warnDays = 90, dangerDays = 30, tone: toneOverride, relative = true, className }) {
  const { date } = useFormat()
  const ago = useTimeAgo()
  if (!value) return <span className="text-ink-faint">—</span>
  // batch expiries are often month-only ("2027-03"): that means the end of the month, shown as 03/27
  const month = typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
  const at = month ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0, 23, 59) : value
  const d = daysUntil(at)
  // `tone` overrides the day thresholds when the server already decided (e.g. a blood unit's near-expiry flag)
  const tone = toneOverride ?? (d < 0 || d <= dangerDays ? 'danger' : d <= warnDays ? 'warning' : 'neutral')
  return (
    <span className={clsx('inline-flex flex-col items-start gap-0.5', className)}>
      <Tag tone={tone} icon={CalendarClock} mono={month} className={d < 0 ? 'line-through' : undefined}>{month ? `${value.slice(5, 7)}/${value.slice(2, 4)}` : date(value)}</Tag>
      {relative && <span className={clsx('text-[11px]', tone === 'neutral' ? 'text-ink-faint' : TONE[tone].text)}>{ago(at)}</span>}
    </span>
  )
}

/**
 * A level against a target — stock on hand vs reorder level, beds used vs total, budget used.
 * The bar turns amber at/under `warnAt` and red at/under `dangerAt` (for "low is bad"), or
 * the other way round with `highIsBad` (e.g. occupancy, spend). `bare` draws only the bar
 * (for next to text that already states the figures).
 */
export function LevelBar({ value, max, warnAt, dangerAt, highIsBad = false, label, unit, bare = false, width = 'w-28', className }) {
  const v = Number(value) || 0
  const m = Number(max) || 0
  const pct = m > 0 ? Math.max(0, Math.min(100, (v / m) * 100)) : 0
  let tone = 'success'
  if (highIsBad) {
    if (dangerAt != null && v >= dangerAt) tone = 'danger'
    else if (warnAt != null && v >= warnAt) tone = 'warning'
  } else {
    if (dangerAt != null && v <= dangerAt) tone = 'danger'
    else if (warnAt != null && v <= warnAt) tone = 'warning'
  }
  return (
    <span className={clsx('inline-flex flex-col gap-1', width, className)}>
      {!bare && <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className={clsx('font-semibold tabular-nums', tone === 'success' ? 'text-ink' : TONE[tone].text)}>
          {label ?? v}{unit && <span className="ms-0.5 text-[11px] font-normal text-ink-faint">{unit}</span>}
        </span>
        {m > 0 && <span className="text-[11px] text-ink-faint tabular-nums">/ {max}</span>}
      </span>}
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <span className={clsx('block h-full rounded-full', TONE[tone].fill)} style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

/**
 * A measured value against its normal range — lab results, vitals. Out-of-range values are
 * coloured with an arrow; `critical` makes it bold red. With `low`/`high`, a thin range bar
 * shows where the value sits. `flagLabel` (e.g. t('lab…high')) is shown beside the arrow.
 *
 *   <ResultValue value={13.9} unit="g/dL" low={12} high={16} />
 *   <ResultValue value={182} flag="H" flagLabel={t('lab.flags.high')} />
 */
export function ResultValue({ value, unit, low, high, flag, flagLabel, critical = false, showRange = true, className }) {
  const n = Number(value)
  const lo = low != null && low !== '' ? Number(low) : null
  const hi = high != null && high !== '' ? Number(high) : null
  const f = flag ? String(flag).toUpperCase() : !Number.isNaN(n) && lo != null && n < lo ? 'L' : !Number.isNaN(n) && hi != null && n > hi ? 'H' : null
  const isCrit = critical || f === 'HH' || f === 'LL' || f === 'CRITICAL'
  const up = f === 'H' || f === 'HH'
  const down = f === 'L' || f === 'LL'
  const tone = isCrit ? 'danger' : up || down ? 'warning' : null
  const Arrow = up ? ArrowUp : down ? ArrowDown : null
  const range = lo != null && hi != null && hi > lo && !Number.isNaN(n)
  // place the value on a bar where the normal band is the middle 60%
  const pos = range ? Math.max(2, Math.min(98, 20 + ((n - lo) / (hi - lo)) * 60)) : 0
  return (
    <span className={clsx('inline-flex flex-col gap-1 min-w-0', className)}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className={clsx('tabular-nums text-sm', isCrit ? 'font-bold text-danger-600' : tone ? 'font-semibold text-amber-600' : 'font-medium text-ink')}>
          {value ?? '—'}
        </span>
        {unit && <span className="text-[11px] text-ink-faint">{unit}</span>}
        {Arrow && (
          <span className={clsx('inline-flex items-center gap-0.5 rounded px-1 py-px text-[10.5px] font-semibold', TONE[tone].bg, TONE[tone].text)}>
            <Arrow className="w-3 h-3" aria-hidden />{flagLabel}
          </span>
        )}
      </span>
      {range && showRange && (
        <span className="relative h-1 w-24 rounded-full bg-black/[0.06]" aria-hidden>
          <span className="absolute inset-y-0 start-[20%] w-[60%] rounded-full bg-success-500/30" />
          <span className={clsx('absolute -top-[3px] h-2.5 w-1 -translate-x-1/2 rounded-full rtl:translate-x-1/2', tone ? TONE[tone].fill : 'bg-success-600')}
            style={{ insetInlineStart: `${pos}%` }} />
        </span>
      )}
    </span>
  )
}

/**
 * "done / total" as plain figures — dispensed of prescribed, doses given of due. The done
 * figure is green when complete and amber when part-way; nothing else is coloured.
 * `format` renders the figures, e.g. format={(p) => formatINR(p)} for money in paise.
 */
export function Fraction({ value, max, label, align = 'end', format, className }) {
  const v = Number(value) || 0
  const m = Number(max) || 0
  if (!m) return <span className="text-ink-faint">—</span>
  return (
    <span className={clsx('inline-flex flex-col leading-tight', align === 'start' ? 'items-start' : 'items-end', className)}>
      <span className="text-sm tabular-nums whitespace-nowrap">
        <span className={clsx('font-semibold', v >= m ? 'text-success-600' : v > 0 ? 'text-amber-600' : 'text-ink-muted')}>{format ? format(v) : v}</span>
        <span className="text-ink-faint"> / {format ? format(m) : m}</span>
      </span>
      {label && <span className="text-[10.5px] text-ink-faint">{label}</span>}
    </span>
  )
}

/**
 * A document's money summary (`paise` when the amounts are in paise), right-aligned under its lines: subtotal, tax, discount … then the
 * total on its own ruled line in semibold. Rows with an empty value are skipped.
 *
 *   <Totals rows={[
 *     { label: t('…subtotal'), value: 12000 },
 *     { label: t('…discount'), value: -500 },
 *     { label: t('…tax'), value: 1380 },
 *     { label: t('…total'), value: 12880, total: true },
 *     { label: t('…paid'), value: 5000, muted: true },
 *     { label: t('…due'), value: 7880, tone: 'danger' },   // colour only when it means something
 *     { label: t('…writtenOff'), value: 300, note: reason },  // a small note under the label
 *   ]} />
 */
export function Totals({ rows = [], paise = false, wide = false, className }) {
  const list = rows.filter((r) => r && r.value != null && r.value !== '')
  return (
    <dl className={clsx('ms-auto w-full space-y-1.5 text-sm', !wide && 'max-w-xs', className)}>
      {list.map((r, i) => (
        <div key={r.key ?? i} className={clsx('flex items-baseline justify-between gap-4', r.total && 'mt-2 border-t border-border pt-2')}>
          <dt className={clsx(r.total ? 'font-semibold text-ink' : 'text-ink-muted')}>
            {r.label}{r.note && <span className="block text-[11px] font-normal text-ink-faint">{r.note}</span>}
          </dt>
          <dd className={clsx(r.total && 'text-base font-semibold')}>
            {typeof r.value === 'number' ? <Money value={r.value} paise={paise} muted={r.muted} plain={!r.tone} tone={r.tone} /> : r.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
