import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarClock, Clock, DoorOpen, FlaskConical, Library, Monitor, Pencil, School, Shapes, Sparkles, Theater, Trophy, Users } from 'lucide-react'
import { ROOM_KINDS } from '@schoolgiant/shared'
import { Avatar, ColorChip, ControlChip, Drawer, EmptyState, Note, SideNav, SideNavLayout, Skeleton, StatCardRow, TONE, hueTone } from '../system'
import Button from '../ui/Button'
import WeekGrid from './WeekGrid'
import { fetchRoomBoard, fetchTimetableGrid } from '../../api/timetable'

export const KIND_ICON = { CLASSROOM: School, LAB: FlaskConical, COMPUTER: Monitor, HALL: Theater, LIBRARY: Library, GROUND: Trophy, OTHER: Shapes }
const KIND_ORDER = ['CLASSROOM', 'LAB', 'COMPUTER', 'LIBRARY', 'HALL', 'GROUND', 'OTHER']

// a room's state → its tile tint and glyph colour
const STATE = {
  IN_USE: { tile: 'bg-brand-50/60 border-brand-200', ink: 'rgb(var(--brand-500))', soft: 'rgb(var(--brand-100))', text: 'text-brand-700' },
  FREE: { tile: 'bg-surface border-success-200', ink: '#1F9D66', soft: '#E8F6EE', text: 'text-success-700' },
  CLOSED: { tile: 'bg-bg border-border', ink: '#94A3B8', soft: '#EEF0F3', text: 'text-ink-muted' },
  INACTIVE: { tile: 'bg-bg border-border opacity-60', ink: '#B8BEC9', soft: '#F1F2F4', text: 'text-ink-faint' },
}

/**
 * A room from above: four walls with a door gap, the teacher's desk at the front and rows of desks — filled when a
 * class is in, empty when the room is free, grey when closed.
 */
export function RoomGlyph({ status = 'FREE', size = 44, className }) {
  const s = STATE[status] ?? STATE.FREE
  const full = status === 'IN_USE'
  const desks = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) desks.push({ x: 11 + c * 8.5, y: 17 + r * 7 })
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className={clsx('shrink-0', className)} aria-hidden>
      <rect x="2" y="2" width="40" height="40" rx="7" fill={s.soft} />
      {/* walls, with the door gap on the right */}
      <path d="M30 41.5H8.5A6.5 6.5 0 0 1 2 35V9a6.5 6.5 0 0 1 6.5-6.5h27A6.5 6.5 0 0 1 42 9v17" fill="none" stroke={s.ink} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M42 34v1a6.5 6.5 0 0 1-6.5 6.5H38" fill="none" stroke={s.ink} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M42 26 35.5 31" stroke={s.ink} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      {/* the board and the teacher's desk */}
      <rect x="12" y="6.5" width="20" height="2.4" rx="1.2" fill={s.ink} opacity="0.85" />
      <rect x="17" y="11" width="10" height="3" rx="1" fill={s.ink} opacity={full ? 0.9 : 0.45} />
      {desks.map((d, i) => (
        <rect key={i} x={d.x} y={d.y} width="6" height="4.2" rx="1.2"
          fill={full ? s.ink : 'none'} stroke={s.ink} strokeWidth={full ? 0 : 1.1} opacity={full ? 0.55 + (i % 3) * 0.12 : 0.55} />
      ))}
    </svg>
  )
}

/** Today's periods in this room as a strip of cells: booked ones filled, the current one ringed. */
function TodayStrip({ frame, today, now, schoolDay }) {
  const { t } = useTranslation('timetable')
  const periods = frame.filter((s) => s.kind === 'PERIOD' && s.no > 0)
  const byNo = new Map(today.map((x) => [x.period, x]))
  return (
    <div className="flex gap-0.5" aria-hidden>
      {periods.map((p) => {
        const e = byNo.get(p.no)
        const current = schoolDay && p.start <= now && now < p.end
        const past = schoolDay && p.end <= now
        const tone = e ? TONE[hueTone(e.classId ?? e.section)] : null
        return (
          <span key={p.no} title={e ? t('timetable.board.cellTitle', { no: p.no, section: e.section, subject: e.subject }) : t('timetable.board.cellFree', { no: p.no })}
            className={clsx('flex-1 rounded-[3px]', current ? 'h-3.5 -my-0.5 outline outline-[1.5px] outline-offset-1 outline-ink/70' : 'h-2.5', e ? tone.fill : 'bg-black/[0.06]', past && !current && 'opacity-40')} />
        )
      })}
    </div>
  )
}

function RoomTile({ room, frame, now, onOpen, selected }) {
  const { t } = useTranslation('timetable')
  const s = STATE[room.status] ?? STATE.FREE
  const Icon = KIND_ICON[room.kind] ?? DoorOpen
  const cur = room.current
  return (
    <button type="button" onClick={() => onOpen(room)}
      className={clsx('flex min-h-[148px] flex-col gap-2.5 rounded-xl border p-3 text-start transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400', s.tile, selected && 'ring-2 ring-brand-500')}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-xs font-bold text-ink font-mono-num">{room.code || room.name}</span>
        {room.code && <span className="truncate text-[10.5px] text-ink-faint">{room.name}</span>}
        <span className="ms-auto inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
          <Icon className="h-3.5 w-3.5" aria-hidden />{room.capacity ? t('timetable.board.seats', { count: room.capacity }) : null}
        </span>
      </div>
      <div className="flex min-w-0 items-start gap-2.5">
        <RoomGlyph status={room.status} size={42} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          {cur ? (
            <>
              <ColorChip label={cur.section} seed={cur.classId ?? cur.section} />
              <p className="mt-1 truncate text-[12.5px] font-semibold text-ink">{cur.subject || t('timetable.board.noSubject')}</p>
              {cur.teacher && <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-muted"><Avatar name={cur.teacher} size={14} soft />{cur.teacher}</p>}
            </>
          ) : (
            <>
              <p className={clsx('text-xs font-semibold', s.text)}>{t(`timetable.board.status.${room.status}`)}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint line-clamp-2">
                {room.status === 'FREE'
                  ? (room.next ? t('timetable.board.nextAt', { time: room.next.start, section: room.next.section }) : t('timetable.board.freeRestOfDay'))
                  : room.section ? t('timetable.board.homeOf', { section: room.section }) : ''}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="mt-auto space-y-1.5">
        <TodayStrip frame={frame} today={room.today} now={now.time} schoolDay={now.schoolDay} />
        <div className="flex items-center justify-between text-[10.5px] text-ink-faint">
          <span>{room.section && cur ? t('timetable.board.homeOf', { section: room.section }) : t('timetable.board.todayCount', { count: room.today.length })}</span>
          <span className="tabular-nums">{t('timetable.board.weekUse', { pct: room.weekUse })}</span>
        </div>
      </div>
    </button>
  )
}

function RoomDrawer({ room, timetableId, onClose, onEdit }) {
  const { t } = useTranslation('timetable')
  const navigate = useNavigate()
  const grid = useQuery({ queryKey: ['timetable-grid', timetableId, 'room', room?.id], queryFn: () => fetchTimetableGrid(timetableId, 'room', room.id), enabled: !!room && !!timetableId })
  if (!room) return null
  const Icon = KIND_ICON[room.kind] ?? DoorOpen
  const kind = t(`timetable.roomKinds.${room.kind}`, ROOM_KINDS.find((k) => k.value === room.kind)?.label ?? room.kind)
  return (
    <Drawer open onClose={onClose} size="xl" title={room.code ? `${room.code} · ${room.name}` : room.name} subtitle={[kind, room.capacity && t('timetable.board.seats', { count: room.capacity }), room.section && t('timetable.board.homeOf', { section: room.section })].filter(Boolean).join(' · ')}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <RoomGlyph status={room.status} size={56} />
          <div className="min-w-0">
            <p className={clsx('text-sm font-semibold', STATE[room.status]?.text)}>{room.current ? t('timetable.board.nowIn', { section: room.current.section, subject: room.current.subject }) : t(`timetable.board.status.${room.status}`)}</p>
            <p className="text-xs text-ink-faint">{t('timetable.board.weekLine', { count: room.weekPeriods, pct: room.weekUse })}</p>
          </div>
          <Icon className="ms-auto h-5 w-5 text-ink-faint" aria-hidden />
        </div>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('timetable.board.today')}</h3>
          {room.today.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {room.today.map((x) => (
                <li key={x.period} className={clsx('flex items-center gap-3 px-3 py-2 text-sm', room.current?.period === x.period && 'bg-brand-50/60')}>
                  <span className="w-16 shrink-0 text-xs text-ink-muted tabular-nums">{t('timetable.board.periodShort', { no: x.period })}<span className="block text-[10.5px] text-ink-faint">{x.start}–{x.end}</span></span>
                  <ColorChip label={x.section} seed={x.classId ?? x.section} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{x.subject}</span>
                  {x.teacher && <span className="flex items-center gap-1.5 truncate text-xs text-ink-muted"><Avatar name={x.teacher} size={18} soft />{x.teacher}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-faint">{t('timetable.board.nothingToday')}</p>}
        </section>
        {timetableId && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('timetable.board.week')}</h3>
            {grid.data ? <WeekGrid days={grid.data.days} slots={grid.data.slots} cells={grid.data.cells} show="section" /> : <Skeleton className="h-48 rounded-xl" />}
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {timetableId && <Button icon={CalendarClock} onClick={() => navigate(`/timetable/timetable?roomId=${room.id}`)}>{t('timetable.board.openTimetable')}</Button>}
          {onEdit && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(room)}>{t('timetable.rooms.edit')}</Button>}
        </div>
      </div>
    </Drawer>
  )
}

/** Every room at a glance: who is in it this period, what's next, and how busy its week is. Grouped by kind of room. */
export default function RoomBoard({ onEdit }) {
  const { t } = useTranslation('timetable')
  const [at, setAt] = useState('')
  const [onlyFree, setOnlyFree] = useState(false)
  const [kindPick, setKindPick] = useState('') // the kind of room picked in the side list ('' = all)
  const [open, setOpen] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['room-board', at], queryFn: () => fetchRoomBoard(at || undefined), refetchInterval: at ? false : 60_000 })
  const frame = data?.frame ?? []
  const periods = frame.filter((s) => s.kind === 'PERIOD' && s.no > 0)
  const nowLabel = t('timetable.board.now')
  const periodLabel = (p) => t('timetable.board.periodAt', { no: p.no, time: p.start })
  const groups = useMemo(() => {
    const m = new Map()
    const byCode = [...(data?.rooms ?? [])].sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name, undefined, { numeric: true }))
    for (const r of byCode) { if (!m.has(r.kind)) m.set(r.kind, []); m.get(r.kind).push(r) }
    return KIND_ORDER.filter((k) => m.has(k)).map((k) => ({ kind: k, rooms: m.get(k) }))
  }, [data])
  const c = data?.counts
  const n = data?.now
  const when = !n ? '' : !n.schoolDay ? t('timetable.board.phase.CLOSED') : n.phase === 'PERIOD' ? t('timetable.board.phase.PERIOD', { no: n.slot?.no, start: n.slot?.start, end: n.slot?.end })
    : n.phase === 'BREAK' ? t('timetable.board.phase.BREAK', { label: n.slot?.label || t('timetable.board.break') }) : t(`timetable.board.phase.${n.phase}`)

  if (isLoading) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[148px] rounded-xl" />)}</div>
  if (!data?.rooms?.length) return <EmptyState icon={DoorOpen} title={t('timetable.rooms.empty')} hint={t('timetable.board.emptyHint')} />

  return (
    <div className="space-y-4">
      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: at ? t('timetable.board.inUseThen') : t('timetable.board.inUse'), value: c.IN_USE, sub: t('timetable.board.ofRooms', { count: c.total - c.INACTIVE }), progress: ((c.IN_USE) / Math.max(1, c.total - c.INACTIVE)) * 100 },
        { icon: Sparkles, tone: 'success', label: at ? t('timetable.board.freeThen') : t('timetable.board.freeNow'), value: c.FREE, sub: t('timetable.board.freeHint'), onClick: () => setOnlyFree((x) => !x), className: onlyFree ? 'ring-2 ring-success-300' : undefined },
        { icon: CalendarClock, tone: 'violet', label: t('timetable.board.avgUse'), value: `${data.avgUse}%`, sub: t('timetable.board.avgUseHint', { count: data.perWeek }), progress: data.avgUse },
        { icon: Clock, tone: 'info', label: at ? t('timetable.board.showing') : nowLabel, value: n.time, sub: when },
      ]} />
      {!data.published && <Note tone="warning">{t('timetable.board.notPublished')}</Note>}
      <SideNavLayout nav={groups.length > 1 && <SideNav title={t('timetable.board.navTitle')} value={kindPick} onChange={setKindPick} items={[
        { id: '', label: t('timetable.board.allRooms'), icon: DoorOpen, count: `${c.FREE}/${c.total}` },
        ...groups.map(({ kind, rooms }) => ({
          id: kind, label: t(`timetable.board.groups.${kind}`), icon: KIND_ICON[kind] ?? DoorOpen,
          hint: t('timetable.board.busyRatio', { busy: rooms.filter((r) => r.status === 'IN_USE').length, total: rooms.filter((r) => r.active).length }),
          count: `${rooms.filter((r) => r.status === 'FREE').length}/${rooms.length}`,
          progress: { value: rooms.filter((r) => r.status === 'IN_USE').length, max: Math.max(1, rooms.filter((r) => r.active).length), warnPct: 101 },
        })),
      ]} />}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted">
        <ControlChip label={t('timetable.board.at')} value={at ? periodLabel(periods.find((p) => p.start === at) ?? { no: '?', start: at }) : nowLabel} active={!!at}
          options={[nowLabel, ...periods.map(periodLabel)]} onChange={(v) => setAt(periods.find((p) => periodLabel(p) === v)?.start ?? '')} />
        {['IN_USE', 'FREE', 'CLOSED', 'INACTIVE'].map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><RoomGlyph status={k} size={20} />{t(`timetable.board.status.${k}`)}</span>
        ))}
        <label className="ms-auto flex min-h-[32px] items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} className="rounded border-border text-brand-500" />{t('timetable.board.freeOnly')}
        </label>
      </div>
      {groups.filter((g) => !kindPick || g.kind === kindPick).map(({ kind, rooms }) => {
        const list = onlyFree ? rooms.filter((r) => r.status === 'FREE') : rooms
        if (!list.length) return null
        const Icon = KIND_ICON[kind] ?? DoorOpen
        const busy = rooms.filter((r) => r.status === 'IN_USE').length
        const live = rooms.filter((r) => r.active).length
        return (
          <section key={kind} className="rounded-xl border border-border bg-surface shadow-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
              <Icon className="h-4 w-4 text-ink-muted" aria-hidden />
              <h2 className="font-display font-semibold text-ink">{t(`timetable.board.groups.${kind}`)}</h2>
              <span className="text-xs text-ink-faint">{t('timetable.board.roomsCount', { count: rooms.length })}</span>
              <span className="ms-auto text-xs text-ink-muted">{t('timetable.board.busyRatio', { busy, total: live })}</span>
              <div className="h-1.5 w-24 rounded-full bg-black/5"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(busy / Math.max(1, live)) * 100}%` }} /></div>
            </header>
            <div className="grid grid-cols-1 gap-3 p-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {list.map((r) => <RoomTile key={r.id} room={r} frame={frame} now={n} selected={open?.id === r.id} onOpen={setOpen} />)}
            </div>
          </section>
        )
      })}
      </SideNavLayout>
      <RoomDrawer room={open} timetableId={data.timetableId} onClose={() => setOpen(null)} onEdit={onEdit ? (r) => { setOpen(null); onEdit(r) } : undefined} />
    </div>
  )
}
