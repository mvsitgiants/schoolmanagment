import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, CircleDollarSign, ClipboardCheck, FilePlus2, FileStack, ListFilter, PenLine, RotateCcw, Search, TrendingUp, X } from 'lucide-react'
import { COE_REVAL_STATUS } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, ControlChip, DataTable, DateCell, Drawer, EmptyState, FactGrid, FormField, HeaderButton, Input, Modal, Money, PageContainer,
  PageHeader, PersonCell, StatCardRow, StatusPill, Textarea, Timeline, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import useSessionPick from '../../components/coe/useSessionPick'
import { actOnRevaluation, fetchRevaluationCandidates, fetchRevaluations, requestRevaluation } from '../../api/coe'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function RequestModal({ session, onClose, onSaved }) {
  const { t } = useTranslation('coe')
  const { showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(null)
  const [reason, setReason] = useState('')
  const [feePaid, setFeePaid] = useState(false)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['reval-candidates', session.id, search], queryFn: () => fetchRevaluationCandidates(session.id, search) })
  const save = useMutation({ mutationFn: () => requestRevaluation({ resultId: picked.id, reason: reason || undefined, feePaid }), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('coe.revaluation.new')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!picked} onClick={() => save.mutate()}>{t('coe.revaluation.submit')}</Button>
    </>}>
      <p className="text-sm text-ink-muted mb-3">{t('coe.revaluation.pickHint', { session: session.name })}</p>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" aria-hidden />
        <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('coe.revaluation.searchPlaceholder')} aria-label={t('coe.revaluation.searchPlaceholder')} />
      </div>
      <DataTable dense maxHeight="35vh" loading={isLoading} rows={rows} rowKey="id" selectedId={picked?.id} onSelect={setPicked}
        emptyTitle={t('coe.revaluation.noCandidates')}
        columns={[
          { key: 'name', header: t('coe.student'), render: (v, r) => <PersonCell name={v} sub={r.registerNo || r.admissionNo} /> },
          { key: 'courseCode', header: t('coe.course'), render: (v, r) => <span><CodeBadge>{v}</CodeBadge> <span className="text-xs text-ink-muted">{r.courseTitle}</span></span> },
          { key: 'external', header: t('coe.revaluation.external'), align: 'right', render: (v, r) => `${v} / ${r.externalMax}` },
          { key: 'grade', header: t('coe.grade'), render: (v, r) => <StatusPill tone={r.pass ? 'success' : 'danger'} dot={false}>{v}</StatusPill> },
        ]} />
      <div className="grid sm:grid-cols-3 gap-4 mt-4">
        <div className="sm:col-span-2"><FormField label={t('coe.revaluation.reason')}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField></div>
        <div>
          <p className="text-sm font-medium text-ink mb-1">{t('coe.revaluation.fee')}</p>
          <p className="text-sm text-ink-muted mb-2"><Money value={session.revaluationFee ?? 0} paise /></p>
          <div className="flex items-center gap-2 text-sm text-ink-muted"><Switch size="sm" checked={feePaid} onChange={setFeePaid} label={t('coe.revaluation.feePaid')} />{t('coe.revaluation.feePaid')}</div>
        </div>
      </div>
    </Modal>
  )
}

export default function Revaluation() {
  const { t } = useTranslation('coe')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { sessions, sessionId, setSessionId, session, isLoading: loadingSessions } = useSessionPick((s) => s.status === 'PUBLISHED')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const [asking, setAsking] = useState(false)
  const key = ['revaluations', sessionId, status]
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchRevaluations({ sessionId, status: status || undefined }), enabled: !!sessionId })
  const canApprove = hasPermission('coe.revaluation.approve')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['revaluations'] }); qc.invalidateQueries({ queryKey: ['coe-results'] }) }
  const act = useMutation({
    mutationFn: ({ id, ...body }) => actOnRevaluation(id, body),
    onSuccess: (r) => { refresh(); setOpen(null); showSuccess(t(`coe.revaluation.done.${r.status}`)) },
    onError: (e) => showError(e.message),
  })
  const reject = async (r) => { const note = await prompt({ title: t('coe.revaluation.rejectTitle'), label: t('coe.revaluation.rejectReason'), required: true }); if (note) act.mutate({ id: r.id, action: 'REJECT', note }) }
  const revalue = async (r) => {
    const v = await prompt({ title: t('coe.revaluation.newMarksTitle', { code: r.courseCode, name: r.name }), label: t('coe.revaluation.newMarksLabel', { old: r.oldMarks, max: r.externalMax }), required: true })
    if (v !== null && v !== undefined && v !== '') act.mutate({ id: r.id, action: 'REVALUE', newMarks: Number(v) })
  }
  const s = data?.summary
  const rows = data?.rows ?? []

  const header = (
    <PageHeader icon={RotateCcw} title={t('coe.revaluation.title')} subtitle={t('coe.revaluation.subtitle')}
      actions={session && <HeaderButton icon={FilePlus2} variant="primary" requires="create" onClick={() => setAsking(true)}>{t('coe.revaluation.new')}</HeaderButton>} />
  )
  if (!loadingSessions && !sessions.length) {
    return <PageContainer>{header}<EmptyState icon={FileStack} title={t('coe.revaluation.noPublished')} hint={t('coe.revaluation.noPublishedHint')} /></PageContainer>
  }
  const actions = (r) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {r.status === 'REQUESTED' && canApprove && <Button size="sm" variant="ghost" icon={Check} aria-label={t('coe.revaluation.approve')} title={t('coe.revaluation.approve')} onClick={() => act.mutate({ id: r.id, action: 'APPROVE' })} />}
      {r.status === 'REQUESTED' && canApprove && <Button size="sm" variant="ghost" icon={X} aria-label={t('coe.revaluation.reject')} title={t('coe.revaluation.reject')} onClick={() => reject(r)} />}
      {r.status === 'APPROVED' && canApprove && <Button size="sm" variant="secondary" icon={PenLine} onClick={() => revalue(r)}>{t('coe.revaluation.enterMarks')}</Button>}
    </div>
  )
  return (
    <PageContainer>
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <ControlChip icon={FileStack} label={t('coe.session')} active value={session?.name} options={sessions.map((x) => ({ value: x.id, label: x.name }))} onChange={setSessionId} />
        <ControlChip icon={ListFilter} label={t('coe.status')} active={!!status} value={status ? t(`coe.revalStatus.${status}`) : t('coe.all')}
          options={[{ value: '', label: t('coe.all') }, ...Object.keys(COE_REVAL_STATUS).map((k) => ({ value: k, label: t(`coe.revalStatus.${k}`) }))]} onChange={setStatus} />
      </div>
      {s && (
        <StatCardRow items={[
          { icon: ClipboardCheck, tone: 'warning', label: t('coe.revalStatus.REQUESTED'), value: s.REQUESTED, sub: t('coe.revaluation.statRequestedSub'), onClick: () => setStatus('REQUESTED') },
          { icon: PenLine, tone: 'info', label: t('coe.revaluation.statInProgress'), value: s.APPROVED, sub: t('coe.revaluation.statInProgressSub'), onClick: () => setStatus('APPROVED') },
          { icon: TrendingUp, tone: 'success', label: t('coe.revalStatus.REVALUED'), value: s.REVALUED, sub: t('coe.revaluation.statImproved', { n: s.improved }), progress: s.REVALUED ? (s.improved / s.REVALUED) * 100 : 0, onClick: () => setStatus('REVALUED') },
          { icon: CircleDollarSign, tone: 'teal', label: t('coe.revaluation.statFees'), value: <Money value={s.fees} paise />, sub: t('coe.revaluation.statFeesSub') },
        ]} />
      )}
      <DataTable
        title={t('coe.revaluation.list', { count: rows.length })} exportable exportName={`revaluation-${session?.name ?? ''}`}
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id" onSelect={setOpen}
        emptyIcon={RotateCcw} emptyTitle={t('coe.revaluation.empty')} emptyHint={t('coe.revaluation.emptyHint')}
        emptyAction={hasPermission('coe.revaluation.create') && session && <Button icon={FilePlus2} onClick={() => setAsking(true)}>{t('coe.revaluation.new')}</Button>}
        columns={[
          { key: 'name', header: t('coe.student'), sortable: true, mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.registerNo || r.admissionNo} /> },
          { key: 'courseCode', header: t('coe.course'), sortable: true, render: (v, r) => <span><CodeBadge>{v}</CodeBadge> <span className="text-xs text-ink-muted">{r.courseTitle}</span></span> },
          { key: 'oldMarks', header: t('coe.revaluation.marks'), align: 'right', render: (v, r) => (
            <span className="inline-flex items-center gap-1.5 tabular-nums">{v}{r.newMarks !== null && r.newMarks !== undefined && <><ArrowRight className="h-3 w-3 text-ink-faint" /><b className={r.change > 0 ? 'text-success-600' : 'text-ink'}>{r.newMarks}</b></>}<span className="text-ink-faint">/ {r.externalMax}</span></span>
          ) },
          { key: 'oldGrade', header: t('coe.grade'), render: (v, r) => <span className="inline-flex items-center gap-1"><ColorChip label={v} seed={`g${v}`} />{r.newGrade && <><ArrowRight className="h-3 w-3 text-ink-faint" /><ColorChip label={r.newGrade} seed={`g${r.newGrade}`} /></>}</span> },
          { key: 'fee', header: t('coe.revaluation.fee'), align: 'right', render: (v, r) => <span className="inline-flex flex-col items-end"><Money value={v} paise /><span className={r.feePaid ? 'text-[11px] text-success-600' : 'text-[11px] text-amber-600'}>{r.feePaid ? t('coe.revaluation.paid') : t('coe.revaluation.unpaid')}</span></span> },
          { key: 'status', header: t('coe.status'), sortable: true, render: (v) => <StatusPill tone={COE_REVAL_STATUS[v]?.tone}>{t(`coe.revalStatus.${v}`)}</StatusPill> },
          { key: 'createdAt', header: t('coe.revaluation.asked'), sortable: true, render: (v) => <DateCell value={v} /> },
          { key: 'actions', header: '', align: 'right', render: (_, r) => actions(r) },
        ]}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} subtitle={t('coe.revaluation.drawerSubtitle')} title={open ? `${open.courseCode} · ${open.name}` : ''} footer={open && actions(open)}>
        {open && (
          <div className="space-y-5">
            <FactGrid cols={2} items={[
              { label: t('coe.session'), value: open.sessionName },
              { label: t('coe.status'), value: <StatusPill tone={COE_REVAL_STATUS[open.status]?.tone}>{t(`coe.revalStatus.${open.status}`)}</StatusPill> },
              { label: t('coe.revaluation.oldMarks'), value: `${open.oldMarks} / ${open.externalMax} · ${open.oldGrade}` },
              { label: t('coe.revaluation.newMarks'), value: open.newMarks !== null && open.newMarks !== undefined ? `${open.newMarks} / ${open.externalMax} · ${open.newGrade}` : null },
              { label: t('coe.revaluation.fee'), value: <Money value={open.fee} paise /> },
              { label: t('coe.revaluation.rule'), value: t('coe.revaluation.ruleValue') },
              ...(open.reason ? [{ label: t('coe.revaluation.reason'), value: open.reason, span: 'full', text: true }] : []),
            ]} />
            <Timeline dense items={[...open.history].reverse().map((h, i) => ({
              id: String(i), tone: h.action === 'REVALUED' ? 'success' : h.action === 'REJECTED' ? 'danger' : 'brand',
              title: t(`coe.revalStatus.${h.action}`), time: dateTime(h.at), meta: h.by, body: h.note || null,
            }))} />
          </div>
        )}
      </Drawer>
      {asking && session && <RequestModal session={session} onClose={() => setAsking(false)} onSaved={() => { setAsking(false); refresh(); showSuccess(t('coe.revaluation.requested')) }} />}
    </PageContainer>
  )
}
