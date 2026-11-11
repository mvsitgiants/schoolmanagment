import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CHECKOUT_REASONS } from '@schoolgiant/shared'
import { DateInput, FormField, Modal, Note, Select, Textarea, localIso } from '../system'
import Button from '../ui/Button'
import StudentPicker from '../fees/StudentPicker'
import { allotBed, checkoutAllotment, moveAllotment } from '../../api/hostel'
import { useSnackbar } from '../../context/SnackbarContext'
import { BedPicker, useHostelLabels } from './HostelKit'

/** Allot a student a bed from a date (the bed can come preset from the board). */
export function AllotModal({ blocks, bed, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ studentId: '', bedId: bed?.id ?? '', from: localIso(new Date()), note: '' })
  const [errors, setErrors] = useState({})
  const save = useMutation({ mutationFn: () => allotBed(form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={bed ? t('hostel.allot.titleBed', { code: bed.code }) : t('hostel.allot.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.bedId} onClick={() => save.mutate()}>{t('hostel.allot.save')}</Button>
    </>}>
      <div className="space-y-3">
        <StudentPicker value={form.studentId} onChange={(id) => setForm((f) => ({ ...f, studentId: id }))} error={errors.studentId} />
        {!bed && <BedPicker blocks={blocks} value={form.bedId} onChange={(id) => setForm((f) => ({ ...f, bedId: id }))} error={errors.bedId} />}
        {bed?.state === 'RESERVED' && <Note tone="info">{t('hostel.allot.reservedNote', { note: bed.note ?? '' })}</Note>}
        <FormField label={t('hostel.allot.from')} error={errors.from}><DateInput value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} /></FormField>
        <FormField label={t('hostel.allot.note')}><Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

/** Move a student to another bed from a date. */
export function MoveModal({ allotment, blocks, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ bedId: '', from: localIso(new Date()), note: '' })
  const [errors, setErrors] = useState({})
  const save = useMutation({ mutationFn: () => moveAllotment(allotment.id, form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={t('hostel.move.title', { name: allotment.student?.name ?? '' })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.bedId} onClick={() => save.mutate()}>{t('hostel.move.save')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{t('hostel.move.now', { code: allotment.bedCode })}</p>
        <BedPicker blocks={blocks} value={form.bedId} onChange={(id) => setForm((f) => ({ ...f, bedId: id }))} error={errors.bedId} exclude={allotment.bedId} />
        <FormField label={t('hostel.move.from')} hint={t('hostel.move.fromHint')} error={errors.from}><DateInput value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} /></FormField>
        <FormField label={t('hostel.allot.note')}><Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

/** Check a student out of the hostel: the last night and why. */
export function CheckoutModal({ allotment, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ to: localIso(new Date()), reason: 'LEFT_HOSTEL', note: '' })
  const [errors, setErrors] = useState({})
  const save = useMutation({ mutationFn: () => checkoutAllotment(allotment.id, form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={t('hostel.checkout.title', { name: allotment.student?.name ?? '' })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button variant="danger" loading={save.isPending} onClick={() => save.mutate()}>{t('hostel.checkout.save')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{t('hostel.checkout.bed', { code: allotment.bedCode })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('hostel.checkout.to')} error={errors.to}><DateInput value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} /></FormField>
          <FormField label={t('hostel.checkout.reason')}><Select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}>{CHECKOUT_REASONS.map((r) => <option key={r.value} value={r.value}>{L.reason(r.value)}</option>)}</Select></FormField>
        </div>
        <FormField label={t('hostel.checkout.note')}><Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}
