import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BadgePercent, HandCoins, Printer, ReceiptText, Wallet } from 'lucide-react'
import { CodeBadge, ColorChip, DataTable, DateCell, Money, PaidBar, SectionCard, StatusPill } from '../../system'
import Button from '../../ui/Button'
import { hasPermission } from '../../../api/auth'
import { printDocument } from '../../print/printDocument'
import { useFormat } from '../../../context/SettingsContext'
import { Quiet, SectionError, broken, list, useLabels } from './kit'

const FLAT = '!rounded-none !border-0 !shadow-none'

/** Student 360 › Fees: billed / paid / due with a bar, what is still open, receipts (printable) and concessions. */
export default function FeesTab({ s, f }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  if (broken(f)) return <SectionCard icon={Wallet} title={t('students.profile.tabs.fees')}><SectionError /></SectionCard>
  const tot = f.totals
  const paidPct = tot.billed ? Math.round((tot.paid / tot.billed) * 100) : 0
  const canCollect = hasPermission('fees.collect.create') && s.status === 'ACTIVE' && tot.due > 0
  const canPrint = hasPermission('fees.invoices.print') || hasPermission('fees.collect.view')
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t('students.profile.fees.billed')} value={<Money value={tot.billed} paise />} />
            <Stat label={t('students.profile.fees.paid')} value={<Money value={tot.paid} paise tone={tot.paid > 0 ? 'success' : undefined} />} />
            <Stat label={t('students.profile.fees.due')} value={<Money value={tot.due} paise tone={tot.due > 0 ? 'warning' : 'success'} />} />
            <Stat label={t('students.profile.fees.overdue')} value={<Money value={tot.overdue} paise tone={tot.overdue > 0 ? 'danger' : undefined} />} />
          </div>
          {canCollect && <Button icon={HandCoins} to={`/fees/collect?student=${s.id}`} className="shrink-0">{t('students.profile.fees.collect')}</Button>}
        </div>
        {tot.billed > 0 && (
          <div className="mt-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/[0.06]">
              <span className="h-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
              {tot.overdue > 0 && <span className="h-full bg-rose-500" style={{ width: `${(tot.overdue / tot.billed) * 100}%` }} />}
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-ink-faint">
              <span>{t('students.profile.fees.paidPct', { pct: paidPct })}</span>
              {f.nextDue && <span className={f.nextDue.overdue ? 'text-danger-600' : undefined}>{t(f.nextDue.overdue ? 'students.profile.fees.overdueSince' : 'students.profile.fees.nextDue', { date: date(f.nextDue.date), what: f.nextDue.installment ?? '' })}</span>}
            </div>
          </div>
        )}
        {tot.lateFeeDue > 0 && <p className="mt-2 text-xs text-amber-700">{t('students.profile.fees.lateFee')} <Money value={tot.lateFeeDue} paise tone="warning" /></p>}
      </section>

      <SectionCard icon={Wallet} title={t('students.profile.fees.open')} count={f.openCount || null} flush>
        {f.invoices.length === 0 ? <Quiet icon={Wallet} title={tot.billed ? t('students.profile.fees.nothingDue') : t('students.profile.fees.noInvoices')} /> : (
          <DataTable className={FLAT} rows={f.invoices} rowTone={(r) => (r.overdue ? 'danger' : undefined)} columns={[
            { key: 'installment', header: t('students.profile.fees.installment'), mobileTitle: true, render: (v, r) => <span className="block leading-tight"><span className="block font-medium text-ink">{v || '—'}</span><span className="block font-mono-num text-[11px] text-ink-faint">{r.invoiceNo}</span></span> },
            { key: 'dueDate', header: t('students.profile.fees.dueDate'), nowrap: true, render: (v, r) => <DateCell value={v} tone={r.overdue ? 'danger' : undefined} /> },
            { key: 'net', header: t('students.profile.fees.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
            { key: 'balance', header: t('students.profile.fees.balance'), align: 'right', mobilePrimary: true, render: (v, r) => <PaidBar total={r.net} balance={v} paise overdue={r.overdue} paidLabel={t('students.profile.fees.paidShort')} /> },
            { key: 'status', header: t('students.profile.fees.status'), render: (v) => <StatusPill tone={L.invoiceTone(v)}>{L.invoice(v)}</StatusPill> },
          ]} />
        )}
      </SectionCard>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SectionCard icon={ReceiptText} title={t('students.profile.fees.receipts')} count={f.receiptCount || null} flush>
          {f.receipts.length === 0 ? <Quiet icon={ReceiptText} title={t('students.profile.fees.noReceipts')} /> : (
            <DataTable className={FLAT} rows={f.receipts} rowTone={(r) => (r.status === 'CANCELLED' ? 'warning' : undefined)} columns={[
              { key: 'receiptNo', header: t('students.profile.fees.receiptNo'), mobileTitle: true, render: (v, r) => <CodeBadge className={clsx(r.status === 'CANCELLED' && 'line-through')}>{v}</CodeBadge> },
              { key: 'date', header: t('students.profile.fees.date'), nowrap: true, render: (v) => <DateCell value={v} /> },
              { key: 'mode', header: t('students.profile.fees.mode'), render: (v, r) => <ColorChip label={L.payMode(v, r.modeLabel)} seed={`mode-${v}`} dot /> },
              { key: 'amount', header: t('students.profile.fees.amount'), align: 'right', mobilePrimary: true, render: (v, r) => <span className="block leading-tight"><Money value={v} paise muted={r.status === 'CANCELLED'} />{r.refunded > 0 && <span className="block text-[11px] text-amber-700">{t('students.profile.fees.refunded')} <Money value={r.refunded} paise tone="warning" /></span>}</span> },
              ...(canPrint ? [{ key: 'print', header: '', align: 'right', render: (_, r) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('students.profile.fees.print')} title={t('students.profile.fees.print')} onClick={() => printDocument('FEE_RECEIPT', r.id)} /> }] : []),
            ]} />
          )}
        </SectionCard>
        <SectionCard icon={BadgePercent} title={t('students.profile.fees.concessions')} count={f.concessions.length || null} flush>
          {list(f.concessions).length === 0 ? <Quiet icon={BadgePercent} title={t('students.profile.fees.noConcessions')} /> : (
            <ul className="divide-y divide-border">
              {f.concessions.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="inline-flex h-9 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg bg-violet-50 px-2 text-sm font-semibold tabular-nums text-violet-700">
                    {c.kind === 'PCT' ? `${c.value}%` : <Money value={c.value} paise compact />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.reason}</span>
                  <StatusPill tone={L.concessionTone(c.status)}>{L.concession(c.status)}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold sm:text-xl">{value}</p>
    </div>
  )
}
