import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, CalendarRange, CheckCircle2, Clock, DoorClosed, DoorOpen, GraduationCap, Lock, Pencil, Plus, Users } from 'lucide-react'
import { REG_WINDOW_STATUS } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, DataTable, DateCell, Drawer, EmptyState, FactGrid, HeaderButton, LevelBar, Modal, PageContainer, PageHeader, PersonCell,
  StatCardRow, StatusPill,
} from '../../components/system'
import Button from '../../components/ui/Button'
import WindowForm from '../../components/registration/WindowForm'
import { fetchRoster, fetchWindow, fetchWindows, updateWindow } from '../../api/registration'
import { fetchPrograms } from '../../api/programs'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

function RosterModal({ windowId, offering, onClose }) {
  const { t } = useTranslation('registration')
  const { data, isLoading } = useQuery({ queryKey: ['roster', windowId, offering.courseId], queryFn: () => fetchRoster(windowId, offering.courseId) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('registration.windows.rosterTitle', { code: offering.code, title: offering.title })}>
      <DataTable dense maxHeight="60vh" loading={isLoading} rows={data?.students ?? []} exportable exportName={`roster-${offering.code}`}
        title={t('registration.windows.rosterCount', { count: data?.students.length ?? 0 })}
        emptyTitle={t('registration.windows.rosterEmpty')}
        columns={[
          { key: 'name', header: t('registration.student'), sortable: true, render: (v, r) => <PersonCell name={v} sub={r.registerNo || r.admissionNo} /> },
          { key: 'registerNo', header: t('registration.registerNo'), render: (v, r) => v || r.admissionNo },
          { key: 'status', header: t('registration.status'), render: (v) => <StatusPill tone={v === 'APPROVED' ? 'success' : 'warning'}>{t(`registration.regStatus.${v}`)}</StatusPill> },
        ]} />
    </Modal>
  )
}

function WindowDrawer({ id, onClose, onEdit }) {
  const { t } = useTranslation('registration')
  const [roster, setRoster] = useState(null)
  const { data: w } = useQuery({ queryKey: ['reg-window', id], queryFn: () => fetchWindow(id), enabled: !!id })
  return (
    <Drawer open={!!id} onClose={onClose} size="xl" subtitle={t('registration.windows.drawerSubtitle')} title={w ? `${w.programCode} · ${t('registration.semesterN', { n: w.semester })}` : ''}
      footer={w && hasPermission('registration.windows.edit') && <Button icon={Pencil} onClick={() => onEdit(w)}>{t('actions.edit')}</Button>}>
      {w && (
        <div className="space-y-5">
          <FactGrid cols={2} items={[
            { label: t('registration.windows.program'), value: w.programName },
            { label: t('registration.windows.year'), value: w.yearName },
            { label: t('registration.windows.dates'), value: `${w.opensOn} → ${w.closesOn}` },
            { label: t('registration.windows.credits'), value: `${w.minCredits ?? '—'} – ${w.maxCredits ?? '—'}` },
            { label: t('registration.windows.approval'), value: w.requireApproval ? t('registration.windows.approvalOn') : t('registration.windows.approvalOff') },
            { label: t('registration.status'), value: <StatusPill tone={REG_WINDOW_STATUS[w.status]?.tone}>{t(`registration.windowStatus.${w.status}`)}</StatusPill> },
          ]} />
          {w.groups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {w.groups.map((g) => <ColorChip key={g.code} label={g.name || g.code} seed={g.code} sub={t('registration.windows.pickRange', { min: g.minPick, max: g.maxPick })} />)}
            </div>
          )}
          <DataTable dense title={t('registration.windows.offerings')} rows={w.offerings} rowKey="courseId" onSelect={setRoster}
            exportable exportName={`${w.programCode}-S${w.semester}-offerings`}
            emptyTitle={t('registration.windows.noOfferings')}
            columns={[
              { key: 'code', header: t('registration.course'), render: (v, o) => <div><CodeBadge>{v}</CodeBadge> <span className="text-sm text-ink-muted">{o.title}</span></div> },
              { key: 'credits', header: t('registration.credits'), align: 'right' },
              { key: 'group', header: t('registration.windows.group'), render: (v, o) => (o.mandatory ? <StatusPill tone="brand" dot={false}>{t('registration.windows.compulsory')}</StatusPill> : v ? <ColorChip label={v} seed={v} /> : '—') },
              { key: 'taken', header: t('registration.windows.registered'), align: 'right', render: (v, o) => (o.seats ? <LevelBar value={v} max={o.seats} highIsBad warnAt={o.seats * 0.85} dangerAt={o.seats} width="w-24" /> : <span className="font-semibold">{v}</span>) },
              { key: 'approved', header: t('registration.windows.approved'), align: 'right', render: (v) => <span className="text-ink-muted">{v}</span> },
            ]} />
          <p className="text-xs text-ink-faint">{t('registration.windows.rosterHint')}</p>
        </div>
      )}
      {roster && <RosterModal windowId={id} offering={roster} onClose={() => setRoster(null)} />}
    </Drawer>
  )
}

export default function Windows() {
  const { t } = useTranslation('registration')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['reg-windows'], queryFn: () => fetchWindows() })
  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: fetchPrograms, enabled: hasPermission('programs.programs.view') })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['reg-windows'] }); qc.invalidateQueries({ queryKey: ['reg-window'] }) }
  const toggle = useMutation({
    mutationFn: (w) => updateWindow(w.id, { closed: w.status !== 'CLOSED' }),
    onSuccess: (w) => { refresh(); showSuccess(w.status === 'CLOSED' ? t('registration.windows.closedNow') : t('registration.windows.reopened')) },
    onError: (e) => showError(e.message),
  })
  const open = rows.filter((w) => w.status === 'OPEN')
  const sum = (list, k) => list.reduce((n, w) => n + (w[k] ?? 0), 0)
  const canCreate = hasPermission('registration.windows.create')
  const noPrograms = !programs.length && hasPermission('programs.programs.view')

  return (
    <PageContainer>
      <PageHeader icon={CalendarRange} title={t('registration.windows.title')} subtitle={t('registration.windows.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('registration.windows.new')}</HeaderButton>} />
      <StatCardRow items={[
        { icon: DoorOpen, tone: 'success', label: t('registration.windows.statOpen'), value: open.length, sub: t('registration.windows.statOpenSub', { total: rows.length }) },
        { icon: Users, tone: 'brand', label: t('registration.windows.statStudents'), value: sum(open, 'students'), sub: t('registration.windows.statStudentsSub') },
        { icon: Clock, tone: 'warning', label: t('registration.windows.statWaiting'), value: sum(open, 'submitted'), sub: t('registration.windows.statWaitingSub') },
        {
          icon: CheckCircle2, tone: 'teal', label: t('registration.windows.statApproved'), value: sum(open, 'approved'),
          segments: [{ label: t('registration.regStatus.APPROVED'), value: sum(open, 'approved'), tone: 'success' }, { label: t('registration.regStatus.SUBMITTED'), value: sum(open, 'submitted'), tone: 'warning' }, { label: t('registration.regStatus.NOT_REGISTERED'), value: Math.max(0, sum(open, 'students') - sum(open, 'approved') - sum(open, 'submitted')), tone: 'neutral' }],
        },
      ]} />
      <DataTable
        title={t('registration.windows.list')} exportable exportName="registration-windows"
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id" onSelect={(w) => setSelected(w.id)}
        emptyIcon={noPrograms ? GraduationCap : CalendarClock}
        emptyTitle={noPrograms ? t('registration.windows.noPrograms') : t('registration.windows.empty')}
        emptyHint={noPrograms ? t('registration.windows.noProgramsHint') : t('registration.windows.emptyHint')}
        emptyAction={canCreate && !noPrograms && <Button icon={Plus} onClick={() => setEditing('new')}>{t('registration.windows.new')}</Button>}
        columns={[
          { key: 'programName', header: t('registration.windows.program'), sortable: true, mobileTitle: true, render: (v, w) => <div className="flex items-center gap-2"><ColorChip label={w.programCode} seed={w.programCode} /><span className="text-sm text-ink truncate">{v}</span></div> },
          { key: 'semester', header: t('registration.windows.semester'), sortable: true, render: (v) => <ColorChip label={`${t('registration.semShort', { n: v })}`} seed={`sem${v}`} /> },
          { key: 'yearName', header: t('registration.windows.year'), sortable: true },
          { key: 'opensOn', header: t('registration.windows.opensOn'), sortable: true, render: (v) => <DateCell value={v} relative={false} /> },
          { key: 'closesOn', header: t('registration.windows.closesOn'), sortable: true, render: (v, w) => <DateCell value={v} tone={w.status === 'OPEN' ? 'warning' : undefined} /> },
          { key: 'status', header: t('registration.status'), sortable: true, render: (v) => <StatusPill tone={REG_WINDOW_STATUS[v]?.tone}>{t(`registration.windowStatus.${v}`)}</StatusPill> },
          { key: 'maxCredits', header: t('registration.windows.credits'), align: 'right', render: (v, w) => `${w.minCredits ?? '—'}–${v ?? '—'}` },
          { key: 'approved', header: t('registration.windows.progress'), render: (v, w) => <LevelBar value={v + w.submitted} max={w.students || 1} width="w-24" /> },
          { key: 'actions', header: '', align: 'right', render: (_, w) => hasPermission('registration.windows.edit') && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={w.status === 'CLOSED' ? DoorOpen : Lock} title={w.status === 'CLOSED' ? t('registration.windows.reopen') : t('registration.windows.close')}
                aria-label={w.status === 'CLOSED' ? t('registration.windows.reopen') : t('registration.windows.close')} onClick={() => toggle.mutate(w)} />
              <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('actions.edit')} onClick={async () => setEditing(await fetchWindow(w.id))} />
            </div>
          ) },
        ]}
      />
      <WindowDrawer id={selected} onClose={() => setSelected(null)} onEdit={(w) => { setSelected(null); setEditing(w) }} />
      {editing && <WindowForm window={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(w) => { setEditing(null); refresh(); showSuccess(t('registration.windows.saved')); if (!editing?.id) setSelected(w.id) }} />}
      {rows.length > 0 && <p className="text-xs text-ink-faint flex items-center gap-1.5"><DoorClosed className="h-3.5 w-3.5" />{t('registration.windows.footnote')}</p>}
    </PageContainer>
  )
}
