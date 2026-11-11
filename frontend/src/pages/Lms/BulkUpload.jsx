import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { FolderOpen, Files, Paperclip, RotateCcw, Send, Users, X } from 'lucide-react'
import { CONTENT_FILE_MAX_MB, FILE_ACCEPT, addDaysYmd } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Note, PageContainer, PageHeader, Panel, ProgressBar, SegmentedControl, Select, Skeleton, StatusPill, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import { FileDrop, StudentPicker, TopicSelect, fmtSize } from './CreateContent'
import { createContent, fetchContentTopics, fetchLmsLookup } from '../../api/lms'
import { uploadFile } from '../../api/files'
import { hasPermission } from '../../api/auth'

const MAX_FILES = 30
const ACCEPTED = new Set(FILE_ACCEPT.split(','))
const STATE_TONE = { WAITING: 'neutral', UPLOADING: 'info', DONE: 'success', FAILED: 'danger' }
// a server error on one of these is about the whole batch, not one file: stop and show it on the form
const COMMON_FIELDS = ['classId', 'subjectId', 'publishDate', 'studentIds', 'type']

/** "unit_3-fractions notes.pdf" → "Unit 3 fractions notes". */
function titleFromName(name) {
  const base = name.replace(/\.[^./\\]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const title = base ? base.charAt(0).toUpperCase() + base.slice(1) : name
  return title.slice(0, 160)
}

const extOf = (name) => (name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : '')
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let seq = 0

/** LMS › Create content › Bulk upload: many files at once, each one its own study material item. */
export default function BulkUpload() {
  const { t } = useTranslation('lms')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [f, setF] = useState(() => ({
    classId: params.get('classId') ?? '', subjectId: params.get('subjectId') ?? '', topicId: params.get('topicId') ?? '',
    publish: 'NOW', publishDate: addDaysYmd(localIso(new Date()), 1), publishTime: '08:00', visibility: 'ALL', studentIds: [],
  }))
  const [rows, setRows] = useState([])
  const [rejected, setRejected] = useState([])
  const [errors, setErrors] = useState({})
  const [tried, setTried] = useState(false)
  const [running, setRunning] = useState(false)
  const [ran, setRan] = useState(false)
  const [picking, setPicking] = useState(false)
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e?.target ? e.target.value : e }))
  const patch = (key, changes) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...changes } : r)))

  const { data: look, isLoading: lookLoading } = useQuery({ queryKey: ['lms-lookup'], queryFn: fetchLmsLookup, staleTime: 60_000 })
  const classes = look?.classes ?? []
  const cls = classes.find((c) => c.id === f.classId)
  const subjects = cls?.subjects ?? []
  const { data: units = [], isFetching: topicsLoading } = useQuery({ queryKey: ['lms-content-topics', f.classId, f.subjectId], queryFn: () => fetchContentTopics(f.classId, f.subjectId), enabled: !!(f.classId && f.subjectId && cls) })
  const topicIds = useMemo(() => new Set(units.flatMap((u) => u.topics.map((x) => x.id))), [units])

  // once an item is saved the batch belongs to that class and subject
  const placed = rows.some((r) => r.itemId)
  const busy = running
  // rows that still follow "Topic for all" take the new one; picked-by-hand topics stay
  const followAll = (topicId) => setRows((rs) => rs.map((r) => (r.itemId || r.ownTopic ? r : { ...r, topicId })))
  const resetTopics = () => setRows((rs) => rs.map((r) => (r.itemId ? r : { ...r, topicId: '', ownTopic: false })))
  const pickClass = (e) => {
    const c = classes.find((y) => y.id === e.target.value)
    setF((v) => ({ ...v, classId: e.target.value, subjectId: c?.subjects.length === 1 ? c.subjects[0].id : '', topicId: '', studentIds: [] }))
    resetTopics()
  }
  const pickSubject = (e) => { setF((v) => ({ ...v, subjectId: e.target.value, topicId: '' })); resetTopics() }
  const pickTopicForAll = (e) => { setF((v) => ({ ...v, topicId: e.target.value })); followAll(e.target.value) }

  const addFiles = (list) => {
    const bad = []
    const fresh = []
    const room = MAX_FILES - rows.length
    for (const file of list) {
      if (!ACCEPTED.has(extOf(file.name))) bad.push({ name: file.name, reason: t('lms.content.bulk.badType') })
      else if (file.size > CONTENT_FILE_MAX_MB * 1024 * 1024) bad.push({ name: file.name, reason: t('lms.content.bulk.badSize', { mb: CONTENT_FILE_MAX_MB }) })
      else if ([...rows, ...fresh].some((r) => r.file.name === file.name && r.file.size === file.size)) bad.push({ name: file.name, reason: t('lms.content.bulk.badDuplicate') })
      else if (fresh.length >= room) bad.push({ name: file.name, reason: t('lms.content.bulk.badLimit', { max: MAX_FILES }) })
      else fresh.push({ key: ++seq, file, title: titleFromName(file.name), topicId: f.topicId, ownTopic: false, description: '', status: 'WAITING', error: '', itemId: null })
    }
    setRejected(bad)
    if (fresh.length) setRows((rs) => [...rs, ...fresh])
  }

  const open = rows.filter((r) => r.status !== 'DONE')
  const doneCount = rows.length - open.length
  const failedCount = rows.filter((r) => r.status === 'FAILED').length
  const rowProblem = (r) => (r.itemId ? null : !r.title.trim() ? 'title' : !r.topicId || !topicIds.has(r.topicId) ? 'topic' : null)
  const commonProblems = {
    ...(!f.classId && { classId: t('lms.content.bulk.needClass') }),
    ...(!f.subjectId && { subjectId: t('lms.content.bulk.needSubject') }),
    ...(f.publish === 'LATER' && !(f.publishDate && f.publishTime) && { publishDate: t('lms.content.bulk.needWhen') }),
    ...(f.visibility === 'STUDENTS' && !f.studentIds.length && { studentIds: t('lms.content.bulk.needStudents') }),
  }
  const shownErrors = { ...(tried ? commonProblems : {}), ...errors }
  const ready = !Object.keys(commonProblems).length && open.length > 0 && open.every((r) => !rowProblem(r))

  const bodyFor = (r) => ({
    type: 'MATERIAL', classId: f.classId, subjectId: f.subjectId, topicId: r.topicId, title: r.title.trim(),
    descriptionHtml: r.description.trim() ? `<p>${escapeHtml(r.description.trim())}</p>` : '', url: '',
    publish: f.publish, publishDate: f.publish === 'LATER' ? f.publishDate : null, publishTime: f.publish === 'LATER' ? f.publishTime : null,
    visibility: f.visibility, studentIds: f.visibility === 'STUDENTS' ? f.studentIds : [],
  })

  // one after another: items of a new topic share a course unit, so parallel saves would trip over each other
  const run = async () => {
    setTried(true)
    if (!ready || running) return
    setErrors({})
    setRunning(true)
    for (const r of open) patch(r.key, { status: 'WAITING', error: '' })
    for (const r of open) {
      patch(r.key, { status: 'UPLOADING', error: '' })
      let itemId = r.itemId
      try {
        if (!itemId) {
          itemId = (await createContent(bodyFor(r))).id
          patch(r.key, { itemId })
        }
        await uploadFile('lms_item', itemId, r.file)
        patch(r.key, { status: 'DONE' })
      } catch (e) {
        const fields = e.response?.data?.details?.fields ?? {}
        const reason = Object.values(fields)[0] ?? e.message
        patch(r.key, { status: 'FAILED', error: itemId ? t('lms.content.bulk.savedNoFile', { reason }) : reason })
        if (COMMON_FIELDS.some((k) => fields[k])) { setErrors(fields); break }
      }
    }
    setRunning(false)
    setRan(true)
    qc.invalidateQueries({ queryKey: ['lms-content'] })
    qc.invalidateQueries({ queryKey: ['lms-courses'] })
    qc.invalidateQueries({ queryKey: ['lms-topic-count'] })
  }

  const progress = rows.length ? (doneCount / rows.length) * 100 : 0
  const later = f.publish === 'LATER'

  if (!hasPermission('lms.create-content.create')) {
    return (
      <PageContainer>
        <PageHeader icon={Files} title={t('lms.content.bulk.title')} subtitle={t('lms.content.bulk.subtitle')} />
        <Note tone="warning">{t('lms.content.bulk.noPermission')}</Note>
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <PageHeader icon={Files} title={t('lms.content.bulk.title')} subtitle={t('lms.content.bulk.subtitle')} />
      {lookLoading ? <Skeleton className="h-96" /> : (
        <div className="space-y-3">
          <Panel title={t('lms.content.bulk.forAll')}>
            {!classes.length ? <Note tone="warning">{t('lms.content.form.noClasses')}</Note> : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label={t('lms.content.form.class')} required error={shownErrors.classId} hint={placed ? t('lms.content.bulk.placedHint') : undefined}>
                    <Select value={f.classId} disabled={busy || placed} onChange={pickClass}>
                      <option value="">{t('lms.content.form.pickClass')}</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </FormField>
                  <FormField label={t('lms.content.form.subject')} required error={shownErrors.subjectId}>
                    <Select value={f.subjectId} disabled={!cls || busy || placed} onChange={pickSubject}>
                      <option value="">{t('lms.content.form.pickSubject')}</option>
                      {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </FormField>
                  <FormField label={t('lms.content.bulk.topicForAll')}
                    hint={f.classId && f.subjectId && !topicsLoading && !units.length ? t('lms.content.form.noTopics') : t('lms.content.bulk.topicForAllHint')}>
                    <TopicSelect units={units} value={f.topicId} onChange={pickTopicForAll} disabled={busy} />
                  </FormField>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-ink">{t('lms.content.form.publishTo')}</p>
                    <SegmentedControl value={f.publish} onChange={set('publish')} options={[{ value: 'NOW', label: t('lms.content.form.now') }, { value: 'LATER', label: t('lms.content.form.later') }]} />
                    {later && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <FormField label={t('lms.content.form.date')} error={shownErrors.publishDate}><DateInput value={f.publishDate} min={localIso(new Date())} onChange={set('publishDate')} /></FormField>
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
                        <Button size="sm" variant="secondary" icon={Users} disabled={!f.classId || busy} onClick={() => setPicking(true)}>{t('lms.content.form.chooseStudents')}</Button>
                        <span className={clsx('text-xs', shownErrors.studentIds ? 'text-danger-700' : 'text-ink-muted')}>{shownErrors.studentIds ?? t('lms.content.chosenCount', { count: f.studentIds.length })}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <Panel title={t('lms.content.bulk.files')} subtitle={t('lms.content.bulk.filesHint', { max: MAX_FILES })}>
            <div className="space-y-3">
              {rows.length < MAX_FILES && <FileDrop onFiles={addFiles} disabled={busy} />}
              {rejected.length > 0 && (
                <Note tone="warning" actions={<button type="button" onClick={() => setRejected([])} aria-label={t('lms.content.bulk.dismiss')} title={t('lms.content.bulk.dismiss')} className="grid h-6 w-6 place-items-center rounded-md hover:bg-black/[0.05]"><X className="h-3.5 w-3.5" /></button>}>
                  <p className="font-medium">{t('lms.content.bulk.rejected', { count: rejected.length })}</p>
                  <ul className="mt-1 space-y-0.5">
                    {rejected.map((b, i) => <li key={`${b.name}${i}`} className="break-words">{t('lms.content.bulk.rejectedRow', { name: b.name, reason: b.reason })}</li>)}
                  </ul>
                </Note>
              )}
              {tried && !rows.length && <p className="text-xs text-danger-700">{t('lms.content.bulk.needFiles')}</p>}
              {rows.length > 0 && (
                <ul className="space-y-2">
                  {rows.map((r, i) => {
                    const locked = busy || !!r.itemId
                    const problem = tried ? rowProblem(r) : null
                    return (
                      <li key={r.key} className={clsx('rounded-xl border bg-surface p-3', r.status === 'FAILED' ? 'border-danger-500/30' : 'border-border')}>
                        <div className="flex items-center gap-2">
                          <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={r.file.name}>{r.file.name}</span>
                          <span className="shrink-0 text-xs text-ink-faint">{fmtSize(r.file.size)}</span>
                          <StatusPill tone={STATE_TONE[r.status]}>{t(`lms.content.bulk.state.${r.status}`)}</StatusPill>
                          {!locked && (
                            <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={t('lms.content.form.removeFile')} title={t('lms.content.form.removeFile')}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-black/[0.04] hover:text-ink"><X className="h-4 w-4" /></button>
                          )}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <FormField label={t('lms.content.bulk.rowTitle', { n: i + 1 })} required error={problem === 'title' ? t('lms.content.bulk.needTitle') : undefined}>
                            <Input value={r.title} maxLength={160} disabled={locked} onChange={(e) => patch(r.key, { title: e.target.value })} />
                          </FormField>
                          <FormField label={t('lms.content.form.topic')} required error={problem === 'topic' ? t('lms.content.bulk.needTopic') : undefined}>
                            <TopicSelect units={units} value={r.topicId} disabled={locked} onChange={(e) => patch(r.key, { topicId: e.target.value, ownTopic: true })} />
                          </FormField>
                          <FormField label={t('lms.content.bulk.shortDescription')}>
                            <Input value={r.description} maxLength={300} disabled={locked} placeholder={t('lms.content.bulk.optional')} onChange={(e) => patch(r.key, { description: e.target.value })} />
                          </FormField>
                        </div>
                        {r.status === 'FAILED' && r.error && <p className="mt-2 text-xs text-danger-700 break-words">{r.error}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Panel>

          {(running || ran) && rows.length > 0 && (
            <div className="space-y-2">
              <ProgressBar value={progress} tone={failedCount && !running ? 'warning' : 'brand'} />
              {running ? <p className="text-xs text-ink-muted">{t('lms.content.bulk.working', { done: doneCount, total: rows.length })}</p> : (
                <Note tone={failedCount ? 'warning' : 'success'} actions={<Button size="sm" variant="secondary" icon={FolderOpen} onClick={() => navigate('/lms/my-content')}>{t('lms.content.bulk.goMine')}</Button>}>
                  {failedCount
                    ? t('lms.content.bulk.summaryFailed', { done: doneCount, failed: failedCount })
                    : open.length ? t('lms.content.bulk.summaryStopped', { done: doneCount, left: open.length })
                      : later ? t('lms.content.bulk.summaryScheduled', { count: doneCount }) : t('lms.content.bulk.summaryDone', { count: doneCount })}
                </Note>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={running} onClick={() => navigate(-1)}>{t('lms.content.form.cancel')}</Button>
            {open.length > 0 && (
              <Button icon={ran && failedCount ? RotateCcw : Send} loading={running} disabled={running || (tried && !ready)} onClick={run}>
                {ran && failedCount ? t('lms.content.bulk.retry', { count: open.length })
                  : later ? t('lms.content.bulk.scheduleN', { count: open.length }) : t('lms.content.bulk.publishN', { count: open.length })}
              </Button>
            )}
          </div>
        </div>
      )}
      {picking && <StudentPicker classId={f.classId} value={f.studentIds} onClose={() => setPicking(false)} onDone={(ids) => { setF((v) => ({ ...v, studentIds: ids })); setPicking(false) }} />}
    </PageContainer>
  )
}
