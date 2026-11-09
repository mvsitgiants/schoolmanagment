import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, ArrowLeftRight, Lock, Plus, Save, Sparkles, UserMinus, UserX, Wand2, X } from 'lucide-react'
import { ROOM_KINDS, SEAT_FILL, SEAT_MIX, examRoomCapacity } from '@schoolgiant/shared'
import { Avatar, ColorChip, Note, SegmentedControl, Select, Tag, TONE, hueTone } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'

// Pieces of Exams › Seating & invigilation: the setup (rooms and rules), a room's seat map that can be edited by
// clicking two seats, the notice-board runs and the invigilators per room.

const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase()

/** Rooms and rules for generating a session's seating. */
export function SeatingSetup({ view, roomIds, setRoomIds, rules, setRules, canEdit, busy, onGenerate, onGenerateAll }) {
  const { t } = useTranslation('exams')
  const rooms = view.rooms
  const picked = new Set(roomIds)
  const capOf = (r) => examRoomCapacity({ id: r.id, layout: r.homeLayout ?? undefined, capacity: r.capacity }, { gap: rules.gap })
  const seats = rooms.filter((r) => picked.has(r.id)).reduce((n, r) => n + capOf(r), 0)
  const short = Math.max(0, view.needed - seats)
  const kinds = ROOM_KINDS.map((k) => k.value).filter((k) => rooms.some((r) => r.kind === k))
  const kindLabel = (k) => t(`exams.seating.roomKinds.${k}`, ROOM_KINDS.find((x) => x.value === k)?.label ?? k)
  const toggle = (id) => setRoomIds(picked.has(id) ? roomIds.filter((x) => x !== id) : [...roomIds, id])
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">{t('exams.seating.rooms')}</p>
            <p className={clsx('text-xs', short ? 'text-danger-600' : 'text-ink-faint')}>
              {short ? t('exams.seating.short', { seats, needed: view.needed, short }) : t('exams.seating.enough', { seats, needed: view.needed })}
            </p>
          </div>
          {canEdit && <Button size="sm" variant="secondary" icon={Sparkles} onClick={() => setRoomIds(view.suggestion.ids)}>{t('exams.seating.suggest', { count: view.suggestion.ids.length })}</Button>}
        </div>
        {!rooms.length && <Note tone="warning">{t('exams.seating.noRooms')}</Note>}
        <div className="space-y-3">
          {kinds.map((k) => (
            <div key={k}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{kindLabel(k)}</p>
              <div className="flex flex-wrap gap-1.5">
                {rooms.filter((r) => r.kind === k).map((r) => {
                  const on = picked.has(r.id)
                  return (
                    <button key={r.id} type="button" disabled={!canEdit} onClick={() => toggle(r.id)}
                      className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                        on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink hover:bg-bg', !canEdit && 'cursor-default')}>
                      <span className="font-semibold font-mono-num">{r.code || r.name}</span>
                      <span className="tabular-nums text-ink-faint">{capOf(r)}</span>
                      {view.suggestion.ids.includes(r.id) && <Sparkles className="h-3 w-3 text-amber-500" aria-label={t('exams.seating.suggested')} />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-ink">{t('exams.seating.rules')}</p>
        <div>
          <p className="mb-1 text-xs text-ink-muted">{t('exams.seating.mix')}</p>
          <SegmentedControl value={rules.mix} onChange={(v) => setRules({ ...rules, mix: v })}
            options={Object.keys(SEAT_MIX).map((k) => ({ value: k, label: t(`exams.seating.mixes.${k}`, SEAT_MIX[k].label) }))} />
          <p className="mt-1 text-[11px] text-ink-faint">{t(`exams.seating.mixHint.${rules.mix}`)}</p>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm text-ink">
          <span>{t('exams.seating.gap')}<span className="block text-[11px] text-ink-faint">{t('exams.seating.gapHint')}</span></span>
          <Switch checked={!!rules.gap} onChange={(v) => setRules({ ...rules, gap: v })} label={t('exams.seating.gap')} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-ink">
          <span>{t('exams.seating.spread')}<span className="block text-[11px] text-ink-faint">{t('exams.seating.spreadHint')}</span></span>
          <Switch checked={rules.spread !== false} onChange={(v) => setRules({ ...rules, spread: v })} label={t('exams.seating.spread')} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-xs text-ink-muted">{t('exams.seating.fill')}</p>
            <Select value={rules.fill} onChange={(e) => setRules({ ...rules, fill: e.target.value })}>
              {Object.keys(SEAT_FILL).map((k) => <option key={k} value={k}>{t(`exams.seating.fills.${k}`, SEAT_FILL[k].label)}</option>)}
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-muted">{t('exams.seating.perInvigilator')}</p>
            <Select value={rules.perInvigilator} onChange={(e) => setRules({ ...rules, perInvigilator: Number(e.target.value) })}>
              {[20, 25, 30, 40, 50, 60].map((n) => <option key={n} value={n}>{t('exams.seating.perInvigilatorN', { count: n })}</option>)}
            </Select>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-col gap-2 pt-1">
            <Button icon={Wand2} loading={busy} disabled={!roomIds.length} onClick={onGenerate}>{view.plan ? t('exams.seating.regenerate') : t('exams.seating.generate')}</Button>
            <Button variant="secondary" disabled={!roomIds.length || busy} onClick={onGenerateAll}>{t('exams.seating.generateAll')}</Button>
            {view.plan?.seats.some((s) => s.locked) && <p className="text-[11px] text-ink-faint">{t('exams.seating.keepsLocked')}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One room's seats, front row first. Click a student, then another seat: they swap (or move to it when it is free).
 * A student without a seat can be picked from the list under the map and put on a free seat the same way.
 */
export function RoomSeatMap({ room, seats, classes, clashes = [], canEdit, picked, onPick, onPlace }) {
  const { t } = useTranslation('exams')
  const at = useMemo(() => new Map(seats.filter((s) => s.roomId === room.roomId).map((s) => [s.seat, s])), [seats, room.roomId])
  const clash = useMemo(() => new Set(clashes.filter((c) => c.roomId === room.roomId).flatMap((c) => [c.a, c.b])), [clashes, room.roomId])
  const usable = new Set(room.usable)
  const classOf = new Map(classes.map((c) => [c.id, c]))
  const wide = room.drawn.columns * room.drawn.perBench > 10
  const click = (label, s) => {
    if (!canEdit) return
    if (picked) {
      if (picked.seat === label && picked.roomId === room.roomId) return onPick(null)
      return onPlace({ roomId: room.roomId, seat: label })
    }
    if (s) onPick({ studentId: s.studentId, roomId: room.roomId, seat: label, name: s.name })
  }
  return (
    <div className="overflow-x-auto scroll-thin rounded-2xl border border-border bg-bg/60 p-4">
      <div className="mx-auto mb-4 flex h-7 w-full max-w-lg items-center justify-center rounded-md bg-ink/80 text-[10.5px] font-semibold uppercase tracking-widest text-white">{t('exams.seating.front')}</div>
      <div className="flex min-w-fit flex-col gap-2">
        {room.drawn.grid.map((row, r) => (
          <div key={r} className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${room.drawn.columns}, minmax(${wide ? 64 : 96}px, 1fr))` }}>
            {row.map((bench, c) => (
              <div key={c} className={clsx('flex min-w-0 gap-1', room.drawn.kind === 'BENCH' && 'rounded-lg bg-surface p-1 ring-1 ring-border')}>
                {bench.map((label) => {
                  const s = at.get(label)
                  const off = !usable.has(label)
                  const tone = s ? TONE[hueTone(s.classId)] : null
                  const isPicked = picked && picked.roomId === room.roomId && picked.seat === label
                  return (
                    <button key={label} type="button" disabled={off || !canEdit} onClick={() => click(label, s)}
                      title={s ? [t('exams.seating.seatN', { no: label }), s.section, s.rollNo && t('exams.seating.roll', { no: s.rollNo }), s.name, classOf.get(s.classId)?.subject].filter(Boolean).join(' · ') : off ? t('exams.seating.seatGap', { no: label }) : t('exams.seating.seatFree', { no: label })}
                      className={clsx('relative flex h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-md border px-0.5 text-center leading-tight transition-transform',
                        s ? clsx(tone.bg, tone.border, tone.text) : off ? 'border-transparent bg-black/[0.03] text-ink-faint/40' : 'border-dashed border-success-300 bg-success-50/40 text-success-600',
                        canEdit && !off && 'hover:scale-105', isPicked && 'ring-2 ring-brand-500 ring-offset-1', clash.has(label) && 'ring-2 ring-danger-400',
                        picked && !s && !off && 'animate-pulse')}>
                      <span className="text-[9.5px] font-semibold tabular-nums opacity-70">{label}</span>
                      {s && <span className="max-w-full truncate text-[10.5px] font-bold">{wide ? `${s.section}${s.rollNo ? `/${s.rollNo}` : ''}` : initials(s.name)}</span>}
                      {s && !wide && <span className="max-w-full truncate text-[9px] opacity-75">{s.section}{s.rollNo ? `/${s.rollNo}` : ''}</span>}
                      {s?.locked && <Lock className="absolute end-0.5 top-0.5 h-2.5 w-2.5 opacity-60" aria-label={t('exams.seating.locked')} />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The classes of the session as a legend with how many sit in the room. */
export function ClassLegend({ classes, seats, roomId }) {
  const { t } = useTranslation('exams')
  const n = new Map()
  for (const s of seats) if (!roomId || s.roomId === roomId) n.set(s.classId, (n.get(s.classId) ?? 0) + 1)
  return (
    <div className="flex flex-wrap gap-1.5">
      {classes.filter((c) => n.get(c.id)).map((c) => (
        <ColorChip key={c.id} label={c.name} seed={c.id} dot sub={t('exams.seating.inRoom', { count: n.get(c.id), subject: c.subject })} />
      ))}
    </div>
  )
}

/** Invigilators of every room: who, how many are wanted, warnings, and pick / remove / automatic. */
export function InvigilatorsPanel({ plan, teachers, canEdit, onSet, onAuto, busy }) {
  const { t } = useTranslation('exams')
  const byId = new Map(teachers.map((x) => [x.id, x]))
  const usedHere = new Set(plan.rooms.flatMap((r) => r.invigilatorIds))
  const [adding, setAdding] = useState(null) // roomId
  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">{t('exams.seating.invigilatorRules')}</p>
          <Button size="sm" variant="secondary" icon={Wand2} loading={busy} onClick={onAuto}>{t('exams.seating.pickAgain')}</Button>
        </div>
      )}
      <div className="divide-y divide-border rounded-xl border border-border bg-surface">
        {plan.rooms.map((r) => {
          const short = r.invigilatorIds.length < r.wanted
          const free = teachers.filter((x) => !usedHere.has(x.id)).sort((a, b) => Number(r.avoid.includes(a.id)) - Number(r.avoid.includes(b.id)) || Number(a.away) - Number(b.away) || a.duties - b.duties || a.name.localeCompare(b.name))
          return (
            <div key={r.roomId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="w-40 shrink-0">
                <p className="font-semibold text-ink font-mono-num">{r.code || r.name}</p>
                <p className="text-[11px] text-ink-faint">{t('exams.seating.roomLine', { count: r.students, wanted: r.wanted })}</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {r.invigilatorIds.map((id) => {
                  const x = byId.get(id)
                  const own = r.avoid.includes(id)
                  return (
                    <span key={id} className={clsx('inline-flex items-center gap-1.5 rounded-full border py-0.5 pe-1 ps-0.5 text-xs', own || x?.away ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-border bg-bg text-ink')}>
                      <Avatar name={x?.name ?? '?'} size={20} soft />{x?.name ?? '—'}
                      {x && <span className="text-[10px] text-ink-faint tabular-nums">{t('exams.seating.dutiesN', { count: x.duties })}</span>}
                      {(own || x?.away) && <AlertTriangle className="h-3 w-3" aria-label={own ? t('exams.seating.ownSubject') : t('exams.seating.onLeave')} />}
                      {canEdit && <button type="button" onClick={() => onSet(r.roomId, r.invigilatorIds.filter((v) => v !== id))} className="rounded-full p-0.5 hover:bg-black/5" aria-label={t('exams.seating.remove')}><X className="h-3 w-3" /></button>}
                    </span>
                  )
                })}
                {short && <Tag size="xs" tone="warning">{t('exams.seating.needMore', { count: r.wanted - r.invigilatorIds.length })}</Tag>}
                {r.invigilatorsByHand && <Tag size="xs">{t('exams.seating.byHand')}</Tag>}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1.5">
                  {adding === r.roomId ? (
                    <Select autoFocus value="" onChange={(e) => { if (e.target.value) onSet(r.roomId, [...r.invigilatorIds, e.target.value]); setAdding(null) }}>
                      <option value="">{t('exams.seating.pickTeacher')}</option>
                      {free.map((x) => <option key={x.id} value={x.id}>{[x.name, t('exams.seating.dutiesN', { count: x.duties }), r.avoid.includes(x.id) && t('exams.seating.ownSubject'), x.away && t('exams.seating.onLeave')].filter(Boolean).join(' · ')}</option>)}
                    </Select>
                  ) : <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(r.roomId)}>{t('exams.seating.add')}</Button>}
                  {r.invigilatorsByHand && <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => onSet(r.roomId, [], true)}>{t('exams.seating.auto')}</Button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The notice board: per room, each class-section's roll numbers. */
export function SeatingRuns({ plan }) {
  const { t } = useTranslation('exams')
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {plan.rooms.map((r) => (
        <div key={r.roomId} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="w-32 shrink-0">
            <p className="font-semibold text-ink font-mono-num">{r.code || r.name}</p>
            <p className="text-[11px] text-ink-faint">{t('exams.seating.studentsN', { count: r.students })}</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {r.runs.map((x) => <ColorChip key={x.section} label={x.section} sub={x.from != null ? (x.from === x.to ? `${x.from}` : `${x.from}–${x.to}`) + ` (${x.count})` : `(${x.count})`} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Students left without a seat: pick one, then a free seat. */
export function UnseatedList({ list, picked, onPick, canEdit }) {
  const { t } = useTranslation('exams')
  if (!list.length) return null
  return (
    <Note tone="warning" icon={UserMinus}>
      <p className="font-medium">{t('exams.seating.unseatedN', { count: list.length })}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.map((s) => (
          <button key={s.id} type="button" disabled={!canEdit} onClick={() => onPick(picked?.studentId === s.id ? null : { studentId: s.id, name: s.name })}
            className={clsx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs', picked?.studentId === s.id ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-amber-200 bg-surface text-ink')}>
            {s.section}{s.rollNo ? `/${s.rollNo}` : ''} · {s.name}
          </button>
        ))}
      </div>
    </Note>
  )
}

export function PickedBar({ picked, onCancel }) {
  const { t } = useTranslation('exams')
  if (!picked) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
      <ArrowLeftRight className="h-4 w-4" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t('exams.seating.pickedHint', { name: picked.name })}</span>
      <Button size="sm" variant="ghost" onClick={onCancel}>{t('exams.seating.cancel')}</Button>
    </div>
  )
}

/**
 * Exam-hall attendance, room by room: every seated student starts present; click to mark absent, then save. The room's
 * invigilators (and anyone who may edit the seating) can mark it. Marks entry starts the absent ones as absent.
 */
export function HallAttendance({ plan, classes, me, canEditAll, busy, onSave }) {
  const { t } = useTranslation('exams')
  const mine = plan.rooms.filter((r) => canEditAll || r.invigilatorIds.includes(me))
  const [roomId, setRoomId] = useState(() => (mine[0] ?? plan.rooms[0])?.roomId)
  const room = plan.rooms.find((r) => r.roomId === roomId)
  const here = plan.seats.filter((x) => x.roomId === roomId).sort((a, b) => String(a.seat).localeCompare(String(b.seat), undefined, { numeric: true }))
  const [absent, setAbsent] = useState(() => new Set(plan.absentIds))
  const marked = plan.attendance.find((a) => a.roomId === roomId)
  const editable = canEditAll || room?.invigilatorIds.includes(me)
  const classOf = new Map(classes.map((c) => [c.id, c]))
  const toggle = (id) => setAbsent((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })
  const absentHere = here.filter((x) => absent.has(x.studentId)).length
  if (!room) return null
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {plan.rooms.map((r) => {
          const done = plan.attendance.some((a) => a.roomId === r.roomId)
          return (
            <button key={r.roomId} type="button" onClick={() => setRoomId(r.roomId)}
              className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium', r.roomId === roomId ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink hover:bg-bg')}>
              <span className="font-semibold font-mono-num">{r.code || r.name}</span>
              <span className={clsx('h-1.5 w-1.5 rounded-full', done ? 'bg-success-500' : 'bg-amber-400')} />
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {marked ? t('exams.seating.hallMarked', { name: marked.by }) : t('exams.seating.hallNotMarked')}
          {' · '}{t('exams.seating.hallCount', { present: here.length - absentHere, absent: absentHere })}
        </p>
        {editable && <Button size="sm" icon={Save} loading={busy} onClick={() => onSave(roomId, here.filter((x) => absent.has(x.studentId)).map((x) => x.studentId))}>{t('exams.seating.hallSave')}</Button>}
      </div>
      {!editable && <Note>{t('exams.seating.hallOnlyInvigilators')}</Note>}
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {here.map((x) => {
          const off = absent.has(x.studentId)
          const tone = TONE[hueTone(x.classId)]
          return (
            <button key={x.studentId} type="button" disabled={!editable} onClick={() => toggle(x.studentId)}
              className={clsx('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-sm transition-colors',
                off ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-border bg-surface text-ink hover:bg-bg')}>
              <span className={clsx('w-9 shrink-0 rounded-md px-1 py-0.5 text-center text-[11px] font-bold tabular-nums', tone.bg, tone.text)}>{x.seat}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className={clsx('block truncate font-medium', off && 'line-through')}>{x.name}</span>
                <span className="block truncate text-[11px] text-ink-faint">{x.section}{x.rollNo ? ` · ${t('exams.seating.roll', { no: x.rollNo })}` : ''}{classOf.get(x.classId)?.subject ? ` · ${classOf.get(x.classId).subject}` : ''}</span>
              </span>
              {off && <UserX className="h-4 w-4 shrink-0" aria-label={t('exams.seating.absent')} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
