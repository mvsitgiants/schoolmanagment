import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { CalendarRange, ChevronDown, Check } from 'lucide-react'
import { formatDate } from '../../utils/format'
import DateInput from './DateInput'

/**
 * A working period picker for dashboards — presets plus a custom from/to.
 * The value is `{ preset, from, to }` with local `YYYY-MM-DD` dates (inclusive).
 *
 *   const [range, setRange] = useState(() => presetRange('thisMonth'))
 *   <DateRangeChip value={range} onChange={setRange} />
 *   const inPeriod = rows.filter((r) => inDateRange(r.orderDate, range))
 */

const pad = (n) => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD — never toISOString(), which shifts IST dates back a day. */
export const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Labels live in the `ui` namespace as ui.dateRange.<key>, translated at render time.
const PRESETS = [
  { key: 'today' },
  { key: 'last7' },
  { key: 'last30' },
  { key: 'thisMonth' },
  { key: 'lastMonth' },
  { key: 'thisQuarter' },
  { key: 'thisFy' },
  { key: 'lastFy' },
]

export function presetRange(key, now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const day = (offset) => new Date(y, m, now.getDate() + offset)
  const fyStart = m >= 3 ? y : y - 1 // Indian FY: 1 Apr – 31 Mar
  const ranges = {
    today: [now, now],
    last7: [day(-6), now],
    last30: [day(-29), now],
    thisMonth: [new Date(y, m, 1), now],
    lastMonth: [new Date(y, m - 1, 1), new Date(y, m, 0)],
    thisQuarter: [new Date(y, m - (m % 3), 1), now],
    thisFy: [new Date(fyStart, 3, 1), now],
    lastFy: [new Date(fyStart - 1, 3, 1), new Date(fyStart, 2, 31)],
  }
  const [from, to] = ranges[key] || ranges.thisMonth
  return { preset: ranges[key] ? key : 'thisMonth', from: localIso(from), to: localIso(to) }
}

/** The equally long period immediately before `range` — for "vs previous period" deltas. */
export function previousRange(range) {
  const from = new Date(`${range.from}T00:00:00`)
  const to = new Date(`${range.to}T00:00:00`)
  const days = Math.round((to - from) / 86400000) + 1
  const prevTo = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1)
  const prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), prevTo.getDate() - days + 1)
  return { preset: 'custom', from: localIso(prevFrom), to: localIso(prevTo) }
}

/** Accepts a `YYYY-MM-DD` date or an ISO timestamp; false for empty values. */
export function inDateRange(value, range) {
  if (!value || !range) return false
  const s = String(value)
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : (() => {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : localIso(d)
  })()
  return !!iso && iso >= range.from && iso <= range.to
}

export function rangeLabel(range) {
  return range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`
}

export default function DateRangeChip({ value, onChange, align = 'right' }) {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(value.from)
  const [to, setTo] = useState(value.to)
  const ref = useRef(null)

  useEffect(() => { setFrom(value.from); setTo(value.to) }, [value.from, value.to])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const pick = (key) => { onChange(presetRange(key)); setOpen(false) }
  const customValid = from && to && from <= to
  const applyCustom = () => {
    if (!customValid) return
    onChange({ preset: 'custom', from, to })
    setOpen(false)
  }

  const presetName = PRESETS.some((p) => p.key === value.preset) ? t(`ui.dateRange.${value.preset}`) : undefined

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={presetName ? `${presetName}: ${rangeLabel(value)}` : rangeLabel(value)}
        className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-1.5 shadow-card text-sm font-medium text-ink hover:bg-bg whitespace-nowrap"
      >
        <CalendarRange size={16} className="text-ink-faint" />
        {rangeLabel(value)}
        <ChevronDown size={14} className={clsx('text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={clsx(
          'absolute z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-surface border border-border rounded-lg shadow-lg p-2',
          align === 'right' ? 'end-0' : 'start-0',
        )}>
          <ul className="py-1">
            {PRESETS.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => pick(p.key)}
                  className={clsx(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm text-start hover:bg-bg',
                    value.preset === p.key ? 'text-brand-700 font-medium' : 'text-ink',
                  )}
                >
                  {t(`ui.dateRange.${p.key}`)}
                  {value.preset === p.key && <Check size={14} />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border mt-1 pt-2 px-1 space-y-2">
            <p className="text-xs font-medium text-ink-muted">{t('ui.dateRange.customRange')}</p>
            <div className="grid grid-cols-2 gap-2">
              <DateInput value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink" aria-label={t('ui.dateRange.fromDate')} />
              <DateInput value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink" aria-label={t('ui.dateRange.toDate')} />
            </div>
            <button
              type="button"
              disabled={!customValid}
              onClick={applyCustom}
              className="w-full rounded-md bg-brand-500 text-white text-sm font-medium py-1.5 hover:bg-brand-600 disabled:opacity-50"
            >
              {t('ui.common.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
