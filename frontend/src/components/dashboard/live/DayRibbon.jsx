import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { toMin, usePlain } from './liveKit'

// The school day as a slim strip (the bell schedule, each part as wide as it lasts): assembly, periods, breaks and
// lunch, labelled. Pick a period to see the school at that time; "See now" goes back to live. The period being
// looked at is filled teal; finished ones are greyed; a thin red line marks the time only when live.

export default function DayRibbon({ frame = [], now, at, onPick }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  if (!frame.length) return null
  const start = toMin(frame[0].start)
  const span = Math.max(1, toMin(frame.at(-1).end) - start)
  const marker = now.live ? (toMin(now.time) - start) / span : null
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">{t('dashboard.live.ribbon.pick')}</span>
      {now.isToday && (
        <button type="button" onClick={() => onPick('')} aria-pressed={!at}
          className={clsx('h-8 shrink-0 rounded-md border px-2.5 text-xs font-medium',
            !at ? 'border-brand-500 text-brand-700' : 'border-border text-ink-muted hover:text-ink')}>
          {t('dashboard.live.ribbon.now')}
        </button>
      )}
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <div className="relative flex h-8 min-w-[760px] overflow-hidden rounded-md border border-border">
          {frame.map((sl, i) => {
            const w = ((toMin(sl.end) - toMin(sl.start)) / span) * 100
            const isPeriod = sl.kind === 'PERIOD' && sl.no > 0
            const current = now.slot && now.slot.start === sl.start && now.phase === 'PERIOD'
            const past = now.schoolDay && toMin(sl.end) <= toMin(now.time)
            const name = isPeriod ? t('dashboard.live.ribbon.period', { no: sl.no }) : sl.label || t('dashboard.live.break')
            return (
              <button key={`${sl.start}${i}`} type="button" disabled={!isPeriod} onClick={() => onPick(sl.start)} style={{ width: `${w}%`, minWidth: isPeriod ? undefined : 58 }}
                title={t('dashboard.live.ribbon.title', { name, start: clock(sl.start), end: clock(sl.end) })} aria-pressed={isPeriod ? !!current : undefined}
                className={clsx('flex min-w-0 items-center justify-center gap-1 overflow-hidden border-e border-border px-1 text-[11px] last:border-e-0',
                  !isPeriod ? 'cursor-default bg-bg text-[10px] text-ink-faint' : current ? 'bg-brand-500 font-semibold text-white' : past ? 'bg-surface text-ink-faint hover:bg-bg' : 'bg-surface text-ink hover:bg-bg')}>
                {isPeriod ? (
                  <>
                    <span className="truncate"><span className="hidden 2xl:inline">{t('dashboard.live.ribbon.period', { no: sl.no })}</span><span className="2xl:hidden">{t('dashboard.live.ribbon.short', { no: sl.no })}</span></span>
                    <span className={clsx('hidden truncate tabular-nums lg:inline', current ? 'text-white/80' : 'text-ink-faint')}>· {clock(sl.start)}</span>
                  </>
                ) : <span className="truncate">{name}</span>}
              </button>
            )
          })}
          {marker != null && marker >= 0 && marker <= 1 && <span className="pointer-events-none absolute inset-y-0 w-px bg-rose-500" style={{ left: `${marker * 100}%` }} aria-hidden />}
        </div>
      </div>
    </div>
  )
}
