import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, CheckCircle2, Hourglass, Plus, Printer, XCircle } from 'lucide-react'
import { CONDUCT_OPTIONS, LEAVING_REASONS, TC_STATUS } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, ControlChip, DataTable, DateCell, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, PersonCell, Select, StackCell, StatCardRow, StatusPill, Textarea, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { cancelTc, fetchStudent, fetchStudents, fetchTcs, issueTc, requestTc } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

function RequestTc({ studentId: presetId, onClose, onSaved }) {
  const { t } = useTranslation('students')
  const { showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found } = useQuery({ queryKey: ['students', 'tc-pick', q], queryFn: () => fetchStudents({ search: q, pageSize: 20 }), enabled: !!q })
  const { data: preset } = useQuery({ queryKey: ['student', presetId, false], queryFn: () => fetchStudent(presetId), enabled: !!presetId })
  const [form, setForm] = useState({ studentId: presetId ?? '', leavingDate: new Date().toISOString().slice(0, 10), reason: 'TRANSFER', reasonText: '', conduct: 'Good', promotedTo: '', feesPaidUpTo: '', remarks: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const options = [...(preset ? [preset] : []), ...(found?.data ?? []).filter((x) => x.id !== preset?.id)]
  const picked = options.find((s) => s.id === form.studentId)
  const save = useMutation({
    mutationFn: () => requestTc(form),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={t('students.transfer.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.leavingDate} onClick={() => save.mutate()}>{t('students.transfer.request')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('students.transfer.findStudent')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('students.directory.search')} /></FormField>
        <FormField label={t('students.directory.student')} required error={errors.studentId}>
          <Select value={form.studentId} onChange={set('studentId')}>
            <option value="">{t('students.transfer.pickStudent')}</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.classShort ?? '—'} · {s.admissionNo}</option>)}
          </Select>
        </FormField>
        <FormField label={t('students.transfer.leavingDate')} required error={errors.leavingDate}><Input type="date" value={form.leavingDate} onChange={set('leavingDate')} /></FormField>
        <FormField label={t('students.transfer.reason')} required>
          <Select value={form.reason} onChange={set('reason')}>{LEAVING_REASONS.map((r) => <option key={r.value} value={r.value}>{t(`students.transfer.reasons.${r.value}`, r.label)}</option>)}</Select>
        </FormField>
        {form.reason === 'OTHER' && <div className="sm:col-span-2"><FormField label={t('students.transfer.reasonText')}><Input value={form.reasonText} onChange={set('reasonText')} /></FormField></div>}
        <FormField label={t('students.transfer.conduct')}>
          <Select value={form.conduct} onChange={set('conduct')}>{CONDUCT_OPTIONS.map((c) => <option key={c} value={c}>{t(`students.transfer.conducts.${c.replace(/\s/g, '')}`, c)}</option>)}</Select>
        </FormField>
        <FormField label={t('students.transfer.feesPaidUpTo')}><Input value={form.feesPaidUpTo} onChange={set('feesPaidUpTo')} placeholder={t('students.transfer.feesPlaceholder')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('students.transfer.promotedTo')} hint={t('students.transfer.promotedHint')}><Input value={form.promotedTo} onChange={set('promotedTo')} placeholder={picked?.classShort ? t('students.transfer.promotedPlaceholder') : ''} /></FormField></div>
        <div className="sm:col-span-2"><FormField label={t('students.transfer.remarks')}><Textarea rows={2} value={form.remarks} onChange={set('remarks')} /></FormField></div>
      </div>
    </Modal>
  )
}

export default function Transfer() {
  const { t } = useTranslation('students')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('')
  const [asking, setAsking] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['tcs', status], queryFn: () => fetchTcs(status) })
  // the tiles count every TC, whichever status is picked (the same list as "All", so it is usually cached)
  const { data: all = [] } = useQuery({ queryKey: ['tcs', ''], queryFn: () => fetchTcs('') })
  const tally = all.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})
  useEffect(() => { const sid = params.get('student'); if (sid) { setAsking(sid); setParams({}, { replace: true }) } }, [params, setParams])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tcs'] }); qc.invalidateQueries({ queryKey: ['students'] }); qc.invalidateQueries({ queryKey: ['student'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const statusLabel = (s) => (s ? t(`students.transfer.status.${s}`, TC_STATUS[s]?.label) : t('students.all'))
  const STATUSES = ['', 'REQUESTED', 'ISSUED', 'CANCELLED']
  const STATUS_LOOK = { REQUESTED: { icon: Hourglass, tone: 'warning' }, ISSUED: { icon: CheckCircle2, tone: 'success' }, CANCELLED: { icon: XCircle, tone: 'neutral' } }

  return (
    <PageContainer>
      <PageHeader icon={ArrowLeftRight} title={t('students.transfer.title')} subtitle={t('students.transfer.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setAsking('new')}>{t('students.transfer.new')}</HeaderButton>} />
      {all.length > 0 && (
        <StatCardRow className="mb-4" items={STATUSES.filter(Boolean).map((k) => ({
          label: statusLabel(k), value: tally[k] ?? 0, ...STATUS_LOOK[k],
          onClick: () => setStatus(status === k ? '' : k),
          className: status === k ? 'ring-2 ring-brand-400' : status ? 'opacity-60 hover:opacity-100' : undefined,
        }))} />
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<div className="flex justify-end"><ControlChip label={t('students.status.title')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? '')} /></div>}
        columns={[
          { key: 'tcNo', header: t('students.transfer.tcNo'), render: (v) => (v ? <CodeBadge tone="success">{v}</CodeBadge> : <span className="text-xs text-ink-faint">{t('students.transfer.draft')}</span>) },
          { key: 'studentId', header: t('students.directory.student'), mobilePrimary: true, render: (v, r) => (
            <Link to={`/students/profile/${v}`} onClick={(e) => e.stopPropagation()} className="block max-w-full hover:[&_span.font-medium]:text-brand-700">
              <PersonCell name={r.snapshot?.name} sub={[r.lastClassLabel, r.snapshot?.admissionNo].filter(Boolean).join(' · ')} size={34} />
            </Link>
          ) },
          { key: 'leavingDate', header: t('students.transfer.leavingDate'), nowrap: true, render: (v) => <DateCell value={v} /> },
          { key: 'reasonLabel', header: t('students.transfer.reason'), mobileHidden: true, render: (v, r) => <ColorChip dot seed={r.reason} label={r.reason === 'OTHER' && r.reasonText ? r.reasonText : r.reason ? t(`students.transfer.reasons.${r.reason}`, v ?? r.reason) : v} /> },
          { key: 'requestedBy', header: t('students.transfer.requestedBy'), mobileHidden: true, render: (v, r) => <StackCell title={v ?? '—'} sub={r.issuedBy ? `→ ${r.issuedBy}` : undefined} /> },
          { key: 'status', header: t('students.status.title'), render: (v) => <StatusPill tone={TC_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 140, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'REQUESTED' && hasPermission('students.transfer.approve') && <Button size="sm" variant="ghost" icon={CheckCircle2} title={t('students.transfer.issue')} aria-label={t('students.transfer.issue')}
                onClick={async () => { if (await confirm({ title: t('students.transfer.issueConfirm.title', { name: r.snapshot?.name }), message: t('students.transfer.issueConfirm.message'), confirmLabel: t('students.transfer.issue') })) act.mutate({ fn: () => issueTc(id), done: t('students.transfer.issued') }) }} />}
              {hasPermission('students.transfer.print') && r.status !== 'CANCELLED' && <Button size="sm" variant="ghost" icon={Printer} title={t('students.transfer.print')} aria-label={t('students.transfer.print')} onClick={() => printDocument('TRANSFER_CERTIFICATE', id)} />}
              {r.status !== 'CANCELLED' && (r.status === 'REQUESTED' || hasPermission('students.transfer.approve')) && <Button size="sm" variant="ghost" icon={XCircle} title={t('students.transfer.cancel')} aria-label={t('students.transfer.cancel')}
                onClick={async () => {
                  const reason = await prompt({ title: t('students.transfer.cancelConfirm.title'), message: r.status === 'ISSUED' ? t('students.transfer.cancelConfirm.issued') : t('students.transfer.cancelConfirm.requested'), label: t('students.transfer.cancelReason'), required: true })
                  if (reason) act.mutate({ fn: () => cancelTc(id, reason), done: t('students.transfer.cancelled') })
                }} />}
            </div>
          ) },
        ]}
        emptyIcon={ArrowLeftRight} emptyTitle={t('students.transfer.empty')} emptyHint={t('students.transfer.emptyHint')}
      />
      {asking && <RequestTc studentId={asking === 'new' ? null : asking} onClose={() => setAsking(null)} onSaved={() => { refresh(); showSuccess(t('students.transfer.requested')); setAsking(null) }} />}
    </PageContainer>
  )
}
