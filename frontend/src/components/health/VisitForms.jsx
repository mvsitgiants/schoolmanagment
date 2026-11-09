import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { COMPLAINTS, VISIT_OUTCOMES } from '@schoolgiant/shared'
import { FormField, Input, Modal, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { createVisit, updateVisit } from '../../api/health'
import { useSnackbar } from '../../context/SnackbarContext'
import { PersonPicker, useHealthLabels } from './HealthKit'

const num = (v) => (v === '' || v == null ? null : Number(v))

/** How a visit ends (or goes on resting), with who picked them up / where they were sent, and whether to tell the guardian. */
function OutcomeFields({ form, set, errors, choices, isStudent }) {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  return (
    <>
      <FormField label={t('health.visits.outcome')}>
        <Select value={form.outcome} onChange={(e) => set('outcome', e.target.value)}>{choices.map((o) => <option key={o} value={o}>{L.outcome(o)}</option>)}</Select>
      </FormField>
      {form.outcome === 'SENT_HOME' && <FormField label={t('health.visits.pickedUpBy')}><Input value={form.pickedUpBy} onChange={(e) => set('pickedUpBy', e.target.value)} /></FormField>}
      {form.outcome === 'REFERRED' && <FormField label={t('health.visits.referredTo')} required error={errors.referredTo}><Input value={form.referredTo} onChange={(e) => set('referredTo', e.target.value)} /></FormField>}
      {form.outcome !== 'IN_ROOM' && <FormField label={t('health.visits.outcomeNote')} className="sm:col-span-2"><Input value={form.outcomeNote} onChange={(e) => set('outcomeNote', e.target.value)} /></FormField>}
      {form.outcome === 'SENT_HOME' && isStudent && (
        <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={form.notifyGuardian} onChange={(e) => set('notifyGuardian', e.target.checked)} className="rounded border-border text-brand-500" />{t('health.visits.notifyGuardian')}
        </label>
      )}
    </>
  )
}

/** A new sick-room visit: who, the complaint, vitals, what was given, and (optionally) how it ended. */
export function VisitModal({ onClose, onSaved }) {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const { showError } = useSnackbar()
  const [person, setPerson] = useState({ personType: 'STUDENT', studentId: '', staffUserId: '', staffName: '' })
  const [form, setForm] = useState({ complaint: 'FEVER', complaintNote: '', tempC: '', pulse: '', bp: '', spo2: '', treatment: '', medicines: [], outcome: 'IN_ROOM', outcomeNote: '', referredTo: '', pickedUpBy: '', notifyGuardian: true })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const save = useMutation({
    mutationFn: () => createVisit({
      ...person, complaint: form.complaint, complaintNote: form.complaintNote, treatment: form.treatment, outcome: form.outcome, outcomeNote: form.outcomeNote, referredTo: form.referredTo, pickedUpBy: form.pickedUpBy,
      notifyGuardian: form.notifyGuardian, medicines: form.medicines.filter((m) => m.name.trim()),
      vitals: { tempC: num(form.tempC), pulse: num(form.pulse), bp: form.bp, spo2: num(form.spo2) },
    }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const who = person.personType === 'STAFF' ? person.staffUserId || person.staffName.trim() : person.studentId
  return (
    <Modal open onClose={onClose} size="lg" title={t('health.visits.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!who} onClick={() => save.mutate()}>{t('health.visits.save')}</Button>
    </>}>
      <div className="space-y-4">
        <PersonPicker value={person} onChange={setPerson} errors={errors} />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('health.visits.complaint')} required><Select value={form.complaint} onChange={(e) => set('complaint', e.target.value)}>{COMPLAINTS.map((c) => <option key={c} value={c}>{L.complaint(c)}</option>)}</Select></FormField>
          <FormField label={t('health.visits.complaintNote')}><Input value={form.complaintNote} onChange={(e) => set('complaintNote', e.target.value)} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label={t('health.visits.temp')}><Input type="number" step="0.1" min={30} max={45} value={form.tempC} onChange={(e) => set('tempC', e.target.value)} /></FormField>
          <FormField label={t('health.visits.pulse')}><Input type="number" min={20} max={250} value={form.pulse} onChange={(e) => set('pulse', e.target.value)} /></FormField>
          <FormField label={t('health.visits.bp')}><Input value={form.bp} placeholder="110/70" onChange={(e) => set('bp', e.target.value)} /></FormField>
          <FormField label={t('health.visits.spo2')}><Input type="number" min={50} max={100} value={form.spo2} onChange={(e) => set('spo2', e.target.value)} /></FormField>
        </div>
        <FormField label={t('health.visits.treatment')}><Textarea rows={2} value={form.treatment} onChange={(e) => set('treatment', e.target.value)} /></FormField>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-ink-muted">{t('health.visits.medicines')}</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => set('medicines', [...form.medicines, { name: '', dose: '' }])}>{t('health.visits.addMedicine')}</Button></div>
          {form.medicines.map((m, i) => (
            <div key={i} className="mb-2 grid grid-cols-[2fr_1fr_auto] gap-2">
              <Input value={m.name} placeholder={t('health.visits.medicine')} onChange={(e) => set('medicines', form.medicines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input value={m.dose} placeholder={t('health.visits.dose')} onChange={(e) => set('medicines', form.medicines.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('actions.remove')} onClick={() => set('medicines', form.medicines.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <OutcomeFields form={form} set={set} errors={errors} choices={Object.keys(VISIT_OUTCOMES)} isStudent={person.personType === 'STUDENT'} />
        </div>
      </div>
    </Modal>
  )
}

/** End (or rest) a visit that is open on the board. */
export function CloseVisitModal({ visit, onClose, onSaved }) {
  const { t } = useTranslation('health')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ outcome: 'BACK_TO_CLASS', treatment: visit.treatment ?? '', outcomeNote: '', referredTo: '', pickedUpBy: '', notifyGuardian: true })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const save = useMutation({ mutationFn: () => updateVisit(visit.id, form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={t('health.visits.closeTitle', { name: visit.person?.name ?? '' })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('health.visits.treatment')} className="sm:col-span-2"><Textarea rows={2} value={form.treatment} onChange={(e) => set('treatment', e.target.value)} /></FormField>
        <OutcomeFields form={form} set={set} errors={errors} choices={visit.outcome === 'REST' ? ['BACK_TO_CLASS', 'SENT_HOME', 'REFERRED'] : ['BACK_TO_CLASS', 'REST', 'SENT_HOME', 'REFERRED']} isStudent={visit.personType === 'STUDENT'} />
      </div>
    </Modal>
  )
}
