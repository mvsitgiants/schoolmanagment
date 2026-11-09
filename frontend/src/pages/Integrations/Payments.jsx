import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, CreditCard, IndianRupee, ShieldCheck, Webhook } from 'lucide-react'
import { HEALTH_STATUSES, INTEGRATION_PROVIDER_BY, LOG_STATUSES, formatINR } from '@schoolgiant/shared'
import { CodeBadge, DataTable, DateCell, PageContainer, PageHeader, Panel, StatCardRow, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { CopyField, ProviderConfigPanel, healthLabel, providerDesc, providerLabel } from '../../components/integrations/IntegrationBits'
import LogDrawer, { logStatusLabel } from '../../components/integrations/LogDrawer'
import { fetchPayments, savePayments, testPayments } from '../../api/integrations'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'

const HEALTH_TONE = { OK: 'success', DEGRADED: 'warning', DOWN: 'danger', UNKNOWN: 'sky' }

/** The last webhooks Razorpay sent: event, how it went, its reference. Row → the redacted outline. */
function RecentWebhooks({ rows }) {
  const { t } = useTranslation('integrations')
  const [open, setOpen] = useState(null)
  return (
    <>
      <DataTable
        title={t('integrations.payments.lastWebhooks')}
        rows={rows}
        dense
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          { key: 'createdAt', header: t('integrations.common.when'), nowrap: true, width: 150, render: (v) => <DateCell value={v} time /> },
          { key: 'operation', header: t('integrations.payments.event'), mobilePrimary: true, render: (v, r) => <div><CodeBadge>{String(v).replace(/^webhook:?/, '') || 'webhook'}</CodeBadge>{r.error && <p className="text-[11px] text-danger-600 mt-0.5 line-clamp-1">{r.error}</p>}</div> },
          { key: 'status', header: t('integrations.common.status'), render: (v) => <StatusPill tone={LOG_STATUSES[v]?.tone}>{logStatusLabel(t, v)}</StatusPill> },
          { key: 'ref', header: t('integrations.payments.reference'), render: (v) => (v ? <span className="font-mono-num text-xs text-ink-muted break-all">{v}</span> : '—') },
        ]}
        emptyIcon={Webhook}
        emptyTitle={t('integrations.payments.noWebhooks')}
        emptyHint={t('integrations.payments.noWebhooksHint')}
      />
      <LogDrawer id={open} onClose={() => setOpen(null)} />
    </>
  )
}

/** Integrations › Payment gateway: the school's own Razorpay keys, mode, webhook and health. Orders live in Fees › Online payments. */
export default function Payments() {
  const { t } = useTranslation('integrations')
  const { dateTime } = useFormat()
  const { data, isLoading } = useQuery({ queryKey: ['integrations', 'payments'], queryFn: fetchPayments, refetchInterval: 60_000 })
  const cfg = data?.config
  const health = HEALTH_STATUSES[cfg?.health?.status] ? cfg.health.status : 'UNKNOWN'
  const applied = data?.last30Days?.APPLIED ?? { count: 0, amount: 0 }
  const day = data?.last24h ?? {}
  const hookFails = (day.ERROR ?? 0) + (day.REJECTED ?? 0)

  return (
    <PageContainer>
      <PageHeader icon={CreditCard} title={t('integrations.payments.title')} subtitle={t('integrations.payments.subtitle')}
        actions={hasPermission('fees.online.view') && <Button variant="secondary" iconRight={ArrowRight} to="/fees/online">{t('integrations.payments.toFees')}</Button>} />
      <StatCardRow items={[
        { icon: Activity, label: t('integrations.payments.health'), value: healthLabel(t, health), sub: cfg?.health?.checkedAt ? dateTime(cfg.health.checkedAt) : t('integrations.payments.notChecked'), tone: HEALTH_TONE[health] },
        { icon: ShieldCheck, label: t('integrations.payments.modeTile'), value: cfg ? (cfg.enabled ? t(`integrations.mode.${cfg.mode ?? 'SANDBOX'}`) : t('integrations.common.off')) : '—', sub: cfg?.settings?.keyId ?? t('integrations.payments.noKey'), tone: cfg?.enabled && cfg.mode === 'LIVE' ? 'success' : 'violet' },
        { icon: Webhook, label: t('integrations.payments.webhooks24'), value: (day.OK ?? 0) + (day.DUPLICATE ?? 0) + hookFails, sub: t('integrations.payments.failedCount', { count: hookFails }), tone: hookFails ? 'warning' : 'info' },
        { icon: IndianRupee, label: t('integrations.payments.received30'), value: formatINR(applied.amount ?? 0), sub: t('integrations.payments.paymentsCount', { count: applied.count ?? 0 }), tone: 'teal' },
      ]} />
      {isLoading || !data ? <Panel><div className="h-64 rounded-lg bg-black/5 animate-pulse" /></Panel> : (
        <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <ProviderConfigPanel provider={INTEGRATION_PROVIDER_BY.RAZORPAY} saved={data.config} onSave={savePayments} onTest={testPayments} canConfigure={hasPermission('integrations.payments.configure')}>
              <div className="space-y-2">
                <CopyField label={t('integrations.payments.webhookUrl')} value={data.webhookUrl} hint={t('integrations.payments.webhookHint')} />
                <p className="text-[11px] text-ink-faint">{t('integrations.payments.events')}</p>
                <div className="flex flex-wrap gap-1">{data.webhookEvents.map((e) => <CodeBadge key={e}>{e}</CodeBadge>)}</div>
              </div>
            </ProviderConfigPanel>
            <div className="grid sm:grid-cols-2 gap-3">
              {data.providers.filter((p) => !p.available).map((p) => (
                <div key={p.id} className="rounded-xl border border-dashed border-border p-4 opacity-70">
                  <p className="text-sm font-medium text-ink">{providerLabel(t, p)}</p>
                  <p className="text-xs text-ink-muted mt-0.5">{providerDesc(t, p)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <RecentWebhooks rows={data.webhooks ?? []} />
          </div>
        </div>
      )}
    </PageContainer>
  )
}
