import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarHeart, CalendarOff, CircleCheck, CircleDashed, CircleX, Clock, Palmtree, Plus, X } from 'lucide-react'
import { APPRAISAL_STATUS } from '@schoolgiant/shared'
import { Avatar, Calendar, DataTable, Fact, FactGrid, FormField, Input, LevelBar, Note, Panel, PersonCell, StatCardRow, StatusPill, localIso, useTimeAgo } from '../../components/system'
import Button from '../../components/ui/Button'
import {
  fetchMyApprovals, fetchMyAttendance, fetchMyLeave, fetchMyRecord, fetchMyReview, fetchMyReviews, submitManagerReview, submitSelfReview, updateMyRecord,
} from '../../api/hrms'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels } from '../../components/hrms/HrKit'
import { BalanceBar, LeaveStatusPill, LeaveTypeName, halves, invalidateLeave, useBalanceText, useDaysText, useLeaveDates } from '../../components/hrms/leave/LeaveBits'
import { LeaveChainInline, LeaveDecisionButtons, useLeaveDecision } from '../../components/hrms/leave/LeaveChain'
import LeaveApplyModal from '../../components/hrms/leave/LeaveApplyModal'
import LeaveDrawer from '../../components/hrms/leave/LeaveDrawer'
import ReviewForm from '../../components/hrms/ReviewForm'
import clsx from 'clsx'

// My workspace › the Staff & HR tabs: what a member of staff sees of their own record.

export const ME_HR = ['hrms', 'me']

/** `applyOpen`: open the apply form straight away (Overview › Apply for leave); `onApplyClose` when it closes. */
export function MyLeaveTab({ applyOpen = false, onApplyClose } = {}) {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const days = useDaysText()
  const dates = useLeaveDates()
  const balanceText = useBalanceText()
  const { showSuccess } = useSnackbar()
  const [applyingHere, setApplying] = useState(false)
  const [open, setOpen] = useState(null)
  const applying = applyingHere || applyOpen
  const closeApply = () => { setApplying(false); onApplyClose?.() }
  const { data, isLoading } = useQuery({ queryKey: [...ME_HR, 'leave'], queryFn: fetchMyLeave })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('hrmsLeave.loading')}</p>
  // leave HR gives when it is granted (maternity, child-care, compensatory off) shows once there is some; until then it is named in a line
  const granted = (b) => !b.unlimited && !b.ofTotal && !b.available && !b.pending && !b.taken
  const shown = (data?.balances ?? []).filter((b) => !granted(b))
  const later = (data?.balances ?? []).filter(granted)
  const noLeave = (data?.calendar ?? []).filter((c) => c.kind === 'NO_LEAVE')
  const vacations = (data?.calendar ?? []).filter((c) => c.kind === 'VACATION')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{t('hrmsLeave.me.hint')}</p>
        {data?.canApply ? <Button icon={Plus} onClick={() => setApplying(true)}>{t('hrmsLeave.me.apply')}</Button> : <p className="text-xs text-ink-faint">{t('hrmsLeave.me.officeApplies')}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {shown.map((b) => (
          <div key={b.leaveTypeId} className="rounded-xl border border-border bg-surface px-4 py-3 min-w-0" title={b.description ?? undefined}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted truncate">{b.name}</p>
            {b.unlimited
              ? <p className="mt-1 text-sm text-ink">{balanceText(b)}</p>
              : <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{halves(b.available)}<span className="ms-1.5 text-xs font-normal text-ink-muted">{b.ofTotal ? t('hrmsLeave.me.ofDays', { of: days(b.ofTotal) }) : t('hrmsLeave.me.daysLeft')}</span></p>}
            {!b.unlimited && b.ofTotal > 0 && <BalanceBar left={b.available} of={b.ofTotal} className="mt-2" />}
            {b.pending > 0 && <p className="mt-1.5 text-[11px] text-amber-700">{t('hrmsLeave.me.waiting', { days: days(b.pending) })}</p>}
          </div>
        ))}
      </div>
      {later.length > 0 && <p className="-mt-1 text-xs text-ink-muted">{t('hrmsLeave.me.grantedLater', { types: later.map((b) => b.name).join(', ') })}</p>}
      {noLeave.length > 0 && (
        <Note tone="warning" icon={CalendarOff}>
          <p className="font-medium">{t('hrmsLeave.me.noLeaveTitle')}</p>
          {noLeave.map((c) => <p key={c.name + c.from}>{t(c.mode === 'BLOCK' ? 'hrmsLeave.me.noLeaveBlock' : c.mode === 'HR' ? 'hrmsLeave.me.noLeaveHr' : 'hrmsLeave.me.noLeaveWarn', { name: c.name, dates: dates(c) })}</p>)}
        </Note>
      )}
      {vacations.length > 0 && <Note icon={Palmtree}>{vacations.map((c) => <p key={c.name + c.from}>{t('hrmsLeave.me.vacation', { name: c.name, dates: dates(c) })}</p>)}</Note>}
      <Panel title={t('hrmsLeave.me.requests')} flush>
        <DataTable rows={data?.requests ?? []} dense className="border-0 shadow-none" onRowClick={setOpen} columns={[
          { key: 'leaveName', header: t('hrmsLeave.requests.leave'), mobilePrimary: true, render: (v, r) => <LeaveTypeName name={v} paid={r.paid} /> },
          { key: 'from', header: t('hrmsLeave.requests.when'), render: (_, r) => <div className="leading-tight"><p className="text-ink whitespace-nowrap">{dates(r)}</p><p className="text-[11px] text-ink-muted">{days(r.days)}</p></div> },
          { key: 'status', header: t('hrmsLeave.requests.where'), render: (v, r) => <div className="space-y-1">{v !== 'PENDING' && <LeaveStatusPill status={v} />}<LeaveChainInline chain={r.chain} /></div> },
        ]} emptyTitle={t('hrmsLeave.me.noRequests')} />
      </Panel>
      {open && <LeaveDrawer leave={open} mode="self" onClose={() => setOpen(null)} />}
      {applying && data && (
        <LeaveApplyModal balances={data.balances} onClose={closeApply}
          onDone={(l) => { closeApply(); qc.invalidateQueries({ queryKey: ME_HR }); showSuccess(l.chain?.waitingOn ? t('hrmsLeave.me.sentTo', { who: l.chain.waitingOn }) : t('hrmsLeave.me.sent')) }} />
      )}
    </div>
  )
}

export function MyAttendanceTab() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const [month, setMonth] = useState(localIso(new Date()).slice(0, 7))
  const { data, isLoading } = useQuery({ queryKey: [...ME_HR, 'attendance', month], queryFn: () => fetchMyAttendance(month) })
  const tot = data?.totals ?? {}
  // the month on the shared calendar: each day's mark inside its cell — present teal, absent red, half day / late amber;
  // holidays and weekly offs shade the day
  const off = (s) => s === 'HOLIDAY' || s === 'WEEKLY_OFF'
  const markTone = (d) => (d.status === 'ABSENT' ? 'danger' : d.status === 'HALF_DAY' || d.late ? 'warning' : d.status === 'PRESENT' ? 'accent' : 'neutral')
  const items = (data?.days ?? []).filter((d) => d.status && !off(d.status)).map((d) => ({
    id: d.date, date: d.date, title: d.late ? `${L.att(d.status)} · ${t('hrms.attendance.tot.late')}` : L.att(d.status), tone: markTone(d),
    time: d.inTime || undefined, endTime: d.outTime || undefined, kind: d.leave || undefined,
  }))
  const holidays = (data?.days ?? []).filter((d) => off(d.status)).map((d) => ({ date: d.date, name: d.holiday || L.att(d.status) }))
  return (
    <div className="space-y-4">
      {!isLoading && (
        <StatCardRow items={[
          { icon: CircleCheck, tone: 'success', label: L.att('PRESENT'), value: tot.PRESENT ?? 0 },
          { icon: CircleDashed, tone: 'warning', label: L.att('HALF_DAY'), value: tot.HALF_DAY ?? 0 },
          { icon: CircleX, tone: 'danger', label: L.att('ABSENT'), value: tot.ABSENT ?? 0 },
          { icon: Palmtree, tone: 'brand', label: L.att('LEAVE'), value: tot.LEAVE ?? 0 },
          { icon: Clock, tone: 'orange', label: t('hrms.attendance.tot.late'), value: tot.late ?? 0 },
        ]} />
      )}
      <Calendar month={month} onMonthChange={setMonth} loading={isLoading} items={items} holidays={holidays}
        legend={[{ tone: 'accent', label: L.att('PRESENT') }, { tone: 'warning', label: `${L.att('HALF_DAY')} / ${t('hrms.attendance.tot.late')}` }, { tone: 'danger', label: L.att('ABSENT') }, { tone: 'neutral', label: L.att('LEAVE') }]} />
      <p className="text-xs text-ink-faint">{t('hrms.me.attendanceHint')}</p>
    </div>
  )
}

export function MyApprovalsTab() {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const days = useDaysText()
  const dates = useLeaveDates()
  const [open, setOpen] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: [...ME_HR, 'approvals'], queryFn: fetchMyApprovals })
  const { decide, busy } = useLeaveDecision(() => invalidateLeave(qc), { asManager: true })
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">{t('hrmsLeave.me.teamHint')}</p>
      <DataTable rows={rows} loading={isLoading} onRowClick={(r) => setOpen(r.id)} columns={[
        { key: 'employeeName', header: t('hrmsLeave.requests.person'), mobilePrimary: true, render: (v) => <PersonCell name={v} /> },
        { key: 'leaveName', header: t('hrmsLeave.requests.leave'), render: (v, r) => <div><LeaveTypeName name={v} paid={r.paid} />{r.chain?.totalSteps > 1 && <p className="text-[11px] text-ink-muted">{t('hrmsLeave.chain.stepOf', { step: r.chain.stepNumber, total: r.chain.totalSteps })}</p>}</div> },
        { key: 'from', header: t('hrmsLeave.requests.when'), render: (_, r) => <div className="leading-tight"><p className="text-ink whitespace-nowrap">{dates(r)}</p><p className="text-[11px] text-ink-muted">{days(r.days)}</p></div> },
        { key: 'reason', header: t('hrmsLeave.requests.reason'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{v}{r.arrangement && <span className="block text-xs text-ink-faint">{t('hrmsLeave.me.arranged', { text: r.arrangement })}</span>}</span> },
        { key: 'id', header: '', align: 'right', render: (_, r) => <LeaveDecisionButtons leave={r} decide={decide} busy={busy} /> },
      ]} emptyTitle={t('hrmsLeave.me.noApprovals')} />
      {open && <LeaveDrawer id={open} mode="approver" onClose={() => setOpen(null)} />}
    </div>
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
      <div className="min-w-0 flex items-center gap-2.5">
        {mode === 'manager' && <Avatar name={a.employeeName} size={30} soft />}
        <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{mode === 'self' ? a.cycle?.name : a.employeeName}</p>
        <p className="text-xs text-ink-faint">{mode === 'self' ? [a.cycle?.dueDate && t('hrms.performance.dueBy', { date: a.cycle.dueDate }), a.reviewerName && t('hrms.performance.reviewedBy', { name: a.reviewerName })].filter(Boolean).join(' · ') : [a.designation, a.cycle?.name].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={APPRAISAL_STATUS[a.status]?.tone}>{L.review(a.status)}</StatusPill>
        {a.finalScore != null && <LevelBar value={a.finalScore} max={5} warnAt={3.49} dangerAt={2.49} width="w-20" />}
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
  const ago = useTimeAgo()
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
        {me.holidays.length ? me.holidays.map((h) => (
          <div key={h.date + h.name} className="flex items-center gap-3 py-1.5">
            <span className={clsx('inline-flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border leading-none', h.optional ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-pink-200 bg-pink-50 text-pink-700')}>
              <span className="text-[15px] font-bold tabular-nums">{Number(h.date.slice(8, 10))}</span>
              <CalendarHeart className="mt-0.5 h-2.5 w-2.5" aria-hidden />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-medium text-ink truncate">{h.name}{h.optional && <span className="text-xs font-normal text-ink-faint"> ({t('hrms.holidays.optionalShort')})</span>}</p>
              <p className="text-[11px] text-ink-faint">{date(h.date)} · {ago(h.date)}</p>
            </div>
          </div>
        )) : <p className="text-sm text-ink-faint">{t('hrms.me.noHolidays')}</p>}
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

