import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarOff, Plus } from 'lucide-react'
import { Calendar, DateInput, FormField, Input, StatusPill, Textarea, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyApplyLeave, familyAttendance, familyCancelLeave } from '../../api/family'
import { PickupCard, StudentCheckInCard } from '../../components/family/Passes'
import { useFormat } from '../../context/SettingsContext'

const DOT = { P: 'bg-brand-500', L: 'bg-amber-400', HD: 'bg-amber-400', A: 'bg-danger-500', LV: 'bg-black/30' }
const MARK_TONE = { P: 'accent', A: 'danger', L: 'warning', HD: 'warning', LV: 'neutral' }
const LEAVE_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' }

function LeaveForm({ onDone }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const today = localIso(new Date())
  const [form, setForm] = useState({ from: today, to: today, reason: '' })
  const [error, setError] = useState(null)
  const save = useMutation({
    mutationFn: () => familyApplyLeave(slug, studentId, form),
    onSuccess: (d) => { qc.setQueryData(['family', slug, studentId, 'attendance', d.month], d); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'attendance'] }); onDone() },
    onError: (e) => setError(e.message),
  })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('family.leave.from')}><DateInput value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to }))} /></FormField>
        <FormField label={t('family.leave.to')}><DateInput value={form.to} min={form.from} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} /></FormField>
      </div>
      <FormField label={t('family.leave.reason')} error={error}><Textarea rows={2} value={form.reason} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('family.leave.reasonPlaceholder')} /></FormField>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>{t('family.cancel')}</Button>
        <Button className="flex-1" loading={save.isPending} disabled={form.reason.trim().length < 3} onClick={() => save.mutate()}>{t('family.leave.send')}</Button>
      </div>
      <p className="text-xs text-ink-muted">{t('family.leave.hint')}</p>
    </div>
  )
}

export default function FamilyAttendance() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const [month, setMonth] = useState(() => localIso(new Date()).slice(0, 7))
  const [asking, setAsking] = useState(false)
  const { data: d, isLoading, error } = useFamilyQuery(['attendance', month], () => familyAttendance(slug, studentId, month))
  const cancel = useMutation({ mutationFn: (leaveId) => familyCancelLeave(slug, studentId, leaveId), onSuccess: () => qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'attendance'] }) })
  if (isLoading) return <FSkeleton className="h-80" />
  if (error) return <FError error={error} />
  if (!d) return null
  // each day's mark inside its cell: present in the teal accent, absent red, late / half day amber, leave grey
  const items = d.days.map((x) => ({ id: x.date, date: x.date, title: t(`family.marks.${x.status}`), tone: MARK_TONE[x.status] ?? 'neutral', sub: x.note || undefined }))

  return (
    <>
      <StudentCheckInCard />
      <PickupCard />
      <FCard>
        <Calendar month={month} onMonthChange={setMonth} maxMonth={d.today.slice(0, 7)} items={items} panelBelow />
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold text-ink">{d.pct === null ? t('family.attendance.noneYet') : t('family.attendance.pct', { pct: d.pct })}</span>
          {['P', 'A', 'L', 'HD', 'LV'].filter((k) => d.counts[k]).map((k) => <span key={k} className="inline-flex items-center gap-1.5 text-ink-muted"><span className={clsx('w-2.5 h-2.5 rounded-full', DOT[k])} />{t(`family.marks.${k}`)} {d.counts[k]}</span>)}
        </div>
      </FCard>

      <FCard title={t('family.leave.title')} action={!asking && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAsking(true)}>{t('family.leave.ask')}</Button>}>
        {asking && <div className="mb-4"><LeaveForm onDone={() => setAsking(false)} /></div>}
        {d.leave.length ? (
          <div className="divide-y divide-border -my-2">
            {d.leave.map((l) => (
              <div key={l.id} className="py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-ink">{date(l.from)}{l.to !== l.from ? ` – ${date(l.to)}` : ''}</p>
                  <p className="text-sm text-ink-muted break-words">{l.reason}</p>
                  {l.decisionNote && <p className="text-xs text-ink-faint mt-0.5">{l.decisionNote}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusPill tone={LEAVE_TONE[l.status]}>{t(`family.leave.status.${l.status}`)}</StatusPill>
                  {l.status === 'PENDING' && l.byFamily && <button type="button" className="text-xs text-brand-600 hover:underline min-h-[32px]" onClick={() => cancel.mutate(l.id)}>{t('family.leave.withdraw')}</button>}
                </div>
              </div>
            ))}
          </div>
        ) : !asking && <FEmpty icon={CalendarOff} title={t('family.leave.none')} />}
      </FCard>
    </>
  )
}
