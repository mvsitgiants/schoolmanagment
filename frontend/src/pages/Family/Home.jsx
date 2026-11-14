import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpenCheck, CalendarCheck, CalendarClock, IndianRupee, Megaphone, MessagesSquare, Trophy } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { FCard, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyHome } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const MARK_TONE = { P: 'success', L: 'success', HD: 'success', A: 'danger', LV: undefined }

/** The child's day at a glance: marked today?, homework due, fees due, the latest result. */
export default function FamilyHome() {
  const { t } = useTranslation('family')
  const { slug, studentId, student, has } = useFamily()
  const { date } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['home'], () => familyHome(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!d) return null
  const a = d.attendance
  return (
    <>
      <FCard>
        <p className="text-sm text-ink-muted">{t('family.home.hello')}</p>
        <p className="font-display text-xl font-semibold text-ink">{student?.name}</p>
        <p className="text-sm text-ink-muted">{[student?.class, student?.admissionNo].filter(Boolean).join(' · ')}</p>
      </FCard>

      {d.notices?.latest?.length > 0 && (
        <FCard title={t('family.home.notices')} action={<Link to={`/app/${slug}/notices`} className="text-sm font-medium text-brand-600">{t('family.home.allNotices')}</Link>}>
          <div className="divide-y divide-border -my-2">
            {d.notices.latest.map((n) => <FRow key={n.id} to={`/app/${slug}/notices`} icon={Megaphone} title={n.title} subtitle={date(String(n.publishedAt).slice(0, 10))} right={!n.read ? <span className="w-2.5 h-2.5 rounded-full bg-brand-500" aria-label={t('family.home.unread')} /> : null} />)}
          </div>
        </FCard>
      )}
      {d.chatUnread > 0 && <FCard><FRow to={`/app/${slug}/chat`} icon={MessagesSquare} title={t('family.home.chatUnread', { count: d.chatUnread })} /></FCard>}

      {(a || d.homework || d.fees || d.result || d.nextExam) && (
        <FCard title={t('family.home.today', { date: date(d.today) })}>
          <div className="divide-y divide-border -my-2">
            {a && <FRow to={`/app/${slug}/attendance`} icon={CalendarCheck} tone={MARK_TONE[a.today]}
              title={a.today ? t(`family.marks.${a.today}`) : t('family.home.notMarked')}
              subtitle={a.monthPct === null ? t('family.home.noAttendanceYet') : t('family.home.monthPct', { pct: a.monthPct, absent: a.absentThisMonth })} />}
            {d.homework && <FRow to={`/app/${slug}/homework`} icon={BookOpenCheck}
              title={d.homework.length ? t('family.home.homeworkDue', { count: d.homework.length }) : t('family.home.noHomework')}
              subtitle={d.homework[0] ? `${d.homework[0].subject}: ${d.homework[0].title} · ${t('family.home.due', { date: date(d.homework[0].dueDate) })}` : undefined} />}
            {d.fees && <FRow to={`/app/${slug}/fees`} icon={IndianRupee} tone={d.fees.overdue ? 'danger' : undefined}
              title={d.fees.due ? t('family.home.feesDue', { amount: formatINR(d.fees.due, { decimals: 0 }) }) : t('family.home.feesClear')}
              subtitle={d.fees.overdue ? t('family.home.overdue', { amount: formatINR(d.fees.overdue, { decimals: 0 }) }) : d.fees.nextDue && d.fees.due ? t('family.home.nextDue', { date: date(d.fees.nextDue) }) : undefined} />}
            {d.nextExam && <FRow to={`/app/${slug}/results`} icon={CalendarClock} title={d.nextExam.name} subtitle={t('family.home.examFrom', { date: date(d.nextExam.startDate) })} />}
            {d.result && has('RESULTS') && <FRow to={`/app/${slug}/results`} icon={Trophy} tone={d.result.held ? 'warning' : d.result.result === 'FAIL' ? 'danger' : 'success'}
              title={t('family.home.result', { exam: d.result.exam })} subtitle={d.result.held ? t('family.hold.result') : [d.result.pct !== null ? `${d.result.pct}%` : null, d.result.grade, t(`family.result.${d.result.result}`, d.result.resultLabel)].filter(Boolean).join(' · ')} />}
          </div>
        </FCard>
      )}
    </>
  )
}
