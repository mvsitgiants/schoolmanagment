import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText, Printer, ShieldAlert } from 'lucide-react'
import { DataTable, FormField, Input, Money, PageContainer, PageHeader, StatCardRow, Toolbar, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchPayslips } from '../../api/payroll'
import { PayslipDrawer, RunStatusPill } from '../../components/payroll/PayrollKit'
import { printDocument } from '../../components/print/printDocument'

/** Payroll › Payslips: a month's payslips across runs — open one to correct LOP (before approval) or print it. */
export default function Payslips() {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(0); return localIso(d).slice(0, 7) })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { month, search: q || undefined, page, pageSize: 50 }
  const { data, isLoading, error } = useQuery({ queryKey: ['payroll-payslips', params], queryFn: () => fetchPayslips(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('payroll.payslips.title')} subtitle={t('payroll.payslips.subtitle')} />
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="w-44"><FormField label={t('payroll.month')}><Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1) }} /></FormField></div>
        <StatCardRow items={[{ label: t('payroll.payslips.count'), value: meta?.total ?? 0 }, { label: t('payroll.payslips.withLop'), value: data?.summary?.lop ?? 0 }, { label: t('payroll.payslips.flagged'), value: data?.summary?.flagged ?? 0, tone: data?.summary?.flagged ? 'warning' : 'neutral' }]} />
      </div>
      <DataTable rows={data?.data ?? []} loading={isLoading} error={error}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('payroll.payslips.search')} />}
        columns={[
          { key: 'name', header: t('payroll.staff.person'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.payslipNo}</p></div> },
          { key: 'structureName', header: t('payroll.assign.structure'), mobileHidden: true },
          { key: 'payDays', header: t('payroll.att.payDays'), align: 'right', render: (v, r) => `${v}/${r.baseDays}` },
          { key: 'gross', header: t('payroll.runs.gross'), align: 'right', render: (v) => <Money value={v} paise /> },
          { key: 'net', header: t('payroll.runs.net'), align: 'right', render: (v) => <Money value={v} paise className="font-semibold" /> },
          { key: 'status', header: t('payroll.status'), render: (v, r) => <span className="inline-flex items-center gap-1"><RunStatusPill status={v} />{r.warnings.length > 0 && <ShieldAlert className="h-4 w-4 text-amber-500" />}</span> },
          { key: 'id', header: '', align: 'right', width: 50, render: (id) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('payroll.printSlip')} onClick={(e) => { e.stopPropagation(); printDocument('PAYSLIP', id) }} /> },
        ]}
        onRowClick={(r) => setOpen(r.id)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={FileText} emptyTitle={t('payroll.payslips.empty')} />
      {open && <PayslipDrawer id={open} onClose={() => setOpen(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['payroll-payslips'] })} />}
    </PageContainer>
  )
}
