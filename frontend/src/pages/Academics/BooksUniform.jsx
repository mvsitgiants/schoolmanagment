import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, Pencil, Plus, Save, Shirt, ShoppingBag, Trash2, X } from 'lucide-react'
import { KIT_KINDS, formatINR } from '@schoolgiant/shared'
import { Attachments, DateInput, EmptyState, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { copyKit, deleteKit, fetchAcademicLookup, fetchKit, fetchKitStoreItems, fetchKits, saveKit } from '../../api/academics'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// Academic setup › Books & uniform: each class's list for the year — books, notebooks, stationery, uniform, shoes —
// with codes, prices and notes, the files families download (the publisher's book list, a uniform picture), and the
// day families start seeing it in the app (usually a few weeks before the session starts).

const STORE_KIND = { BOOKS: 'BOOK', UNIFORM: 'UNIFORM', STATIONERY: 'STATIONERY' }
const rupees = (paise) => (paise == null ? '' : String(paise / 100))
const toPaise = (v) => (String(v ?? '').trim() === '' ? null : Math.round(Number(v) * 100))
const blankShop = () => ({ key: `s${Math.random().toString(36).slice(2)}`, name: '', sells: [], address: '', phone: '', mapUrl: '', note: '' })

/** Where to buy: shops the school sends families to — what each sells, address, phone, map link and a note. */
function ShopsEditor({ shops, known, onChange, canEdit, errors }) {
  const { t } = useTranslation('academics')
  const set = (key, k, v) => onChange(shops.map((s) => (s.key === key ? { ...s, [k]: v } : s)))
  const others = known.filter((k) => !shops.some((s) => s.name.trim().toLowerCase() === k.name.trim().toLowerCase()))
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-bg/50">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{t('academics.kit.shops')}{shops.length ? <span className="ms-1.5 text-ink-faint font-normal">({shops.length})</span> : null}</span>
          <span className="block text-[11px] text-ink-muted">{t('academics.kit.shopsHint')}</span>
        </span>
        {canEdit && (
          <span className="flex flex-wrap items-center gap-2">
            {others.length > 0 && (
              <div className="w-52"><Select aria-label={t('academics.kit.shopFromOther')} value="" onChange={(e) => { const s = others.find((x) => x.name === e.target.value); if (s) onChange([...shops, { ...blankShop(), ...s, key: blankShop().key, address: s.address ?? '', phone: s.phone ?? '', mapUrl: s.mapUrl ?? '', note: s.note ?? '' }]) }} className="!h-8 text-xs">
                <option value="">{t('academics.kit.shopFromOther')}</option>{others.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </Select></div>
            )}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...shops, blankShop()])}>{t('academics.kit.addShop')}</Button>
          </span>
        )}
      </div>
      {shops.length === 0 ? <p className="px-3 py-3 text-xs text-ink-faint">{t('academics.kit.noShops')}</p> : (
        <div className="divide-y divide-border">
          {shops.map((s, n) => (
            <div key={s.key} className="px-3 py-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-4"><Input aria-label={t('academics.kit.shopName')} placeholder={t('academics.kit.shopName')} value={s.name} onChange={(e) => set(s.key, 'name', e.target.value)} /></div>
                <div className="sm:col-span-3"><Input aria-label={t('academics.kit.shopPhone')} placeholder={t('academics.kit.shopPhone')} inputMode="tel" value={s.phone} onChange={(e) => set(s.key, 'phone', e.target.value)} /></div>
                <div className="sm:col-span-4"><Input aria-label={t('academics.kit.shopMap')} placeholder={t('academics.kit.shopMap')} value={s.mapUrl} onChange={(e) => set(s.key, 'mapUrl', e.target.value)} error={errors[`shops.${n}.mapUrl`]} /></div>
                <div className="sm:col-span-1 flex justify-end">{canEdit && <button type="button" onClick={() => onChange(shops.filter((x) => x.key !== s.key))} className="p-2 rounded text-ink-muted hover:text-danger-600 hover:bg-black/[0.04]" aria-label={t('academics.kit.removeShop')} title={t('academics.kit.removeShop')}><X className="w-4 h-4" /></button>}</div>
                <div className="sm:col-span-7"><Input aria-label={t('academics.kit.shopAddress')} placeholder={t('academics.kit.shopAddress')} value={s.address} onChange={(e) => set(s.key, 'address', e.target.value)} /></div>
                <div className="sm:col-span-5"><Input aria-label={t('academics.kit.shopNote')} placeholder={t('academics.kit.shopNote')} value={s.note} onChange={(e) => set(s.key, 'note', e.target.value)} /></div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-xs text-ink-muted">{t('academics.kit.shopSells')}</span>
                {KIT_KINDS.map((k) => (
                  <label key={k.value} className="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
                    <input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={s.sells.includes(k.value)}
                      onChange={(e) => set(s.key, 'sells', e.target.checked ? [...s.sells, k.value] : s.sells.filter((x) => x !== k.value))} />
                    {t(`academics.kit.kinds.${k.value}`)}
                  </label>
                ))}
                {!s.sells.length && <span className="text-[11px] text-ink-faint">{t('academics.kit.shopSellsAll')}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const blankItem = (kind = 'BOOK') => ({ key: `n${Math.random().toString(36).slice(2)}`, kind, name: '', code: '', subject: '', publisher: '', qty: 1, price: '', note: '', storeItemId: null })

/** Pick sale items from the store (uniform, books) — their code and price come along. */
function StorePicker({ onPick, onClose }) {
  const { t } = useTranslation('academics')
  const { data: items = [], isLoading } = useQuery({ queryKey: ['kit-store-items'], queryFn: fetchKitStoreItems })
  const [q, setQ] = useState('')
  const rows = items.filter((i) => !q || `${i.name} ${i.code}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal open onClose={onClose} title={t('academics.kit.fromStore')} footer={<Button variant="secondary" onClick={onClose}>{t('academics.kit.done')}</Button>}>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('academics.kit.searchStore')} />
      <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
        {isLoading ? <li className="px-3 py-3 text-sm text-ink-faint">…</li> : !rows.length ? <li className="px-3 py-3 text-sm text-ink-faint">{t('academics.kit.storeEmpty')}</li> : rows.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{i.name}</span>
              <span className="block text-[11px] text-ink-faint">{[i.code, i.salePrice != null && formatINR(i.salePrice, { decimals: 0 }), i.sizes.length ? i.sizes.join(', ') : null].filter(Boolean).join(' · ')}</span>
            </span>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => onPick(i)}>{t('academics.kit.add')}</Button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

/** Copy this list to other classes (not published; classes that have one are skipped). */
function CopyModal({ kit, classes, onClose }) {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [picked, setPicked] = useState([])
  const go = useMutation({
    mutationFn: () => copyKit(kit.id, { classIds: picked }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['kits'] }); showSuccess(t('academics.kit.copied', { made: r.made, skipped: r.skipped })); onClose() },
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('academics.kit.copyTitle', { cls: kit.className })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('academics.kit.cancel')}</Button>
      <Button icon={Copy} loading={go.isPending} disabled={!picked.length} onClick={() => go.mutate()}>{t('academics.kit.copy')}</Button>
    </>}>
      <p className="text-sm text-ink-muted mb-3">{t('academics.kit.copyHint')}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {classes.filter((c) => c.id !== kit.classId).map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
            {c.name}
          </label>
        ))}
      </div>
    </Modal>
  )
}

/** One class's list: the items by kind, instructions, files, and when families see it. */
function KitEditor({ kitId, yearId, lookup, knownShops = [], onClose }) {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const canEdit = hasPermission(kitId ? 'academics.books-uniform.edit' : 'academics.books-uniform.create')
  const [id, setId] = useState(kitId)
  const [form, setForm] = useState(kitId ? null : { classId: '', branchId: '', instructions: '', published: false, visibleFrom: '', items: [blankItem('BOOK')], shops: [] })
  const [errors, setErrors] = useState({})
  const [store, setStore] = useState(false)
  const [copying, setCopying] = useState(false)
  useQuery({
    queryKey: ['kit', kitId], enabled: !!kitId && !form,
    queryFn: async () => {
      const k = await fetchKit(kitId)
      setForm({ ...k, branchId: k.branchId ?? '', visibleFrom: k.visibleFrom ?? '', items: k.items.map((i) => ({ ...i, key: i.id, price: rupees(i.price), code: i.code ?? '', subject: i.subject ?? '', publisher: i.publisher ?? '', note: i.note ?? '' })), shops: (k.shops ?? []).map((s) => ({ ...blankShop(), ...s, key: s.id, address: s.address ?? '', phone: s.phone ?? '', mapUrl: s.mapUrl ?? '', note: s.note ?? '' })) })
      return k
    },
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setItem = (key, k, v) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, [k]: v } : i)) }))
  const save = useMutation({
    mutationFn: () => saveKit(id, {
      academicYearId: yearId, classId: form.classId, branchId: form.branchId || null, instructions: form.instructions, published: form.published, visibleFrom: form.visibleFrom || '',
      items: form.items.filter((i) => i.name.trim()).map(({ key, id: _id, ...i }) => ({ ...i, qty: Number(i.qty) || 1, price: toPaise(i.price), storeItemId: i.storeItemId || null })),
      shops: form.shops.filter((s) => s.name.trim()).map(({ key, id: _id, ...s }) => s),
    }),
    onSuccess: (k) => { setId(k.id); qc.invalidateQueries({ queryKey: ['kits'] }); showSuccess(t('academics.kit.saved')) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const remove = useMutation({ mutationFn: () => deleteKit(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['kits'] }); onClose() }, onError: (e) => showError(e.message) })
  const cls = lookup?.classes?.find((c) => c.id === form?.classId)

  return (
    <Modal open onClose={onClose} size="xl" title={cls ? t('academics.kit.editTitle', { cls: cls.name }) : t('academics.kit.newTitle')} footer={form && <>
      {id && hasPermission('academics.books-uniform.delete') && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" onClick={async () => { if (await confirm({ title: t('academics.kit.deleteTitle'), message: t('academics.kit.deleteMessage'), tone: 'danger', confirmLabel: t('academics.kit.delete') })) remove.mutate() }}>{t('academics.kit.delete')}</Button>}
      {id && hasPermission('academics.books-uniform.create') && <Button variant="secondary" icon={Copy} onClick={() => setCopying(true)}>{t('academics.kit.copyOther')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('academics.kit.close')}</Button>
      {canEdit && <Button icon={Save} loading={save.isPending} disabled={!form.classId} onClick={() => save.mutate()}>{t('academics.kit.save')}</Button>}
    </>}>
      {!form ? <p className="text-sm text-ink-faint">…</p> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <FormField label={t('academics.kit.class')} required error={errors.classId}>
              <Select value={form.classId} onChange={set('classId')} disabled={!!id}><option value="">{t('academics.kit.pick')}</option>{(lookup?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </FormField>
            <FormField label={t('academics.kit.campus')}>
              <Select value={form.branchId} onChange={set('branchId')} disabled={!!id}><option value="">{t('academics.kit.allCampuses')}</option>{(lookup?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            </FormField>
            <FormField label={t('academics.kit.visibleFrom')} hint={t('academics.kit.visibleFromHint')}><DateInput value={form.visibleFrom} onChange={set('visibleFrom')} /></FormField>
            <FormField label={t('academics.kit.publish')} hint={form.published ? t('academics.kit.publishedHint') : t('academics.kit.draftHint')}>
              <div className="h-9 flex items-center"><Switch checked={form.published} onChange={set('published')} label={t('academics.kit.publish')} disabled={!canEdit} /></div>
            </FormField>
          </div>
          <FormField label={t('academics.kit.instructions')} hint={t('academics.kit.instructionsHint')}>
            <Textarea rows={3} maxLength={2000} value={form.instructions} onChange={set('instructions')} placeholder={t('academics.kit.instructionsPlaceholder')} />
          </FormField>

          <div className="space-y-4">
            {KIT_KINDS.map((k) => {
              const rows = form.items.filter((i) => i.kind === k.value)
              return (
                <div key={k.value} className="rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-bg/50">
                    <span className="text-sm font-semibold text-ink">{t(`academics.kit.kinds.${k.value}`)}{rows.length ? <span className="ms-1.5 text-ink-faint font-normal">({rows.length})</span> : null}</span>
                    {canEdit && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, items: [...f.items, blankItem(k.value)] }))}>{t('academics.kit.addItem')}</Button>}
                  </div>
                  {rows.length > 0 && (
                    <div className="divide-y divide-border">
                      {rows.map((i) => (
                        <div key={i.key} className="grid grid-cols-2 sm:grid-cols-12 gap-2 px-3 py-2 items-start">
                          <div className="col-span-2 sm:col-span-3"><Input aria-label={t('academics.kit.name')} placeholder={t('academics.kit.name')} value={i.name} onChange={(e) => setItem(i.key, 'name', e.target.value)} /></div>
                          <div className="sm:col-span-2"><Input aria-label={t('academics.kit.code')} placeholder={t('academics.kit.code')} value={i.code} onChange={(e) => setItem(i.key, 'code', e.target.value)} /></div>
                          <div className="sm:col-span-2"><Input aria-label={k.value === 'BOOK' ? t('academics.kit.publisher') : t('academics.kit.subject')} placeholder={k.value === 'BOOK' ? t('academics.kit.publisher') : t('academics.kit.subject')} value={k.value === 'BOOK' ? i.publisher : i.subject} onChange={(e) => setItem(i.key, k.value === 'BOOK' ? 'publisher' : 'subject', e.target.value)} /></div>
                          <div className="sm:col-span-1"><Input aria-label={t('academics.kit.qty')} inputMode="numeric" value={i.qty} onChange={(e) => setItem(i.key, 'qty', e.target.value.replace(/\D/g, ''))} /></div>
                          <div className="sm:col-span-1"><Input aria-label={t('academics.kit.price')} placeholder="₹" inputMode="decimal" value={i.price} onChange={(e) => setItem(i.key, 'price', e.target.value.replace(/[^\d.]/g, ''))} /></div>
                          <div className="col-span-2 sm:col-span-2"><Input aria-label={t('academics.kit.note')} placeholder={k.value === 'UNIFORM' ? t('academics.kit.notePlaceholderUniform') : t('academics.kit.note')} value={i.note} onChange={(e) => setItem(i.key, 'note', e.target.value)} /></div>
                          <div className="sm:col-span-1 flex justify-end">{canEdit && <button type="button" onClick={() => setForm((f) => ({ ...f, items: f.items.filter((x) => x.key !== i.key) }))} className="p-2 rounded text-ink-muted hover:text-danger-600 hover:bg-black/[0.04]" aria-label={t('academics.kit.removeItem')} title={t('academics.kit.removeItem')}><X className="w-4 h-4" /></button>}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={ShoppingBag} onClick={() => setStore(true)}>{t('academics.kit.fromStore')}</Button>
              <span className="text-xs text-ink-faint self-center">{t('academics.kit.fromStoreHint')}</span>
            </div>
          )}

          <ShopsEditor shops={form.shops} known={knownShops} canEdit={canEdit} errors={errors} onChange={(shops) => setForm((f) => ({ ...f, shops }))} />

          {id ? <Attachments entityType="class_kit" entityId={id} label={t('academics.kit.files')} canAdd={canEdit} /> : <Note>{t('academics.kit.filesAfterSave')}</Note>}
        </div>
      )}
      {store && <StorePicker onClose={() => setStore(false)} onPick={(s) => setForm((f) => ({ ...f, items: [...f.items, { ...blankItem(STORE_KIND[s.category] ?? 'OTHER'), name: s.name, code: s.code, price: rupees(s.salePrice), storeItemId: s.id, note: s.sizes.length ? t('academics.kit.sizesNote', { sizes: s.sizes.join(', ') }) : '' }] }))} />}
      {copying && id && <CopyModal kit={{ id, classId: form.classId, className: cls?.name }} classes={lookup?.classes ?? []} onClose={() => setCopying(false)} />}
    </Modal>
  )
}

export default function BooksUniform() {
  const { t } = useTranslation('academics')
  const { date } = useFormat()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [yearId, setYearId] = useState('')
  const year = yearId || lookup?.currentYear?.id || ''
  const { data, isLoading } = useQuery({ queryKey: ['kits', year], queryFn: () => fetchKits(year), enabled: !!year })
  const [open, setOpen] = useState(null) // kit id, or 'new'
  const kits = data?.kits ?? []
  const missing = useMemo(() => (lookup?.classes ?? []).filter((c) => !kits.some((k) => k.classId === c.id)), [lookup, kits])
  const canCreate = hasPermission('academics.books-uniform.create')
  const today = new Date().toISOString().slice(0, 10)
  const state = (k) => (!k.published ? ['neutral', t('academics.kit.draft')] : k.visibleFrom && k.visibleFrom > today ? ['info', t('academics.kit.showsFrom', { date: date(k.visibleFrom) })] : ['success', t('academics.kit.live')])

  return (
    <PageContainer>
      <PageHeader icon={Shirt} title={t('academics.kit.title')} subtitle={t('academics.kit.subtitle')}
        actions={<>
          <div className="w-44"><Select aria-label={t('academics.kit.year')} value={year} onChange={(e) => setYearId(e.target.value)}>{(lookup?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select></div>
          {canCreate && <Button icon={Plus} onClick={() => setOpen('new')}>{t('academics.kit.new')}</Button>}
        </>} />
      <Panel flush>
        {isLoading ? <p className="px-4 py-4 text-sm text-ink-faint">…</p> : !kits.length ? (
          <EmptyState icon={Shirt} title={t('academics.kit.emptyTitle')} hint={t('academics.kit.emptyHint')} action={canCreate && <Button icon={Plus} onClick={() => setOpen('new')}>{t('academics.kit.new')}</Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {kits.map((k) => {
              const [tone, label] = state(k)
              return (
                <li key={k.id}>
                  <button type="button" onClick={() => setOpen(k.id)} className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-black/[0.02]">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{k.className}<span className="ms-2 text-xs font-normal text-ink-muted">{k.branchName ?? t('academics.kit.allCampuses')}</span></span>
                      <span className="block text-[11px] text-ink-faint">{[t('academics.kit.itemCount', { count: k.items.length }), k.fileCount ? t('academics.kit.fileCount', { count: k.fileCount }) : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <StatusPill tone={tone}>{label}</StatusPill>
                    <Pencil className="w-4 h-4 text-ink-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      {kits.length > 0 && missing.length > 0 && <Note className="mt-4">{t('academics.kit.missing', { list: missing.map((c) => c.name).join(', ') })}</Note>}
      {open && <KitEditor key={open} kitId={open === 'new' ? null : open} yearId={year} lookup={lookup} knownShops={data?.shops ?? []} onClose={() => setOpen(null)} />}
    </PageContainer>
  )
}
