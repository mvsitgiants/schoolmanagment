import { useTranslation } from 'react-i18next'
import { DateInput, FormField, FormSection, Input, Note, Select, Textarea } from '../system'
import { ItemLines, paiseOf, rupeesOf, useInventoryMeta, useItemOptions } from './InventoryKit'

const blankLine = { itemId: '', size: '', qty: 1, rate: '' }

/** The form's starting values from an order (edit) or blank (new). The campus defaults to the user's own. */
export function poFormValues(po, meta) {
  return {
    vendorId: po?.vendorId ?? '', branchId: po?.branchId ?? meta?.myBranchId ?? '', date: po?.date ?? '', expectedOn: po?.expectedOn ?? '',
    tax: rupeesOf(po?.tax || null), terms: po?.terms ?? '', note: po?.note ?? '',
    lines: po?.lines?.length ? po.lines.map((l) => ({ itemId: l.itemId, size: l.size ?? '', qty: l.qty, rate: rupeesOf(l.rate) })) : [{ ...blankLine }],
  }
}

/** What the API takes from the form: amounts in paise, empty lines dropped, a blank rate left to the item's own rate. */
export function poBody(form) {
  return {
    vendorId: form.vendorId, branchId: form.branchId || undefined, date: form.date || undefined, expectedOn: form.expectedOn || undefined, tax: paiseOf(form.tax) ?? 0, terms: form.terms, note: form.note,
    lines: form.lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, size: l.size, qty: Number(l.qty), ...(l.rate !== '' && { rate: paiseOf(l.rate) }) })),
  }
}

/** The order's figures as typed (paise): lines with an item, total quantity, value before tax, tax, total. */
export function poTotals(form) {
  const lines = form.lines.filter((l) => l.itemId)
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (paiseOf(l.rate) ?? 0), 0)
  const tax = paiseOf(form.tax) ?? 0
  return { lines: lines.length, qty: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0), subtotal, tax, total: subtotal + tax }
}

/** Can the order be saved? A vendor and at least one item. */
export const poReady = (form) => !!form.vendorId && form.lines.some((l) => l.itemId)

/** New / edit form for a purchase order. Controlled: `value` + `onChange(next)`; `value.lines` are the item lines. */
export default function PoForm({ value: form, onChange, errors = {} }) {
  const { t } = useTranslation('inventory')
  const { data: meta } = useInventoryMeta()
  const { data: items = [] } = useItemOptions()
  const set = (k) => (e) => onChange({ ...form, [k]: e.target.value })
  const campuses = (meta?.branches ?? []).length > 1 && !meta?.branchLocked

  return (
    <div className="space-y-5">
      <FormSection title={t('inventory.po.form.supplier')} hint={t('inventory.po.form.supplierHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('inventory.po.vendor')} required error={errors.vendorId} className="sm:col-span-2">
            <Select value={form.vendorId} onChange={set('vendorId')}><option value="">{t('inventory.po.pickVendor')}</option>{(meta?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
          </FormField>
          <FormField label={t('inventory.po.date')} error={errors.date} hint={t('inventory.po.form.dateHint')}><DateInput value={form.date} onChange={set('date')} /></FormField>
          <FormField label={t('inventory.po.expectedOn')} error={errors.expectedOn}><DateInput value={form.expectedOn} onChange={set('expectedOn')} /></FormField>
          {campuses && (
            <FormField label={t('inventory.po.deliverTo')} className="sm:col-span-2"><Select value={form.branchId} onChange={set('branchId')}>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
          )}
        </div>
        {meta && (meta.vendors ?? []).length === 0 && <Note tone="warning" className="mt-4">{t('inventory.po.noVendors')}</Note>}
      </FormSection>

      <FormSection title={t('inventory.po.lines')} hint={t('inventory.po.form.linesHint')}>
        {errors.lines && <p className="mb-3 text-sm text-danger-600">{errors.lines}</p>}
        <ItemLines lines={form.lines} onChange={(lines) => onChange({ ...form, lines })} items={items} withRate errors={errors} />
      </FormSection>

      <FormSection title={t('inventory.po.form.taxTerms')} hint={t('inventory.po.form.taxTermsHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('inventory.po.tax')} error={errors.tax} hint={t('inventory.po.taxHint')}><Input type="number" min="0" step="0.01" value={form.tax} onChange={set('tax')} /></FormField>
          <FormField label={t('inventory.po.terms')} className="sm:col-span-2 xl:col-span-3"><Textarea rows={2} value={form.terms} onChange={set('terms')} placeholder={t('inventory.po.termsPlaceholder')} /></FormField>
          <FormField label={t('inventory.po.note')} className="sm:col-span-2 xl:col-span-4"><Input value={form.note} onChange={set('note')} /></FormField>
        </div>
      </FormSection>
    </div>
  )
}
