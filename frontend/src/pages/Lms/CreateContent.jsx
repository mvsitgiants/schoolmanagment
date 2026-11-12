import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Eye, FileUp, Files, Paperclip, Search, Send, Share2, Users, X } from 'lucide-react'
import { CONTENT_FILE_MAX_MB, CONTENT_TYPES, FILE_ACCEPT, addDaysYmd, htmlToText, videoEmbed } from '@schoolgiant/shared'
import { Attachments, DateInput, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, Skeleton, localIso } from '../../components/system'
import HubBanner from '../../components/homework/HubBanner'
import Button from '../../components/ui/Button'
import { RichTextEditor } from '../../components/lms/RichText'
import { ContentPreview, TypeIcon } from '../../components/lms/ContentKit'
import { HomeworkForm } from '../Homework/Homework'
import { createContent, fetchContent, fetchContentStudents, fetchContentTopics, fetchLmsLookup, updateContent } from '../../api/lms'
import { fetchHomeworkLookup } from '../../api/homework'
import { uploadFile } from '../../api/files'
import { hasPermission } from '../../api/auth'
import { useModules } from '../../context/ModuleContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const TYPES = Object.keys(CONTENT_TYPES)
const SHARED = TYPES.filter((k) => CONTENT_TYPES[k].kind)
export const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** The class's students with a search, to tick who sees the content. `fetchRows` swaps the list (the subject hub's own). */
export function StudentPicker({ classId, value, onDone, onClose, fetchRows, rowsKey }) {
  const { t } = useTranslation('lms')
  const [picked, setPicked] = useState(() => new Set(value))
  const [q, setQ] = useState('')
  const { data: rows = [], isLoading } = useQuery({ queryKey: rowsKey ?? ['lms-content-students', classId], queryFn: fetchRows ?? (() => fetchContentStudents(classId)), enabled: !!classId })
  const needle = q.trim().toLowerCase()
  const shown = needle ? rows.filter((s) => [s.name, s.admissionNo, s.rollNo, s.section].some((v) => String(v ?? '').toLowerCase().includes(needle))) : rows
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Modal open onClose={onClose} title={t('lms.content.students.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('lms.content.form.cancel')}</Button>
      <Button onClick={() => onDone([...picked])}>{t('lms.content.students.done', { count: picked.size })}</Button>
    </>}>
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lms.content.students.search')} className="ps-9" />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-ink-muted">{t('lms.content.chosenCount', { count: picked.size })}</span>
          <span className="flex gap-3">
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setPicked((p) => new Set([...p, ...shown.map((s) => s.id)]))}>{t('lms.content.students.selectAll')}</button>
            <button type="button" className="font-medium text-ink-muted hover:underline" onClick={() => setPicked(new Set())}>{t('lms.content.students.clear')}</button>
          </span>
        </div>
        {isLoading ? <Skeleton className="h-40" /> : !rows.length ? <p className="py-6 text-center text-sm text-ink-faint">{t('lms.content.students.none')}</p> : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {shown.map((s) => (
              <li key={s.id}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-black/[0.02]">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-border text-brand-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{s.name}</span>
                    <span className="block text-xs text-ink-muted">{[s.section, s.rollNo && t('lms.content.students.roll', { n: s.rollNo })].filter(Boolean).join(' · ')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** The dashed "drag and drop files here, or choose files" box (the browser's picker allows many at once). */
export function FileDrop({ onFiles, disabled = false }) {
  const { t } = useTranslation('lms')
  const input = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles([...e.dataTransfer.files]) }}
        className={clsx('flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition disabled:cursor-not-allowed disabled:opacity-60', over ? 'border-brand-500 bg-brand-50' : 'border-border hover:bg-black/[0.02]')}>
        <FileUp className="h-5 w-5 text-ink-faint" aria-hidden />
        <span className="text-sm text-ink">{t('lms.content.form.drop')} <span className="font-medium text-brand-700">{t('lms.content.form.browse')}</span></span>
        <span className="text-xs text-ink-faint">{t('lms.content.form.fileTypes', { mb: CONTENT_FILE_MAX_MB })}</span>
      </button>
      <input ref={input} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { onFiles([...e.target.files]); e.target.value = '' }} />
    </>
  )
}

/** The syllabus topic picker, grouped by unit. */
export function TopicSelect({ units, value, onChange, placeholder, disabled }) {
  const { t } = useTranslation('lms')
  return (
    <Select value={value} disabled={disabled || !units.length} onChange={onChange}>
      <option value="">{placeholder ?? t('lms.content.form.pickTopic')}</option>
      {units.map((u) => <optgroup key={u.id} label={u.name}>{u.topics.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}</optgroup>)}
    </Select>
  )
}

/** Files waiting to be added when the content is saved (a new item has no id yet). */
function PendingFiles({ files, onChange }) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const add = (list) => {
    const ok = []
    for (const f of list) {
      if (f.size > CONTENT_FILE_MAX_MB * 1024 * 1024) showError(t('lms.content.form.tooBig', { name: f.name, mb: CONTENT_FILE_MAX_MB }))
      else ok.push(f)
    }
    if (ok.length) onChange([...files, ...ok])
  }
  return (
    <div className="space-y-2">
      <FileDrop onFiles={add} />
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}${i}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
              <span className="shrink-0 text-xs text-ink-faint">{fmtSize(f.size)}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={t('lms.content.form.removeFile')} title={t('lms.content.form.removeFile')} className="grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-black/[0.04] hover:text-ink"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ContentForm({ existing, start }) {
  const { t } = useTranslation('lms')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { isEnabled } = useModules()
  const { dateTime } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const x = existing ?? {}
  const [f, setF] = useState(() => ({
    type: x.type ?? (SHARED.includes(start.type) ? start.type : 'MATERIAL'), classId: x.classId ?? start.classId ?? '', subjectId: x.subjectId ?? start.subjectId ?? '', topicId: x.topicId ?? start.topicId ?? '',
    title: x.title ?? '', descriptionHtml: x.descriptionHtml || (x.body ? x.body.split('\n').map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('') : ''), url: x.url ?? '',
    publish: x.status === 'SCHEDULED' ? 'LATER' : 'NOW', publishDate: x.publishDate ?? addDaysYmd(localIso(new Date()), 1), publishTime: x.publishTime ?? '08:00',
    visibility: x.visibility ?? 'ALL', studentIds: x.studentIds ?? [],
  }))
  const [pending, setPending] = useState([])
  const [errors, setErrors] = useState({})
  const [picking, setPicking] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [homework, setHomework] = useState(null)
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e?.target ? e.target.value : e }))

  const { data: look, isLoading: lookLoading } = useQuery({ queryKey: ['lms-lookup'], queryFn: fetchLmsLookup, staleTime: 60_000 })
  const classes = look?.classes ?? []
  const cls = classes.find((c) => c.id === f.classId)
  const subjects = cls?.subjects ?? []
  const { data: units = [], isFetching: topicsLoading } = useQuery({ queryKey: ['lms-content-topics', f.classId, f.subjectId], queryFn: () => fetchContentTopics(f.classId, f.subjectId), enabled: !!(f.classId && f.subjectId && cls) })
  const topic = useMemo(() => { for (const u of units) { const tp = u.topics.find((x2) => x2.id === f.topicId); if (tp) return { ...tp, unit: u.name } } return null }, [units, f.topicId])
  const hwLookup = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup, enabled: !!homework, staleTime: 60_000 })

  const pickClass = (e) => {
    const c = classes.find((y) => y.id === e.target.value)
    setF((v) => ({ ...v, classId: e.target.value, subjectId: c?.subjects.length === 1 ? c.subjects[0].id : '', topicId: '', studentIds: [] }))
  }
  const urlKind = f.type === 'VIDEO' || f.type === 'LINK'
  const body = () => ({
    type: f.type, classId: f.classId, subjectId: f.subjectId, topicId: f.topicId, title: f.title, descriptionHtml: f.descriptionHtml, url: urlKind ? f.url : '',
    publish: f.publish, publishDate: f.publish === 'LATER' ? f.publishDate : null, publishTime: f.publish === 'LATER' ? f.publishTime : null,
    visibility: f.visibility, studentIds: f.visibility === 'STUDENTS' ? f.studentIds : [],
  })
  const save = useMutation({
    mutationFn: async () => {
      const saved = existing ? await updateContent(existing.id, body()) : await createContent(body())
      const failed = []
      for (const file of pending) {
        try { await uploadFile('lms_item', saved.id, file) } catch (e) { failed.push(e.message) }
      }
      return { saved, failed }
    },
    onSuccess: ({ saved, failed }) => {
      qc.invalidateQueries({ queryKey: ['lms-content'] })
      qc.invalidateQueries({ queryKey: ['lms-courses'] })
      qc.invalidateQueries({ queryKey: ['lms-topic-count'] })
      if (failed.length) showError(t('lms.content.form.filesFailed', { count: failed.length, reason: failed[0] }))
      else showSuccess(saved.status === 'SCHEDULED' ? t('lms.content.form.scheduledDone', { when: dateTime(saved.publishAt) }) : existing ? t('lms.content.form.updated') : t('lms.content.form.published'))
      navigate('/lms/my-content')
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  const canHomework = isEnabled('homework') && hasPermission('homework.homework.create')
  const canQuiz = isEnabled('online-tests') && hasPermission('online-tests.tests.create')
  const pickType = (k) => {
    if (k === 'ASSIGNMENT') {
      setHomework({ subjectId: f.subjectId || undefined, classId: f.classId, title: f.title || topic?.name || '', details: htmlToText(f.descriptionHtml) })
      return
    }
    if (k === 'QUIZ') {
      const q = new URLSearchParams({ new: '1', ...(f.classId && { classId: f.classId }), ...(f.subjectId && { subjectId: f.subjectId }), ...((f.title || topic?.name) && { title: f.title || topic.name }) })
      navigate(`/online-tests/tests?${q}`)
      return
    }
    setF((v) => ({ ...v, type: k }))
  }
  const visibleTypes = TYPES.filter((k) => (k === 'ASSIGNMENT' ? canHomework : k === 'QUIZ' ? canQuiz : true)).filter((k) => !existing || CONTENT_TYPES[k].kind)
  const ready = f.classId && f.subjectId && f.topicId && f.title.trim() && (!urlKind || f.url.trim()) && (f.visibility === 'ALL' || f.studentIds.length) && (f.publish === 'NOW' || (f.publishDate && f.publishTime))
  const previewItem = {
    type: f.type, title: f.title, descriptionHtml: f.descriptionHtml, url: urlKind ? f.url : '', embed: f.type === 'VIDEO' ? videoEmbed(f.url) : null,
    subject: subjects.find((s) => s.id === f.subjectId)?.name ?? '', topic: topic?.name ?? '', files: existing?.files ?? [], visibility: f.visibility, studentIds: f.studentIds,
  }

  if (lookLoading) return <Skeleton className="h-96" />
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label={t('lms.content.form.typeLabel')}>
        {visibleTypes.map((k) => {
          const on = f.type === k
          return (
            <button key={k} type="button" role="radio" aria-checked={on} onClick={() => pickType(k)}
              className={clsx('flex items-center gap-2.5 rounded-xl border bg-surface px-3 py-2.5 text-start transition', on ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-border hover:bg-black/[0.02]')}>
              <TypeIcon type={k} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-ink">{t(`lms.content.types.${k}.name`)}</span>
                <span className="block text-xs text-ink-muted">{t(`lms.content.types.${k}.hint`)}</span>
              </span>
            </button>
          )
        })}
      </div>
      {!existing && f.type === 'MATERIAL' && hasPermission('lms.create-content.create') && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span>{t('lms.content.bulk.manyHint')}</span>
          <Link to={`/lms/bulk-upload?${new URLSearchParams(Object.fromEntries(Object.entries({ classId: f.classId, subjectId: f.subjectId, topicId: f.topicId }).filter(([, v]) => v)))}`}
            className="inline-flex min-h-[32px] items-center gap-1 font-medium text-brand-700 hover:underline">
            <Files className="h-3.5 w-3.5" aria-hidden />{t('lms.content.bulk.manyLink')}
          </Link>
        </p>
      )}

      <Panel>
        {!classes.length ? <Note tone="warning">{t('lms.content.form.noClasses')}</Note> : (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t('lms.content.form.class')} required error={errors.classId}>
              <Select value={f.classId} onChange={pickClass}>
                <option value="">{t('lms.content.form.pickClass')}</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
            <FormField label={t('lms.content.form.subject')} required error={errors.subjectId}>
              <Select value={f.subjectId} disabled={!cls} onChange={(e) => setF((v) => ({ ...v, subjectId: e.target.value, topicId: '' }))}>
                <option value="">{t('lms.content.form.pickSubject')}</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </FormField>
            <FormField label={t('lms.content.form.topic')} required error={errors.topicId}
              hint={f.classId && f.subjectId && !topicsLoading && !units.length ? t('lms.content.form.noTopics') : undefined}>
              <TopicSelect units={units} value={f.topicId} onChange={set('topicId')} />
            </FormField>
          </div>
        )}
      </Panel>

      <Panel title={t('lms.content.form.details')}>
        <div className="space-y-3">
          <FormField label={t('lms.content.form.title')} required error={errors.title}>
            <Input value={f.title} onChange={set('title')} maxLength={160} placeholder={t('lms.content.form.titlePlaceholder')} />
          </FormField>
          {urlKind && (
            <FormField label={f.type === 'VIDEO' ? t('lms.content.form.videoUrl') : t('lms.content.form.linkUrl')} required error={errors.url}
              hint={f.type === 'VIDEO' ? t('lms.content.form.videoHint') : t('lms.content.form.linkHint')}>
              <Input type="url" inputMode="url" value={f.url} onChange={set('url')} placeholder={t('lms.content.form.urlPlaceholder')} />
            </FormField>
          )}
          <FormField label={t('lms.content.form.description')}>
            <RichTextEditor maths textFromFile value={f.descriptionHtml} onChange={(html) => setF((v) => ({ ...v, descriptionHtml: html }))} placeholder={t('lms.content.form.descriptionPlaceholder')} />
          </FormField>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">{t('lms.content.form.attach')}</p>
            {existing ? <Attachments entityType="lms_item" entityId={existing.id} canAdd compact label={t('lms.content.form.attach')} /> : <PendingFiles files={pending} onChange={setPending} />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">{t('lms.content.form.publishTo')}</p>
              <SegmentedControl value={f.publish} onChange={set('publish')} options={[{ value: 'NOW', label: t('lms.content.form.now') }, { value: 'LATER', label: t('lms.content.form.later') }]} />
              {f.publish === 'LATER' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <FormField label={t('lms.content.form.date')} error={errors.publishDate}><DateInput value={f.publishDate} min={localIso(new Date())} onChange={set('publishDate')} /></FormField>
                  <FormField label={t('lms.content.form.time')}><Input type="time" value={f.publishTime} onChange={set('publishTime')} /></FormField>
                </div>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">{t('lms.content.form.visibility')}</p>
              <SegmentedControl value={f.visibility} onChange={(v) => { set('visibility')(v); if (v === 'STUDENTS' && !f.studentIds.length && f.classId) setPicking(true) }}
                options={[{ value: 'ALL', label: t('lms.content.form.allStudents') }, { value: 'STUDENTS', label: t('lms.content.form.chosen') }]} />
              {f.visibility === 'STUDENTS' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" icon={Users} disabled={!f.classId} onClick={() => setPicking(true)}>{t('lms.content.form.chooseStudents')}</Button>
                  <span className={clsx('text-xs', errors.studentIds ? 'text-danger-700' : 'text-ink-muted')}>{errors.studentIds ?? t('lms.content.chosenCount', { count: f.studentIds.length })}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" icon={Eye} onClick={() => setPreviewing(true)}>{t('lms.content.form.preview')}</Button>
        <Button variant="secondary" onClick={() => navigate(-1)}>{t('lms.content.form.cancel')}</Button>
        <Button icon={Send} loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
          {f.publish === 'LATER' ? t('lms.content.form.schedule') : existing ? t('lms.content.form.save') : t('lms.content.form.publish')}
        </Button>
      </div>

      {picking && <StudentPicker classId={f.classId} value={f.studentIds} onClose={() => setPicking(false)} onDone={(ids) => { setF((v) => ({ ...v, studentIds: ids })); setPicking(false) }} />}
      {previewing && <ContentPreview item={previewItem} pendingFiles={pending} onClose={() => setPreviewing(false)} />}
      {homework && hwLookup.data && (
        <HomeworkForm lookup={hwLookup.data} defaults={{ ...homework, sectionIds: hwLookup.data.sections.filter((s) => s.classId === homework.classId && s.subjects.some((y) => y.id === homework.subjectId)).map((s) => s.id) }}
          onClose={() => setHomework(null)} onSaved={(r) => { setHomework(null); showSuccess(t('lms.content.form.assignmentSet', { count: r?.created ?? 1 })) }} />
      )}
    </div>
  )
}

/** LMS › Create content: share study material, a video or a link for a syllabus topic (assignment and quiz open their own forms). */
export default function CreateContent() {
  const { t } = useTranslation('lms')
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const { data: existing, isLoading, error } = useQuery({ queryKey: ['lms-content', 'one', editId], queryFn: () => fetchContent(editId), enabled: !!editId })
  const start = { type: params.get('kind')?.toUpperCase(), classId: params.get('classId'), subjectId: params.get('subjectId'), topicId: params.get('topicId') }
  return (
    <PageContainer>
      <PageHeader icon={Share2} title={editId ? t('lms.content.form.editTitle') : t('lms.content.form.newTitle')} subtitle={t('lms.content.form.subtitle')} />
      <HubBanner classId={existing?.classId ?? start.classId} subjectId={existing?.subjectId ?? start.subjectId} className="mb-3" />
      {editId && isLoading ? <Skeleton className="h-96" /> : error ? <Note tone="warning">{error.message}</Note> : (
        <ContentForm key={editId ?? 'new'} existing={editId ? existing : null} start={start} />
      )}
    </PageContainer>
  )
}
