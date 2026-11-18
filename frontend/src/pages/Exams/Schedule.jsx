import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, CalendarRange, ChevronLeft, ClipboardList, Pencil, Plus, Send, Trash2, Undo2, Wand2, X } from 'lucide-react'
import { EXAM_STATUS, MAX_PAPER_PARTS, PAPER_PART_PRESETS, addMinutes, clashes } from '@schoolgiant/shared'
import { DateInput, ColorChip, ControlChip, DataTable, DateCell, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, PillRow, ProgressBar, Select, SideNav, SideNavLayout, StatusPill, Textarea, pillClass, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup, fetchGrading } from '../../api/academics'
import { createExam, deleteExam, fetchExam, fetchExamTypes, fetchExams, savePapers, scheduleExam, suggestPapers, unscheduleExam, updateExam } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import LocalNameField, { useLocalNames } from '../../components/localNames/LocalNameField'

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
  const names = useLocalNames('exams') // the name in the school's other languages (Settings › Also keep names in)
  const pickType = (e) => {
    const type = types.find((x) => x.id === e.target.value)
    setForm((f) => ({ ...f, examTypeId: e.target.value, name: f.name || (type ? `${type.name} ${year?.name ?? ''}`.trim() : '') }))
  }
  const save = useMutation({
    mutationFn: () => (exam ? updateExam(exam.id, { ...form, academicYearId: year?.id }) : createExam({ ...form, academicYearId: year?.id })),
    onSuccess: async (...a) => { await names.save().catch((e) => showError(e.message)); onSaved(...a) },
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
        <LocalNameField names={names} slot="exam" english={form.name} label={t('exams.schedule.name')} />
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

const blankPaper = { subjectId: '', date: '', startTime: '09:30', endTime: '12:30', maxMarks: '80', passMarks: '27', gradeOnly: false, countsInTotal: true, parts: [] }
const partsIn = (parts) => (parts ?? []).map((x) => ({ name: x.name, maxMarks: String(x.maxMarks ?? ''), passMarks: String(x.passMarks ?? ''), date: x.date ?? '', startTime: x.startTime ?? '', endTime: x.endTime ?? '' }))
const sumOf = (parts, k) => parts.reduce((n, x) => n + (Number(x[k]) || 0), 0)
/** Which ready-made split these parts are (names and marks match), or 'CUSTOM'. */
const presetOf = (parts) => PAPER_PART_PRESETS.find((p) => p.parts.length === parts.length && p.parts.every((x, i) => x.name === parts[i].name && String(x.maxMarks) === String(parts[i].maxMarks) && String(x.passMarks) === String(parts[i].passMarks)))?.value ?? 'CUSTOM'

/** A class's timetable for the exam: one row per subject. */
function PapersEditor({ exam, cls, onClose, onSaved }) {
  const { t } = useTranslation('exams')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [rows, setRows] = useState(() => cls.papers.map((p) => ({
    subjectId: p.subjectId, date: p.date ?? '', startTime: p.startTime ?? '', endTime: p.endTime ?? '', maxMarks: String(p.maxMarks ?? ''), passMarks: String(p.passMarks ?? ''), gradeOnly: !!p.gradeOnly, countsInTotal: p.countsInTotal !== false, parts: partsIn(p.parts),
  })))
  const [errors, setErrors] = useState({})
  const [filling, setFilling] = useState(false)
  const setRow = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  // marked in parts: the paper's max and pass marks follow its parts (the overall pass marks can still be changed)
  const setParts = (i, parts) => setRows((r) => r.map((x, j) => (j === i ? { ...x, parts, ...(parts.length >= 2 && { maxMarks: String(sumOf(parts, 'maxMarks')), passMarks: String(sumOf(parts, 'passMarks')) }) } : x)))
  const applyPreset = (i, value) => { const p = PAPER_PART_PRESETS.find((x) => x.value === value); if (p) setParts(i, partsIn(p.parts)) }
  const setPart = (i, j, k, v) => setParts(i, rows[i].parts.map((x, n) => (n === j ? { ...x, [k]: v } : x)))
  const presetName = (p) => t(`exams.papers.presets.${p.value}`, { defaultValue: p.label })
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
    mutationFn: () => savePapers(exam.id, cls.id, rows.filter((r) => r.subjectId).map((r) => ({ ...r, maxMarks: Number(r.maxMarks) || 0, passMarks: Number(r.passMarks) || 0,
      parts: !r.gradeOnly && r.parts?.length >= 2 ? r.parts.map((x) => ({ name: x.name.trim(), maxMarks: Number(x.maxMarks) || 0, passMarks: Number(x.passMarks) || 0, date: x.date || '', startTime: x.date ? x.startTime : '', endTime: x.date ? x.endTime : '' })) : [] }))),
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
          <div key={i} className={`rounded-lg p-2 ${clash.has(i) ? 'bg-amber-50' : ''}`}>
          <div className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_.8fr_.8fr_.7fr_.7fr_auto_auto] gap-2 items-start">
            <FormField label={i === 0 ? t('exams.papers.subject') : undefined} error={err(i, 'subjectId')}>
              <Select value={r.subjectId} onChange={(e) => setRow(i, 'subjectId', e.target.value)}>
                <option value="">{t('exams.papers.pickSubject')}</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </FormField>
            <FormField label={i === 0 ? t('exams.papers.date') : undefined} error={err(i, 'date')}><DateInput value={r.date} onChange={(e) => setRow(i, 'date', e.target.value)} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.start') : undefined} error={err(i, 'startTime')}><Input type="time" value={r.startTime} onChange={(e) => setRow(i, 'startTime', e.target.value)} onBlur={() => !r.endTime && r.startTime && setRow(i, 'endTime', addMinutes(r.startTime, 180))} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.end') : undefined} error={err(i, 'endTime')}><Input type="time" value={r.endTime} onChange={(e) => setRow(i, 'endTime', e.target.value)} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.max') : undefined} error={err(i, 'maxMarks')}><Input type="number" min="0" disabled={r.gradeOnly || r.parts?.length >= 2} title={r.parts?.length >= 2 ? t('exams.papers.maxFromParts') : undefined} value={r.gradeOnly ? '' : r.maxMarks} onChange={(e) => setRow(i, 'maxMarks', e.target.value)} /></FormField>
            <FormField label={i === 0 ? t('exams.papers.pass') : undefined} error={err(i, 'passMarks')}><Input type="number" min="0" disabled={r.gradeOnly} value={r.gradeOnly ? '' : r.passMarks} onChange={(e) => setRow(i, 'passMarks', e.target.value)} /></FormField>
            <label className={`inline-flex items-center gap-1.5 text-xs text-ink-muted h-9 ${i === 0 ? 'md:mt-6' : ''}`} title={t('exams.papers.gradeOnlyHint')}>
              <input type="checkbox" checked={r.gradeOnly} onChange={(e) => setRow(i, 'gradeOnly', e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t('exams.papers.gradeOnly')}
            </label>
            <Button size="sm" variant="ghost" icon={X} className={i === 0 ? 'md:mt-6' : ''} aria-label={t('exams.papers.remove')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} />
          </div>
          {/* Theory + Practical (+ Internal): each part with its own max and pass marks */}
          {!r.gradeOnly && (r.parts?.length >= 2 ? (
            <div className="mt-2 ms-1 rounded-md border border-border bg-black/[0.02] p-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink-muted">{t('exams.papers.inParts')}</span>
                <Select value={presetOf(r.parts)} onChange={(e) => applyPreset(i, e.target.value)} className="w-64" aria-label={t('exams.papers.inParts')}>
                  {PAPER_PART_PRESETS.map((p) => <option key={p.value} value={p.value}>{presetName(p)}</option>)}
                  <option value="CUSTOM" disabled>{t('exams.papers.customParts')}</option>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setRow(i, 'parts', [])}>{t('exams.papers.oneMark')}</Button>
              </div>
              {err(i, 'parts') && <Note tone="danger">{err(i, 'parts')}</Note>}
              {r.parts.map((p, j) => (
                <div key={j} className="grid grid-cols-2 md:grid-cols-[1.4fr_.6fr_.6fr_1fr_.8fr_.8fr_auto] gap-2 items-start">
                  <FormField label={j === 0 ? t('exams.papers.partName') : undefined}><Input value={p.name} maxLength={40} onChange={(e) => setPart(i, j, 'name', e.target.value)} /></FormField>
                  <FormField label={j === 0 ? t('exams.papers.max') : undefined} error={err(i, `parts.${j}.maxMarks`)}><Input type="number" min="0" value={p.maxMarks} onChange={(e) => setPart(i, j, 'maxMarks', e.target.value)} /></FormField>
                  <FormField label={j === 0 ? t('exams.papers.pass') : undefined} error={err(i, `parts.${j}.passMarks`)}><Input type="number" min="0" value={p.passMarks} onChange={(e) => setPart(i, j, 'passMarks', e.target.value)} /></FormField>
                  <FormField label={j === 0 ? t('exams.papers.partDate') : undefined} error={err(i, `parts.${j}.date`)}><DateInput value={p.date} onChange={(e) => setPart(i, j, 'date', e.target.value)} /></FormField>
                  <FormField label={j === 0 ? t('exams.papers.start') : undefined}><Input type="time" disabled={!p.date} value={p.startTime} onChange={(e) => setPart(i, j, 'startTime', e.target.value)} onBlur={() => p.date && !p.endTime && p.startTime && setPart(i, j, 'endTime', addMinutes(p.startTime, 180))} /></FormField>
                  <FormField label={j === 0 ? t('exams.papers.end') : undefined} error={err(i, `parts.${j}.endTime`)}><Input type="time" disabled={!p.date} value={p.endTime} onChange={(e) => setPart(i, j, 'endTime', e.target.value)} /></FormField>
                  <Button size="sm" variant="ghost" icon={X} className={j === 0 ? 'mt-6' : ''} disabled={r.parts.length <= 2} aria-label={t('exams.papers.removePart')} onClick={() => setParts(i, r.parts.filter((_, n) => n !== j))} />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                {r.parts.length < MAX_PAPER_PARTS && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setParts(i, [...r.parts, { name: '', maxMarks: '', passMarks: '', date: '', startTime: '', endTime: '' }])}>{t('exams.papers.addPart')}</Button>}
                <span className="text-xs text-ink-muted">{t('exams.papers.partsHint')}</span>
              </div>
            </div>
          ) : (
            <button type="button" className="mt-1 ms-1 text-xs font-medium text-brand-600 hover:underline" onClick={() => applyPreset(i, 'TH_PR')}>{t('exams.papers.splitParts')}</button>
          ))}
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
  const [classId, setClassId] = useState('') // one class's papers, or every class
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
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('exams.schedule.back')} title={t('exams.schedule.back')} />
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
      {exam.classes.length > 1 && (
        <PillRow>
          <button type="button" aria-pressed={!classId} onClick={() => setClassId('')} className={pillClass(!classId)}>{t('exams.schedule.allClasses', { count: exam.classes.length })}</button>
          {exam.classes.map((c) => (
            <button key={c.id} type="button" aria-pressed={classId === c.id} onClick={() => setClassId(c.id)} className={pillClass(classId === c.id)}>
              {c.name} <span className={`tabular-nums ${c.papers.length ? 'opacity-70' : 'text-danger-600'}`}>· {c.papers.length}</span>
            </button>
          ))}
        </PillRow>
      )}
      {exam.classes.filter((c) => !classId || c.id === classId).map((c) => (
        <Panel key={c.id} title={c.name} subtitle={t('exams.schedule.paperCount', { count: c.papers.length })} flush
          actions={canEdit && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditingClass(c)}>{t('exams.schedule.editPapers')}</Button>}>
          <DataTable
            rows={c.papers}
            dense
            className="border-0 shadow-none"
            columns={[
              { key: 'date', header: t('exams.papers.date'), nowrap: true, render: (v) => (v ? <DateCell value={v} /> : <span className="text-danger-600">{t('exams.schedule.noDate')}</span>) },
              { key: 'startTime', header: t('exams.papers.time'), nowrap: true, render: (v, r) => (v ? `${v}${r.endTime ? ` – ${r.endTime}` : ''}` : '—') },
              { key: 'subject', header: t('exams.papers.subject'), mobilePrimary: true, render: (v, r) => <ColorChip label={v} seed={r.subjectId} dot sub={r.subjectCode ?? undefined} /> },
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
      {openId ? (
        <SideNavLayout nav={(data?.exams?.length ?? 0) > 1 && (
          <SideNav title={t('exams.schedule.examsNav')} value={openId} onChange={open} items={(data?.exams ?? []).map((e) => ({
            id: e.id, label: e.name, icon: CalendarRange,
            hint: e.startDate ? `${date(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${date(e.endDate)}` : ''}` : statusLabel(t, e.status),
            count: e.status === 'PUBLISHED' ? undefined : statusLabel(t, e.status), countTone: e.status === 'DRAFT' ? 'warning' : undefined,
            progress: e.sheetsExpected && e.status !== 'DRAFT' ? { value: e.sheetsLocked, max: e.sheetsExpected, kind: 'done' } : undefined,
          }))} />
        )}>
          <ExamDetail key={openId} examId={openId} onBack={() => open(null)} />
        </SideNavLayout>
      ) : (
        <DataTable
          rows={data?.exams ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          toolbar={<div className="flex justify-end">
            <ControlChip label={t('exams.schedule.year')} value={year?.name ?? '—'} active={!!yearId} options={years.map((y) => y.name)} onChange={(v) => setYearId(years.find((y) => y.name === v)?.id ?? '')} />
          </div>}
          columns={[
            { key: 'name', header: t('exams.schedule.name'), mobilePrimary: true, render: (v, r) => (
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{v}</p>
                {(r.typeName || r.term) && <div className="mt-1"><ColorChip label={r.typeName || r.term} seed={r.examTypeId ?? undefined} dot sub={r.typeName ? r.term || undefined : undefined} /></div>}
              </div>
            ) },
            { key: 'classes', header: t('exams.schedule.classes'), mobileHidden: true, render: (v) => <div className="flex flex-wrap gap-1">{v.map((c) => <ColorChip key={c.id} label={c.code || c.name} seed={c.id} />)}</div> },
            { key: 'startDate', header: t('exams.schedule.dates'), mobilePrimary: true, render: (v, r) => (v ? <span className="text-sm sm:whitespace-nowrap">{date(v)}{r.endDate && r.endDate !== v ? ` – ${date(r.endDate)}` : ''}</span> : '—') },
            { key: 'papers', header: t('exams.schedule.papers'), align: 'right', mobileLabel: t('exams.schedule.papers') },
            { key: 'sheetsLocked', header: t('exams.schedule.marksLocked'), mobileHidden: true, render: (v, r) => (r.status === 'DRAFT' || !r.sheetsExpected ? '—' : <div className="min-w-[110px]"><ProgressBar value={Math.round((v / r.sheetsExpected) * 100)} /><p className="text-xs text-ink-faint mt-0.5">{t('exams.schedule.sheetsOf', { locked: v, total: r.sheetsExpected })}</p></div>) },
            { key: 'status', header: t('exams.schedule.status'), mobileTrail: true, render: (v) => <StatusPill tone={EXAM_STATUS[v]?.tone}>{statusLabel(t, v)}</StatusPill> },
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
