import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Receipt, Wallet, X } from 'lucide-react'
import { EXPENSE_PAY_MODES, EXPENSE_STATUSES, TDS_SECTIONS, toPaise, toRupees } from '@schoolgiant/shared'
import { Attachments, DataTable, Drawer, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, Select, SegmentedControl, StatusPill, Textarea, Toolbar, localIso, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { cancelExpense, createExpense, decideExpense, fetchExpense, fetchExpenseHeads, fetchExpenses, payExpense } from '../../api/finance'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useFinanceMeta } from '../../components/finance/FinanceKit'

function ExpenseForm({ onClose, onSaved }) {
  const { t } = useTranslation('finance')
  const { showError } = useSnackbar()
  const { data: heads = [] } = useQuery({ queryKey: ['fin-expense-heads'], queryFn: fetchExpenseHeads })
  const [f, setF] = useState({ date: localIso(new Date()), accountId: '', payee: '', description: '', billNo: '', amount: '', tdsSection: '', tdsAmount: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const pickTds = (code) => { const s = TDS_SECTIONS.find((x) => x.value === code); setF((x) => ({ ...x, tdsSection: code, tdsAmount: s && x.amount ? String(Math.round((Number(x.amount) * s.pct) / 100)) : '' })) }
  const save = useMutation({
    mutationFn: () => createExpense({ date: f.date, accountId: f.accountId, payee: { name: f.payee }, description: f.description, billNo: f.billNo, amount: toPaise(f.amount), ...(f.tdsSection && { tds: { section: f.tdsSection, pct: TDS_SECTIONS.find((x) => x.value === f.tdsSection)?.pct, amount: toPaise(f.tdsAmount) } }) }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const headsSorted = [...heads.filter((h) => h.head), ...heads.filter((h) => !h.head)]
  return (
    <Modal open onClose={onClose} size="lg" title={t('finance.expenses.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!f.accountId || f.payee.trim().length < 2 || f.description.trim().length < 3 || !(Number(f.amount) > 0)} onClick={() => save.mutate()}>{t('finance.expenses.submit')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('finance.expenses.head')} required error={errors.accountId}>
          <Select value={f.accountId} onChange={set('accountId')}><option value="">{t('finance.expenses.pickHead')}</option>{headsSorted.map((h) => <option key={h.id} value={h.id}>{`${h.code} · ${h.name}`}</option>)}</Select>
        </FormField>
        <FormField label={t('finance.expenses.billDate')} required error={errors.date}><Input type="date" value={f.date} onChange={set('date')} /></FormField>
        <FormField label={t('finance.expenses.payee')} required><Input value={f.payee} onChange={set('payee')} placeholder={t('finance.expenses.payeePlaceholder')} /></FormField>
        <FormField label={t('finance.expenses.billNo')}><Input value={f.billNo} onChange={set('billNo')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('finance.expenses.description')} required><Textarea rows={2} value={f.description} onChange={set('description')} /></FormField></div>
        <FormField label={t('finance.expenses.amount')} required error={errors.amount}><Input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} /></FormField>
        <FormField label={t('finance.expenses.tdsSection')}>
          <Select value={f.tdsSection} onChange={(e) => pickTds(e.target.value)}><option value="">{t('finance.expenses.noTds')}</option>{TDS_SECTIONS.map((s) => <option key={s.value} value={s.value}>{t(`finance.tds.${s.value}`)}</option>)}</Select>
        </FormField>
        {f.tdsSection && <FormField label={t('finance.expenses.tdsAmount')} error={errors['tds.amount']}><Input type="number" min="0" value={f.tdsAmount} onChange={set('tdsAmount')} /></FormField>}
        {f.tdsSection && Number(f.amount) > 0 && <p className="sm:col-span-2 text-xs text-ink-muted">{t('finance.expenses.payableLine', { n: Number(f.amount) - Number(f.tdsAmount || 0) })}</p>}
        <p className="sm:col-span-2 text-xs text-ink-faint">{t('finance.expenses.attachHint')}</p>
      </div>
    </Modal>
  )
}

function PayForm({ x, onClose, onSaved }) {
  const { t } = useTranslation('finance')
  const { showError } = useSnackbar()
  const { data: meta } = useFinanceMeta()
  const [f, setF] = useState({ date: localIso(new Date()), mode: 'BANK_TRANSFER', bankAccountId: '', reference: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => payExpense(x.id, { ...f, bankAccountId: f.bankAccountId || undefined }), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={t('finance.expenses.payTitle', { no: x.expenseNo })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={f.mode !== 'CASH' && !f.reference.trim()} onClick={() => save.mutate()}>{t('finance.expenses.pay')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Note className="sm:col-span-2">{t('finance.expenses.payNote', { n: toRupees(x.payable), name: x.payee.name })}</Note>
        <FormField label={t('finance.expenses.paidOn')} error={errors.date}><Input type="date" value={f.date} onChange={set('date')} /></FormField>
        <FormField label={t('finance.expenses.mode')}><Select value={f.mode} onChange={set('mode')}>{EXPENSE_PAY_MODES.map((m) => <option key={m.value} value={m.value}>{t(`finance.payModes.${m.value}`)}</option>)}</Select></FormField>
        {f.mode !== 'CASH' && (meta?.banks ?? []).length > 1 && <FormField label={t('finance.expenses.fromBank')}><Select value={f.bankAccountId} onChange={set('bankAccountId')}><option value="">{t('finance.expenses.defaultBank')}</option>{meta.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>}
        {f.mode !== 'CASH' && <FormField label={t('finance.expenses.reference')} required error={errors.reference}><Input value={f.reference} onChange={set('reference')} /></FormField>}
      </div>
    </Modal>
  )
}

function ExpenseDrawer({ id, onClose, onChanged }) {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [paying, setPaying] = useState(false)
  const { data: x } = useQuery({ queryKey: ['fin-expense', id], queryFn: () => fetchExpense(id) })
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['fin-expense', id] }); onChanged(); showSuccess(msg) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => done(v.done), onError: (e) => showError(e.message) })
  if (!x) return <Drawer open onClose={onClose} title={t('finance.loading')}><span /></Drawer>
  const steps = [x.submitted?.by && t('finance.expenses.steps.submitted', { by: x.submitted.by, at: dateTime(x.submitted.at) }), x.approved?.by && t('finance.expenses.steps.approved', { by: x.approved.by }), x.rejected?.by && t('finance.expenses.steps.rejected', { by: x.rejected.by, reason: x.rejected.reason ?? '' }), x.paid?.date && t('finance.expenses.steps.paid', { date: date(x.paid.date), mode: t(`finance.payModes.${x.paid.mode}`), ref: x.paid.reference ?? '', no: x.paid.voucherNo ?? '' })].filter(Boolean)
  return (
    <Drawer open onClose={onClose} size="lg" title={`${x.expenseNo} · ${x.payee.name}`} subtitle={`${x.accountName} · ${date(x.date)}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><StatusPill tone={EXPENSE_STATUSES[x.status]?.tone}>{t(`finance.expenseStatus.${x.status}`)}</StatusPill><span className="ml-auto text-lg font-semibold"><Money value={x.amount} paise /></span></div>
        <p className="text-sm text-ink">{x.description}</p>
        {x.tds?.amount > 0 && <p className="text-sm text-ink-muted">{t('finance.expenses.tdsLine', { section: x.tds.section, tds: toRupees(x.tds.amount), payable: toRupees(x.payable) })}</p>}
        <div className="text-xs text-ink-muted space-y-0.5">{steps.map((s) => <p key={s}>{s}</p>)}</div>
        <Attachments entityType="expense" entityId={x.id} canAdd={x.status !== 'CANCELLED'} compact />
        <div className="flex flex-wrap gap-2">
          {x.status === 'SUBMITTED' && hasPermission('finance.expenses.approve') && <>
            <Button icon={Check} onClick={() => act.mutate({ fn: () => decideExpense(x.id, { approve: true }), done: t('finance.expenses.approved') })}>{t('finance.expenses.approve')}</Button>
            <Button variant="ghost" icon={X} onClick={async () => { const note = await prompt({ title: t('finance.expenses.rejectTitle'), label: t('finance.expenses.why'), required: true, confirmLabel: t('finance.expenses.reject') }); if (note) act.mutate({ fn: () => decideExpense(x.id, { approve: false, note }), done: t('finance.expenses.rejected') }) }}>{t('finance.expenses.reject')}</Button>
          </>}
          {x.status === 'APPROVED' && hasPermission('finance.expenses.pay') && <Button icon={Wallet} onClick={() => setPaying(true)}>{t('finance.expenses.pay')}</Button>}
          {['SUBMITTED', 'APPROVED'].includes(x.status) && <Button variant="ghost" onClick={async () => { const reason = await prompt({ title: t('finance.expenses.cancelTitle'), label: t('finance.expenses.why'), confirmLabel: t('finance.expenses.cancel') }); if (reason !== null) act.mutate({ fn: () => cancelExpense(x.id, reason || undefined), done: t('finance.expenses.cancelled') }) }}>{t('finance.expenses.cancel')}</Button>}
        </div>
      </div>
      {paying && <PayForm x={x} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); done(t('finance.expenses.paid')) }} />}
    </Drawer>
  )
}

/** Accounts › Expenses: bills recorded, approved within the role’s limit, paid — paying posts them to the books. */
export default function Expenses() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { date } = useFormat()
  const [status, setStatus] = useState('SUBMITTED')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { status: status || undefined, search: q || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['fin-expenses', params], queryFn: () => fetchExpenses(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  const sum = data?.summary ?? {}
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fin-expenses'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }) }
  return (
    <PageContainer>
      <PageHeader icon={Receipt} title={t('finance.expenses.title')} subtitle={t('finance.expenses.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="finance.expenses.create" onClick={() => setCreating(true)}>{t('finance.expenses.new')}</HeaderButton>} />
      <SegmentedControl className="mb-3" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[...Object.keys(EXPENSE_STATUSES).map((k) => ({ value: k, label: `${t(`finance.expenseStatus.${k}`)}${sum[k]?.count ? ` (${sum[k].count})` : ''}` })), { value: '', label: t('finance.all') }]} />
      <DataTable rows={data?.data ?? []} loading={isLoading}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('finance.expenses.search')} />}
        columns={[
          { key: 'date', header: t('finance.expenses.billDate'), nowrap: true, render: (v) => date(v) },
          { key: 'payee', header: t('finance.expenses.payee'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v.name}</p><p className="text-xs text-ink-faint">{r.expenseNo} · {r.accountName}</p></div> },
          { key: 'description', header: t('finance.expenses.description'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted truncate max-w-xs inline-block">{v}</span> },
          { key: 'amount', header: t('finance.expenses.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
          { key: 'status', header: t('finance.status'), render: (v) => <StatusPill tone={EXPENSE_STATUSES[v]?.tone}>{t(`finance.expenseStatus.${v}`)}</StatusPill> },
        ]}
        onRowClick={(r) => setOpen(r.id)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={Receipt} emptyTitle={t('finance.expenses.empty')} />
      {open && <ExpenseDrawer id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
      {creating && <ExpenseForm onClose={() => setCreating(false)} onSaved={(x) => { setCreating(false); refresh(); setOpen(x.id) }} />}
    </PageContainer>
  )
}
