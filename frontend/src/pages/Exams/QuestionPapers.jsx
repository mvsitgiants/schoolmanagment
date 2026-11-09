import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  ArrowDown, ArrowUp, BadgeCheck, CalendarClock, ChevronLeft, CircleDashed, ClipboardCheck, Copy, Eye, FilePen, FileStack, FileText, History, KeyRound,
  Layers, Library, Lock, LockOpen, PencilLine, Plus, Printer, RefreshCw, Send, Shuffle, Sparkles, Timer, Trash2, Undo2, Wand2,
} from 'lucide-react'
import { DIFFICULTY, QP_DIFFICULTIES, answerText, blueprintTotals, marksMix } from '@schoolgiant/shared'
import {
  ColorChip, ControlChip, DataTable, DateCell, EmptyState, LevelBar, Note, PageContainer, PageHeader, Panel, PersonCell, SectionCard, SegmentedControl,
  SideNav, SideNavLayout, StatCardRow, StatusPill, Tabs, Tag, Timeline, useConfirm, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import {
  BankPicker, BlueprintForm, MixBars, QuestionBody, QuestionChips, QuestionForm, SetsForm, statusTone, useQpLabels,
} from '../../components/exams/QuestionPaperKit'
import {
  addFromBank, approveQuestionPaper, autoPickSet, deleteQuestionPaper, fetchPaperBoard, fetchQuestionPaper, makeSets, recallQuestionPaper, replaceQuestion,
  saveBlueprint, saveSetQuestions, sendBackQuestionPaper, startQuestionPaper, submitQuestionPaper, unlockQuestionPaper, writeQuestion,
} from '../../api/questionPapers'
import { hasPermission } from '../../api/auth'
import { downloadPdf, pdfEnabled, printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const NS = 'questionPapers'
const STATUSES = ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'APPROVED']

// ───────────────────────────────────────────────────────── the board: an exam's papers by class × subject

function PaperTile({ row, canStart, starting, onStart, onOpen }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const p = row.paper
  return (
    <div
      role={p ? 'button' : undefined}
      tabIndex={p ? 0 : undefined}
      onClick={p ? () => onOpen(p.id) : undefined}
      onKeyDown={p ? (e) => { if (e.key === 'Enter') onOpen(p.id) } : undefined}
      className={clsx('rounded-xl border bg-surface p-3 flex flex-col gap-2.5 transition-colors', p ? 'cursor-pointer hover:border-brand-300 border-border' : 'border-dashed border-border')}
    >
      <div className="flex items-start justify-between gap-2">
        <ColorChip label={row.subject} seed={row.subjectId} dot />
        <StatusPill tone={statusTone(row.status)}>{L.status(row.status)}</StatusPill>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <DateCell value={row.date} relative={false} />
        <span className="tabular-nums">{t('questionPapers.board.outOf', { n: row.maxMarks })}</span>
      </div>
      {p ? (
        <>
          <PersonCell name={p.setterName ?? '—'} sub={p.mine ? t('questionPapers.board.you') : t('questionPapers.board.setter')} size={24} />
          <LevelBar value={p.picked} max={p.needed} width="w-full" label={t('questionPapers.board.questions', { picked: p.picked, needed: p.needed })} />
          <div className="flex flex-wrap gap-1.5">
            {p.sets > 1 && <Tag icon={Layers}>{t('questionPapers.board.sets', { count: p.sets })}</Tag>}
            {p.marks !== p.maxMarks && <Tag tone="warning">{t('questionPapers.board.marksOff', { marks: p.marks, max: p.maxMarks })}</Tag>}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint">{t('questionPapers.board.notStartedHint')}</span>
          {canStart && <Button size="sm" variant="secondary" icon={Plus} loading={starting} onClick={() => onStart(row.examPaperId)}>{t('questionPapers.board.start')}</Button>}
        </div>
      )}
    </div>
  )
}

function Board({ examId, onExam, onOpen }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const { showError, showSuccess } = useSnackbar()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [classId, setClassId] = useState('') // the class picked in the side list ('' = all)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['qp-board', examId], queryFn: () => fetchPaperBoard(examId) })
  const canStart = hasPermission('exams.question-papers.create')
  const start = useMutation({
    mutationFn: startQuestionPaper,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['qp-board'] }); qc.setQueryData(['question-paper', p.id], p); showSuccess(t('questionPapers.board.started')); onOpen(p.id) },
    onError: (e) => showError(e.message),
  })
  const rows = data?.rows ?? []
  const shown = rows.filter((r) => (!status || r.status === status) && (!classId || r.classId === classId))
  // the side list: every class of the exam (whatever status is picked), with how far its papers have got
  const nav = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.classId)) m.set(r.classId, { id: r.classId, name: r.className, total: 0, approved: 0, notStarted: 0, waiting: 0 })
      const c = m.get(r.classId)
      c.total += 1
      if (r.status === 'APPROVED') c.approved += 1
      else if (r.status === 'NOT_STARTED') c.notStarted += 1
      else if (r.status === 'SUBMITTED') c.waiting += 1
    }
    return [...m.values()]
  }, [rows])
  const classes = useMemo(() => {
    const out = new Map()
    for (const r of shown) { if (!out.has(r.classId)) out.set(r.classId, { id: r.classId, name: r.className, rows: [] }); out.get(r.classId).rows.push(r) }
    return [...out.values()]
  }, [shown])
  const s = data?.summary
  const pick = (v) => setStatus((cur) => (cur === v ? '' : v))

  return (
    <PageContainer>
      <PageHeader icon={ClipboardCheck} title={t('questionPapers.title')} subtitle={t('questionPapers.subtitle')} />
      {s && s.total > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: FileStack, tone: 'brand', label: t('questionPapers.board.papers'), value: s.total, onClick: () => setStatus('') },
          { icon: CircleDashed, tone: s.NOT_STARTED ? 'danger' : 'neutral', label: L.status('NOT_STARTED'), value: s.NOT_STARTED, onClick: () => pick('NOT_STARTED') },
          { icon: FilePen, tone: 'warning', label: L.status('DRAFT'), value: s.DRAFT, onClick: () => pick('DRAFT') },
          { icon: Send, tone: 'info', label: L.status('SUBMITTED'), value: s.SUBMITTED, onClick: () => pick('SUBMITTED') },
          { icon: BadgeCheck, tone: 'success', label: L.status('APPROVED'), value: s.APPROVED, progress: (s.APPROVED / s.total) * 100, onClick: () => pick('APPROVED') },
        ]} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <SegmentedControl
          options={[{ value: '', label: t('questionPapers.board.all'), count: s?.total }, ...STATUSES.map((v) => ({ value: v, label: L.status(v), count: s?.[v] }))]}
          value={status} onChange={setStatus}
        />
        <ControlChip icon={CalendarClock} label={t('questionPapers.board.exam')} value={data?.exam?.name ?? t('questionPapers.board.noExam')} active={!!data?.exam}
          options={(data?.exams ?? []).map((e) => e.name)} onChange={(v) => onExam(data.exams.find((e) => e.name === v)?.id ?? '')} />
      </div>
      {data?.limited && <Note className="mb-4">{t('questionPapers.board.limited')}</Note>}
      {isLoading || error || !rows.length ? (
        <EmptyState icon={ClipboardCheck} error={error} onRetry={refetch}
          title={isLoading ? t('questionPapers.loading') : !data?.exams?.length ? t('questionPapers.board.noExams') : t('questionPapers.board.empty')}
          hint={!isLoading && !data?.exams?.length ? t('questionPapers.board.noExamsHint') : undefined} />
      ) : (
        <SideNavLayout nav={nav.length > 1 && <SideNav title={t('questionPapers.board.classes')} value={classId} onChange={setClassId} items={[
          { id: '', label: t('questionPapers.board.allClasses'), icon: Layers, count: `${s?.APPROVED ?? 0}/${s?.total ?? 0}` },
          ...nav.map((c) => ({
            id: c.id, label: c.name,
            hint: [c.notStarted ? t('questionPapers.board.navNotStarted', { count: c.notStarted }) : null, c.waiting ? t('questionPapers.board.navWaiting', { count: c.waiting }) : null].filter(Boolean).join(' · ') || t('questionPapers.board.navAllDone'),
            count: `${c.approved}/${c.total}`, countTone: c.waiting ? 'warning' : undefined,
            progress: { value: c.approved, max: c.total, warnPct: 101 },
          })),
        ]} />}>
        <div className="space-y-4">
          {!classes.length && <EmptyState icon={ClipboardCheck} title={t('questionPapers.board.empty')} />}
          {classes.map((c) => {
            const done = c.rows.filter((r) => r.status === 'APPROVED').length
            return (
              <SectionCard key={c.id} title={<ColorChip label={c.name} seed={c.id} />} count={c.rows.length}
                actions={<LevelBar value={done} max={c.rows.length} label={t('questionPapers.board.approvedOf', { done, total: c.rows.length })} width="w-40" />}>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {c.rows.map((r) => (
                    <PaperTile key={r.examPaperId} row={r} canStart={canStart} starting={start.isPending && start.variables === r.examPaperId} onStart={(id) => start.mutate(id)} onOpen={onOpen} />
                  ))}
                </div>
              </SectionCard>
            )
          })}
        </div>
        </SideNavLayout>
      )}
    </PageContainer>
  )
}

// ───────────────────────────────────────────────────────── one paper

const HISTORY_ICON = { CREATED: Plus, SUBMITTED: Send, RECALLED: Undo2, SENT_BACK: Undo2, APPROVED: BadgeCheck, UNLOCKED: LockOpen, SETS: Layers }
const HISTORY_TONE = { CREATED: 'brand', SUBMITTED: 'info', RECALLED: 'neutral', SENT_BACK: 'warning', APPROVED: 'success', UNLOCKED: 'danger', SETS: 'violet' }
const DIFF_FILL = { EASY: 'success', MEDIUM: 'warning', HARD: 'danger' }

/** One question (and its OR alternative) on the editor, with what can be done to it. */
function QuestionCard({ no, item, section, editable, busy, first, last, onMove, onEdit, onSuggest, onRemove, onPick, onWrite }) {
  const { t } = useTranslation(NS)
  const tools = (part) => editable && (
    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="ghost" icon={Sparkles} disabled={busy} title={t('questionPapers.card.suggest')} aria-label={t('questionPapers.card.suggest')} onClick={() => onSuggest(part)} />
      <Button size="sm" variant="ghost" icon={PencilLine} disabled={busy} title={t('questionPapers.card.edit')} aria-label={t('questionPapers.card.edit')} onClick={() => onEdit(part)} />
      <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} title={t('questionPapers.card.remove')} aria-label={t('questionPapers.card.remove')} onClick={() => onRemove(part)} />
    </div>
  )
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-1 shrink-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-xs font-semibold tabular-nums">{no}</span>
          {editable && <>
            <Button size="sm" variant="ghost" icon={ArrowUp} disabled={first || busy} aria-label={t('questionPapers.actions.moveUp')} onClick={() => onMove(-1)} />
            <Button size="sm" variant="ghost" icon={ArrowDown} disabled={last || busy} aria-label={t('questionPapers.actions.moveDown')} onClick={() => onMove(1)} />
          </>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <QuestionBody q={item} />
            <Tag tone="brand" className="shrink-0">{t('questionPapers.card.marks', { count: section.marks })}</Tag>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <QuestionChips q={item} />
            <div className="flex items-center gap-2">
              {!item.questionId && <Tag icon={PencilLine}>{t('questionPapers.card.written')}</Tag>}
              {tools('main')}
            </div>
          </div>
          {section.choice && (
            <div className="rounded-lg bg-bg p-2.5 space-y-2">
              <p className="text-[11px] font-bold tracking-widest text-ink-muted">{t('questionPapers.card.or')}</p>
              {item.or ? (
                <>
                  <QuestionBody q={item.or} />
                  <div className="flex flex-wrap items-center justify-between gap-2"><QuestionChips q={item.or} />{tools('or')}</div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-amber-700">{t('questionPapers.card.noOr')}</span>
                  {editable && <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" icon={Sparkles} disabled={busy} onClick={() => onSuggest('or')}>{t('questionPapers.card.suggest')}</Button>
                    <Button size="sm" variant="ghost" icon={Library} disabled={busy} onClick={() => onPick('or')}>{t('questionPapers.section.pick')}</Button>
                    <Button size="sm" variant="ghost" icon={PencilLine} disabled={busy} onClick={() => onWrite('or')}>{t('questionPapers.section.write')}</Button>
                  </div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PaperEditor({ id, onBack }) {
  const { t } = useTranslation(NS)
  const L = useQpLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const key = ['question-paper', id]
  const { data: paper, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchQuestionPaper(id) })
  const [setId, setSetId] = useState(null)
  const [view, setView] = useState('questions')
  const [modal, setModal] = useState(null) // { kind: 'blueprint' | 'sets' | 'form' | 'bank', section, index, part, initial }
  const [busy, setBusy] = useState(false)

  const set = paper?.sets.find((s) => s.id === setId) ?? paper?.sets[0]
  const run = async (fn, message) => {
    setBusy(true)
    try {
      const out = await fn()
      qc.setQueryData(key, out)
      qc.invalidateQueries({ queryKey: ['qp-board'] })
      if (message) showSuccess(typeof message === 'function' ? message(out) : message)
      return out
    } catch (e) { showError(e.message); return null } finally { setBusy(false) }
  }

  if (isLoading) return <PageContainer><p className="text-sm text-ink-faint">{t('questionPapers.loading')}</p></PageContainer>
  if (error || !paper) return <PageContainer><EmptyState icon={ClipboardCheck} error={error} onRetry={refetch} title={t('questionPapers.notFound')} action={<Button variant="secondary" icon={ChevronLeft} onClick={onBack}>{t('questionPapers.back')}</Button>} /></PageContainer>

  const derived = paper.setMode === 'SHUFFLE' && set.letter !== 'A'
  const editable = paper.can.edit && !derived
  const sectionItems = (sectionId) => set.sections.find((x) => x.sectionId === sectionId)?.items ?? []
  const saveItems = (sectionId, items, msg) => run(() => saveSetQuestions(paper.id, set.id, set.sections.map((x) => (x.sectionId === sectionId ? { sectionId, items } : x))), msg)
  const move = (sectionId, i, d) => { const items = [...sectionItems(sectionId)]; [items[i], items[i + d]] = [items[i + d], items[i]]; saveItems(sectionId, items) }
  const remove = async (section, i, part) => {
    if (!(await confirm({ title: t('questionPapers.card.removeConfirm'), tone: 'danger', confirmLabel: t('questionPapers.card.remove') }))) return
    const items = sectionItems(section.id)
    saveItems(section.id, part === 'or' ? items.map((it, k) => (k === i ? { ...it, or: null } : it)) : items.filter((_, k) => k !== i), t('questionPapers.card.removed'))
  }
  const autoPick = (sectionId, refill) => run(() => autoPickSet(paper.id, set.id, { sectionId, refill }), (out) => (out.short?.length
    ? t('questionPapers.autoPick.short', { picked: out.picked, missing: out.short.reduce((n, x) => n + x.missing, 0) })
    : t('questionPapers.autoPick.done', { count: out.picked })))
  const refillAll = async () => {
    if (!(await confirm({ title: t('questionPapers.autoPick.refillConfirm.title'), message: t('questionPapers.autoPick.refillConfirm.message', { set: set.letter }), confirmLabel: t('questionPapers.autoPick.refill') }))) return
    autoPick(undefined, true)
  }
  const suggest = (sectionId, index, part) => run(() => replaceQuestion(paper.id, set.id, { sectionId, index, part }), t('questionPapers.card.replaced'))
  const saveForm = async (q, { saveToBank }) => {
    const { section, index, part, initial } = modal
    let out
    if (initial) {
      const items = sectionItems(section.id).map((it, k) => (k !== index ? it : part === 'or' ? { ...it, or: q } : { ...q, or: it.or }))
      out = await saveItems(section.id, items, t('questionPapers.form.saved'))
    } else out = await run(() => writeQuestion(paper.id, set.id, { sectionId: section.id, question: q, saveToBank, index, part }), t('questionPapers.form.added'))
    if (out) setModal(null)
  }
  const pickFromBank = async (ids) => {
    const { section, index, part } = modal
    const out = await run(() => addFromBank(paper.id, set.id, { sectionId: section.id, questionIds: ids, index, part }), t('questionPapers.bank.added', { count: ids.length }))
    if (out) setModal(null)
  }
  const workflow = {
    submit: async () => {
      if (!(await confirm({ title: t('questionPapers.flow.submitConfirm.title'), message: t('questionPapers.flow.submitConfirm.message'), confirmLabel: t('questionPapers.flow.submit') }))) return
      run(() => submitQuestionPaper(paper.id), t('questionPapers.flow.submitted'))
    },
    recall: () => run(() => recallQuestionPaper(paper.id), t('questionPapers.flow.recalled')),
    approve: async () => {
      const note = await prompt({ title: t('questionPapers.flow.approveConfirm.title'), message: t('questionPapers.flow.approveConfirm.message'), label: t('questionPapers.flow.noteOptional'), confirmLabel: t('questionPapers.flow.approve') })
      if (note === null || note === undefined) return
      run(() => approveQuestionPaper(paper.id, note || undefined), t('questionPapers.flow.approved'))
    },
    sendBack: async () => {
      const note = await prompt({ title: t('questionPapers.flow.sendBackConfirm.title'), message: t('questionPapers.flow.sendBackConfirm.message'), label: t('questionPapers.flow.whatToChange'), required: true, confirmLabel: t('questionPapers.flow.sendBack') })
      if (note) run(() => sendBackQuestionPaper(paper.id, note), t('questionPapers.flow.sentBack'))
    },
    unlock: async () => {
      const reason = await prompt({ title: t('questionPapers.flow.unlockConfirm.title'), message: t('questionPapers.flow.unlockConfirm.message'), label: t('questionPapers.flow.reason'), required: true, confirmLabel: t('questionPapers.flow.unlock') })
      if (reason) run(() => unlockQuestionPaper(paper.id, reason), t('questionPapers.flow.unlocked'))
    },
    remove: async () => {
      if (!(await confirm({ title: t('questionPapers.flow.deleteConfirm.title'), message: t('questionPapers.flow.deleteConfirm.message'), tone: 'danger', confirmLabel: t('questionPapers.flow.delete') }))) return
      try { await deleteQuestionPaper(paper.id); qc.invalidateQueries({ queryKey: ['qp-board'] }); showSuccess(t('questionPapers.flow.deleted')); onBack() } catch (e) { showError(e.message) }
    },
  }

  // numbers run on through the sections
  let n = 0
  const numbered = paper.sections.map((s) => { const items = sectionItems(s.id); const start = n; n += items.length; return { s, items, start } })
  const totals = blueprintTotals(paper)
  const progress = set.progress
  const written = totals.written || 1
  const diffMix = marksMix(paper, set, 'difficulty')
  const chapterMix = marksMix(paper, set, 'chapter')
  const hasMix = QP_DIFFICULTIES.some((d) => paper.difficulty?.[d] > 0)
  const chapterRows = [...new Set([...paper.chapters.map((c) => c.chapter), ...Object.keys(chapterMix)])].map((c) => ({
    key: c, label: c === '—' ? t('questionPapers.mix.noChapter') : c, target: paper.chapters.find((x) => x.chapter.toLowerCase() === c.toLowerCase())?.weight ?? (paper.chapters.length ? 0 : null), marks: chapterMix[c] ?? 0, tone: 'brand',
  }))
  const lastSentBack = paper.status === 'DRAFT' && paper.history[0]?.action === 'SENT_BACK' ? paper.history[0] : null
  const mismatch = paper.warnings.find((w) => w.code === 'MARKS_MISMATCH')
  const keyRows = numbered.flatMap(({ s, items, start }) => items.flatMap((it, k) => [
    { id: `${s.id}-${k}`, no: start + k + 1, section: s.title, type: it.type, answer: answerText(it), scheme: it.explanation ?? '', marks: s.marks },
    ...(it.or ? [{ id: `${s.id}-${k}-or`, no: start + k + 1, or: true, section: s.title, type: it.or.type, answer: answerText(it.or), scheme: it.or.explanation ?? '', marks: s.marks }] : []),
  ]))
  const print = (doc, preview) => printDocument(doc, set.id, { print: !preview })

  return (
    <PageContainer>
      <Button size="sm" variant="ghost" icon={ChevronLeft} className="mb-2" onClick={onBack}>{t('questionPapers.back')}</Button>
      <PageHeader icon={ClipboardCheck}
        title={<span className="inline-flex flex-wrap items-center gap-2">{t('questionPapers.editor.title', { subject: paper.subject, cls: paper.className })}<StatusPill tone={statusTone(paper.status)}>{L.status(paper.status)}</StatusPill></span>}
        subtitle={t('questionPapers.editor.subtitle', { exam: paper.exam?.name ?? '', setter: paper.setterName ?? '—' })}
        actions={<div className="flex flex-wrap gap-2">
          {paper.can.print && <>
            <Button variant="secondary" icon={Eye} onClick={() => print('QUESTION_PAPER', true)}>{t('questionPapers.print.preview')}</Button>
            <Button variant="secondary" icon={Printer} onClick={() => print('QUESTION_PAPER')}>{t('questionPapers.print.paper', { set: set.letter })}</Button>
            <Button variant="secondary" icon={KeyRound} onClick={() => print('ANSWER_KEY')}>{t('questionPapers.print.key')}</Button>
            {pdfEnabled() && <Button variant="ghost" icon={FileText} onClick={() => downloadPdf('QUESTION_PAPER', set.id)}>{t('questionPapers.print.pdf')}</Button>}
          </>}
          {paper.can.submit && <Button icon={Send} loading={busy} onClick={workflow.submit}>{t('questionPapers.flow.submit')}</Button>}
          {paper.can.recall && <Button variant="secondary" icon={Undo2} loading={busy} onClick={workflow.recall}>{t('questionPapers.flow.recall')}</Button>}
          {paper.can.approve && <Button variant="secondary" icon={Undo2} loading={busy} onClick={workflow.sendBack}>{t('questionPapers.flow.sendBack')}</Button>}
          {paper.can.approve && <Button icon={BadgeCheck} loading={busy} onClick={workflow.approve}>{t('questionPapers.flow.approve')}</Button>}
          {paper.can.unlock && <Button variant="secondary" icon={LockOpen} loading={busy} onClick={workflow.unlock}>{t('questionPapers.flow.unlock')}</Button>}
          {paper.can.delete && <Button variant="ghost" icon={Trash2} aria-label={t('questionPapers.flow.delete')} title={t('questionPapers.flow.delete')} onClick={workflow.remove} />}
        </div>}
      />

      <div className="space-y-3 mb-4">
        {lastSentBack && <Note tone="warning" icon={Undo2}>{t('questionPapers.flow.sentBackNote', { by: lastSentBack.by ?? '—', note: lastSentBack.note ?? '' })}</Note>}
        {paper.status === 'SUBMITTED' && <Note icon={Send}>{t('questionPapers.flow.waiting', { at: dateTime(paper.submittedAt) })}</Note>}
        {paper.status === 'APPROVED' && <Note tone="success" icon={Lock}>{t('questionPapers.flow.lockedNote', { by: paper.approvedBy ?? '—', at: dateTime(paper.approvedAt) })}</Note>}
        {mismatch && <Note tone="warning">{t('questionPapers.warnings.MARKS_MISMATCH', { total: mismatch.total, max: mismatch.maxMarks })}</Note>}
        {paper.bank.count === 0 && paper.can.edit && <Note>{t('questionPapers.editor.noBank')}</Note>}
      </div>

      <StatCardRow className="mb-4" items={[
        { icon: ClipboardCheck, tone: totals.total === paper.maxMarks ? 'success' : 'warning', label: t('questionPapers.editor.marks'), value: `${totals.total} / ${paper.maxMarks}`, sub: t('questionPapers.editor.marksSub', { count: paper.sections.length }) },
        { icon: FileStack, tone: progress.complete ? 'success' : 'brand', label: t('questionPapers.editor.questions', { set: set.letter }), value: `${progress.picked} / ${progress.needed}`, progress: progress.needed ? (progress.picked / progress.needed) * 100 : 0 },
        { icon: Layers, tone: 'violet', label: t('questionPapers.editor.sets'), value: paper.sets.length, sub: paper.sets.length > 1 ? L.mode(paper.setMode) : t('questionPapers.editor.oneSet') },
        { icon: Timer, tone: 'sky', label: t('questionPapers.editor.duration'), value: paper.durationMin ? t('questionPapers.editor.minutes', { count: paper.durationMin }) : '—', sub: paper.date ? `${paper.date}${paper.startTime ? ` · ${paper.startTime}` : ''}` : undefined },
      ]} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Tabs tabs={paper.sets.map((s) => ({ value: s.id, label: t('questionPapers.editor.setTab', { letter: s.letter }) }))} value={set.id} onChange={setSetId} />
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl options={[{ value: 'questions', label: t('questionPapers.editor.viewQuestions') }, { value: 'key', label: t('questionPapers.editor.viewKey') }]} value={view} onChange={setView} />
              {editable && view === 'questions' && <>
                <Button size="sm" icon={Wand2} loading={busy} disabled={progress.complete} onClick={() => autoPick()}>{t('questionPapers.autoPick.fill')}</Button>
                <Button size="sm" variant="secondary" icon={RefreshCw} disabled={busy} onClick={refillAll}>{t('questionPapers.autoPick.refill')}</Button>
              </>}
            </div>
          </div>
          {derived && <Note icon={Shuffle}>{t('questionPapers.editor.derived', { set: set.letter })}</Note>}

          {view === 'key' ? (
            <DataTable
              rows={keyRows}
              dense
              columns={[
                { key: 'no', header: t('questionPapers.key.no'), width: 60, render: (v, r) => <span className="font-semibold tabular-nums">{r.or ? t('questionPapers.card.or') : v}</span> },
                { key: 'section', header: t('questionPapers.key.section'), render: (v) => <ColorChip label={v} dot /> },
                { key: 'answer', header: t('questionPapers.key.answer'), mobilePrimary: true, render: (v) => (v ? <span className="whitespace-pre-line text-emerald-700">{v}</span> : <span className="text-amber-700">{t('questionPapers.key.noAnswer')}</span>) },
                { key: 'scheme', header: t('questionPapers.key.scheme'), render: (v) => <span className="whitespace-pre-line text-ink-muted">{v || '—'}</span> },
                { key: 'marks', header: t('questionPapers.key.marks'), align: 'right', render: (v) => <span className="tabular-nums">{v}</span> },
              ]}
              emptyIcon={KeyRound} emptyTitle={t('questionPapers.key.empty')}
            />
          ) : numbered.map(({ s, items, start }) => {
            const pr = progress.sections.find((x) => x.id === s.id)
            const free = Math.max(0, s.count - items.length)
            return (
              <SectionCard key={s.id} icon={FileText} title={`${s.title} — ${L.type(s.type)}`}
                hint={[
                  t('questionPapers.section.marksLine', { count: s.count, marks: s.marks, total: (s.attempt || s.count) * s.marks }),
                  s.attempt && s.attempt < s.count ? t('questionPapers.section.attempt', { n: s.attempt, of: s.count }) : null,
                  s.choice ? t('questionPapers.section.choice') : null,
                ].filter(Boolean).join(' · ')}
                actions={<>
                  <LevelBar value={pr?.picked ?? 0} max={pr?.needed ?? 0} width="w-28" />
                  {editable && <Button size="sm" variant="ghost" icon={Wand2} disabled={busy || !pr?.missing} onClick={() => autoPick(s.id)}>{t('questionPapers.section.autoPick')}</Button>}
                </>}>
                <div className="space-y-2">
                  {s.instructions && <p className="text-xs italic text-ink-muted">{s.instructions}</p>}
                  {items.map((it, k) => (
                    <QuestionCard key={`${k}-${it.questionId ?? it.text.slice(0, 20)}`} no={start + k + 1} item={it} section={s} editable={editable} busy={busy}
                      first={k === 0} last={k === items.length - 1}
                      onMove={(d) => move(s.id, k, d)}
                      onEdit={(part) => setModal({ kind: 'form', section: s, index: k, part, initial: part === 'or' ? it.or : it })}
                      onSuggest={(part) => suggest(s.id, k, part)}
                      onRemove={(part) => remove(s, k, part)}
                      onPick={(part) => setModal({ kind: 'bank', section: s, index: k, part })}
                      onWrite={(part) => setModal({ kind: 'form', section: s, index: k, part })} />
                  ))}
                  {pr?.extra > 0 && <Note tone="warning">{t('questionPapers.section.extra', { count: pr.extra })}</Note>}
                  {free > 0 && (
                    <div className="rounded-xl border border-dashed border-border p-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-ink-muted">{t('questionPapers.section.free', { count: free })}</span>
                      {editable && <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" icon={Library} disabled={busy} onClick={() => setModal({ kind: 'bank', section: s })}>{t('questionPapers.section.pick')}</Button>
                        <Button size="sm" variant="ghost" icon={PencilLine} disabled={busy} onClick={() => setModal({ kind: 'form', section: s })}>{t('questionPapers.section.write')}</Button>
                      </div>}
                    </div>
                  )}
                </div>
              </SectionCard>
            )
          })}
        </div>

        <div className="space-y-4 min-w-0">
          <Panel title={t('questionPapers.editor.blueprint')} icon={ClipboardCheck}
            actions={paper.can.edit && <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setModal({ kind: 'blueprint' })}>{t('questionPapers.editor.editBlueprint')}</Button>}>
            <div className="space-y-2">
              {paper.sections.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium text-ink">{s.title}</span> <span className="text-ink-muted">· {L.type(s.type)}</span></span>
                  <span className="tabular-nums text-ink-muted shrink-0">{s.count} × {s.marks}{s.attempt && s.attempt < s.count ? ` (${s.attempt})` : ''} = <b className="text-ink">{totals.sections[i].total}</b></span>
                </div>
              ))}
              <div className={clsx('flex items-center justify-between border-t border-border pt-2 text-sm font-semibold', totals.total === paper.maxMarks ? 'text-emerald-700' : 'text-amber-700')}>
                <span>{t('questionPapers.editor.total')}</span><span className="tabular-nums">{totals.total} / {paper.maxMarks}</span>
              </div>
              {paper.instructions && <p className="text-xs text-ink-muted whitespace-pre-line pt-1">{paper.instructions}</p>}
            </div>
          </Panel>

          <Panel title={t('questionPapers.mix.difficulty', { set: set.letter })} icon={Sparkles}>
            <MixBars total={written} rows={QP_DIFFICULTIES.map((d) => ({ key: d, label: L.diff(d), target: hasMix ? paper.difficulty[d] : null, marks: diffMix[d] ?? 0, tone: DIFF_FILL[d] ?? DIFFICULTY[d]?.tone }))} />
            {!hasMix && <p className="text-xs text-ink-faint mt-2">{t('questionPapers.mix.noTarget')}</p>}
          </Panel>

          <Panel title={t('questionPapers.mix.chapters', { set: set.letter })} icon={FileText}>
            <MixBars total={written} rows={chapterRows} />
          </Panel>

          <Panel title={t('questionPapers.sets.panel')} icon={Copy}
            actions={paper.can.edit && <Button size="sm" variant="ghost" icon={Layers} onClick={() => setModal({ kind: 'sets' })}>{t('questionPapers.sets.make')}</Button>}>
            <div className="flex flex-wrap gap-1.5">
              {paper.sets.map((s) => (
                <button key={s.id} type="button" onClick={() => setSetId(s.id)}
                  className={clsx('rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums', s.id === set.id ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:bg-bg')}>
                  {s.letter}<span className="ms-1.5 text-[11px] font-normal">{s.progress.picked}/{s.progress.needed}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-muted mt-2">{paper.sets.length > 1 ? t(`questionPapers.sets.hint.${paper.setMode}`) : t('questionPapers.sets.onlyA')}</p>
          </Panel>

          <Panel title={t('questionPapers.history.title')} icon={History}>
            <Timeline dense items={paper.history.map((h, i) => ({
              id: i, icon: HISTORY_ICON[h.action] ?? CircleDashed, tone: HISTORY_TONE[h.action] ?? 'neutral',
              title: t(`questionPapers.history.${h.action}`), time: dateTime(h.at), meta: h.by ?? undefined, body: h.note ? <p className="text-xs text-ink whitespace-pre-line">{h.note}</p> : undefined,
            }))} />
            {paper.printed > 0 && <p className="text-xs text-ink-faint mt-3 inline-flex items-center gap-1"><Printer className="w-3.5 h-3.5" aria-hidden />{t('questionPapers.history.printed', { count: paper.printed, by: paper.lastPrintedBy ?? '—', at: dateTime(paper.lastPrintedAt) })}</p>}
          </Panel>
        </div>
      </div>

      {modal?.kind === 'blueprint' && <BlueprintForm paper={paper} saving={busy} onClose={() => setModal(null)}
        onSave={async (body) => { if (await run(() => saveBlueprint(paper.id, body), t('questionPapers.blueprint.saved'))) setModal(null) }} />}
      {modal?.kind === 'sets' && <SetsForm paper={paper} saving={busy} onClose={() => setModal(null)}
        onSave={async (body) => {
          const out = await run(() => makeSets(paper.id, body), (o) => (o.short?.length ? t('questionPapers.sets.short', { sets: o.short.map((x) => x.letter).join(', ') }) : t('questionPapers.sets.made', { count: body.count })))
          if (out) setModal(null)
        }} />}
      {modal?.kind === 'form' && <QuestionForm section={modal.section} initial={modal.initial} chapters={paper.bank.chapters} canSaveToBank={paper.can.saveToBank} saving={busy}
        onClose={() => setModal(null)} onSave={saveForm} />}
      {modal?.kind === 'bank' && <BankPicker paper={paper} section={modal.section} single={modal.index !== undefined} saving={busy}
        onClose={() => setModal(null)} onPick={pickFromBank} />}
      {busy && <span className="sr-only" aria-live="polite">{t('questionPapers.loading')}</span>}
    </PageContainer>
  )
}

export default function QuestionPapers() {
  const [params, setParams] = useSearchParams()
  const examId = params.get('exam') ?? ''
  const paperId = params.get('paper') ?? ''
  const go = (next) => setParams(Object.fromEntries(Object.entries({ exam: examId, paper: paperId, ...next }).filter(([, v]) => v)), { replace: false })
  return paperId
    ? <PaperEditor key={paperId} id={paperId} onBack={() => go({ paper: '' })} />
    : <Board examId={examId} onExam={(v) => go({ exam: v })} onOpen={(id) => go({ paper: id })} />
}
