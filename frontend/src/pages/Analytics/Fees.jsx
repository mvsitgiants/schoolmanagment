import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlarmClock, BadgePercent, CircleCheckBig, FileText, Hourglass, IndianRupee, Layers, Undo2, Wallet } from 'lucide-react'
import { PAYMENT_MODES, formatINRCompact } from '@schoolgiant/shared'
import {
  BreakdownDonut, CHART, ChartCard, ColorChip, ContactCell, DataTable, DateCell, DateRangeChip, EmptyState, MiniBarChart, Money, Note,
  PageContainer, PageHeader, PaidBar, PersonCell, RankBars, StackedBar, StatCardRow, TONE, TrendArea,
} from '../../components/system'
import PctBar from '../../components/analytics/PctBar'
import { fetchFeeAnalytics } from '../../api/analytics'
import { useFormat } from '../../context/SettingsContext'

// colour follows the payment mode (its place in the fixed list), never its rank in this period
const MODE_COLOR = Object.fromEntries(PAYMENT_MODES.map((m, i) => [m.value, CHART.series[i % CHART.series.length]]))
const AGEING_COLOR = { NOT_DUE: CHART.status.neutral, D0_30: '#FBBF24', D31_60: '#F59E0B', D61_90: '#EA580C', D90_PLUS: CHART.status.critical }
const rupees = (paise) => (paise == null ? null : paise / 100)
const money = (v) => <Money value={v} paise />

/** Analytics › Fee collection: billed against collected over a period, and where the money is stuck. */
export default function Fees() {
  const { t } = useTranslation('analytics')
  const { date } = useFormat()
  const [range, setRange] = useState(null) // null: the current academic year (the API says which dates)
  const params = { from: range?.from, to: range?.to }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics-fees', params], queryFn: () => fetchFeeAnalytics(params), placeholderData: keepPreviousData })
  const s = data?.summary
  const shownRange = range ?? (data ? { preset: 'custom', ...data.range } : null)
  const monthLabel = (m) => t('analytics.common.monthLabel', { month: t(`analytics.common.months.${Number(m.slice(5, 7))}`), year: m.slice(2, 4) })

  // running totals: how far collection has kept up with what fell due, month by month
  const cumulative = useMemo(() => {
    let billed = 0
    let collected = 0
    return (data?.months ?? []).map((m) => { billed += m.billed; collected += m.collected; return { label: monthLabel(m.month), value: billed, value2: collected } })
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const monthly = useMemo(() => (data?.months ?? []).map((m) => ({ label: monthLabel(m.month), value: m.collected })), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const ageingLabel = (k) => t(`analytics.fees.ageing.${k}`)
  const headName = (h) => (h.lateFee ? t('analytics.fees.lateFee') : h.name ?? '—')

  return (
    <PageContainer>
      <PageHeader icon={IndianRupee} title={t('analytics.fees.title')}
        subtitle={data?.year && !range ? t('analytics.fees.subtitleYear', { year: data.year.name }) : t('analytics.fees.subtitle')}
        actions={shownRange && <DateRangeChip value={shownRange} onChange={setRange} />} />
      {error && <Note tone="warning" className="mb-4">{error.response?.data?.message || error.message}</Note>}
      {!data && isLoading && <EmptyState icon={IndianRupee} title={t('analytics.common.loading')} />}
      {!data && error && <EmptyState error onRetry={refetch} title={t('analytics.common.loadFailed')} />}

      {data && s && s.invoices === 0 && s.receipts === 0 && (
        <EmptyState icon={FileText} title={t('analytics.fees.empty')} hint={t('analytics.fees.emptyHint')} />
      )}

      {data && s && (s.invoices > 0 || s.receipts > 0) && (
        <div className="flex flex-col gap-4">
          <StatCardRow items={[
            { icon: FileText, tone: 'brand', label: t('analytics.fees.billed'), value: formatINRCompact(s.billed), sub: t('analytics.fees.invoicesN', { count: s.invoices }) },
            { icon: Wallet, tone: 'success', label: t('analytics.fees.collected'), value: formatINRCompact(s.collected), sub: t('analytics.fees.receiptsN', { count: s.receipts }) },
            { icon: CircleCheckBig, tone: s.collectionPct >= 85 ? 'success' : s.collectionPct >= 60 ? 'warning' : 'danger', label: t('analytics.fees.collectionPct'), value: s.collectionPct == null ? '—' : `${s.collectionPct}%`,
              progress: s.collectionPct ?? undefined, sub: t('analytics.fees.realised', { amount: formatINRCompact(s.realised) }) },
            { icon: Hourglass, tone: 'warning', label: t('analytics.fees.outstanding'), value: formatINRCompact(s.outstanding),
              sub: t('analytics.fees.overdueSub', { amount: formatINRCompact(s.overdue), count: s.defaulters }) },
            { icon: BadgePercent, tone: 'violet', label: t('analytics.fees.concessions'), value: formatINRCompact(s.concession), sub: t('analytics.fees.studentsN', { count: s.concessionStudents }) },
            { icon: Undo2, tone: 'pink', label: t('analytics.fees.refunds'), value: formatINRCompact(s.refunded), sub: t('analytics.fees.refundsN', { count: s.refunds }) },
          ]} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <TrendArea title={t('analytics.fees.trend')} subtitle={t('analytics.fees.trendSub')} data={cumulative} valueFormat={formatINRCompact} yAxisWidth={64}
              series={[{ key: 'value', name: t('analytics.fees.billed') }, { key: 'value2', name: t('analytics.fees.collected'), color: CHART.status.good }]} />
            <BreakdownDonut title={t('analytics.fees.byMode')} subtitle={t('analytics.fees.byModeSub')} valueFormat={formatINRCompact}
              centerLabel={t('analytics.fees.collected')} centerValue={formatINRCompact(s.collected)}
              segments={data.modes.map((m) => ({ name: t(`analytics.fees.modes.${m.mode}`, m.label), value: m.amount, color: MODE_COLOR[m.mode] ?? CHART.other }))}
              empty={t('analytics.common.noData')} />
          </div>

          <MiniBarChart title={t('analytics.fees.monthly')} subtitle={t('analytics.fees.monthlySub')} data={monthly} valueFormat={formatINRCompact} color={CHART.status.good} height={190} />

          <ChartCard title={t('analytics.fees.ageingTitle')} subtitle={t('analytics.fees.ageingSub', { date: date(data.today) })} icon={AlarmClock}
            table={{ columns: [{ key: 'label', label: t('analytics.fees.bucket') }, { key: 'amount', label: t('analytics.fees.amount'), align: 'right', format: formatINRCompact }, { key: 'students', label: t('analytics.fees.students'), align: 'right' }, { key: 'invoices', label: t('analytics.fees.invoices'), align: 'right' }],
              rows: data.ageing.map((a) => ({ ...a, label: ageingLabel(a.key) })) }}>
            <StackedBar height={26} format={formatINRCompact}
              segments={data.ageing.map((a) => ({ label: ageingLabel(a.key), value: a.amount, color: AGEING_COLOR[a.key] }))} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {data.ageing.map((a) => (
                <div key={a.key} className="rounded-xl border border-border/80 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: AGEING_COLOR[a.key] }} />{ageingLabel(a.key)}
                  </p>
                  <p className={`mt-1 font-display text-lg font-semibold tabular-nums ${a.key === 'D90_PLUS' && a.amount ? TONE.danger.text : 'text-ink'}`}>{formatINRCompact(a.amount)}</p>
                  <p className="text-[11px] text-ink-muted">{t('analytics.fees.studentsN', { count: a.students })}</p>
                </div>
              ))}
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <MiniBarChart title={t('analytics.fees.outstandingByClass')} subtitle={t('analytics.fees.outstandingByClassSub')} valueFormat={formatINRCompact} color={CHART.status.warning} height={200}
              data={data.classes.map((c) => ({ label: c.name ?? t('analytics.fees.noClass'), value: c.outstanding }))} />
            <RankBars title={t('analytics.fees.lowestCollection')} subtitle={t('analytics.fees.lowestCollectionSub')} max={6} peak={100} valueFormat={(v) => `${v}%`}
              rows={[...data.classes].filter((c) => c.collectionPct != null).sort((a, b) => a.collectionPct - b.collectionPct).map((c) => ({ key: c.classId ?? 'none', label: c.name ?? t('analytics.fees.noClass'), value: c.collectionPct }))}
              empty={t('analytics.common.noData')} />
          </div>

          <DataTable title={t('analytics.fees.byClass')} exportable exportName={`fees-by-class-${data.range.from}-${data.range.to}`} rowKey={(r) => r.classId ?? 'none'} rows={data.classes}
            columns={[
              { key: 'name', header: t('analytics.fees.class'), mobilePrimary: true, sortable: true, sortAccessor: (r) => r.name ?? '', render: (v, r) => (v ? <ColorChip label={v} seed={r.classId} dot /> : <span className="text-ink-faint">{t('analytics.fees.noClass')}</span>) },
              { key: 'students', header: t('analytics.fees.students'), align: 'right', sortable: true, render: (v, r) => <span className="tabular-nums">{v}{r.owing ? <span className="ms-1 text-[11px] text-ink-faint">{t('analytics.fees.owingN', { count: r.owing })}</span> : null}</span> },
              { key: 'billed', header: t('analytics.fees.billed'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.billed), render: money },
              { key: 'paid', header: t('analytics.fees.paidVsBilled'), mobileHidden: true, sortAccessor: (r) => rupees(r.collected), render: (_, r) => <PaidBar total={r.billed} balance={r.outstanding} paise overdue={r.overdue > 0} /> },
              { key: 'outstanding', header: t('analytics.fees.outstanding'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.outstanding), render: (v) => <Money value={v} paise tone={v ? 'warning' : undefined} /> },
              { key: 'overdue', header: t('analytics.fees.overdue'), align: 'right', sortable: true, mobileHidden: true, sortAccessor: (r) => rupees(r.overdue), render: (v) => <Money value={v} paise tone={v ? 'danger' : undefined} /> },
              { key: 'collectionPct', header: t('analytics.fees.collectionPct'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={85} warn={60} /> },
            ]}
            totals={{ billed: money(s.billed), outstanding: money(s.outstanding), overdue: money(s.overdue), collectionPct: <PctBar value={s.collectionPct} good={85} warn={60} /> }}
            emptyIcon={Layers} emptyTitle={t('analytics.common.noData')} />

          <DataTable title={t('analytics.fees.byHead')} exportable exportName={`fees-by-head-${data.range.from}-${data.range.to}`} rowKey="key" rows={data.heads}
            columns={[
              { key: 'name', header: t('analytics.fees.head'), mobilePrimary: true, sortAccessor: headName, render: (_, r) => <ColorChip label={headName(r)} seed={r.key} tone={r.lateFee ? 'danger' : undefined} /> },
              { key: 'billed', header: t('analytics.fees.billed'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.billed), render: money },
              { key: 'collected', header: t('analytics.fees.collectedShare'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.collected), render: (v) => (v == null ? '—' : money(v)) },
              { key: 'outstanding', header: t('analytics.fees.outstanding'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.outstanding), render: (v) => (v == null ? '—' : <Money value={v} paise tone={v ? 'warning' : undefined} />) },
              { key: 'concession', header: t('analytics.fees.concessions'), align: 'right', mobileHidden: true, sortAccessor: (r) => rupees(r.concession), render: (v) => (v ? <Money value={v} paise tone="info" /> : <span className="text-ink-faint">—</span>) },
              { key: 'collectionPct', header: t('analytics.fees.collectionPct'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={85} warn={60} /> },
            ]}
            emptyIcon={Layers} emptyTitle={t('analytics.common.noData')} />

          <DataTable title={t('analytics.fees.defaulters')} exportable exportName={`fee-defaulters-${data.today}`} rowKey="studentId" rows={data.defaulters} maxHeight="520px"
            columns={[
              { key: 'name', header: t('analytics.fees.student'), mobilePrimary: true, sortable: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
              { key: 'classShort', header: t('analytics.fees.class'), sortable: true, render: (v, r) => <ColorChip label={v} seed={r.classId ?? v} /> },
              { key: 'overdue', header: t('analytics.fees.overdue'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.overdue), render: (v) => <Money value={v} paise tone="danger" /> },
              { key: 'oldestDue', header: t('analytics.fees.oldestDue'), sortable: true, mobileHidden: true, render: (v) => <DateCell value={v} tone="danger" /> },
              { key: 'daysOverdue', header: t('analytics.fees.daysOverdue'), align: 'right', sortable: true, render: (v) => <span className={`font-semibold tabular-nums ${v > 90 ? TONE.danger.text : v > 30 ? TONE.warning.text : 'text-ink'}`}>{v}</span> },
              { key: 'guardianName', header: t('analytics.fees.guardian'), mobileHidden: true, sortAccessor: (r) => `${r.guardianName ?? ''} ${r.guardianMobile ?? ''}`, render: (v, r) => <ContactCell name={v} phone={r.guardianMobile} /> },
            ]}
            emptyIcon={CircleCheckBig} emptyTitle={t('analytics.fees.noDefaulters')} />

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownDonut title={t('analytics.fees.concessionsByReason')} subtitle={t('analytics.fees.concessionsByReasonSub')} valueFormat={formatINRCompact}
              centerLabel={t('analytics.fees.concessions')} centerValue={formatINRCompact(s.concession)}
              segments={data.concessions.map((c, i) => ({ name: c.reason ?? t('analytics.fees.otherReason'), value: c.amount, color: CHART.series[i % CHART.series.length] }))}
              empty={t('analytics.fees.noConcessions')} />
            <RankBars title={t('analytics.fees.refundsByMode')} subtitle={t('analytics.fees.refundsByModeSub', { count: s.refunds })} valueFormat={formatINRCompact} color={CHART.series[4]}
              rows={data.refunds.map((r) => ({ key: r.mode, label: t(`analytics.fees.modes.${r.mode}`, r.label), value: r.amount, color: MODE_COLOR[r.mode] }))}
              empty={t('analytics.fees.noRefunds')} />
          </div>
        </div>
      )}
    </PageContainer>
  )
}
