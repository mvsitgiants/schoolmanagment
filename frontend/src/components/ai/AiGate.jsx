import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, KeyRound, ShieldCheck, Sparkles } from 'lucide-react'
import { FormField, Input, Note, Panel, SkeletonLines } from '../system'
import Button from '../ui/Button'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { fetchAiKey, fetchAiStatus, saveAiKey } from '../../api/ai'

const NS = 'ai'

/** Is AI set up for this institution, and this month's use (GET /ai/status). */
export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: fetchAiStatus, staleTime: 30_000 })
}

/** True when an error is the server's "AI is not set up" answer. */
export const isAiUnavailable = (err) => err?.response?.data?.code === 'AI_UNAVAILABLE'

/**
 * The friendly "AI is not set up yet" state: what the feature will do once it is, and who switches it on.
 * `feature`: assistant | questionPapers | remarks (the bullet points under ai.unavailable.<feature>).
 */
export function AiUnavailable({ feature }) {
  const { t } = useTranslation(NS)
  const points = [1, 2, 3].map((n) => t(`ai.unavailable.${feature}.p${n}`))
  return (
    <Panel className="overflow-hidden" flush>
      <div className="grid lg:grid-cols-[1.1fr_1fr]">
        <div className="p-6 sm:p-8 flex flex-col gap-4">
          <span className="h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-400 to-violet-500 text-white flex items-center justify-center shadow-card">
            <Sparkles className="w-6 h-6" aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">{t('ai.unavailable.title')}</h2>
            <p className="text-sm text-ink-muted mt-1.5 max-w-lg leading-relaxed">{t('ai.unavailable.body')}</p>
          </div>
          <ul className="space-y-2.5">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-ink">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-brand-500" aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-bg/70 border-t lg:border-t-0 lg:border-s border-border p-6 sm:p-8 flex flex-col gap-4 justify-center">
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 rounded-lg bg-surface border border-border text-ink-muted flex items-center justify-center shrink-0"><KeyRound className="w-4 h-4" aria-hidden /></span>
            <div>
              <p className="text-sm font-semibold text-ink">{t('ai.unavailable.howTitle')}</p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">{t('ai.unavailable.how')}</p>
            </div>
          </div>
          <AiKeyForm />
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 rounded-lg bg-surface border border-border text-ink-muted flex items-center justify-center shrink-0"><ShieldCheck className="w-4 h-4" aria-hidden /></span>
            <div>
              <p className="text-sm font-semibold text-ink">{t('ai.unavailable.privacyTitle')}</p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">{t('ai.unavailable.privacy')}</p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

/** Renders `children` once AI is set up; the not-set-up state (or a loading skeleton) until then. */
export default function AiGate({ feature, children }) {
  const { t } = useTranslation(NS)
  const { data, isLoading, error } = useAiStatus()
  if (isLoading) return <Panel><SkeletonLines lines={4} /></Panel>
  if (error) return <Note tone="danger">{error.message || t('ai.common.loadFailed')}</Note>
  if (!data?.configured) return <AiUnavailable feature={feature} />
  return children
}

/** The institution's own Claude API key (admins only): write-only, the screen sees only whether it is set and its last 4. */
export function AiKeyForm() {
  const { t } = useTranslation(NS)
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const allowed = hasPermission('core.settings.edit') || hasPermission('integrations.payments.configure')
  const { data: cfg } = useQuery({ queryKey: ['ai-key'], queryFn: fetchAiKey, enabled: allowed })
  const [key, setKey] = useState('')
  const save = useMutation({
    mutationFn: () => saveAiKey({ enabled: true, apiKey: key }),
    onSuccess: () => { setKey(''); qc.invalidateQueries({ queryKey: ['ai-key'] }); qc.invalidateQueries({ queryKey: ['ai-status'] }); showSuccess(t('ai.key.saved')) },
    onError: (e) => showError(e.message),
  })
  if (!allowed) return null
  const set = cfg?.secrets?.apiKey?.set
  return (
    <form className="rounded-xl border border-border bg-surface p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save.mutate() }}>
      <FormField label={t('ai.key.label')} hint={set ? t('ai.key.saved4', { last4: cfg.secrets.apiKey.last4 }) : t('ai.key.hint')}>
        <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
      </FormField>
      <Button type="submit" size="sm" icon={KeyRound} loading={save.isPending} disabled={!key.trim()}>{set ? t('ai.key.replace') : t('ai.key.save')}</Button>
    </form>
  )
}
