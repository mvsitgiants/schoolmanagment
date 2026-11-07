import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquareText, Plus, RotateCcw, Send, Trash2 } from 'lucide-react'
import { CHANNEL_LABEL, MESSAGE_STATUSES, TEMPLATE_SAMPLE, renderTemplate, smsParts } from '@schoolgiant/shared'
import {
  ControlChip, DataTable, Drawer, FormField, Input, Note, PageContainer, PageHeader, Panel, Select, StatusPill, Tabs, Textarea, Toolbar, ViewControls,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { DefinitionGrid, Switch } from '../../components/app/Controls'
import {
  fetchMessages, fetchMessaging, fetchNotificationRules, retryMessage, saveMessagingChannel, saveNotificationRule, sendTestMessage,
} from '../../api/core'
import { hasAnyPermission, hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const canEdit = () => hasPermission('core.notifications-setup.edit')
// delivery setup is shared with Integrations › SMS & WhatsApp
const canEditDelivery = () => hasAnyPermission('core.notifications-setup.edit', 'integrations.messaging.configure')
const errorsOf = (e) => e.response?.data?.details?.fields ?? {}
// labels: admin.notificationSetup.channels.<CH> · statuses.<STATUS> · providers.<CH>.<value> · events.<event, . → _>
const chLabel = (t, ch) => t(`admin.notificationSetup.channels.${ch}`, { defaultValue: CHANNEL_LABEL[ch] ?? ch })
const statusText = (t, s) => (MESSAGE_STATUSES[s] ? t(`admin.notificationSetup.statuses.${s}`, { defaultValue: MESSAGE_STATUSES[s].label }) : s)
const keyOf = (code) => String(code).replace(/\./g, '_')

// ───────────────────────────────────────────────────────── family messages (wording)

function ChannelEditor({ channel, value, vars, varHelp, customized, fixed, onChange, onReset, errors, disabled }) {
  const { t } = useTranslation('admin')
  const preview = renderTemplate(value.body, TEMPLATE_SAMPLE)
  const sms = channel === 'SMS' ? smsParts(preview) : null
  const insert = (v) => onChange({ body: `${value.body ?? ''}{{${v}}}` })
  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center gap-3">
        <Switch checked={value.enabled} onChange={(enabled) => onChange({ enabled })} disabled={disabled || fixed} label={chLabel(t, channel)} />
        <span className="text-sm font-medium text-ink">{chLabel(t, channel)}</span>
        {fixed && <span className="text-[11px] text-ink-faint">{t('admin.notificationSetup.alwaysOn')}</span>}
        {customized && <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-700">{t('admin.notificationSetup.yourWording')}</span>}
        {customized && !disabled && <button type="button" onClick={onReset} className="ms-auto text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> {t('admin.notificationSetup.defaultWording')}</button>}
      </div>
      {value.enabled && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            {channel === 'EMAIL' && (
              <FormField label={t('admin.notificationSetup.subject')} error={errors[`${channel}.subject`]}>
                <Input value={value.subject ?? ''} disabled={disabled} maxLength={200} onChange={(e) => onChange({ subject: e.target.value })} />
              </FormField>
            )}
            <FormField label={t('admin.notificationSetup.message')} error={errors[`${channel}.body`]} hint={sms ? t(sms.unicode ? 'admin.notificationSetup.smsCountUnicode' : 'admin.notificationSetup.smsCount', { count: sms.length, parts: sms.parts }) : undefined}>
              <Textarea rows={channel === 'SMS' ? 3 : 6} value={value.body ?? ''} disabled={disabled} maxLength={2000} onChange={(e) => onChange({ body: e.target.value })} />
            </FormField>
            {!disabled && (
              <div className="flex flex-wrap gap-1">
                {vars.map((v) => <button key={v} type="button" title={varHelp[v] ? t(`admin.notificationSetup.varHelp.${keyOf(v)}`, { defaultValue: varHelp[v] }) : undefined} onClick={() => insert(v)} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border text-ink-muted hover:border-brand-400 hover:text-brand-700">{`{{${v}}}`}</button>)}
              </div>
            )}
            {channel === 'SMS' && (
              <FormField label={t('admin.notificationSetup.dltId')} hint={t('admin.notificationSetup.dltIdHint')}>
                <Input value={value.templateId ?? ''} disabled={disabled} maxLength={60} onChange={(e) => onChange({ templateId: e.target.value })} placeholder={t('admin.notificationSetup.dltIdPlaceholder')} />
              </FormField>
            )}
            {channel === 'WHATSAPP' && (
              <div className="grid sm:grid-cols-3 gap-3">
                <FormField label={t('admin.notificationSetup.approvedTemplate')} hint={t('admin.notificationSetup.approvedTemplateHint')}>
                  <Input value={value.templateName ?? ''} disabled={disabled} onChange={(e) => onChange({ templateName: e.target.value })} placeholder="appointment_booked" />
                </FormField>
                <FormField label={t('admin.notificationSetup.language')}>
                  <Input value={value.language ?? 'en'} disabled={disabled} onChange={(e) => onChange({ language: e.target.value })} />
                </FormField>
                <FormField label={t('admin.notificationSetup.templateValues')} error={errors[`${channel}.params`]}>
                  <Input value={(value.params ?? []).join(', ')} disabled={disabled} onChange={(e) => onChange({ params: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="student.name, fees.dueDate" />
                </FormField>
              </div>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">{t('admin.notificationSetup.previewSample')}</p>
            <div className="rounded-lg bg-bg border border-border p-3 text-sm text-ink whitespace-pre-wrap break-words">
              {channel === 'EMAIL' && <p className="font-medium mb-2">{renderTemplate(value.subject, TEMPLATE_SAMPLE)}</p>}
              {preview || <span className="text-ink-faint">{t('admin.notificationSetup.empty')}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RuleEditor({ rule, channels }) {
  const { t } = useTranslation('admin')
  const ruleLabel = t(`admin.notificationSetup.events.${keyOf(rule.event)}.label`, { defaultValue: rule.label })
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(rule.channels)
  const [errors, setErrors] = useState({})
  useEffect(() => setForm(rule.channels), [rule.channels])
  const dirty = JSON.stringify(form) !== JSON.stringify(rule.channels)
  const save = useMutation({
    mutationFn: (body) => saveNotificationRule(rule.event, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-rules'] }); setErrors({}); showSuccess(t('admin.notificationSetup.savedRule', { name: ruleLabel })) },
    onError: (e) => { setErrors(errorsOf(e)); showError(e.message) },
  })
  const changedChannels = () => Object.fromEntries(channels.map((c) => c.value).filter((ch) => JSON.stringify(form[ch]) !== JSON.stringify(rule.channels[ch])).map((ch) => [ch, form[ch]]))
  return (
    <Panel title={ruleLabel} subtitle={rule.when ? t(`admin.notificationSetup.events.${keyOf(rule.event)}.when`, { defaultValue: rule.when }) : rule.when}>
      <div className="space-y-3">
        {channels.map((c) => (
          <ChannelEditor key={c.value} channel={c.value} value={form[c.value]} vars={rule.vars} varHelp={rule.varHelp} customized={rule.customized[c.value]} fixed={rule.fixed?.includes(c.value)} errors={errors} disabled={!canEdit()}
            onChange={(patch) => setForm((f) => ({ ...f, [c.value]: { ...f[c.value], ...patch } }))}
            onReset={() => save.mutate({ [c.value]: null })} />
        ))}
        {canEdit() && (
          <div className="flex items-center gap-3 pt-1">
            <Button icon={Check} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(changedChannels())}>{t('actions.save')}</Button>
            {dirty && <Button variant="ghost" onClick={() => { setForm(rule.channels); setErrors({}) }}>{t('admin.notificationSetup.undoChanges')}</Button>}
          </div>
        )}
      </div>
    </Panel>
  )
}

function MessagesTab() {
  const { t } = useTranslation('admin')
  const { data, isLoading } = useQuery({ queryKey: ['notification-rules'], queryFn: fetchNotificationRules })
  if (isLoading) return <div className="h-64 rounded-xl bg-black/5 animate-pulse" />
  return (
    <div className="space-y-4">
      <Note tone="info">{t('admin.notificationSetup.consentNote')}</Note>
      {data.rules.map((r) => <RuleEditor key={r.event} rule={r} channels={data.channels} />)}
    </div>
  )
}

// ───────────────────────────────────────────────────────── delivery (providers)

function Secret({ label, set, value, onChange, disabled }) {
  const { t } = useTranslation('admin')
  return (
    <FormField label={label} hint={set ? t('admin.notificationSetup.secretSaved') : undefined}>
      <Input type="password" autoComplete="new-password" value={value ?? ''} disabled={disabled} placeholder={set ? '••••••••' : ''} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  )
}

function GatewayFields({ http = {}, onChange, vars, disabled, kind }) {
  const { t } = useTranslation('admin')
  const set = (patch) => onChange({ ...http, ...patch })
  const headers = http.headers ?? []
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-[120px_minmax(0,1fr)] gap-3">
        <FormField label={t('admin.notificationSetup.method')}><Select value={http.method ?? 'POST'} disabled={disabled} onChange={(e) => set({ method: e.target.value })}><option value="POST">POST</option><option value="GET">GET</option></Select></FormField>
        <FormField label="URL"><Input value={http.url ?? ''} disabled={disabled} onChange={(e) => set({ url: e.target.value })} placeholder={`https://api.your-${kind}-gateway.in/send?to={{to}}`} /></FormField>
      </div>
      {(http.method ?? 'POST') === 'POST' && (
        <div className="grid sm:grid-cols-[120px_minmax(0,1fr)] gap-3">
          <FormField label={t('admin.notificationSetup.bodyAs')}><Select value={http.bodyType ?? 'JSON'} disabled={disabled} onChange={(e) => set({ bodyType: e.target.value })}><option value="JSON">JSON</option><option value="FORM">{t('admin.notificationSetup.form')}</option></Select></FormField>
          <FormField label={t('admin.notificationSetup.body')}><Textarea rows={3} className="font-mono text-xs" value={http.body ?? ''} disabled={disabled} onChange={(e) => set({ body: e.target.value })} placeholder={'{"to":"{{to}}","message":"{{message}}","template_id":"{{templateId}}"}'} /></FormField>
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-ink-muted mb-1.5">{t('admin.notificationSetup.headers')}</p>
        <div className="space-y-2">
          {headers.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={t('admin.notificationSetup.headerName')} className="!h-8 max-w-[200px]" value={h.name} disabled={disabled} placeholder="Authorization" onChange={(e) => set({ headers: headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input aria-label={t('admin.notificationSetup.headerValue')} className="!h-8" value={h.value} disabled={disabled} placeholder="Bearer {{apiKey}}" onChange={(e) => set({ headers: headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              {!disabled && <button type="button" aria-label={t('admin.notificationSetup.removeHeader')} onClick={() => set({ headers: headers.filter((_, j) => j !== i) })} className="text-ink-faint hover:text-danger-600"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
          {!disabled && headers.length < 10 && <Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ headers: [...headers, { name: '', value: '' }] })}>{t('admin.notificationSetup.addHeader')}</Button>}
        </div>
      </div>
      <Secret label={t('admin.notificationSetup.apiKey')} set={http.apiKeySet} value={http.apiKey} disabled={disabled} onChange={(apiKey) => set({ apiKey })} />
      <p className="text-[11px] text-ink-faint">{t('admin.notificationSetup.placeholders')} {vars.map((v) => <code key={v} className="me-1.5">{`{{${v}}}`}</code>)}— <code>{'{{to}}'}</code> {t('admin.notificationSetup.toIs')}, <code>{'{{to10}}'}</code> {t('admin.notificationSetup.to10Is')}. {t('admin.notificationSetup.encodedNote')}</p>
    </div>
  )
}

function ChannelSetup({ channel, saved, providers, gatewayVars }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(saved)
  const [to, setTo] = useState('')
  const [result, setResult] = useState(null)
  useEffect(() => setForm(saved), [saved])
  const disabled = !canEditDelivery()
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const save = useMutation({
    mutationFn: () => saveMessagingChannel(channel, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messaging'] }); showSuccess(t('admin.notificationSetup.deliverySaved', { channel: chLabel(t, channel) })) },
    onError: (e) => showError(e.message),
  })
  const test = useMutation({ mutationFn: () => sendTestMessage(channel, to), onSuccess: setResult, onError: (e) => showError(e.message) })
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const p = form.provider ?? 'NONE'

  return (
    <Panel title={chLabel(t, channel)} subtitle={p === 'NONE' ? t('admin.notificationSetup.offSubtitle') : p === 'TEST' ? t('admin.notificationSetup.testSubtitle') : null}>
      <div className="space-y-4">
        <FormField label={t('admin.notificationSetup.sendWith')}>
          <div className="max-w-xs"><Select value={p} disabled={disabled} onChange={(e) => set({ provider: e.target.value })}>{providers.map((o) => <option key={o.value} value={o.value}>{t(`admin.notificationSetup.providers.${channel}.${o.value}`, { defaultValue: o.label })}</option>)}</Select></div>
        </FormField>
        {channel === 'SMS' && p === 'HTTP' && (
          <>
            <FormField label={t('admin.notificationSetup.senderId')} hint={t('admin.notificationSetup.senderIdHint')}><Input className="max-w-[160px]" value={form.senderId ?? ''} disabled={disabled} maxLength={20} onChange={(e) => set({ senderId: e.target.value })} /></FormField>
            <GatewayFields http={form.http} vars={gatewayVars} disabled={disabled} kind="sms" onChange={(http) => set({ http })} />
          </>
        )}
        {channel === 'SMS' && p === 'MSG91' && (
          <div className="grid sm:grid-cols-3 gap-3">
            <FormField label={t('admin.notificationSetup.senderId')} hint={t('admin.notificationSetup.senderIdHintShort')}><Input value={form.senderId ?? ''} disabled={disabled} maxLength={20} onChange={(e) => set({ senderId: e.target.value })} /></FormField>
            <Secret label={t('admin.notificationSetup.msg91Key')} set={form.msg91?.authKeySet} value={form.msg91?.authKey} disabled={disabled} onChange={(authKey) => set({ msg91: { route: '4', ...form.msg91, authKey } })} />
            <FormField label={t('admin.notificationSetup.route')}><Select value={form.msg91?.route ?? '4'} disabled={disabled} onChange={(e) => set({ msg91: { ...form.msg91, route: e.target.value } })}><option value="4">{t('admin.notificationSetup.transactional')}</option><option value="1">{t('admin.notificationSetup.promotional')}</option></Select></FormField>
            <p className="sm:col-span-3 text-[11px] text-ink-faint">{t('admin.notificationSetup.msg91Note')}</p>
          </div>
        )}
        {channel === 'WHATSAPP' && p === 'HTTP' && <GatewayFields http={form.http} vars={gatewayVars} disabled={disabled} kind="whatsapp" onChange={(http) => set({ http })} />}
        {channel === 'WHATSAPP' && p === 'META' && (
          <div className="grid sm:grid-cols-3 gap-3">
            <FormField label={t('admin.notificationSetup.phoneNumberId')}><Input value={form.meta?.phoneNumberId ?? ''} disabled={disabled} onChange={(e) => set({ meta: { ...form.meta, phoneNumberId: e.target.value } })} /></FormField>
            <Secret label={t('admin.notificationSetup.accessToken')} set={form.meta?.tokenSet} value={form.meta?.token} disabled={disabled} onChange={(token) => set({ meta: { ...form.meta, token } })} />
            <FormField label={t('admin.notificationSetup.apiVersion')}><Input value={form.meta?.apiVersion ?? 'v21.0'} disabled={disabled} onChange={(e) => set({ meta: { ...form.meta, apiVersion: e.target.value } })} /></FormField>
          </div>
        )}
        {channel === 'EMAIL' && p === 'SMTP' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label={t('admin.notificationSetup.smtpServer')}><Input value={form.smtp?.host ?? ''} disabled={disabled} placeholder="smtp.yourschool.edu.in" onChange={(e) => set({ smtp: { ...form.smtp, host: e.target.value } })} /></FormField>
            <div className="flex items-end gap-3">
              <FormField label={t('admin.notificationSetup.port')}><Input type="number" className="!w-24" value={form.smtp?.port ?? ''} disabled={disabled} placeholder="587" onChange={(e) => set({ smtp: { ...form.smtp, port: e.target.value ? Number(e.target.value) : undefined } })} /></FormField>
              <div className="pb-2"><Switch checked={!!form.smtp?.secure} disabled={disabled} onChange={(secure) => set({ smtp: { ...form.smtp, secure } })} label="SSL" /></div>
              <span className="pb-2.5 text-xs text-ink-muted">{t('admin.notificationSetup.sslPort')}</span>
            </div>
            <FormField label={t('admin.notificationSetup.userName')}><Input value={form.smtp?.user ?? ''} disabled={disabled} autoComplete="off" onChange={(e) => set({ smtp: { ...form.smtp, user: e.target.value } })} /></FormField>
            <Secret label={t('admin.notificationSetup.password')} set={form.smtp?.passSet} value={form.smtp?.pass} disabled={disabled} onChange={(pass) => set({ smtp: { ...form.smtp, pass } })} />
            <FormField label={t('admin.notificationSetup.from')}><Input value={form.smtp?.from ?? ''} disabled={disabled} placeholder="City Care Institution <care@citycare.in>" onChange={(e) => set({ smtp: { ...form.smtp, from: e.target.value } })} /></FormField>
          </div>
        )}
        {!disabled && (
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-border">
            <Button icon={Check} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
            {p !== 'NONE' && (
              <div className="flex items-end gap-2 ms-auto">
                <FormField label={t('admin.notificationSetup.sendTestTo')}><Input className="!w-56" value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'EMAIL' ? 'you@example.com' : t('admin.notificationSetup.mobileNumber')} /></FormField>
                <Button variant="secondary" icon={Send} disabled={!to.trim() || dirty} loading={test.isPending} onClick={() => test.mutate()} title={dirty ? t('admin.notificationSetup.saveFirst') : undefined}>{t('admin.notificationSetup.sendTest')}</Button>
              </div>
            )}
          </div>
        )}
        {result && <Note tone={result.status === 'SENT' ? 'success' : 'danger'}>{result.status === 'SENT' ? t(result.provider === 'TEST' ? 'admin.notificationSetup.sentToTest' : 'admin.notificationSetup.sentTo', { to: result.to }) : t('admin.notificationSetup.notSent', { reason: result.reason })}</Note>}
      </div>
    </Panel>
  )
}

export function DeliveryTab() {
  const { data, isLoading } = useQuery({ queryKey: ['messaging'], queryFn: fetchMessaging })
  if (isLoading) return <div className="h-64 rounded-xl bg-black/5 animate-pulse" />
  return (
    <div className="space-y-4">
      {['SMS', 'WHATSAPP', 'EMAIL'].map((ch) => <ChannelSetup key={ch} channel={ch} saved={data.config[ch]} providers={data.providers[ch]} gatewayVars={data.gatewayVars} />)}
    </div>
  )
}

// ───────────────────────────────────────────────────────── message log

const STATUS_OPTIONS = Object.entries(MESSAGE_STATUSES)

function LogTab() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, status, channel])
  const params = { search: q, status: status || undefined, channel: channel || undefined, page, pageSize: 30 }
  const { data, isLoading } = useQuery({ queryKey: ['messages', params], queryFn: () => fetchMessages(params), placeholderData: (p) => p, refetchInterval: 15_000 })
  const meta = data?.meta
  const retry = useMutation({ mutationFn: (id) => retryMessage(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages'] }); setOpen(null); showSuccess(t('admin.notificationSetup.requeued')) }, onError: (e) => showError(e.message) })
  const week = meta?.last7Days ?? {}
  const statusLabel = useMemo(() => Object.fromEntries(STATUS_OPTIONS.map(([k]) => [k, statusText(t, k)])), [t])
  const all = t('admin.notificationSetup.all')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {['SENT', 'QUEUED', 'FAILED', 'SKIPPED'].map((k) => <span key={k} className="px-2.5 py-1 rounded-md bg-surface border border-border text-ink-muted">{t('admin.notificationSetup.last7Days', { status: statusLabel[k] })} <span className="font-semibold text-ink">{week[k] ?? 0}</span></span>)}
      </div>
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        onRowClick={setOpen}
        toolbar={(
          <Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('admin.notificationSetup.searchPlaceholder')} right={(
            <ViewControls>
              <ControlChip label={t('common.status')} value={statusLabel[status] ?? all} active={!!status} options={[all, ...STATUS_OPTIONS.map(([k]) => statusLabel[k])]} onChange={(v) => setStatus(STATUS_OPTIONS.find(([k]) => statusLabel[k] === v)?.[0] ?? '')} />
              <ControlChip label={t('admin.notificationSetup.channel')} value={CHANNEL_LABEL[channel] ? chLabel(t, channel) : all} active={!!channel} options={[all, ...Object.keys(CHANNEL_LABEL).map((c) => chLabel(t, c))]} onChange={(v) => setChannel(Object.keys(CHANNEL_LABEL).find((c) => chLabel(t, c) === v) ?? '')} />
            </ViewControls>
          )} />
        )}
        columns={[
          { key: 'createdAt', header: t('admin.notificationSetup.cols.when'), nowrap: true, width: 160, render: (v) => <span className="text-sm text-ink-muted">{dateTime(v)}</span> },
          { key: 'channel', header: t('admin.notificationSetup.channel'), nowrap: true, render: (v) => chLabel(t, v) },
          { key: 'studentName', header: t('admin.notificationSetup.cols.to'), render: (v, r) => <div><p className="text-sm text-ink">{v ?? (r.test ? t('admin.notificationSetup.testMessage') : '—')}</p><p className="text-xs text-ink-faint font-mono-num">{r.to ?? '—'}</p></div> },
          { key: 'body', header: t('admin.notificationSetup.message'), mobilePrimary: true, render: (v) => <span className="text-sm text-ink-muted line-clamp-2">{v}</span> },
          { key: 'status', header: t('common.status'), render: (v, r) => <div><StatusPill tone={MESSAGE_STATUSES[v]?.tone}>{statusText(t, v)}</StatusPill>{r.reason && <p className="text-[11px] text-ink-faint mt-0.5 line-clamp-2">{r.reason}</p>}</div> },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={MessageSquareText}
        emptyTitle={t('admin.notificationSetup.emptyTitle')}
        emptyHint={t('admin.notificationSetup.emptyHint')}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} subtitle={open ? chLabel(t, open.channel) : ''} title={open?.studentName ?? (open?.test ? t('admin.notificationSetup.testMessage') : t('admin.notificationSetup.message'))}
        footer={open && ['FAILED', 'SKIPPED'].includes(open.status) && canEdit() && <Button icon={RotateCcw} loading={retry.isPending} onClick={() => retry.mutate(open.id)}>{t('admin.notificationSetup.sendAgain')}</Button>}>
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><StatusPill tone={MESSAGE_STATUSES[open.status]?.tone}>{statusText(t, open.status)}</StatusPill>{open.reason && <span className="text-xs text-ink-muted">{open.reason}</span>}</div>
            <DefinitionGrid items={[
              { label: t('admin.notificationSetup.cols.to'), value: open.to ?? '—', mono: true },
              { label: t('admin.notificationSetup.sentWith'), value: open.provider ?? '—' },
              { label: t('admin.notificationSetup.statuses.QUEUED'), value: dateTime(open.createdAt) },
              { label: t('admin.notificationSetup.statuses.SENT'), value: open.sentAt ? dateTime(open.sentAt) : '—' },
              { label: t('admin.notificationSetup.attempts'), value: open.attempts },
              open.providerRef && { label: t('admin.notificationSetup.providerRef'), value: open.providerRef, mono: true },
              open.templateId && { label: t('admin.notificationSetup.dltTemplate'), value: open.templateId, mono: true },
              open.waTemplate?.name && { label: t('admin.notificationSetup.waTemplate'), value: `${open.waTemplate.name} (${open.waTemplate.language})` },
            ]} />
            {open.subject && <p className="text-sm font-medium text-ink">{open.subject}</p>}
            <div className="rounded-lg bg-bg border border-border p-3 text-sm text-ink whitespace-pre-wrap break-words">{open.body}</div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

/** Administration › Notification rules: what families are sent, how it is delivered, and the log (engine E12). */
export default function NotificationSetup() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState('messages')
  return (
    <PageContainer>
      <PageHeader icon={MessageSquareText} title={t('admin.notificationSetup.title')} subtitle={t('admin.notificationSetup.subtitle')} />
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: 'messages', label: t('admin.notificationSetup.tabs.messages') }, { value: 'delivery', label: t('admin.notificationSetup.tabs.delivery') }, { value: 'log', label: t('admin.notificationSetup.tabs.log') }]} />
        <div className="p-4 bg-bg/40 rounded-b-xl">
          {tab === 'messages' && <MessagesTab />}
          {tab === 'delivery' && <DeliveryTab />}
          {tab === 'log' && <LogTab />}
        </div>
      </div>
    </PageContainer>
  )
}
