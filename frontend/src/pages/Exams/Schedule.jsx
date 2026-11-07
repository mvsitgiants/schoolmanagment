import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, CalendarRange, ChevronLeft, ClipboardList, Pencil, Plus, Send, Trash2, Undo2, Wand2, X } from 'lucide-react'
import { EXAM_STATUS, addMinutes, clashes } from '@schoolgiant/shared'
import { ControlChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, ProgressBar, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup, fetchGrading } from '../../api/academics'
import { createExam, deleteExam, fetchExam, fetchExamTypes, fetchExams, savePapers, scheduleExam, suggestPapers, unscheduleExam, updateExam } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const statusLabel = (t, s) => t(`exams.status.${s}`, EXAM_STATUS[s]?.label ?? s)

/** New exam / edit its name, type, classes, grading and hall-ticket instructions. */
function ExamForm({ exam, year, onClose, onSaved }) {
  const { t } = useTranslation('exams')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data: types = [] } = useQuery({ queryKey: ['exam-types'], queryFn: fetchExamTypes })
  const { data: schemes = [] } = useQuery({ queryKey: ['grading'], queryFn: fetchGrading })
  const [form, setForm] = useState({
    name: exam?.name ?? '', examTypeId: exam?.examTypeId ?? '', term: exam?.term ?? '', classIds: exam?.classIds ?? [],
    gradingSchemeId: exam?.gradingSchemeId ?? '', instructions: exam?.instructions ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const toggle = (id) => setForm((f) => ({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id] }))
  const pickType = (e) => {
    const type = types.find((x) => x.id === e.target.value)
    setForm((f) => ({ ...f, examTypeId: e.target.value, name: f.name || (type ? `${type.name} ${year?.name ?? ''}`.trim() : '') }))
  }
  const save = useMutation({
    mutationFn: () => (exam ? updateExam(exam.id, { ...form, academicYearId: year?.id }) : createExam({ ...form, academicYearId: year?.id })),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const classes = lookup?.classes ?? []
  return (
    <Modal open onClose={onClose} size="lg" title={exam ? t('exams.schedule.editTitle') : t('exams.schedule.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !form.classIds.length} onClick={() => save.mutate()}>{t('exams.schedule.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('exams.schedule.type')}>
          <Select value={form.examTypeId} onChange={pickType}>
            <option value="">{t('exams.schedule.noType')}</option>
            {types.filter((x) => x.active || x.id === form.examTypeId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('exams.schedule.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('exams.schedule.namePlaceholder')} /></FormField>
        <FormField label={t('exams.schedule.term')}>
          <Select value={form.term} onChange={set('term')}>
            <option value="">{t('exams.schedule.noTerm')}</option>
            {(year?.terms ?? []).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('exams.schedule.grading')} hint={t('exams.schedule.gradingHint')}>
          <Select value={form.gradingSchemeId} onChange={set('gradingSchemeId')}>
            <option value="">{t('exams.schedule.classGrading')}</option>
            {schemes.filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <p className="text-xs font-medium text-ink-muted mb-2">{t('exams.schedule.classes')} <span className="text-danger-500">*</span></p>
          <div className="flex flex-wrap gap-2">
            {classes.map((c) => (
              <label key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                <input type="checkbox" checked={form.classIds.includes(c.id)} onChange={() => toggle(c.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                {c.name}
              </label>
            ))}
          </div>
          {errors.classIds && <p className="text-xs text-danger-600 mt-1">{errors.classIds}</p>}
        </div>
        <div className="sm:col-span-2"><FormField label={t('exams.schedule.instructions')} hint={t('exams.schedule.instructionsHint')}><Textarea rows={3} value={form.instructions} onChange={set('instructions')} /></FormField></div>
      </div>
    </Modal>
  )
}

const blankPaper = { subjectId: '', date: '', startTime: '09:30', endTime: '12:30', maxMarks: '80', passMarks: '27', gradeOnly: false, countsInTotal: true }

/** A class's timetable for the exam: one row per subject. */
function PapersEditor({ exam, cls, onClose, onSaved }) {
  const { t } = useTranslation('exams')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [rows, setRows] = useState(() => cls.papers.map((p) => ({
    subjectId: p.subjectId, date: p.date ?? '', startTime: p.startTime ?? '', endTime: p.endTime ?? '', maxMarks: String(p.maxMarks ?? ''), passMarks: String(p.passMarks ?? ''), gradeOnly: !!p.gradeOnly, countsInTotal: p.countsInTotal !== false,
  })))
  const [errors, setErrors] = useState({})
  const [filling, setFilling] = useState(false)
  const setRow = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const subjects = lookup?.subjects ?? []
  const fill = async () => {
    setFilling(true)
    try {
      const list = await suggestPapers(exam.id, cls.id)
      setRows((r) => [...r, ...list.filter((s) => !r.some((x) => x.subjectId === s.subjectId)).map((s) => ({ ...blankPaper, subjectId: s.subjectId, maxMarks: String(s.maxMarks), passMarks: String(s.passMarks), gradeOnly: s.gradeOnly, countsInTotal: s.countsInTotal }))])
    } catch (e) { showError(e.message) } finally { setFilling(false) }
  }
  const clash = useMemo(() => new Set(clashes(rows).flat()), [rows])
  const save = useMutation({
    mutationFn: () => savePapers(exam.id, cls.id, rows.filter((r) => r.subjectId).map((r) => ({ ...r, maxMarks: Number(r.maxMarks) || 0, passMarks: Number(r.passMarks) || 0 }))),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const err = (i, k) => errors[`papers.${i}.${k}`]
  return (
    <Modal open onClose={onClose} size="xl" title={t('exams.papers.title', { cls: cls.name, exam: exam.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('exams.papers.save')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 justify-between">
          <Button size="sm" variant="secondary" icon={Wand2} loading={filling} onClick={fill}>{t('exams.papers.fill')}</Button>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((r) => [...r, { ...blankPaper, date: r.at(-1)?.date ?? '' }])}>{t('exams.papers.add')}</Button>
        </div>
        {!rows.length && <Note>{t('exams.papers.emptyHint')}</Note>}
        {rows.map((r, i) => (
          <div key={i} className={`grid grid-cols-2 md:grid-cols-[1.6fr_1fr_.8fr_.8fr_.7fr_.7fr_auto_auto] gap-2 items-start rounded-lg p-2 ${clash.has(i) ? 'bg-amber-50' : ''}`}>
            <FormField label={i === 0 ? t('exams.papers.subject') : undefined} error={err(i, 'subjectId')}>
              <Select value={r.subjectId} onChange={(e) => setRow(i, 'subjectId', e.target.value)}>
                <option value="">{t('exams.papers.pickSubject')}</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </FormField>
            <FormField label={i === 0 ? t('exams.papers.date') : undefined} error={err(i, 'date')}><Input type="date" value={r.date} onChange={(e) => setRow(i, 'date', e.target.value)} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.start') : undefined} error={err(i, 'startTime')}><Input type="time" value={r.startTime} onChange={(e) => setRow(i, 'startTime', e.target.value)} onBlur={() => !r.endTime && r.startTime && setRow(i, 'endTime', addMinutes(r.startTime, 180))} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.end') : undefined} error={err(i, 'endTime')}><Input type="time" value={r.endTime} onChange={(e) => setRow(i, 'endTime', e.target.value)} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.max') : undefined} error={err(i, 'maxMarks')}><Input type="number" min="0" disabled={r.gradeOnly} value={r.gradeOnly ? '' : r.maxMarks} onChange={(e) => setRow(i, 'maxMarks', e.target.value)} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.pass') : undefined} error={err(i, 'passMarks')}><Input type="number" min="0" disabled={r.gradeOnly} value={r.gradeOnly ? '' : r.passMarks} onChange={(e) => setRow(i, 'passMarks', e.target.value)} /></FormField>
            <label className={`inline-flex items-center gap-1.5 text-xs text-ink-muted h-9 ${i === 0 ? 'md:mt-6' : ''}`} title={t('exams.papers.gradeOnlyHint')}>
              <input type="checkbox" checked={r.gradeOnly} onChange={(e) => setRow(i, 'gradeOnly', e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t('exams.papers.gradeOnly')}
            </label>
            <Button size="sm" variant="ghost" icon={X} className={i === 0 ? 'md:mt-6' : ''} aria-label={t('exams.papers.remove')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} />
          </div>
        ))}
        {clash.size > 0 && <Note tone="warning">{t('exams.papers.clash')}</Note>}
        {errors.papers && <Note tone="danger">{errors.papers}</Note>}
      </div>
    </Modal>
  )
}

/** One exam: its classes and papers, and the step it is at. */
function ExamDetail({ examId, onBack }) {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [editingClass, setEditingClass] = useState(null)
  const { data: exam, isLoading, error } = useQuery({ queryKey: ['exam', examId], queryFn: () => fetchExam(examId) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['exam', examId] }); qc.invalidateQueries({ queryKey: ['exams'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('exams.loading')}</p>
  if (error || !exam) return <Note tone="warning">{error?.message}</Note>
  const canEdit = hasPermission('exams.schedule.edit') && exam.status !== 'PUBLISHED'
  const missing = exam.classes.filter((c) => !c.papers.length).length + exam.classes.flatMap((c) => c.papers).filter((p) => !p.date).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('exams.schedule.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{exam.name}</p>
            <p className="text-xs text-ink-muted">{exam.startDate ? `${date(exam.startDate)}${exam.endDate !== exam.startDate ? ` – ${date(exam.endDate)}` : ''}` : t('exams.schedule.noDates')}{exam.term ? ` · ${exam.term}` : ''}</p>
          </div>
          <StatusPill tone={EXAM_STATUS[exam.status]?.tone}>{statusLabel(t, exam.status)}</StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          {exam.status === 'DRAFT' && hasPermission('exams.schedule.edit') && <Button icon={Send} loading={act.isPending}
            onClick={async () => { if (await confirm({ title: t('exams.schedule.scheduleConfirm.title', { name: exam.name }), message: t('exams.schedule.scheduleConfirm.message'), confirmLabel: t('exams.schedule.schedule') })) act.mutate({ fn: () => scheduleExam(exam.id), done: t('exams.schedule.scheduled') }) }}>
            {t('exams.schedule.schedule')}
          </Button>}
          {exam.status === 'SCHEDULED' && hasPermission('exams.schedule.edit') && <Button variant="secondary" icon={Undo2} onClick={() => act.mutate({ fn: () => unscheduleExam(exam.id), done: t('exams.schedule.unscheduled') })}>{t('exams.schedule.unschedule')}</Button>}
        </div>
      </div>
      {exam.status === 'DRAFT' && missing > 0 && <Note tone="warning">{t('exams.schedule.missingHint')}</Note>}
      {exam.status === 'SCHEDULED' && <Note>{t('exams.schedule.scheduledHint')}</Note>}
      {exam.classes.map((c) => (
        <Panel key={c.id} title={c.name} subtitle={t('exams.schedule.paperCount', { count: c.papers.length })} flush
          actions={canEdit && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditingClass(c)}>{t('exams.schedule.editPapers')}</Button>}>
          <DataTable
            rows={c.papers}
            dense
            className="border-0 shadow-none"
            columns={[
              { key: 'date', header: t('exams.papers.date'), nowrap: true, render: (v) => (v ? date(v) : <span className="text-danger-600">{t('exams.schedule.noDate')}</span>) },
              { key: 'startTime', header: t('exams.papers.time'), nowrap: true, render: (v, r) => (v ? `${v}${r.endTime ? ` – ${r.endTime}` : ''}` : '—') },
              { key: 'subject', header: t('exams.papers.subject'), mobilePrimary: true },
              { key: 'maxMarks', header: t('exams.papers.max'), align: 'right', render: (v, r) => (r.gradeOnly ? t('exams.papers.gradeOnly') : v) },
              { key: 'passMarks', header: t('exams.papers.pass'), align: 'right', render: (v, r) => (r.gradeOnly ? '—' : v) },
            ]}
            emptyIcon={ClipboardList} emptyTitle={t('exams.schedule.noPapers')}
          />
        </Panel>
      ))}
      {editingClass && <PapersEditor exam={exam} cls={editingClass} onClose={() => setEditingClass(null)} onSaved={() => { refresh(); setEditingClass(null); showSuccess(t('exams.papers.saved')) }} />}
    </div>
  )
}

export default function Schedule() {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const openId = params.get('exam')
  const [yearId, setYearId] = useState('')
  const [editing, setEditing] = useState(null)
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['exams', yearId], queryFn: () => fetchExams(yearId) })
  const years = lookup?.years ?? []
  const year = data?.year
  const open = (id) => setParams(id ? { exam: id } : {})
  const remove = useMutation({ mutationFn: (id) => deleteExam(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['exams'] }); showSuccess(t('exams.schedule.deleted')) }, onError: (e) => showError(e.message) })

  return (
    <PageContainer>
      <PageHeader icon={CalendarRange} title={t('exams.schedule.title')} subtitle={t('exams.schedule.subtitle')}
        actions={!openId && <HeaderButton icon={Plus} variant="primary" requires="exams.schedule.create" onClick={() => setEditing('new')}>{t('exams.schedule.new')}</HeaderButton>} />
      {openId ? <ExamDetail examId={openId} onBack={() => open(null)} /> : (
        <DataTable
          rows={data?.exams ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          toolbar={<div className="flex justify-end">
            <ControlChip label={t('exams.schedule.year')} value={year?.name ?? '—'} active={!!yearId} options={years.map((y) => y.name)} onChange={(v) => setYearId(years.find((y) => y.name === v)?.id ?? '')} />
          </div>}
          columns={[
            { key: 'name', header: t('exams.schedule.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.typeName, r.term].filter(Boolean).join(' · ') || '—'}</p></div> },
            { key: 'classes', header: t('exams.schedule.classes'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{v.map((c) => c.code).join(', ')}</span> },
            { key: 'startDate', header: t('exams.schedule.dates'), nowrap: true, render: (v, r) => (v ? <span className="text-sm">{date(v)}{r.endDate && r.endDate !== v ? ` – ${date(r.endDate)}` : ''}</span> : '—') },
            { key: 'papers', header: t('exams.schedule.papers'), align: 'right' },
            { key: 'sheetsLocked', header: t('exams.schedule.marksLocked'), mobileHidden: true, render: (v, r) => (r.status === 'DRAFT' || !r.sheetsExpected ? '—' : <div className="min-w-[110px]"><ProgressBar value={Math.round((v / r.sheetsExpected) * 100)} /><p className="text-xs text-ink-faint mt-0.5">{t('exams.schedule.sheetsOf', { locked: v, total: r.sheetsExpected })}</p></div>) },
            { key: 'status', header: t('exams.schedule.status'), render: (v) => <StatusPill tone={EXAM_STATUS[v]?.tone}>{statusLabel(t, v)}</StatusPill> },
            { key: 'id', header: '', align: 'right', width: 100, render: (id, r) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {hasPermission('exams.schedule.edit') && r.status !== 'PUBLISHED' && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('exams.schedule.edit')} title={t('exams.schedule.edit')} onClick={() => setEditing(r)} />}
                {hasPermission('exams.schedule.delete') && r.status !== 'PUBLISHED' && !r.sheetsStarted && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('exams.schedule.delete')} title={t('exams.schedule.delete')}
                  onClick={async () => { if (await confirm({ title: t('exams.schedule.deleteConfirm', { name: r.name }), tone: 'danger', confirmLabel: t('exams.schedule.delete') })) remove.mutate(id) }} />}
              </div>
            ) },
          ]}
          onRowClick={(r) => open(r.id)}
          emptyIcon={CalendarClock} emptyTitle={t('exams.schedule.empty')} emptyHint={t('exams.schedule.emptyHint')}
        />
      )}
      {editing && <ExamForm exam={editing === 'new' ? null : editing} year={year} onClose={() => setEditing(null)}
        onSaved={(e) => { qc.invalidateQueries({ queryKey: ['exams'] }); qc.invalidateQueries({ queryKey: ['exam', e.id] }); setEditing(null); showSuccess(t('exams.schedule.saved')); if (editing === 'new') open(e.id) }} />}
    </PageContainer>
  )
}
