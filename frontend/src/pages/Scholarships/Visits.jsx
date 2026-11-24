import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, CheckCircle2, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  ControlChip, DataTable, DateCell, DateInput, Drawer, FormField, HeaderButton, Input, LevelBar, Modal, Note, PageContainer, PageHeader, PersonCell,
  Skeleton, StatusPill, Textarea, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { ApplicationStatus } from '../../components/scholarships/ScholarshipKit'
import { deleteVisitDay, fetchVisitBookings, fetchVisitDays, saveVisitDay } from '../../api/scholarships'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const EMPTY = { date: '', from: '10:00', to: '13:00', slotMinutes: '10', perSlot: '2', place: '', note: '', active: true }

function DayForm({ day, onClose, onSaved }) {
  const { t } = useTranslation('scholarships')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(day ? { ...EMPTY, ...day, slotMinutes: String(day.slotMinutes), perSlot: String(day.perSlot), place: day.place ?? '', note: day.note ?? '' } : EMPTY)
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({
    mutationFn: () => saveVisitDay(day?.id, { date: form.date, from: form.from, to: form.to, slotMinutes: Number(form.slotMinutes), perSlot: Number(form.perSlot), place: form.place, note: form.note, active: form.active }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={day ? t('scholarships.visit.editTitle') : t('scholarships.visit.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.date || !form.from || !form.to} onClick={() => save.mutate()}>{t('scholarships.common.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><FormField label={t('scholarships.visit.date')} required error={errors.date}><DateInput value={form.date} onChange={set('date')} /></FormField></div>
        <FormField label={t('scholarships.visit.from')} required error={errors.from}><Input type="time" value={form.from} onChange={set('from')} /></FormField>
        <FormField label={t('scholarships.visit.to')} required error={errors.to}><Input type="time" value={form.to} onChange={set('to')} /></FormField>
        <FormField label={t('scholarships.visit.slotMinutes')} error={errors.slotMinutes} hint={t('scholarships.visit.slotHint')}><Input type="number" min="5" max="120" value={form.slotMinutes} onChange={set('slotMinutes')} /></FormField>
        <FormField label={t('scholarships.visit.perSlot')} error={errors.perSlot} hint={t('scholarships.visit.perSlotHint')}><Input type="number" min="1" max="50" value={form.perSlot} onChange={set('perSlot')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('scholarships.visit.place')} hint={t('scholarships.visit.placeHint')}><Input value={form.place} onChange={set('place')} /></FormField></div>
        <div className="sm:col-span-2"><FormField label={t('scholarships.visit.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField></div>
        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.active} onChange={set('active')} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('scholarships.visit.active')}</label>
      </div>
    </Modal>
  )
}

/** Who is coming on one day, by time: the desk's list. Open an application to tick the originals seen. */
function Bookings({ day, onClose }) {
  const { t } = useTranslation('scholarships')
  const navigate = useNavigate()
  const { date } = useFormat()
  const { data, isLoading } = useQuery({ queryKey: ['scholarship-visit', day.id], queryFn: () => fetchVisitBookings(day.id) })
  const rows = data?.rows ?? []
  return (
    <Drawer open onClose={onClose} size="lg" subtitle={t('scholarships.visit.bookingsSubtitle')} title={`${date(day.date)} · ${day.from}–${day.to}`}>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-4">
          {day.place && <p className="text-sm text-ink-muted">{day.place}</p>}
          <Note>{t('scholarships.visit.deskHint')}</Note>
          <DataTable rows={rows} rowKey="id" onSelect={(r) => navigate(`/scholarships/applications/${r.id}`)}
            columns={[
              { key: 'time', header: t('scholarships.visit.time'), width: 70, render: (v) => <span className="tabular-nums font-medium text-ink">{v}</span> },
              { key: 'student', header: t('scholarships.list.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v?.name ?? '—'} sub={[v?.classShort, r.applicationNo].filter(Boolean).join(' · ')} size={28} /> },
              { key: 'originals', header: t('scholarships.visit.bring'), render: (v, r) => (r.attended || !v.length ? <span className="inline-flex items-center gap-1 text-sm text-success-600"><CheckCircle2 className="w-4 h-4" />{t('scholarships.visit.done')}</span> : <span className="text-sm text-ink">{v.join(', ')}</span>) },
              { key: 'status', header: t('scholarships.list.status'), mobileHidden: true, render: (v) => <ApplicationStatus status={v} /> },
              { key: 'id', header: '', align: 'right', width: 48, render: () => <ExternalLink className="w-4 h-4 text-ink-faint" aria-hidden /> },
            ]}
            emptyIcon={CalendarClock} emptyTitle={t('scholarships.visit.noBookings')} />
        </div>
      )}
    </Drawer>
  )
}

/** Days the office sees originals. Families whose copies are all checked book a time in the app — no queue. */
export default function Visits() {
  const { t } = useTranslation('scholarships')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState(null) // {} new · day
  const [open, setOpen] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['scholarship-visits', all], queryFn: () => fetchVisitDays(all) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['scholarship-visits'] })
  const remove = useMutation({ mutationFn: (id) => deleteVisitDay(id), onSuccess: () => { refresh(); showSuccess(t('scholarships.visit.deleted')) }, onError: (e) => showError(e.message) })
  return (
    <PageContainer>
      <PageHeader icon={CalendarClock} title={t('scholarships.visit.title')} subtitle={t('scholarships.visit.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="scholarships.visits.create" onClick={() => setEditing({})}>{t('scholarships.visit.new')}</HeaderButton>} />
      <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id" onSelect={setOpen}
        toolbar={<Toolbar right={<ControlChip label={t('scholarships.schemes.showing')} active={all} value={all ? t('scholarships.visit.allDays') : t('scholarships.visit.coming')}
          options={[{ value: 'coming', label: t('scholarships.visit.coming') }, { value: 'all', label: t('scholarships.visit.allDays') }]} onChange={(v) => setAll(v === 'all')} />} />}
        columns={[
          { key: 'date', header: t('scholarships.visit.date'), mobileTitle: true, render: (v) => <DateCell value={v} /> },
          { key: 'from', header: t('scholarships.visit.hours'), mobilePrimary: true, render: (v, r) => <span className="tabular-nums text-ink">{r.from}–{r.to}<span className="block text-xs text-ink-faint">{t('scholarships.visit.every', { count: r.slotMinutes, per: r.perSlot })}</span></span> },
          { key: 'place', header: t('scholarships.visit.place'), mobileHidden: true, render: (v) => v || <span className="text-ink-faint">—</span> },
          { key: 'booked', header: t('scholarships.visit.bookedCol'), mobilePrimary: true, render: (v, r) => <LevelBar value={v} max={r.times.length * r.perSlot} label={t('scholarships.visit.ofPlaces', { booked: v, total: r.times.length * r.perSlot })} highIsBad warnAt={r.times.length * r.perSlot} width="w-36" /> },
          { key: 'active', header: t('scholarships.schemes.state'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('scholarships.visit.open') : t('scholarships.visit.closed')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 100, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('scholarships.visits.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('scholarships.common.edit')} title={t('scholarships.common.edit')} onClick={() => setEditing(r)} />}
              {hasPermission('scholarships.visits.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('scholarships.common.delete')} title={t('scholarships.common.delete')}
                onClick={async () => { if (await confirm({ title: t('scholarships.visit.deleteTitle'), message: t('scholarships.visit.deleteMessage'), tone: 'danger', confirmLabel: t('scholarships.common.delete') })) remove.mutate(id) }} />}
            </div>
          ) },
        ]}
        emptyIcon={CalendarClock} emptyTitle={t('scholarships.visit.empty')} emptyHint={t('scholarships.visit.emptyHint')}
        emptyAction={hasPermission('scholarships.visits.create') && <Button icon={Plus} onClick={() => setEditing({})}>{t('scholarships.visit.new')}</Button>} />
      {editing && <DayForm day={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); showSuccess(t('scholarships.visit.saved')) }} />}
      {open && <Bookings day={open} onClose={() => setOpen(null)} />}
    </PageContainer>
  )
}
