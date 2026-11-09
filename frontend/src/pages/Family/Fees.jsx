import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CreditCard, Receipt } from 'lucide-react'
import { INVOICE_STATUS, formatINR } from '@schoolgiant/shared'
import { Note, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { loadCheckout } from '../../utils/razorpayCheckout'
import { FCard, FEmpty, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyDocUrl, familyFees, familyPayStart, familyPayVerify } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** Pay what is due now through the school's Razorpay: open Checkout, then confirm its signed reply with the school. */
function PayButton({ amount, onPaid }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const pay = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await loadCheckout(t('family.fees.checkoutFailed'))
      const o = await familyPayStart(slug, studentId)
      await new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: o.name, description: o.description, prefill: o.prefill,
          handler: async (r) => {
            try {
              const res = await familyPayVerify(slug, studentId, { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature })
              setMsg(res.status === 'APPLIED' ? { tone: 'success', text: t('family.fees.paid', { receipt: res.receiptNos?.[0] ?? '' }) } : { tone: 'warning', text: t('family.fees.paidReview') })
              onPaid()
            } catch (e) {
              setMsg({ tone: 'danger', text: e.message })
            } finally {
              resolve()
            }
          },
          modal: { ondismiss: resolve },
        })
        rz.on('payment.failed', (r) => setMsg({ tone: 'danger', text: r?.error?.description || t('family.fees.payFailed') }))
        rz.open()
      })
    } catch (e) {
      setMsg({ tone: 'danger', text: e.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <Button className="w-full" size="lg" icon={CreditCard} loading={busy} onClick={pay}>{t('family.fees.payNow', { amount })}</Button>
      <p className="text-xs text-ink-muted text-center">{t('family.fees.payHint')}</p>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
    </div>
  )
}

export default function FamilyFees() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['fees'], () => familyFees(slug, studentId))
  const refresh = () => { qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'fees'] }); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'home'] }) }
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
        {d.totals.billed > 0 && (
          <span className="mt-3 block h-2 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden>
            <span className="block h-full rounded-full bg-success-500" style={{ width: `${Math.min(100, (d.totals.paid / d.totals.billed) * 100)}%` }} />
          </span>
        )}
        <p className="mt-2 text-sm text-ink-muted">{t('family.fees.summary', { billed: money(d.totals.billed), paid: money(d.totals.paid), year: d.year ?? '' })}</p>
        {d.totals.due > 0 && (d.onlinePayment
          ? <PayButton amount={money(d.totals.due)} onPaid={refresh} />
          : <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2 text-sm text-ink-muted">{t('family.fees.payAtSchool')}</p>)}
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
                <div className="shrink-0 text-end">
                  <p className="text-[15px] font-semibold text-ink font-mono-num whitespace-nowrap">{money(i.balance > 0 ? i.balance : i.net)}</p>
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
