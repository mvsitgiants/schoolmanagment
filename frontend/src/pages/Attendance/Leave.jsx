import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarOff, Check, Plus, X, XCircle } from 'lucide-react'
import { LEAVE_STATUS } from '@schoolgiant/shared'
import { ControlChip, DataTable, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { applyStudentLeave, cancelStudentLeave, decideStudentLeave, fetchStudentLeave } from '../../api/attendance'
import { fetchStudents } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function ApplyLeave({ onClose, onSaved }) {
  const { t } = useTranslation('attendance')
  const { showError } = useSnackbar()
  const today = new Date().toISOString().slice(0, 10)
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found } = useQuery({ queryKey: ['students', 'leave-pick', q], queryFn: () => fetchStudents({ search: q, pageSize: 20 }), enabled: q.length >= 2 })
  const [form, setForm] = useState({ studentId: '', from: today, to: today, reason: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => applyStudentLeave(form), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={t('attendance.leave.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.reason.trim()} onClick={() => save.mutate()}>{t('attendance.leave.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('attendance.leave.find')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('attendance.leave.findPlaceholder')} /></FormField>
        <FormField label={t('attendance.leave.student')} required error={errors.studentId}>
          <Select value={form.studentId} onChange={set('studentId')}>
            <option value="">{t('attendance.leave.pick')}</option>
            {(found?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.classShort ?? '—'}</option>)}
          </Select>
        </FormField>
        <FormField label={t('attendance.leave.from')} required error={errors.from}><Input type="date" value={form.from} onChange={set('from')} /></FormField>
        <FormField label={t('attendance.leave.to')} required error={errors.to}><Input type="date" value={form.to} min={form.from} onChange={set('to')} /></FormField>
        <div className="col-span-2"><FormField label={t('attendance.leave.reason')} required error={errors.reason}><Textarea rows={2} value={form.reason} onChange={set('reason')} /></FormField></div>
      </div>
    </Modal>
  )
}

export default function Leave() {
  const { t } = useTranslation('attendance')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('PENDING')
  const [adding, setAdding] = useState(false)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['student-leave', status], queryFn: () => fetchStudentLeave({ status: status || undefined }) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student-leave'] }); qc.invalidateQueries({ queryKey: ['attendance-sheet'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const statusLabel = (s) => (s ? t(`attendance.leave.status.${s}`, LEAVE_STATUS[s]?.label) : t('attendance.all'))
  const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', '']
  const canDecide = hasPermission('attendance.leave.approve')

  return (
    <PageContainer>
      <PageHeader icon={CalendarOff} title={t('attendance.leave.title')} subtitle={t('attendance.leave.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" onClick={() => setAdding(true)}>{t('attendance.leave.new')}</HeaderButton>} />
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<div className="flex justify-end"><ControlChip label={t('attendance.leave.statusLabel')} value={statusLabel(status)} active={status !== 'PENDING'} options={STATUSES.map(statusLabel)} onChange={(v) => setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? 'PENDING')} /></div>}
        columns={[
          { key: 'studentName', header: t('attendance.leave.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.classShort, r.admissionNo].filter(Boolean).join(' · ')}</p></div> },
          { key: 'from', header: t('attendance.leave.dates'), render: (v, r) => <span className="text-sm">{date(v)}{r.to !== v ? ` – ${date(r.to)}` : ''}</span> },
          { key: 'reason', header: t('attendance.leave.reason'), render: (v) => <span className="text-sm text-ink-muted line-clamp-2">{v}</span> },
          { key: 'appliedByName', header: t('attendance.leave.askedBy'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{v}{r.decidedBy ? ` → ${r.decidedBy}` : ''}</span> },
          { key: 'status', header: t('attendance.leave.statusLabel'), render: (v) => <StatusPill tone={LEAVE_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 130, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'PENDING' && canDecide && <>
                <Button size="sm" variant="ghost" icon={Check} title={t('attendance.leave.approve')} aria-label={t('attendance.leave.approve')} onClick={() => act.mutate({ fn: () => decideStudentLeave(id, true), done: t('attendance.leave.approved') })} />
                <Button size="sm" variant="ghost" icon={X} title={t('attendance.leave.reject')} aria-label={t('attendance.leave.reject')} onClick={() => act.mutate({ fn: () => decideStudentLeave(id, false), done: t('attendance.leave.rejected') })} />
              </>}
              {['PENDING', 'APPROVED'].includes(r.status) && <Button size="sm" variant="ghost" icon={XCircle} title={t('attendance.leave.cancel')} aria-label={t('attendance.leave.cancel')}
                onClick={async () => { if (await confirm({ title: t('attendance.leave.cancelConfirm', { name: r.studentName }), message: t('attendance.leave.cancelHint'), tone: 'danger', confirmLabel: t('attendance.leave.cancel') })) act.mutate({ fn: () => cancelStudentLeave(id), done: t('attendance.leave.cancelled') }) }} />}
            </div>
          ) },
        ]}
        emptyIcon={CalendarOff} emptyTitle={t('attendance.leave.empty')}
      />
      {adding && <ApplyLeave onClose={() => setAdding(false)} onSaved={() => { refresh(); setAdding(false); showSuccess(t('attendance.leave.added')) }} />}
    </PageContainer>
  )
}
