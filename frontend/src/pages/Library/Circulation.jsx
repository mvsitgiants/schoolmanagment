import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlarmClock, ArrowLeftRight, BookCheck, BookPlus, BookX, CalendarClock, IndianRupee, RefreshCw, ScanBarcode, ScanQrCode, UserSearch, X } from 'lucide-react'
import { formatINR, toPaise } from '@schoolgiant/shared'
import { DateInput, DataTable, DateCell, FormField, Input, Money, Note, PageContainer, PageHeader, Panel, PersonCell, SearchInput, StackCell, SegmentedControl, StatCardRow, Tabs, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchBorrower, fetchCopyByCode, fetchDesk, fetchLoans, issueBooks, markLost, renewLoan, returnBook, searchBorrowers } from '../../api/library'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CollectModal, LoanPill, useLibraryLabels } from '../../components/library/LibraryKit'
import { ScanDialog, cardCodeOf } from '../../components/scan/Scanner'

const PAGE = 50

/** A scan box: a barcode scanner types the number and presses Enter — or the camera button reads it (phones). */
function ScanInput({ label, placeholder, onScan, busy, inputRef, initial = '' }) {
  const { t } = useTranslation('library')
  const [v, setV] = useState(initial)
  const [camera, setCamera] = useState(false)
  return (
    <FormField label={label}>
      <div className="flex gap-2">
        <Input ref={inputRef} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoComplete="off" disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { e.preventDefault(); onScan(cardCodeOf(v)); setV('') } }} />
        <Button variant="secondary" icon={ScanQrCode} aria-label={t('library.desk.useCamera')} title={t('library.desk.useCamera')} disabled={busy} onClick={() => setCamera(true)} />
      </div>
      <ScanDialog open={camera} onClose={() => setCamera(false)} onCode={(c) => onScan(cardCodeOf(c))} title={label} />
    </FormField>
  )
}

function BorrowerSearch({ onPick }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found = [] } = useQuery({ queryKey: ['library', 'borrowers', q], queryFn: () => searchBorrowers(q), enabled: q.length >= 2 })
  return (
    <div className="space-y-2">
      <SearchInput value={search} onChange={setSearch} placeholder={t('library.desk.searchPlaceholder')} />
      {found.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border">
          {found.map((b) => (
            <button key={`${b.kind}:${b.id}`} type="button" onClick={() => { onPick(b); setSearch('') }} className="w-full px-3 py-2 text-left text-sm hover:bg-black/[0.02]">
              <span className="text-ink">{b.name}</span>
              <span className="ml-2 text-xs text-ink-faint">{[L.kind(b.kind), b.place, b.code].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** `initialCard`: a card scanned elsewhere (the app's Scan button) opens straight on that borrower. */
function IssuePanel({ initialCard }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const bookRef = useRef(null)
  const [who, setWho] = useState(null)
  const [books, setBooks] = useState([])
  const [dueOn, setDueOn] = useState('')
  const [override, setOverride] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const key = who && { kind: who.kind, id: who.id }
  const { data: card, isFetching } = useQuery({ queryKey: ['library', 'card', key], queryFn: () => fetchBorrower(key), enabled: !!who })
  const scanCard = useMutation({ mutationFn: (code) => fetchBorrower({ code }), onSuccess: (c) => { setWho({ kind: c.borrower.kind, id: c.borrower.id }); qc.setQueryData(['library', 'card', { kind: c.borrower.kind, id: c.borrower.id }], c); setBooks([]); setOverride(false); setTimeout(() => bookRef.current?.focus(), 50) }, onError: (e) => showError(e.message) })
  const scanBook = useMutation({
    mutationFn: fetchCopyByCode,
    onSuccess: (c) => {
      if (c.status !== 'AVAILABLE') { showError(c.loan ? t('library.desk.alreadyOut', { no: c.accessionNo, name: c.loan.borrower?.name }) : t('library.desk.notAvailable', { no: c.accessionNo, status: L.copy(c.status) })); return }
      setBooks((list) => (list.some((x) => x.accessionNo === c.accessionNo) ? list : [...list, c]))
    },
    onError: (e) => showError(e.message),
  })
  const issue = useMutation({
    mutationFn: () => issueBooks({ ...key, codes: books.map((b) => b.accessionNo), dueOn: dueOn || undefined, override }),
    onSuccess: (c) => { qc.setQueryData(['library', 'card', key], c); qc.invalidateQueries({ queryKey: ['library', 'loans'] }); qc.invalidateQueries({ queryKey: ['library', 'desk'] }); showSuccess(t('library.desk.issued', { count: books.length })); setBooks([]); setOverride(false) },
    onError: (e) => showError(e.message),
  })
  const blocked = card?.blocked ?? []
  const wouldBlock = blocked.filter((b) => b !== 'LIMIT').length > 0 || (card && card.loans.length + books.length > card.limit)
  return (
    <Panel title={t('library.desk.issueTitle')} icon={BookPlus}>
      <div className="space-y-3">
        <InitialScan code={initialCard} run={(c) => scanCard.mutate(c)} />
        <ScanInput label={t('library.desk.scanCard')} placeholder={t('library.desk.scanCardPlaceholder')} onScan={(c) => scanCard.mutate(c)} busy={scanCard.isPending} />
        {!who && <BorrowerSearch onPick={(b) => { setWho({ kind: b.kind, id: b.id }); setBooks([]) }} />}
        {who && card && (
          <div className="rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">{card.borrower.name}</p>
                <p className="text-xs text-ink-faint">{[L.kind(card.borrower.kind), card.borrower.place, card.borrower.code].filter(Boolean).join(' · ')}</p>
              </div>
              <Button size="sm" variant="ghost" icon={X} aria-label={t('library.desk.clear')} onClick={() => { setWho(null); setBooks([]) }} />
            </div>
            <p className="text-xs text-ink-muted">{t('library.desk.hasOut', { count: card.loans.length, limit: card.limit })}{card.owed > 0 && <> · <span className="text-danger-600">{t('library.desk.owes', { amount: formatINR(card.owed) })}</span></>}</p>
            {card.loans.length > 0 && (
              <ul className="text-xs text-ink-muted space-y-0.5">
                {card.loans.map((l) => <li key={l.id} className="flex items-center justify-between gap-2"><span className="truncate">{l.title} <span className="text-ink-faint">({l.accessionNo})</span></span><span className="shrink-0">{l.state === 'OVERDUE' ? <span className="text-danger-600">{t('library.desk.lateBy', { count: l.daysLate })}</span> : t('library.desk.dueOn', { date: date(l.dueOn) })}</span></li>)}
              </ul>
            )}
            {blocked.length > 0 && <Note tone="warning">{blocked.map((b) => L.block(b)).join(' ')}</Note>}
            {card.owed > 0 && hasPermission('library.circulation.receive') && <Button size="sm" variant="secondary" icon={IndianRupee} onClick={() => setCollecting(true)}>{t('library.desk.collect', { amount: formatINR(card.owed) })}</Button>}
          </div>
        )}
        {who && (
          <>
            <ScanInput inputRef={bookRef} label={t('library.desk.scanBook')} placeholder={t('library.desk.scanBookPlaceholder')} onScan={(c) => scanBook.mutate(c)} busy={scanBook.isPending || isFetching} />
            {books.length > 0 && (
              <div className="divide-y divide-border rounded-xl border border-border">
                {books.map((b) => (
                  <div key={b.accessionNo} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 min-w-0 text-sm text-ink truncate">{b.title.title}<span className="ml-2 text-xs text-ink-faint">{b.accessionNo}</span></span>
                    {b.title.type === 'REFERENCE' && <span className="text-xs text-amber-700">{t('library.desk.reference')}</span>}
                    <Button size="sm" variant="ghost" icon={X} aria-label={t('library.desk.remove')} onClick={() => setBooks((list) => list.filter((x) => x.accessionNo !== b.accessionNo))} />
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 items-end">
              <FormField label={t('library.desk.due')} hint={card ? t('library.desk.dueHint', { date: date(card.dueOn), days: card.days }) : undefined}><DateInput value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></FormField>
              {(wouldBlock || books.some((b) => b.title.type === 'REFERENCE')) && <label className="inline-flex items-center gap-2 text-sm text-ink pb-2"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="rounded border-border text-brand-500" />{t('library.desk.override')}</label>}
            </div>
            <Button icon={BookCheck} loading={issue.isPending} disabled={!books.length || !hasPermission('library.circulation.issue')} onClick={() => issue.mutate()}>{t('library.desk.issue', { count: books.length })}</Button>
          </>
        )}
      </div>
      {collecting && card && <CollectModal fines={card.fines.map((f) => ({ ...f, borrower: card.borrower }))} onClose={() => setCollecting(false)} onDone={(r) => { setCollecting(false); qc.invalidateQueries({ queryKey: ['library'] }); showSuccess(t('library.fines.collected', { no: r.receiptNo })) }} />}
    </Panel>
  )
}

function ReturnPanel({ initialBook }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [damaged, setDamaged] = useState(false)
  const [last, setLast] = useState([])
  const [collecting, setCollecting] = useState(null)
  const back = useMutation({
    mutationFn: async (code) => {
      let damageCharge
      if (damaged) {
        const v = await prompt({ title: t('library.desk.damageTitle', { no: code }), label: t('library.desk.damageCharge') })
        if (v === null || v === undefined) throw new Error(t('library.desk.notTaken'))
        damageCharge = v === '' ? undefined : toPaise(v)
      }
      return returnBook({ code, damaged, damageCharge })
    },
    onSuccess: (r) => {
      setLast((list) => [r, ...list].slice(0, 8))
      setDamaged(false)
      qc.invalidateQueries({ queryKey: ['library'] })
      if (r.fines.some((f) => f.status === 'OPEN')) showError(t('library.desk.returnedLate', { days: r.daysLate, amount: formatINR(r.fines.filter((f) => f.status === 'OPEN').reduce((n, f) => n + f.amount, 0)) }))
      else showSuccess(t('library.desk.returned', { no: r.copy.accessionNo }))
    },
    onError: (e) => showError(e.message),
  })
  return (
    <Panel title={t('library.desk.returnTitle')} icon={ArrowLeftRight}>
      <div className="space-y-3">
        <ScanInput label={t('library.desk.scanReturn')} placeholder={t('library.desk.scanBookPlaceholder')} onScan={(c) => back.mutate(c)} busy={back.isPending} initial={initialBook ?? ''} />
        <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} className="rounded border-border text-brand-500" />{t('library.desk.damaged')}</label>
        {last.length > 0 && (
          <div className="divide-y divide-border rounded-xl border border-border">
            {last.map((r) => {
              const open = r.fines.filter((f) => f.status === 'OPEN')
              return (
                <div key={r.loan.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{r.loan.title}<span className="ml-2 text-xs text-ink-faint">{r.copy.accessionNo}</span></span>
                    <span className="shrink-0 text-xs text-ink-muted">{r.loan.borrower?.name}</span>
                  </div>
                  <p className="text-xs text-ink-faint">
                    {r.daysLate ? t('library.desk.lateLine', { count: r.daysLate, due: date(r.loan.dueOn) }) : t('library.desk.onTime')}
                    {r.copy.status === 'DAMAGED' && ` · ${L.copy('DAMAGED')}`}
                  </p>
                  {open.length > 0 && hasPermission('library.circulation.receive') && (
                    <Button className="mt-1" size="sm" variant="secondary" icon={IndianRupee} onClick={() => setCollecting(open.map((f) => ({ ...f, borrower: r.loan.borrower })))}>{t('library.desk.collect', { amount: formatINR(open.reduce((n, f) => n + f.amount, 0)) })}</Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {collecting && <CollectModal fines={collecting} onClose={() => setCollecting(null)} onDone={(r) => { setCollecting(null); qc.invalidateQueries({ queryKey: ['library'] }); showSuccess(t('library.fines.collected', { no: r.receiptNo })) }} />}
    </Panel>
  )
}

function Loans() {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  const [state, setState] = useState('OVERDUE')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const params = { state, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading } = useQuery({ queryKey: ['library', 'loans', params], queryFn: () => fetchLoans(params) })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['library'] }); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const lost = async (l) => {
    const v = await prompt({ title: t('library.loans.lostTitle', { title: l.title }), message: t('library.loans.lostHint'), label: t('library.loans.lostCharge') })
    if (v === null || v === undefined) return
    if (!(await confirm({ title: t('library.loans.lostConfirm', { name: l.borrower?.name }), confirmLabel: t('library.loans.markLost'), tone: 'danger' }))) return
    act.mutate({ fn: () => markLost(l.id, v === '' ? {} : { charge: toPaise(v) }), done: t('library.loans.markedLost') })
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={state} onChange={(v) => { setState(v); setPage(1) }} options={['OVERDUE', 'DUE_TODAY', 'OUT', 'RETURNED', 'LOST'].map((v) => ({ value: v, label: t(`library.loans.states.${v}`) }))} />
        <div className="w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('library.loans.search')} /></div>
      </div>
      <DataTable rows={data?.data ?? []} loading={isLoading} columns={[
        { key: 'title', header: t('library.loans.book'), mobilePrimary: true, render: (v, l) => <StackCell title={v} sub={l.accessionNo} subMono /> },
        { key: 'borrower', header: t('library.loans.borrower'), render: (v) => <PersonCell name={v?.name} sub={[L.kind(v?.kind), v?.place].filter(Boolean).join(' · ') || undefined} /> },
        { key: 'issuedOn', header: t('library.loans.issued'), mobileHidden: true, render: (v) => <DateCell value={v} relative={false} /> },
        { key: 'dueOn', header: t('library.loans.due'), render: (v, l) => (
          <span className="block">
            <DateCell value={l.returnedOn ?? v} relative={!l.daysLate} tone={l.daysLate > 0 && !l.returnedOn ? 'danger' : undefined} />
            {l.daysLate > 0 && <span className="mt-0.5 block text-xs text-danger-600">{t('library.desk.lateBy', { count: l.daysLate })}{l.fineSoFar > 0 && <> · <Money value={l.fineSoFar} paise tone="danger" className="text-xs" /></>}</span>}
          </span>
        ) },
        { key: 'state', header: t('library.loans.status'), render: (v) => <LoanPill state={v} /> },
        { key: 'id', header: '', align: 'right', width: 110, render: (_, l) => l.status === 'ISSUED' && (
          <div className="flex justify-end gap-1">
            {hasPermission('library.circulation.issue') && l.state !== 'OVERDUE' && <Button size="sm" variant="ghost" icon={RefreshCw} aria-label={t('library.loans.renew')} onClick={() => act.mutate({ fn: () => renewLoan(l.id), done: t('library.loans.renewed') })} />}
            {hasPermission('library.circulation.receive') && <Button size="sm" variant="ghost" icon={BookX} aria-label={t('library.loans.markLost')} onClick={() => lost(l)} />}
          </div>
        ) },
      ]} emptyTitle={t('library.loans.empty')}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
    </div>
  )
}

/** Library › Issue & return: the desk (scan the card, scan the books), returns with fines, and the loans lists. */
/** Runs a scan once, on arrival (a link from the app's Scan button). */
function InitialScan({ code, run }) {
  const done = useRef(false)
  useEffect(() => { if (code && !done.current) { done.current = true; run(code) } }, [code, run])
  return null
}

export default function Circulation() {
  const { t } = useTranslation('library')
  const [params] = useSearchParams()
  const [tab, setTab] = useState('DESK')
  const { data: d } = useQuery({ queryKey: ['library', 'desk'], queryFn: fetchDesk, refetchInterval: 60_000 })
  return (
    <PageContainer>
      <PageHeader icon={ScanBarcode} title={t('library.desk.title')} subtitle={t('library.desk.subtitle')} />
      <div className="space-y-4">
        {d && <StatCardRow items={[
          { icon: BookPlus, tone: 'brand', label: t('library.desk.issuedToday'), value: d.issued },
          { icon: BookCheck, tone: 'success', label: t('library.desk.returnedToday'), value: d.returned },
          { icon: CalendarClock, tone: d.dueToday ? 'warning' : 'sky', label: t('library.desk.dueToday'), value: d.dueToday },
          { icon: AlarmClock, label: t('library.desk.overdue'), value: d.overdue, tone: d.overdue ? 'danger' : 'neutral' },
        ]} />}
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'DESK', label: t('library.desk.tabDesk'), icon: UserSearch }, { value: 'LOANS', label: t('library.desk.tabLoans') }]} />
        {tab === 'DESK' ? <div className="grid lg:grid-cols-2 gap-4 items-start"><IssuePanel initialCard={params.get('card') ?? undefined} /><ReturnPanel initialBook={params.get('book') ?? undefined} /></div> : <Loans />}
      </div>
    </PageContainer>
  )
}
