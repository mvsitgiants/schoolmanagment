import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarRange, Check, CheckCircle2, ClipboardList, Clock, ListFilter, PencilLine, UserPlus, Users, X, XCircle } from 'lucide-react'
import { REG_STATUS } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ColumnBars, ControlChip, DataTable, DateCell, Drawer, EmptyState, FactGrid, LevelBar, PageContainer, PageHeader, PersonCell,
  StatCardRow, StatusPill, Timeline, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import RegistrationForm from '../../components/registration/RegistrationForm'
import { decideRegistrations, fetchRegistrations, fetchRosters, fetchWindows } from '../../api/registration'
import { hasAnyPermission, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const TONE = { ...Object.fromEntries(Object.entries(REG_STATUS).map(([k, v]) => [k, v.tone])), NOT_REGISTERED: 'neutral' }

export default function Requests() {
  const { t } = useTranslation('registration')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [windowId, setWindowId] = useState(params.get('window') ?? '')
  const [status, setStatus] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [open, setOpen] = useState(null) // drawer row
  const [entering, setEntering] = useState(null) // studentId
  const { data: windows = [], isLoading: loadingWindows } = useQuery({ queryKey: ['reg-windows'], queryFn: () => fetchWindows() })
  useEffect(() => {
    if (windows.length && !windows.some((w) => w.id === windowId)) setWindowId((windows.find((w) => w.status === 'OPEN') ?? windows[0]).id)
  }, [windows, windowId])
  useEffect(() => { if (windowId) setParams({ window: windowId }, { replace: true }) }, [windowId, setParams])
  const win = windows.find((w) => w.id === windowId)
  const key = ['registrations', windowId]
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchRegistrations(windowId), enabled: !!windowId })
  const { data: rosters = [] } = useQuery({ queryKey: ['rosters', windowId], queryFn: () => fetchRosters(windowId), enabled: !!windowId })
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !status || r.status === status), [data, status])
  const summary = data?.summary ?? {}
  const canApprove = hasPermission('registration.requests.approve')
  const canEnter = hasAnyPermission('registration.windows.edit', 'registration.requests.approve')
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['rosters', windowId] }); qc.invalidateQueries({ queryKey: ['reg-windows'] }) }
  const decide = useMutation({
    mutationFn: ({ ids, action, note }) => decideRegistrations(ids, action, note),
    onSuccess: (r, v) => { refresh(); setSelectedIds([]); setOpen(null); showSuccess(t(v.action === 'APPROVE' ? 'registration.requests.approvedN' : 'registration.requests.rejectedN', { count: r.done })) },
    onError: (e) => showError(e.message),
  })
  const reject = async (ids) => {
    const note = await prompt({ title: t('registration.requests.rejectTitle', { count: ids.length }), label: t('registration.requests.rejectReason'), required: true })
    if (note) decide.mutate({ ids, action: 'REJECT', note })
  }
  const pendingSelected = selectedIds.filter((id) => rows.find((r) => r.id === id)?.status === 'SUBMITTED')

  if (!loadingWindows && !windows.length) {
    return (
      <PageContainer>
        <PageHeader icon={ClipboardList} title={t('registration.requests.title')} subtitle={t('registration.requests.subtitle')} />
        <EmptyState icon={CalendarRange} title={t('registration.requests.noWindows')} hint={t('registration.requests.noWindowsHint')} />
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={t('registration.requests.title')} subtitle={t('registration.requests.subtitle')} />
      <div className="flex flex-wrap items-center gap-2">
        <ControlChip icon={CalendarRange} label={t('registration.requests.window')} active value={win ? `${win.programCode} · ${t('registration.semShort', { n: win.semester })} · ${win.yearName}` : ''}
          options={windows.map((w) => ({ value: w.id, label: `${w.programCode} · ${t('registration.semShort', { n: w.semester })} · ${w.yearName} — ${t(`registration.windowStatus.${w.status}`)}` }))} onChange={(v) => { setWindowId(v); setSelectedIds([]) }} />
        <ControlChip icon={ListFilter} label={t('registration.status')} active={!!status} value={status ? t(`registration.regStatus.${status}`) : t('registration.all')}
          options={[{ value: '', label: t('registration.all') }, ...['SUBMITTED', 'APPROVED', 'REJECTED', 'NOT_REGISTERED'].map((s) => ({ value: s, label: t(`registration.regStatus.${s}`) }))]} onChange={setStatus} />
        {win && <StatusPill tone={win.status === 'OPEN' ? 'success' : 'warning'}>{t(`registration.windowStatus.${win.status}`)} · {win.closesOn}</StatusPill>}
      </div>
      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: t('registration.requests.statStudents'), value: summary.total ?? 0, sub: t('registration.requests.statStudentsSub'), onClick: () => setStatus(''),
          segments: [{ label: t('registration.regStatus.APPROVED'), value: summary.APPROVED ?? 0, tone: 'success' }, { label: t('registration.regStatus.SUBMITTED'), value: summary.SUBMITTED ?? 0, tone: 'warning' }, { label: t('registration.regStatus.NOT_REGISTERED'), value: summary.NOT_REGISTERED ?? 0, tone: 'neutral' }] },
        { icon: Clock, tone: 'warning', label: t('registration.regStatus.SUBMITTED'), value: summary.SUBMITTED ?? 0, sub: t('registration.requests.statWaitingSub'), onClick: () => setStatus('SUBMITTED') },
        { icon: CheckCircle2, tone: 'success', label: t('registration.regStatus.APPROVED'), value: summary.APPROVED ?? 0, sub: t('registration.requests.statApprovedSub'), progress: summary.total ? ((summary.APPROVED ?? 0) / summary.total) * 100 : 0, onClick: () => setStatus('APPROVED') },
        { icon: XCircle, tone: 'danger', label: t('registration.requests.statOpenItems'), value: (summary.NOT_REGISTERED ?? 0) + (summary.REJECTED ?? 0), sub: t('registration.requests.statOpenItemsSub', { rejected: summary.REJECTED ?? 0 }), onClick: () => setStatus('NOT_REGISTERED') },
      ]} />
      {rosters.length > 0 && (
        <ColumnBars title={t('registration.requests.demand')} subtitle={t('registration.requests.demandHint')}
          items={rosters.map((r) => ({ id: r.courseId, label: r.code, short: r.code, value: r.registered, tone: r.seats && r.registered >= r.seats ? 'danger' : undefined }))} />
      )}
      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])} noun={t('registration.requests.noun')}>
        {canApprove && <Button size="sm" icon={Check} disabled={!pendingSelected.length} loading={decide.isPending} onClick={() => decide.mutate({ ids: pendingSelected, action: 'APPROVE' })}>{t('registration.requests.approveN', { count: pendingSelected.length })}</Button>}
        {canApprove && <Button size="sm" variant="secondary" icon={X} disabled={!pendingSelected.length} onClick={() => reject(pendingSelected)}>{t('registration.requests.reject')}</Button>}
      </BulkActionBar>
      <DataTable
        title={t('registration.requests.list', { count: rows.length })}
        exportable={hasPermission('registration.requests.export')} exportName={`registrations-${win?.programCode ?? ''}-S${win?.semester ?? ''}`}
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        selectable={canApprove} selectedIds={selectedIds} onSelectionChange={setSelectedIds}
        onSelect={(r) => (r.registrationId ? setOpen(r) : canEnter && setEntering(r.studentId))}
        rowTone={(r) => (r.status === 'REJECTED' ? 'danger' : undefined)}
        emptyIcon={Users} emptyTitle={t('registration.requests.empty')} emptyHint={t('registration.requests.emptyHint')}
        columns={[
          { key: 'name', header: t('registration.student'), sortable: true, mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.registerNo || r.admissionNo} /> },
          { key: 'courses', header: t('registration.requests.courses'), render: (v) => (v.length ? <div className="flex flex-wrap gap-1">{v.map((c) => <ColorChip key={c} label={c} seed={c} mono />)}</div> : <span className="text-ink-faint">—</span>) },
          { key: 'credits', header: t('registration.credits'), align: 'right', sortable: true, render: (v) => (v ? <LevelBar value={v} max={win?.maxCredits || v} label={String(v)} width="w-20" /> : '—') },
          { key: 'advisorName', header: t('registration.requests.advisor'), sortable: true, render: (v) => v || <span className="text-ink-faint">—</span> },
          { key: 'status', header: t('registration.status'), sortable: true, render: (v) => <StatusPill tone={TONE[v]}>{t(`registration.regStatus.${v}`)}</StatusPill> },
          { key: 'updatedAt', header: t('registration.requests.updated'), sortable: true, render: (v) => <DateCell value={v} time /> },
          { key: 'actions', header: '', align: 'right', render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'NOT_REGISTERED' && canEnter && win?.status === 'OPEN' && <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setEntering(r.studentId)}>{t('registration.requests.register')}</Button>}
              {r.status === 'SUBMITTED' && canApprove && <Button size="sm" variant="ghost" icon={Check} aria-label={t('registration.requests.approve')} title={t('registration.requests.approve')} onClick={() => decide.mutate({ ids: [r.registrationId], action: 'APPROVE' })} />}
            </div>
          ) },
        ]}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} subtitle={t('registration.requests.drawerSubtitle')} title={open?.name}
        footer={open && <div className="flex flex-wrap gap-2">
          {open.status === 'SUBMITTED' && canApprove && <Button icon={Check} loading={decide.isPending} onClick={() => decide.mutate({ ids: [open.registrationId], action: 'APPROVE' })}>{t('registration.requests.approve')}</Button>}
          {open.status === 'SUBMITTED' && canApprove && <Button variant="secondary" icon={X} onClick={() => reject([open.registrationId])}>{t('registration.requests.reject')}</Button>}
          {canEnter && win?.status === 'OPEN' && <Button variant="ghost" icon={PencilLine} onClick={() => { setEntering(open.studentId); setOpen(null) }}>{t('registration.requests.addDrop')}</Button>}
        </div>}>
        {open && (
          <div className="space-y-5">
            <FactGrid cols={2} items={[
              { label: t('registration.registerNo'), value: open.registerNo || open.admissionNo, mono: true },
              { label: t('registration.status'), value: <StatusPill tone={TONE[open.status]}>{t(`registration.regStatus.${open.status}`)}</StatusPill> },
              { label: t('registration.credits'), value: open.credits },
              { label: t('registration.requests.advisor'), value: open.advisorName },
              ...(open.note ? [{ label: t('registration.requests.note'), value: open.note, span: 'full', text: true }] : []),
            ]} />
            <div>
              <p className="text-sm font-semibold text-ink mb-2">{t('registration.requests.courses')}</p>
              <div className="flex flex-wrap gap-1.5">{open.courses.map((c) => <ColorChip key={c} label={c} seed={c} mono />)}</div>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink mb-2">{t('registration.requests.history')}</p>
              <Timeline dense items={[...open.history].reverse().map((h, i) => ({
                id: String(i), tone: h.action === 'APPROVED' ? 'success' : h.action === 'REJECTED' ? 'danger' : 'brand',
                title: t(`registration.historyAction.${h.action}`, h.action), time: dateTime(h.at), meta: h.by,
                body: [h.added?.length ? t('registration.requests.added', { codes: h.added.join(', ') }) : null, h.dropped?.length ? t('registration.requests.dropped', { codes: h.dropped.join(', ') }) : null, h.note].filter(Boolean).join(' · ') || null,
              }))} />
            </div>
          </div>
        )}
      </Drawer>
      {entering && <RegistrationForm windowId={windowId} studentId={entering} onClose={() => setEntering(null)}
        onSaved={(r) => { setEntering(null); refresh(); showSuccess(r.status === 'APPROVED' ? t('registration.requests.savedApproved') : t('registration.requests.savedWaiting')) }} />}
    </PageContainer>
  )
}
