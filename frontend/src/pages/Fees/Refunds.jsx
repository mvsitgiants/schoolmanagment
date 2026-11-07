import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Undo2 } from 'lucide-react'
import { MODES_WITH_REFERENCE, PAYMENT_MODES, formatINR, toPaise, toRupees } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Select, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchReceipts, fetchRefunds, refundReceipt } from '../../api/fees'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function NewRefund({ onClose, onSaved }) {
  const { t } = useTranslation('fees')
  const { date } = useFormat()
  const { showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found } = useQuery({ queryKey: ['fee-receipts', 'refund-pick', q], queryFn: () => fetchReceipts({ search: q, status: 'VALID', pageSize: 20 }), enabled: q.length >= 2 })
  const [receiptId, setReceiptId] = useState('')
  const [form, setForm] = useState({ amount: '', mode: 'CASH', reference: '', reason: '' })
  const [errors, setErrors] = useState({})
  const options = (found?.data ?? []).filter((r) => r.amount > (r.refunded ?? 0))
  const receipt = options.find((r) => r.id === receiptId)
  const left = receipt ? receipt.amount - (receipt.refunded ?? 0) : 0
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const needsRef = MODES_WITH_REFERENCE.includes(form.mode)
  const save = useMutation({
    mutationFn: () => refundReceipt(receiptId, { amount: toPaise(form.amount), mode: form.mode, reference: form.reference || undefined, reason: form.reason }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const modeLabel = (v) => t(`fees.modes.${v}`, PAYMENT_MODES.find((m) => m.value === v)?.label ?? v)
  return (
    <Modal open onClose={onClose} size="lg" title={t('fees.refunds.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!receipt || !toPaise(form.amount) || toPaise(form.amount) > left || form.reason.trim().length < 3 || (needsRef && !form.reference.trim())} onClick={() => save.mutate()}>{t('fees.refunds.submit')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('fees.refunds.findReceipt')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('fees.refunds.findPlaceholder')} /></FormField>
        <FormField label={t('fees.refunds.receipt')} required>
          <Select value={receiptId} onChange={(e) => { setReceiptId(e.target.value); const r = options.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, amount: r ? String(toRupees(r.amount - (r.refunded ?? 0))) : '' })) }}>
            <option value="">{q.length >= 2 ? t('fees.refunds.pickReceipt') : t('fees.picker.typeFirst')}</option>
            {options.map((r) => <option key={r.id} value={r.id}>{r.receiptNo} · {r.student?.name ?? '—'} · {formatINR(r.amount)} · {date(r.date)}</option>)}
          </Select>
        </FormField>
        {receipt && <div className="sm:col-span-2"><Note>{t('fees.refunds.canRefund', { amount: formatINR(left), no: receipt.receiptNo })}</Note></div>}
        <FormField label={t('fees.refunds.amount')} required error={errors.amount}><Input type="number" min="1" step="1" className="text-right" value={form.amount} onChange={set('amount')} /></FormField>
        <FormField label={t('fees.refunds.mode')} required>
          <Select value={form.mode} onChange={set('mode')}>{PAYMENT_MODES.filter((m) => m.value !== 'ONLINE').map((m) => <option key={m.value} value={m.value}>{modeLabel(m.value)}</option>)}</Select>
        </FormField>
        {needsRef && <FormField label={t('fees.refunds.reference')} required error={errors.reference}><Input value={form.reference} onChange={set('reference')} /></FormField>}
        <div className="sm:col-span-2"><FormField label={t('fees.refunds.reason')} required error={errors.reason}><Textarea rows={2} value={form.reason} onChange={set('reason')} /></FormField></div>
        <div className="sm:col-span-2"><Note tone="warning">{t('fees.refunds.hint')}</Note></div>
      </div>
    </Modal>
  )
}

export default function Refunds() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [adding, setAdding] = useState(false)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['fee-refunds'], queryFn: fetchRefunds })
  const modeLabel = (v) => t(`fees.modes.${v}`, PAYMENT_MODES.find((m) => m.value === v)?.label ?? v)
  return (
    <PageContainer>
      <PageHeader icon={Undo2} title={t('fees.refunds.title')} subtitle={t('fees.refunds.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="fees.refunds.refund" onClick={() => setAdding(true)}>{t('fees.refunds.new')}</HeaderButton>} />
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="fee-refunds"
        columns={[
          { key: 'refundNo', header: t('fees.refunds.no'), nowrap: true, render: (v) => <span className="font-mono-num">{v}</span> },
          { key: 'student', header: t('fees.refunds.student'), mobilePrimary: true, render: (v) => <div><p className="font-medium text-ink">{v?.name ?? '—'}</p><p className="text-xs text-ink-faint">{[v?.classShort, v?.admissionNo].filter(Boolean).join(' · ')}</p></div> },
          { key: 'date', header: t('fees.refunds.date'), nowrap: true, render: (v) => date(v) },
          { key: 'receiptNo', header: t('fees.refunds.receipt'), mobileHidden: true, render: (v) => <span className="font-mono-num text-sm">{v ?? '—'}</span> },
          { key: 'mode', header: t('fees.refunds.mode'), render: (v, r) => <span className="text-sm">{modeLabel(v)}{r.reference ? <span className="text-ink-faint"> · {r.reference}</span> : ''}</span> },
          { key: 'reason', header: t('fees.refunds.reason'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{v}{r.by ? <span className="block text-xs text-ink-faint">{r.by}</span> : null}</span> },
          { key: 'amount', header: t('fees.refunds.amount'), align: 'right', render: (v) => formatINR(v) },
        ]}
        totals={(list) => ({ amount: formatINR(list.reduce((n, r) => n + r.amount, 0)) })}
        totalsLabel={t('fees.refunds.total')}
        emptyIcon={Undo2} emptyTitle={t('fees.refunds.empty')} emptyHint={t('fees.refunds.emptyHint')}
      />
      {adding && <NewRefund onClose={() => setAdding(false)} onSaved={() => {
        ['fee-refunds', 'fee-receipts', 'fee-ledger', 'fee-dues', 'fee-day'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
        setAdding(false); showSuccess(t('fees.refunds.done'))
      }} />}
    </PageContainer>
  )
}
