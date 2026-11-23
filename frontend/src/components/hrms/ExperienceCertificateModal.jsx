import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Printer } from 'lucide-react'
import { CERTIFICATE_CONDUCT, defaultConduct } from '@schoolgiant/shared'
import { FormField, Modal, Note, Textarea } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'
import { fetchEmployee, saveExitCertificate } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

/** Print the experience certificate — after HR has said what it says (staff who can't record exits just print it). */
export function useExperienceCertificate() {
  const [employeeId, setEmployeeId] = useState(null)
  const canWord = hasPermission('hrms.employees.terminate')
  return {
    open: (id) => (canWord ? setEmployeeId(id) : printDocument('HR_EXPERIENCE_LETTER', id)),
    modal: employeeId ? <ExperienceCertificateModal employeeId={employeeId} onClose={() => setEmployeeId(null)} /> : null,
  }
}

/**
 * What the experience certificate says beyond name, post and dates: the conduct line (good for someone who
 * resigned or retired, left out for a termination or someone who stopped coming), the duties, and — for a
 * teacher — the subjects and classes taught (from Academic setup › teacher allocations). Saved, then printed.
 */
function ExperienceCertificateModal({ employeeId, onClose }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const { data: e } = useQuery({ queryKey: ['hrms', 'employee', employeeId], queryFn: () => fetchEmployee(employeeId) })
  const [form, setForm] = useState(null)
  useEffect(() => {
    if (!e || form) return
    const c = e.exit?.certificate ?? {}
    setForm({ conduct: c.conduct || defaultConduct(e.exit?.type), duties: c.duties ?? '', showTeaching: c.showTeaching !== false })
  }, [e, form])
  const save = useMutation({
    mutationFn: () => saveExitCertificate(employeeId, { conduct: form.conduct, duties: form.duties.trim(), showTeaching: form.showTeaching }),
    onSuccess: () => { printDocument('HR_EXPERIENCE_LETTER', employeeId); onClose() },
    onError: (err) => showError(err.message),
  })
  const suggested = defaultConduct(e?.exit?.type)
  return (
    <Modal open onClose={onClose} size="md" title={t('hrms.certificate.title')} subtitle={e ? `${e.name} · ${e.employeeCode}` : ''}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button icon={Printer} loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>{t('hrms.certificate.savePrint')}</Button></>}>
      {!form ? <div className="h-40 rounded-xl bg-black/5 animate-pulse" /> : (
        <div className="space-y-5">
          <FormField label={t('hrms.certificate.conduct')}>
            <div className="space-y-2" role="radiogroup">
              {CERTIFICATE_CONDUCT.map((c) => (
                <label key={c.value} className={clsx('flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer', form.conduct === c.value ? 'border-brand-500 bg-brand-50/50' : 'border-border hover:bg-black/[0.02]')}>
                  <input type="radio" name="conduct" className="mt-0.5 text-brand-600" checked={form.conduct === c.value} onChange={() => setForm({ ...form, conduct: c.value })} />
                  <span className="text-sm text-ink">
                    {t(`hrms.certificate.conductOptions.${c.value}`)}
                    {c.value === suggested && <span className="ms-2 text-xs text-ink-faint">{t('hrms.certificate.suggested')}</span>}
                  </span>
                </label>
              ))}
            </div>
          </FormField>
          {form.conduct === 'GOOD' && suggested === 'OMIT' && <Note tone="warning">{t('hrms.certificate.goodAfterTermination')}</Note>}
          <FormField label={t('hrms.certificate.duties')} hint={t('hrms.certificate.dutiesHint')}>
            <Textarea rows={2} maxLength={400} value={form.duties} onChange={(ev) => setForm({ ...form, duties: ev.target.value })} />
          </FormField>
          {e?.category === 'TEACHING' && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="min-w-0"><span className="block text-sm font-medium text-ink">{t('hrms.certificate.showTeaching')}</span><span className="block text-xs text-ink-muted">{t('hrms.certificate.showTeachingHint')}</span></span>
              <Switch checked={form.showTeaching} onChange={(v) => setForm({ ...form, showTeaching: v })} label={t('hrms.certificate.showTeaching')} />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
