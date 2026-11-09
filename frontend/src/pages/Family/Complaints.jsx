import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CheckCircle2, Clock, MessageSquareWarning, Plus, Send } from 'lucide-react'
import { FO_COMPLAINT_CATEGORIES, FO_COMPLAINT_STATUS } from '@schoolgiant/shared'
import { StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyComplaints, familyRaiseComplaint } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const FLOW = ['OPEN', 'IN_PROGRESS', 'RESOLVED']

/** The family app › Complaints: raise a complaint or concern about the child's school life, and follow it to resolution. */
export default function FamilyComplaints() {
  const { t } = useTranslation('frontoffice')
  const { slug, studentId, student } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const [writing, setWriting] = useState(false)
  const [f, setF] = useState({ category: 'ACADEMICS', subject: '', description: '' })
  const key = ['family', slug, studentId, 'complaints']
  const { data, isLoading, error } = useFamilyQuery(['complaints'], () => familyComplaints(slug, studentId))
  const raise = useMutation({
    mutationFn: () => familyRaiseComplaint(slug, studentId, f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setWriting(false); setF({ category: 'ACADEMICS', subject: '', description: '' }) },
  })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const rows = data?.rows ?? []
  return (
    <>
      {writing ? (
        <FCard title={t('frontoffice.family.newTitle', { name: student?.firstName ?? '' })}>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">{t('frontoffice.family.about')}</p>
              <div className="flex flex-wrap gap-2">
                {FO_COMPLAINT_CATEGORIES.map((c) => (
                  <button key={c.value} type="button" onClick={() => setF({ ...f, category: c.value })}
                    className={clsx('min-h-[40px] rounded-full border px-3 text-sm', f.category === c.value ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-ink-muted')}>
                    {t(`frontoffice.categories.${c.value}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">{t('frontoffice.family.subject')}</span>
              <input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={150} className="h-12 w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-ink focus:border-brand-400 focus:outline-none" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">{t('frontoffice.family.details')}</span>
              <textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[15px] text-ink focus:border-brand-400 focus:outline-none" />
            </label>
            {raise.error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">{raise.error.message}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setWriting(false)} className="h-12 flex-1 rounded-xl border border-border text-sm font-medium text-ink">{t('frontoffice.common.cancel')}</button>
              <button type="button" disabled={raise.isPending || f.subject.trim().length < 3} onClick={() => raise.mutate()} className="inline-flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" />{t('frontoffice.family.send')}</button>
            </div>
          </div>
        </FCard>
      ) : (
        <button type="button" onClick={() => setWriting(true)} className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-300 bg-brand-50/60 text-[15px] font-semibold text-brand-700">
          <Plus className="h-5 w-5" />{t('frontoffice.family.raise')}
        </button>
      )}
      {raise.isSuccess && !writing && <p className="rounded-xl bg-success-50 px-3 py-2 text-sm text-success-700">{t('frontoffice.family.sent')}</p>}
      {!rows.length ? (
        <FCard><FEmpty icon={MessageSquareWarning} title={t('frontoffice.family.none')} hint={t('frontoffice.family.noneHint')} /></FCard>
      ) : rows.map((c) => {
        const step = FLOW.indexOf(c.status === 'CLOSED' ? 'RESOLVED' : c.status)
        return (
          <FCard key={c.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-[15px] font-semibold text-ink">{c.subject}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{c.complaintNo} · {t(`frontoffice.categories.${c.category}`)} · {date(c.date)}</p>
              </div>
              <StatusPill tone={FO_COMPLAINT_STATUS[c.status]?.tone}>{t(`frontoffice.complaintStatus.${c.status}`)}</StatusPill>
            </div>
            {/* progress: raised → being looked at → resolved */}
            <div className="mt-3 flex items-center gap-1.5" aria-hidden>
              {FLOW.map((s, i) => <span key={s} className={clsx('h-1.5 flex-1 rounded-full', i <= step ? (step === 2 ? 'bg-success-500' : 'bg-brand-500') : 'bg-black/[0.08]')} />)}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-ink-faint">{FLOW.map((s) => <span key={s}>{t(`frontoffice.family.flow.${s}`)}</span>)}</div>
            {c.description && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-muted">{c.description}</p>}
            {c.resolution && (
              <div className="mt-3 flex gap-2 rounded-xl bg-success-50 p-3 text-sm text-success-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span className="whitespace-pre-wrap">{c.resolution}</span>
              </div>
            )}
            {['OPEN', 'IN_PROGRESS'].includes(c.status) && c.dueOn && (
              <p className={clsx('mt-3 inline-flex items-center gap-1 text-xs', c.overdue ? 'text-danger-600' : 'text-ink-muted')}><Clock className="h-3.5 w-3.5" />{t('frontoffice.family.expected', { date: date(c.dueOn) })}</p>
            )}
          </FCard>
        )
      })}
    </>
  )
}
