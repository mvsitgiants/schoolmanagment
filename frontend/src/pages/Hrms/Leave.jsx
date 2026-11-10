import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building2, CalendarOff, CalendarRange, CheckCircle2, Clock3, GitPullRequestArrow, Inbox, ListFilter, Palmtree, Plus, ShieldCheck, UserRoundX, X } from 'lucide-react'
import {
  ControlChip, DataTable, FilterBar, HeaderButton, PageContainer, PageHeader, PersonCell, SearchInput, SegmentedControl, SideNav, SideNavLayout, StatCardRow, Tabs, ViewControls,
} from '../../components/system'
import { fetchLeaveSummary, fetchLeaveTypes, fetchLeaves } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useHrMeta } from '../../components/hrms/HrKit'
import { LeaveTypeName, invalidateLeave, useDaysText, useLeaveDates } from '../../components/hrms/leave/LeaveBits'
import { LeaveChainInline, LeaveDecisionButtons, useLeaveDecision } from '../../components/hrms/leave/LeaveChain'
import LeaveApplyModal from '../../components/hrms/leave/LeaveApplyModal'
import LeaveDrawer from '../../components/hrms/leave/LeaveDrawer'
import LeaveBalances from '../../components/hrms/leave/LeaveBalances'
import TeamCalendar from '../../components/hrms/leave/TeamCalendar'
import LeavePolicies from '../../components/hrms/leave/LeavePolicies'
import LeaveApprovalChains from '../../components/hrms/leave/LeaveApprovalChains'
import LeaveNoLeaveDays from '../../components/hrms/leave/LeaveNoLeaveDays'
import LeaveYearEnd from '../../components/hrms/leave/LeaveYearEnd'

// Staff & HR › Leave: requests (what waits on me first, then everything), everyone's balances, the team calendar
// (who is away which day), and the setup — leave policies, approval chains, no-leave days and vacations, the year end.

const PAGE = 50
const STATUSES = ['', 'PENDING', 'UPCOMING', 'APPROVED', 'REJECTED', 'CANCELLED']

function Requests({ summary, types, departments, onOpen }) {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const days = useDaysText()
  const dates = useLeaveDates()
  const decides = hasPermission('hrms.leave.approve')
  const [boxPick, setBoxPick] = useState(null)
  const box = boxPick ?? (decides || summary?.waitingOnMe ? 'mine' : 'all')
  const mine = box === 'mine'
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [dept, setDept] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [box, status, type, dept, q])
  const params = { box, status: mine ? undefined : status || undefined, leaveTypeId: type || undefined, departmentId: dept || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['leaves', params], queryFn: () => fetchLeaves(params), placeholderData: (p) => p })
  // deciding the last request on a later page empties it: step back to the last page there is
  useEffect(() => { if (data && page > 1 && !data.rows.length && data.total) setPage(Math.ceil(data.total / PAGE)) }, [data, page])
  const { decide, busy } = useLeaveDecision(() => invalidateLeave(qc))
  const waitingN = data?.waitingOnMe ?? summary?.waitingOnMe ?? 0
  const statusLabel = (s) => (s ? t(`hrmsLeave.requests.status.${s}`) : t('hrmsLeave.filters.all'))
  const filtersOn = search || (!mine && status) || type || dept
  const columns = [
    { key: 'employeeName', header: t('hrmsLeave.requests.person'), mobilePrimary: true, render: (v, l) => <PersonCell name={v} sub={l.applied?.onBehalf ? t('hrmsLeave.requests.enteredBy', { name: l.applied.by }) : undefined} /> },
    { key: 'leaveName', header: t('hrmsLeave.requests.leave'), mobilePrimary: true, render: (v, l) => <LeaveTypeName name={v} paid={l.paid} /> },
    { key: 'from', header: t('hrmsLeave.requests.when'), mobilePrimary: true, render: (_, l) => (
      <div className="leading-tight"><p className="text-ink whitespace-nowrap">{dates(l)}</p><p className="text-[11px] text-ink-muted">{days(l.days)}</p></div>
    ) },
    { key: 'reason', header: t('hrmsLeave.requests.reason'), mobileHidden: true, render: (v, l) => (
      <div className="max-w-[220px]">
        <p className="text-sm text-ink-muted line-clamp-2" title={v}>{v}</p>
        {l.warnings?.length > 0 && l.status === 'PENDING' && <p className="text-[11px] text-amber-700 line-clamp-1" title={l.warnings.join(' ')}>{l.warnings[0]}</p>}
      </div>
    ) },
    { key: 'status', header: t('hrmsLeave.requests.where'), mobilePrimary: true, render: (_, l) => <LeaveChainInline chain={l.chain} /> },
    { key: 'id', header: '', align: 'right', mobilePrimary: true, render: (_, l) => <LeaveDecisionButtons leave={l} decide={decide} busy={busy} /> },
  ]
  return (
    <div className="flex flex-col gap-4">
      <FilterBar search={<SearchInput value={search} onChange={setSearch} placeholder={t('hrmsLeave.requests.search')} />}>
        <ViewControls>
          <SegmentedControl value={box} onChange={setBoxPick} options={[
            { value: 'mine', label: waitingN ? t('hrmsLeave.requests.mineN', { count: waitingN }) : t('hrmsLeave.requests.mine') },
            { value: 'all', label: t('hrmsLeave.requests.all') },
          ]} />
          {!mine && <ControlChip icon={ListFilter} label={t('hrmsLeave.filters.status')} value={statusLabel(status)} active={!!status} options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} onChange={setStatus} />}
          <ControlChip icon={Palmtree} label={t('hrmsLeave.filters.type')} value={types.find((x) => x.id === type)?.name ?? t('hrmsLeave.filters.all')} active={!!type}
            options={[{ value: '', label: t('hrmsLeave.filters.all') }, ...types.map((x) => ({ value: x.id, label: x.name }))]} onChange={setType} />
          <ControlChip icon={Building2} label={t('hrmsLeave.filters.department')} value={departments.find((d) => d.id === dept)?.name ?? t('hrmsLeave.filters.all')} active={!!dept}
            options={[{ value: '', label: t('hrmsLeave.filters.all') }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} onChange={setDept} />
          {filtersOn && <ControlChip icon={X} label={t('hrmsLeave.filters.clear')} caret={false} onClick={() => { setSearch(''); setStatus(''); setType(''); setDept('') }} />}
        </ViewControls>
      </FilterBar>
      <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} columns={columns} onRowClick={(l) => onOpen(l.id)}
        emptyIcon={mine ? Inbox : CalendarOff}
        emptyTitle={filtersOn ? t('hrmsLeave.requests.emptyFiltered') : mine ? t('hrmsLeave.requests.emptyMine') : t('hrmsLeave.requests.emptyAll')}
        emptyHint={filtersOn ? undefined : mine ? (data?.pending ? t('hrmsLeave.requests.emptyMineOthers', { count: data.pending }) : t('hrmsLeave.requests.emptyMineHint')) : undefined}
        emptyAction={mine && !filtersOn && data?.pending ? <button type="button" onClick={() => setBoxPick('all')} className="text-sm font-medium text-brand-700 hover:underline">{t('hrmsLeave.requests.seeAll')}</button> : undefined}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
    </div>
  )
}

const SETUP = [
  { id: 'policies', icon: ShieldCheck },
  { id: 'chains', icon: GitPullRequestArrow },
  { id: 'noLeave', icon: CalendarOff },
  { id: 'yearEnd', icon: CalendarRange },
]

function Setup({ types, typesLoading, departments, leaveYear }) {
  const { t } = useTranslation('hrmsLeave')
  const [section, setSection] = useState('policies')
  return (
    <SideNavLayout nav={<SideNav title={t('hrmsLeave.setup.title')} value={section} onChange={setSection}
      items={SETUP.map((s) => ({ id: s.id, icon: s.icon, label: t(`hrmsLeave.setup.${s.id}`), hint: t(`hrmsLeave.setup.${s.id}Hint`) }))} />}>
      {section === 'policies' && <LeavePolicies types={types} loading={typesLoading} leaveYear={leaveYear} />}
      {section === 'chains' && <LeaveApprovalChains types={types.filter((x) => x.active)} departments={departments} />}
      {section === 'noLeave' && <LeaveNoLeaveDays />}
      {section === 'yearEnd' && <LeaveYearEnd />}
    </SideNavLayout>
  )
}

const TABS = ['requests', 'balances', 'calendar', 'setup']

/** Staff & HR › Leave. */
export default function Leave() {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [applying, setApplying] = useState(null) // { employeeId? }
  const showSetup = ['hrms.leave.edit', 'hrms.leave.approve'].some(hasPermission)
  const tabs = TABS.filter((x) => x !== 'setup' || showSetup).map((x) => ({ value: x, label: t(`hrmsLeave.tabs.${x}`) }))
  const asked = params.get('tab')
  const tab = tabs.some((x) => x.value === asked) ? asked : 'requests'
  const openId = params.get('open')
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const setTab = (x) => setParam('tab', x === 'requests' ? null : x)
  const canApply = hasPermission('hrms.leave.apply_on_behalf')
  const { data: meta } = useHrMeta()
  const { data: summary } = useQuery({ queryKey: ['leave-summary'], queryFn: fetchLeaveSummary })
  const { data: types = [], isLoading: typesLoading } = useQuery({ queryKey: ['leave-types'], queryFn: fetchLeaveTypes })
  const activeTypes = useMemo(() => types.filter((x) => x.active), [types])
  const departments = meta?.departments ?? []
  const c = summary?.counts
  const days = useDaysText()
  const leaveYear = summary ? { today: summary.today, startMonth: summary.year.startMonth } : null
  return (
    <PageContainer>
      <PageHeader icon={Palmtree} title={t('hrmsLeave.title')} subtitle={t('hrmsLeave.subtitle')}
        actions={canApply && <HeaderButton icon={Plus} variant="primary" onClick={() => setApplying({})}>{t('hrmsLeave.applyFor')}</HeaderButton>} />
      <StatCardRow className="mb-4" items={[
        { icon: Clock3, tone: summary?.waitingOnMe ? 'warning' : 'neutral', label: t('hrmsLeave.tiles.waitingOnYou'), value: summary?.waitingOnMe ?? '—', sub: t('hrmsLeave.tiles.waitingAll', { count: c?.PENDING ?? 0 }), onClick: () => setTab('requests') },
        { icon: UserRoundX, tone: 'neutral', label: t('hrmsLeave.tiles.awayToday'), value: summary?.onLeaveToday ?? '—', sub: t('hrmsLeave.tiles.awayTodaySub'), onClick: () => setTab('calendar') },
        { icon: CheckCircle2, tone: 'brand', label: t('hrmsLeave.tiles.approved', { year: summary?.year?.label ?? '' }), value: c?.APPROVED ?? '—', sub: t('hrmsLeave.tiles.approvedSub', { days: days(summary?.daysOff ?? 0) }) },
      ]} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'requests' && <Requests summary={summary} types={activeTypes} departments={departments} onOpen={(id) => setParam('open', id)} />}
      {tab === 'balances' && <LeaveBalances departments={departments} onApply={canApply ? (r) => setApplying({ employeeId: r.employeeId }) : undefined} />}
      {tab === 'calendar' && <TeamCalendar departments={departments} onOpen={(id) => setParam('open', id)} />}
      {tab === 'setup' && showSetup && <Setup types={types} typesLoading={typesLoading} departments={departments} leaveYear={leaveYear} />}
      {openId && <LeaveDrawer key={openId} id={openId} mode="hr" onClose={() => setParam('open', null)} />}
      {applying && (
        <LeaveApplyModal employees={meta?.staff ?? []} defaultEmployeeId={applying.employeeId} canApproveNow={hasPermission('hrms.leave.approve')}
          onClose={() => setApplying(null)}
          onDone={(l) => { setApplying(null); invalidateLeave(qc); showSuccess(l.status === 'APPROVED' ? t('hrmsLeave.apply.doneApproved', { name: l.employeeName }) : t('hrmsLeave.apply.doneFor', { name: l.employeeName, who: l.chain?.waitingOn ?? '' })) }} />
      )}
    </PageContainer>
  )
}
