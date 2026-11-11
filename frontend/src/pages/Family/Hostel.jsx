import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BedDouble, Phone, Plus, Snowflake, Ticket, Utensils } from 'lucide-react'
import { OUTPASS_KINDS, OUTPASS_STATUS } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Select, StatusPill, Textarea, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCancelOutpass, familyHostel, familyRequestOutpass } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

function OutpassRequest({ onDone }) {
  const { t } = useTranslation('hostel')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const today = localIso(new Date())
  const [form, setForm] = useState({ kind: 'HOME', leaveDate: today, leaveTime: '16:00', returnDate: today, returnTime: '18:00', reason: '', destination: '' })
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'leaveDate' && f.returnDate < e.target.value && { returnDate: e.target.value }) }))
  const save = useMutation({
    mutationFn: () => familyRequestOutpass(slug, studentId, form),
    onSuccess: (d) => { qc.setQueryData(['family', slug, studentId, 'hostel'], d); onDone() },
    onError: (e) => setError(e.message),
  })
  return (
    <div className="space-y-3">
      <FormField label={t('hostel.family.kind')}><Select value={form.kind} onChange={set('kind')}>{OUTPASS_KINDS.map((k) => <option key={k.value} value={k.value}>{t(`hostel.outpassKinds.${k.value}`)}</option>)}</Select></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('hostel.family.leaveOn')}><DateInput value={form.leaveDate} min={today} onChange={set('leaveDate')} /></FormField>
        <FormField label={t('hostel.family.at')}><Input type="time" value={form.leaveTime} onChange={set('leaveTime')} /></FormField>
        <FormField label={t('hostel.family.backOn')}><DateInput value={form.returnDate} min={form.leaveDate} onChange={set('returnDate')} /></FormField>
        <FormField label={t('hostel.family.at')}><Input type="time" value={form.returnTime} onChange={set('returnTime')} /></FormField>
      </div>
      <FormField label={t('hostel.family.destination')}><Input value={form.destination} maxLength={200} onChange={set('destination')} /></FormField>
      <FormField label={t('hostel.family.reason')} error={error}><Textarea rows={2} value={form.reason} maxLength={300} onChange={set('reason')} placeholder={t('hostel.family.reasonPlaceholder')} /></FormField>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>{t('actions.cancel')}</Button>
        <Button className="flex-1" loading={save.isPending} disabled={form.reason.trim().length < 3} onClick={() => save.mutate()}>{t('hostel.family.send')}</Button>
      </div>
      <p className="text-xs text-ink-muted">{t('hostel.family.hint')}</p>
    </div>
  )
}

/** The family app › Hostel: the child's room and bed, the warden, today's menu, and outpasses (ask for one, see where it is). */
export default function FamilyHostel() {
  const { t } = useTranslation('hostel')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date, time } = useFormat()
  const [asking, setAsking] = useState(false)
  const { data: d, isLoading, error } = useFamilyQuery(['hostel'], () => familyHostel(slug, studentId))
  const withdraw = useMutation({ mutationFn: (id) => familyCancelOutpass(slug, studentId, id), onSuccess: (x) => qc.setQueryData(['family', slug, studentId, 'hostel'], x) })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!d.resident && !d.outpasses.length) return <FCard><FEmpty icon={BedDouble} title={t('hostel.family.none')} hint={t('hostel.family.noneHint')} /></FCard>
  return (
    <>
      {d.resident && (
        <FCard title={t('hostel.family.room')}>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><BedDouble className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-semibold text-ink">{d.stay.code}</p>
              <p className="text-sm text-ink-muted">{[d.stay.block, t('hostel.family.roomBed', { room: d.stay.room, bed: d.stay.bed })].join(' · ')}</p>
              <p className="text-xs text-ink-faint">{t('hostel.family.since', { date: date(d.stay.from) })}</p>
            </div>
            {d.stay.ac && <Snowflake className="h-5 w-5 text-sky-500" aria-label={t('hostel.board.ac')} />}
          </div>
          {d.warden && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="text-ink">{t('hostel.family.warden', { name: d.warden.name })}</span>
              {d.warden.mobile && <a href={`tel:${d.warden.mobile}`} className="inline-flex min-h-[44px] items-center gap-1 text-brand-700"><Phone className="h-4 w-4" />{t('hostel.family.call')}</a>}
            </div>
          )}
        </FCard>
      )}
      {d.resident && d.menuToday?.length > 0 && (
        <FCard title={t('hostel.family.menuToday')}>
          <div className="divide-y divide-border">
            {d.menuToday.map((m) => (
              <div key={m.meal} className="flex items-start gap-3 py-2">
                <Utensils className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{t(`hostel.meals.${m.meal}`)} <span className="text-xs font-normal text-ink-faint tabular-nums">{m.time}</span></p>
                  <p className="text-sm text-ink-muted break-words">{m.dishes}</p>
                </div>
              </div>
            ))}
          </div>
        </FCard>
      )}
      <FCard title={t('hostel.family.outpasses')} action={d.canRequest && !asking && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAsking(true)}>{t('hostel.family.ask')}</Button>}>
        {asking && <div className="mb-4"><OutpassRequest onDone={() => setAsking(false)} /></div>}
        {d.outpasses.length ? (
          <div className="-my-2 divide-y divide-border">
            {d.outpasses.map((o) => (
              <div key={o.id} className="flex items-start gap-3 py-3">
                <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-ink">{date(o.leaveDate)} {o.leaveTime} → {date(o.returnDate)} {o.returnTime}</p>
                  <p className="text-sm text-ink-muted break-words">{t(`hostel.outpassKinds.${o.kind}`)} · {o.reason}</p>
                  {o.outAt && <p className="text-xs text-ink-faint">{t('hostel.family.leftAt', { time: time(o.outAt) })}{o.inAt ? ` · ${t('hostel.family.backAt', { time: time(o.inAt) })}` : ''}</p>}
                  {o.decisionNote && <p className="mt-0.5 text-xs text-ink-faint">{o.decisionNote}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusPill tone={o.late ? 'danger' : OUTPASS_STATUS[o.status]?.tone}>{o.late ? t('hostel.family.late', { min: o.lateMinutes }) : t(`hostel.outpassStatus.${o.status}`)}</StatusPill>
                  {o.status === 'REQUESTED' && o.byFamily && <button type="button" className="min-h-[32px] text-xs text-brand-600 hover:underline" onClick={() => withdraw.mutate(o.id)}>{t('hostel.family.withdraw')}</button>}
                </div>
              </div>
            ))}
          </div>
        ) : !asking && <FEmpty icon={Ticket} title={t('hostel.family.noPasses')} />}
      </FCard>
    </>
  )
}
