import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, Cake, CalendarDays, CalendarRange, ClipboardCheck, IndianRupee, MonitorPlay, PartyPopper, Plane, UserX, Users } from 'lucide-react'
import { formatINRCompact } from '@schoolgiant/shared'
import { Panel, TONE } from '../../system'
import { useFormat } from '../../../context/SettingsContext'

// The next seven days, a column a day: exams, events, PTMs, holidays, staff on leave (and how many periods will need
// cover), fee instalments falling due, birthdays, homework due and online tests opening.

const KIND = {
  HOLIDAY: { icon: PartyPopper, tone: 'danger' },
  EXAM: { icon: ClipboardCheck, tone: 'warning' },
  PTM: { icon: Users, tone: 'info' },
  EVENT: { icon: CalendarDays, tone: 'violet' },
  TEST: { icon: MonitorPlay, tone: 'sky' },
  FEES: { icon: IndianRupee, tone: 'orange' },
  LEAVE: { icon: Plane, tone: 'pink' },
  HOMEWORK: { icon: BookOpen, tone: 'teal' },
  BIRTHDAY: { icon: Cake, tone: 'brand' },
  STAFF_BIRTHDAY: { icon: Cake, tone: 'violet' },
}

function Chip({ item }) {
  const { t } = useTranslation('dashboard')
  const k = KIND[item.kind] ?? KIND.EVENT
  const tone = TONE[k.tone]
  const Icon = k.icon
  const title = item.kind === 'HOMEWORK' ? t('dashboard.live.week.homework', { count: item.count })
    : item.kind === 'FEES' ? t('dashboard.live.week.fees', { count: item.count, amount: formatINRCompact(item.amount ?? 0) })
      : item.kind === 'EXAM' ? t('dashboard.live.week.exam', { name: item.title, count: item.count })
        : item.kind === 'LEAVE' ? t('dashboard.live.week.leave', { count: item.count })
          : item.kind === 'BIRTHDAY' || item.kind === 'STAFF_BIRTHDAY' ? t(`dashboard.live.week.${item.kind === 'BIRTHDAY' ? 'birthdays' : 'staffBirthdays'}`, { count: item.count })
            : item.title
  const sub = item.kind === 'LEAVE' || item.kind === 'BIRTHDAY' || item.kind === 'STAFF_BIRTHDAY' || item.kind === 'FEES' ? item.title : item.sub
  return (
    <Link to={item.link} className={clsx('flex min-w-0 items-start gap-1.5 rounded-lg border px-2 py-1.5 text-start transition-colors hover:brightness-95', tone.bg, tone.border)}>
      <Icon className={clsx('mt-px h-3.5 w-3.5 shrink-0', tone.text)} aria-hidden />
      <span className="min-w-0">
        <span className={clsx('block text-[11.5px] font-semibold leading-snug line-clamp-2', tone.text)}>{title}</span>
        {sub && <span className="block truncate text-[10.5px] text-ink-muted">{sub}</span>}
      </span>
    </Link>
  )
}

export default function WeekAhead({ agenda, today, className }) {
  const { t } = useTranslation('dashboard')
  const { date } = useFormat()
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
  const label = (d) => (d.date === today ? t('dashboard.live.week.today') : d.date === tomorrow ? t('dashboard.live.week.tomorrow') : t(`dashboard.live.days.${d.day}`))
  return (
    <Panel title={t('dashboard.live.week.title')} subtitle={t('dashboard.live.week.subtitle')} icon={CalendarRange} iconTone="info" className={className} flush>
      <div className="flex snap-x gap-2 overflow-x-auto p-3 [scrollbar-width:thin] xl:grid xl:grid-cols-7 xl:overflow-visible">
        {agenda.map((d) => (
          <div key={d.date} className={clsx('flex min-w-[168px] snap-start flex-col gap-1.5 rounded-xl border p-2 xl:min-w-0', d.working ? 'border-border bg-surface' : 'border-dashed border-border bg-bg')}>
            <div className="flex items-baseline justify-between gap-1 px-0.5">
              <span className={clsx('text-[12.5px] font-semibold', d.date === today ? 'text-brand-700' : 'text-ink')}>{label(d)}</span>
              <span className="text-[10.5px] text-ink-faint tabular-nums">{date(d.date)}</span>
            </div>
            {d.cover > 0 && (
              <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold', d.date === today ? 'bg-rose-500 text-white' : 'bg-amber-100 text-amber-800')}>
                <UserX className="h-3.5 w-3.5" aria-hidden />{t('dashboard.live.week.cover', { count: d.cover })}
              </span>
            )}
            {!d.working && !d.items.some((x) => x.kind === 'HOLIDAY') && <span className="px-0.5 text-[11px] text-ink-faint">{t('dashboard.live.week.noSchool')}</span>}
            {d.items.map((it, j) => <Chip key={`${it.kind}${j}`} item={it} />)}
            {d.working && !d.items.length && !d.cover && <span className="px-0.5 py-2 text-[11px] text-ink-faint">{t('dashboard.live.week.nothing')}</span>}
          </div>
        ))}
      </div>
    </Panel>
  )
}
