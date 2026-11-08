import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, Download, HandCoins, IndianRupee, Plus, Undo2 } from 'lucide-react'
import { FINE_REASONS, formatINR, toPaise } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Money, PageContainer, PageHeader, SearchInput, SegmentedControl, Select, StatCardRow, Textarea, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { cancelFinePayment, createFine, exportFines, fetchFines, waiveFine } from '../../api/library'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { BorrowerPicker, CollectModal, FinePill, useLibraryLabels } from '../../components/library/LibraryKit'

const PAGE = 50

function FineForm({ onClose, onSaved }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const { showError } = useSnackbar()
  const [who, setWho] = useState(null)
  const [form, setForm] = useState({ reason: 'DAMAGED', amount: '', note: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => createFine({ kind: who.kind, id: who.id, reason: form.reason, amount: toPaise(form.amount), note: form.note }), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('library.fines.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!who || !(Number(form.amount) > 0)} onClick={() => save.mutate()}>{t('library.fines.save')}</Button>
    </>}>
      <div className="space-y-3">
        <BorrowerPicker value={who} onPick={setWho} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('library.fines.reason')}><Select value={form.reason} onChange={set('reason')}>{FINE_REASONS.map((r) => <option key={r.value} value={r.value}>{L.reason(r.value)}</option>)}</Select></FormField>
          <FormField label={t('library.fines.amountRs')} required><Input type="number" min="1" value={form.amount} onChange={set('amount')} /></FormField>
        </div>
        <FormField label={t('library.fines.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField>
      </div>
    </Modal>
  )
}

/** Library › Fines: what borrowers owe (late, lost, damaged), collected with a receipt, waived, or a payment cancelled. */
export default function Fines() {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [status, setStatus] = useState('OPEN')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [collecting, setCollecting] = useState(null)
  const params = { status, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading } = useQuery({ queryKey: ['library', 'fines', params], queryFn: () => fetchFines(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['library'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const ask = async (title) => { const v = await prompt({ title, label: t('library.fines.why'), required: true }); return v || null }
  const tot = data?.totals ?? {}
  const canCancel = hasPermission('library.fines.cancel')
  const canCollect = hasPermission('library.fines.create') || hasPermission('library.circulation.receive')
  const rows = data?.data ?? []
  return (
    <PageContainer>
      <PageHeader icon={HandCoins} title={t('library.fines.title')} subtitle={t('library.fines.subtitle')}
        actions={<>
          <HeaderButton icon={Download} requires="library.fines.view" onClick={() => exportFines({ status, search: q || undefined }).catch((e) => showError(e.message))}>{t('library.fines.export')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="library.fines.create" onClick={() => setAdding(true)}>{t('library.fines.new')}</HeaderButton>
        </>} />
      <div className="space-y-4">
        <StatCardRow items={[
          { label: t('library.fines.toCollect'), value: formatINR(tot.OPEN?.amount ?? 0), tone: tot.OPEN?.amount ? 'warning' : 'neutral' },
          { label: t('library.fines.collectedTotal'), value: formatINR(tot.PAID?.amount ?? 0) },
          { label: t('library.fines.waivedTotal'), value: formatINR(tot.WAIVED?.amount ?? 0) },
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={['OPEN', 'PAID', 'WAIVED', 'ALL'].map((v) => ({ value: v, label: v === 'ALL' ? t('library.fines.all') : L.fine(v) }))} />
          <div className="w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('library.fines.search')} /></div>
        </div>
        <DataTable rows={rows} loading={isLoading} columns={[
          { key: 'borrower', header: t('library.fines.borrower'), mobilePrimary: true, render: (v) => <span>{v?.name}<span className="block text-xs text-ink-faint">{[L.kind(v?.kind), v?.place, v?.code].filter(Boolean).join(' · ')}</span></span> },
          { key: 'reason', header: t('library.fines.reason'), render: (v, f) => <span>{L.reason(v)}{f.days ? <span className="text-xs text-ink-faint"> · {t('library.desk.lateBy', { count: f.days })}</span> : null}<span className="block text-xs text-ink-faint">{[f.title, f.accessionNo].filter(Boolean).join(' · ') || f.note}</span></span> },
          { key: 'date', header: t('library.fines.date'), mobileHidden: true, render: (v) => date(v) },
          { key: 'amount', header: t('library.fines.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
          { key: 'status', header: t('library.fines.status'), render: (v, f) => <span className="flex flex-col items-start gap-0.5"><FinePill status={v} />{f.paid?.receiptNo && <span className="text-[11px] text-ink-faint">{f.paid.receiptNo} · {date(f.paid.date)}</span>}{f.waived?.reason && <span className="text-[11px] text-ink-faint">{f.waived.reason}</span>}</span> },
          { key: 'id', header: '', align: 'right', width: 120, render: (_, f) => (
            <div className="flex justify-end gap-1">
              {f.status === 'OPEN' && canCollect && <Button size="sm" variant="secondary" icon={IndianRupee} onClick={() => setCollecting(rows.filter((x) => x.status === 'OPEN' && x.borrower?.kind === f.borrower?.kind && x.borrower?.id === f.borrower?.id))}>{t('library.fines.collectShort')}</Button>}
              {f.status === 'OPEN' && canCancel && <Button size="sm" variant="ghost" icon={Ban} aria-label={t('library.fines.waive')} onClick={async () => { const reason = await ask(t('library.fines.waiveTitle', { amount: formatINR(f.amount), name: f.borrower?.name })); if (reason) act.mutate({ fn: () => waiveFine(f.id, reason), done: t('library.fines.waived') }) }} />}
              {f.status === 'PAID' && canCancel && <Button size="sm" variant="ghost" icon={Undo2} aria-label={t('library.fines.cancelPayment')} onClick={async () => { const reason = await ask(t('library.fines.cancelTitle', { no: f.paid?.receiptNo })); if (reason) act.mutate({ fn: () => cancelFinePayment(f.id, reason), done: t('library.fines.cancelled') }) }} />}
            </div>
          ) },
        ]} emptyTitle={t('library.fines.empty')}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      </div>
      {adding && <FineForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); showSuccess(t('library.fines.added')) }} />}
      {collecting && <CollectModal fines={collecting} onClose={() => setCollecting(null)} onDone={(r) => { setCollecting(null); refresh(); showSuccess(t('library.fines.collected', { no: r.receiptNo })) }} />}
    </PageContainer>
  )
}
