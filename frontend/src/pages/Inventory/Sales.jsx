import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Ban, Banknote, CreditCard, Download, Minus, Plus, Printer, Receipt, ShoppingBag, Smartphone, Store, Trash2 } from 'lucide-react'
import { STORE_SALE_MODES, formatINR, salePriceOf } from '@schoolgiant/shared'
import {
  DateInput, CodeBadge, DataTable, DateCell, EmptyState, FormField, Input, Money, Note, PageContainer, PageHeader, Panel, PersonCell, RankBars, SearchInput, SegmentedControl,
  Skeleton, StatCardRow, TONE, hueTone, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { cancelSale, createSale, exportSales, fetchSales } from '../../api/inventory'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { CATEGORY_ICON, CampusSelect, SalePill, SaleStudentPicker, useInventoryLabels, useInventoryMeta, useItemOptions } from '../../components/inventory/InventoryKit'

const MODE_ICON = { CASH: Banknote, UPI: Smartphone, CARD: CreditCard }

/** A sellable item as a tile: price, and a button per size (with what is in stock). */
function ProductTile({ item, onAdd }) {
  const { t } = useTranslation('inventory')
  const Icon = CATEGORY_ICON[item.category] ?? ShoppingBag
  const tone = TONE[hueTone(`store-${item.category}`)]
  const sizes = item.sizes.length ? item.sizes : [{ size: '' }]
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tone.bg)}><Icon className={clsx('h-4 w-4', tone.text)} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-ink">{item.name}</span>
          <span className="block text-xs text-ink-faint">{item.salePrice != null ? formatINR(item.salePrice) : t('inventory.sales.noPrice')}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sizes.map((s) => {
          const have = s.size ? item.stockBySize?.[s.size] ?? 0 : item.stock
          const price = salePriceOf(item, s.size)
          const off = have <= 0 || !price
          return (
            <button key={s.size || '_'} type="button" disabled={off} onClick={() => onAdd(item, s.size)}
              title={price ? formatINR(price) : undefined}
              className={clsx('inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors',
                off ? 'cursor-not-allowed border-border bg-bg text-ink-faint line-through' : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100')}>
              {s.size || t('inventory.sales.add')}
              <span className={clsx('rounded px-1 text-[10px] font-medium tabular-nums', off ? '' : have <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-white/70 text-ink-muted')}>{have}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Counter({ branchId, onSold }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const campus = branchId || meta?.myBranchId || ''
  const { data: items = [], isLoading } = useItemOptions({ sellable: true, branchId: campus })
  const [cat, setCat] = useState('')
  const [find, setFind] = useState('')
  const [student, setStudent] = useState(null)
  const [cart, setCart] = useState([]) // { itemId, name, size, qty, rate, have }
  const [mode, setMode] = useState('CASH')
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState({})
  const cats = [...new Set(items.map((i) => i.category))]
  const shown = items.filter((i) => (!cat || i.category === cat) && (!find || i.name.toLowerCase().includes(find.toLowerCase()) || i.code.toLowerCase().includes(find.toLowerCase())))
  const add = (item, size) => setCart((c) => {
    const have = size ? item.stockBySize?.[size] ?? 0 : item.stock
    const at = c.findIndex((l) => l.itemId === item.id && l.size === size)
    if (at >= 0) return c.map((l, i) => (i === at ? { ...l, qty: Math.min(l.qty + 1, have) } : l))
    return [...c, { itemId: item.id, name: item.name, size, qty: 1, rate: salePriceOf(item, size), have }]
  })
  const bump = (n, d) => setCart((c) => c.map((l, i) => (i === n ? { ...l, qty: Math.max(1, Math.min(l.have, l.qty + d)) } : l)))
  const total = cart.reduce((s, l) => s + l.qty * l.rate, 0)
  const sell = useMutation({
    mutationFn: () => createSale({ studentId: student.id, branchId: campus || undefined, mode, reference, lines: cart.map((l) => ({ itemId: l.itemId, size: l.size, qty: l.qty })) }),
    onSuccess: (s) => { setCart([]); setReference(''); setErrors({}); onSold(s) },
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-60"><SearchInput value={find} onChange={setFind} placeholder={t('inventory.sales.findItem')} /></div>
          {cats.length > 1 && <SegmentedControl value={cat} onChange={setCat} options={[{ value: '', label: t('inventory.sales.allItems') }, ...cats.map((c) => ({ value: c, label: L.cat(c) }))]} />}
        </div>
        {isLoading ? <Skeleton className="h-40" /> : shown.length === 0 ? (
          <EmptyState icon={Store} title={t('inventory.sales.noItems')} hint={t('inventory.sales.noItemsHint')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map((i) => <ProductTile key={i.id} item={i} onAdd={add} />)}</div>
        )}
      </div>
      <Panel title={t('inventory.sales.bill')} icon={Receipt} className="lg:sticky lg:top-4 self-start">
        <div className="space-y-4">
          <SaleStudentPicker value={student} onPick={setStudent} error={errors.studentId} />
          {cart.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-ink-faint">{t('inventory.sales.cartEmpty')}</p> : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {cart.map((l, n) => (
                <div key={`${l.itemId}:${l.size}`} className="flex items-center gap-2 px-2.5 py-2">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.name}{l.size ? <CodeBadge className="ms-1">{l.size}</CodeBadge> : null}</span><span className="block text-xs text-ink-faint">{formatINR(l.rate)}</span></span>
                  <span className="inline-flex items-center rounded-lg border border-border">
                    <button type="button" className="grid h-8 w-8 place-items-center text-ink-muted hover:text-ink" aria-label={t('inventory.sales.less')} onClick={() => bump(n, -1)}><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-7 text-center text-sm font-semibold tabular-nums">{l.qty}</span>
                    <button type="button" className="grid h-8 w-8 place-items-center text-ink-muted hover:text-ink disabled:opacity-40" disabled={l.qty >= l.have} aria-label={t('inventory.sales.more')} onClick={() => bump(n, 1)}><Plus className="h-3.5 w-3.5" /></button>
                  </span>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatINR(l.qty * l.rate)}</span>
                  <button type="button" className="text-ink-faint hover:text-danger-500" aria-label={t('inventory.lines.remove')} onClick={() => setCart((c) => c.filter((_, i) => i !== n))}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-baseline justify-between"><span className="text-sm text-ink-muted">{t('inventory.sales.total')}</span><span className="text-2xl font-bold tabular-nums">{formatINR(total)}</span></div>
          <div className="grid grid-cols-3 gap-2">
            {STORE_SALE_MODES.map((m) => {
              const Icon = MODE_ICON[m]
              return (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={clsx('flex flex-col items-center gap-1 rounded-lg border py-2 text-xs font-semibold', mode === m ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:bg-black/[0.03]')}>
                  <Icon className="h-4 w-4" aria-hidden />{L.mode(m)}
                </button>
              )
            })}
          </div>
          {mode !== 'CASH' && <FormField label={t('inventory.sales.reference')} hint={t('inventory.sales.referenceHint')}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></FormField>}
          <Button className="w-full" icon={Receipt} loading={sell.isPending} disabled={!student || !cart.length || !hasPermission('inventory.sales.create')} onClick={() => sell.mutate()}>
            {t('inventory.sales.takePayment', { amount: formatINR(total) })}
          </Button>
        </div>
      </Panel>
    </div>
  )
}

/** Store › Uniform & book sales: the counter (pick the student, tap sizes, take the money, print) and the day's sales. */
export default function Sales() {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { showSuccess, showError } = useSnackbar()
  const [branchId, setBranchId] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [last, setLast] = useState(null)
  const params = { branchId: branchId || undefined, date: date || undefined, search: q || undefined, status: 'ALL', pageSize: 200 }
  const { data, isLoading } = useQuery({ queryKey: ['inventory', 'sales', params], queryFn: () => fetchSales(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['inventory'] })
  const cancel = useMutation({ mutationFn: ({ id, reason }) => cancelSale(id, reason), onSuccess: () => { refresh(); showSuccess(t('inventory.sales.cancelled')) }, onError: (e) => showError(e.message) })
  const day = data?.day
  const modeSegments = useMemo(() => STORE_SALE_MODES.map((m) => ({ label: L.mode(m), value: day?.modes?.[m]?.amount ?? 0 })), [day, L])
  return (
    <PageContainer>
      <PageHeader icon={Store} title={t('inventory.sales.pageTitle')} subtitle={t('inventory.sales.pageSubtitle')}
        actions={<>
          <CampusSelect value={branchId} onChange={setBranchId} all={false} />
          <Button variant="secondary" icon={Download} onClick={() => exportSales(params).catch((e) => showError(e.message))}>{t('inventory.export')}</Button>
        </>} />
      {last && (
        <Note tone="success" actions={<Button size="sm" variant="secondary" icon={Printer} onClick={() => printDocument('STORE_SALE_RECEIPT', last.id)}>{t('inventory.sales.printReceipt')}</Button>}>
          {t('inventory.sales.sold', { no: last.saleNo, amount: formatINR(last.total), name: last.student?.name })}
        </Note>
      )}
      {hasPermission('inventory.sales.create') && <Counter branchId={branchId} onSold={(s) => { setLast(s); refresh() }} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {day && <StatCardRow items={[
            { icon: Receipt, tone: 'brand', label: date ? t('inventory.sales.dayTotal') : t('inventory.sales.todayTotal'), value: <Money value={day.amount} paise />, sub: t('inventory.sales.receiptsN', { n: day.count }), segments: modeSegments.filter((s) => s.value) },
            ...STORE_SALE_MODES.map((m) => ({ icon: MODE_ICON[m], label: L.mode(m), value: <Money value={day.modes[m]?.amount ?? 0} paise />, sub: t('inventory.sales.receiptsN', { n: day.modes[m]?.count ?? 0 }) })),
          ]} />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('inventory.sales.search')} /></div>
            <FormField className="w-44"><DateInput value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('inventory.sales.date')} /></FormField>
            {day?.cancelled > 0 && <span className="text-xs text-ink-faint">{t('inventory.sales.cancelledN', { n: day.cancelled })}</span>}
          </div>
          <DataTable rows={data?.data ?? []} loading={isLoading} rowTone={(r) => (r.status === 'CANCELLED' ? 'danger' : undefined)} columns={[
            { key: 'saleNo', header: t('inventory.sales.receipt'), mobilePrimary: true, render: (v, r) => <span><CodeBadge>{v}</CodeBadge><span className="block mt-0.5 text-xs text-ink-faint"><DateCell value={r.at} time /></span></span> },
            { key: 'student', header: t('inventory.sales.student'), render: (v) => <PersonCell name={v?.name} sub={[v?.class, v?.admissionNo].filter(Boolean).join(' · ')} /> },
            { key: 'lines', header: t('inventory.sales.items'), mobileHidden: true, render: (v) => <span className="text-xs text-ink-muted">{v.map((l) => `${l.qty} × ${l.name}${l.size ? ` (${l.size})` : ''}`).join(', ')}</span> },
            { key: 'mode', header: t('inventory.sales.mode'), mobileHidden: true, render: (v) => { const Icon = MODE_ICON[v] ?? Banknote; return <span className="inline-flex items-center gap-1.5 text-sm"><Icon className="h-4 w-4 text-ink-faint" aria-hidden />{L.mode(v)}</span> } },
            { key: 'total', header: t('inventory.sales.amount'), align: 'right', render: (v, r) => <span className="inline-flex flex-col items-end"><Money value={v} paise />{r.status === 'CANCELLED' && <SalePill status={r.status} />}</span> },
            { key: 'id', header: '', align: 'right', width: 90, render: (id, r) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" icon={Printer} aria-label={t('actions.print')} title={t('actions.print')} onClick={() => printDocument('STORE_SALE_RECEIPT', id)} />
                {r.status === 'PAID' && hasPermission('inventory.sales.cancel') && <Button size="sm" variant="ghost" icon={Ban} aria-label={t('inventory.sales.cancel')} title={t('inventory.sales.cancel')}
                  onClick={async () => { const reason = await prompt({ title: t('inventory.sales.cancelTitle', { no: r.saleNo }), label: t('inventory.po.reason'), required: true }); if (reason) cancel.mutate({ id, reason }) }} />}
              </div>
            ) },
          ]} emptyTitle={t('inventory.sales.empty')} />
        </div>
        <RankBars title={t('inventory.sales.topItems')} rows={(data?.topItems ?? []).map((i) => ({ key: i.name, label: i.name, value: i.amount }))} valueFormat={(v) => formatINR(v)} empty={t('inventory.sales.noneYet')} />
      </div>
    </PageContainer>
  )
}
