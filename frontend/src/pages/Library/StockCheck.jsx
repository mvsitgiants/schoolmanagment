import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookCheck, BookX, CheckCircle2, ClipboardCheck, CircleAlert, Flag, ScanQrCode, XCircle } from 'lucide-react'
import { DataTable, FormField, Input, Note, PageContainer, PageHeader, Panel, ProgressBar, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { ScanDialog, scanFeedback } from '../../components/scan/Scanner'
import { closeStockCheck, fetchStockCheck, fetchStockChecks, scanStock, startStockCheck } from '../../api/library'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** Start a check: a name, and optionally one shelf. */
function StartForm({ onStarted }) {
  const { t } = useTranslation('library')
  const { showError } = useSnackbar()
  const { date } = useFormat()
  const [name, setName] = useState(() => t('library.stock.defaultName', { date: date(new Date()) }))
  const [shelf, setShelf] = useState('')
  const start = useMutation({ mutationFn: () => startStockCheck({ name, shelf: shelf.trim() || undefined }), onSuccess: onStarted, onError: (e) => showError(e.message) })
  return (
    <Panel title={t('library.stock.startTitle')} subtitle={t('library.stock.startHint')}>
      <div className="grid sm:grid-cols-[1fr_12rem_auto] gap-3 items-end">
        <FormField label={t('library.stock.name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label={t('library.stock.shelf')} hint={t('library.stock.shelfHint')}><Input value={shelf} onChange={(e) => setShelf(e.target.value)} /></FormField>
        <Button icon={ClipboardCheck} loading={start.isPending} disabled={name.trim().length < 2} onClick={() => start.mutate()}>{t('library.stock.start')}</Button>
      </div>
    </Panel>
  )
}

/** An open (or finished) check: scan books, see each shelf's progress and what is still missing. */
function CheckView({ id, onClosed }) {
  const { t } = useTranslation('library')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const { data: c, isLoading } = useQuery({ queryKey: ['library', 'stock', id], queryFn: () => fetchStockCheck(id) })
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState([])
  const canEdit = hasPermission('library.catalogue.edit')
  const refresh = () => qc.invalidateQueries({ queryKey: ['library', 'stock', id] })
  const close = useMutation({ mutationFn: () => closeStockCheck(id), onSuccess: (d) => { qc.setQueryData(['library', 'stock', id], d); qc.invalidateQueries({ queryKey: ['library', 'stock-list'] }); showSuccess(t('library.stock.closed')); onClosed?.() }, onError: (e) => showError(e.message) })
  const onCode = async (code) => {
    const key = `${Date.now()}`
    try {
      const r = await scanStock(id, code)
      if (!r.found || r.wrongShelf || r.onLoan) scanFeedback(false)
      setLog((l) => [{ key, ...r, code }, ...l].slice(0, 30))
      refresh()
    } catch (e) {
      scanFeedback(false)
      setLog((l) => [{ key, found: false, code, error: e.message }, ...l].slice(0, 30))
    }
  }
  if (isLoading || !c) return <div className="h-40 rounded-xl bg-black/[0.04] animate-pulse" />
  const open = c.status === 'OPEN'
  const pct = c.expected ? Math.round((c.seen / c.expected) * 100) : 0
  const tone = (r) => (!r.found || r.error ? 'danger' : r.already ? 'neutral' : r.wrongShelf || r.onLoan ? 'warning' : 'success')
  const what = (r) => (r.error ? r.error : !r.found ? t('library.stock.unknownBook') : r.already ? t('library.stock.already') : r.onLoan ? t('library.stock.onLoanHere') : r.wrongShelf ? t('library.stock.wrongShelf', { shelf: r.shelf }) : t('library.stock.found'))
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{c.name}</p>
            {c.shelf && <StatusPill tone="info">{t('library.stock.shelfN', { shelf: c.shelf })}</StatusPill>}
            <StatusPill tone={open ? 'warning' : 'success'}>{open ? t('library.stock.open') : t('library.stock.done')}</StatusPill>
          </div>
          <div className="flex items-center gap-3"><div className="flex-1"><ProgressBar value={pct} showValue={false} size="md" /></div><span className="text-sm font-semibold tabular-nums text-ink">{c.seen}/{c.expected}</span></div>
          {open && canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="lg" icon={ScanQrCode} className="w-full sm:w-auto" onClick={() => setScanning(true)}>{t('library.stock.scan')}</Button>
              <Button variant="secondary" icon={Flag} loading={close.isPending} className="w-full sm:w-auto"
                onClick={async () => { if (await confirm({ title: t('library.stock.closeTitle'), message: t('library.stock.closeMsg', { count: c.missingCount }), confirmLabel: t('library.stock.close') })) close.mutate() }}>{t('library.stock.close')}</Button>
            </div>
          )}
        </div>
      </Panel>
      <StatCardRow items={[
        { icon: BookCheck, tone: 'success', label: t('library.stock.foundN'), value: c.seen },
        { icon: BookX, tone: c.missingCount ? 'danger' : 'neutral', label: t('library.stock.missingN'), value: c.missingCount },
        { icon: CircleAlert, tone: 'info', label: t('library.stock.onLoan'), value: c.onLoan },
        { icon: XCircle, tone: c.unknown.length ? 'warning' : 'neutral', label: t('library.stock.unknownN'), value: c.unknown.length },
      ]} />
      {c.shelves.length > 1 && (
        <Panel title={t('library.stock.byShelf')} flush>
          <ul className="divide-y divide-border">
            {c.shelves.map((s) => (
              <li key={s.shelf ?? '-'} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-20 shrink-0 text-sm font-medium text-ink">{s.shelf ?? t('library.stock.noShelf')}</span>
                <span className="flex-1"><ProgressBar value={s.expected ? (s.seen / s.expected) * 100 : 0} showValue={false} /></span>
                <span className="w-16 shrink-0 text-end text-xs tabular-nums text-ink-muted">{s.seen}/{s.expected}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <DataTable rows={c.missing} title={t('library.stock.missingTitle', { count: c.missingCount })} columns={[
        { key: 'title', header: t('library.stock.book'), mobilePrimary: true, render: (v, r) => <span><span className="block font-medium text-ink">{v}</span><span className="block text-xs text-ink-faint font-mono">{r.accessionNo}</span></span> },
        { key: 'shelf', header: t('library.stock.shelf'), mobileTrail: true, render: (v) => v ?? '—' },
      ]} emptyIcon={CheckCircle2} emptyTitle={t('library.stock.nothingMissing')} />
      <ScanDialog open={scanning} continuous onClose={() => setScanning(false)} onCode={onCode} title={t('library.stock.scanTitle', { seen: c.seen, expected: c.expected })} hint={t('library.stock.scanHint')}>
        <ul className="divide-y divide-border rounded-lg border border-border max-h-48 overflow-y-auto">
          {log.slice(0, 8).map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate text-ink">{r.title || r.code}</span>{r.title && <span className="block text-[11px] font-mono text-ink-faint">{r.accessionNo}</span>}</span>
              <StatusPill tone={tone(r)}>{what(r)}</StatusPill>
            </li>
          ))}
          {!log.length && <li className="px-3 py-2 text-sm text-ink-faint">{t('library.stock.nothingYet')}</li>}
        </ul>
      </ScanDialog>
    </div>
  )
}

/**
 * Library › Stock check (/library/stock-check): walk the shelves scanning every book with the phone's camera or a
 * scanner gun. What should be on a shelf and was never scanned is missing — out-on-loan books are counted apart.
 */
export default function StockCheck() {
  const { t } = useTranslation('library')
  const { date } = useFormat()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const { data: checks = [], isLoading } = useQuery({ queryKey: ['library', 'stock-list'], queryFn: fetchStockChecks })
  const openCheck = checks.find((c) => c.status === 'OPEN')
  const id = params.get('id') ?? openCheck?.id ?? null
  const show = (x) => setParams(x ? { id: x } : {})
  return (
    <PageContainer>
      <PageHeader icon={ClipboardCheck} title={t('library.stock.title')} subtitle={t('library.stock.subtitle')} />
      <div className="space-y-4">
        {id ? <CheckView key={id} id={id} onClosed={() => qc.invalidateQueries({ queryKey: ['library', 'stock-list'] })} />
          : !isLoading && hasPermission('library.catalogue.edit') && <StartForm onStarted={(c) => { qc.invalidateQueries({ queryKey: ['library', 'stock-list'] }); show(c.id) }} />}
        {!isLoading && !openCheck && id && hasPermission('library.catalogue.edit') && <Button variant="ghost" onClick={() => show(null)}>{t('library.stock.newCheck')}</Button>}
        {checks.length > 0 && (
          <DataTable rows={checks} title={t('library.stock.history')} onRowClick={(r) => show(r.id)} columns={[
            { key: 'name', header: t('library.stock.name'), mobilePrimary: true, render: (v, r) => <span><span className="block font-medium text-ink">{v}</span><span className="block text-xs text-ink-faint">{date(r.startedAt)}{r.shelf ? ` · ${t('library.stock.shelfN', { shelf: r.shelf })}` : ''}</span></span> },
            { key: 'summary', header: t('library.stock.result'), render: (v) => (v ? t('library.stock.summary', { seen: v.seen, expected: v.expected, missing: v.missing }) : '—') },
            { key: 'status', header: '', mobileTrail: true, render: (v) => <StatusPill tone={v === 'OPEN' ? 'warning' : 'success'}>{v === 'OPEN' ? t('library.stock.open') : t('library.stock.done')}</StatusPill> },
          ]} />
        )}
        {!isLoading && !checks.length && !hasPermission('library.catalogue.edit') && <Note>{t('library.stock.none')}</Note>}
      </div>
    </PageContainer>
  )
}
