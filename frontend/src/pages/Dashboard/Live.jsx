import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, ChevronDown, IndianRupee, MapPin, RefreshCw, UserCheck, Users } from 'lucide-react'
import { ControlChip, Note, PageContainer, Skeleton } from '../../components/system'
import Button from '../../components/ui/Button'
import DayRibbon from '../../components/dashboard/live/DayRibbon'
import PrioritiesPanel from '../../components/dashboard/live/PrioritiesPanel'
import SyllabusPanel from '../../components/dashboard/live/SyllabusPanel'
import TimetableMatrix from '../../components/dashboard/live/TimetableMatrix'
import WeekAhead from '../../components/dashboard/live/WeekAhead'
import { AttendanceCard, QuickActions, Tiles } from '../../components/dashboard/live/Overview'
import { situationOf, usePlain } from '../../components/dashboard/live/liveKit'
import { hasPermission } from '../../api/auth'
import { fetchLiveCampus } from '../../api/dashboard'
import { useFormat } from '../../context/SettingsContext'

/**
 * Dashboard › Live campus, for a principal or the owner — what needs doing first, at a glance: one sentence on where
 * the day is, six figures that open the screen to deal with them (students present, teachers in, attendance taken,
 * lessons without a teacher, fees overdue, waiting for approval), what needs attention beside one-tap shortcuts,
 * today's attendance with the last school days, the syllabus against the plan, the teachers, every class today
 * (the period strip looks at another time), the next seven days and the last changes. Refreshes every minute.
 * Colour only where something needs doing: red to act now, amber to look at today.
 */

export default function Live() {
  const { t } = useTranslation('dashboard')
  const { time } = useFormat()
  const { clock, longDate, money } = usePlain()
  const [params, setParams] = useSearchParams()
  const [classes, setClasses] = useState(false) // every class today: folded away until asked for
  const at = params.get('at') ?? ''
  const day = params.get('date') ?? ''
  const branchId = params.get('branch') ?? ''
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  const { data: d, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['live-campus', at, day, branchId],
    queryFn: () => fetchLiveCampus({ at: at || undefined, date: day || undefined, branchId: branchId || undefined }),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })

  const n = d?.now
  const sit = situationOf(n)
  const open = !!n?.schoolDay
  const s = d?.summary
  const tc = d?.teachers?.counts
  const away = tc ? (tc.ABSENT ?? 0) + (tc.ON_LEAVE ?? 0) : 0
  const notIn = d?.teachers ? d.teachers.list.filter((x) => x.state === 'NOT_IN_YET').length : 0
  const lateNotIn = d?.teachers ? d.teachers.list.filter((x) => x.state === 'NOT_IN_YET' && x.overdue).length : 0
  const overdueClasses = d ? d.sections.filter((x) => x.attendance?.overdue).length : 0
  const firstStart = d?.frame?.find((x) => x.kind === 'PERIOD' && x.no > 0)?.start

  // ── the plain summary
  const lines = []
  if (n) {
    const when = n.isToday ? t('dashboard.live.say.today') : n.date === addDay(n.today, 1) ? t('dashboard.live.say.tomorrow') : n.date === addDay(n.today, -1) ? t('dashboard.live.say.yesterday') : null
    const dateText = longDate(n.date)
    const moment = !open ? (n.holiday ? t('dashboard.live.say.holiday', { name: n.holiday }) : t('dashboard.live.say.noSchool'))
      : n.phase === 'PERIOD' ? (n.slot?.no === 1 ? t('dashboard.live.say.firstPeriod', { start: clock(n.slot.start), end: clock(n.slot.end) }) : t('dashboard.live.say.period', { no: n.slot?.no, start: clock(n.slot?.start), end: clock(n.slot?.end) }))
        : n.phase === 'BREAK' ? t('dashboard.live.say.break', { name: (n.slot?.label || t('dashboard.live.break')).toLowerCase() })
          : n.phase === 'BEFORE' ? t('dashboard.live.say.before', { time: clock(firstStart) })
            : t('dashboard.live.say.after')
    if (sit === 'LIVE') lines.push(t('dashboard.live.say.nowLine', { date: dateText, time: clock(n.time), moment }))
    else lines.push(t(sit === 'FUTURE' ? 'dashboard.live.say.planLine' : 'dashboard.live.say.pastLine', { when: when ? `${when}, ${dateText}` : dateText, time: clock(n.time), moment }))
  }

  // ── the six figures, each opening the screen where it is dealt with
  const figures = []
  const planned = sit === 'FUTURE' && !n?.isToday
  const linkIf = (perm, to) => (hasPermission(perm) ? to : undefined)
  if (s?.attendance && open) {
    const a = s.attendance
    figures.push({
      key: 'students', icon: Users, label: t('dashboard.live.kpi.students'), help: t('dashboard.live.kpi.studentsHelp'),
      value: planned || !a.counted ? '–' : a.present, of: planned || !a.counted ? null : a.counted,
      sub: planned ? t('dashboard.live.fig.notYet') : !a.counted ? t('dashboard.live.kpi.studentsNone') : t('dashboard.live.kpi.studentsSub', { pct: a.pct ?? 0, absent: a.absent, leave: a.onLeave }),
      tone: a.counted && a.pct != null && a.pct < 85 ? 'warning' : 'normal', link: linkIf('attendance.reports.view', '/attendance/reports'),
    })
  }
  if (s && open && d.teachers) {
    const exp = s.teachersExpected
    const sub = planned ? t('dashboard.live.fig.teachersPlan')
      : s.teachersIn >= exp ? t('dashboard.live.fig.teachersAll')
        : s.teachersIn === 0 && !away ? t('dashboard.live.fig.teachersNone')
          : [away && t('dashboard.live.fig.teachersAway', { count: away }), notIn && t('dashboard.live.fig.teachersNotIn', { count: notIn })].filter(Boolean).join(' · ')
    figures.push({ key: 'teachers', icon: UserCheck, label: t('dashboard.live.fig.teachers'), help: t('dashboard.live.fig.teachersHelp'), value: planned ? exp : s.teachersIn, of: planned ? null : exp, bar: planned ? null : { value: s.teachersIn, max: exp }, tone: away || lateNotIn ? 'warning' : 'normal', sub, link: linkIf('hrms.attendance.view', '/hrms/attendance') })
  }
  if (s?.attendance && open) {
    const a = s.attendance
    figures.push({
      key: 'attendance', icon: CalendarCheck, label: t('dashboard.live.fig.attendance'), help: t('dashboard.live.fig.attendanceHelp', { time: clock(d.markBefore) }),
      value: planned ? '–' : a.marked, of: planned ? null : a.sections, bar: planned ? null : { value: a.marked, max: a.sections },
      sub: planned ? t('dashboard.live.fig.attendancePlan', { time: clock(d.markBefore) }) : a.marked >= a.sections ? t('dashboard.live.kpi.attendanceAll') : overdueClasses ? t('dashboard.live.kpi.attendanceLate', { count: overdueClasses, time: clock(d.markBefore) }) : t('dashboard.live.kpi.attendanceDue', { time: clock(d.markBefore) }),
      tone: overdueClasses ? 'danger' : 'normal', link: linkIf('attendance.mark.view', '/attendance/mark'),
    })
  }
  if (s && open && s.uncovered != null) {
  }
  const fees = d?.priorities.find((p) => p.key === 'feesOverdue')
  if (fees) figures.push({ key: 'fees', icon: IndianRupee, label: t('dashboard.live.kpi.fees'), help: t('dashboard.live.kpi.feesHelp'), value: money(fees.amount ?? 0), sub: t('dashboard.live.kpi.feesSub', { count: fees.count }), tone: 'warning', link: fees.link })

  return (
    <PageContainer>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[420px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">{t('dashboard.live.title')}</h1>
              {n && sit === 'LIVE' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('dashboard.live.liveNow')}
                </span>
              )}
            </div>
            {n ? (
              <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{lines[0]}</p>
            ) : <p className="mt-1 text-sm text-ink-muted">{t('dashboard.live.loading')}</p>}
            {n && sit !== 'LIVE' && (
              <Button size="sm" className="mt-2" onClick={() => set({ date: '', at: '' })}>{t('dashboard.live.seeNow')}</Button>
            )}
            {n && n.isToday && !open && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {n.prevSchoolDay && <button type="button" onClick={() => set({ date: n.prevSchoolDay, at: '' })} className="font-medium text-brand-600 hover:underline">{t('dashboard.live.lastSchoolDay', { date: longDate(n.prevSchoolDay) })}</button>}
                {n.nextSchoolDay && <button type="button" onClick={() => set({ date: n.nextSchoolDay, at: '' })} className="font-medium text-brand-600 hover:underline">{t('dashboard.live.nextSchoolDay', { date: longDate(n.nextSchoolDay) })}</button>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d?.branches?.length > 1 && (
              <ControlChip icon={MapPin} label={t('dashboard.live.campus')}
                value={d.branches.find((b) => b.id === branchId)?.name ?? t('dashboard.live.allCampuses')}
                options={[t('dashboard.live.allCampuses'), ...d.branches.map((b) => b.name)]}
                onChange={(v) => set({ branch: d.branches.find((b) => b.name === v)?.id ?? '' })} />
            )}
            {dataUpdatedAt > 0 && <span className="text-[11px] text-ink-faint">{t('dashboard.live.updated', { time: time(new Date(dataUpdatedAt)) })}</span>}
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={isFetching} onClick={() => refetch()}>{t('dashboard.live.refresh')}</Button>
          </div>
        </div>
      </div>

      {error && <Note tone="danger">{error.message}</Note>}
      {d && !d.year && <Note tone="warning">{t('dashboard.live.noYear')}</Note>}
      {d && d.year && !d.published && <Note tone="warning">{t('dashboard.live.noTimetable')}</Note>}

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}

      {d && (
        <>
          {figures.length > 0 && <Tiles items={figures} />}

          {/* what needs doing first, beside the shortcuts */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
            <PrioritiesPanel priorities={d.priorities} markBefore={d.markBefore} className="xl:col-span-2" />
            <QuickActions />
          </div>

          {/* students, the syllabus, what is coming up */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3 xl:items-start">
            {s?.attendance && open && <AttendanceCard a={s.attendance} days={d.attendanceDays} today={n.today} markBefore={d.markBefore} />}
            {d.syllabus && d.syllabus.rows.length > 0 && <SyllabusPanel syllabus={d.syllabus} compact />}
            {d.agenda.length > 0 && <WeekAhead agenda={d.agenda} today={n.today} compact />}
          </div>

          {/* every class today, only when asked for; the strip looks at another period */}
          {open && d.sections.length > 0 && (
            <div className="space-y-2">
              <button type="button" onClick={() => setClasses((v) => !v)} aria-expanded={classes}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                <ChevronDown className={classes ? 'h-4 w-4 rotate-180 transition' : 'h-4 w-4 transition'} aria-hidden />
                {classes ? t('dashboard.live.classesHide') : t('dashboard.live.classesShow', { count: d.sections.length })}
              </button>
              {classes && (
                <>
                  {d.frame?.length > 0 && <DayRibbon frame={d.frame} now={n} at={at} onPick={(v) => set({ at: v })} />}
                  <TimetableMatrix data={d} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}

function addDay(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
}
