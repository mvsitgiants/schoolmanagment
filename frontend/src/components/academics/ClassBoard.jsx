import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { SEATING_KINDS, defaultSeating, placeStudents, seatPlan } from '@schoolgiant/shared'
import { ArrowLeftRight, Armchair, CalendarCheck, RotateCcw, Printer, Tags, CalendarDays, CalendarOff, DoorOpen, GraduationCap, Layers, MapPin, Pencil, Presentation, UserRound, Users } from 'lucide-react'
import { Avatar, Drawer, EmptyState, FactGrid, LevelBar, Note, SideNav, SideNavLayout, Skeleton, StatCardRow, StatusPill, Tabs, Tag, TONE, hueTone } from '../system'
import Button from '../ui/Button'
import { fetchClassBoard, moveClassSeats, resetClassSeats } from '../../api/academics'
import { fetchStudents } from '../../api/students'
import { fetchSheet } from '../../api/attendance'
import { printDocuments } from '../print/printDocument'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'

// The Class board (Academic setup › Classes & sections, "Board" view): one card per class, and in it one
// tile per section — the school's take on the hospital bed board. Classes are the wards, sections the beds.
// The class list (GET /academics/classes) gives the sections; GET /academics/board adds each section's
// boys / girls split and today's attendance.

const MARKS = ['P', 'L', 'HD', 'LV', 'A']
const MARK_TONE = { P: 'success', L: 'warning', HD: 'info', LV: 'neutral', A: 'danger' }
const GENDER_TONE = { MALE: 'info', FEMALE: 'pink', OTHER: 'violet', UNSET: 'neutral' }

/** Present % → tone: 90 % and up is good, 75–89 % amber, below that red. */
export const presentTone = (pct) => (pct == null ? 'neutral' : pct >= 90 ? 'success' : pct >= 75 ? 'warning' : 'danger')

/** The state a section tile is drawn in. */
export function sectionState(section, extra) {
  if (!section.active) return 'INACTIVE'
  if (extra?.attendance?.taken) return 'TAKEN'
  if (extra?.attendance) return 'PENDING'
  if (!section.studentCount) return 'EMPTY'
  return 'OFF'
}

/** Tile background per state (like the bed board's BED_TILE). */
export const SECTION_TILE = {
  TAKEN: 'bg-surface',
  PENDING: 'bg-amber-50/50',
  OFF: 'bg-surface',
  EMPTY: 'bg-bg',
  INACTIVE: 'bg-bg opacity-70',
}

/**
 * A small drawing of a classroom: a board on the wall and two desks. The pupils at the desks are drawn
 * when the section has students; an inactive section is greyed with a slash. Colour = the class colour.
 */
export function ClassroomGlyph({ tone = 'brand', filled = true, inactive = false, size = 44, title, className }) {
  return (
    <svg viewBox="0 0 48 34" width={size} height={Math.round((size * 34) / 48)} role="img" aria-label={title} aria-hidden={title ? undefined : true}
      className={clsx('shrink-0', inactive ? 'text-ink-faint' : TONE[tone]?.text ?? TONE.brand.text, className)}>
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* the board, its chalk lines and ledge */}
        <rect x="9" y="2" width="30" height="13" rx="1.6" fill="currentColor" fillOpacity={inactive ? 0 : 0.14} />
        <path d="M14 6.5h9M14 10.5h15" strokeOpacity="0.6" />
        <path d="M21 15v2.5M27 15v2.5" />
        {/* two desks with legs */}
        <path d="M5 25.5h15M28 25.5h15M7 25.5v6M18 25.5v6M30 25.5v6M41 25.5v6" />
      </g>
      {filled && !inactive && (
        <g fill="currentColor">
          {/* the pupils: a head and shoulders behind each desk */}
          <circle cx="12.5" cy="19.6" r="2.3" />
          <path d="M8.6 25.5c0-2 1.7-3.4 3.9-3.4s3.9 1.4 3.9 3.4z" />
          <circle cx="35.5" cy="19.6" r="2.3" />
          <path d="M31.6 25.5c0-2 1.7-3.4 3.9-3.4s3.9 1.4 3.9 3.4z" />
        </g>
      )}
      {inactive && <path d="M7 32L41 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  )
}

/** Today's attendance as a small chip: "Taken · 94% present" / "Not taken yet" / nothing on a day off. */
export function AttendanceChip({ attendance, size = 'xs' }) {
  const { t } = useTranslation('academics')
  if (!attendance) return null
  if (!attendance.taken) return <Tag size={size} tone="warning" icon={CalendarCheck}>{t('academics.board.notTaken')}</Tag>
  return (
    <Tag size={size} tone={presentTone(attendance.pct)} icon={CalendarCheck}>
      {attendance.pct == null ? t('academics.board.taken') : t('academics.board.takenPct', { pct: Math.round(attendance.pct) })}
    </Tag>
  )
}

/** Boys / girls (and other, not recorded) as one thin split bar, with the figures beside it. */
export function GenderSplit({ genders, big = false }) {
  const { t } = useTranslation('academics')
  const g = genders ?? {}
  const total = ['MALE', 'FEMALE', 'OTHER', 'UNSET'].reduce((n, k) => n + (g[k] ?? 0), 0)
  if (!total) return null
  return (
    <div className="min-w-0">
      <span className={clsx('flex w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.06]', big ? 'h-2.5' : 'h-1.5')} aria-hidden>
        {Object.entries(GENDER_TONE).map(([k, tone]) => (g[k] ? <span key={k} className={clsx('h-full', TONE[tone].fill)} style={{ width: `${(g[k] / total) * 100}%` }} /> : null))}
      </span>
      <p className={clsx('mt-1 truncate text-ink-muted tabular-nums', big ? 'text-xs' : 'text-[11px]')}>
        {[t('academics.board.boys', { count: g.MALE ?? 0 }), t('academics.board.girls', { count: g.FEMALE ?? 0 }),
          g.OTHER ? t('academics.board.other', { count: g.OTHER }) : null, g.UNSET ? t('academics.board.unset', { count: g.UNSET }) : null].filter(Boolean).join(' · ')}
      </p>
    </div>
  )
}

/** Students against the section's capacity: amber from 90 % full, red over capacity. */
function StrengthBar({ count, capacity, width = 'w-full' }) {
  const { t } = useTranslation('academics')
  if (!capacity) return <p className="text-[11.5px] text-ink-muted tabular-nums">{t('academics.board.students', { count })}</p>
  return <LevelBar value={count} max={capacity} highIsBad warnAt={capacity * 0.9} dangerAt={capacity + 1} width={width} />
}

/** One section on the board. */
export function SectionTile({ section, cls, extra, selected, onClick }) {
  const { t } = useTranslation('academics')
  const tone = hueTone(cls.id)
  const state = sectionState(section, extra)
  return (
    <button type="button" onClick={onClick}
      aria-label={t('academics.board.tileAria', { name: section.label, state: t(`academics.board.state.${state}`) })}
      className={clsx('text-start rounded-xl border p-3 min-h-[150px] flex flex-col gap-2.5 transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
        state === 'PENDING' ? 'border-amber-200' : 'border-border', SECTION_TILE[state], selected && 'ring-2 ring-brand-500')}>
      <div className="flex items-start gap-2.5 min-w-0">
        <ClassroomGlyph tone={tone} filled={section.studentCount > 0} inactive={!section.active} size={40} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className={clsx('text-lg font-bold leading-tight font-mono-num truncate', section.active ? 'text-ink' : 'text-ink-faint line-through')}>{section.short}</p>
          <p className="truncate text-[11px] text-ink-faint">{[section.room && t('academics.sections.roomN', { room: section.room }), section.branchName].filter(Boolean).join(' · ') || ' '}</p>
        </div>
        {!section.active && <StatusPill tone="neutral">{t('academics.inactive')}</StatusPill>}
      </div>
      <div className="flex items-center gap-1.5 min-w-0 text-[12px]">
        {section.classTeacherName
          ? <><Avatar name={section.classTeacherName} size={20} soft /><span className="truncate text-ink">{section.classTeacherName}</span></>
          : <span className="inline-flex items-center gap-1 text-amber-600"><UserRound className="h-3.5 w-3.5" aria-hidden />{t('academics.board.noTeacher')}</span>}
      </div>
      <StrengthBar count={section.studentCount} capacity={section.capacity} />
      <GenderSplit genders={extra?.genders} />
      {extra?.attendance && <div className="mt-auto border-t border-border pt-2"><AttendanceChip attendance={extra.attendance} /></div>}
    </button>
  )
}

/** The key to the board's colours, like the bed board's legend row. */
function Legend({ onlyPending, onOnlyPending, showFilter }) {
  const { t } = useTranslation('academics')
  const dot = (tone) => <span className={clsx('h-2.5 w-2.5 rounded-full', TONE[tone].fill)} />
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted">
      <span className="inline-flex items-center gap-1.5"><ClassroomGlyph tone="brand" size={22} />{t('academics.board.legend.students')}</span>
      <span className="inline-flex items-center gap-1.5"><ClassroomGlyph tone="brand" filled={false} size={22} />{t('academics.board.legend.empty')}</span>
      <span className="inline-flex items-center gap-1.5"><ClassroomGlyph inactive size={22} />{t('academics.board.legend.inactive')}</span>
      <span className="inline-flex items-center gap-1.5">{dot('success')}{t('academics.board.legend.good')}</span>
      <span className="inline-flex items-center gap-1.5">{dot('warning')}{t('academics.board.legend.fair')}</span>
      <span className="inline-flex items-center gap-1.5">{dot('danger')}{t('academics.board.legend.poor')}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded border border-amber-300 bg-amber-50" />{t('academics.board.legend.pending')}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-amber-500" />{t('academics.board.legend.nearlyFull')}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-rose-500" />{t('academics.board.legend.over')}</span>
      {showFilter && (
        <label className="ms-auto flex min-h-[32px] items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={onlyPending} onChange={(e) => onOnlyPending(e.target.checked)} className="rounded border-border text-brand-500" />{t('academics.board.onlyPending')}
        </label>
      )}
    </div>
  )
}

/** Everything about one section, and where to go from it. */
function SectionDrawer({ section, cls, extra, board, year, onClose, onEdit }) {
  const { t } = useTranslation('academics')
  const navigate = useNavigate()
  const { date, time } = useFormat()
  const att = extra?.attendance
  const c = att?.counts
  const off = section.active && !att && board
  return (
    <Drawer open onClose={onClose} title={section.label} subtitle={[cls.departmentName, year?.name].filter(Boolean).join(' · ')}
      footer={onEdit && <Button variant="secondary" icon={Pencil} onClick={onEdit}>{t('academics.board.editSection')}</Button>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <ClassroomGlyph tone={hueTone(cls.id)} filled={section.studentCount > 0} inactive={!section.active} size={56} />
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={section.active ? 'success' : 'neutral'}>{section.active ? t('status.active') : t('academics.inactive')}</StatusPill>
            <AttendanceChip attendance={att} size="sm" />
          </div>
        </div>

        <FactGrid boxed cols={2} items={[
          { icon: UserRound, label: t('academics.sections.classTeacher'), value: section.classTeacherName
            ? <span className="flex items-center gap-1.5 min-w-0"><Avatar name={section.classTeacherName} size={20} soft /><span className="truncate">{section.classTeacherName}</span></span>
            : <span className="text-amber-600">{t('academics.board.noTeacher')}</span> },
          { icon: DoorOpen, label: t('academics.sections.room'), value: section.room },
          { icon: Users, label: t('academics.sections.students'), value: section.capacity ? t('academics.board.ofCapacity', { count: section.studentCount, capacity: section.capacity }) : String(section.studentCount) },
          { icon: MapPin, label: t('academics.sections.campus'), value: section.branchName },
        ]} />

        {section.capacity > 0 && <StrengthBar count={section.studentCount} capacity={section.capacity} />}

        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('academics.board.genderTitle')}</p>
          {extra?.genders && section.studentCount > 0 ? <GenderSplit genders={extra.genders} big /> : <p className="text-sm text-ink-faint">{t('academics.board.noStudents')}</p>}
        </div>

        <div>
          <p className="text-sm font-semibold text-ink mb-2">{board ? t('academics.board.attendanceOn', { date: date(board.date) }) : t('academics.board.attendanceTitle')}</p>
          {att?.taken ? (
            <div className="space-y-2">
              {c?.total > 0 && (
                <span className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden>
                  {MARKS.map((k) => (c[k] ? <span key={k} className={clsx('h-full', TONE[MARK_TONE[k]].fill)} style={{ width: `${(c[k] / c.total) * 100}%` }} /> : null))}
                </span>
              )}
              <div className="flex flex-wrap gap-1.5">
                {c && MARKS.map((k) => (c[k] ? <Tag key={k} size="xs" tone={MARK_TONE[k]}>{t(`academics.board.marks.${k}`, { count: c[k] })}</Tag> : null))}
              </div>
              {(att.takenBy || att.takenAt) && <p className="text-xs text-ink-muted">{t('academics.board.takenBy', { name: att.takenBy ?? '—', time: att.takenAt ? time(att.takenAt) : '—' })}</p>}
            </div>
          ) : att ? <Note tone="warning" icon={CalendarCheck}>{t('academics.board.notTakenNote')}</Note>
            : off ? <Note icon={CalendarOff}>{extra?.holiday ? t('academics.board.holiday', { name: extra.holiday }) : !board.inYear ? t('academics.board.outsideYear') : t('academics.board.dayOff')}</Note>
              : <p className="text-sm text-ink-faint">—</p>}
        </div>

        <div className="flex flex-col gap-2">
          {hasPermission('students.directory.view') && <Button variant="secondary" icon={GraduationCap} onClick={() => navigate(`/students/directory?sectionId=${section.id}`)}>{t('academics.board.viewStudents')}</Button>}
          {section.active && (hasPermission('attendance.mark.create') || hasPermission('attendance.mark.view')) && <Button icon={CalendarCheck} onClick={() => navigate(`/attendance/mark?sectionId=${section.id}`)}>{att && !att.taken ? t('academics.board.markAttendance') : t('academics.board.openAttendance')}</Button>}
          {hasPermission('timetable.timetable.view') && <Button variant="secondary" icon={CalendarDays} onClick={() => navigate(`/timetable/timetable?sectionId=${section.id}`)}>{t('academics.board.timetable')}</Button>}
        </div>
      </div>
    </Drawer>
  )
}

/** One class as a card: its badge, strength and today's attendance, then its section tiles. */
function ClassCard({ cls, sections, extras, openId, onOpenSection, onOpenClass }) {
  const { t } = useTranslation('academics')
  const tone = TONE[hueTone(cls.id)]
  const all = cls.sections
  const students = all.reduce((n, s) => n + s.studentCount, 0)
  const capacity = all.length && all.every((s) => s.capacity) ? all.reduce((n, s) => n + s.capacity, 0) : 0
  const due = all.filter((s) => extras.get(s.id)?.attendance)
  const taken = due.filter((s) => extras.get(s.id).attendance.taken).length
  return (
    <section className="rounded-xl border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-border">
        <button type="button" onClick={onOpenClass} className="flex min-w-0 items-center gap-3 text-start rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold font-mono-num', tone.bg, tone.text, tone.border)}>{(cls.code || cls.name).slice(0, 3)}</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-display font-semibold text-ink">{cls.name}{!cls.active && <span className="ms-2 text-xs font-normal text-ink-faint">{t('academics.inactive')}</span>}</span>
            <span className="block truncate text-[11.5px] text-ink-faint">{[cls.departmentName, t('academics.board.classLine', { students: t('academics.board.students', { count: students }), sections: t('academics.board.sectionsN', { count: all.length }) })].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
        <span className="ms-auto flex items-center gap-3">
          {due.length > 0 && <span className={clsx('text-xs tabular-nums', taken < due.length ? 'text-amber-600' : 'text-ink-muted')}>{t('academics.board.takenRatio', { taken, total: due.length })}</span>}
          {capacity ? <LevelBar value={students} max={capacity} highIsBad warnAt={capacity * 0.9} dangerAt={capacity + 1} width="w-28" />
            : <span className="text-xs text-ink-muted tabular-nums">{t('academics.board.students', { count: students })}</span>}
        </span>
      </header>
      {sections.length ? (
        <div className="p-3 grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {sections.map((s) => <SectionTile key={s.id} section={s} cls={cls} extra={extras.get(s.id)} selected={openId === s.id} onClick={() => onOpenSection(s.id)} />)}
        </div>
      ) : <p className="px-4 py-4 text-sm text-ink-faint">{t('academics.classes.noSections')}</p>}
    </section>
  )
}

/**
 * The board itself. `classes` / `year` come from the class list; `onEditSection(cls, section)` opens the
 * section form (shown when the caller may edit); `onOpenClass(cls)` opens the class drawer; `emptyAction` is the
 * button shown when there are no classes yet.
 */

// ───────────────────────────────────────────────────────── one class: its sections as tabs, each a seating sheet

const SEAT_TONE = { MALE: 'info', FEMALE: 'pink', OTHER: 'violet' }
const DOT = { P: 'bg-success-500', L: 'bg-amber-400', HD: 'bg-info-500', LV: 'bg-ink-faint', A: 'bg-danger-500' }

/**
 * A classroom from above: the board and the class teacher's desk at the front, then rows of two-seat desks with
 * aisles. Students sit in roll-number order; free seats are outlined; anyone over the room's seats is listed
 * as "no seat". With today's attendance taken, each seat carries a dot (present, absent, late, on leave).
 */
function SeatingSheet({ section, cls, extra, board }) {
  const { t } = useTranslation('academics')
  const navigate = useNavigate()
  const canSee = hasPermission('students.directory.view') || hasPermission('students.profile.view')
  const studentsQ = useQuery({ queryKey: ['students', { sectionId: section.id, status: 'ACTIVE', pageSize: 100, seat: true }],
    queryFn: () => fetchStudents({ sectionId: section.id, status: 'ACTIVE', pageSize: 100 }), enabled: canSee })
  const taken = !!extra?.attendance?.taken
  const sheetQ = useQuery({ queryKey: ['attendance-sheet', section.id, board?.date, 0],
    queryFn: () => fetchSheet({ sectionId: section.id, date: board.date }), enabled: taken && !!board?.date && hasPermission('attendance.mark.view'), retry: false })
  const marks = useMemo(() => new Map((sheetQ.data?.students ?? []).map((x) => [x.id, x.status])), [sheetQ.data])
  const kids = useMemo(() => [...(studentsQ.data?.data ?? [])].sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || a.name.localeCompare(b.name)), [studentsQ.data])
  // the section's own layout, or (none set) three columns of two-seat benches sized to its capacity
  const plan = useMemo(() => {
    if (section.seating) return seatPlan(section.seating)
    const cap = section.capacity || Math.max(30, Math.ceil(Math.max(kids.length, section.studentCount) / 6) * 6)
    return seatPlan(defaultSeating(cap), { limit: cap })
  }, [section.seating, section.capacity, section.studentCount, kids.length])
  // who sits where: seats arranged by hand stay; everyone else fills the free seats in roll order
  const placement = useMemo(() => placeStudents(plan, kids, section.seatAssignments ?? []), [plan, kids, section.seatAssignments])
  const capacity = plan.total
  const standing = placement.standing
  const rows = plan.rows
  const qc = useQueryClient()
  const canArrange = hasPermission('academics.classes.edit')
  const [arranging, setArranging] = useState(false)
  const [picked, setPicked] = useState(null) // { id, name, seat }
  const refresh = () => { qc.invalidateQueries({ queryKey: ['academic-classes'] }); setPicked(null) }
  const move = useMutation({ mutationFn: (m) => moveClassSeats(section.id, [m]), onSuccess: refresh })
  const reset = useMutation({ mutationFn: () => resetClassSeats(section.id), onSuccess: () => { refresh(); setArranging(false) } })
  const clickSeat = (label, kid) => {
    if (!arranging) { if (kid) navigate(`/students/profile/${kid.id}`); return }
    if (!picked) { if (kid) setPicked({ id: kid.id, name: kid.name, seat: label }); return }
    if (picked.seat === label) { setPicked(null); return }
    move.mutate({ studentId: picked.id, seat: label })
  }
  const tone = TONE[hueTone(cls.id)]
  const kindLabel = t(`academics.board.sheet.kinds.${plan.kind}`, SEATING_KINDS[plan.kind]?.label)

  if (!canSee) return <Note>{t('academics.board.sheet.noAccess')}</Note>
  if (studentsQ.isLoading) return <Skeleton className="h-80 rounded-xl" />

  const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const Seat = ({ kid, no }) => {
    if (!kid) {
      return (
        <button type="button" disabled={!arranging || !picked} onClick={() => clickSeat(no, null)} title={t('academics.board.sheet.freeSeat', { no })}
          className={clsx('flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-success-300 bg-success-50/40 text-success-600', arranging && picked && 'animate-pulse cursor-pointer')}>
          <Armchair className="h-3.5 w-3.5 opacity-60" aria-hidden />
          <span className="mt-0.5 text-[10px] font-medium tabular-nums">{no}</span>
        </button>
      )
    }
    const st = TONE[SEAT_TONE[kid.gender] ?? 'neutral']
    const mark = marks.get(kid.id)
    const isPicked = picked?.id === kid.id
    return (
      <button type="button" onClick={() => clickSeat(no, kid)}
        title={[t('academics.board.sheet.seat', { no }), kid.rollNo ? t('academics.board.sheet.roll', { no: kid.rollNo }) : null, kid.name, mark ? t(`academics.board.sheet.mark.${mark}`, mark) : null].filter(Boolean).join(' · ')}
        className={clsx('relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 2xl:flex-row 2xl:justify-start 2xl:gap-2 2xl:px-2 2xl:text-start', st.bg, st.border, mark === 'A' && 'opacity-60', isPicked && 'ring-2 ring-brand-500 ring-offset-1')}>
        <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/80 text-[10.5px] font-bold', st.text)}>{initials(kid.name)}</span>
        <span className="min-w-0 max-w-full leading-tight">
          <span className={clsx('hidden truncate text-[12px] font-semibold 2xl:block', st.text)}>{kid.name.split(/\s+/)[0]}</span>
          {kid.rollNo != null && <span className="block truncate text-[9.5px] text-ink-faint tabular-nums">{t('academics.board.sheet.roll', { no: kid.rollNo })}</span>}
        </span>
        {mark && <span className={clsx('absolute end-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface', DOT[mark])} />}
        {placement.placed.has(kid.id) && <span className="absolute start-1 top-1 text-[8px] text-ink-faint" aria-label={t('academics.board.sheet.byHand')}>●</span>}
      </button>
    )
  }

  return (
    <div className="space-y-3">
    {canArrange && (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={arranging ? 'primary' : 'secondary'} icon={ArrowLeftRight} onClick={() => { setArranging((x) => !x); setPicked(null) }}>
          {arranging ? t('academics.board.sheet.doneArranging') : t('academics.board.sheet.arrange')}
        </Button>
        {(section.seatAssignments?.length ?? 0) > 0 && <Button size="sm" variant="ghost" icon={RotateCcw} loading={reset.isPending} onClick={() => reset.mutate()}>{t('academics.board.sheet.rollOrder')}</Button>}
        <span className="text-xs text-ink-faint">
          {arranging ? (picked ? t('academics.board.sheet.pickedHint', { name: picked.name }) : t('academics.board.sheet.arrangeHint'))
            : (section.seatAssignments?.length ? t('academics.board.sheet.arranged') : t('academics.board.sheet.rollOrderNote'))}
        </span>
      </div>
    )}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      {/* the room */}
      <div className="min-w-0 rounded-2xl border border-border bg-bg/60 p-4 sm:p-5">
        <div className="mb-5 grid grid-cols-[auto_1fr_auto] items-center gap-4">
          <span className="flex items-center gap-1 text-[10.5px] text-ink-faint"><DoorOpen className="h-4 w-4" aria-hidden />{t('academics.board.sheet.door')}</span>
          <div className="flex flex-col items-center gap-2">
            <span className={clsx('flex h-7 w-full max-w-lg items-center justify-center rounded-md text-[10.5px] font-semibold uppercase tracking-widest text-white', tone.fill)}>{t('academics.board.sheet.board')}</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-ink">
              <Presentation className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
              {section.classTeacherName ? <><Avatar name={section.classTeacherName} size={18} soft />{section.classTeacherName}</> : <span className="text-amber-600">{t('academics.board.noTeacher')}</span>}
            </span>
          </div>
          <span className="text-[10.5px] text-ink-faint tabular-nums">{t('academics.board.sheet.rows', { count: plan.rows.length })}</span>
        </div>
        {/* the benches (or desks) as laid out: `columns` across, `rows` deep, aisles between */}
        <div className="flex flex-col gap-2.5">
          {rows.map((row, r) => (
            <div key={r} className="grid gap-3 sm:gap-5" style={{ gridTemplateColumns: `repeat(${plan.columns}, minmax(0, 1fr))` }}>
              {row.map((bench, c) => (!bench.length ? <span key={c} /> : (
                <div key={c} className={clsx('flex min-w-0 gap-1.5', plan.kind === 'BENCH' && 'rounded-xl bg-surface p-1.5 shadow-sm ring-1 ring-border')}>
                  {bench.map((seat) => <Seat key={seat.label} kid={placement.at.get(seat.label) ?? null} no={seat.label} />)}
                  {bench.length < plan.perBench && Array.from({ length: plan.perBench - bench.length }, (_, k) => <span key={`x${k}`} className="flex-1" />)}
                </div>
              )))}
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-ink-faint">
          {t('academics.board.sheet.layoutLine', {
            what: plan.kind === 'BENCH' ? t('academics.board.sheet.benchesOf', { count: plan.perBench }) : kindLabel,
            columns: plan.columns, rows: plan.rowCount, numbering: t(`academics.board.sheet.numberingShort.${plan.numbering}`),
          })}
          {!section.seating && <span> · {t('academics.board.sheet.defaultLayout')}</span>}
        </p>
        {standing.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <Tag tone="danger" size="xs">{t('academics.board.sheet.noSeat', { count: standing.length })}</Tag>
            {standing.map((k) => <Tag key={k.id} tone="danger" size="xs">{k.name}</Tag>)}
          </div>
        )}
      </div>

      {/* who is in the section */}
      <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-ink">{t('academics.board.sheet.list', { count: kids.length })}</p>
          <span className="text-[11px] text-ink-faint">{t('academics.board.sheet.seatsLeft', { count: Math.max(0, capacity - kids.length) })}</span>
        </div>
        <ul className="max-h-[560px] divide-y divide-border overflow-y-auto scroll-thin">
          {kids.map((k) => {
            const mark = marks.get(k.id)
            const st = TONE[SEAT_TONE[k.gender] ?? 'neutral']
            return (
              <li key={k.id}>
                <button type="button" onClick={() => navigate(`/students/profile/${k.id}`)} className="flex w-full items-center gap-2.5 px-4 py-2 text-start hover:bg-bg">
                  <span className="w-6 shrink-0 text-end text-[11px] text-ink-faint tabular-nums">{k.rollNo ?? '—'}</span>
                  <Avatar name={k.name} size={26} soft />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-medium text-ink">{k.name}</span>
                    <span className="block truncate text-[11px] text-ink-faint font-mono-num">{k.admissionNo}</span>
                  </span>
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', st.dot)} title={k.gender ?? ''} />
                  {mark && <Tag size="xs" tone={MARK_TONE[mark]}>{t(`academics.board.sheet.mark.${mark}`)}</Tag>}
                </button>
              </li>
            )
          })}
          {!kids.length && <li className="px-4 py-6 text-center text-sm text-ink-faint">{t('academics.board.noStudents')}</li>}
        </ul>
      </div>
    </div>
    </div>
  )
}

/** A small drawing of a seating layout (for the section form): every seat with its number, benches boxed. */
export function SeatingPreview({ seating, className }) {
  const { t } = useTranslation('academics')
  const plan = seatPlan(seating)
  return (
    <div className={clsx('rounded-xl border border-border bg-bg/60 p-3', className)}>
      <div className="mx-auto mb-2 h-1.5 w-1/2 rounded-full bg-ink/40" title={t('academics.board.sheet.board')} />
      <div className="flex max-h-72 flex-col gap-1 overflow-auto scroll-thin">
        {plan.rows.map((row, r) => (
          <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${plan.columns}, minmax(0, 1fr))` }}>
            {row.map((bench, c) => (
              <div key={c} className={clsx('flex gap-0.5', plan.kind === 'BENCH' && 'rounded-md bg-surface p-0.5 ring-1 ring-border')}>
                {bench.map((seat) => (
                  <span key={seat.label} className="flex h-5 min-w-0 flex-1 items-center justify-center rounded-[4px] border border-success-200 bg-success-50 text-[8.5px] font-medium text-success-700 tabular-nums">{seat.label}</span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The class picked in the side list: a tab per section, and in each the seating sheet with its figures. */
function ClassSections({ cls, extras, board, year, onEditSection }) {
  const { t } = useTranslation('academics')
  const navigate = useNavigate()
  const [tab, setTab] = useState(cls.sections[0]?.id ?? '')
  const section = cls.sections.find((x) => x.id === tab) ?? cls.sections[0]
  if (!section) return <EmptyState icon={Layers} title={t('academics.classes.noSections')} />
  const extra = extras.get(section.id)
  const capacity = section.capacity || 0
  const free = capacity ? Math.max(0, capacity - section.studentCount) : null
  const g = extra?.genders ?? {}
  const att = extra?.attendance
  const tone = TONE[hueTone(cls.id)]
  return (
    <section className="rounded-xl border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <span className={clsx('flex h-9 w-9 items-center justify-center rounded-xl border text-[11px] font-bold font-mono-num', tone.bg, tone.text, tone.border)}>{(cls.code || cls.name).slice(0, 3)}</span>
        <div className="min-w-0">
          <h2 className="font-display font-semibold text-ink">{cls.name}</h2>
          <p className="text-xs text-ink-faint">{t('academics.board.classLine', { students: t('academics.board.students', { count: cls.sections.reduce((n, x) => n + x.studentCount, 0) }), sections: t('academics.board.sectionsN', { count: cls.sections.length }) })}</p>
        </div>
        {cls.sections.length > 1 && <Button className="ms-auto" size="sm" variant="ghost" icon={Tags} onClick={() => printDocuments('SEAT_LABEL', cls.sections.map((x) => x.id), { preparing: t('academics.board.sheet.preparingLabels') })}>{t('academics.board.sheet.printClassLabels', { count: cls.sections.length })}</Button>}
      </header>
      <Tabs className="mt-2 px-2" value={section.id} onChange={setTab} tabs={cls.sections.map((x) => ({ value: x.id, label: `${x.short ?? x.name} · ${x.studentCount}` }))} />
      <div className="space-y-4 p-4">
        <StatCardRow items={[
          { icon: Users, tone: 'brand', label: t('academics.board.sheet.students'), value: capacity ? `${section.studentCount} / ${capacity}` : section.studentCount,
            progress: capacity ? (section.studentCount / capacity) * 100 : undefined },
          { icon: Armchair, tone: free === 0 ? 'danger' : 'success', label: t('academics.board.sheet.free'), value: free ?? '—',
            sub: free == null ? t('academics.board.sheet.noCapacity') : free === 0 ? t('academics.board.sheet.full') : t('academics.board.sheet.freeSub', { count: capacity }) },
          { icon: UserRound, tone: 'violet', label: t('academics.board.sheet.genderShort'), value: `${g.MALE ?? 0} : ${g.FEMALE ?? 0}`,
            segments: [{ label: t('academics.board.sheet.boys'), value: g.MALE ?? 0, tone: 'info' }, { label: t('academics.board.sheet.girls'), value: g.FEMALE ?? 0, tone: 'pink' }] },
          { icon: CalendarCheck, tone: att?.taken ? 'success' : att ? 'warning' : 'sky', label: t('academics.board.sheet.today'),
            value: att?.taken ? (att.pct == null ? '✓' : `${Math.round(att.pct)}%`) : att ? '—' : '·',
            sub: att?.taken ? t('academics.board.taken') : att ? t('academics.board.notTaken') : (extra?.holiday ? t('academics.board.holiday', { name: extra.holiday }) : t('academics.board.dayOff')) },
        ]} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-blue-200 bg-blue-50" />{t('academics.board.sheet.boys')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-pink-200 bg-pink-50" />{t('academics.board.sheet.girls')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-dashed border-success-300 bg-success-50/40" />{t('academics.board.sheet.freeSeatLegend')}</span>
          {att?.taken && ['P', 'A', 'L', 'LV'].map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={clsx('h-2.5 w-2.5 rounded-full', DOT[k])} />{t(`academics.board.sheet.mark.${k}`)}</span>)}
          <span className="ms-auto flex flex-wrap gap-2">
            {section.active && (hasPermission('attendance.mark.create') || hasPermission('attendance.mark.view')) && <Button size="sm" icon={CalendarCheck} onClick={() => navigate(`/attendance/mark?sectionId=${section.id}`)}>{att && !att.taken ? t('academics.board.markAttendance') : t('academics.board.openAttendance')}</Button>}
            {hasPermission('timetable.timetable.view') && <Button size="sm" variant="secondary" icon={CalendarDays} onClick={() => navigate(`/timetable/timetable?sectionId=${section.id}`)}>{t('academics.board.timetable')}</Button>}
            <Button size="sm" variant="secondary" icon={Printer} onClick={() => printDocuments('SEAT_LABEL', [section.id], { preparing: t('academics.board.sheet.preparingLabels') })}>{t('academics.board.sheet.printLabels')}</Button>
            {hasPermission('academics.classes.edit') && onEditSection && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEditSection(cls, section)}>{t('academics.board.editSection')}</Button>}
          </span>
        </div>
        <SeatingSheet key={section.id} section={section} cls={cls} extra={extra} board={board} year={year} />
      </div>
    </section>
  )
}

export default function ClassBoard({ classes, year, loading, emptyAction, onEditSection, onOpenClass }) {
  const { t } = useTranslation('academics')
  const [onlyPending, setOnlyPending] = useState(false)
  const [pick, setPick] = useState('') // the class picked in the side list ('' = every class)
  const [open, setOpen] = useState(null) // { classId, sectionId }
  const { data: board, isLoading } = useQuery({ queryKey: ['academic-board', year?.id], queryFn: () => fetchClassBoard(year?.id), enabled: !!year?.id, refetchInterval: 60_000 })
  const extras = useMemo(() => new Map((board?.sections ?? []).map((s) => [s.id, s])), [board])
  const pendingCount = useMemo(() => classes.reduce((n, c) => n + c.sections.filter((s) => extras.get(s.id)?.attendance && !extras.get(s.id).attendance.taken).length, 0), [classes, extras])
  const anyDue = useMemo(() => [...extras.values()].some((s) => s.attendance), [extras])
  const visible = classes
    .filter((c) => !pick || c.id === pick)
    .map((c) => ({ cls: c, sections: onlyPending ? c.sections.filter((s) => extras.get(s.id)?.attendance && !extras.get(s.id).attendance.taken) : c.sections }))
    .filter((x) => !onlyPending || x.sections.length)
  const pickedCls = pick ? classes.find((c) => c.id === pick) : null
  const openCls = open && classes.find((c) => c.id === open.classId)
  const openSec = openCls?.sections.find((s) => s.id === open.sectionId)
  const canEdit = hasPermission('academics.classes.edit')

  const studentsOf = (c) => c.sections.reduce((n, x) => n + (x.studentCount ?? 0), 0)
  const seatsOf = (c) => (c.sections.every((x) => x.capacity) ? c.sections.reduce((n, x) => n + x.capacity, 0) : 0)
  const pendingOf = (c) => c.sections.filter((x) => extras.get(x.id)?.attendance && !extras.get(x.id).attendance.taken).length
  const navItems = [
    { id: '', label: t('academics.board.allClasses'), icon: Layers, count: classes.reduce((n, c) => n + studentsOf(c), 0) },
    ...classes.map((c) => {
      const pending = pendingOf(c)
      const seats = seatsOf(c)
      return {
        id: c.id, label: c.name,
        hint: [t('academics.board.sectionsN', { count: c.sections.length }), pending ? t('academics.board.navPending', { count: pending }) : null].filter(Boolean).join(' · '),
        count: studentsOf(c), countTone: pending ? 'warning' : undefined,
        progress: seats ? { value: studentsOf(c), max: seats, warnPct: 90 } : undefined,
      }
    }),
  ]

  if (loading) {
    return <div className="rounded-xl border border-border bg-surface shadow-card p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[150px] rounded-xl" />)}</div>
  }

  return (
    <SideNavLayout nav={classes.length > 1 && <SideNav title={t('academics.board.navTitle')} value={pick} onChange={(id) => { setPick(id); setOpen(null) }} items={navItems} />}>
      {pickedCls ? <ClassSections key={pickedCls.id} cls={pickedCls} extras={extras} board={board} year={year} onEditSection={onEditSection} /> : <>
      <Legend onlyPending={onlyPending} onOnlyPending={setOnlyPending} showFilter={anyDue} />
      {board && !isLoading && !anyDue && (board.holiday || !board.inYear || !board.workingDay) && classes.some((c) => c.sections.length) && (
        <Note icon={CalendarOff}>{board.holiday ? t('academics.board.holiday', { name: board.holiday }) : !board.inYear ? t('academics.board.outsideYear') : t('academics.board.dayOff')}</Note>
      )}
      {anyDue && !onlyPending && pendingCount > 0 && <p className="text-sm text-ink-muted">{t('academics.board.pendingCount', { count: pendingCount })}</p>}
      {onlyPending && !visible.length ? (
        <EmptyState icon={CalendarCheck} title={t('academics.board.allTaken')} />
      ) : visible.map(({ cls, sections }) => (
        <ClassCard key={cls.id} cls={cls} sections={sections} extras={extras} openId={open?.sectionId}
          onOpenSection={(sectionId) => setOpen({ classId: cls.id, sectionId })} onOpenClass={() => onOpenClass?.(cls)} />
      ))}
      {!classes.length && <EmptyState icon={Layers} title={t('academics.classes.emptyTitle')} hint={t('academics.classes.emptyHint')} action={emptyAction} />}
      </>}
      {openSec && (
        <SectionDrawer section={openSec} cls={openCls} extra={extras.get(openSec.id)} board={board} year={year} onClose={() => setOpen(null)}
          onEdit={canEdit && onEditSection ? () => { onEditSection(openCls, openSec); setOpen(null) } : undefined} />
      )}
    </SideNavLayout>
  )
}
