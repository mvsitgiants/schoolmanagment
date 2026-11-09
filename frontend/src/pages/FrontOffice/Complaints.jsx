import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlarmClock, CheckCircle2, CircleDot, Flag, Inbox, Lock, MessageSquareWarning, Play, Plus, RotateCcw, StickyNote, UserCheck } from 'lucide-react'
import { FO_COMPLAINT_CATEGORIES, FO_COMPLAINT_PRIORITIES, FO_COMPLAINT_SOURCES } from '@schoolgiant/shared'
import {
  CodeBadge, DataTable, DateCell, Drawer, EmptyState, FactGrid, FormField, Input, Note, PageContainer, PageHeader, PersonCell, SearchInput, SegmentedControl,
  SideNav, SideNavLayout, StackCell, StatCardRow, Textarea, Timeline,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { CategoryChip, ChipPicker, ComplaintPill, PriorityChip, StaffSelect, StudentFinder, useFoLabels } from '../../components/frontoffice/FoKit'
import { addComplaintNote, assignComplaint, fetchAllComplaints, fetchComplaint, fetchComplaints, raiseComplaint, setComplaintStatus } from '../../api/frontOffice'
import { getCurrentUser, hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50
/** A filter's state whose every change sends the list back to page 1. */
function usePagedFilter(initial, setPage) {
  const [value, set] = useState(initial)
  return [value, (v) => { set(v); setPage(1) }]
}
const fieldsOf = (e) => e?.response?.data?.details?.fields ?? {}
const EMPTY = { source: 'PARENT', category: 'ACADEMICS', priority: 'MEDIUM', subject: '', description: '', student: null, name: '', mobile: '', email: '', complainantUserId: '', assignedToId: '' }
const STEP_TONE = { RAISED: 'brand', ASSIGNED: 'violet', STATUS: 'info', RESOLVED: 'success', CLOSED: 'neutral', REOPENED: 'warning', NOTE: 'neutral' }
const STEP_ICON = { RAISED: Flag, ASSIGNED: UserCheck, STATUS: Play, RESOLVED: CheckCircle2, CLOSED: Lock, REOPENED: RotateCcw, NOTE: StickyNote }

function NewComplaintDrawer({ open, onClose }) {
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  useEffect(() => { if (open) { setF(EMPTY); setErrors({}) } }, [open])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const family = ['PARENT', 'STUDENT'].includes(f.source)
  const save = useMutation({
    mutationFn: () => raiseComplaint({
      source: f.source, category: f.category, priority: f.priority, subject: f.subject, description: f.description,
      studentId: f.student?.id, complainantUserId: f.source === 'STAFF' ? f.complainantUserId || undefined : undefined,
      complainant: { name: f.name, mobile: f.mobile, email: f.email }, assignedToId: hasPermission('frontoffice.complaints.assign') ? f.assignedToId || undefined : undefined,
    }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['frontoffice', 'complaints'] }); showSuccess(t('frontoffice.complaints.raised', { no: c.complaintNo })); onClose() },
    onError: (e) => { setErrors(fieldsOf(e)); showError(e.message) },
  })
  return (
    <Drawer open={open} onClose={onClose} size="lg" title={t('frontoffice.complaints.newTitle')} subtitle={t('frontoffice.complaints.newSubtitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('frontoffice.common.cancel')}</Button><Button icon={Flag} loading={save.isPending} disabled={f.subject.trim().length < 3} onClick={() => save.mutate()}>{t('frontoffice.complaints.raise')}</Button></>}>
      <div className="space-y-4">
        <ChipPicker label={t('frontoffice.complaints.source')} options={FO_COMPLAINT_SOURCES.filter((s) => s.value !== 'FAMILY_APP').map((s) => ({ value: s.value, label: L.source(s.value) }))} value={f.source} onChange={(v) => set('source', v)} />
        <ChipPicker label={t('frontoffice.complaints.category')} options={FO_COMPLAINT_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))} value={f.category} onChange={(v) => set('category', v)} />
        <ChipPicker label={t('frontoffice.complaints.priority')} options={FO_COMPLAINT_PRIORITIES.map((p) => ({ value: p.value, label: L.priority(p.value) }))} value={f.priority} onChange={(v) => set('priority', v)} />
        <FormField label={t('frontoffice.complaints.subject')} required error={errors.subject}><Input value={f.subject} onChange={(e) => set('subject', e.target.value)} placeholder={t('frontoffice.complaints.subjectPlaceholder')} /></FormField>
        <FormField label={t('frontoffice.complaints.description')}><Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} /></FormField>
        <StudentFinder label={family ? t('frontoffice.complaints.student') : t('frontoffice.complaints.studentOptional')} value={f.student} onChange={(s) => set('student', s)} />
        {f.source === 'STAFF' && <StaffSelect label={t('frontoffice.complaints.staffComplainant')} value={f.complainantUserId} onChange={(v) => set('complainantUserId', v)} />}
        {!(family && f.student) && !(f.source === 'STAFF' && f.complainantUserId) && (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t('frontoffice.complaints.complainantName')} required error={errors['complainant.name']}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></FormField>
            <FormField label={t('frontoffice.complaints.mobile')} error={errors['complainant.mobile']}><Input inputMode="tel" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></FormField>
            <FormField label={t('frontoffice.complaints.email')} error={errors['complainant.email']}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></FormField>
          </div>
        )}
        {family && f.student && <Note tone="info">{t('frontoffice.complaints.familyContactHint')}</Note>}
        {hasPermission('frontoffice.complaints.assign') && <StaffSelect label={t('frontoffice.complaints.assignTo')} value={f.assignedToId} onChange={(v) => set('assignedToId', v)} placeholder={t('frontoffice.complaints.assignLater')} />}
      </div>
    </Drawer>
  )
}

function ComplaintDrawer({ id, onClose }) {
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const qc = useQueryClient()
  const { date, dateTime } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [assignee, setAssignee] = useState('')
  const [resolution, setResolution] = useState('')
  const [note, setNote] = useState('')
  const key = ['frontoffice', 'complaints', 'one', id]
  const { data: c } = useQuery({ queryKey: key, queryFn: () => fetchComplaint(id), enabled: !!id })
  useEffect(() => { setAssignee(c?.assignedToId ?? ''); setResolution(c?.resolution ?? ''); setNote('') }, [c?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = (msg) => (d) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['frontoffice', 'complaints'] }); showSuccess(msg) }
  const assign = useMutation({ mutationFn: () => assignComplaint(id, assignee), onSuccess: done(t('frontoffice.complaints.assigned')), onError: (e) => showError(e.message) })
  const move = useMutation({ mutationFn: (body) => setComplaintStatus(id, body), onSuccess: (d) => done(t(`frontoffice.complaints.moved.${d.status}`))(d), onError: (e) => showError(e.message) })
  const addNote = useMutation({ mutationFn: () => addComplaintNote(id, note), onSuccess: (d) => { setNote(''); done(t('frontoffice.complaints.noteAdded'))(d) }, onError: (e) => showError(e.message) })
  const me = getCurrentUser()?.user?.id
  const mayMove = c && (hasPermission('frontoffice.complaints.resolve') || c.assignedToId === me)
  const active = c && ['OPEN', 'IN_PROGRESS'].includes(c.status)
  return (
    <Drawer open={!!id} onClose={onClose} size="lg" title={c?.subject ?? ''} subtitle={c?.complaintNo}>
      {c && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><ComplaintPill value={c.status} /><CategoryChip value={c.category} /><PriorityChip value={c.priority} />{c.overdue && <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger-600"><AlarmClock className="h-3.5 w-3.5" />{t('frontoffice.complaints.overdue')}</span>}</div>
          {c.description && <p className="whitespace-pre-wrap rounded-xl bg-bg p-3 text-sm text-ink">{c.description}</p>}
          <FactGrid cols={2} items={[
            { label: t('frontoffice.complaints.complainant'), value: [c.complainant.name, c.complainant.mobile].filter(Boolean).join(' · ') },
            { label: t('frontoffice.complaints.source'), value: L.source(c.source) },
            { label: t('frontoffice.complaints.student'), value: c.studentName ? `${c.studentName}${c.classLabel ? ` · ${c.classLabel}` : ''}` : null },
            { label: t('frontoffice.complaints.raisedOn'), value: date(c.date) },
            { label: t('frontoffice.complaints.dueOn'), value: c.dueOn ? date(c.dueOn) : null },
            { label: t('frontoffice.complaints.assignedTo'), value: c.assignedTo },
          ]} />
          {c.resolution && <Note tone="success">{c.resolution}</Note>}
          {active && hasPermission('frontoffice.complaints.assign') && (
            <div className="flex items-end gap-2">
              <div className="flex-1"><StaffSelect label={t('frontoffice.complaints.assignTo')} value={assignee} onChange={setAssignee} /></div>
              <Button icon={UserCheck} loading={assign.isPending} disabled={!assignee || assignee === c.assignedToId} onClick={() => assign.mutate()}>{t('frontoffice.complaints.assign')}</Button>
            </div>
          )}
          {mayMove && c.status !== 'CLOSED' && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              {active && <FormField label={t('frontoffice.complaints.resolution')} hint={t('frontoffice.complaints.resolutionHint')}><Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} /></FormField>}
              <div className="flex flex-wrap gap-2">
                {c.status === 'OPEN' && <Button size="sm" variant="secondary" icon={Play} onClick={() => move.mutate({ status: 'IN_PROGRESS' })}>{t('frontoffice.complaints.start')}</Button>}
                {active && <Button size="sm" icon={CheckCircle2} loading={move.isPending} disabled={!resolution.trim()} onClick={() => move.mutate({ status: 'RESOLVED', resolution })}>{t('frontoffice.complaints.resolve')}</Button>}
                {c.status === 'RESOLVED' && <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => move.mutate({ status: 'IN_PROGRESS', note: t('frontoffice.complaints.reopenNote') })}>{t('frontoffice.complaints.reopen')}</Button>}
                <Button size="sm" variant="ghost" icon={Lock} onClick={() => move.mutate({ status: 'CLOSED' })}>{t('frontoffice.complaints.close')}</Button>
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('frontoffice.complaints.history')}</p>
            <Timeline dense items={c.steps.map((s, i) => ({
              id: i, icon: STEP_ICON[s.action] ?? CircleDot, tone: STEP_TONE[s.action] ?? 'neutral', title: L.step(s.action), time: dateTime(s.at),
              meta: s.by ?? undefined, body: s.note ? <p className="whitespace-pre-wrap text-sm text-ink-muted">{s.note}</p> : undefined,
            }))} />
            <div className="mt-3 flex items-end gap-2">
              <FormField label={t('frontoffice.complaints.addNote')} className="flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
              <Button variant="secondary" icon={StickyNote} disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>{t('frontoffice.complaints.saveNote')}</Button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}

/** Front office › Complaints: every complaint by category (left), on the SLA clock, assigned and tracked to resolution. */
export default function FrontOfficeComplaints() {
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [page, setPage] = useState(1)
  // a new filter or search starts again at page 1
  const [category, setCategory] = usePagedFilter('', setPage)
  const [view, setView] = usePagedFilter('ACTIVE', setPage)
  const [mine, setMine] = usePagedFilter(false, setPage)
  const [search, setSearch] = usePagedFilter('', setPage)
  const q = useDebouncedValue(search.trim(), 300)
  const open = params.get('id')
  const setOpen = (id) => setParams(id ? { id } : {}, { replace: true })
  const query = {
    category, mine, search: q,
    ...(view === 'ACTIVE' ? { open: true } : view === 'OVERDUE' ? { overdue: true } : view === 'ALL' ? {} : { status: view }),
  }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['frontoffice', 'complaints', query, page], queryFn: () => fetchComplaints({ ...query, page, pageSize: PAGE }), placeholderData: (prev) => prev })
  const c = data?.counts ?? {}
  return (
    <PageContainer>
      <PageHeader icon={MessageSquareWarning} title={t('frontoffice.complaints.title')} subtitle={t('frontoffice.complaints.subtitle')}
        actions={hasPermission('frontoffice.complaints.create') && <Button icon={Plus} onClick={() => setAdding(true)}>{t('frontoffice.complaints.new')}</Button>} />
      {data && <StatCardRow items={[
        { icon: Inbox, tone: c.OPEN ? 'warning' : 'neutral', label: t('frontoffice.complaints.statOpen'), value: c.OPEN ?? 0, onClick: () => setView('OPEN') },
        { icon: Play, tone: 'info', label: t('frontoffice.complaints.statProgress'), value: c.IN_PROGRESS ?? 0, onClick: () => setView('IN_PROGRESS') },
        { icon: AlarmClock, tone: data.overdue ? 'danger' : 'neutral', label: t('frontoffice.complaints.statOverdue'), value: data.overdue, onClick: () => setView('OVERDUE') },
        { icon: CheckCircle2, tone: 'success', label: t('frontoffice.complaints.statResolved'), value: (c.RESOLVED ?? 0) + (c.CLOSED ?? 0), sub: data.avgResolveDays != null ? t('frontoffice.complaints.avgDays', { days: data.avgResolveDays }) : undefined, onClick: () => setView('RESOLVED') },
      ]} />}
      <SideNavLayout nav={<SideNav title={t('frontoffice.complaints.categories')} value={category} onChange={setCategory} items={[
        { id: '', label: t('frontoffice.common.all'), count: Object.values(data?.byCategory ?? {}).reduce((n, x) => n + x, 0) },
        ...FO_COMPLAINT_CATEGORIES.map((x) => ({ id: x.value, label: L.category(x.value), count: data?.byCategory?.[x.value] ?? 0, hint: t('frontoffice.complaints.openCount') })),
      ]} />}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl value={view} onChange={setView} options={[
              { value: 'ACTIVE', label: t('frontoffice.complaints.viewActive'), count: (c.OPEN ?? 0) + (c.IN_PROGRESS ?? 0) },
              { value: 'OVERDUE', label: t('frontoffice.complaints.viewOverdue'), count: data?.overdue },
              { value: 'RESOLVED', label: L.complaint('RESOLVED'), count: c.RESOLVED },
              { value: 'CLOSED', label: L.complaint('CLOSED'), count: c.CLOSED },
              { value: 'ALL', label: t('frontoffice.common.all') },
            ]} />
            <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="rounded border-border text-brand-500" />{t('frontoffice.complaints.mine')}</label>
            <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('frontoffice.complaints.search')} /></div>
          </div>
          {error && <EmptyState error={error} onRetry={refetch} />}
          <DataTable rows={data?.rows ?? []} loading={isLoading} onRowClick={(r) => setOpen(r.id)} exportable exportName="complaints" exportAll={() => fetchAllComplaints(query)} rowTone={(r) => (r.overdue ? 'danger' : undefined)}
            emptyIcon={MessageSquareWarning} emptyTitle={t('frontoffice.complaints.empty')}
            pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
            columns={[
              { key: 'complaintNo', header: t('frontoffice.complaints.no'), mobileHidden: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
              { key: 'subject', header: t('frontoffice.complaints.subject'), mobilePrimary: true, render: (v, r) => <StackCell title={v} sub={[r.complainant.name, r.studentName && r.classLabel ? `${r.studentName} · ${r.classLabel}` : r.studentName].filter(Boolean).join(' — ')} /> },
              { key: 'category', header: t('frontoffice.complaints.category'), render: (v) => <CategoryChip value={v} /> },
              { key: 'priority', header: t('frontoffice.complaints.priority'), mobileHidden: true, render: (v) => <PriorityChip value={v} /> },
              { key: 'assignedTo', header: t('frontoffice.complaints.assignedTo'), mobileHidden: true, render: (v) => (v ? <PersonCell name={v} size={24} /> : <span className="text-xs text-amber-700">{t('frontoffice.complaints.unassigned')}</span>) },
              { key: 'dueOn', header: t('frontoffice.complaints.dueOn'), render: (v, r) => (['RESOLVED', 'CLOSED'].includes(r.status) ? <DateCell value={r.resolvedAt ?? r.closedAt} relative={false} /> : <DateCell value={v} tone={r.overdue ? 'danger' : undefined} />) },
              { key: 'status', header: t('frontoffice.complaints.status'), render: (v) => <ComplaintPill value={v} /> },
            ]} />
        </div>
      </SideNavLayout>
      <NewComplaintDrawer open={adding} onClose={() => setAdding(false)} />
      <ComplaintDrawer id={open} onClose={() => setOpen(null)} />
    </PageContainer>
  )
}
