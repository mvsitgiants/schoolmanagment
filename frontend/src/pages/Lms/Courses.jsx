import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronLeft, Eye, EyeOff, Library, Plus, Send, Trash2, X } from 'lucide-react'
import { COURSE_STATUS, ITEM_KINDS } from '@schoolgiant/shared'
import { Attachments, ColorChip, DataTable, DateCell, Fraction, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, PersonCell, ProgressBar, SegmentedControl, Select, SideNav, SideNavLayout, StatusPill, Tabs, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { createCourse, deleteCourse, fetchCourse, fetchCourseProgress, fetchCourses, fetchLmsLookup, saveOutline, setCourseStatus, updateCourse } from '../../api/lms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const useLookup = () => useQuery({ queryKey: ['lms-lookup'], queryFn: fetchLmsLookup, staleTime: 60_000 })

/** Class, subject and sections for a course (or a live class). */
export function ClassSubjectPicker({ value, onChange, errors = {} }) {
  const { t } = useTranslation('lms')
  const { data: look } = useLookup()
  const classes = look?.classes ?? []
  const cls = classes.find((c) => c.id === value.classId)
  const sections = (look?.sections ?? []).filter((s) => s.classId === value.classId)
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <FormField label={t('lms.class')} required error={errors.classId}>
        <Select value={value.classId} onChange={(e) => onChange({ ...value, classId: e.target.value, subjectId: '', sectionIds: [] })}>
          <option value="">{t('lms.pickClass')}</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </FormField>
      <FormField label={t('lms.subject')} required error={errors.subjectId}>
        <Select value={value.subjectId} onChange={(e) => onChange({ ...value, subjectId: e.target.value })} disabled={!cls}>
          <option value="">{t('lms.pickSubject')}</option>
          {(cls?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </FormField>
      {sections.length > 0 && (
        <div className="sm:col-span-2">
          <p className="text-xs font-medium text-ink-muted mb-1.5">{t('lms.sections')}</p>
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => (
              <label key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                <input type="checkbox" checked={value.sectionIds.includes(s.id)} onChange={() => onChange({ ...value, sectionIds: value.sectionIds.includes(s.id) ? value.sectionIds.filter((x) => x !== s.id) : [...value.sectionIds, s.id] })} className="rounded border-border text-brand-500" />{s.short}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-1">{t('lms.sectionsHint')}</p>
        </div>
      )}
    </div>
  )
}

function CourseForm({ course, onClose, onSaved }) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ title: course?.title ?? '', description: course?.description ?? '', classId: course?.classId ?? '', subjectId: course?.subjectId ?? '', sectionIds: course?.sectionIds ?? [] })
  const [errors, setErrors] = useState({})
  const save = useMutation({ mutationFn: () => (course ? updateCourse(course.id, f) : createCourse(f)), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={course ? t('lms.courses.editTitle') : t('lms.courses.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={f.title.trim().length < 2 || !f.classId || !f.subjectId} onClick={() => save.mutate()}>{t('lms.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('lms.courses.name')} required error={errors.title}><Input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder={t('lms.courses.namePlaceholder')} /></FormField>
        <ClassSubjectPicker value={f} onChange={setF} errors={errors} />
        <FormField label={t('lms.courses.description')}><Textarea rows={3} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

/** The outline: units and their items, edited in place and saved together. */
function Outline({ course, onSaved }) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const [units, setUnits] = useState(course.units)
  const [open, setOpen] = useState(null)
  const [dirty, setDirty] = useState(false)
  const change = (fn) => { setUnits(fn); setDirty(true) }
  const setUnit = (i, patch) => change((u) => u.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const setItem = (i, k, patch) => setUnit(i, { items: units[i].items.map((x, j) => (j === k ? { ...x, ...patch } : x)) })
  const move = (list, i, d) => { const out = [...list]; const [x] = out.splice(i, 1); out.splice(i + d, 0, x); return out }
  const save = useMutation({ mutationFn: () => saveOutline(course.id, units), onSuccess: (c) => { setUnits(c.units); setDirty(false); onSaved(c) }, onError: (e) => showError(e.message) })
  const editable = course.canChange
  const itemTools = (i, k, it, u, labelled = false) => <>
    <Button size="sm" variant="ghost" icon={it.published ? Eye : EyeOff} aria-label={t('lms.outline.toggle')} title={t('lms.outline.toggle')} onClick={() => setItem(i, k, { published: !it.published })}>{labelled && (it.published ? t('lms.outline.hide') : t('lms.outline.show'))}</Button>
    <Button size="sm" variant="ghost" icon={ArrowUp} disabled={!k} aria-label={t('lms.up')} title={t('lms.up')} onClick={() => setUnit(i, { items: move(u.items, k, -1) })}>{labelled && t('lms.up')}</Button>
    <Button size="sm" variant="ghost" icon={X} aria-label={t('lms.remove')} title={t('lms.remove')} onClick={() => setUnit(i, { items: u.items.filter((_, j) => j !== k) })}>{labelled && t('lms.remove')}</Button>
  </>
  return (
    <div className="space-y-4">
      {units.map((u, i) => (
        <Panel key={u.id ?? `n${i}`} title={editable ? <Input value={u.title} onChange={(e) => setUnit(i, { title: e.target.value })} aria-label={t('lms.outline.unit')} /> : u.title}
          actions={editable && <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={ArrowUp} disabled={!i} aria-label={t('lms.up')} onClick={() => change((x) => move(x, i, -1))} />
            <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === units.length - 1} aria-label={t('lms.down')} onClick={() => change((x) => move(x, i, 1))} />
            <Button size="sm" variant="ghost" icon={Trash2} disabled={u.items.length > 0} aria-label={t('lms.remove')} onClick={() => change((x) => x.filter((_, j) => j !== i))} />
          </div>}>
          <div className="space-y-2">
            {u.items.map((it, k) => {
              const expanded = open === (it.id ?? `${i}:${k}`)
              return (
                <div key={it.id ?? `${i}:${k}`} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-[11px] uppercase tracking-wide text-ink-faint w-12 sm:w-14 shrink-0">{t(`lms.kinds.${it.kind}`)}</span>
                    <button type="button" className="flex-1 min-w-0 min-h-[32px] text-start text-sm text-ink truncate" onClick={() => setOpen(expanded ? null : (it.id ?? `${i}:${k}`))}>{it.title || t('lms.outline.untitled')}</button>
                    {!it.published && <StatusPill tone="neutral">{t('lms.outline.hidden')}</StatusPill>}
                    {it.files?.length > 0 && <span className="text-xs text-ink-faint">{t('lms.outline.files', { count: it.files.length })}</span>}
                    {/* phones: the item's buttons move into its opened panel so the title keeps the row */}
                    {editable && <span className="hidden sm:contents">{itemTools(i, k, it, u)}</span>}
                  </div>
                  {expanded && (
                    <div className="border-t border-border px-3 py-3 space-y-3">
                      {editable && <div className="flex flex-wrap gap-1 sm:hidden">{itemTools(i, k, it, u, true)}</div>}
                      <div className="grid sm:grid-cols-[2fr_100px] gap-2">
                        <Input value={it.title} disabled={!editable} onChange={(e) => setItem(i, k, { title: e.target.value })} aria-label={t('lms.outline.title')} placeholder={t('lms.outline.title')} />
                        <Input type="number" min="0" value={it.minutes ?? ''} disabled={!editable} onChange={(e) => setItem(i, k, { minutes: e.target.value ? Number(e.target.value) : null })} aria-label={t('lms.outline.minutes')} placeholder={t('lms.outline.minutes')} />
                      </div>
                      {it.kind === 'NOTE' && <Textarea rows={6} value={it.body} disabled={!editable} onChange={(e) => setItem(i, k, { body: e.target.value })} aria-label={t('lms.outline.body')} />}
                      {['LINK', 'VIDEO'].includes(it.kind) && <Input value={it.url} disabled={!editable} onChange={(e) => setItem(i, k, { url: e.target.value })} placeholder={it.kind === 'VIDEO' ? t('lms.outline.videoPlaceholder') : 'https://'} aria-label={t('lms.outline.url')} />}
                      {it.id ? <Attachments entityType="lms_item" entityId={it.id} canAdd={editable} compact /> : <p className="text-xs text-ink-faint">{t('lms.outline.saveForFiles')}</p>}
                    </div>
                  )}
                </div>
              )
            })}
            {editable && (
              <div className="flex flex-wrap gap-1">
                {Object.keys(ITEM_KINDS).map((kind) => <Button key={kind} size="sm" variant="ghost" icon={Plus} onClick={() => { setUnit(i, { items: [...u.items, { kind, title: '', body: '', url: '', published: true, files: [] }] }); setOpen(`${i}:${u.items.length}`) }}>{t(`lms.kinds.${kind}`)}</Button>)}
              </div>
            )}
          </div>
        </Panel>
      ))}
      {editable && (
        <div className="flex flex-wrap gap-2 sticky bottom-2">
          <Button variant="secondary" icon={Plus} onClick={() => change((x) => [...x, { title: t('lms.outline.newUnit', { n: x.length + 1 }), items: [] }])}>{t('lms.outline.addUnit')}</Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('lms.outline.save')}</Button>
          {dirty && <span className="self-center text-xs text-amber-700">{t('lms.outline.unsaved')}</span>}
        </div>
      )}
    </div>
  )
}

function Progress({ courseId }) {
  const { t } = useTranslation('lms')
  const { data, isLoading } = useQuery({ queryKey: ['lms-progress', courseId], queryFn: () => fetchCourseProgress(courseId) })
  return (
    <DataTable rows={data?.rows ?? []} loading={isLoading} rowKey="studentId" dense columns={[
      { key: 'name', header: t('lms.progress.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.section, r.rollNo && t('lms.progress.roll', { n: r.rollNo })].filter(Boolean).join(' · ') || undefined} size={28} /> },
      { key: 'pct', header: t('lms.progress.done'), mobileTrail: true, render: (v, r) => <div className="flex items-center gap-2 w-28 sm:w-48"><div className="flex-1"><ProgressBar value={v} showValue={false} /></div><span className="text-xs text-ink-muted">{r.done}/{data.total}</span></div> },
      { key: 'lastAt', header: t('lms.progress.last'), mobileHidden: true, render: (v) => <DateCell value={v} time /> },
    ]} emptyTitle={t('lms.progress.empty')} />
  )
}

function CourseDetail({ id, onBack }) {
  const { t } = useTranslation('lms')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('outline')
  const [editing, setEditing] = useState(false)
  const { data: c, isLoading } = useQuery({ queryKey: ['lms-course', id], queryFn: () => fetchCourse(id) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lms-course', id] }); qc.invalidateQueries({ queryKey: ['lms-courses'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done); if (v.back) onBack() }, onError: (e) => showError(e.message) })
  if (isLoading || !c) return <p className="text-sm text-ink-faint">{t('lms.loading')}</p>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('lms.back')} title={t('lms.back')} className="shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink break-words">{c.title}</p>
              <StatusPill tone={COURSE_STATUS[c.status]?.tone}>{t(`lms.courseStatus.${c.status}`)}</StatusPill>
            </div>
            <p className="text-xs text-ink-muted">{[c.className, c.subject, c.sections.length ? c.sections.map((s) => s.label).join(', ') : t('lms.allSections')].join(' · ')}</p>
          </div>
        </div>
        {c.canChange && <div className="flex w-full flex-wrap gap-2 ps-12 sm:w-auto sm:ps-0">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{t('lms.edit')}</Button>
          {c.status !== 'PUBLISHED' && <Button size="sm" icon={Send} onClick={() => act.mutate({ fn: () => setCourseStatus(c.id, 'PUBLISHED'), done: t('lms.courses.published') })}>{t('lms.courses.publish')}</Button>}
          {c.status === 'PUBLISHED' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ fn: () => setCourseStatus(c.id, 'ARCHIVED'), done: t('lms.courses.archived') })}>{t('lms.courses.archive')}</Button>}
          {hasPermission('lms.courses.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('lms.delete')} title={t('lms.delete')}
            onClick={async () => { if (await confirm({ title: t('lms.courses.deleteConfirm', { name: c.title }), confirmLabel: t('lms.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteCourse(c.id), done: t('lms.courses.deleted'), back: true }) }} />}
        </div>}
      </div>
      {c.status === 'DRAFT' && <Note>{t('lms.courses.draftHint')}</Note>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'outline', label: t('lms.courses.tabOutline') }, { value: 'progress', label: t('lms.courses.tabProgress') }]} />
      {tab === 'outline' ? <Outline key={c.updatedAt} course={c} onSaved={() => { refresh(); showSuccess(t('lms.saved')) }} /> : <Progress courseId={c.id} />}
      {editing && <CourseForm course={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); showSuccess(t('lms.saved')) }} />}
    </div>
  )
}

/** LMS › Courses & material: a class's subject laid out in units — notes, files, links and videos. */
export default function Courses() {
  const { t } = useTranslation('lms')
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const openId = params.get('course')
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['lms-courses', status], queryFn: () => fetchCourses({ status: status || undefined }) })
  const open = (id) => setParams(id ? { course: id } : {})
  const statusLabel = (s) => t(`lms.courseStatus.${s}`)
  // the open course's siblings, to switch without going back (the opened one stays even if the filter would hide it)
  const siblings = openId && !rows.some((r) => r.id === openId) ? [] : rows
  return (
    <PageContainer>
      <PageHeader icon={Library} title={t('lms.courses.title')} subtitle={t('lms.courses.subtitle')}
        actions={!openId && <HeaderButton icon={Plus} variant="primary" requires="lms.courses.create" onClick={() => setCreating(true)}>{t('lms.courses.new')}</HeaderButton>} />
      {openId ? (
        <SideNavLayout nav={siblings.length > 1 && (
          <SideNav title={t('lms.courses.nav')} value={openId} onChange={open} items={siblings.map((r) => ({
            id: r.id, label: r.title, icon: Library,
            hint: [r.className, r.subject].filter(Boolean).join(' · '),
            count: r.status === 'PUBLISHED' ? (r.items ? `${r.published}/${r.items}` : undefined) : statusLabel(r.status),
            countTone: r.status === 'DRAFT' ? 'warning' : undefined,
            progress: r.items ? { value: r.published, max: r.items, kind: 'done' } : undefined,
          }))} />
        )}>
          <CourseDetail key={openId} id={openId} onBack={() => open(null)} />
        </SideNavLayout>
      ) : (
        <>
          <SegmentedControl className="mb-3" value={status} onChange={setStatus} options={[{ value: '', label: t('lms.current') }, ...Object.keys(COURSE_STATUS).map((k) => ({ value: k, label: statusLabel(k) }))]} />
          <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} columns={[
            { key: 'title', header: t('lms.courses.name'), render: (v, r) => (
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{v}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <ColorChip label={r.className} seed={r.classId} />
                  <ColorChip label={r.subject} seed={r.subjectId} dot sub={r.sections.length ? r.sections.join(', ') : t('lms.allSections')} />
                </div>
                {/* phones: the material count rides under the title (the column is hidden there) */}
                <p className="md:hidden mt-1 text-xs font-normal text-ink-muted">{t('lms.courses.itemsLine', { units: r.units, published: r.published, items: r.items })}</p>
              </div>
            ) },
            { key: 'items', header: t('lms.courses.items'), align: 'right', mobileHidden: true, render: (v, r) => (v ? <Fraction value={r.published} max={v} label={t('lms.courses.unitsShown', { count: r.units })} /> : t('lms.courses.itemsLine', { units: r.units, published: r.published, items: v })) },
            { key: 'status', header: t('lms.status'), mobileTrail: true, render: (v) => <StatusPill tone={COURSE_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          ]} onRowClick={(r) => open(r.id)} emptyIcon={Library} emptyTitle={t('lms.courses.empty')} emptyHint={t('lms.courses.emptyHint')} />
        </>
      )}
      {creating && <CourseForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); qc.invalidateQueries({ queryKey: ['lms-courses'] }); open(c.id) }} />}
    </PageContainer>
  )
}
