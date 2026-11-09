import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Check, CheckCheck, FileStack, Library, ListPlus, PencilLine, Plus, RotateCcw, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { AI_MAX_QUESTIONS, BLOOM_LEVELS, QP_DIFFICULTIES, QUESTION_TYPES, checkQuestion } from '@schoolgiant/shared'
import {
  ColorChip, ControlChip, EmptyState, FormField, Input, Note, PageContainer, PageHeader, Panel, Select, SkeletonLines, StatusPill, Tag, Textarea,
} from '../../components/system'
import Button from '../../components/ui/Button'
import AiGate from '../../components/ai/AiGate'
import { QuestionBody, QuestionChips, QuestionForm, statusTone, useQpLabels } from '../../components/exams/QuestionPaperKit'
import { acceptQuestions, fetchQpContext, fetchQpSetup, generateQuestions } from '../../api/ai'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const NS = 'ai'
const TYPES = Object.keys(QUESTION_TYPES)
const DEFAULT_ROWS = [{ type: 'MCQ', count: 5, marks: 1 }, { type: 'SHORT', count: 3, marks: 2 }, { type: 'LONG', count: 2, marks: 5 }]
const DEFAULT_MIX = { EASY: 30, MEDIUM: 50, HARD: 20 }
const MIX_FILL = { EASY: 'bg-emerald-500', MEDIUM: 'bg-amber-500', HARD: 'bg-rose-500' }

/** A toggle pill (chapters, Bloom's levels). */
function Pill({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={clsx('inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
        on ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-surface border-border text-ink-muted hover:text-ink hover:bg-bg')}>
      {on && <Check className="w-3 h-3" aria-hidden />}{children}
    </button>
  )
}

/** Step header inside a panel: a number disc and a title. */
function Step({ n, title, hint }) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <span className="h-6 w-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

/** One drafted question for review: accept, edit or discard. */
function DraftCard({ d, n, onAccept, onDiscard, onEdit, onRestore }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const problems = Object.keys(d.problems ?? {})
  const tone = d.state === 'ACCEPTED' ? 'border-emerald-300 bg-emerald-50/30' : d.state === 'DISCARDED' ? 'border-dashed border-border opacity-60' : d.state === 'SAVED' ? 'border-brand-200 bg-brand-50/30' : 'border-border'
  return (
    <div className={clsx('rounded-xl border bg-surface p-4 flex flex-col gap-3 transition-colors', tone)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="h-6 min-w-6 px-1.5 rounded-md bg-bg text-xs font-bold text-ink-muted flex items-center justify-center tabular-nums">{n}</span>
          <Tag tone="info">{L.type(d.type)}</Tag>
          <Tag tone="brand">{t('ai.qp.marks', { count: d.marks })}</Tag>
          {d.state === 'ACCEPTED' && <StatusPill tone="success">{t('ai.qp.state.ACCEPTED')}</StatusPill>}
          {d.state === 'DISCARDED' && <StatusPill tone="neutral">{t('ai.qp.state.DISCARDED')}</StatusPill>}
          {d.state === 'SAVED' && <StatusPill tone="brand">{t('ai.qp.state.SAVED')}</StatusPill>}
          {d.edited && <Tag>{t('ai.qp.edited')}</Tag>}
        </div>
        {d.state !== 'SAVED' && (
          <div className="flex items-center gap-1 shrink-0">
            {d.state === 'DISCARDED'
              ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRestore}>{t('ai.qp.restore')}</Button>
              : <>
                <Button size="sm" variant="ghost" icon={PencilLine} aria-label={t('ai.qp.edit')} title={t('ai.qp.edit')} onClick={onEdit} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('ai.qp.discard')} title={t('ai.qp.discard')} onClick={onDiscard} />
                <Button size="sm" variant={d.state === 'ACCEPTED' ? 'secondary' : 'primary'} icon={d.state === 'ACCEPTED' ? X : Check} disabled={!!problems.length && d.state !== 'ACCEPTED'} onClick={onAccept}>
                  {d.state === 'ACCEPTED' ? t('ai.qp.unaccept') : t('ai.qp.accept')}
                </Button>
              </>}
          </div>
        )}
      </div>
      <QuestionBody q={d} answers />
      {d.explanation && <p className="text-xs text-ink-muted whitespace-pre-line border-s-2 border-border ps-2.5">{d.explanation}</p>}
      <QuestionChips q={d} />
      {problems.length > 0 && <Note tone="warning">{t('ai.qp.needsFix', { what: problems.map((k) => t(`ai.qp.problems.${k}`, k)).join(', ') })}</Note>}
    </div>
  )
}

function Generator() {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const { number } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const canCreate = hasPermission('ai.question-papers.create')
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [chapters, setChapters] = useState([])
  const [extraChapter, setExtraChapter] = useState('')
  const [topics, setTopics] = useState('')
  const [rows, setRows] = useState(DEFAULT_ROWS)
  const [mix, setMix] = useState(DEFAULT_MIX)
  const [blooms, setBlooms] = useState([])
  const [drafts, setDrafts] = useState([])
  const [editing, setEditing] = useState(null)
  const [sendToPaper, setSendToPaper] = useState(true)
  const [result, setResult] = useState(null)

  const setup = useQuery({ queryKey: ['ai-qp-setup', examId], queryFn: () => fetchQpSetup(examId) })
  const papers = useMemo(() => setup.data?.rows ?? [], [setup.data])
  useEffect(() => { if (!examId && setup.data?.exam) setExamId(setup.data.exam.id) }, [setup.data, examId])
  const classes = useMemo(() => [...new Map(papers.map((r) => [r.classId, { id: r.classId, name: r.className }])).values()], [papers])
  useEffect(() => { if (!classes.some((c) => c.id === classId)) setClassId(classes[0]?.id ?? '') }, [classes, classId])
  const subjects = useMemo(() => papers.filter((r) => r.classId === classId), [papers, classId])
  useEffect(() => { if (!subjects.some((s) => s.subjectId === subjectId)) setSubjectId(subjects[0]?.subjectId ?? '') }, [subjects, subjectId])
  const paper = subjects.find((s) => s.subjectId === subjectId) ?? null

  const ctx = useQuery({ queryKey: ['ai-qp-context', paper?.examPaperId], queryFn: () => fetchQpContext(paper.examPaperId), enabled: !!paper })
  useEffect(() => {
    // a new paper: its blueprint's sections become the rows (when the question paper is started), chapters cleared
    setChapters([])
    setResult(null)
    const secs = ctx.data?.paper?.sections ?? []
    setRows(secs.length ? secs.slice(0, 6).map((s) => ({ type: s.type, count: Math.min(s.count, AI_MAX_QUESTIONS), marks: s.marks })) : DEFAULT_ROWS)
  }, [ctx.data])

  const total = rows.reduce((n, r) => n + (Number(r.count) || 0), 0)
  const marks = rows.reduce((n, r) => n + (Number(r.count) || 0) * (Number(r.marks) || 0), 0)
  const mixTotal = QP_DIFFICULTIES.reduce((n, k) => n + (Number(mix[k]) || 0), 0)
  const tooMany = total > AI_MAX_QUESTIONS

  const gen = useMutation({
    mutationFn: () => generateQuestions({
      examPaperId: paper.examPaperId, chapters, topics: topics.trim() || undefined,
      rows: rows.filter((r) => Number(r.count) > 0).map((r) => ({ type: r.type, count: Number(r.count), marks: Number(r.marks) })), mix, blooms,
    }),
    onSuccess: (data) => { setDrafts(data.drafts.map((d) => ({ ...d, state: 'PENDING' }))); setResult(null) },
    onError: (e) => showError(e.message),
  })
  const accepted = drafts.filter((d) => d.state === 'ACCEPTED')
  const pending = drafts.filter((d) => d.state === 'PENDING')
  const save = useMutation({
    mutationFn: () => acceptQuestions({
      examPaperId: paper.examPaperId, sendToPaper: sendToPaper && ctx.data?.paper?.status === 'DRAFT',
      questions: accepted.map(({ type, text, options, answers, explanation, chapter, difficulty, bloom, marks: m }) => ({ type, text, options, answers, explanation, chapter, difficulty, bloom, marks: m })),
    }),
    onSuccess: (r) => {
      setDrafts((list) => list.map((d) => (d.state === 'ACCEPTED' ? { ...d, state: 'SAVED' } : d)))
      setResult(r)
      showSuccess(t('ai.qp.savedToast', { count: r.saved }))
    },
    onError: (e) => showError(e.message),
  })

  const setDraft = (id, fn) => setDrafts((list) => list.map((d) => (d.id === id ? fn(d) : d)))
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const chapterOptions = [...new Set([...(ctx.data?.chapters ?? []), ...chapters])]
  const examOptions = (setup.data?.exams ?? []).map((e) => ({ value: e.id, label: e.name }))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
      <div className="space-y-4">
        <Panel title={t('ai.qp.setupTitle')} icon={Wand2}>
          <Step n={1} title={t('ai.qp.step1')} hint={t('ai.qp.step1Hint')} />
          {setup.isLoading ? <SkeletonLines lines={2} /> : setup.data?.examsOff ? <Note tone="warning">{t('ai.qp.examsOff')}</Note> : !examOptions.length ? (
            <Note>{t('ai.qp.noExams')}</Note>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <ControlChip label={t('ai.qp.exam')} value={examOptions.find((e) => e.value === examId)?.label ?? '—'} active options={examOptions.map((e) => e.label)}
                  onChange={(v) => { setExamId(examOptions.find((e) => e.label === v)?.value ?? ''); setDrafts([]) }} />
                {classes.length > 0 && <ControlChip label={t('ai.qp.class')} value={classes.find((c) => c.id === classId)?.name ?? '—'} active options={classes.map((c) => c.name)}
                  onChange={(v) => setClassId(classes.find((c) => c.name === v)?.id ?? '')} />}
                {subjects.length > 0 && <ControlChip label={t('ai.qp.subject')} value={paper?.subject ?? '—'} active options={subjects.map((s) => s.subject)}
                  onChange={(v) => setSubjectId(subjects.find((s) => s.subject === v)?.subjectId ?? '')} />}
              </div>
              {!papers.length && <Note className="mt-3">{t('ai.qp.noPapers')}</Note>}
              {paper && (
                <div className="mt-3 rounded-xl border border-border bg-bg/50 px-3.5 py-3 flex flex-wrap items-center gap-2">
                  <ColorChip label={paper.className} seed={paper.classId} />
                  <ColorChip label={paper.subject} seed={paper.subjectId} dot />
                  <Tag tone="brand">{t('ai.qp.outOf', { n: paper.maxMarks })}</Tag>
                  {ctx.data && <Tag icon={Library}>{t('ai.qp.inBank', { count: ctx.data.bankCount })}</Tag>}
                  <StatusPill tone={statusTone(paper.status)}>{L.status(paper.status)}</StatusPill>
                </div>
              )}
            </>
          )}

          <div className="border-t border-border my-5" />
          <Step n={2} title={t('ai.qp.step2')} hint={t('ai.qp.step2Hint')} />
          <FormField label={t('ai.qp.chapters')} hint={chapterOptions.length ? t('ai.qp.chaptersHint') : t('ai.qp.noChapters')}>
            <div className="space-y-2">
              {chapterOptions.length > 0 && <div className="flex flex-wrap gap-1.5">{chapterOptions.map((c) => <Pill key={c} on={chapters.includes(c)} onClick={() => setChapters((x) => toggleIn(x, c))}>{c}</Pill>)}</div>}
              <div className="flex gap-2">
                <Input value={extraChapter} maxLength={120} placeholder={t('ai.qp.addChapter')} onChange={(e) => setExtraChapter(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && extraChapter.trim()) { e.preventDefault(); setChapters((x) => [...new Set([...x, extraChapter.trim()])]); setExtraChapter('') } }} />
                <Button variant="secondary" icon={Plus} disabled={!extraChapter.trim()} onClick={() => { setChapters((x) => [...new Set([...x, extraChapter.trim()])]); setExtraChapter('') }}>{t('ai.qp.add')}</Button>
              </div>
            </div>
          </FormField>
          <FormField label={t('ai.qp.topics')} hint={t('ai.qp.topicsHint')} className="mt-4">
            <Textarea rows={2} maxLength={1500} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={t('ai.qp.topicsPlaceholder')} />
          </FormField>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-ink-muted">{t('ai.qp.questions')}</p>
              {ctx.data?.paper && <Tag tone="info" icon={FileStack}>{t('ai.qp.fromBlueprint')}</Tag>}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_2rem] gap-2 mb-1 text-[11px] font-medium text-ink-faint">
              <span>{t('ai.qp.type')}</span><span>{t('ai.qp.count')}</span><span>{t('ai.qp.marksEach')}</span><span />
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_auto] gap-2 items-center">
                  <Select aria-label={t('ai.qp.type')} value={r.type} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, type: e.target.value } : y)))}>
                    {TYPES.map((ty) => <option key={ty} value={ty}>{L.type(ty)}</option>)}
                  </Select>
                  <Input type="number" min={1} max={AI_MAX_QUESTIONS} aria-label={t('ai.qp.count')} title={t('ai.qp.count')} value={r.count} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, count: e.target.value } : y)))} />
                  <Input type="number" min={0.25} step={0.25} aria-label={t('ai.qp.marksEach')} title={t('ai.qp.marksEach')} value={r.marks} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, marks: e.target.value } : y)))} />
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={rows.length < 2} aria-label={t('ai.qp.removeRow')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              {rows.length < 6 ? <Button size="sm" variant="ghost" icon={ListPlus} onClick={() => setRows((x) => [...x, { type: 'SHORT', count: 2, marks: 2 }])}>{t('ai.qp.addRow')}</Button> : <span />}
              <span className={clsx('text-xs tabular-nums', tooMany ? 'text-danger-600 font-semibold' : 'text-ink-muted')}>{t('ai.qp.totals', { count: total, marks: number(marks) })}</span>
            </div>
            {tooMany && <p className="text-xs text-danger-600 mt-1">{t('ai.qp.tooMany', { max: AI_MAX_QUESTIONS })}</p>}
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('ai.qp.mix')}</p>
            <div className="h-2.5 rounded-full bg-black/5 overflow-hidden flex" role="img" aria-label={t('ai.qp.mix')}>
              {QP_DIFFICULTIES.map((k) => <div key={k} className={MIX_FILL[k]} style={{ width: `${mixTotal ? ((Number(mix[k]) || 0) / mixTotal) * 100 : 0}%` }} />)}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {QP_DIFFICULTIES.map((k) => (
                <FormField key={k} label={L.diff(k)}>
                  <Input type="number" min={0} max={100} value={mix[k]} onChange={(e) => setMix((m) => ({ ...m, [k]: e.target.value }))} />
                </FormField>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('ai.qp.blooms')}</p>
            <div className="flex flex-wrap gap-1.5">{BLOOM_LEVELS.map((b) => <Pill key={b} on={blooms.includes(b)} onClick={() => setBlooms((x) => toggleIn(x, b))}>{L.bloom(b)}</Pill>)}</div>
          </div>

          <Button className="w-full mt-5" size="lg" icon={Sparkles} loading={gen.isPending} disabled={!paper || !canCreate || !total || tooMany} onClick={() => gen.mutate()}>
            {drafts.length ? t('ai.qp.regenerate', { count: total }) : t('ai.qp.generate', { count: total })}
          </Button>
          {!canCreate && <p className="text-xs text-ink-faint mt-2 text-center">{t('ai.qp.viewOnly')}</p>}
        </Panel>
      </div>

      <Panel
        title={t('ai.qp.reviewTitle')} subtitle={drafts.length ? t('ai.qp.reviewCounts', { accepted: accepted.length, pending: pending.length, total: drafts.length }) : t('ai.qp.reviewHint')} icon={CheckCheck}
        actions={drafts.length > 0 && pending.length > 0 ? <Button size="sm" variant="secondary" icon={CheckCheck}
          onClick={() => setDrafts((list) => list.map((d) => (d.state === 'PENDING' && !Object.keys(d.problems ?? {}).length ? { ...d, state: 'ACCEPTED' } : d)))}>{t('ai.qp.acceptAll')}</Button> : null}
      >
        {gen.isPending ? (
          <div className="space-y-3" role="status">
            <p className="text-sm text-ink-muted flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-500 animate-pulse" aria-hidden />{t('ai.qp.drafting', { count: total })}</p>
            {[0, 1, 2].map((i) => <div key={i} className="rounded-xl border border-border p-4"><SkeletonLines lines={3} /></div>)}
          </div>
        ) : !drafts.length ? (
          <EmptyState icon={Sparkles} title={t('ai.qp.emptyTitle')} hint={t('ai.qp.emptyHint')} />
        ) : (
          <div className="space-y-3">
            {result && (
              <Note tone="success" actions={<Button size="sm" variant="secondary" to="/exams/question-papers">{t('ai.qp.openPapers')}</Button>}>
                {t('ai.qp.savedNote', { count: result.saved })}{' '}
                {result.paper && (result.paper.added > 0
                  ? t('ai.qp.addedToPaper', { count: result.paper.added })
                  : t(`ai.qp.notAdded.${result.paper.reason ?? 'NO_ROOM'}`))}
                {result.paper?.added > 0 && result.paper.skipped > 0 && ` ${t('ai.qp.skipped', { count: result.paper.skipped })}`}
              </Note>
            )}
            {drafts.map((d, i) => (
              <DraftCard key={d.id} d={d} n={i + 1}
                onAccept={() => setDraft(d.id, (x) => ({ ...x, state: x.state === 'ACCEPTED' ? 'PENDING' : 'ACCEPTED' }))}
                onDiscard={() => setDraft(d.id, (x) => ({ ...x, state: 'DISCARDED' }))}
                onRestore={() => setDraft(d.id, (x) => ({ ...x, state: 'PENDING' }))}
                onEdit={() => setEditing(d)} />
            ))}
            <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-surface/95 backdrop-blur border-t border-border flex flex-wrap items-center justify-end gap-3">
              {ctx.data?.paper?.status === 'DRAFT' && (
                <label className="me-auto inline-flex items-center gap-2 text-sm text-ink-muted">
                  <input type="checkbox" checked={sendToPaper} onChange={(e) => setSendToPaper(e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                  {t('ai.qp.sendToPaper')}
                </label>
              )}
              {ctx.data && !ctx.data.paper && <span className="me-auto text-xs text-ink-faint">{t('ai.qp.noPaperYet')}</span>}
              <Button icon={Save} loading={save.isPending} disabled={!accepted.length || !canCreate} onClick={() => save.mutate()}>
                {t('ai.qp.save', { count: accepted.length })}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {editing && (
        <QuestionForm
          section={{ type: editing.type, marks: editing.marks, title: L.type(editing.type) }}
          initial={editing}
          chapters={chapterOptions}
          onClose={() => setEditing(null)}
          onSave={(q) => {
            setDraft(editing.id, (x) => {
              const next = { ...x, ...q, answers: q.answers ?? [], bloom: q.bloom ?? '', edited: true }
              return { ...next, problems: checkQuestion({ ...next, answers: next.answers.length ? next.answers : undefined }) }
            })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** AI › Question paper generator: Claude drafts questions with answers for an exam paper; the teacher keeps the good ones. */
export default function QuestionPapers() {
  const { t } = useTranslation(NS)
  return (
    <PageContainer>
      <PageHeader icon={Wand2} title={t('ai.qp.title')} subtitle={t('ai.qp.subtitle')}
        actions={<Link to="/exams/question-papers" className="text-sm font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5"><FileStack className="w-4 h-4" aria-hidden />{t('ai.qp.openPapers')}</Link>} />
      <AiGate feature="questionPapers">
        <Generator />
      </AiGate>
    </PageContainer>
  )
}
