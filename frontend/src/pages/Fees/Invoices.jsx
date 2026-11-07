import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText, Printer, Receipt, XCircle } from 'lucide-react'
import { INVOICE_STATUS, PAYMENT_MODES, formatINR } from '@schoolgiant/shared'
import { ControlChip, DataTable, Input, PageContainer, PageHeader, StatusPill, Tabs, Toolbar, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAcademicLookup } from '../../api/academics'
import { cancelReceipt, fetchInvoices, fetchReceipts } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const pagination = (meta, setPage) => meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }
const studentCell = (r) => <div><p className="font-medium text-ink">{r.student?.name ?? '—'}</p><p className="text-xs text-ink-faint">{[r.student?.classShort, r.student?.admissionNo].filter(Boolean).join(' · ')}</p></div>

function InvoiceList() {
  const { t } = useTranslation('fees')
  const navigate = useNavigate()
  const { date } = useFormat()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const sections = useMemo(() => lookup?.sections ?? [], [lookup])
  const params = { search: q || undefined, status: status || undefined, sectionId: sectionId || undefined, overdue: overdue || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['fee-invoices', params], queryFn: () => fetchInvoices(params), placeholderData: keepPreviousData })
  const STATUSES = ['', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED']
  const statusLabel = (s) => (s ? t(`fees.invoiceStatus.${s}`, INVOICE_STATUS[s]?.label) : t('fees.all'))
  const reset = (fn) => (v) => { fn(v); setPage(1) }

  return (
    <DataTable
      rows={data?.data ?? []}
      loading={isLoading}
      error={error}
      onRetry={refetch}
      exportable exportName="fee-invoices"
      rowTone={(r) => (r.overdue ? 'danger' : undefined)}
      toolbar={<Toolbar search={search} onSearch={reset(setSearch)} searchPlaceholder={t('fees.invoices.search')} right={<>
        <ControlChip label={t('fees.invoices.section')} value={sections.find((s) => s.id === sectionId)?.label ?? t('fees.all')} active={!!sectionId}
          options={[t('fees.all'), ...sections.map((s) => s.label)]} onChange={(v) => { setSectionId(sections.find((s) => s.label === v)?.id ?? ''); setPage(1) }} />
        <ControlChip label={t('fees.invoices.status')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />
        <ControlChip label={t('fees.invoices.overdueOnly')} value={overdue ? t('fees.yes') : t('fees.no')} active={overdue} options={[t('fees.no'), t('fees.yes')]} onChange={(v) => { setOverdue(v === t('fees.yes')); setPage(1) }} />
      </>} />}
      columns={[
        { key: 'invoiceNo', header: t('fees.invoices.no'), nowrap: true, render: (v) => <span className="font-mono-num">{v}</span> },
        { key: 'student', header: t('fees.invoices.student'), mobilePrimary: true, render: (_, r) => studentCell(r) },
        { key: 'installment', header: t('fees.invoices.installment') },
        { key: 'dueDate', header: t('fees.invoices.due'), nowrap: true, render: (v) => date(v) },
        { key: 'net', header: t('fees.invoices.amount'), align: 'right', render: (v) => formatINR(v) },
        { key: 'balance', header: t('fees.invoices.balance'), align: 'right', render: (v) => formatINR(v) },
        { key: 'status', header: t('fees.invoices.status'), render: (v) => <StatusPill tone={INVOICE_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
      ]}
      onRowClick={hasPermission('fees.collect.view') ? (r) => navigate(`/fees/collect?student=${r.studentId}`) : undefined}
      pagination={pagination(data?.meta, setPage)}
      emptyIcon={FileText} emptyTitle={q || status || sectionId || overdue ? t('fees.invoices.noMatch') : t('fees.invoices.empty')} emptyHint={t('fees.invoices.emptyHint')}
    />
  )
}

function ReceiptList() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, mode: mode || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['fee-receipts', params], queryFn: () => fetchReceipts(params), placeholderData: keepPreviousData })
  const cancel = useMutation({
    mutationFn: ({ id, reason }) => cancelReceipt(id, reason),
    onSuccess: () => { ['fee-receipts', 'fee-invoices', 'fee-ledger', 'fee-dues', 'fee-day'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); showSuccess(t('fees.receipts.cancelled')) },
    onError: (e) => showError(e.message),
  })
  const modeLabel = (v) => (v ? t(`fees.modes.${v}`, PAYMENT_MODES.find((m) => m.value === v)?.label ?? v) : t('fees.all'))
  const MODES = ['', ...PAYMENT_MODES.map((m) => m.value)]
  const STATUSES = ['', 'VALID', 'CANCELLED']
  const statusLabel = (s) => (s ? t(`fees.receiptStatus.${s}`) : t('fees.all'))
  const canCancel = hasPermission('fees.invoices.cancel')

  return (
    <DataTable
      rows={data?.data ?? []}
      loading={isLoading}
      error={error}
      onRetry={refetch}
      exportable exportName="fee-receipts"
      toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('fees.receipts.search')} right={<>
        <Input type="date" className="w-36" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label={t('fees.receipts.from')} />
        <Input type="date" className="w-36" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label={t('fees.receipts.to')} />
        <ControlChip label={t('fees.receipts.mode')} value={modeLabel(mode)} active={!!mode} options={MODES.map(modeLabel)} onChange={(v) => { setMode(MODES.find((m) => modeLabel(m) === v) ?? ''); setPage(1) }} />
        <ControlChip label={t('fees.receipts.status')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />
      </>} />}
      columns={[
        { key: 'receiptNo', header: t('fees.receipts.no'), nowrap: true, render: (v) => <span className="font-mono-num">{v}</span> },
        { key: 'student', header: t('fees.receipts.student'), mobilePrimary: true, render: (_, r) => studentCell(r) },
        { key: 'date', header: t('fees.receipts.date'), nowrap: true, render: (v, r) => <span title={dateTime(r.at)}>{date(v)}</span> },
        { key: 'mode', header: t('fees.receipts.mode'), render: (v, r) => <span className="text-sm">{modeLabel(v)}{r.reference ? <span className="text-ink-faint"> · {r.reference}</span> : ''}</span> },
        { key: 'collectedBy', header: t('fees.receipts.by'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{v ?? '—'}</span> },
        { key: 'amount', header: t('fees.receipts.amount'), align: 'right', render: (v, r) => <span>{formatINR(v)}{r.refunded ? <span className="block text-xs text-ink-faint">{t('fees.receipts.refundedSub', { amount: formatINR(r.refunded) })}</span> : null}</span> },
        { key: 'status', header: t('fees.receipts.status'), render: (v, r) => <div><StatusPill tone={v === 'VALID' ? 'success' : 'neutral'}>{statusLabel(v)}</StatusPill>{r.cancelReason && <p className="text-xs text-ink-faint mt-0.5 line-clamp-1">{r.cancelReason}</p>}</div> },
        { key: 'id', header: '', align: 'right', width: 100, render: (id, r) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon={Printer} title={t('fees.receipts.print')} aria-label={t('fees.receipts.print')} onClick={() => printDocument('FEE_RECEIPT', id)} />
            {canCancel && r.status === 'VALID' && !r.refunded && <Button size="sm" variant="ghost" icon={XCircle} title={t('fees.receipts.cancel')} aria-label={t('fees.receipts.cancel')}
              onClick={async () => {
                const reason = await prompt({ title: t('fees.receipts.cancelConfirm.title', { no: r.receiptNo }), message: t('fees.receipts.cancelConfirm.message', { amount: formatINR(r.amount) }), label: t('fees.receipts.cancelReason'), required: true })
                if (reason) cancel.mutate({ id, reason })
              }} />}
          </div>
        ) },
      ]}
      pagination={pagination(data?.meta, setPage)}
      emptyIcon={Receipt} emptyTitle={t('fees.receipts.empty')}
    />
  )
}

export default function Invoices() {
  const { t } = useTranslation('fees')
  const [tab, setTab] = useState('invoices')
  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('fees.invoices.title')} subtitle={t('fees.invoices.subtitle')} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'invoices', label: t('fees.invoices.tab') }, { value: 'receipts', label: t('fees.receipts.tab') }]} />
      {tab === 'invoices' ? <InvoiceList /> : <ReceiptList />}
    </PageContainer>
  )
}
