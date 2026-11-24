import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Globe, IndianRupee } from 'lucide-react'
import { SCHOLARSHIP_PORTAL_STATUS, formatINR, toPaise } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Modal, Note, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { recordMoney, updatePortal } from '../../api/scholarships'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * Where applications stand on the government portal: one (with the portal's own application id and the sanctioned
 * amount) or a whole list at once — e.g. after verifying a batch on the portal.
 */
export function PortalStatus({ ids, app, onClose, onDone }) {
  const { t } = useTranslation('scholarships')
  const { showError } = useSnackbar()
  const one = ids.length === 1
  const [form, setForm] = useState({
    status: app?.portal?.status ?? (one ? 'APPLIED' : 'INSTITUTE_VERIFIED'), applicationId: app?.portal?.applicationId ?? '',
    sanctionedAmount: app?.portal?.sanctionedAmount != null ? String(app.portal.sanctionedAmount / 100) : '', note: '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => updatePortal(ids, {
      status: form.status, note: form.note || undefined,
      ...(one && { applicationId: form.applicationId }),
      ...(one && form.sanctionedAmount !== '' && { sanctionedAmount: toPaise(form.sanctionedAmount) }),
    }),
    onSuccess: onDone, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={one ? t('scholarships.portal.titleOne') : t('scholarships.portal.titleMany', { count: ids.length })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.cancel')}</Button>
      <Button icon={Globe} loading={save.isPending} onClick={() => save.mutate()}>{t('scholarships.common.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <FormField label={t('scholarships.portal.status')}>
            <Select value={form.status} onChange={set('status')}>{Object.keys(SCHOLARSHIP_PORTAL_STATUS).map((k) => <option key={k} value={k}>{t(`scholarships.portalStatus.${k}`, SCHOLARSHIP_PORTAL_STATUS[k].label)}</option>)}</Select>
          </FormField>
        </div>
        {one && <FormField label={t('scholarships.portal.applicationId')} hint={t('scholarships.portal.applicationIdHint')}><Input value={form.applicationId} onChange={set('applicationId')} /></FormField>}
        {one && <FormField label={t('scholarships.portal.sanctioned')} hint={t('scholarships.portal.sanctionedHint')}><Input type="number" min="0" value={form.sanctionedAmount} onChange={set('sanctionedAmount')} /></FormField>}
        <div className="sm:col-span-2"><FormField label={t('scholarships.portal.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField></div>
        {!one && <div className="sm:col-span-2"><Note>{t('scholarships.portal.manyHint')}</Note></div>}
      </div>
    </Modal>
  )
}

/**
 * Money a government or trust paid the institution for approved students. Each amount becomes a fee receipt (mode
 * "Scholarship money") against that student's fees and is posted to Accounts; the fees stop being held once nothing
 * more is awaited.
 */
export function RecordMoney({ rows, onClose, onDone }) {
  const { t } = useTranslation('scholarships')
  const { showError } = useSnackbar()
  const [amounts, setAmounts] = useState(Object.fromEntries(rows.map((r) => [r.id, String(Math.max(0, (r.expectedAmount ?? 0) - (r.received ?? 0)) / 100)])))
  const [form, setForm] = useState({ date: '', reference: '', final: false })
  const total = rows.reduce((n, r) => n + toPaise(amounts[r.id] || 0), 0)
  const save = useMutation({
    mutationFn: () => recordMoney(rows.filter((r) => Number(amounts[r.id]) > 0).map((r) => ({ id: r.id, amount: toPaise(amounts[r.id]) })), { date: form.date || undefined, reference: form.reference || undefined, final: form.final }),
    onSuccess: onDone, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="lg" title={t('scholarships.money.title', { count: rows.length })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.cancel')}</Button>
      <Button icon={IndianRupee} loading={save.isPending} disabled={!total} onClick={() => save.mutate()}>{t('scholarships.money.record', { amount: formatINR(total) })}</Button>
    </>}>
      <div className="space-y-4">
        <Note>{t('scholarships.money.hint')}</Note>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('scholarships.money.date')} hint={t('scholarships.money.dateHint')}><DateInput value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></FormField>
          <FormField label={t('scholarships.money.reference')} hint={t('scholarships.money.referenceHint')}><Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></FormField>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{r.student?.name ?? '—'}</p>
                <p className="text-xs text-ink-faint">{[r.applicationNo, r.portal?.applicationId, t('scholarships.money.awaited', { amount: formatINR(Math.max(0, (r.expectedAmount ?? 0) - (r.received ?? 0))) })].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="w-36"><Input type="number" min="0" aria-label={t('scholarships.money.amount')} value={amounts[r.id]} onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value }))} /></div>
            </li>
          ))}
        </ul>
        <label className="inline-flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.final} onChange={(e) => setForm((f) => ({ ...f, final: e.target.checked }))} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
          <span>{t('scholarships.money.final')}<span className="block text-xs text-ink-faint">{t('scholarships.money.finalHint')}</span></span>
        </label>
      </div>
    </Modal>
  )
}
