import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, Check, Plus, X } from 'lucide-react'
import { APPRAISAL_STATUS, LEAVE_STATUSES, STAFF_ATTENDANCE } from '@schoolgiant/shared'
import { DataTable, Fact, FactGrid, FormField, Input, Note, Panel, StatCardRow, StatusPill, localIso, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import {
  applyMyLeave, cancelMyLeave, decideAsManager, fetchMyApprovals, fetchMyAttendance, fetchMyLeave, fetchMyRecord, fetchMyReview, fetchMyReviews, submitManagerReview,
  submitSelfReview, updateMyRecord,
} from '../../api/hrms'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { LeaveApplyForm, useHrLabels, useLeaveSpan } from '../../components/hrms/HrKit'
import ReviewForm from '../../components/hrms/ReviewForm'
import clsx from 'clsx'

// My workspace › the Staff & HR tabs: what a member of staff sees of their own record.

export const ME_HR = ['hrms', 'me']

export function MyLeaveTab() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date } = useFormat()
  const span = useLeaveSpan()
  const { showSuccess, showError } = useSnackbar()
  const [applying, setApplying] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: [...ME_HR, 'leave'], queryFn: fetchMyLeave })
  const refresh = () => qc.invalidateQueries({ queryKey: ME_HR })
  const cancel = useMutation({ mutationFn: ({ id, reason }) => cancelMyLeave(id, reason), onSuccess: () => { refresh(); showSuccess(t('hrms.leave.cancelled')) }, onError: (e) => showError(e.message) })
  const today = localIso(new Date())
  if (isLoading) return <p className="text-sm text-ink-faint">{t('hrms.loading')}</p>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{t('hrms.me.leaveHint')}</p>
        {data?.canApply && <Button icon={Plus} onClick={() => setApplying(true)}>{t('hrms.me.apply')}</Button>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(data?.balances ?? []).map((b) => (
          <div key={b.leaveTypeId} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-xs text-ink-muted">{b.name}</p>
            <p className="text-xl font-semibold text-ink font-mono-num">{b.available ?? b.balance}</p>
            <p className="text-[11px] text-ink-faint">{b.available === null ? t('hrms.leave.noLimit') : t('hrms.leave.takenPending', { taken: b.taken, pending: b.pending })}</p>
          </div>
        ))}
      </div>
      <Panel title={t('hrms.me.requests')} flush>
        <DataTable rows={data?.requests ?? []} dense className="border-0 shadow-none" columns={[
          { key: 'leaveName', header: t('hrms.leave.type'), mobilePrimary: true },
          { key: 'from', header: t('hrms.leave.when'), nowrap: true, render: (_, r) => span(r, date) },
          { key: 'days', header: t('hrms.leave.days'), align: 'right' },
          { key: 'status', header: t('hrms.leave.status'), render: (v, r) => <span><StatusPill tone={LEAVE_STATUSES[v]?.tone}>{L.leaveStatus(v)}</StatusPill>{r.decided?.note && <span className="block text-[11px] text-ink-faint">{r.decided.note}</span>}</span> },
          { key: 'id', header: '', align: 'right', width: 60, render: (id, r) => (r.status === 'PENDING' || (r.status === 'APPROVED' && r.from > today)) && (
            <Button size="sm" variant="ghost" icon={Ban} aria-label={t('hrms.leave.cancel')} title={t('hrms.leave.cancel')}
              onClick={async () => { const reason = await prompt({ title: t('hrms.me.cancelTitle'), label: t('hrms.leave.cancelWhy'), confirmLabel: t('hrms.leave.cancel') }); if (reason !== null) cancel.mutate({ id, reason: reason || undefined }) }} />
          ) },
        ]} emptyTitle={t('hrms.me.noRequests')} />
      </Panel>
      {applying && <LeaveApplyForm balances={data?.balances ?? []} submit={applyMyLeave} onClose={() => setApplying(false)} onSaved={() => { setApplying(false); refresh(); showSuccess(t('hrms.me.applied')) }} />}
    </div>
  )
}

export function MyAttendanceTab() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const [month, setMonth] = useState(localIso(new Date()).slice(0, 7))
  const { data, isLoading } = useQuery({ queryKey: [...ME_HR, 'attendance', month], queryFn: () => fetchMyAttendance(month) })
  const tot = data?.totals ?? {}
  const first = data?.days?.[0]?.date
  const pad = first ? (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7 : 0
  const tone = { success: 'bg-success-50 text-success-700', warning: 'bg-amber-50 text-amber-700', danger: 'bg-danger-50 text-danger-700', info: 'bg-sky-50 text-sky-700', brand: 'bg-brand-50 text-brand-700', neutral: 'bg-bg text-ink-muted' }
  return (
    <div className="space-y-4">
      <div className="w-44"><FormField label={t('hrms.attendance.month')}><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FormField></div>
      {isLoading ? <p className="text-sm text-ink-faint">{t('hrms.loading')}</p> : (
        <>
          <StatCardRow items={[
            { label: L.att('PRESENT'), value: tot.PRESENT ?? 0 }, { label: L.att('HALF_DAY'), value: tot.HALF_DAY ?? 0 }, { label: L.att('ABSENT'), value: tot.ABSENT ?? 0 },
            { label: L.att('LEAVE'), value: tot.LEAVE ?? 0 }, { label: t('hrms.attendance.tot.late'), value: tot.late ?? 0 },
          ]} />
          <div className="grid grid-cols-7 gap-1.5 max-w-xl">
            {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => <div key={d} className="text-center text-[11px] text-ink-faint">{L.day(d)}</div>)}
            {Array.from({ length: pad }, (_, i) => <div key={`p${i}`} />)}
            {(data?.days ?? []).map((d) => (
              <div key={d.date} title={[d.holiday, d.leave, d.inTime && `${d.inTime}–${d.outTime ?? ''}`].filter(Boolean).join(' · ')}
                className={clsx('rounded-lg p-1.5 text-center min-h-[48px]', d.status ? tone[STAFF_ATTENDANCE[d.status]?.tone ?? 'neutral'] : 'border border-dashed border-border text-ink-faint')}>
                <p className="text-xs font-semibold">{Number(d.date.slice(8))}</p>
                <p className="text-[10px]">{d.status ? L.attCode(d.status) : ''}{d.late ? ' ·' : ''}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-faint">{t('hrms.me.attendanceHint')}</p>
        </>
      )}
    </div>
  )
}

export function MyApprovalsTab() {
  const { t } = useTranslation('hrms')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date } = useFormat()
  const span = useLeaveSpan()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: [...ME_HR, 'approvals'], queryFn: fetchMyApprovals })
  const act = useMutation({ mutationFn: ({ id, approve, note }) => decideAsManager(id, { approve, note }), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ME_HR }); qc.invalidateQueries({ queryKey: ['leaves'] }); showSuccess(v.approve ? t('hrms.leave.approved') : t('hrms.leave.rejected')) }, onError: (e) => showError(e.message) })
  return (
    <DataTable rows={rows} loading={isLoading} columns={[
      { key: 'employeeName', header: t('hrms.leave.person'), mobilePrimary: true },
      { key: 'leaveName', header: t('hrms.leave.type') },
      { key: 'from', header: t('hrms.leave.when'), nowrap: true, render: (_, r) => span(r, date) },
      { key: 'days', header: t('hrms.leave.days'), align: 'right' },
      { key: 'reason', header: t('hrms.leave.reason'), render: (v, r) => <span className="text-sm text-ink-muted">{v}{r.arrangement && <span className="block text-xs text-ink-faint">{t('hrms.leave.arrangementShort', { text: r.arrangement })}</span>}</span> },
      { key: 'id', header: '', align: 'right', width: 100, render: (id, r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Check} aria-label={t('hrms.leave.approve')} title={t('hrms.leave.approve')} onClick={() => act.mutate({ id, approve: true })} />
          <Button size="sm" variant="ghost" icon={X} aria-label={t('hrms.leave.reject')} title={t('hrms.leave.reject')}
            onClick={async () => { const note = await prompt({ title: t('hrms.leave.rejectTitle', { name: r.employeeName }), label: t('hrms.leave.rejectWhy'), confirmLabel: t('hrms.leave.reject') }); if (note !== null) act.mutate({ id, approve: false, note: note || undefined }) }} />
        </div>
      ) },
    ]} emptyTitle={t('hrms.me.noApprovals')} />
  )
}

export function MyReviewsTab() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [open, setOpen] = useState(null) // { id, mode }
  const { data, isLoading } = useQuery({ queryKey: [...ME_HR, 'reviews'], queryFn: fetchMyReviews })
  const review = useQuery({ queryKey: [...ME_HR, 'review', open?.id], queryFn: () => fetchMyReview(open.id), enabled: !!open })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('hrms.loading')}</p>
  const row = (a, mode) => (
    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{mode === 'self' ? a.cycle?.name : a.employeeName}</p>
        <p className="text-xs text-ink-faint">{mode === 'self' ? [a.cycle?.dueDate && t('hrms.performance.dueBy', { date: a.cycle.dueDate }), a.reviewerName && t('hrms.performance.reviewedBy', { name: a.reviewerName })].filter(Boolean).join(' · ') : [a.designation, a.cycle?.name].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={APPRAISAL_STATUS[a.status]?.tone}>{L.review(a.status)}</StatusPill>
        {a.finalScore != null && <span className="text-sm font-semibold">{a.finalScore}/5</span>}
        {mode === 'self' && a.status === 'SELF' && <Button size="sm" onClick={() => setOpen({ id: a.id, mode: 'self' })}>{t('hrms.performance.doSelf')}</Button>}
        {mode === 'manager' && a.status === 'MANAGER' && <Button size="sm" onClick={() => setOpen({ id: a.id, mode: 'manager' })}>{t('hrms.performance.doRate')}</Button>}
        {a.status === 'DONE' && <Button size="sm" variant="ghost" onClick={() => setOpen({ id: a.id, mode: 'view' })}>{t('hrms.performance.view')}</Button>}
      </div>
    </div>
  )
  const r = review.data
  return (
    <div className="space-y-4">
      <Panel title={t('hrms.me.myReviews')}>{data?.mine?.length ? data.mine.map((a) => row(a, 'self')) : <p className="text-sm text-ink-faint">{t('hrms.me.noReviews')}</p>}</Panel>
      {data?.team?.length > 0 && <Panel title={t('hrms.me.teamReviews')}>{data.team.map((a) => row(a, 'manager'))}</Panel>}
      {open && r && open.mode !== 'view' && (
        <ReviewForm review={r} mode={open.mode} submit={(body) => (open.mode === 'self' ? submitSelfReview(r.id, body) : submitManagerReview(r.id, body))}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ME_HR }); showSuccess(t('hrms.performance.sent')) }} />
      )}
      {open?.mode === 'view' && r && (
        <Panel title={t('hrms.performance.resultTitle', { name: r.employeeName })} actions={<Button size="sm" variant="ghost" icon={X} aria-label={t('actions.close')} onClick={() => setOpen(null)} />}>
          <FactGrid cols={2} items={[
            { label: t('hrms.performance.final'), value: r.finalScore != null ? `${r.finalScore}/5` : '—' },
            { label: t('hrms.performance.selfScore'), value: r.self?.score != null ? `${r.self.score}/5` : '—' },
          ]} />
          {(r.cycle?.criteria ?? []).map((c) => <Fact key={c.key} label={c.label} value={`${r.manager?.ratings?.[c.key] ?? '—'} / 5${r.self?.ratings?.[c.key] ? ` (${t('hrms.performance.selfSaid', { n: r.self.ratings[c.key] })})` : ''}`} />)}
          {['strengths', 'improve', 'goals', 'comments'].map((k) => r.manager?.[k] && <Fact key={k} label={t(`hrms.performance.${k}`)} value={r.manager[k]} text />)}
        </Panel>
      )}
    </div>
  )
}

export function MyProfileTab() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: me, isLoading } = useQuery({ queryKey: [...ME_HR, 'record'], queryFn: fetchMyRecord })
  const [edit, setEdit] = useState(null)
  const save = useMutation({ mutationFn: () => updateMyRecord(edit), onSuccess: () => { setEdit(null); qc.invalidateQueries({ queryKey: ME_HR }); showSuccess(t('hrms.me.saved')) }, onError: (e) => showError(e.message) })
  if (isLoading || !me) return <p className="text-sm text-ink-faint">{t('hrms.loading')}</p>
  return (
    <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
      <Panel title={t('hrms.me.record')} actions={!edit && <Button size="sm" variant="secondary" onClick={() => setEdit({ mobile: me.mobile ?? '', emergencyContact: { name: me.emergencyContact?.name ?? '', relation: me.emergencyContact?.relation ?? '', phone: me.emergencyContact?.phone ?? '' } })}>{t('hrms.me.editContact')}</Button>}>
        <FactGrid cols={2} items={[
          { label: t('hrms.employees.code'), value: me.employeeCode, mono: true },
          { label: t('hrms.employees.designation'), value: me.designation },
          { label: t('hrms.employees.category'), value: L.category(me.category) },
          { label: t('hrms.employees.department'), value: me.department },
          { label: t('hrms.employees.joiningDate'), value: date(me.joiningDate) },
          { label: t('hrms.employees.manager'), value: me.manager?.name },
          { label: t('hrms.employees.mobile'), value: me.mobile, mono: true },
          { label: t('hrms.employees.email'), value: me.email },
          { label: t('hrms.profile.emergency'), value: me.emergencyContact?.name ? `${me.emergencyContact.name} ${me.emergencyContact.phone ?? ''}` : null },
        ]} />
        {edit && (
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <FormField label={t('hrms.employees.mobile')}><Input value={edit.mobile} onChange={(e) => setEdit((x) => ({ ...x, mobile: e.target.value }))} /></FormField>
            <FormField label={t('hrms.me.emergencyName')}><Input value={edit.emergencyContact.name} onChange={(e) => setEdit((x) => ({ ...x, emergencyContact: { ...x.emergencyContact, name: e.target.value } }))} /></FormField>
            <FormField label={t('hrms.me.emergencyRelation')}><Input value={edit.emergencyContact.relation} onChange={(e) => setEdit((x) => ({ ...x, emergencyContact: { ...x.emergencyContact, relation: e.target.value } }))} /></FormField>
            <FormField label={t('hrms.me.emergencyPhone')}><Input value={edit.emergencyContact.phone} onChange={(e) => setEdit((x) => ({ ...x, emergencyContact: { ...x.emergencyContact, phone: e.target.value } }))} /></FormField>
            <div className="sm:col-span-2 flex gap-2">
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t('hrms.me.save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>{t('actions.cancel')}</Button>
            </div>
          </div>
        )}
        <p className="text-xs text-ink-faint mt-3">{t('hrms.me.recordHint')}</p>
      </Panel>
      <Panel title={t('hrms.me.holidays')}>
        {me.holidays.length ? me.holidays.map((h) => <p key={h.date + h.name} className="text-sm py-1"><span className="text-ink-muted">{date(h.date)}</span> · {h.name}{h.optional && <span className="text-xs text-ink-faint"> ({t('hrms.holidays.optionalShort')})</span>}</p>) : <p className="text-sm text-ink-faint">{t('hrms.me.noHolidays')}</p>}
      </Panel>
    </div>
  )
}

/** Whether to show the HR tabs: the record (null = no linked staff record yet). */
export function useMyHrRecord(enabled) {
  return useQuery({ queryKey: [...ME_HR, 'record'], queryFn: fetchMyRecord, enabled, retry: false })
}

export function HrNotLinked({ error }) {
  const { t } = useTranslation('hrms')
  if (!error) return null
  return <Note>{error.response?.data?.code === 'NO_EMPLOYEE' || error.response?.status === 404 ? t('hrms.me.notLinked') : error.message}</Note>
}

