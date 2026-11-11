import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, CheckCheck, Clock, Mail, MessageCircle, RotateCcw, ScrollText, Smartphone, TriangleAlert } from 'lucide-react'
import { MESSAGE_STATUSES, NOTIFY_EVENT_BY, SEND_CHANNELS } from '@schoolgiant/shared'
import { DateInput, ColorChip, ControlChip, DataTable, DateCell, PageContainer, PageHeader, PersonCell, StatCardRow, StatusPill, Toolbar } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchMessageLog, retryLoggedMessage } from '../../api/communication'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

// each channel's icon, wherever a message's channel is shown
const CHANNEL_ICON = { SMS: Smartphone, WHATSAPP: MessageCircle, EMAIL: Mail }

/** Every SMS, WhatsApp and email to families: what was sent, to whom, whether it arrived — and retry. */
export default function Log() {
  const { t } = useTranslation('communication')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, status: status || undefined, channel: channel || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['message-log', params], queryFn: () => fetchMessageLog(params), placeholderData: keepPreviousData })
  const retry = useMutation({ mutationFn: (id) => retryLoggedMessage(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['message-log'] }); showSuccess(t('communication.log.retried')) }, onError: (e) => showError(e.message) })
  const STATUSES = ['', ...Object.keys(MESSAGE_STATUSES)]
  const statusLabel = (s) => (s ? t(`communication.log.status.${s}`, MESSAGE_STATUSES[s]?.label) : t('communication.all'))
  const CHANNELS = ['', ...SEND_CHANNELS]
  const channelLabel = (c) => (c ? t(`communication.channels.${c}`) : t('communication.all'))
  const week = data?.meta?.last7Days ?? {}
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={ScrollText} title={t('communication.log.title')} subtitle={t('communication.log.subtitle')} />
      <StatCardRow className="mb-4" items={[
        { icon: CheckCheck, label: t('communication.log.week.sent'), value: week.SENT ?? 0, tone: 'success' },
        { icon: Clock, label: t('communication.log.week.queued'), value: (week.QUEUED ?? 0) + (week.SENDING ?? 0), tone: 'info' },
        { icon: TriangleAlert, label: t('communication.log.week.failed'), value: week.FAILED ?? 0, tone: week.FAILED ? 'danger' : 'neutral' },
        { icon: Ban, tone: 'violet', label: t('communication.log.week.skipped'), value: week.SKIPPED ?? 0 },
      ]} />
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable={hasPermission('communication.log.export')} exportName="message-log"
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('communication.log.search')} right={<>
          <DateInput className="w-36" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label={t('communication.log.from')} />
          <DateInput className="w-36" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label={t('communication.log.to')} />
          <ControlChip label={t('communication.log.channel')} value={channelLabel(channel)} active={!!channel} options={CHANNELS.map(channelLabel)} onChange={(v) => { setChannel(CHANNELS.find((c) => channelLabel(c) === v) ?? ''); setPage(1) }} />
          <ControlChip label={t('communication.statusLabel')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />
        </>} />}
        columns={[
          { key: 'createdAt', header: t('communication.log.when'), nowrap: true, render: (v) => <DateCell value={v} time /> },
          { key: 'event', header: t('communication.log.what'), render: (v) => (v ? <ColorChip label={t(`communication.log.events.${v.replace(/\./g, '_')}`, NOTIFY_EVENT_BY[v]?.label ?? v)} seed={v} dot /> : '—') },
          { key: 'studentName', header: t('communication.log.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.to ?? undefined} size={28} /> },
          { key: 'channel', header: t('communication.log.channel'), render: (v) => <ColorChip label={t(`communication.channels.${v}`, v)} seed={`channel-${v}`} icon={CHANNEL_ICON[v]} /> },
          { key: 'body', header: t('communication.log.message'), mobileHidden: true, render: (v) => <span className="text-xs text-ink-muted line-clamp-2">{v}</span> },
          { key: 'status', header: t('communication.statusLabel'), render: (v, r) => <div><StatusPill tone={MESSAGE_STATUSES[v]?.tone}>{statusLabel(v)}</StatusPill>{r.reason && <p className="text-xs text-ink-faint mt-0.5 line-clamp-2">{r.reason}</p>}{r.delivery?.status && <p className="text-xs text-ink-faint">{r.delivery.status}</p>}</div> },
          { key: 'id', header: '', align: 'right', width: 60, render: (id, r) => ['FAILED', 'SKIPPED'].includes(r.status) && hasPermission('communication.messages.send') && (
            <Button size="sm" variant="ghost" icon={RotateCcw} title={t('communication.log.retry')} aria-label={t('communication.log.retry')} onClick={() => retry.mutate(id)} />
          ) },
        ]}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={ScrollText} emptyTitle={t('communication.log.empty')}
      />
    </PageContainer>
  )
}
