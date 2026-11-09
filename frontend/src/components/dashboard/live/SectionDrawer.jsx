import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck, CalendarCheck, CalendarDays, UserX } from 'lucide-react'
import { ColorChip, Drawer, StackedBar, StatusPill, TONE } from '../../system'
import Button from '../../ui/Button'
import { hasPermission } from '../../../api/auth'
import { PresenceAvatar } from './liveKit'
import { SyllabusBar } from './SyllabusPanel'

// One section's day, opened from its card: every period (done · now · next) with who teaches it and whether they
// are in, the attendance taken today, and how far each subject's syllabus has got against the year plan.

const STATE_TONE = { DONE: 'neutral', NOW: 'brand', NEXT: 'info', LATER: 'neutral' }

function H({ children }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{children}</h3>
}

export default function SectionDrawer({ section: s, data, onClose }) {
  const { t } = useTranslation('dashboard')
  if (!s) return null
  const syllabus = (data.syllabus?.rows ?? []).filter((r) => r.sectionId === s.id).sort((a, b) => a.subject.localeCompare(b.subject))
  const a = s.attendance
  const sub = [
    s.classTeacher && t('dashboard.live.drawer.classTeacher', { name: s.classTeacher.name }),
    s.room && t('dashboard.live.drawer.room', { room: s.room }),
    t('dashboard.live.drawer.students', { count: s.strength }),
  ].filter(Boolean).join(' · ')
  return (
    <Drawer open onClose={onClose} size="xl" title={s.label} subtitle={t('dashboard.live.board.title')}>
      <div className="space-y-6">
        <p className="-mt-2 text-sm text-ink-muted">{sub}</p>
        <section>
          <H>{t('dashboard.live.drawer.day')}</H>
          {s.day.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {s.day.map((r) => {
                const teacher = r.substitute ?? r.teacher
                return (
                  <li key={r.period} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm', r.state === 'NOW' && 'bg-brand-50/60', r.state === 'DONE' && 'opacity-60', r.uncovered && 'bg-rose-50/60')}>
                    <span className="w-20 shrink-0 text-xs text-ink-muted tabular-nums">
                      {t('dashboard.live.board.periodShort', { no: r.period })}
                      <span className="block text-[10.5px] text-ink-faint">{r.start}–{r.end}</span>
                    </span>
                    <span className="min-w-0 flex-1">{r.subject ? <ColorChip label={r.subject} seed={r.subject} /> : <span className="text-xs text-ink-faint">{t('dashboard.live.drawer.free')}</span>}</span>
                    {r.uncovered ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700"><UserX className="h-3.5 w-3.5" aria-hidden />{t('dashboard.live.drawer.uncovered', { name: r.teacher?.name ?? '' })}</span>
                    ) : teacher ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                        <PresenceAvatar name={teacher.name} state={teacher.state} size={22} />
                        <span className="truncate">{teacher.name}</span>
                        {r.substitute && <span className="rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">{t('dashboard.live.drawer.sub')}</span>}
                      </span>
                    ) : null}
                    {r.state !== 'LATER' && <StatusPill tone={STATE_TONE[r.state]} dot={r.state === 'NOW'}>{t(`dashboard.live.drawer.state.${r.state}`)}</StatusPill>}
                  </li>
                )
              })}
            </ul>
          ) : <p className="text-sm text-ink-faint">{t('dashboard.live.drawer.noPeriods')}</p>}
        </section>

        {a && (
          <section>
            <H>{t('dashboard.live.drawer.attendance')}</H>
            {a.marked ? (
              <div className="rounded-xl border border-border p-3">
                <StackedBar segments={[
                  { label: t('dashboard.live.drawer.marks.present'), value: (a.present ?? 0) - (a.late ?? 0), color: '#10B981' },
                  { label: t('dashboard.live.drawer.marks.late'), value: a.late ?? 0, color: '#F59E0B' },
                  { label: t('dashboard.live.drawer.marks.leave'), value: a.onLeave ?? 0, color: '#94A3B8' },
                  { label: t('dashboard.live.drawer.marks.absent'), value: a.absent ?? 0, color: '#EF4444' },
                ]} />
                {a.period && <p className="mt-2 text-xs text-ink-muted">{a.period.marked ? t('dashboard.live.drawer.periodMarked', { no: a.period.period, present: a.period.present, absent: a.period.absent }) : t('dashboard.live.drawer.periodNotMarked', { no: a.period.period })}</p>}
              </div>
            ) : (
              <p className={clsx('rounded-xl border px-3 py-2.5 text-sm', a.overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                {a.overdue ? t('dashboard.live.drawer.notMarkedLate', { time: data.markBefore }) : t('dashboard.live.drawer.notMarked')}
              </p>
            )}
          </section>
        )}

        {syllabus.length > 0 && (
          <section>
            <H>{t('dashboard.live.drawer.syllabus')}</H>
            <ul className="space-y-2.5">
              {syllabus.map((r) => (
                <li key={r.subjectId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-ink">{r.subject}<span className="ms-1.5 font-normal text-ink-faint">{r.teacher?.name}</span></span>
                    <span className={clsx('shrink-0 tabular-nums', r.behind ? TONE.danger.text : 'text-ink-muted')}>{r.behind ? t('dashboard.live.syllabus.behindTopics', { count: r.behind }) : `${r.pct}%`}</span>
                  </div>
                  <SyllabusBar row={r} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {hasPermission('timetable.timetable.view') && <Button size="sm" icon={CalendarDays} to={`/timetable/timetable?sectionId=${s.id}`}>{t('dashboard.live.drawer.openTimetable')}</Button>}
          {hasPermission('attendance.mark.view') && <Button size="sm" variant="secondary" icon={CalendarCheck} to={`/attendance/mark?sectionId=${s.id}`}>{t('dashboard.live.drawer.openAttendance')}</Button>}
          {hasPermission('homework.syllabus.view') && <Button size="sm" variant="secondary" icon={BookOpenCheck} to={`/homework/syllabus?class=${s.classId}`}>{t('dashboard.live.drawer.openSyllabus')}</Button>}
        </div>
      </div>
    </Drawer>
  )
}
