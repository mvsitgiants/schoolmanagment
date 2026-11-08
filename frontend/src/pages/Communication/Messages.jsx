import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessageSquareText, Send } from 'lucide-react'
import { SEND_CHANNELS, SMS_MAX } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Note, PageContainer, PageHeader, Panel, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import AudiencePicker, { emptyAudience } from '../../components/communication/AudiencePicker'
import { fetchBroadcasts, sendBroadcast } from '../../api/communication'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** One-off messages to families: write it, pick who gets it and how, send. Every send is listed with its delivery. */
export default function Messages() {
  const { t } = useTranslation('communication')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState({ subject: '', text: '', audience: emptyAudience(), channels: ['WHATSAPP'] })
  const [errors, setErrors] = useState({})
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['broadcasts', page], queryFn: () => fetchBroadcasts({ page, pageSize: 25 }), placeholderData: keepPreviousData })
  const sms = form.channels.includes('SMS')
  const tooLong = sms && form.text.length > SMS_MAX
  const send = useMutation({
    mutationFn: () => sendBroadcast(form),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['broadcasts'] }); setForm((f) => ({ ...f, subject: '', text: '' })); setErrors({}); showSuccess(t('communication.messages.sent', { count: r.recipients, queued: r.queued, skipped: r.skipped })) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const toggle = (c) => setForm((f) => ({ ...f, channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c] }))
  const canSend = hasPermission('communication.messages.send')
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={MessageSquareText} title={t('communication.messages.title')} subtitle={t('communication.messages.subtitle')} />
      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4 items-start">
        {canSend && (
          <Panel title={t('communication.messages.compose')}>
            <div className="space-y-4">
              <AudiencePicker value={form.audience} onChange={(audience) => setForm((f) => ({ ...f, audience }))} />
              {errors.audience && <p className="text-xs text-danger-600">{errors.audience}</p>}
              <div>
                <p className="text-xs font-medium text-ink-muted mb-1.5">{t('communication.messages.how')}</p>
                <div className="flex flex-wrap gap-4">
                  {SEND_CHANNELS.map((c) => <label key={c} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.channels.includes(c)} onChange={() => toggle(c)} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t(`communication.channels.${c}`)}</label>)}
                </div>
              </div>
              {form.channels.includes('EMAIL') && <FormField label={t('communication.messages.subject')}><Input value={form.subject} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></FormField>}
              <FormField label={t('communication.messages.text')} required error={errors.text} hint={sms ? t('communication.messages.smsCount', { n: form.text.length, max: SMS_MAX }) : undefined}>
                <Textarea rows={5} value={form.text} maxLength={2000} error={tooLong} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} placeholder={t('communication.messages.placeholder')} />
              </FormField>
              {sms && <Note tone="warning">{t('communication.messages.dltHint')}</Note>}
              <Button className="w-full" icon={Send} loading={send.isPending} disabled={form.text.trim().length < 3 || !form.channels.length || tooLong}
                onClick={async () => { if (await confirm({ title: t('communication.messages.confirmTitle'), message: t('communication.messages.confirmHint'), confirmLabel: t('communication.messages.send') })) send.mutate() }}>
                {t('communication.messages.send')}
              </Button>
            </div>
          </Panel>
        )}
        <DataTable
          title={t('communication.messages.history')}
          rows={data?.data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          columns={[
            { key: 'text', header: t('communication.messages.text'), mobilePrimary: true, render: (v, r) => <div><p className="text-sm text-ink line-clamp-2">{r.subject ? <b>{r.subject} · </b> : null}{v}</p><p className="text-xs text-ink-faint">{dateTime(r.createdAt)} · {r.sentBy}</p></div> },
            { key: 'channels', header: t('communication.messages.how'), render: (v) => <span className="text-xs text-ink-muted">{v.map((c) => t(`communication.channels.${c}`)).join(', ')}</span> },
            { key: 'recipients', header: t('communication.messages.families'), align: 'right' },
            { key: 'delivery', header: t('communication.messages.delivery'), render: (d) => <span className="text-xs"><span className="text-success-700">{t('communication.messages.sentN', { n: d.sent })}</span>{d.queued ? <span className="text-ink-muted"> · {t('communication.messages.queuedN', { n: d.queued })}</span> : null}{d.failed ? <span className="text-danger-600"> · {t('communication.messages.failedN', { n: d.failed })}</span> : null}{d.skipped ? <span className="text-ink-faint"> · {t('communication.messages.skippedN', { n: d.skipped })}</span> : null}</span> },
          ]}
          pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
          emptyIcon={MessageSquareText} emptyTitle={t('communication.messages.empty')}
        />
      </div>
    </PageContainer>
  )
}
