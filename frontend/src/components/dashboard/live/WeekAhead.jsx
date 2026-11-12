import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, Cake, CalendarDays, ClipboardCheck, IndianRupee, MonitorPlay, Plane, Users } from 'lucide-react'
import { Block, usePlain } from './liveKit'

// The next seven days as a plain agenda: a day header, then a line per thing — exams, events, PTMs, online tests,
// fees falling due, staff on leave, homework due, birthdays. Holidays in grey italic; only "periods need cover" in
// amber.

const ICON = { EXAM: ClipboardCheck, PTM: Users, EVENT: CalendarDays, TEST: MonitorPlay, FEES: IndianRupee, LEAVE: Plane, HOMEWORK: BookOpen, BIRTHDAY: Cake, STAFF_BIRTHDAY: Cake }

function line(item, t, { clock, money }) {
  const at = (hhmm) => (hhmm ? t('dashboard.live.week.atTime', { time: clock(hhmm) }) : '')
  switch (item.kind) {
    case 'HOMEWORK': return t('dashboard.live.week.homework', { count: item.count })
    case 'FEES': return t('dashboard.live.week.fees', { count: item.count, amount: money(item.amount ?? 0) })
    case 'EXAM': return t('dashboard.live.week.exam', { name: item.title, count: item.count })
    case 'LEAVE': return t('dashboard.live.week.leave', { count: item.count, names: item.title })
    case 'BIRTHDAY': return t('dashboard.live.week.birthdays', { count: item.count, names: item.title })
    case 'STAFF_BIRTHDAY': return t('dashboard.live.week.staffBirthdays', { count: item.count, names: item.title })
    case 'TEST': return t('dashboard.live.week.test', { name: item.title, at: at(item.sub) })
    case 'PTM': { const [a, b] = String(item.sub ?? '').split('–'); return t('dashboard.live.week.ptm', { name: item.title, from: clock(a), to: clock(b) }) }
    default: return t('dashboard.live.week.event', { name: item.title, at: at(item.sub) })
  }
}

export default function WeekAhead({ agenda: all, today, className, compact = false }) {
  const { t } = useTranslation('dashboard')
  const plain = usePlain()
  const agenda = compact ? all.filter((d) => d.date >= today && (d.items.length || d.cover > 0)).slice(0, 4) : all
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
  const dayLabel = (d) => (d.date === today || d.date === tomorrow
    ? `${t(d.date === today ? 'dashboard.live.week.today' : 'dashboard.live.week.tomorrow')} · ${plain.longDate(d.date)}`
    : plain.longDate(d.date))
  return (
    <Block title={compact ? t('dashboard.live.week.comingUp') : agenda[0]?.date === today ? t('dashboard.live.week.title') : t('dashboard.live.week.titleFrom', { date: plain.longDate(agenda[0]?.date ?? today) })} className={className}>
      {compact && !agenda.length && <p className="px-4 py-6 text-sm text-ink-muted">{t('dashboard.live.week.nothingAhead')}</p>}
      <ul className="divide-y divide-border">
        {agenda.map((d) => {
          const holidays = d.items.filter((x) => x.kind === 'HOLIDAY')
          const rest = d.items.filter((x) => x.kind !== 'HOLIDAY')
          const quiet = !rest.length && !d.cover && !holidays.length
          return (
            <li key={d.date} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={clsx('text-[12.5px] font-semibold', d.date === today ? 'text-brand-700' : 'text-ink')}>{dayLabel(d)}</span>
                {quiet && <span className="text-[11.5px] text-ink-faint">{d.working ? t('dashboard.live.week.nothing') : t('dashboard.live.week.noSchool')}</span>}
              </div>
              {!quiet && (
                <ul className="mt-1 space-y-0.5">
                  {holidays.map((h, i) => <li key={`h${i}`} className="text-[12.5px] italic text-ink-faint">{t('dashboard.live.week.holiday', { name: h.title })}</li>)}
                  {!d.working && !holidays.length && <li className="text-[12.5px] italic text-ink-faint">{t('dashboard.live.week.noSchool')}</li>}
                  {d.cover > 0 && <li className="text-[12.5px] font-medium text-amber-600">{t('dashboard.live.week.cover', { count: d.cover })}</li>}
                  {rest.map((it, i) => {
                    const Icon = ICON[it.kind] ?? CalendarDays
                    return (
                      <li key={`${it.kind}${i}`}>
                        <Link to={it.link} className="flex min-w-0 items-start gap-2 text-[12.5px] leading-snug text-ink hover:text-brand-700">
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
                          <span className="min-w-0">{line(it, t, plain)}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </Block>
  )
}
