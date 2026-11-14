import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, CalendarClock, Check, CheckCheck, ChevronDown, ChevronUp, CircleDashed, LayoutPanelTop, Lightbulb, MessageCircleQuestion, NotebookPen, Plus, Presentation, RotateCcw, SkipForward, Trash2 } from 'lucide-react'
import { TOPIC_STATUS } from '@schoolgiant/shared'
import { DateInput, Attachments, FormField, Input, Modal, ProgressBar, StatusPill, Textarea } from '../system'
import Button from '../ui/Button'
import { updateTopicPlan } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// Pieces of a syllabus topic: its material, questions, the marking buttons and the hub link — put together by TopicPanel.

/** "NCERT Maths · Ch 3 · p. 45–52" from a topic's book reference. */
export function bookLine(book) {
  return [book?.name, book?.chapter, book?.pages].filter(Boolean).join(' · ')
}

export function TopicStatusPill({ status }) {
  const { t } = useTranslation('homework')
  return <StatusPill tone={TOPIC_STATUS[status]?.tone}>{t(`homework.topic.status.${status}`)}</StatusPill>
}

/** How a subject stands in this class: taught / total, on track or behind, revisions, extra classes. */
export function ProgressStrip({ p }) {
  const { t } = useTranslation('homework')
  if (!p.total) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex items-center gap-2 flex-1 min-w-[10rem]"><div className="flex-1"><ProgressBar value={p.pct} showValue={false} /></div><span className="text-xs text-ink-muted tabular-nums">{t('homework.teach.taughtOf', { done: p.taught, total: p.total })}</span></div>
      {p.behind ? <StatusPill tone="danger">{t('homework.syllabus.plan.behindN', { count: p.behind })}</StatusPill> : <StatusPill tone="neutral">{t('homework.teach.onTrack')}</StatusPill>}
      {p.revision > 0 && <StatusPill tone="warning">{t('homework.teach.revisionN', { count: p.revision })}</StatusPill>}
      {p.extraDone + p.extraDue > 0 && <span className="text-xs text-ink-muted">{t('homework.teach.extraN', { done: p.extraDone, total: p.extraDone + p.extraDue })}</span>}
    </div>
  )
}

/** One question with its answer folded away. */
function QuestionRow({ q, n }) {
  const { t } = useTranslation('homework')
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg bg-black/[0.025] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold text-ink-faint mt-0.5 shrink-0">{n}.</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink whitespace-pre-line">{q.question}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <StatusPill tone="neutral" dot={false}>{t(`homework.topic.kind.${q.kind}`)}</StatusPill>
            {q.use === 'HOMEWORK' && <StatusPill tone="info" dot={false}>{t('homework.topic.use.HOMEWORK')}</StatusPill>}
          </div>
          {q.kind === 'MCQ' && q.options.length > 0 && (
            <ol className="mt-1.5 grid gap-0.5 text-sm text-ink-muted list-[lower-alpha] ps-5">{q.options.map((o, i) => <li key={i}>{o}</li>)}</ol>
          )}
          {q.answer && (
            <>
              <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 inline-flex items-center gap-1 py-1 text-xs font-medium text-brand-600 hover:underline">
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{open ? t('homework.topic.hideAnswer') : t('homework.topic.showAnswer')}
              </button>
              {open && <p className="mt-1 rounded-md bg-brand-50/50 px-2.5 py-2 text-sm text-ink whitespace-pre-line">{q.answer}</p>}
            </>
          )}
        </div>
      </div>
    </li>
  )
}

/** A topic's teaching material, read-only: book and files, how to teach it, key points, questions. */
export function TopicMaterial({ topic, files = true, questions = true }) {
  const { t } = useTranslation('homework')
  const book = bookLine(topic.book)
  const empty = !book && !topic.howTo && !topic.keyPoints?.length && !topic.questions?.length && !topic.homeworkHint
  if (empty) return <p className="text-sm text-ink-faint">{t('homework.topic.noMaterial')}</p>
  const Head = ({ icon: Icon, children }) => <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink mb-1.5"><Icon className="w-4 h-4 text-brand-600" aria-hidden />{children}</p>
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          {topic.howTo && (
            <div className="rounded-lg bg-brand-50/50 border border-brand-100 px-3 py-2.5">
              <Head icon={Presentation}>{t('homework.topic.howTo')}</Head>
              <p className="text-sm leading-relaxed text-ink whitespace-pre-line">{topic.howTo}</p>
            </div>
          )}
          {topic.keyPoints?.length > 0 && (
            <div>
              <Head icon={Lightbulb}>{t('homework.topic.keyPoints')}</Head>
              <ul className="space-y-1">{topic.keyPoints.map((k, i) => <li key={i} className="flex items-start gap-2 text-sm text-ink"><Check className="w-4 h-4 mt-0.5 shrink-0 text-success-600" aria-hidden /><span>{k}</span></li>)}</ul>
            </div>
          )}
        </div>
        <div className="space-y-3 min-w-0">
          {book && (
            <div className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-md bg-amber-50 text-amber-600 shrink-0"><BookOpen className="w-4 h-4" aria-hidden /></span>
              <span className="min-w-0"><span className="block text-xs text-ink-muted">{t('homework.topic.bookRef')}</span><span className="block text-sm font-medium text-ink">{book}</span></span>
            </div>
          )}
          {files && <Attachments entityType="syllabus_topic" entityId={topic.id} canAdd={false} compact hideEmpty label={t('homework.topic.files')} />}
          {topic.homeworkHint && (
            <div className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-md bg-sky-50 text-sky-600 shrink-0"><NotebookPen className="w-4 h-4" aria-hidden /></span>
              <span className="min-w-0"><span className="block text-xs text-ink-muted">{t('homework.topic.homeworkHint')}</span><span className="block text-sm text-ink whitespace-pre-line">{topic.homeworkHint}</span></span>
            </div>
          )}
        </div>
      </div>
      {questions && topic.questions?.length > 0 && (
        <div>
          <Head icon={MessageCircleQuestion}>{t('homework.topic.questions', { count: topic.questions.length })}</Head>
          <ul className="grid gap-2 md:grid-cols-2">{topic.questions.map((q, i) => <QuestionRow key={q.id ?? i} q={q} n={i + 1} />)}</ul>
        </div>
      )}
    </div>
  )
}

/** The Teaching hub, opened at a topic (needs its class and subject; the unit is found from the topic when left out). */
export const hubLink = (tp) => `/teaching/hub?${new URLSearchParams(Object.entries({ classId: tp.classId, subjectId: tp.subjectId, unitId: tp.unitId, topicId: tp.id }).filter(([, v]) => v))}`

/** A topic's questions on their own (the lesson view shows them in a section of their own). */
export function TopicQuestions({ topic }) {
  if (!topic.questions?.length) return null
  return <ul className="grid gap-2 md:grid-cols-2">{topic.questions.map((q, i) => <QuestionRow key={q.id ?? i} q={q} n={i + 1} />)}</ul>
}

/** "Open in Teaching hub" — a link, or (`prominent`) a button-like link. Nothing without the hub's view right. */
export function OpenInHub({ topic, prominent = false, label, className = '' }) {
  const { t } = useTranslation('homework')
  if (!topic?.classId || !topic?.subjectId || !hasPermission('homework.hub.view')) return null
  return (
    <Link to={hubLink(topic)} className={prominent
      ? `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 ${className}`
      : `inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline ${className}`}>
      <LayoutPanelTop className="h-4 w-4 shrink-0" aria-hidden />{label ?? t('homework.topic.openInHub')}{prominent && <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />}
    </Link>
  )
}

/** Pick a date (and period, note) for an extra class. */
function ExtraClassModal({ defaultDate, onClose, onSave, saving }) {
  const { t } = useTranslation('homework')
  const [form, setForm] = useState({ date: defaultDate, period: '', note: '' })
  return (
    <Modal open onClose={onClose} title={t('homework.topic.extra.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={saving} disabled={!form.date} onClick={() => onSave({ date: form.date, period: form.period ? Number(form.period) : undefined, note: form.note || undefined })}>{t('homework.topic.extra.add')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('homework.topic.extra.date')} required><DateInput value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></FormField>
        <FormField label={t('homework.topic.extra.period')}><Input type="number" min="1" max="15" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} /></FormField>
        <FormField label={t('homework.topic.extra.note')} className="col-span-2"><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

/**
 * What a teacher does with a topic in one section: Taught / Partly / Not taught (on `date`), needs
 * revision, extra classes, and — when `onHomework` is given — give homework. `row` is the topic's
 * record in that section ({ id, status, needsRevision, extraClasses }).
 */
/**
 * Asked before a topic is marked taught (it can't be undone): Taught, Partly taught, or Cancel.
 * const [askMark, markDialog] = useMarkTaught(); const choice = await askMark(name) // 'TAUGHT' | 'PARTLY' | null; render {markDialog}
 */
export function useMarkTaught() {
  const { t } = useTranslation('homework')
  const [asking, setAsking] = useState(null) // { name, resolve }
  const ask = (name) => new Promise((resolve) => setAsking({ name, resolve }))
  const answer = (v) => { asking?.resolve(v); setAsking(null) }
  const dialog = asking && (
    <Modal open onClose={() => answer(null)} size="md" title={asking.name ? t('homework.topic.markAsk.title', { name: asking.name }) : t('homework.topic.markAsk.titlePlain')}
      footer={<>
        <Button variant="ghost" onClick={() => answer(null)}>{t('homework.topic.markAsk.cancel')}</Button>
        <Button variant="secondary" icon={CircleDashed} onClick={() => answer('PARTLY')}>{t('homework.topic.markAsk.partly')}</Button>
        <Button icon={CheckCheck} onClick={() => answer('TAUGHT')}>{t('homework.topic.markAsk.taught')}</Button>
      </>}>
      <p className="text-sm text-ink-muted">{t('homework.topic.markAsk.message')}</p>
    </Modal>
  )
  return [ask, dialog]
}

/**
 * Marking a lesson as held: all of it taught (its topics are ticked off) or only part (they stay open, marked partly
 * taught), with an optional note on how it went. `const [ask, dialog] = useMarkLessonDone()`; `await ask(lesson)` →
 * { partly, reflection } or null.
 */
export function useMarkLessonDone() {
  const { t } = useTranslation('homework')
  const [asking, setAsking] = useState(null) // { lesson, resolve }
  const [note, setNote] = useState('')
  const ask = (lesson) => new Promise((resolve) => { setNote(''); setAsking({ lesson, resolve }) })
  const answer = (v) => { asking?.resolve(v); setAsking(null) }
  const n = asking?.lesson?.topics?.length ?? 0
  const dialog = asking && (
    <Modal open onClose={() => answer(null)} size="md" title={t('homework.lessons.doneConfirm.title', { title: asking.lesson.title })}
      footer={<>
        <Button variant="ghost" onClick={() => answer(null)}>{t('homework.topic.markAsk.cancel')}</Button>
        <Button variant="secondary" icon={CircleDashed} onClick={() => answer({ partly: true, reflection: note.trim() })}>{t('homework.topic.markAsk.partly')}</Button>
        <Button icon={CheckCheck} onClick={() => answer({ partly: false, reflection: note.trim() })}>{t('homework.topic.markAsk.taught')}</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink">{t('homework.lessons.doneAsk.which')}</p>
        <ul className="space-y-1 text-sm text-ink-muted">
          <li className="flex gap-2"><CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden />{n ? t('homework.lessons.doneAsk.taughtHint', { count: n }) : t('homework.lessons.doneAsk.taughtHintNone')}</li>
          <li className="flex gap-2"><CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />{n ? t('homework.lessons.doneAsk.partlyHint') : t('homework.lessons.doneAsk.partlyHintNone')}</li>
        </ul>
        <FormField label={t('homework.lessons.reflection')} hint={t('homework.lessons.doneAsk.optional')}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  )
  return [ask, dialog]
}

export function TopicActions({ sectionId, subjectId, row, date, canMark = true, onHomework, onChanged, showDate = false, compact = false, after, topicName }) {
  const { t } = useTranslation('homework')
  const { showSuccess, showError } = useSnackbar()
  const { date: fmt } = useFormat()
  const [adding, setAdding] = useState(false)
  const act = useMutation({
    mutationFn: ({ body }) => updateTopicPlan({ sectionId, subjectId, topicId: row.id, ...body }),
    onSuccess: (_, v) => { setAdding(false); onChanged?.(); if (v.done) showSuccess(v.done) },
    onError: (e) => showError(e.message),
  })
  const send = (body, done) => act.mutate({ body, done })
  const [askMark, markDialog] = useMarkTaught()
  // taught can't be undone: ask first (taught, or only partly)
  const markTaught = async () => {
    const c = await askMark(topicName)
    if (c === 'TAUGHT') send({ status: 'TAUGHT', date }, t('homework.topic.done.taught'))
    if (c === 'PARTLY') send({ status: 'PARTLY', date }, t('homework.topic.done.partly'))
  }
  const busy = act.isPending
  const extras = row.extraClasses?.length > 0 && (
    <ul className="space-y-1">
      {row.extraClasses.map((x) => (
        <li key={x.id} className="flex items-center gap-2 text-sm">
          <button type="button" disabled={!canMark || busy} aria-pressed={x.done} onClick={() => send({ extraId: x.id, extraDone: !x.done }, x.done ? null : t('homework.topic.done.extraTaken'))}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${x.done ? 'border-success-500 bg-success-50 text-success-600' : 'border-border text-ink-faint'}`}
            aria-label={t('homework.topic.extra.markTaken')} title={t('homework.topic.extra.markTaken')}>
            {x.done && <Check className="w-4 h-4" />}
          </button>
          <span className="min-w-0 flex-1 text-ink">{t('homework.topic.extra.on', { date: fmt(x.date) })}{x.period ? ` · ${t('homework.lessons.periodN', { n: x.period })}` : ''}{x.note ? ` · ${x.note}` : ''}</span>
          {canMark && <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} aria-label={t('homework.topic.remove')} title={t('homework.topic.remove')} onClick={() => send({ extraId: x.id, removeExtra: true }, null)} />}
        </li>
      ))}
    </ul>
  )
  const [dating, setDating] = useState(false)
  if (compact) {
    // the Teaching hub: icon buttons only (their names show on hover and to screen readers)
    const icon = (Icon, label, onClick, pressed) => (
      <button type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={busy} onClick={onClick}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border transition disabled:opacity-50 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${pressed ? 'border-brand-600 bg-brand-600 text-white' : 'border-transparent text-ink-muted hover:bg-black/[0.04] hover:text-brand-700'}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </button>
    )
    // once taught it stays taught: only revision, an extra class or homework from here (no way back to "not taught")
    const taught = row.status === 'TAUGHT'
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {canMark && !taught && <>
            {icon(CheckCheck, t('homework.topic.act.taught'), markTaught, false)}
            {icon(CircleDashed, t('homework.topic.act.partly'), () => send({ status: row.status === 'PARTLY' ? 'NOT_STARTED' : 'PARTLY', date }, t('homework.topic.done.partly')), row.status === 'PARTLY')}
            {icon(SkipForward, t('homework.topic.act.notTaught'), () => send({ notTaughtOn: date }, t('homework.topic.done.carried')))}
            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          </>}
          {canMark && <>
            {icon(RotateCcw, t('homework.topic.act.revision'), () => send({ needsRevision: !row.needsRevision }, row.needsRevision ? t('homework.topic.done.revised') : t('homework.topic.done.revision')), !!row.needsRevision)}
            {icon(Plus, t('homework.topic.act.extra'), () => setAdding(true))}
            {showDate && !taught && icon(CalendarClock, t('homework.topic.plannedFor'), () => setDating((x) => !x), dating)}
            {onHomework && hasPermission('homework.homework.create') && icon(NotebookPen, t('homework.topic.act.homework'), onHomework)}
          </>}
          {after}
        </div>
        {canMark && showDate && dating && !taught && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-muted">{t('homework.topic.plannedFor')}</span>
            <DateInput className="!h-8 w-40" value={row.start ?? ''} aria-label={t('homework.topic.plannedFor')} disabled={busy} onChange={(e) => send({ plannedDate: e.target.value || null }, t('homework.topic.done.moved'))} />
            {row.override && <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => send({ plannedDate: null }, t('homework.topic.done.moved'))}>{t('homework.topic.resetDate')}</Button>}
          </div>
        )}
        {canMark && row.needsRevision && (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            {t('homework.topic.reviseBy')}
            <DateInput className="!h-8 !w-auto" value={row.revisionBy ?? ''} disabled={busy} onChange={(e) => send({ revisionBy: e.target.value || null }, t('homework.topic.done.reviseBy'))} />
          </label>
        )}
        {extras}
        {adding && <ExtraClassModal defaultDate={date} saving={busy} onClose={() => setAdding(false)} onSave={(x) => send({ addExtra: x }, t('homework.topic.done.extraAdded'))} />}
        {markDialog}
      </div>
    )
  }
  const big = 'min-h-10 sm:min-h-0'
  return (
    <div className="space-y-2">
      {canMark && row.status !== 'TAUGHT' && (
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" className={big} variant={row.status === 'TAUGHT' ? 'primary' : 'secondary'} icon={CheckCheck} disabled={busy}
            onClick={markTaught}>{t('homework.topic.act.taught')}</Button>
          <Button size="sm" className={big} variant={row.status === 'PARTLY' ? 'primary' : 'secondary'} icon={CircleDashed} disabled={busy}
            onClick={() => send({ status: row.status === 'PARTLY' ? 'NOT_STARTED' : 'PARTLY', date }, t('homework.topic.done.partly'))}>{t('homework.topic.act.partly')}</Button>
          <Button size="sm" className={big} variant="secondary" icon={SkipForward} disabled={busy}
            onClick={() => send({ notTaughtOn: date }, t('homework.topic.done.carried'))}>{t('homework.topic.act.notTaught')}</Button>
        </div>
      )}
      {canMark && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" className={big} variant={row.needsRevision ? 'primary' : 'ghost'} icon={RotateCcw} aria-pressed={row.needsRevision} disabled={busy}
            onClick={() => send({ needsRevision: !row.needsRevision }, row.needsRevision ? t('homework.topic.done.revised') : t('homework.topic.done.revision'))}>{t('homework.topic.act.revision')}</Button>
          {row.needsRevision && (
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              {t('homework.topic.reviseBy')}
              <DateInput className="!h-8 !w-auto" value={row.revisionBy ?? ''} disabled={busy} onChange={(e) => send({ revisionBy: e.target.value || null }, t('homework.topic.done.reviseBy'))} />
            </label>
          )}
          <Button size="sm" className={big} variant="ghost" icon={Plus} disabled={busy} onClick={() => setAdding(true)}>{t('homework.topic.act.extra')}</Button>
          {onHomework && hasPermission('homework.homework.create') && <Button size="sm" className={big} variant="ghost" icon={NotebookPen} onClick={onHomework}>{t('homework.topic.act.homework')}</Button>}
        </div>
      )}
      {showDate && canMark && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">{t('homework.topic.plannedFor')}</span>
          <DateInput className="w-40" value={row.start ?? ''} aria-label={t('homework.topic.plannedFor')} disabled={busy}
            onChange={(e) => send({ plannedDate: e.target.value || null }, t('homework.topic.done.moved'))} />
          {row.override && <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => send({ plannedDate: null }, t('homework.topic.done.moved'))}>{t('homework.topic.resetDate')}</Button>}
        </div>
      )}
      {extras}
      {adding && <ExtraClassModal defaultDate={date} saving={busy} onClose={() => setAdding(false)} onSave={(x) => send({ addExtra: x }, t('homework.topic.done.extraAdded'))} />}
        {markDialog}
    </div>
  )
}
