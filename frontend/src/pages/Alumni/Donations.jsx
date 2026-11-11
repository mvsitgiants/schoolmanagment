import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeIndianRupee, CalendarRange, Download, HandHeart, Landmark, Plus, Printer, Receipt, Trophy } from 'lucide-react'
import { DONATION_FUNDS, MODES_WITH_REFERENCE, PAYMENT_MODES, donationFundLabel, formatINR, toPaise } from '@schoolgiant/shared'
import {
  DateInput, BreakdownDonut, CHART, CodeBadge, ColorChip, ColumnBars, DataTable, DateCell, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, PersonCell, RankBars,
  SearchInput, SegmentedControl, Select, StatCardRow, Tag, Textarea,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { createDonation, exportDonations, fetchDonationSummary, fetchDonations } from '../../api/alumni'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { printDocument } from '../../components/print/printDocument'
import { AlumnusFinder } from '../../components/alumni/AlumniKit'

const PAGE = 50
const OTHER_FUND = '__other'

function DonationForm({ onClose, onSaved }) {
  const { t } = useTranslation('alumni')
  const { showError } = useSnackbar()
  const [kind, setKind] = useState('ALUMNUS')
  const [alumnus, setAlumnus] = useState(null)
  const [f, setF] = useState({ name: '', email: '', mobile: '', pan: '', address: '', amount: '', mode: 'UPI', reference: '', fund: 'GENERAL', fundOther: '', purpose: '', is80G: false, date: '', note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({
    mutationFn: () => createDonation({
      donorKind: kind, alumnusId: kind === 'ALUMNUS' ? alumnus?.id : undefined, name: kind === 'OTHER' ? f.name : undefined,
      email: f.email, mobile: f.mobile, pan: f.pan, address: f.address, amount: toPaise(f.amount), mode: f.mode, reference: f.reference,
      fund: f.fund === OTHER_FUND ? f.fundOther : f.fund, purpose: f.purpose, is80G: f.is80G, date: f.date, note: f.note,
    }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const ready = Number(f.amount) > 0 && (kind === 'ALUMNUS' ? !!alumnus : f.name.trim().length > 1) && (f.fund !== OTHER_FUND || f.fundOther.trim())
  return (
    <Modal open onClose={onClose} size="lg" title={t('alumni.donations.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t('alumni.donations.save')}</Button>
    </>}>
      <div className="space-y-3">
        <SegmentedControl value={kind} onChange={setKind} options={[{ value: 'ALUMNUS', label: t('alumni.donations.fromAlumnus') }, { value: 'OTHER', label: t('alumni.donations.fromOther') }]} />
        {kind === 'ALUMNUS' ? <AlumnusFinder value={alumnus} onPick={setAlumnus} error={errors.alumnusId} /> : (
          <FormField label={t('alumni.donations.donorName')} required error={errors.name}><Input value={f.name} onChange={set('name')} /></FormField>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('alumni.donations.amountRs')} required error={errors.amount}><Input type="number" min="1" value={f.amount} onChange={set('amount')} /></FormField>
          <FormField label={t('alumni.donations.date')} error={errors.date}><DateInput value={f.date} onChange={set('date')} /></FormField>
          <FormField label={t('alumni.donations.mode')}><Select value={f.mode} onChange={set('mode')}>{PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{t(`alumni.modes.${m.value}`)}</option>)}</Select></FormField>
          {MODES_WITH_REFERENCE.includes(f.mode) && <FormField label={t('alumni.donations.reference')}><Input value={f.reference} onChange={set('reference')} /></FormField>}
          <FormField label={t('alumni.donations.fund')}>
            <Select value={f.fund} onChange={set('fund')}>{DONATION_FUNDS.map((x) => <option key={x.value} value={x.value}>{t(`alumni.funds.${x.value}`)}</option>)}<option value={OTHER_FUND}>{t('alumni.donations.otherFund')}</option></Select>
          </FormField>
          {f.fund === OTHER_FUND && <FormField label={t('alumni.donations.fundName')} required><Input value={f.fundOther} onChange={set('fundOther')} /></FormField>}
        </div>
        <FormField label={t('alumni.donations.purpose')}><Input value={f.purpose} onChange={set('purpose')} /></FormField>
        <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={f.is80G} onChange={set('is80G')} />
          <span>{t('alumni.donations.is80G')}<span className="block text-xs text-ink-muted">{t('alumni.donations.is80GHint')}</span></span>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('alumni.donations.pan')} required={f.is80G} error={errors.pan}><Input value={f.pan} onChange={set('pan')} placeholder="ABCDE1234F" className="uppercase" /></FormField>
          <FormField label={t('alumni.donations.email')} error={errors.email}><Input type="email" value={f.email} onChange={set('email')} /></FormField>
          <FormField label={t('alumni.donations.mobile')} error={errors.mobile}><Input value={f.mobile} onChange={set('mobile')} /></FormField>
        </div>
        <FormField label={t('alumni.donations.address')}><Textarea rows={2} value={f.address} onChange={set('address')} /></FormField>
      </div>
    </Modal>
  )
}

/** Alumni › Donations: gifts from alumni and well-wishers with their receipts (80G), totalled by fund and by batch. */
export default function AlumniDonations() {
  const { t } = useTranslation('alumni')
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [fund, setFund] = useState('')
  const [batch, setBatch] = useState('')
  const [only80G, setOnly80G] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [last, setLast] = useState(null)
  const params = { fund: fund || undefined, batch: batch || undefined, is80G: only80G || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['alumni', 'donations', params], queryFn: () => fetchDonations(params) })
  const { data: s } = useQuery({ queryKey: ['alumni', 'donation-summary'], queryFn: () => fetchDonationSummary() })
  const tot = s?.totals ?? {}
  const canPrint = hasPermission('alumni.donations.view')
  return (
    <PageContainer>
      <PageHeader icon={HandHeart} title={t('alumni.donations.title')} subtitle={t('alumni.donations.subtitle')}
        actions={<>
          <HeaderButton icon={Download} requires="alumni.donations.export" onClick={() => exportDonations({ ...params, page: undefined, pageSize: undefined }).catch((e) => showError(e.message))}>{t('alumni.donations.export')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="alumni.donations.create" onClick={() => setAdding(true)}>{t('alumni.donations.new')}</HeaderButton>
        </>} />
      {last && (
        <Note tone="success" actions={<>
          {canPrint && <Button size="sm" variant="secondary" icon={Printer} onClick={() => printDocument('DONATION_RECEIPT', last.id)}>{t('alumni.donations.printReceipt')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setLast(null)}>{t('actions.close')}</Button>
        </>}>{t('alumni.donations.lastSaved', { no: last.receiptNo, amount: formatINR(last.amount), name: last.donor.name })}</Note>
      )}
      <StatCardRow items={[
        { icon: BadgeIndianRupee, label: t('alumni.donations.total'), value: formatINR(tot.amount ?? 0), sub: t('alumni.donations.gifts', { count: tot.count ?? 0 }), tone: 'success' },
        { icon: CalendarRange, label: t('alumni.donations.thisFy'), value: formatINR(tot.fyAmount ?? 0), sub: t('alumni.donations.gifts', { count: tot.fyCount ?? 0 }), tone: 'brand' },
        { icon: Landmark, label: t('alumni.donations.with80G'), value: formatINR(tot.amount80G ?? 0), tone: 'violet', progress: tot.amount ? (tot.amount80G / tot.amount) * 100 : 0 },
        { icon: Trophy, label: t('alumni.donations.largest'), value: formatINR(tot.largest ?? 0), tone: 'orange' },
      ]} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <BreakdownDonut title={t('alumni.donations.byFund')} centerLabel={t('alumni.donations.total')} centerValue={formatINR(tot.amount ?? 0)} valueFormat={(v) => formatINR(v)}
          segments={(s?.byFund ?? []).map((x, i) => ({ name: x.label, value: x.amount, color: CHART.series[i % CHART.series.length] }))} empty={t('alumni.donations.noData')} />
        <ColumnBars title={t('alumni.donations.byBatch')} subtitle={t('alumni.donations.byBatchHint')} activeId={batch} onPick={(it) => { setBatch(it?.id ?? ''); setPage(1) }}
          items={(s?.byBatch ?? []).map((b) => ({ id: String(b.batch), label: `${b.batch}: ${formatINR(b.amount)}`, short: String(b.batch).slice(2), value: Math.round(b.amount / 100000) }))} />
        <RankBars title={t('alumni.donations.topDonors')} rows={(s?.topDonors ?? []).map((d, i) => ({ key: i, label: d.batch ? `${d.name} (${d.batch})` : d.name, value: d.amount }))} valueFormat={(v) => formatINR(v)} empty={t('alumni.donations.noData')} />
      </div>
      <ColumnBars title={t('alumni.donations.byMonth')} subtitle={t('alumni.donations.byBatchHint')} items={(s?.byMonth ?? []).map((m) => ({ id: m.month, label: `${m.month}: ${formatINR(m.amount)}`, short: m.month.slice(5), value: Math.round(m.amount / 100000) }))} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-52"><Select value={fund} onChange={(e) => { setFund(e.target.value); setPage(1) }}><option value="">{t('alumni.donations.allFunds')}</option>{(s?.funds ?? []).map((x) => <option key={x} value={x}>{donationFundLabel(x) === x ? x : t(`alumni.funds.${x}`)}</option>)}</Select></div>
        <SegmentedControl value={only80G} onChange={(v) => { setOnly80G(v); setPage(1) }} options={[{ value: '', label: t('alumni.donations.all') }, { value: '1', label: t('alumni.donations.only80G') }]} />
        {batch && <Button size="sm" variant="ghost" onClick={() => setBatch('')}>{t('alumni.donations.clearBatch', { batch })}</Button>}
        <div className="w-full sm:w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('alumni.donations.search')} /></div>
      </div>
      <DataTable rows={data?.data ?? []} loading={isLoading} error={error} onRetry={refetch} emptyIcon={HandHeart} emptyTitle={t('alumni.donations.empty')}
        totals={data && data.total ? { amount: <Money value={data.amount} paise /> } : undefined}
        columns={[
          { key: 'receiptNo', header: t('alumni.donations.receipt'), render: (v) => <CodeBadge>{v}</CodeBadge> },
          { key: 'date', header: t('alumni.donations.date'), mobileHidden: true, render: (v) => <DateCell value={v} /> },
          { key: 'donor', header: t('alumni.donations.donor'), mobilePrimary: true, render: (d) => <PersonCell name={d.name} sub={d.kind === 'ALUMNUS' ? t('alumni.donations.alumnusOf', { batch: d.batch ?? '—' }) : t('alumni.donations.otherDonor')} /> },
          { key: 'fund', header: t('alumni.donations.fund'), render: (v, d) => <span className="flex flex-col items-start gap-0.5"><ColorChip label={donationFundLabel(v) === v ? v : t(`alumni.funds.${v}`)} seed={`fund-${v}`} dot />{d.purpose && <span className="text-[11px] text-ink-faint">{d.purpose}</span>}</span> },
          { key: 'mode', header: t('alumni.donations.mode'), mobileHidden: true, render: (v, d) => <span className="text-sm text-ink-muted">{t(`alumni.modes.${v}`)}{d.reference ? ` · ${d.reference}` : ''}</span> },
          { key: 'is80G', header: '80G', align: 'center', mobileHidden: true, render: (v) => (v ? <Tag tone="violet">80G</Tag> : '—') },
          { key: 'amount', header: t('alumni.donations.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
          ...(canPrint ? [{ key: 'id', header: '', align: 'right', width: 60, render: (id) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('alumni.donations.print')} title={t('alumni.donations.print')} onClick={(e) => { e.stopPropagation(); printDocument('DONATION_RECEIPT', id) }} /> }] : []),
        ]}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      {adding && <DonationForm onClose={() => setAdding(false)} onSaved={(d) => {
        setAdding(false); setLast(d); qc.invalidateQueries({ queryKey: ['alumni'] }); showSuccess(t('alumni.donations.saved', { no: d.receiptNo }))
      }} />}
      <p className="flex items-center gap-1.5 text-xs text-ink-faint"><Receipt className="h-3.5 w-3.5" />{t('alumni.donations.accountsNote')}</p>
    </PageContainer>
  )
}
