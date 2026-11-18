import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Bike, Car, CarFront, Search, X } from 'lucide-react'
import { Input } from '../system'
import { findParkingPeople } from '../../api/parking'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { printQrCards } from '../scan/printPoster'

/** The words for kinds, owners, areas and pass states, in the user's language. */
export function useParkingLabels() {
  const { t } = useTranslation('parking')
  return useMemo(() => ({
    kind: (v) => t(`parking.kind.${v}`, v ?? ''),
    owner: (v) => t(`parking.owner.${v}`, v ?? ''),
    areaFor: (v) => t(`parking.areaFor.${v}`, v ?? ''),
    state: (v) => t(`parking.state.${v}`, v ?? ''),
  }), [t])
}

/** How long a vehicle stayed: "40 min", "2 h 10 min". */
export function useStay() {
  const { t } = useTranslation('parking')
  return (m) => (m < 60 ? t('parking.time.min', { count: m }) : m % 60 ? t('parking.time.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('parking.time.h', { count: m / 60 }))
}

export const STATE_TONE = { ACTIVE: 'success', EXPIRED: 'warning', REVOKED: 'neutral' }

/** A small picture for the kind of vehicle. */
export function KindIcon({ kind, className = 'h-4 w-4' }) {
  const Icon = kind === 'CAR' ? Car : kind === 'CYCLE' ? Bike : kind === 'TWO_WHEELER' ? Bike : CarFront
  return <Icon className={clsx(className, kind === 'TWO_WHEELER' && 'text-brand-700')} aria-hidden />
}

/** A number plate, drawn like one. */
export function Plate({ plate, size = 'md' }) {
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-md border-2 border-ink/80 bg-white font-mono font-bold tracking-wider text-ink',
      size === 'lg' ? 'px-3 py-1 text-xl' : 'px-1.5 py-0.5 text-xs')}>{plate}</span>
  )
}

/** One area's fill: name, who it is for, and a bar — calm until it is nearly or fully used. */
export function AreaFill({ area, onClick, active }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const tone = area.full ? 'bg-danger-500' : area.pct >= 85 ? 'bg-amber-500' : 'bg-brand-500'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={clsx('rounded-xl border bg-surface p-3 text-start', active ? 'border-brand-400 ring-2 ring-brand-500/20' : area.full ? 'border-danger-200' : 'border-border', onClick && 'hover:border-brand-300')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{area.name}</p>
          <p className="text-xs text-ink-muted">{L.areaFor(area.for)}{area.kinds?.length ? ` · ${area.kinds.map(L.kind).join(', ')}` : ''}</p>
        </div>
        <p className="shrink-0 text-end">
          <span className="text-lg font-semibold tabular-nums text-ink">{area.inside}</span>
          {area.capacity > 0 && <span className="text-sm text-ink-muted tabular-nums"> / {area.capacity}</span>}
        </p>
      </div>
      {area.capacity > 0 ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[0.06]"><div className={clsx('h-full rounded-full', tone)} style={{ width: `${area.pct}%` }} /></div>
          <p className={clsx('mt-1 text-xs', area.full ? 'font-medium text-danger-600' : 'text-ink-muted')}>{area.full ? t('parking.area.full') : t('parking.area.free', { count: area.free })}</p>
        </>
      ) : <p className="mt-2 text-xs text-ink-muted">{t('parking.area.noLimit')}</p>}
    </Tag>
  )
}

/**
 * A student or member of staff found by typing a name, admission number or staff code. `value`: the picked person
 * ({ id, name, sub }) or null.
 */
export function PeoplePicker({ kind, value, onChange, error, autoFocus }) {
  const { t } = useTranslation('parking')
  const [text, setText] = useState('')
  const q = useDebouncedValue(text.trim(), 250)
  const { data = [], isFetching } = useQuery({ queryKey: ['parking', 'people', kind, q], queryFn: () => findParkingPeople(kind, q), enabled: q.length >= 2 && !value })
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg/60 px-3 py-2">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{value.name}</p>{value.sub && <p className="truncate text-xs text-ink-muted">{value.sub}</p>}</div>
        <button type="button" onClick={() => { onChange(null); setText('') }} className="rounded p-1 text-ink-muted hover:bg-black/[0.05]" aria-label={t('parking.form.changePerson')}><X className="h-4 w-4" /></button>
      </div>
    )
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <Input className="ps-9" autoFocus={autoFocus} value={text} error={error} onChange={(e) => setText(e.target.value)} autoComplete="off" data-typein="off"
        placeholder={kind === 'STAFF' ? t('parking.form.findStaff') : t('parking.form.findStudent')} />
      {q.length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {!data.length ? <p className="px-3 py-2 text-sm text-ink-muted">{isFetching ? t('parking.form.searching') : t('parking.form.nobody')}</p> : data.map((p) => (
            <button key={p.id} type="button" onClick={() => onChange(p)} className="block w-full rounded-md px-3 py-2 text-start hover:bg-black/[0.04]">
              <span className="block text-sm font-medium text-ink">{p.name}</span>
              {p.sub && <span className="block text-xs text-ink-muted">{p.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Stickers for the windscreen or the mudguard: the pass number as a QR, the plate big, whose and till when. */
export function printParkingStickers(vehicles, { t, institution, date }) {
  return printQrCards({
    title: t('parking.sticker.title'),
    heading: institution ? `${institution} · ${t('parking.sticker.heading')}` : t('parking.sticker.heading'),
    items: vehicles.map((v) => ({
      code: v.passNo,
      label: v.plate,
      sub: [v.passNo, v.ownerName, v.areaName, t('parking.sticker.validTo', { date: date(v.validTo) })].filter(Boolean).join(' · '),
    })),
  })
}
