import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { leaveDates } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { fetchHrmsMeta } from '../../api/hrms'
import { useSnackbar } from '../../context/SnackbarContext'

// Bits every Staff & HR screen uses.

export const useHrMeta = (enabled = true) => useQuery({ queryKey: ['hrms-meta'], queryFn: fetchHrmsMeta, enabled, staleTime: 60_000 })

/** Translated labels for the shared lists (category, employment type, statuses …). */
export function useHrLabels() {
  const { t } = useTranslation('hrms')
  return useMemo(() => ({
    category: (v) => (v ? t(`hrms.categories.${v}`, v) : '—'),
    employment: (v) => (v ? t(`hrms.employmentTypes.${v}`, v) : '—'),
    status: (v) => t(`hrms.statuses.${v}`, v),
    exit: (v) => t(`hrms.exitTypes.${v}`, v),
    att: (v) => t(`hrms.attendance.statuses.${v}`, v),
    attCode: (v) => t(`hrms.attendance.codes.${v}`, v),
    leaveStatus: (v) => t(`hrms.leave.statuses.${v}`, v),
    stage: (v) => t(`hrms.hiring.stages.${v}`, v),
    reqStatus: (v) => t(`hrms.hiring.reqStatuses.${v}`, v),
    review: (v) => t(`hrms.performance.statuses.${v}`, v),
    cycle: (v) => t(`hrms.performance.cycleStatuses.${v}`, v),
    day: (v) => t(`hrms.days.${v}`, v),
  }), [t])
}

/** "3 Dec" / "3 – 5 Dec" for a leave. */
export function useLeaveSpan() {
  const { t } = useTranslation('hrms')
  return (l, date) => `${date(l.from)}${l.to !== l.from ? ` – ${date(l.to)}` : ''}${l.halfDay ? ` · ${t('hrms.leave.halfDayShort')}` : ''}`
}

/**
 * Ask for leave: for oneself (`balances` from My workspace) or, for HR, for someone (`employees` to pick from).
 * `submit(body)` sends it.
 */
export function LeaveApplyForm({ balances = [], types, employees, submit, canApproveNow = false, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: balances[0]?.leaveTypeId ?? '', from: '', to: '', halfDay: false, half: 'FIRST', reason: '', arrangement: '', approveNow: false })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const options = types ? types.filter((x) => x.active) : balances.map((b) => ({ id: b.leaveTypeId, name: b.name, code: b.code, allowHalfDay: b.allowHalfDay }))
  const type = options.find((x) => x.id === form.leaveTypeId)
  const bal = balances.find((b) => b.leaveTypeId === form.leaveTypeId)
  const oneDay = form.from && (!form.to || form.to === form.from)
  // a rough count for the person (the server counts offs and holidays exactly)
  const rough = form.from && form.to >= form.from ? leaveDates(form.from, form.to, { halfDay: form.halfDay && oneDay, offDays: ['SUN'] }).days : 0
  const save = useMutation({
    mutationFn: () => submit({
      ...(employees && { employeeId: form.employeeId, approveNow: form.approveNow }),
      leaveTypeId: form.leaveTypeId, from: form.from, to: form.to || form.from, halfDay: !!(form.halfDay && oneDay), half: form.halfDay && oneDay ? form.half : undefined,
      reason: form.reason, arrangement: form.arrangement,
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('hrms.leave.applyTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.leaveTypeId || !form.from || form.reason.trim().length < 2 || (employees && !form.employeeId)} onClick={() => save.mutate()}>{t('hrms.leave.send')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        {employees && (
          <div className="col-span-2">
            <FormField label={t('hrms.leave.person')} required error={errors.employeeId}>
              <Select value={form.employeeId} onChange={set('employeeId')}>
                <option value="">{t('hrms.leave.pickPerson')}</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{`${e.name} · ${e.code}`}</option>)}
              </Select>
            </FormField>
          </div>
        )}
        <div className="col-span-2">
          <FormField label={t('hrms.leave.type')} required error={errors.leaveTypeId}>
            <Select value={form.leaveTypeId} onChange={set('leaveTypeId')}>
              <option value="">{t('hrms.leave.pickType')}</option>
              {options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </FormField>
          {bal && <p className="text-xs text-ink-muted mt-1">{bal.available === null ? t('hrms.leave.noLimit') : t('hrms.leave.free', { n: bal.available })}</p>}
        </div>
        <FormField label={t('hrms.leave.from')} required error={errors.from}><Input type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value, to: f.to && f.to >= e.target.value ? f.to : e.target.value }))} /></FormField>
        <FormField label={t('hrms.leave.to')} error={errors.to}><Input type="date" min={form.from} value={form.to} onChange={set('to')} /></FormField>
        {oneDay && type?.allowHalfDay !== false && (
          <div className="col-span-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.halfDay} onChange={set('halfDay')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t('hrms.leave.halfDay')}
            </label>
            {form.halfDay && (
              <div className="w-44">
                <Select value={form.half} onChange={set('half')} aria-label={t('hrms.leave.whichHalf')}>
                  <option value="FIRST">{t('hrms.leave.firstHalf')}</option>
                  <option value="SECOND">{t('hrms.leave.secondHalf')}</option>
                </Select>
              </div>
            )}
          </div>
        )}
        {rough > 0 && <p className="col-span-2 text-xs text-ink-muted">{t('hrms.leave.roughDays', { count: rough })}</p>}
        <div className="col-span-2"><FormField label={t('hrms.leave.reason')} required error={errors.reason}><Textarea rows={2} value={form.reason} onChange={set('reason')} /></FormField></div>
        <div className="col-span-2"><FormField label={t('hrms.leave.arrangement')} hint={t('hrms.leave.arrangementHint')}><Textarea rows={2} value={form.arrangement} onChange={set('arrangement')} /></FormField></div>
        {employees && canApproveNow && (
          <label className="col-span-2 inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.approveNow} onChange={set('approveNow')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
            {t('hrms.leave.approveNow')}
          </label>
        )}
        {errors.halfDay && <div className="col-span-2"><Note tone="warning">{errors.halfDay}</Note></div>}
      </div>
    </Modal>
  )
}
