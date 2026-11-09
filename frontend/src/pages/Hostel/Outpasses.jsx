import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlarmClock, Check, CheckCircle2, Clock, LogIn, LogOut, MapPin, Phone, Plus, Ticket, UserRound, X } from 'lucide-react'
import { OUTPASS_STATUS } from '@schoolgiant/shared'
import {
  DataTable, DateRangeChip, Drawer, HeaderButton, KanbanBoard, KanbanCard, PageContainer, PageHeader, PersonCell, PhoneLink, PillRow, RecordHero, SearchInput, SegmentedControl,
  SideNavLayout, pillClass, StatCardRow, Tag, Timeline, presetRange, useConfirm, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { BlockNav, OutpassStatusPill, useHostelLabels } from '../../components/hostel/HostelKit'
import OutpassForm from '../../components/hostel/OutpassForm'
import { cancelOutpass, decideOutpass, fetchAllOutpasses, fetchHostelBoard, fetchOutpasses, markOutpassIn, markOutpassOut } from '../../api/hostel'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

/** The buttons an outpass offers in its state: approve / reject, mark out, mark back in, cancel. */
function useOutpassActions(onDone) {
  const { t } = useTranslation('hostel')
  const prompt = usePrompt()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const run = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, { msg }) => { showSuccess(msg); onDone?.(r) }, onError: (e) => showError(e.message) })
  const canApprove = hasPermission('hostel.outpass.approve')
  const canGate = canApprove || hasPermission('hostel.outpass.create')
  return {
    pending: run.isPending,
    actions: (o, size = 'sm') => (
      <>
        {o.status === 'REQUESTED' && canApprove && <Button size={size} icon={Check} onClick={() => run.mutate({ fn: () => decideOutpass(o.id, { approve: true }), msg: t('hostel.outpass.approved') })}>{t('hostel.outpass.approve')}</Button>}
        {o.status === 'REQUESTED' && canApprove && <Button size={size} variant="ghost" icon={X} onClick={async () => {
          const note = await prompt({ title: t('hostel.outpass.rejectTitle', { no: o.outpassNo }), label: t('hostel.outpass.rejectWhy'), required: true })
          if (note) run.mutate({ fn: () => decideOutpass(o.id, { approve: false, note }), msg: t('hostel.outpass.rejected') })
        }}>{t('hostel.outpass.reject')}</Button>}
        {o.status === 'APPROVED' && canGate && <Button size={size} icon={LogOut} onClick={() => run.mutate({ fn: () => markOutpassOut(o.id), msg: t('hostel.outpass.markedOut') })}>{t('hostel.outpass.markOut')}</Button>}
        {o.status === 'OUT' && canGate && <Button size={size} icon={LogIn} onClick={() => run.mutate({ fn: () => markOutpassIn(o.id), msg: t('hostel.outpass.markedIn') })}>{t('hostel.outpass.markIn')}</Button>}
        {['REQUESTED', 'APPROVED'].includes(o.status) && canGate && <Button size={size} variant="ghost" onClick={async () => {
          if (await confirm({ title: t('hostel.outpass.cancelConfirm', { no: o.outpassNo }), confirmLabel: t('hostel.outpass.cancel'), tone: 'danger' })) run.mutate({ fn: () => cancelOutpass(o.id), msg: t('hostel.outpass.cancelled') })
        }}>{t('hostel.outpass.cancel')}</Button>}
      </>
    ),
  }
}

function OutpassDrawer({ pass, onClose, onDone }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const { date, dateTime } = useFormat()
  const { actions } = useOutpassActions(onDone)
  if (!pass) return null
  const o = pass
  return (
    <Drawer open onClose={onClose} title={o.outpassNo} subtitle={L.outpassKind(o.kind)} footer={<div className="flex flex-wrap gap-2">{actions(o, 'md')}</div>}>
      <div className="space-y-4">
        <RecordHero name={o.student?.name} subtitle={[o.student?.className, o.block].filter(Boolean).join(' · ')} status={<OutpassStatusPill status={o.status} />}
          facts={[
            { icon: LogOut, label: t('hostel.outpass.leave'), value: `${date(o.leaveDate)} ${o.leaveTime}` },
            { icon: LogIn, label: t('hostel.outpass.return'), value: `${date(o.returnDate)} ${o.returnTime}` },
            { icon: MapPin, label: t('hostel.outpass.destination'), value: o.destination ?? '—' },
          ]} />
        {o.overdue && <Tag tone="danger" icon={AlarmClock}>{t('hostel.outpass.overdue')}</Tag>}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hostel.outpass.reason')}</p>
          <p className="mt-1 text-sm text-ink">{o.reason}</p>
        </div>
        {o.escort?.name && (
          <div className="flex items-center gap-3">
            <PersonCell name={o.escort.name} sub={o.escort.relation ? t(`hostel.relations.${o.escort.relation}`, { defaultValue: o.escort.relation }) : undefined} />
            {o.escort.mobile && <span className="ms-auto inline-flex items-center gap-1 text-sm"><Phone className="h-4 w-4 text-ink-faint" /><PhoneLink number={o.escort.mobile} /></span>}
          </div>
        )}
        <Timeline dense items={[
          { id: 'asked', icon: UserRound, tone: 'neutral', title: t(o.requestedBy === 'PARENT' ? 'hostel.outpass.askedByParent' : 'hostel.outpass.askedBy', { name: o.requestedByName ?? '' }), time: dateTime(o.createdAt) },
          o.decidedAt && { id: 'decided', icon: o.status === 'REJECTED' ? X : o.status === 'CANCELLED' ? X : Check, tone: o.status === 'REJECTED' ? 'danger' : o.status === 'CANCELLED' ? 'neutral' : 'info', title: o.status === 'REJECTED' ? t('hostel.outpass.rejectedBy', { name: o.decidedBy ?? '' }) : o.status === 'CANCELLED' ? t('hostel.outpass.cancelledBy', { name: o.decidedBy ?? '' }) : t('hostel.outpass.approvedBy', { name: o.decidedBy ?? '' }), time: dateTime(o.decidedAt), meta: o.decisionNote },
          o.outAt && { id: 'out', icon: LogOut, tone: 'violet', title: t('hostel.outpass.wentOut', { name: o.outBy ?? '' }), time: dateTime(o.outAt) },
          o.inAt && { id: 'in', icon: o.late ? AlarmClock : CheckCircle2, tone: o.late ? 'danger' : 'success', title: o.late ? t('hostel.outpass.cameBackLate', { min: o.lateMinutes }) : t('hostel.outpass.cameBack'), time: dateTime(o.inAt), meta: o.inBy },
        ].filter(Boolean)} />
      </div>
    </Drawer>
  )
}

const PAGE = 50

/** Hostel › Outpasses: asked → approved → out → back, as a board; and the full list with dates. */
export default function HostelOutpasses() {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const qc = useQueryClient()
  const { date, time } = useFormat()
  const { showSuccess } = useSnackbar()
  const [params] = useSearchParams()
  const [blockId, setBlockId] = useState('')
  const [view, setView] = useState('OPEN')
  const [status, setStatus] = useState('')
  const [range, setRange] = useState(() => presetRange('last30'))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const [asking, setAsking] = useState(params.get('studentId') ? { studentId: params.get('studentId') } : null)
  const [open, setOpen] = useState(null)
  const { data: board } = useQuery({ queryKey: ['hostel', 'board'], queryFn: fetchHostelBoard })
  const blocks = board?.blocks ?? []
  // any change of filter goes back to the first page of the full list
  const reset = (set) => (v) => { set(v); setPage(1) }
  const filters = { view, ...(blockId && { blockId }), ...(q && { search: q }), ...(view === 'ALL' && status && { status }), ...(view === 'ALL' && range?.from && { from: range.from, to: range.to }) }
  const query = { ...filters, ...(view === 'ALL' && { page, pageSize: PAGE }) }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['hostel', 'outpasses', query], queryFn: () => fetchOutpasses(query), refetchInterval: 60_000 })
  const rows = data?.rows ?? []
  const c = data?.counts
  const refresh = (r) => { qc.invalidateQueries({ queryKey: ['hostel'] }); setOpen((cur) => (cur && r?.id === cur.id ? { ...cur, ...r } : null)) }
  const { actions } = useOutpassActions(refresh)
  const when = (d, tm) => `${date(d)} ${tm}`

  return (
    <PageContainer>
      <PageHeader icon={Ticket} title={t('hostel.outpass.title')} subtitle={t('hostel.outpass.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="hostel.outpass.create" onClick={() => setAsking({})}>{t('hostel.outpass.new')}</HeaderButton>} />
      <StatCardRow items={[
        { icon: Clock, tone: c?.REQUESTED ? 'warning' : 'neutral', label: t('hostel.outpass.waiting'), value: c?.REQUESTED ?? '—' },
        { icon: Check, tone: 'info', label: t('hostel.outpass.readyToLeave'), value: c?.APPROVED ?? '—' },
        { icon: LogOut, tone: 'violet', label: t('hostel.board.outOnPass'), value: c?.OUT ?? '—', sub: c ? t('hostel.outpass.backToday', { count: c.backToday }) : null },
        { icon: AlarmClock, tone: c?.overdue ? 'danger' : 'success', label: t('hostel.outpass.overdueN'), value: c?.overdue ?? '—' },
      ]} />
      <SideNavLayout nav={blocks.length > 1 && <BlockNav blocks={blocks} value={blockId} onChange={reset(setBlockId)} allLabel={t('hostel.nav.allBlocks')} />}>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl value={view} onChange={reset(setView)} options={[{ value: 'OPEN', label: t('hostel.outpass.board') }, { value: 'ALL', label: t('hostel.outpass.all') }]} />
          {view === 'ALL' && <DateRangeChip value={range} onChange={reset(setRange)} />}
          <div className="w-full sm:ms-auto sm:w-72"><SearchInput value={search} onChange={reset(setSearch)} placeholder={t('hostel.outpass.search')} /></div>
        </div>
        {view === 'OPEN' ? (
          <KanbanBoard loading={isLoading} items={rows} columnOf={(o) => o.status} onCardClick={setOpen} emptyText={t('hostel.outpass.columnEmpty')}
            columns={['REQUESTED', 'APPROVED', 'OUT'].map((k) => ({ key: k, label: L.outpass(k), tone: OUTPASS_STATUS[k].tone, icon: k === 'REQUESTED' ? Clock : k === 'APPROVED' ? Check : LogOut }))}
            renderCard={(o) => (
              <div className="space-y-2">
                <KanbanCard title={o.student?.name ?? ''} subtitle={[o.student?.className, o.block].filter(Boolean).join(' · ')} tag={L.outpassKind(o.kind)} tagTone={o.overdue ? 'danger' : 'violet'}
                  meta={o.status === 'OUT' ? t('hostel.outpass.dueBack', { when: when(o.returnDate, o.returnTime) }) : `${when(o.leaveDate, o.leaveTime)} → ${when(o.returnDate, o.returnTime)}`} metaIcon={o.overdue ? AlarmClock : Clock}
                  tone={o.overdue ? 'danger' : undefined} avatar={o.student?.name} />
                <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>{actions(o)}</div>
              </div>
            )} />
        ) : (
          <>
            <PillRow>
              {['', ...Object.keys(OUTPASS_STATUS)].map((k) => (
                <button key={k || 'all'} type="button" onClick={() => reset(setStatus)(k)} aria-pressed={status === k} className={pillClass(status === k)}>
                  {k ? L.outpass(k) : t('hostel.outpass.anyStatus')}
                </button>
              ))}
            </PillRow>
            <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} onRowClick={setOpen} exportable exportName="outpasses" exportAll={() => fetchAllOutpasses(filters)}
              pagination={data?.page && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
              rowTone={(o) => (o.overdue || o.late ? 'danger' : undefined)} emptyIcon={Ticket} emptyTitle={t('hostel.outpass.empty')}
              columns={[
                { key: 'outpassNo', header: t('hostel.outpass.no'), mobileHidden: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: 'student', header: t('hostel.outpass.student'), mobilePrimary: true, render: (v, o) => <PersonCell name={v?.name} sub={[v?.className, o.block].filter(Boolean).join(' · ')} /> },
                { key: 'kind', header: t('hostel.outpass.kind'), mobileHidden: true, render: (v) => <Tag size="xs" tone="violet">{L.outpassKind(v)}</Tag> },
                { key: 'leaveDate', header: t('hostel.outpass.window'), render: (_, o) => <span className="text-xs tabular-nums">{when(o.leaveDate, o.leaveTime)} → {when(o.returnDate, o.returnTime)}</span> },
                { key: 'inAt', header: t('hostel.outpass.back'), mobileHidden: true, render: (v, o) => (v ? <span className="text-xs tabular-nums">{time(v)}{o.late && <Tag size="xs" tone="danger" className="ms-1.5">{t('hostel.outpass.lateMin', { min: o.lateMinutes })}</Tag>}</span> : '—') },
                { key: 'status', header: t('hostel.outpass.status'), render: (v) => <OutpassStatusPill status={v} /> },
              ]} />
          </>
        )}
      </SideNavLayout>
      <OutpassDrawer pass={open} onClose={() => setOpen(null)} onDone={refresh} />
      {asking && <OutpassForm studentId={asking.studentId} onClose={() => setAsking(null)} onSaved={(r) => { setAsking(null); refresh(); showSuccess(r.status === 'APPROVED' ? t('hostel.outpass.savedApproved', { no: r.outpassNo }) : t('hostel.outpass.saved', { no: r.outpassNo })) }} />}
    </PageContainer>
  )
}
