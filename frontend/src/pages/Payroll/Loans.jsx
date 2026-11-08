import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HandCoins, Plus } from 'lucide-react'
import { LOAN_STATUSES, LOAN_TYPES, toPaise, toRupees } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Money, PageContainer, PageHeader, ProgressBar, SegmentedControl, Select, StatusPill, localIso, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { closeLoan, createLoan, fetchLoans, fetchPayrollStaff, updateLoan } from '../../api/payroll'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useMonthLabel } from '../../components/payroll/PayrollKit'

function LoanForm({ loan, onClose, onSaved }) {
  const { t } = useTranslation('payroll')
  const { showError } = useSnackbar()
  const { data: staff = [] } = useQuery({ queryKey: ['payroll-staff'], queryFn: fetchPayrollStaff, enabled: !loan })
  const [f, setF] = useState({ employeeId: '', type: loan?.type ?? 'ADVANCE', amount: loan ? String(toRupees(loan.amount)) : '', instalment: loan ? String(toRupees(loan.instalment)) : '', startMonth: loan?.startMonth ?? localIso(new Date()).slice(0, 7), disbursedOn: '', reason: loan?.reason ?? '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => (loan
      ? updateLoan(loan.id, { instalment: toPaise(f.instalment), startMonth: f.startMonth, reason: f.reason })
      : createLoan({ employeeId: f.employeeId, type: f.type, amount: toPaise(f.amount), instalment: toPaise(f.instalment), startMonth: f.startMonth, disbursedOn: f.disbursedOn || undefined, reason: f.reason })),
    onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const months = Number(f.instalment) > 0 ? Math.ceil(Number(f.amount) / Number(f.instalment)) : 0
  return (
    <Modal open onClose={onClose} title={loan ? t('payroll.loans.editTitle', { no: loan.loanNo }) : t('payroll.loans.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={(!loan && !f.employeeId) || !(Number(f.instalment) > 0) || (!loan && !(Number(f.amount) > 0)) || f.reason.trim().length < 3} onClick={() => save.mutate()}>{t('payroll.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        {!loan && (
          <div className="sm:col-span-2">
            <FormField label={t('payroll.staff.person')} required>
              <Select value={f.employeeId} onChange={set('employeeId')}>
                <option value="">{t('payroll.loans.pickPerson')}</option>
                {staff.filter((s) => s.status !== 'EXITED').map((s) => <option key={s.id} value={s.id}>{`${s.name} · ${s.code}`}</option>)}
              </Select>
            </FormField>
          </div>
        )}
        {!loan && <FormField label={t('payroll.loans.type')}><Select value={f.type} onChange={set('type')}>{LOAN_TYPES.map((x) => <option key={x.value} value={x.value}>{t(`payroll.loanTypes.${x.value}`)}</option>)}</Select></FormField>}
        {!loan && <FormField label={t('payroll.loans.amount')} required error={errors.amount}><Input type="number" min="1" value={f.amount} onChange={set('amount')} /></FormField>}
        <FormField label={t('payroll.loans.instalment')} required error={errors.instalment} hint={months ? t('payroll.loans.months', { count: months }) : undefined}><Input type="number" min="1" value={f.instalment} onChange={set('instalment')} /></FormField>
        <FormField label={t('payroll.loans.from')}><Input type="month" value={f.startMonth} onChange={set('startMonth')} /></FormField>
        {!loan && <FormField label={t('payroll.loans.disbursed')}><Input type="date" value={f.disbursedOn} onChange={set('disbursedOn')} /></FormField>}
        <div className="sm:col-span-2"><FormField label={t('payroll.loans.reason')} required><Input value={f.reason} onChange={set('reason')} /></FormField></div>
      </div>
    </Modal>
  )
}

/** Payroll › Loans & advances: salary advances and staff loans, recovered from pay month by month. */
export default function Loans() {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const monthLabel = useMonthLabel()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('ACTIVE')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const params = { status: status || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['payroll-loans', params], queryFn: () => fetchLoans(params), placeholderData: keepPreviousData })
  const refresh = () => qc.invalidateQueries({ queryKey: ['payroll-loans'] })
  const close = useMutation({ mutationFn: ({ id, ...b }) => closeLoan(id, b), onSuccess: () => { refresh(); showSuccess(t('payroll.loans.closed')) }, onError: (e) => showError(e.message) })
  const meta = data?.meta
  const canEdit = hasPermission('payroll.loans.edit')
  return (
    <PageContainer>
      <PageHeader icon={HandCoins} title={t('payroll.loans.title')} subtitle={t('payroll.loans.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="payroll.loans.create" onClick={() => setEditing('new')}>{t('payroll.loans.new')}</HeaderButton>} />
      <SegmentedControl className="mb-3" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[...Object.keys(LOAN_STATUSES).map((k) => ({ value: k, label: t(`payroll.loanStatus.${k}`) })), { value: '', label: t('payroll.all') }]} />
      <DataTable rows={data?.data ?? []} loading={isLoading} columns={[
        { key: 'employeeName', header: t('payroll.staff.person'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.loanNo} · {t(`payroll.loanTypes.${r.type}`)}</p></div> },
        { key: 'amount', header: t('payroll.loans.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
        { key: 'instalment', header: t('payroll.loans.instalment'), align: 'right', render: (v, r) => <span><Money value={v} paise /><span className="block text-[11px] text-ink-faint">{t('payroll.loans.fromShort', { month: monthLabel(r.startMonth) })}</span></span> },
        { key: 'balance', header: t('payroll.loans.balance'), align: 'right', render: (v, r) => <span><Money value={v} paise /><span className="block w-24 ml-auto mt-1"><ProgressBar value={r.amount ? (r.recovered / r.amount) * 100 : 0} showValue={false} /></span></span> },
        { key: 'status', header: t('payroll.status'), render: (v) => <StatusPill tone={LOAN_STATUSES[v]?.tone}>{t(`payroll.loanStatus.${v}`)}</StatusPill> },
        { key: 'id', header: '', align: 'right', width: 120, render: (id, r) => canEdit && r.status === 'ACTIVE' && (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={async () => { const note = await prompt({ title: t('payroll.loans.closeTitle', { no: r.loanNo }), label: t('payroll.loans.closeWhy'), required: true, confirmLabel: r.recovered ? t('payroll.loans.close') : t('payroll.loans.cancel') }); if (note) close.mutate({ id, note, cancel: !r.recovered }) }}>
              {r.recovered ? t('payroll.loans.close') : t('payroll.loans.cancel')}
            </Button>
          </div>
        ) },
      ]} onRowClick={canEdit ? (r) => r.status === 'ACTIVE' && setEditing(r) : undefined}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={HandCoins} emptyTitle={t('payroll.loans.empty')} />
      {editing && <LoanForm loan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('payroll.saved')) }} />}
    </PageContainer>
  )
}
