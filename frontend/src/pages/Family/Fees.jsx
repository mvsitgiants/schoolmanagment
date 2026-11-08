import { useTranslation } from 'react-i18next'
import { Receipt } from 'lucide-react'
import { INVOICE_STATUS, formatINR } from '@schoolgiant/shared'
import { StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyDocUrl, familyFees } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

export default function FamilyFees() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['fees'], () => familyFees(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!d) return null
  const money = (p) => formatINR(p, { decimals: 0 })
  return (
    <>
      <FCard>
        <p className="text-sm text-ink-muted">{t('family.fees.dueNow')}</p>
        <p className={`font-display text-3xl font-semibold ${d.totals.overdue ? 'text-danger-700' : 'text-ink'}`}>{money(d.totals.due)}</p>
        {d.totals.overdue > 0 && <p className="text-sm text-danger-700">{t('family.fees.overdue', { amount: money(d.totals.overdue) })}</p>}
        <p className="mt-2 text-sm text-ink-muted">{t('family.fees.summary', { billed: money(d.totals.billed), paid: money(d.totals.paid), year: d.year ?? '' })}</p>
        {d.totals.due > 0 && !d.onlinePayment && <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2 text-sm text-ink-muted">{t('family.fees.payAtSchool')}</p>}
      </FCard>

      <FCard title={t('family.fees.installments')}>
        {d.invoices.length ? (
          <div className="divide-y divide-border -my-2">
            {d.invoices.map((i) => (
              <div key={i.id} className="py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-ink">{i.installment}</p>
                  <p className={`text-sm ${i.overdue ? 'text-danger-700' : 'text-ink-muted'}`}>{t('family.fees.dueOn', { date: date(i.dueDate) })}{i.concession ? ` · ${t('family.fees.concession', { amount: money(i.concession) })}` : ''}</p>
                </div>
                <div className="text-end">
                  <p className="text-[15px] font-semibold text-ink font-mono-num">{money(i.balance > 0 ? i.balance : i.net)}</p>
                  <StatusPill tone={INVOICE_STATUS[i.status]?.tone}>{t(`family.invoice.${i.status}`, i.statusLabel)}</StatusPill>
                </div>
              </div>
            ))}
          </div>
        ) : <FEmpty icon={Receipt} title={t('family.fees.noInvoices')} />}
      </FCard>

      <FCard title={t('family.fees.receipts')}>
        {d.receipts.length ? (
          <div className="divide-y divide-border -my-2">
            {d.receipts.map((r) => (
              <FRow key={r.id} href={familyDocUrl(slug, 'FEE_RECEIPT', r.id)} icon={Receipt}
                title={`${money(r.amount)} · ${r.modeLabel}`} subtitle={`${r.receiptNo} · ${date(r.date)}`}
                meta={r.refunded ? t('family.fees.refunded', { amount: money(r.refunded) }) : undefined} />
            ))}
          </div>
        ) : <FEmpty icon={Receipt} title={t('family.fees.noReceipts')} />}
      </FCard>
    </>
  )
}
