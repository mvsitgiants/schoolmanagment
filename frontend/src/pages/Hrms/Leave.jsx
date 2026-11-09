import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, Check, Palmtree, Pencil, Plus, X } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, GENDERS, LEAVE_ACCRUALS, LEAVE_STATUSES } from '@schoolgiant/shared'
import { ColorChip, DataTable, FormField, Input, LevelBar, Modal, PageContainer, PageHeader, PersonCell, SearchInput, SegmentedControl, Select, StatusPill, Tabs, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { applyLeaveFor, cancelLeave, createLeaveType, decideLeave, fetchLeaveBalances, fetchLeaveTypes, fetchLeaves, updateLeaveType } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { LeaveApplyForm, useHrLabels, useHrMeta, useLeaveSpan } from '../../components/hrms/HrKit'
import useDebouncedValue from '../../hooks/useDebouncedValue'

const PAGE = 50

// a leave type's chip colour: the tone set on the type, else one picked from its code
const typeTone = (tone) => (tone && tone !== 'neutral' ? tone : undefined)

function TypeForm({ type, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const x = type ?? {}
  const [form, setForm] = useState({
    code: x.code ?? '', name: x.name ?? '', paid: x.paid ?? true, accrual: x.accrual ?? 'YEARLY', perYear: String(x.perYear ?? 0), carryForwardMax: String(x.carryForwardMax ?? 0),
    allowHalfDay: x.allowHalfDay ?? true, sandwich: x.sandwich ?? false, allowNegative: x.allowNegative ?? false, maxPerRequest: x.maxPerRequest ? String(x.maxPerRequest) : '',
    genders: x.genders ?? [], categories: x.categories ?? [], active: x.active ?? true, order: x.order ?? 0, tone: x.tone ?? 'neutral',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'code' ? e.target.value.toUpperCase() : e.target.value }))
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((y) => y !== v) : [...f[k], v] }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, perYear: Number(form.perYear) || 0, carryForwardMax: Number(form.carryForwardMax) || 0, maxPerRequest: form.maxPerRequest ? Number(form.maxPerRequest) : null }
      return type ? updateLeaveType(type.id, body) : createLeaveType(body)
    },
    onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const check = (k) => (
    <label key={k} className="inline-flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={form[k]} onChange={set(k)} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t(`hrms.leave.typeForm.${k}`)}
    </label>
  )
  return (
    <Modal open onClose={onClose} size="lg" title={type ? t('hrms.leave.typeForm.editTitle') : t('hrms.leave.typeForm.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.code || form.name.trim().length < 2} onClick={() => save.mutate()}>{t('hrms.leave.typeForm.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('hrms.leave.typeForm.code')} required error={errors.code}><Input value={form.code} onChange={set('code')} maxLength={8} /></FormField>
        <FormField label={t('hrms.leave.typeForm.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField>
        <FormField label={t('hrms.leave.typeForm.accrual')}>
          <Select value={form.accrual} onChange={set('accrual')}>{LEAVE_ACCRUALS.map((a) => <option key={a.value} value={a.value}>{t(`hrms.leave.accruals.${a.value}`)}</option>)}</Select>
        </FormField>
        <FormField label={t('hrms.leave.typeForm.perYear')}><Input type="number" min="0" step="0.5" disabled={form.accrual === 'NONE'} value={form.perYear} onChange={set('perYear')} /></FormField>
        <FormField label={t('hrms.leave.typeForm.carry')} hint={t('hrms.leave.typeForm.carryHint')}><Input type="number" min="0" value={form.carryForwardMax} onChange={set('carryForwardMax')} /></FormField>
        <FormField label={t('hrms.leave.typeForm.maxPerRequest')}><Input type="number" min="1" value={form.maxPerRequest} onChange={set('maxPerRequest')} /></FormField>
        <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2">{['paid', 'allowHalfDay', 'sandwich', 'allowNegative', 'active'].map(check)}</div>
        <div className="col-span-2">
          <p className="text-xs font-medium text-ink-muted mb-1.5">{t('hrms.leave.typeForm.forWhom')}</p>
          <div className="flex flex-wrap gap-2">
            {GENDERS.map((g) => <label key={g.value} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"><input type="checkbox" checked={form.genders.includes(g.value)} onChange={() => toggle('genders', g.value)} className="rounded border-border text-brand-500" />{t(`hrms.genders.${g.value}`)}</label>)}
            {EMPLOYEE_CATEGORIES.map((c) => <label key={c.value} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"><input type="checkbox" checked={form.categories.includes(c.value)} onChange={() => toggle('categories', c.value)} className="rounded border-border text-brand-500" />{L.category(c.value)}</label>)}
          </div>
          <p className="text-xs text-ink-faint mt-1">{t('hrms.leave.typeForm.forWhomHint')}</p>
        </div>
      </div>
    </Modal>
  )
}

function Requests() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date } = useFormat()
  const span = useLeaveSpan()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('PENDING')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [applying, setApplying] = useState(false)
  const params = { status: status || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['leaves', params], queryFn: () => fetchLeaves(params), placeholderData: (p) => p })
  // deciding the last request on a later page empties it: step back to the last page there is
  useEffect(() => { if (data && page > 1 && !data.rows.length && data.total) setPage(Math.ceil(data.total / PAGE)) }, [data, page])
  const { data: meta } = useHrMeta(hasPermission('hrms.leave.apply_on_behalf'))
  const { data: types = [] } = useQuery({ queryKey: ['leave-types'], queryFn: fetchLeaveTypes })
  const refresh = () => ['leaves', 'leave-balances', 'staff-day', 'staff-month'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const canApprove = hasPermission('hrms.leave.approve')
  const canCancel = hasPermission('hrms.leave.cancel')
  const decide = async (r, approve) => {
    const note = approve ? '' : await prompt({ title: t('hrms.leave.rejectTitle', { name: r.employeeName }), label: t('hrms.leave.rejectWhy'), confirmLabel: t('hrms.leave.reject') })
    if (!approve && note === null) return
    act.mutate({ fn: () => decideLeave(r.id, { approve, note: note || undefined }), done: approve ? t('hrms.leave.approved') : t('hrms.leave.rejected') })
  }
  const cancel = async (r) => {
    const reason = await prompt({ title: t('hrms.leave.cancelTitle', { name: r.employeeName }), label: t('hrms.leave.cancelWhy'), confirmLabel: t('hrms.leave.cancel'), tone: 'danger' })
    if (reason === null) return
    act.mutate({ fn: () => cancelLeave(r.id, reason || undefined), done: t('hrms.leave.cancelled') })
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[
          { value: 'PENDING', label: t('hrms.leave.waitingCount', { count: data?.pending ?? 0 }) },
          { value: 'APPROVED', label: L.leaveStatus('APPROVED') }, { value: 'REJECTED', label: L.leaveStatus('REJECTED') }, { value: 'CANCELLED', label: L.leaveStatus('CANCELLED') }, { value: '', label: t('hrms.all') },
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('hrms.leave.search')} /></div>
          {hasPermission('hrms.leave.apply_on_behalf') && <Button icon={Plus} onClick={() => setApplying(true)}>{t('hrms.leave.applyFor')}</Button>}
        </div>
      </div>
      <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} columns={[
        { key: 'employeeName', header: t('hrms.leave.person'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.employeeCode} onClick={() => navigate(`/hrms/employees/${r.employeeId}`)} /> },
        { key: 'leaveName', header: t('hrms.leave.type'), render: (v, r) => <span className="inline-flex flex-col items-start gap-0.5"><ColorChip label={v} seed={r.leaveCode} tone={typeTone(types.find((x) => x.id === String(r.leaveTypeId))?.tone)} dot />{r.paid === false && <span className="text-[11px] font-medium text-danger-600">{t('hrms.leave.unpaid')}</span>}</span> },
        { key: 'from', header: t('hrms.leave.when'), nowrap: true, render: (_, r) => span(r, date) },
        { key: 'days', header: t('hrms.leave.days'), align: 'right', render: (v) => <span className="font-display text-base font-bold tabular-nums text-ink">{v}</span> },
        { key: 'reason', header: t('hrms.leave.reason'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{v}{r.arrangement && <span className="block text-xs text-ink-faint">{t('hrms.leave.arrangementShort', { text: r.arrangement })}</span>}</span> },
        { key: 'status', header: t('hrms.leave.status'), render: (v, r) => <span><StatusPill tone={LEAVE_STATUSES[v]?.tone}>{L.leaveStatus(v)}</StatusPill>{r.decided?.by && <span className="block text-[11px] text-ink-faint mt-0.5">{r.decided.by}</span>}</span> },
        { key: 'id', header: '', align: 'right', width: 150, render: (_, r) => (
          <div className="flex justify-end gap-1">
            {r.status === 'PENDING' && canApprove && <>
              <Button size="sm" variant="ghost" icon={Check} aria-label={t('hrms.leave.approve')} title={t('hrms.leave.approve')} onClick={() => decide(r, true)} />
              <Button size="sm" variant="ghost" icon={X} aria-label={t('hrms.leave.reject')} title={t('hrms.leave.reject')} onClick={() => decide(r, false)} />
            </>}
            {['PENDING', 'APPROVED'].includes(r.status) && canCancel && <Button size="sm" variant="ghost" icon={Ban} aria-label={t('hrms.leave.cancel')} title={t('hrms.leave.cancel')} onClick={() => cancel(r)} />}
          </div>
        ) },
      ]} emptyIcon={Palmtree} emptyTitle={status === 'PENDING' ? t('hrms.leave.noneWaiting') : t('hrms.leave.none')}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      {applying && <LeaveApplyForm types={types} employees={(meta?.staff ?? [])} canApproveNow={canApprove} submit={applyLeaveFor}
        onClose={() => setApplying(false)} onSaved={() => { setApplying(false); refresh(); showSuccess(t('hrms.leave.appliedFor')) }} />}
    </>
  )
}

function Balances() {
  const { t } = useTranslation('hrms')
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({ queryKey: ['leave-balances'], queryFn: fetchLeaveBalances })
  const types = (data?.types ?? []).filter((x) => x.active)
  return (
    <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} rowKey="employeeId" columns={[
      { key: 'name', header: t('hrms.leave.person'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.code, r.designation].filter(Boolean).join(' · ')} /> },
      ...types.map((ty) => ({
        key: ty.code, header: ty.code, align: 'right', render: (_, r) => {
          const b = r.balances.find((x) => x.leaveTypeId === ty.id)
          if (!b) return <span className="text-ink-faint">—</span>
          // the bar is what is left of what was credited (left + taken)
          const credited = Math.max(0, b.balance + b.taken)
          return (
            <span className="inline-flex flex-col items-end gap-0.5" title={t('hrms.leave.takenPending', { taken: b.taken, pending: b.pending })}>
              <LevelBar value={b.balance} max={credited} warnAt={credited * 0.25} dangerAt={0} width="w-20" />
              {b.pending > 0 && <span className="text-amber-600 text-[11px] tabular-nums">−{b.pending}</span>}
            </span>
          )
        },
      })),
    ]} onRowClick={(r) => navigate(`/hrms/employees/${r.employeeId}`)} emptyTitle={t('hrms.leave.noStaff')} />
  )
}

function Types() {
  const { t } = useTranslation('hrms')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['leave-types'], queryFn: fetchLeaveTypes })
  const canEdit = hasPermission('hrms.leave.edit')
  return (
    <>
      {canEdit && <div className="flex justify-end mb-3"><Button icon={Plus} onClick={() => setEditing('new')}>{t('hrms.leave.typeForm.new')}</Button></div>}
      <DataTable rows={rows} loading={isLoading} columns={[
        { key: 'name', header: t('hrms.leave.typeForm.name'), mobilePrimary: true, render: (v, r) => (r.active ? <ColorChip label={v} seed={r.code} tone={typeTone(r.tone)} dot sub={r.code} /> : <span className="text-ink-faint line-through">{v} <span className="text-xs font-mono-num">{r.code}</span></span>) },
        { key: 'accrual', header: t('hrms.leave.typeForm.accrual'), render: (v, r) => (v === 'NONE' ? t('hrms.leave.accruals.NONE') : t('hrms.leave.perYear', { n: r.perYear, how: t(`hrms.leave.accrualShort.${v}`) })) },
        { key: 'carryForwardMax', header: t('hrms.leave.typeForm.carry'), align: 'right', render: (v) => <span className="font-semibold tabular-nums text-ink">{v}</span> },
        { key: 'paid', header: t('hrms.leave.typeForm.paid'), render: (v) => <StatusPill tone={v ? 'success' : 'danger'}>{v ? t('hrms.yes') : t('hrms.no')}</StatusPill> },
        { key: 'id', header: '', align: 'right', width: 60, render: (_, r) => canEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('hrms.edit')} onClick={() => setEditing(r)} /> },
      ]} onRowClick={canEdit ? (r) => setEditing(r) : undefined} />
      {editing && <TypeForm type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['leave-types'] }); qc.invalidateQueries({ queryKey: ['leave-balances'] }); showSuccess(t('hrms.leave.typeForm.saved')) }} />}
    </>
  )
}

/** Staff & HR › Leave: requests to decide, everyone's balances, and the leave types. */
export default function Leave() {
  const { t } = useTranslation('hrms')
  const [tab, setTab] = useState('requests')
  return (
    <PageContainer>
      <PageHeader icon={Palmtree} title={t('hrms.leave.title')} subtitle={t('hrms.leave.subtitle')} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'requests', label: t('hrms.leave.tabs.requests') }, { value: 'balances', label: t('hrms.leave.tabs.balances') }, { value: 'types', label: t('hrms.leave.tabs.types') }]} />
      {tab === 'requests' ? <Requests /> : tab === 'balances' ? <Balances /> : <Types />}
    </PageContainer>
  )
}
