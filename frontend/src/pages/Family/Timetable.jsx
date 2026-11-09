import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarClock, Coffee, DoorOpen, UserRoundCog } from 'lucide-react'
import { TONE, hueTone } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyTimetable } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { addDaysYmd, weekdayCode } from '@schoolgiant/shared'

const toMin = (hhmm) => { const [h, m] = String(hhmm ?? '').split(':').map(Number); return h * 60 + m }

/** The date of `day` (MON…SUN) in the week that has `today` — or the coming one once today is past it. */
function dateOfDay(today, day, days) {
  const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const diff = order.indexOf(day) - order.indexOf(weekdayCode(today))
  return addDaysYmd(today, diff >= 0 || !days.includes(day) ? diff : diff + 7)
}

/** Today while school is on; after the last bell (or on a holiday weekday) the next school day. */
function openingDay(w, todayCode) {
  const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const lastEnd = Math.max(0, ...w.slots.map((s) => toMin(s.end)))
  if (w.days.includes(todayCode) && toMin(w.time) < lastEnd) return todayCode
  for (let i = 1; i <= 7; i++) {
    const d = order[(order.indexOf(todayCode) + i) % 7]
    if (w.days.includes(d)) return d
  }
  return w.days[0]
}

/** The family app › Timetable: the child's class week, a day at a time, with "now" and substitute teachers. */
export default function FamilyTimetable() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data: w, isLoading, error } = useFamilyQuery(['timetable'], () => familyTimetable(slug, studentId), { refetchInterval: 5 * 60_000 })
  const todayCode = w ? weekdayCode(w.today) : null
  const [picked, setPicked] = useState(null)
  const day = picked ?? (w ? openingDay(w, todayCode) : null)
  const dayDate = w && day ? dateOfDay(w.today, day, w.days) : null
  const subs = useMemo(() => new Map((w?.substitutions ?? []).filter((s) => s.date === dayDate).map((s) => [s.period, s.teacher])), [w, dayDate])

  if (isLoading) return <FSkeleton className="h-96" />
  if (error) return <FError error={error} />
  if (!w.published) return <FCard><FEmpty icon={CalendarClock} title={t('family.timetable.none')} hint={t('family.timetable.noneHint')} /></FCard>

  const isToday = dayDate === w.today
  const nowMin = toMin(w.time)
  const row = w.cells[day] ?? {}
  const periods = w.slots.filter((s) => s.kind === 'PERIOD' && row[s.no]).length

  return (
    <>
      {/* day picker: a chip per working day, today marked */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('family.timetable.days')}>
        {w.days.map((d) => (
          <button
            key={d} type="button" role="tab" aria-selected={d === day} onClick={() => setPicked(d)}
            className={clsx('relative min-h-[44px] min-w-[52px] shrink-0 rounded-xl border px-3 text-sm font-semibold transition-colors',
              d === day ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-surface text-ink-muted hover:text-ink')}
          >
            {t(`family.timetable.day.${d}`)}
            {d === todayCode && <span className={clsx('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', d === day ? 'bg-white' : 'bg-brand-600')} aria-label={t('family.timetable.today')} />}
          </button>
        ))}
      </div>

      <FCard title={isToday ? t('family.timetable.todayTitle') : dayDate === addDaysYmd(w.today, 1) ? t('family.timetable.tomorrowTitle') : t(`family.timetable.dayLong.${day}`)} action={<span className="text-xs text-ink-muted">{date(dayDate)} · {t('family.timetable.periods', { count: periods })}</span>}>
        {subs.size > 0 && (
          <p className="mb-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <UserRoundCog className="h-4 w-4 shrink-0" aria-hidden />{t('family.timetable.subsNote', { count: subs.size })}
          </p>
        )}
        <ol className="space-y-1.5">
          {w.slots.map((slot, i) => {
            const live = isToday && nowMin >= toMin(slot.start) && nowMin < toMin(slot.end)
            const done = isToday && nowMin >= toMin(slot.end)
            if (slot.kind !== 'PERIOD') {
              return (
                <li key={`b${i}`} className={clsx('flex items-center gap-3 px-1 py-1 text-xs', live ? 'text-brand-700' : 'text-ink-faint')}>
                  <span className="w-12 shrink-0 tabular-nums">{slot.start}</span>
                  <span className="flex flex-1 items-center gap-1.5 border-t border-dashed border-border pt-1"><Coffee className="h-3.5 w-3.5" aria-hidden />{slot.label || t(`family.timetable.slot.${slot.kind}`, { defaultValue: slot.kind })}</span>
                </li>
              )
            }
            const c = row[slot.no]
            const tone = TONE[hueTone(c?.subject)]
            const sub = subs.get(slot.no)
            return (
              <li key={`p${slot.no}`} className={clsx('flex items-stretch gap-3', done && 'opacity-55')}>
                <div className="w-12 shrink-0 pt-2 text-right text-xs tabular-nums text-ink-muted">
                  <span className="block font-semibold text-ink">{slot.start}</span>{slot.end}
                </div>
                {c ? (
                  <div className={clsx('flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2.5', tone.bg, tone.border, live && 'ring-2 ring-brand-500 ring-offset-1')}>
                    <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-[11px] font-bold', tone.text)}>{c.subjectCode?.slice(0, 4) || slot.no}</span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block truncate text-[15px] font-semibold', tone.text)}>{c.subject}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {sub ? <span className="font-medium text-amber-800">{t('family.timetable.substitute', { name: sub })}</span> : c.teacher}
                        {c.room && <span className="ml-1.5 inline-flex items-center gap-0.5"><DoorOpen className="h-3 w-3" aria-hidden />{c.room}</span>}
                      </span>
                    </span>
                    {live && <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">{t('family.timetable.now')}</span>}
                  </div>
                ) : (
                  <div className="flex flex-1 items-center rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-ink-faint">{t('family.timetable.free')}</div>
                )}
              </li>
            )
          })}
        </ol>
      </FCard>
    </>
  )
}
