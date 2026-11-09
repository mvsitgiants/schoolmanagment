import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  AlertCircle,
  BellRing,
  BookOpenCheck,
  Building2,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Compass,
  FileBadge,
  GraduationCap,
  IndianRupee,
  LayoutDashboard,
  Megaphone,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import {
  BreakdownDonut,
  Note,
  PageContainer,
  Panel,
  ProgressBar,
  StatCard,
  StatCardRow,
  TrendArea,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchCommandCentre } from '../../api/dashboard'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { useFormat } from '../../context/SettingsContext'
import { navFor } from '../../catalog/nav'
import { iconFor } from '../../catalog/icons'

const greetingKey = () => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'home.goodMorning'
  if (h >= 12 && h < 17) return 'home.goodAfternoon'
  return 'home.goodEvening'
}

/**
 * Flagship Home Page: Complete Executive Command Center Dashboard
 * & Full Application Launcher Hub.
 */
export default function Home() {
  const { t } = useTranslation(['dashboard', 'common', 'ui'])
  const navigate = useNavigate()
  const cl = useCatalogLabel()
  const me = useAuthUser()
  const { date, dateTime } = useFormat()
  const nav = useMemo(() => navFor(me), [me])
  const [moduleSearch, setModuleSearch] = useState('')

  const { data: d, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['command-centre'],
    queryFn: fetchCommandCentre,
    refetchInterval: 5 * 60_000,
  })

  const firstName = (me?.user?.name || '').split(' ')[0]
  const greeting = t(`common:${greetingKey()}`)
  const day = (ymd) => String(Number(ymd?.slice(8, 10) || '0'))

  // Attendance data structures
  const attendanceTrendData = (d?.attendance?.trend ?? []).map((x) => ({
    label: day(x.date),
    pct: x.pct ?? 0,
  }))

  const attendanceSegments = d?.attendance
    ? [
        { name: t('dashboard.command.present'), value: d.attendance.present || 0, color: '#10B981' },
        { name: t('dashboard.command.absent'), value: d.attendance.absent || 0, color: '#EF4444' },
        { name: t('dashboard.command.onLeave'), value: d.attendance.onLeave || 0, color: '#F59E0B' },
      ].filter((s) => s.value > 0)
    : []

  // Fees data structures
  const feesTrendData = (d?.fees?.trend ?? []).map((x) => ({
    label: day(x.date),
    amount: (x.amount || 0) / 100,
  }))

  // Primary Executive KPIs
  const kpis = []
  if (d?.students) {
    kpis.push({
      icon: GraduationCap,
      label: t('dashboard.command.students'),
      value: d.students.active,
      sub: t('dashboard.command.studentsSub', { boys: d.students.boys, girls: d.students.girls }),
      tone: 'brand',
      onClick: () => navigate('/students/directory'),
    })
  }

  if (d?.attendance) {
    const isUnmarked = (d.attendance.unmarkedCount || 0) > 0
    kpis.push({
      icon: CalendarCheck,
      label: t('dashboard.command.attendanceToday'),
      value: d.attendance.pct === null ? '—' : `${d.attendance.pct}%`,
      sub: t('dashboard.command.attendanceSub', {
        absent: d.attendance.absent,
        marked: d.attendance.marked,
        total: d.attendance.sections,
      }),
      trend: (d.attendance.trend ?? []).map((x) => x.pct ?? 0),
      tone: isUnmarked ? 'warning' : 'success',
      onClick: () => navigate('/attendance/mark'),
    })
  }

  if (d?.fees) {
    kpis.push({
      icon: IndianRupee,
      label: t('dashboard.command.collectedToday'),
      value: formatINR(d.fees.today, { decimals: 0 }),
      sub: t('dashboard.command.collectedMonth', { amount: formatINRCompact(d.fees.month) }),
      trend: (d.fees.trend ?? []).map((x) => x.amount / 100),
      tone: 'info',
      onClick: () => navigate('/fees/day-end'),
    })
  }

  if (d?.fees) {
    const hasOverdue = (d.fees.overdue || 0) > 0
    kpis.push({
      icon: IndianRupee,
      label: t('dashboard.command.outstanding'),
      value: formatINRCompact(d.fees.due),
      sub: t('dashboard.command.overdueSub', {
        amount: formatINRCompact(d.fees.overdue),
        count: d.fees.studentsOwing,
      }),
      tone: hasOverdue ? 'danger' : 'neutral',
      onClick: () => navigate('/fees/dues'),
    })
  }

  // Filtered modules for the launchpad
  const filteredNav = useMemo(() => {
    if (!moduleSearch.trim()) return nav
    const q = moduleSearch.toLowerCase()
    return nav
      .map((cat) => ({
        ...cat,
        modules: cat.modules.filter(
          (m) =>
            cl.module(m).toLowerCase().includes(q) ||
            m.pages.some((p) => cl.page(m.id, p).toLowerCase().includes(q))
        ),
      }))
      .filter((cat) => cat.modules.length > 0)
  }, [nav, moduleSearch, cl])

  return (
    <PageContainer className="pb-16 space-y-7 animate-fade-in">
      {/* 1. EXECUTIVE HERO HEADER */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface p-6 sm:p-7 shadow-card">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-600 mb-1.5">
              <Sparkles size={14} />
              <span>{t('dashboard.command.title')}</span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot" />
                {t('dashboard.command.liveOperations')}
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink tracking-tight">
              {firstName ? t('dashboard:homeHero.greetingName', { greeting, name: firstName }) : greeting}
            </h1>

            <p className="mt-1.5 text-xs sm:text-sm text-ink-muted flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {me?.tenant?.name && (
                <span className="inline-flex items-center gap-1.5 font-medium text-ink bg-slate-100 px-2.5 py-0.5 rounded-md border border-slate-200">
                  <Building2 size={13} className="text-brand-600" />
                  {me.tenant.name}
                </span>
              )}
              {d?.year?.name && (
                <span className="font-semibold text-ink bg-brand-50 text-brand-800 px-2.5 py-0.5 rounded-md border border-brand-200/80">
                  {d.year.name}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-ink-muted">
                <Calendar size={13} className="text-ink-faint" />
                {d ? date(d.today) : t('dashboard.command.loading')}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              loading={isFetching}
              onClick={() => refetch()}
              className="shadow-sm"
            >
              {t('dashboard.command.refresh')}
            </Button>
          </div>
        </div>

        {/* Quick Commands Bar */}
        <div className="relative z-10 flex flex-wrap items-center gap-2 pt-4 mt-4 border-t border-border/60">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1.5 me-1">
            <Zap size={13} className="text-amber-500" />
            {t('dashboard.command.quickCommands')}:
          </span>
          {hasPermission('attendance.mark.view') && (
            <Link
              to="/attendance/mark"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-border/80 text-xs font-semibold text-ink hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300 transition-colors shadow-sm"
            >
              <CalendarCheck size={13} className="text-emerald-600" />
              <span>{t('dashboard.command.cmdMarkAttendance')}</span>
            </Link>
          )}
          {hasPermission('fees.invoices.view') && (
            <Link
              to="/fees/collect"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-border/80 text-xs font-semibold text-ink hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300 transition-colors shadow-sm"
            >
              <IndianRupee size={13} className="text-blue-600" />
              <span>{t('dashboard.command.cmdCollectFee')}</span>
            </Link>
          )}
          {hasPermission('students.directory.create') && (
            <Link
              to="/students/admit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-border/80 text-xs font-semibold text-ink hover:bg-brand-50 hover:text-brand-800 hover:border-brand-300 transition-colors shadow-sm"
            >
              <UserPlus size={13} className="text-brand-600" />
              <span>{t('dashboard.command.cmdAdmitStudent')}</span>
            </Link>
          )}
          {hasPermission('communication.notices.view') && (
            <Link
              to="/communication/notices"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-border/80 text-xs font-semibold text-ink hover:bg-purple-50 hover:text-purple-800 hover:border-purple-300 transition-colors shadow-sm"
            >
              <Megaphone size={13} className="text-purple-600" />
              <span>{t('dashboard.command.cmdPostNotice')}</span>
            </Link>
          )}
          {hasPermission('exams.schedule.view') && (
            <Link
              to="/exams/schedule"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-border/80 text-xs font-semibold text-ink hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-300 transition-colors shadow-sm"
            >
              <ClipboardCheck size={13} className="text-indigo-600" />
              <span>{t('dashboard.command.cmdScheduleExam')}</span>
            </Link>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-black/5 animate-pulse" />
          ))}
        </div>
      )}

      {error && <Note tone="danger">{error.message}</Note>}
      {d && !d.year && <Note tone="warning">{t('dashboard.command.noYear')}</Note>}

      {d && (
        <>
          {/* 2. ACTION-REQUIRED DECISIONS BANNER */}
          {d.pending && d.pending.length > 0 && (
            <div className="rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-50/90 via-amber-50/60 to-orange-50/40 p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200 shadow-sm">
                    <BellRing className="w-5 h-5 animate-bounce" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-bold text-amber-950">
                      {t('dashboard.command.waiting')}
                    </h3>
                    <p className="text-xs text-amber-800/80">{t('dashboard.command.waitingSub')}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {d.pending.map((p) => (
                    <Link
                      key={p.key}
                      to={p.link}
                      className="group inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-surface/90 px-3.5 py-1.5 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100 hover:border-amber-400 transition-all card-hover"
                    >
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold">
                        {p.count}
                      </span>
                      <span>{t(`dashboard.command.pending.${p.key}`, { count: p.count })}</span>
                      <ChevronRight size={14} className="text-amber-700 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 3. PRIMARY EXECUTIVE KPIS */}
          {kpis.length > 0 && <StatCardRow items={kpis} />}

          {/* 4. VISUAL ANALYTICS INTELLIGENCE GRID */}
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            {/* ATTENDANCE INTELLIGENCE */}
            {d.attendance && (
              <div className="ui-panel bg-surface border border-border/80 rounded-2xl shadow-card p-5">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/70">
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/80 flex items-center justify-center shrink-0 shadow-sm">
                      <CalendarCheck className="w-4 h-4" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-ink">
                        {t('dashboard.command.attendance')}
                      </h3>
                      <p className="text-xs text-ink-muted">
                        {t('dashboard.command.sectionsMarkedToday', { sections: d.attendance.sections, marked: d.attendance.marked })}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/attendance/reports"
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 hover:underline"
                  >
                    {t('dashboard.command.open')} <ChevronRight size={13} />
                  </Link>
                </div>

                <div className="grid sm:grid-cols-5 gap-4 items-center">
                  {/* Attendance Breakdown Donut */}
                  <div className="sm:col-span-2 flex flex-col items-center">
                    <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                      {t('dashboard.command.attendanceBreakdown')}
                    </span>
                    <BreakdownDonut
                      segments={attendanceSegments}
                      centerValue={d.attendance.pct != null ? `${d.attendance.pct}%` : '—'}
                      centerLabel={t('dashboard.command.attended')}
                      className="p-3 border-0 shadow-none bg-transparent"
                    />
                  </div>

                  {/* 7-day Attendance Trend Area */}
                  <div className="sm:col-span-3 min-w-0">
                    <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider block mb-2 text-start">
                      {t('dashboard.command.attendanceTrend')}
                    </span>
                    <TrendArea
                      height={180}
                      data={attendanceTrendData}
                      series={[{ key: 'pct', name: t('dashboard.command.attendanceSeries'), color: '#10B981' }]}
                      valueFormat={(v) => `${v}%`}
                      className="p-0 border-0 shadow-none bg-transparent"
                    />
                  </div>
                </div>

                {/* Attendance Alert Bar */}
                {d.attendance.unmarkedCount > 0 ? (
                  <div className="mt-4 p-3 rounded-xl bg-amber-50/80 border border-amber-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-start sm:items-center gap-2 text-xs text-amber-900">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                      <span>
                        <strong>{t('dashboard.command.classesUnmarked', { count: d.attendance.unmarkedCount })}</strong>{' '}
                        {d.attendance.unmarked.slice(0, 8).join(', ')}
                        {d.attendance.unmarked.length > 8 ? '…' : ''}
                      </span>
                    </div>
                    <Link to="/attendance/mark" className="shrink-0">
                      <Button size="sm" variant="secondary" className="text-xs h-7 py-0 px-2.5">
                        {t('dashboard.command.markAttendanceNow')}
                      </Button>
                    </Link>
                  </div>
                ) : (
                  d.attendance.sections > 0 && (
                    <div className="mt-4 p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 flex items-center gap-2 text-xs text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-medium">{t('dashboard.command.allMarked')}</span>
                    </div>
                  )
                )}
              </div>
            )}

            {/* FINANCIAL FLOW & FEE COLLECTIONS */}
            {d.fees && (
              <div className="ui-panel bg-surface border border-border/80 rounded-2xl shadow-card p-5">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/70">
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/80 flex items-center justify-center shrink-0 shadow-sm">
                      <IndianRupee className="w-4 h-4" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-ink">
                        {t('dashboard.command.fees')}
                      </h3>
                      <p className="text-xs text-ink-muted">
                        {t('dashboard.command.receiptsToday', { count: d.fees.receiptsToday })}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/reports/library?report=fees.collection"
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 hover:underline"
                  >
                    {t('dashboard.command.viewAllReports')} <ChevronRight size={13} />
                  </Link>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider block mb-1">
                    {t('dashboard.command.collectionTrend')}
                  </span>
                  <TrendArea
                    height={190}
                    data={feesTrendData}
                    series={[{ key: 'amount', name: t('dashboard.command.collectionSeries'), color: '#0284C7' }]}
                    valueFormat={(v) => formatINRCompact(v * 100)}
                    className="p-0 border-0 shadow-none bg-transparent"
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-border/70">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-border/60">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted block truncate">
                      {t('dashboard.command.todayInflow')}
                    </span>
                    <span className="text-base font-bold text-ink font-mono-num tabular-nums block mt-0.5">
                      {formatINRCompact(d.fees.today)}
                    </span>
                    <span className="text-[10px] text-ink-faint truncate block">{t('dashboard.command.receiptsCount', { count: d.fees.receiptsToday })}</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-border/60">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted block truncate">
                      {t('dashboard.command.thisMonthRevenue')}
                    </span>
                    <span className="text-base font-bold text-ink font-mono-num tabular-nums block mt-0.5">
                      {formatINRCompact(d.fees.month)}
                    </span>
                    <span className="text-[10px] text-emerald-700 font-semibold block">{t('dashboard.command.activeCollection')}</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-border/60">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted block truncate">
                      {t('dashboard.command.balanceDue')}
                    </span>
                    <span className="text-base font-bold text-ink font-mono-num tabular-nums block mt-0.5">
                      {formatINRCompact(d.fees.due)}
                    </span>
                    <span className="text-[10px] text-ink-faint truncate block">{t('dashboard.command.currentTerms')}</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200/80">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-800 block truncate">
                      {t('dashboard.command.overdueRisk')}
                    </span>
                    <span className="text-base font-bold text-rose-900 font-mono-num tabular-nums block mt-0.5">
                      {formatINRCompact(d.fees.overdue)}
                    </span>
                    <span className="text-[10px] text-rose-700 font-medium truncate block">
                      {t('dashboard.command.studentsOwing', { count: d.fees.studentsOwing })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* EXAMINATION HUB */}
            {d.exams && (
              <Panel
                title={t('dashboard.command.exams')}
                subtitle={t('dashboard.command.academicProgress')}
                icon={ClipboardCheck}
                iconTone="brand"
                actions={
                  <Link
                    to="/exams/schedule"
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 hover:underline"
                  >
                    {t('dashboard.command.open')} <ChevronRight size={13} />
                  </Link>
                }
              >
                {d.exams.marking.length > 0 ? (
                  <div className="space-y-4 mb-4">
                    {d.exams.marking.map((e) => {
                      const pct = e.expected ? Math.round((e.locked / e.expected) * 100) : 0
                      return (
                        <div key={e.id} className="p-3 rounded-xl bg-slate-50/80 border border-border/60">
                          <div className="flex items-center justify-between gap-2 text-sm mb-1.5">
                            <span className="font-semibold text-ink">{e.name}</span>
                            <span className="text-xs font-mono-num font-semibold text-ink-muted">
                              {t('dashboard.command.sheetsLocked', { locked: e.locked, total: e.expected })}
                            </span>
                          </div>
                          <ProgressBar value={pct} tone={pct >= 100 ? 'success' : pct > 50 ? 'brand' : 'warning'} />
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-ink-faint py-3">{t('dashboard.command.noExams')}</p>
                )}

                {d.exams.upcoming.length > 0 && (
                  <div className="pt-3 border-t border-border/70">
                    <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider block mb-2">
                      {t('dashboard.command.upcomingExams')}
                    </span>
                    <ul className="space-y-2 text-sm">
                      {d.exams.upcoming.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border/60 hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-brand-600" />
                            <span className="font-medium text-ink">{e.name}</span>
                          </div>
                          <span className="text-xs text-ink-muted bg-slate-100 px-2 py-0.5 rounded font-mono-num">
                            {date(e.startDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            )}

            {/* OPERATIONAL SNAPSHOT & GENDER DISTRIBUTION */}
            {(d.homework || d.certificates || d.students) && (
              <Panel
                title={t('dashboard.command.thisWeek')}
                subtitle={t('dashboard.command.operationsPulse')}
                icon={BookOpenCheck}
                iconTone="info"
              >
                <div className="grid grid-cols-2 gap-3.5">
                  {d.homework && (
                    <div className="p-3.5 rounded-xl bg-slate-50/90 border border-border/60 card-hover">
                      <dt className="text-xs font-medium text-ink-muted">{t('dashboard.command.homeworkSet')}</dt>
                      <dd className="text-2xl font-bold text-ink font-mono-num tabular-nums mt-1">
                        {d.homework.setThisWeek}
                      </dd>
                      <dd className="text-[11px] font-medium text-amber-700 mt-0.5">
                        {t('dashboard.command.dueToday', { count: d.homework.dueToday })}
                      </dd>
                    </div>
                  )}

                  {d.students && (
                    <div className="p-3.5 rounded-xl bg-slate-50/90 border border-border/60 card-hover">
                      <dt className="text-xs font-medium text-ink-muted">{t('dashboard.command.newAdmissions')}</dt>
                      <dd className="text-2xl font-bold text-ink font-mono-num tabular-nums mt-1">
                        {d.students.joinedThisMonth}
                      </dd>
                      <dd className="text-[11px] text-ink-faint mt-0.5">{t('dashboard.command.thisMonth')}</dd>
                    </div>
                  )}

                  {d.certificates && (
                    <div className="p-3.5 rounded-xl bg-slate-50/90 border border-border/60 card-hover">
                      <dt className="text-xs font-medium text-ink-muted flex items-center gap-1.5">
                        <FileBadge size={14} className="text-brand-600" />
                        {t('dashboard.command.certificates')}
                      </dt>
                      <dd className="text-2xl font-bold text-ink font-mono-num tabular-nums mt-1">
                        {d.certificates.thisMonth}
                      </dd>
                      <dd className="text-[11px] text-ink-faint mt-0.5">{t('dashboard.command.thisMonth')}</dd>
                    </div>
                  )}

                  {d.exams && (
                    <div className="p-3.5 rounded-xl bg-slate-50/90 border border-border/60 card-hover">
                      <dt className="text-xs font-medium text-ink-muted">{t('dashboard.command.resultsOut')}</dt>
                      <dd className="text-2xl font-bold text-ink font-mono-num tabular-nums mt-1">
                        {d.exams.published}
                      </dd>
                      <dd className="text-[11px] text-ink-faint mt-0.5">{d.year?.name}</dd>
                    </div>
                  )}
                </div>

                {/* Student Gender Ratio Bar */}
                {d.students && d.students.active > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/70">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-semibold text-ink-muted">
                        {t('dashboard.command.genderRatio')}
                      </span>
                      <span className="font-mono-num text-ink font-medium">
                        {d.students.boys} {t('dashboard.command.boys')} · {d.students.girls} {t('dashboard.command.girls')}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
                      <div
                        className="bg-sky-500 h-full transition-all duration-500"
                        style={{ width: `${Math.round((d.students.boys / d.students.active) * 100)}%` }}
                        title={`${t('dashboard.command.boys')}: ${Math.round((d.students.boys / d.students.active) * 100)}%`}
                      />
                      <div
                        className="bg-pink-500 h-full transition-all duration-500"
                        style={{ width: `${Math.round((d.students.girls / d.students.active) * 100)}%` }}
                        title={`${t('dashboard.command.girls')}: ${Math.round((d.students.girls / d.students.active) * 100)}%`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-ink-faint mt-1">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-sky-500" />
                        {t('dashboard.command.boys')} {Math.round((d.students.boys / d.students.active) * 100)}%
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-pink-500" />
                        {t('dashboard.command.girls')} {Math.round((d.students.girls / d.students.active) * 100)}%
                      </span>
                    </div>
                  </div>
                )}
              </Panel>
            )}
          </div>
        </>
      )}

      {/* 5. CAMPUS MODULES & APPLICATION LAUNCHPAD */}
      <div className="pt-6 border-t border-border/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="font-display text-xl font-bold text-ink tracking-tight flex items-center gap-2">
              <Compass className="w-5 h-5 text-brand-600" />
              {t('dashboard.command.modulesTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
              {t('dashboard.command.modulesSubtitle')}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              placeholder={t('dashboard.command.searchModules')}
              className="w-full ps-9 pe-3 py-1.5 text-xs rounded-xl border border-border bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
            />
          </div>
        </div>

        <div className="space-y-8">
          {filteredNav.map((cat) => (
            <section key={cat.id}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {cl.category(cat)}
                </h3>
                <span className="text-[11px] font-medium text-ink-faint bg-slate-100 px-2 py-0.5 rounded-full">
                  {cat.modules.length}
                </span>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {cat.modules.map((m) => {
                  const Icon = iconFor(m.icon)
                  return (
                    <Link
                      key={m.id}
                      to={m.pages[0].path}
                      className="group flex items-center gap-3.5 rounded-2xl border border-border/80 bg-surface p-4 shadow-card hover:border-brand-300 hover:shadow-card-hover transition-all card-hover"
                    >
                      <span
                        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105"
                        style={{ background: `${cat.color}18`, color: cat.color }}
                      >
                        <Icon className="w-5 h-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink text-sm sm:text-base tracking-tight truncate group-hover:text-brand-700 transition-colors">
                          {cl.module(m)}
                        </span>
                        <span className="block text-xs text-ink-muted truncate mt-0.5">
                          {m.pages.slice(0, 3).map((p) => cl.page(m.id, p)).join(' · ')}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand-600 group-hover:translate-x-1 transition-all shrink-0" />
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {d && (
        <div className="pt-2 flex items-center justify-between text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} />
            {t('dashboard.command.updated', { at: dateTime(new Date(dataUpdatedAt)) })}
          </span>
        </div>
      )}
    </PageContainer>
  )
}
