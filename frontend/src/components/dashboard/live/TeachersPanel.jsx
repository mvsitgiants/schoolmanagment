import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { hasPermission } from '../../../api/auth'
import { Block, Initials, LEVEL_TEXT, PRESENCE_LEVEL, PRESENCE_ORDER, PresenceDot, isAway, situationOf, usePlain } from './liveKit'

// Teachers: one plain line of who is in (or, on a day still to come, who is expected and who is on leave), a thin bar,
// then only the teachers who need a look — absent, on leave, late, not arrived once school has started — with the
// lessons nobody is taking yet and a way to book a substitute. "Show all teachers" opens everyone.

function StateWord({ x }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  const level = PRESENCE_LEVEL[x.state] ?? 'muted'
  const word = x.state === 'ON_LEAVE' && x.leave?.half ? t(`dashboard.live.teachers.halfLeave.${x.leave.half}`) : t(`dashboard.live.presence.${x.state}`)
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 text-[11.5px]', level === 'ok' || level === 'muted' ? 'text-ink-muted' : `font-medium ${LEVEL_TEXT[level]}`)}>
      {level === 'ok' && <PresenceDot state={x.state} size={5} />}
      {word}
      {x.inTime && (x.state === 'PRESENT' || x.state === 'LATE') && <span className="font-normal text-ink-faint">{t('dashboard.live.teachers.at', { time: clock(x.inTime) })}</span>}
    </span>
  )
}

function Row({ x, plain }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  const open = x.uncovered.filter((u) => !u.done)
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Initials name={x.name} size={26} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] text-ink">{x.name}</p>
          <p className="truncate text-[11.5px] text-ink-faint">
            {x.now ? t('dashboard.live.teachers.teaching', { section: x.now.section, subject: x.now.subject })
              : x.free ? t('dashboard.live.teachers.freeNow')
                : x.periodsToday ? t('dashboard.live.teachers.lessonsToday', { count: x.periodsToday })
                  : x.designation}
          </p>
        </div>
        <StateWord x={x} />
      </div>
      {!plain && isAway(x.state) && x.uncovered.length > 0 && (
        <div className="space-y-1 ps-9">
          <p className="text-[11.5px] text-ink-muted">
            {open.length ? t('dashboard.live.teachers.needCover', { count: open.length }) : t('dashboard.live.teachers.allPast')}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {x.uncovered.map((u) => (
              <span key={`${u.sectionId}${u.period}`} title={u.suggestion ? t('dashboard.live.teachers.suggest', { name: u.suggestion.name }) : undefined}
                className={clsx('rounded border border-border px-1.5 py-px text-[11px]', u.done ? 'text-ink-faint line-through' : 'text-ink-muted')}>
                {t('dashboard.live.teachers.lessonChip', { no: u.period, section: u.section, time: clock(u.start) })}
              </span>
            ))}
            {open.length > 0 && hasPermission('timetable.substitutions.view') && (
              <Link to="/timetable/substitutions" className="ms-auto text-[11.5px] font-medium text-brand-600 hover:underline">{t('dashboard.live.teachers.findSubstitute')}</Link>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export default function TeachersPanel({ teachers, now, firstStart, className }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  const [all, setAll] = useState(false)
  const sit = situationOf(now)
  const planned = sit === 'FUTURE' && !now.isToday
  const list = useMemo(() => [...teachers.list].sort((a, b) => PRESENCE_ORDER.indexOf(a.state) - PRESENCE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name)), [teachers.list])
  const c = teachers.counts
  const inNow = c.PRESENT + c.LATE
  const expected = Math.max(0, c.total - c.OFF)
  const away = (c.ABSENT ?? 0) + (c.ON_LEAVE ?? 0)
  const notIn = c.NOT_IN_YET ?? 0
  const needsLook = (x) => isAway(x.state) || x.state === 'LATE' || (x.state === 'NOT_IN_YET' && x.overdue)
  const exceptions = list.filter(needsLook)
  const shown = all ? list : exceptions

  const summary = planned
    ? [t('dashboard.live.teachers.expected', { count: expected }), c.ON_LEAVE && t('dashboard.live.teachers.onLeaveCount', { count: c.ON_LEAVE })].filter(Boolean).join(' · ')
    : [t('dashboard.live.teachers.present', { n: inNow, count: expected }), away && t('dashboard.live.teachers.awayCount', { count: away }), notIn && t('dashboard.live.teachers.notInCount', { count: notIn })].filter(Boolean).join(' · ')
  const empty = planned ? t('dashboard.live.teachers.noLeavePlan')
    : inNow >= expected && expected > 0 ? t('dashboard.live.teachers.everyoneIn')
      : now.isToday && now.phase === 'BEFORE' ? t('dashboard.live.teachers.arriving', { time: clock(firstStart) })
        : notIn && !exceptions.length ? t('dashboard.live.teachers.notMarkedYet')
          : t('dashboard.live.teachers.noProblems')

  return (
    <Block title={t('dashboard.live.teachers.title')} className={className}
      actions={hasPermission('hrms.attendance.view') && <Link to="/hrms/attendance" className="text-xs font-medium text-brand-600 hover:underline">{t('dashboard.live.teachers.link')}</Link>}>
      <div className="space-y-2 px-4 py-3">
        <p className="text-[13px] text-ink">{summary}</p>
        {!planned && <span className="block h-1 w-full overflow-hidden rounded-full bg-black/[0.07]"><span className="block h-full rounded-full bg-ink/70" style={{ width: `${expected ? (inNow / expected) * 100 : 0}%` }} /></span>}
        {!planned && teachers.freeNow > 0 && <p className="text-[11.5px] text-ink-faint">{t('dashboard.live.teachers.freeCount', { count: teachers.freeNow })}</p>}
      </div>
      {shown.length ? (
        <ul className={clsx('divide-y divide-border border-t border-border', all && 'max-h-[420px] overflow-y-auto [scrollbar-width:thin]')}>
          {shown.map((x) => <Row key={x.id} x={x} plain={all && !needsLook(x)} />)}
        </ul>
      ) : <p className="border-t border-border px-4 py-3 text-[13px] text-ink-muted">{empty}</p>}
      {list.length > exceptions.length && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-border px-4 py-2 text-start text-xs font-medium text-ink-muted hover:text-ink">
          {all ? t('dashboard.live.teachers.showExceptions') : t('dashboard.live.teachers.showAll', { count: list.length })}
        </button>
      )}
    </Block>
  )
}
