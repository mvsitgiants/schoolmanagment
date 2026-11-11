import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import { Ban, FlaskConical, KeyRound, ListChecks, Pencil, Plus, Power, Radio, RotateCcw, Send, Trash2, Webhook } from 'lucide-react'
import { INTEGRATION_MODES, WEBHOOK_DELIVERY_STATUSES } from '@schoolgiant/shared'
import {
  DateInput, CodeBadge, ColorChip, DataTable, DateCell, Drawer, ExpiryBadge, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, SegmentedControl, StatusPill, Tabs, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { DefinitionGrid } from '../../components/app/Controls'
import { RevealOnceModal, errText, fieldErrors } from '../../components/integrations/IntegrationBits'
import {
  createApiKey, createWebhook, deleteWebhook, fetchApiKeys, fetchApiKeysMeta, fetchWebhookDeliveries, fetchWebhooks, redeliverWebhook, revokeApiKey,
  rotateWebhookSecret, testWebhook, updateApiKey, updateWebhook,
} from '../../api/integrations'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const eventKey = (ev) => `admin.apiKeys.events.${String(ev).replace(/\./g, '_')}`
const KEY_STATE = { ACTIVE: { label: 'Active', tone: 'success' }, EXPIRED: { label: 'Expired', tone: 'warning' }, REVOKED: { label: 'Revoked', tone: 'neutral' } }
const Chip = ({ on, onClick, disabled, children }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className={clsx('text-[11px] px-2 py-0.5 rounded-md border transition-colors', on ? 'bg-brand-500 border-brand-500 text-white' : 'border-border text-ink-muted hover:border-brand-400 hover:text-brand-700', disabled && 'opacity-60 cursor-not-allowed')}>
    {children}
  </button>
)

// ───────────────────────────────────────────────────────── API keys

function ScopePicker({ groups, value, onChange }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const set = new Set(value)
  const toggle = (keys, on) => {
    const next = new Set(set)
    for (const k of keys) (on ? next.add(k) : next.delete(k))
    onChange([...next])
  }
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border">
      {groups.map((m) => {
        const views = m.pages.flatMap((p) => p.actions.filter((a) => a.key.endsWith('.view')).map((a) => a.key))
        const allView = views.length && views.every((k) => set.has(k))
        return (
          <div key={m.module} className="p-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{cl.module(m.module)}</span>
              <span className="ms-auto"><Chip on={allView} onClick={() => toggle(views, !allView)}>{t('admin.apiKeys.viewAll')}</Chip></span>
            </div>
            {m.pages.map((p) => (
              <div key={p.page} className="flex flex-wrap items-center gap-1.5 ps-2">
                <span className="text-xs text-ink-muted w-full sm:w-40 shrink-0">{cl.page(m.module, p.page)}</span>
                {p.actions.map((a) => <Chip key={a.key} on={set.has(a.key)} onClick={() => toggle([a.key], !set.has(a.key))}>{cl.action({ id: a.key.split('.').pop(), label: a.label })}</Chip>)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** `preset`: a new key's starting name and permissions (e.g. the website key from Portal content). */
function KeyModal({ meta, apiKey, preset, onClose, onSaved }) {
  const { t } = useTranslation('admin')
  const { showError } = useSnackbar()
  const [f, setF] = useState({
    name: apiKey?.name ?? preset?.name ?? '', scopes: apiKey?.scopes ?? preset?.scopes ?? [], expiresOn: apiKey?.expiresAt ? String(apiKey.expiresAt).slice(0, 10) : '',
    origins: (apiKey?.allowedOrigins ?? []).join('\n'),
  })
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, scopes: f.scopes, expiresOn: f.expiresOn || null, allowedOrigins: f.origins.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) }
      return apiKey ? updateApiKey(apiKey.id, body) : createApiKey(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(fieldErrors(e)); showError(errText(e)) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={apiKey ? t('admin.apiKeys.editTitle', { name: apiKey.name }) : t('admin.apiKeys.newKey')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2 || !f.scopes.length} onClick={() => save.mutate()}>{apiKey ? t('actions.save') : t('admin.apiKeys.createKey')}</Button></>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-[minmax(0,1fr)_180px] gap-3">
          <FormField label={t('common.name')} required error={errors.name}><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('admin.apiKeys.namePlaceholder')} /></FormField>
          <FormField label={t('admin.apiKeys.expiresOn')} hint={t('admin.apiKeys.expiresHint')} error={errors.expiresAt}><DateInput value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></FormField>
        </div>
        <FormField label={t('admin.apiKeys.scopesLabel', { count: f.scopes.length })} error={errors.scopes}>
          <ScopePicker groups={meta.scopes} value={f.scopes} onChange={(scopes) => setF({ ...f, scopes })} />
        </FormField>
        <Note>{t('admin.apiKeys.scopesNote')}</Note>
        <FormField label={t('admin.apiKeys.originsLabel')} hint={t('admin.apiKeys.originsHint')} error={errors.allowedOrigins}>
          <Textarea rows={2} value={f.origins} onChange={(e) => setF({ ...f, origins: e.target.value })} placeholder="https://www.yourschool.edu.in" />
        </FormField>
      </div>
    </Modal>
  )
}

function KeysTab({ meta }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  // ?new=website (from Portal content › Website API): open a new key set up for the website
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(() => (params.get('new') === 'website' && hasPermission('core.api-keys.create') ? 'website' : null))
  const closeModal = () => { setEditing(null); if (params.get('new')) setParams((p) => { p.delete('new'); return p }, { replace: true }) }
  const [reveal, setReveal] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: fetchApiKeys })
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys'] })
  const revoke = async (k) => {
    if (!(await confirm({ title: t('admin.apiKeys.revokeConfirm.title', { name: k.name }), message: t('admin.apiKeys.revokeConfirm.message'), tone: 'danger', confirmLabel: t('admin.apiKeys.revoke') }))) return
    try { await revokeApiKey(k.id); refresh(); showSuccess(t('admin.apiKeys.revoked')) } catch (e) { showError(errText(e)) }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Note className="flex-1 min-w-[240px]"><Trans t={t} i18nKey="admin.apiKeys.keysNote" values={{ header: 'Authorization: Bearer hk_…' }} components={{ code: <code /> }} /></Note>
        <Button icon={Plus} requires="core.api-keys.create" onClick={() => setEditing('new')}>{t('admin.apiKeys.newKey')}</Button>
      </div>
      <DataTable rows={rows} loading={isLoading}
        columns={[
          { key: 'name', header: t('admin.apiKeys.cols.key'), mobilePrimary: true, render: (v, k) => <div className="flex items-start gap-3"><span className={clsx('w-9 h-9 rounded-xl border flex items-center justify-center shrink-0', k.state === 'REVOKED' ? 'bg-bg text-ink-faint border-border' : 'bg-violet-50 text-violet-700 border-violet-200')}><KeyRound className="w-4 h-4" /></span><div className="min-w-0"><p className="font-medium text-ink">{v}</p><CodeBadge>{k.hint}</CodeBadge>{k.allowedOrigins?.length > 0 && <p className="text-[11px] text-ink-muted truncate" title={k.allowedOrigins.join('\n')}>{t('admin.apiKeys.originsShort', { list: k.allowedOrigins.map((o) => o.replace(/^https?:\/\//, '')).join(', ') })}</p>}</div></div> },
          { key: 'scopes', header: t('admin.apiKeys.cols.permissions'), render: (v) => <span title={(v ?? []).join('\n')}><ColorChip label={String(v?.length ?? 0)} tone="info" icon={ListChecks} /></span> },
          { key: 'expiresAt', header: t('admin.apiKeys.cols.expires'), render: (v, k) => (v ? (k.state === 'REVOKED' ? <DateCell value={v} relative={false} /> : <ExpiryBadge value={v} warnDays={30} dangerDays={7} />) : <span className="text-sm text-ink-muted">{t('admin.apiKeys.never')}</span>) },
          { key: 'lastUsedAt', header: t('admin.apiKeys.cols.lastUsed'), render: (v, k) => (v ? <span className="block leading-tight"><DateCell value={v} time />{k.lastUsedIp && <span className="block font-mono-num text-[11px] text-ink-faint">{k.lastUsedIp}</span>}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'state', header: t('common.status'), render: (v) => <StatusPill tone={KEY_STATE[v]?.tone}>{t(`admin.apiKeys.state.${v}`, { defaultValue: KEY_STATE[v]?.label ?? v })}</StatusPill> },
          { key: 'actions', header: '', align: 'right', render: (_, k) => k.state !== 'REVOKED' && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={Pencil} requires="core.api-keys.edit" aria-label={t('actions.edit')} onClick={() => setEditing(k)} />
              <Button size="sm" variant="ghost" icon={Ban} requires="core.api-keys.delete" aria-label={t('admin.apiKeys.revoke')} className="text-danger-600" onClick={() => revoke(k)} />
            </div>
          ) },
        ]}
        emptyIcon={KeyRound} emptyTitle={t('admin.apiKeys.emptyTitle')} emptyHint={t('admin.apiKeys.emptyHint')} />
      {editing && <KeyModal meta={meta} apiKey={typeof editing === 'object' ? editing : null}
        preset={editing === 'website' ? { name: t('admin.apiKeys.websitePresetName'), scopes: ['portal.content.view'] } : null}
        onClose={closeModal} onSaved={(r) => {
        closeModal(); refresh()
        if (r.key) setReveal(r); else showSuccess(t('common.saved'))
      }} />}
      <RevealOnceModal open={!!reveal} onClose={() => setReveal(null)} title={reveal ? t('admin.apiKeys.revealTitle', { name: reveal.apiKey.name }) : ''} secret={reveal?.key} />
    </div>
  )
}

// ───────────────────────────────────────────────────────── webhooks

function WebhookModal({ meta, hook, onClose, onSaved }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const { showError } = useSnackbar()
  const [f, setF] = useState({ name: hook?.name ?? '', url: hook?.url ?? '', mode: hook?.mode ?? 'LIVE', events: hook?.events ?? [] })
  const [errors, setErrors] = useState({})
  const save = useMutation({ mutationFn: () => (hook ? updateWebhook(hook.id, f) : createWebhook(f)), onSuccess: onSaved, onError: (e) => { setErrors(fieldErrors(e)); showError(errText(e)) } })
  const byModule = useMemo(() => meta.events.reduce((m, e) => ({ ...m, [e.module]: [...(m[e.module] ?? []), e] }), {}), [meta.events])
  const toggle = (ev) => setF((x) => ({ ...x, events: x.events.includes(ev) ? x.events.filter((e) => e !== ev) : [...x.events, ev] }))
  return (
    <Modal open onClose={onClose} size="lg" title={hook ? t('admin.apiKeys.editTitle', { name: hook.name }) : t('admin.apiKeys.newWebhook')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2 || !f.url.trim() || !f.events.length} onClick={() => save.mutate()}>{hook ? t('actions.save') : t('admin.apiKeys.addWebhook')}</Button></>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label={t('common.name')} required error={errors.name}><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('admin.apiKeys.webhookNamePlaceholder')} /></FormField>
          <FormField label={t('admin.apiKeys.mode')}><SegmentedControl value={f.mode} onChange={(mode) => setF({ ...f, mode })} options={INTEGRATION_MODES.map((o) => ({ ...o, label: t(`admin.apiKeys.modes.${o.value}`, { defaultValue: o.label }) }))} /></FormField>
        </div>
        <FormField label="URL" required error={errors.url} hint={f.mode === 'SANDBOX' ? t('admin.apiKeys.urlHintSandbox') : t('admin.apiKeys.urlHintLive')}>
          <Input value={f.url} maxLength={500} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://hooks.example.com/institution" />
        </FormField>
        <FormField label={t('admin.apiKeys.eventsLabel', { count: f.events.length })} error={errors.events}>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {Object.entries(byModule).map(([mod, evs]) => (
              <div key={mod} className="p-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-muted w-full sm:w-28 shrink-0 capitalize">{cl.module(mod)}</span>
                {evs.map((e) => <Chip key={e.event} on={f.events.includes(e.event)} onClick={() => toggle(e.event)}>{t(eventKey(e.event), { defaultValue: e.label })}</Chip>)}
              </div>
            ))}
          </div>
        </FormField>
      </div>
    </Modal>
  )
}

function Deliveries({ endpointId, compact }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [page, setPage] = useState(1)
  const params = { page, pageSize: compact ? 10 : 30 }
  const { data, isLoading } = useQuery({ queryKey: ['webhook-deliveries', endpointId ?? 'all', params], queryFn: () => fetchWebhookDeliveries(endpointId, params), placeholderData: (p) => p, refetchInterval: 15_000 })
  const again = useMutation({ mutationFn: (id) => redeliverWebhook(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhook-deliveries'] }); showSuccess(t('admin.apiKeys.queuedAgain')) }, onError: (e) => showError(errText(e)) })
  const meta = data?.meta
  return (
    <DataTable rows={data?.data ?? []} loading={isLoading} dense={compact}
      columns={[
        { key: 'createdAt', header: t('admin.apiKeys.cols.when'), nowrap: true, render: (v) => <DateCell value={v} time /> },
        !endpointId && { key: 'endpointName', header: t('admin.apiKeys.cols.webhook'), render: (v) => (v ? <ColorChip label={v} seed={v} icon={Webhook} /> : <span className="text-ink-faint">—</span>) },
        { key: 'event', header: t('admin.apiKeys.cols.event'), mobilePrimary: true, render: (v, d) => <div><p className="text-sm font-mono">{v}</p><p className="text-[11px] text-ink-faint font-mono">{d.deliveryId}</p></div> },
        { key: 'status', header: t('common.status'), render: (v, d) => <div><StatusPill tone={WEBHOOK_DELIVERY_STATUSES[v]?.tone}>{t(`admin.apiKeys.deliveryStatus.${v}`, { defaultValue: WEBHOOK_DELIVERY_STATUSES[v]?.label ?? v })}</StatusPill><p className="text-[11px] text-ink-faint">{[d.responseStatus && `HTTP ${d.responseStatus}`, d.attempts && t('admin.apiKeys.attempts', { count: d.attempts }), d.error].filter(Boolean).join(' · ')}</p></div> },
        { key: 'actions', header: '', align: 'right', render: (_, d) => !d.test && ['FAILED', 'SUCCESS'].includes(d.status) && (
          <span onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" icon={RotateCcw} requires="core.api-keys.edit" loading={again.isPending && again.variables === d.id} onClick={() => again.mutate(d.id)}>{t('admin.apiKeys.sendAgain')}</Button></span>
        ) },
      ].filter(Boolean)}
      pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
      emptyIcon={Send} emptyTitle={t('admin.apiKeys.noDeliveries')} />
  )
}

function WebhooksTab({ meta }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const [reveal, setReveal] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: fetchWebhooks })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); qc.invalidateQueries({ queryKey: ['webhook-deliveries'] }) }
  const test = useMutation({ mutationFn: (id) => testWebhook(id), onSuccess: (d) => { setTestResult(d); refresh() }, onError: (e) => showError(errText(e)) })
  const rotate = useMutation({ mutationFn: (id) => rotateWebhookSecret(id), onSuccess: (r) => { setReveal({ title: t('admin.apiKeys.newSecretTitle', { name: r.webhook.name }), secret: r.secret }); setOpen(r.webhook); refresh() }, onError: (e) => showError(errText(e)) })
  const toggle = useMutation({ mutationFn: (h) => updateWebhook(h.id, { active: !h.active }), onSuccess: (h) => { setOpen(h); refresh(); showSuccess(h.active ? t('admin.apiKeys.webhookOn') : t('admin.apiKeys.webhookPaused')) }, onError: (e) => showError(errText(e)) })
  const remove = async (h) => {
    if (!(await confirm({ title: t('admin.apiKeys.removeConfirm.title', { name: h.name }), message: t('admin.apiKeys.removeConfirm.message'), tone: 'danger', confirmLabel: t('actions.remove') }))) return
    try { await deleteWebhook(h.id); setOpen(null); refresh(); showSuccess(t('admin.apiKeys.webhookRemoved')) } catch (e) { showError(errText(e)) }
  }
  const askRotate = async (h) => {
    if (await confirm({ title: t('admin.apiKeys.rotateConfirm.title'), message: t('admin.apiKeys.rotateConfirm.message'), confirmLabel: t('admin.apiKeys.rotateConfirm.confirm') })) rotate.mutate(h.id)
  }
  const host = (u) => { try { return new URL(u).host } catch { return u } }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Note className="flex-1 min-w-[240px]"><Trans t={t} i18nKey="admin.apiKeys.webhooksNote" values={{ sig: 'X-Webhook-Signature: t=…,v1=…', body: 't.body', id: 'X-Webhook-Id', minutes: meta.retryMinutes.join(', ') }} components={{ code: <code /> }} /></Note>
        <Button icon={Plus} requires="core.api-keys.create" onClick={() => setEditing('new')}>{t('admin.apiKeys.newWebhook')}</Button>
      </div>
      <DataTable rows={rows} loading={isLoading} onRowClick={(h) => { setTestResult(null); setOpen(h) }}
        columns={[
          { key: 'name', header: t('admin.apiKeys.cols.webhook'), mobilePrimary: true, render: (v, h) => <div className="flex items-start gap-3"><span className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 bg-sky-50 text-sky-700 border-sky-200"><Webhook className="w-4 h-4" /></span><div className="min-w-0"><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono truncate max-w-[280px]">{host(h.url)}</p></div></div> },
          { key: 'events', header: t('admin.apiKeys.cols.events'), render: (v) => <ColorChip label={String(v?.length ?? 0)} tone="info" icon={ListChecks} /> },
          { key: 'mode', header: t('admin.apiKeys.mode'), render: (v) => (v === 'SANDBOX' ? <ColorChip label={t('admin.apiKeys.sandbox')} tone="orange" icon={FlaskConical} /> : <ColorChip label={t('admin.apiKeys.live')} tone="success" icon={Radio} />) },
          { key: 'lastStatus', header: t('admin.apiKeys.cols.lastDelivery'), render: (v, h) => (v ? <div className="flex flex-col items-start gap-0.5"><StatusPill tone={WEBHOOK_DELIVERY_STATUSES[v]?.tone}>{t(`admin.apiKeys.deliveryStatus.${v}`, { defaultValue: WEBHOOK_DELIVERY_STATUSES[v]?.label ?? v })}</StatusPill><DateCell value={h.lastDeliveryAt} time relative={false} className="text-[11px]" /></div> : <span className="text-ink-faint">—</span>) },
          { key: 'active', header: t('ui.common.on'), render: (v, h) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('ui.common.on') : h.failures >= 25 ? t('admin.apiKeys.pausedFailing') : t('admin.apiKeys.paused')}</StatusPill> },
        ]}
        emptyIcon={Webhook} emptyTitle={t('admin.apiKeys.noWebhooks')} emptyHint={t('admin.apiKeys.noWebhooksHint')} />
      <Drawer open={!!open} onClose={() => setOpen(null)} size="lg" subtitle={t('admin.apiKeys.cols.webhook')} title={open?.name}
        footer={open && (
          <div className="flex flex-wrap gap-2 w-full">
            <Button variant="secondary" icon={Send} requires="core.api-keys.edit" loading={test.isPending} onClick={() => test.mutate(open.id)}>{t('admin.apiKeys.sendTest')}</Button>
            <Button variant="secondary" icon={Pencil} requires="core.api-keys.edit" onClick={() => setEditing(open)}>{t('actions.edit')}</Button>
            <Button variant="ghost" icon={KeyRound} requires="core.api-keys.edit" onClick={() => askRotate(open)}>{t('admin.apiKeys.rotateSecret')}</Button>
            <Button variant="ghost" icon={Power} requires="core.api-keys.edit" onClick={() => toggle.mutate(open)}>{open.active ? t('admin.apiKeys.pause') : t('admin.apiKeys.turnOn')}</Button>
            <Button variant="ghost" icon={Trash2} requires="core.api-keys.delete" className="ms-auto text-danger-600" onClick={() => remove(open)}>{t('actions.remove')}</Button>
          </div>
        )}>
        {open && (
          <div className="space-y-4">
            {testResult && <Note tone={testResult.status === 'SUCCESS' ? 'success' : 'danger'}>{testResult.status === 'SUCCESS' ? t('admin.apiKeys.testDelivered', { status: testResult.responseStatus, ms: testResult.latencyMs }) : t('admin.apiKeys.testFailed', { error: testResult.error ?? `HTTP ${testResult.responseStatus}` })}</Note>}
            <DefinitionGrid items={[
              { label: 'URL', value: open.url, mono: true, full: true },
              { label: t('admin.apiKeys.mode'), value: open.mode === 'SANDBOX' ? t('admin.apiKeys.sandbox') : t('admin.apiKeys.live') },
              { label: t('admin.apiKeys.signingSecret'), value: open.secretHint, mono: true },
              { label: t('admin.apiKeys.consecutiveFailures'), value: open.failures ?? 0 },
              { label: t('admin.apiKeys.added'), value: `${dateTime(open.createdAt)}${open.createdBy ? ` · ${open.createdBy}` : ''}` },
              { label: t('admin.apiKeys.cols.events'), value: (open.events ?? []).map((e) => t(eventKey(e), { defaultValue: meta.events.find((x) => x.event === e)?.label ?? e })).join(', '), full: true },
            ]} />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">{t('admin.apiKeys.recentDeliveries')}</p>
              <Deliveries endpointId={open.id} compact />
            </div>
          </div>
        )}
      </Drawer>
      {editing && <WebhookModal meta={meta} hook={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(r) => {
        setEditing(null); refresh()
        if (r.secret) setReveal({ title: t('admin.apiKeys.secretTitle', { name: r.webhook.name }), secret: r.secret }); else { setOpen(r); showSuccess(t('common.saved')) }
      }} />}
      <RevealOnceModal open={!!reveal} onClose={() => setReveal(null)} title={reveal?.title} secret={reveal?.secret} />
    </div>
  )
}

/** Administration › API keys & webhooks: scoped keys for other systems, and signed event webhooks out. */
export default function ApiKeys() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState('keys')
  const { data: meta } = useQuery({ queryKey: ['api-keys', 'meta'], queryFn: fetchApiKeysMeta, staleTime: 300_000 })
  return (
    <PageContainer>
      <PageHeader icon={KeyRound} title={t('admin.apiKeys.title')} subtitle={t('admin.apiKeys.subtitle')}
        actions={hasPermission('core.api-keys.view') && <HeaderButton icon={Webhook} onClick={() => setTab('deliveries')}>{t('admin.apiKeys.deliveryLog')}</HeaderButton>} />
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: 'keys', label: t('admin.apiKeys.tabs.keys') }, { value: 'webhooks', label: t('admin.apiKeys.tabs.webhooks') }, { value: 'deliveries', label: t('admin.apiKeys.deliveryLog') }]} />
        <div className="p-4 bg-bg/40 rounded-b-xl">
          {!meta ? <div className="h-64 rounded-xl bg-black/5 animate-pulse" /> : (
            <>
              {tab === 'keys' && <KeysTab meta={meta} />}
              {tab === 'webhooks' && <WebhooksTab meta={meta} />}
              {tab === 'deliveries' && <Deliveries />}
            </>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
