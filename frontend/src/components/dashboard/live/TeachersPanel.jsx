import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronRight, Search, UsersRound } from 'lucide-react'
import { ColorChip, Panel, SegmentedControl, TONE } from '../../system'
import { hasPermission } from '../../../api/auth'
import { PRESENCE_ORDER, PRESENCE_TONE, PresenceAvatar, PresenceDot, isAway } from './liveKit'

// The teachers, by presence: away (absent, on leave) first with the periods nobody covers yet and a way to the
// substitution desk, then not in yet, late, in. Each says what they are teaching now — or that they are free.

const GROUPS = {
  ALL: () => true,
  AWAY: (x) => isAway(x.state),
  NOT_IN: (x) => x.state === 'NOT_IN_YET',
  LATE: (x) => x.state === 'LATE',
  IN: (x) => x.state === 'PRESENT' || x.state === 'LATE',
  FREE: (x) => x.free,
}

function TeacherRow({ x }) {
  const { t } = useTranslation('dashboard')
  const tone = TONE[PRESENCE_TONE[x.state] ?? 'neutral']
  return (
    <li className={clsx('flex min-w-0 flex-col gap-1.5 px-3 py-2.5', isAway(x.state) && x.uncovered.some((u) => !u.done) && 'bg-rose-50/50')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <PresenceAvatar name={x.name} state={x.state} size={30} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium text-ink">{x.name}</p>
          <p className="truncate text-[11px] text-ink-faint">
            {[x.designation, x.classTeacherOf && t('dashboard.live.teachers.classTeacherOf', { section: x.classTeacherOf })].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-end">
          <span className={clsx('text-[11px] font-semibold', tone.text)}>
            {x.state === 'ON_LEAVE' && x.leave?.half ? t(`dashboard.live.teachers.halfLeave.${x.leave.half}`) : t(`dashboard.live.presence.${x.state}`)}
            {x.inTime && (x.state === 'PRESENT' || x.state === 'LATE') ? <span className="ms-1 font-normal text-ink-faint tabular-nums">{x.inTime}</span> : null}
          </span>
          {x.now ? (
            <span className="flex items-center gap-1 text-[11px] text-ink-muted">
              <ColorChip label={x.now.section} seed={x.now.classId} className="[&>span]:px-1.5 [&>span]:py-0 [&>span]:text-[10.5px]" />
              <span className="max-w-[110px] truncate">{x.now.subject}</span>
            </span>
          ) : x.free ? (
            <span className="rounded-full bg-emerald-50 px-1.5 text-[10.5px] font-semibold text-emerald-700">{t('dashboard.live.teachers.freeNow')}</span>
          ) : x.periodsToday ? (
            <span className="text-[10.5px] text-ink-faint tabular-nums">{t('dashboard.live.teachers.periodsLeft', { left: x.periodsLeft, total: x.periodsToday })}</span>
          ) : null}
        </div>
      </div>
      {isAway(x.state) && x.uncovered.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 ps-10">
          {x.uncovered.map((u) => (
            <span key={`${u.sectionId}${u.period}`} title={u.suggestion ? t('dashboard.live.teachers.suggest', { name: u.suggestion.name }) : undefined}
              className={clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums', u.done ? 'border-border bg-bg text-ink-faint line-through' : 'border-rose-200 bg-rose-50 text-rose-700')}>
              {t('dashboard.live.teachers.uncoveredChip', { no: u.period, section: u.section })}
            </span>
          ))}
          {hasPermission('timetable.substitutions.view') && x.uncovered.some((u) => !u.done) && (
            <Link to="/timetable/substitutions" className="ms-auto inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 hover:underline">
              {t('dashboard.live.teachers.findSubstitute')}<ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </li>
  )
}

export default function TeachersPanel({ teachers }) {
  const { t } = useTranslation('dashboard')
  const [group, setGroup] = useState('ALL')
  const [q, setQ] = useState('')
  const list = useMemo(() => [...teachers.list].sort((a, b) => PRESENCE_ORDER.indexOf(a.state) - PRESENCE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name)), [teachers.list])
  const shown = list.filter(GROUPS[group]).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()))
  const c = teachers.counts
  const bar = PRESENCE_ORDER.filter((k) => c[k]).map((k) => ({ k, n: c[k] }))
  return (
    <Panel title={t('dashboard.live.teachers.title')} subtitle={t('dashboard.live.teachers.subtitle', { in: c.PRESENT + c.LATE, total: c.total - c.OFF })} icon={UsersRound} iconTone="info"
      actions={hasPermission('hrms.attendance.view') && <Link to="/hrms/attendance" className="flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline">{t('dashboard.live.open')}<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden /></Link>}
      flush>
      <div className="space-y-3 p-4">
        {/* the staff room in one bar: in · late · not in · away */}
        <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.05]" role="img" aria-label={bar.map((b) => `${t(`dashboard.live.presence.${b.k}`)}: ${b.n}`).join(', ')}>
          {bar.map((b) => <span key={b.k} className={clsx('h-full', TONE[PRESENCE_TONE[b.k]].fill, b.k === 'NOT_IN_YET' && 'opacity-60')} style={{ width: `${(b.n / Math.max(1, c.total)) * 100}%` }} />)}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          {bar.map((b) => <span key={b.k} className="inline-flex items-center gap-1"><PresenceDot state={b.k} size={7} />{t(`dashboard.live.presence.${b.k}`)}<b className="font-semibold text-ink tabular-nums">{b.n}</b></span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={group} onChange={setGroup} options={Object.keys(GROUPS).map((k) => ({ value: k, label: t(`dashboard.live.teachers.groups.${k}`), count: k === 'ALL' ? undefined : list.filter(GROUPS[k]).length }))} />
          {list.length > 12 && (
            <label className="relative ms-auto min-w-[140px] flex-1 sm:max-w-[200px]">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dashboard.live.teachers.search')} className="h-8 w-full rounded-lg border border-border bg-surface ps-7 pe-2 text-xs" />
            </label>
          )}
        </div>
      </div>
      {shown.length ? (
        <ul className="max-h-[520px] divide-y divide-border overflow-y-auto border-t border-border [scrollbar-width:thin]">
          {shown.map((x) => <TeacherRow key={x.id} x={x} />)}
        </ul>
      ) : <p className="border-t border-border px-4 py-8 text-center text-sm text-ink-faint">{t('dashboard.live.teachers.none')}</p>}
    </Panel>
  )
}
