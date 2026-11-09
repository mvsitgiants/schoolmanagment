import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, Building2, FileQuestion, FileSpreadsheet, Link2, Plus, ScrollText, Unlink, Upload, Wand2 } from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import { CodeBadge, DataTable, DateCell, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StackCell, StatCardRow, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { autoMatch, createBankAccount, fetchBankAccounts, fetchReconciliation, importStatement, matchLine, unmatchLine } from '../../api/finance'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function BankForm({ onClose, onSaved }) {
  const { t } = useTranslation('finance')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ name: '', bankName: '', accountNoLast4: '', ifsc: '', branch: '', isDefault: false })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({ mutationFn: () => createBankAccount(f), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('finance.bank.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>{t('finance.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><FormField label={t('finance.bank.name')} required><Input value={f.name} onChange={set('name')} placeholder={t('finance.bank.namePlaceholder')} /></FormField></div>
        <FormField label={t('finance.bank.bankName')}><Input value={f.bankName} onChange={set('bankName')} /></FormField>
        <FormField label={t('finance.bank.last4')}><Input value={f.accountNoLast4} maxLength={4} inputMode="numeric" onChange={set('accountNoLast4')} /></FormField>
        <FormField label={t('finance.bank.ifsc')}><Input value={f.ifsc} onChange={(e) => setF((x) => ({ ...x, ifsc: e.target.value.toUpperCase() }))} /></FormField>
        <FormField label={t('finance.bank.branch')}><Input value={f.branch} onChange={set('branch')} /></FormField>
        <label className="col-span-2 inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.isDefault} onChange={set('isDefault')} className="rounded border-border text-brand-500" />{t('finance.bank.isDefault')}</label>
      </div>
    </Modal>
  )
}

function ImportModal({ bank, onClose, onDone }) {
  const { t } = useTranslation('finance')
  const { showError } = useSnackbar()
  const [csv, setCsv] = useState('')
  const [result, setResult] = useState(null)
  const go = useMutation({ mutationFn: () => importStatement(bank.id, csv), onSuccess: (r) => { setResult(r); onDone() }, onError: (e) => showError(e.message) })
  const readFile = async (file) => setCsv(await file.text())
  return (
    <Modal open onClose={onClose} size="lg" title={t('finance.bank.importTitle', { name: bank.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.close')}</Button>
      <Button loading={go.isPending} disabled={csv.length < 10} onClick={() => go.mutate()}>{t('finance.bank.import')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{t('finance.bank.importHint')}</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="text-sm" />
        <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono-num text-xs" />
        {result && <Note tone="success">{t('finance.bank.imported', { imported: result.imported, duplicates: result.duplicates, matched: result.matched })}{result.errors?.length ? ` ${t('finance.bank.importErrors', { count: result.errors.length })}` : ''}</Note>}
      </div>
    </Modal>
  )
}

function Reconcile({ bank }) {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('UNRECONCILED')
  const [importing, setImporting] = useState(false)
  const [pick, setPick] = useState({})
  const { data, isLoading } = useQuery({ queryKey: ['fin-recon', bank.id, status], queryFn: () => fetchReconciliation(bank.id, { status: status || undefined }) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fin-recon', bank.id] }); qc.invalidateQueries({ queryKey: ['fin-banks'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); showSuccess(typeof v.done === 'function' ? v.done(r) : v.done) }, onError: (e) => showError(e.message) })
  const canRec = hasPermission('finance.bank.reconcile')
  const s = data?.summary
  return (
    <div className="space-y-4">
      {s && <StatCardRow items={[
        { icon: BookOpen, tone: 'brand', label: t('finance.bank.bookBalance'), value: formatINRCompact(s.bookBalance), sub: formatINR(s.bookBalance) },
        { icon: FileSpreadsheet, tone: 'info', label: t('finance.bank.statementBalance'), value: s.statementBalance != null ? formatINRCompact(s.statementBalance) : '—', sub: s.statementDate ? date(s.statementDate) : undefined },
        { icon: FileQuestion, label: t('finance.bank.unmatchedStatement'), value: s.statementUnreconciled.count, tone: s.statementUnreconciled.count ? 'warning' : 'success' },
        { icon: ScrollText, tone: 'violet', label: t('finance.bank.unmatchedBook'), value: s.bookUnreconciled.count },
      ]} />}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={status} onChange={setStatus} options={[{ value: 'UNRECONCILED', label: t('finance.bank.unmatched') }, { value: 'RECONCILED', label: t('finance.bank.matched') }, { value: '', label: t('finance.all') }]} />
        {canRec && <Button size="sm" variant="secondary" icon={Upload} onClick={() => setImporting(true)}>{t('finance.bank.importStatement')}</Button>}
        {canRec && <Button size="sm" variant="ghost" icon={Wand2} onClick={() => act.mutate({ fn: () => autoMatch(bank.id), done: (r) => t('finance.bank.autoMatched', { count: r.matched }) })}>{t('finance.bank.autoMatch')}</Button>}
      </div>
      {isLoading ? <p className="text-sm text-ink-faint">{t('finance.loading')}</p> : (
        <DataTable rows={data?.lines ?? []} dense columns={[
          { key: 'date', header: t('finance.voucher.date'), nowrap: true, render: (v) => <DateCell value={v} relative={false} /> },
          { key: 'description', header: t('finance.bank.narration'), mobilePrimary: true, render: (v, r) => <StackCell title={v || '—'} sub={r.reference} subMono className="max-w-sm" /> },
          { key: 'deposit', header: t('finance.bank.deposit'), align: 'right', render: (v) => (v ? <Money value={v} paise signed /> : '') },
          { key: 'withdrawal', header: t('finance.bank.withdrawal'), align: 'right', render: (v) => (v ? <Money value={-v} paise /> : '') },
          { key: 'status', header: t('finance.bank.match'), render: (v, r) => (v === 'RECONCILED'
            ? <span className="inline-flex items-center gap-1"><StatusPill tone="success">{r.match?.voucherNo}</StatusPill>{canRec && <Button size="sm" variant="ghost" icon={Unlink} aria-label={t('finance.bank.unmatch')} onClick={() => act.mutate({ fn: () => unmatchLine(r.id), done: t('finance.bank.unmatchedDone') })} />}</span>
            : canRec ? (
              <div className="flex gap-1 min-w-[220px]">
                <div className="flex-1 min-w-0">
                  <Select value={pick[r.id] ?? (r.suggestions[0] ? `${r.suggestions[0].journalId}:${r.suggestions[0].line}` : '')} onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))} aria-label={t('finance.bank.entry')}>
                    <option value="">{t('finance.bank.pickEntry')}</option>
                    {(data?.book ?? []).filter((b) => (r.deposit ? b.debit === r.deposit : b.credit === r.withdrawal)).map((b) => <option key={`${b.journalId}:${b.line}`} value={`${b.journalId}:${b.line}`}>{`${b.voucherNo} · ${b.date} · ${b.narration ?? ''}`.slice(0, 80)}</option>)}
                  </Select>
                </div>
                <Button size="sm" variant="ghost" icon={Link2} aria-label={t('finance.bank.matchIt')} disabled={!(pick[r.id] ?? r.suggestions[0])}
                  onClick={() => { const [journalId, line] = (pick[r.id] ?? `${r.suggestions[0].journalId}:${r.suggestions[0].line}`).split(':'); act.mutate({ fn: () => matchLine(r.id, { journalId, line: Number(line) }), done: t('finance.bank.matchedDone') }) }} />
              </div>
            ) : <span className="text-xs text-ink-faint">{t('finance.bank.unmatched')}</span>) },
        ]} emptyTitle={status === 'UNRECONCILED' ? t('finance.bank.allMatched') : t('finance.bank.noLines')} />
      )}
      {(data?.book ?? []).length > 0 && status === 'UNRECONCILED' && (
        <Panel title={t('finance.bank.bookNotOnStatement', { count: data.book.length })} flush>
          <DataTable rows={data.book.slice(0, 100)} dense rowKey={(b) => `${b.journalId}:${b.line}`} className="border-0 shadow-none" columns={[
            { key: 'date', header: t('finance.voucher.date'), nowrap: true, render: (v) => <DateCell value={v} relative={false} /> },
            { key: 'voucherNo', header: t('finance.journals.voucher'), mobilePrimary: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
            { key: 'narration', header: t('finance.voucher.narration'), render: (v) => <span className="text-sm text-ink-muted truncate max-w-sm inline-block">{v}</span> },
            { key: 'debit', header: t('finance.bank.in'), align: 'right', render: (v) => (v ? <Money value={v} paise signed /> : '') },
            { key: 'credit', header: t('finance.bank.out'), align: 'right', render: (v) => (v ? <Money value={-v} paise /> : '') },
          ]} />
        </Panel>
      )}
      {importing && <ImportModal bank={bank} onClose={() => setImporting(false)} onDone={refresh} />}
    </div>
  )
}

/** Accounts › Bank: bank accounts, statement import and reconciliation against the books. */
export default function Bank() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [adding, setAdding] = useState(false)
  const [bankId, setBankId] = useState('')
  const { data: banks = [], isLoading } = useQuery({ queryKey: ['fin-banks'], queryFn: fetchBankAccounts })
  const bank = banks.find((b) => b.id === bankId) ?? banks.find((b) => b.isDefault) ?? banks[0]
  return (
    <PageContainer>
      <PageHeader icon={Building2} title={t('finance.bank.title')} subtitle={t('finance.bank.subtitle')}
        actions={<HeaderButton icon={Plus} requires="finance.accounts.create" onClick={() => setAdding(true)}>{t('finance.bank.new')}</HeaderButton>} />
      {isLoading ? <p className="text-sm text-ink-faint">{t('finance.loading')}</p> : !bank ? <Note>{t('finance.bank.none')}</Note> : (
        <>
          {banks.length > 1 && (
            <div className="w-72 mb-4">
              <Select value={bank.id} onChange={(e) => setBankId(e.target.value)} aria-label={t('finance.bank.account')}>
                {banks.map((b) => <option key={b.id} value={b.id}>{`${b.name}${b.accountNoLast4 ? ` · …${b.accountNoLast4}` : ''}${b.unreconciled ? ` (${b.unreconciled})` : ''}`}</option>)}
              </Select>
            </div>
          )}
          <Reconcile key={bank.id} bank={bank} />
        </>
      )}
      {adding && <BankForm onClose={() => setAdding(false)} onSaved={(b) => { setAdding(false); qc.invalidateQueries({ queryKey: ['fin-banks'] }); qc.invalidateQueries({ queryKey: ['finance-meta'] }); setBankId(b.id); showSuccess(t('finance.saved')) }} />}
    </PageContainer>
  )
}
