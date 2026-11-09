import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { FileText, IndianRupee, Receipt } from 'lucide-react'
import { formatINRCompact } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, ControlChip, DataTable, DateCell, Money, PageContainer, PageHeader, StatCardRow, StatusPill, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAllInvoices, fetchDashboard } from '../../api/superadmin'
import { useFormat } from '../../context/SettingsContext'
import { InstitutionCell, PlanChip } from './Dashboard'

const TONE = { DUE: 'warning', PAID: 'success', VOID: 'neutral' }
const STATUSES = ['DUE', 'PAID', 'VOID']
const KINDS = ['NEW', 'RENEWAL', 'PLAN_CHANGE']

export default function Invoices() {
  const { t } = useTranslation('superadmin')
  const statusLabel = (k) => t(`superadmin.invoices.status.${k}`)
  const navigate = useNavigate()
  const { date } = useFormat()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, status])
  const query = { status, search: q, page, pageSize: 30 }
  const { data, isLoading } = useQuery({ queryKey: ['sa-invoices', query], queryFn: () => fetchAllInvoices(query), placeholderData: (p) => p })
  const meta = data?.meta
  // the platform overview already sums what is owed and what came in; the tiles reuse it
  const { data: overview } = useQuery({ queryKey: ['sa-dashboard'], queryFn: fetchDashboard })
  const pick = (k) => setParams(status === k ? {} : { status: k })

  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('superadmin.invoices.title')} subtitle={t('superadmin.invoices.subtitle')} />
      {overview && (
        <StatCardRow className="lg:!grid-cols-2" items={[
          { icon: Receipt, tone: overview.outstanding ? 'warning' : 'neutral', label: t('superadmin.dashboard.outstanding'), value: formatINRCompact(overview.outstanding), sub: t('superadmin.dashboard.unpaidInvoices', { count: overview.outstandingCount }), onClick: () => pick('DUE'), className: status === 'DUE' ? 'ring-2 ring-brand-400' : undefined },
          { icon: IndianRupee, tone: 'success', label: t('superadmin.dashboard.collected30d'), value: formatINRCompact(overview.collected30d), sub: t('superadmin.dashboard.paymentsRecorded'), onClick: () => pick('PAID'), className: status === 'PAID' ? 'ring-2 ring-brand-400' : undefined },
        ]} />
      )}
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        onRowClick={(r) => navigate(`/superadmin/tenants/${r.tenantId}`)}
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('superadmin.invoices.search')} right={<ControlChip label={t('common.status')} value={STATUSES.includes(status) ? statusLabel(status) : t('superadmin.common.all')} active={!!status} options={[t('superadmin.common.all'), ...STATUSES.map(statusLabel)]} onChange={(v) => { const k = STATUSES.find((x) => statusLabel(x) === v); setParams(k ? { status: k } : {}) }} />} />}
        columns={[
          { key: 'number', header: t('superadmin.common.invoice'), nowrap: true, mobilePrimary: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
          { key: 'tenantName', header: t('superadmin.common.institution'), render: (v) => <InstitutionCell name={v} size={30} /> },
          { key: 'kind', header: t('superadmin.common.type'), render: (v, r) => (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <ColorChip label={KINDS.includes(v) ? t(`superadmin.invoices.kind.${v}`) : v} seed={v} dot />
              {r.planName && <PlanChip code={r.planCode} name={r.planName} />}
              {r.cycle && <span className="text-[11px] text-ink-faint">{t(`superadmin.cycle.${r.cycle}`, { defaultValue: r.cycle.toLowerCase() })}</span>}
            </span>
          ) },
          { key: 'issuedAt', header: t('superadmin.invoices.issued'), nowrap: true, render: (v) => <DateCell value={v} /> },
          { key: 'total', header: t('ui.common.total'), align: 'right', render: (v, r) => <Money value={v} paise currency="INR" tone={r.status === 'DUE' ? 'warning' : undefined} className="font-semibold" /> },
          { key: 'status', header: t('common.status'), render: (v, r) => <StatusPill tone={TONE[v]}>{v === 'DUE' ? t('superadmin.common.dueOn', { date: date(r.dueDate) }) : v === 'PAID' ? t('superadmin.common.paidOn', { date: date(r.paidAt) }) : t('superadmin.common.void')}</StatusPill> },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={FileText} emptyTitle={t('superadmin.invoices.empty')}
      />
    </PageContainer>
  )
}
