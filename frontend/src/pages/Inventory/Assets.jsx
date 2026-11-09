import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Archive, DoorOpen, IndianRupee, LayoutGrid, List, Package, Pencil, Plus, ShieldCheck, Trash2, Wrench, Printer } from 'lucide-react'
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_DISPOSAL_METHODS, ASSET_MAINTENANCE_KINDS, ASSET_STATUS, formatINR } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, DataTable, DateCell, Drawer, EmptyState, Fact, FactGrid, FormField, HeaderButton, Input, LevelBar, Modal, Money, Note, PageContainer, PageHeader, Panel,
  PersonCell, SearchInput, SegmentedControl, Select, SideNav, SideNavLayout, Skeleton, StatCardRow, TONE, Textarea, Timeline, hueTone, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { addMaintenance, deleteAsset, disposeAsset, fetchAsset, fetchAssets, removeMaintenance, saveAsset } from '../../api/inventory'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { ASSET_ICON, AssetPill, CampusSelect, ConditionPill, paiseOf, rupeesOf, useInventoryLabels, useInventoryMeta } from '../../components/inventory/InventoryKit'
import { printDocuments } from '../../components/print/printDocument'

const STATUS_DOT = { IN_USE: 'bg-emerald-500', IN_STORE: 'bg-blue-500', UNDER_REPAIR: 'bg-amber-500', DISPOSED: 'bg-slate-400' }

function AssetForm({ asset, onClose, onSaved }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const [form, setForm] = useState({
    assetTag: asset?.assetTag ?? '', name: asset?.name ?? '', category: asset?.category ?? 'FURNITURE', make: asset?.make ?? '', model: asset?.model ?? '', serialNo: asset?.serialNo ?? '',
    branchId: asset?.branchId ?? '', roomId: asset?.roomId ?? '', location: asset?.location ?? '', assignedToId: asset?.assignedTo?.userId ?? '',
    vendorId: asset?.vendorId ?? '', purchaseDate: asset?.purchase?.date ?? '', cost: rupeesOf(asset?.purchase?.cost), invoiceNo: asset?.purchase?.invoiceNo ?? '',
    warrantyEnd: asset?.warrantyEnd ?? '', lifeYears: asset?.depreciation?.lifeYears ?? '', salvagePct: asset?.depreciation?.salvagePct ?? '',
    condition: asset?.condition ?? 'GOOD', status: asset?.status ?? 'IN_USE', note: asset?.note ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const life = ASSET_CATEGORIES.find((c) => c.value === form.category)?.lifeYears
  const save = useMutation({
    mutationFn: () => saveAsset(asset?.id, {
      ...form, cost: paiseOf(form.cost), lifeYears: form.lifeYears === '' ? null : Number(form.lifeYears), salvagePct: form.salvagePct === '' ? null : Number(form.salvagePct),
      branchId: form.branchId || undefined, assetTag: form.assetTag || undefined,
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const rooms = (meta?.rooms ?? []).filter((r) => !form.branchId || !r.branchId || r.branchId === form.branchId)
  return (
    <Modal open onClose={onClose} size="lg" title={asset ? t('inventory.assets.editTitle', { tag: asset.assetTag }) : t('inventory.assets.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <FormField label={t('inventory.assets.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('inventory.assets.namePlaceholder')} /></FormField>
          <FormField label={t('inventory.assets.tag')} error={errors.assetTag} hint={asset ? undefined : t('inventory.assets.tagHint')}><Input value={form.assetTag} onChange={set('assetTag')} className="font-mono uppercase" /></FormField>
        </div>
        <div className="flex flex-wrap gap-2">
          {ASSET_CATEGORIES.map((c) => {
            const Icon = ASSET_ICON[c.value]
            const on = form.category === c.value
            return (
              <button key={c.value} type="button" onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:bg-black/[0.03]')}>
                <Icon className="h-4 w-4" aria-hidden />{L.assetCat(c.value)}
              </button>
            )
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('inventory.assets.make')}><Input value={form.make} onChange={set('make')} /></FormField>
          <FormField label={t('inventory.assets.model')}><Input value={form.model} onChange={set('model')} /></FormField>
          <FormField label={t('inventory.assets.serialNo')}><Input value={form.serialNo} onChange={set('serialNo')} /></FormField>
        </div>
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
          {(meta?.branches ?? []).length > 1 && !meta?.branchLocked && (
            <FormField label={t('inventory.campus')}><Select value={form.branchId} onChange={set('branchId')}><option value="">{t('inventory.myCampus')}</option>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
          )}
          <FormField label={t('inventory.assets.room')} error={errors.roomId}><Select value={form.roomId} onChange={set('roomId')}><option value="">{t('inventory.assets.noRoom')}</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.code ? `${r.name} · ${r.code}` : r.name}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.location')}><Input value={form.location} onChange={set('location')} placeholder={t('inventory.assets.locationPlaceholder')} /></FormField>
          <FormField label={t('inventory.assets.assignedTo')} error={errors.assignedToId}><Select value={form.assignedToId} onChange={set('assignedToId')}><option value="">{t('inventory.assets.nobody')}</option>{(meta?.staff ?? []).map((u) => <option key={u.id} value={u.id}>{u.designation ? `${u.name} · ${u.designation}` : u.name}</option>)}</Select></FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label={t('inventory.assets.purchaseDate')}><Input type="date" value={form.purchaseDate} onChange={set('purchaseDate')} /></FormField>
          <FormField label={t('inventory.assets.cost')}><Input type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} /></FormField>
          <FormField label={t('inventory.assets.vendor')}><Select value={form.vendorId} onChange={set('vendorId')}><option value="">—</option>{(meta?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.invoiceNo')}><Input value={form.invoiceNo} onChange={set('invoiceNo')} /></FormField>
          <FormField label={t('inventory.assets.warrantyEnd')}><Input type="date" value={form.warrantyEnd} onChange={set('warrantyEnd')} /></FormField>
          <FormField label={t('inventory.assets.lifeYears')} hint={t('inventory.assets.lifeHint', { n: life })}><Input type="number" min="1" max="60" value={form.lifeYears} onChange={set('lifeYears')} placeholder={String(life ?? '')} /></FormField>
          <FormField label={t('inventory.assets.salvagePct')}><Input type="number" min="0" max="100" value={form.salvagePct} onChange={set('salvagePct')} placeholder="0" /></FormField>
          <FormField label={t('inventory.assets.condition')}><Select value={form.condition} onChange={set('condition')}>{Object.keys(ASSET_CONDITIONS).map((c) => <option key={c} value={c}>{L.cond(c)}</option>)}</Select></FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <FormField label={t('inventory.assets.status')}><Select value={form.status} onChange={set('status')}>{Object.keys(ASSET_STATUS).filter((s) => s !== 'DISPOSED').map((s) => <option key={s} value={s}>{L.assetStatus(s)}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.note')}><Input value={form.note} onChange={set('note')} /></FormField>
        </div>
      </div>
    </Modal>
  )
}

function MaintenanceForm({ asset, onClose, onDone }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ kind: 'REPAIR', description: '', cost: '', vendor: '', date: '', nextDue: '', status: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => addMaintenance(asset.id, { ...form, cost: paiseOf(form.cost), date: form.date || undefined, nextDue: form.nextDue || undefined, status: form.status || undefined }),
    onSuccess: onDone,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('inventory.assets.maintTitle', { tag: asset.assetTag })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.description.trim().length < 2} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-3">
        <SegmentedControl value={form.kind} onChange={(v) => setForm((f) => ({ ...f, kind: v }))} options={ASSET_MAINTENANCE_KINDS.map((k) => ({ value: k, label: L.maint(k) }))} />
        <FormField label={t('inventory.assets.whatDone')} required><Textarea rows={2} value={form.description} onChange={set('description')} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('inventory.assets.date')}><Input type="date" value={form.date} onChange={set('date')} /></FormField>
          <FormField label={t('inventory.assets.maintCost')}><Input type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} /></FormField>
          <FormField label={t('inventory.assets.byVendor')}><Input value={form.vendor} onChange={set('vendor')} /></FormField>
          <FormField label={t('inventory.assets.nextDue')}><Input type="date" value={form.nextDue} onChange={set('nextDue')} /></FormField>
        </div>
        <FormField label={t('inventory.assets.setStatus')}>
          <Select value={form.status} onChange={set('status')}><option value="">{t('inventory.assets.keepStatus', { status: L.assetStatus(asset.status) })}</option>{['IN_USE', 'UNDER_REPAIR', 'IN_STORE'].map((s) => <option key={s} value={s}>{L.assetStatus(s)}</option>)}</Select>
        </FormField>
      </div>
    </Modal>
  )
}

function DisposeForm({ asset, onClose, onDone }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ method: 'SCRAPPED', amount: '', reason: '', date: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => disposeAsset(asset.id, { ...form, amount: paiseOf(form.amount), date: form.date || undefined }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('inventory.assets.disposeTitle', { tag: asset.assetTag })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button variant="danger" loading={save.isPending} disabled={form.reason.trim().length < 3} onClick={() => save.mutate()}>{t('inventory.assets.dispose')}</Button>
    </>}>
      <div className="space-y-3">
        <Note tone="warning">{t('inventory.assets.disposeHint', { value: formatINR(asset.bookValue) })}</Note>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('inventory.assets.method')}><Select value={form.method} onChange={set('method')}>{ASSET_DISPOSAL_METHODS.map((m) => <option key={m} value={m}>{L.disposal(m)}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.date')}><Input type="date" value={form.date} onChange={set('date')} /></FormField>
          {form.method === 'SOLD' && <FormField label={t('inventory.assets.soldFor')}><Input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} /></FormField>}
        </div>
        <FormField label={t('inventory.po.reason')} required><Textarea rows={2} value={form.reason} onChange={set('reason')} /></FormField>
      </div>
    </Modal>
  )
}

function AssetDrawer({ id, onClose, onEdit }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [maint, setMaint] = useState(false)
  const [disposing, setDisposing] = useState(false)
  const { data: a } = useQuery({ queryKey: ['inventory', 'asset', id], queryFn: () => fetchAsset(id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['inventory'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); showSuccess(v.done); if (v.close) onClose() }, onError: (e) => showError(e.message) })
  if (!a) return <Drawer open onClose={onClose} title={t('inventory.loading')}><Skeleton className="h-40" /></Drawer>
  const Icon = ASSET_ICON[a.category] ?? Package
  const canEdit = hasPermission('inventory.assets.edit') && a.status !== 'DISPOSED'
  const cost = a.purchase?.cost ?? 0
  return (
    <Drawer open onClose={onClose} size="lg" title={a.name} subtitle={[a.assetTag, L.assetCat(a.category)].join(' · ')}
      footer={<div className="flex flex-wrap gap-2">
        {canEdit && <Button icon={Pencil} variant="secondary" onClick={() => onEdit(a)}>{t('inventory.edit')}</Button>}
        {canEdit && <Button icon={Wrench} variant="secondary" onClick={() => setMaint(true)}>{t('inventory.assets.logMaint')}</Button>}
        {canEdit && <Button icon={Archive} variant="ghost" onClick={() => setDisposing(true)}>{t('inventory.assets.dispose')}</Button>}
        {hasPermission('inventory.assets.delete') && a.status !== 'DISPOSED' && !a.maintenance.length && <Button icon={Trash2} variant="ghost"
          onClick={async () => { if (await confirm({ title: t('inventory.assets.deleteConfirm', { tag: a.assetTag }), tone: 'danger', confirmLabel: t('inventory.delete') })) act.mutate({ fn: () => deleteAsset(a.id), done: t('inventory.assets.deleted'), close: true }) }}>{t('inventory.delete')}</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ColorChip label={L.assetCat(a.category)} seed={`asset-${a.category}`} icon={Icon} />
          <AssetPill status={a.status} /><ConditionPill condition={a.condition} />
          {a.warranty && <ColorChip label={L.warranty(a.warranty)} tone={a.warranty === 'ON' ? 'success' : a.warranty === 'SOON' ? 'warning' : 'neutral'} icon={ShieldCheck} />}
        </div>
        {cost > 0 && (
          <Panel title={t('inventory.assets.bookValue')}>
            <div className="flex items-baseline justify-between gap-3"><Money value={a.bookValue} paise className="text-2xl font-bold" /><span className="text-sm text-ink-muted">{t('inventory.assets.ofCost', { cost: formatINR(cost) })}</span></div>
            <LevelBar value={a.bookValue} max={cost} bare width="w-full" className="mt-2" />
            <p className="mt-1.5 text-xs text-ink-faint">{t('inventory.assets.depNote', { life: a.lifeYears, pct: a.pctWritten, salvage: a.depreciation?.salvagePct ?? 0 })}</p>
          </Panel>
        )}
        <FactGrid>
          <Fact label={t('inventory.assets.room')}>{a.roomName ?? '—'}</Fact>
          <Fact label={t('inventory.assets.location')}>{a.location ?? '—'}</Fact>
          <Fact label={t('inventory.assets.assignedTo')}>{a.assignedTo ? <PersonCell name={a.assignedTo.name} size={24} /> : '—'}</Fact>
          <Fact label={t('inventory.assets.makeModel')}>{[a.make, a.model].filter(Boolean).join(' ') || '—'}</Fact>
          <Fact label={t('inventory.assets.serialNo')} mono>{a.serialNo ?? '—'}</Fact>
          <Fact label={t('inventory.assets.purchaseDate')}>{a.purchase?.date ? <DateCell value={a.purchase.date} relative={false} /> : '—'}</Fact>
          <Fact label={t('inventory.assets.vendor')}>{a.vendorName ?? '—'}</Fact>
          <Fact label={t('inventory.assets.warrantyEnd')}>{a.warrantyEnd ? <DateCell value={a.warrantyEnd} /> : '—'}</Fact>
        </FactGrid>
        {a.status === 'DISPOSED' && a.disposal && <Note tone="warning">{t('inventory.assets.disposedNote', { method: L.disposal(a.disposal.method), date: a.disposal.date, reason: a.disposal.reason })}</Note>}
        <Panel title={t('inventory.assets.maintenance')} subtitle={a.maintenanceCost ? t('inventory.assets.spent', { amount: formatINR(a.maintenanceCost) }) : undefined}>
          {a.maintenance.length === 0 ? <p className="text-sm text-ink-faint">{t('inventory.assets.noMaint')}</p> : (
            <Timeline items={a.maintenance.map((m) => ({
              id: m.id, icon: Wrench, tone: m.kind === 'REPAIR' ? 'warning' : 'info', title: `${L.maint(m.kind)} · ${m.description}`,
              time: m.date, meta: [m.cost ? formatINR(m.cost) : null, m.vendor, m.by, m.nextDue && t('inventory.assets.nextDueOn', { date: m.nextDue }), m.at && dateTime(m.at)].filter(Boolean).join(' · '),
              actions: canEdit && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('inventory.delete')} onClick={async () => { if (await confirm({ title: t('inventory.assets.removeMaint'), tone: 'danger' })) act.mutate({ fn: () => removeMaintenance(a.id, m.id), done: t('inventory.assets.saved') }) }} />,
            }))} />
          )}
        </Panel>
        {a.note && <Note>{a.note}</Note>}
      </div>
      {maint && <MaintenanceForm asset={a} onClose={() => setMaint(false)} onDone={() => { setMaint(false); refresh(); showSuccess(t('inventory.assets.maintSaved')) }} />}
      {disposing && <DisposeForm asset={a} onClose={() => setDisposing(false)} onDone={() => { setDisposing(false); refresh(); showSuccess(t('inventory.assets.disposed')) }} />}
    </Drawer>
  )
}

/** One asset as a chip on the board: its icon in its category colour, the tag, a status dot. */
function AssetChip({ a, onOpen }) {
  const Icon = ASSET_ICON[a.category] ?? Package
  const tone = TONE[hueTone(`asset-${a.category}`)]
  return (
    <button type="button" onClick={() => onOpen(a.id)} title={`${a.name} · ${a.assetTag}`}
      className={clsx('relative flex w-[92px] flex-col items-center gap-1 rounded-lg border bg-surface px-1.5 py-2 text-center transition-colors hover:border-brand-300', a.status === 'UNDER_REPAIR' ? 'border-amber-300' : 'border-border')}>
      <span className={clsx('absolute right-1.5 top-1.5 h-2 w-2 rounded-full', STATUS_DOT[a.status])} aria-hidden />
      <span className={clsx('grid h-8 w-8 place-items-center rounded-lg', tone.bg)}><Icon className={clsx('h-4 w-4', tone.text)} aria-hidden /></span>
      <span className="w-full truncate text-[11px] font-medium text-ink">{a.name}</span>
      <span className="w-full truncate font-mono text-[10px] text-ink-faint">{a.assetTag}</span>
    </button>
  )
}

/** Store › Asset register: every asset by place (a room board) or as a list, with book value, upkeep and disposal. */
export default function Assets() {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [branchId, setBranchId] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [view, setView] = useState('board')
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') ?? '') // a scanned tag opens here
  const q = useDebouncedValue(search.trim(), 300)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const params = { branchId: branchId || undefined, category: category || undefined, status, search: q || undefined }
  const { data, isLoading } = useQuery({ queryKey: ['inventory', 'assets', params], queryFn: () => fetchAssets(params) })
  const rows = data?.data ?? []
  const sum = data?.summary
  const places = []
  const byPlace = new Map()
  for (const a of rows) {
    const k = a.roomId ?? `loc:${a.location ?? ''}`
    if (!byPlace.has(k)) { byPlace.set(k, []); places.push({ key: k, name: a.roomName ?? a.location ?? null, room: !!a.roomId }) }
    byPlace.get(k).push(a)
  }
  places.sort((x, y) => (x.name == null) - (y.name == null) || String(x.name).localeCompare(String(y.name)))
  return (
    <PageContainer>
      <PageHeader icon={Package} title={t('inventory.assets.pageTitle')} subtitle={t('inventory.assets.pageSubtitle')}
        actions={<>
          <CampusSelect value={branchId} onChange={setBranchId} />
          {rows.length > 0 && <HeaderButton icon={Printer} onClick={() => printDocuments('ASSET_LABEL', rows.slice(0, 300).map((a) => a.id))}>{t('inventory.assets.printLabels', { count: Math.min(rows.length, 300) })}</HeaderButton>}
          <HeaderButton icon={Plus} variant="primary" requires="inventory.assets.create" onClick={() => setEditing('new')}>{t('inventory.assets.new')}</HeaderButton>
        </>} />
      <SideNavLayout nav={<SideNav title={t('inventory.assets.categories')} value={category} onChange={(v) => setCategory(v ?? '')} items={[
        { id: '', label: t('inventory.assets.allCategories'), icon: Package, count: sum?.count ?? 0 },
        ...ASSET_CATEGORIES.map((c) => ({ id: c.value, label: L.assetCat(c.value), icon: ASSET_ICON[c.value], count: sum?.byCategory?.[c.value]?.count ?? 0, hint: sum?.byCategory?.[c.value]?.bookValue ? formatINR(sum.byCategory[c.value].bookValue) : undefined })),
      ]} />}>
        {sum && <StatCardRow items={[
          { icon: Package, tone: 'brand', label: t('inventory.assets.countN'), value: sum.count, sub: sum.disposed ? t('inventory.assets.disposedN', { n: sum.disposed }) : undefined },
          { icon: IndianRupee, tone: 'violet', label: t('inventory.assets.bookValue'), value: <Money value={sum.bookValue} paise compact />, progress: sum.cost ? (sum.bookValue / sum.cost) * 100 : undefined, sub: t('inventory.assets.costWas', { cost: formatINR(sum.cost) }) },
          { icon: Wrench, tone: sum.repair ? 'warning' : 'neutral', label: t('inventory.assets.underRepair'), value: sum.repair, sub: sum.serviceDue ? t('inventory.assets.serviceDue', { n: sum.serviceDue }) : undefined, onClick: () => setStatus('UNDER_REPAIR') },
          { icon: ShieldCheck, tone: sum.warrantySoon ? 'warning' : 'neutral', label: t('inventory.assets.warrantySoon'), value: sum.warrantySoon },
        ]} />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('inventory.assets.search')} /></div>
          <div className="w-44"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('inventory.assets.status')}>
            <option value="ACTIVE">{t('inventory.assets.notDisposed')}</option>
            {Object.keys(ASSET_STATUS).map((s) => <option key={s} value={s}>{L.assetStatus(s)}</option>)}
            <option value="ALL">{t('inventory.assets.everything')}</option>
          </Select></div>
          <SegmentedControl className="ms-auto" value={view} onChange={setView} options={[{ value: 'board', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" />{t('inventory.assets.board')}</span> }, { value: 'list', label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" />{t('inventory.assets.list')}</span> }]} />
        </div>
        {isLoading ? <Skeleton className="h-48" /> : rows.length === 0 ? (
          <EmptyState icon={Package} title={t('inventory.assets.empty')} hint={t('inventory.assets.emptyHint')} />
        ) : view === 'board' ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {places.map((p) => {
              const list = byPlace.get(p.key)
              const repair = list.filter((a) => a.status === 'UNDER_REPAIR').length
              return (
                <Panel key={p.key} icon={DoorOpen} title={p.name ?? t('inventory.assets.noPlace')} subtitle={[t('inventory.assets.itemsN', { n: list.length }), formatINR(list.reduce((s, a) => s + a.bookValue, 0)), repair ? t('inventory.assets.repairN', { n: repair }) : null].filter(Boolean).join(' · ')}>
                  <div className="flex flex-wrap gap-2">{list.map((a) => <AssetChip key={a.id} a={a} onOpen={setOpen} />)}</div>
                </Panel>
              )
            })}
          </div>
        ) : (
          <DataTable rows={rows} onRowClick={(r) => setOpen(r.id)} rowTone={(r) => (r.status === 'UNDER_REPAIR' ? 'warning' : undefined)} columns={[
            { key: 'assetTag', header: t('inventory.assets.tag'), mobilePrimary: true, render: (v, r) => { const Icon = ASSET_ICON[r.category] ?? Package; return <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-ink-faint" aria-hidden /><span><span className="block font-medium">{r.name}</span><CodeBadge>{v}</CodeBadge></span></span> } },
            { key: 'category', header: t('inventory.assets.category'), mobileHidden: true, render: (v) => <ColorChip label={L.assetCat(v)} seed={`asset-${v}`} dot /> },
            { key: 'roomName', header: t('inventory.assets.place'), mobileHidden: true, render: (v, r) => v ?? r.location ?? '—' },
            { key: 'assignedTo', header: t('inventory.assets.assignedTo'), mobileHidden: true, render: (v) => (v ? <PersonCell name={v.name} size={24} /> : '—') },
            { key: 'status', header: t('inventory.assets.status'), render: (v) => <AssetPill status={v} /> },
            { key: 'bookValue', header: t('inventory.assets.bookValue'), align: 'right', render: (v, r) => (r.purchase?.cost ? <span className="inline-flex flex-col items-end gap-1"><Money value={v} paise /><LevelBar value={v} max={r.purchase.cost} bare width="w-20" /></span> : '—') },
          ]} />
        )}
      </SideNavLayout>
      {open && <AssetDrawer id={open} onClose={() => setOpen(null)} onEdit={(a) => { setOpen(null); setEditing(a) }} />}
      {editing && <AssetForm asset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(a) => { setEditing(null); qc.invalidateQueries({ queryKey: ['inventory'] }); showSuccess(t('inventory.assets.saved')); setOpen(a.id) }} />}
    </PageContainer>
  )
}
