import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronLeft, LayoutPanelTop, Library } from 'lucide-react'
import { COURSE_STATUS } from '@schoolgiant/shared'
import { Attachments, ColorChip, DataTable, DateCell, Fraction, FormField, HeaderButton, Note, PageContainer, PageHeader, Panel, PersonCell, ProgressBar, SegmentedControl, Select, SideNav, SideNavLayout, StatusPill, Tabs } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchCourse, fetchCourseProgress, fetchCourses, fetchLmsLookup } from '../../api/lms'
import { hasPermission } from '../../api/auth'
import { RichTextView } from '../../components/lms/RichText'

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

/**
 * What students of this class see for the subject, unit by unit — read only. It is written in the Teaching hub (each
 * topic's content lands here as an item); an item opens to its text, link and files.
 */
function Outline({ course }) {
  const { t } = useTranslation('lms')
  const [open, setOpen] = useState(null)
  if (!course.units.some((u) => u.items.length)) return <Note>{t('lms.courses.nothingYet')}</Note>
  return (
    <div className="space-y-3">
      {course.units.filter((u) => u.items.length).map((u) => (
        <Panel key={u.id} title={u.title}>
          <ul className="divide-y divide-border">
            {u.items.map((it) => {
              const expanded = open === it.id
              return (
                <li key={it.id}>
                  <button type="button" onClick={() => setOpen(expanded ? null : it.id)} aria-expanded={expanded} className="flex min-h-[40px] w-full items-center gap-2 px-1 text-start">
                    <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-ink-faint">{t(`lms.kinds.${it.kind}`)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{it.title || t('lms.outline.untitled')}</span>
                    {!it.published && <StatusPill tone="neutral">{t('lms.outline.hidden')}</StatusPill>}
                    {it.files?.length > 0 && <span className="text-xs text-ink-faint">{t('lms.outline.files', { count: it.files.length })}</span>}
                    <ChevronDown className={`h-4 w-4 shrink-0 text-ink-faint transition ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                  {expanded && (
                    <div className="space-y-2 px-1 pb-3">
                      {it.html ? <RichTextView html={it.html} /> : it.body && <p className="whitespace-pre-line text-sm text-ink">{it.body}</p>}
                      {it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand-700 hover:underline">{it.url}</a>}
                      <Attachments entityType="lms_item" entityId={it.id} canAdd={false} compact hideEmpty />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      ))}
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
  const [tab, setTab] = useState('outline')
  const { data: c, isLoading } = useQuery({ queryKey: ['lms-course', id], queryFn: () => fetchCourse(id) })
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
        {hasPermission('homework.hub.view') && (
          <Link to={`/teaching/hub?${new URLSearchParams({ classId: c.classId, subjectId: c.subjectId, edit: '1' })}`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">
            <LayoutPanelTop className="h-4 w-4" aria-hidden />{t('lms.courses.editInHub')}
          </Link>
        )}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'outline', label: t('lms.courses.tabOutline') }, { value: 'progress', label: t('lms.courses.tabProgress') }]} />
      {tab === 'outline' ? <Outline course={c} /> : <Progress courseId={c.id} />}
    </div>
  )
}

/** LMS › Courses & material: what students of each class see, subject by subject (read only; written in the Teaching hub). */
export default function Courses() {
  const { t } = useTranslation('lms')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const openId = params.get('course')
  const [status, setStatus] = useState('')
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['lms-courses', status], queryFn: () => fetchCourses({ status: status || undefined }) })
  const open = (id) => setParams(id ? { course: id } : {})
  const statusLabel = (s) => t(`lms.courseStatus.${s}`)
  // the open course's siblings, to switch without going back (the opened one stays even if the filter would hide it)
  const siblings = openId && !rows.some((r) => r.id === openId) ? [] : rows
  return (
    <PageContainer>
      <PageHeader icon={Library} title={t('lms.courses.title')} subtitle={t('lms.courses.subtitleRead')}
        actions={!openId && <HeaderButton icon={LayoutPanelTop} variant="primary" requires="homework.hub.view" onClick={() => navigate('/teaching/hub?edit=1')}>{t('lms.courses.writeInHub')}</HeaderButton>} />
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
    </PageContainer>
  )
}
