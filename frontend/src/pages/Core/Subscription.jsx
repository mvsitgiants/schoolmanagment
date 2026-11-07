import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, CreditCard, Download, FileText, Minus, Printer, Receipt, Sparkles, Tag } from 'lucide-react'
import { CATEGORIES, MODULES, MODULE_BY_ID, formatINR } from '@schoolgiant/shared'
import {
  DataTable, Drawer, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SegmentedControl, StatusPill,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { DefinitionGrid, UsageMeter } from '../../components/app/Controls'
import { changePlan, confirmInvoicePayment, downloadInvoicePdf, fetchInvoice, fetchInvoiceDocument, fetchPlans, fetchSubscription, previewPlan, startInvoicePayment, subscribe } from '../../api/core'
import { loadCheckout } from '../../utils/razorpayCheckout'
import { getCurrentUser, hasPermission, syncCurrentUser } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { bannerText } from '../../utils/subscriptionBanner'

// labels: admin.subscription.status.* · kinds.* · events.*
const STATUS_TONE = { TRIAL: 'info', ACTIVE: 'success', PAST_DUE: 'warning', TRIAL_EXPIRED: 'danger', SUSPENDED: 'danger', CANCELLED: 'danger' }
const INV_TONE = { DUE: 'warning', PAID: 'success', VOID: 'neutral' }
const KINDS = ['NEW', 'RENEWAL', 'PLAN_CHANGE']
const EVENTS = ['TRIAL_STARTED', 'PLAN_CHANGED', 'INVOICE_ISSUED', 'PAYMENT_RECORDED', 'STATUS_CHANGED', 'TRIAL_EXTENDED', 'LIMITS_CHANGED', 'INVOICE_VOIDED']
const cycleWord = (t, cycle) => (cycle === 'YEARLY' ? t('admin.subscription.cycleYearly') : t('admin.subscription.cycleMonthly'))
const limitLabel = (t, l) => t(`admin.subscription.limits.${l.key}`, { defaultValue: l.label })

const priceFor = (p, cycle) => (cycle === 'YEARLY' ? p.priceYearly : p.priceMonthly)

/** List price, discount, GST (CGST + SGST, or IGST across states) and the total, as on the invoice. */
function PriceLines({ t, label, p, totalLabel }) {
  const line = (a, b, cls) => <div className={clsx('flex justify-between px-3 py-2', cls)}><span className={cls ? '' : 'text-ink-muted'}>{a}</span><span className="tabular-nums">{b}</span></div>
  const half = (p.gstPct ?? 18) / 2
  return (
    <div className="rounded-lg border border-border divide-y divide-border text-sm">
      {line(label, formatINR(p.listAmount ?? p.amount))}
      {p.discount > 0 && line(<>{t('admin.subscription.discount')}{p.discountNote && <span className="text-ink-faint"> · {p.discountNote}</span>}</>, `− ${formatINR(p.discount)}`)}
      {p.igst > 0 ? line(t('admin.subscription.igst', { pct: p.gstPct ?? 18 }), formatINR(p.igst))
        : p.cgst > 0 || p.sgst > 0 ? <>{line(t('admin.subscription.cgst', { pct: half }), formatINR(p.cgst))}{line(t('admin.subscription.sgst', { pct: half }), formatINR(p.sgst))}</>
          : line(t('admin.subscription.gstPct', { pct: p.gstPct ?? 18 }), formatINR(p.gst))}
      {line(totalLabel, formatINR(p.total), 'font-semibold')}
    </div>
  )
}

function PlanChangeModal({ plan, cycle, mode, onClose, onDone }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const { showError } = useSnackbar()
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState('') // applied once the preview accepts it
  const [couponError, setCouponError] = useState(null)
  const { data: pv, isLoading, error: previewError } = useQuery({ queryKey: ['plan-preview', plan.code, cycle, coupon], queryFn: () => previewPlan(plan.code, cycle, coupon || undefined), retry: false })
  // a coupon the server refuses: say why and price without it
  useEffect(() => { if (previewError && coupon) { setCouponError(previewError.message); setCoupon('') } }, [previewError, coupon])
  const run = useMutation({
    mutationFn: () => (mode === 'subscribe' ? subscribe(plan.code, cycle, coupon || undefined) : changePlan(plan.code, cycle, coupon || undefined)),
    onSuccess: onDone,
    onError: (e) => showError(e.message),
  })
  const blocked = pv?.problems?.length > 0
  const needsInvoice = mode === 'subscribe' || pv?.invoiceNeeded
  return (
    <Modal open onClose={onClose} size="md" title={mode === 'subscribe' ? t('admin.subscription.subscribeTo', { plan: plan.name }) : t('admin.subscription.switchTo', { plan: plan.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={run.isPending} disabled={isLoading || blocked} onClick={() => run.mutate()}>{mode === 'subscribe' ? t('admin.subscription.subscribeAndInvoice') : t('admin.subscription.confirmChange')}</Button>
    </>}>
      {isLoading || !pv ? <div className="h-40 rounded-lg bg-black/5 animate-pulse" /> : (
        <div className="space-y-4">
          {blocked && (
            <Note tone="danger" icon={AlertTriangle}>
              {t('admin.subscription.tooSmall', { plan: plan.name, problems: pv.problems.map((p) => t('admin.subscription.problem', { used: p.used, what: limitLabel(t, p).toLowerCase(), limit: p.limit })).join(', ') })}
            </Note>
          )}
          {pv.modulesAdded.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-success-600 flex items-center gap-1"><ArrowUpRight className="w-3.5 h-3.5" /> {t('admin.subscription.modulesAdded', { count: pv.modulesAdded.length })}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">{pv.modulesAdded.map((m) => <span key={m} className="text-xs px-2 py-0.5 rounded bg-success-50 text-success-600">{MODULE_BY_ID[m] ? cl.module(m) : m}</span>)}</div>
            </div>
          )}
          {pv.modulesRemoved.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-danger-600 flex items-center gap-1"><ArrowDownRight className="w-3.5 h-3.5" /> {t('admin.subscription.modulesRemoved', { count: pv.modulesRemoved.length })}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">{pv.modulesRemoved.map((m) => <span key={m} className="text-xs px-2 py-0.5 rounded bg-danger-50 text-danger-600">{MODULE_BY_ID[m] ? cl.module(m) : m}</span>)}</div>
              <p className="text-xs text-ink-muted mt-1.5">{t('admin.subscription.removedNote')}</p>
            </div>
          )}
          <PriceLines t={t} label={`${plan.name} · ${cycleWord(t, cycle)}`} p={pv} totalLabel={cycle === 'YEARLY' ? t('admin.subscription.totalPerYear') : t('admin.subscription.totalPerMonth')} />
          {needsInvoice && (
            <FormField label={t('admin.subscription.coupon')} error={couponError} hint={coupon ? t('admin.subscription.couponApplied', { code: coupon }) : null}>
              <div className="flex gap-2">
                <Input value={couponInput} onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null) }} placeholder={t('admin.subscription.couponPlaceholder')} className="flex-1" />
                {coupon
                  ? <Button variant="ghost" onClick={() => { setCoupon(''); setCouponInput('') }}>{t('admin.subscription.couponRemove')}</Button>
                  : <Button variant="secondary" icon={Tag} disabled={!couponInput.trim()} onClick={() => { setCouponError(null); setCoupon(couponInput.trim()) }}>{t('admin.subscription.couponApply')}</Button>}
              </div>
            </FormField>
          )}
          <p className="text-xs text-ink-muted">
            {needsInvoice
              ? t('admin.subscription.invoiceNote')
              : t('admin.subscription.trialSwitchNote')}
          </p>
        </div>
      )}
    </Modal>
  )
}

/** Print the server-made tax invoice (the same page as the PDF and the emailed copy). */
async function printInvoice(id, onError) {
  const w = window.open('', '_blank', 'width=820,height=900') // opened before the wait, or the browser blocks it
  if (!w) return
  try {
    const { html } = await fetchInvoiceDocument(id)
    w.document.write(html.replace('</body>', '<script>window.onload=()=>window.print()</script></body>'))
    w.document.close()
  } catch (e) {
    w.close()
    onError(e.message)
  }
}

/** Pay an invoice in Razorpay's window; the server checks the signed result and activates the period. */
function usePayInvoice(onPaid) {
  const { t } = useTranslation(['admin', 'common'])
  const { showError, showSuccess } = useSnackbar()
  const [paying, setPaying] = useState(null)
  const pay = async (invoiceId) => {
    setPaying(invoiceId)
    try {
      await loadCheckout(t('admin.subscription.checkoutFailed'))
      const o = await startInvoicePayment(invoiceId)
      await new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: o.name, description: o.description, prefill: o.prefill,
          handler: async (r) => {
            try {
              const res = await confirmInvoicePayment(invoiceId, { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature })
              if (res.status === 'FLAGGED') showError(t('admin.subscription.paymentFlagged'))
              else showSuccess(t('admin.subscription.paymentDone'))
              await onPaid()
            } catch (e) {
              showError(e.message)
            } finally {
              resolve()
            }
          },
          modal: { ondismiss: resolve },
        })
        rz.on('payment.failed', (r) => showError(r?.error?.description || t('admin.subscription.paymentFailed')))
        rz.open()
      })
    } catch (e) {
      showError(e.message)
    } finally {
      setPaying(null)
    }
  }
  return { pay, paying }
}

export default function Subscription() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { date } = useFormat()
  const { data: sub, isLoading } = useQuery({ queryKey: ['subscription'], queryFn: fetchSubscription })
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: fetchPlans })
  const [cycle, setCycle] = useState(null)
  const [change, setChange] = useState(null) // { plan, mode }
  const [invoiceId, setInvoiceId] = useState(null)
  const { data: invoice } = useQuery({ queryKey: ['invoice', invoiceId], queryFn: () => fetchInvoice(invoiceId), enabled: !!invoiceId })
  const canManage = hasPermission('core.subscription.manage')
  const { pay, paying } = usePayInvoice(async () => { await syncCurrentUser(); qc.invalidateQueries() })
  const canPay = (inv) => inv?.status !== 'PAID' && inv?.status !== 'VOID' && canManage && sub?.onlinePayment
  const cyc = cycle ?? sub?.billingCycle ?? 'MONTHLY'
  const trial = sub && ['TRIAL', 'TRIAL_EXPIRED'].includes(sub.status)

  const matrix = useMemo(() => CATEGORIES.map((c) => ({ ...c, modules: MODULES.filter((m) => m.category === c.id && !m.mandatory) })).filter((c) => c.modules.length), [])

  if (isLoading || !sub) return <PageContainer><div className="h-96 rounded-xl bg-black/5 animate-pulse" /></PageContainer>
  const tone = STATUS_TONE[sub.status] ?? 'neutral'
  const label = t(`admin.subscription.status.${sub.status}`, { defaultValue: sub.status })
  const kindLabel = (k) => (KINDS.includes(k) ? t(`admin.subscription.kinds.${k}`) : k)
  const invStatusLabel = (s) => t(`admin.subscription.invStatus.${s}`, { defaultValue: s })
  const current = plans.find((p) => p.code === sub.plan?.code)

  const done = async () => {
    setChange(null)
    await syncCurrentUser()
    qc.invalidateQueries()
    showSuccess(change?.mode === 'subscribe' ? t('admin.subscription.invoiceRaised') : t('admin.subscription.planChanged'))
  }

  return (
    <PageContainer>
      <PageHeader icon={CreditCard} title={t('admin.subscription.title')} subtitle={t('admin.subscription.subtitle')} actions={<StatusPill tone={tone}>{label}</StatusPill>} />

      {sub.banner && <Note tone={sub.banner.tone === 'info' ? 'info' : sub.banner.tone === 'warning' ? 'warning' : 'danger'} icon={AlertTriangle}>{bannerText(t, sub.banner)}</Note>}

      <div className="grid lg:grid-cols-3 gap-6">
        <Panel title={t('admin.subscription.currentPlan')} className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="font-display text-2xl font-semibold text-ink">{sub.plan?.name}</p>
              <p className="text-sm text-ink-muted mt-1">{t(sub.billingCycle === 'YEARLY' ? 'admin.subscription.pricePerYear' : 'admin.subscription.pricePerMonth', { price: formatINR(priceFor(sub.plan, sub.billingCycle)) })} · {t('admin.subscription.moduleCount', { count: sub.plan?.modules.length ?? 0 })}</p>
            </div>
            {trial && canManage && current && <Button icon={Sparkles} onClick={() => setChange({ plan: current, mode: 'subscribe' })}>{t('admin.subscription.subscribeTo', { plan: current.name })}</Button>}
          </div>
          <div className="mt-5 pt-5 border-t border-border">
            <DefinitionGrid cols={3} items={[
              { label: t('common.status'), value: label },
              trial ? { label: t('admin.subscription.trialEnds'), value: sub.status === 'TRIAL' ? t('admin.subscription.trialEndsDays', { date: date(sub.trialEndsAt), count: sub.daysLeft }) : date(sub.trialEndsAt) } : { label: t('admin.subscription.currentPeriod'), value: sub.currentPeriodStart ? `${date(sub.currentPeriodStart)} – ${date(sub.currentPeriodEnd)}` : '—' },
              { label: t('admin.subscription.billing'), value: sub.billingCycle === 'YEARLY' ? t('admin.subscription.yearly') : t('admin.subscription.monthly') },
              sub.openInvoice ? { label: t('admin.subscription.openInvoice'), value: <button onClick={() => setInvoiceId(sub.openInvoice.id)} className="text-brand-600 hover:underline">{sub.openInvoice.number} · {formatINR(sub.openInvoice.total)}</button> } : { label: t('admin.subscription.openInvoice'), value: t('admin.subscription.none') },
              sub.openInvoice ? { label: t('admin.subscription.dueBy'), value: date(sub.openInvoice.dueDate) } : null,
              { label: t('admin.subscription.customerSince'), value: date(sub.createdAt) },
            ]} />
          </div>
          {sub.openInvoice && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              {canPay(sub.openInvoice) && <Button icon={CreditCard} loading={paying === sub.openInvoice.id} onClick={() => pay(sub.openInvoice.id)}>{t('admin.subscription.payNow', { amount: formatINR(sub.openInvoice.total) })}</Button>}
              <p className="text-xs text-ink-muted">{t(sub.onlinePayment ? 'admin.subscription.payOnlineNote' : 'admin.subscription.payNote')}</p>
            </div>
          )}
        </Panel>
        <Panel title={t('admin.subscription.usage')}>
          <div className="space-y-4">
            {sub.limitDefs.map((l) => <UsageMeter key={l.key} label={limitLabel(t, l)} used={sub.usage[l.key] ?? 0} limit={sub.limits[l.key]} unit={l.unit} />)}
          </div>
          <p className="mt-4 text-xs text-ink-faint">{t('admin.subscription.usageNote')}</p>
        </Panel>
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-display text-lg font-semibold text-ink">{t('admin.subscription.plans')}</h2>
          <SegmentedControl options={[{ value: 'MONTHLY', label: t('admin.subscription.monthly') }, { value: 'YEARLY', label: t('admin.subscription.yearlyFree') }]} value={cyc} onChange={setCycle} />
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((p) => {
            const isCurrent = p.code === sub.plan?.code && cyc === sub.billingCycle
            const perMonth = cyc === 'YEARLY' ? Math.round(p.priceYearly / 12) : p.priceMonthly
            const up = current && p.priceMonthly > current.priceMonthly
            return (
              <article key={p.code} className={clsx('relative rounded-xl border bg-surface p-5 flex flex-col', isCurrent ? 'border-brand-500 ring-2 ring-brand-500/15' : p.highlight ? 'border-brand-200' : 'border-border')}>
                {isCurrent && <span className="absolute -top-2.5 start-4 text-[10px] font-semibold uppercase tracking-wide bg-brand-500 text-white px-2 py-0.5 rounded-full">{t('admin.subscription.currentPlan')}</span>}
                {!isCurrent && p.highlight && <span className="absolute -top-2.5 start-4 text-[10px] font-semibold uppercase tracking-wide bg-ink text-white px-2 py-0.5 rounded-full">{t('admin.subscription.mostPopular')}</span>}
                <h3 className="font-display text-lg font-semibold text-ink">{p.name}</h3>
                <p className="text-xs text-ink-muted mt-0.5 min-h-[32px]">{p.tagline}</p>
                <p className="mt-3"><span className="font-display text-2xl font-semibold text-ink">{formatINR(perMonth)}</span><span className="text-xs text-ink-faint"> {t('admin.subscription.perMonth')}</span></p>
                <p className="text-[11px] text-ink-faint">{cyc === 'YEARLY' ? t('admin.subscription.billedYearly', { price: formatINR(p.priceYearly) }) : t('admin.subscription.billedMonthly')} · {t('admin.subscription.plusGst')}</p>
                <ul className="mt-4 space-y-1.5 text-sm flex-1">
                  <li className="text-ink">{t('admin.subscription.planUsers', { count: p.limits.users })} · {t('admin.subscription.planBranches', { count: p.limits.branches })}{p.limits.students ? <> · {t('admin.subscription.planStudents', { count: p.limits.students })}</> : null}</li>
                  {p.features.map((f) => <li key={f} className="flex gap-2 text-ink-muted"><Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />{f}</li>)}
                </ul>
                {canManage && (
                  <Button className="mt-5 w-full" variant={isCurrent ? 'secondary' : up ? 'primary' : 'secondary'} disabled={isCurrent}
                    onClick={() => setChange({ plan: p, mode: 'change' })}>
                    {isCurrent ? t('admin.subscription.yourPlan') : p.code === sub.plan?.code ? (cyc === 'YEARLY' ? t('admin.subscription.switchToYearly') : t('admin.subscription.switchToMonthly')) : up ? t('admin.subscription.upgradeTo', { plan: p.name }) : t('admin.subscription.switchTo', { plan: p.name })}
                  </Button>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <Panel title={t('admin.subscription.whatEachIncludes')} flush>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="border-b border-border bg-bg/60">
                <th className="text-start px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('admin.subscription.module')}</th>
                {plans.map((p) => <th key={p.code} className={clsx('px-3 py-2.5 text-center text-xs font-semibold', p.code === sub.plan?.code ? 'text-brand-700' : 'text-ink-muted')}>{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.map((c) => [
                <tr key={`cat-${c.id}`}><td colSpan={plans.length + 1} className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{cl.category(c)}</td></tr>,
                ...c.modules.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 hover:bg-bg/40">
                    <td className="px-4 py-1.5 text-ink">{cl.module(m)}</td>
                    {plans.map((p) => (
                      <td key={p.code} className={clsx('text-center py-1.5', p.code === sub.plan?.code && 'bg-brand-50/40')}>
                        {p.modules.includes(m.id) ? <Check className="w-4 h-4 text-success-500 inline" strokeWidth={2.5} /> : <Minus className="w-4 h-4 text-ink-faint/40 inline" />}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <DataTable
            title={t('admin.subscription.invoices')}
            rows={sub.invoices}
            onRowClick={(r) => setInvoiceId(r.id)}
            columns={[
              { key: 'number', header: t('admin.subscription.invoice'), nowrap: true, mobilePrimary: true, render: (v) => <span className="font-mono-num text-ink">{v}</span> },
              { key: 'kind', header: t('admin.subscription.type'), render: (v, r) => <div><p className="text-sm text-ink">{kindLabel(v)}</p><p className="text-xs text-ink-faint">{r.planName} · {cycleWord(t, r.cycle)}</p></div> },
              { key: 'periodStart', header: t('admin.subscription.period'), nowrap: true, mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{date(v)} – {date(r.periodEnd)}</span> },
              { key: 'total', header: t('admin.subscription.total'), align: 'right', render: (v) => formatINR(v) },
              { key: 'status', header: t('common.status'), render: (v, r) => <StatusPill tone={INV_TONE[v]}>{v === 'PAID' ? t('admin.subscription.paidOn', { date: date(r.paidAt) }) : v === 'DUE' ? t('admin.subscription.dueOn', { date: date(r.dueDate) }) : invStatusLabel(v)}</StatusPill> },
            ]}
            emptyIcon={Receipt} emptyTitle={t('admin.subscription.noInvoices')} emptyHint={trial ? t('admin.subscription.noInvoicesTrial') : undefined}
          />
        </div>
        <Panel title={t('admin.subscription.activity')}>
          {sub.events.length === 0 ? <p className="text-sm text-ink-faint">{t('admin.subscription.nothingYet')}</p> : (
            <ol className="relative border-s border-border ms-1 space-y-3.5">
              {sub.events.slice(0, 12).map((e) => (
                <li key={e.id} className="ms-4">
                  <span className="absolute -start-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-brand-400 border-2 border-surface" />
                  <p className="text-sm text-ink">{EVENTS.includes(e.type) ? t(`admin.subscription.events.${e.type}`) : e.type}{e.to && <span className="text-ink-muted"> · {e.from ? `${e.from} → ` : ''}{e.to}</span>}</p>
                  {e.note && <p className="text-xs text-ink-muted">{e.note}</p>}
                  <p className="text-[11px] text-ink-faint">{date(e.at)} · {e.by}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {change && <PlanChangeModal plan={change.plan} cycle={cyc} mode={change.mode} onClose={() => setChange(null)} onDone={done} />}

      <Drawer open={!!invoiceId} onClose={() => setInvoiceId(null)} subtitle={t('admin.subscription.invoice')} title={invoice?.number ?? '…'} footer={invoice && <>
        <Button variant="secondary" icon={Printer} onClick={() => printInvoice(invoice.id, showError)}>{t('admin.subscription.print.button')}</Button>
        {getCurrentUser()?.features?.pdf && <Button variant="secondary" icon={Download} onClick={() => downloadInvoicePdf(invoice).catch(() => showError(t('admin.subscription.pdfFailed')))}>{t('admin.subscription.downloadPdf')}</Button>}
        {canPay(invoice) && <Button icon={CreditCard} loading={paying === invoice.id} onClick={() => pay(invoice.id)}>{t('admin.subscription.payNow', { amount: formatINR(invoice.total) })}</Button>}
      </>}>
        {invoice && (
          <div className="space-y-5">
            <StatusPill tone={INV_TONE[invoice.status]}>{invStatusLabel(invoice.status)}</StatusPill>
            <DefinitionGrid items={[
              { label: t('admin.subscription.billedTo'), value: invoice.billedTo.name, full: true },
              { label: t('admin.subscription.plan'), value: `${invoice.planName} · ${cycleWord(t, invoice.cycle)}` },
              { label: t('admin.subscription.type'), value: kindLabel(invoice.kind) },
              { label: t('admin.subscription.period'), value: `${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`, full: true },
              { label: t('admin.subscription.issued'), value: date(invoice.issuedAt) },
              { label: invoice.paidAt ? t('admin.subscription.invStatus.PAID') : t('admin.subscription.invStatus.DUE'), value: date(invoice.paidAt || invoice.dueDate) },
              invoice.paymentRef && { label: t('admin.subscription.paymentRef'), value: `${invoice.paymentMethod?.replace('_', ' ').toLowerCase()} · ${invoice.paymentRef}`, full: true },
            ]} />
            <PriceLines t={t} label={t('admin.subscription.subscription')} p={invoice} totalLabel={t('admin.subscription.total')} />
            <p className="text-xs text-ink-faint flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {t('admin.subscription.print.sac')}</p>
          </div>
        )}
      </Drawer>
    </PageContainer>
  )
}
