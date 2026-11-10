import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, GitPullRequestArrow, Plus, Search, Trash2, X } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, LEAVE_APPROVER_TYPES, LEAVE_CHAIN_MAX_STEPS } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Modal, Note, Select, StatusPill, useConfirm } from '../../system'
import Button from '../../ui/Button'
import { createLeaveChain, deleteLeaveChain, fetchLeaveChainOptions, fetchLeaveChains, updateLeaveChain } from '../../../api/hrms'
import { hasPermission } from '../../../api/auth'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useHrLabels } from '../HrKit'
import { fieldErrors, useDaysText } from './LeaveBits'
import { Section, SwitchRow } from './LeavePolicies'

// Leave › Setup › Approval chains: who approves a leave request, step by step (up to five: the person they report
// to, the head of their department, the principal / HR, named people, anyone with a role), chosen by kind of leave,
// department, staff category and length. The highest-priority chain that matches wins; none matching → the reporting
// manager, else the principal / HR. A request keeps the chain it started with.

const KEY = ['leave-chains']

function Chips({ options, value, onChange, empty }) {
  if (!options.length) return <p className="text-xs text-ink-faint">{empty}</p>
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto scroll-thin">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button key={o.value} type="button" onClick={() => toggle(o.value)} aria-pressed={on}
            className={clsx('text-xs px-2.5 py-1 rounded-full border transition max-w-full truncate', on ? 'bg-brand-500 text-white border-brand-500' : 'border-border text-ink-muted hover:border-ink-faint')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Named approvers: search the active logins; chips for the ones picked. */
function UserPicker({ users, value, onChange }) {
  const { t } = useTranslation('hrmsLeave')
  const [q, setQ] = useState('')
  const byId = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return users.filter((u) => !value.includes(u.id) && `${u.name} ${u.designation ?? ''}`.toLowerCase().includes(needle)).slice(0, 8)
  }, [users, value, q])
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 max-w-full text-xs ps-2.5 pe-1 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-500/30">
              <span className="truncate">{byId[id]?.name ?? t('hrmsLeave.chains.unknown')}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={t('actions.remove')} className="p-0.5 rounded-full hover:bg-brand-500/10"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hrmsLeave.chains.findPerson')} className="!ps-8" />
      </div>
      {matches.length > 0 && (
        <ul className="rounded-lg border border-border divide-y divide-border">
          {matches.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => { onChange([...value, u.id]); setQ('') }} className="w-full text-start px-3 py-1.5 text-sm hover:bg-bg flex items-center justify-between gap-2">
                <span className="truncate text-ink">{u.name}</span>
                {u.designation && <span className="text-[11px] text-ink-faint truncate">{u.designation}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const blankStep = (type = 'REPORTING_MANAGER') => ({ label: '', approverType: type, userIds: [], roleIds: [] })
const blankRule = { name: '', active: true, priority: '10', scope: { leaveTypeIds: [], departmentIds: [], categories: [], minDays: '' }, steps: [blankStep()], skipSelfOrRepeat: true, escalateAfterHours: '' }

function RuleModal({ rule, types, departments, onClose, onDone }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const short = (type) => t(`hrmsLeave.approvers.short.${type}`)
  const [f, setF] = useState(() => (rule ? {
    ...rule, priority: String(rule.priority ?? 0), escalateAfterHours: rule.escalateAfterHours == null ? '' : String(rule.escalateAfterHours),
    scope: { ...rule.scope, minDays: rule.scope.minDays == null ? '' : String(rule.scope.minDays) },
    steps: rule.steps.map((s) => ({ label: s.label ?? '', approverType: s.approverType, userIds: s.userIds ?? [], roleIds: s.roleIds ?? [] })),
  } : blankRule))
  const [errors, setErrors] = useState({})
  const { data: options } = useQuery({ queryKey: ['leave-chain-options'], queryFn: fetchLeaveChainOptions, staleTime: 120_000 })
  const users = options?.users ?? []
  const roles = options?.roles ?? []
  const setScope = (k) => (v) => setF((x) => ({ ...x, scope: { ...x.scope, [k]: v } }))
  const setStep = (i, patch) => setF((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const move = (i, d) => setF((x) => { const steps = [...x.steps]; const [s] = steps.splice(i, 1); steps.splice(i + d, 0, s); return { ...x, steps } })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), active: f.active, priority: Number(f.priority || 0),
        scope: { leaveTypeIds: f.scope.leaveTypeIds, departmentIds: f.scope.departmentIds, categories: f.scope.categories, minDays: f.scope.minDays === '' ? null : Number(f.scope.minDays) },
        steps: f.steps.map((s) => ({ label: s.label.trim(), approverType: s.approverType, userIds: s.approverType === 'SPECIFIC_USERS' ? s.userIds : [], roleIds: s.approverType === 'ROLE' ? s.roleIds : [] })),
        skipSelfOrRepeat: f.skipSelfOrRepeat, escalateAfterHours: f.escalateAfterHours === '' ? null : Number(f.escalateAfterHours),
      }
      return rule ? updateLeaveChain(rule.id, body) : createLeaveChain(body)
    },
    onSuccess: onDone,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const stepsOk = f.steps.every((s) => (s.approverType !== 'SPECIFIC_USERS' || s.userIds.length) && (s.approverType !== 'ROLE' || s.roleIds.length))
  const ok = f.name.trim().length >= 2 && f.steps.length >= 1 && stepsOk
  return (
    <Modal open onClose={onClose} size="lg" title={rule ? t('hrmsLeave.chains.editTitle', { name: rule.name }) : t('hrmsLeave.chains.newTitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
          <FormField label={t('hrmsLeave.chains.name')} required error={errors.name}><Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} maxLength={80} placeholder={t('hrmsLeave.chains.namePlaceholder')} autoFocus /></FormField>
          <FormField label={t('hrmsLeave.chains.priority')} hint={t('hrmsLeave.chains.priorityHint')} error={errors.priority}><Input type="number" min="0" max="999" value={f.priority} onChange={(e) => setF((x) => ({ ...x, priority: e.target.value }))} /></FormField>
        </div>
        <SwitchRow checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} label={t('hrmsLeave.chains.inUse')} hint={t('hrmsLeave.chains.inUseHint')} />

        <Section title={t('hrmsLeave.chains.appliesTo')} hint={t('hrmsLeave.chains.appliesToHint')}>
          <FormField label={t('hrmsLeave.chains.leaveTypes')}><Chips options={types.map((lt) => ({ value: lt.id, label: lt.name }))} value={f.scope.leaveTypeIds} onChange={setScope('leaveTypeIds')} empty={t('hrmsLeave.chains.nothing')} /></FormField>
          <FormField label={t('hrmsLeave.chains.departments')}><Chips options={departments.map((d) => ({ value: d.id, label: d.name }))} value={f.scope.departmentIds} onChange={setScope('departmentIds')} empty={t('hrmsLeave.chains.nothing')} /></FormField>
          <FormField label={t('hrmsLeave.chains.staff')}><Chips options={EMPLOYEE_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))} value={f.scope.categories} onChange={setScope('categories')} empty={t('hrmsLeave.chains.nothing')} /></FormField>
          <FormField label={t('hrmsLeave.chains.minDays')} hint={t('hrmsLeave.chains.minDaysHint')} error={errors['scope.minDays']}>
            <Input type="number" min="0" max="366" step="0.5" className="max-w-[120px]" value={f.scope.minDays} onChange={(e) => setScope('minDays')(e.target.value)} />
          </FormField>
        </Section>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('hrmsLeave.chains.steps')}</p>
            <p className="text-xs text-ink-muted truncate">{f.steps.map((s) => s.label || short(s.approverType)).join(' → ')}</p>
          </div>
          {errors.steps && <p className="text-xs text-danger-600">{errors.steps}</p>}
          {f.steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <Select aria-label={t('hrmsLeave.chains.whoDecides')} value={s.approverType} onChange={(e) => setStep(i, { approverType: e.target.value })}>
                    {LEAVE_APPROVER_TYPES.map((a) => <option key={a.value} value={a.value}>{t(`hrmsLeave.approvers.long.${a.value}`)}</option>)}
                  </Select>
                </div>
                <div className="flex items-center shrink-0">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 text-ink-faint hover:text-ink disabled:opacity-30" aria-label={t('hrmsLeave.chains.moveUp')}><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" disabled={i === f.steps.length - 1} onClick={() => move(i, 1)} className="p-1.5 text-ink-faint hover:text-ink disabled:opacity-30" aria-label={t('hrmsLeave.chains.moveDown')}><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" disabled={f.steps.length === 1} onClick={() => setF((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }))} className="p-1.5 text-ink-faint hover:text-danger-600 disabled:opacity-30" aria-label={t('hrmsLeave.chains.removeStep')}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="text-[11px] text-ink-faint">{t(`hrmsLeave.approvers.hint.${s.approverType}`)}</p>
              <FormField label={t('hrmsLeave.chains.stepName')} hint={t('hrmsLeave.chains.stepNameHint')}>
                <Input value={s.label} maxLength={60} onChange={(e) => setStep(i, { label: e.target.value })} placeholder={short(s.approverType)} />
              </FormField>
              {s.approverType === 'SPECIFIC_USERS' && <FormField label={t('hrmsLeave.chains.people')} required error={errors[`steps.${i}.userIds`]}><UserPicker users={users} value={s.userIds} onChange={(v) => setStep(i, { userIds: v })} /></FormField>}
              {s.approverType === 'ROLE' && <FormField label={t('hrmsLeave.chains.roles')} required error={errors[`steps.${i}.roleIds`]}><Chips options={roles.map((r) => ({ value: r.id, label: r.name }))} value={s.roleIds} onChange={(v) => setStep(i, { roleIds: v })} empty={t('hrmsLeave.chains.loading')} /></FormField>}
            </div>
          ))}
          {f.steps.length < LEAVE_CHAIN_MAX_STEPS && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((x) => ({ ...x, steps: [...x.steps, blankStep('HR')] }))}>{t('hrmsLeave.chains.addStep')}</Button>}
        </div>

        <Section title={t('hrmsLeave.chains.more')}>
          <SwitchRow checked={f.skipSelfOrRepeat} onChange={(v) => setF((x) => ({ ...x, skipSelfOrRepeat: v }))} label={t('hrmsLeave.chains.skip')} hint={t('hrmsLeave.chains.skipHint')} />
          <FormField label={t('hrmsLeave.chains.moveOn')} hint={t('hrmsLeave.chains.moveOnHint')} error={errors.escalateAfterHours}>
            <Input type="number" min="1" max="720" className="max-w-[120px]" value={f.escalateAfterHours} onChange={(e) => setF((x) => ({ ...x, escalateAfterHours: e.target.value }))} />
          </FormField>
        </Section>
        <Note>{t('hrmsLeave.chains.selfNote')}</Note>
      </div>
    </Modal>
  )
}

export default function LeaveApprovalChains({ types = [], departments = [] }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const days = useDaysText()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const canEdit = hasPermission('hrms.leave.edit')
  const { data: rules = [], isLoading } = useQuery({ queryKey: KEY, queryFn: fetchLeaveChains })
  const typeBy = useMemo(() => Object.fromEntries(types.map((lt) => [lt.id, lt.name])), [types])
  const deptBy = useMemo(() => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments])
  const short = (type) => t(`hrmsLeave.approvers.short.${type}`)
  const remove = async (r) => {
    if (!(await confirm({ title: t('hrmsLeave.chains.deleteTitle', { name: r.name }), message: t('hrmsLeave.chains.deleteMsg'), tone: 'danger', confirmLabel: t('actions.delete') }))) return
    try { await deleteLeaveChain(r.id); showSuccess(t('hrmsLeave.chains.deleted')); qc.invalidateQueries({ queryKey: KEY }) } catch (e) { showError(e.message) }
  }
  const scopeText = (s) => [
    s.leaveTypeIds.length ? s.leaveTypeIds.map((id) => typeBy[id] ?? '?').join(', ') : null,
    s.departmentIds.length ? s.departmentIds.map((id) => deptBy[id] ?? '?').join(', ') : null,
    s.categories.length ? s.categories.map(L.category).join(', ') : null,
    s.minDays != null ? t('hrmsLeave.chains.minDaysText', { days: days(s.minDays) }) : null,
  ].filter(Boolean)
  const columns = [
    { key: 'name', header: t('hrmsLeave.chains.col.chain'), mobilePrimary: true, render: (v, r) => <div className="min-w-0"><p className="font-medium text-ink truncate">{v}</p>{r.updatedBy && <p className="text-[11px] text-ink-faint truncate">{t('hrmsLeave.chains.byName', { name: r.updatedBy })}</p>}</div> },
    { key: 'scope', header: t('hrmsLeave.chains.col.when'), render: (s) => { const p = scopeText(s); return p.length ? <span className="text-xs text-ink">{p.join(' · ')}</span> : <span className="text-xs text-ink-faint">{t('hrmsLeave.chains.every')}</span> } },
    { key: 'steps', header: t('hrmsLeave.chains.col.steps'), render: (steps) => (
      <div className="flex flex-wrap items-center gap-1 text-xs text-ink">
        {steps.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 min-w-0">
            {i > 0 && <span className="text-ink-faint">→</span>}
            <span className="px-1.5 py-0.5 rounded-md bg-bg border border-border truncate max-w-[180px]" title={[...(s.userNames ?? []), ...(s.roleNames ?? [])].join(', ') || undefined}>{s.label || short(s.approverType)}</span>
          </span>
        ))}
      </div>
    ) },
    { key: 'priority', header: t('hrmsLeave.chains.col.priority'), align: 'right', mobileHidden: true },
    { key: 'escalateAfterHours', header: t('hrmsLeave.chains.col.movesOn'), mobileHidden: true, render: (v) => <span className="text-xs text-ink-muted">{v ? t('hrmsLeave.chains.afterHours', { count: v }) : t('hrmsLeave.chains.never')}</span> },
    { key: 'active', header: t('hrmsLeave.chains.col.status'), render: (v) => <StatusPill tone={v ? 'brand' : 'neutral'}>{v ? t('hrmsLeave.chains.inUse') : t('hrmsLeave.chains.off')}</StatusPill> },
    { key: 'id', header: '', align: 'right', render: (_, r) => canEdit && <button type="button" onClick={(e) => { e.stopPropagation(); remove(r) }} className="p-1.5 text-ink-faint hover:text-danger-600" aria-label={t('hrmsLeave.chains.deleteAria', { name: r.name })}><Trash2 className="w-4 h-4" /></button> },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-ink-muted max-w-3xl">{t('hrmsLeave.chains.intro')}</p>
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>{t('hrmsLeave.chains.new')}</Button>}
      </div>
      <Note icon={GitPullRequestArrow}>{t('hrmsLeave.chains.defaultNote')}</Note>
      <DataTable columns={columns} rows={rules} loading={isLoading} onRowClick={canEdit ? setEditing : undefined}
        emptyIcon={GitPullRequestArrow} emptyTitle={t('hrmsLeave.chains.emptyTitle')} emptyHint={t('hrmsLeave.chains.emptyHint')} />
      {editing && (
        <RuleModal rule={editing === 'new' ? null : editing} types={types} departments={departments} onClose={() => setEditing(null)}
          onDone={(r) => { setEditing(null); showSuccess(t('hrmsLeave.chains.saved', { name: r?.name })); qc.invalidateQueries({ queryKey: KEY }) }} />
      )}
    </div>
  )
}
