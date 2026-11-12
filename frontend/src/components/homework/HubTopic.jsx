import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, BookMarked, Camera, ChevronDown, Copy, GripVertical, HelpCircle, Library, Paperclip, PenLine, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import { CONTENT_FILE_MAX_MB, FILE_ACCEPT, QUESTION_KINDS, QUESTION_USES } from '@schoolgiant/shared'
import { FormField, Input, Select, Textarea, useConfirm } from '../system'
import Button from '../ui/Button'
import { RichTextEditor } from '../lms/RichText'
import { FileDrop } from '../../pages/Lms/CreateContent'
import { CameraCapture, FileChips, LibraryPicker } from './HubTools'
import { deleteFile, uploadFile } from '../../api/files'
import { copyHubTopicFiles } from '../../api/teaching'
import { apiUrl } from '../../api/client'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

// One topic of the Subject hub (pages/Homework/Hub.jsx): the row (number, name, open, remove, move) and, when open,
// its sub-topics, the student content of each, the teacher's notes and the questions.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const isDesktop = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches
const FROM = [
  { key: 'write', icon: PenLine },
  { key: 'upload', icon: Upload },
  { key: 'camera', icon: Camera },
  { key: 'library', icon: Library },
]

/**
 * What students read for a topic or sub-topic: the editor, its attached files, and "Add content from" — write, upload,
 * a photo of a book page, or something from the library. Files need the LMS item, so `getItemId(copyFrom?)` makes it.
 */
export function ContentBlock({ html, onChange, files, itemId, getItemId, onFilesChanged, classId, subjectId, disabled, placeholder }) {
  const { t } = useTranslation('hub')
  const { showError, showSuccess } = useSnackbar()
  const confirm = useConfirm()
  const editor = useRef(null)
  const fileInput = useRef(null)
  const picInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState(false)
  const [library, setLibrary] = useState(false)
  const canLibrary = hasPermission('lms.content-library.view') || hasPermission('lms.my-content.view')

  const upload = async (list, { inline = false } = {}) => {
    const ok = list.filter((f) => {
      if (f.size <= CONTENT_FILE_MAX_MB * 1024 * 1024) return true
      showError(t('hub.files.tooBig', { name: f.name, mb: CONTENT_FILE_MAX_MB }))
      return false
    })
    if (!ok.length) return false
    setBusy(true)
    try {
      const id = await getItemId()
      for (const f of ok) {
        const saved = await uploadFile('lms_item', id, f)
        if (inline) editor.current?.insertImage(apiUrl(`/v1/files/${saved.id}/content`), f.name)
      }
      onFilesChanged()
      showSuccess(inline ? t('hub.files.pictureAdded') : t('hub.files.added', { count: ok.length }))
      return true
    } catch (e) {
      showError(e.message)
      return false
    } finally { setBusy(false) }
  }
  const remove = async (f) => {
    if (!await confirm({ title: t('hub.files.removeTitle'), message: t('hub.files.removeMessage', { name: f.name }), confirmLabel: t('hub.files.removeConfirm'), tone: 'danger' })) return
    try { await deleteFile(f.id, t('hub.files.removedReason')); onFilesChanged() } catch (e) { showError(e.message) }
  }
  const pick = async (row) => {
    setBusy(true)
    try {
      if (row.kind === 'VIDEO') editor.current?.insertHtml(`<p><a href="${esc(row.url)}" data-embed="video">${esc(row.title)}</a></p><p><br></p>`)
      else if (row.kind === 'LINK') editor.current?.insertHtml(`<p><a href="${esc(row.url)}">${esc(row.title)}</a></p>`)
      else editor.current?.insertHtml(`<h3>${esc(row.title)}</h3>${row.descriptionHtml || ''}<p><br></p>`)
      if (row.files?.length) { await getItemId(row.id); onFilesChanged() }
      setLibrary(false)
      showSuccess(t('hub.library.added', { title: row.title }))
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  const go = (key) => {
    if (key === 'write') editor.current?.focus()
    if (key === 'upload') fileInput.current?.click()
    if (key === 'camera') setCamera(true)
    if (key === 'library') setLibrary(true)
  }
  const from = FROM.filter((x) => x.key !== 'library' || canLibrary)

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]">
      {/* phones: a row of icon buttons above the editor */}
      <div className="grid grid-cols-4 gap-1.5 lg:hidden" role="group" aria-label={t('hub.from.title')}>
        {from.map((x) => (
          <button key={x.key} type="button" disabled={disabled || busy} onClick={() => go(x.key)}
            className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-surface px-1 text-xs font-medium text-ink hover:bg-black/[0.02] disabled:opacity-60">
            <x.icon className="h-5 w-5 text-brand-700" aria-hidden />
            <span className="truncate">{t(`hub.from.${x.key}.short`)}</span>
          </button>
        ))}
      </div>
      <div className="min-w-0 space-y-2">
        <RichTextEditor ref={editor} value={html} onChange={onChange} placeholder={placeholder ?? t('hub.content.placeholder')} headings videos tall maths textFromFile
          onPickImage={disabled ? undefined : () => picInput.current?.click()} />
        <FileChips files={files} onRemove={disabled ? undefined : remove} disabled={busy} />
        <div className="hidden lg:block"><FileDrop disabled={disabled || busy} onFiles={(l) => upload(l)} /></div>
      </div>
      {/* computers: the "Add content from" panel beside the editor */}
      <aside className="hidden lg:block">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('hub.from.title')}</p>
        <div className="space-y-1.5">
          {from.map((x) => (
            <button key={x.key} type="button" disabled={disabled || busy} onClick={() => go(x.key)}
              className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-start hover:bg-black/[0.02] disabled:opacity-60">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><x.icon className="h-4 w-4" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight text-ink">{t(`hub.from.${x.key}.name`)}</span>
                <span className="block text-xs text-ink-muted">{t(`hub.from.${x.key}.hint`)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { upload([...e.target.files]); e.target.value = '' }} />
      <input ref={picInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload([f], { inline: true }) }} />
      {camera && <CameraCapture busy={busy} onClose={() => setCamera(false)} onPhoto={async (file) => { if (await upload([file], { inline: true })) setCamera(false) }} />}
      {library && <LibraryPicker classId={classId} subjectId={subjectId} exceptId={itemId} busy={busy} onPick={pick} onClose={() => setLibrary(false)} />}
    </div>
  )
}

/**
 * Files added to the topic from the syllabus page (record type syllabus_topic): the teacher's, read-only here, each
 * opening in a new tab, with one click to copy them all to the student content.
 */
function TeacherFiles({ topic, ctx, onFilesChanged }) {
  const { t } = useTranslation('hub')
  const { showError, showSuccess } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const files = topic.teacherFiles ?? []
  if (!files.length) return null
  const copy = async () => {
    setBusy(true)
    try {
      const r = await copyHubTopicFiles(topic.id, { classId: ctx.classId, subjectId: ctx.subjectId })
      onFilesChanged()
      showSuccess(r.copied ? t('hub.teacher.filesCopied', { count: r.copied }) : t('hub.teacher.filesAlready'))
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t('hub.teacher.files')}</span>
          <span className="block text-xs text-ink-muted">{t('hub.teacher.filesHint')}</span>
        </span>
        {ctx.editable && ctx.lmsOn && <Button size="sm" variant="secondary" icon={Copy} loading={busy} onClick={copy}>{t('hub.teacher.copyFiles')}</Button>}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {files.map((f) => (
          <li key={f.id} className="max-w-full">
            <a href={apiUrl(`/v1/files/${f.id}/content`)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs text-ink hover:bg-black/[0.03]">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden /><span className="min-w-0 truncate">{f.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A section that opens and closes (the teacher's notes, the questions). */
function Fold({ icon: Icon, title, note, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-start">
        <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {note && <span className="block text-xs text-ink-muted">{note}</span>}
        </span>
        <ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-faint transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="space-y-3 border-t border-border p-3">{children}</div>}
    </div>
  )
}

/** For the teacher: book reference, periods, how to teach it, key points, homework suggestion. Never shown to students. */
function TeacherFields({ form, onForm, disabled }) {
  const { t } = useTranslation('hub')
  const setBook = (k) => (e) => onForm({ book: { ...form.book, [k]: e.target.value } })
  const points = form.keyPoints.length ? form.keyPoints : ['']
  const setPoint = (i, v) => onForm({ keyPoints: points.map((x, j) => (j === i ? v : x)) })
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <FormField label={t('hub.teacher.bookName')} className="sm:col-span-6"><Input value={form.book.name} onChange={setBook('name')} placeholder={t('hub.teacher.bookNameHint')} /></FormField>
        <FormField label={t('hub.teacher.chapter')} className="sm:col-span-3"><Input value={form.book.chapter} onChange={setBook('chapter')} /></FormField>
        <FormField label={t('hub.teacher.pages')} className="sm:col-span-2"><Input value={form.book.pages} onChange={setBook('pages')} placeholder={t('hub.teacher.pagesHint')} /></FormField>
        <FormField label={t('hub.teacher.periods')} className="sm:col-span-1"><Input type="number" inputMode="numeric" min={0} max={200} value={form.periods ?? ''} onChange={(e) => onForm({ periods: e.target.value === '' ? null : Number(e.target.value) })} /></FormField>
      </div>
      <FormField label={t('hub.teacher.howTo')} hint={t('hub.teacher.howToHint')}>
        <Textarea rows={4} value={form.howTo} onChange={(e) => onForm({ howTo: e.target.value })} />
      </FormField>
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">{t('hub.teacher.keyPoints')}</p>
        <div className="space-y-2">
          {points.map((k, i) => (
            <div key={i} className="flex gap-2">
              <Input className="min-w-0 flex-1" value={k} onChange={(e) => setPoint(i, e.target.value)} aria-label={t('hub.teacher.keyPointN', { n: i + 1 })} />
              <Button size="sm" variant="ghost" icon={X} aria-label={t('hub.remove')} title={t('hub.remove')} onClick={() => onForm({ keyPoints: points.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => onForm({ keyPoints: [...points, ''] })}>{t('hub.teacher.addPoint')}</Button>
        </div>
      </div>
      <FormField label={t('hub.teacher.homeworkHint')} hint={t('hub.teacher.homeworkHintHelp')}>
        <Textarea rows={2} value={form.homeworkHint} onChange={(e) => onForm({ homeworkHint: e.target.value })} />
      </FormField>
    </fieldset>
  )
}

/** The topic's questions: asked in class, set as homework, or kept for exam papers. */
function Questions({ questions, onChange, disabled }) {
  const { t } = useTranslation('hub')
  const setQ = (i, patch) => onChange(questions.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <fieldset disabled={disabled} className="space-y-3">
      {questions.map((q, i) => (
        <div key={q.id ?? q.key} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex gap-2">
            <Textarea className="min-w-0 flex-1" rows={2} value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} placeholder={t('hub.questions.question')} aria-label={t('hub.questions.questionN', { n: i + 1 })} />
            <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('hub.remove')} title={t('hub.remove')} onClick={() => onChange(questions.filter((_, j) => j !== i))} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value })} aria-label={t('hub.questions.kindLabel')}>
              {QUESTION_KINDS.map((k) => <option key={k} value={k}>{t(`hub.questions.kind.${k}`)}</option>)}
            </Select>
            <Select value={q.use} onChange={(e) => setQ(i, { use: e.target.value })} aria-label={t('hub.questions.useLabel')}>
              {QUESTION_USES.map((k) => <option key={k} value={k}>{t(`hub.questions.use.${k}`)}</option>)}
            </Select>
          </div>
          {q.kind === 'MCQ' && (
            <div className="space-y-1.5">
              {q.options.map((o, k) => (
                <div key={k} className="flex gap-2">
                  <Input className="min-w-0 flex-1" value={o} onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} placeholder={t('hub.questions.optionN', { n: k + 1 })} aria-label={t('hub.questions.optionN', { n: k + 1 })} />
                  <Button size="sm" variant="ghost" icon={X} aria-label={t('hub.remove')} title={t('hub.remove')} onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k) })} />
                </div>
              ))}
              {q.options.length < 8 && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setQ(i, { options: [...q.options, ''] })}>{t('hub.questions.addOption')}</Button>}
            </div>
          )}
          <Textarea rows={2} value={q.answer} onChange={(e) => setQ(i, { answer: e.target.value })} placeholder={t('hub.questions.answer')} aria-label={t('hub.questions.answer')} />
        </div>
      ))}
      <Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...questions, { key: `n${Date.now()}`, question: '', answer: '', kind: 'SHORT', use: 'CLASS', options: ['', ''] }])}>{t('hub.questions.add')}</Button>
    </fieldset>
  )
}

/** The topic name, changed in place (Enter or leaving the box saves it). */
function TopicName({ name, onRename, disabled }) {
  const { t } = useTranslation('hub')
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  const done = () => { setEditing(false); if (v.trim() && v.trim() !== name) onRename(v.trim()); else setV(name) }
  if (editing) {
    return <Input autoFocus value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onBlur={done} aria-label={t('hub.topic.name')}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(name); setEditing(false) } }} className="min-w-0 flex-1" />
  }
  return (
    <button type="button" disabled={disabled} onClick={() => { setV(name); setEditing(true) }} title={t('hub.topic.rename')}
      className="min-w-0 flex-1 truncate rounded-md px-1 py-1 text-start text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:hover:bg-transparent">
      {name}
    </button>
  )
}

/**
 * One topic: the row, and its body when open. `form` is the topic as being edited (Hub.jsx keeps unsaved changes);
 * `getItemId(subKey | null, copyFrom?)` gives the LMS item for the topic's or a sub-topic's content.
 */
export function TopicCard({
  n, topic, form, onForm, open, onToggle, onRename, onDelete, onMove, canUp, canDown, onSave, saving, dirty,
  getItemId, onFilesChanged, ctx, dragProps, handleProps,
}) {
  const { t } = useTranslation('hub')
  const confirm = useConfirm()
  const { classId, subjectId, lmsOn, editable } = ctx
  const subFiles = new Map(topic.subTopics.map((s) => [s.id, s.content]))
  const setSub = (i, patch) => onForm({ subTopics: form.subTopics.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const toggleSubs = async () => {
    if (form.subOn && form.subTopics.some((s) => s.id) && !await confirm({ title: t('hub.sub.offTitle'), message: t('hub.sub.offMessage'), confirmLabel: t('hub.sub.offConfirm'), tone: 'danger' })) return
    onForm(form.subOn ? { subOn: false } : { subOn: true, subTopics: form.subTopics.length ? form.subTopics : [{ key: `s${Date.now()}`, name: '', contentHtml: '' }] })
  }
  const status = topic.content?.status
  return (
    <li {...dragProps} id={`hub-topic-${topic.id}`} className={clsx('scroll-mt-20 rounded-xl border bg-surface shadow-card', open ? 'border-brand-300' : 'border-border')}>
      <div className="flex min-h-[52px] items-center gap-1 px-1.5 sm:gap-2 sm:px-2">
        {editable && (
          <>
            <span {...handleProps} className="hidden h-9 w-6 cursor-grab place-items-center text-ink-faint [@media(pointer:fine)]:grid" title={t('hub.topic.drag')} aria-hidden><GripVertical className="h-4 w-4" /></span>
            <span className="hidden flex-col [@media(pointer:coarse)]:flex">
              <button type="button" disabled={!canUp} onClick={() => onMove(-1)} aria-label={t('hub.topic.up')} className="grid h-[22px] w-9 place-items-center text-ink-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden /></button>
              <button type="button" disabled={!canDown} onClick={() => onMove(1)} aria-label={t('hub.topic.down')} className="grid h-[22px] w-9 place-items-center text-ink-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" aria-hidden /></button>
            </span>
          </>
        )}
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-xs font-semibold text-ink-muted">{n}</span>
        <TopicName name={topic.name} onRename={onRename} disabled={!editable} />
        {dirty && <span className="hidden shrink-0 text-xs text-amber-600 sm:inline">{t('hub.topic.unsaved')}</span>}
        {!dirty && status && status !== 'DRAFT' && <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">{t(`hub.status.${status}`)}</span>}
        {editable && (
          <button type="button" onClick={onDelete} aria-label={t('hub.topic.delete', { name: topic.name })} title={t('hub.topic.delete', { name: topic.name })}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-danger-50 hover:text-danger-700"><Trash2 className="h-4 w-4" aria-hidden /></button>
        )}
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? t('hub.topic.close') : t('hub.topic.open')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-black/[0.04]"><ChevronDown className={clsx('h-5 w-5 transition', open && 'rotate-180')} aria-hidden /></button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3 sm:px-4">
          {/* sub-topics */}
          <div className="space-y-2">
            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-ink">{t('hub.sub.toggle')}</span>
                <span className="block text-xs text-ink-muted">{t('hub.sub.toggleHint')}</span>
              </span>
              <input type="checkbox" role="switch" checked={form.subOn} disabled={!editable} onChange={toggleSubs} className="h-5 w-9 shrink-0 cursor-pointer accent-brand-600" />
            </label>
          </div>

          {/* the topic's own content */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">{t('hub.content.title')} <span className="text-danger-600">*</span></p>
            {lmsOn ? (
              <ContentBlock html={form.contentHtml} onChange={(h) => onForm({ contentHtml: h })} files={topic.content?.files ?? []} itemId={topic.content?.id}
                getItemId={(copyFrom) => getItemId(null, copyFrom)} onFilesChanged={onFilesChanged} classId={classId} subjectId={subjectId} disabled={!editable} />
            ) : <p className="rounded-lg bg-bg px-3 py-2 text-sm text-ink-muted">{t('hub.content.lmsOff')}</p>}
          </div>

          {form.subOn && (
            <div className="space-y-3">
              {form.subTopics.map((s, i) => (
                <div key={s.key} className="space-y-2 rounded-lg border border-border p-2.5 sm:p-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold text-ink-muted">{`${n}.${i + 1}`}</span>
                    <Input className="min-w-0 flex-1" value={s.name} maxLength={200} disabled={!editable} onChange={(e) => setSub(i, { name: e.target.value })} placeholder={t('hub.sub.namePlaceholder')} aria-label={t('hub.sub.nameN', { n: i + 1 })} />
                    {editable && <Button size="sm" variant="ghost" icon={X} aria-label={t('hub.sub.remove')} title={t('hub.sub.remove')} onClick={() => onForm({ subTopics: form.subTopics.filter((_, j) => j !== i) })} />}
                  </div>
                  {lmsOn && (
                    <ContentBlock html={s.contentHtml} onChange={(h) => setSub(i, { contentHtml: h })} files={subFiles.get(s.id)?.files ?? []} itemId={subFiles.get(s.id)?.id}
                      getItemId={(copyFrom) => getItemId(s.key, copyFrom)} onFilesChanged={onFilesChanged} classId={classId} subjectId={subjectId} disabled={!editable || !s.name.trim()}
                      placeholder={s.name.trim() ? t('hub.sub.contentPlaceholder') : t('hub.sub.nameFirst')} />
                  )}
                </div>
              ))}
              {editable && <Button size="sm" variant="secondary" icon={Plus} onClick={() => onForm({ subTopics: [...form.subTopics, { key: `s${Date.now()}`, name: '', contentHtml: '' }] })}>{t('hub.sub.add')}</Button>}
            </div>
          )}

          <Fold icon={BookMarked} title={t('hub.teacher.title')} note={t('hub.teacher.note')} defaultOpen={isDesktop()}>
            <div className="space-y-3">
              <TeacherFiles topic={topic} ctx={ctx} onFilesChanged={onFilesChanged} />
              <TeacherFields form={form} onForm={onForm} disabled={!editable} />
            </div>
          </Fold>
          <Fold icon={HelpCircle} title={t('hub.questions.title')} note={t('hub.questions.count', { count: form.questions.filter((q) => q.question.trim()).length })} defaultOpen={isDesktop()}>
            <Questions questions={form.questions} onChange={(questions) => onForm({ questions })} disabled={!editable} />
          </Fold>

          {editable && (
            <div className="flex justify-end">
              <Button size="sm" icon={Save} loading={saving} disabled={!dirty} onClick={onSave}>{t('hub.topic.save')}</Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
