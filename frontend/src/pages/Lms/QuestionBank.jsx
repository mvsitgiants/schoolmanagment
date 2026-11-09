import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileQuestion, Plus, Trash2, X } from 'lucide-react'
import { BLOOM_LEVELS, DIFFICULTY, QUESTION_TYPES, checkQuestion } from '@schoolgiant/shared'
import { ColorChip, ControlChip, DataTable, FormField, HeaderButton, ImportExportButtons, Input, Modal, Note, PageContainer, PageHeader, Select, StatusPill, Textarea, Toolbar, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { createQuestion, deleteQuestion, fetchLmsLookup, fetchQuestions, importQuestions, updateQuestion } from '../../api/lms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { readSheet } from '../../utils/readSheet'

/** All subjects the caller may pick, with the classes they are taught in. */
function useSubjects() {
  const { data: look } = useQuery({ queryKey: ['lms-lookup'], queryFn: fetchLmsLookup, staleTime: 60_000 })
  const classes = look?.classes ?? []
  const subjects = [...new Map(classes.flatMap((c) => c.subjects).map((s) => [s.id, s])).values()].sort((a, b) => a.name.localeCompare(b.name))
  return { classes, subjects }
}

function QuestionForm({ question, defaults, onClose, onSaved, onDelete }) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const { classes, subjects } = useSubjects()
  const q0 = question ?? {}
  const [f, setF] = useState({
    subjectId: q0.subjectId ?? defaults.subjectId ?? '', classId: q0.classId ?? defaults.classId ?? '', chapter: q0.chapter ?? defaults.chapter ?? '', type: q0.type ?? 'MCQ',
    text: q0.text ?? '', options: q0.options?.length ? q0.options : [{ text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }],
    tf: q0.type === 'TRUE_FALSE' ? (q0.options?.[0]?.correct ? 'TRUE' : 'FALSE') : '',
    answers: (q0.answers ?? []).join(' | '), explanation: q0.explanation ?? '', marks: String(q0.marks ?? 1), negative: String(q0.negative ?? 0), difficulty: q0.difficulty ?? 'MEDIUM', bloom: q0.bloom ?? '',
  })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const type = QUESTION_TYPES[f.type]
  const setOpt = (i, patch) => setF((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? { ...o, ...patch } : f.type === 'MCQ' && patch.correct ? { ...o, correct: false } : o)) }))
  const body = () => ({
    ...f, marks: Number(f.marks), negative: Number(f.negative), classId: f.classId || null, bloom: f.bloom || undefined,
    options: f.type === 'TRUE_FALSE' ? [{ text: 'True', correct: f.tf === 'TRUE' }, { text: 'False', correct: f.tf === 'FALSE' }] : type?.options ? f.options : [],
    answers: ['FILL', 'SHORT', 'LONG'].includes(f.type) ? f.answers.split('|').map((x) => x.trim()).filter(Boolean) : undefined,
  })
  const problems = checkQuestion(body())
  const save = useMutation({ mutationFn: () => (question ? updateQuestion(question.id, body()) : createQuestion(body())), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="xl" title={question ? t('lms.qb.editTitle') : t('lms.qb.newTitle')} footer={<>
      {question && onDelete && hasPermission('lms.question-bank.delete') && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" onClick={onDelete}>{t('lms.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!f.subjectId || Object.keys(problems).length > 0} onClick={() => save.mutate()}>{t('lms.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FormField label={t('lms.subject')} required><Select value={f.subjectId} onChange={set('subjectId')}><option value="">{t('lms.pickSubject')}</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>
          <FormField label={t('lms.class')}><Select value={f.classId} onChange={set('classId')}><option value="">{t('lms.anyClass')}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
          <FormField label={t('lms.qb.chapter')}><Input value={f.chapter} onChange={set('chapter')} /></FormField>
          <FormField label={t('lms.qb.type')}><Select value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value, tf: '' }))}>{Object.keys(QUESTION_TYPES).map((k) => <option key={k} value={k}>{t(`lms.qtypes.${k}`)}</option>)}</Select></FormField>
        </div>
        <FormField label={t('lms.qb.question')} required><Textarea rows={3} value={f.text} onChange={set('text')} /></FormField>
        {f.type === 'TRUE_FALSE' && (
          <div className="flex gap-4">
            {['TRUE', 'FALSE'].map((v) => <label key={v} className="inline-flex items-center gap-2 text-sm"><input type="radio" name="tf" checked={f.tf === v} onChange={() => setF((x) => ({ ...x, tf: v }))} className="border-border text-brand-500" />{t(`lms.qb.${v.toLowerCase()}`)}</label>)}
          </div>
        )}
        {type?.options && f.type !== 'TRUE_FALSE' && (
          <div className="space-y-2">
            <p className="text-xs text-ink-muted">{f.type === 'MCQ' ? t('lms.qb.markOne') : t('lms.qb.markAll')}</p>
            {f.options.map((o, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                <input type={f.type === 'MCQ' ? 'radio' : 'checkbox'} name="correct" checked={!!o.correct} onChange={(e) => setOpt(i, { correct: e.target.checked })} aria-label={t('lms.qb.correct')} className="border-border text-brand-500" />
                <Input value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder={t('lms.qb.option', { n: i + 1 })} />
                <Button size="sm" variant="ghost" icon={X} disabled={f.options.length <= 2} aria-label={t('lms.remove')} onClick={() => setF((x) => ({ ...x, options: x.options.filter((_, j) => j !== i) }))} />
              </div>
            ))}
            {f.options.length < 8 && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((x) => ({ ...x, options: [...x.options, { text: '', correct: false }] }))}>{t('lms.qb.addOption')}</Button>}
          </div>
        )}
        {['FILL', 'SHORT', 'LONG'].includes(f.type) && <FormField label={f.type === 'FILL' ? t('lms.qb.accepted') : t('lms.qb.model')} hint={f.type === 'FILL' ? t('lms.qb.acceptedHint') : undefined}><Textarea rows={f.type === 'LONG' ? 4 : 2} value={f.answers} onChange={set('answers')} /></FormField>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FormField label={t('lms.qb.marks')}><Input type="number" min="0.25" step="0.25" value={f.marks} onChange={set('marks')} /></FormField>
          <FormField label={t('lms.qb.negative')} hint={type?.auto ? undefined : t('lms.qb.negativeNa')}><Input type="number" min="0" step="0.25" value={f.negative} disabled={!type?.auto} onChange={set('negative')} /></FormField>
          <FormField label={t('lms.qb.difficulty')}><Select value={f.difficulty} onChange={set('difficulty')}>{Object.keys(DIFFICULTY).map((k) => <option key={k} value={k}>{t(`lms.difficulty.${k}`)}</option>)}</Select></FormField>
          <FormField label={t('lms.qb.bloom')}><Select value={f.bloom} onChange={set('bloom')}><option value="">—</option>{BLOOM_LEVELS.map((b) => <option key={b} value={b}>{t(`lms.bloom.${b}`)}</option>)}</Select></FormField>
        </div>
        <FormField label={t('lms.qb.explanation')} hint={t('lms.qb.explanationHint')}><Textarea rows={2} value={f.explanation} onChange={set('explanation')} /></FormField>
        {Object.keys(problems).length > 0 && f.text.trim().length > 2 && <Note tone="warning">{Object.values(problems)[0]}</Note>}
      </div>
    </Modal>
  )
}

/** LMS › Question bank: questions by subject, class and chapter — the online tests draw from it. */
export default function QuestionBank() {
  const { t } = useTranslation('lms')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { classes, subjects } = useSubjects()
  const [filter, setFilter] = useState({ subjectId: '', classId: '', chapter: '', type: '', difficulty: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)), search: q || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['lms-questions', params], queryFn: () => fetchQuestions(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  const refresh = () => qc.invalidateQueries({ queryKey: ['lms-questions'] })
  const remove = useMutation({ mutationFn: deleteQuestion, onSuccess: (r) => { refresh(); setEditing(null); showSuccess(r.deactivated ? t('lms.qb.switchedOff') : t('lms.qb.deleted')) }, onError: (e) => showError(e.message) })
  const askDelete = (r) => confirm({ title: t('lms.qb.deleteConfirm'), message: r.used ? t('lms.qb.usedHint') : undefined, confirmLabel: t('lms.delete'), tone: 'danger' })
  const pick = (k, list, labelOf) => (
    <ControlChip className="shrink-0 max-sm:h-10" label={t(`lms.qb.filter.${k}`)} value={filter[k] ? labelOf(filter[k]) : t('lms.all')} active={!!filter[k]} options={[t('lms.all'), ...list.map(labelOf)]}
      onChange={(v) => { setFilter((x) => ({ ...x, [k]: list.find((it) => labelOf(it) === v) ?? '', ...(k === 'subjectId' && { chapter: '' }) })); setPage(1) }} />
  )
  const subjectName = (id) => subjects.find((s) => s.id === id)?.name ?? id
  const className = (id) => classes.find((c) => c.id === id)?.name ?? id
  return (
    <PageContainer>
      <PageHeader icon={FileQuestion} title={t('lms.qb.title')} subtitle={t('lms.qb.subtitle', { count: meta?.total ?? 0 })}
        actions={<>
          {hasPermission('lms.question-bank.import') && <ImportExportButtons resourceLabel={t('lms.qb.resource')} requires="lms.question-bank.import"
            onImport={async (file) => importQuestions(await readSheet(file), true)} onCommit={(r) => importQuestions(r, false)}
            templateHeaders={['subject', 'class', 'chapter', 'type', 'question', 'option1', 'option2', 'option3', 'option4', 'answer', 'marks', 'negative', 'difficulty', 'explanation']}
            templateSample={['PHY', '11', 'Laws of motion', 'MCQ', 'The SI unit of force is', 'Joule', 'Newton', 'Watt', 'Pascal', '2', '1', '0', 'EASY', '1 N = 1 kg·m/s²']}
            onDone={refresh} />}
          <HeaderButton icon={Plus} variant="primary" requires="lms.question-bank.create" onClick={() => setEditing('new')}>{t('lms.qb.new')}</HeaderButton>
        </>} />
      <DataTable rows={data?.data ?? []} loading={isLoading}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('lms.qb.search')}
          right={<div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0 [scrollbar-width:thin]">
            {pick('subjectId', subjects.map((s) => s.id), subjectName)}
            {pick('classId', classes.map((c) => c.id), className)}
            {filter.subjectId && (data?.chapters ?? []).length > 0 && pick('chapter', data.chapters, (c) => c)}
            {pick('type', Object.keys(QUESTION_TYPES), (k) => t(`lms.qtypes.${k}`))}
            {pick('difficulty', Object.keys(DIFFICULTY), (k) => t(`lms.difficulty.${k}`))}
          </div>} />}
        columns={[
          { key: 'text', header: t('lms.qb.question'), render: (v, r) => <div className="min-w-0"><p className="text-sm text-ink line-clamp-2 max-w-xl whitespace-normal">{v}</p><div className="mt-1 flex flex-wrap items-center gap-1"><ColorChip label={subjectName(r.subjectId)} seed={r.subjectId} dot />{r.classId && <ColorChip label={className(r.classId)} seed={r.classId} />}{r.chapter && <span className="text-xs font-normal text-ink-faint truncate">{r.chapter}</span>}</div>
            {/* phones: type and marks ride under the question (those columns are hidden there) */}
            <p className="md:hidden mt-1 text-xs font-normal text-ink-muted">{t(`lms.qtypes.${r.type}`)} · {t('lms.qb.marksN', { count: r.marks })}{r.negative ? ` · −${r.negative}` : ''}</p></div> },
          { key: 'type', header: t('lms.qb.type'), mobileHidden: true, render: (v) => <ColorChip label={t(`lms.qtypes.${v}`)} seed={`qtype-${v}`} dot /> },
          { key: 'marks', header: t('lms.qb.marks'), align: 'right', mobileHidden: true, render: (v, r) => `${v}${r.negative ? ` / −${r.negative}` : ''}` },
          { key: 'difficulty', header: t('lms.qb.difficulty'), mobileTrail: true, render: (v) => <StatusPill tone={DIFFICULTY[v]?.tone}>{t(`lms.difficulty.${v}`)}</StatusPill> },
          // phones delete from the question's form instead (a tap opens it)
          { key: 'id', header: '', align: 'right', width: 50, mobileHidden: true, render: (id, r) => hasPermission('lms.question-bank.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('lms.delete')} title={t('lms.delete')}
            onClick={async (e) => { e.stopPropagation(); if (await askDelete(r)) remove.mutate(id) }} /> },
        ]}
        onRowClick={hasPermission('lms.question-bank.edit') ? (r) => setEditing(r) : undefined}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={FileQuestion} emptyTitle={t('lms.qb.empty')} emptyHint={t('lms.qb.emptyHint')} />
      {editing && <QuestionForm question={editing === 'new' ? null : editing} defaults={filter} onClose={() => setEditing(null)}
        onDelete={editing !== 'new' ? async () => { if (await askDelete(editing)) remove.mutate(editing.id) } : undefined} onSaved={() => { setEditing(null); refresh(); showSuccess(t('lms.saved')) }} />}
    </PageContainer>
  )
}
