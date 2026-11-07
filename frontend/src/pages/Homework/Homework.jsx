import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpenCheck, CheckCheck, Pencil, Plus, Trash2 } from 'lucide-react'
import { SUBMISSION_STATUS, addDaysYmd } from '@schoolgiant/shared'
import { Attachments, ControlChip, DataTable, Drawer, localIso, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, ProgressBar, Select, StatusPill, Textarea, Toolbar, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { createHomework, deleteHomework, fetchHomework, fetchHomeworkList, fetchHomeworkLookup, saveHomeworkSubmissions, updateHomework } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const MARKS = ['SUBMITTED', 'LATE', 'CHECKED', 'MISSING']
const MARK_STYLE = {
  SUBMITTED: 'bg-info-500 text-white border-info-500',
  LATE: 'bg-amber-400 text-white border-amber-400',
  CHECKED: 'bg-success-500 text-white border-success-500',
  MISSING: 'bg-danger-500 text-white border-danger-500',
}
const todayIso = () => localIso(new Date())

/** Set homework (one or more sections of a subject), or edit one. */
function HomeworkForm({ lookup, homework, onClose, onSaved }) {
  const { t } = useTranslation('homework')
  const { showError } = useSnackbar()
  const sections = lookup?.sections ?? []
  const subjects = useMemo(() => {
    const m = new Map()
    for (const s of sections) for (const x of s.subjects) m.set(x.id, x)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sections])
  const [form, setForm] = useState(() => ({
    subjectId: homework?.subjectId ?? subjects[0]?.id ?? '', sectionIds: homework ? [homework.sectionId] : [],
    title: homework?.title ?? '', details: homework?.details ?? '', setDate: homework?.setDate ?? todayIso(), dueDate: homework?.dueDate ?? addDaysYmd(todayIso(), 1),
    needsSubmission: homework?.needsSubmission ?? true, notify: true,
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const forSubject = sections.filter((s) => s.subjects.some((x) => x.id === form.subjectId))
  const toggle = (id) => setForm((f) => ({ ...f, sectionIds: f.sectionIds.includes(id) ? f.sectionIds.filter((x) => x !== id) : [...f.sectionIds, id] }))
  const save = useMutation({
    mutationFn: () => (homework
      ? updateHomework(homework.id, { title: form.title, details: form.details, dueDate: form.dueDate, needsSubmission: form.needsSubmission })
      : createHomework({ ...form, sectionIds: form.sectionIds.filter((id) => forSubject.some((s) => s.id === id)) })),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const picked = form.sectionIds.filter((id) => forSubject.some((s) => s.id === id))
  return (
    <Modal open onClose={onClose} size="lg" title={homework ? t('homework.form.editTitle') : t('homework.form.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 2 || !form.dueDate || (!homework && (!form.subjectId || !picked.length))} onClick={() => save.mutate()}>
        {homework ? t('homework.form.save') : t('homework.form.set', { count: picked.length })}
      </Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        {!homework && <>
          <FormField label={t('homework.form.subject')} required error={errors.subjectId}>
            <Select value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value, sectionIds: [] }))}>
              <option value="">{t('homework.form.pickSubject')}</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>
          <div>
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('homework.form.classes')} <span className="text-danger-500">*</span></p>
            <div className="flex flex-wrap gap-2">
              {forSubject.map((s) => (
                <label key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                  <input type="checkbox" checked={form.sectionIds.includes(s.id)} onChange={() => toggle(s.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                  {s.short}
                </label>
              ))}
              {!forSubject.length && <span className="text-sm text-ink-faint">{t('homework.form.noClasses')}</span>}
            </div>
          </div>
        </>}
        <div className="sm:col-span-2"><FormField label={t('homework.form.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} placeholder={t('homework.form.titlePlaceholder')} /></FormField></div>
        <div className="sm:col-span-2"><FormField label={t('homework.form.details')}><Textarea rows={4} value={form.details} onChange={set('details')} placeholder={t('homework.form.detailsPlaceholder')} /></FormField></div>
        {!homework && <FormField label={t('homework.form.setDate')} error={errors.setDate}><Input type="date" value={form.setDate} onChange={set('setDate')} /></FormField>}
        <FormField label={t('homework.form.dueDate')} required error={errors.dueDate}><Input type="date" value={form.dueDate} min={form.setDate} onChange={set('dueDate')} /></FormField>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.needsSubmission} onChange={(e) => setForm((f) => ({ ...f, needsSubmission: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {t('homework.form.needsSubmission')}
        </label>
        {!homework && <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.notify} onChange={(e) => setForm((f) => ({ ...f, notify: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {t('homework.form.notify')}
        </label>}
        {!homework && <div className="sm:col-span-2"><Note>{t('homework.form.filesHint')}</Note></div>}
      </div>
    </Modal>
  )
}

/** One homework: what was set, its files, and who handed it in. */
function HomeworkDrawer({ id, lookup, onClose }) {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: hw, isLoading } = useQuery({ queryKey: ['homework', id], queryFn: () => fetchHomework(id) })
  const [marks, setMarks] = useState({})
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (hw) setMarks(Object.fromEntries(hw.students.map((s) => [s.id, { status: s.status, remark: s.remark }]))) }, [hw])
  const changed = hw ? hw.students.filter((s) => marks[s.id] && (marks[s.id].status !== s.status || (marks[s.id].remark ?? '') !== (s.remark ?? ''))) : []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['homework', id] }); qc.invalidateQueries({ queryKey: ['homework-list'] }) }
  const save = useMutation({
    mutationFn: () => saveHomeworkSubmissions(id, changed.map((s) => ({ studentId: s.id, status: marks[s.id].status, remark: marks[s.id].remark || undefined }))),
    onSuccess: (d) => { qc.setQueryData(['homework', id], d); qc.invalidateQueries({ queryKey: ['homework-list'] }); showSuccess(t('homework.detail.saved')) },
    onError: (e) => showError(e.message),
  })
  const remove = useMutation({ mutationFn: () => deleteHomework(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['homework-list'] }); showSuccess(t('homework.detail.deleted')); onClose() }, onError: (e) => showError(e.message) })
  const canCheck = hw?.needsSubmission && (hasPermission('homework.homework.edit') || hasPermission('homework.homework.create'))
  const markLabel = (s) => t(`homework.status.${s}`, SUBMISSION_STATUS[s]?.label ?? s)

  return (
    <Drawer open onClose={onClose} size="xl" title={hw?.title ?? t('homework.loading')} subtitle={hw ? `${hw.subject} · ${hw.section}` : undefined}
      footer={canCheck && <Button loading={save.isPending} disabled={!changed.length} onClick={() => save.mutate()}>{t('homework.detail.save', { count: changed.length })}</Button>}>
      {isLoading || !hw ? <p className="text-sm text-ink-faint">{t('homework.loading')}</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">{t('homework.detail.dates', { set: date(hw.setDate), due: date(hw.dueDate) })} · {hw.teacher}</p>
            {hw.canChange && <div className="flex gap-1">
              {hasPermission('homework.homework.edit') && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>{t('homework.detail.edit')}</Button>}
              {hasPermission('homework.homework.delete') && <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: t('homework.detail.deleteConfirm', { title: hw.title }), tone: 'danger', confirmLabel: t('homework.detail.delete') })) remove.mutate() }}>{t('homework.detail.delete')}</Button>}
            </div>}
          </div>
          {hw.details && <p className="text-sm text-ink whitespace-pre-line">{hw.details}</p>}
          {hw.notifiedAt && <Note tone="success">{t('homework.detail.notified', { at: dateTime(hw.notifiedAt) })}</Note>}
          <Attachments entityType="homework" entityId={hw.id} canAdd={hw.canChange} compact />
          {hw.needsSubmission ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-ink">{t('homework.detail.handIns', { done: hw.counts.handedIn, total: hw.counts.total })}</p>
                {canCheck && <Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.status === 'PENDING' || v.status === 'SUBMITTED' ? { ...v, status: 'CHECKED' } : v])))}>{t('homework.detail.allChecked')}</Button>}
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {hw.students.map((s) => {
                  const m = marks[s.id] ?? { status: s.status, remark: s.remark }
                  return (
                    <div key={s.id} className="p-2.5 flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink truncate">{s.rollNo ? <span className="font-mono-num text-ink-faint me-1.5">{s.rollNo}</span> : null}{s.name}</p>
                        {canCheck ? <Input className="mt-1 h-8" value={m.remark ?? ''} maxLength={300} onChange={(e) => setMarks((x) => ({ ...x, [s.id]: { ...m, remark: e.target.value } }))} placeholder={t('homework.detail.remark')} aria-label={t('homework.detail.remark')} />
                          : m.remark && <p className="text-xs text-ink-muted">{m.remark}</p>}
                      </div>
                      {canCheck ? (
                        <div className="flex gap-1">
                          {MARKS.map((k) => (
                            <button key={k} type="button" onClick={() => setMarks((x) => ({ ...x, [s.id]: { ...m, status: m.status === k ? 'PENDING' : k } }))}
                              className={`px-2 h-8 [@media(pointer:coarse)]:h-10 rounded-md border text-xs font-medium ${m.status === k ? MARK_STYLE[k] : 'border-border text-ink-muted hover:bg-bg'}`}>
                              {t(`homework.short.${k}`)}
                            </button>
                          ))}
                        </div>
                      ) : <StatusPill tone={SUBMISSION_STATUS[m.status]?.tone}>{markLabel(m.status)}</StatusPill>}
                    </div>
                  )
                })}
                {!hw.students.length && <p className="p-3 text-sm text-ink-faint">{t('homework.detail.noStudents')}</p>}
              </div>
              {canCheck && <p className="text-xs text-ink-faint mt-2">{t('homework.detail.legend')}</p>}
            </div>
          ) : <Note>{t('homework.detail.noHandIn')}</Note>}
        </div>
      )}
      {editing && hw && <HomeworkForm lookup={lookup} homework={hw} onClose={() => setEditing(false)} onSaved={() => { refresh(); setEditing(false); showSuccess(t('homework.form.saved')) }} />}
    </Drawer>
  )
}

export default function HomeworkPage() {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [search, setSearch] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [when, setWhen] = useState('OPEN')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const { data: lookup } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup })
  const sections = lookup?.sections ?? []
  const subjects = useMemo(() => {
    const m = new Map()
    for (const s of sections) for (const x of s.subjects) m.set(x.id, x)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sections])
  const params = { search: q || undefined, sectionId: sectionId || undefined, subjectId: subjectId || undefined, when: when || undefined, mine: mine ? '1' : undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['homework-list', params], queryFn: () => fetchHomeworkList(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  const WHEN = ['OPEN', 'PAST', '']
  const whenLabel = (w) => t(`homework.when.${w || 'ALL'}`)
  const reset = () => setPage(1)

  return (
    <PageContainer>
      <PageHeader icon={BookOpenCheck} title={t('homework.title')} subtitle={t('homework.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="homework.homework.create" onClick={() => setAdding(true)}>{t('homework.new')}</HeaderButton>} />
      {lookup && !sections.length && <Note tone="warning" className="mb-4">{t('homework.noSections')}</Note>}
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); reset() }} searchPlaceholder={t('homework.search')} right={<>
          <ControlChip label={t('homework.class')} value={sections.find((s) => s.id === sectionId)?.short ?? t('homework.all')} active={!!sectionId}
            options={[t('homework.all'), ...sections.map((s) => s.short)]} onChange={(v) => { setSectionId(sections.find((s) => s.short === v)?.id ?? ''); reset() }} />
          <ControlChip label={t('homework.subject')} value={subjects.find((s) => s.id === subjectId)?.name ?? t('homework.all')} active={!!subjectId}
            options={[t('homework.all'), ...subjects.map((s) => s.name)]} onChange={(v) => { setSubjectId(subjects.find((s) => s.name === v)?.id ?? ''); reset() }} />
          <ControlChip label={t('homework.due')} value={whenLabel(when)} active={when !== 'OPEN'} options={WHEN.map(whenLabel)} onChange={(v) => { setWhen(WHEN.find((w) => whenLabel(w) === v) ?? 'OPEN'); reset() }} />
          <ControlChip label={t('homework.setBy')} value={mine ? t('homework.me') : t('homework.anyone')} active={mine} options={[t('homework.anyone'), t('homework.me')]} onChange={(v) => { setMine(v === t('homework.me')); reset() }} />
        </>} />}
        columns={[
          { key: 'dueDate', header: t('homework.due'), nowrap: true, render: (v, r) => <span className={r.overdue ? 'text-ink-muted' : 'font-medium'}>{date(v)}</span> },
          { key: 'section', header: t('homework.class'), render: (v, r) => <span className="text-sm">{v} · {r.subject}</span> },
          { key: 'title', header: t('homework.what'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p>{r.details && <p className="text-xs text-ink-faint line-clamp-1">{r.details}</p>}</div> },
          { key: 'teacher', header: t('homework.setBy'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{v}</span> },
          { key: 'counts', header: t('homework.handedIn'), render: (c, r) => (r.needsSubmission
            ? <div className="min-w-[110px]"><ProgressBar value={c.total ? Math.round((c.handedIn / c.total) * 100) : 0} /><p className="text-xs text-ink-faint mt-0.5">{t('homework.handedInOf', { done: c.handedIn, total: c.total })}{c.MISSING ? ` · ${t('homework.missingN', { count: c.MISSING })}` : ''}</p></div>
            : <span className="text-xs text-ink-faint">{t('homework.noHandIn')}</span>) },
        ]}
        onRowClick={(r) => setOpenId(r.id)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={BookOpenCheck} emptyTitle={t('homework.empty')} emptyHint={t('homework.emptyHint')}
      />
      {adding && <HomeworkForm lookup={lookup} onClose={() => setAdding(false)} onSaved={(r) => {
        qc.invalidateQueries({ queryKey: ['homework-list'] }); setAdding(false)
        showSuccess(r.notified ? t('homework.form.setNotified', { count: r.created, families: r.notified }) : t('homework.form.setDone', { count: r.created }))
        if (r.ids?.length === 1) setOpenId(r.ids[0])
      }} />}
      {openId && <HomeworkDrawer id={openId} lookup={lookup} onClose={() => setOpenId(null)} />}
    </PageContainer>
  )
}
