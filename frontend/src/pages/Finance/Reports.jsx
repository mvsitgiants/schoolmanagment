import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, BookText, Download, FileSpreadsheet, LineChart, ListChecks, PiggyBank, RefreshCw, Scale, TrendingDown, TrendingUp } from 'lucide-react'
import { formatINR, formatINRCompact, fyRange } from '@schoolgiant/shared'
import { DateInput, CodeBadge, ColorChip, DataTable, DateCell, FormField, Money, Note, PageContainer, PageHeader, Panel, Select, SideNav, SideNavLayout, StatCardRow, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { downloadReport, fetchReport, rebuildPostings } from '../../api/finance'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { AccountSelect, useFinanceMeta } from '../../components/finance/FinanceKit'

const REPORTS = [
  { id: 'income-expenditure', icon: PiggyBank },
  { id: 'balance-sheet', icon: Scale },
  { id: 'trial-balance', icon: ListChecks },
  { id: 'day-book', icon: BookOpen },
  { id: 'ledger', icon: BookText },
]

function Sections({ title, section }) {
  return (
    <Panel title={title} flush>
      <div className="divide-y divide-border">
        {section.groups.map((g) => (
          <div key={g.name} className="px-4 py-2">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">{g.name}</p>
            {g.rows.map((r) => <div key={r.id} className="flex justify-between gap-3 text-sm py-0.5"><span className="inline-flex min-w-0 items-center gap-2"><CodeBadge>{r.code}</CodeBadge><span className="min-w-0">{r.name}</span></span><Money value={r.amount} paise className="shrink-0" /></div>)}
            <div className="flex justify-between gap-3 text-sm font-semibold pt-1"><span /><Money value={g.total} paise /></div>
          </div>
        ))}
        <div className="flex justify-between gap-3 px-4 py-2 font-semibold bg-bg"><span>{title}</span><Money value={section.total} paise /></div>
      </div>
    </Panel>
  )
}

/** Accounts › Financial reports: income & expenditure, balance sheet, trial balance, day book, ledgers and the Tally export. */
export default function Reports() {
  const { t } = useTranslation('finance')
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: meta } = useFinanceMeta()
  const [tab, setTab] = useState('income-expenditure')
  const [fy, setFy] = useState('')
  const [custom, setCustom] = useState(null)
  const [accountId, setAccountId] = useState('')
  const theFy = fy || meta?.fy
  const range = custom ?? (theFy ? fyRange(theFy) : null)
  const asOf = range ? (range.to < (meta?.today ?? range.to) ? range.to : meta?.today) : null
  const params = tab === 'balance-sheet' ? { asOf } : tab === 'ledger' ? { ...range, accountId } : range
  const ready = !!range && (tab !== 'ledger' || !!accountId)
  const { data, isLoading, error } = useQuery({ queryKey: ['fin-report', tab, params], queryFn: () => fetchReport(tab, params), enabled: ready })
  const exportKind = { 'income-expenditure': 'pnl', 'balance-sheet': 'balance-sheet', 'trial-balance': 'trial-balance', 'day-book': 'day-book', ledger: 'ledger' }[tab]
  const rebuild = useMutation({ mutationFn: () => rebuildPostings(range), onSuccess: (r) => showSuccess(t('finance.reports.rebuilt', { posted: r.posted, existing: r.existing })), onError: (e) => showError(e.message) })
  const dl = (kind) => downloadReport(kind, kind === 'balance-sheet' ? { asOf } : kind === 'ledger' ? { ...range, accountId } : range).catch((e) => showError(e.message))
  return (
    <PageContainer>
      <PageHeader icon={LineChart} title={t('finance.reports.title')} subtitle={t('finance.reports.subtitle')} />
      <SideNavLayout nav={(
        <SideNav title={t('finance.reports.navTitle')} value={tab} onChange={setTab} items={REPORTS.map((r) => ({ id: r.id, label: t(`finance.reports.tabs.${r.id}`), icon: r.icon, hint: t(`finance.reports.hints.${r.id}`) }))} />
      )}>
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <div className="col-span-2 sm:w-44">
          <FormField label={t('finance.reports.fy')}>
            <Select value={custom ? '' : theFy ?? ''} onChange={(e) => { setCustom(null); setFy(e.target.value) }}>
              {custom && <option value="">{t('finance.reports.custom')}</option>}
              {(meta?.fys ?? []).map((f) => <option key={f} value={f}>{t('finance.reports.fyLabel', { fy: f })}</option>)}
            </Select>
          </FormField>
        </div>
        {range && <div className={tab === 'balance-sheet' ? 'col-span-2 sm:w-40' : 'min-w-0 sm:w-40'}><FormField label={t('finance.reports.from')}><DateInput value={range.from} onChange={(e) => setCustom({ ...range, from: e.target.value })} /></FormField></div>}
        {range && tab !== 'balance-sheet' && <div className="min-w-0 sm:w-40"><FormField label={t('finance.reports.to')}><DateInput value={range.to} onChange={(e) => setCustom({ ...range, to: e.target.value })} /></FormField></div>}
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1">
          {hasPermission('finance.reports.export') && ready && <Button variant="secondary" icon={Download} onClick={() => dl(exportKind)}>{t('finance.reports.csv')}</Button>}
          {hasPermission('finance.reports.export') && range && <Button variant="ghost" icon={FileSpreadsheet} onClick={() => dl('tally')}>{t('finance.reports.tally')}</Button>}
          {hasPermission('finance.journals.post') && range && <Button variant="ghost" icon={RefreshCw} loading={rebuild.isPending}
            onClick={async () => { if (await confirm({ title: t('finance.reports.rebuildTitle'), message: t('finance.reports.rebuildHint'), confirmLabel: t('finance.reports.rebuild') })) rebuild.mutate() }}>{t('finance.reports.rebuild')}</Button>}
        </div>
      </div>
      {tab === 'ledger' && <div className="w-full sm:w-96"><AccountSelect accounts={meta?.accounts} value={accountId} onChange={setAccountId} aria-label={t('finance.reports.account')} /></div>}
      {!ready ? <Note>{t('finance.reports.pickAccount')}</Note> : isLoading ? <p className="text-sm text-ink-faint">{t('finance.loading')}</p> : error ? <Note tone="warning">{error.message}</Note> : data && (
        <>
          {tab === 'income-expenditure' && (
            <div className="space-y-4">
              <StatCardRow items={[
                { icon: TrendingUp, tone: 'success', label: t('finance.reports.income'), value: formatINRCompact(data.income.total), sub: formatINR(data.income.total) },
                { icon: TrendingDown, tone: 'orange', label: t('finance.reports.expenditure'), value: formatINRCompact(data.expenses.total), sub: formatINR(data.expenses.total) },
                { icon: PiggyBank, tone: data.profit >= 0 ? 'success' : 'danger', label: data.profit >= 0 ? t('finance.reports.surplus') : t('finance.reports.deficit'), value: formatINRCompact(Math.abs(data.profit)),
                  sub: data.income.total > 0 ? t('finance.reports.ofIncome', { pct: Math.round((Math.abs(data.profit) / data.income.total) * 100) }) : undefined },
              ]} />
              <div className="grid lg:grid-cols-2 gap-4"><Sections title={t('finance.reports.income')} section={data.income} /><Sections title={t('finance.reports.expenditure')} section={data.expenses} /></div>
              <Note tone={data.profit >= 0 ? 'success' : 'warning'}>{data.profit >= 0 ? t('finance.reports.surplus') : t('finance.reports.deficit')}: <Money value={Math.abs(data.profit)} paise /></Note>
            </div>
          )}
          {tab === 'balance-sheet' && (
            <div className="space-y-4">
              {!data.balanced && <Note tone="danger">{t('finance.reports.notBalanced')}</Note>}
              <p className="text-sm text-ink-muted">{t('finance.reports.asOf', { date: date(data.asOf) })}</p>
              <div className="grid lg:grid-cols-2 gap-4">
                <Sections title={t('finance.reports.assets')} section={data.assets} />
                <div className="space-y-4"><Sections title={t('finance.reports.liabilities')} section={data.liabilities} /><Sections title={t('finance.reports.funds')} section={data.equity} /></div>
              </div>
            </div>
          )}
          {tab === 'trial-balance' && (
            <>
              {!data.balanced && <Note tone="danger" className="mb-3">{t('finance.reports.notBalanced')}</Note>}
              <DataTable rows={[...data.rows, { id: 'total', code: '', name: t('finance.reports.total'), ...data.totals }]} dense columns={[
                { key: 'name', header: t('finance.accounts.account'), mobilePrimary: true, render: (v, r) => <span className={r.id === 'total' ? 'font-semibold' : 'inline-flex items-center gap-2'}>{r.code && <CodeBadge>{r.code}</CodeBadge>}{v}</span> },
                ...['openingDr', 'openingCr', 'debit', 'credit', 'closingDr', 'closingCr'].map((k) => ({ key: k, header: t(`finance.reports.tb.${k}`), align: 'right', render: (v) => (v ? <Money value={v} paise /> : '') })),
              ]} />
            </>
          )}
          {tab === 'day-book' && (
            <DataTable rows={data.rows} dense columns={[
              { key: 'date', header: t('finance.voucher.date'), nowrap: true, render: (v) => <DateCell value={v} relative={false} /> },
              { key: 'voucherNo', header: t('finance.journals.voucher'), mobilePrimary: true, render: (v, r) => <div className="flex flex-col items-start gap-1"><CodeBadge>{v}</CodeBadge><ColorChip label={t(`finance.voucherTypes.${r.type}`)} seed={r.type} dot /></div> },
              { key: 'narration', header: t('finance.voucher.narration'), render: (v, r) => <span className="text-sm">{v}<span className="block text-xs text-ink-faint">{r.lines.map((l) => `${l.accountName} ${l.debit ? 'Dr' : 'Cr'}`).join(' · ')}</span></span> },
              { key: 'total', header: t('finance.voucher.amount'), align: 'right', mobileTrail: true, render: (v) => <Money value={v} paise /> },
            ]} emptyTitle={t('finance.reports.none')} />
          )}
          {tab === 'ledger' && (
            <DataTable rows={[{ journalId: 'open', line: 0, date: data.from, narration: t('finance.reports.opening'), balance: data.opening }, ...data.entries, { journalId: 'close', line: 0, date: data.to, narration: t('finance.reports.closing'), debit: data.totals.debit, credit: data.totals.credit, balance: data.closing }]}
              rowKey={(r) => `${r.journalId}:${r.line}`} dense columns={[
                { key: 'date', header: t('finance.voucher.date'), nowrap: true, render: (v) => <DateCell value={v} relative={false} /> },
                { key: 'voucherNo', header: t('finance.journals.voucher'), render: (v) => (v ? <CodeBadge>{v}</CodeBadge> : '') },
                { key: 'narration', header: t('finance.voucher.narration'), mobilePrimary: true, render: (v, r) => <span className="text-sm">{v}{r.against && <span className="block text-xs text-ink-faint">{r.against}{r.party ? ` · ${r.party}` : ''}</span>}</span> },
                { key: 'debit', header: t('finance.voucher.debit'), align: 'right', render: (v) => (v ? <Money value={v} paise /> : '') },
                { key: 'credit', header: t('finance.voucher.credit'), align: 'right', render: (v) => (v ? <Money value={v} paise /> : '') },
                { key: 'balance', header: t('finance.accounts.balance'), align: 'right', mobileTrail: true, render: (v) => <Money value={v} paise /> },
              ]} />
          )}
        </>
      )}
      </SideNavLayout>
    </PageContainer>
  )
}
