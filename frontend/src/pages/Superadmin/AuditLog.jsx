import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { ColorChip, DataTable, DateCell, PageContainer, PageHeader, Pagination, PersonCell, SearchInput, StatusPill } from '../../components/system'
import { fetchPlatformAudit } from '../../api/superadmin'
import useDebouncedValue from '../../hooks/useDebouncedValue'

const PAGE_SIZE = 50

/** Every change made in the platform console, and platform sign-ins: who, what, on what, how it ended. */
export default function PlatformAuditLog() {
  const { t } = useTranslation('superadmin')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search, 300)
  const { data, isLoading } = useQuery({ queryKey: ['sa-audit', q, page], queryFn: () => fetchPlatformAudit({ search: q || undefined, page, pageSize: PAGE_SIZE }), placeholderData: (prev) => prev })
  const rows = data?.data ?? []
  return (
    <PageContainer>
      <PageHeader icon={History} title={t('superadmin.audit.title')} subtitle={t('superadmin.audit.subtitle')} />
      <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('superadmin.audit.search')} className="max-w-md" />
      <DataTable
        rows={rows}
        loading={isLoading}
        dense
        columns={[
          { key: 'at', header: t('superadmin.audit.when'), nowrap: true, render: (v) => <DateCell value={v} time /> },
          { key: 'actorName', header: t('superadmin.audit.who'), mobilePrimary: true, render: (v, r) => (
            <span className="inline-flex flex-col items-start gap-1">
              <PersonCell name={v ?? '—'} size={26} />
              {r.role && <ColorChip label={t(`superadmin.staff.roles.${r.role}`, { defaultValue: r.role })} seed={r.role} dot />}
            </span>
          ) },
          { key: 'action', header: t('superadmin.audit.what'), render: (v, r) => <div><p className="text-sm text-ink">{v}</p>{r.target && <p className="text-xs text-ink-faint font-mono-num truncate max-w-[260px]">{r.target}</p>}</div> },
          { key: 'status', header: t('superadmin.audit.result'), render: (v) => <StatusPill tone={v < 400 ? 'success' : 'danger'}>{v < 400 ? t('superadmin.audit.done') : t('superadmin.audit.refused', { code: v })}</StatusPill> },
          { key: 'ip', header: t('superadmin.audit.ip'), mobileHidden: true, render: (v) => <span className="text-xs text-ink-faint font-mono-num">{v}</span> },
        ]}
        emptyIcon={History} emptyTitle={t('superadmin.audit.empty')}
      />
      {data?.meta && <Pagination page={page - 1} size={PAGE_SIZE} totalElements={data.meta.total} totalPages={data.meta.totalPages} onPageChange={(p) => setPage(p + 1)} />}
    </PageContainer>
  )
}
