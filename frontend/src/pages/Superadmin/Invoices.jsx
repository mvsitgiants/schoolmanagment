import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { ControlChip, DataTable, PageContainer, PageHeader, StatusPill, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAllInvoices } from '../../api/superadmin'
import { useFormat } from '../../context/SettingsContext'

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

  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('superadmin.invoices.title')} subtitle={t('superadmin.invoices.subtitle')} />
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        onRowClick={(r) => navigate(`/superadmin/tenants/${r.tenantId}`)}
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('superadmin.invoices.search')} right={<ControlChip label={t('common.status')} value={STATUSES.includes(status) ? statusLabel(status) : t('superadmin.common.all')} active={!!status} options={[t('superadmin.common.all'), ...STATUSES.map(statusLabel)]} onChange={(v) => { const k = STATUSES.find((x) => statusLabel(x) === v); setParams(k ? { status: k } : {}) }} />} />}
        columns={[
          { key: 'number', header: t('superadmin.common.invoice'), nowrap: true, mobilePrimary: true, render: (v) => <span className="font-mono-num text-ink">{v}</span> },
          { key: 'tenantName', header: t('superadmin.common.institution'), render: (v) => <span className="font-medium text-ink">{v}</span> },
          { key: 'kind', header: t('superadmin.common.type'), render: (v, r) => <span className="text-sm text-ink-muted">{KINDS.includes(v) ? t(`superadmin.invoices.kind.${v}`) : v} · {r.planName} · {r.cycle ? t(`superadmin.cycle.${r.cycle}`, { defaultValue: r.cycle.toLowerCase() }) : ''}</span> },
          { key: 'issuedAt', header: t('superadmin.invoices.issued'), nowrap: true, render: (v) => date(v) },
          { key: 'total', header: t('ui.common.total'), align: 'right', render: (v) => formatINR(v) },
          { key: 'status', header: t('common.status'), render: (v, r) => <StatusPill tone={TONE[v]}>{v === 'DUE' ? t('superadmin.common.dueOn', { date: date(r.dueDate) }) : v === 'PAID' ? t('superadmin.common.paidOn', { date: date(r.paidAt) }) : t('superadmin.common.void')}</StatusPill> },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={FileText} emptyTitle={t('superadmin.invoices.empty')}
      />
    </PageContainer>
  )
}
