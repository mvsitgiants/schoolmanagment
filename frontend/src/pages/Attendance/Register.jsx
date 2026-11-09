import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck, CalendarCheck, Percent, TriangleAlert, UsersRound } from 'lucide-react'
import { ATTENDANCE_MARKS, MARK_BY, attendancePct } from '@schoolgiant/shared'
import { ControlChip, Input, Note, PageContainer, PageHeader, PillRow, SideNav, SideNavLayout, Skeleton, StatCardRow, TONE, pillClass } from '../../components/system'
import RegisterGrid, { MARK_TONE } from '../../components/attendance/RegisterGrid'
import groupByClass, { classKeyOf } from '../../components/attendance/groupByClass'
import { fetchAttendanceBoard, fetchRegister } from '../../api/attendance'

/**
 * A section's month at a glance: a column per day, a row per student, totals and % on the right.
 * The classes are the page's side list (chips on a phone) and a class's sections are chips inside.
 */
export default function Register() {
  const { t } = useTranslation('attendance')
  const { data: board } = useQuery({ queryKey: ['attendance-board', ''], queryFn: () => fetchAttendanceBoard() })
  const sections = useMemo(() => board?.sections ?? [], [board])
  const classes = useMemo(() => groupByClass(sections), [sections])
  const [sectionId, setSectionId] = useState('')
  const [month, setMonth] = useState('')
  const [subjectId, setSubjectId] = useState('') // period-wise attendance: one subject's periods
  // start on the teacher's own section (the board lists theirs first), else the first one
  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id) }, [sections, sectionId])
  useEffect(() => { if (!month && board?.today) setMonth(board.today.slice(0, 7)) }, [board, month])
  const section = sections.find((s) => s.id === sectionId)
  const cls = section ? classes.find((c) => c.key === classKeyOf(section)) : null
  const pick = (id) => { setSectionId(id); setSubjectId('') }
  const { data: reg, isLoading } = useQuery({ queryKey: ['attendance-register', sectionId, month, subjectId], queryFn: () => fetchRegister(sectionId, month, subjectId), enabled: !!sectionId && !!month })
  // the month up to today: days marked, and working days (blank when missed) — not the days still to come
  const days = reg?.days.filter((d) => (d.taken || d.working) && (!board?.today || d.date <= board.today)) ?? []
  const students = reg?.students ?? []
  const min = reg?.minimumPct || 75
  const overall = reg ? attendancePct(students.reduce((m, r) => { for (const k of ['P', 'A', 'L', 'HD', 'LV', 'total']) m[k] += r.counts?.[k] ?? 0; return m }, { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })) : null
  const below = students.filter((r) => r.pct != null && r.pct < min).length
  const takenDays = reg ? reg.days.filter((d) => d.taken).length : 0

  const nav = classes.length > 1 && (
    <SideNav title={t('attendance.register.classesNav')} value={cls?.key} onChange={(key) => pick(classes.find((c) => c.key === key)?.sections[0]?.id ?? '')}
      items={classes.map((c) => ({
        id: c.key, label: c.name, hint: t('attendance.register.sectionsN', { count: c.sections.length }),
        count: c.sections.reduce((n, s) => n + (s.strength ?? 0), 0),
      }))} />
  )

  return (
    <PageContainer wide>
      <PageHeader icon={BookOpenCheck} title={t('attendance.register.title')} subtitle={t('attendance.register.subtitle')} />
      {board && !sections.length && <Note className="mt-4">{t('attendance.board.none')}</Note>}
      {sections.length > 0 && (
        <SideNavLayout className="mt-4" nav={nav}>
          {cls && cls.sections.length > 1 && (
            <PillRow>
              {cls.sections.map((s) => (
                <button key={s.id} type="button" aria-pressed={sectionId === s.id} onClick={() => pick(s.id)} className={pillClass(sectionId === s.id)}>
                  {s.short} <span className="tabular-nums opacity-70">· {s.strength}</span>
                </button>
              ))}
            </PillRow>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input type="month" className="w-52" value={month} max={board?.today?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label={t('attendance.register.month')} />
            {reg?.subjects?.length > 0 && (
              <ControlChip label={t('attendance.register.subject')} value={reg.subjects.find((x) => x.id === subjectId)?.name ?? t('attendance.register.wholeDay')} active={!!subjectId}
                options={[t('attendance.register.wholeDay'), ...reg.subjects.map((x) => x.name)]} onChange={(v) => setSubjectId(reg.subjects.find((x) => x.name === v)?.id ?? '')} />
            )}
          </div>
          {reg && students.length > 0 && (
            <StatCardRow items={[
              { icon: UsersRound, tone: 'brand', label: t('attendance.register.summary.students'), value: students.length },
              { icon: CalendarCheck, tone: 'info', label: t('attendance.register.summary.days'), value: takenDays },
              { icon: Percent, tone: overall == null ? 'neutral' : overall < min ? 'danger' : overall < 90 ? 'warning' : 'success', label: t('attendance.register.summary.average'), value: overall == null ? '—' : `${overall}%`, progress: overall ?? undefined },
              { icon: TriangleAlert, tone: below ? 'danger' : 'success', label: t('attendance.register.summary.below', { min }), value: below },
            ]} />
          )}
          {isLoading && <Skeleton className="h-64 rounded-2xl" />}
          {reg && (
            <RegisterGrid title={t('attendance.register.tableTitle', { section: reg.section.label, taken: takenDays })} days={days} students={students} minimumPct={reg.minimumPct}
              exportName={`attendance-${reg.section.label}-${month}`} emptyIcon={BookOpenCheck} emptyTitle={t('attendance.register.empty')} />
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
            {ATTENDANCE_MARKS.map((m) => {
              const tone = TONE[MARK_TONE[m.value] ?? 'neutral']
              return (
                <span key={m.value} className="inline-flex items-center gap-1.5">
                  <span className={clsx('inline-flex h-5 min-w-[20px] items-center justify-center rounded px-0.5 text-[10.5px] font-semibold font-mono-num', tone.bg, tone.text)}>{t(`attendance.short.${m.value}`, MARK_BY[m.value]?.short ?? m.value)}</span>
                  {t(`attendance.marks.${m.value}`, m.label)}
                </span>
              )
            })}
            <span className="text-ink-faint">{t('attendance.register.movedNote')}</span>
          </div>
        </SideNavLayout>
      )}
    </PageContainer>
  )
}
