import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, Check, CheckCheck, ChevronDown, ChevronUp, CircleDashed, Lightbulb, MessageCircleQuestion, NotebookPen, Pencil, Plus, Presentation, RotateCcw, Save, SkipForward, Trash2, X } from 'lucide-react'
import { QUESTION_KINDS, QUESTION_USES, TOPIC_STATUS } from '@schoolgiant/shared'
import { DateInput, Attachments, Drawer, FormField, Input, Modal, Note, ProgressBar, Select, StatusPill, Textarea } from '../system'
import Button from '../ui/Button'
import { fetchSyllabusTopic, saveSyllabusTopic, updateTopicPlan } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { TopicContentLink } from '../lms/ContentKit'
import { useFormat } from '../../context/SettingsContext'

// Topic material and a section's record of a topic — shared by the syllabus page and the teacher's day.

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
export function TopicMaterial({ topic, files = true }) {
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
      {topic.questions?.length > 0 && (
        <div>
          <Head icon={MessageCircleQuestion}>{t('homework.topic.questions', { count: topic.questions.length })}</Head>
          <ul className="grid gap-2 md:grid-cols-2">{topic.questions.map((q, i) => <QuestionRow key={q.id ?? i} q={q} n={i + 1} />)}</ul>
        </div>
      )}
    </div>
  )
}

/** Edit a topic's material. */
function TopicEditor({ topic, onDone }) {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => ({
    book: { ...topic.book }, howTo: topic.howTo, homeworkHint: topic.homeworkHint,
    keyPoints: topic.keyPoints.length ? [...topic.keyPoints] : [''],
    questions: topic.questions.map((q) => ({ ...q, options: q.options.length ? [...q.options] : ['', ''] })),
  }))
  const setBook = (k) => (e) => setForm((f) => ({ ...f, book: { ...f.book, [k]: e.target.value } }))
  const setPoint = (i, v) => setForm((f) => ({ ...f, keyPoints: f.keyPoints.map((x, j) => (j === i ? v : x)) }))
  const setQ = (i, patch) => setForm((f) => ({ ...f, questions: f.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const save = useMutation({
    mutationFn: () => saveSyllabusTopic(topic.id, {
      book: form.book, howTo: form.howTo, homeworkHint: form.homeworkHint,
      keyPoints: form.keyPoints.map((k) => k.trim()).filter(Boolean),
      questions: form.questions.filter((q) => q.question.trim()).map((q) => ({ id: q.id, question: q.question, answer: q.answer, kind: q.kind, use: q.use, options: q.kind === 'MCQ' ? q.options.filter((o) => o.trim()) : undefined })),
    }),
    onSuccess: (d) => { qc.setQueryData(['syllabus-topic', topic.id], d); qc.invalidateQueries({ queryKey: ['syllabus'] }); qc.invalidateQueries({ queryKey: ['teach-day'] }); showSuccess(t('homework.topic.saved')); onDone() },
    onError: (e) => showError(e.message),
  })
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t('homework.topic.bookName')} className="sm:col-span-3"><Input value={form.book.name} onChange={setBook('name')} placeholder={t('homework.topic.bookNameHint')} /></FormField>
        <FormField label={t('homework.topic.chapter')} className="sm:col-span-2"><Input value={form.book.chapter} onChange={setBook('chapter')} /></FormField>
        <FormField label={t('homework.topic.pages')}><Input value={form.book.pages} onChange={setBook('pages')} placeholder={t('homework.topic.pagesHint')} /></FormField>
      </div>
      <Attachments entityType="syllabus_topic" entityId={topic.id} canAdd label={t('homework.topic.files')} compact />
      <FormField label={t('homework.topic.howTo')} hint={t('homework.topic.howToHint')}>
        <Textarea rows={5} value={form.howTo} onChange={(e) => setForm((f) => ({ ...f, howTo: e.target.value }))} />
      </FormField>
      <div>
        <p className="text-sm font-medium text-ink mb-1.5">{t('homework.topic.keyPoints')}</p>
        <div className="space-y-2">
          {form.keyPoints.map((k, i) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1 min-w-0" value={k} onChange={(e) => setPoint(i, e.target.value)} aria-label={t('homework.topic.keyPointN', { n: i + 1 })} />
              <Button size="sm" variant="ghost" icon={X} aria-label={t('homework.topic.remove')} title={t('homework.topic.remove')} onClick={() => setForm((f) => ({ ...f, keyPoints: f.keyPoints.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, keyPoints: [...f.keyPoints, ''] }))}>{t('homework.topic.addPoint')}</Button>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-ink mb-1.5">{t('homework.topic.questionsTitle')}</p>
        <div className="space-y-3">
          {form.questions.map((q, i) => (
            <div key={q.id ?? `n-${i}`} className="rounded-lg border border-border p-2.5 space-y-2">
              <div className="flex gap-2">
                <Textarea className="flex-1 min-w-0" rows={2} value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} placeholder={t('homework.topic.question')} aria-label={t('homework.topic.question')} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('homework.topic.remove')} title={t('homework.topic.remove')} onClick={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value })} aria-label={t('homework.topic.kindLabel')}>
                  {QUESTION_KINDS.map((k) => <option key={k} value={k}>{t(`homework.topic.kind.${k}`)}</option>)}
                </Select>
                <Select value={q.use} onChange={(e) => setQ(i, { use: e.target.value })} aria-label={t('homework.topic.useLabel')}>
                  {QUESTION_USES.map((k) => <option key={k} value={k}>{t(`homework.topic.use.${k}`)}</option>)}
                </Select>
              </div>
              {q.kind === 'MCQ' && (
                <div className="space-y-1.5">
                  {q.options.map((o, k) => (
                    <div key={k} className="flex gap-2">
                      <Input className="flex-1 min-w-0" value={o} onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} placeholder={t('homework.topic.optionN', { n: k + 1 })} aria-label={t('homework.topic.optionN', { n: k + 1 })} />
                      <Button size="sm" variant="ghost" icon={X} aria-label={t('homework.topic.remove')} title={t('homework.topic.remove')} onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k) })} />
                    </div>
                  ))}
                  {q.options.length < 8 && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setQ(i, { options: [...q.options, ''] })}>{t('homework.topic.addOption')}</Button>}
                </div>
              )}
              <Textarea rows={2} value={q.answer} onChange={(e) => setQ(i, { answer: e.target.value })} placeholder={t('homework.topic.answer')} aria-label={t('homework.topic.answer')} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, { question: '', answer: '', kind: 'SHORT', use: 'CLASS', options: ['', ''] }] }))}>{t('homework.topic.addQuestion')}</Button>
        </div>
      </div>
      <FormField label={t('homework.topic.homeworkHint')} hint={t('homework.topic.homeworkHintHelp')}>
        <Textarea rows={3} value={form.homeworkHint} onChange={(e) => setForm((f) => ({ ...f, homeworkHint: e.target.value }))} />
      </FormField>
      <div className="flex justify-end gap-2 sticky bottom-0 bg-surface py-2">
        <Button variant="ghost" onClick={onDone}>{t('actions.cancel')}</Button>
        <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{t('homework.topic.save')}</Button>
      </div>
    </div>
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
export function TopicActions({ sectionId, subjectId, row, date, canMark = true, onHomework, onChanged, showDate = false }) {
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
  const busy = act.isPending
  const big = 'min-h-10 sm:min-h-0'
  return (
    <div className="space-y-2">
      {canMark && (
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" className={big} variant={row.status === 'TAUGHT' ? 'primary' : 'secondary'} icon={CheckCheck} disabled={busy}
            onClick={() => send(row.status === 'TAUGHT' ? { status: 'NOT_STARTED' } : { status: 'TAUGHT', date }, row.status === 'TAUGHT' ? t('homework.topic.done.undone') : t('homework.topic.done.taught'))}>{t('homework.topic.act.taught')}</Button>
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
      {row.extraClasses?.length > 0 && (
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
      )}
      {adding && <ExtraClassModal defaultDate={date} saving={busy} onClose={() => setAdding(false)} onSave={(x) => send({ addExtra: x }, t('homework.topic.done.extraAdded'))} />}
    </div>
  )
}

/**
 * A topic opened from the syllabus: its material (edit it, add files) and — when `section` is given —
 * how it stands in that section ({ id, label, row, date }).
 */
export function TopicDrawer({ topicId, subjectId, section, onClose, onChanged }) {
  const { t } = useTranslation('homework')
  const { date: fmt } = useFormat()
  const [editing, setEditing] = useState(false)
  const { data: topic, isLoading, error } = useQuery({ queryKey: ['syllabus-topic', topicId], queryFn: () => fetchSyllabusTopic(topicId) })
  const canEdit = hasPermission('homework.syllabus.edit') && topic?.canEdit
  const canMark = hasPermission('homework.syllabus.edit') || hasPermission('homework.lesson-plans.edit')
  const row = section?.row
  return (
    <Drawer open onClose={onClose} size="xl" title={topic?.name ?? t('homework.loading')} subtitle={topic ? `${topic.className} · ${topic.subject} · ${topic.unit}` : undefined}>
      {isLoading && <p className="text-sm text-ink-faint">{t('homework.loading')}</p>}
      {error && <Note tone="warning">{error.message}</Note>}
      {topic && (
        <div className="space-y-5">
          {row && (
            <div className="rounded-xl border border-border p-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink flex-1 min-w-0">{t('homework.topic.inSection', { section: section.label })}</p>
                <TopicStatusPill status={row.status} />
                {row.needsRevision && <StatusPill tone="warning">{t('homework.topic.needsRevision')}</StatusPill>}
              </div>
              {row.start && <p className="text-xs text-ink-muted">{row.start === row.end ? t('homework.topic.plannedOn', { date: fmt(row.start) }) : t('homework.topic.plannedRange', { from: fmt(row.start), to: fmt(row.end) })}{row.override ? ` · ${t('homework.topic.ownDate')}` : ''}</p>}
              <TopicActions sectionId={section.id} subjectId={subjectId} row={row} date={section.date} canMark={canMark} onChanged={onChanged} showDate />
            </div>
          )}
          {editing ? <TopicEditor topic={topic} onDone={() => setEditing(false)} /> : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{t('homework.topic.material')}</p>
                {canEdit && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>{t('homework.topic.edit')}</Button>}
              </div>
              <TopicMaterial topic={topic} />
              <TopicContentLink topicId={topic.id} />
              {topic.contentBy && <p className="text-xs text-ink-faint inline-flex items-center gap-1"><MessageCircleQuestion className="w-3.5 h-3.5" aria-hidden />{t('homework.topic.updatedBy', { name: topic.contentBy })}</p>}
            </>
          )}
        </div>
      )}
    </Drawer>
  )
}
