import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Pencil, Plus, SkipForward, Trash2, Undo2 } from 'lucide-react'
import { LESSON_STATUS, addDaysYmd, weekOf } from '@schoolgiant/shared'
import { ColorChip, ControlChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, Select, StatCardRow, StatusPill, Textarea, localIso, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { createLessonPlan, deleteLessonPlan, fetchHomeworkLookup, fetchLessonPlans, fetchSyllabus, setLessonPlanStatus, updateLessonPlan } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function PlanForm({ lookup, plan, defaultDate, onClose, onSaved }) {
  const { t } = useTranslation('homework')
  const { showError } = useSnackbar()
  const sections = lookup?.sections ?? []
  const [form, setForm] = useState(() => ({
    sectionId: plan?.sectionId ?? sections[0]?.id ?? '', subjectId: plan?.subjectId ?? '', date: plan?.date ?? defaultDate, period: plan?.period ? String(plan.period) : '',
    title: plan?.title ?? '', topicIds: plan?.topicIds ?? [], objectives: plan?.objectives ?? '', method: plan?.method ?? '', resources: plan?.resources ?? '', homeworkNote: plan?.homeworkNote ?? '',
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const section = sections.find((s) => s.id === form.sectionId)
  const subjects = section?.subjects ?? []
  const { data: syllabus } = useQuery({ queryKey: ['syllabus', section?.classId, form.subjectId], queryFn: () => fetchSyllabus(section.classId, form.subjectId), enabled: !!section && !!form.subjectId })
  const doneHere = syllabus?.sections.find((s) => s.id === form.sectionId)?.ticks ?? {}
  const toggle = (id) => setForm((f) => ({ ...f, topicIds: f.topicIds.includes(id) ? f.topicIds.filter((x) => x !== id) : [...f.topicIds, id] }))
  const save = useMutation({
    mutationFn: () => (plan ? updateLessonPlan(plan.id, form) : createLessonPlan(form)),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={plan ? t('homework.lessons.form.editTitle') : t('homework.lessons.form.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.sectionId || !form.subjectId || !form.date || form.title.trim().length < 2} onClick={() => save.mutate()}>{t('homework.lessons.form.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('homework.lessons.form.class')} required>
          <Select value={form.sectionId} onChange={(e) => setForm((f) => ({ ...f, sectionId: e.target.value, subjectId: '', topicIds: [] }))}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </FormField>
        <FormField label={t('homework.lessons.form.subject')} required error={errors.subjectId}>
          <Select value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value, topicIds: [] }))}>
            <option value="">{t('homework.lessons.form.pickSubject')}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('homework.lessons.form.date')} required error={errors.date}><Input type="date" value={form.date} onChange={set('date')} /></FormField>
        <FormField label={t('homework.lessons.form.period')}><Input type="number" min="1" max="15" value={form.period} onChange={set('period')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('homework.lessons.form.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} placeholder={t('homework.lessons.form.titlePlaceholder')} /></FormField></div>
        {form.subjectId && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('homework.lessons.form.topics')}</p>
            {syllabus?.units.length ? (
              <div className="space-y-2 max-h-56 overflow-y-auto rounded-lg border border-border p-3">
                {syllabus.units.map((u) => (
                  <div key={u.id}>
                    <p className="text-xs font-semibold text-ink-muted">{u.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {u.topics.map((tp) => (
                        <label key={tp.id} className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={form.topicIds.includes(tp.id)} onChange={() => toggle(tp.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                          <span className={doneHere[tp.id] ? 'text-ink-faint' : ''}>{tp.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-faint">{t('homework.lessons.form.noSyllabus')}</p>}
            {errors.topicIds && <p className="text-xs text-danger-600 mt-1">{errors.topicIds}</p>}
          </div>
        )}
        <div className="sm:col-span-2"><FormField label={t('homework.lessons.form.objectives')}><Textarea rows={2} value={form.objectives} onChange={set('objectives')} placeholder={t('homework.lessons.form.objectivesPlaceholder')} /></FormField></div>
        <div className="sm:col-span-2"><FormField label={t('homework.lessons.form.method')}><Textarea rows={3} value={form.method} onChange={set('method')} placeholder={t('homework.lessons.form.methodPlaceholder')} /></FormField></div>
        <FormField label={t('homework.lessons.form.resources')}><Textarea rows={2} value={form.resources} onChange={set('resources')} /></FormField>
        <FormField label={t('homework.lessons.form.homeworkNote')}><Textarea rows={2} value={form.homeworkNote} onChange={set('homeworkNote')} /></FormField>
      </div>
    </Modal>
  )
}

export default function LessonPlans() {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [anchor, setAnchor] = useState(() => localIso(new Date()))
  const [sectionId, setSectionId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [editing, setEditing] = useState(null)
  const week = weekOf(anchor)
  const { data: lookup } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup })
  const sections = lookup?.sections ?? []
  const subjects = useMemo(() => {
    const m = new Map()
    for (const s of sections) for (const x of s.subjects) m.set(x.id, x)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sections])
  const params = { from: week.from, to: week.to, sectionId: sectionId || undefined, subjectId: subjectId || undefined }
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['lesson-plans', params], queryFn: () => fetchLessonPlans(params) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lesson-plans'] }); qc.invalidateQueries({ queryKey: ['syllabus'] }); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('homework.lesson-plans.edit')
  const statusLabel = (s) => t(`homework.lessons.status.${s}`, LESSON_STATUS[s]?.label ?? s)
  const countOf = (s) => rows.filter((r) => r.status === s).length

  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={t('homework.lessons.title')} subtitle={t('homework.lessons.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="homework.lesson-plans.create" onClick={() => setEditing('new')}>{t('homework.lessons.new')}</HeaderButton>} />
      {lookup && !sections.length && <Note tone="warning" className="mb-4">{t('homework.noSections')}</Note>}
      {rows.length > 0 && <StatCardRow className="mb-4" items={[
        { icon: ClipboardList, tone: 'brand', label: t('homework.lessons.summary.total'), value: rows.length, sub: t('homework.lessons.week', { from: date(week.from), to: date(week.to) }) },
        { icon: CheckCircle2, tone: 'success', label: statusLabel('DONE'), value: countOf('DONE'), progress: (countOf('DONE') / rows.length) * 100 },
        { icon: CalendarClock, tone: 'info', label: statusLabel('PLANNED'), value: countOf('PLANNED') },
        { icon: SkipForward, tone: countOf('SKIPPED') ? 'warning' : 'neutral', label: statusLabel('SKIPPED'), value: countOf('SKIPPED') },
      ]} />}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label={t('homework.lessons.prevWeek')} onClick={() => setAnchor(addDaysYmd(week.from, -7))} />
            <span className="text-sm font-medium text-ink px-1">{t('homework.lessons.week', { from: date(week.from), to: date(week.to) })}</span>
            <Button size="sm" variant="ghost" icon={ChevronRight} aria-label={t('homework.lessons.nextWeek')} onClick={() => setAnchor(addDaysYmd(week.from, 7))} />
            <Button size="sm" variant="ghost" onClick={() => setAnchor(localIso(new Date()))}>{t('homework.lessons.thisWeek')}</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <ControlChip label={t('homework.class')} value={sections.find((s) => s.id === sectionId)?.short ?? t('homework.all')} active={!!sectionId}
              options={[t('homework.all'), ...sections.map((s) => s.short)]} onChange={(v) => setSectionId(sections.find((s) => s.short === v)?.id ?? '')} />
            <ControlChip label={t('homework.subject')} value={subjects.find((s) => s.id === subjectId)?.name ?? t('homework.all')} active={!!subjectId}
              options={[t('homework.all'), ...subjects.map((s) => s.name)]} onChange={(v) => setSubjectId(subjects.find((s) => s.name === v)?.id ?? '')} />
          </div>
        </div>}
        columns={[
          { key: 'date', header: t('homework.lessons.date'), nowrap: true, render: (v, r) => <span>{date(v)}{r.period ? <span className="text-ink-faint"> · {t('homework.lessons.periodN', { n: r.period })}</span> : ''}</span> },
          { key: 'section', header: t('homework.class'), render: (v, r) => <div className="flex flex-wrap items-center gap-1"><ColorChip label={v} seed={r.classId ?? v} /><ColorChip label={r.subject} seed={r.subjectId} dot /></div> },
          { key: 'title', header: t('homework.lessons.lesson'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p>{r.topics.length > 0 && <p className="text-xs text-ink-faint line-clamp-1">{r.topics.join(', ')}</p>}{r.reflection && <p className="text-xs text-ink-muted italic line-clamp-1">{r.reflection}</p>}</div> },
          { key: 'teacher', header: t('homework.lessons.teacher'), mobileHidden: true, render: (v) => <PersonCell name={v} size={26} /> },
          { key: 'status', header: t('homework.lessons.statusLabel'), render: (v) => <StatusPill tone={LESSON_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 160, render: (id, r) => r.canChange && canEdit && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'PLANNED' ? <>
                <Button size="sm" variant="ghost" icon={Check} title={t('homework.lessons.markDone')} aria-label={t('homework.lessons.markDone')}
                  onClick={async () => { const reflection = await prompt({ title: t('homework.lessons.doneConfirm.title', { title: r.title }), message: r.topics.length ? t('homework.lessons.doneConfirm.withTopics', { count: r.topics.length }) : t('homework.lessons.doneConfirm.message'), label: t('homework.lessons.reflection'), required: false }); if (reflection !== null) act.mutate({ fn: () => setLessonPlanStatus(id, { status: 'DONE', reflection: reflection || undefined }), done: t('homework.lessons.markedDone') }) }} />
                <Button size="sm" variant="ghost" icon={SkipForward} title={t('homework.lessons.skip')} aria-label={t('homework.lessons.skip')} onClick={() => act.mutate({ fn: () => setLessonPlanStatus(id, { status: 'SKIPPED' }), done: t('homework.lessons.skipped') })} />
              </> : <Button size="sm" variant="ghost" icon={Undo2} title={t('homework.lessons.reopen')} aria-label={t('homework.lessons.reopen')} onClick={() => act.mutate({ fn: () => setLessonPlanStatus(id, { status: 'PLANNED' }), done: t('homework.lessons.reopened') })} />}
              <Button size="sm" variant="ghost" icon={Pencil} title={t('homework.lessons.edit')} aria-label={t('homework.lessons.edit')} onClick={() => setEditing(r)} />
              {hasPermission('homework.lesson-plans.delete') && <Button size="sm" variant="ghost" icon={Trash2} title={t('homework.lessons.delete')} aria-label={t('homework.lessons.delete')}
                onClick={async () => { if (await confirm({ title: t('homework.lessons.deleteConfirm', { title: r.title }), tone: 'danger', confirmLabel: t('homework.lessons.delete') })) act.mutate({ fn: () => deleteLessonPlan(id), done: t('homework.lessons.deleted') }) }} />}
            </div>
          ) },
        ]}
        onRowClick={canEdit ? (r) => r.canChange && setEditing(r) : undefined}
        emptyIcon={ClipboardList} emptyTitle={t('homework.lessons.empty')} emptyHint={t('homework.lessons.emptyHint')}
      />
      {editing && <PlanForm lookup={lookup} plan={editing === 'new' ? null : editing} defaultDate={anchor < week.from || anchor > week.to ? week.from : anchor}
        onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); showSuccess(t('homework.lessons.saved')) }} />}
    </PageContainer>
  )
}
