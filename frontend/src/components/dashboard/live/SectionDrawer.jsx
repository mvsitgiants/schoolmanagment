import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Drawer } from '../../system'
import Button from '../../ui/Button'
import { hasPermission } from '../../../api/auth'
import { Initials, PresenceDot, ThinBar, usePlain } from './liveKit'

// One section's day, opened from its row: every period with who teaches it and whether they are in, the attendance
// taken today, and how far each subject's syllabus has got against the year plan. Calm like the page: grey and ink,
// teal for now, red only for an uncovered period or a register overdue.

function H({ children }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{children}</h3>
}

export default function SectionDrawer({ section: s, data, onClose }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  if (!s) return null
  const syllabus = (data.syllabus?.rows ?? []).filter((r) => r.sectionId === s.id).sort((a, b) => a.subject.localeCompare(b.subject))
  const a = s.attendance
  const facts = [
    s.classTeacher && t('dashboard.live.drawer.classTeacher', { name: s.classTeacher.name }),
    s.room && t('dashboard.live.drawer.room', { room: s.room }),
    t('dashboard.live.drawer.students', { count: s.strength }),
  ].filter(Boolean).join(' · ')
  return (
    <Drawer open onClose={onClose} size="xl" title={s.label} subtitle={t('dashboard.live.drawer.kicker')}>
      <div className="space-y-6">
        <p className="-mt-2 text-sm text-ink-muted">{facts}</p>

        <section>
          <H>{t('dashboard.live.drawer.day')}</H>
          {s.day.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {s.day.map((r) => {
                const who = r.substitute ?? r.teacher
                return (
                  <li key={r.period} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm', r.state === 'NOW' && 'bg-brand-50/60', r.uncovered && r.state !== 'DONE' && 'bg-rose-50/60')}>
                    <span className={clsx('w-16 shrink-0 text-xs tabular-nums', r.state === 'NOW' ? 'font-semibold text-brand-700' : 'text-ink-faint')}>
                      {t('dashboard.live.timetable.period', { no: r.period })}<span className="block text-[10.5px] font-normal">{clock(r.start)}</span>
                    </span>
                    <span className={clsx('min-w-0 flex-1 truncate', r.subject ? (r.state === 'DONE' ? 'text-ink-faint' : 'text-ink') : 'text-ink-faint')}>{r.subject ?? t('dashboard.live.drawer.noLesson')}</span>
                    {r.uncovered ? (
                      <span className={clsx('text-xs', r.state === 'DONE' ? 'text-ink-faint' : 'font-medium text-rose-600')}>{t('dashboard.live.drawer.uncovered', { name: r.teacher?.name ?? '' })}</span>
                    ) : who ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                        <Initials name={who.name} size={20} />
                        <span className="truncate">{who.name}</span>
                        <PresenceDot state={who.state} />
                        {who.state && !['PRESENT', 'EXPECTED', 'UNKNOWN'].includes(who.state) && <span className="text-[11px] text-ink-faint">({t(`dashboard.live.presence.${who.state}`).toLowerCase()})</span>}
                        {r.substitute && <span className="text-[11px] text-amber-600">{t('dashboard.live.drawer.sub')}</span>}
                      </span>
                    ) : null}
                    {r.state === 'NOW' && <span className="text-[11px] font-medium text-brand-700">{t('dashboard.live.drawer.now')}</span>}
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
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[['present', (a.present ?? 0) - (a.late ?? 0)], ['late', a.late ?? 0], ['leave', a.onLeave ?? 0], ['absent', a.absent ?? 0]].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border py-2">
                      <p className="text-base font-semibold text-ink tabular-nums">{v}</p>
                      <p className="text-[11px] text-ink-faint">{t(`dashboard.live.drawer.marks.${k}`)}</p>
                    </div>
                  ))}
                </div>
                <ThinBar value={a.total ? ((a.present ?? 0) / a.total) * 100 : 0} />
                {a.period && <p className="text-xs text-ink-muted">{a.period.marked ? t('dashboard.live.drawer.periodMarked', { no: a.period.period, present: a.period.present, absent: a.period.absent }) : t('dashboard.live.drawer.periodNotMarked', { no: a.period.period })}</p>}
              </div>
            ) : (
              <p className={clsx('text-sm', a.overdue ? 'text-rose-600' : 'text-ink-muted')}>
                {a.overdue ? t('dashboard.live.drawer.notMarkedLate', { time: clock(data.markBefore) }) : t('dashboard.live.drawer.notMarked', { time: clock(data.markBefore) })}
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
                    <span className="truncate text-ink">{r.subject}{r.teacher?.name && <span className="ms-1.5 text-ink-faint">{t('dashboard.live.syllabus.taughtBy', { name: r.teacher.name })}</span>}</span>
                    <span className={clsx('shrink-0 tabular-nums', r.behind > 1 ? 'text-amber-600' : 'text-ink-faint')}>
                      {r.expectedPct != null ? t('dashboard.live.syllabus.doneShould', { done: r.pct, expected: r.expectedPct }) : t('dashboard.live.syllabus.done', { done: r.pct })}
                    </span>
                  </div>
                  <ThinBar value={r.pct} tick={r.expectedPct} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {hasPermission('timetable.timetable.view') && <Button size="sm" variant="secondary" to={`/timetable/timetable?sectionId=${s.id}`}>{t('dashboard.live.drawer.openTimetable')}</Button>}
          {hasPermission('attendance.mark.view') && <Button size="sm" variant="secondary" to={`/attendance/mark?sectionId=${s.id}`}>{t('dashboard.live.drawer.openAttendance')}</Button>}
          {hasPermission('homework.syllabus.view') && <Button size="sm" variant="secondary" to={`/homework/syllabus?class=${s.classId}`}>{t('dashboard.live.drawer.openSyllabus')}</Button>}
        </div>
      </div>
    </Drawer>
  )
}
