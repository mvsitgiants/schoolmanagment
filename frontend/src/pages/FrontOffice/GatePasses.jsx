import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Ban, Check, CheckCircle2, Clock, DoorOpen, Hourglass, LogIn, LogOut, Plus, ShieldCheck, Ticket, X } from 'lucide-react'
import { FO_GATE_PASS_REASONS } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, Drawer, EmptyState, FactGrid, FormField, Input, KanbanBoard, Note, PageContainer, PageHeader, SearchInput, SegmentedControl,
  StatCardRow, useConfirm, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Face, PassPill, PhotoCapture, StaffSelect, StudentFinder } from '../../components/frontoffice/FoKit'
import {
  cancelGatePass, createGatePass, decideGatePass, fetchGatePass, fetchGatePasses, fetchPassesToApprove, fetchPassHistory, passLeft, passReturned,
} from '../../api/frontOffice'
import { getCurrentUser, hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const fieldsOf = (e) => e?.response?.data?.details?.fields ?? {}
const EMPTY = { kind: 'STUDENT', student: null, staffId: '', collectorType: 'GUARDIAN', guardianId: '', name: '', relation: '', mobile: '', idNumber: '', photo: '', reason: '', leaveAt: '', returnBy: '', approveNow: false }

/** Who may approve this pass from the screen: an approver, or the student's class teacher. */
const mayDecide = (p) => hasPermission('frontoffice.gate-pass.approve') || (p.classTeacherId && p.classTeacherId === getCurrentUser()?.user?.id)

function NewPassDrawer({ open, onClose, needsApproval }) {
  const { t } = useTranslation('frontoffice')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  useEffect(() => { if (open) { setF(EMPTY); setErrors({}) } }, [open])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const { data: history = [] } = useQuery({ queryKey: ['frontoffice', 'pass-history', f.student?.id], queryFn: () => fetchPassHistory(f.student.id), enabled: !!f.student })
  const save = useMutation({
    mutationFn: () => createGatePass(f.kind === 'STUDENT'
      ? { kind: 'STUDENT', studentId: f.student?.id, reason: f.reason, leaveAt: f.leaveAt, approveNow: f.approveNow, collector: f.collectorType === 'GUARDIAN' ? { type: 'GUARDIAN', guardianId: f.guardianId, idNumber: f.idNumber, photo: f.photo } : { type: 'OTHER', name: f.name, relation: f.relation, mobile: f.mobile, idNumber: f.idNumber, photo: f.photo } }
      : { kind: 'STAFF', staffId: f.staffId, reason: f.reason, leaveAt: f.leaveAt, returnBy: f.returnBy, approveNow: f.approveNow }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['frontoffice', 'passes'] }); showSuccess(t('frontoffice.passes.created', { no: p.passNo })); onClose() },
    onError: (e) => { setErrors(fieldsOf(e)); showError(e.message) },
  })
  const guardians = f.student?.guardians ?? []
  return (
    <Drawer open={open} onClose={onClose} size="lg" title={t('frontoffice.passes.newTitle')} subtitle={t('frontoffice.passes.newSubtitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('frontoffice.common.cancel')}</Button><Button icon={Ticket} loading={save.isPending} disabled={f.reason.trim().length < 2} onClick={() => save.mutate()}>{t('frontoffice.passes.create')}</Button></>}>
      <div className="space-y-4">
        <SegmentedControl value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'STUDENT', label: t('frontoffice.passes.kinds.STUDENT') }, { value: 'STAFF', label: t('frontoffice.passes.kinds.STAFF') }]} />
        {f.kind === 'STUDENT' ? (
          <>
            <StudentFinder required value={f.student} error={errors.studentId} onChange={(s) => setF((x) => ({ ...x, student: s, guardianId: s?.guardians?.find((g) => g.isPrimary)?.id ?? s?.guardians?.[0]?.id ?? '' }))} />
            {history.length > 0 && (
              <Note tone={history.length >= 3 ? 'warning' : 'info'}>
                {t('frontoffice.passes.history', { count: history.length })}{' '}
                {history.slice(0, 3).map((h) => `${date(h.date)} (${h.reason})`).join(' · ')}
              </Note>
            )}
            {f.student && (
              <>
                <SegmentedControl value={f.collectorType} onChange={(v) => set('collectorType', v)} options={[{ value: 'GUARDIAN', label: t('frontoffice.passes.collectorGuardian') }, { value: 'OTHER', label: t('frontoffice.passes.collectorOther') }]} />
                {f.collectorType === 'GUARDIAN' ? (
                  guardians.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {guardians.map((g) => (
                        <button key={g.id} type="button" onClick={() => set('guardianId', g.id)}
                          className={clsx('flex items-center gap-3 rounded-xl border p-3 text-start transition', f.guardianId === g.id ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300' : 'border-border hover:border-ink-faint')}>
                          <Face name={g.name} size={36} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink">{g.name}</span>
                            <span className="block truncate text-xs text-ink-muted">{[g.relation, g.mobile].filter(Boolean).join(' · ')}</span>
                          </span>
                          {f.guardianId === g.id && <CheckCircle2 className="ms-auto h-4 w-4 shrink-0 text-brand-600" />}
                        </button>
                      ))}
                    </div>
                  ) : <Note tone="warning">{t('frontoffice.passes.noGuardians')}</Note>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label={t('frontoffice.passes.collectorName')} required error={errors['collector.name']}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></FormField>
                    <FormField label={t('frontoffice.passes.relation')} required error={errors['collector.relation']}><Input value={f.relation} onChange={(e) => set('relation', e.target.value)} placeholder={t('frontoffice.passes.relationPlaceholder')} /></FormField>
                    <FormField label={t('frontoffice.passes.mobile')}><Input inputMode="tel" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></FormField>
                    <FormField label={t('frontoffice.passes.idNumber')}><Input value={f.idNumber} onChange={(e) => set('idNumber', e.target.value)} /></FormField>
                  </div>
                )}
                <PhotoCapture value={f.photo} onChange={(v) => set('photo', v)} label={t('frontoffice.passes.collectorPhoto')} />
              </>
            )}
          </>
        ) : (
          <StaffSelect label={t('frontoffice.passes.staff')} required error={errors.staffId} value={f.staffId} onChange={(v) => set('staffId', v)} />
        )}
        <FormField label={t('frontoffice.passes.reason')} required error={errors.reason}>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {FO_GATE_PASS_REASONS.map((r, i) => (
                <button key={r} type="button" onClick={() => set('reason', t(`frontoffice.passes.reasons.${i}`))} className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:border-ink-faint hover:text-ink">{t(`frontoffice.passes.reasons.${i}`)}</button>
              ))}
            </div>
            <Input value={f.reason} onChange={(e) => set('reason', e.target.value)} />
          </div>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('frontoffice.passes.leaveAt')}><Input type="time" value={f.leaveAt} onChange={(e) => set('leaveAt', e.target.value)} /></FormField>
          {f.kind === 'STAFF' && <FormField label={t('frontoffice.passes.returnBy')}><Input type="time" value={f.returnBy} onChange={(e) => set('returnBy', e.target.value)} /></FormField>}
        </div>
        {needsApproval && hasPermission('frontoffice.gate-pass.approve') && (
          <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.approveNow} onChange={(e) => set('approveNow', e.target.checked)} className="rounded border-border text-brand-500" />{t('frontoffice.passes.approveNow')}</label>
        )}
        {needsApproval && !f.approveNow && <Note tone="info">{t('frontoffice.passes.approvalHint')}</Note>}
      </div>
    </Drawer>
  )
}

/** One pass on the board: who leaves, who collects (with their photo), why, and the next step as a button. */
function PassCard({ p, onAct, onOpen }) {
  const { t } = useTranslation('frontoffice')
  const { time } = useFormat()
  const who = p.studentName ?? p.staffName
  const can = hasPermission('frontoffice.gate-pass.create')
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
      <button type="button" onClick={() => onOpen(p.id)} className="block w-full text-start">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{who}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {p.classLabel ? <ColorChip label={p.classLabel} /> : <ColorChip label={t('frontoffice.passes.kinds.STAFF')} tone="neutral" />}
              <CodeBadge>{p.passNo}</CodeBadge>
            </div>
          </div>
          {p.leaveAt && <span className="inline-flex items-center gap-1 text-xs text-ink-muted tabular-nums"><Clock className="h-3.5 w-3.5" />{p.leaveAt}</span>}
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{p.reason}</p>
        {p.collector && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-bg px-2 py-1.5">
            <Face photo={p.collector.photo} name={p.collector.name} size={28} />
            <span className="min-w-0 text-xs"><span className="block truncate font-medium text-ink">{p.collector.name}</span><span className="block truncate text-ink-faint">{p.collector.relation}</span></span>
          </div>
        )}
        {p.leftAt && <p className="mt-2 text-xs text-success-700">{t('frontoffice.passes.leftAt', { time: time(p.leftAt) })}</p>}
      </button>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
        {p.status === 'REQUESTED' && mayDecide(p) && <>
          <Button size="sm" icon={Check} onClick={() => onAct('approve', p)}>{t('frontoffice.passes.approve')}</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => onAct('reject', p)}>{t('frontoffice.passes.reject')}</Button>
        </>}
        {p.status === 'APPROVED' && can && <Button size="sm" icon={LogOut} onClick={() => onAct('left', p)}>{t('frontoffice.passes.handOver')}</Button>}
        {p.status === 'LEFT' && p.kind === 'STAFF' && can && <Button size="sm" variant="secondary" icon={LogIn} onClick={() => onAct('returned', p)}>{t('frontoffice.passes.back')}</Button>}
        {['REQUESTED', 'APPROVED'].includes(p.status) && can && <Button size="sm" variant="ghost" icon={Ban} onClick={() => onAct('cancel', p)}>{t('frontoffice.passes.cancel')}</Button>}
      </div>
    </div>
  )
}

function PassDrawer({ id, onClose }) {
  const { t } = useTranslation('frontoffice')
  const { dateTime, date } = useFormat()
  const { data: p } = useQuery({ queryKey: ['frontoffice', 'passes', 'one', id], queryFn: () => fetchGatePass(id), enabled: !!id })
  return (
    <Drawer open={!!id} onClose={onClose} title={p ? (p.studentName ?? p.staffName) : ''} subtitle={p?.passNo}>
      {p && (
        <div className="space-y-4">
          <div className="flex items-center gap-2"><PassPill value={p.status} />{p.classLabel && <ColorChip label={p.classLabel} />}</div>
          {p.collector && (
            <div className="flex items-center gap-4 rounded-xl border border-border p-3">
              <Face photo={p.collector.photo} name={p.collector.name} size={88} />
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs uppercase tracking-wide text-ink-faint">{t('frontoffice.passes.collectedBy')}</p>
                <p className="text-base font-semibold text-ink">{p.collector.name}</p>
                <p className="text-sm text-ink-muted">{[p.collector.relation, p.collector.mobile].filter(Boolean).join(' · ')}</p>
                {p.collector.type === 'OTHER' && <ColorChip label={t('frontoffice.passes.notOnRecord')} tone="warning" />}
              </div>
            </div>
          )}
          <FactGrid cols={2} items={[
            { label: t('frontoffice.passes.date'), value: date(p.date) },
            { label: t('frontoffice.passes.leaveAt'), value: p.leaveAt },
            { label: t('frontoffice.passes.reason'), value: p.reason, span: 'full', text: true },
            { label: t('frontoffice.passes.requestedBy'), value: p.requestedBy },
            { label: t('frontoffice.passes.decidedBy'), value: p.approvedBy ? `${p.approvedBy} · ${dateTime(p.approvedAt)}` : null },
            { label: t('frontoffice.passes.decisionNote'), value: p.decisionNote, span: 'full' },
            { label: t('frontoffice.passes.leftAtLabel'), value: p.leftAt ? `${dateTime(p.leftAt)} · ${p.leftBy ?? ''}` : null },
            { label: t('frontoffice.passes.returnedAt'), value: p.returnedAt ? dateTime(p.returnedAt) : null },
            { label: t('frontoffice.passes.cancelReason'), value: p.cancelledReason, span: 'full' },
          ]} />
        </div>
      )}
    </Drawer>
  )
}

/** For a class teacher without the gate-pass page: just the passes waiting for them. */
function ToApprove({ onAct, onOpen }) {
  const { t } = useTranslation('frontoffice')
  const { data, isLoading } = useQuery({ queryKey: ['frontoffice', 'passes', 'to-approve'], queryFn: fetchPassesToApprove })
  if (isLoading) return <div className="h-40 animate-pulse rounded-xl bg-black/[0.04]" />
  if (!data?.rows?.length) return <EmptyState icon={ShieldCheck} title={t('frontoffice.passes.nothingToApprove')} />
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.rows.map((p) => <PassCard key={p.id} p={p} onAct={onAct} onOpen={onOpen} />)}</div>
}

/** Front office › Gate passes: today's passes as a board — waiting for approval, approved (at the gate), gone. */
export default function FrontOfficeGatePasses() {
  const { t } = useTranslation('frontoffice')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [day, setDay] = useState('')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const canView = hasPermission('frontoffice.gate-pass.view')
  const open = params.get('id')
  const setOpen = (id) => setParams(id ? { id } : {}, { replace: true })
  const query = { date: day || undefined, kind, search: q }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['frontoffice', 'passes', query], queryFn: () => fetchGatePasses(query), refetchInterval: 30_000, enabled: canView })
  const act = useMutation({
    mutationFn: async ({ kind: k, p }) => {
      if (k === 'approve') return decideGatePass(p.id, true)
      if (k === 'reject') {
        const note = await prompt({ title: t('frontoffice.passes.rejectTitle', { name: p.studentName ?? p.staffName }), label: t('frontoffice.passes.rejectReason') })
        if (note === null || note === undefined) return null
        return decideGatePass(p.id, false, note)
      }
      if (k === 'left') {
        if (!(await confirm({ title: t('frontoffice.passes.handOverConfirm', { name: p.studentName ?? p.staffName }), message: p.collector ? t('frontoffice.passes.checkCollector', { name: p.collector.name, relation: p.collector.relation ?? '' }) : undefined, confirmLabel: t('frontoffice.passes.handOver') }))) return null
        return passLeft(p.id)
      }
      if (k === 'returned') return passReturned(p.id)
      if (k === 'cancel') {
        const reason = await prompt({ title: t('frontoffice.passes.cancelTitle', { no: p.passNo }), label: t('frontoffice.passes.cancelReason') })
        if (reason === null || reason === undefined) return null
        return cancelGatePass(p.id, reason)
      }
      return null
    },
    onSuccess: (p, v) => { if (p) { qc.invalidateQueries({ queryKey: ['frontoffice', 'passes'] }); showSuccess(t(`frontoffice.passes.done.${v.kind}`, { no: p.passNo })) } },
    onError: (e) => showError(e.message),
  })
  const onAct = (k, p) => act.mutate({ kind: k, p })
  const c = data?.counts ?? {}
  return (
    <PageContainer>
      <PageHeader icon={Ticket} title={t('frontoffice.passes.title')} subtitle={t('frontoffice.passes.subtitle')}
        actions={hasPermission('frontoffice.gate-pass.create') && <Button icon={Plus} onClick={() => setAdding(true)}>{t('frontoffice.passes.new')}</Button>} />
      {!canView ? <ToApprove onAct={onAct} onOpen={setOpen} /> : (
        <>
          {error && <EmptyState error={error} onRetry={refetch} />}
          <StatCardRow items={[
            { icon: Hourglass, tone: c.REQUESTED ? 'warning' : 'neutral', label: t('frontoffice.passes.statWaiting'), value: c.REQUESTED ?? 0 },
            { icon: ShieldCheck, tone: 'info', label: t('frontoffice.passes.statApproved'), value: c.APPROVED ?? 0 },
            { icon: DoorOpen, tone: 'success', label: t('frontoffice.passes.statLeft'), value: (c.LEFT ?? 0) + (c.RETURNED ?? 0), sub: c.RETURNED ? t('frontoffice.passes.statReturned', { count: c.RETURNED }) : undefined },
            { icon: Ban, tone: 'neutral', label: t('frontoffice.passes.statStopped'), value: (c.REJECTED ?? 0) + (c.CANCELLED ?? 0) },
          ]} />
          <div className="flex flex-wrap items-end gap-2">
            <FormField label={t('frontoffice.passes.date')}><Input type="date" value={day || data?.date || ''} onChange={(e) => setDay(e.target.value)} /></FormField>
            <SegmentedControl value={kind} onChange={setKind} options={[{ value: '', label: t('frontoffice.common.all') }, { value: 'STUDENT', label: t('frontoffice.passes.kinds.STUDENT') }, { value: 'STAFF', label: t('frontoffice.passes.kinds.STAFF') }]} />
            <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('frontoffice.passes.search')} /></div>
          </div>
          {data && !data.needsApproval && <Note tone="info">{t('frontoffice.passes.noApprovalNeeded')}</Note>}
          <KanbanBoard loading={isLoading} items={data?.rows ?? []} minColumnWidth={280}
            columnOf={(p) => (p.status === 'RETURNED' ? 'LEFT' : ['REJECTED', 'CANCELLED'].includes(p.status) ? 'STOPPED' : p.status)}
            columns={[
              { key: 'REQUESTED', label: t('frontoffice.passes.colWaiting'), tone: 'warning', icon: Hourglass, hint: t('frontoffice.passes.colWaitingHint') },
              { key: 'APPROVED', label: t('frontoffice.passes.colApproved'), tone: 'info', icon: ShieldCheck, hint: t('frontoffice.passes.colApprovedHint') },
              { key: 'LEFT', label: t('frontoffice.passes.colLeft'), tone: 'success', icon: DoorOpen },
              { key: 'STOPPED', label: t('frontoffice.passes.colStopped'), tone: 'neutral', icon: Ban },
            ]}
            emptyText={t('frontoffice.passes.colEmpty')}
            renderCard={(p) => <PassCard p={p} onAct={onAct} onOpen={setOpen} />} />
        </>
      )}
      <NewPassDrawer open={adding} onClose={() => setAdding(false)} needsApproval={data?.needsApproval !== false} />
      <PassDrawer id={open} onClose={() => setOpen(null)} />
    </PageContainer>
  )
}
