import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, FileBadge, FileText, Printer, Receipt, Stamp } from 'lucide-react'
import { ColorChip, ControlChip, DataTable, DateCell, DateInput, PageContainer, PageHeader, PersonCell, StatusPill, Toolbar } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { printDocument } from '../../components/print/printDocument'
import { fetchIssued } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50
const TYPES = ['CERTIFICATE', 'TC', 'RECEIPT', 'LETTER']
const TYPE_ICON = { CERTIFICATE: Award, TC: FileBadge, RECEIPT: Receipt, LETTER: FileText }

/**
 * Everything the school has issued — certificates, transfer certificates, fee receipts, staff letters — in one register,
 * newest first. Each kind shows only to roles that may see it. Print any of them again from here.
 */
export default function Issued() {
  const { t } = useTranslation('documentLibrary')
  const { showError } = useSnackbar()
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const params = { type: type || undefined, from: from || undefined, to: to || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['doc-library', 'issued', params], queryFn: () => fetchIssued(params), placeholderData: keepPreviousData })
  const by = data?.summary?.byType ?? {}
  const reset = (fn) => (v) => { fn(v); setPage(1) }
  const title = (r) => (r.type === 'LETTER' ? t(`documentLibrary.issued.letter.${r.title}`, r.title) : r.type === 'RECEIPT' ? r.title.replace('Fee receipt', t('documentLibrary.issued.type.RECEIPT')) : r.type === 'TC' ? t('documentLibrary.issued.type.TC') : r.title)
  return (
    <PageContainer>
      <PageHeader icon={Stamp} title={t('documentLibrary.issued.title')} subtitle={data ? t('documentLibrary.issued.subtitleRange', { from: data.from, to: data.to }) : t('documentLibrary.issued.subtitle')} />
      <div className="flex flex-wrap gap-2">
        {['', ...TYPES].map((k) => {
          const Icon = TYPE_ICON[k]
          const n = k ? by[k] ?? 0 : Object.values(by).reduce((a, b) => a + b, 0)
          return (
            <button key={k || 'ALL'} type="button" onClick={() => reset(setType)(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${type === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted hover:text-ink'}`}>
              {Icon && <Icon className="h-4 w-4" aria-hidden />}{k ? t(`documentLibrary.issued.type.${k}`) : t('documentLibrary.filter.all')}
              <span className="tabular-nums font-semibold">{n}</span>
            </button>
          )
        })}
      </div>
      <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        exportable={hasPermission('documents.issued.export')} exportName="issued-documents"
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('documentLibrary.issued.search')}
          right={<div className="flex flex-wrap items-center gap-2">
            <div className="w-40"><DateInput value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label={t('documentLibrary.issued.from')} /></div>
            <span className="text-sm text-ink-faint">–</span>
            <div className="w-40"><DateInput value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label={t('documentLibrary.issued.to')} /></div>
          </div>} />}
        columns={[
          { key: 'no', header: t('documentLibrary.issued.colNo'), mobileTitle: true, render: (v, r) => { const Icon = TYPE_ICON[r.type]; return <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-ink-muted" aria-hidden /><span className="font-medium text-ink tabular-nums">{v || '—'}</span></span> }, sortAccessor: (r) => r.no ?? '' },
          { key: 'title', header: t('documentLibrary.issued.colWhat'), mobilePrimary: true, render: (_, r) => <span className="text-sm text-ink">{title(r)}</span>, sortAccessor: (r) => title(r) },
          { key: 'person', header: t('documentLibrary.col.person'), mobilePrimary: true, render: (p) => (p ? <span className="flex items-center gap-2 min-w-0"><PersonCell name={p.name} sub={p.sub} size={26} />{p.classShort && <ColorChip label={p.classShort} seed={p.classId ?? p.classShort} />}</span> : '—'), sortAccessor: (r) => r.person?.name ?? '' },
          { key: 'date', header: t('documentLibrary.issued.colDate'), render: (v) => (v ? <DateCell value={v} /> : '—') },
          { key: 'status', header: t('documentLibrary.issued.colStatus'), mobileHidden: true, render: (v) => <StatusPill tone={v === 'CANCELLED' ? 'neutral' : 'success'}>{t(`documentLibrary.issued.status.${v}`)}</StatusPill> },
          { key: 'actions', header: '', align: 'right', width: 60, render: (_, r) => (
            <Button size="sm" variant="ghost" icon={Printer} title={t('documentLibrary.issued.print')} aria-label={t('documentLibrary.issued.print')}
              onClick={(e) => { e.stopPropagation(); printDocument(r.print.kind, r.print.id).catch((err) => showError(err.message)) }} />
          ) },
        ]}
        emptyIcon={Stamp} emptyTitle={t('documentLibrary.issued.empty')} />
    </PageContainer>
  )
}
