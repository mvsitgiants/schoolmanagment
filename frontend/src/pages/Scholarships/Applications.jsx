import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowRight, Award, Check, Globe, IndianRupee, MessageSquareShare, Plus, RefreshCw, UsersRound, X } from 'lucide-react'
import { SCHOLARSHIP_PORTAL_STATUS, formatINR } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ControlChip, DataTable, DateCell, EmptyState, HeaderButton, LevelBar, Money, Note, PageContainer, PageHeader, PersonCell,
  Tag, Toolbar, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import NewApplication from '../../components/scholarships/NewApplication'
import WhoCanApply from '../../components/scholarships/WhoCanApply'
import { ApplicationStatus, DocDots, DocKey, valueTextOf } from '../../components/scholarships/ScholarshipKit'
import { PortalStatus, RecordMoney } from '../../components/scholarships/PortalMoney'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { decideApplications, fetchApplications, fetchScholarshipMeta, tellFamilies } from '../../api/scholarships'
import { hasAnyPermission, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50
const TABS = ['CHECK', 'FAMILY', 'DECIDE', 'APPROVED', 'CLOSED']
const OPEN = ['IN_PROGRESS', 'NEEDS_FIX', 'READY']
const TAB_TONE = { CHECK: 'bg-brand-500 text-white', FAMILY: 'bg-amber-50 text-amber-600', DECIDE: 'bg-brand-500 text-white', APPROVED: 'bg-black/[0.06] text-ink-muted', CLOSED: 'bg-black/[0.06] text-ink-muted' }

/** "Check 1 document" / "Family to fix 1 document" … — what the office does next, in plain words. */
function NextStep({ next }) {
  const { t } = useTranslation('scholarships')
  if (!next) return null
  const tone = next.code === 'FIX' ? 'text-danger-600' : next.code === 'CHECK' || next.code === 'DECIDE' ? 'text-brand-700 font-medium' : 'text-ink-muted'
  return <span className={clsx('text-sm', tone)}>{t(`scholarships.next.${next.code}`, { count: next.count })}</span>
}

/**
 * Scholarship applications, split by what each needs next: documents to check, waiting for the family, ready to
 * decide (a merit list with the seats and budget left), approved, closed. Opening one goes to its full-page review,
 * where previous / next walk through the same list.
 */
export default function Applications() {
  const { t } = useTranslation('scholarships')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const navigate = useNavigate()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const schemeId = params.get('scheme') ?? ''
  const tabParam = params.get('tab')
  const [search, setSearch] = useState('')
  const renewal = params.get('renewal') ?? ''
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState([])
  const [adding, setAdding] = useState(false)
  const [finding, setFinding] = useState(false)
  const [portalIds, setPortalIds] = useState(null)
  const [moneyRows, setMoneyRows] = useState(null)

  // an old link or a scan at the desk (?open=<id>) goes straight to the review
  const openParam = params.get('open')
  useEffect(() => { if (openParam) navigate(`/scholarships/applications/${openParam}`, { replace: true }) }, [openParam, navigate])

  const { data: meta } = useQuery({ queryKey: ['scholarship-meta'], queryFn: fetchScholarshipMeta })
  const schemes = meta?.schemes ?? []
  // the counts decide the first tab shown: the work waiting first
  const { data: counts } = useQuery({ queryKey: ['scholarship-apps', 'counts', schemeId], queryFn: () => fetchApplications({ schemeId: schemeId || undefined, pageSize: 1 }) })
  const tabs = counts?.summary?.tabs
  const tab = tabParam ?? (tabs ? TABS.find((k) => tabs[k] > 0 && k !== 'CLOSED') ?? 'CHECK' : 'CHECK')
  const listParams = { schemeId: schemeId || undefined, tab, renewal: renewal || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['scholarship-apps', listParams], queryFn: () => fetchApplications(listParams), placeholderData: keepPreviousData, enabled: !!tab })
  const rows = data?.rows ?? []
  const s = data?.summary
  const canCreate = hasPermission('scholarships.applications.create')
  const canWork = hasAnyPermission('scholarships.applications.create', 'scholarships.applications.edit', 'scholarships.applications.verify')
  const canApprove = hasPermission('scholarships.applications.approve')
  const canPortal = hasPermission('scholarships.applications.portal')
  const canMoney = hasPermission('scholarships.applications.money')
  const scheme = schemes.find((x) => x.id === schemeId)

  const setParam = (k, v) => { setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true }); setPage(1); setSelectedIds([]) }
  const openReview = (id) => navigate(`/scholarships/applications/${id}?${new URLSearchParams({ tab, ...(schemeId && { scheme: schemeId }) })}`)
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

  if (meta && !schemes.length) {
    return (
      <PageContainer>
        <PageHeader icon={Award} title={t('scholarships.list.title')} subtitle={t('scholarships.list.subtitle')} />
        <EmptyState icon={Award} title={t('scholarships.list.noSchemes')} hint={t('scholarships.list.noSchemesHint')}
          action={hasPermission('scholarships.schemes.create') && <Button icon={Plus} onClick={() => navigate('/scholarships/schemes/new')}>{t('scholarships.schemes.new')}</Button>} />
      </PageContainer>
    )
  }

  const studentCol = { key: 'student', header: t('scholarships.list.student'), mobileTitle: true, render: (v, r) => (
    <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={[v?.admissionNo, r.applicationNo].filter(Boolean).join(' · ')} size={32} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}{r.renewal && <Tag tone="info" icon={RefreshCw}>{t('scholarships.renewal.tag')}</Tag>}</span>
  ) }
  const schemeCol = schemeId ? [] : [{ key: 'scheme', header: t('scholarships.list.scheme'), mobileLabel: t('scholarships.list.scheme'), render: (v) => <div className="max-w-[16rem]"><p className="text-sm text-ink">{v?.name}</p><p className="text-xs text-ink-faint">{valueTextOf(t, v)}</p></div> }]
  const docsCol = { key: 'docs', header: t('scholarships.list.documents'), mobilePrimary: true, render: (v) => <DocDots items={v?.items} /> }
  const nextCol = { key: 'next', header: t('scholarships.list.nextStep'), mobilePrimary: true, render: (v) => <NextStep next={v} /> }
  const worthCol = { key: 'expectedAmount', header: t('scholarships.list.amount'), align: 'right', mobileTrail: true, render: (v) => <Money value={v} paise /> }
  const COLUMNS = {
    CHECK: [studentCol, ...schemeCol, docsCol, nextCol],
    FAMILY: [studentCol, ...schemeCol, docsCol, nextCol, { key: 'familyToldAt', header: t('scholarships.list.told'), mobileHidden: true, render: (v) => (v ? <DateCell value={v} /> : <span className="text-sm text-ink-faint">{t('scholarships.list.notTold')}</span>) }],
    DECIDE: [
      ...(schemeId ? [{ key: 'rank', header: t('scholarships.list.rank'), width: 56, align: 'right', render: (v) => (v ? <span className="tabular-nums font-semibold text-ink">#{v}</span> : '') }] : []),
      studentCol, ...schemeCol,
      { key: 'marksPct', header: t('scholarships.app.marks'), align: 'right', mobilePrimary: true, render: (v) => (v != null ? <span className="tabular-nums">{v}%</span> : <span className="text-ink-faint">—</span>) },
      { key: 'familyIncome', header: t('scholarships.app.income'), align: 'right', render: (v) => (v != null ? formatINR(v) : <span className="text-ink-faint">—</span>) },
      { key: 'category', header: t('scholarships.check.category'), render: (v) => (v ? t(`scholarships.category.${v}`, v) : '—') },
      worthCol,
    ],
    APPROVED: [studentCol, ...schemeCol, worthCol,
      { key: 'decidedAt', header: t('scholarships.list.approvedOn'), mobileHidden: true, render: (v, r) => <div><DateCell value={v} /><p className="text-xs text-ink-faint">{r.decidedBy}</p></div> },
      { key: 'awaitingMoney', header: t('scholarships.list.moneyCol'), mobilePrimary: true, render: (v, r) => (
        <div className="space-y-0.5">
          {r.benefit === 'PAID_TO_INSTITUTION' ? <p className={clsx('text-sm', v ? 'text-amber-600' : 'text-ink')}>{v ? t('scholarships.money.awaited', { amount: formatINR(Math.max(0, r.expectedAmount - r.received)) }) : t('scholarships.list.moneyIn', { amount: formatINR(r.received) })}</p>
            : <p className="text-sm text-ink-muted">{t(`scholarships.list.given.${r.benefit ?? 'FEE_WAIVER'}`)}</p>}
          {r.portal && <p className="text-xs text-ink-faint">{t(`scholarships.portalStatus.${r.portal.status}`, SCHOLARSHIP_PORTAL_STATUS[r.portal.status]?.label)}</p>}
        </div>
      ) }],
    CLOSED: [studentCol, ...schemeCol, { key: 'status', header: t('scholarships.list.status'), mobilePrimary: true, render: (v) => <ApplicationStatus status={v} /> }, { key: 'decidedAt', header: t('scholarships.list.closedOn'), mobileHidden: true, render: (v) => (v ? <DateCell value={v} /> : '—') }],
  }

  const sc = s?.scheme
  return (
    <PageContainer>
      <PageHeader icon={Award} title={t('scholarships.list.title')} subtitle={data?.year ? t('scholarships.list.subtitleYear', { year: data.year.name }) : t('scholarships.list.subtitle')}
        actions={<>
          <HeaderButton icon={UsersRound} requires="scholarships.applications.create" onClick={() => setFinding(true)}>{t('scholarships.who.button')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="scholarships.applications.create" onClick={() => setAdding(true)}>{t('scholarships.new.button')}</HeaderButton>
        </>} />

      {/* the stages, with what is waiting in each */}
      <div role="tablist" className="flex flex-wrap gap-2 sm:flex-nowrap sm:gap-1 sm:overflow-x-auto sm:scroll-hide sm:border-b sm:border-border">
        {TABS.map((k) => {
          const n = tabs?.[k] ?? 0
          const active = tab === k
          return (
            <button key={k} type="button" role="tab" aria-selected={active} onClick={() => setParam('tab', k)}
              className={clsx('flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors sm:-mb-px sm:rounded-none sm:border-0 sm:border-b-2 sm:px-4 sm:py-3',
                active ? 'border-brand-300 bg-brand-50 text-brand-700 sm:border-brand-500 sm:bg-transparent sm:text-ink' : 'border-border bg-surface text-ink-muted hover:text-ink sm:border-transparent sm:bg-transparent')}>
              {t(`scholarships.tab.${k}`)}
              <span className={clsx('min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-xs tabular-nums', n > 0 && ['CHECK', 'DECIDE', 'FAMILY'].includes(k) ? TAB_TONE[k] : 'bg-black/[0.06] text-ink-muted')}>{n}</span>
            </button>
          )
        })}
      </div>
      <p className="text-sm text-ink-muted -mt-2">{t(`scholarships.tabHint.${tab}`)}</p>

      {tab === 'CHECK' && rows.length > 0 && (
        <Note actions={<Button size="sm" icon={ArrowRight} onClick={() => openReview(rows[0].id)}>{t('scholarships.list.startChecking')}</Button>}>{t('scholarships.list.startCheckingHint', { count: tabs?.CHECK ?? rows.length })}</Note>
      )}
      {tab === 'DECIDE' && sc && (
        <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-border bg-surface p-4">
          <div>
            <p className="text-xs font-medium text-ink-muted mb-1">{t('scholarships.decide.seats')}</p>
            {sc.seats ? <LevelBar value={sc.approved} max={sc.seats} label={t('scholarships.decide.seatsUsed', { count: sc.approved })} highIsBad warnAt={sc.seats} width="w-full" /> : <p className="text-sm text-ink">{t('scholarships.decide.noLimit', { count: sc.approved })}</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-ink-muted mb-1">{t('scholarships.decide.budget')}</p>
            {sc.budget ? <><p className="text-sm font-semibold text-ink tabular-nums">{formatINR(sc.approvedAmount)} <span className="text-xs font-normal text-ink-faint">/ {formatINR(sc.budget)}</span></p><LevelBar value={sc.approvedAmount} max={sc.budget} highIsBad warnAt={sc.budget} width="w-full" bare /></> : <p className="text-sm text-ink">{t('scholarships.decide.noBudget', { amount: formatINR(sc.approvedAmount) })}</p>}
          </div>
          <p className="sm:col-span-2 text-xs text-ink-faint">{sc.renewalsFirst ? `${t('scholarships.renewal.firstNote')} ` : ''}{t(`scholarships.decide.order.${sc.rankBy ?? 'NONE'}`)}</p>
        </div>
      )}
      {tab === 'DECIDE' && !schemeId && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
          <span className="text-sm text-ink-muted">{t('scholarships.decide.pickScheme')}</span>
          {Object.values(rows.reduce((m, r) => { if (r.scheme) { m[r.scheme.id] = m[r.scheme.id] ?? { ...r.scheme, n: 0 }; m[r.scheme.id].n++ } return m }, {})).map((x) => (
            <Button key={x.id} size="sm" variant="secondary" onClick={() => setParam('scheme', x.id)}>{x.name} <span className="ms-1.5 rounded-full bg-brand-500 px-1.5 text-xs text-white tabular-nums">{x.n}</span></Button>
          ))}
        </div>
      )}
      {tab === 'APPROVED' && s && (s.moneyApps > 0 || s.portalToVerify > 0) && (
        <p className="text-sm text-ink-muted">{[s.moneyApps > 0 && t('scholarships.stat.portalMoney', { amount: formatINR(s.moneyAwaited), count: s.moneyApps }), s.portalToVerify > 0 && t('scholarships.list.portalLine', { count: s.portalToVerify })].filter(Boolean).join(' · ')}</p>
      )}

      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])} noun={t('scholarships.bulk.noun')}>
        {canApprove && tab === 'DECIDE' && <Button size="sm" icon={Check} disabled={!readyIds.length} loading={bulk.isPending}
          onClick={() => bulk.mutate({ fn: () => decideApplications(readyIds, true), done: (r) => t('scholarships.decide.approved', { count: r.done }) })}>{t('scholarships.bulk.approve', { count: readyIds.length })}</Button>}
        {canWork && ['FAMILY', 'CHECK'].includes(tab) && <Button size="sm" variant={tab === 'FAMILY' ? 'primary' : 'secondary'} icon={MessageSquareShare} disabled={!openIds.length} loading={bulk.isPending}
          onClick={() => bulk.mutate({ fn: () => tellFamilies(openIds), done: (r) => t('scholarships.tell.sent', { count: r.sent }) })}>{t('scholarships.bulk.tell', { count: openIds.length })}</Button>}
        {canApprove && ['DECIDE', 'FAMILY', 'CHECK'].includes(tab) && <Button size="sm" variant="ghost" icon={X} disabled={!openIds.length} onClick={reject}>{t('scholarships.decide.reject')}</Button>}
        {canPortal && tab !== 'CLOSED' && <Button size="sm" variant="ghost" icon={Globe} disabled={!liveIds.length} onClick={() => setPortalIds(liveIds)}>{t('scholarships.bulk.portal', { count: liveIds.length })}</Button>}
        {canMoney && awaiting.length > 0 && <Button size="sm" variant="ghost" icon={IndianRupee} onClick={() => setMoneyRows(awaiting)}>{t('scholarships.bulk.money', { count: awaiting.length })}</Button>}
      </BulkActionBar>

      <DataTable
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        selectable={canWork || canApprove} selectedIds={selectedIds} onSelectionChange={setSelectedIds}
        onSelect={(r) => openReview(r.id)}
        exportable={hasPermission('scholarships.applications.export')} exportName={`scholarship-applications-${tab.toLowerCase()}`}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('scholarships.list.search')}
          right={<div className="flex flex-wrap gap-2">
            <ControlChip icon={Award} label={t('scholarships.list.scheme')} active={!!schemeId} value={scheme?.name ?? t('scholarships.list.allSchemes')}
              options={[{ value: '', label: t('scholarships.list.allSchemes') }, ...schemes.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => setParam('scheme', v)} />
            <ControlChip icon={RefreshCw} label={t('scholarships.renewal.filter')} active={!!renewal} value={t(`scholarships.renewal.show.${renewal || 'ALL'}`)}
              options={['', 'RENEWAL', 'NEW'].map((k) => ({ value: k, label: t(`scholarships.renewal.show.${k || 'ALL'}`) }))} onChange={(v) => setParam('renewal', v)} />
          </div>} />}
        columns={COLUMNS[tab]}
        emptyIcon={Award} emptyTitle={t(`scholarships.tabEmpty.${tab}`)}
        emptyAction={tab === 'CHECK' && canCreate && !(tabs && Object.values(tabs).some(Boolean)) && <Button icon={UsersRound} onClick={() => setFinding(true)}>{t('scholarships.who.button')}</Button>}
      />

      {['CHECK', 'FAMILY'].includes(tab) && rows.length > 0 && <DocKey />}

      {adding && <NewApplication schemes={schemes} classes={meta?.classes ?? []} schemeId={schemeId || undefined} onClose={() => setAdding(false)}
        onSaved={(app) => { refresh(); setAdding(false); showSuccess(t('scholarships.new.started', { no: app.applicationNo })); navigate(`/scholarships/applications/${app.id}`) }} />}
      {finding && <WhoCanApply schemes={schemes} classes={meta?.classes ?? []} schemeId={schemeId || undefined} onClose={() => setFinding(false)} onDone={refresh} />}
      {portalIds && <PortalStatus ids={portalIds} app={portalIds.length === 1 ? rows.find((r) => r.id === portalIds[0]) : null} onClose={() => setPortalIds(null)}
        onDone={(r) => { refresh(); setPortalIds(null); setSelectedIds([]); showSuccess(t('scholarships.portal.saved', { count: r.done })) }} />}
      {moneyRows && <RecordMoney rows={moneyRows} onClose={() => setMoneyRows(null)}
        onDone={(r) => { refresh(); qc.invalidateQueries({ queryKey: ['fee-ledger'] }); setMoneyRows(null); setSelectedIds([]); showSuccess([t('scholarships.money.done', { count: r.done }), r.skipped?.length ? t('scholarships.bulk.skipped', { count: r.skipped.length, first: r.skipped[0].message }) : null].filter(Boolean).join(' ')) }} />}
    </PageContainer>
  )
}
