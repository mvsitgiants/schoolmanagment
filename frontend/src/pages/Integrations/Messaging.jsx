import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Check, CheckCheck, FileText, Link2, Mail, MessageCircle, MessageSquareText, PlugZap, Send, Smartphone, TriangleAlert } from 'lucide-react'
import { CHANNEL_LABEL, HEALTH_STATUSES, INTEGRATION_PROVIDER_BY, MESSAGE_STATUSES } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, ControlChip, DataTable, DateCell, Note, PageContainer, PageHeader, Panel, PersonCell, StatCardRow, StatusPill, Tabs, Toolbar, ViewControls,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { CopyField, HealthPill, SecretField, errText, fieldHint, fieldLabel, healthLabel } from '../../components/integrations/IntegrationBits'
import { DeliveryTab } from '../Core/NotificationSetup'
import {
  createMessagingUrls, fetchMessagingIntegration, fetchMessagingTemplates, fetchRecentSends, saveMessagingWebhook, testMessagingProvider,
} from '../../api/integrations'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

const canConfigure = () => hasPermission('integrations.messaging.configure')
const DEF = INTEGRATION_PROVIDER_BY.MESSAGING
const CHANNEL_LOOK = { SMS: { icon: Smartphone, tone: 'sky' }, WHATSAPP: { icon: MessageCircle, tone: 'success' }, EMAIL: { icon: Mail, tone: 'violet' } }
const DELIVERY_TONE = { DELIVERED: 'success', READ: 'success', FAILED: 'danger' }
const HEALTH_TONE = { OK: 'success', DEGRADED: 'warning', DOWN: 'danger', UNKNOWN: 'sky' }
const chLabel = (t, ch) => t(`integrations.messaging.channel.${ch}`, { defaultValue: CHANNEL_LABEL[ch] ?? ch })
const msgStatus = (t, s) => (MESSAGE_STATUSES[s] ? t(`integrations.messaging.status.${s}`, { defaultValue: MESSAGE_STATUSES[s].label }) : s)
const deliveryLabel = (t, s) => t(`integrations.messaging.delivery.${s}`, { defaultValue: s })
const providerName = (t, ch, value, options) => t(`integrations.messaging.provider.${ch}.${value}`, { defaultValue: options?.[ch]?.find((o) => o.value === value)?.label ?? value })

function DeliveryReports({ data }) {
  const { t } = useTranslation('integrations')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [secrets, setSecrets] = useState({})
  const [result, setResult] = useState({})
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations', 'messaging'] })
  const urls = useMutation({ mutationFn: createMessagingUrls, onSuccess: refresh, onError: (e) => showError(errText(e)) })
  const save = useMutation({
    mutationFn: () => saveMessagingWebhook({ secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)) }),
    onSuccess: () => { setSecrets({}); refresh(); showSuccess(t('integrations.messaging.webhookSaved')) },
    onError: (e) => showError(errText(e)),
  })
  const test = useMutation({ mutationFn: (ch) => testMessagingProvider(ch), onSuccess: (r, ch) => { setResult((x) => ({ ...x, [ch]: r })); refresh() }, onError: (e) => showError(errText(e)) })
  const disabled = !canConfigure()
  if (!data.urls) {
    return (
      <Panel title={t('integrations.messaging.reports')}>
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">{t('integrations.messaging.noUrlsYet')}</p>
          {canConfigure() && <Button icon={Link2} loading={urls.isPending} onClick={() => urls.mutate()}>{t('integrations.messaging.makeUrls')}</Button>}
        </div>
      </Panel>
    )
  }
  return (
    <div className="space-y-4">
      <Panel title={t('integrations.messaging.msg91Title')} subtitle={t('integrations.messaging.msg91Subtitle')}>
        <div className="space-y-3">
          <CopyField label={t('integrations.messaging.reportUrl')} value={data.urls.msg91} hint={t('integrations.messaging.reportUrlHint')} />
          {canConfigure() && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon={PlugZap} disabled={data.providers.SMS !== 'MSG91'} title={data.providers.SMS !== 'MSG91' ? t('integrations.messaging.notMsg91') : undefined} loading={test.isPending && test.variables === 'SMS'} onClick={() => test.mutate('SMS')}>{t('integrations.messaging.testMsg91')}</Button>
              {data.providers.SMS !== 'MSG91' && <span className="text-xs text-ink-faint">{t('integrations.messaging.notMsg91')}</span>}
            </div>
          )}
          {result.SMS && <Note tone={result.SMS.ok ? 'success' : 'danger'}>{result.SMS.message}</Note>}
        </div>
      </Panel>
      <Panel title={t('integrations.messaging.waTitle')} subtitle={t('integrations.messaging.waSubtitle')}>
        <div className="space-y-3">
          <CopyField label={t('integrations.messaging.callbackUrl')} value={data.urls.whatsapp} />
          <div className="grid sm:grid-cols-2 gap-3">
            {DEF.secrets.map((s) => (
              <SecretField key={s.key} label={fieldLabel(t, DEF, s, 'secrets')} hint={fieldHint(t, DEF, s, 'secrets')} state={data.webhook.secrets?.[s.key]} value={secrets[s.key]} disabled={disabled} onChange={(v) => setSecrets((x) => ({ ...x, [s.key]: v }))} />
            ))}
          </div>
          <p className="text-[11px] text-ink-faint"><Trans t={t} i18nKey="integrations.messaging.subscribeNote" components={{ code: <code /> }} /></p>
          {canConfigure() && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
              <Button icon={Check} disabled={!Object.values(secrets).some(Boolean)} loading={save.isPending} onClick={() => save.mutate()}>{t('integrations.common.save')}</Button>
              <Button variant="secondary" icon={PlugZap} className="ms-auto" disabled={data.providers.WHATSAPP !== 'META'} title={data.providers.WHATSAPP !== 'META' ? t('integrations.messaging.notCloudApi') : undefined} loading={test.isPending && test.variables === 'WHATSAPP'} onClick={() => test.mutate('WHATSAPP')}>{t('integrations.messaging.testWa')}</Button>
            </div>
          )}
          {result.WHATSAPP && <Note tone={result.WHATSAPP.ok ? 'success' : 'danger'}>{result.WHATSAPP.message}</Note>}
        </div>
      </Panel>
    </div>
  )
}

/** Which template each family message uses: the SMS DLT template id and the WhatsApp template name. */
function Templates({ data }) {
  const { t } = useTranslation('integrations')
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['integrations', 'messaging-templates'], queryFn: fetchMessagingTemplates })
  const missing = rows.filter((r) => (r.sms.enabled && data?.providers.SMS === 'MSG91' && !r.sms.templateId) || (r.whatsapp.enabled && data?.providers.WHATSAPP === 'META' && !r.whatsapp.templateName)).length
  return (
    <div className="space-y-3">
      <Note>
        <Trans t={t} i18nKey="integrations.messaging.templatesNote" components={{ link: <Link className="underline" to="/core/notifications-setup" /> }} />
        {data?.senderId && <> {t('integrations.messaging.senderIs', { id: data.senderId })}</>}
      </Note>
      {missing > 0 && <Note tone="warning" icon={TriangleAlert}>{t('integrations.messaging.missingTemplates', { count: missing })}</Note>}
      <DataTable
        rows={rows}
        loading={isLoading}
        rowKey="event"
        dense
        exportable
        exportName="message-templates"
        columns={[
          { key: 'label', header: t('integrations.messaging.message'), mobilePrimary: true, sortable: true, render: (v, r) => <div><p className="text-sm font-medium text-ink">{t(`admin:admin.notificationSetup.events.${r.event.replace(/\./g, '_')}.label`, { defaultValue: v })}</p><p className="text-[11px] text-ink-faint font-mono">{r.event}</p></div> },
          { key: 'sms', header: t('integrations.messaging.smsTemplate'), render: (v) => (!v.enabled ? <span className="text-xs text-ink-faint">{t('integrations.common.off')}</span> : v.templateId ? <CodeBadge>{v.templateId}</CodeBadge> : <StatusPill tone={data?.providers.SMS === 'MSG91' ? 'warning' : 'neutral'}>{t('integrations.messaging.notSet')}</StatusPill>) },
          { key: 'whatsapp', header: t('integrations.messaging.waTemplate'), render: (v) => (!v.enabled ? <span className="text-xs text-ink-faint">{t('integrations.common.off')}</span> : v.templateName ? <span className="inline-flex items-center gap-1.5"><CodeBadge>{v.templateName}</CodeBadge>{v.language && <span className="text-[11px] text-ink-faint">{v.language}</span>}</span> : <StatusPill tone={data?.providers.WHATSAPP === 'META' ? 'warning' : 'neutral'}>{t('integrations.messaging.notSet')}</StatusPill>) },
        ]}
        emptyIcon={FileText}
        emptyTitle={t('integrations.messaging.noTemplates')}
      />
    </div>
  )
}

const STATUS_KEYS = Object.keys(MESSAGE_STATUSES)

/** The latest messages and what the provider reported back (sent → delivered → read, or failed). */
function Sends() {
  const { t } = useTranslation('integrations')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, status, channel])
  const params = { search: q, status: status || undefined, channel: channel || undefined, page, pageSize: 20 }
  const { data, isLoading } = useQuery({ queryKey: ['integrations', 'sends', params], queryFn: () => fetchRecentSends(params), placeholderData: (p) => p, refetchInterval: 20_000 })
  const meta = data?.meta
  const all = t('integrations.common.all')
  const channels = ['SMS', 'WHATSAPP', 'EMAIL']
  return (
    <DataTable
      rows={data?.data ?? []}
      loading={isLoading}
      toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('integrations.messaging.searchSends')} right={(
        <ViewControls>
          <ControlChip label={t('integrations.common.status')} value={status ? msgStatus(t, status) : all} active={!!status} options={[all, ...STATUS_KEYS.map((k) => msgStatus(t, k))]} onChange={(v) => setStatus(STATUS_KEYS.find((k) => msgStatus(t, k) === v) ?? '')} />
          <ControlChip label={t('integrations.messaging.channelCol')} value={channel ? chLabel(t, channel) : all} active={!!channel} options={[all, ...channels.map((c) => chLabel(t, c))]} onChange={(v) => setChannel(channels.find((c) => chLabel(t, c) === v) ?? '')} />
        </ViewControls>
      )} />}
      columns={[
        { key: 'createdAt', header: t('integrations.common.when'), nowrap: true, width: 150, render: (v) => <DateCell value={v} time /> },
        { key: 'channel', header: t('integrations.messaging.channelCol'), nowrap: true, render: (v) => <ColorChip label={chLabel(t, v)} {...CHANNEL_LOOK[v]} /> },
        { key: 'studentName', header: t('integrations.messaging.to'), render: (v, r) => <PersonCell name={v ?? (r.test ? t('integrations.messaging.testMessage') : '—')} sub={r.to ?? '—'} size={26} /> },
        { key: 'body', header: t('integrations.messaging.message'), mobilePrimary: true, render: (v) => <span className="text-sm text-ink-muted line-clamp-2">{v}</span> },
        { key: 'status', header: t('integrations.messaging.sendStatus'), render: (v, r) => <div><StatusPill tone={MESSAGE_STATUSES[v]?.tone}>{msgStatus(t, v)}</StatusPill>{r.reason && <p className="text-[11px] text-ink-faint mt-0.5 line-clamp-2">{r.reason}</p>}</div> },
        { key: 'delivery', header: t('integrations.messaging.deliveryCol'), render: (v, r) => (v?.status
          ? <div><StatusPill tone={DELIVERY_TONE[v.status] ?? 'neutral'}>{deliveryLabel(t, v.status)}</StatusPill>{v.at && <p className="text-[11px] text-ink-faint mt-0.5"><DateCell value={v.at} time relative={false} /></p>}</div>
          : <span className="text-xs text-ink-faint">{r.status === 'SENT' ? t('integrations.messaging.noReport') : '—'}</span>) },
      ]}
      pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
      emptyIcon={MessageSquareText}
      emptyTitle={t('integrations.messaging.noSends')}
      emptyHint={t('integrations.messaging.noSendsHint')}
    />
  )
}

/** Integrations › SMS & WhatsApp: the same delivery setup as Notification rules, plus delivery reports, templates, tests and recent sends. */
export default function Messaging() {
  const { t } = useTranslation('integrations')
  const [tab, setTab] = useState('providers')
  const { data } = useQuery({ queryKey: ['integrations', 'messaging'], queryFn: fetchMessagingIntegration })
  const count = (ch, st) => (data?.last7Days ?? []).filter((r) => r.channel === ch && r.status === st).reduce((s, r) => s + r.count, 0)
  const health = HEALTH_STATUSES[data?.webhook?.health?.status] ? data.webhook.health.status : 'UNKNOWN'
  const failed = count('SMS', 'FAILED') + count('WHATSAPP', 'FAILED') + count('EMAIL', 'FAILED')
  return (
    <PageContainer>
      <PageHeader icon={MessageSquareText} title={t('integrations.messaging.title')} subtitle={t('integrations.messaging.subtitle')} />
      <StatCardRow items={[
        { icon: Send, label: t('integrations.messaging.smsSent'), value: count('SMS', 'SENT') + count('SMS', 'DELIVERED'), sub: t('integrations.messaging.confirmedDelivered', { count: count('SMS', 'DELIVERED') }), tone: 'sky' },
        { icon: CheckCheck, label: t('integrations.messaging.waDelivered'), value: count('WHATSAPP', 'DELIVERED') + count('WHATSAPP', 'READ'), sub: t('integrations.messaging.readCount', { count: count('WHATSAPP', 'READ') }), tone: 'success' },
        { icon: TriangleAlert, label: t('integrations.messaging.failed7'), value: failed, tone: failed ? 'danger' : 'teal' },
        { icon: Activity, label: t('integrations.messaging.healthTile'), value: healthLabel(t, health), sub: data ? t('integrations.messaging.sendsWith', { sms: providerName(t, 'SMS', data.providers.SMS, data.providerOptions), wa: providerName(t, 'WHATSAPP', data.providers.WHATSAPP, data.providerOptions) }) : '', tone: HEALTH_TONE[health] },
      ]} />
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[
          { value: 'providers', label: t('integrations.messaging.providers') },
          { value: 'reports', label: t('integrations.messaging.reports') },
          { value: 'templates', label: t('integrations.messaging.templates') },
          { value: 'sends', label: t('integrations.messaging.sends') },
        ]} />
        <div className="p-4 bg-bg/40 rounded-b-xl space-y-4">
          {tab === 'providers' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Note className="flex-1"><Trans t={t} i18nKey="integrations.messaging.sameSettings" values={{ sms: CHANNEL_LABEL.SMS }} components={{ link: <Link className="underline" to="/core/notifications-setup" /> }} /></Note>
                {data?.webhook?.health && <HealthPill health={data.webhook.health} />}
              </div>
              <DeliveryTab />
            </>
          )}
          {tab === 'reports' && (data ? <DeliveryReports data={data} /> : <div className="h-64 rounded-xl bg-black/5 animate-pulse" />)}
          {tab === 'templates' && <Templates data={data} />}
          {tab === 'sends' && <Sends />}
        </div>
      </div>
    </PageContainer>
  )
}
