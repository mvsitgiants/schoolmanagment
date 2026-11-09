import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { DRIVE_STATUS, OFFER_STATUS, REGISTRATION_STATUS, ROUND_RESULTS, companyInitials, formatLpa } from '@schoolgiant/shared'
import { FormField, Input, Select, StatusPill, TONE, hueTone } from '../system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { findPlacementStudents, fetchPlacementsMeta } from '../../api/placements'

// Shared pieces of the Training & placements screens: the company "logo" (initials on its own colour), status pills,
// the labels, the CTC range, the drive funnel and the student finder.

export const usePlacementsMeta = () => useQuery({ queryKey: ['placements', 'meta'], queryFn: fetchPlacementsMeta, staleTime: 60_000 })

/** The company's initials on a tile coloured from its name — the same colour on every screen. */
export function CompanyLogo({ name, size = 40, className }) {
  const t = TONE[hueTone(name)]
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center rounded-xl border font-display font-semibold', t.bg, t.text, t.border, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden>
      {companyInitials(name)}
    </span>
  )
}

/** Label helpers, all from the placements namespace. */
export function usePlacementLabels() {
  const { t } = useTranslation('placements')
  return {
    sector: (v) => (v ? t(`placements.sectors.${v}`) : '—'),
    drive: (v) => t(`placements.driveStatus.${v}`),
    offer: (v) => t(`placements.offerStatus.${v}`),
    reg: (v) => t(`placements.regStatus.${v}`),
    round: (v) => t(`placements.roundKinds.${v}`),
    result: (v) => t(`placements.roundResults.${v}`),
    mode: (v) => t(`placements.modes.${v}`),
    reason: (v) => t(`placements.reasons.${v}`),
    window: (v) => t(`placements.window.${v}`),
  }
}

export function DriveStatusPill({ status }) {
  const L = usePlacementLabels()
  return <StatusPill tone={DRIVE_STATUS[status]?.tone ?? 'neutral'}>{L.drive(status)}</StatusPill>
}
export function OfferStatusPill({ status }) {
  const L = usePlacementLabels()
  return <StatusPill tone={OFFER_STATUS[status]?.tone ?? 'neutral'}>{L.offer(status)}</StatusPill>
}
export function RegStatusPill({ status }) {
  const L = usePlacementLabels()
  return <StatusPill tone={REGISTRATION_STATUS[status]?.tone ?? 'neutral'}>{L.reg(status)}</StatusPill>
}

/** A round's result as a small coloured square with marks (or a dash when not entered yet). */
export function ResultChip({ result, marks }) {
  const L = usePlacementLabels()
  const tone = TONE[ROUND_RESULTS[result]?.tone ?? 'neutral']
  return (
    <span title={result ? L.result(result) : undefined}
      className={clsx('inline-flex min-w-[42px] items-center justify-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums', result ? [tone.bg, tone.text, tone.border] : 'border-dashed border-border text-ink-faint')}>
      {marks != null ? marks : result ? L.result(result).slice(0, 1) : '—'}
    </span>
  )
}

/** "6 – 8 LPA", "8 LPA" or "—". */
export function ctcRange(min, max) {
  if (min && max && min !== max) return `${formatLpa(min).replace(' LPA', '')} – ${formatLpa(max)}`
  return formatLpa(max || min)
}

/** The CTC as a chip (green at the dream figure and above). */
export function CtcChip({ value, dream }) {
  const tone = TONE[dream && value >= dream ? 'success' : 'brand']
  return <span className={clsx('inline-flex items-center rounded-lg border px-2 py-0.5 text-[12px] font-semibold tabular-nums', tone.bg, tone.text, tone.border)}>{formatLpa(value)}</span>
}

/** The drive funnel: one bar per step, as wide as the share of those registered still in. */
export function Funnel({ steps = [] }) {
  const { t } = useTranslation('placements')
  const top = Math.max(1, steps[0]?.count ?? 0)
  const tones = ['info', 'violet', 'sky', 'orange', 'pink', 'teal']
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const last = s.key === 'SELECTED' || s.key === 'ACCEPTED'
        const tone = TONE[s.key === 'ACCEPTED' ? 'success' : s.key === 'SELECTED' ? 'brand' : tones[i % tones.length]]
        const pct = Math.round(((s.count ?? 0) / top) * 100)
        const label = s.key === 'REGISTERED' ? t('placements.funnel.registered') : s.key === 'SELECTED' ? t('placements.funnel.selected') : s.key === 'ACCEPTED' ? t('placements.funnel.accepted') : s.label
        return (
          <li key={s.key} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3">
            <span className={clsx('truncate text-[13px]', last ? 'font-semibold text-ink' : 'text-ink-muted')}>{label}</span>
            <span className="h-6 overflow-hidden rounded-md bg-black/[0.04]">
              <span className={clsx('flex h-full items-center rounded-md px-2 text-[11px] font-semibold text-white transition-all duration-500', tone.fill)} style={{ width: `${Math.max(pct, s.count ? 6 : 0)}%` }}>
                {pct >= 18 && `${pct}%`}
              </span>
            </span>
            <span className="w-10 text-right text-sm font-semibold tabular-nums text-ink">{s.count}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Find a student (name, admission or register number) and pick one. */
export function StudentFinder({ value, onPick, error }) {
  const { t } = useTranslation('placements')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found = [] } = useQuery({ queryKey: ['placements', 'students', q], queryFn: () => findPlacementStudents(q), enabled: q.length >= 2 })
  const options = [...(value ? [value] : []), ...found.filter((s) => s.id !== value?.id)]
  return (
    <>
      <FormField label={t('placements.finder.find')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('placements.finder.placeholder')} /></FormField>
      <FormField label={t('placements.finder.student')} required error={error}>
        <Select value={value?.id ?? ''} onChange={(e) => onPick(options.find((s) => s.id === e.target.value) ?? null)}>
          <option value="">{q.length >= 2 || value ? t('placements.finder.pick') : t('placements.finder.typeFirst')}</option>
          {options.map((s) => <option key={s.id} value={s.id}>{[s.name, s.program ?? s.classShort, s.admissionNo].filter(Boolean).join(' · ')}</option>)}
        </Select>
      </FormField>
    </>
  )
}

/** Rupees-in-lakhs input helpers: the API takes paise a year. */
export const lakhsToPaise = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 100000 * 100))
export const paiseToLakhs = (v) => (v == null ? '' : String(Math.round((v / 100 / 100000) * 100) / 100))
