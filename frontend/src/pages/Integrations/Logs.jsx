import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, CreditCard, Cpu, MapPin, MessageCircle, RotateCcw, ScrollText, Smartphone, Webhook } from 'lucide-react'
import { HEALTH_STATUSES, INTEGRATION_LOG_RETENTION_DAYS, LOG_DIRECTIONS, LOG_PROVIDERS, LOG_STATUSES } from '@schoolgiant/shared'
import {
  ControlChip, DataTable, DateCell, DateRangeChip, IconTile, Note, PageContainer, PageHeader, StatusPill, Toolbar, ViewControls, presetRange,
} from '../../components/system'
import { healthLabel } from '../../components/integrations/IntegrationBits'
import LogDrawer, { logProviderLabel, logStatusLabel } from '../../components/integrations/LogDrawer'
import { fetchIntegrationLogs, fetchProviderHealth } from '../../api/integrations'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'

const STATUS = Object.keys(LOG_STATUSES)
const PROVIDER_LOOK = {
  RAZORPAY: { icon: CreditCard, tone: 'brand' }, GPS: { icon: MapPin, tone: 'warning' }, MSG91: { icon: Smartphone, tone: 'info' },
  WHATSAPP: { icon: MessageCircle, tone: 'success' }, DEVICE: { icon: Cpu, tone: 'brand' }, WEBHOOK: { icon: Webhook, tone: 'info' },
}
const dirLabel = (t, v) => t(`integrations.logs.direction.${v}`, { defaultValue: LOG_DIRECTIONS.find((d) => d.value === v)?.label ?? v })

/** One provider today: calls, failures, the last error, and its connection check. Click → filter the log. */
function HealthTile({ p, active, onClick }) {
  const { t } = useTranslation('integrations')
  const { dateTime } = useFormat()
  const look = PROVIDER_LOOK[p.provider] ?? { icon: ScrollText, tone: 'neutral' }
  const status = HEALTH_STATUSES[p.health?.status] ? p.health.status : null
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`text-start rounded-xl border bg-surface shadow-card p-3.5 space-y-2 transition-colors hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${active ? 'border-brand-400 ring-1 ring-brand-300' : 'border-border'}`}>
      <div className="flex items-center gap-2.5">
        <IconTile icon={look.icon} tone={look.tone} size="sm" />
        <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate">{logProviderLabel(t, p.provider)}</span>
        {status && <StatusPill tone={HEALTH_STATUSES[status].tone}>{healthLabel(t, status)}</StatusPill>}
      </div>
      <div className="flex items-baseline gap-4">
        <div><p className="text-xl font-semibold text-ink font-mono-num">{p.calls}</p><p className="text-[11px] text-ink-faint">{t('integrations.logs.callsToday')}</p></div>
        <div><p className={`text-xl font-semibold font-mono-num ${p.failures ? 'text-danger-600' : 'text-ink'}`}>{p.failures}</p><p className="text-[11px] text-ink-faint">{t('integrations.logs.failures')}</p></div>
        {p.avgLatencyMs != null && <div><p className="text-xl font-semibold text-ink font-mono-num">{p.avgLatencyMs}</p><p className="text-[11px] text-ink-faint">{t('integrations.logs.avgMs')}</p></div>}
      </div>
      <p className="text-[11px] text-ink-muted line-clamp-2 min-h-[2rem]">
        {p.lastError ? <><span className="text-danger-600">{t('integrations.logs.lastError')}</span> {dateTime(p.lastError.at)} — {p.lastError.message ?? p.lastError.operation}</> : t('integrations.logs.noErrors')}
      </p>
    </button>
  )
}

/** Integrations › Integration logs: every call to and from a provider, device or webhook, with health per provider. */
export default function Logs() {
  const { t } = useTranslation('integrations')
  const [search, setSearch] = useState('')
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('')
  const [direction, setDirection] = useState('')
  const [range, setRange] = useState(() => presetRange('last7'))
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, provider, status, direction, range.from, range.to])
  const params = { search: q, provider: provider || undefined, status: status || undefined, direction: direction || undefined, from: range.from, to: range.to, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['integrations', 'logs', params], queryFn: () => fetchIntegrationLogs(params), placeholderData: (p) => p, refetchInterval: 30_000 })
  const { data: health } = useQuery({ queryKey: ['integrations', 'logs-health'], queryFn: fetchProviderHealth, refetchInterval: 60_000 })
  const meta = data?.meta
  const all = t('integrations.common.all')

  return (
    <PageContainer>
      <PageHeader icon={ScrollText} title={t('integrations.logs.title')} subtitle={t('integrations.logs.subtitle')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(health?.providers ?? LOG_PROVIDERS.map((p) => ({ provider: p.value, calls: 0, failures: 0 }))).map((p) => (
          <HealthTile key={p.provider} p={p} active={provider === p.provider} onClick={() => setProvider(provider === p.provider ? '' : p.provider)} />
        ))}
      </div>
      <Note>{t('integrations.logs.redactedNote', { days: INTEGRATION_LOG_RETENTION_DAYS })}</Note>
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        onRowClick={(r) => setOpen(r.id)}
        exportable
        exportName="integration-log"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('integrations.logs.search')} right={(
          <ViewControls>
            <ControlChip label={t('integrations.logs.providerCol')} value={provider ? logProviderLabel(t, provider) : all} active={!!provider} options={[all, ...LOG_PROVIDERS.map((p) => logProviderLabel(t, p.value))]} onChange={(v) => setProvider(LOG_PROVIDERS.find((p) => logProviderLabel(t, p.value) === v)?.value ?? '')} />
            <ControlChip label={t('integrations.common.status')} value={status ? logStatusLabel(t, status) : all} active={!!status} options={[all, ...STATUS.map((k) => logStatusLabel(t, k))]} onChange={(v) => setStatus(STATUS.find((k) => logStatusLabel(t, k) === v) ?? '')} />
            <ControlChip label={t('integrations.logs.directionCol')} value={direction ? dirLabel(t, direction) : all} active={!!direction} options={[all, ...LOG_DIRECTIONS.map((d) => dirLabel(t, d.value))]} onChange={(v) => setDirection(LOG_DIRECTIONS.find((d) => dirLabel(t, d.value) === v)?.value ?? '')} />
            <DateRangeChip value={range} onChange={setRange} />
          </ViewControls>
        )} />}
        columns={[
          { key: 'createdAt', header: t('integrations.common.when'), nowrap: true, width: 150, render: (v) => <DateCell value={v} time /> },
          { key: 'direction', header: '', width: 28, render: (v) => (v === 'IN' ? <ArrowDownLeft className="w-4 h-4 text-info-600" aria-label={dirLabel(t, 'IN')} /> : <ArrowUpRight className="w-4 h-4 text-ink-faint" aria-label={dirLabel(t, 'OUT')} />) },
          { key: 'provider', header: t('integrations.logs.providerCol'), nowrap: true, render: (v) => logProviderLabel(t, v) },
          { key: 'operation', header: t('integrations.logs.operation'), mobilePrimary: true, render: (v, r) => <div><p className="text-sm text-ink font-mono">{v}</p>{r.error && <p className="text-[11px] text-danger-600 line-clamp-1">{r.error}</p>}</div> },
          { key: 'ref', header: t('integrations.logs.providerRef'), render: (v) => (v ? <span className="text-xs text-ink-muted font-mono break-all line-clamp-1">{v}</span> : '') },
          { key: 'status', header: t('integrations.common.status'), render: (v, r) => <span className="inline-flex items-center gap-2"><StatusPill tone={LOG_STATUSES[v]?.tone}>{logStatusLabel(t, v)}</StatusPill>{r.httpStatus && <span className="text-[11px] text-ink-faint font-mono-num">{r.httpStatus}</span>}{r.retry && <RotateCcw className="w-3.5 h-3.5 text-ink-faint" aria-label={t('integrations.logs.canRetry')} />}</span> },
          { key: 'latencyMs', header: t('integrations.logs.time'), align: 'right', render: (v) => (v != null ? <span className="font-mono-num text-xs text-ink-muted">{t('integrations.bits.ms', { ms: v })}</span> : '') },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={ScrollText}
        emptyTitle={t('integrations.logs.empty')}
        emptyHint={t('integrations.logs.emptyHint')}
      />
      <LogDrawer id={open} onClose={() => setOpen(null)} />
    </PageContainer>
  )
}
