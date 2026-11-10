import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Building2, Gift, Plus, Scale, Users, X } from 'lucide-react'
import { EMPLOYEE_CATEGORIES } from '@schoolgiant/shared'
import { ControlChip, DataTable, Drawer, FilterBar, FormField, Input, Modal, Note, PersonCell, SearchInput, SegmentedControl, Select, SkeletonRows, Textarea, ViewControls, localIso } from '../../system'
import Button from '../../ui/Button'
import { adjustEmployeeLeave, creditCompOff, fetchEmployeeLedger, fetchLeaveBalances } from '../../../api/hrms'
import { hasPermission } from '../../../api/auth'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useFormat } from '../../../context/SettingsContext'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { useHrLabels } from '../HrKit'
import { BalanceBar, fieldErrors, halves, invalidateLeave, useBalanceText, useDaysText } from './LeaveBits'

// Leave › Balances: every person × every kind of leave that has a balance ("9 of 12 days left"), one page at a time;
// leave that needs no balance (duty leave, leave without pay …) is summed in one column. A row opens the person's
// balances and their ledger, where HR corrects a balance (with a reason) or gives compensatory off.

const PAGE = 50

function AdjustModal({ row, onClose, onDone }) {
  const { t } = useTranslation('hrmsLeave')
  const { showError } = useSnackbar()
  const types = row.balances.filter((b) => !b.unlimited)
  const [f, setF] = useState({ kind: 'ADJUSTMENT', leaveTypeId: types[0]?.leaveTypeId ?? '', days: '', note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
  const n = Number(f.days)
  const halvesOk = f.days !== '' && Number.isFinite(n) && n !== 0 && Number.isInteger(n * 2)
  const save = useMutation({
    mutationFn: () => adjustEmployeeLeave(row.employeeId, { leaveTypeId: f.leaveTypeId, kind: f.kind, days: n, note: f.note.trim() }),
    onSuccess: onDone,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('hrmsLeave.balances.adjustTitle', { name: row.name })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!f.leaveTypeId || !halvesOk || f.note.trim().length < 3} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <div className="space-y-3">
        <FormField label={t('hrmsLeave.balances.what')}>
          <SegmentedControl value={f.kind} onChange={set('kind')} options={[{ value: 'ADJUSTMENT', label: t('hrmsLeave.balances.correct') }, { value: 'OPENING', label: t('hrmsLeave.balances.opening') }]} />
        </FormField>
        <p className="-mt-1.5 text-[11px] text-ink-faint">{f.kind === 'OPENING' ? t('hrmsLeave.balances.openingHint') : t('hrmsLeave.balances.correctHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('hrmsLeave.balances.type')} required error={errors.leaveTypeId}>
            <Select value={f.leaveTypeId} onChange={set('leaveTypeId')}>{types.map((b) => <option key={b.leaveTypeId} value={b.leaveTypeId}>{b.name}</option>)}</Select>
          </FormField>
          <FormField label={t('hrmsLeave.balances.days')} required hint={t('hrmsLeave.balances.daysHint')} error={errors.days || (f.days !== '' && !halvesOk ? t('hrmsLeave.balances.daysError') : undefined)}>
            <Input type="number" step="0.5" value={f.days} onChange={set('days')} />
          </FormField>
        </div>
        <FormField label={t('hrmsLeave.balances.why')} required error={errors.note}><Textarea rows={2} value={f.note} onChange={set('note')} maxLength={300} placeholder={t('hrmsLeave.balances.whyPlaceholder')} /></FormField>
        <Note>{t('hrmsLeave.balances.ledgerNote')}</Note>
      </div>
    </Modal>
  )
}

function CompOffModal({ row, onClose, onDone }) {
  const { t } = useTranslation('hrmsLeave')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ workedDate: '', days: 1, note: '' })
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => creditCompOff({ employeeId: row.employeeId, workedDate: f.workedDate, days: f.days, note: f.note.trim() || undefined }),
    onSuccess: onDone,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('hrmsLeave.balances.compOffTitle', { name: row.name })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!f.workedDate} onClick={() => save.mutate()}>{t('hrmsLeave.balances.give')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('hrmsLeave.balances.workedOn')} required hint={t('hrmsLeave.balances.workedOnHint')} error={errors.workedDate}><Input type="date" value={f.workedDate} max={localIso(new Date())} onChange={(e) => setF((x) => ({ ...x, workedDate: e.target.value }))} /></FormField>
          <FormField label={t('hrmsLeave.balances.howMuch')}><SegmentedControl value={f.days} onChange={(v) => setF((x) => ({ ...x, days: v }))} options={[{ value: 1, label: t('hrmsLeave.bits.wholeDay') }, { value: 0.5, label: t('hrmsLeave.bits.halfADay') }]} /></FormField>
        </div>
        <FormField label={t('hrmsLeave.balances.compOffNote')}><Textarea rows={2} value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} maxLength={300} placeholder={t('hrmsLeave.balances.compOffPlaceholder')} /></FormField>
        <Note>{t('hrmsLeave.balances.compOffOnce')}</Note>
      </div>
    </Modal>
  )
}

function BalanceDrawer({ row, onClose, onApply }) {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const { date } = useFormat()
  const days = useDaysText()
  const balanceText = useBalanceText()
  const { showSuccess } = useSnackbar()
  const [modal, setModal] = useState(null)
  const [typeId, setTypeId] = useState('')
  const { data: ledger = [], isLoading } = useQuery({ queryKey: ['emp-ledger', row.employeeId, typeId], queryFn: () => fetchEmployeeLedger(row.employeeId, typeId || undefined) })
  const done = (msg) => { setModal(null); showSuccess(msg); invalidateLeave(qc) }
  const canEdit = hasPermission('hrms.leave.edit')
  const hasCompOff = row.balances.some((b) => b.compOff)
  return (
    <Drawer open onClose={onClose} size="lg" subtitle={t('hrmsLeave.balances.drawerSub')} title={row.name}
      footer={(canEdit || onApply) && (
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit && hasCompOff && <Button variant="secondary" icon={Gift} onClick={() => setModal('compoff')}>{t('hrmsLeave.balances.giveCompOff')}</Button>}
          {canEdit && <Button variant="secondary" icon={Scale} onClick={() => setModal('adjust')}>{t('hrmsLeave.balances.adjust')}</Button>}
          {onApply && <Button icon={Plus} onClick={() => onApply(row)}>{t('hrmsLeave.balances.applyFor')}</Button>}
        </div>
      )}>
      <div className="space-y-5">
        <p className="text-xs text-ink-muted">{[row.designation, row.department].filter(Boolean).join(' · ')}</p>
        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
          {row.balances.map((b) => (
            <button key={b.leaveTypeId} type="button" onClick={() => setTypeId(typeId === b.leaveTypeId ? '' : b.leaveTypeId)}
              className={clsx('rounded-lg border bg-surface px-3 py-2.5 text-start min-w-0 transition-colors', typeId === b.leaveTypeId ? 'border-brand-300 ring-1 ring-brand-200' : 'border-border hover:bg-bg')}>
              <p className="text-sm font-medium text-ink truncate">{b.name}</p>
              <p className={clsx('mt-0.5 text-xs', !b.unlimited && b.available < 0 ? 'text-danger-600' : 'text-ink-muted')}>{balanceText(b)}</p>
              {!b.unlimited && b.ofTotal > 0 && <BalanceBar left={b.available} of={b.ofTotal} className="mt-1.5" />}
              {b.pending > 0 && <p className="mt-1 text-[11px] text-amber-700">{t('hrmsLeave.balances.waiting', { days: days(b.pending) })}</p>}
            </button>
          ))}
        </div>
        <section>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hrmsLeave.balances.ledger')}{typeId && <span className="normal-case font-normal"> · {row.balances.find((b) => b.leaveTypeId === typeId)?.name}</span>}</h4>
            {typeId && <button type="button" onClick={() => setTypeId('')} className="text-xs text-brand-700 hover:underline">{t('hrmsLeave.balances.showAll')}</button>}
          </div>
          <p className="text-[11px] text-ink-faint mb-2">{t('hrmsLeave.balances.ledgerHint')}</p>
          {isLoading ? <SkeletonRows rows={3} className="!px-0" /> : ledger.length === 0 ? <p className="text-sm text-ink-muted">{t('hrmsLeave.balances.noEntries')}</p> : (
            <ul className="divide-y divide-border">
              {ledger.map((e) => (
                <li key={e.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{t(`hrmsLeave.kinds.${e.kind}`, { defaultValue: e.kindLabel })} <span className="text-ink-muted">· {row.balances.find((b) => b.code === e.leaveCode)?.name ?? e.leaveCode}</span></p>
                    <p className="text-[11px] text-ink-faint mt-0.5">{[date(e.date), e.note, e.by && e.by !== 'System' ? e.by : null].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className={clsx('text-sm font-semibold tabular-nums whitespace-nowrap', e.days < 0 ? 'text-ink' : 'text-brand-700')}>{e.days > 0 ? '+' : ''}{halves(e.days)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {modal === 'adjust' && <AdjustModal row={row} onClose={() => setModal(null)} onDone={() => done(t('hrmsLeave.balances.adjusted'))} />}
      {modal === 'compoff' && <CompOffModal row={row} onClose={() => setModal(null)} onDone={() => done(t('hrmsLeave.balances.compOffGiven'))} />}
    </Drawer>
  )
}

export default function LeaveBalances({ departments = [], onApply }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const days = useDaysText()
  const [search, setSearch] = useState('')
  const [dept, setDept] = useState('')
  const [cat, setCat] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState(null)
  const q = useDebouncedValue(search.trim(), 300)
  useEffect(() => setPage(1), [q, dept, cat])
  const params = { search: q || undefined, departmentId: dept || undefined, category: cat || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['leave-balances', params], queryFn: () => fetchLeaveBalances(params), placeholderData: (p) => p })
  const rows = data?.rows ?? []
  const types = data?.types ?? []
  // a column for each kind of leave credited to staff; the rest (given by HR, or needing no balance) share one column
  const counted = types.filter((x) => !x.allowNegative && x.accrual !== 'NONE')
  const isCounted = new Set(counted.map((x) => x.id))
  const open = rows.find((r) => r.employeeId === openId)
  const columns = useMemo(() => [
    { key: 'name', header: t('hrmsLeave.balances.person'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.designation ?? L.category(r.category)} /> },
    ...counted.map((lt) => ({
      key: `t:${lt.id}`, header: lt.name, mobileLabel: lt.name, render: (_, r) => {
        const b = r.balances.find((x) => x.leaveTypeId === lt.id)
        if (!b) return <span className="text-ink-faint text-xs">{t('hrmsLeave.balances.notFor')}</span>
        return (
          <span className="inline-flex flex-col gap-1 w-24">
            <span className={clsx('text-xs tabular-nums', b.available < 0 ? 'text-danger-600 font-semibold' : 'text-ink')}>{b.ofTotal ? t('hrmsLeave.balances.cell', { left: halves(b.available), of: halves(b.ofTotal) }) : halves(b.available)}</span>
            {b.ofTotal > 0 && <BalanceBar left={b.available} of={b.ofTotal} />}
            {b.pending > 0 && <span className="text-[10px] text-amber-700">{t('hrmsLeave.balances.waitingShort', { n: halves(b.pending) })}</span>}
          </span>
        )
      },
    })),
    { key: 'other', header: t('hrmsLeave.balances.other'), render: (_, r) => {
      const rest = r.balances.filter((b) => !isCounted.has(b.leaveTypeId) && (b.unlimited ? b.taken > 0 : b.available !== 0 || b.taken > 0))
      if (!rest.length) return <span className="text-ink-faint text-xs">—</span>
      return (
        <ul className="text-xs text-ink-muted space-y-0.5 max-w-[240px]">
          {rest.map((b) => <li key={b.leaveTypeId}>{b.unlimited ? t('hrmsLeave.balances.otherTaken', { type: b.name, days: days(b.taken) }) : t('hrmsLeave.balances.otherLeft', { type: b.name, days: days(b.available) })}</li>)}
        </ul>
      )
    } },
  ], [counted, isCounted, t, L, days])
  const filtersOn = search || dept || cat
  return (
    <div className="flex flex-col gap-4">
      <FilterBar search={<SearchInput value={search} onChange={setSearch} placeholder={t('hrmsLeave.balances.search')} />}>
        <ViewControls>
          <ControlChip icon={Building2} label={t('hrmsLeave.filters.department')} value={departments.find((d) => d.id === dept)?.name ?? t('hrmsLeave.filters.all')} active={!!dept}
            options={[{ value: '', label: t('hrmsLeave.filters.all') }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} onChange={setDept} />
          <ControlChip icon={Users} label={t('hrmsLeave.filters.staff')} value={cat ? L.category(cat) : t('hrmsLeave.filters.all')} active={!!cat}
            options={[{ value: '', label: t('hrmsLeave.filters.all') }, ...EMPLOYEE_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))]} onChange={setCat} />
          {filtersOn && <ControlChip icon={X} label={t('hrmsLeave.filters.clear')} caret={false} onClick={() => { setSearch(''); setDept(''); setCat('') }} />}
        </ViewControls>
      </FilterBar>
      <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="employeeId" onRowClick={(r) => setOpenId(r.employeeId)} columns={columns}
        emptyIcon={Scale} emptyTitle={filtersOn ? t('hrmsLeave.balances.emptyFiltered') : t('hrmsLeave.balances.empty')}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      <Note>{t('hrmsLeave.balances.note')}</Note>
      {open && <BalanceDrawer row={open} onClose={() => setOpenId(null)} onApply={onApply} />}
    </div>
  )
}
