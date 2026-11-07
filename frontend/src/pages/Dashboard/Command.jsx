import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BellRing, BookOpenCheck, CalendarCheck, ChevronRight, ClipboardCheck, FileBadge, GraduationCap, IndianRupee, LayoutDashboard, RefreshCw } from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import { MiniBarChart, Note, PageContainer, PageHeader, Panel, ProgressBar, StatCardRow, HeaderButton } from '../../components/system'
import { fetchCommandCentre } from '../../api/dashboard'
import { useFormat } from '../../context/SettingsContext'

/** The principal's picture of today. Each block appears only for modules the role can see. */
export default function Command() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { date, dateTime } = useFormat()
  const { data: d, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({ queryKey: ['command-centre'], queryFn: fetchCommandCentre, refetchInterval: 5 * 60_000 })
  const day = (ymd) => String(Number(ymd.slice(8, 10))) // day of the month: short whatever the date format

  const kpis = []
  if (d?.students) kpis.push({ icon: GraduationCap, label: t('dashboard.command.students'), value: d.students.active, sub: t('dashboard.command.studentsSub', { boys: d.students.boys, girls: d.students.girls }), onClick: () => navigate('/students/directory') })
  if (d?.attendance) kpis.push({ icon: CalendarCheck, label: t('dashboard.command.attendanceToday'), value: d.attendance.pct === null ? '—' : `${d.attendance.pct}%`, sub: t('dashboard.command.attendanceSub', { absent: d.attendance.absent, marked: d.attendance.marked, total: d.attendance.sections }), tone: d.attendance.unmarkedCount ? 'warning' : 'success', onClick: () => navigate('/attendance/mark') })
  if (d?.fees) kpis.push({ icon: IndianRupee, label: t('dashboard.command.collectedToday'), value: formatINR(d.fees.today, { decimals: 0 }), sub: t('dashboard.command.collectedMonth', { amount: formatINRCompact(d.fees.month) }), tone: 'info', onClick: () => navigate('/fees/day-end') })
  if (d?.fees) kpis.push({ icon: IndianRupee, label: t('dashboard.command.outstanding'), value: formatINRCompact(d.fees.due), sub: t('dashboard.command.overdueSub', { amount: formatINRCompact(d.fees.overdue), count: d.fees.studentsOwing }), tone: d.fees.overdue ? 'danger' : 'neutral', onClick: () => navigate('/fees/dues') })

  return (
    <PageContainer>
      <PageHeader icon={LayoutDashboard} title={t('dashboard.command.title')} subtitle={d ? t('dashboard.command.subtitle', { date: date(d.today), year: d.year?.name ?? '—' }) : t('dashboard.command.loading')}
        actions={<HeaderButton icon={RefreshCw} onClick={() => refetch()} disabled={isFetching}>{t('dashboard.command.refresh')}</HeaderButton>} />
      {isLoading && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-black/5 animate-pulse" />)}</div>}
      {error && <Note tone="warning">{error.message}</Note>}
      {d && !d.year && <Note tone="warning">{t('dashboard.command.noYear')}</Note>}
      {d && (
        <div className="space-y-4">
          {d.pending.length > 0 && (
            <Panel title={t('dashboard.command.waiting')} icon={BellRing} iconTone="warning">
              <div className="flex flex-wrap gap-2">
                {d.pending.map((p) => (
                  <Link key={p.key} to={p.link} className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100">
                    <span className="font-semibold">{p.count}</span> {t(`dashboard.command.pending.${p.key}`, { count: p.count })} <ChevronRight size={14} />
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          {kpis.length > 0 && <StatCardRow items={kpis} />}

          <div className="grid lg:grid-cols-2 gap-4">
            {d.attendance && (
              <Panel title={t('dashboard.command.attendance')} icon={CalendarCheck} actions={<Link to="/attendance/reports" className="text-xs text-brand-600 hover:underline">{t('dashboard.command.open')}</Link>}>
                <MiniBarChart title={t('dashboard.command.attendanceTrend')} height={130} data={d.attendance.trend.map((x) => ({ label: day(x.date), value: x.pct ?? 0 }))} valueFormat={(v) => `${v}%`} />
                {d.attendance.unmarkedCount > 0
                  ? <Note tone="warning" className="mt-3">{t('dashboard.command.unmarked', { count: d.attendance.unmarkedCount, list: d.attendance.unmarked.join(', ') })}</Note>
                  : d.attendance.sections > 0 && <Note tone="success" className="mt-3">{t('dashboard.command.allMarked')}</Note>}
              </Panel>
            )}
            {d.fees && (
              <Panel title={t('dashboard.command.fees')} icon={IndianRupee} actions={<Link to="/reports/library?report=fees.collection" className="text-xs text-brand-600 hover:underline">{t('dashboard.command.open')}</Link>}>
                <MiniBarChart title={t('dashboard.command.collectionTrend')} height={130} data={d.fees.trend.map((x) => ({ label: day(x.date), value: x.amount / 100 }))} valueFormat={(v) => formatINRCompact(v * 100)} />
                <p className="text-xs text-ink-muted mt-3">{t('dashboard.command.receiptsToday', { count: d.fees.receiptsToday })}</p>
              </Panel>
            )}
            {d.exams && (
              <Panel title={t('dashboard.command.exams')} icon={ClipboardCheck} actions={<Link to="/exams/schedule" className="text-xs text-brand-600 hover:underline">{t('dashboard.command.open')}</Link>}>
                {d.exams.marking.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {d.exams.marking.map((e) => (
                      <div key={e.id}>
                        <div className="flex justify-between text-sm"><span className="font-medium text-ink">{e.name}</span><span className="text-ink-muted">{t('dashboard.command.sheetsLocked', { locked: e.locked, total: e.expected })}</span></div>
                        <ProgressBar value={e.expected ? Math.round((e.locked / e.expected) * 100) : 0} showValue={false} />
                      </div>
                    ))}
                  </div>
                )}
                {d.exams.upcoming.length > 0
                  ? <ul className="space-y-1.5 text-sm">{d.exams.upcoming.map((e) => <li key={e.id} className="flex justify-between"><span>{e.name}</span><span className="text-ink-muted">{date(e.startDate)}</span></li>)}</ul>
                  : !d.exams.marking.length && <p className="text-sm text-ink-faint">{t('dashboard.command.noExams')}</p>}
              </Panel>
            )}
            {(d.homework || d.certificates || d.students) && (
              <Panel title={t('dashboard.command.thisWeek')} icon={BookOpenCheck}>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {d.homework && <div><dt className="text-ink-muted">{t('dashboard.command.homeworkSet')}</dt><dd className="text-xl font-semibold text-ink font-mono-num">{d.homework.setThisWeek}</dd><dd className="text-xs text-ink-faint">{t('dashboard.command.dueToday', { count: d.homework.dueToday })}</dd></div>}
                  {d.students && <div><dt className="text-ink-muted">{t('dashboard.command.newAdmissions')}</dt><dd className="text-xl font-semibold text-ink font-mono-num">{d.students.joinedThisMonth}</dd><dd className="text-xs text-ink-faint">{t('dashboard.command.thisMonth')}</dd></div>}
                  {d.certificates && <div><dt className="text-ink-muted flex items-center gap-1"><FileBadge size={13} /> {t('dashboard.command.certificates')}</dt><dd className="text-xl font-semibold text-ink font-mono-num">{d.certificates.thisMonth}</dd><dd className="text-xs text-ink-faint">{t('dashboard.command.thisMonth')}</dd></div>}
                  {d.exams && <div><dt className="text-ink-muted">{t('dashboard.command.resultsOut')}</dt><dd className="text-xl font-semibold text-ink font-mono-num">{d.exams.published}</dd><dd className="text-xs text-ink-faint">{d.year?.name}</dd></div>}
                </dl>
              </Panel>
            )}
          </div>
          <p className="text-xs text-ink-faint">{t('dashboard.command.updated', { at: dateTime(new Date(dataUpdatedAt)) })}</p>
        </div>
      )}
    </PageContainer>
  )
}
