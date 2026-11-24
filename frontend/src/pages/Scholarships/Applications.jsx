import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, BadgeCheck, Check, ClipboardCheck, FileSearch, Globe, IndianRupee, ListFilter, MessageSquareShare, Plus, UsersRound, X } from 'lucide-react'
import { SCHOLARSHIP_PORTAL_STATUS, SCHOLARSHIP_STATUS, formatINR } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ControlChip, DataTable, DateCell, EmptyState, HeaderButton, Money, PageContainer, PageHeader, PersonCell, StatCardRow,
  Toolbar, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import ApplicationDrawer from '../../components/scholarships/ApplicationDrawer'
import NewApplication from '../../components/scholarships/NewApplication'
import WhoCanApply from '../../components/scholarships/WhoCanApply'
import { ApplicationStatus, DocProgress } from '../../components/scholarships/ScholarshipKit'
import { PortalStatus, RecordMoney } from '../../components/scholarships/PortalMoney'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { decideApplications, fetchApplications, fetchScholarshipMeta, tellFamilies } from '../../api/scholarships'
import { hasAnyPermission, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50
const OPEN = ['IN_PROGRESS', 'NEEDS_FIX', 'READY']

/**
 * Scholarship applications of the year. The screen leads with what needs doing — documents waiting to be checked,
 * families who still have to give or fix something, applications ready for a decision — and each can be done for a
 * whole list at once: tell every family what is pending, approve a ranked list.
 */
export default function Applications() {
  const { t } = useTranslation('scholarships')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const navigate = useNavigate()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [schemeId, setSchemeId] = useState(params.get('scheme') ?? '')
  const [filter, setFilter] = useState(params.get('view') ?? '') // '' | TO_CHECK | FAMILY | <status>
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState([])
  const [openId, setOpenId] = useState(params.get('open') ?? null)
  const [adding, setAdding] = useState(false)
  const [finding, setFinding] = useState(false)
  const [portalIds, setPortalIds] = useState(null)
  const [moneyRows, setMoneyRows] = useState(null)

  // a scan at the desk (or a link) opens the application, even when this page is already open
  const openParam = params.get('open')
  useEffect(() => { if (openParam) setOpenId(openParam) }, [openParam])
  const { data: meta } = useQuery({ queryKey: ['scholarship-meta'], queryFn: fetchScholarshipMeta })
  const schemes = meta?.schemes ?? []
  const view = ['TO_CHECK', 'FAMILY', 'PORTAL_VERIFY', 'MONEY'].includes(filter) ? filter : undefined
  const status = view ? undefined : filter || undefined
  const listParams = { schemeId: schemeId || undefined, view, status, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['scholarship-apps', listParams], queryFn: () => fetchApplications(listParams), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const s = data?.summary
  const canCreate = hasPermission('scholarships.applications.create')
  const canWork = hasAnyPermission('scholarships.applications.create', 'scholarships.applications.edit', 'scholarships.applications.verify')
  const canApprove = hasPermission('scholarships.applications.approve')
  const canPortal = hasPermission('scholarships.applications.portal')
  const canMoney = hasPermission('scholarships.applications.money')

  const pick = (v) => { setFilter(v); setPage(1); setSelectedIds([]) }
  const openApp = (id) => { setOpenId(id); setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('open', id); else n.delete('open'); return n }, { replace: true }) }
  const refresh = () => { qc.invalidateQueries({ queryKey: ['scholarship-apps'] }); qc.invalidateQueries({ queryKey: ['scholarship-app'] }) }
  const bulk = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (r, v) => {
      refresh(); setSelectedIds([])
      const skipped = r.skipped?.length ?? 0
      showSuccess([v.done(r), skipped ? t('scholarships.bulk.skipped', { count: skipped, first: r.skipped[0].message }) : null].filter(Boolean).join(' '))
    },
    onError: (e) => showError(e.message),
  })
  const picked = rows.filter((r) => selectedIds.includes(r.id))
  const readyIds = picked.filter((r) => r.status === 'READY').map((r) => r.id)
  const openIds = picked.filter((r) => OPEN.includes(r.status)).map((r) => r.id)
  const liveIds = picked.filter((r) => r.status !== 'WITHDRAWN').map((r) => r.id)
  const awaiting = picked.filter((r) => r.awaitingMoney)
  const reject = async () => {
    const note = await prompt({ title: t('scholarships.decide.rejectManyTitle', { count: openIds.length }), label: t('scholarships.decide.rejectReason'), required: true })
    if (note) bulk.mutate({ fn: () => decideApplications(openIds, false, note), done: (r) => t('scholarships.decide.rejected', { count: r.done }) })
  }

  const FILTERS = [
    { value: '', label: t('scholarships.list.all') },
    { value: 'TO_CHECK', label: t('scholarships.list.toCheck') },
    { value: 'FAMILY', label: t('scholarships.list.family') },
    { value: 'PORTAL_VERIFY', label: t('scholarships.list.portalVerify') },
    { value: 'MONEY', label: t('scholarships.list.money') },
    ...Object.keys(SCHOLARSHIP_STATUS).map((k) => ({ value: k, label: t(`scholarships.status.${k}`, SCHOLARSHIP_STATUS[k].label) })),
  ]
  const filterLabel = FILTERS.find((f) => f.value === filter)?.label

  if (meta && !schemes.length) {
    return (
      <PageContainer>
        <PageHeader icon={Award} title={t('scholarships.list.title')} subtitle={t('scholarships.list.subtitle')} />
        <EmptyState icon={Award} title={t('scholarships.list.noSchemes')} hint={t('scholarships.list.noSchemesHint')}
          action={hasPermission('scholarships.schemes.create') && <Button icon={Plus} onClick={() => navigate('/scholarships/schemes/new')}>{t('scholarships.schemes.new')}</Button>} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader icon={Award} title={t('scholarships.list.title')} subtitle={data?.year ? t('scholarships.list.subtitleYear', { year: data.year.name }) : t('scholarships.list.subtitle')}
        actions={<>
          <HeaderButton icon={UsersRound} requires="scholarships.applications.create" onClick={() => setFinding(true)}>{t('scholarships.who.button')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="scholarships.applications.create" onClick={() => setAdding(true)}>{t('scholarships.new.button')}</HeaderButton>
        </>} />

      {s && <StatCardRow items={[
        { icon: FileSearch, tone: 'brand', label: t('scholarships.stat.toCheck'), value: s.docsToCheck, sub: t('scholarships.stat.toCheckSub', { count: s.appsToCheck }), onClick: () => pick('TO_CHECK') },
        { icon: MessageSquareShare, tone: s.familyPending ? 'warning' : 'neutral', label: t('scholarships.stat.family'), value: s.familyPending, sub: t('scholarships.stat.familySub'), onClick: () => pick('FAMILY') },
        { icon: ClipboardCheck, tone: 'info', label: t('scholarships.stat.ready'), value: s.byStatus.READY, sub: t('scholarships.stat.readySub'), onClick: () => pick('READY') },
        { icon: BadgeCheck, tone: 'success', label: t('scholarships.stat.approved'), value: s.byStatus.APPROVED, sub: t('scholarships.stat.approvedSub', { amount: formatINR(s.approvedAmount) }), onClick: () => pick('APPROVED'),
          progress: s.total ? (s.byStatus.APPROVED / s.total) * 100 : 0 },
        ...(s.government || s.moneyApps ? [{ icon: Globe, tone: s.portalToVerify ? 'warning' : 'neutral', label: t('scholarships.stat.portal'), value: s.portalToVerify,
          sub: s.moneyApps ? t('scholarships.stat.portalMoney', { amount: formatINR(s.moneyAwaited), count: s.moneyApps }) : t('scholarships.stat.portalSub'), onClick: () => pick(s.portalToVerify ? 'PORTAL_VERIFY' : 'MONEY') }] : []),
      ]} />}

      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])} noun={t('scholarships.bulk.noun')}>
        {canWork && <Button size="sm" variant="secondary" icon={MessageSquareShare} disabled={!openIds.length} loading={bulk.isPending}
          onClick={() => bulk.mutate({ fn: () => tellFamilies(openIds), done: (r) => t('scholarships.tell.sent', { count: r.sent }) })}>{t('scholarships.bulk.tell', { count: openIds.length })}</Button>}
        {canApprove && <Button size="sm" icon={Check} disabled={!readyIds.length} loading={bulk.isPending}
          onClick={() => bulk.mutate({ fn: () => decideApplications(readyIds, true), done: (r) => t('scholarships.decide.approved', { count: r.done }) })}>{t('scholarships.bulk.approve', { count: readyIds.length })}</Button>}
        {canApprove && <Button size="sm" variant="ghost" icon={X} disabled={!openIds.length} onClick={reject}>{t('scholarships.decide.reject')}</Button>}
        {canPortal && <Button size="sm" variant="ghost" icon={Globe} disabled={!liveIds.length} onClick={() => setPortalIds(liveIds)}>{t('scholarships.bulk.portal', { count: liveIds.length })}</Button>}
        {canMoney && awaiting.length > 0 && <Button size="sm" variant="ghost" icon={IndianRupee} onClick={() => setMoneyRows(awaiting)}>{t('scholarships.bulk.money', { count: awaiting.length })}</Button>}
      </BulkActionBar>

      <DataTable
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        selectable={canWork || canApprove} selectedIds={selectedIds} onSelectionChange={setSelectedIds}
        onSelect={(r) => openApp(r.id)}
        exportable={hasPermission('scholarships.applications.export')} exportName="scholarship-applications"
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('scholarships.list.search')}
          right={<div className="flex flex-wrap gap-2">
            <ControlChip icon={Award} label={t('scholarships.list.scheme')} active={!!schemeId} value={schemes.find((x) => x.id === schemeId)?.name ?? t('scholarships.list.allSchemes')}
              options={[{ value: '', label: t('scholarships.list.allSchemes') }, ...schemes.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => { setSchemeId(v); setPage(1); setSelectedIds([]) }} />
            <ControlChip icon={ListFilter} label={t('scholarships.list.show')} active={!!filter} value={filterLabel} options={FILTERS} onChange={pick} />
          </div>} />}
        columns={[
          ...(schemeId ? [{ key: 'rank', header: t('scholarships.list.rank'), width: 56, align: 'right', render: (v) => (v ? <span className="tabular-nums text-ink-muted">#{v}</span> : '') }] : []),
          { key: 'student', header: t('scholarships.list.student'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={[v?.admissionNo, r.applicationNo].filter(Boolean).join(' · ')} size={32} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span> },
          ...(schemeId ? [] : [{ key: 'scheme', header: t('scholarships.list.scheme'), render: (v) => <div><p className="text-sm text-ink">{v?.name}</p><p className="text-xs text-ink-faint">{v?.valueText}</p></div> }]),
          { key: 'docs', header: t('scholarships.list.documents'), render: (v) => <DocProgress docs={v} /> },
          { key: 'expectedAmount', header: t('scholarships.list.amount'), align: 'right', mobileHidden: true, render: (v) => <Money value={v} paise /> },
          { key: 'status', header: t('scholarships.list.status'), render: (v, r) => (
            <div className="space-y-1">
              <ApplicationStatus status={v} />
              {r.portal && <p className="text-xs text-ink-muted">{t(`scholarships.portalStatus.${r.portal.status}`, SCHOLARSHIP_PORTAL_STATUS[r.portal.status]?.label)}</p>}
              {r.awaitingMoney && <p className="text-xs text-ink-muted">{t('scholarships.money.awaited', { amount: formatINR(Math.max(0, r.expectedAmount - r.received)) })}</p>}
            </div>
          ) },
          { key: 'familyToldAt', header: t('scholarships.list.told'), mobileHidden: true, render: (v) => (v ? <DateCell value={v} /> : <span className="text-ink-faint">—</span>) },
        ]}
        emptyIcon={Award} emptyTitle={filter ? t('scholarships.list.emptyFilter') : t('scholarships.list.empty')}
        emptyHint={filter ? undefined : t('scholarships.list.emptyHint')}
        emptyAction={!filter && canCreate && <Button icon={UsersRound} onClick={() => setFinding(true)}>{t('scholarships.who.button')}</Button>}
      />

      {openId && <ApplicationDrawer id={openId} classes={meta?.classes ?? []} onClose={() => openApp(null)} />}
      {adding && <NewApplication schemes={schemes} classes={meta?.classes ?? []} schemeId={schemeId || undefined} onClose={() => setAdding(false)}
        onSaved={(app) => { refresh(); setAdding(false); showSuccess(t('scholarships.new.started', { no: app.applicationNo })); openApp(app.id) }} />}
      {portalIds && <PortalStatus ids={portalIds} app={portalIds.length === 1 ? rows.find((r) => r.id === portalIds[0]) : null} onClose={() => setPortalIds(null)}
        onDone={(r) => { refresh(); setPortalIds(null); setSelectedIds([]); showSuccess(t('scholarships.portal.saved', { count: r.done })) }} />}
      {moneyRows && <RecordMoney rows={moneyRows} onClose={() => setMoneyRows(null)}
        onDone={(r) => { refresh(); qc.invalidateQueries({ queryKey: ['fee-ledger'] }); setMoneyRows(null); setSelectedIds([]); showSuccess([t('scholarships.money.done', { count: r.done }), r.skipped?.length ? t('scholarships.bulk.skipped', { count: r.skipped.length, first: r.skipped[0].message }) : null].filter(Boolean).join(' ')) }} />}
      {finding && <WhoCanApply schemes={schemes} classes={meta?.classes ?? []} schemeId={schemeId || undefined} onClose={() => setFinding(false)} onDone={refresh} />}
    </PageContainer>
  )
}
