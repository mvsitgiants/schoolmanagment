import { useMemo } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { BedDouble, Building2, LogOut, Snowflake } from 'lucide-react'
import { BED_STATES, BLOCK_KINDS, OUTPASS_STATUS } from '@schoolgiant/shared'
import { FormField, Select, SideNav, StatusPill, Tag } from '../system'

/** Labels for the hostel lists (shared values → this namespace's text). */
export function useHostelLabels() {
  const { t } = useTranslation('hostel')
  return {
    kind: (v) => t(`hostel.blockKinds.${v}`),
    roomType: (v) => t(`hostel.roomTypes.${v}`),
    bed: (v) => t(`hostel.bedStates.${v}`),
    outpass: (v) => t(`hostel.outpassStatus.${v}`),
    outpassKind: (v) => t(`hostel.outpassKinds.${v}`),
    reason: (v) => t(`hostel.checkoutReasons.${v}`),
    meal: (v) => t(`hostel.meals.${v}`),
    day: (v) => t(`hostel.days.${v}`),
    floor: (n) => (n === 0 ? t('hostel.board.ground') : t('hostel.board.floorN', { n })),
  }
}

export const blockTone = (kind) => BLOCK_KINDS.find((k) => k.value === kind)?.tone ?? 'neutral'

export function OutpassStatusPill({ status }) {
  const L = useHostelLabels()
  return <StatusPill tone={OUTPASS_STATUS[status]?.tone ?? 'neutral'}>{L.outpass(status)}</StatusPill>
}

export function BlockKindTag({ kind }) {
  const L = useHostelLabels()
  return <Tag size="xs" tone={blockTone(kind)}>{L.kind(kind)}</Tag>
}

const GLYPH_TONE = { OCCUPIED: 'text-brand-600', FREE: 'text-success-600', RESERVED: 'text-info-500', BLOCKED: 'text-ink-faint' }

/**
 * A small drawing of a bed that shows its state at a glance: occupied → a sleeper under a blanket; free → an empty
 * outline; reserved → a dashed mattress; blocked → greyed with a slash.
 */
export function BedGlyph({ state = 'FREE', size = 40, title, className }) {
  const filled = state === 'OCCUPIED'
  return (
    <svg viewBox="0 0 48 30" width={size} height={Math.round((size * 30) / 48)} role="img" aria-label={title} aria-hidden={title ? undefined : true}
      className={clsx('shrink-0', GLYPH_TONE[state] ?? GLYPH_TONE.FREE, className)}>
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 5v21M43.5 13v13M4.5 21.5h39M7.5 21.5v5M40.5 21.5v5" />
        <rect x="6.5" y="15.5" width="35" height="5" rx="1.6" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.25 : 0}
          strokeDasharray={state === 'RESERVED' ? '2.5 2' : undefined} />
        <rect x="8" y="11.5" width="7.5" height="4" rx="2" fill={filled ? 'currentColor' : 'none'} fillOpacity="0.35" />
      </g>
      {filled && (
        <g fill="currentColor">
          <circle cx="11.75" cy="8.6" r="3.1" />
          <path d="M16.5 15.5c0-3 2-5 5-5h16.2c2 0 3.3 1.4 3.3 3.2v1.8z" />
        </g>
      )}
      {state === 'BLOCKED' && <path d="M8 27L40 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  )
}

const TILE = {
  FREE: 'bg-success-50/40 border-success-200',
  OCCUPIED: 'bg-surface border-border',
  RESERVED: 'bg-info-50/50 border-info-200 border-dashed',
  BLOCKED: 'bg-black/[0.03] border-border',
}

/** One bed in a room card: the glyph, its label, and who sleeps there (or why it is held / blocked). */
export function BedChip({ bed, onClick, selected }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const s = bed.allotment?.student
  return (
    <button type="button" onClick={onClick} aria-label={t('hostel.board.bedAria', { code: bed.code, detail: s?.name ?? L.bed(bed.state) })}
      className={clsx('flex min-h-[64px] w-full items-center gap-2 rounded-lg border p-2 text-start transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400', TILE[bed.state], selected && 'ring-2 ring-brand-500')}>
      <BedGlyph state={bed.state} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="text-[11px] font-semibold text-ink-muted">{bed.label}</span>
          {bed.allotment?.out && <LogOut className="h-3 w-3 text-violet-500" aria-label={t('hostel.board.outNow')} />}
        </span>
        {s ? (
          <>
            <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">{s.name}</span>
            <span className="block truncate text-[10.5px] text-ink-faint">{[s.className, s.admissionNo].filter(Boolean).join(' · ')}</span>
          </>
        ) : (
          <>
            <span className={clsx('block text-xs font-medium', bed.state === 'FREE' ? 'text-success-700' : bed.state === 'RESERVED' ? 'text-info-600' : 'text-ink-muted')}>{L.bed(bed.state)}</span>
            {bed.note && <span className="block truncate text-[10.5px] text-ink-faint">{bed.note}</span>}
          </>
        )}
      </span>
    </button>
  )
}

/** A room as a card: number, type, AC, an occupancy bar, and its beds. */
export function RoomCard({ room, onBed, onRoom, selectedBed }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const occ = room.beds.filter((b) => b.state === 'OCCUPIED').length
  const usable = room.beds.filter((b) => b.state !== 'BLOCKED').length
  const pct = usable ? Math.round((occ / usable) * 100) : 0
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
      <header className="flex items-center gap-2">
        <button type="button" onClick={onRoom} disabled={!onRoom} className="font-display text-[15px] font-semibold text-ink hover:text-brand-700 disabled:hover:text-ink">{room.number}</button>
        <span className="truncate text-[11px] text-ink-faint">{L.roomType(room.type)}</span>
        {room.ac && <Snowflake className="h-3.5 w-3.5 text-sky-500" aria-label={t('hostel.board.ac')} />}
        <span className="ms-auto text-[11px] font-semibold tabular-nums text-ink-muted">{occ}/{room.beds.length}</span>
      </header>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-danger-500' : pct >= 75 ? 'bg-amber-400' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
        {room.beds.map((b) => <BedChip key={b.id} bed={b} selected={selectedBed === b.id} onClick={() => onBed?.(b, room)} />)}
      </div>
    </section>
  )
}

/** The blocks as the page's left list, each with its beds in use against its beds and a fill bar. */
export function BlockNav({ blocks = [], value, onChange, allLabel }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const total = blocks.reduce((n, b) => n + b.counts.total, 0)
  const occ = blocks.reduce((n, b) => n + b.counts.OCCUPIED, 0)
  return (
    <SideNav title={t('hostel.nav.blocks')} value={value} onChange={onChange} items={[
      ...(allLabel ? [{ id: '', label: allLabel, icon: Building2, count: `${occ}/${total}`, progress: { value: occ, max: total || 1 } }] : []),
      ...blocks.map((b) => ({
        id: b.id, label: b.name, icon: BedDouble,
        hint: [L.kind(b.kind), b.warden?.name].filter(Boolean).join(' · '),
        count: `${b.counts.OCCUPIED}/${b.counts.total}`,
        progress: { value: b.counts.OCCUPIED, max: Math.max(1, b.counts.total - b.counts.BLOCKED) },
      })),
    ]} />
  )
}

/** Pick a free (or reserved) bed: block, then the free beds of that block by room. */
export function BedPicker({ blocks = [], value, onChange, error, exclude }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const options = useMemo(() => blocks.map((b) => ({
    block: b,
    beds: b.rooms.flatMap((r) => r.beds.filter((x) => (x.state === 'FREE' || x.state === 'RESERVED') && x.id !== exclude).map((x) => ({ ...x, room: r }))),
  })).filter((g) => g.beds.length), [blocks, exclude])
  return (
    <FormField label={t('hostel.allot.bed')} required error={error} hint={!options.length ? t('hostel.allot.noFreeBeds') : undefined}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('hostel.allot.pickBed')}</option>
        {options.map((g) => (
          <optgroup key={g.block.id} label={`${g.block.name} · ${L.kind(g.block.kind)}`}>
            {g.beds.map((x) => (
              <option key={x.id} value={x.id}>
                {[x.code, L.floor(x.room.floor), L.roomType(x.room.type), x.room.ac && t('hostel.board.ac'), x.state === 'RESERVED' && `${L.bed('RESERVED')}: ${x.note ?? ''}`].filter(Boolean).join(' · ')}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </FormField>
  )
}

/** The legend for the bed board. */
export function BedLegend({ className }) {
  const L = useHostelLabels()
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted', className)}>
      {Object.keys(BED_STATES).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><BedGlyph state={k} size={22} />{L.bed(k)}</span>)}
    </div>
  )
}
