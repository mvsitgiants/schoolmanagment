import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ESCORT_RELATIONS, OUTPASS_KINDS } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Modal, Select, Textarea, localIso } from '../system'
import Button from '../ui/Button'
import { createOutpass, fetchAllotments } from '../../api/hostel'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useHostelLabels } from './HostelKit'

const hhmmNow = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** Ask for an outpass for a student who lives in the hostel (optionally approving it at once). */
export default function OutpassForm({ studentId, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const { showError } = useSnackbar()
  const canApprove = hasPermission('hostel.outpass.approve')
  const today = localIso(new Date())
  const [find, setFind] = useState('')
  const [form, setForm] = useState({
    studentId: studentId ?? '', kind: 'DAY', leaveDate: today, leaveTime: hhmmNow(), returnDate: today, returnTime: '18:00', reason: '', destination: '',
    escort: { name: '', relation: 'FATHER', mobile: '' }, note: '', approve: canApprove,
  })
  const [errors, setErrors] = useState({})
  const { data: residents = [] } = useQuery({ queryKey: ['hostel', 'allotments', {}], queryFn: () => fetchAllotments({}) })
  const q = find.trim().toLowerCase()
  const options = residents.filter((r) => r.studentId === form.studentId || !q || (r.student?.name ?? '').toLowerCase().includes(q) || (r.student?.admissionNo ?? '').toLowerCase().includes(q) || r.bedCode.toLowerCase().includes(q)).slice(0, 200)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'leaveDate' && f.returnDate < e.target.value && { returnDate: e.target.value }) }))
  const setE = (k) => (e) => setForm((f) => ({ ...f, escort: { ...f.escort, [k]: e.target.value } }))
  const pick = (e) => {
    const r = residents.find((x) => x.studentId === e.target.value)
    setForm((f) => ({ ...f, studentId: e.target.value, escort: f.escort.name || !r?.student?.guardian ? f.escort : { name: r.student.guardian, relation: ESCORT_RELATIONS.includes(r.student.relation) ? r.student.relation : 'OTHER', mobile: r.student.mobile ?? '' } }))
  }
  const save = useMutation({ mutationFn: () => createOutpass(form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} size="lg" title={t('hostel.outpass.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || form.reason.trim().length < 3} onClick={() => save.mutate()}>{form.approve ? t('hostel.outpass.saveApprove') : t('hostel.outpass.save')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('hostel.outpass.find')}><Input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('hostel.outpass.findPlaceholder')} /></FormField>
          <FormField label={t('hostel.outpass.student')} required error={errors.studentId} hint={!residents.length ? t('hostel.outpass.noResidents') : undefined}>
            <Select value={form.studentId} onChange={pick}>
              <option value="">{t('hostel.outpass.pickStudent')}</option>
              {options.map((r) => <option key={r.studentId} value={r.studentId}>{[r.student?.name, r.student?.className, r.bedCode].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hostel.outpass.kind')}><Select value={form.kind} onChange={set('kind')}>{OUTPASS_KINDS.map((k) => <option key={k.value} value={k.value}>{L.outpassKind(k.value)}</option>)}</Select></FormField>
          <FormField label={t('hostel.outpass.destination')}><Input value={form.destination} onChange={set('destination')} /></FormField>
          <FormField label={t('hostel.outpass.leave')} required error={errors.leaveDate}>
            <div className="flex gap-2"><DateInput value={form.leaveDate} onChange={set('leaveDate')} /><Input type="time" value={form.leaveTime} onChange={set('leaveTime')} className="w-32" /></div>
          </FormField>
          <FormField label={t('hostel.outpass.return')} required error={errors.returnDate || errors.returnTime}>
            <div className="flex gap-2"><DateInput value={form.returnDate} min={form.leaveDate} onChange={set('returnDate')} /><Input type="time" value={form.returnTime} onChange={set('returnTime')} className="w-32" /></div>
          </FormField>
        </div>
        <FormField label={t('hostel.outpass.reason')} required error={errors.reason}><Textarea rows={2} value={form.reason} maxLength={300} onChange={set('reason')} /></FormField>
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hostel.outpass.escort')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('hostel.outpass.escortName')}><Input value={form.escort.name} onChange={setE('name')} /></FormField>
          <FormField label={t('hostel.outpass.escortRelation')}><Select value={form.escort.relation} onChange={setE('relation')}>{ESCORT_RELATIONS.map((r) => <option key={r} value={r}>{t(`hostel.relations.${r}`)}</option>)}</Select></FormField>
          <FormField label={t('hostel.outpass.escortMobile')}><Input type="tel" value={form.escort.mobile} onChange={setE('mobile')} /></FormField>
        </div>
        <FormField label={t('hostel.outpass.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField>
        {canApprove && (
          <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.approve} onChange={(e) => setForm((f) => ({ ...f, approve: e.target.checked }))} className="rounded border-border text-brand-500" />{t('hostel.outpass.approveNow')}
          </label>
        )}
      </div>
    </Modal>
  )
}
