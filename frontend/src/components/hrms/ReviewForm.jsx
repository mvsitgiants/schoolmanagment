import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RATING_SCALE, weightedScore } from '@schoolgiant/shared'
import { FormField, Modal, Note, Textarea } from '../system'
import Button from '../ui/Button'
import { useSnackbar } from '../../context/SnackbarContext'
import clsx from 'clsx'

/** Ratings 1–5 per criterion, as buttons. */
export function RatingRows({ criteria, value, onChange, readOnly = false, compare }) {
  const { t } = useTranslation('hrms')
  return (
    <div className="space-y-3">
      {criteria.map((c) => (
        <div key={c.key} className="grid sm:grid-cols-[1fr_auto] gap-2 items-center">
          <div>
            <p className="text-sm text-ink">{c.label}</p>
            {compare?.[c.key] && <p className="text-[11px] text-ink-faint">{t('hrms.performance.selfSaid', { n: compare[c.key] })}</p>}
          </div>
          <div className="flex gap-1">
            {RATING_SCALE.map((r) => (
              <button key={r.value} type="button" disabled={readOnly} title={t(`hrms.performance.scale.${r.value}`)} onClick={() => onChange?.({ ...value, [c.key]: r.value })}
                className={clsx('h-8 w-8 rounded-lg border text-sm font-semibold', value?.[c.key] === r.value ? 'bg-brand-500 text-white border-brand-500' : 'border-border text-ink-muted hover:bg-bg', readOnly && 'cursor-default')}>
                {r.value}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The self review (`mode="self"`) or the reviewer's (`mode="manager"`) of one appraisal. */
export default function ReviewForm({ review, mode, submit, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const criteria = review.cycle?.criteria ?? []
  const part = mode === 'self' ? review.self : review.manager
  const [ratings, setRatings] = useState(part?.ratings ?? {})
  const [text, setText] = useState({ comments: part?.comments ?? '', strengths: part?.strengths ?? '', improve: part?.improve ?? '', goals: part?.goals ?? '' })
  const score = weightedScore(criteria, ratings)
  const save = useMutation({ mutationFn: () => submit({ ratings, ...(mode === 'self' ? { comments: text.comments } : text) }), onSuccess: onSaved, onError: (e) => showError(e.message) })
  const set = (k) => (e) => setText((x) => ({ ...x, [k]: e.target.value }))
  return (
    <Modal open onClose={onClose} size="lg" title={mode === 'self' ? t('hrms.performance.selfTitle', { cycle: review.cycle?.name ?? '' }) : t('hrms.performance.rateTitle', { name: review.employeeName })} footer={<>
      <span className="mr-auto text-sm text-ink-muted">{score !== null ? t('hrms.performance.score', { n: score }) : t('hrms.performance.rateAll')}</span>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={score === null} onClick={() => save.mutate()}>{t('hrms.performance.send')}</Button>
    </>}>
      <div className="space-y-4">
        {mode === 'manager' && review.self?.comments && <Note>{t('hrms.performance.theirComments', { text: review.self.comments })}</Note>}
        <RatingRows criteria={criteria} value={ratings} onChange={setRatings} compare={mode === 'manager' ? review.self?.ratings : undefined} />
        <p className="text-[11px] text-ink-faint">{RATING_SCALE.map((r) => `${r.value} ${t(`hrms.performance.scale.${r.value}`)}`).join(' · ')}</p>
        <FormField label={t('hrms.performance.comments')}><Textarea rows={3} value={text.comments} onChange={set('comments')} /></FormField>
        {mode === 'manager' && <>
          <FormField label={t('hrms.performance.strengths')}><Textarea rows={2} value={text.strengths} onChange={set('strengths')} /></FormField>
          <FormField label={t('hrms.performance.improve')}><Textarea rows={2} value={text.improve} onChange={set('improve')} /></FormField>
          <FormField label={t('hrms.performance.goals')}><Textarea rows={2} value={text.goals} onChange={set('goals')} /></FormField>
        </>}
      </div>
    </Modal>
  )
}
