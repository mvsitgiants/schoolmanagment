import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck, CalendarCheck, ClipboardList, Clock, LayoutGrid, MapPin, RefreshCw, School, UserX, UsersRound } from 'lucide-react'
import { ControlChip, Note, PageContainer, Skeleton, StatCardRow } from '../../components/system'
import Button from '../../components/ui/Button'
import DayRibbon from '../../components/dashboard/live/DayRibbon'
import LiveClassBoard from '../../components/dashboard/live/LiveClassBoard'
import PrioritiesPanel from '../../components/dashboard/live/PrioritiesPanel'
import SyllabusPanel from '../../components/dashboard/live/SyllabusPanel'
import TeachersPanel from '../../components/dashboard/live/TeachersPanel'
import WeekAhead from '../../components/dashboard/live/WeekAhead'
import { fetchLiveCampus } from '../../api/dashboard'
import { useFormat } from '../../context/SettingsContext'

/**
 * Dashboard › Live campus: what is happening in the school right now, class by class — the period, the teacher and
 * whether they are in, substitutes and uncovered periods, attendance — with the teachers, the syllabus against the
 * plan, what needs attention first and the next seven days. Refreshes every minute; a period on the ribbon (or
 * another day) can be looked at instead of now.
 */
export default function Live() {
  const { t } = useTranslation('dashboard')
  const { date, time } = useFormat()
  const [params, setParams] = useSearchParams()
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
  const phaseLine = !n ? '' : n.phase === 'PERIOD' ? t('dashboard.live.phase.PERIOD', { no: n.slot?.no, start: n.slot?.start, end: n.slot?.end })
    : n.phase === 'BREAK' ? (n.slot?.label || t('dashboard.live.board.break'))
      : n.phase === 'CLOSED' ? (n.holiday || t('dashboard.live.phase.CLOSED')) : t(`dashboard.live.phase.${n.phase}`)
  const s = d?.summary
  const tiles = []
  const open = !!n?.schoolDay
  if (s && d.teachers && open) {
    tiles.push({ icon: UsersRound, tone: s.teachersIn >= s.teachersExpected ? 'success' : 'warning', label: t('dashboard.live.strip.teachers'), value: `${s.teachersIn}/${s.teachersExpected}`, sub: t('dashboard.live.strip.teachersSub', { away: (d.teachers.counts.ABSENT ?? 0) + (d.teachers.counts.ON_LEAVE ?? 0), notIn: d.teachers.counts.NOT_IN_YET ?? 0 }), progress: s.teachersExpected ? (s.teachersIn / s.teachersExpected) * 100 : 0 })
  }
  if (s && d.sections.length && open) {
    tiles.push({ icon: School, tone: 'brand', label: t('dashboard.live.strip.running'), value: `${s.running}/${s.sections}`, sub: n.phase === 'PERIOD' ? t('dashboard.live.strip.runningSub', { free: s.inPeriod - s.running }) : phaseLine })
  }
  if (s && s.uncovered != null && open) {
    tiles.push({ icon: UserX, tone: s.uncovered ? 'danger' : 'success', label: t('dashboard.live.strip.uncovered'), value: s.uncovered, sub: s.uncovered ? t('dashboard.live.strip.uncoveredSub') : t('dashboard.live.strip.allCovered') })
  }
  if (s?.attendance && open) {
    const a = s.attendance
    tiles.push({ icon: CalendarCheck, tone: a.marked < a.sections ? 'warning' : 'success', label: t('dashboard.live.strip.attendance'), value: `${a.marked}/${a.sections}`, sub: a.pct != null ? t('dashboard.live.strip.attendanceSub', { pct: a.pct, present: a.present }) : t('dashboard.live.strip.nothingMarked'), progress: a.sections ? (a.marked / a.sections) * 100 : 0 })
  }
  if (s && s.syllabusBehind != null) {
    tiles.push({ icon: BookOpenCheck, tone: s.syllabusBehind ? 'warning' : 'success', label: t('dashboard.live.strip.syllabus'), value: s.syllabusBehind, sub: t('dashboard.live.strip.syllabusSub', { done: d.syllabus?.avgPct ?? 0, expected: d.syllabus?.avgExpected ?? '—' }) })
  }
  if (s) tiles.push({ icon: ClipboardList, tone: s.approvals ? 'violet' : 'success', label: t('dashboard.live.strip.approvals'), value: s.approvals, sub: s.approvals ? t('dashboard.live.strip.approvalsSub') : t('dashboard.live.strip.nothingWaiting') })

  return (
    <PageContainer>
      <div className="flex flex-col gap-3 border-b border-border/80 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-200/80 bg-brand-50 text-brand-600 shadow-sm"><LayoutGrid className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">{t('dashboard.live.title')}</h1>
                {n && (n.live ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" />{t('dashboard.live.liveNow')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                    <Clock className="h-3 w-3" aria-hidden />{n.isToday ? t('dashboard.live.lookingAt', { time: n.time }) : t('dashboard.live.lookingAtDay', { date: date(n.date), time: n.time })}
                  </span>
                ))}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted sm:text-sm">
                {n ? (
                  <>
                    <span className="font-semibold text-ink tabular-nums">{n.isToday ? n.clock : n.time}</span>
                    <span>{t(`dashboard.live.days.${n.day}`)} {date(n.date)}</span>
                    <span className="text-ink-faint">·</span>
                    <span className={clsx('font-medium', n.phase === 'PERIOD' ? 'text-brand-700' : 'text-ink-muted')}>{phaseLine}</span>
                    {d.year && <span className="rounded border border-slate-200/70 bg-slate-100 px-1.5 py-px text-[11px] font-semibold text-ink">{d.year.name}</span>}
                  </>
                ) : t('dashboard.live.loading')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d?.branches?.length > 1 && (
              <ControlChip icon={MapPin} label={t('dashboard.live.campus')} active={!!branchId}
                value={d.branches.find((b) => b.id === branchId)?.name ?? t('dashboard.live.allCampuses')}
                options={[t('dashboard.live.allCampuses'), ...d.branches.map((b) => b.name)]}
                onChange={(v) => set({ branch: d.branches.find((b) => b.name === v)?.id ?? '' })} />
            )}
            {dataUpdatedAt > 0 && <span className="text-[11px] text-ink-faint">{t('dashboard.live.updated', { time: time(new Date(dataUpdatedAt), { seconds: true }) })}</span>}
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={isFetching} onClick={() => refetch()}>{t('dashboard.live.refresh')}</Button>
          </div>
        </div>
        {d?.frame?.length > 0 && n?.schoolDay && <DayRibbon frame={d.frame} now={n} at={at} onPick={(v) => set({ at: v })} />}
      </div>

      {error && <Note tone="danger">{error.message}</Note>}
      {n && n.isToday && !n.schoolDay && (
        <Note tone="warning">
          <p>{n.holiday ? t('dashboard.live.noSchoolHoliday', { name: n.holiday }) : t('dashboard.live.noSchool')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {n.prevSchoolDay && <Button size="sm" variant="secondary" onClick={() => set({ date: n.prevSchoolDay, at: '' })}>{t('dashboard.live.lastSchoolDay', { date: date(n.prevSchoolDay) })}</Button>}
            {n.nextSchoolDay && <Button size="sm" variant="secondary" onClick={() => set({ date: n.nextSchoolDay, at: '' })}>{t('dashboard.live.nextSchoolDay', { date: date(n.nextSchoolDay) })}</Button>}
          </div>
        </Note>
      )}
      {n && !n.isToday && (
        <Note tone="info" actions={<Button size="sm" variant="secondary" onClick={() => set({ date: '', at: '' })}>{t('dashboard.live.backToToday')}</Button>}>
          {t(n.date < n.today ? 'dashboard.live.viewingPast' : 'dashboard.live.viewingFuture', { date: date(n.date) })}
        </Note>
      )}
      {d && !d.year && <Note tone="warning">{t('dashboard.live.noYear')}</Note>}
      {d && d.year && !d.published && <Note tone="warning">{t('dashboard.live.noTimetable')}</Note>}

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
        </div>
      )}

      {d && (
        <>
          {tiles.length > 0 && <StatCardRow items={tiles} />}

          {open && (d.sections.length > 0 || d.year) && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink"><LayoutGrid className="h-4 w-4 text-ink-muted" aria-hidden />{t('dashboard.live.board.title')}</h2>
              <LiveClassBoard data={d} />
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <PrioritiesPanel priorities={d.priorities} className={d.teachers && open ? 'xl:col-span-5' : 'xl:col-span-12'} />
            {d.teachers && open && <div className="min-w-0 xl:col-span-7"><TeachersPanel teachers={d.teachers} /></div>}
          </div>

          {d.agenda.length > 0 && <WeekAhead agenda={d.agenda} today={n.today} />}
          {d.syllabus && d.syllabus.rows.length > 0 && <SyllabusPanel syllabus={d.syllabus} />}
        </>
      )}
    </PageContainer>
  )
}
