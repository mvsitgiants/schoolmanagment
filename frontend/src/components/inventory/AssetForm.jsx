import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUS } from '@schoolgiant/shared'
import { DateInput, FormField, FormSection, Input, Select } from '../system'
import { ASSET_ICON, paiseOf, rupeesOf, useInventoryLabels, useInventoryMeta } from './InventoryKit'

/** The form's starting values from an asset (edit) or blank (add). */
export function assetFormValues(asset) {
  return {
    assetTag: asset?.assetTag ?? '', name: asset?.name ?? '', category: asset?.category ?? 'FURNITURE', make: asset?.make ?? '', model: asset?.model ?? '', serialNo: asset?.serialNo ?? '',
    branchId: asset?.branchId ?? '', roomId: asset?.roomId ?? '', location: asset?.location ?? '', assignedToId: asset?.assignedTo?.userId ?? '',
    vendorId: asset?.vendorId ?? '', purchaseDate: asset?.purchase?.date ?? '', cost: rupeesOf(asset?.purchase?.cost), invoiceNo: asset?.purchase?.invoiceNo ?? '',
    warrantyEnd: asset?.warrantyEnd ?? '', lifeYears: asset?.depreciation?.lifeYears ?? '', salvagePct: asset?.depreciation?.salvagePct ?? '',
    condition: asset?.condition ?? 'GOOD', status: asset?.status ?? 'IN_USE', note: asset?.note ?? '',
  }
}

/** What the API takes from the form: cost in paise, blanks as "not set". */
export function assetBody(form) {
  return {
    ...form, cost: paiseOf(form.cost), lifeYears: form.lifeYears === '' ? null : Number(form.lifeYears), salvagePct: form.salvagePct === '' ? null : Number(form.salvagePct),
    branchId: form.branchId || undefined, assetTag: form.assetTag || undefined,
  }
}

/**
 * Add / edit form for an asset in the register. Controlled: `value` + `onChange(next)`. `errors` are the API's field errors.
 * `editing` drops the "leave empty for the next number" hint on the tag.
 */
export default function AssetForm({ value: form, onChange, errors = {}, editing = false }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { data: meta } = useInventoryMeta()
  const set = (k) => (e) => onChange({ ...form, [k]: e.target.value })
  const life = ASSET_CATEGORIES.find((c) => c.value === form.category)?.lifeYears
  const rooms = (meta?.rooms ?? []).filter((r) => !form.branchId || !r.branchId || r.branchId === form.branchId)
  const campuses = (meta?.branches ?? []).length > 1 && !meta?.branchLocked

  return (
    <div className="space-y-5">
      <FormSection title={t('inventory.assets.form.what')} hint={t('inventory.assets.form.whatHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <FormField label={t('inventory.assets.name')} required error={errors.name} className="sm:col-span-2"><Input value={form.name} onChange={set('name')} placeholder={t('inventory.assets.namePlaceholder')} /></FormField>
          <FormField label={t('inventory.assets.tag')} error={errors.assetTag} hint={editing ? undefined : t('inventory.assets.tagHint')}><Input value={form.assetTag} onChange={set('assetTag')} className="font-mono uppercase" /></FormField>
          <div className="sm:col-span-2 xl:col-span-3">
            <p className="mb-1.5 text-xs font-medium text-ink-muted">{t('inventory.assets.category')}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('inventory.assets.category')}>
              {ASSET_CATEGORIES.map((c) => {
                const Icon = ASSET_ICON[c.value]
                const on = form.category === c.value
                return (
                  <button key={c.value} type="button" role="radio" aria-checked={on} onClick={() => onChange({ ...form, category: c.value })}
                    className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:bg-black/[0.03]')}>
                    <Icon className="h-4 w-4" aria-hidden />{L.assetCat(c.value)}
                  </button>
                )
              })}
            </div>
          </div>
          <FormField label={t('inventory.assets.make')}><Input value={form.make} onChange={set('make')} /></FormField>
          <FormField label={t('inventory.assets.model')}><Input value={form.model} onChange={set('model')} /></FormField>
          <FormField label={t('inventory.assets.serialNo')}><Input value={form.serialNo} onChange={set('serialNo')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('inventory.assets.form.where')} hint={t('inventory.assets.form.whereHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {campuses && (
            <FormField label={t('inventory.campus')}><Select value={form.branchId} onChange={set('branchId')}><option value="">{t('inventory.myCampus')}</option>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
          )}
          <FormField label={t('inventory.assets.room')} error={errors.roomId}><Select value={form.roomId} onChange={set('roomId')}><option value="">{t('inventory.assets.noRoom')}</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.code ? `${r.name} · ${r.code}` : r.name}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.location')}><Input value={form.location} onChange={set('location')} placeholder={t('inventory.assets.locationPlaceholder')} /></FormField>
          <FormField label={t('inventory.assets.assignedTo')} error={errors.assignedToId}><Select value={form.assignedToId} onChange={set('assignedToId')}><option value="">{t('inventory.assets.nobody')}</option>{(meta?.staff ?? []).map((u) => <option key={u.id} value={u.id}>{u.designation ? `${u.name} · ${u.designation}` : u.name}</option>)}</Select></FormField>
        </div>
      </FormSection>

      <FormSection title={t('inventory.assets.form.purchase')} hint={t('inventory.assets.form.purchaseHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <FormField label={t('inventory.assets.purchaseDate')}><DateInput value={form.purchaseDate} onChange={set('purchaseDate')} /></FormField>
          <FormField label={t('inventory.assets.cost')} error={errors.cost}><Input type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} /></FormField>
          <FormField label={t('inventory.assets.warrantyEnd')}><DateInput value={form.warrantyEnd} onChange={set('warrantyEnd')} /></FormField>
          <FormField label={t('inventory.assets.vendor')}><Select value={form.vendorId} onChange={set('vendorId')}><option value="">{t('inventory.assets.form.noVendor')}</option>{(meta?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.invoiceNo')}><Input value={form.invoiceNo} onChange={set('invoiceNo')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('inventory.assets.form.condition')} hint={t('inventory.assets.form.conditionHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('inventory.assets.condition')}><Select value={form.condition} onChange={set('condition')}>{Object.keys(ASSET_CONDITIONS).map((c) => <option key={c} value={c}>{L.cond(c)}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.status')}><Select value={form.status} onChange={set('status')}>{Object.keys(ASSET_STATUS).filter((s) => s !== 'DISPOSED').map((s) => <option key={s} value={s}>{L.assetStatus(s)}</option>)}</Select></FormField>
          <FormField label={t('inventory.assets.lifeYears')} error={errors.lifeYears} hint={t('inventory.assets.lifeHint', { n: life })}><Input type="number" min="1" max="60" value={form.lifeYears} onChange={set('lifeYears')} placeholder={String(life ?? '')} /></FormField>
          <FormField label={t('inventory.assets.salvagePct')} error={errors.salvagePct}><Input type="number" min="0" max="100" value={form.salvagePct} onChange={set('salvagePct')} placeholder="0" /></FormField>
          <FormField label={t('inventory.assets.note')} className="sm:col-span-2 xl:col-span-4"><Input value={form.note} onChange={set('note')} /></FormField>
        </div>
      </FormSection>
    </div>
  )
}
