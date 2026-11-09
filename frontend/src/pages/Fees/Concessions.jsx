import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgePercent, Check, IndianRupee, Percent, Plus, Undo2, X } from 'lucide-react'
import { CONCESSION_KINDS, CONCESSION_REASONS, CONCESSION_STATUS, formatINR, toPaise } from '@schoolgiant/shared'
import { ColorChip, ControlChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import { decideConcession, fetchConcessions, fetchFeeHeads, requestConcession, withdrawConcession } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const reasonKey = (r) => r.replace(/[^A-Za-z]/g, '')

function RequestConcession({ onClose, onSaved }) {
  const { t } = useTranslation('fees')
  const { showError } = useSnackbar()
  const { data: heads = [] } = useQuery({ queryKey: ['fee-heads'], queryFn: fetchFeeHeads })
  const [form, setForm] = useState({ studentId: '', kind: 'PCT', value: '', feeHeadIds: [], reason: CONCESSION_REASONS[0], reasonText: '', note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const toggleHead = (id) => setForm((f) => ({ ...f, feeHeadIds: f.feeHeadIds.includes(id) ? f.feeHeadIds.filter((x) => x !== id) : [...f.feeHeadIds, id] }))
  const reason = form.reason === 'Other' ? form.reasonText.trim() : form.reason
  const save = useMutation({
    mutationFn: () => requestConcession({
      studentId: form.studentId, kind: form.kind, value: form.kind === 'PCT' ? Number(form.value) : toPaise(form.value),
      feeHeadIds: form.feeHeadIds, reason, note: form.note || undefined,
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={t('fees.concessions.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !Number(form.value) || reason.length < 2} onClick={() => save.mutate()}>{t('fees.concessions.request')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <StudentPicker value={form.studentId} onChange={(id) => setForm((f) => ({ ...f, studentId: id }))} error={errors.studentId} />
        <FormField label={t('fees.concessions.kind')} required>
          <Select value={form.kind} onChange={set('kind')}>{CONCESSION_KINDS.map((k) => <option key={k.value} value={k.value}>{t(`fees.concessions.kinds.${k.value}`, k.label)}</option>)}</Select>
        </FormField>
        <FormField label={form.kind === 'PCT' ? t('fees.concessions.percent') : t('fees.concessions.amount')} required error={errors.value} hint={form.kind === 'AMOUNT' ? t('fees.concessions.amountHint') : undefined}>
          <Input type="number" min="1" max={form.kind === 'PCT' ? 100 : undefined} step={form.kind === 'PCT' ? '0.5' : '1'} value={form.value} onChange={set('value')} />
        </FormField>
        <FormField label={t('fees.concessions.reason')} required error={errors.reason}>
          <Select value={form.reason} onChange={set('reason')}>{CONCESSION_REASONS.map((r) => <option key={r} value={r}>{t(`fees.concessions.reasons.${reasonKey(r)}`, r)}</option>)}</Select>
        </FormField>
        {form.reason === 'Other' && <FormField label={t('fees.concessions.reasonText')} required><Input value={form.reasonText} onChange={set('reasonText')} /></FormField>}
        <div className="sm:col-span-2">
          <p className="text-xs font-medium text-ink-muted mb-2">{t('fees.concessions.onHeads')}</p>
          <div className="flex flex-wrap gap-2">
            {heads.filter((h) => h.active).map((h) => (
              <label key={h.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                <input type="checkbox" checked={form.feeHeadIds.includes(h.id)} onChange={() => toggleHead(h.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                {h.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-1">{t('fees.concessions.onHeadsHint')}</p>
        </div>
        <div className="sm:col-span-2"><FormField label={t('fees.concessions.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField></div>
        <div className="sm:col-span-2"><Note>{t('fees.concessions.approvalHint')}</Note></div>
      </div>
    </Modal>
  )
}

export default function Concessions() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('PENDING')
  const [adding, setAdding] = useState(false)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['fee-concessions', status], queryFn: () => fetchConcessions(status) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fee-concessions'] }); qc.invalidateQueries({ queryKey: ['fee-ledger'] }); qc.invalidateQueries({ queryKey: ['fee-dues'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', '']
  const statusLabel = (s) => (s ? t(`fees.concessionStatus.${s}`, CONCESSION_STATUS[s]?.label) : t('fees.all'))
  const canApprove = hasPermission('fees.concessions.approve')
  const canCreate = hasPermission('fees.concessions.create')
  const valueText = (r) => (r.kind === 'PCT' ? t('fees.concessions.pctValue', { value: r.value }) : t('fees.concessions.amountValue', { amount: formatINR(r.value) }))

  return (
    <PageContainer>
      <PageHeader icon={BadgePercent} title={t('fees.concessions.title')} subtitle={t('fees.concessions.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="fees.concessions.create" onClick={() => setAdding(true)}>{t('fees.concessions.new')}</HeaderButton>} />
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<div className="flex justify-end"><ControlChip label={t('fees.concessions.statusLabel')} value={statusLabel(status)} active={status !== 'PENDING'} options={STATUSES.map(statusLabel)} onChange={(v) => setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? 'PENDING')} /></div>}
        columns={[
          { key: 'student', header: t('fees.concessions.student'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={[v?.admissionNo, r.yearName].filter(Boolean).join(' · ')} size={32} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span> },
          { key: 'value', header: t('fees.concessions.concession'), render: (_, r) => <div><ColorChip label={valueText(r)} icon={r.kind === 'PCT' ? Percent : IndianRupee} tone={r.kind === 'PCT' ? 'violet' : 'teal'} /><p className="text-xs text-ink-faint mt-1">{r.heads.length ? r.heads.join(', ') : t('fees.concessions.allHeads')}</p></div> },
          { key: 'reason', header: t('fees.concessions.reason'), render: (v, r) => <div><ColorChip label={t(`fees.concessions.reasons.${reasonKey(v)}`, v)} seed={reasonKey(v)} dot />{r.note && <p className="text-xs text-ink-faint line-clamp-2 mt-1">{r.note}</p>}</div> },
          { key: 'requestedBy', header: t('fees.concessions.askedBy'), mobileHidden: true, render: (v, r) => <PersonCell name={v} sub={[r.decidedBy && `→ ${r.decidedBy}`, date(String(r.createdAt).slice(0, 10))].filter(Boolean).join(' · ')} size={26} /> },
          { key: 'status', header: t('fees.concessions.statusLabel'), render: (v) => <StatusPill tone={CONCESSION_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 130, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'PENDING' && canApprove && <>
                <Button size="sm" variant="ghost" icon={Check} title={t('fees.concessions.approve')} aria-label={t('fees.concessions.approve')}
                  onClick={async () => { if (await confirm({ title: t('fees.concessions.approveConfirm.title', { name: r.student?.name }), message: t('fees.concessions.approveConfirm.message'), confirmLabel: t('fees.concessions.approve') })) act.mutate({ fn: () => decideConcession(id, true), done: t('fees.concessions.approved') }) }} />
                <Button size="sm" variant="ghost" icon={X} title={t('fees.concessions.reject')} aria-label={t('fees.concessions.reject')} onClick={() => act.mutate({ fn: () => decideConcession(id, false), done: t('fees.concessions.rejected') })} />
              </>}
              {((r.status === 'PENDING' && (canCreate || canApprove)) || (r.status === 'APPROVED' && canApprove)) && <Button size="sm" variant="ghost" icon={Undo2} title={t('fees.concessions.withdraw')} aria-label={t('fees.concessions.withdraw')}
                onClick={async () => { if (await confirm({ title: t('fees.concessions.withdrawConfirm.title'), message: r.status === 'APPROVED' ? t('fees.concessions.withdrawConfirm.approved') : t('fees.concessions.withdrawConfirm.pending'), tone: 'danger', confirmLabel: t('fees.concessions.withdraw') })) act.mutate({ fn: () => withdrawConcession(id), done: t('fees.concessions.withdrawn') }) }} />}
            </div>
          ) },
        ]}
        emptyIcon={BadgePercent} emptyTitle={t('fees.concessions.empty')}
      />
      {adding && <RequestConcession onClose={() => setAdding(false)} onSaved={() => { refresh(); setAdding(false); showSuccess(t('fees.concessions.requested')) }} />}
    </PageContainer>
  )
}
