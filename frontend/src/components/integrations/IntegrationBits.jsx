import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, PlugZap } from 'lucide-react'
import { HEALTH_STATUSES, INTEGRATION_MODES } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, Panel, SegmentedControl, StatusPill } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'
import i18n from '../../i18n'

export const errText = (e) => e?.response?.data?.message ?? e?.message ?? i18n.t('integrations:integrations.bits.somethingWrong')
export const fieldErrors = (e) => e?.response?.data?.details?.fields ?? {}

// Translated labels for the shared integration definitions (packages/shared/src/integrations.js),
// keyed by code / provider id; each falls back to the English label of the definition.
export const providerLabel = (t, p) => t(`integrations.providers.${p.id}.label`, { defaultValue: p.label })
export const providerDesc = (t, p) => (p.desc ? t(`integrations.providers.${p.id}.desc`, { defaultValue: p.desc }) : '')
/** Label / hint of a provider field or secret (`kind` 'fields' | 'secrets'). */
export const fieldLabel = (t, p, f, kind = 'fields') => t(`integrations.providers.${p.id}.${kind}.${f.key}.label`, { defaultValue: f.label })
export const fieldHint = (t, p, f, kind = 'fields') => (f.hint ? t(`integrations.providers.${p.id}.${kind}.${f.key}.hint`, { defaultValue: f.hint }) : undefined)
export const healthLabel = (t, code) => t(`integrations.health.${code}`, { defaultValue: HEALTH_STATUSES[code]?.label ?? code })
export const modeOptions = (t) => INTEGRATION_MODES.map((m) => ({ value: m.value, label: t(`integrations.mode.${m.value}`, { defaultValue: m.label }) }))

export function HealthPill({ health }) {
  const { t } = useTranslation('integrations')
  const code = HEALTH_STATUSES[health?.status] ? health.status : 'UNKNOWN'
  return <StatusPill tone={HEALTH_STATUSES[code].tone}>{healthLabel(t, code)}</StatusPill>
}

/** Copy-to-clipboard button. */
export function CopyButton({ value, label }) {
  const { t } = useTranslation('integrations')
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ }
  }
  return <Button size="sm" variant="secondary" icon={done ? Check : Copy} onClick={copy} aria-label={label ?? t('integrations.bits.copy')}>{done ? t('integrations.bits.copied') : label ?? t('integrations.bits.copy')}</Button>
}

/** A read-only value the admin pastes somewhere else (webhook URL, callback URL). */
export function CopyField({ label, value, hint }) {
  return (
    <FormField label={label} hint={hint}>
      <div className="flex gap-2 min-w-0">
        <Input readOnly value={value ?? ''} className="font-mono text-xs min-w-0" onFocus={(e) => e.target.select()} />
        <CopyButton value={value ?? ''} />
      </div>
    </FormField>
  )
}

/** Password-style input for a stored secret: blank keeps the saved one. */
export function SecretField({ label, hint, state, value, onChange, disabled, error }) {
  const { t } = useTranslation('integrations')
  return (
    <FormField label={label} error={error} hint={state?.set ? t('integrations.bits.secretSaved', { last4: state.last4 ?? '••••' }) : hint}>
      <Input type="password" autoComplete="new-password" value={value ?? ''} disabled={disabled} placeholder={state?.set ? `••••••••${state.last4 ?? ''}` : ''} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  )
}

/** Shows a key / secret exactly once. */
export function RevealOnceModal({ open, onClose, title, secret, children }) {
  const { t } = useTranslation('integrations')
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<Button onClick={onClose}>{t('integrations.bits.savedIt')}</Button>}>
      <div className="space-y-3">
        <Note tone="warning" icon={KeyRound}>{t('integrations.bits.copyNow')}</Note>
        <div className="rounded-lg border border-border bg-bg p-3 font-mono text-xs break-all text-ink select-all">{secret}</div>
        <CopyButton value={secret ?? ''} />
        {children}
      </div>
    </Modal>
  )
}

/**
 * Provider settings panel: on/off, sandbox/live, plain fields and secrets from the provider
 * definition (packages/shared integrations.js), save and test connection.
 */
/** `modes={false}`: the provider's sandbox / live is not this institution's choice (ABDM: the platform account's). */
export function ProviderConfigPanel({ provider, saved, onSave, onTest, canConfigure, children, title, modes = true }) {
  const { t } = useTranslation('integrations')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { dateTime } = useFormat()
  const name = providerLabel(t, provider)
  const blank = () => ({ enabled: !!saved.enabled, mode: saved.mode ?? 'SANDBOX', settings: { ...(saved.settings ?? {}) }, secrets: {} })
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  useEffect(() => { setForm(blank()); setErrors({}) }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = form.enabled !== !!saved.enabled || form.mode !== (saved.mode ?? 'SANDBOX')
    || provider.fields.some((f) => (form.settings[f.key] ?? '') !== (saved.settings?.[f.key] ?? ''))
    || Object.values(form.secrets).some((v) => v)
  const save = useMutation({
    mutationFn: () => onSave({
      enabled: form.enabled, mode: form.mode,
      settings: Object.fromEntries(provider.fields.map((f) => [f.key, form.settings[f.key] ?? ''])),
      secrets: Object.fromEntries(Object.entries(form.secrets).filter(([, v]) => v)),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); setErrors({}); showSuccess(t('integrations.bits.providerSaved', { name })) },
    onError: (e) => { setErrors(fieldErrors(e)); showError(errText(e)) },
  })
  const test = useMutation({ mutationFn: onTest, onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['integrations'] }) }, onError: (e) => showError(errText(e)) })
  const disabled = !canConfigure
  return (
    <Panel title={title ?? name} subtitle={providerDesc(t, provider)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch checked={form.enabled} disabled={disabled} onChange={(enabled) => setForm((f) => ({ ...f, enabled }))} label={t('integrations.bits.useProvider', { name })} />
          <span className="text-sm text-ink">{form.enabled ? t('ui.common.on') : t('ui.common.off')}</span>
          {modes && <SegmentedControl value={form.mode} onChange={(mode) => !disabled && setForm((f) => ({ ...f, mode }))} options={modeOptions(t)} />}
          <span className="ms-auto flex items-center gap-2 text-xs text-ink-muted">
            <HealthPill health={saved.health} />
            {saved.health?.checkedAt && <span>{dateTime(saved.health.checkedAt)}</span>}
          </span>
        </div>
        {saved.health?.message && saved.health.status !== 'OK' && <Note tone="warning">{saved.health.message}</Note>}
        {modes && form.mode === 'LIVE' && <Note tone="warning">{t('integrations.bits.liveWarning')}</Note>}
        <div className="grid sm:grid-cols-2 gap-3">
          {provider.fields.map((f) => (
            <FormField key={f.key} label={fieldLabel(t, provider, f)} hint={fieldHint(t, provider, f)} error={errors[`settings.${f.key}`]}>
              <Input value={form.settings[f.key] ?? ''} disabled={disabled} placeholder={f.placeholder} autoComplete="off" onChange={(e) => setForm((x) => ({ ...x, settings: { ...x.settings, [f.key]: e.target.value } }))} />
            </FormField>
          ))}
          {provider.secrets.map((s) => (
            <SecretField key={s.key} label={fieldLabel(t, provider, s, 'secrets')} hint={fieldHint(t, provider, s, 'secrets')} state={saved.secrets?.[s.key]} value={form.secrets[s.key]} disabled={disabled} error={errors[`secrets.${s.key}`]}
              onChange={(v) => setForm((x) => ({ ...x, secrets: { ...x.secrets, [s.key]: v } }))} />
          ))}
        </div>
        {children}
        {canConfigure && (
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border">
            <Button icon={Check} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
            {dirty && <Button variant="ghost" onClick={() => { setForm(blank()); setErrors({}) }}>{t('integrations.bits.undoChanges')}</Button>}
            {onTest && <Button variant="secondary" icon={PlugZap} className="ms-auto" disabled={dirty} title={dirty ? t('integrations.bits.saveFirst') : undefined} loading={test.isPending} onClick={() => test.mutate()}>{t('integrations.bits.testConnection')}</Button>}
          </div>
        )}
        {result && <Note tone={result.ok ? 'success' : 'danger'}>{result.message}{result.latencyMs ? ` (${t('integrations.bits.ms', { ms: result.latencyMs })})` : ''}</Note>}
        {saved.updatedBy && <p className="text-[11px] text-ink-faint">{t('integrations.bits.lastChangedBy', { name: saved.updatedBy })}{saved.updatedAt ? ` · ${dateTime(saved.updatedAt)}` : ''}</p>}
      </div>
    </Panel>
  )
}
