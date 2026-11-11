import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarDays, ChevronDown, ClipboardList, Goal, MessageSquareQuote, NotebookPen, Package, Pencil, Presentation, Trash2 } from 'lucide-react'
import { LESSON_STATUS } from '@schoolgiant/shared'
import { Avatar, ColorChip, Drawer, Skeleton, StatusPill, useConfirm } from '../system'
import Button from '../ui/Button'
import { TopicMaterial } from './TopicKit'
import { deleteLessonPlan, fetchSyllabusTopic } from '../../api/homework'
import { useSnackbar } from '../../context/SnackbarContext'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
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

/** A syllabus topic the lesson covers, opening to its teaching material. */
function TopicCard({ name, q, open, onToggle }) {
  const { t } = useTranslation('homework')
  const topic = q.data
  const empty = topic && !topic.book?.name && !topic.book?.pages && !topic.howTo && !topic.keyPoints?.length && !topic.questions?.length && !topic.homeworkHint
  return (
    <div className={`rounded-xl border bg-surface transition ${open ? 'border-brand-200 shadow-sm' : 'border-border'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-start">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-600 shrink-0"><BookOpen className="w-[18px] h-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink leading-tight">{topic?.name ?? name}</span>
          <span className="block text-xs text-ink-muted mt-0.5">{[topic?.unit, topic?.periods && t('homework.lessons.view.periods', { count: topic.periods })].filter(Boolean).join(' · ')}</span>
        </span>
        {empty && <StatusPill tone="neutral">{t('homework.lessons.view.noMaterial')}</StatusPill>}
        <ChevronDown className={`w-4 h-4 text-ink-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4">
          {q.isLoading ? <Skeleton className="h-24" /> : topic ? (
            <>
              <TopicMaterial topic={topic} />
              {empty && hasPermission('homework.syllabus.edit') && (
                <Link to="/homework/syllabus" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">{t('homework.lessons.view.addMaterial')}</Link>
              )}
            </>
          ) : <p className="text-sm text-ink-faint">{t('homework.lessons.view.topicGone')}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * A lesson plan, read only: a summary (class, subject, when, teacher, status), how it went, the lesson's own plan, and
 * every syllabus topic it covers opened to its teaching material. `onEdit` (when the person may change it) opens the form.
 */
export default function LessonView({ plan, onClose, onEdit, onDeleted }) {
  const { t } = useTranslation('homework')
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  // delete: the person may change this lesson and has the delete right (same rule as the list's bin button)
  const canDelete = !!onDeleted && plan.canChange && hasPermission('homework.lesson-plans.delete')
  const remove = useMutation({ mutationFn: () => deleteLessonPlan(plan.id), onSuccess: () => { showSuccess(t('homework.lessons.deleted')); onDeleted() }, onError: (e) => showError(e.message) })
  const { date } = useFormat()
  const ids = plan.topicIds ?? []
  const topics = useQueries({ queries: ids.map((id) => ({ queryKey: ['syllabus-topic', id], queryFn: () => fetchSyllabusTopic(id), staleTime: 60_000 })) })
  const [openIds, setOpenIds] = useState(() => new Set(ids.slice(0, 1)))
  const toggle = (id) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const status = LESSON_STATUS[plan.status]
  const hasPlan = plan.objectives || plan.method || plan.resources || plan.homeworkNote
  return (
    <Drawer open onClose={onClose} size="xl" title={plan.title} subtitle={t('homework.lessons.view.subtitle')}
      footer={(onEdit || canDelete) && (
        <div className="flex items-center justify-between gap-2">
          {canDelete ? <Button variant="ghost" icon={Trash2} className="text-danger-600 hover:bg-danger-50" loading={remove.isPending}
            onClick={async () => { if (await confirm({ title: t('homework.lessons.deleteConfirm', { title: plan.title }), tone: 'danger', confirmLabel: t('homework.lessons.delete') })) remove.mutate() }}>{t('homework.lessons.delete')}</Button> : <span />}
          {onEdit && <Button icon={Pencil} onClick={onEdit}>{t('homework.lessons.edit')}</Button>}
        </div>
      )}>
      <div className="space-y-5">
        {/* summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl border border-border bg-border overflow-hidden">
          <div className="bg-surface px-3 py-2.5 min-w-0">
            <p className="text-xs text-ink-muted mb-1">{t('homework.class')}</p>
            <div className="flex flex-wrap gap-1"><ColorChip label={plan.section} seed={plan.classId ?? plan.section} /><ColorChip label={plan.subject} seed={plan.subjectId} dot /></div>
          </div>
          <div className="bg-surface px-3 py-2.5 min-w-0">
            <p className="text-xs text-ink-muted mb-1">{t('homework.lessons.view.when')}</p>
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><CalendarDays className="w-4 h-4 text-ink-faint" />{date(plan.date)}</p>
            {plan.period && <p className="text-xs text-ink-muted">{t('homework.lessons.periodN', { n: plan.period })}</p>}
          </div>
          <div className="bg-surface px-3 py-2.5 min-w-0">
            <p className="text-xs text-ink-muted mb-1">{t('homework.lessons.teacher')}</p>
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink truncate">{plan.teacher ? <><Avatar name={plan.teacher} size={22} soft /><span className="truncate">{plan.teacher}</span></> : '—'}</p>
          </div>
          <div className="bg-surface px-3 py-2.5 min-w-0">
            <p className="text-xs text-ink-muted mb-1">{t('homework.lessons.statusLabel')}</p>
            <StatusPill tone={status?.tone}>{t(`homework.lessons.status.${plan.status}`, status?.label ?? plan.status)}</StatusPill>
          </div>
        </div>

        {plan.reflection && (
          <div className="flex items-start gap-3 rounded-xl border border-success-200 bg-success-50/60 px-4 py-3">
            <MessageSquareQuote className="w-5 h-5 mt-0.5 shrink-0 text-success-600" />
            <div><p className="text-xs font-semibold text-success-700">{t('homework.lessons.view.howItWent')}</p><p className="text-sm text-ink whitespace-pre-line">{plan.reflection}</p></div>
          </div>
        )}

        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink mb-2"><BookOpen className="w-4 h-4 text-brand-600" />{t('homework.lessons.view.topics', { count: ids.length })}</h3>
          {ids.length ? (
            <div className="space-y-2.5">
              {ids.map((id, i) => <TopicCard key={id} name={plan.topics?.[i]} q={topics[i]} open={openIds.has(id)} onToggle={() => toggle(id)} />)}
            </div>
          ) : <p className="text-sm text-ink-faint">{t('homework.lessons.view.noTopics')}</p>}
        </section>

        {hasPlan && (
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink mb-1"><ClipboardList className="w-4 h-4 text-brand-600" />{t('homework.lessons.view.plan')}</h3>
            <div className="rounded-xl border border-border px-3 divide-y divide-border">
              <PlanLine icon={Goal} label={t('homework.lessons.form.objectives')}>{plan.objectives}</PlanLine>
              <PlanLine icon={Presentation} label={t('homework.lessons.form.method')}>{plan.method}</PlanLine>
              <PlanLine icon={Package} label={t('homework.lessons.form.resources')}>{plan.resources}</PlanLine>
              <PlanLine icon={NotebookPen} label={t('homework.lessons.form.homeworkNote')}>{plan.homeworkNote}</PlanLine>
            </div>
          </section>
        )}

        <MaterialView plan={plan} />
      </div>
    </Drawer>
  )
}
