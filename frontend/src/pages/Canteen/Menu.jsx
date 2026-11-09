import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Leaf, Pencil, Plus, Sparkles, Trash2, Utensils, UtensilsCrossed, X } from 'lucide-react'
import { CANTEEN_CATEGORIES, CANTEEN_DAYS, CANTEEN_MARKS, CANTEEN_TAGS, formatINR, toPaise, toRupees } from '@schoolgiant/shared'
import { FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, SearchInput, SegmentedControl, Select, SideNav, SideNavLayout, StatCardRow, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteMenuItem, deleteSpecial, fetchMenu, fetchSpecials, saveMenuItem, saveSpecial, setSoldOut } from '../../api/canteen'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CATEGORY_ICON, FoodMark, ItemTile, useCanteenLabels } from '../../components/canteen/CanteenKit'

const chip = (on) => `inline-flex min-h-[32px] items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors ${on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted hover:bg-black/[0.03]'}`

function ItemForm({ item, onClose, onSaved }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const { showError } = useSnackbar()
  const confirm = useConfirm()
  const [form, setForm] = useState({
    name: item?.name ?? '', category: item?.category ?? 'SNACK', price: item ? String(toRupees(item.price)) : '', mark: item?.mark ?? 'VEG',
    tags: item?.tags ?? [], days: item?.days ?? [], description: item?.description ?? '', active: item?.active ?? true,
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }))
  const save = useMutation({
    mutationFn: () => saveMenuItem(item?.id, { ...form, price: toPaise(form.price) }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? e.fields ?? {}); showError(e.message) },
  })
  const remove = useMutation({ mutationFn: () => deleteMenuItem(item.id), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={item ? t('canteen.menu.editTitle') : t('canteen.menu.newTitle')} footer={<>
      {item && hasPermission('canteen.menu.delete') && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" loading={remove.isPending}
        onClick={async () => { if (await confirm({ title: t('canteen.menu.deleteTitle', { name: item.name }), message: t('canteen.menu.deleteHint'), tone: 'danger' })) remove.mutate() }}>{t('actions.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name.trim() || form.price === ''} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_140px] gap-3">
          <FormField label={t('canteen.menu.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} autoFocus /></FormField>
          <FormField label={t('canteen.menu.priceRs')} required error={errors.price}><Input type="number" min="0" step="0.5" value={form.price} onChange={set('price')} /></FormField>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label={t('canteen.menu.category')}><Select value={form.category} onChange={set('category')}>{CANTEEN_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{L.category(c.value)}</option>)}</Select></FormField>
          <FormField label={t('canteen.menu.mark')}>
            <div className="flex flex-wrap gap-2">
              {CANTEEN_MARKS.map((m) => <button key={m.value} type="button" className={chip(form.mark === m.value)} onClick={() => setForm((f) => ({ ...f, mark: m.value }))}><FoodMark mark={m.value} size={12} />{L.mark(m.value)}</button>)}
            </div>
          </FormField>
        </div>
        <FormField label={t('canteen.menu.tags')} hint={t('canteen.menu.tagsHint')}>
          <div className="flex flex-wrap gap-2">{CANTEEN_TAGS.map((x) => <button key={x.value} type="button" className={chip(form.tags.includes(x.value))} onClick={() => toggle('tags', x.value)}>{L.tag(x.value)}</button>)}</div>
        </FormField>
        <FormField label={t('canteen.menu.days')} hint={t('canteen.menu.daysHint')}>
          <div className="flex flex-wrap gap-2">{CANTEEN_DAYS.map((d) => <button key={d} type="button" className={chip(form.days.includes(d))} onClick={() => toggle('days', d)}>{L.day(d)}</button>)}</div>
        </FormField>
        <FormField label={t('canteen.menu.description')}><Textarea rows={2} value={form.description} onChange={set('description')} /></FormField>
        {item && (
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />{t('canteen.menu.activeLabel')}</label>
        )}
      </div>
    </Modal>
  )
}

function SpecialForm({ items, date, onClose, onSaved }) {
  const { t } = useTranslation('canteen')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ date, itemId: '', price: '', note: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const picked = items.find((i) => i.id === form.itemId)
  const save = useMutation({ mutationFn: () => saveSpecial({ date: form.date, itemId: form.itemId, price: form.price === '' ? null : toPaise(form.price), note: form.note }), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('canteen.specials.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.itemId || !form.date} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('canteen.specials.date')} required><Input type="date" value={form.date} onChange={set('date')} /></FormField>
        <FormField label={t('canteen.specials.item')} required>
          <Select value={form.itemId} onChange={set('itemId')}>
            <option value="">{t('canteen.specials.pick')}</option>
            {items.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name} · {formatINR(i.price)}</option>)}
          </Select>
        </FormField>
        <FormField label={t('canteen.specials.priceRs')} hint={picked ? t('canteen.specials.priceHint', { price: formatINR(picked.price) }) : undefined}><Input type="number" min="0" step="0.5" value={form.price} onChange={set('price')} /></FormField>
        <FormField label={t('canteen.specials.note')}><Input value={form.note} onChange={set('note')} maxLength={120} placeholder={t('canteen.specials.notePlaceholder')} /></FormField>
      </div>
    </Modal>
  )
}

/** The week's specials: one column a day. */
function SpecialsWeek({ items, from }) {
  const { t } = useTranslation('canteen')
  const { date } = useFormat()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [adding, setAdding] = useState(null)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) }), [from])
  const { data: specials = [] } = useQuery({ queryKey: ['canteen', 'specials', from], queryFn: () => fetchSpecials({ from, to: days[6] }), enabled: !!from })
  const remove = useMutation({ mutationFn: deleteSpecial, onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen'] }); showSuccess(t('canteen.specials.removed')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('canteen.menu.edit') || hasPermission('canteen.menu.create')
  return (
    <Panel title={t('canteen.specials.title')} subtitle={t('canteen.specials.subtitle')} icon={Sparkles} iconTone="warning">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.map((d, i) => {
          const list = specials.filter((s) => s.date === d)
          return (
            <div key={d} className={`rounded-xl border p-2 min-h-[110px] flex flex-col ${i === 0 ? 'border-brand-300 bg-brand-50/40' : 'border-border bg-bg'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{i === 0 ? t('canteen.specials.today') : date(d)}</p>
              <div className="mt-1.5 flex-1 space-y-1.5">
                {list.map((s) => (
                  <div key={s.id} className="group rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
                    <div className="flex items-start gap-1.5"><FoodMark mark={s.mark} size={10} className="mt-0.5" /><span className="flex-1 text-xs font-semibold text-ink leading-tight">{s.name}</span>
                      {canEdit && <button type="button" aria-label={t('canteen.specials.remove')} className="text-ink-faint hover:text-danger-600" onClick={() => remove.mutate(s.id)}><X className="w-3 h-3" /></button>}
                    </div>
                    <p className="mt-0.5 text-[11px] font-mono-num text-amber-800">{formatINR(s.price)}{s.price !== s.menuPrice && <span className="ms-1 line-through text-ink-faint">{formatINR(s.menuPrice)}</span>}</p>
                    {s.note && <p className="text-[10px] text-ink-muted line-clamp-2">{s.note}</p>}
                  </div>
                ))}
              </div>
              {canEdit && <button type="button" onClick={() => setAdding(d)} className="mt-1.5 inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1 text-[11px] text-ink-muted hover:bg-surface"><Plus className="w-3 h-3" />{t('canteen.specials.add')}</button>}
            </div>
          )
        })}
      </div>
      {adding && <SpecialForm items={items} date={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); qc.invalidateQueries({ queryKey: ['canteen'] }); showSuccess(t('canteen.specials.saved')) }} />}
    </Panel>
  )
}

/** Canteen › Menu: the items as tiles by category, sold-out switches for today, and the week's specials. */
export default function CanteenMenu() {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [cat, setCat] = useState('')
  const [search, setSearch] = useState('')
  const [mark, setMark] = useState('ALL')
  const [editing, setEditing] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['canteen', 'menu'], queryFn: fetchMenu })
  const items = data?.items ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: ['canteen'] })
  const sold = useMutation({ mutationFn: ({ id, soldOut }) => setSoldOut(id, soldOut), onSuccess: refresh, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('canteen.menu.edit')
  const active = items.filter((i) => i.active)
  const shown = items.filter((i) => (cat === 'OFF' ? !i.active : i.active && (!cat || i.category === cat)) && (mark === 'ALL' || i.mark === mark) && (!search || i.name.toLowerCase().includes(search.toLowerCase())))
  const nav = [
    { id: '', label: t('canteen.menu.all'), icon: Utensils, count: active.length },
    ...CANTEEN_CATEGORIES.map((c) => ({ id: c.value, label: L.category(c.value), icon: CATEGORY_ICON[c.value], count: active.filter((i) => i.category === c.value).length, progress: active.length ? { value: active.filter((i) => i.category === c.value).length, max: active.length, kind: 'done' } : undefined })),
    ...(items.some((i) => !i.active) ? [{ id: 'OFF', label: t('canteen.menu.offMenu'), icon: UtensilsCrossed, count: items.filter((i) => !i.active).length }] : []),
  ]
  const markCount = (m) => active.filter((i) => i.mark === m).length
  return (
    <PageContainer>
      <PageHeader icon={Utensils} title={t('canteen.menu.title')} subtitle={t('canteen.menu.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="canteen.menu.create" onClick={() => setEditing({})}>{t('canteen.menu.new')}</HeaderButton>} />
      <div className="space-y-4">
        <StatCardRow items={[
          { icon: Utensils, label: t('canteen.menu.onMenu'), value: active.length, segments: CANTEEN_MARKS.map((m) => ({ label: L.mark(m.value), value: markCount(m.value), tone: m.tone })) },
          { icon: UtensilsCrossed, tone: active.some((i) => i.soldOut) ? 'danger' : 'neutral', label: t('canteen.menu.soldOutToday'), value: active.filter((i) => i.soldOut).length },
          { icon: Leaf, tone: 'success', label: t('canteen.menu.vegShare'), value: active.length ? `${Math.round((markCount('VEG') / active.length) * 100)}%` : '—', progress: active.length ? (markCount('VEG') / active.length) * 100 : 0 },
          { icon: CalendarDays, tone: 'violet', label: t('canteen.menu.everyDay'), value: active.filter((i) => !i.days.length).length, sub: t('canteen.menu.everyDaySub') },
        ]} />
        <SideNavLayout nav={<SideNav title={t('canteen.menu.categories')} value={cat} onChange={setCat} items={nav} />}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64 max-w-full"><SearchInput value={search} onChange={setSearch} placeholder={t('canteen.menu.search')} /></div>
            <SegmentedControl value={mark} onChange={setMark} options={[{ value: 'ALL', label: t('canteen.menu.allMarks') }, ...CANTEEN_MARKS.map((m) => ({ value: m.value, label: L.mark(m.value) }))]} />
          </div>
          {!isLoading && !items.length && <Note>{t('canteen.menu.emptyHint')}</Note>}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {isLoading && Array.from({ length: 6 }, (_, i) => <div key={i} className="h-36 rounded-xl bg-black/[0.05] animate-pulse" />)}
            {shown.map((it) => (
              <ItemTile key={it.id} item={{ ...it, soldOut: it.soldOut }} footer={
                <span className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="text-[11px] text-ink-faint">{it.days.length ? it.days.map(L.day).join(' · ') : t('canteen.menu.everyDayShort')} · {t('canteen.menu.sold30', { count: it.sold30 })}</span>
                  <span className="flex items-center gap-1">
                    {canEdit && it.active && (
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted cursor-pointer">
                        <input type="checkbox" checked={!it.soldOut} onChange={(e) => sold.mutate({ id: it.id, soldOut: !e.target.checked })} />{t('canteen.menu.inStock')}
                      </label>
                    )}
                    {canEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('actions.edit')} onClick={() => setEditing(it)} />}
                  </span>
                </span>
              } />
            ))}
          </div>
          {!isLoading && items.length > 0 && !shown.length && <p className="py-8 text-center text-sm text-ink-muted">{t('canteen.menu.noMatch')}</p>}
          {data?.date && <SpecialsWeek items={items} from={data.date} />}
        </SideNavLayout>
      </div>
      {editing && <ItemForm item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('canteen.menu.saved')) }} />}
    </PageContainer>
  )
}
