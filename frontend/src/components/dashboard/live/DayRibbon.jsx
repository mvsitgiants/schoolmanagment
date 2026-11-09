import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Radio } from 'lucide-react'
import { toMin } from './liveKit'

// The school day as a ribbon (the bell schedule, each slot as wide as it is long) that doubles as the period
// scrubber: pick a period to see the campus then; "Now" goes back to the live view. A marker shows the time looked at.

export default function DayRibbon({ frame = [], now, at, onPick }) {
  const { t } = useTranslation('dashboard')
  if (!frame.length) return null
  const start = toMin(frame[0].start)
  const span = Math.max(1, toMin(frame.at(-1).end) - start)
  const marker = now.schoolDay ? (toMin(now.time) - start) / span : null
  return (
    <div className="flex min-w-0 items-center gap-2">
      {now.isToday && (
        <button type="button" onClick={() => onPick('')} aria-pressed={!at}
          className={clsx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors',
            !at ? 'border-brand-500 bg-brand-500 text-white' : 'border-border bg-surface text-ink-muted hover:bg-bg')}>
          <Radio className={clsx('h-3.5 w-3.5', !at && 'animate-pulse')} aria-hidden />{t('dashboard.live.ribbon.now')}
        </button>
      )}
      <div className="relative min-w-0 flex-1 overflow-x-auto [scrollbar-width:thin]">
        <div className="relative flex h-9 min-w-[560px] gap-px overflow-hidden rounded-lg border border-border bg-border">
          {frame.map((sl, i) => {
            const w = ((toMin(sl.end) - toMin(sl.start)) / span) * 100
            const isPeriod = sl.kind === 'PERIOD' && sl.no > 0
            const picked = at && sl.start === at
            const current = now.slot && now.slot.start === sl.start
            const past = now.schoolDay && toMin(sl.end) <= toMin(now.time)
            const label = isPeriod ? t('dashboard.live.ribbon.period', { no: sl.no }) : sl.label || t('dashboard.live.board.break')
            return (
              <button key={`${sl.start}${i}`} type="button" disabled={!isPeriod} onClick={() => onPick(sl.start)} style={{ width: `${w}%` }}
                title={`${label} · ${sl.start}–${sl.end}`} aria-pressed={isPeriod ? !!picked : undefined}
                className={clsx('relative flex min-w-0 flex-col items-center justify-center px-0.5 leading-none transition-colors',
                  isPeriod ? (picked ? 'bg-brand-500 text-white' : current ? 'bg-brand-100 text-brand-800' : 'bg-surface text-ink hover:bg-brand-50') : 'cursor-default bg-bg text-ink-faint',
                  past && !picked && !current && 'opacity-60')}>
                <span className={clsx('truncate font-semibold', isPeriod ? 'text-[11px]' : 'text-[9.5px]')}>{isPeriod ? `P${sl.no}` : label}</span>
                {isPeriod && <span className={clsx('mt-0.5 hidden text-[9.5px] tabular-nums sm:block', picked ? 'text-white/80' : 'text-ink-faint')}>{sl.start}</span>}
              </button>
            )
          })}
          {marker != null && marker >= 0 && marker <= 1 && (
            <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]" style={{ left: `${marker * 100}%` }} aria-hidden />
          )}
        </div>
      </div>
    </div>
  )
}
