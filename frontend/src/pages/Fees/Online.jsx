import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, CreditCard, PlugZap, RefreshCw, Undo2, XCircle } from 'lucide-react'
import { GATEWAY_ORDER_STATUSES, formatINR } from '@schoolgiant/shared'
import { ControlChip, DataTable, FormField, Input, Note, PageContainer, PageHeader, Panel, Select, StatCardRow, StatusPill, Toolbar, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { cancelOnlineOrder, fetchOnlineConfig, fetchOnlineOrders, refundOnlineOrder, saveOnlineConfig, syncOnlineOrder, testOnlineConfig } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** The school's Razorpay account: keys, mode, webhook. Secrets are never shown again — blank keeps the saved one. */
function Setup() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: view, isLoading } = useQuery({ queryKey: ['online-config'], queryFn: fetchOnlineConfig })
  const canEdit = hasPermission('fees.online.configure')
  const [form, setForm] = useState(null)
  useEffect(() => { if (view) setForm({ enabled: !!view.config.enabled, mode: view.config.mode ?? 'SANDBOX', keyId: view.config.settings?.keyId ?? '', keySecret: '', webhookSecret: '' }) }, [view])
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => saveOnlineConfig({ enabled: form.enabled, mode: form.mode, settings: { keyId: form.keyId }, secrets: { keySecret: form.keySecret || '', webhookSecret: form.webhookSecret || '' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['online-config'] }); qc.invalidateQueries({ queryKey: ['online-status'] }); setErrors({}); showSuccess(t('fees.online.saved')) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const test = useMutation({ mutationFn: testOnlineConfig, onSuccess: (r) => (r.ok ? showSuccess(r.message) : showError(r.message)), onError: (e) => showError(e.message) })
  if (isLoading || !form) return <Panel><p className="text-sm text-ink-faint">{t('fees.loading')}</p></Panel>
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const secretHint = (k) => (view.config.secrets?.[k]?.set ? t('fees.online.secretSet', { last4: view.config.secrets[k].last4 ?? '••••' }) : t('fees.online.secretNotSet'))
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); showSuccess(t('fees.online.copied')) } catch { showError(text) } }
  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-4 items-start">
      <Panel title={t('fees.online.account')} icon={PlugZap} actions={canEdit && <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>{t('fees.online.test')}</Button>}>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={form.enabled} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
            {t('fees.online.enabled')}
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label={t('fees.online.mode')}>
              <Select value={form.mode} disabled={!canEdit} onChange={set('mode')}>
                <option value="SANDBOX">{t('fees.online.modes.SANDBOX')}</option>
                <option value="LIVE">{t('fees.online.modes.LIVE')}</option>
              </Select>
            </FormField>
            <FormField label={t('fees.online.keyId')} error={errors['settings.keyId']}><Input value={form.keyId} disabled={!canEdit} onChange={set('keyId')} placeholder="rzp_test_…" /></FormField>
            <FormField label={t('fees.online.keySecret')} hint={secretHint('keySecret')} error={errors['secrets.keySecret']}><Input type="password" autoComplete="off" value={form.keySecret} disabled={!canEdit} onChange={set('keySecret')} /></FormField>
            <FormField label={t('fees.online.webhookSecret')} hint={secretHint('webhookSecret')}><Input type="password" autoComplete="off" value={form.webhookSecret} disabled={!canEdit} onChange={set('webhookSecret')} /></FormField>
          </div>
          {canEdit && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('fees.online.save')}</Button>}
          <Note>{t('fees.online.keysHint')}</Note>
        </div>
      </Panel>
      <Panel title={t('fees.online.webhook')}>
        <div className="space-y-3 text-sm">
          <p className="text-ink-muted">{t('fees.online.webhookHint')}</p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
            <span className="font-mono-num text-xs break-all flex-1">{view.webhookUrl}</span>
            <Button size="sm" variant="ghost" icon={Copy} aria-label={t('fees.online.copy')} onClick={() => copy(view.webhookUrl)} />
          </div>
          <p className="text-xs font-medium text-ink-muted">{t('fees.online.events')}</p>
          <div className="flex flex-wrap gap-1.5">{view.webhookEvents.map((e) => <span key={e} className="font-mono-num text-xs rounded bg-bg border border-border px-1.5 py-0.5">{e}</span>)}</div>
          <Note tone="warning">{t('fees.online.receiptHint')}</Note>
        </div>
      </Panel>
    </div>
  )
}

export default function Online() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, status: status || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['online-orders', params], queryFn: () => fetchOnlineOrders(params), placeholderData: keepPreviousData })
  const { data: view } = useQuery({ queryKey: ['online-config'], queryFn: fetchOnlineConfig })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['online-orders'] }); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const STATUSES = ['', ...Object.keys(GATEWAY_ORDER_STATUSES)]
  const statusLabel = (s) => (s ? t(`fees.online.status.${s}`, GATEWAY_ORDER_STATUSES[s]?.label) : t('fees.all'))
  const s30 = view?.last30Days ?? {}
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={CreditCard} title={t('fees.online.title')} subtitle={t('fees.online.subtitle')} />
      <Setup />
      <StatCardRow className="my-4" items={[
        { label: t('fees.online.k.received'), value: formatINR(s30.APPLIED?.amount ?? 0, { decimals: 0 }), sub: t('fees.online.k.count', { count: s30.APPLIED?.count ?? 0 }), tone: 'success' },
        { label: t('fees.online.k.waiting'), value: s30.CREATED?.count ?? 0, tone: 'info' },
        { label: t('fees.online.k.review'), value: s30.NEEDS_REVIEW?.count ?? 0, tone: s30.NEEDS_REVIEW?.count ? 'danger' : 'neutral', onClick: () => setStatus('NEEDS_REVIEW') },
        { label: t('fees.online.k.refunded'), value: s30.REFUNDED?.count ?? 0 },
      ]} />
      <DataTable
        title={t('fees.online.transactions')}
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="online-fee-payments"
        rowTone={(r) => (r.status === 'NEEDS_REVIEW' ? 'danger' : undefined)}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('fees.online.search')}
          right={<ControlChip label={t('fees.online.statusLabel')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />} />}
        columns={[
          { key: 'createdAt', header: t('fees.online.when'), nowrap: true, render: (v) => <span className="text-sm">{dateTime(v)}</span> },
          { key: 'studentName', header: t('fees.online.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.admissionNo}</p></div> },
          { key: 'source', header: t('fees.online.source'), render: (v, r) => <span className="text-sm">{t(`fees.online.sources.${v}`)}{r.method ? <span className="text-ink-faint"> · {r.method}</span> : ''}</span> },
          { key: 'amount', header: t('fees.online.amount'), align: 'right', render: (v) => formatINR(v) },
          { key: 'status', header: t('fees.online.statusLabel'), render: (v, r) => <div><StatusPill tone={GATEWAY_ORDER_STATUSES[v]?.tone}>{statusLabel(v)}</StatusPill>{r.receiptNos?.length > 0 && <p className="text-xs text-ink-faint font-mono-num mt-0.5">{r.receiptNos.join(', ')}</p>}{r.error && <p className="text-xs text-danger-600 mt-0.5 line-clamp-2">{r.error}</p>}</div> },
          { key: 'providerOrderId', header: t('fees.online.reference'), mobileHidden: true, render: (v, r) => <span className="font-mono-num text-xs text-ink-muted">{r.providerPaymentId ?? v}</span> },
          { key: 'id', header: '', align: 'right', width: 120, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={RefreshCw} title={t('fees.online.sync')} aria-label={t('fees.online.sync')} onClick={() => act.mutate({ fn: () => syncOnlineOrder(id), done: t('fees.online.synced') })} />
              {r.kind === 'LINK' && r.status === 'CREATED' && <Button size="sm" variant="ghost" icon={XCircle} title={t('fees.online.cancelLink')} aria-label={t('fees.online.cancelLink')}
                onClick={async () => { if (await confirm({ title: t('fees.online.cancelConfirm'), tone: 'danger', confirmLabel: t('fees.online.cancelLink') })) act.mutate({ fn: () => cancelOnlineOrder(id), done: t('fees.online.cancelled') }) }} />}
              {['APPLIED', 'NEEDS_REVIEW'].includes(r.status) && hasPermission('fees.online.refund') && <Button size="sm" variant="ghost" icon={Undo2} title={t('fees.online.refund')} aria-label={t('fees.online.refund')}
                onClick={async () => { const reason = await prompt({ title: t('fees.online.refundConfirm.title', { amount: formatINR(r.amount) }), message: t('fees.online.refundConfirm.message'), label: t('fees.online.refundReason'), required: true }); if (reason) act.mutate({ fn: () => refundOnlineOrder(id, { reason }), done: t('fees.online.refunded') }) }} />}
            </div>
          ) },
        ]}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={CreditCard} emptyTitle={t('fees.online.empty')}
      />
    </PageContainer>
  )
}
