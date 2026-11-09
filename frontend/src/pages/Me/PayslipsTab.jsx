import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Printer, Wallet } from 'lucide-react'
import { CodeBadge, DataTable, Fraction, Money } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchMyPayslipHtml, fetchMyPayslips } from '../../api/payroll'
import { printHtml } from '../../components/print/printDocument'
import { useFormat } from '../../context/SettingsContext'
import { RunStatusPill, useMonthLabel } from '../../components/payroll/PayrollKit'

/** My workspace › Payslips: the signed-in person's approved and paid payslips, to see and print. */
export default function PayslipsTab() {
  const { t } = useTranslation('payroll')
  const { date } = useFormat()
  const monthLabel = useMonthLabel()
  const { data, isLoading } = useQuery({ queryKey: ['hrms', 'me', 'payslips'], queryFn: fetchMyPayslips })
  return (
    <DataTable rows={data?.payslips ?? []} loading={isLoading} columns={[
      { key: 'month', header: t('payroll.month'), mobilePrimary: true, render: (v, r) => <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200"><Wallet className="w-4 h-4" /></span><div className="min-w-0"><p className="font-medium text-ink">{monthLabel(v)}</p><CodeBadge>{r.payslipNo}</CodeBadge></div></div> },
      { key: 'payDays', header: t('payroll.att.payDays'), align: 'right', render: (v, r) => <Fraction value={v} max={r.baseDays} /> },
      { key: 'gross', header: t('payroll.runs.gross'), align: 'right', render: (v) => <Money value={v} paise /> },
      { key: 'net', header: t('payroll.runs.net'), align: 'right', render: (v) => <Money value={v} paise className="font-semibold" /> },
      { key: 'status', header: t('payroll.status'), render: (v, r) => <span><RunStatusPill status={v} />{r.paid?.date && <span className="block text-[11px] text-ink-faint">{date(r.paid.date)}</span>}</span> },
      { key: 'id', header: '', align: 'right', width: 60, render: (id) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('payroll.printSlip')} onClick={() => printHtml('PAYSLIP', () => fetchMyPayslipHtml(id))} /> },
    ]} emptyIcon={Wallet} emptyTitle={t('payroll.me.empty')} />
  )
}
