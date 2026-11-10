import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Boxes, Download, PackageX, Pencil, Plus, Tag, Trash2, TriangleAlert, X } from 'lucide-react'
import { STORE_CATEGORIES, STORE_CATEGORY_BY, STORE_UNITS } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, DataTable, DateCell, Drawer, FormField, HeaderButton, ImportExportButtons, Input, LevelBar, Modal, Money, Note, PageContainer, PageHeader, Panel,
  SearchInput, SegmentedControl, Select, SideNav, SideNavLayout, StatCardRow, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteItem, exportItems, fetchItem, fetchItems, importItems, saveItem } from '../../api/inventory'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { readSheet } from '../../utils/readSheet'
import { useSnackbar } from '../../context/SnackbarContext'
import { CATEGORY_ICON, CampusSelect, LevelPill, MovePill, paiseOf, rupeesOf, useInventoryLabels } from '../../components/inventory/InventoryKit'

const PAGE = 100
const GST_RATES = [0, 5, 12, 18, 28]

function ItemForm({ item, category, onClose, onSaved }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    code: item?.code ?? '', name: item?.name ?? '', category: item?.category ?? category ?? 'STATIONERY', unit: item?.unit ?? 'PCS',
    rate: rupeesOf(item?.rate), sellable: item?.sellable ?? !!STORE_CATEGORY_BY[item?.category ?? category ?? 'STATIONERY']?.sellable,
    salePrice: rupeesOf(item?.salePrice), sizes: (item?.sizes ?? []).map((s) => ({ size: s.size, salePrice: rupeesOf(s.salePrice) })),
    reorderLevel: item?.reorderLevel ?? 0, location: item?.location ?? '', hasExpiry: item?.hasExpiry ?? false, description: item?.description ?? '', active: item?.active ?? true,
    hsn: item?.hsn ?? '', gstRate: item?.gstRate ?? '',
  })
  const [newSize, setNewSize] = useState('')
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const addSizes = () => {
    const more = newSize.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => s && !form.sizes.some((x) => x.size === s))
    if (more.length) setForm((f) => ({ ...f, sizes: [...f.sizes, ...more.map((size) => ({ size, salePrice: '' }))] }))
    setNewSize('')
  }
  const save = useMutation({
    mutationFn: () => saveItem(item?.id, {
      code: form.code, name: form.name, category: form.category, unit: form.unit, rate: paiseOf(form.rate) ?? 0, sellable: form.sellable,
      salePrice: paiseOf(form.salePrice), sizes: form.sizes.map((s) => ({ size: s.size, salePrice: paiseOf(s.salePrice) })),
      reorderLevel: Number(form.reorderLevel) || 0, location: form.location, hasExpiry: form.hasExpiry, description: form.description, active: form.active,
      hsn: form.hsn.trim(), gstRate: form.gstRate === '' ? null : Number(form.gstRate),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={item ? t('inventory.items.editTitle') : t('inventory.items.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.code.trim() || !form.name.trim()} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <FormField label={t('inventory.items.code')} required error={errors.code}><Input value={form.code} onChange={set('code')} placeholder="NB-200" className="font-mono uppercase" /></FormField>
          <FormField label={t('inventory.items.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-muted">{t('inventory.items.category')}</p>
          <div className="flex flex-wrap gap-2">
            {STORE_CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICON[c.value]
              const on = form.category === c.value
              return (
                <button key={c.value} type="button" onClick={() => setForm((f) => ({ ...f, category: c.value, ...(!item && { sellable: c.sellable }) }))}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:bg-black/[0.03]'}`}>
                  <Icon className="h-4 w-4" aria-hidden />{L.cat(c.value)}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label={t('inventory.items.unit')}><Select value={form.unit} onChange={set('unit')}>{STORE_UNITS.map((u) => <option key={u} value={u}>{L.unit(u)}</option>)}</Select></FormField>
          <FormField label={t('inventory.items.rate')} hint={t('inventory.items.rateHint')}><Input type="number" min="0" step="0.01" value={form.rate} onChange={set('rate')} /></FormField>
          <FormField label={t('inventory.items.reorderLevel')} hint={t('inventory.items.reorderHint')}><Input type="number" min="0" value={form.reorderLevel} onChange={set('reorderLevel')} /></FormField>
          <FormField label={t('inventory.items.location')}><Input value={form.location} onChange={set('location')} placeholder={t('inventory.items.locationPlaceholder')} /></FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-[12rem_10rem_1fr] sm:items-start">
          <FormField label={t('inventory.items.hsn')} error={errors.hsn}><Input value={form.hsn} onChange={set('hsn')} maxLength={12} className="font-mono" /></FormField>
          <FormField label={t('inventory.items.gstRate')} error={errors.gstRate}>
            <Select value={String(form.gstRate)} onChange={set('gstRate')}>
              <option value="">{t('inventory.items.gstNotSet')}</option>
              {GST_RATES.map((r) => <option key={r} value={String(r)}>{r === 0 ? t('inventory.items.gstNil') : t('inventory.items.gstPct', { rate: r })}</option>)}
            </Select>
          </FormField>
          <p className="text-xs text-ink-faint sm:pt-7">{t('inventory.items.gstHint')}</p>
        </div>
        <div className="space-y-3 rounded-xl border border-border p-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.sellable} onChange={set('sellable')} className="rounded border-border text-brand-500" />{t('inventory.items.sellable')}</label>
          {form.sellable && <FormField label={t('inventory.items.salePrice')} error={errors.salePrice} className="sm:w-48"><Input type="number" min="0" step="0.01" value={form.salePrice} onChange={set('salePrice')} /></FormField>}
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">{t('inventory.items.sizes')}</p>
            <div className="flex flex-wrap gap-2">
              {form.sizes.map((s, n) => (
                <span key={s.size} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1">
                  <CodeBadge>{s.size}</CodeBadge>
                  {form.sellable && <Input type="number" min="0" step="0.01" value={s.salePrice} placeholder={t('inventory.items.sizePrice')} className="w-24 h-8"
                    onChange={(e) => setForm((f) => ({ ...f, sizes: f.sizes.map((x, i) => (i === n ? { ...x, salePrice: e.target.value } : x)) }))} />}
                  <button type="button" aria-label={t('inventory.items.removeSize')} className="text-ink-faint hover:text-danger-500" onClick={() => setForm((f) => ({ ...f, sizes: f.sizes.filter((_, i) => i !== n) }))}><X className="h-3.5 w-3.5" /></button>
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <Input value={newSize} onChange={(e) => setNewSize(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSizes() } }} placeholder={t('inventory.items.sizePlaceholder')} className="w-36" />
                <Button size="sm" variant="secondary" icon={Plus} onClick={addSizes} disabled={!newSize.trim()}>{t('inventory.items.addSize')}</Button>
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">{errors.sizes ?? t('inventory.items.sizesHint')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.hasExpiry} onChange={set('hasExpiry')} className="rounded border-border text-brand-500" />{t('inventory.items.hasExpiry')}</label>
          {item && <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.active} onChange={set('active')} className="rounded border-border text-brand-500" />{t('inventory.items.active')}</label>}
        </div>
        <FormField label={t('inventory.items.description')}><Textarea rows={2} value={form.description} onChange={set('description')} /></FormField>
      </div>
    </Modal>
  )
}

function ItemDrawer({ id, branchId, onClose, onEdit }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { data: x } = useQuery({ queryKey: ['inventory', 'item', id, branchId], queryFn: () => fetchItem(id, { branchId: branchId || undefined }) })
  if (!x) return <Drawer open onClose={onClose} title={t('inventory.loading')}><span /></Drawer>
  const Icon = CATEGORY_ICON[x.category] ?? Boxes
  const maxQty = Math.max(x.reorderLevel * 2, ...x.stockRows.map((r) => r.qty), 1)
  return (
    <Drawer open onClose={onClose} size="lg" title={x.name} subtitle={[x.code, L.cat(x.category), x.location].filter(Boolean).join(' · ')}
      footer={hasPermission('inventory.items.edit') && <Button icon={Pencil} variant="secondary" onClick={() => onEdit(x)}>{t('inventory.edit')}</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ColorChip label={L.cat(x.category)} seed={`store-${x.category}`} icon={Icon} />
          <LevelPill level={x.stock <= 0 ? 'OUT' : x.reorderLevel && x.stock <= x.reorderLevel ? 'LOW' : 'OK'} />
          {x.sellable && <ColorChip label={t('inventory.items.forSale')} tone="brand" icon={Tag} />}
        </div>
        <StatCardRow items={[
          { label: t('inventory.items.inStock'), value: `${x.stock} ${L.unit(x.unit)}`, tone: 'brand' },
          { label: t('inventory.items.rate'), value: <Money value={x.rate} paise />, tone: 'violet' },
          ...(x.sellable ? [{ label: t('inventory.items.salePrice'), value: x.salePrice != null ? <Money value={x.salePrice} paise /> : '—', tone: 'teal' }] : []),
        ]} />
        <Panel title={t('inventory.items.stockWhere')}>
          {x.stockRows.length === 0 ? <p className="text-sm text-ink-faint">{t('inventory.items.noStock')}</p> : (
            <div className="space-y-2.5">
              {x.stockRows.map((r) => (
                <div key={`${r.branchId}:${r.size}`} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm">{r.size ? <CodeBadge>{r.size}</CodeBadge> : null} <span className="text-ink-muted">{r.branch}</span>{r.expiry && <span className="ms-2 text-xs text-ink-faint">{t('inventory.items.expiry')}: <DateCell value={r.expiry} relative={false} /></span>}</span>
                  <LevelBar value={r.qty} max={maxQty} warnAt={x.reorderLevel || undefined} dangerAt={0} width="w-40" />
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t('inventory.items.recent')} flush>
          <DataTable rows={x.moves} dense columns={[
            { key: 'date', header: t('inventory.ledger.date'), render: (v) => <DateCell value={v} relative={false} /> },
            { key: 'type', header: t('inventory.ledger.type'), mobilePrimary: true, render: (v) => <MovePill type={v} /> },
            { key: 'qty', header: t('inventory.ledger.qty'), align: 'right', render: (v, m) => <span className={`font-semibold tabular-nums ${v > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{v > 0 ? `+${v}` : v}{m.size ? <span className="ms-1 text-xs font-normal text-ink-faint">{m.size}</span> : null}</span> },
            { key: 'balance', header: t('inventory.ledger.balance'), align: 'right', mobileHidden: true },
            { key: 'party', header: t('inventory.ledger.party'), mobileHidden: true, render: (v, m) => v?.name ?? m.refNo ?? (m.reason ? L.reason(m.reason) : '—') },
          ]} emptyTitle={t('inventory.ledger.empty')} />
        </Panel>
      </div>
    </Drawer>
  )
}

/** Store › Items: the item master — categories down the side, stock against the reorder level, import and export. */
export default function Items() {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [active, setActive] = useState('ACTIVE')
  const [branchId, setBranchId] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const params = { search: q || undefined, category: category || undefined, active, branchId: branchId || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['inventory', 'items', params], queryFn: () => fetchItems(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['inventory'] })
  const remove = useMutation({
    mutationFn: deleteItem,
    onSuccess: (r) => { refresh(); showSuccess(r.deleted ? t('inventory.items.deleted') : t('inventory.items.deactivated')) },
    onError: (e) => showError(e.message),
  })
  const counts = data?.categories ?? {}
  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  const rows = data?.data ?? []
  const low = rows.filter((r) => r.level === 'LOW').length
  const out = rows.filter((r) => r.level === 'OUT').length
  const value = rows.reduce((s, r) => s + (r.value ?? 0), 0)
  return (
    <PageContainer>
      <PageHeader icon={Boxes} title={t('inventory.items.pageTitle')} subtitle={t('inventory.items.pageSubtitle')}
        actions={<>
          <CampusSelect value={branchId} onChange={(v) => { setBranchId(v); setPage(1) }} />
          {hasPermission('inventory.items.import') && <ImportExportButtons resourceLabel={t('inventory.items.resource')} requires="inventory.items.import"
            onImport={async (file) => importItems(await readSheet(file), true)} onCommit={(r) => importItems(r, false)}
            templateHeaders={['code', 'name', 'category', 'unit', 'rate', 'salePrice', 'sellable', 'sizes', 'reorderLevel', 'location']}
            templateSample={['UNI-SHIRT', 'School shirt (white)', 'UNIFORM', 'PCS', '320', '450', 'yes', '26, 28, 30, 32, 34', '20', 'Rack U1']}
            onDone={refresh} />}
          {hasPermission('inventory.items.export') && <HeaderButton icon={Download} onClick={() => exportItems({ branchId: branchId || undefined }).catch((e) => showError(e.message))}>{t('inventory.export')}</HeaderButton>}
          <HeaderButton icon={Plus} variant="primary" requires="inventory.items.create" onClick={() => setEditing('new')}>{t('inventory.items.new')}</HeaderButton>
        </>} />
      <SideNavLayout nav={<SideNav title={t('inventory.items.categories')} value={category} onChange={(v) => { setCategory(v ?? ''); setPage(1) }} items={[
        { id: '', label: t('inventory.items.allCategories'), icon: Boxes, count: total },
        ...STORE_CATEGORIES.map((c) => ({ id: c.value, label: L.cat(c.value), icon: CATEGORY_ICON[c.value], count: counts[c.value] ?? 0 })),
      ]} />}>
        <StatCardRow items={[
          { icon: Boxes, tone: 'brand', label: t('inventory.items.itemsN'), value: data?.total ?? 0 },
          { icon: TriangleAlert, tone: low ? 'warning' : 'neutral', label: t('inventory.items.lowN'), value: low },
          { icon: PackageX, tone: out ? 'danger' : 'neutral', label: t('inventory.items.outN'), value: out },
          { icon: Tag, tone: 'violet', label: t('inventory.items.valueN'), value: <Money value={value} paise compact /> },
        ]} />
        {data && total === 0 && <Note>{t('inventory.items.emptyHint')}</Note>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('inventory.items.search')} /></div>
          <SegmentedControl value={active} onChange={(v) => { setActive(v); setPage(1) }} options={[
            { value: 'ACTIVE', label: t('inventory.items.activeOnly') }, { value: 'INACTIVE', label: t('inventory.items.inactive') }, { value: 'ALL', label: t('inventory.items.all') },
          ]} />
        </div>
        <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} onRowClick={(r) => setOpen(r.id)} columns={[
          { key: 'name', header: t('inventory.items.name'), mobilePrimary: true, render: (v, r) => {
            const Icon = CATEGORY_ICON[r.category] ?? Boxes
            return <span className="flex items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black/[0.04]"><Icon className="h-4 w-4 text-ink-muted" aria-hidden /></span><span className="min-w-0"><span className="block font-medium">{v}</span><span className="block text-xs text-ink-faint font-mono">{r.code}</span></span></span>
          } },
          { key: 'category', header: t('inventory.items.category'), mobileHidden: true, render: (v) => <ColorChip label={L.cat(v)} seed={`store-${v}`} dot /> },
          { key: 'sizes', header: t('inventory.items.sizes'), mobileHidden: true, render: (v) => (v.length ? <span className="flex flex-wrap gap-1">{v.slice(0, 6).map((s) => <CodeBadge key={s.size}>{s.size}</CodeBadge>)}{v.length > 6 && <span className="text-xs text-ink-faint">+{v.length - 6}</span>}</span> : '—') },
          { key: 'rate', header: t('inventory.items.rate'), align: 'right', mobileHidden: true, render: (v) => <Money value={v} paise /> },
          { key: 'salePrice', header: t('inventory.items.salePrice'), align: 'right', mobileHidden: true, render: (v, r) => (r.sellable && v != null ? <Money value={v} paise /> : '—') },
          { key: 'stock', header: t('inventory.items.stockVsReorder'), align: 'right', render: (v, r) => <LevelBar value={v} max={Math.max(r.reorderLevel * 2, v, 1)} warnAt={r.reorderLevel || undefined} dangerAt={0} unit={L.unit(r.unit)} width="w-32" /> },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1">
              {hasPermission('inventory.items.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('inventory.edit')} onClick={(e) => { e.stopPropagation(); setEditing(r) }} />}
              {hasPermission('inventory.items.delete') && r.active && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('inventory.delete')}
                onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('inventory.items.deleteConfirm', { name: r.name }), message: t('inventory.items.deleteHint'), confirmLabel: t('inventory.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
            </div>
          ) },
        ]} emptyTitle={t('inventory.items.empty')}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      </SideNavLayout>
      {open && <ItemDrawer id={open} branchId={branchId} onClose={() => setOpen(null)} onEdit={(x) => { setOpen(null); setEditing(x) }} />}
      {editing && <ItemForm item={editing === 'new' ? null : editing} category={category || undefined} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); showSuccess(t('inventory.items.saved')) }} />}
    </PageContainer>
  )
}
