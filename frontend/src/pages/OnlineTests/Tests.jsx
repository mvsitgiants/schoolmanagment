import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronLeft, ClipboardCheck, Download, Lock, PenLine, Plus, Send, Shuffle, Trash2, X } from 'lucide-react'
import { DIFFICULTY, QUESTION_TYPES, RESULT_RELEASE, TEST_STATUS } from '@schoolgiant/shared'
import { DateInput, ColorChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, SearchInput, SegmentedControl, Select, SideNav, SideNavLayout, StatusPill, Textarea, localIso, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { addTestQuestions, closeTest, createTest, deleteTest, fetchTest, fetchTests, pickTestQuestions, publishTest, setTestQuestions, updateTest } from '../../api/onlineTests'
import { fetchQuestions, questionsFromTopics } from '../../api/lms'
import { QuestionForm } from '../Lms/QuestionBank'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { ClassSubjectPicker } from '../Lms/Courses'
import useDebouncedValue from '../../hooks/useDebouncedValue'

const PAGE = 50

const tomorrow = () => localIso(new Date(Date.now() + 864e5))

function TestForm({ test, defaults, onClose, onSaved }) {
  const { t } = useTranslation('tests')
  const { showError } = useSnackbar()
  const x = test ?? defaults ?? {}
  const draft = !test || test.status === 'DRAFT'
  const [f, setF] = useState({
    title: x.title ?? '', instructions: x.instructions ?? '', classId: x.classId ?? '', subjectId: x.subjectId ?? '', sectionIds: x.sectionIds ?? [],
    durationMin: String(x.durationMin ?? 30), opens: x.opens ?? { date: tomorrow(), time: '09:00' }, closes: x.closes ?? { date: tomorrow(), time: '18:00' },
    attemptsAllowed: String(x.attemptsAllowed ?? 1), passPct: String(x.passPct ?? 33), shuffleQuestions: x.shuffleQuestions ?? true, shuffleOptions: x.shuffleOptions ?? true,
    partialMarks: x.partialMarks ?? false, results: x.results ?? 'AFTER_CLOSE', showAnswers: x.showAnswers ?? true, fullscreen: x.proctor?.fullscreen ?? false, maxTabSwitches: String(x.proctor?.maxTabSwitches ?? 0),
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setWhen = (k, part) => (e) => setF((v) => ({ ...v, [k]: { ...v[k], [part]: e.target.value } }))
  const body = () => ({
    title: f.title, instructions: f.instructions, classId: f.classId, subjectId: f.subjectId, sectionIds: f.sectionIds, durationMin: Number(f.durationMin), opens: f.opens, closes: f.closes,
    attemptsAllowed: Number(f.attemptsAllowed), passPct: Number(f.passPct), shuffleQuestions: f.shuffleQuestions, shuffleOptions: f.shuffleOptions, partialMarks: f.partialMarks,
    results: f.results, showAnswers: f.showAnswers, proctor: { fullscreen: f.fullscreen, maxTabSwitches: Number(f.maxTabSwitches) },
  })
  const save = useMutation({ mutationFn: () => (test ? updateTest(test.id, body()) : createTest(body())), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  const check = (k) => <label key={k} className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f[k]} disabled={!draft} onChange={set(k)} className="rounded border-border text-brand-500" />{t(`tests.form.${k}`)}</label>
  return (
    <Modal open onClose={onClose} size="xl" title={test ? t('tests.form.editTitle') : t('tests.form.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={f.title.trim().length < 2 || !f.classId || !f.subjectId} onClick={() => save.mutate()}>{t('tests.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('tests.form.title')} required error={errors.title}><Input value={f.title} onChange={set('title')} placeholder={t('tests.form.titlePlaceholder')} /></FormField>
        {draft && <ClassSubjectPicker value={f} onChange={(v) => setF((x2) => ({ ...x2, ...v }))} errors={errors} />}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FormField label={t('tests.form.opensDate')} error={errors['opens.date']}><DateInput value={f.opens.date} disabled={!draft} onChange={setWhen('opens', 'date')} /></FormField>
          <FormField label={t('tests.form.opensTime')}><Input type="time" value={f.opens.time} disabled={!draft} onChange={setWhen('opens', 'time')} /></FormField>
          <FormField label={t('tests.form.closesDate')} error={errors['closes.date']}><DateInput value={f.closes.date} onChange={setWhen('closes', 'date')} /></FormField>
          <FormField label={t('tests.form.closesTime')}><Input type="time" value={f.closes.time} onChange={setWhen('closes', 'time')} /></FormField>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FormField label={t('tests.form.duration')}><Input type="number" min="5" max="300" value={f.durationMin} disabled={!draft} onChange={set('durationMin')} /></FormField>
          <FormField label={t('tests.form.attempts')}><Input type="number" min="1" max="10" value={f.attemptsAllowed} disabled={!draft} onChange={set('attemptsAllowed')} /></FormField>
          <FormField label={t('tests.form.passPct')}><Input type="number" min="0" max="100" value={f.passPct} disabled={!draft} onChange={set('passPct')} /></FormField>
          <FormField label={t('tests.form.results')}><Select value={f.results} onChange={set('results')}>{RESULT_RELEASE.map((r) => <option key={r.value} value={r.value}>{t(`tests.release.${r.value}`)}</option>)}</Select></FormField>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{['shuffleQuestions', 'shuffleOptions', 'partialMarks'].map(check)}<label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.showAnswers} onChange={set('showAnswers')} className="rounded border-border text-brand-500" />{t('tests.form.showAnswers')}</label></div>
        <Panel title={t('tests.form.proctoring')}>
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.fullscreen} disabled={!draft} onChange={set('fullscreen')} className="rounded border-border text-brand-500" />{t('tests.form.fullscreen')}</label>
            <FormField label={t('tests.form.maxTabSwitches')} hint={t('tests.form.maxTabSwitchesHint')}><Input type="number" min="0" max="20" value={f.maxTabSwitches} disabled={!draft} onChange={set('maxTabSwitches')} /></FormField>
          </div>
        </Panel>
        <FormField label={t('tests.form.instructions')}><Textarea rows={3} value={f.instructions} onChange={set('instructions')} /></FormField>
      </div>
    </Modal>
  )
}

/** Choose questions from the bank: tick them, or pick some at random. */
function BankPicker({ test, onClose, onDone }) {
  const { t } = useTranslation('tests')
  const { showError, showSuccess } = useSnackbar()
  const [filter, setFilter] = useState({ chapter: '', difficulty: '', type: '' })
  const [chosen, setChosen] = useState([])
  const [count, setCount] = useState('5')
  const [writing, setWriting] = useState(false)
  const qc = useQueryClient()
  const canWrite = hasPermission('lms.question-bank.create')
  // the questions already written on this class's topics (Teaching hub) → into the bank, then they can be ticked
  const bring = useMutation({
    mutationFn: () => questionsFromTopics({ classId: test.classId, subjectId: test.subjectId }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['lms-questions'] }); showSuccess(r.added ? t('tests.builder.broughtIn', { count: r.added, topics: r.topics }) : r.already ? t('tests.builder.alreadyIn') : t('tests.builder.noTopicQuestions')) },
    onError: (e) => showError(e.message),
  })
  const have = new Set(test.questions.map((q) => q.questionId))
  const params = { subjectId: test.subjectId, ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)), page: 1, pageSize: 100 }
  const { data, isLoading } = useQuery({ queryKey: ['lms-questions', params], queryFn: () => fetchQuestions(params) })
  const add = useMutation({ mutationFn: () => addTestQuestions(test.id, chosen), onSuccess: () => { onDone(); showSuccess(t('tests.builder.added', { count: chosen.length })) }, onError: (e) => showError(e.message) })
  const pick = useMutation({ mutationFn: () => pickTestQuestions(test.id, { count: Number(count), ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) }), onSuccess: (r) => { onDone(); showSuccess(t('tests.builder.picked', { picked: r.picked, asked: r.asked })) }, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="xl" title={t('tests.builder.fromBank')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.close')}</Button>
      <Button loading={add.isPending} disabled={!chosen.length} onClick={() => add.mutate()}>{t('tests.builder.addChosen', { count: chosen.length })}</Button>
    </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="col-span-2 sm:col-span-1"><Select value={filter.chapter} onChange={(e) => setFilter((x) => ({ ...x, chapter: e.target.value }))} aria-label={t('tests.builder.chapter')}><option value="">{t('tests.builder.anyChapter')}</option>{(data?.chapters ?? []).map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
          <Select value={filter.difficulty} onChange={(e) => setFilter((x) => ({ ...x, difficulty: e.target.value }))} aria-label={t('tests.builder.difficulty')}><option value="">{t('tests.builder.anyDifficulty')}</option>{Object.keys(DIFFICULTY).map((k) => <option key={k} value={k}>{t(`tests.difficulty.${k}`)}</option>)}</Select>
          <Select value={filter.type} onChange={(e) => setFilter((x) => ({ ...x, type: e.target.value }))} aria-label={t('tests.builder.type')}><option value="">{t('tests.builder.anyType')}</option>{Object.keys(QUESTION_TYPES).map((k) => <option key={k} value={k}>{t(`tests.qtypes.${k}`)}</option>)}</Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-bg p-2">
          <Shuffle className="w-4 h-4 text-ink-faint" />
          <span className="text-sm text-ink flex-1 sm:flex-none">{t('tests.builder.pickRandom')}</span>
          <div className="w-20"><Input type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} aria-label={t('tests.builder.count')} /></div>
          <Button size="sm" variant="secondary" loading={pick.isPending} onClick={() => pick.mutate()}>{t('tests.builder.pick')}</Button>
        </div>
        {/* nothing suitable in the bank: write one here, or bring in the questions written on the topics */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={PenLine} onClick={() => setWriting(true)}>{t('tests.builder.write')}</Button>
            <Button size="sm" variant="secondary" icon={Download} loading={bring.isPending} onClick={() => bring.mutate()}>{t('tests.builder.bringIn')}</Button>
            <span className="text-xs text-ink-faint">{t('tests.builder.bringInHint')}</span>
          </div>
        )}
        {isLoading ? <p className="text-sm text-ink-faint">{t('tests.loading')}</p> : !(data?.data ?? []).length ? <Note>{canWrite ? t('tests.builder.bankEmptyHelp') : t('tests.builder.bankEmpty')}</Note> : (
          <div className="max-h-[50vh] overflow-y-auto divide-y divide-border rounded-lg border border-border">
            {data.data.map((q) => (
              <label key={q.id} className={`flex gap-3 px-3 py-2.5 text-sm ${have.has(q.id) ? 'opacity-50' : 'cursor-pointer hover:bg-bg'}`}>
                <input type="checkbox" disabled={have.has(q.id)} checked={have.has(q.id) || chosen.includes(q.id)} onChange={() => setChosen((c) => (c.includes(q.id) ? c.filter((x) => x !== q.id) : [...c, q.id]))} className="mt-0.5 rounded border-border text-brand-500" />
                <span className="flex-1 min-w-0"><span className="block text-ink line-clamp-2">{q.text}</span><span className="text-xs text-ink-faint">{[t(`tests.qtypes.${q.type}`), t('tests.marks', { n: q.marks }), q.chapter, t(`tests.difficulty.${q.difficulty}`)].filter(Boolean).join(' · ')}</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
      {writing && <QuestionForm question={null} defaults={{ subjectId: test.subjectId, classId: test.classId }} onClose={() => setWriting(false)}
        onSaved={(q) => { setWriting(false); qc.invalidateQueries({ queryKey: ['lms-questions'] }); if (q?.id) setChosen((c) => [...c, q.id]); showSuccess(t('tests.builder.written')) }} />}
    </Modal>
  )
}

function TestDetail({ id, onBack }) {
  const { t } = useTranslation('tests')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const { data: test, isLoading } = useQuery({ queryKey: ['test', id], queryFn: () => fetchTest(id) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['test', id] }); qc.invalidateQueries({ queryKey: ['tests'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); showSuccess(typeof v.done === 'function' ? v.done(r) : v.done); if (v.back) onBack() }, onError: (e) => showError(e.message) })
  if (isLoading || !test) return <p className="text-sm text-ink-faint">{t('tests.loading')}</p>
  const draft = test.status === 'DRAFT'
  const items = test.questions.map((q) => ({ index: q.index, marks: q.marks }))
  const reorder = (i, d) => { const next = [...items]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); act.mutate({ fn: () => setTestQuestions(test.id, next), done: t('tests.saved') }) }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('tests.back')} title={t('tests.back')} className="shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink break-words">{test.title}</p>
              <StatusPill tone={TEST_STATUS[test.status]?.tone}>{t(`tests.status.${test.status}`)}</StatusPill>
            </div>
            <p className="text-xs text-ink-muted">{[test.className, test.subject, test.sections.join(', ') || t('tests.allSections'), t('tests.minutes', { count: test.durationMin })].filter(Boolean).join(' · ')}</p>
            {test.opens?.date && <p className="text-xs text-ink-muted">{t('tests.window', { from: `${date(test.opens.date)} ${test.opens.time}`, to: `${date(test.closes.date)} ${test.closes.time}` })}</p>}
          </div>
        </div>
        {test.canChange && <div className="flex w-full flex-wrap gap-2 ps-12 sm:w-auto sm:ps-0">
          {test.status !== 'CLOSED' && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{t('tests.edit')}</Button>}
          {draft && hasPermission('online-tests.tests.publish') && <Button size="sm" icon={Send}
            onClick={async () => { const ok = await confirm({ title: t('tests.publishTitle'), message: t('tests.publishHint'), confirmLabel: t('tests.publishTell') }); if (ok) act.mutate({ fn: () => publishTest(test.id, true), done: (r) => t('tests.publishedTold', { count: r.told }) }) }}>{t('tests.publish')}</Button>}
          {test.status === 'PUBLISHED' && hasPermission('online-tests.tests.publish') && <Button size="sm" variant="ghost" icon={Lock}
            onClick={async () => { if (await confirm({ title: t('tests.closeTitle'), message: t('tests.closeHint'), confirmLabel: t('tests.close') })) act.mutate({ fn: () => closeTest(test.id), done: t('tests.closed') }) }}>{t('tests.close')}</Button>}
          {draft && hasPermission('online-tests.tests.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('tests.delete')} title={t('tests.delete')}
            onClick={async () => { if (await confirm({ title: t('tests.deleteConfirm', { name: test.title }), confirmLabel: t('tests.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteTest(test.id), done: t('tests.deleted'), back: true }) }} />}
        </div>}
      </div>
      {draft && <Note>{t('tests.draftHint')}</Note>}
      <Panel title={t('tests.builder.questions', { count: test.questions.length, marks: test.totalMarks })} actions={draft && test.canChange && <Button size="sm" icon={Plus} onClick={() => setPicking(true)}>{t('tests.builder.add')}</Button>} flush>
        {!test.questions.length ? <p className="px-4 py-6 text-sm text-ink-faint">{t('tests.builder.none')}</p> : (
          <div className="divide-y divide-border">
            {test.questions.map((q, i) => (
              <div key={`${q.questionId}${i}`} className="flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span className="text-xs font-mono-num text-ink-faint w-6 pt-0.5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0 basis-[calc(100%-2.25rem)] sm:basis-auto">
                  <p className="text-sm text-ink">{q.text}</p>
                  {q.options?.length > 0 && <p className="text-xs text-ink-muted mt-0.5">{q.options.map((o) => (o.correct ? `✓ ${o.text}` : o.text)).join(' · ')}</p>}
                  {q.answers?.length > 0 && q.type === 'FILL' && <p className="text-xs text-ink-muted mt-0.5">✓ {q.answers.join(' | ')}</p>}
                  <p className="text-[11px] text-ink-faint">{t(`tests.qtypes.${q.type}`)}{q.chapter ? ` · ${q.chapter}` : ''}</p>
                </div>
                {draft && test.canChange ? (
                  <div className="flex items-center gap-1 ms-9 sm:ms-0">
                    <div className="w-16"><Input type="number" min="0.25" step="0.25" defaultValue={q.marks} aria-label={t('tests.builder.marks')} title={t('tests.builder.marks')} onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== q.marks) act.mutate({ fn: () => setTestQuestions(test.id, items.map((it) => (it.index === q.index ? { ...it, marks: v } : it))), done: t('tests.saved') }) }} /></div>
                    <Button size="sm" variant="ghost" icon={ArrowUp} disabled={!i} aria-label={t('tests.up')} onClick={() => reorder(i, -1)} />
                    <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === items.length - 1} aria-label={t('tests.down')} onClick={() => reorder(i, 1)} />
                    <Button size="sm" variant="ghost" icon={X} aria-label={t('tests.remove')} onClick={() => act.mutate({ fn: () => setTestQuestions(test.id, items.filter((it) => it.index !== q.index)), done: t('tests.saved') })} />
                  </div>
                ) : <span className="text-sm text-ink-muted whitespace-nowrap ms-9 sm:ms-0">{t('tests.marks', { n: q.marks })}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
      {editing && <TestForm test={test} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); showSuccess(t('tests.saved')) }} />}
      {picking && <BankPicker test={test} onClose={() => setPicking(false)} onDone={() => { setPicking(false); refresh() }} />}
    </div>
  )
}

/** Online tests › Tests: set a test from the question bank, publish it for a window, close it. */
export default function Tests() {
  const { t } = useTranslation('tests')
  const qc = useQueryClient()
  const { date } = useFormat()
  const [params, setParams] = useSearchParams()
  const openId = params.get('test')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  // ?new=1&classId=…&subjectId=…&title=… (from "Create content" › Quiz) opens the form filled in
  const [creating, setCreating] = useState(() => (params.get('new') === '1' ? { classId: params.get('classId') ?? '', subjectId: params.get('subjectId') ?? '', title: params.get('title') ?? '' } : false))
  const q = useDebouncedValue(search.trim(), 300)
  const query = { status: status || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['tests', 'list', query], queryFn: () => fetchTests(query), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const open = (id) => setParams(id ? { test: id } : {})
  const statusLabel = (s) => t(`tests.status.${s}`)
  // the open test's siblings, to switch without going back
  const siblings = openId && !rows.some((r) => r.id === openId) ? [] : rows
  return (
    <PageContainer>
      <PageHeader icon={ClipboardCheck} title={t('tests.title')} subtitle={t('tests.subtitle')}
        actions={!openId && <HeaderButton icon={Plus} variant="primary" requires="online-tests.tests.create" onClick={() => setCreating(true)}>{t('tests.new')}</HeaderButton>} />
      {openId ? (
        <SideNavLayout nav={siblings.length > 1 && (
          <SideNav title={t('tests.nav')} value={openId} onChange={open} items={siblings.map((r) => ({
            id: r.id, label: r.title, icon: ClipboardCheck,
            hint: r.status === 'DRAFT' ? [r.className, r.subject].filter(Boolean).join(' · ') : r.toEvaluate ? t('tests.toEvaluate', { count: r.toEvaluate }) : t('tests.attemptsN', { count: r.attempts }),
            count: r.status === 'DRAFT' ? statusLabel(r.status) : r.toEvaluate || r.attempts,
            countTone: r.status === 'DRAFT' || r.toEvaluate ? 'warning' : undefined,
          }))} />
        )}>
          <TestDetail key={openId} id={openId} onBack={() => open(null)} />
        </SideNavLayout>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: t('tests.all') }, ...Object.keys(TEST_STATUS).map((k) => ({ value: k, label: statusLabel(k) }))]} />
            <div className="w-full sm:w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('tests.search')} /></div>
          </div>
          <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} columns={[
            { key: 'title', header: t('tests.form.title'), render: (v, r) => (
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{v}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <ColorChip label={r.className} seed={r.classId} />
                  <ColorChip label={r.subject} seed={r.subjectId} dot sub={r.sections.join(', ') || undefined} />
                </div>
                {/* phones: the window, size and attempts ride under the title (those columns are hidden there) */}
                <div className="md:hidden mt-1 space-y-0.5 text-xs font-normal text-ink-muted">
                  {r.opens?.date && <p>{t('tests.window', { from: `${date(r.opens.date)} ${r.opens.time}`, to: `${date(r.closes.date)} ${r.closes.time}` })}</p>}
                  <p>{[t('tests.qmLong', { count: r.questions, m: r.totalMarks }), r.status !== 'DRAFT' && t('tests.attemptsN', { count: r.attempts })].filter(Boolean).join(' · ')}
                    {r.toEvaluate > 0 && <span className="font-medium text-amber-700"> · {t('tests.toEvaluate', { count: r.toEvaluate })}</span>}</p>
                </div>
              </div>
            ) },
            { key: 'opens', header: t('tests.when'), nowrap: true, mobileHidden: true, render: (v, r) => (v?.date ? <span className="text-sm">{date(v.date)} {v.time}<span className="block text-xs text-ink-faint">{t('tests.until', { when: `${date(r.closes.date)} ${r.closes.time}` })}</span></span> : '—') },
            { key: 'questions', header: t('tests.questionsCol'), align: 'right', mobileHidden: true, render: (v, r) => t('tests.qm', { q: v, m: r.totalMarks }) },
            { key: 'attempts', header: t('tests.attemptsCol'), align: 'right', mobileHidden: true, render: (v, r) => <span><span className={v ? 'font-semibold tabular-nums text-ink' : 'tabular-nums text-ink-faint'}>{v}</span>{r.toEvaluate > 0 && <span className="block text-[11px] font-medium text-amber-700">{t('tests.toEvaluate', { count: r.toEvaluate })}</span>}</span> },
            { key: 'status', header: t('tests.statusCol'), mobileTrail: true, render: (v) => <StatusPill tone={TEST_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          ]} onRowClick={(r) => open(r.id)} emptyIcon={ClipboardCheck} emptyTitle={q ? t('tests.noMatch') : t('tests.empty')} emptyHint={q ? undefined : t('tests.emptyHint')}
            pagination={total > PAGE ? { page: page - 1, size: PAGE, totalElements: total, totalPages: Math.ceil(total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
        </>
      )}
      {creating && <TestForm defaults={creating === true ? undefined : creating} onClose={() => { setCreating(false); if (params.get('new')) setParams({}, { replace: true }) }} onSaved={(x) => { setCreating(false); qc.invalidateQueries({ queryKey: ['tests'] }); open(x.id) }} />}
    </PageContainer>
  )
}
