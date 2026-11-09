import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, CheckCircle2, ClipboardList, Download, PackageCheck, Pencil, Plus, Printer, Send, ShoppingBag, Truck, Undo2, Users } from 'lucide-react'
import { PO_STATUS, STORE_CATEGORIES, formatINR } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, DataTable, DateCell, Drawer, Fact, FactGrid, FormField, HeaderButton, Input, LevelBar, Modal, Money, Note, PageContainer, PageHeader, Panel,
  PersonCell, SearchInput, Select, SideNav, SideNavLayout, Tabs, Textarea, Timeline, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { approvePo, cancelPo, exportPos, fetchPo, fetchPos, fetchVendors, receivePo, savePo, saveVendor, sendBackPo, submitPo } from '../../api/inventory'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CampusSelect, ItemLines, PoPill, paiseOf, rupeesOf, useInventoryLabels, useInventoryMeta, useItemOptions } from '../../components/inventory/InventoryKit'

const STATUS_ORDER = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CANCELLED']

function VendorForm({ vendor, onClose, onSaved }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    name: vendor?.name ?? '', contactPerson: vendor?.contactPerson ?? '', phone: vendor?.phone ?? '', email: vendor?.email ?? '', gstin: vendor?.gstin ?? '',
    address: vendor?.address ?? '', categories: vendor?.categories ?? [], note: vendor?.note ?? '', active: vendor?.active ?? true,
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({ mutationFn: () => saveVendor(vendor?.id, form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  const toggle = (c) => setForm((f) => ({ ...f, categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c] }))
  return (
    <Modal open onClose={onClose} title={vendor ? t('inventory.vendors.editTitle') : t('inventory.vendors.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('inventory.vendors.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('inventory.vendors.contactPerson')}><Input value={form.contactPerson} onChange={set('contactPerson')} /></FormField>
          <FormField label={t('inventory.vendors.phone')}><Input value={form.phone} onChange={set('phone')} inputMode="tel" /></FormField>
          <FormField label={t('inventory.vendors.email')} error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
          <FormField label={t('inventory.vendors.gstin')}><Input value={form.gstin} onChange={set('gstin')} className="uppercase" /></FormField>
        </div>
        <FormField label={t('inventory.vendors.address')}><Textarea rows={2} value={form.address} onChange={set('address')} /></FormField>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-muted">{t('inventory.vendors.supplies')}</p>
          <div className="flex flex-wrap gap-2">
            {STORE_CATEGORIES.map((c) => (
              <label key={c.value} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                <input type="checkbox" checked={form.categories.includes(c.value)} onChange={() => toggle(c.value)} className="rounded border-border text-brand-500" />{L.cat(c.value)}
              </label>
            ))}
          </div>
        </div>
        {vendor && <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.active} onChange={set('active')} className="rounded border-border text-brand-500" />{t('inventory.vendors.active')}</label>}
      </div>
    </Modal>
  )
}

function Vendors() {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [editing, setEditing] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['inventory', 'vendors', q], queryFn: () => fetchVendors({ search: q || undefined, active: 'ALL' }) })
  const top = Math.max(1, ...data.map((v) => v.ordered))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-72"><SearchInput value={search} onChange={setSearch} placeholder={t('inventory.vendors.search')} /></div>
        {hasPermission('inventory.purchase-orders.create') && <Button icon={Plus} onClick={() => setEditing('new')}>{t('inventory.vendors.new')}</Button>}
      </div>
      <DataTable rows={data} loading={isLoading} onRowClick={hasPermission('inventory.purchase-orders.edit') ? (v) => setEditing(v) : undefined} columns={[
        { key: 'name', header: t('inventory.vendors.name'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.contactPerson, r.phone].filter(Boolean).join(' · ') || undefined} /> },
        { key: 'categories', header: t('inventory.vendors.supplies'), mobileHidden: true, render: (v) => <span className="flex flex-wrap gap-1">{v.map((c) => <ColorChip key={c} label={L.cat(c)} seed={`store-${c}`} dot />)}</span> },
        { key: 'gstin', header: t('inventory.vendors.gstin'), mobileHidden: true, render: (v) => (v ? <CodeBadge>{v}</CodeBadge> : '—') },
        { key: 'orders', header: t('inventory.vendors.orders'), align: 'right' },
        { key: 'ordered', header: t('inventory.vendors.ordered'), align: 'right', render: (v) => <span className="inline-flex flex-col items-end gap-1"><Money value={v} paise /><LevelBar value={v} max={top} bare width="w-24" /></span> },
        { key: 'lastOrderOn', header: t('inventory.vendors.lastOrder'), mobileHidden: true, render: (v) => (v ? <DateCell value={v} /> : '—') },
        { key: 'active', header: '', render: (v) => (!v ? <ColorChip label={t('inventory.vendors.inactive')} tone="neutral" /> : null) },
      ]} emptyTitle={t('inventory.vendors.empty')} />
      {editing && <VendorForm vendor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['inventory'] }); showSuccess(t('inventory.vendors.saved')) }} />}
    </div>
  )
}

function PoForm({ po, onClose, onSaved }) {
  const { t } = useTranslation('inventory')
  const { showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const { data: items = [] } = useItemOptions()
  const [form, setForm] = useState({
    vendorId: po?.vendorId ?? '', branchId: po?.branchId ?? meta?.myBranchId ?? '', date: po?.date ?? '', expectedOn: po?.expectedOn ?? '',
    tax: rupeesOf(po?.tax || null), terms: po?.terms ?? '', note: po?.note ?? '',
  })
  const [lines, setLines] = useState(po?.lines?.length ? po.lines.map((l) => ({ itemId: l.itemId, size: l.size ?? '', qty: l.qty, rate: rupeesOf(l.rate) })) : [{ itemId: '', size: '', qty: 1, rate: '' }])
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (paiseOf(l.rate) ?? 0), 0)
  const total = subtotal + (paiseOf(form.tax) ?? 0)
  const save = useMutation({
    mutationFn: () => savePo(po?.id, {
      vendorId: form.vendorId, branchId: form.branchId || undefined, date: form.date || undefined, expectedOn: form.expectedOn || undefined, tax: paiseOf(form.tax) ?? 0, terms: form.terms, note: form.note,
      lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, size: l.size, qty: Number(l.qty), ...(l.rate !== '' && { rate: paiseOf(l.rate) }) })),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="xl" title={po ? t('inventory.po.editTitle', { no: po.poNo }) : t('inventory.po.newTitle')} footer={<>
      <span className="me-auto text-sm text-ink-muted">{t('inventory.po.totalIs')} <b className="text-ink">{formatINR(total)}</b></span>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.vendorId || !lines.some((l) => l.itemId)} onClick={() => save.mutate()}>{t('inventory.po.saveDraft')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label={t('inventory.po.vendor')} required error={errors.vendorId} className="sm:col-span-2">
            <Select value={form.vendorId} onChange={set('vendorId')}><option value="">{t('inventory.po.pickVendor')}</option>{(meta?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
          </FormField>
          <FormField label={t('inventory.po.date')}><Input type="date" value={form.date} onChange={set('date')} /></FormField>
          <FormField label={t('inventory.po.expectedOn')}><Input type="date" value={form.expectedOn} onChange={set('expectedOn')} /></FormField>
          {(meta?.branches ?? []).length > 1 && !meta?.branchLocked && (
            <FormField label={t('inventory.po.deliverTo')} className="sm:col-span-2"><Select value={form.branchId} onChange={set('branchId')}>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
          )}
        </div>
        {(meta?.vendors ?? []).length === 0 && <Note tone="warning">{t('inventory.po.noVendors')}</Note>}
        <ItemLines lines={lines} onChange={setLines} items={items} withRate errors={errors} />
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <FormField label={t('inventory.po.tax')} hint={t('inventory.po.taxHint')}><Input type="number" min="0" step="0.01" value={form.tax} onChange={set('tax')} /></FormField>
          <FormField label={t('inventory.po.terms')}><Textarea rows={2} value={form.terms} onChange={set('terms')} placeholder={t('inventory.po.termsPlaceholder')} /></FormField>
        </div>
        <FormField label={t('inventory.po.note')}><Input value={form.note} onChange={set('note')} /></FormField>
      </div>
    </Modal>
  )
}

function ReceiveForm({ po, onClose, onDone }) {
  const { t } = useTranslation('inventory')
  const { showError } = useSnackbar()
  const { data: items = [] } = useItemOptions()
  const expiryOf = new Map(items.map((i) => [i.id, i.hasExpiry]))
  const open = po.lines.filter((l) => l.pending > 0)
  const [qty, setQty] = useState(Object.fromEntries(open.map((l) => [l.id, l.pending])))
  const [expiry, setExpiry] = useState({})
  const [form, setForm] = useState({ invoiceNo: '', date: '', note: '' })
  const save = useMutation({
    mutationFn: () => receivePo(po.id, { ...form, date: form.date || undefined, lines: open.map((l) => ({ lineId: l.id, qty: Number(qty[l.id]) || 0, expiry: expiry[l.id] || undefined })) }),
    onSuccess: onDone,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="lg" title={t('inventory.po.receiveTitle', { no: po.poNo })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={PackageCheck} loading={save.isPending} disabled={!open.some((l) => Number(qty[l.id]) > 0)} onClick={() => save.mutate()}>{t('inventory.po.receive')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('inventory.po.invoiceNo')}><Input value={form.invoiceNo} onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))} /></FormField>
          <FormField label={t('inventory.po.receivedOn')}><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></FormField>
          <FormField label={t('inventory.po.note')}><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
        </div>
        <div className="divide-y divide-border rounded-xl border border-border">
          {open.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{l.name}{l.size ? <CodeBadge className="ms-1.5">{l.size}</CodeBadge> : null}</span>
                <span className="block text-xs text-ink-faint">{t('inventory.po.pendingOf', { pending: l.pending, qty: l.qty })}</span></span>
              {expiryOf.get(l.itemId) && <FormField label={t('inventory.items.expiry')} className="w-40"><Input type="date" value={expiry[l.id] ?? ''} onChange={(e) => setExpiry((m) => ({ ...m, [l.id]: e.target.value }))} /></FormField>}
              <FormField label={t('inventory.po.came')} className="w-24"><Input type="number" min="0" max={l.pending} value={qty[l.id]} onChange={(e) => setQty((m) => ({ ...m, [l.id]: e.target.value }))} /></FormField>
            </div>
          ))}
        </div>
        <Note>{t('inventory.po.receiveHint')}</Note>
      </div>
    </Modal>
  )
}

function PoDrawer({ id, onClose, onEdit, onChanged }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const { dateTime } = useFormat()
  const [receiving, setReceiving] = useState(false)
  const { data: po } = useQuery({ queryKey: ['inventory', 'po', id], queryFn: () => fetchPo(id) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['inventory'] }); onChanged() }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  if (!po) return <Drawer open onClose={onClose} title={t('inventory.loading')}><span /></Drawer>
  const withReason = async (title, fn, done) => {
    const reason = await prompt({ title, label: t('inventory.po.reason'), required: true })
    if (reason) act.mutate({ fn: () => fn(reason), done })
  }
  const can = (a) => hasPermission(`inventory.purchase-orders.${a}`)
  const events = [
    po.created?.at && { at: po.created.at, title: t('inventory.po.evCreated'), sub: po.created.by },
    po.submitted?.at && { at: po.submitted.at, title: t('inventory.po.evSubmitted'), sub: po.submitted.by },
    po.approved?.at && { at: po.approved.at, title: t('inventory.po.evApproved'), sub: [po.approved.by, po.approved.note].filter(Boolean).join(' · ') },
    ...po.receipts.map((r) => ({ at: r.at, title: t('inventory.po.evReceived', { no: r.grnNo }), sub: [r.by, r.invoiceNo && t('inventory.po.invoiceShort', { no: r.invoiceNo }), formatINR(r.value)].filter(Boolean).join(' · ') })),
    po.cancelled?.at && { at: po.cancelled.at, title: t('inventory.po.evCancelled'), sub: [po.cancelled.by, po.cancelled.reason].filter(Boolean).join(' · ') },
  ].filter(Boolean)
  return (
    <Drawer open onClose={onClose} size="xl" title={po.poNo} subtitle={po.vendorName}
      footer={<div className="flex flex-wrap gap-2">
        {po.status === 'DRAFT' && can('edit') && <Button icon={Pencil} variant="secondary" onClick={() => onEdit(po)}>{t('inventory.edit')}</Button>}
        {po.status === 'DRAFT' && (can('create') || can('edit')) && <Button icon={Send} onClick={() => act.mutate({ fn: () => submitPo(po.id), done: t('inventory.po.submitted') })}>{t('inventory.po.submit')}</Button>}
        {po.status === 'SUBMITTED' && can('approve') && <Button icon={CheckCircle2} disabled={!po.canApprove} title={!po.canApprove ? t('inventory.po.overLimit', { limit: formatINR(meta?.poApproveMax ?? 0) }) : undefined}
          onClick={() => act.mutate({ fn: () => approvePo(po.id), done: t('inventory.po.approved') })}>{t('inventory.po.approve')}</Button>}
        {['SUBMITTED', 'APPROVED'].includes(po.status) && can('approve') && <Button icon={Undo2} variant="secondary" onClick={() => withReason(t('inventory.po.sendBackTitle'), (r) => sendBackPo(po.id, r), t('inventory.po.sentBack'))}>{t('inventory.po.sendBack')}</Button>}
        {['APPROVED', 'PARTIAL'].includes(po.status) && (can('edit') || hasPermission('inventory.items.edit')) && <Button icon={PackageCheck} onClick={() => setReceiving(true)}>{t('inventory.po.receive')}</Button>}
        {hasPermission('inventory.purchase-orders.print') && <Button icon={Printer} variant="secondary" onClick={() => printDocument('PURCHASE_ORDER', po.id)}>{t('actions.print')}</Button>}
        {!['RECEIVED', 'CANCELLED'].includes(po.status) && can('cancel') && <Button icon={Ban} variant="ghost" onClick={() => withReason(t('inventory.po.cancelTitle'), (r) => cancelPo(po.id, r), t('inventory.po.cancelled'))}>{t('inventory.po.cancel')}</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><PoPill status={po.status} />{po.branchName && <ColorChip label={po.branchName} dot />}</div>
        {po.status === 'SUBMITTED' && can('approve') && !po.canApprove && <Note tone="warning">{t('inventory.po.overLimit', { limit: formatINR(meta?.poApproveMax ?? 0) })}</Note>}
        <FactGrid>
          <Fact label={t('inventory.po.date')}><DateCell value={po.date} relative={false} /></Fact>
          <Fact label={t('inventory.po.expectedOn')}>{po.expectedOn ? <DateCell value={po.expectedOn} /> : '—'}</Fact>
          <Fact label={t('inventory.po.total')}><Money value={po.total} paise /></Fact>
          <Fact label={t('inventory.po.receivedQty')}><LevelBar value={po.received} max={po.ordered} width="w-32" /></Fact>
        </FactGrid>
        <Panel title={t('inventory.po.lines')} flush>
          <DataTable rows={po.lines} dense columns={[
            { key: 'name', header: t('inventory.lines.item'), mobilePrimary: true, render: (v, l) => <span className="font-medium">{v}{l.size ? <CodeBadge className="ms-1.5">{l.size}</CodeBadge> : null}</span> },
            { key: 'qty', header: t('inventory.lines.qty'), align: 'right', render: (v, l) => `${v} ${L.unit(l.unit)}` },
            { key: 'rate', header: t('inventory.lines.rate'), align: 'right', render: (v) => <Money value={v} paise /> },
            { key: 'amount', header: t('inventory.po.amount'), align: 'right', render: (v) => <Money value={v} paise /> },
            { key: 'receivedQty', header: t('inventory.po.receivedQty'), align: 'right', render: (v, l) => <LevelBar value={v} max={l.qty} width="w-24" /> },
          ]} totals={{ amount: <Money value={po.subtotal} paise /> }} />
        </Panel>
        <div className="flex flex-col items-end gap-1 text-sm">
          {po.tax > 0 && <span className="text-ink-muted">{t('inventory.po.tax')}: <Money value={po.tax} paise /></span>}
          <span className="font-semibold">{t('inventory.po.total')}: <Money value={po.total} paise /></span>
        </div>
        {po.terms && <Panel title={t('inventory.po.terms')}><p className="whitespace-pre-line text-sm text-ink">{po.terms}</p></Panel>}
        {po.note && <Note>{po.note}</Note>}
        <Panel title={t('inventory.po.history')}><Timeline items={events.map((e, i) => ({ id: i, title: e.title, meta: e.sub, time: dateTime(e.at) }))} /></Panel>
      </div>
      {receiving && <ReceiveForm po={po} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); refresh(); showSuccess(t('inventory.po.receivedDone')) }} />}
    </Drawer>
  )
}

function Orders() {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('OPEN')
  const [branchId, setBranchId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const params = { status, branchId: branchId || undefined, search: q || undefined, page, pageSize: 50 }
  const { data, isLoading } = useQuery({ queryKey: ['inventory', 'pos', params], queryFn: () => fetchPos(params) })
  const tot = data?.totals ?? {}
  const openCount = ['SUBMITTED', 'APPROVED', 'PARTIAL'].reduce((s, k) => s + (tot[k]?.count ?? 0), 0)
  return (
    <SideNavLayout nav={<SideNav title={t('inventory.po.statuses')} value={status} onChange={(v) => { setStatus(v ?? 'ALL'); setPage(1) }} items={[
      { id: 'OPEN', label: t('inventory.po.open'), icon: ClipboardList, count: openCount },
      ...STATUS_ORDER.map((s) => ({ id: s, label: L.po(s), count: tot[s]?.count ?? 0, hint: tot[s]?.value ? formatINR(tot[s].value) : undefined, countTone: s === 'SUBMITTED' && tot[s]?.count ? 'warning' : undefined })),
      { id: 'ALL', label: t('inventory.po.all'), count: Object.values(tot).reduce((s, x) => s + x.count, 0) },
    ]} />}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('inventory.po.search')} /></div>
        <CampusSelect value={branchId} onChange={(v) => { setBranchId(v); setPage(1) }} />
        <span className="ms-auto flex gap-2">
          <Button variant="secondary" icon={Download} onClick={() => exportPos(params).catch((e) => showError(e.message))}>{t('inventory.export')}</Button>
          {hasPermission('inventory.purchase-orders.create') && <Button icon={Plus} onClick={() => setEditing('new')}>{t('inventory.po.new')}</Button>}
        </span>
      </div>
      <DataTable rows={data?.data ?? []} loading={isLoading} onRowClick={(r) => setOpen(r.id)} rowTone={(r) => (r.status === 'SUBMITTED' ? 'warning' : undefined)} columns={[
        { key: 'poNo', header: t('inventory.po.no'), mobilePrimary: true, render: (v, r) => <span><CodeBadge>{v}</CodeBadge><span className="block mt-0.5 text-xs text-ink-faint"><DateCell value={r.date} relative={false} /></span></span> },
        { key: 'vendorName', header: t('inventory.po.vendor'), render: (v, r) => <PersonCell name={v} sub={t('inventory.po.linesN', { n: r.lines.length })} /> },
        { key: 'status', header: t('inventory.po.status'), render: (v) => <PoPill status={v} /> },
        { key: 'received', header: t('inventory.po.receivedQty'), mobileHidden: true, render: (v, r) => <LevelBar value={v} max={r.ordered} width="w-28" /> },
        { key: 'expectedOn', header: t('inventory.po.expectedOn'), mobileHidden: true, render: (v) => (v ? <DateCell value={v} /> : '—') },
        { key: 'total', header: t('inventory.po.total'), align: 'right', render: (v) => <Money value={v} paise /> },
      ]} emptyTitle={t('inventory.po.empty')}
        pagination={data && data.total > 50 ? { page: page - 1, size: 50, totalElements: data.total, totalPages: Math.ceil(data.total / 50), onPageChange: (p) => setPage(p + 1) } : undefined} />
      {open && <PoDrawer id={open} onClose={() => setOpen(null)} onEdit={(po) => { setOpen(null); setEditing(po) }} onChanged={() => {}} />}
      {editing && <PoForm po={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(po) => { setEditing(null); qc.invalidateQueries({ queryKey: ['inventory'] }); showSuccess(t('inventory.po.saved', { no: po.poNo })); setOpen(po.id) }} />}
    </SideNavLayout>
  )
}

/** Store › Purchase orders: orders to vendors, through approval (within the approver's limit) to goods received; the vendor list. */
export default function PurchaseOrders() {
  const { t } = useTranslation('inventory')
  const [tab, setTab] = useState('orders')
  return (
    <PageContainer>
      <PageHeader icon={ShoppingBag} title={t('inventory.po.pageTitle')} subtitle={t('inventory.po.pageSubtitle')}
        actions={<HeaderButton icon={tab === 'orders' ? Users : Truck} onClick={() => setTab(tab === 'orders' ? 'vendors' : 'orders')}>{tab === 'orders' ? t('inventory.vendors.tab') : t('inventory.po.tab')}</HeaderButton>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'orders', label: t('inventory.po.tab') }, { value: 'vendors', label: t('inventory.vendors.tab') }]} />
      {tab === 'orders' ? <Orders /> : <Vendors />}
    </PageContainer>
  )
}
