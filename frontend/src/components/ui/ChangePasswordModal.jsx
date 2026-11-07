import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, FormField, Input } from '../system'
import Button from './Button'
import { changePassword } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const EMPTY = { current: '', next: '', confirm: '' }

/** Self-service password change — needs the current password; other devices get signed out. */
export default function ChangePasswordModal({ open, onClose }) {
  const { t } = useTranslation('ui')
  const { showSuccess } = useSnackbar()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const close = () => { setForm(EMPTY); setError(''); onClose() }
  const tooShort = form.next.length > 0 && form.next.length < 8
  const mismatch = form.confirm.length > 0 && form.next !== form.confirm
  const ready = form.current && form.next.length >= 8 && form.next === form.confirm

  const submit = async (e) => {
    e?.preventDefault()
    if (!ready) return
    setSaving(true); setError('')
    try {
      showSuccess(await changePassword(form.current, form.next))
      close()
    } catch (err) {
      setError(err?.response?.data?.message || err.message || t('ui.password.changeFailed'))
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={close} title={t('ui.password.title')} size="sm"
      footer={<>
        <Button variant="secondary" onClick={close}>{t('ui.common.cancel')}</Button>
        <Button variant="primary" loading={saving} disabled={!ready} onClick={submit}>{t('ui.password.submit')}</Button>
      </>}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label={t('ui.password.current')} required>
          <Input type="password" autoComplete="current-password" autoFocus value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </FormField>
        <FormField label={t('ui.password.new')} required hint={tooShort ? undefined : t('ui.password.minLength')} error={tooShort ? t('ui.password.minLength') : undefined}>
          <Input type="password" autoComplete="new-password" value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </FormField>
        <FormField label={t('ui.password.confirm')} required error={mismatch ? t('ui.password.mismatch') : undefined}>
          <Input type="password" autoComplete="new-password" value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </FormField>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <p className="text-xs text-ink-muted">{t('ui.password.otherDevicesNote')}</p>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
