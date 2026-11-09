import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { DoorOpen, UserRound } from 'lucide-react'
import { ACCENTS, LevelBar, TONE, Tag, hueTone } from '../system'

// A vehicle drawn from above, front to the right: the cab (door on the near side, the driver's seat on the
// right-hand side), then rows of seats either side of the aisle, and the full-width bench at the back.
// Seats fill in order with the riders; a filled seat takes its group's colour (the stop, or the class).

/** Seats either side of the aisle, by vehicle type: a bus is 2 + 2, a van 2 + 1, a car or auto 1 + 1. */
const SHAPE = { BUS: [2, 2], MINI_BUS: [2, 2], VAN: [2, 1], CAR: [1, 1], AUTO: [1, 1] }

/**
 * The seat plan for a capacity: rows from the front to the back, each a list of cells across the vehicle
 * (top = door side … bottom = driver side), a cell being a seat number or null for the aisle.
 * The back row is a bench across the aisle (5 on a bus); a short row, if the seats don't divide evenly, sits
 * just behind the driver.
 */
export function seatLayout(capacity, type) {
  const [top, bottom] = SHAPE[type] ?? SHAPE.BUS
  const width = top + bottom + 1
  const n = Math.max(0, Math.floor(Number(capacity) || 0))
  const back = Math.min(n, width)
  const per = top + bottom
  const rest = n - back
  const full = Math.floor(rest / per)
  const short = rest % per
  const rows = []
  let no = 0
  const seat = () => ++no
  if (short) {
    // behind the driver first (the door side stays clear by the door)
    const onBottom = Math.min(short, bottom)
    const onTop = short - onBottom
    rows.push([...Array.from({ length: top }, (_, i) => (i >= top - onTop ? 'S' : 'X')), null, ...Array.from({ length: bottom }, (_, i) => (i < onBottom ? 'S' : 'X'))])
  }
  for (let i = 0; i < full; i++) rows.push([...Array(top).fill('S'), null, ...Array(bottom).fill('S')])
  if (back) rows.push(Array.from({ length: width }, (_, i) => (i < back ? 'S' : 'X')))
  // number the seats front to back, across each row; 'X' is no seat (blank), null the aisle
  return { width, rows: rows.map((r) => r.map((c) => (c === 'S' ? seat() : c === 'X' ? 'X' : null))) }
}

/**
 * Riders → colour groups: by stop (each stop on the vehicle's routes its own colour, in route order) or by class
 * (the class's colour on every screen). Returns the riders with `tone` and `group`, and the groups in order.
 */
export function seatGroups(riders = [], by = 'STOP', noClass = '—') {
  const groups = new Map()
  const out = riders.map((r) => {
    const key = by === 'CLASS' ? r.classId ?? 'none' : `${r.routeId}:${r.stopId}`
    if (!groups.has(key)) {
      const label = by === 'CLASS' ? r.classTitle ?? r.classCode ?? noClass : r.stop
      const tone = by === 'CLASS' ? (r.classCode ? hueTone(r.classCode) : 'neutral') : ACCENTS[groups.size % ACCENTS.length]
      groups.set(key, { key, label, sub: by === 'STOP' ? r.route : null, tone, count: 0 })
    }
    const g = groups.get(key)
    g.count++
    return { ...r, group: key, tone: g.tone }
  })
  return { riders: out, groups: [...groups.values()] }
}

const SIZE = {
  sm: { cell: 16, gap: 3, pad: 6, cab: 20, radius: 4 },
  lg: { cell: 28, gap: 5, pad: 10, cab: 34, radius: 6 },
}
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase()

/**
 * <SeatMap capacity={40} type="BUS" riders={ridersWithTone} />
 * `riders` in seat order, each { id, name, stop, tone, group }; past the capacity they show as standing.
 * `active` lights up one group's seats (the others fade).
 */
export default function SeatMap({ capacity, type, riders = [], size = 'sm', active = null, className }) {
  const { t } = useTranslation('transport')
  const s = SIZE[size] ?? SIZE.sm
  const { width, rows } = seatLayout(capacity, type)
  const seated = riders.length
  const standing = riders.slice(Math.max(0, capacity ?? 0))
  const dim = (r) => active && r && r.group !== active
  const aria = t('transport.board.mapAria', { seated: Math.min(seated, capacity ?? 0), capacity: capacity ?? 0 })
  const cellStyle = { width: s.cell, height: s.cell, borderRadius: s.radius }
  const big = size === 'lg'

  const seatCell = (no) => {
    const r = riders[no - 1]
    if (!r) {
      return (
        <span key={no} title={t('transport.board.seatFree', { n: no })} style={cellStyle}
          className="flex items-center justify-center border border-ink-faint/40 bg-surface shadow-[inset_3px_0_0_rgb(0_0_0/0.05)]">
          {big && <span className="text-[9px] tabular-nums text-ink-faint">{no}</span>}
        </span>
      )
    }
    return (
      <span key={no} title={t('transport.board.seat', { n: no, name: r.name, stop: r.stop })} style={cellStyle}
        className={clsx('flex items-center justify-center text-white shadow-[inset_3px_0_0_rgb(0_0_0/0.18)] transition-opacity', (TONE[r.tone] ?? TONE.neutral).fill, dim(r) && 'opacity-20')}>
        {big && <span className="text-[9px] font-semibold leading-none">{initials(r.name)}</span>}
      </span>
    )
  }

  return (
    <div className={clsx('min-w-0', className)}>
      <div className="max-w-full overflow-x-auto scroll-thin">
        <div role="img" aria-label={aria} className="inline-flex items-stretch border-2 border-ink-faint/40 bg-black/[0.015]"
          style={{ padding: s.pad, gap: s.gap * 2, borderRadius: `${s.radius * 2}px ${s.cab}px ${s.cab}px ${s.radius * 2}px` }}>
          {/* rows back → front, so the front is on the right */}
          <div className="flex" style={{ gap: s.gap }}>
            {[...rows].reverse().map((row, ri) => (
              <div key={ri} className="flex flex-col" style={{ gap: s.gap }}>
                {row.map((c, ci) => (c === null || c === 'X'
                  ? <span key={`a${ci}`} style={{ width: s.cell, height: s.cell }} aria-hidden />
                  : seatCell(c)))}
              </div>
            ))}
          </div>
          {/* the cab: door on top, the driver below with the wheel in front */}
          <div className="flex flex-col justify-between border-s border-dashed border-ink-faint/40" style={{ paddingInlineStart: s.gap * 2, height: width * s.cell + (width - 1) * s.gap }}>
            <span title={t('transport.board.door')} className="flex items-center justify-center text-ink-faint" style={{ width: s.cell, height: s.cell }}>
              <DoorOpen style={{ width: s.cell * 0.8, height: s.cell * 0.8 }} aria-hidden />
            </span>
            <span className="flex items-center" style={{ gap: Math.max(2, s.gap - 1) }} title={t('transport.board.driverSeat')}>
              <span style={cellStyle} className="flex items-center justify-center border border-ink-faint/60 bg-black/[0.06]">
                <UserRound className="text-ink-muted" style={{ width: s.cell * 0.65, height: s.cell * 0.65 }} aria-hidden />
              </span>
              <span className="rounded-full border-2 border-ink-faint/60" style={{ width: s.cell * 0.55, height: s.cell * 0.55 }} aria-hidden />
            </span>
          </div>
        </div>
      </div>
      {standing.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Tag size="xs" tone="danger">{t('transport.board.standing', { count: standing.length })}</Tag>
          {standing.map((r) => (
            <span key={r.id} title={t('transport.board.standingRider', { name: r.name, stop: r.stop })}
              className={clsx('rounded-full border-2 border-rose-500 bg-rose-50', dim(r) && 'opacity-20')}
              style={{ width: big ? 16 : 10, height: big ? 16 : 10 }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** "28 / 40 seats" with a bar: amber from 90% full, red once over. */
export function SeatsBar({ seated, capacity, className }) {
  const { t } = useTranslation('transport')
  const cap = capacity ?? 0
  const over = seated - cap
  return (
    <div className={clsx('space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={clsx('font-semibold tabular-nums', over > 0 ? 'text-rose-700' : cap && seated >= cap * 0.9 ? 'text-amber-700' : 'text-ink')}>
          {t('transport.board.seatsOf', { seated, capacity: cap })}
        </span>
        <span className={clsx('tabular-nums', over > 0 ? 'font-medium text-rose-700' : 'text-ink-faint')}>
          {over > 0 ? t('transport.board.over', { count: over }) : t('transport.board.free', { count: cap - seated })}
        </span>
      </div>
      <LevelBar bare value={seated} max={Math.max(1, cap)} highIsBad warnAt={Math.ceil(cap * 0.9)} dangerAt={cap + 1} width="w-full" />
    </div>
  )
}

/** The colour key under a seat map: each stop (or class) with its count. Pass `onPick` to light one up. */
export function SeatLegend({ groups = [], max, active, onPick, className }) {
  const { t } = useTranslation('transport')
  const shown = max ? groups.slice(0, max) : groups
  const more = groups.length - shown.length
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted', className)}>
      {shown.map((g) => {
        const body = (
          <>
            <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-[3px]', (TONE[g.tone] ?? TONE.neutral).fill)} />
            <span className="truncate max-w-[10rem]">{g.label}</span>
            <span className="tabular-nums text-ink-faint">{g.count}</span>
          </>
        )
        return onPick
          ? <button key={g.key} type="button" aria-pressed={active === g.key} onClick={() => onPick(active === g.key ? null : g.key)}
              className={clsx('inline-flex min-h-[28px] items-center gap-1.5 rounded-md px-1.5 hover:bg-black/[0.04]', active === g.key && 'bg-black/[0.06] text-ink', active && active !== g.key && 'opacity-50')}>{body}</button>
          : <span key={g.key} className="inline-flex items-center gap-1.5 min-w-0">{body}</span>
      })}
      {more > 0 && <span className="text-ink-faint">{t('transport.board.moreN', { count: more })}</span>}
    </div>
  )
}
