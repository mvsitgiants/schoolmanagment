import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import SectionDrawer from './SectionDrawer'
import { Block, Chip, sectionName, shortName, situationOf, toMin, usePlain } from './liveKit'

// The timetable, two ways. "Right now": one plain sentence per class at the time being looked at — what lesson,
// with whom, in which room, and whether attendance is taken — classes with a problem first, classes with no lesson
// folded into one line. "Whole day": the full matrix, a row per class and a column per period, with full subject
// and teacher names. Colour only for what needs action: red no teacher / attendance late, amber substitute.

const needsAttention = (s) => s.uncovered > 0 || s.attendance?.overdue || s.current?.uncovered

function attendanceWords(a, t, clock, markBefore, planned) {
  if (!a || planned) return null
  if (a.marked) return { text: t('dashboard.live.timetable.present', { n: a.present, total: a.total }) }
  return a.overdue ? { text: t('dashboard.live.timetable.notTakenLate', { time: clock(markBefore) }), tone: 'text-rose-600' } : { text: t('dashboard.live.timetable.notTaken') }
}

/** One class, one sentence, at the time looked at. */
function NowLine({ s, data, onOpen, planned }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  const c = s.current
  const name = sectionName(s.className, s.short)
  const room = s.room ? t('dashboard.live.timetable.room', { room: c?.room || s.room }) : null
  let what
  let tone
  if (s.phase === 'PERIOD' && c?.subject) {
    if (c.uncovered) { what = t('dashboard.live.timetable.nowUncovered', { subject: c.subject, teacher: c.teacher?.name ?? '' }); tone = 'text-rose-600' }
    else if (c.substitute) { what = t('dashboard.live.timetable.nowSub', { subject: c.subject, teacher: c.substitute.name, regular: c.teacher?.name ?? '' }); tone = 'text-amber-600' }
    else if (c.teacher) {
      const st = c.teacher.state
      what = t('dashboard.live.timetable.nowWith', { subject: c.subject, teacher: c.teacher.name })
      if (!planned && st === 'NOT_IN_YET') { what += ` ${t('dashboard.live.timetable.teacherNotIn')}`; tone = 'text-amber-600' }
    } else what = t('dashboard.live.timetable.nowNoTeacherSet', { subject: c.subject })
  } else if (s.phase === 'PERIOD') what = t('dashboard.live.timetable.noLesson')
  else if (s.phase === 'BREAK') what = (s.slot?.label || t('dashboard.live.break'))
  else if (s.phase === 'BEFORE') what = s.next ? t('dashboard.live.timetable.firstLesson', { subject: s.next.subject, time: clock(s.next.start) }) : t('dashboard.live.timetable.notStarted')
  else what = t('dashboard.live.timetable.over')
  const att = attendanceWords(s.attendance, t, clock, data.markBefore, planned)
  // lessons later in the day that have no teacher (the current one is already said above)
  const later = s.day.filter((r) => r.uncovered && r.state !== 'DONE' && r.state !== 'NOW')
  return (
    <li>
      <button type="button" onClick={() => onOpen(s.id)} className="flex w-full min-w-0 flex-wrap items-baseline gap-x-1.5 px-4 py-2 text-start text-[13px] hover:bg-bg">
        <span className="font-medium text-ink">{name}</span>
        <span className="text-ink-faint">—</span>
        <span className={tone ?? 'text-ink'}>{what}</span>
        {room && s.phase === 'PERIOD' && c?.subject && <span className="text-ink-muted">· {room}</span>}
        {att && <span className={att.tone ?? 'text-ink-muted'}>· {att.text}</span>}
        {later.length > 0 && (
          <span className="text-rose-600">· {t('dashboard.live.timetable.laterUncovered', { count: later.length, list: later.map((r) => t('dashboard.live.timetable.periodAt', { no: r.period, time: clock(r.start), subject: r.subject })).join(', ') })}</span>
        )}
      </button>
    </li>
  )
}

function RightNow({ groups, data, onOpen, planned }) {
  const { t } = useTranslation('dashboard')
  const problems = groups.flatMap((g) => g.rows.filter(needsAttention))
  return (
    <div className="divide-y divide-border">
      {problems.length > 0 && (
        <div>
          <p className="bg-rose-50/60 px-4 py-1.5 text-[11.5px] font-semibold text-rose-700">{t('dashboard.live.timetable.problemsFirst', { count: problems.length })}</p>
          <ul>{problems.map((s) => <NowLine key={s.id} s={s} data={data} onOpen={onOpen} planned={planned} />)}</ul>
        </div>
      )}
      {groups.map((g) => {
        const rest = g.rows.filter((s) => !needsAttention(s))
        const busy = rest.filter((s) => !(s.phase === 'PERIOD' && !s.current?.subject))
        const idle = rest.filter((s) => s.phase === 'PERIOD' && !s.current?.subject)
        if (!rest.length) return null
        return (
          <div key={g.id}>
            <p className="bg-bg px-4 py-1 text-[11.5px] font-semibold text-ink-muted">{g.name}</p>
            <ul>
              {busy.map((s) => <NowLine key={s.id} s={s} data={data} onOpen={onOpen} planned={planned} />)}
              {idle.length > 0 && (
                <li className="px-4 py-2 text-[13px] text-ink-faint">
                  {t('dashboard.live.timetable.idleLine', { list: idle.map((s) => sectionName(s.className, s.short)).join(', '), count: idle.length })}
                </li>
              )}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function Matrix({ groups, data, onOpen, planned }) {
  const { t } = useTranslation('dashboard')
  const { clock } = usePlain()
  const { frame, now } = data
  const columns = frame.map((sl) => ({ ...sl, isPeriod: sl.kind === 'PERIOD' && sl.no > 0 }))
  const currentNo = now.phase === 'PERIOD' ? now.slot?.no : null
  const isPast = (sl) => now.schoolDay && toMin(sl.end) <= toMin(now.time)
  return (
    <>
      <p className="border-b border-border px-4 py-2 text-[11.5px] text-ink-faint">{t('dashboard.live.timetable.legend')}</p>
      <div className="max-h-[68vh] overflow-auto [scrollbar-width:thin]">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky start-0 top-0 z-30 min-w-[128px] border-b border-border bg-surface px-3 py-2 text-start font-medium text-ink-muted">{t('dashboard.live.timetable.class')}</th>
              <th className="sticky top-0 z-20 min-w-[104px] border-b border-border bg-surface px-2 py-2 text-start font-medium text-ink-muted">{t('dashboard.live.timetable.attendance')}</th>
              {columns.map((sl, i) => sl.isPeriod ? (
                <th key={`${sl.start}${i}`} className={clsx('sticky top-0 z-20 min-w-[118px] border-b px-2 py-1.5 text-start font-medium',
                  sl.no === currentNo ? 'border-t-2 border-b-border border-t-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface', sl.no !== currentNo && (isPast(sl) ? 'text-ink-faint' : 'text-ink-muted'))}>
                  <span className="block">{t('dashboard.live.timetable.period', { no: sl.no })}</span>
                  <span className={clsx('block whitespace-nowrap text-[10.5px] font-normal', sl.no === currentNo ? 'text-brand-600' : 'text-ink-faint')}>{clock(sl.start)}–{clock(sl.end)}</span>
                </th>
              ) : <th key={`${sl.start}${i}`} title={sl.label ?? ''} className="sticky top-0 z-20 w-1.5 min-w-[6px] border-b border-border bg-bg p-0" />)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={`h${g.id}`}>
                <td colSpan={columns.length + 2} className="border-b border-border bg-bg p-0">
                  <span className="sticky start-0 inline-block px-3 py-1 text-[11px] font-semibold text-ink-muted">{g.name}</span>
                </td>
              </tr>,
              ...g.rows.map((s) => {
                const att = attendanceWords(s.attendance, t, clock, data.markBefore, planned)
                return (
                  <tr key={s.id} onClick={() => onOpen(s.id)} className="group cursor-pointer">
                    <td className="sticky start-0 z-10 border-b border-border bg-surface px-3 py-1.5 group-hover:bg-bg">
                      <span className="block whitespace-nowrap font-medium text-ink">{t('dashboard.live.timetable.section', { name: String(s.short).split('-').pop() })}</span>
                      {s.room && <span className="block whitespace-nowrap text-[10.5px] text-ink-faint">{t('dashboard.live.timetable.room', { room: s.room })}</span>}
                    </td>
                    <td className={clsx('border-b border-border bg-surface px-2 py-1.5 group-hover:bg-bg', att?.tone ?? 'text-ink-muted')}>{att ? att.text : <span className="text-ink-faint">–</span>}</td>
                    {columns.map((sl, i) => {
                      if (!sl.isPeriod) return <td key={`${sl.start}${i}`} className="border-b border-border bg-bg p-0" />
                      const r = s.day.find((x) => x.period === sl.no)
                      const current = sl.no === currentNo
                      const past = isPast(sl) && !current
                      return (
                        <td key={`${sl.start}${i}`} className={clsx('max-w-[150px] border-b border-border px-2 py-1.5',
                          r?.uncovered && !past ? 'bg-rose-50' : current ? 'bg-brand-50/50' : 'bg-surface group-hover:bg-bg')}>
                          {!r?.subject ? <span className="text-ink-faint/70">–</span> : (
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className={clsx('truncate', past ? 'text-ink-faint' : 'text-ink', current && 'font-semibold')}>{r.subject}</span>
                              {r.uncovered ? <span className={clsx('truncate text-[11px]', past ? 'text-ink-faint' : 'font-medium text-rose-600')}>{t('dashboard.live.timetable.noTeacher')}</span>
                                : r.substitute ? <span className="truncate text-[11px] text-amber-600">{t('dashboard.live.timetable.subShort', { name: shortName(r.substitute.name) })}</span>
                                  : r.teacher ? <span className="truncate text-[11px] text-ink-faint">{shortName(r.teacher.name)}</span> : null}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              }),
            ])}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function TimetableMatrix({ data }) {
  const { t } = useTranslation('dashboard')
  const { clock, longDate } = usePlain()
  const [view, setView] = useState('NOW')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [cls, setCls] = useState('')
  const [open, setOpen] = useState(null)
  const { sections, now } = data
  const sit = situationOf(now)
  const planned = sit === 'FUTURE' && !now.isToday
  const classes = useMemo(() => {
    const m = new Map()
    for (const s of sections) { if (!m.has(s.classId)) m.set(s.classId, { id: s.classId, name: s.className, order: s.order, sections: [] }); m.get(s.classId).sections.push(s) }
    return [...m.values()].sort((a, b) => a.order - b.order)
  }, [sections])
  const problems = sections.filter(needsAttention).length
  const groups = classes
    .filter((c) => !cls || c.id === cls)
    .map((c) => ({ ...c, rows: c.sections.filter((s) => !onlyProblems || needsAttention(s)) }))
    .filter((c) => c.rows.length)
  const live = open ? sections.find((s) => s.id === open) : null
  const title = now.isToday ? t('dashboard.live.timetable.titleToday') : t('dashboard.live.timetable.titleDay', { date: longDate(now.date) })
  const sub = view === 'NOW'
    ? (sit === 'LIVE' ? t('dashboard.live.timetable.subNow') : t('dashboard.live.timetable.subAt', { time: clock(now.time) }))
    : t('dashboard.live.timetable.subDay')

  return (
    <Block title={title} sub={sub}
      actions={(
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="me-1 inline-flex overflow-hidden rounded-full border border-border">
            {['NOW', 'DAY'].map((k) => (
              <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                className={clsx('h-7 px-3 text-xs font-medium [@media(pointer:coarse)]:h-9', view === k ? 'bg-brand-500 text-white' : 'bg-surface text-ink-muted hover:text-ink')}>
                {t(`dashboard.live.timetable.view.${k}`)}
              </button>
            ))}
          </div>
          <Chip active={onlyProblems} onClick={() => setOnlyProblems((v) => !v)}>{t('dashboard.live.timetable.onlyProblems', { count: problems })}</Chip>
          {classes.length > 1 && (
            <label className={clsx('relative inline-flex h-7 items-center gap-1 rounded-full border bg-surface ps-3 pe-2 text-xs font-medium [@media(pointer:coarse)]:h-9', cls ? 'border-brand-500 text-brand-700' : 'border-border text-ink-muted')}>
              {cls ? classes.find((c) => c.id === cls)?.name : t('dashboard.live.timetable.allClasses')}
              <ChevronDown className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
              <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label={t('dashboard.live.timetable.class')} className="absolute inset-0 cursor-pointer opacity-0">
                <option value="">{t('dashboard.live.timetable.allClasses')}</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}>
      {!groups.length ? <p className="px-4 py-6 text-sm text-ink-muted">{onlyProblems ? t('dashboard.live.timetable.noProblems') : t('dashboard.live.timetable.empty')}</p>
        : view === 'NOW' ? <RightNow groups={groups} data={data} onOpen={setOpen} planned={planned} />
          : <Matrix groups={groups} data={data} onOpen={setOpen} planned={planned} />}
      <p className="border-t border-border px-4 py-2 text-[11.5px] text-ink-faint">{t('dashboard.live.timetable.clickHint')}</p>
      <SectionDrawer section={live} data={data} onClose={() => setOpen(null)} />
    </Block>
  )
}
