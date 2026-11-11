import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { DateInput, FormField, Modal, SegmentedControl, Select, Textarea } from '../../system'
import Button from '../../ui/Button'
import { Switch } from '../../app/Controls'
import { applyLeaveFor, applyMyLeave, fetchEmployeeLeave, previewLeaveFor, previewMyLeave } from '../../../api/hrms'
import { useSnackbar } from '../../../context/SnackbarContext'
import { fieldErrors, useBalanceText } from './LeaveBits'
import LeavePreview from './LeavePreview'

/**
 * Ask for leave with a live preview of the days that count, the balance after, the no-leave days it touches and
 * (for a teacher) the lessons on those days. Staff apply for themselves (`balances` from My workspace); HR applies
 * on someone's behalf (`employees` to pick from — their own balances load once picked).
 */
export default function LeaveApplyModal({ balances: myBalances, employees, defaultEmployeeId, canApproveNow = false, onClose, onDone }) {
  const { t } = useTranslation('hrmsLeave')
  const { showError } = useSnackbar()
  const balanceText = useBalanceText()
  const onBehalf = !!employees
  const [f, setF] = useState({ employeeId: defaultEmployeeId ?? '', leaveTypeId: '', from: '', to: '', halfDay: false, half: 'FIRST', reason: '', arrangement: '', approveNow: false })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
  const theirs = useQuery({ queryKey: ['emp-leave', f.employeeId], queryFn: () => fetchEmployeeLeave(f.employeeId), enabled: onBehalf && !!f.employeeId })
  const balances = onBehalf ? theirs.data ?? [] : myBalances ?? []
  const type = balances.find((b) => b.leaveTypeId === f.leaveTypeId)
  const person = onBehalf ? employees.find((e) => e.id === f.employeeId) : null
  const to = f.to || f.from
  const halfAllowed = !!(f.from && to === f.from && type?.allowHalfDay)
  const halfDay = halfAllowed && f.halfDay
  const body = { ...(onBehalf && { employeeId: f.employeeId }), leaveTypeId: f.leaveTypeId, from: f.from, to, halfDay, half: halfDay ? f.half : undefined }
  const ready = (!onBehalf || !!f.employeeId) && !!f.leaveTypeId && !!f.from && to >= f.from
  const preview = useQuery({
    queryKey: ['leave-preview', onBehalf, f.employeeId, f.leaveTypeId, f.from, to, halfDay, halfDay ? f.half : null],
    queryFn: () => (onBehalf ? previewLeaveFor : previewMyLeave)(body),
    enabled: ready, retry: false, staleTime: 0,
  })
  const save = useMutation({
    mutationFn: () => (onBehalf ? applyLeaveFor : applyMyLeave)({ ...body, reason: f.reason.trim(), arrangement: f.arrangement.trim() || undefined, ...(onBehalf && { approveNow: canApproveNow && f.approveNow }) }),
    onSuccess: (x) => onDone?.(x),
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const canSave = ready && preview.data?.ok && !preview.isFetching && f.reason.trim().length >= 2
  const teacher = (person?.category ?? (onBehalf ? null : 'TEACHING')) === 'TEACHING' || preview.data?.lessons
  return (
    <Modal open onClose={onClose} size="lg" title={onBehalf ? t('hrmsLeave.apply.titleFor') : t('hrmsLeave.apply.title')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
        <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>{onBehalf ? (f.approveNow ? t('hrmsLeave.apply.saveApproved') : t('hrmsLeave.apply.save')) : t('hrmsLeave.apply.send')}</Button>
      </>}>
      <div className="space-y-3">
        {onBehalf && (
          <FormField label={t('hrmsLeave.apply.person')} required error={errors.employeeId}>
            <Select value={f.employeeId} onChange={(e) => setF((x) => ({ ...x, employeeId: e.target.value, leaveTypeId: '' }))}>
              <option value="">{t('hrmsLeave.apply.pickPerson')}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.designation ? `${e.name} — ${e.designation}` : e.name}</option>)}
            </Select>
          </FormField>
        )}
        <FormField label={t('hrmsLeave.apply.type')} required error={errors.leaveTypeId}>
          <Select value={f.leaveTypeId} onChange={set('leaveTypeId')} disabled={onBehalf && !f.employeeId}>
            <option value="">{onBehalf && !f.employeeId ? t('hrmsLeave.apply.pickPersonFirst') : t('hrmsLeave.apply.pickType')}</option>
            {balances.map((b) => <option key={b.leaveTypeId} value={b.leaveTypeId}>{`${b.name} — ${balanceText(b)}`}</option>)}
          </Select>
        </FormField>
        {type?.description && <p className="-mt-1.5 text-xs text-ink-muted">{type.description}</p>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('hrmsLeave.apply.from')} required error={errors.from}>
            <DateInput value={f.from} onChange={(e) => { const from = e.target.value; setF((x) => ({ ...x, from, to: !x.to || x.to < from ? from : x.to })) }} />
          </FormField>
          <FormField label={t('hrmsLeave.apply.to')} error={errors.to}><DateInput value={f.to} min={f.from || undefined} onChange={set('to')} /></FormField>
        </div>
        {halfAllowed && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-3 text-sm text-ink">
              <Switch checked={f.halfDay} onChange={(v) => setF((x) => ({ ...x, halfDay: v }))} label={t('hrmsLeave.apply.halfDay')} />
              {t('hrmsLeave.apply.halfDay')}
            </label>
            {f.halfDay && <SegmentedControl value={f.half} onChange={set('half')} options={[{ value: 'FIRST', label: t('hrmsLeave.apply.morning') }, { value: 'SECOND', label: t('hrmsLeave.apply.afternoon') }]} />}
          </div>
        )}
        <LeavePreview query={ready ? preview : { data: null, error: null, isFetching: false }} self={!onBehalf} name={person?.name} />
        <FormField label={t('hrmsLeave.apply.reason')} required error={errors.reason}>
          <Textarea rows={2} value={f.reason} onChange={set('reason')} maxLength={500} placeholder={t('hrmsLeave.apply.reasonHint')} />
        </FormField>
        <FormField label={t(`hrmsLeave.apply.${teacher ? 'arrangementTeacher' : 'arrangement'}${onBehalf ? 'Theirs' : ''}`)} hint={t(`hrmsLeave.apply.${teacher ? 'arrangementTeacherHint' : 'arrangementHint'}${onBehalf ? 'Theirs' : ''}`)}>
          <Textarea rows={2} value={f.arrangement} onChange={set('arrangement')} maxLength={500} />
        </FormField>
        {onBehalf && canApproveNow && (
          <label className="flex items-start gap-3 text-sm text-ink">
            <Switch checked={f.approveNow} onChange={(v) => setF((x) => ({ ...x, approveNow: v }))} label={t('hrmsLeave.apply.approveNow')} />
            <span>{t('hrmsLeave.apply.approveNow')}<span className="block text-[11px] text-ink-faint">{t('hrmsLeave.apply.approveNowHint')}</span></span>
          </label>
        )}
      </div>
    </Modal>
  )
}
