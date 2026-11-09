import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, CheckSquare, ExternalLink, Inbox, Undo2, X } from 'lucide-react'
import { APPROVAL_STATUSES, formatINR } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, Drawer, FormField, Note, PageContainer, PageHeader, PersonCell, StatusPill, Tabs, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { DefinitionGrid } from '../../components/app/Controls'
import ApprovalSteps from '../../components/approvals/ApprovalSteps'
import { approveRequest, fetchApproval, fetchApprovalsPage, rejectRequest, withdrawRequest } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

/** Where the request's record lives in the app. */
function recordLink(r, t) {
  if (r.entityType === 'invoice') return { to: `/billing/invoices?bill=${r.entityId}`, label: t('admin.approvals.openBill', { bill: r.entityName }) }
  if (r.studentId) return { to: `/students/profile/${r.studentId}`, label: t('admin.approvals.openStudent') }
  return null
}

function Details({ r }) {
  const { t } = useTranslation('admin')
  const p = r.payload ?? {}
  if (r.type === 'billing.discount') {
    return (
      <DefinitionGrid items={[
        { label: t('admin.approvals.details.discount'), value: `${p.pct}% · ${formatINR(p.amount)}` },
        { label: t('admin.approvals.details.billBeforeDiscount'), value: formatINR(p.gross) },
        { label: t('admin.approvals.details.reasonOnBill'), value: p.reason, full: true },
        p.items?.length > 0 && { label: t('admin.approvals.details.items'), value: p.items.join(', '), full: true },
      ]} />
    )
  }
  if (r.type === 'billing.cancel') {
    return <DefinitionGrid items={[{ label: t('admin.approvals.details.bill'), value: r.entityName, mono: true }, { label: t('admin.approvals.details.refund'), value: r.valueText }, { label: t('admin.approvals.details.reason'), value: p.reason, full: true }]} />
  }
  return null
}

function RequestDrawer({ id, onClose }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState(null)
  const { data: r } = useQuery({ queryKey: ['approval', id], queryFn: () => fetchApproval(id), enabled: !!id })
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['approval', id] }); qc.invalidateQueries({ queryKey: ['bell'] }); setNote(''); showSuccess(msg) }
  const approve = useMutation({
    mutationFn: () => approveRequest(id, note.trim() || undefined),
    onSuccess: (x) => {
      if (x.status === 'FAILED') { showError(x.error); qc.invalidateQueries({ queryKey: ['approvals'] }); return }
      done(x.status === 'PENDING' ? t('admin.approvals.toast.passedOn') : x.result?.summary ? t('admin.approvals.toast.approvedSummary', { summary: x.result.summary }) : t('admin.approvals.toast.approved'))
    },
    onError: (e) => showError(e.message),
  })
  const reject = useMutation({
    mutationFn: () => rejectRequest(id, note.trim()),
    onSuccess: () => done(t('admin.approvals.toast.rejected')),
    onError: (e) => { setNoteError(e.response?.data?.details?.fields?.note ?? null); showError(e.message) },
  })
  const withdraw = useMutation({ mutationFn: () => withdrawRequest(id), onSuccess: () => done(t('admin.approvals.toast.withdrawn')), onError: (e) => showError(e.message) })
  const link = r && recordLink(r, t)

  return (
    <Drawer open={!!id} onClose={onClose} size="md" subtitle={r?.typeLabel ?? t('admin.approvals.approval')} title={r?.title ?? '…'}
      footer={r && (r.canDecide || r.canWithdraw) && (
        <div className="flex flex-wrap gap-2 w-full">
          {r.canDecide && <Button icon={Check} loading={approve.isPending} onClick={() => approve.mutate()}>{t('admin.approvals.approve')}</Button>}
          {r.canDecide && <Button variant="secondary" icon={X} loading={reject.isPending} onClick={() => { if (!note.trim()) { setNoteError(t('admin.approvals.sayWhy')); return } reject.mutate() }}>{t('admin.approvals.reject')}</Button>}
          {r.canWithdraw && <Button variant="ghost" icon={Undo2} className="ms-auto" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>{t('admin.approvals.withdraw')}</Button>}
        </div>
      )}>
      {!r ? <div className="h-64 rounded-lg bg-black/5 animate-pulse" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={APPROVAL_STATUSES[r.status]?.tone}>{t(`admin.approvals.status.${r.status}`, { defaultValue: APPROVAL_STATUSES[r.status]?.label ?? r.status })}</StatusPill>
            <span className="text-xs text-ink-muted">{t('admin.approvals.askedByAt', { name: r.requestedBy, at: dateTime(r.createdAt) })}</span>
          </div>
          <p className="text-sm text-ink">{r.summary}</p>
          {r.reason && <Note tone="info">{t('admin.approvals.reasonQuote', { reason: r.reason, name: r.requestedBy })}</Note>}
          <Details r={r} />
          {link && <Link to={link.to} className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">{link.label} <ExternalLink className="w-3.5 h-3.5" /></Link>}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('admin.approvals.steps')}</p>
            <ApprovalSteps request={r} approvers={r.approvers} />
          </div>
          {r.status === 'APPROVED' && r.mode === 'PERMIT' && <Note tone="success">{t('admin.approvals.validUntil', { at: dateTime(r.expiresAt) })}</Note>}
          {r.status === 'USED' && (r.result?.summary || r.usedRef) && <Note tone="success">{r.result?.summary ? `${r.result.summary}.` : t('admin.approvals.usedOn', { ref: r.usedRef })}</Note>}
          {r.status === 'FAILED' && <Note tone="danger">{t('admin.approvals.couldNotBeDone', { error: r.error })}</Note>}
          {r.status === 'PENDING' && <p className="text-xs text-ink-faint">{t('admin.approvals.expiresIfNobody', { at: dateTime(r.expiresAt) })}</p>}
          {r.canDecide && (
            <FormField label={t('admin.approvals.noteLabel')} hint={t('admin.approvals.noteHint')} error={noteError}>
              <Textarea rows={2} value={note} maxLength={300} onChange={(e) => { setNote(e.target.value); setNoteError(null) }} placeholder={t('admin.approvals.notePlaceholder')} />
            </FormField>
          )}
        </div>
      )}
    </Drawer>
  )
}

/** Personal approvals inbox: requests waiting for me, requests I made, and (admins) all. */
export default function Approvals() {
  const { t } = useTranslation('admin')
  const { dateTime } = useFormat()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || 'waiting')
  const openId = params.get('id')
  const canSeeAll = hasPermission('core.workflows.view')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [tab])
  const { data, isLoading } = useQuery({ queryKey: ['approvals', tab, page], queryFn: () => fetchApprovalsPage(tab, { page, pageSize: 25 }), placeholderData: (p) => p, refetchInterval: 30_000 })
  const rows = data?.data ?? []
  // Tab badge: just the count of requests waiting on me.
  const { data: waitingPage } = useQuery({ queryKey: ['approvals', 'waiting-count'], queryFn: () => fetchApprovalsPage('waiting', { page: 1, pageSize: 1 }), refetchInterval: 30_000 })
  const waitingCount = waitingPage?.meta?.total ?? 0
  const open = (id) => setParams(id ? { id } : {})

  return (
    <PageContainer>
      <PageHeader icon={CheckSquare} title={t('admin.approvals.title')} subtitle={t('admin.approvals.subtitle')} />
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[
          { value: 'waiting', label: waitingCount ? t('admin.approvals.tabs.waitingCount', { count: waitingCount }) : t('admin.approvals.tabs.waiting') },
          { value: 'mine', label: t('admin.approvals.tabs.mine') },
          ...(canSeeAll ? [{ value: 'all', label: t('admin.approvals.tabs.all') }] : []),
        ]} />
        <div className="p-4">
          <DataTable
            rows={rows}
            loading={isLoading}
            onRowClick={(r) => open(r.id)}
            pagination={data?.meta && { page: data.meta.page - 1, size: data.meta.pageSize, totalElements: data.meta.total, totalPages: data.meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
            columns={[
              { key: 'createdAt', header: t('admin.approvals.cols.asked'), nowrap: true, width: 150, render: (v) => <span title={dateTime(v)}><DateCell value={v} time /></span> },
              { key: 'title', header: t('admin.approvals.cols.request'), mobilePrimary: true, render: (v, r) => <div className="min-w-0">{r.typeLabel && <ColorChip label={r.typeLabel} seed={r.type} dot className="mb-1" />}<p className="text-sm font-medium text-ink">{v}</p><p className="text-xs text-ink-muted">{r.summary}</p></div> },
              { key: 'requestedBy', header: t('admin.approvals.cols.askedBy'), render: (v) => <PersonCell name={v} size={26} /> },
              { key: 'valueText', header: t('admin.approvals.cols.value'), align: 'right', nowrap: true, render: (v) => (v ? <span className="font-mono-num font-semibold text-ink">{v}</span> : <span className="text-ink-faint">—</span>) },
              { key: 'status', header: t('common.status'), render: (v, r) => (
                <div className="flex flex-col items-start gap-1">
                  <StatusPill tone={APPROVAL_STATUSES[v]?.tone}>{t(`admin.approvals.status.${v}`, { defaultValue: APPROVAL_STATUSES[v]?.label ?? v })}</StatusPill>
                  {v === 'PENDING' && r.steps.length > 1 && (
                    <span className="inline-flex items-center gap-1.5" title={t('admin.approvals.stepOf', { n: r.currentStep + 1, total: r.steps.length })}>
                      {r.steps.map((_, i) => <span key={i} className={`h-1.5 w-4 rounded-full ${i < r.currentStep ? 'bg-emerald-500' : i === r.currentStep ? 'bg-amber-500' : 'bg-black/10'}`} />)}
                      <span className="text-[11px] text-ink-faint">{t('admin.approvals.stepOf', { n: r.currentStep + 1, total: r.steps.length })}</span>
                    </span>
                  )}
                </div>
              ) },
            ]}
            emptyIcon={Inbox}
            emptyTitle={tab === 'waiting' ? t('admin.approvals.emptyWaiting') : t('admin.approvals.emptyRequests')}
            emptyHint={tab === 'waiting' ? t('admin.approvals.emptyWaitingHint') : t('admin.approvals.emptyRequestsHint')}
          />
        </div>
      </div>
      <RequestDrawer id={openId} onClose={() => open(null)} />
    </PageContainer>
  )
}
