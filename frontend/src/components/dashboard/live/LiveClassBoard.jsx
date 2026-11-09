import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, CalendarClock, Coffee, DoorOpen, LayoutGrid, Moon, School, Sunrise, UserX } from 'lucide-react'
import { ColorChip, EmptyState, SegmentedControl, SideNav, SideNavLayout, TONE, hueTone } from '../../system'
import { ClassroomGlyph, presentTone } from '../../academics/ClassBoard'
import SectionDrawer from './SectionDrawer'
import { PresenceAvatar, PresenceDot } from './liveKit'

// The class board: one card per section, like the hospital's bed board — what is on in the room now, who is
// teaching it (and whether they came in), the substitute or "no teacher", how far the period has run, today's
// attendance and the next period. The classes run down a side list with their own warning counts.

const needsAttention = (s) => s.uncovered > 0 || s.attendance?.overdue || s.current?.uncovered

/** A strip of today's periods: done ones faded, the current one ringed, an uncovered one red. */
function DayStrip({ day }) {
  const { t } = useTranslation('dashboard')
  if (!day.length) return null
  return (
    <div className="flex gap-0.5" aria-hidden>
      {day.map((r) => {
        const tone = r.subject ? TONE[hueTone(r.subject)] : null
        return (
          <span key={r.period} title={r.subject ? t('dashboard.live.board.stripCell', { no: r.period, subject: r.subject }) : t('dashboard.live.board.stripFree', { no: r.period })}
            className={clsx('flex-1 rounded-[3px]', r.state === 'NOW' ? 'h-3 -my-[2px] ring-[1.5px] ring-ink/60' : 'h-2',
              r.uncovered ? 'bg-rose-500' : tone ? tone.fill : r.state === 'NOW' ? 'bg-ink/25' : 'bg-black/[0.06]', r.state === 'DONE' && 'opacity-35')} />
        )
      })}
    </div>
  )
}

/** The middle of a card: what the section is doing at the time looked at. */
function NowBlock({ s, now }) {
  const { t } = useTranslation('dashboard')
  const c = s.current
  if (s.phase === 'PERIOD' && c?.subject) {
    const teacher = c.substitute ?? c.teacher
    return (
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <ColorChip label={c.subject} seed={c.subject} />
          <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">{t('dashboard.live.board.periodAt', { no: c.period, start: c.start, end: c.end })}</span>
        </div>
        {c.uncovered ? (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-700"><UserX className="h-3.5 w-3.5" aria-hidden />{t('dashboard.live.board.uncovered')}</p>
        ) : teacher ? (
          <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink">
            <PresenceAvatar name={teacher.name} state={teacher.state} size={20} />
            <span className="truncate font-medium">{teacher.name}</span>
          </p>
        ) : <p className="text-[12px] text-ink-faint">{t('dashboard.live.board.noTeacherSet')}</p>}
        {c.substitute && (
          <p className="truncate text-[11px] font-medium text-amber-700">{t('dashboard.live.board.substituteFor', { name: c.teacher?.name ?? '' })}</p>
        )}
        {c.uncovered && c.teacher && <p className="truncate text-[11px] text-ink-faint">{t('dashboard.live.board.awayTeacher', { name: c.teacher.name })}</p>}
      </div>
    )
  }
  const icon = { BREAK: Coffee, BEFORE: Sunrise, AFTER: Moon, CLOSED: Moon, PERIOD: School }[s.phase] ?? School
  const Icon = icon
  const line = s.phase === 'PERIOD' ? t('dashboard.live.board.freePeriod', { no: s.slot?.no })
    : s.phase === 'BREAK' ? (s.slot?.label || t('dashboard.live.board.break'))
      : t(`dashboard.live.board.phase.${s.phase}`)
  return (
    <div className="flex min-w-0 items-center gap-2 text-ink-muted">
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-semibold">{line}</p>
        {s.phase === 'BREAK' && s.slot && <p className="text-[11px] text-ink-faint tabular-nums">{s.slot.start}–{s.slot.end}</p>}
        {s.phase === 'PERIOD' && <p className="hidden text-[11px] text-ink-faint sm:block">{t('dashboard.live.board.freeHint')}</p>}
        {now.phase === 'CLOSED' && now.holiday && <p className="truncate text-[11px] text-ink-faint">{now.holiday}</p>}
      </div>
    </div>
  )
}

function AttendanceLine({ a, strength, closed }) {
  const { t } = useTranslation('dashboard')
  if (!a || (closed && !a.marked)) return null
  if (!a.marked) {
    return (
      <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold', a.overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
        {a.overdue && <AlertTriangle className="h-3 w-3" aria-hidden />}{t('dashboard.live.board.notMarked')}
      </span>
    )
  }
  const total = a.total || strength || 0
  const pct = total ? Math.round(((a.present ?? 0) / total) * 100) : 0
  const tone = TONE[presentTone(a.pct)]
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" title={t('dashboard.live.board.attendanceTitle', { present: a.present, total, absent: a.absent ?? 0 })}>
      <span className="h-1.5 min-w-[40px] flex-1 overflow-hidden rounded-full bg-black/[0.06]"><span className={clsx('block h-full rounded-full', tone.fill)} style={{ width: `${pct}%` }} /></span>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink">{a.present}/{total}</span>
      {a.absent > 0 && <span className="shrink-0 text-[10.5px] font-medium text-rose-600 tabular-nums">{t('dashboard.live.board.absentShort', { count: a.absent })}</span>}
    </span>
  )
}

function SectionCard({ s, now, onOpen }) {
  const { t } = useTranslation('dashboard')
  const c = s.current
  const alert = c?.uncovered || s.uncovered > 0
  const tile = alert ? 'border-rose-200 bg-rose-50/40' : s.attendance?.overdue ? 'border-amber-200 bg-amber-50/30' : s.phase === 'PERIOD' && c?.subject ? 'border-brand-200 bg-surface' : 'border-border bg-surface'
  return (
    <button type="button" onClick={() => onOpen(s)}
      className={clsx('flex min-h-[132px] min-w-0 flex-col gap-2 rounded-xl border p-2.5 text-start sm:min-h-[150px] sm:p-3 shadow-card transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400', tile)}>
      <div className="flex min-w-0 items-center gap-2">
        <ClassroomGlyph tone={hueTone(s.classId)} size={24} filled={s.phase === 'PERIOD' && !!c?.subject} />
        <span className="font-display text-sm font-bold text-ink">{s.short}</span>
        {s.room && <span className="hidden items-center gap-0.5 text-[10.5px] text-ink-faint min-[460px]:inline-flex"><DoorOpen className="h-3 w-3" aria-hidden />{s.room}</span>}
        {s.uncovered > 0 && <span className="ms-auto shrink-0 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white tabular-nums" title={t('dashboard.live.board.uncoveredLeft', { count: s.uncovered })}>{s.uncovered}</span>}
      </div>
      <NowBlock s={s} now={now} />
      <div className="mt-auto space-y-2">
        {s.elapsed != null && (s.phase === 'PERIOD' || s.phase === 'BREAK') && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-black/[0.06]" title={t('dashboard.live.board.elapsed', { pct: s.elapsed })}>
            <div className={clsx('h-full rounded-full', s.phase === 'BREAK' ? 'bg-ink-faint' : 'bg-brand-500')} style={{ width: `${s.elapsed}%` }} />
          </div>
        )}
        <DayStrip day={s.day} />
        <div className="flex min-w-0 items-center gap-2">
          <AttendanceLine a={s.attendance} strength={s.strength} closed={!now.schoolDay} />
        </div>
        {s.next && (
          <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-ink-muted">
            <CalendarClock className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
            <span className="truncate">{t('dashboard.live.board.next', { no: s.next.period, time: s.next.start, subject: s.next.subject })}</span>
            {(s.next.substitute ?? s.next.teacher) && <PresenceDot state={(s.next.substitute ?? s.next.teacher).state} size={6} />}
            {s.next.uncovered && <span className="shrink-0 font-semibold text-rose-600">{t('dashboard.live.board.nextUncovered')}</span>}
          </p>
        )}
      </div>
    </button>
  )
}

export default function LiveClassBoard({ data }) {
  const { t } = useTranslation('dashboard')
  const [cls, setCls] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [open, setOpen] = useState(null)
  const sections = data.sections
  const classes = useMemo(() => {
    const m = new Map()
    for (const s of sections) { if (!m.has(s.classId)) m.set(s.classId, { id: s.classId, name: s.className, order: s.order, sections: [] }); m.get(s.classId).sections.push(s) }
    return [...m.values()].sort((a, b) => a.order - b.order)
  }, [sections])
  const counts = {
    ALL: sections.length,
    ATTENTION: sections.filter(needsAttention).length,
    TEACHING: sections.filter((s) => s.phase === 'PERIOD' && s.current?.subject).length,
    FREE: sections.filter((s) => s.phase === 'PERIOD' && !s.current?.subject).length,
  }
  const pick = (s) => (filter === 'ATTENTION' ? needsAttention(s) : filter === 'TEACHING' ? s.phase === 'PERIOD' && s.current?.subject : filter === 'FREE' ? s.phase === 'PERIOD' && !s.current?.subject : true)
  const shown = classes.filter((c) => !cls || c.id === cls).map((c) => ({ ...c, list: c.sections.filter(pick) })).filter((c) => c.list.length)
  const live = open ? sections.find((s) => s.id === open.id) ?? open : null

  if (!sections.length) return <EmptyState icon={LayoutGrid} title={t('dashboard.live.board.empty')} hint={t('dashboard.live.board.emptyHint')} />

  return (
    <>
      <SideNavLayout nav={classes.length > 1 && (
        <SideNav title={t('dashboard.live.board.classes')} value={cls} onChange={setCls} items={[
          { id: '', label: t('dashboard.live.board.allClasses'), icon: LayoutGrid, count: sections.length },
          ...classes.map((c) => {
            const unc = c.sections.reduce((n, s) => n + s.uncovered, 0)
            const late = c.sections.filter((s) => s.attendance?.overdue).length
            const marked = c.sections.filter((s) => s.attendance?.marked).length
            return {
              id: c.id, label: c.name,
              hint: unc ? t('dashboard.live.board.navUncovered', { count: unc }) : late ? t('dashboard.live.board.navUnmarked', { count: late }) : t('dashboard.live.board.navSections', { count: c.sections.length }),
              count: unc || late || c.sections.length, countTone: unc ? 'danger' : late ? 'warning' : undefined,
              progress: c.sections[0]?.attendance ? { value: marked, max: c.sections.length, kind: 'done' } : undefined,
            }
          }),
        ]} />
      )}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SegmentedControl value={filter} onChange={setFilter} options={['ALL', 'ATTENTION', 'TEACHING', 'FREE'].map((k) => ({ value: k, label: t(`dashboard.live.board.filter.${k}`), count: counts[k] }))} />
          <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            {['PRESENT', 'NOT_IN_YET', 'ABSENT'].map((k) => <span key={k} className="inline-flex items-center gap-1"><PresenceDot state={k} size={7} />{t(`dashboard.live.board.legend.${k}`)}</span>)}
          </div>
        </div>
        {!shown.length && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-ink-faint">{t('dashboard.live.board.noneMatch')}</p>}
        {shown.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {shown.flatMap((c) => c.list).map((s) => <SectionCard key={s.id} s={s} now={data.now} onOpen={setOpen} />)}
          </div>
        )}
      </SideNavLayout>
      <SectionDrawer section={live} data={data} onClose={() => setOpen(null)} />
    </>
  )
}
