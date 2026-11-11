import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Layers, Pencil, Plus, Trash2, UserCog, UserX, Users, WalletCards } from 'lucide-react'
import { DateInput, CodeBadge, ColorChip, DataTable, FormField, HeaderButton, Input, Modal, Money, PersonCell, Note, PageContainer, PageHeader, SegmentedControl, Select, StatCardRow, StatusPill, Tabs, Textarea, Toolbar, localIso, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { deleteAssignment, deleteStructure, fetchAssignmentHistory, fetchAssignments, fetchStructures, saveAssignment } from '../../api/payroll'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { ComponentRows, StructureModal, useRuleText } from '../../components/payroll/PayrollKit'
import { PAY_COMPONENTS, toPaise, toRupees } from '@schoolgiant/shared'

const KIND = Object.fromEntries(PAY_COMPONENTS.map((c) => [c.code, c.kind]))

function StructuresTab() {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const ruleText = useRuleText()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['payroll-structures', 'all'], queryFn: () => fetchStructures(true) })
  const remove = useMutation({ mutationFn: deleteStructure, onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-structures'] }); showSuccess(t('payroll.structures.deleted')) }, onError: (e) => showError(e.message) })
  return (
    <>
      <div className="flex justify-end mb-3"><HeaderButton icon={Plus} variant="primary" requires="payroll.structures.create" onClick={() => setEditing('new')}>{t('payroll.structures.new')}</HeaderButton></div>
      <DataTable rows={rows} loading={isLoading} columns={[
        { key: 'name', header: t('payroll.structures.name'), mobilePrimary: true, render: (v, r) => <div className="flex flex-col items-start gap-1"><p className={r.active ? 'font-medium text-ink' : 'text-ink-faint line-through'}>{v}</p><CodeBadge>{r.code}</CodeBadge></div> },
        { key: 'components', header: t('payroll.structures.components'), render: (v) => <div className="flex flex-wrap gap-1.5 max-w-xl">{v.filter((c) => c.rule.type !== 'STATUTORY' && c.rule.type !== 'LOANS').map((c) => (
          <ColorChip key={c.code} label={t(`payroll.components.${c.code}`)} tone={KIND[c.code] === 'DEDUCTION' ? 'danger' : undefined} seed={c.code} dot sub={ruleText(c.rule)} />
        ))}</div> },
        { key: 'assigned', header: t('payroll.structures.staff'), align: 'right', render: (v) => <span className={v ? 'inline-flex items-center gap-1 font-semibold tabular-nums text-ink' : 'text-ink-faint tabular-nums'}>{v > 0 && <Users className="h-3.5 w-3.5 text-ink-faint" aria-hidden />}{v ?? 0}</span> },
        { key: 'active', header: t('payroll.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('payroll.structures.inUse') : t('payroll.structures.off')}</StatusPill> },
        { key: 'id', header: '', align: 'right', width: 100, render: (_, r) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {hasPermission('payroll.structures.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('payroll.edit')} onClick={() => setEditing(r)} />}
            {hasPermission('payroll.structures.delete') && !r.assigned && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('payroll.delete')}
              onClick={async () => { if (await confirm({ title: t('payroll.structures.deleteConfirm', { name: r.name }), confirmLabel: t('payroll.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
          </div>
        ) },
      ]} onRowClick={hasPermission('payroll.structures.edit') ? (r) => setEditing(r) : undefined} emptyIcon={Layers} emptyTitle={t('payroll.structures.empty')} />
      {editing && <StructureModal structure={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['payroll-structures'] }); qc.invalidateQueries({ queryKey: ['payroll-meta'] }); showSuccess(t('payroll.saved')) }} />}
    </>
  )
}

/** Put one person on a structure from a date, with their own gross, overrides and TDS. */
function AssignModal({ row, onClose, onSaved }) {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: structures = [] } = useQuery({ queryKey: ['payroll-structures', 'active'], queryFn: () => fetchStructures(false) })
  const { data: hist } = useQuery({ queryKey: ['payroll-assignment', row.employee.id], queryFn: () => fetchAssignmentHistory(row.employee.id) })
  const a = row.assignment
  const [form, setForm] = useState({ structureId: a?.structureId ?? structures.find((s) => (s.categories ?? []).includes(row.employee.category))?.id ?? '', effectiveFrom: a ? localIso(new Date()) : row.employee.joiningDate, gross: a?.grossMonthly ? String(toRupees(a.grossMonthly)) : '', tds: a?.tdsMonthly != null ? String(toRupees(a.tdsMonthly)) : '', notes: '' })
  const [overrides, setOverrides] = useState(a?.overrides ?? [])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => saveAssignment({ employeeId: row.employee.id, structureId: form.structureId, effectiveFrom: form.effectiveFrom, grossMonthly: form.gross ? toPaise(form.gross) : null, tdsMonthly: form.tds !== '' ? toPaise(form.tds) : null, overrides, notes: form.notes }),
    onSuccess: (r) => { onSaved(); if (r.arrearsFrom) showSuccess(t('payroll.assign.arrears')) },
    onError: (e) => showError(e.message),
  })
  const remove = useMutation({ mutationFn: deleteAssignment, onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-assignment', row.employee.id] }); onSaved() }, onError: (e) => showError(e.message) })
  const p = hist?.preview
  return (
    <Modal open onClose={onClose} size="xl" title={t('payroll.assign.title', { name: row.employee.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.structureId || !form.effectiveFrom} onClick={() => save.mutate()}>{t('payroll.save')}</Button>
    </>}>
      <div className="space-y-4">
        {!row.salary.grossMonthly && <Note tone="warning">{t('payroll.assign.noGross')}</Note>}
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('payroll.assign.structure')} required>
            <Select value={form.structureId} onChange={set('structureId')}>
              <option value="">{t('payroll.assign.pick')}</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('payroll.assign.from')} required hint={a ? t('payroll.assign.fromHint') : undefined}><DateInput value={form.effectiveFrom} onChange={set('effectiveFrom')} /></FormField>
          <FormField label={t('payroll.assign.gross')} hint={t('payroll.assign.grossHint', { amount: row.salary.grossMonthly ? toRupees(row.salary.grossMonthly) : '—' })}><Input type="number" min="0" value={form.gross} onChange={set('gross')} /></FormField>
          <FormField label={t('payroll.assign.tds')} hint={t('payroll.assign.tdsHint')}><Input type="number" min="0" value={form.tds} onChange={set('tds')} /></FormField>
        </div>
        <div>
          <p className="text-sm font-medium text-ink mb-1">{t('payroll.assign.overrides')}</p>
          <p className="text-xs text-ink-muted mb-2">{t('payroll.assign.overridesHint')}</p>
          <ComponentRows value={overrides} onChange={setOverrides} allowNone />
        </div>
        <FormField label={t('payroll.assign.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
        {p && (
          <Note>{t('payroll.assign.preview', { gross: toRupees(p.gross), deductions: toRupees(p.totalDeductions), net: toRupees(p.net) })}</Note>
        )}
        {(hist?.history ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">{t('payroll.assign.history')}</p>
            {hist.history.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-1 text-sm border-b border-border/60">
                <span>{date(h.effectiveFrom)} · {h.structureName}{h.grossMonthly ? <> · <Money value={h.grossMonthly} paise /></> : null}</span>
                {hasPermission('payroll.structures.edit') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('payroll.delete')}
                  onClick={async () => { if (await confirm({ title: t('payroll.assign.removeConfirm'), confirmLabel: t('payroll.delete'), tone: 'danger' })) remove.mutate(h.id) }} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function StaffTab() {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const { date } = useFormat()
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, unassigned: view === 'unassigned' ? '1' : undefined, page, pageSize: 50 }
  const { data, isLoading, error } = useQuery({ queryKey: ['payroll-assignments', params], queryFn: () => fetchAssignments(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  const counts = data?.counts ?? {}
  return (
    <>
      <StatCardRow className="mb-3" items={[
        { icon: Users, tone: 'brand', label: t('payroll.staff.total'), value: counts.total ?? 0,
          progress: counts.total ? ((counts.total - (counts.unassigned ?? 0)) / counts.total) * 100 : undefined },
        { icon: UserX, label: t('payroll.staff.unassigned'), value: counts.unassigned ?? 0, tone: counts.unassigned ? 'warning' : 'neutral',
          onClick: () => { setView(view === 'unassigned' ? 'all' : 'unassigned'); setPage(1) }, className: view === 'unassigned' ? 'ring-2 ring-amber-400' : undefined },
        { icon: WalletCards, label: t('payroll.staff.noSalary'), value: counts.noSalary ?? 0, tone: counts.noSalary ? 'danger' : 'neutral' },
      ]} />
      <DataTable rows={data?.data ?? []} loading={isLoading} error={error} rowKey={(r) => r.employee.id}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('payroll.staff.search')}
          right={<SegmentedControl value={view} onChange={(v) => { setView(v); setPage(1) }} options={[{ value: 'all', label: t('payroll.staff.everyone') }, { value: 'unassigned', label: t('payroll.staff.unassigned') }]} />} />}
        columns={[
          { key: 'employee', header: t('payroll.staff.person'), mobilePrimary: true, render: (e) => <PersonCell name={e.name} sub={[e.code, e.designation].filter(Boolean).join(' · ')} size={32} /> },
          { key: 'assignment', header: t('payroll.assign.structure'), render: (a) => (a ? <div><ColorChip label={a.structureName} seed={a.structureId} dot /><p className="text-xs text-ink-faint mt-0.5">{t('payroll.staff.since', { date: date(a.effectiveFrom) })}</p></div> : <ColorChip label={t('payroll.staff.none')} tone="warning" icon={UserX} />) },
          { key: 'salary', header: t('payroll.staff.gross'), align: 'right', render: (s, r) => <Money value={r.assignment?.grossMonthly ?? s.grossMonthly} paise /> },
          { key: 'monthly', header: t('payroll.staff.net'), align: 'right', render: (m) => (m ? <Money value={m.net} paise tone="success" /> : '—') },
          { key: 'cost', header: t('payroll.staff.cost'), align: 'right', mobileHidden: true, render: (_, r) => (r.monthly ? <Money value={r.monthly.employerCost} paise /> : '—') },
        ]}
        onRowClick={hasPermission('payroll.structures.edit') || hasPermission('payroll.structures.create') ? (r) => setOpen(r) : undefined}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={UserCog} emptyTitle={t('payroll.staff.empty')} emptyHint={t('payroll.staff.emptyHint')} />
      {open && <AssignModal row={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['payroll-assignments'] }); qc.invalidateQueries({ queryKey: ['payroll-structures'] }) }} />}
    </>
  )
}

/** Payroll › Salary structures: the structures, and which one each staff member is on. */
export default function Structures() {
  const { t } = useTranslation('payroll')
  const [tab, setTab] = useState('staff')
  return (
    <PageContainer>
      <PageHeader icon={Layers} title={t('payroll.structures.title')} subtitle={t('payroll.structures.subtitle')} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'staff', label: t('payroll.structures.tabStaff') }, { value: 'structures', label: t('payroll.structures.tabStructures') }]} />
      {tab === 'staff' ? <StaffTab /> : <StructuresTab />}
    </PageContainer>
  )
}
