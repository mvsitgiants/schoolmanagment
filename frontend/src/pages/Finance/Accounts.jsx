import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Landmark, Pencil, Plus, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, DataTable, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, Select, StatCardRow, Tabs, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { createAccount, deleteAccount, fetchAccounts, fetchFeeHeadMapping, fetchFinanceSummary, saveFeeHeadMapping, updateAccount } from '../../api/finance'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { AccountSelect } from '../../components/finance/FinanceKit'

function AccountForm({ account, accounts, onClose, onSaved }) {
  const { t } = useTranslation('finance')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ code: account?.code ?? '', name: account?.name ?? '', parentId: account?.parentId ? String(account.parentId) : '', isGroup: account?.isGroup ?? false, cashBank: account?.cashBank ?? false, expenseHead: account?.expenseHead ?? false, description: account?.description ?? '', active: account?.active ?? true })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({
    mutationFn: () => (account ? updateAccount(account.id, { ...f, parentId: f.parentId || null }) : createAccount({ ...f, parentId: f.parentId || null })),
    onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const groups = accounts.filter((a) => a.isGroup && a.id !== account?.id)
  const type = accounts.find((a) => a.id === f.parentId)?.type ?? account?.type
  return (
    <Modal open onClose={onClose} title={account ? t('finance.accounts.editTitle') : t('finance.accounts.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!f.code || f.name.trim().length < 2 || (!account && !f.parentId)} onClick={() => save.mutate()}>{t('finance.save')}</Button>
    </>}>
      <div className="grid grid-cols-3 gap-4">
        <FormField label={t('finance.accounts.code')} required error={errors.code}><Input value={f.code} onChange={set('code')} /></FormField>
        <div className="col-span-2"><FormField label={t('finance.accounts.name')} required error={errors.name}><Input value={f.name} onChange={set('name')} /></FormField></div>
        <div className="col-span-3">
          <FormField label={t('finance.accounts.under')} required={!account} error={errors.parentId} hint={type ? t(`finance.accountTypes.${type}`) : undefined}>
            <Select value={f.parentId} onChange={set('parentId')}>
              <option value="">{t('finance.accounts.pickGroup')}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{`${'  '.repeat(g.depth)}${g.code} · ${g.name}`}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="col-span-3 flex flex-wrap gap-x-5 gap-y-2">
          {['isGroup', 'cashBank', 'expenseHead', ...(account ? ['active'] : [])].map((k) => (
            <label key={k} className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f[k]} onChange={set(k)} disabled={!!account?.systemKey && k !== 'expenseHead'} className="rounded border-border text-brand-500" />{t(`finance.accounts.flags.${k}`)}</label>
          ))}
        </div>
        <div className="col-span-3"><FormField label={t('finance.accounts.description')}><Textarea rows={2} value={f.description} onChange={set('description')} /></FormField></div>
        {account?.systemKey && <div className="col-span-3"><Note>{t('finance.accounts.systemNote')}</Note></div>}
      </div>
    </Modal>
  )
}

const TYPE_TONE = { ASSET: 'info', LIABILITY: 'orange', EQUITY: 'violet', INCOME: 'success', EXPENSE: 'pink' }

function ChartTab() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['fin-accounts'], queryFn: fetchAccounts })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fin-accounts'] }); qc.invalidateQueries({ queryKey: ['finance-meta'] }) }
  const remove = useMutation({ mutationFn: deleteAccount, onSuccess: () => { refresh(); showSuccess(t('finance.accounts.deleted')) }, onError: (e) => showError(e.message) })
  return (
    <>
      <div className="flex justify-end mb-3"><HeaderButton icon={Plus} variant="primary" requires="finance.accounts.create" onClick={() => setEditing('new')}>{t('finance.accounts.new')}</HeaderButton></div>
      <DataTable rows={rows} loading={isLoading} dense columns={[
        { key: 'name', header: t('finance.accounts.account'), mobilePrimary: true, render: (v, r) => <span style={{ paddingLeft: `${r.depth * 16}px` }} className={r.isGroup ? 'inline-flex items-center gap-2 font-semibold text-ink' : r.active ? 'inline-flex items-center gap-2 text-ink' : 'inline-flex items-center gap-2 text-ink-faint line-through'}><CodeBadge>{r.code}</CodeBadge>{v}</span> },
        { key: 'type', header: t('finance.accounts.type'), mobileHidden: true, render: (v) => <ColorChip label={t(`finance.accountTypes.${v}`)} tone={TYPE_TONE[v]} dot /> },
        { key: 'balance', header: t('finance.accounts.balance'), align: 'right', render: (v, r) => (r.debit || r.credit ? <Money value={v} paise className={r.isGroup ? 'font-semibold' : ''} /> : '—') },
        { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {hasPermission('finance.accounts.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('finance.edit')} onClick={() => setEditing(r)} />}
            {hasPermission('finance.accounts.delete') && !r.systemKey && !r.entries && !r.children && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('finance.delete')}
              onClick={async () => { if (await confirm({ title: t('finance.accounts.deleteConfirm', { name: r.name }), confirmLabel: t('finance.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
          </div>
        ) },
      ]} onRowClick={hasPermission('finance.accounts.edit') ? (r) => setEditing(r) : undefined} emptyIcon={Landmark} emptyTitle={t('finance.accounts.empty')} />
      {editing && <AccountForm account={editing === 'new' ? null : editing} accounts={rows} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('finance.saved')) }} />}
    </>
  )
}

function FeeHeadsTab() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['fin-fee-heads'], queryFn: fetchFeeHeadMapping })
  const { data: accounts = [] } = useQuery({ queryKey: ['fin-accounts'], queryFn: fetchAccounts })
  const [map, setMap] = useState({})
  useEffect(() => setMap(Object.fromEntries(rows.map((r) => [r.feeHeadId, r.accountId]))), [rows])
  const save = useMutation({ mutationFn: () => saveFeeHeadMapping(Object.entries(map).map(([feeHeadId, accountId]) => ({ feeHeadId, accountId }))), onSuccess: () => { qc.invalidateQueries({ queryKey: ['fin-fee-heads'] }); showSuccess(t('finance.saved')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('finance.accounts.edit')
  const pickable = accounts.filter((a) => a.isGroup ? ['INCOME', 'LIABILITY'].includes(a.type) : ['INCOME', 'LIABILITY'].includes(a.type))
  return (
    <div className="space-y-3">
      <Note>{t('finance.feeHeads.hint')}</Note>
      {isLoading ? <p className="text-sm text-ink-faint">{t('finance.loading')}</p> : rows.map((r) => (
        <div key={r.feeHeadId} className="grid sm:grid-cols-[1fr_1.4fr] gap-2 items-center rounded-lg border border-border bg-surface px-3 py-2">
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink"><ColorChip label={r.name} seed={r.feeHeadId} dot /><CodeBadge>{r.code}</CodeBadge>{r.refundable && <span className="text-xs text-amber-700">{t('finance.feeHeads.refundable')}</span>}</p>
          <AccountSelect accounts={pickable} value={map[r.feeHeadId]} disabled={!canEdit} onChange={(v) => setMap((m) => ({ ...m, [r.feeHeadId]: v }))} aria-label={t('finance.feeHeads.ledger')} />
        </div>
      ))}
      {canEdit && rows.length > 0 && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('finance.save')}</Button>}
    </div>
  )
}

/** Accounts › Chart of accounts: the ledgers, their balances, and which ledger each fee head posts to. */
export default function Accounts() {
  const { t } = useTranslation('finance')
  const [tab, setTab] = useState('chart')
  const { data: s } = useQuery({ queryKey: ['finance-summary'], queryFn: fetchFinanceSummary })
  return (
    <PageContainer>
      <PageHeader icon={Landmark} title={t('finance.accounts.title')} subtitle={t('finance.accounts.subtitle')} />
      {s && (
        <StatCardRow className="mb-4" items={[
          ...s.money.map((m) => ({ icon: Wallet, label: m.name, value: formatINRCompact(m.balance), sub: formatINR(m.balance) })),
          { icon: TrendingUp, label: t('finance.summary.yearIncome', { fy: s.fy }), value: formatINRCompact(s.year.income), sub: formatINR(s.year.income), tone: 'success' },
          { icon: TrendingDown, label: t('finance.summary.yearExpenditure', { fy: s.fy }), value: formatINRCompact(s.year.expenditure), sub: formatINR(s.year.expenditure), tone: 'orange' },
        ]} />
      )}
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'chart', label: t('finance.accounts.tabChart') }, { value: 'fees', label: t('finance.accounts.tabFees') }]} />
      {tab === 'chart' ? <ChartTab /> : <FeeHeadsTab />}
    </PageContainer>
  )
}
