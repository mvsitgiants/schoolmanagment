import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Copy, IndianRupee, Link2, Printer, Receipt, Wallet } from 'lucide-react'
import { INVOICE_STATUS, MODES_WITH_REFERENCE, PAYMENT_MODES, formatINR, toPaise, toRupees } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, FormField, Input, Money, Note, PageContainer, PageHeader, PaidBar, Panel, Select, StackCell, StatCardRow, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import { collectFee, createPaymentLink, fetchFeeLedger, fetchOnlineStatus } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'

/** With online payment on: a Razorpay link for what is due now, to send the parent (SMS from Razorpay, or copy). */
function OnlineLink({ studentId }) {
  const { t } = useTranslation('fees')
  const { showSuccess, showError } = useSnackbar()
  const { data: status } = useQuery({ queryKey: ['online-status'], queryFn: fetchOnlineStatus, staleTime: 300_000 })
  const [notify, setNotify] = useState(true)
  const [link, setLink] = useState(null)
  const make = useMutation({ mutationFn: () => createPaymentLink(studentId, { notify }), onSuccess: (r) => { setLink(r); showSuccess(notify ? t('fees.collect.linkSent') : t('fees.collect.linkMade')) }, onError: (e) => showError(e.message) })
  if (!status?.on) return null
  const copy = async () => { try { await navigator.clipboard.writeText(link.shortUrl); showSuccess(t('fees.online.copied')) } catch { showError(link.shortUrl) } }
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-medium text-ink-muted">{t('fees.collect.orLink')}</p>
      {link?.shortUrl ? (
        <div className="flex items-center gap-2"><span className="flex-1 text-xs font-mono-num break-all">{link.shortUrl}</span><Button size="sm" variant="ghost" icon={Copy} aria-label={t('fees.online.copy')} onClick={copy} /></div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('fees.collect.linkSms')}</label>
          <Button size="sm" variant="secondary" icon={Link2} className="w-full" loading={make.isPending} onClick={() => make.mutate()}>{t('fees.collect.makeLink')}</Button>
        </>
      )}
    </div>
  )
}

/** The counter: find the student, see what is due, take the money, print the receipt. */
export default function Collect() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [studentId, setStudentId] = useState(params.get('student') ?? '')
  const [picked, setPicked] = useState(null)
  const [form, setForm] = useState({ amount: '', mode: 'CASH', reference: '', waiveLateFee: false, note: '' })
  const [errors, setErrors] = useState({})
  const [last, setLast] = useState(null)
  const { data: ledger, isLoading, error, refetch } = useQuery({ queryKey: ['fee-ledger', studentId], queryFn: () => fetchFeeLedger(studentId), enabled: !!studentId })
  const canWaive = hasPermission('fees.collect.discount')
  const lateFee = ledger?.totals.lateFeeDue ?? 0
  const due = (ledger?.totals.balance ?? 0) + (form.waiveLateFee ? 0 : lateFee)

  useEffect(() => { if (params.get('student')) setParams({}, { replace: true }) }, [params, setParams])
  useEffect(() => {
    setForm((f) => ({ ...f, amount: due ? String(toRupees(due)) : '' }))
  }, [ledger, form.waiveLateFee]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id, s) => { setStudentId(id); setPicked(s ?? null); setLast(null); setErrors({}); setForm({ amount: '', mode: 'CASH', reference: '', waiveLateFee: false, note: '' }) }
  const needsRef = MODES_WITH_REFERENCE.includes(form.mode)
  const save = useMutation({
    mutationFn: () => collectFee({ studentId, amount: toPaise(form.amount), mode: form.mode, reference: form.reference || undefined, waiveLateFee: canWaive && form.waiveLateFee, note: form.note || undefined }),
    onSuccess: (r) => {
      setLast(r)
      setErrors({})
      setForm((f) => ({ ...f, reference: '', note: '' }))
      qc.invalidateQueries({ queryKey: ['fee-ledger', studentId] })
      qc.invalidateQueries({ queryKey: ['fee-receipts'] })
      qc.invalidateQueries({ queryKey: ['fee-invoices'] })
      qc.invalidateQueries({ queryKey: ['fee-dues'] })
      qc.invalidateQueries({ queryKey: ['fee-day'] })
      showSuccess(t('fees.collect.done', { no: r.receiptNo, amount: formatINR(r.amount) }))
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const modeLabel = (v) => t(`fees.modes.${v}`, PAYMENT_MODES.find((m) => m.value === v)?.label ?? v)
  const statusLabel = (s) => t(`fees.invoiceStatus.${s}`, INVOICE_STATUS[s]?.label ?? s)
  const totals = ledger?.totals

  return (
    <PageContainer>
      <PageHeader icon={Wallet} title={t('fees.collect.title')} subtitle={t('fees.collect.subtitle')} />
      <Panel className="mb-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <StudentPicker value={studentId} onChange={pick} preset={picked ?? (ledger ? { id: ledger.student.id, name: ledger.student.name, classShort: ledger.student.classShort, admissionNo: ledger.student.admissionNo } : null)} />
        </div>
      </Panel>

      {!studentId && <Note>{t('fees.collect.startHint')}</Note>}
      {studentId && isLoading && <p className="text-sm text-ink-faint">{t('fees.loading')}</p>}
      {studentId && error && <Note tone="warning" actions={<Button size="sm" variant="secondary" onClick={() => refetch()}>{t('fees.retry')}</Button>}>{error.message}</Note>}

      {ledger && (
        <div className="space-y-4">
          <StatCardRow items={[
            { icon: Receipt, tone: 'brand', label: t('fees.collect.billed'), value: formatINR(totals.billed), sub: t('fees.collect.installmentCount', { count: ledger.invoices.length }) },
            { icon: CheckCircle2, label: t('fees.collect.paid'), value: formatINR(totals.paid), tone: 'success',
              sub: t('fees.collect.ofBilled', { pct: totals.billed > 0 ? Math.round((totals.paid / totals.billed) * 100) : 0 }), progress: totals.billed > 0 ? (totals.paid / totals.billed) * 100 : 0 },
            { icon: IndianRupee, label: t('fees.collect.balance'), value: formatINR(totals.balance), tone: totals.balance ? 'warning' : 'success' },
            { icon: AlertTriangle, label: t('fees.collect.overdue'), value: formatINR(totals.overdue), tone: totals.overdue ? 'danger' : 'neutral', sub: lateFee ? t('fees.collect.lateFeeSub', { amount: formatINR(lateFee) }) : undefined },
          ]} />

          {last && (
            <Note tone="success" actions={<Button size="sm" variant="secondary" icon={Printer} onClick={() => printDocument('FEE_RECEIPT', last.id)}>{t('fees.collect.print')}</Button>}>
              {t('fees.collect.lastReceipt', { no: last.receiptNo, amount: formatINR(last.amount), balance: formatINR(last.balance) })}
            </Note>
          )}

          <div className="grid lg:grid-cols-[1fr_22rem] gap-4 items-start">
            <DataTable
              title={t('fees.collect.installments')}
              rows={ledger.invoices}
              rowTone={(r) => (r.overdue ? 'danger' : undefined)}
              columns={[
                { key: 'installment', header: t('fees.collect.installment'), mobilePrimary: true, render: (v, r) => <StackCell title={v} sub={r.invoiceNo} subMono /> },
                { key: 'dueDate', header: t('fees.collect.due'), nowrap: true, render: (v, r) => <DateCell value={v} tone={r.overdue ? 'danger' : undefined} relative={r.balance > 0} /> },
                { key: 'net', header: t('fees.collect.amount'), align: 'right', render: (v, r) => <span title={r.concession ? t('fees.collect.concessionTip', { amount: formatINR(r.concession) }) : undefined}><Money value={v} paise /></span> },
                { key: 'paid', header: t('fees.collect.paid'), align: 'right', mobileHidden: true, render: (v) => <Money value={v} paise tone={v > 0 ? 'success' : undefined} /> },
                { key: 'balance', header: t('fees.collect.balance'), align: 'right', render: (v, r) => (r.status === 'CANCELLED' ? <span className="text-ink-faint">—</span> : <span className="inline-flex flex-col items-end">
                  <PaidBar total={r.net} balance={v} paise overdue={r.overdue} paidLabel={t('fees.collect.paidShort')} />
                  {r.lateFeeDue ? <span className="text-xs text-danger-600 mt-0.5">{t('fees.collect.plusLate', { amount: formatINR(r.lateFeeDue) })}</span> : null}</span>) },
                { key: 'status', header: t('fees.collect.status'), render: (v) => <StatusPill tone={INVOICE_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
              ]}
              emptyIcon={Receipt} emptyTitle={t('fees.collect.noInvoices')} emptyHint={t('fees.collect.noInvoicesHint')}
            />

            {hasPermission('fees.collect.create') && (
              <Panel title={t('fees.collect.take')} icon={IndianRupee}>
                {due > 0 ? (
                  <div className="space-y-3">
                    <FormField label={t('fees.collect.amountReceived')} required error={errors.amount} hint={t('fees.collect.dueNow', { amount: formatINR(due) })}>
                      <Input type="number" min="1" step="1" className="text-right" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                    </FormField>
                    <FormField label={t('fees.collect.mode')} required>
                      <Select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>
                        {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{modeLabel(m.value)}</option>)}
                      </Select>
                    </FormField>
                    {needsRef && <FormField label={t('fees.collect.reference')} required error={errors.reference} hint={t('fees.collect.referenceHint')}>
                      <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
                    </FormField>}
                    {canWaive && lateFee > 0 && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.waiveLateFee} onChange={(e) => setForm((f) => ({ ...f, waiveLateFee: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                        {t('fees.collect.waiveLateFee', { amount: formatINR(lateFee) })}
                      </label>
                    )}
                    <FormField label={t('fees.collect.note')}><Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
                    <OnlineLink studentId={studentId} />
                    <Button className="w-full" loading={save.isPending} disabled={!toPaise(form.amount) || (needsRef && !form.reference.trim())} onClick={() => save.mutate()}>
                      {t('fees.collect.submit', { amount: formatINR(toPaise(form.amount)) })}
                    </Button>
                  </div>
                ) : <p className="text-sm text-ink-muted">{t('fees.collect.nothingDue', { name: ledger.student.name })}</p>}
              </Panel>
            )}
          </div>

          <DataTable
            title={t('fees.collect.receipts')}
            rows={ledger.payments}
            dense
            columns={[
              { key: 'receiptNo', header: t('fees.receipts.no'), mobilePrimary: true, render: (v) => <span className="font-mono-num">{v}</span> },
              { key: 'at', header: t('fees.receipts.when'), nowrap: true, render: (v) => <DateCell value={v} time /> },
              { key: 'mode', header: t('fees.receipts.mode'), render: (v, r) => <ColorChip label={modeLabel(v)} seed={v} dot sub={r.reference || undefined} /> },
              { key: 'amount', header: t('fees.receipts.amount'), align: 'right', render: (v, r) => <span><Money value={v} paise muted={r.status !== 'VALID'} />{r.refunded ? <span className="block text-xs text-ink-faint">{t('fees.receipts.refundedSub', { amount: formatINR(r.refunded) })}</span> : null}</span> },
              { key: 'status', header: t('fees.receipts.status'), render: (v) => <StatusPill tone={v === 'VALID' ? 'success' : 'neutral'}>{t(`fees.receiptStatus.${v}`)}</StatusPill> },
              { key: 'id', header: '', align: 'right', width: 60, render: (id) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('fees.collect.print')} title={t('fees.collect.print')} onClick={() => printDocument('FEE_RECEIPT', id)} /> },
            ]}
            emptyIcon={Receipt} emptyTitle={t('fees.collect.noReceipts')}
          />
        </div>
      )}
    </PageContainer>
  )
}
