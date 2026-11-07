import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, BadgeCheck, Ban, Boxes, Building2, CalendarPlus, CreditCard, Gauge, Layers, Percent, Receipt, Shield, Users } from 'lucide-react'
import { CATEGORY_BY_ID, formatINR } from '@schoolgiant/shared'
import {
  DataTable, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, StatCardRow, StatusPill, Tabs, Textarea, VerifiedBadge, useConfirm,
} from '../../components/system'
import { canPlatform } from '../../api/auth'
import Button from '../../components/ui/Button'
import { DefinitionGrid, Switch, UsageMeter } from '../../components/app/Controls'
import { changeTenantPlan, fetchSaPlans, fetchTenant, recordInvoicePayment, sendPaymentLink, updateTenant, voidInvoice } from '../../api/superadmin'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { TENANT_STATUS, tenantStatusLabel } from './Dashboard'
import { bannerText } from '../../utils/subscriptionBanner'

const INV_TONE = { DUE: 'warning', PAID: 'success', VOID: 'neutral' }
const KINDS = ['NEW', 'RENEWAL', 'PLAN_CHANGE']
const METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'CASH', 'OTHER']
const SOURCES = ['SIGNUP', 'SUPERADMIN', 'SEED']
const EVENTS = ['TRIAL_STARTED', 'TRIAL_EXTENDED', 'PLAN_CHANGED', 'STATUS_CHANGED', 'INVOICE_ISSUED', 'INVOICE_VOIDED', 'PAYMENT_RECORDED', 'LIMITS_CHANGED', 'VERIFIED', 'VERIFICATION_REMOVED']
const limitLabel = (t, l) => t(`superadmin.limits.${l.key}`, { defaultValue: l.label })

function PlanModal({ tenant, plans, onClose, onDone }) {
  const { t } = useTranslation('superadmin')
  const [planCode, setPlanCode] = useState(tenant.planCode)
  const [cycle, setCycle] = useState(tenant.billingCycle)
  const [invoice, setInvoice] = useState(tenant.subscription.status !== 'TRIAL')
  const { showError } = useSnackbar()
  const run = useMutation({ mutationFn: () => changeTenantPlan(tenant.id, { planCode, cycle, invoice }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('superadmin.tenantDetail.changePlan')} footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={run.isPending} disabled={planCode === tenant.planCode && cycle === tenant.billingCycle} onClick={() => run.mutate()}>{t('superadmin.tenantDetail.changePlan')}</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('superadmin.common.plan')}><Select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>{plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{t('superadmin.tenantDetail.planOption', { name: p.name, price: formatINR(p.priceMonthly) })}</option>)}</Select></FormField>
        <FormField label={t('superadmin.common.billing')}><Select value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="MONTHLY">{t('superadmin.cycle.MONTHLY')}</option><option value="YEARLY">{t('superadmin.cycle.YEARLY')}</option></Select></FormField>
      </div>
      <label className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <span><span className="block text-sm font-medium text-ink">{t('superadmin.tenantDetail.raiseInvoice')}</span><span className="block text-xs text-ink-muted">{t('superadmin.tenantDetail.raiseInvoiceHint')}</span></span>
        <Switch checked={invoice} onChange={setInvoice} label={t('superadmin.tenantDetail.raiseInvoiceShort')} />
      </label>
      <p className="mt-3 text-xs text-ink-muted">{t('superadmin.tenantDetail.changePlanNote')}</p>
    </Modal>
  )
}

function PayModal({ invoice, onClose, onDone, tenantId }) {
  const { t } = useTranslation('superadmin')
  const [method, setMethod] = useState('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const { showError } = useSnackbar()
  const pay = useMutation({ mutationFn: () => recordInvoicePayment(tenantId, invoice.id, { method, reference }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="sm" title={t('superadmin.tenantDetail.recordPaymentTitle', { number: invoice.number })} footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={pay.isPending} onClick={() => pay.mutate()}>{t('superadmin.tenantDetail.markPaid', { amount: formatINR(invoice.total) })}</Button></>}>
      <div className="space-y-4">
        <FormField label={t('superadmin.tenantDetail.method')}><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((k) => <option key={k} value={k}>{t(`superadmin.tenantDetail.methods.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('superadmin.tenantDetail.reference')} hint={t('superadmin.tenantDetail.referenceHint')}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></FormField>
        <p className="text-xs text-ink-muted">{t('superadmin.tenantDetail.payNote')}</p>
      </div>
    </Modal>
  )
}

function LimitsModal({ tenant, onClose, onDone }) {
  const { t } = useTranslation('superadmin')
  const planLimits = tenant.subscription.limits
  const [form, setForm] = useState(() => Object.fromEntries(tenant.subscription.limitDefs.map((l) => [l.key, tenant.limitsOverride?.[l.key] ?? ''])))
  const { showError } = useSnackbar()
  const save = useMutation({
    mutationFn: () => updateTenant(tenant.id, { limitsOverride: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : Number(v)])) }),
    onSuccess: onDone, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('superadmin.tenantDetail.limitOverrides')} footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t('superadmin.tenantDetail.saveLimits')}</Button></>}>
      <p className="text-sm text-ink-muted mb-4">{t('superadmin.tenantDetail.limitsIntro')}</p>
      <div className="grid grid-cols-2 gap-4">
        {tenant.subscription.limitDefs.map((l) => (
          <FormField key={l.key} label={limitLabel(t, l)} hint={t('superadmin.tenantDetail.effectiveLimit', { limit: `${planLimits[l.key]}${l.unit ? ` ${l.unit}` : ''}` })}>
            <Input type="number" min="0" placeholder={t('superadmin.tenantDetail.planLimit')} value={form[l.key]} onChange={(e) => setForm((f) => ({ ...f, [l.key]: e.target.value }))} />
          </FormField>
        ))}
      </div>
    </Modal>
  )
}

/** A deal for this institution: % off every invoice (after the plan price, before GST), until a date or always. */
function DealModal({ tenant, onClose, onDone }) {
  const { t } = useTranslation('superadmin')
  const [form, setForm] = useState(() => ({ pct: tenant.discount?.pct ?? '', note: tenant.discount?.note ?? '', until: tenant.discount?.until?.slice(0, 10) ?? '' }))
  const { showError } = useSnackbar()
  const save = useMutation({
    mutationFn: (remove) => updateTenant(tenant.id, { discount: remove ? { pct: null } : { pct: Number(form.pct), note: form.note, until: form.until || null } }),
    onSuccess: onDone, onError: (e) => showError(e.message),
  })
  const pct = Number(form.pct)
  return (
    <Modal open onClose={onClose} title={t('superadmin.tenantDetail.deal')} footer={<>
      {tenant.discount?.pct && <Button variant="ghost" className="me-auto" onClick={() => save.mutate(true)}>{t('superadmin.tenantDetail.dealRemove')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!(pct > 0 && pct <= 100)} onClick={() => save.mutate(false)}>{t('superadmin.tenantDetail.dealSave')}</Button>
    </>}>
      <p className="text-sm text-ink-muted mb-4">{t('superadmin.tenantDetail.dealIntro')}</p>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('superadmin.tenantDetail.dealPct')}><Input type="number" min="1" max="100" value={form.pct} onChange={(e) => setForm((f) => ({ ...f, pct: e.target.value }))} /></FormField>
        <FormField label={t('superadmin.tenantDetail.dealUntil')} hint={t('superadmin.tenantDetail.dealUntilHint')}><Input type="date" value={form.until} onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))} /></FormField>
        <div className="col-span-2"><FormField label={t('superadmin.tenantDetail.dealNote')}><Input value={form.note} maxLength={80} placeholder={t('superadmin.tenantDetail.dealNotePlaceholder')} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField></div>
      </div>
    </Modal>
  )
}

export default function TenantDetail() {
  const { t } = useTranslation('superadmin')
  const cl = useCatalogLabel()
  const { id } = useParams()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { date, dateTime } = useFormat()
  const { data: tn, isLoading } = useQuery({ queryKey: ['sa-tenant', id], queryFn: () => fetchTenant(id) })
  const { data: plans = [] } = useQuery({ queryKey: ['sa-plans'], queryFn: fetchSaPlans })
  const [tab, setTab] = useState('overview')
  const [modal, setModal] = useState(null)
  const [notes, setNotes] = useState('')
  useEffect(() => { if (tn) setNotes(tn.notes ?? '') }, [tn])

  const refresh = () => { qc.invalidateQueries({ queryKey: ['sa-tenant', id] }); qc.invalidateQueries({ queryKey: ['sa-tenants'] }); qc.invalidateQueries({ queryKey: ['sa-dashboard'] }) }
  const patch = useMutation({ mutationFn: (body) => updateTenant(id, body), onSuccess: () => { refresh(); showSuccess(t('common.saved')) }, onError: (e) => showError(e.message) })
  // a Razorpay link for an unpaid invoice: emailed to the owner, and copied here to send another way
  const link = useMutation({
    mutationFn: (inv) => sendPaymentLink(id, inv.id),
    onSuccess: async (r) => {
      refresh()
      try { await navigator.clipboard.writeText(r.url) } catch { /* no clipboard access */ }
      showSuccess(r.emailedTo ? t('superadmin.tenantDetail.linkSent', { email: r.emailedTo }) : t('superadmin.tenantDetail.linkCreated'))
    },
    onError: (e) => showError(e.message),
  })
  const voidInv = useMutation({ mutationFn: (inv) => voidInvoice(id, inv.id, t('superadmin.tenantDetail.voidReason')), onSuccess: () => { refresh(); showSuccess(t('superadmin.tenantDetail.invoiceVoided')) }, onError: (e) => showError(e.message) })

  if (isLoading || !tn) return <PageContainer><div className="h-96 rounded-xl bg-black/5 animate-pulse" /></PageContainer>
  const sub = tn.subscription
  const st = TENANT_STATUS[sub.status] ?? {}
  const trial = ['TRIAL', 'TRIAL_EXPIRED'].includes(sub.status)
  const modulesOn = tn.modules.filter((m) => m.enabled)

  const extendTrial = (days) => patch.mutate({ trialEndsAt: new Date(Math.max(Date.now(), +new Date(tn.trialEndsAt)) + days * 864e5).toISOString(), ...(tn.status !== 'TRIAL' && trial ? { status: 'TRIAL' } : {}) })
  const setStatus = async (status) => {
    const ok = await confirm({ title: t('superadmin.tenantDetail.markAs', { name: tn.name, status: tenantStatusLabel(t, status) }), message: status === 'SUSPENDED' ? t('superadmin.tenantDetail.suspendMsg') : status === 'CANCELLED' ? t('superadmin.tenantDetail.cancelMsg') : t('superadmin.tenantDetail.restoreMsg'), tone: ['SUSPENDED', 'CANCELLED'].includes(status) ? 'danger' : 'default', confirmLabel: t('superadmin.tenantDetail.changeStatus') })
    if (ok) patch.mutate({ status })
  }
  // the platform checked the institution's legal details; the institution sees the badge on its profile
  const verified = !!tn.verification?.at
  const setVerified = async (on) => {
    const ok = await confirm({ title: t(on ? 'superadmin.verification.markTitle' : 'superadmin.verification.removeTitle', { name: tn.name }), message: t(on ? 'superadmin.verification.markMsg' : 'superadmin.verification.removeMsg'), tone: on ? 'default' : 'danger', confirmLabel: t(on ? 'superadmin.verification.mark' : 'superadmin.verification.remove') })
    if (ok) patch.mutate({ verified: on })
  }

  return (
    <PageContainer>
      <PageHeader icon={Building2} title={tn.name} subtitle={[tn.profile?.city, tn.slug, t('superadmin.tenantDetail.joinedOn', { date: date(tn.createdAt) })].filter(Boolean).join(' · ')}
        actions={<>
          <Button to="/superadmin/tenants" variant="secondary" icon={ArrowLeft} className="rtl:[&_svg]:rotate-180">{t('superadmin.tenants.title')}</Button>
          {verified && <VerifiedBadge label={t('superadmin.verification.verified')} title={t('superadmin.verification.verifiedOn', { date: date(tn.verification.at), by: tn.verification.by ?? '—' })} />}
          {canPlatform('tenants.edit') && <Button variant="secondary" icon={BadgeCheck} onClick={() => setVerified(!verified)}>{t(verified ? 'superadmin.verification.remove' : 'superadmin.verification.mark')}</Button>}
          {canPlatform('billing') && <Button icon={Layers} onClick={() => setModal('plan')}>{t('superadmin.tenantDetail.changePlan')}</Button>}
        </>} />

      <StatCardRow items={[
        { icon: CreditCard, label: t('superadmin.common.plan'), value: plans.find((p) => p.code === tn.planCode)?.name ?? tn.planCode, sub: `${tn.billingCycle === 'YEARLY' ? t('superadmin.cycle.YEARLY') : t('superadmin.cycle.MONTHLY')} · ${tenantStatusLabel(t, sub.status)}`, tone: st.tone === 'danger' ? 'danger' : 'brand' },
        { icon: Users, label: t('superadmin.common.users'), value: sub.usage.users, sub: t('superadmin.tenantDetail.ofLimit', { limit: sub.limits.users }), tone: sub.usage.users >= sub.limits.users ? 'danger' : 'info' },
        { icon: Shield, label: t('superadmin.tenantDetail.roles'), value: tn.roles.length, sub: tn.roles.length === 1 ? t('superadmin.tenantDetail.onlyAdmin') : t('superadmin.tenantDetail.designedByInstitution'), tone: 'neutral' },
        { icon: Boxes, label: t('superadmin.tenantDetail.modulesOn'), value: modulesOn.length, sub: t('superadmin.tenantDetail.ofLimit', { limit: tn.modules.length }), tone: 'success' },
      ]} />

      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[
          { value: 'overview', label: t('superadmin.tenantDetail.tabs.overview') }, { value: 'invoices', label: t('superadmin.tenantDetail.tabs.invoices', { count: tn.invoices.length }) },
          { value: 'users', label: t('superadmin.tenantDetail.tabs.users', { count: tn.users.length }) }, { value: 'modules', label: t('superadmin.common.modules') }, { value: 'activity', label: t('superadmin.tenantDetail.tabs.activity') },
        ]} />
        <div className="p-5">
          {tab === 'overview' && (
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <section>
                  <div className="flex items-center justify-between mb-3"><h3 className="font-display font-semibold text-ink">{t('superadmin.tenantDetail.subscription')}</h3><StatusPill tone={st.tone}>{tenantStatusLabel(t, sub.status)}</StatusPill></div>
                  <DefinitionGrid cols={3} items={[
                    trial ? { label: t('superadmin.tenantDetail.trialEnds'), value: date(sub.trialEndsAt) } : { label: t('superadmin.tenantDetail.currentPeriod'), value: sub.currentPeriodStart ? `${date(sub.currentPeriodStart)} – ${date(sub.currentPeriodEnd)}` : '—' },
                    { label: t('superadmin.tenantDetail.graceDays'), value: sub.graceDays },
                    { label: t('superadmin.tenantDetail.openInvoice'), value: sub.openInvoice ? `${sub.openInvoice.number} · ${formatINR(sub.openInvoice.total)}` : t('superadmin.tenantDetail.none') },
                    { label: t('superadmin.tenantDetail.storedStatus'), value: tn.status },
                    { label: t('superadmin.common.source'), value: SOURCES.includes(tn.createdVia) ? t(`superadmin.tenantDetail.source.${tn.createdVia}`) : undefined },
                    { label: t('superadmin.tenantDetail.limitOverrides'), value: tn.limitsOverride ? Object.entries(tn.limitsOverride).map(([k, v]) => `${t(`superadmin.limits.${k}`, { defaultValue: k })}: ${v}`).join(', ') : t('superadmin.tenantDetail.none') },
                    { label: t('superadmin.tenantDetail.deal'), value: tn.discount?.pct ? `${tn.discount.pct}%${tn.discount.note ? ` · ${tn.discount.note}` : ''}${tn.discount.until ? ` · ${t('superadmin.tenantDetail.dealUntilDate', { date: date(tn.discount.until) })}` : ''}` : t('superadmin.tenantDetail.none') },
                  ]} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canPlatform('tenants.edit') && trial && <><Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => extendTrial(7)}>{t('superadmin.tenantDetail.extendTrial7')}</Button><Button size="sm" variant="secondary" onClick={() => extendTrial(14)}>{t('superadmin.tenantDetail.plus14')}</Button></>}
                    {canPlatform('tenants.edit') && <Button size="sm" variant="secondary" icon={Gauge} onClick={() => setModal('limits')}>{t('superadmin.tenantDetail.limitOverrides')}</Button>}
                    {canPlatform('billing') && <Button size="sm" variant="secondary" icon={Percent} onClick={() => setModal('deal')}>{t('superadmin.tenantDetail.deal')}</Button>}
                    {canPlatform('tenants.edit') && tn.status !== 'SUSPENDED' && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setStatus('SUSPENDED')}>{t('superadmin.tenantDetail.suspend')}</Button>}
                    {canPlatform('tenants.edit') && tn.status === 'SUSPENDED' && tn.currentPeriodEnd && <Button size="sm" variant="secondary" onClick={() => setStatus('ACTIVE')}>{t('superadmin.tenantDetail.reactivate')}</Button>}
                    {canPlatform('tenants.edit') && tn.status === 'SUSPENDED' && !tn.currentPeriodEnd && <Button size="sm" variant="secondary" onClick={() => setStatus('TRIAL')}>{t('superadmin.tenantDetail.backToTrial')}</Button>}
                  </div>
                </section>
                <section>
                  <h3 className="font-display font-semibold text-ink mb-3">{t('superadmin.common.institution')}</h3>
                  <DefinitionGrid items={[
                    { label: t('superadmin.tenantDetail.legalName'), value: tn.profile?.legalName }, { label: t('superadmin.tenants.email'), value: tn.profile?.email }, { label: t('superadmin.tenantDetail.phone'), value: tn.profile?.phone },
                    { label: t('superadmin.tenantDetail.gstin'), value: tn.profile?.gstin }, { label: t('superadmin.tenantDetail.address'), value: [tn.profile?.addressLine, tn.profile?.city, tn.profile?.state, tn.profile?.pincode].filter(Boolean).join(', '), full: true },
                  ]} />
                </section>
                <section>
                  <FormField label={t('superadmin.tenantDetail.internalNotes')} hint={t('superadmin.tenantDetail.internalNotesHint')}>
                    <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </FormField>
                  <Button size="sm" variant="secondary" className="mt-2" disabled={!canPlatform('tenants.edit') || notes === (tn.notes ?? '')} onClick={() => patch.mutate({ notes })}>{t('superadmin.tenantDetail.saveNotes')}</Button>
                </section>
              </div>
              <div className="space-y-4">
                <h3 className="font-display font-semibold text-ink">{t('superadmin.tenantDetail.usage')}</h3>
                {sub.limitDefs.map((l) => <UsageMeter key={l.key} label={limitLabel(t, l)} used={sub.usage[l.key] ?? 0} limit={sub.limits[l.key]} unit={l.unit} />)}
                {sub.banner && <Note tone={sub.banner.tone === 'info' ? 'info' : 'warning'}>{bannerText(t, sub.banner)}</Note>}
              </div>
            </div>
          )}

          {tab === 'invoices' && (
            <DataTable rows={tn.invoices} dense
              columns={[
                { key: 'number', header: t('superadmin.common.invoice'), nowrap: true, mobilePrimary: true, render: (v) => <span className="font-mono-num">{v}</span> },
                { key: 'kind', header: t('superadmin.common.type'), render: (v, r) => <div><p className="text-sm">{KINDS.includes(v) ? t(`superadmin.tenantDetail.kind.${v}`) : v}</p><p className="text-xs text-ink-faint">{r.planName} · {r.cycle ? t(`superadmin.cycle.${r.cycle}`, { defaultValue: r.cycle.toLowerCase() }) : ''}</p></div> },
                { key: 'periodStart', header: t('superadmin.tenantDetail.period'), nowrap: true, render: (v, r) => <span className="text-sm text-ink-muted">{date(v)} – {date(r.periodEnd)}</span> },
                { key: 'total', header: t('ui.common.total'), align: 'right', render: (v) => formatINR(v) },
                { key: 'status', header: t('common.status'), render: (v, r) => (
                  <div>
                    <StatusPill tone={INV_TONE[v]}>{v === 'PAID' ? t('superadmin.common.paidOn', { date: date(r.paidAt) }) : v === 'DUE' ? t('superadmin.common.dueOn', { date: date(r.dueDate) }) : t('superadmin.common.void')}</StatusPill>
                    {/* money that arrived but couldn't be applied (paid twice, void, short) — refund it from Razorpay */}
                    {r.refundFlags?.length > 0 && <p className="text-xs text-amber-600 mt-1" title={r.refundFlags.map((f) => `${f.paymentId} · ${formatINR(f.amount)} · ${f.reason}`).join('\n')}>{t('superadmin.tenantDetail.toRefund', { count: r.refundFlags.length })}</p>}
                  </div>
                ) },
                { key: 'id', header: '', align: 'right', render: (_, r) => r.status === 'DUE' && canPlatform('billing') && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => setModal({ pay: r })}>{t('superadmin.tenantDetail.recordPayment')}</Button>
                    <Button size="sm" variant="secondary" loading={link.isPending && link.variables?.id === r.id} onClick={() => link.mutate(r)}>{t('superadmin.tenantDetail.paymentLink')}</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: t('superadmin.tenantDetail.voidTitle', { number: r.number }), message: t('superadmin.tenantDetail.voidMsg'), tone: 'danger', confirmLabel: t('superadmin.tenantDetail.voidInvoice') })) voidInv.mutate(r) }}>{t('superadmin.tenantDetail.void')}</Button>
                  </div>
                ) },
              ]}
              emptyIcon={Receipt} emptyTitle={t('superadmin.tenantDetail.noInvoices')} emptyHint={t('superadmin.tenantDetail.noInvoicesHint')} />
          )}

          {tab === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">{tn.roles.map((r) => <span key={r.id} className={clsx('text-xs px-2 py-1 rounded-md', r.fullAccess ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-700')}>{r.name}</span>)}</div>
              <DataTable rows={tn.users} dense columns={[
                { key: 'name', header: t('common.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}{r.emailVerifiedAt && <VerifiedBadge size="xs" className="ms-1" title={t('superadmin.verification.userVerified')} />}</p><p className="text-xs text-ink-faint">{r.email}</p></div> },
                { key: 'roles', header: t('superadmin.tenantDetail.roles'), render: (v) => v.join(', ') },
                { key: 'lastLoginAt', header: t('superadmin.tenantDetail.lastSignIn'), nowrap: true, render: (v) => (v ? dateTime(v) : <span className="text-ink-faint">{t('superadmin.tenantDetail.never')}</span>) },
                { key: 'active', header: t('common.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('superadmin.common.active') : t('superadmin.common.inactive')}</StatusPill> },
              ]} />
            </div>
          )}

          {tab === 'modules' && (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {tn.modules.map((m) => {
                const Icon = iconFor(m.icon)
                return (
                  <div key={m.id} className={clsx('flex items-center gap-2.5 rounded-lg border px-3 py-2', m.enabled ? 'border-border' : 'border-dashed border-border opacity-60')}>
                    <Icon className="w-4 h-4" style={{ color: CATEGORY_BY_ID[m.category]?.color }} />
                    <span className="flex-1 text-sm text-ink">{cl.module(m.id)}</span>
                    <StatusPill tone={m.enabled ? 'success' : m.inPlan ? 'neutral' : 'warning'}>{m.enabled ? t('ui.common.on') : m.inPlan ? t('ui.common.off') : t('superadmin.tenantDetail.notInPlan')}</StatusPill>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'activity' && (
            <ol className="relative border-s border-border ms-1 space-y-4 max-w-2xl">
              {tn.events.map((e) => (
                <li key={e.id} className="ms-4">
                  <span className="absolute -start-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-brand-400 border-2 border-surface" />
                  <p className="text-sm text-ink">{EVENTS.includes(e.type) ? t(`superadmin.tenantDetail.events.${e.type}`) : e.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}{e.to && <span className="text-ink-muted"> · {e.from ? `${e.from} → ` : ''}{e.to}</span>}</p>
                  {e.note && <p className="text-xs text-ink-muted">{e.note}</p>}
                  <p className="text-[11px] text-ink-faint">{dateTime(e.at)} · {e.by}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {modal === 'plan' && <PlanModal tenant={tn} plans={plans} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); showSuccess(t('superadmin.tenantDetail.planChanged')) }} />}
      {modal === 'deal' && <DealModal tenant={tn} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); showSuccess(t('superadmin.tenantDetail.dealSaved')) }} />}
      {modal === 'limits' && <LimitsModal tenant={tn} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); showSuccess(t('superadmin.tenantDetail.limitsSaved')) }} />}
      {modal?.pay && <PayModal tenantId={id} invoice={modal.pay} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); showSuccess(t('superadmin.tenantDetail.paymentRecorded')) }} />}
    </PageContainer>
  )
}
