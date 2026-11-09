import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { MapPin, RefreshCw } from 'lucide-react'
import { ControlChip, Note, PageContainer, Skeleton } from '../../components/system'
import Button from '../../components/ui/Button'
import DayRibbon from '../../components/dashboard/live/DayRibbon'
import PrioritiesPanel from '../../components/dashboard/live/PrioritiesPanel'
import SyllabusPanel from '../../components/dashboard/live/SyllabusPanel'
import TeachersPanel from '../../components/dashboard/live/TeachersPanel'
import TimetableMatrix from '../../components/dashboard/live/TimetableMatrix'
import WeekAhead from '../../components/dashboard/live/WeekAhead'
import { situationOf, usePlain } from '../../components/dashboard/live/liveKit'
import { fetchLiveCampus } from '../../api/dashboard'
import { useFormat } from '../../context/SettingsContext'

/**
 * Dashboard › Live campus, written for a principal: a plain sentence or two on what is going on, six figures each with
 * a line saying what it means, what needs doing first, which teachers are not in, today's timetable class by class,
 * the next seven days and the syllabus against the plan. Refreshes every minute; another period (the strip) or
 * another day can be looked at instead of now — the wording then says it is the plan, or what happened.
 */

const NUM = { danger: 'text-rose-600', warning: 'text-amber-600', normal: 'text-ink' }

/** One figure: plain label with a "?" that explains it, the number, and a grey line saying what it means. */
function Figure({ it }) {
  const [help, setHelp] = useState(false)
  return (
    <div className="min-w-0 bg-surface px-3 py-3 sm:px-4">
      <p className="flex items-start gap-1 text-[11.5px] text-ink-muted">
        <span className="min-w-0 leading-tight">{it.label}</span>
        <button type="button" onClick={() => setHelp((v) => !v)} title={it.help} aria-label={it.help} aria-expanded={help}
          className="mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-border text-[9px] font-semibold text-ink-faint hover:border-ink-faint hover:text-ink">?</button>
      </p>
      <p className={clsx('mt-0.5 text-xl font-semibold tabular-nums sm:text-[22px]', NUM[it.level ?? 'normal'])}>{it.value}</p>
      {it.sub && <p className="text-[11.5px] leading-snug text-ink-faint">{it.sub}</p>}
      {help && <p className="mt-1.5 rounded-md bg-bg px-2 py-1.5 text-[11.5px] leading-snug text-ink-muted">{it.help}</p>}
    </div>
  )
}

function Figures({ items }) {
  const cols = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4', 5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5', 6: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6' }[items.length] ?? 'grid-cols-3'
  return (
    <div className={clsx('grid gap-px overflow-hidden rounded-xl border border-border bg-border', cols)}>
      {items.map((it) => <Figure key={it.key} it={it} />)}
    </div>
  )
}

export default function Live() {
  const { t } = useTranslation('dashboard')
  const { time } = useFormat()
  const { clock, longDate } = usePlain()
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
    if (open && d.teachers) {
      const expected = s.teachersExpected
      if (sit === 'FUTURE' && !n.isToday) lines.push(tc.ON_LEAVE ? t('dashboard.live.say.teachersPlanLeave', { count: expected, leave: tc.ON_LEAVE }) : t('dashboard.live.say.teachersPlan', { count: expected }))
      else if (s.teachersIn === 0) lines.push(t(n.phase === 'BEFORE' && n.isToday ? 'dashboard.live.say.teachersNoneYet' : 'dashboard.live.say.teachersNone', { count: expected }))
      else if (s.teachersIn >= expected) lines.push(t('dashboard.live.say.teachersAll', { count: expected }))
      else lines.push([t('dashboard.live.say.teachersSome', { in: s.teachersIn, count: expected }), away && t('dashboard.live.say.teachersAway', { count: away }), notIn && t('dashboard.live.say.teachersNotIn', { count: notIn })].filter(Boolean).join('; ') + '.')
    }
    if (open && s.attendance) {
      const a = s.attendance
      const by = clock(d.markBefore)
      if (sit === 'FUTURE' && !n.isToday) lines.push(t('dashboard.live.say.attendancePlan', { time: by }))
      else if (a.marked === 0) lines.push(overdueClasses ? t('dashboard.live.say.attendanceNoneLate', { time: by }) : t('dashboard.live.say.attendanceNone', { time: by }))
      else if (a.marked >= a.sections) lines.push(t('dashboard.live.say.attendanceAll', { count: a.sections, pct: a.pct ?? 0 }))
      else lines.push(t('dashboard.live.say.attendanceSome', { marked: a.marked, count: a.sections, time: by }))
    }
    if (open && s.uncovered != null) lines.push(s.uncovered ? t('dashboard.live.say.uncovered', { count: s.uncovered }) : t('dashboard.live.say.covered'))
  }

  // ── the six figures
  const figures = []
  if (s && open && d.teachers) {
    const exp = s.teachersExpected
    const sub = sit === 'FUTURE' && !n.isToday ? t('dashboard.live.fig.teachersPlan')
      : s.teachersIn >= exp ? t('dashboard.live.fig.teachersAll')
        : s.teachersIn === 0 ? t('dashboard.live.fig.teachersNone')
          : [away && t('dashboard.live.fig.teachersAway', { count: away }), notIn && t('dashboard.live.fig.teachersNotIn', { count: notIn })].filter(Boolean).join(' · ')
    figures.push({ key: 'teachers', label: t('dashboard.live.fig.teachers'), help: t('dashboard.live.fig.teachersHelp'), value: sit === 'FUTURE' && !n.isToday ? t('dashboard.live.fig.expected', { count: exp }) : t('dashboard.live.fig.of', { n: s.teachersIn, total: exp }), level: away || lateNotIn ? 'warning' : 'normal', sub })
  }
  if (s && open && d.sections.length) {
    const sub = n.phase !== 'PERIOD' ? t('dashboard.live.fig.lessonsNoPeriod')
      : t(sit === 'FUTURE' ? 'dashboard.live.fig.lessonsOtherPlan' : 'dashboard.live.fig.lessonsOther', { count: s.sections - s.running })
    figures.push({ key: 'lessons', label: sit === 'LIVE' ? t('dashboard.live.fig.lessons') : t('dashboard.live.fig.lessonsAt', { time: clock(n.time) }), help: t('dashboard.live.fig.lessonsHelp'), value: t('dashboard.live.fig.of', { n: s.running, total: s.sections }), sub })
  }
  if (s && open && s.uncovered != null) {
    figures.push({ key: 'uncovered', label: t('dashboard.live.fig.uncovered'), help: t('dashboard.live.fig.uncoveredHelp'), value: s.uncovered ? s.uncovered : t('dashboard.live.fig.none'), level: s.uncovered ? 'danger' : 'normal', sub: s.uncovered ? t('dashboard.live.fig.uncoveredSub') : t('dashboard.live.fig.allCovered') })
  }
  if (s?.attendance && open) {
    const a = s.attendance
    const planned = sit === 'FUTURE' && !n.isToday
    const sub = planned ? t('dashboard.live.fig.attendancePlan', { time: clock(d.markBefore) })
      : a.marked >= a.sections && a.pct != null ? t('dashboard.live.fig.attendanceDone', { pct: a.pct }) : t('dashboard.live.fig.attendanceDue', { time: clock(d.markBefore) })
    figures.push({ key: 'attendance', label: t('dashboard.live.fig.attendance'), help: t('dashboard.live.fig.attendanceHelp', { time: clock(d.markBefore) }), value: planned ? t('dashboard.live.fig.notYet') : t('dashboard.live.fig.ofClasses', { n: a.marked, total: a.sections }), level: overdueClasses ? 'danger' : 'normal', sub })
  }
  if (s && s.syllabusBehind != null) {
    figures.push({ key: 'syllabus', label: t('dashboard.live.fig.syllabus'), help: t('dashboard.live.fig.syllabusHelp'), value: s.syllabusBehind, level: s.syllabusBehind ? 'warning' : 'normal', sub: t('dashboard.live.fig.syllabusSub', { done: d.syllabus?.avgPct ?? 0, expected: d.syllabus?.avgExpected ?? 0 }) })
  }
  if (s) {
    const parts = d.priorities.find((p) => p.key === 'approvals')?.parts ?? []
    figures.push({ key: 'approvals', label: t('dashboard.live.fig.approvals'), help: t('dashboard.live.fig.approvalsHelp'), value: s.approvals, sub: parts.length ? parts.map((x) => t(`dashboard.live.priorities.parts.${x.key}`, { count: x.count })).join(' · ') : t('dashboard.live.fig.nothingWaiting') })
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">{t('dashboard.live.title')}</h1>
              {n && sit === 'LIVE' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('dashboard.live.liveNow')}
                </span>
              )}
            </div>
            {n ? (
              <div className="mt-1.5 space-y-0.5 text-[14px] leading-relaxed text-ink">
                {lines.map((l, i) => <p key={i} className={i ? 'text-ink-muted' : undefined}>{l}</p>)}
              </div>
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
        {d?.frame?.length > 0 && open && <DayRibbon frame={d.frame} now={n} at={at} onPick={(v) => set({ at: v })} />}
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
          {figures.length > 0 && <Figures items={figures} />}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
            <PrioritiesPanel priorities={d.priorities} markBefore={d.markBefore} className={d.teachers && open ? 'xl:col-span-2' : 'xl:col-span-3'} />
            {d.teachers && open && <TeachersPanel teachers={d.teachers} now={n} firstStart={firstStart} />}
          </div>

          {open && d.sections.length > 0 && <TimetableMatrix data={d} />}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
            {d.agenda.length > 0 && <WeekAhead agenda={d.agenda} today={n.today} />}
            {d.syllabus && d.syllabus.rows.length > 0 && <SyllabusPanel syllabus={d.syllabus} />}
          </div>
        </>
      )}
    </PageContainer>
  )
}

function addDay(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
}
