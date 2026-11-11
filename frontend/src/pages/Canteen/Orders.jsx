import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Banknote, ChefHat, ClipboardList, HandPlatter, IndianRupee, Receipt, ShoppingCart, Wallet } from 'lucide-react'
import { CANTEEN_ORDER_STATUS, formatINR } from '@schoolgiant/shared'
import { DateInput, ColorChip, ColumnBars, DataTable, KanbanBoard, KanbanCard, PageContainer, PageHeader, RankBars, StatCardRow, Tabs } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAllOrders, fetchDaySummary, fetchOrders, fetchPreorders, orderCollected, orderReady } from '../../api/canteen'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import CounterPos from '../../components/canteen/CounterPos'
import { FoodMark, OrderPill, categoryTone, useCanteenLabels } from '../../components/canteen/CanteenKit'

const PAGE = 50
const linesText = (o) => o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')

/** Pre-orders for a day: what to make (by item), then a board PLACED → READY → COLLECTED. */
function Preorders({ date }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['canteen', 'preorders', date], queryFn: () => fetchPreorders(date), enabled: !!date })
  const move = useMutation({ mutationFn: ({ id, to }) => (to === 'READY' ? orderReady(id) : orderCollected(id)), onSuccess: () => qc.invalidateQueries({ queryKey: ['canteen'] }), onError: (e) => showError(e.message) })
  const rows = data?.rows ?? []
  const open = rows.filter((o) => o.status === 'PLACED')
  const prep = new Map()
  for (const o of open) for (const l of o.lines) prep.set(l.itemId, { id: l.itemId, label: l.name, short: l.name.slice(0, 8), value: (prep.get(l.itemId)?.value ?? 0) + l.qty, tone: categoryTone(l.category) })
  const canMove = hasPermission('canteen.orders.create')
  const columns = ['PLACED', 'READY', 'COLLECTED', 'CANCELLED'].map((s) => ({ key: s, label: L.status(s), tone: CANTEEN_ORDER_STATUS[s].tone }))
  return (
    <div className="space-y-4">
      <ColumnBars title={t('canteen.preorders.toMake')} subtitle={t('canteen.preorders.toMakeSub', { count: open.length })} items={[...prep.values()].sort((a, b) => b.value - a.value)} />
      <KanbanBoard columns={columns} items={rows} loading={isLoading} emptyText={t('canteen.preorders.none')}
        renderCard={(o) => (
          <KanbanCard title={o.studentName ?? t('canteen.orders.walkIn')} subtitle={[o.place, o.orderNo].filter(Boolean).join(' · ')} tag={linesText(o)} tagTone="neutral"
            amount={formatINR(o.total)} avatar={o.studentName}
            actions={canMove && o.status === 'PLACED' ? <Button size="sm" variant="secondary" icon={ChefHat} loading={move.isPending && move.variables?.id === o.id} onClick={() => move.mutate({ id: o.id, to: 'READY' })}>{t('canteen.preorders.ready')}</Button>
              : canMove && o.status === 'READY' ? <Button size="sm" icon={HandPlatter} loading={move.isPending && move.variables?.id === o.id} onClick={() => move.mutate({ id: o.id, to: 'COLLECTED' })}>{t('canteen.preorders.collected')}</Button> : null} />
        )} />
    </div>
  )
}

/** The day: sales (wallet / cash), top-ups, cash in hand, sales by item (over the whole day), then the day's orders a page at a time. */
function DaySummary({ date }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const [page, setPage] = useState(1)
  const { data: d } = useQuery({ queryKey: ['canteen', 'summary', date], queryFn: () => fetchDaySummary(date), enabled: !!date })
  const { data: orders, isLoading } = useQuery({ queryKey: ['canteen', 'orders', 'ALL', date, page], queryFn: () => fetchOrders({ date, page, pageSize: PAGE }), enabled: !!date, placeholderData: (prev) => prev })
  if (!d) return <div className="h-40 rounded-xl bg-black/[0.05] animate-pulse" />
  return (
    <div className="space-y-4">
      <StatCardRow items={[
        { icon: ShoppingCart, label: t('canteen.summary.sales'), value: formatINR(d.sales.total), sub: t('canteen.summary.orders', { count: d.sales.count }), segments: [{ label: t('canteen.payModes.WALLET'), value: d.sales.wallet / 100, tone: 'brand' }, { label: t('canteen.payModes.CASH'), value: d.sales.cash / 100, tone: 'warning' }] },
        { icon: Wallet, tone: 'success', label: t('canteen.summary.topUps'), value: formatINR(d.topUps.total), sub: t('canteen.summary.topUpsSub', { count: d.topUps.count }) },
        { icon: Banknote, tone: 'warning', label: t('canteen.summary.cashInHand'), value: formatINR(d.cashInHand), sub: t('canteen.summary.cashInHandSub') },
        { icon: ClipboardList, tone: 'violet', label: t('canteen.summary.preorders'), value: formatINR(d.sales.preorders), sub: Object.entries(d.preorders).map(([s, n]) => `${L.status(s)} ${n}`).join(' · ') || t('canteen.summary.noPreorders') },
      ]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RankBars title={t('canteen.summary.byItem')} subtitle={t('canteen.summary.byItemSub')} rows={d.items.map((i) => ({ key: i.itemId, label: `${i.name} (${i.qty})`, value: i.amount }))} valueFormat={(v) => formatINR(v)} max={12} empty={t('canteen.summary.nothingSold')} />
        <ColumnBars title={t('canteen.summary.qtyByItem')} items={d.items.slice(0, 14).map((i) => ({ id: i.itemId, label: i.name, short: i.name.slice(0, 6), value: i.qty, tone: categoryTone(i.category) }))} />
      </div>
      <DataTable rows={orders?.rows ?? []} loading={isLoading} emptyTitle={t('canteen.summary.noOrders')} exportable exportName={`canteen-orders-${date}`} exportAll={() => fetchAllOrders({ date })}
        pagination={orders && orders.total > PAGE ? { page: page - 1, size: PAGE, totalElements: orders.total, totalPages: Math.ceil(orders.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} columns={[
        { key: 'orderNo', header: t('canteen.orders.no'), mobilePrimary: true, render: (v, o) => <span className="flex flex-col"><span className="font-mono-num text-sm font-semibold text-ink">{v}</span><span className="text-[11px] text-ink-faint">{t(`canteen.sources.${o.source}`)}</span></span> },
        { key: 'studentName', header: t('canteen.orders.student'), render: (v, o) => (v ? <span className="flex flex-col"><span className="text-sm text-ink">{v}</span><span className="text-[11px] text-ink-faint">{[o.admissionNo, o.place].filter(Boolean).join(' · ')}</span></span> : <span className="text-ink-faint">{t('canteen.orders.walkIn')}</span>) },
        { key: 'lines', header: t('canteen.orders.items'), mobileHidden: true, render: (v) => <span className="flex flex-wrap gap-1">{v.map((l) => <span key={l.itemId} className="inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-ink"><FoodMark mark={l.mark} size={9} />{l.qty} × {l.name}</span>)}</span> },
        { key: 'payMode', header: t('canteen.orders.paid'), render: (v) => <ColorChip label={L.pay(v)} tone={v === 'WALLET' ? 'brand' : 'warning'} icon={v === 'WALLET' ? Wallet : IndianRupee} /> },
        { key: 'total', header: t('canteen.orders.total'), align: 'right', render: (v) => <span className="font-mono-num font-semibold">{formatINR(v)}</span> },
        { key: 'status', header: t('canteen.orders.status'), render: (v) => <OrderPill status={v} /> },
      ]} />
    </div>
  )
}

/** Canteen › Orders: the counter (POS), the day's pre-orders, and the day's summary. */
export default function CanteenOrders() {
  const { t } = useTranslation('canteen')
  const { date: fmt } = useFormat()
  const [tab, setTab] = useState('COUNTER')
  const { data: today } = useQuery({ queryKey: ['canteen', 'summary', 'today'], queryFn: () => fetchDaySummary() })
  const [date, setDate] = useState('')
  const day = date || today?.date
  return (
    <PageContainer>
      <PageHeader icon={Receipt} title={t('canteen.orders.title')} subtitle={t('canteen.orders.subtitle')}
        actions={tab !== 'COUNTER' && <div className="flex items-center gap-2"><DateInput value={day ?? ''} onChange={(e) => setDate(e.target.value)} aria-label={t('canteen.orders.day')} />{day && <span className="hidden sm:inline text-xs text-ink-muted">{fmt(day)}</span>}</div>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'COUNTER', label: t('canteen.orders.tabs.counter') },
        { value: 'PREORDERS', label: t('canteen.orders.tabs.preorders') },
        { value: 'SUMMARY', label: t('canteen.orders.tabs.summary') },
      ]} className="mb-4" />
      {tab === 'COUNTER' && <CounterPos />}
      {tab === 'PREORDERS' && day && <Preorders date={day} />}
      {tab === 'SUMMARY' && day && <DaySummary key={day} date={day} />}
      {tab !== 'COUNTER' && !day && <div className="h-40 rounded-xl bg-black/[0.05] animate-pulse" />}
    </PageContainer>
  )
}
