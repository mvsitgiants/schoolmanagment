import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Banknote, CheckCircle2, Lock, Receipt, Scale } from 'lucide-react'
import { DAY_END_STATUS, PAYMENT_MODES, formatINR, toPaise } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Note, PageContainer, PageHeader, Panel, StatCardRow, StatusPill, Tabs, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { approveDayVariance, closeFeeDay, fetchDayClosings, fetchDaySummary } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const signed = (v) => (v > 0 ? `+${formatINR(v)}` : v < 0 ? `−${formatINR(-v)}` : formatINR(0))

/** My day at the counter: what I took by mode, the cash I should hold, and closing it. */
function MyDay() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { time } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [day, setDay] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const { data: sum, isLoading, error, refetch } = useQuery({ queryKey: ['fee-day', day], queryFn: () => fetchDaySummary({ date: day || undefined }) })
  const variance = counted === '' || !sum ? null : toPaise(counted) - sum.expectedCash
  const close = useMutation({
    mutationFn: () => closeFeeDay({ date: sum.date, cashCounted: toPaise(counted), note: note || undefined }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['fee-day'] }); qc.invalidateQueries({ queryKey: ['fee-day-closings'] })
      setCounted(''); setNote('')
      showSuccess(d.variance ? t('fees.dayEnd.closedVariance', { amount: signed(d.variance) }) : t('fees.dayEnd.closed'))
    },
    onError: (e) => showError(e.message),
  })
  const modeLabel = (v) => t(`fees.modes.${v}`, PAYMENT_MODES.find((m) => m.value === v)?.label ?? v)
  const modes = Object.entries(sum?.byMode ?? {})

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <FormField label={t('fees.dayEnd.date')}><Input type="date" className="w-44" value={day || sum?.date || ''} onChange={(e) => setDay(e.target.value)} /></FormField>
      </div>
      {isLoading && <p className="text-sm text-ink-faint">{t('fees.loading')}</p>}
      {error && <Note tone="warning" actions={<Button size="sm" variant="secondary" onClick={() => refetch()}>{t('fees.retry')}</Button>}>{error.message}</Note>}
      {sum && <>
        <StatCardRow items={[
          { icon: Receipt, label: t('fees.dayEnd.receipts'), value: sum.receipts.length, sub: sum.refunds ? t('fees.dayEnd.refundsSub', { count: sum.refunds }) : undefined },
          { icon: Scale, label: t('fees.dayEnd.total'), value: formatINR(sum.total) },
          { icon: Banknote, label: t('fees.dayEnd.expectedCash'), value: formatINR(sum.expectedCash), tone: 'info' },
        ]} />
        <div className="grid lg:grid-cols-[1fr_22rem] gap-4 items-start">
          <div className="space-y-4">
            {modes.length > 0 && (
              <Panel title={t('fees.dayEnd.byMode')}>
                <div className="divide-y divide-border">
                  {modes.map(([m, v]) => <div key={m} className="flex justify-between py-1.5 text-sm"><span>{modeLabel(m)}</span><span className="font-mono-num">{formatINR(v)}</span></div>)}
                </div>
              </Panel>
            )}
            <DataTable
              title={t('fees.dayEnd.receiptList')}
              rows={sum.receipts}
              dense
              columns={[
                { key: 'receiptNo', header: t('fees.receipts.no'), render: (v) => <span className="font-mono-num">{v}</span> },
                { key: 'at', header: t('fees.dayEnd.time'), nowrap: true, render: (v) => time(v) },
                { key: 'student', header: t('fees.receipts.student'), mobilePrimary: true, render: (v) => <span className="text-sm">{v?.name ?? '—'}{v?.classShort ? <span className="text-ink-faint"> · {v.classShort}</span> : ''}</span> },
                { key: 'mode', header: t('fees.receipts.mode'), render: (v) => modeLabel(v) },
                { key: 'amount', header: t('fees.receipts.amount'), align: 'right', render: (v) => formatINR(v) },
              ]}
              emptyIcon={Receipt} emptyTitle={t('fees.dayEnd.noReceipts')}
            />
          </div>

          <Panel title={t('fees.dayEnd.closeTitle')} icon={Lock}>
            {sum.closing ? (
              <div className="space-y-2 text-sm">
                <StatusPill tone={DAY_END_STATUS[sum.closing.status]?.tone}>{t(`fees.dayEndStatus.${sum.closing.status}`, DAY_END_STATUS[sum.closing.status]?.label)}</StatusPill>
                <p>{t('fees.dayEnd.countedWas', { amount: formatINR(sum.closing.cashCounted) })}</p>
                {sum.closing.variance !== 0 && <p className={sum.closing.variance < 0 ? 'text-danger-600' : 'text-amber-700'}>{t('fees.dayEnd.varianceWas', { amount: signed(sum.closing.variance) })}</p>}
                {sum.closing.note && <p className="text-ink-muted">{sum.closing.note}</p>}
              </div>
            ) : hasPermission('fees.day-end.close') ? (
              <div className="space-y-3">
                <FormField label={t('fees.dayEnd.cashCounted')} required hint={t('fees.dayEnd.cashCountedHint', { amount: formatINR(sum.expectedCash) })}>
                  <Input type="number" min="0" step="1" className="text-right" value={counted} onChange={(e) => setCounted(e.target.value)} />
                </FormField>
                {variance !== null && (variance === 0
                  ? <Note tone="success">{t('fees.dayEnd.matches')}</Note>
                  : <Note tone="warning">{variance < 0 ? t('fees.dayEnd.short', { amount: formatINR(-variance) }) : t('fees.dayEnd.over', { amount: formatINR(variance) })}</Note>)}
                <FormField label={t('fees.dayEnd.note')} hint={variance ? t('fees.dayEnd.noteHint') : undefined}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
                <Button className="w-full" icon={Lock} loading={close.isPending} disabled={counted === '' || !sum.receipts.length}
                  onClick={async () => { if (await confirm({ title: t('fees.dayEnd.closeConfirm.title', { date: sum.date }), message: t('fees.dayEnd.closeConfirm.message'), confirmLabel: t('fees.dayEnd.close') })) close.mutate() }}>
                  {t('fees.dayEnd.close')}
                </Button>
              </div>
            ) : <p className="text-sm text-ink-muted">{t('fees.dayEnd.cantClose')}</p>}
          </Panel>
        </div>
      </>}
    </div>
  )
}

/** Every collector's closed days; a cash difference waits here for someone else to approve. */
function Closings() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['fee-day-closings'], queryFn: () => fetchDayClosings() })
  const approve = useMutation({
    mutationFn: (id) => approveDayVariance(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-day-closings'] }); qc.invalidateQueries({ queryKey: ['fee-day'] }); showSuccess(t('fees.dayEnd.approved')) },
    onError: (e) => showError(e.message),
  })
  const canApprove = hasPermission('fees.day-end.approve_variance')
  return (
    <DataTable
      rows={rows}
      loading={isLoading}
      error={error}
      onRetry={refetch}
      exportable exportName="fee-day-end"
      rowTone={(r) => (r.status === 'VARIANCE' ? 'warning' : undefined)}
      columns={[
        { key: 'date', header: t('fees.dayEnd.date'), nowrap: true, render: (v) => date(v) },
        { key: 'collector', header: t('fees.dayEnd.collector'), mobilePrimary: true },
        { key: 'receipts', header: t('fees.dayEnd.receipts'), align: 'right', mobileHidden: true },
        { key: 'total', header: t('fees.dayEnd.total'), align: 'right', render: (v) => formatINR(v) },
        { key: 'cashCounted', header: t('fees.dayEnd.cashCounted'), align: 'right', mobileHidden: true, render: (v) => formatINR(v) },
        { key: 'variance', header: t('fees.dayEnd.variance'), align: 'right', render: (v) => <span className={v < 0 ? 'text-danger-600' : v > 0 ? 'text-amber-700' : 'text-ink-faint'}>{signed(v)}</span> },
        { key: 'status', header: t('fees.dayEnd.status'), render: (v, r) => <div><StatusPill tone={DAY_END_STATUS[v]?.tone}>{t(`fees.dayEndStatus.${v}`, DAY_END_STATUS[v]?.label)}</StatusPill>{r.approvedBy && <p className="text-xs text-ink-faint mt-0.5">{r.approvedBy}</p>}</div> },
        { key: 'id', header: '', align: 'right', width: 60, render: (id, r) => r.status === 'VARIANCE' && canApprove && (
          <Button size="sm" variant="ghost" icon={CheckCircle2} title={t('fees.dayEnd.approve')} aria-label={t('fees.dayEnd.approve')}
            onClick={async () => { if (await confirm({ title: t('fees.dayEnd.approveConfirm.title', { name: r.collector, date: date(r.date) }), message: t('fees.dayEnd.approveConfirm.message', { amount: signed(r.variance) }), confirmLabel: t('fees.dayEnd.approve') })) approve.mutate(id) }} />
        ) },
      ]}
      emptyIcon={Lock} emptyTitle={t('fees.dayEnd.noClosings')}
    />
  )
}

export default function DayEnd() {
  const { t } = useTranslation('fees')
  const [tab, setTab] = useState('day')
  return (
    <PageContainer>
      <PageHeader icon={Lock} title={t('fees.dayEnd.title')} subtitle={t('fees.dayEnd.subtitle')} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'day', label: t('fees.dayEnd.myDay') }, { value: 'closings', label: t('fees.dayEnd.closings') }]} />
      {tab === 'day' ? <MyDay /> : <Closings />}
    </PageContainer>
  )
}
