import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Eye, EyeOff, History, KeyRound, LogOut, Pencil, Undo2, UserRound, Wallet } from 'lucide-react'
import { EMPLOYEE_STATUSES, EXIT_TYPES, SALARY_MODES, toPaise, toRupees } from '@schoolgiant/shared'
import { Attachments, DataTable, Fact, FactGrid, FormField, Input, Modal, Money, Note, PageContainer, Panel, Select, StatusPill, Tabs, Textarea, Timeline, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import {
  adjustEmployeeLeave, cancelEmployeeExit, createEmployeeLogin, exitEmployee, fetchEmployee, fetchEmployeeLeave, fetchEmployeeLedger, fetchEmployeeSensitive, fetchLeaveTypes,
  linkEmployeeLogin, saveEmployeeSalary, saveEmployeeSensitive,
} from '../../api/hrms'
import { fetchRoles } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels, useHrMeta } from '../../components/hrms/HrKit'
import { EmployeeForm } from './Employees'

function SalaryForm({ emp, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const s = emp.salary ?? {}
  const [form, setForm] = useState({ paymentMode: s.paymentMode ?? 'BANK', grossMonthly: s.grossMonthly ? String(toRupees(s.grossMonthly)) : '', basicMonthly: s.basicMonthly ? String(toRupees(s.basicMonthly)) : '', ctcAnnual: s.ctcAnnual ? String(toRupees(s.ctcAnnual)) : '', pf: s.pf ?? true, esi: s.esi ?? false, pt: s.pt ?? true, effectiveFrom: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({
    mutationFn: () => saveEmployeeSalary(emp.id, { ...form, grossMonthly: toPaise(form.grossMonthly), basicMonthly: form.basicMonthly ? toPaise(form.basicMonthly) : undefined, ctcAnnual: form.ctcAnnual ? toPaise(form.ctcAnnual) : undefined }),
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('hrms.profile.salaryTitle', { name: emp.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!(Number(form.grossMonthly) > 0)} onClick={() => save.mutate()}>{t('hrms.profile.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('hrms.profile.gross')} required><Input type="number" min="0" value={form.grossMonthly} onChange={set('grossMonthly')} /></FormField>
        <FormField label={t('hrms.profile.basic')}><Input type="number" min="0" value={form.basicMonthly} onChange={set('basicMonthly')} /></FormField>
        <FormField label={t('hrms.profile.ctc')}><Input type="number" min="0" value={form.ctcAnnual} onChange={set('ctcAnnual')} /></FormField>
        <FormField label={t('hrms.profile.paymentMode')}>
          <Select value={form.paymentMode} onChange={set('paymentMode')}>{SALARY_MODES.map((m) => <option key={m} value={m}>{t(`hrms.profile.modes.${m}`)}</option>)}</Select>
        </FormField>
        <div className="col-span-2 flex flex-wrap gap-4">
          {['pf', 'esi', 'pt'].map((k) => (
            <label key={k} className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form[k]} onChange={set(k)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t(`hrms.profile.deduct.${k}`)}
            </label>
          ))}
        </div>
        <FormField label={t('hrms.profile.effectiveFrom')}><Input type="date" value={form.effectiveFrom} onChange={set('effectiveFrom')} /></FormField>
        <p className="col-span-2 text-xs text-ink-faint">{t('hrms.profile.salaryHint')}</p>
      </div>
    </Modal>
  )
}

function IdsForm({ emp, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ pan: '', aadhaar: '', uan: '', esi: '', bankName: emp.bank?.bankName ?? '', ifsc: emp.bank?.ifsc ?? '', accountName: emp.bank?.accountName ?? '', account: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => saveEmployeeSensitive(emp.id, form), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  const masked = { ...emp.statutory, account: emp.bank?.account }
  return (
    <Modal open onClose={onClose} title={t('hrms.profile.idsTitle', { name: emp.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('hrms.profile.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        {['pan', 'aadhaar', 'uan', 'esi'].map((k) => (
          <FormField key={k} label={t(`hrms.profile.ids.${k}`)} hint={masked[k] ? t('hrms.profile.keepBlank', { v: masked[k] }) : undefined} error={errors[k]}><Input value={form[k]} onChange={set(k)} autoComplete="off" /></FormField>
        ))}
        <FormField label={t('hrms.profile.bankName')}><Input value={form.bankName} onChange={set('bankName')} /></FormField>
        <FormField label={t('hrms.profile.ifsc')} error={errors.ifsc}><Input value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} /></FormField>
        <FormField label={t('hrms.profile.accountName')}><Input value={form.accountName} onChange={set('accountName')} /></FormField>
        <FormField label={t('hrms.profile.account')} hint={masked.account ? t('hrms.profile.keepBlank', { v: masked.account }) : undefined} error={errors.account}><Input value={form.account} onChange={set('account')} inputMode="numeric" autoComplete="off" /></FormField>
        <p className="col-span-2 text-xs text-ink-faint">{t('hrms.profile.idsHint')}</p>
      </div>
    </Modal>
  )
}

function ExitForm({ emp, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ type: 'RESIGNED', noticeDate: '', lastWorkingDate: '', reason: '', deactivateLogin: true })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({ mutationFn: () => exitEmployee(emp.id, form), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={t('hrms.profile.exitTitle', { name: emp.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button variant="danger" loading={save.isPending} disabled={!form.lastWorkingDate} onClick={() => save.mutate()}>{t('hrms.profile.exitSave')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('hrms.profile.exitType')}><Select value={form.type} onChange={set('type')}>{EXIT_TYPES.map((x) => <option key={x.value} value={x.value}>{L.exit(x.value)}</option>)}</Select></FormField>
        <FormField label={t('hrms.profile.noticeDate')}><Input type="date" value={form.noticeDate} onChange={set('noticeDate')} /></FormField>
        <FormField label={t('hrms.profile.lastDay')} required error={errors.lastWorkingDate}><Input type="date" value={form.lastWorkingDate} onChange={set('lastWorkingDate')} /></FormField>
        <div className="col-span-2"><FormField label={t('hrms.profile.exitReason')}><Textarea rows={2} value={form.reason} onChange={set('reason')} /></FormField></div>
        {emp.login && (
          <label className="col-span-2 inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.deactivateLogin} onChange={set('deactivateLogin')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
            {t('hrms.profile.deactivateLogin')}
          </label>
        )}
        <p className="col-span-2 text-xs text-ink-faint">{t('hrms.profile.exitHint')}</p>
      </div>
    </Modal>
  )
}

function LoginPanel({ emp, onChanged }) {
  const { t } = useTranslation('hrms')
  const { showSuccess, showError } = useSnackbar()
  const { data: meta } = useHrMeta()
  const canUsers = hasPermission('core.users.create')
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, enabled: canUsers && !emp.login })
  const [userId, setUserId] = useState('')
  const [made, setMade] = useState(null)
  const [form, setForm] = useState({ email: emp.email ?? '', roleId: '' })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { if (r?.tempPassword || r?.inviteToken) setMade(r); onChanged(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  if (emp.login) {
    return (
      <Panel title={t('hrms.profile.login')} icon={KeyRound}>
        <p className="text-sm text-ink">{emp.login.email}</p>
        <p className="text-xs text-ink-muted">{emp.login.active ? t('hrms.profile.loginActive') : t('hrms.profile.loginOff')}</p>
        {hasPermission('hrms.employees.edit') && <Button size="sm" variant="ghost" className="mt-2" onClick={() => act.mutate({ fn: () => linkEmployeeLogin(emp.id, null), done: t('hrms.profile.unlinked') })}>{t('hrms.profile.unlink')}</Button>}
      </Panel>
    )
  }
  return (
    <Panel title={t('hrms.profile.login')} icon={KeyRound}>
      <p className="text-sm text-ink-muted mb-3">{t('hrms.profile.noLoginHint')}</p>
      {made && <Note tone="success" className="mb-3">{made.tempPassword ? t('hrms.profile.tempPassword', { pw: made.tempPassword }) : t('hrms.profile.invited')}</Note>}
      {hasPermission('hrms.employees.edit') && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t('hrms.employees.pickLogin')}>
                <option value="">{t('hrms.employees.pickLogin')}</option>
                {(meta?.unlinkedUsers ?? []).map((u) => <option key={u.id} value={u.id}>{`${u.name} · ${u.email}`}</option>)}
              </Select>
            </div>
            <Button size="sm" variant="secondary" disabled={!userId} onClick={() => act.mutate({ fn: () => linkEmployeeLogin(emp.id, userId), done: t('hrms.profile.linked') })}>{t('hrms.profile.link')}</Button>
          </div>
          {canUsers && (
            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <FormField label={t('hrms.employees.loginEmail')}><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></FormField>
              <FormField label={t('hrms.employees.role')}>
                <Select value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                  <option value="">{t('hrms.employees.pickRole')}</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </FormField>
              <Button size="sm" disabled={!form.email || !form.roleId} loading={act.isPending} onClick={() => act.mutate({ fn: () => createEmployeeLogin(emp.id, { email: form.email, roleIds: [form.roleId], invite: true }), done: t('hrms.profile.loginMade') })}>{t('hrms.profile.makeLogin')}</Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function LeaveTab({ emp }) {
  const { t } = useTranslation('hrms')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [typeId, setTypeId] = useState('')
  const [adj, setAdj] = useState({ leaveTypeId: '', days: '', note: '' })
  const { data: balances = [] } = useQuery({ queryKey: ['emp-leave', emp.id], queryFn: () => fetchEmployeeLeave(emp.id) })
  const { data: ledger = [] } = useQuery({ queryKey: ['emp-ledger', emp.id, typeId], queryFn: () => fetchEmployeeLedger(emp.id, typeId || undefined), enabled: hasPermission('hrms.leave.view') })
  const { data: types = [] } = useQuery({ queryKey: ['leave-types'], queryFn: fetchLeaveTypes, enabled: hasPermission('hrms.leave.edit') })
  const adjust = useMutation({
    mutationFn: () => adjustEmployeeLeave(emp.id, { ...adj, days: Number(adj.days) }),
    onSuccess: () => { ['emp-leave', 'emp-ledger'].forEach((k) => qc.invalidateQueries({ queryKey: [k, emp.id] })); setAdj({ leaveTypeId: '', days: '', note: '' }); showSuccess(t('hrms.profile.adjusted')) },
    onError: (e) => showError(e.message),
  })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {balances.map((b) => (
          <button key={b.leaveTypeId} type="button" onClick={() => setTypeId(typeId === b.leaveTypeId ? '' : b.leaveTypeId)} className={`text-left rounded-xl border p-3 ${typeId === b.leaveTypeId ? 'border-brand-400 bg-brand-50/40' : 'border-border bg-surface hover:bg-bg'}`}>
            <p className="text-xs text-ink-muted">{b.name}</p>
            <p className="text-xl font-semibold text-ink font-mono-num">{b.balance}</p>
            <p className="text-[11px] text-ink-faint">{t('hrms.leave.takenPending', { taken: b.taken, pending: b.pending })}</p>
          </button>
        ))}
      </div>
      {hasPermission('hrms.leave.view') && (
        <Panel title={t('hrms.profile.ledger')} flush>
          <DataTable rows={ledger} dense className="border-0 shadow-none" columns={[
            { key: 'date', header: t('hrms.profile.ledgerDate'), nowrap: true, render: (v) => date(v) },
            { key: 'leaveCode', header: t('hrms.leave.type') },
            { key: 'kind', header: t('hrms.profile.ledgerKind'), render: (v) => t(`hrms.leave.kinds.${v}`, v) },
            { key: 'days', header: t('hrms.profile.ledgerDays'), align: 'right', render: (v) => <span className={`font-mono-num ${v < 0 ? 'text-danger-600' : 'text-success-700'}`}>{v > 0 ? `+${v}` : v}</span> },
            { key: 'note', header: t('hrms.profile.ledgerNote'), render: (v, r) => <span className="text-xs text-ink-muted">{[v, r.by].filter(Boolean).join(' · ')}</span> },
          ]} emptyTitle={t('hrms.profile.ledgerEmpty')} />
        </Panel>
      )}
      {hasPermission('hrms.leave.edit') && (
        <Panel title={t('hrms.profile.adjust')} subtitle={t('hrms.profile.adjustHint')}>
          <div className="grid sm:grid-cols-[1fr_.6fr_2fr_auto] gap-2 items-end">
            <FormField label={t('hrms.leave.type')}>
              <Select value={adj.leaveTypeId} onChange={(e) => setAdj((a) => ({ ...a, leaveTypeId: e.target.value }))}>
                <option value="">{t('hrms.leave.pickType')}</option>
                {types.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </FormField>
            <FormField label={t('hrms.profile.ledgerDays')}><Input type="number" step="0.5" value={adj.days} onChange={(e) => setAdj((a) => ({ ...a, days: e.target.value }))} placeholder="+1 / -0.5" /></FormField>
            <FormField label={t('hrms.profile.ledgerNote')}><Input value={adj.note} onChange={(e) => setAdj((a) => ({ ...a, note: e.target.value }))} /></FormField>
            <Button size="sm" loading={adjust.isPending} disabled={!adj.leaveTypeId || !Number(adj.days) || adj.note.trim().length < 3} onClick={() => adjust.mutate()}>{t('hrms.profile.adjustGo')}</Button>
          </div>
        </Panel>
      )}
    </div>
  )
}

/** One staff member: details, job history, leave, pay and ids (for those allowed), login, files, exit. */
export default function EmployeeProfile() {
  const { id } = useParams()
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('overview')
  const [modal, setModal] = useState(null)
  const [reveal, setReveal] = useState(false)
  const { data: emp, isLoading, error } = useQuery({ queryKey: ['employee', id], queryFn: () => fetchEmployee(id) })
  const secret = useQuery({ queryKey: ['employee-sensitive', id], queryFn: () => fetchEmployeeSensitive(id), enabled: reveal, staleTime: Infinity, gcTime: 0 })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['employee', id] }); qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['hrms-meta'] }) }
  const undoExit = useMutation({ mutationFn: () => cancelEmployeeExit(id), onSuccess: () => { refresh(); showSuccess(t('hrms.profile.exitUndone')) }, onError: (e) => showError(e.message) })
  if (isLoading) return <PageContainer><p className="text-sm text-ink-faint">{t('hrms.loading')}</p></PageContainer>
  if (error || !emp) return <PageContainer><Note tone="warning">{error?.message}</Note></PageContainer>
  const canEdit = hasPermission('hrms.employees.edit')
  const canExit = hasPermission('hrms.employees.terminate')
  const showIds = emp.statutory !== undefined
  const tabs = [
    { value: 'overview', label: t('hrms.profile.tabs.overview') },
    { value: 'leave', label: t('hrms.profile.tabs.leave') },
    ...(emp.salary !== undefined || showIds ? [{ value: 'pay', label: t('hrms.profile.tabs.pay') }] : []),
    { value: 'history', label: t('hrms.profile.tabs.history') },
    ...(showIds ? [{ value: 'files', label: t('hrms.profile.tabs.files') }] : []),
  ]
  const s = secret.data
  const done = (msg) => () => { setModal(null); refresh(); showSuccess(msg) }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => navigate('/hrms/employees')} aria-label={t('hrms.profile.back')} />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink truncate">{emp.name}</h1>
            <p className="text-sm text-ink-muted">{[emp.designation, L.category(emp.category), emp.department].filter(Boolean).join(' · ')} <span className="font-mono-num text-ink-faint">· {emp.employeeCode}</span></p>
          </div>
          <StatusPill tone={EMPLOYEE_STATUSES[emp.status]?.tone}>{L.status(emp.status)}</StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setModal('edit')}>{t('hrms.profile.edit')}</Button>}
          {canExit && emp.status !== 'EXITED' && !emp.exit && <Button variant="ghost" icon={LogOut} onClick={() => setModal('exit')}>{t('hrms.profile.exit')}</Button>}
          {canExit && emp.exit && <Button variant="ghost" icon={Undo2} loading={undoExit.isPending}
            onClick={async () => { if (await confirm({ title: t('hrms.profile.undoExitTitle'), message: t('hrms.profile.undoExitHint'), confirmLabel: t('hrms.profile.undoExit') })) undoExit.mutate() }}>{t('hrms.profile.undoExit')}</Button>}
        </div>
      </div>
      {emp.exit && <Note tone="warning" className="mb-4">{t('hrms.profile.exitNote', { type: L.exit(emp.exit.type), date: date(emp.exit.lastWorkingDate), reason: emp.exit.reason ?? '' })}</Note>}
      <Tabs className="mb-4" tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
          <Panel title={t('hrms.profile.details')} icon={UserRound}>
            <FactGrid cols={2} items={[
              { label: t('hrms.employees.employmentType'), value: L.employment(emp.employmentType) },
              { label: t('hrms.employees.joiningDate'), value: date(emp.joiningDate) },
              { label: t('hrms.employees.confirmationDate'), value: emp.confirmationDate && date(emp.confirmationDate) },
              { label: t('hrms.employees.manager'), value: emp.manager?.name },
              { label: t('hrms.employees.branch'), value: emp.branch },
              { label: t('hrms.employees.mobile'), value: emp.mobile, mono: true },
              { label: t('hrms.employees.email'), value: emp.email },
              { label: t('hrms.employees.gender'), value: emp.gender && t(`hrms.genders.${emp.gender}`) },
              { label: t('hrms.employees.dob'), value: emp.dob && date(emp.dob) },
              { label: t('hrms.employees.qualifications'), value: emp.qualifications },
              { label: t('hrms.employees.experience'), value: emp.experienceYears != null ? t('hrms.profile.years', { count: emp.experienceYears }) : null },
              { label: t('hrms.employees.subjects'), value: emp.subjects?.join(', ') },
              { label: t('hrms.employees.weeklyOff'), value: emp.weeklyOffDays?.length ? emp.weeklyOffDays.map(L.day).join(', ') : t('hrms.profile.usualOff') },
              { label: t('hrms.profile.emergency'), value: emp.emergencyContact?.name ? `${emp.emergencyContact.name}${emp.emergencyContact.relation ? ` (${emp.emergencyContact.relation})` : ''} ${emp.emergencyContact.phone ?? ''}` : null },
            ]} />
            {emp.notes && <p className="text-sm text-ink-muted mt-3 whitespace-pre-line">{emp.notes}</p>}
          </Panel>
          <div className="space-y-4">
            <LoginPanel emp={emp} onChanged={refresh} />
            {emp.reports.length > 0 && (
              <Panel title={t('hrms.profile.reports', { count: emp.reports.length })}>
                {emp.reports.map((r) => <button key={r.id} type="button" onClick={() => navigate(`/hrms/employees/${r.id}`)} className="block w-full text-left py-1.5 text-sm text-ink hover:text-brand-600">{r.name}<span className="text-xs text-ink-faint"> · {r.designation ?? ''}</span></button>)}
              </Panel>
            )}
          </div>
        </div>
      )}

      {tab === 'leave' && <LeaveTab emp={emp} />}

      {tab === 'pay' && (
        <div className="grid lg:grid-cols-2 gap-4">
          {emp.salary !== undefined && (
            <Panel title={t('hrms.profile.salary')} icon={Wallet} actions={canEdit && <Button size="sm" variant="secondary" onClick={() => setModal('salary')}>{t('hrms.profile.edit')}</Button>}>
              {emp.salary ? (
                <FactGrid cols={2} items={[
                  { label: t('hrms.profile.gross'), value: <Money value={emp.salary.grossMonthly} paise /> },
                  { label: t('hrms.profile.basic'), value: emp.salary.basicMonthly != null && <Money value={emp.salary.basicMonthly} paise /> },
                  { label: t('hrms.profile.ctc'), value: emp.salary.ctcAnnual != null && <Money value={emp.salary.ctcAnnual} paise /> },
                  { label: t('hrms.profile.paymentMode'), value: t(`hrms.profile.modes.${emp.salary.paymentMode ?? 'BANK'}`) },
                  { label: t('hrms.profile.deductions'), value: ['pf', 'esi', 'pt'].filter((k) => emp.salary[k]).map((k) => t(`hrms.profile.deductShort.${k}`)).join(', ') || '—' },
                  { label: t('hrms.profile.revised'), value: emp.salary.revisedAt && `${dateTime(emp.salary.revisedAt)} · ${emp.salary.revisedBy ?? ''}` },
                ]} />
              ) : <p className="text-sm text-ink-faint">{t('hrms.profile.noSalary')}</p>}
            </Panel>
          )}
          {showIds && (
            <Panel title={t('hrms.profile.idsBank')} icon={KeyRound} actions={<div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={reveal ? EyeOff : Eye} onClick={() => setReveal(!reveal)}>{reveal ? t('hrms.profile.hide') : t('hrms.profile.show')}</Button>
              {canEdit && <Button size="sm" variant="secondary" onClick={() => setModal('ids')}>{t('hrms.profile.edit')}</Button>}
            </div>}>
              <FactGrid cols={2} items={[
                ...['pan', 'aadhaar', 'uan', 'esi'].map((k) => ({ label: t(`hrms.profile.ids.${k}`), value: (reveal ? s?.[k] : emp.statutory?.[k]) ?? null, mono: true })),
                { label: t('hrms.profile.bankName'), value: emp.bank?.bankName },
                { label: t('hrms.profile.ifsc'), value: emp.bank?.ifsc, mono: true },
                { label: t('hrms.profile.accountName'), value: emp.bank?.accountName },
                { label: t('hrms.profile.account'), value: (reveal ? s?.account : emp.bank?.account) ?? null, mono: true },
              ]} />
              {reveal && <p className="text-xs text-ink-faint mt-2">{t('hrms.profile.audited')}</p>}
            </Panel>
          )}
        </div>
      )}

      {tab === 'history' && (
        <Panel title={t('hrms.profile.tabs.history')} icon={History}>
          <Timeline items={emp.jobHistory.map((h, i) => ({
            id: String(i), title: t(`hrms.history.${h.type}`, h.type), time: h.date ? date(h.date) : undefined,
            meta: [h.from && h.to ? `${h.from} → ${h.to}` : h.to, h.by].filter(Boolean).join(' · '), body: h.note,
          }))} />
        </Panel>
      )}

      {tab === 'files' && <Panel title={t('hrms.profile.tabs.files')}><Attachments entityType="employee" entityId={emp.id} canAdd={canEdit} /></Panel>}

      {modal === 'edit' && <EmployeeForm employee={emp} onClose={() => setModal(null)} onSaved={done(t('hrms.employees.saved'))} />}
      {modal === 'salary' && <SalaryForm emp={emp} onClose={() => setModal(null)} onSaved={done(t('hrms.profile.salarySaved'))} />}
      {modal === 'ids' && <IdsForm emp={emp} onClose={() => setModal(null)} onSaved={() => { qc.removeQueries({ queryKey: ['employee-sensitive', id] }); setReveal(false); done(t('hrms.profile.idsSaved'))() }} />}
      {modal === 'exit' && <ExitForm emp={emp} onClose={() => setModal(null)} onSaved={done(t('hrms.profile.exitSaved'))} />}
    </PageContainer>
  )
}
