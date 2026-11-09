import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, Plus, Zap } from 'lucide-react'
import { POSTING_SOURCES, VOUCHER_TYPES } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, ControlChip, DataTable, DateCell, HeaderButton, Money, PageContainer, PageHeader, SegmentedControl, Toolbar } from '../../components/system'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchJournals } from '../../api/finance'
import { JournalStatus, VoucherDrawer, VoucherForm } from '../../components/finance/FinanceKit'

/** Accounts › Journals: every voucher — fee receipts, refunds, payroll and expenses posted on their own, and vouchers by hand. */
export default function Journals() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { status: status || undefined, source: source || undefined, type: type || undefined, search: q || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['fin-journals', params], queryFn: () => fetchJournals(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fin-journals'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }) }
  const SOURCES = ['', 'AUTO', 'MANUAL', ...Object.keys(POSTING_SOURCES).filter((k) => k !== 'MANUAL')]
  const sourceName = (k) => (k === '' ? t('finance.all') : k === 'AUTO' || k === 'MANUAL' ? t(`finance.journals.${k === 'AUTO' ? 'auto' : 'manual'}`) : t(`finance.sources.${k}`))
  const typeName = (k) => (k ? t(`finance.voucherTypes.${k}`) : t('finance.all'))
  return (
    <PageContainer>
      <PageHeader icon={BookOpen} title={t('finance.journals.title')} subtitle={t('finance.journals.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="finance.journals.create" onClick={() => setCreating(true)}>{t('finance.journals.new')}</HeaderButton>} />
      <SegmentedControl className="mb-3" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: t('finance.all') }, { value: 'POSTED', label: t('finance.journalStatus.POSTED') }, { value: 'DRAFT', label: t('finance.journals.drafts', { count: data?.summary?.drafts ?? 0 }) }]} />
      <DataTable rows={data?.data ?? []} loading={isLoading}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('finance.journals.search')}
          right={<>
            <ControlChip label={t('finance.journals.source')} value={sourceName(source)} active={!!source} options={SOURCES.map(sourceName)} onChange={(v) => { setSource(SOURCES.find((k) => sourceName(k) === v) ?? ''); setPage(1) }} />
            <ControlChip label={t('finance.voucher.type')} value={typeName(type)} active={!!type} options={['', ...VOUCHER_TYPES.map((x) => x.value)].map(typeName)} onChange={(v) => { setType(['', ...VOUCHER_TYPES.map((x) => x.value)].find((k) => typeName(k) === v) ?? ''); setPage(1) }} />
          </>} />}
        columns={[
          { key: 'date', header: t('finance.voucher.date'), nowrap: true, render: (v) => <DateCell value={v} /> },
          { key: 'voucherNo', header: t('finance.journals.voucher'), mobilePrimary: true, render: (v, r) => <div className="flex flex-col items-start gap-1"><CodeBadge tone={v ? 'neutral' : 'warning'}>{v ?? t('finance.voucher.draft')}</CodeBadge>
            <ColorChip label={t(`finance.voucherTypes.${r.type}`)} seed={r.type} icon={r.auto ? Zap : undefined} dot sub={r.auto ? t(`finance.sources.${r.source?.type}`, r.source?.type) : undefined} /></div> },
          { key: 'narration', header: t('finance.voucher.narration'), render: (v, r) => <div className="min-w-0"><p className="text-sm text-ink truncate max-w-md">{v || '—'}</p><p className="text-xs text-ink-faint truncate max-w-md">{r.accounts.join(' · ')}</p></div> },
          { key: 'total', header: t('finance.voucher.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
          { key: 'status', header: t('finance.status'), render: (v) => <JournalStatus status={v} /> },
        ]}
        onRowClick={(r) => setOpen(r.id)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={BookOpen} emptyTitle={t('finance.journals.empty')} />
      {open && <VoucherDrawer id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
      {creating && <VoucherForm onClose={() => setCreating(false)} onSaved={(j) => { setCreating(false); refresh(); setOpen(j.id) }} />}
    </PageContainer>
  )
}
