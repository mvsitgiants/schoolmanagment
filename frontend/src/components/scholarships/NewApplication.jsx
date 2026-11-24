import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileCheck2 } from 'lucide-react'
import { formatINR, toPaise } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, Select, Textarea } from '../system'
import Button from '../ui/Button'
import StudentPicker from '../fees/StudentPicker'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { DocState, EligibilityList, docName, valueTextOf } from './ScholarshipKit'
import { createApplication, previewApplication } from '../../api/scholarships'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * Start one application. Before saving it shows whether the student can apply and which documents are already
 * with us (checked earlier and still good) — so the family is only asked for what is really missing.
 */
export default function NewApplication({ schemes = [], classes = [], schemeId: presetScheme, onClose, onSaved }) {
  const { t } = useTranslation('scholarships')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ studentId: '', schemeId: presetScheme ?? schemes[0]?.id ?? '', familyIncome: '', marksPct: '', note: '', tellFamily: true })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const scheme = schemes.find((s) => s.id === form.schemeId)
  const income = useDebouncedValue(form.familyIncome, 400)
  const marks = useDebouncedValue(form.marksPct, 400)
  const params = { schemeId: form.schemeId, studentId: form.studentId, familyIncome: income === '' ? undefined : toPaise(income), marksPct: marks === '' ? undefined : Number(marks) }
  const { data: preview, isFetching } = useQuery({ queryKey: ['scholarship-preview', params], queryFn: () => previewApplication(params), enabled: !!form.studentId && !!form.schemeId })
  const askMarks = !!scheme?.eligibility?.minMarksPct && preview && preview.facts.marksPct == null
  const askIncome = !!scheme?.eligibility?.maxIncome
  const save = useMutation({
    mutationFn: () => createApplication({
      schemeId: form.schemeId, studentId: form.studentId, familyIncome: form.familyIncome === '' ? undefined : toPaise(form.familyIncome),
      marksPct: form.marksPct === '' ? undefined : Number(form.marksPct), note: form.note || undefined, tellFamily: form.tellFamily,
    }),
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  const have = preview?.items.filter((i) => i.state === 'ACCEPTED' || i.state === 'ORIGINAL_DUE') ?? []
  const need = preview?.items.filter((i) => !(i.state === 'ACCEPTED' || i.state === 'ORIGINAL_DUE')) ?? []

  return (
    <Modal open onClose={onClose} size="lg" title={t('scholarships.new.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.schemeId || !preview?.eligible || !!preview?.existing} onClick={() => save.mutate()}>{t('scholarships.new.start')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <FormField label={t('scholarships.new.scheme')} required>
            <Select value={form.schemeId} onChange={set('schemeId')}>
              {schemes.map((s) => <option key={s.id} value={s.id}>{s.name} — {valueTextOf(t, s)}</option>)}
            </Select>
          </FormField>
        </div>
        <StudentPicker value={form.studentId} onChange={(sid) => setForm((f) => ({ ...f, studentId: sid }))} />
        {askIncome && <FormField label={t('scholarships.new.income')} hint={t('scholarships.new.incomeHint')}><Input type="number" min="0" value={form.familyIncome} onChange={set('familyIncome')} /></FormField>}
        {askMarks && <FormField label={t('scholarships.new.marks')} hint={t('scholarships.new.marksHint')}><Input type="number" min="0" max="100" step="0.1" value={form.marksPct} onChange={set('marksPct')} /></FormField>}

        {preview && (
          <div className="sm:col-span-2 space-y-4">
            {preview.existing && <Note tone="warning">{t('scholarships.new.already', { no: preview.existing.applicationNo })}</Note>}
            {!preview.existing && !preview.eligible && <Note tone="danger">{t('scholarships.new.notEligible')}</Note>}
            <div>
              <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.app.eligibility')}</p>
              <EligibilityList checks={preview.checks} classes={classes} />
            </div>
            {preview.items.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.new.toGive', { count: need.length })}</p>
                  <ul className="space-y-1.5">{need.map((i) => <li key={i.key} className="flex items-center justify-between gap-2 text-sm"><span className="text-ink">{docName(t, i)}{!i.required && <span className="text-ink-faint"> · {t('scholarships.doc.optional')}</span>}</span><DocState state={i.state} /></li>)}</ul>
                  {!need.length && <p className="text-sm text-ink-muted">{t('scholarships.new.nothingToGive')}</p>}
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.new.alreadyHave', { count: have.length })}</p>
                  <ul className="space-y-1.5">{have.map((i) => <li key={i.key} className="flex items-center gap-2 text-sm text-ink"><FileCheck2 className="w-4 h-4 text-success-600" aria-hidden />{docName(t, i)}</li>)}</ul>
                  {!have.length && <p className="text-sm text-ink-muted">{t('scholarships.new.nothingYet')}</p>}
                </div>
              </div>
            )}
            <Note>{t('scholarships.new.expected', { amount: formatINR(preview.expectedAmount ?? 0) })}{scheme?.holdFees ? ` ${t('scholarships.new.holdNote')}` : ''}</Note>
          </div>
        )}
        {isFetching && !preview && <p className="sm:col-span-2 text-sm text-ink-muted">{t('scholarships.new.checking')}</p>}

        <div className="sm:col-span-2"><FormField label={t('scholarships.new.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField></div>
        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.tellFamily} onChange={set('tellFamily')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {t('scholarships.new.tellFamily')}
        </label>
      </div>
    </Modal>
  )
}
