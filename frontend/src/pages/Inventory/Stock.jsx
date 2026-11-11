import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, ClipboardList, Download, History, PackageX, Scale, ShoppingBag, TriangleAlert, Warehouse,
} from 'lucide-react'
import { STORE_ADJUST_REASONS, STORE_CATEGORIES, STORE_ISSUE_TO, STORE_MOVE_TYPES } from '@schoolgiant/shared'
import {
  DateInput, CodeBadge, ColorChip, DataTable, DateCell, Drawer, EmptyState, FormField, HeaderButton, ImportExportButtons, Input, LevelBar, Modal, Money, Note, PageContainer, PageHeader,
  SearchInput, SegmentedControl, Select, SideNav, SideNavLayout, Skeleton, StatCardRow, TONE, Tabs, Textarea, hueTone, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import {
  adjustStock, cancelCount, exportStock, fetchCount, fetchCounts, fetchMoves, fetchStock, importOpeningStock, issueStock, postCount, returnStock, saveCount, startCount,
} from '../../api/inventory'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { readSheet } from '../../utils/readSheet'
import { useSnackbar } from '../../context/SnackbarContext'
import { CATEGORY_ICON, CampusSelect, CountPill, ItemLines, LevelPill, MovePill, useInventoryLabels, useInventoryMeta, useItemOptions } from '../../components/inventory/InventoryKit'

const canMove = () => hasPermission('inventory.items.edit')

/** Issue to (or take back from) a department, a staff member, a classroom or anyone else: several items on one slip. */
function SlipForm({ kind, branchId, onClose, onDone }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const [campus, setCampus] = useState(branchId || meta?.myBranchId || '')
  const { data: items = [] } = useItemOptions({ branchId: campus })
  const [form, setForm] = useState({ toKind: 'DEPARTMENT', toId: '', toName: '', note: '', date: '' })
  const [lines, setLines] = useState([{ itemId: '', size: '', qty: 1 }])
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const options = form.toKind === 'DEPARTMENT' ? meta?.departments ?? [] : form.toKind === 'STAFF' ? meta?.staff ?? [] : form.toKind === 'CLASSROOM' ? (meta?.rooms ?? []).filter((r) => !campus || !r.branchId || r.branchId === campus) : []
  const save = useMutation({
    mutationFn: () => (kind === 'ISSUE' ? issueStock : returnStock)({
      branchId: campus || undefined, date: form.date || undefined, note: form.note,
      to: { kind: form.toKind, id: form.toId || undefined, name: form.toName || undefined },
      lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, size: l.size, qty: Number(l.qty) })),
    }),
    onSuccess: onDone,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const ready = lines.some((l) => l.itemId && Number(l.qty) > 0) && (form.toKind === 'OTHER' ? form.toName.trim() : form.toId)
  return (
    <Modal open onClose={onClose} size="lg" title={kind === 'ISSUE' ? t('inventory.slip.issueTitle') : t('inventory.slip.returnTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!ready} icon={kind === 'ISSUE' ? ArrowUpFromLine : ArrowDownToLine} onClick={() => save.mutate()}>{kind === 'ISSUE' ? t('inventory.slip.issue') : t('inventory.slip.takeBack')}</Button>
    </>}>
      <div className="space-y-4">
        {(meta?.branches ?? []).length > 1 && !meta?.branchLocked && (
          <FormField label={t('inventory.campus')}><Select value={campus} onChange={(e) => setCampus(e.target.value)}>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-muted">{kind === 'ISSUE' ? t('inventory.slip.to') : t('inventory.slip.from')}</p>
          <SegmentedControl value={form.toKind} onChange={(v) => setForm((f) => ({ ...f, toKind: v, toId: '', toName: '' }))} options={STORE_ISSUE_TO.map((k) => ({ value: k, label: L.issueTo(k) }))} />
        </div>
        {form.toKind === 'OTHER'
          ? <FormField label={t('inventory.slip.name')} required error={errors['to.name']}><Input value={form.toName} onChange={set('toName')} placeholder={t('inventory.slip.namePlaceholder')} /></FormField>
          : <FormField label={L.issueTo(form.toKind)} required error={errors['to.id']}>
            <Select value={form.toId} onChange={set('toId')}><option value="">{t('inventory.slip.pick')}</option>{options.map((o) => <option key={o.id} value={o.id}>{[o.name, o.designation ?? o.code].filter(Boolean).join(' · ')}</option>)}</Select>
          </FormField>}
        <ItemLines lines={lines} onChange={setLines} items={items} showStock={kind === 'ISSUE'} errors={errors} />
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <FormField label={t('inventory.slip.date')} error={errors.date}><DateInput value={form.date} onChange={set('date')} /></FormField>
          <FormField label={t('inventory.slip.note')}><Input value={form.note} onChange={set('note')} /></FormField>
        </div>
      </div>
    </Modal>
  )
}

function AdjustForm({ row, branchId, onClose, onDone }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const [form, setForm] = useState({ size: row.sizes[0]?.size ?? '', direction: '-', qty: 1, reason: 'DAMAGED', note: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const have = row.sizes.length ? row.sizes.find((s) => s.size === form.size)?.qty ?? 0 : row.qty
  const delta = (form.direction === '-' ? -1 : 1) * (Number(form.qty) || 0)
  const save = useMutation({
    mutationFn: () => adjustStock({ branchId: branchId || meta?.myBranchId || undefined, itemId: row.id, size: form.size, qty: delta, reason: form.reason, note: form.note }),
    onSuccess: onDone,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('inventory.adjust.title', { name: row.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!delta || have + delta < 0} onClick={() => save.mutate()}>{t('inventory.adjust.save')}</Button>
    </>}>
      <div className="space-y-3">
        {row.sizes.length > 0 && <FormField label={t('inventory.lines.size')}><Select value={form.size} onChange={set('size')}>{row.sizes.map((s) => <option key={s.size} value={s.size}>{`${s.size} · ${s.qty}`}</option>)}</Select></FormField>}
        <div className="grid grid-cols-[auto_1fr] items-end gap-3">
          <SegmentedControl value={form.direction} onChange={(v) => setForm((f) => ({ ...f, direction: v }))} options={[{ value: '-', label: t('inventory.adjust.less') }, { value: '+', label: t('inventory.adjust.more') }]} />
          <FormField label={t('inventory.lines.qty')}><Input type="number" min="1" value={form.qty} onChange={set('qty')} /></FormField>
        </div>
        <FormField label={t('inventory.adjust.reason')}><Select value={form.reason} onChange={set('reason')}>{STORE_ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{L.reason(r.value)}</option>)}</Select></FormField>
        <FormField label={t('inventory.slip.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField>
        <Note tone={have + delta < 0 ? 'danger' : 'info'}>{t('inventory.adjust.preview', { from: have, to: have + delta })}</Note>
      </div>
    </Modal>
  )
}

/** One item as a tile: icon, how many, a bar against the reorder level, and each size's count. */
function StockTile({ row, onAdjust, onLedger }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const Icon = CATEGORY_ICON[row.category] ?? Boxes
  const tone = TONE[hueTone(`store-${row.category}`)]
  const max = Math.max(row.reorderLevel * 2, row.qty, 1)
  const border = row.level === 'OUT' ? 'border-rose-200' : row.level === 'LOW' ? 'border-amber-200' : 'border-border'
  return (
    <div className={clsx('flex flex-col gap-2.5 rounded-xl border bg-surface p-3', border)}>
      <div className="flex items-start gap-2.5">
        <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tone.bg)}><Icon className={clsx('h-4 w-4', tone.text)} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
          <span className="block truncate text-[11px] text-ink-faint font-mono">{row.code}{row.location ? ` · ${row.location}` : ''}</span>
        </span>
        <LevelPill level={row.level} />
      </div>
      <LevelBar value={row.qty} max={max} warnAt={row.reorderLevel || undefined} dangerAt={0} unit={L.unit(row.unit)} width="w-full" />
      {row.sizes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.sizes.map((s) => (
            <span key={s.size} className={clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums', s.qty <= 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-border text-ink-muted')}>
              <span className="font-semibold">{s.size}</span><span>{s.qty}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-ink-faint">
        <span>{t('inventory.stock.reorderAt', { n: row.reorderLevel })}{row.expiry ? ` · ${t('inventory.items.expiry')} ` : ''}{row.expiry && <DateCell value={row.expiry} relative={false} />}</span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" icon={History} aria-label={t('inventory.stock.ledger')} title={t('inventory.stock.ledger')} onClick={() => onLedger(row)} />
          {canMove() && <Button size="sm" variant="ghost" icon={Scale} aria-label={t('inventory.adjust.button')} title={t('inventory.adjust.button')} onClick={() => onAdjust(row)} />}
        </span>
      </div>
    </div>
  )
}

function Ledger({ branchId, item }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const params = { branchId: branchId || undefined, itemId: item?.id, type: type || undefined, search: q || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['inventory', 'moves', params], queryFn: () => fetchMoves(params) })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!item && <div className="w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('inventory.ledger.search')} /></div>}
        <div className="w-44"><Select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} aria-label={t('inventory.ledger.type')}><option value="">{t('inventory.ledger.allTypes')}</option>{Object.keys(STORE_MOVE_TYPES).map((k) => <option key={k} value={k}>{L.move(k)}</option>)}</Select></div>
      </div>
      <DataTable rows={data?.data ?? []} loading={isLoading} columns={[
        { key: 'at', header: t('inventory.ledger.when'), render: (v, m) => <span className="text-xs"><DateCell value={m.date} relative={false} /></span> },
        { key: 'itemName', header: t('inventory.ledger.item'), mobilePrimary: true, render: (v, m) => <span className="font-medium">{v}{m.size ? <CodeBadge className="ms-1.5">{m.size}</CodeBadge> : null}</span> },
        { key: 'type', header: t('inventory.ledger.type'), render: (v) => <MovePill type={v} /> },
        { key: 'qty', header: t('inventory.ledger.qty'), align: 'right', render: (v) => <span className={clsx('font-semibold tabular-nums', v > 0 ? 'text-emerald-700' : 'text-rose-700')}>{v > 0 ? `+${v}` : v}</span> },
        { key: 'balance', header: t('inventory.ledger.balance'), align: 'right', mobileHidden: true },
        { key: 'value', header: t('inventory.ledger.value'), align: 'right', mobileHidden: true, render: (v) => <Money value={v} paise muted /> },
        { key: 'party', header: t('inventory.ledger.party'), mobileHidden: true, render: (v, m) => (v ? <ColorChip label={v.name} sub={L.issueTo(v.kind)} seed={v.kind} dot /> : m.refNo ? <CodeBadge>{m.refNo}</CodeBadge> : m.reason ? L.reason(m.reason) : '—') },
        { key: 'by', header: t('inventory.ledger.by'), mobileHidden: true, render: (v, m) => <span className="text-xs text-ink-muted">{v}{m.note ? <span className="block text-ink-faint">{m.note}</span> : null}</span> },
      ]} emptyTitle={t('inventory.ledger.empty')}
        pagination={data && data.total > 50 ? { page: page - 1, size: 50, totalElements: data.total, totalPages: Math.ceil(data.total / 50), onPageChange: (p) => setPage(p + 1) } : undefined} />
    </div>
  )
}

function CountSheet({ id, onClose, onChanged }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: c } = useQuery({ queryKey: ['inventory', 'count', id], queryFn: () => fetchCount(id) })
  const [counted, setCounted] = useState({})
  const [filter, setFilter] = useState('')
  useEffect(() => {
    if (c) setCounted(Object.fromEntries(c.lines.map((l) => [`${l.itemId}:${l.size}`, l.countedQty ?? ''])))
  }, [c])
  const open = c?.status === 'OPEN'
  const lines = useMemo(() => (c?.lines ?? []).filter((l) => !filter || l.name.toLowerCase().includes(filter.toLowerCase())), [c, filter])
  const payload = () => c.lines.map((l) => ({ itemId: l.itemId, size: l.size, countedQty: counted[`${l.itemId}:${l.size}`] === '' || counted[`${l.itemId}:${l.size}`] == null ? null : Number(counted[`${l.itemId}:${l.size}`]) }))
  const save = useMutation({ mutationFn: () => saveCount(id, payload()), onSuccess: () => { onChanged(); showSuccess(t('inventory.counts.saved')) }, onError: (e) => showError(e.message) })
  const post = useMutation({
    mutationFn: async () => { await saveCount(id, payload()); return postCount(id) },
    onSuccess: (r) => { onChanged(); showSuccess(t('inventory.counts.posted', { n: r.posted?.adjusted ?? 0 })); onClose() },
    onError: (e) => showError(e.message),
  })
  const cancel = useMutation({ mutationFn: () => cancelCount(id), onSuccess: () => { onChanged(); onClose() }, onError: (e) => showError(e.message) })
  if (!c) return <Drawer open onClose={onClose} title={t('inventory.loading')}><Skeleton className="h-40" /></Drawer>
  const done = c.lines.filter((l) => counted[`${l.itemId}:${l.size}`] !== '' && counted[`${l.itemId}:${l.size}`] != null).length
  const diffs = c.lines.filter((l) => { const v = counted[`${l.itemId}:${l.size}`]; return v !== '' && v != null && Number(v) !== l.currentQty }).length
  return (
    <Drawer open onClose={onClose} size="xl" title={t('inventory.counts.sheetTitle', { date: c.date })} subtitle={c.category ? L.cat(c.category) : t('inventory.counts.everything')}
      footer={open && <div className="flex flex-wrap gap-2">
        <Button loading={post.isPending} icon={ClipboardCheck} disabled={!done} onClick={async () => { if (await confirm({ title: t('inventory.counts.postConfirm'), message: t('inventory.counts.postHint', { n: diffs }), confirmLabel: t('inventory.counts.post') })) post.mutate() }}>{t('inventory.counts.post')}</Button>
        <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>{t('inventory.counts.save')}</Button>
        <Button variant="ghost" onClick={async () => { if (await confirm({ title: t('inventory.counts.cancelConfirm'), tone: 'danger', confirmLabel: t('inventory.counts.cancel') })) cancel.mutate() }}>{t('inventory.counts.cancel')}</Button>
      </div>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CountPill status={c.status} />
          <span className="text-sm text-ink-muted">{t('inventory.counts.progress', { done, total: c.lines.length, diffs })}</span>
        </div>
        <LevelBar value={done} max={c.lines.length} bare width="w-full" />
        <div className="w-64"><SearchInput value={filter} onChange={setFilter} placeholder={t('inventory.counts.filter')} /></div>
        <DataTable rows={lines} rowKey={(l) => `${l.itemId}:${l.size}`} dense rowTone={(l) => { const v = counted[`${l.itemId}:${l.size}`]; return v === '' || v == null ? undefined : Number(v) === l.currentQty ? 'success' : 'warning' }} columns={[
          { key: 'name', header: t('inventory.ledger.item'), mobilePrimary: true, render: (v, l) => <span className="font-medium">{v}{l.size ? <CodeBadge className="ms-1.5">{l.size}</CodeBadge> : null}</span> },
          { key: 'currentQty', header: t('inventory.counts.books'), align: 'right', render: (v, l) => <span className="tabular-nums">{v}{v !== l.systemQty && <span className="block text-[11px] text-ink-faint">{t('inventory.counts.wasAtStart', { n: l.systemQty })}</span>}</span> },
          { key: 'countedQty', header: t('inventory.counts.counted'), align: 'right', width: 130, render: (_, l) => (open
            ? <Input type="number" min="0" className="w-24 h-8 text-right" value={counted[`${l.itemId}:${l.size}`] ?? ''} onChange={(e) => setCounted((m) => ({ ...m, [`${l.itemId}:${l.size}`]: e.target.value }))} />
            : <span className="tabular-nums">{l.countedQty ?? '—'}</span>) },
          { key: 'diff', header: t('inventory.counts.difference'), align: 'right', render: (_, l) => {
            const v = counted[`${l.itemId}:${l.size}`]
            if (v === '' || v == null) return <span className="text-ink-faint">—</span>
            const d = Number(v) - l.currentQty
            return <span className={clsx('font-semibold tabular-nums', d > 0 ? 'text-emerald-700' : d < 0 ? 'text-rose-700' : 'text-ink-faint')}>{d > 0 ? `+${d}` : d}</span>
          } },
        ]} />
      </div>
    </Drawer>
  )
}

function Counts({ branchId }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const [open, setOpen] = useState(null)
  const [category, setCategory] = useState('')
  const { data = [], isLoading } = useQuery({ queryKey: ['inventory', 'counts', branchId], queryFn: () => fetchCounts({ branchId: branchId || undefined }) })
  const start = useMutation({
    mutationFn: () => startCount({ branchId: branchId || meta?.myBranchId || undefined, category }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['inventory', 'counts'] }); setOpen(c.id) },
    onError: (e) => showError(e.message),
  })
  return (
    <div className="space-y-3">
      {canMove() && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
          <FormField label={t('inventory.counts.what')} className="w-56"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('inventory.counts.everything')}</option>{STORE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{L.cat(c.value)}</option>)}</Select></FormField>
          <Button icon={ClipboardList} loading={start.isPending} onClick={() => start.mutate()}>{t('inventory.counts.start')}</Button>
          <p className="basis-full text-xs text-ink-faint">{t('inventory.counts.hint')}</p>
        </div>
      )}
      <DataTable rows={data} loading={isLoading} onRowClick={(r) => setOpen(r.id)} columns={[
        { key: 'date', header: t('inventory.ledger.date'), mobilePrimary: true, render: (v) => <DateCell value={v} relative={false} /> },
        { key: 'category', header: t('inventory.items.category'), render: (v) => (v ? <ColorChip label={L.cat(v)} seed={`store-${v}`} dot /> : t('inventory.counts.everything')) },
        { key: 'countedCount', header: t('inventory.counts.counted'), render: (v, r) => <LevelBar value={v} max={r.lineCount} width="w-32" /> },
        { key: 'status', header: t('inventory.counts.status'), render: (v) => <CountPill status={v} /> },
        { key: 'posted', header: t('inventory.counts.adjusted'), align: 'right', mobileHidden: true, render: (v) => (v?.adjusted != null ? <span>{v.adjusted} · <Money value={v.value} paise signed /></span> : '—') },
        { key: 'created', header: t('inventory.ledger.by'), mobileHidden: true, render: (v) => v?.by ?? '—' },
      ]} emptyTitle={t('inventory.counts.empty')} />
      {open && <CountSheet id={open} onClose={() => setOpen(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['inventory'] })} />}
    </div>
  )
}

/** Store › Stock: what each campus store holds — by category, against reorder levels; the ledger; physical counts. */
export default function Stock() {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const [tab, setTab] = useState('board')
  const [branchId, setBranchId] = useState('')
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [slip, setSlip] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [ledgerOf, setLedgerOf] = useState(null)
  const params = { branchId: branchId || undefined, category: category || undefined, level: level || undefined, search: q || undefined }
  const { data, isLoading } = useQuery({ queryKey: ['inventory', 'stock', params], queryFn: () => fetchStock(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['inventory'] })
  const cats = data?.categories ?? {}
  const tot = data?.totals
  return (
    <PageContainer>
      <PageHeader icon={Warehouse} title={t('inventory.stock.pageTitle')} subtitle={t('inventory.stock.pageSubtitle')}
        actions={<>
          <CampusSelect value={branchId} onChange={setBranchId} />
          {hasPermission('inventory.stock.import') && <ImportExportButtons resourceLabel={t('inventory.stock.openingResource')} requires="inventory.stock.import"
            onImport={async (file) => importOpeningStock(await readSheet(file), true, branchId || meta?.myBranchId || undefined)} onCommit={(r) => importOpeningStock(r, false, branchId || meta?.myBranchId || undefined)}
            templateHeaders={['code', 'size', 'qty', 'rate']} templateSample={['UNI-SHIRT', '32', '40', '320']} onDone={refresh} />}
          {hasPermission('inventory.stock.export') && <HeaderButton icon={Download} onClick={() => exportStock(params).catch((e) => showError(e.message))}>{t('inventory.export')}</HeaderButton>}
          {canMove() && <HeaderButton icon={ArrowDownToLine} onClick={() => setSlip('RETURN')}>{t('inventory.slip.return')}</HeaderButton>}
          {canMove() && <HeaderButton icon={ArrowUpFromLine} variant="primary" onClick={() => setSlip('ISSUE')}>{t('inventory.slip.issue')}</HeaderButton>}
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'board', label: t('inventory.stock.tabBoard') }, { value: 'ledger', label: t('inventory.stock.tabLedger') }, { value: 'counts', label: t('inventory.stock.tabCounts') },
      ]} />
      {tab === 'board' && (
        <SideNavLayout nav={<SideNav title={t('inventory.items.categories')} value={category} onChange={(v) => setCategory(v ?? '')} items={[
          { id: '', label: t('inventory.items.allCategories'), icon: Boxes, count: tot?.items ?? 0 },
          ...STORE_CATEGORIES.map((c) => ({
            id: c.value, label: L.cat(c.value), icon: CATEGORY_ICON[c.value], count: cats[c.value]?.items ?? 0,
            countTone: cats[c.value]?.out ? 'danger' : cats[c.value]?.low ? 'warning' : undefined,
            hint: cats[c.value]?.low || cats[c.value]?.out ? t('inventory.stock.navHint', { low: cats[c.value]?.low ?? 0, out: cats[c.value]?.out ?? 0 }) : undefined,
          })),
        ]} />}>
          {tot && <StatCardRow items={[
            { icon: Boxes, tone: 'brand', label: t('inventory.stock.value'), value: <Money value={tot.value} paise compact />, sub: t('inventory.stock.itemsSub', { n: tot.items }) },
            { icon: TriangleAlert, tone: tot.low ? 'warning' : 'neutral', label: t('inventory.stock.low'), value: tot.low, onClick: () => setLevel('LOW') },
            { icon: PackageX, tone: tot.out ? 'danger' : 'neutral', label: t('inventory.stock.out'), value: tot.out, onClick: () => setLevel('OUT') },
            { icon: ShoppingBag, tone: 'violet', label: t('inventory.stock.openPos'), value: tot.openPos, sub: t('inventory.stock.movesToday', { n: tot.movesToday }) },
          ]} />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('inventory.items.search')} /></div>
            <SegmentedControl value={level} onChange={setLevel} options={[
              { value: '', label: t('inventory.stock.levelAll') }, { value: 'REORDER', label: t('inventory.stock.levelReorder') }, { value: 'OUT', label: t('inventory.levels.OUT') },
            ]} />
          </div>
          {isLoading ? <Skeleton className="h-48" /> : (data?.rows ?? []).length === 0 ? (
            <EmptyState icon={Boxes} title={t('inventory.stock.empty')} hint={t('inventory.stock.emptyHint')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.rows.map((r) => <StockTile key={r.id} row={r} onAdjust={setAdjusting} onLedger={setLedgerOf} />)}
            </div>
          )}
        </SideNavLayout>
      )}
      {tab === 'ledger' && <Ledger branchId={branchId} />}
      {tab === 'counts' && <Counts branchId={branchId} />}
      {slip && <SlipForm kind={slip} branchId={branchId} onClose={() => setSlip(null)} onDone={(moves) => { setSlip(null); refresh(); showSuccess(slip === 'ISSUE' ? t('inventory.slip.issued', { n: moves.length }) : t('inventory.slip.returned', { n: moves.length })) }} />}
      {adjusting && <AdjustForm row={adjusting} branchId={branchId} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); refresh(); showSuccess(t('inventory.adjust.done')) }} />}
      {ledgerOf && (
        <Drawer open onClose={() => setLedgerOf(null)} size="xl" title={ledgerOf.name} subtitle={t('inventory.stock.ledger')}>
          <Ledger branchId={branchId} item={ledgerOf} />
        </Drawer>
      )}
    </PageContainer>
  )
}
