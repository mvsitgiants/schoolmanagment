import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Printer } from 'lucide-react'
import { EXIT_INTERVIEW_ASPECTS, EXIT_REASONS, REHIRE_OPTIONS, REJOIN_OPTIONS } from '@schoolgiant/shared'
import { FormField, Input, Modal, SegmentedControl, Textarea } from '../system'
import Button from '../ui/Button'
import { fetchEmployee, saveExitInterview } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

const empty = { reason: '', otherReason: '', ratings: {}, liked: '', improve: '', wouldRejoin: '', rehire: '', rehireNote: '' }

/** Record the exit interview — staff who can't record exits just print the form (blank, or as recorded). */
export function useExitInterview() {
  const [employeeId, setEmployeeId] = useState(null)
  const canRecord = hasPermission('hrms.employees.terminate')
  return {
    open: (id) => (canRecord ? setEmployeeId(id) : printDocument('HR_EXIT_INTERVIEW', id)),
    modal: employeeId ? <ExitInterviewModal employeeId={employeeId} onClose={() => setEmployeeId(null)} /> : null,
  }
}

/**
 * The exit interview in the school's words: why they are leaving, six things rated out of five, what to keep and
 * what to change, whether they'd come back — and the school's own call on taking them back. Saving it ticks
 * "Exit interview" on the exit clearance. "Print form" prints it as saved, or blank to fill in by hand.
 */
function ExitInterviewModal({ employeeId, onClose }) {
  const { t } = useTranslation('hrms')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: e } = useQuery({ queryKey: ['hrms', 'employee', employeeId], queryFn: () => fetchEmployee(employeeId) })
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!e || f) return
    const i = e.exit?.interview
    setF(i ? { ...empty, ...i, ratings: i.ratings ?? {} } : empty)
  }, [e, f])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => saveExitInterview(employeeId, {
      reason: f.reason, otherReason: f.otherReason?.trim() || undefined, ratings: f.ratings,
      liked: f.liked?.trim() || undefined, improve: f.improve?.trim() || undefined,
      wouldRejoin: f.wouldRejoin || undefined, rehire: f.rehire || undefined, rehireNote: (f.rehire && f.rehire !== 'YES' && f.rehireNote?.trim()) || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', employeeId] }); qc.invalidateQueries({ queryKey: ['employee', employeeId] }); qc.invalidateQueries({ queryKey: ['hrms', 'exits'] })
      showSuccess(t('hrms.exitInterview.saved')); onClose()
    },
    onError: (err) => showError(err.message),
  })
  return (
    <Modal open onClose={onClose} size="lg" title={t('hrms.exitInterview.title')} subtitle={e ? `${e.name} · ${e.employeeCode}` : ''}
      footer={<>
        <Button variant="ghost" icon={Printer} className="me-auto" onClick={() => printDocument('HR_EXIT_INTERVIEW', employeeId)}>{t('hrms.exitInterview.printForm')}</Button>
        <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
        <Button icon={Check} loading={save.isPending} disabled={!f?.reason} onClick={() => save.mutate()}>{t('actions.save')}</Button>
      </>}>
      {!f ? <div className="h-48 rounded-xl bg-black/5 animate-pulse" /> : (
        <div className="space-y-5">
          <FormField label={t('hrms.exitInterview.reason')} required>
            <div className="flex flex-wrap gap-2">
              {EXIT_REASONS.map((r) => (
                <button key={r.value} type="button" onClick={() => set('reason', r.value)} aria-pressed={f.reason === r.value}
                  className={clsx('min-h-[36px] rounded-full border px-3 text-sm transition-colors', f.reason === r.value ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-border text-ink-muted hover:bg-black/[0.03]')}>
                  {t(`hrms.exitInterview.reasons.${r.value}`)}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label={t('hrms.exitInterview.inTheirWords')}>
            <Input value={f.otherReason ?? ''} maxLength={200} onChange={(ev) => set('otherReason', ev.target.value)} />
          </FormField>

          <FormField label={t('hrms.exitInterview.ratings')}>
            <div className="divide-y divide-border rounded-lg border border-border">
              {EXIT_INTERVIEW_ASPECTS.map((a) => (
                <div key={a.value} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-ink">{t(`hrms.exitInterview.aspects.${a.value}`)}</span>
                  <div className="flex gap-1" role="radiogroup" aria-label={t(`hrms.exitInterview.aspects.${a.value}`)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={f.ratings[a.value] === n} onClick={() => set('ratings', { ...f.ratings, [a.value]: n })}
                        className={clsx('w-9 h-9 rounded-lg border text-sm font-medium tabular-nums', f.ratings[a.value] === n ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-ink-muted hover:bg-black/[0.03]')}>{n}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </FormField>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label={t('hrms.exitInterview.liked')}><Textarea rows={3} maxLength={1000} value={f.liked ?? ''} onChange={(ev) => set('liked', ev.target.value)} /></FormField>
            <FormField label={t('hrms.exitInterview.improve')}><Textarea rows={3} maxLength={1000} value={f.improve ?? ''} onChange={(ev) => set('improve', ev.target.value)} /></FormField>
          </div>
          <FormField label={t('hrms.exitInterview.rejoin')}>
            <SegmentedControl value={f.wouldRejoin} onChange={(v) => set('wouldRejoin', v)} options={REJOIN_OPTIONS.map((o) => ({ value: o.value, label: t(`hrms.exitInterview.rejoinOptions.${o.value}`) }))} />
          </FormField>
          <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
            <p className="text-xs font-semibold text-ink-faint">{t('hrms.exitInterview.schoolOnly')}</p>
            <SegmentedControl value={f.rehire} onChange={(v) => set('rehire', v)} options={REHIRE_OPTIONS.map((o) => ({ value: o.value, label: t(`hrms.exitInterview.rehireOptions.${o.value}`) }))} />
            {f.rehire && f.rehire !== 'YES' && (
              <Input value={f.rehireNote ?? ''} maxLength={300} placeholder={t('hrms.exitInterview.rehireNote')} onChange={(ev) => set('rehireNote', ev.target.value)} />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
