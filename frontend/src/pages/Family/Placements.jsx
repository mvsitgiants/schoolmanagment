import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BadgeCheck, Briefcase, CalendarDays, CheckCircle2, CircleDashed, MapPin, Trophy, XCircle } from 'lucide-react'
import { formatLpa } from '@schoolgiant/shared'
import { StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { CompanyLogo, ctcRange } from '../../components/placements/PlacementsKit'
import { familyPlacementRegister, familyPlacementWithdraw, familyPlacements } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const RESULT_ICON = { PASS: [CheckCircle2, 'text-emerald-600'], FAIL: [XCircle, 'text-rose-600'], ABSENT: [XCircle, 'text-amber-600'] }

function Drive({ d, canRegister, onRegister, onWithdraw, busy }) {
  const { t } = useTranslation('placements')
  const { date } = useFormat()
  const [marks, setMarks] = useState({ tenthPct: '', twelfthPct: '' })
  const reg = d.registration
  const needs = d.pending ?? []
  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <CompanyLogo name={d.company?.name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{d.company?.name}</p>
          <p className="text-xs text-ink-muted">{[d.title, d.roles.join(', ')].filter(Boolean).join(' · ')}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Trophy className="h-3.5 w-3.5" />{ctcRange(d.ctcMin, d.ctcMax)}</span>
            {d.startDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{date(d.startDate)}</span>}
            {d.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{d.location}</span>}
          </div>
        </div>
        {reg ? <StatusPill tone={reg.status === 'SELECTED' ? 'success' : reg.status === 'REJECTED' ? 'neutral' : 'info'}>{t(`placements.family.reg.${reg.status}`)}</StatusPill>
          : d.window === 'OPEN' ? <StatusPill tone={d.eligible ? 'success' : 'neutral'}>{d.eligible ? t('placements.family.eligible') : t('placements.family.notEligible')}</StatusPill> : null}
      </div>
      {reg ? (
        reg.rounds.length > 0 && (
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {reg.rounds.map((r, i) => {
              const [Icon, cls] = RESULT_ICON[r.result] ?? [CircleDashed, 'text-ink-faint']
              return <li key={i} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-ink"><Icon className={clsx('h-3.5 w-3.5', cls)} />{r.name}{r.date && <span className="text-ink-faint"> · {date(r.date)}</span>}</li>
            })}
          </ol>
        )
      ) : d.window === 'OPEN' && (
        <div className="mt-2 space-y-2">
          {(d.criteria.minCgpa != null || d.criteria.maxBacklogs != null) && (
            <p className="text-xs text-ink-muted">{[d.criteria.minCgpa != null && t('placements.details.minCgpa', { v: d.criteria.minCgpa }), d.criteria.maxBacklogs != null && t('placements.details.maxBacklogs', { v: d.criteria.maxBacklogs })].filter(Boolean).join(' · ')}</p>
          )}
          {d.closesOn && <p className="text-xs text-ink-muted">{t('placements.family.closesOn', { date: date(d.closesOn) })}</p>}
          {!d.eligible && d.reasons.length > 0 && <p className="text-xs text-rose-600">{d.reasons.map((r) => t(`placements.reasons.${r.code}`)).join(' · ')}</p>}
          {d.eligible && canRegister && (
            <>
              {needs.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {needs.includes('tenthPct') && <label className="text-xs text-ink-muted">{t('placements.family.tenth', { min: d.criteria.min10th })}<input type="number" min="0" max="100" inputMode="decimal" value={marks.tenthPct} onChange={(e) => setMarks((m) => ({ ...m, tenthPct: e.target.value }))} className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink" /></label>}
                  {needs.includes('twelfthPct') && <label className="text-xs text-ink-muted">{t('placements.family.twelfth', { min: d.criteria.min12th })}<input type="number" min="0" max="100" inputMode="decimal" value={marks.twelfthPct} onChange={(e) => setMarks((m) => ({ ...m, twelfthPct: e.target.value }))} className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink" /></label>}
                </div>
              )}
              <Button className="w-full" icon={BadgeCheck} loading={busy} disabled={needs.some((k) => marks[k] === '')}
                onClick={() => onRegister(d.id, { tenthPct: marks.tenthPct === '' ? undefined : Number(marks.tenthPct), twelfthPct: marks.twelfthPct === '' ? undefined : Number(marks.twelfthPct) })}>{t('placements.family.register')}</Button>
            </>
          )}
        </div>
      )}
      {reg?.status === 'REGISTERED' && !reg.rounds.some((r) => r.result) && d.window === 'OPEN' && canRegister && (
        <button type="button" disabled={busy} onClick={() => onWithdraw(d.id)} className="mt-2 min-h-[44px] text-sm text-ink-muted underline">{t('placements.family.withdraw')}</button>
      )}
    </div>
  )
}

/** The family app › Placements: open drives the student may apply to, registering, progress through the rounds, and offers. */
export default function FamilyPlacements() {
  const { t } = useTranslation('placements')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const key = ['family', slug, studentId, 'placements']
  const { data: d, isLoading, error } = useFamilyQuery(['placements'], () => familyPlacements(slug, studentId))
  const register = useMutation({ mutationFn: ({ driveId, body }) => familyPlacementRegister(slug, studentId, driveId, body), onSuccess: (x) => { qc.setQueryData(key, x); showSuccess(t('placements.family.registered')) }, onError: (e) => showError(e.message) })
  const withdraw = useMutation({ mutationFn: (driveId) => familyPlacementWithdraw(slug, studentId, driveId), onSuccess: (x) => qc.setQueryData(key, x), onError: (e) => showError(e.message) })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const open = d.drives.filter((x) => !x.registration && x.window === 'OPEN')
  const mine = d.drives.filter((x) => x.registration)
  const busy = register.isPending || withdraw.isPending
  return (
    <>
      <FCard>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-black/[0.03] py-2"><p className="text-lg font-semibold tabular-nums text-ink">{d.profile.cgpa ?? '—'}</p><p className="text-[11px] text-ink-muted">CGPA</p></div>
          <div className="rounded-xl bg-black/[0.03] py-2"><p className="text-lg font-semibold tabular-nums text-ink">{d.profile.backlogs ?? '—'}</p><p className="text-[11px] text-ink-muted">{t('placements.family.backlogs')}</p></div>
          <div className="rounded-xl bg-black/[0.03] py-2"><p className="text-lg font-semibold tabular-nums text-ink">{d.offers.filter((o) => ['OFFERED', 'ACCEPTED'].includes(o.status)).length}</p><p className="text-[11px] text-ink-muted">{t('placements.family.offers')}</p></div>
        </div>
        {d.profile.program && <p className="mt-2 text-center text-xs text-ink-muted">{[d.profile.program, d.profile.batch].filter(Boolean).join(' · ')}</p>}
      </FCard>
      {d.offers.length > 0 && (
        <FCard title={t('placements.family.yourOffers')}>
          <div className="divide-y divide-border">
            {d.offers.map((o) => (
              <div key={o.id} className="flex items-center gap-3 py-2">
                <CompanyLogo name={o.company} size={36} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{o.company}</p><p className="text-xs text-ink-muted">{[o.role, o.joiningDate && t('placements.family.joining', { date: date(o.joiningDate) })].filter(Boolean).join(' · ')}</p></div>
                <span className="text-right"><span className="block text-sm font-semibold text-emerald-700">{formatLpa(o.ctc)}</span><span className="text-[11px] text-ink-muted">{t(`placements.offerStatus.${o.status}`)}</span></span>
              </div>
            ))}
          </div>
        </FCard>
      )}
      <FCard title={t('placements.family.open')}>
        {!open.length ? <FEmpty icon={Briefcase} title={t('placements.family.noneOpen')} hint={!d.canRegister ? t('placements.family.officeRegisters') : undefined} />
          : <div className="divide-y divide-border">{open.map((x) => <Drive key={x.id} d={x} canRegister={d.canRegister} busy={busy} onRegister={(driveId, body) => register.mutate({ driveId, body })} onWithdraw={(driveId) => withdraw.mutate(driveId)} />)}</div>}
      </FCard>
      {mine.length > 0 && (
        <FCard title={t('placements.family.mine')}>
          <div className="divide-y divide-border">{mine.map((x) => <Drive key={x.id} d={x} canRegister={d.canRegister} busy={busy} onRegister={() => {}} onWithdraw={(driveId) => withdraw.mutate(driveId)} />)}</div>
        </FCard>
      )}
    </>
  )
}
