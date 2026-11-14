import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Lock, LockOpen } from 'lucide-react'
import { FormField, Input, Modal, StatusPill } from '../system'
import Button from '../ui/Button'
import { holdCandidates, releaseCandidates } from '../../api/exams'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

// Holding a student's admit card or result (services/examHolds.js): the "On hold" label with its reasons, and the
// dialog that holds or releases the students picked. `part`: 'admitCard' (Hall tickets) or 'result' (Report cards).

/** One reason in plain words: "Fees overdue: ₹4,500", "Attendance 68% (below 75%)", or what staff wrote. */
export function useHoldReason() {
  const { t } = useTranslation('exams')
  const { currencyValue } = useFormat()
  return (r) => (r.kind === 'FEES' ? t('exams.holds.why.FEES', { amount: currencyValue(r.amount / 100) })
    : r.kind === 'ATTENDANCE' ? t('exams.holds.why.ATTENDANCE', { pct: r.pct, below: r.below })
      : r.text || t('exams.holds.why.MANUAL'))
}

/** "On hold" with the reasons on hover — or nothing when it isn't held. A released rule shows as "Let through". */
export function HoldPill({ hold, part }) {
  const { t } = useTranslation('exams')
  const reason = useHoldReason()
  const h = hold?.[part]
  if (h?.held) return <span title={h.reasons.map(reason).join(' · ')}><StatusPill tone="danger">{t('exams.holds.onHold')}</StatusPill></span>
  if (h?.released) return <span className="text-xs text-ink-faint" title={t('exams.holds.releasedHint')}>{t('exams.holds.released')}</span>
  return null
}

/** The reasons, written out under a student's name (for a narrow column or a phone). */
export function HoldReasons({ hold, part }) {
  const reason = useHoldReason()
  const h = hold?.[part]
  if (!h?.held) return null
  return <span className="block text-xs text-danger-600">{h.reasons.map(reason).join(' · ')}</span>
}

/**
 * The bulk buttons and their dialog: Hold (with a reason and whether the family is told it) and Release.
 * `ids` the students picked, `onDone` clears the pick.
 */
export function HoldActions({ examId, ids, part, onDone }) {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ admitCard: part === 'admitCard', result: part === 'result', reason: '', showReason: false })
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['exam-candidates'] }); setOpen(false); onDone?.(); showSuccess(msg) }
  const hold = useMutation({ mutationFn: () => holdCandidates(examId, { candidateIds: ids, ...form }), onSuccess: (r) => done(t('exams.holds.heldN', { count: r.held })), onError: (e) => showError(e.message) })
  const release = useMutation({ mutationFn: () => releaseCandidates(examId, { candidateIds: ids, admitCard: part === 'admitCard', result: part === 'result' }), onSuccess: (r) => done(t('exams.holds.releasedN', { count: r.released })), onError: (e) => showError(e.message) })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  return (
    <>
      <Button size="sm" variant="secondary" icon={Lock} onClick={() => { setForm({ admitCard: part === 'admitCard', result: part === 'result', reason: '', showReason: false }); setOpen(true) }}>{t('exams.holds.hold')}</Button>
      <Button size="sm" variant="ghost" icon={LockOpen} loading={release.isPending} onClick={() => release.mutate()}>{t('exams.holds.release')}</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} size="md" title={t('exams.holds.title', { count: ids.length })}
          footer={<>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('exams.holds.cancel')}</Button>
            <Button icon={Lock} loading={hold.isPending} disabled={!form.admitCard && !form.result} onClick={() => hold.mutate()}>{t('exams.holds.hold')}</Button>
          </>}>
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink">{t('exams.holds.what')}</legend>
              <div className="flex flex-wrap gap-4 text-sm text-ink">
                <label className="inline-flex items-center gap-2"><input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={form.admitCard} onChange={set('admitCard')} />{t('exams.holds.admitCard')}</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={form.result} onChange={set('result')} />{t('exams.holds.result')}</label>
              </div>
            </fieldset>
            <FormField label={t('exams.holds.reason')} hint={t('exams.holds.reasonHint')}>
              <Input value={form.reason} maxLength={200} onChange={set('reason')} placeholder={t('exams.holds.reasonPlaceholder')} />
            </FormField>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" checked={form.showReason} onChange={set('showReason')} />
              <span>{t('exams.holds.showReason')}<span className="block text-xs text-ink-muted">{t('exams.holds.showReasonHint')}</span></span>
            </label>
          </div>
        </Modal>
      )}
    </>
  )
}
