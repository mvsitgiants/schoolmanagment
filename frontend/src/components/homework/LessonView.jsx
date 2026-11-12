import { useState } from 'react'
import { useMutation, useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronDown, ChevronUp, ClipboardList, Goal, MessageSquareQuote, NotebookPen, Package, Pencil, Presentation, Trash2 } from 'lucide-react'
import { Skeleton, useConfirm } from '../system'
import Button from '../ui/Button'
import TopicPanel, { partsOf } from './TopicPanel'
import { deleteLessonPlan, fetchSyllabusTopic } from '../../api/homework'
import { useSnackbar } from '../../context/SnackbarContext'
import { hasPermission } from '../../api/auth'
import { MaterialView } from './LessonMaterial'

/** One labelled line of the lesson's own plan, with its icon; nothing when empty. */
function PlanLine({ icon: Icon, label, children }) {
  if (!children) return null
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-black/[0.04] text-ink-muted shrink-0"><Icon className="w-4 h-4" aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="text-sm text-ink whitespace-pre-line leading-relaxed">{children}</p>
      </div>
    </div>
  )
}

/** A syllabus topic the lesson covers: its name, unit and periods; opened, the shared topic panel (components/homework/TopicPanel). */
function TopicCard({ name, q, open, onToggle }) {
  const { t } = useTranslation('homework')
  const topic = q.data
  return (
    <div className={`rounded-xl border bg-surface transition ${open ? 'border-brand-200 shadow-sm' : 'border-border'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-start">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-600 shrink-0"><BookOpen className="w-[18px] h-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink leading-tight">{topic?.name ?? name}</span>
          <span className="block text-xs text-ink-muted mt-0.5">{[topic?.unit, topic?.periods && t('homework.lessons.view.periods', { count: topic.periods })].filter(Boolean).join(' · ')}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-ink-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          {q.isLoading ? <Skeleton className="h-24" /> : topic
            ? <TopicPanel topic={topic} parts={partsOf(topic)} lessons={false} link={topic} />
            : <p className="text-sm text-ink-faint">{t('homework.lessons.view.topicGone')}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * A lesson plan, read only, opened in place under its row (no drawer): how it went, the lesson's own plan, each syllabus
 * topic it covers (the first one open, as the shared topic panel), then its files — and Edit / Delete / Close at the end.
 * `onEdit` (when the person may change it) opens the form; `onClose` folds it away.
 */
export default function LessonView({ plan, onClose, onEdit, onDeleted }) {
  const { t } = useTranslation('homework')
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  // delete: the person may change this lesson and has the delete right (same rule as the list's bin button)
  const canDelete = !!onDeleted && plan.canChange && hasPermission('homework.lesson-plans.delete')
  const remove = useMutation({ mutationFn: () => deleteLessonPlan(plan.id), onSuccess: () => { showSuccess(t('homework.lessons.deleted')); onDeleted() }, onError: (e) => showError(e.message) })
  const ids = plan.topicIds ?? []
  const topics = useQueries({ queries: ids.map((id) => ({ queryKey: ['syllabus-topic', id], queryFn: () => fetchSyllabusTopic(id), staleTime: 60_000 })) })
  const [openIds, setOpenIds] = useState(() => new Set(ids.slice(0, 1)))
  const toggle = (id) => setOpenIds((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const hasPlan = plan.objectives || plan.method || plan.resources || plan.homeworkNote
  return (
    <div className="space-y-4">
      {plan.reflection && (
        <div className="flex items-start gap-3 rounded-lg border border-success-200 bg-success-50/60 px-3 py-2.5">
          <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden />
          <div><p className="text-xs font-semibold text-success-700">{t('homework.lessons.view.howItWent')}</p><p className="whitespace-pre-line text-sm text-ink">{plan.reflection}</p></div>
        </div>
      )}

      {hasPlan && (
        <section>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink"><ClipboardList className="h-4 w-4 text-brand-600" aria-hidden />{t('homework.lessons.view.plan')}</h3>
          <div className="divide-y divide-border rounded-lg border border-border px-3">
            <PlanLine icon={Goal} label={t('homework.lessons.form.objectives')}>{plan.objectives}</PlanLine>
            <PlanLine icon={Presentation} label={t('homework.lessons.form.method')}>{plan.method}</PlanLine>
            <PlanLine icon={Package} label={t('homework.lessons.form.resources')}>{plan.resources}</PlanLine>
            <PlanLine icon={NotebookPen} label={t('homework.lessons.form.homeworkNote')}>{plan.homeworkNote}</PlanLine>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><BookOpen className="h-4 w-4 text-brand-600" aria-hidden />{t('homework.lessons.view.topics', { count: ids.length })}</h3>
        {ids.length ? (
          <div className="space-y-2">
            {ids.map((id, i) => <TopicCard key={id} name={plan.topics?.[i]} q={topics[i]} open={openIds.has(id)} onToggle={() => toggle(id)} />)}
          </div>
        ) : <p className="text-sm text-ink-faint">{t('homework.lessons.view.noTopics')}</p>}
      </section>

      <MaterialView plan={plan} />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {canDelete && (
          <Button size="sm" variant="ghost" icon={Trash2} className="me-auto text-danger-600 hover:bg-danger-50" loading={remove.isPending}
            onClick={async () => { if (await confirm({ title: t('homework.lessons.deleteConfirm', { title: plan.title }), tone: 'danger', confirmLabel: t('homework.lessons.delete') })) remove.mutate() }}>{t('homework.lessons.delete')}</Button>
        )}
        {onClose && <Button size="sm" variant="ghost" icon={ChevronUp} onClick={onClose}>{t('homework.lessons.view.close')}</Button>}
        {onEdit && <Button size="sm" icon={Pencil} onClick={onEdit}>{t('homework.lessons.edit')}</Button>}
      </div>
    </div>
  )
}
