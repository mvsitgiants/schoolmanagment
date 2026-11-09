import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarCheck2, CalendarDays, CalendarOff, Grid3x3 } from 'lucide-react'
import { ColumnBars, SectionCard, StatusPill, Tag } from '../../system'
import Button from '../../ui/Button'
import { hasPermission } from '../../../api/auth'
import { useFormat } from '../../../context/SettingsContext'
import { Figure, Legend, MARK_FILL, Quiet, SectionError, addDays, broken, list, pctTone, useLabels, useMonthShort, useWeekdayShort } from './kit'

const MARKS = ['P', 'L', 'HD', 'A', 'LV']

/** Student 360 › Attendance: the year's %, a calendar heat-map of the last three months, % by month, and leave asked for. */
export default function AttendanceTab({ a }) {
  const { t } = useTranslation('students')
  if (broken(a)) return <SectionCard icon={CalendarCheck2} title={t('students.profile.tabs.attendance')}><SectionError /></SectionCard>
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Summary a={a} />
        <Heatmap a={a} />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Months a={a} />
        <Leave a={a} />
      </div>
    </div>
  )
}

function Summary({ a }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  const tone = pctTone(a.pct, a.minimumPct)
  const c = a.counts
  return (
    <SectionCard icon={CalendarCheck2} title={t('students.profile.attendance.year')} hint={t('students.profile.attendance.range', { from: date(a.from), to: date(a.to) })}>
      {c.total === 0 ? <Quiet icon={CalendarOff} title={t('students.profile.attendance.none')} hint={t('students.profile.attendance.noneHint')} /> : (
        <>
          <div className="flex items-end justify-between gap-4">
            <Figure value={a.pct != null ? `${a.pct}%` : '—'} label={t('students.profile.attendance.present', { present: c.P + c.L + c.HD / 2, total: c.total })} tone={tone === 'success' ? undefined : tone} />
            {a.today && <span className="flex flex-col items-end gap-1 text-[11px] text-ink-faint">{t('students.profile.today.title')}<StatusPill tone={L.markTone(a.today)}>{L.mark(a.today)}</StatusPill></span>}
          </div>
          <div className="relative mt-4 h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <span className={clsx('block h-full rounded-full', { success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-rose-500', neutral: 'bg-ink-faint' }[tone])} style={{ width: `${Math.min(100, a.pct ?? 0)}%` }} />
            <span className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${a.minimumPct}%` }} title={t('students.profile.attendance.minimum', { pct: a.minimumPct })} />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">{t('students.profile.attendance.minimum', { pct: a.minimumPct })}</p>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MARKS.map((m) => (
              <li key={m} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                <span className={clsx('h-3 w-3 shrink-0 rounded-[3px]', MARK_FILL[m])} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{L.mark(m)}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">{c[m]}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 rounded-lg bg-bg px-2.5 py-2">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{t('students.profile.attendance.marked')}</span>
              <span className="text-sm font-semibold tabular-nums text-ink">{c.total}</span>
            </li>
          </ul>
          {hasPermission('attendance.register.view') && <Button size="sm" variant="ghost" className="mt-3" to="/attendance/register">{t('students.profile.attendance.register')}</Button>}
        </>
      )}
    </SectionCard>
  )
}

/** The last ~13 weeks as a calendar: a column per week (Monday first), a square per day coloured by the mark. */
function Heatmap({ a }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  const month = useMonthShort()
  const weekday = useWeekdayShort()
  const marks = new Map(list(a.days).map((d) => [d.date, d.status]))
  const today = a.to
  // start on the Monday on or before the first day shown
  const first = a.heatmapFrom
  const dow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7
  const start = addDays(first, -dow)
  const weeks = []
  for (let w = start; w <= today; w = addDays(w, 7)) weeks.push(w)
  const counts = Object.fromEntries(MARKS.map((m) => [m, 0]))
  for (const s of marks.values()) if (counts[s] != null) counts[s]++
  return (
    <SectionCard icon={Grid3x3} title={t('students.profile.attendance.calendar')} hint={t('students.profile.attendance.calendarHint')}>
      <div className="grid gap-[3px] sm:gap-1" style={{ gridTemplateColumns: `auto repeat(${weeks.length}, minmax(0, 1fr))` }}>
        <span />
        {weeks.map((w, i) => {
          const m = w.slice(0, 7)
          const firstOfMonth = i === 0 || weeks[i - 1].slice(0, 7) !== m
          return <span key={w} className="truncate text-[10px] font-medium text-ink-faint">{firstOfMonth ? month(m) : ''}</span>
        })}
        {[0, 1, 2, 3, 4, 5, 6].map((d) => (
          <Fragment key={d}>
            <span className="pe-1.5 text-end text-[10px] leading-none text-ink-faint self-center">{d % 2 === 0 ? weekday(addDays(start, d)) : ''}</span>
            {weeks.map((w) => {
              const day = addDays(w, d)
              const out = day < first || day > today
              const s = marks.get(day)
              return (
                <span key={day} title={out ? undefined : `${date(day)} · ${s ? L.mark(s) : t('students.profile.attendance.noMark')}`}
                  className={clsx('aspect-square w-full max-w-[2.25rem] justify-self-center rounded-[4px]', out ? 'bg-transparent' : s ? MARK_FILL[s] : 'bg-black/[0.05]', day === today && 'ring-2 ring-brand-400 ring-offset-1 ring-offset-surface')} />
              )
            })}
          </Fragment>
        ))}
      </div>
      <Legend className="mt-4" items={[...MARKS.map((m) => ({ label: L.mark(m), fill: MARK_FILL[m], count: counts[m] })), { label: t('students.profile.attendance.noMark'), fill: 'bg-black/[0.08]' }]} />
    </SectionCard>
  )
}

function Months({ a }) {
  const { t } = useTranslation('students')
  const month = useMonthShort()
  const months = list(a.months)
  if (!months.length) return <SectionCard icon={CalendarDays} title={t('students.profile.attendance.byMonth')}><Quiet icon={CalendarDays} title={t('students.profile.attendance.none')} /></SectionCard>
  return (
    <ColumnBars title={t('students.profile.attendance.byMonth')} subtitle={t('students.profile.glance.attendanceHint', { min: a.minimumPct })} height={120}
      items={months.map((m) => ({ id: m.month, label: `${month(m.month)} · ${t('students.profile.attendance.absentN', { count: m.absent })}`, short: month(m.month), value: Math.round(m.pct ?? 0), tone: pctTone(m.pct, a.minimumPct) }))} />
  )
}

function Leave({ a }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  const rows = list(a.leave)
  return (
    <SectionCard icon={CalendarOff} title={t('students.profile.attendance.leave')} count={rows.length || null} flush
      actions={hasPermission('attendance.leave.view') && <Button size="sm" variant="ghost" className="-my-1" to="/attendance/leave">{t('students.profile.open')}</Button>}>
      {rows.length === 0 ? <Quiet icon={CalendarOff} title={t('students.profile.attendance.noLeave')} /> : (
        <ul className="divide-y divide-border">
          {rows.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{date(l.from)}{l.to !== l.from ? ` – ${date(l.to)}` : ''}</span>
                <span className="block truncate text-[11px] text-ink-faint">{l.reason}{l.decisionNote ? ` · ${l.decisionNote}` : ''}</span>
              </span>
              {l.byFamily && <Tag tone="info" size="xs">{t('students.profile.attendance.byFamily')}</Tag>}
              <StatusPill tone={L.leaveTone(l.status)}>{L.leave(l.status)}</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
