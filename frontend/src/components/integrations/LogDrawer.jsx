import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { LOG_PROVIDERS, LOG_STATUSES } from '@schoolgiant/shared'
import { Drawer, Note, StatusPill } from '../system'
import Button from '../ui/Button'
import { DefinitionGrid } from '../app/Controls'
import { fetchIntegrationLog, retryIntegrationLog } from '../../api/integrations'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { errText } from './IntegrationBits'

const PROVIDER_LABEL = Object.fromEntries(LOG_PROVIDERS.map((p) => [p.value, p.label]))
export const logProviderLabel = (t, v) => (PROVIDER_LABEL[v] ? t(`integrations.logs.provider.${v}`, { defaultValue: PROVIDER_LABEL[v] }) : v)
export const logStatusLabel = (t, v) => (LOG_STATUSES[v] ? t(`integrations.logs.status.${v}`, { defaultValue: LOG_STATUSES[v].label }) : v)

/** One integration log row: what was called, how it went, and the redacted outline. Failed safe calls can be tried again. */
export default function LogDrawer({ id, onClose }) {
  const { t } = useTranslation('integrations')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: l } = useQuery({ queryKey: ['integrations', 'log', id], queryFn: () => fetchIntegrationLog(id), enabled: !!id })
  const retry = useMutation({
    mutationFn: () => retryIntegrationLog(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      if (r.kind === 'REDELIVER') showSuccess(t('integrations.logs.requeued'))
      else if (r.ok) showSuccess(r.message ?? t('integrations.logs.retryOk'))
      else showError(r.message ?? t('integrations.logs.retryFailed'))
    },
    onError: (e) => showError(errText(e)),
  })
  return (
    <Drawer open={!!id} onClose={onClose} subtitle={l ? logProviderLabel(t, l.provider) : t('integrations.logs.entry')} title={l?.operation ?? '…'}
      footer={l?.retry && <Button icon={RotateCcw} loading={retry.isPending} onClick={() => retry.mutate()}>{l.retry === 'REDELIVER' ? t('integrations.logs.redeliver') : t('integrations.logs.testAgain')}</Button>}>
      {!l ? <div className="h-48 rounded-lg bg-black/5 animate-pulse" /> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <StatusPill tone={LOG_STATUSES[l.status]?.tone}>{logStatusLabel(t, l.status)}</StatusPill>
            <span className="text-xs text-ink-muted">{l.direction === 'IN' ? t('integrations.logs.incoming') : t('integrations.logs.outgoing')}</span>
          </div>
          {l.error && <Note tone="danger">{l.error}</Note>}
          <DefinitionGrid items={[
            { label: t('integrations.common.when'), value: dateTime(l.createdAt) },
            { label: t('integrations.logs.httpStatus'), value: l.httpStatus, mono: true },
            { label: t('integrations.logs.timeTaken'), value: l.latencyMs != null ? t('integrations.bits.ms', { ms: l.latencyMs }) : null },
            { label: t('integrations.logs.attempts'), value: l.attempts },
            { label: t('integrations.logs.requestId'), value: l.requestId, mono: true, full: true },
            { label: t('integrations.logs.providerRef'), value: l.ref, mono: true },
            l.entityType && { label: t('integrations.logs.record'), value: `${l.entityType} ${l.entityId ?? ''}`, mono: true },
          ]} />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">{t('integrations.logs.outline')}</p>
            <pre className="text-[11px] rounded-lg bg-bg border border-border p-3 overflow-x-auto whitespace-pre-wrap break-all text-ink-muted max-h-96">{l.summary ? JSON.stringify(l.summary, null, 2) : '—'}</pre>
            <p className="text-[11px] text-ink-faint mt-1">{t('integrations.logs.outlineHint')}</p>
          </div>
        </div>
      )}
    </Drawer>
  )
}
