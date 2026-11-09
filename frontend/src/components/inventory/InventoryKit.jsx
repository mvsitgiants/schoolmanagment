import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  Armchair, BookOpen, CookingPot, Dumbbell, FlaskConical, Microscope, Monitor, Music, Package, PencilRuler, Plus, Projector, Shirt, SprayCan, Trash2, Trophy, Zap,
} from 'lucide-react'
import { ASSET_CONDITIONS, ASSET_STATUS, PO_STATUS, STOCK_LEVEL, STORE_COUNT_STATUS, STORE_MOVE_TYPES, STORE_SALE_STATUS } from '@schoolgiant/shared'
import { FormField, Input, Select, StatusPill } from '../system'
import Button from '../ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchInventoryMeta, fetchItems, searchSaleStudents } from '../../api/inventory'

export const CATEGORY_ICON = { STATIONERY: PencilRuler, UNIFORM: Shirt, BOOKS: BookOpen, LAB: FlaskConical, CLEANING: SprayCan, SPORTS: Trophy, IT: Monitor, OTHER: Package }
export const ASSET_ICON = { FURNITURE: Armchair, IT: Monitor, AV: Projector, LAB: Microscope, SPORTS: Dumbbell, ELECTRICAL: Zap, MUSIC: Music, KITCHEN: CookingPot, OTHER: Package }

/** Labels for the store's fixed lists (shared values → this namespace's text). */
export function useInventoryLabels() {
  const { t } = useTranslation('inventory')
  return {
    cat: (v) => t(`inventory.categories.${v}`),
    unit: (v) => t(`inventory.units.${v}`),
    move: (v) => t(`inventory.moveTypes.${v}`),
    po: (v) => t(`inventory.poStatus.${v}`),
    sale: (v) => t(`inventory.saleStatus.${v}`),
    level: (v) => t(`inventory.levels.${v}`),
    reason: (v) => t(`inventory.adjustReasons.${v}`),
    issueTo: (v) => t(`inventory.issueTo.${v}`),
    count: (v) => t(`inventory.countStatus.${v}`),
    mode: (v) => t(`inventory.modes.${v}`),
    assetCat: (v) => t(`inventory.assetCategories.${v}`),
    assetStatus: (v) => t(`inventory.assetStatus.${v}`),
    cond: (v) => t(`inventory.conditions.${v}`),
    maint: (v) => t(`inventory.maintenanceKinds.${v}`),
    disposal: (v) => t(`inventory.disposalMethods.${v}`),
    warranty: (v) => t(`inventory.warranty.${v}`),
  }
}

export const useInventoryMeta = () => useQuery({ queryKey: ['inventory', 'meta'], queryFn: fetchInventoryMeta, staleTime: 60_000 })

export function PoPill({ status }) {
  const L = useInventoryLabels()
  return <StatusPill tone={PO_STATUS[status]?.tone ?? 'neutral'}>{L.po(status)}</StatusPill>
}
export function SalePill({ status }) {
  const L = useInventoryLabels()
  return <StatusPill tone={STORE_SALE_STATUS[status]?.tone ?? 'neutral'}>{L.sale(status)}</StatusPill>
}
export function LevelPill({ level }) {
  const L = useInventoryLabels()
  return <StatusPill tone={STOCK_LEVEL[level]?.tone ?? 'neutral'}>{L.level(level)}</StatusPill>
}
export function MovePill({ type }) {
  const L = useInventoryLabels()
  return <StatusPill tone={STORE_MOVE_TYPES[type]?.tone ?? 'neutral'}>{L.move(type)}</StatusPill>
}
export function CountPill({ status }) {
  const L = useInventoryLabels()
  return <StatusPill tone={STORE_COUNT_STATUS[status]?.tone ?? 'neutral'}>{L.count(status)}</StatusPill>
}
export function AssetPill({ status }) {
  const L = useInventoryLabels()
  return <StatusPill tone={ASSET_STATUS[status]?.tone ?? 'neutral'}>{L.assetStatus(status)}</StatusPill>
}
export function ConditionPill({ condition }) {
  const L = useInventoryLabels()
  return <StatusPill dot={false} tone={ASSET_CONDITIONS[condition]?.tone ?? 'neutral'}>{L.cond(condition)}</StatusPill>
}

/** Campus picker for a page header (only when more than one campus is open to the user). */
export function CampusSelect({ value, onChange, all = true, className }) {
  const { t } = useTranslation('inventory')
  const { data: meta } = useInventoryMeta()
  const branches = meta?.branches ?? []
  if (branches.length < 2 || meta?.branchLocked) return null
  return (
    <div className={clsx('w-48', className)}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('inventory.campus')}>
        {all && <option value="">{t('inventory.allCampuses')}</option>}
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
    </div>
  )
}

/** All active items (for pickers), optionally only the sellable ones, with stock in a campus. */
export function useItemOptions({ sellable = false, branchId } = {}) {
  return useQuery({
    queryKey: ['inventory', 'item-options', sellable, branchId ?? ''],
    queryFn: () => fetchItems({ sellable: sellable ? '1' : undefined, branchId: branchId || undefined, pageSize: 1000 }),
    staleTime: 30_000,
    select: (r) => r.data,
  })
}

/**
 * Item lines editor: item (searchable), size when the item has sizes, quantity and — for purchase orders — the
 * rate. `lines`: [{ itemId, size, qty, rate }] (rate in rupees, as typed). `errors` keyed `lines.<n>.<field>`.
 */
export function ItemLines({ lines, onChange, items = [], withRate = false, showStock = false, errors = {} }) {
  const { t } = useTranslation('inventory')
  const byId = new Map(items.map((i) => [i.id, i]))
  const set = (n, patch) => onChange(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)))
  return (
    <div className="space-y-2">
      {lines.map((l, n) => {
        const item = byId.get(l.itemId)
        const sizes = item?.sizes ?? []
        const have = item ? (sizes.length ? item.stockBySize?.[l.size] ?? 0 : item.stock) : null
        return (
          <div key={n} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto] sm:items-end sm:border-0 sm:p-0">
            <FormField label={n === 0 ? t('inventory.lines.item') : undefined} error={errors[`lines.${n}.itemId`]} className="col-span-2 sm:col-span-1">
              <Select value={l.itemId} onChange={(e) => {
                const it = byId.get(e.target.value)
                set(n, { itemId: e.target.value, size: '', ...(withRate && it && { rate: it.rate ? String(it.rate / 100) : '' }) })
              }}>
                <option value="">{t('inventory.lines.pickItem')}</option>
                {items.map((i) => <option key={i.id} value={i.id}>{`${i.name} · ${i.code}`}</option>)}
              </Select>
            </FormField>
            <FormField label={n === 0 ? t('inventory.lines.size') : undefined} error={errors[`lines.${n}.size`]}>
              {sizes.length
                ? <Select value={l.size} onChange={(e) => set(n, { size: e.target.value })}><option value="">{t('inventory.lines.pickSize')}</option>{sizes.map((s) => <option key={s.size} value={s.size}>{s.size}</option>)}</Select>
                : <Input value="—" disabled />}
            </FormField>
            <FormField label={n === 0 ? t('inventory.lines.qty') : undefined} error={errors[`lines.${n}.qty`]}
              hint={showStock && have != null ? t('inventory.lines.have', { n: have }) : undefined}>
              <Input type="number" min="1" value={l.qty} onChange={(e) => set(n, { qty: e.target.value })} />
            </FormField>
            <div className="flex items-end gap-2">
              {withRate && (
                <FormField label={n === 0 ? t('inventory.lines.rate') : undefined} className="w-28"><Input type="number" min="0" step="0.01" value={l.rate ?? ''} onChange={(e) => set(n, { rate: e.target.value })} /></FormField>
              )}
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('inventory.lines.remove')} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, i) => i !== n))} />
            </div>
          </div>
        )
      })}
      <Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...lines, { itemId: '', size: '', qty: 1, rate: '' }])}>{t('inventory.lines.add')}</Button>
    </div>
  )
}

/** Find a student by admission number or name (store counter). `onPick(student)` gets { id, name, admissionNo, class }. */
export function SaleStudentPicker({ value, onPick, error }) {
  const { t } = useTranslation('inventory')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found = [] } = useQuery({ queryKey: ['inventory', 'students', q], queryFn: () => searchSaleStudents(q), enabled: q.length >= 2 })
  const options = [...(value ? [value] : []), ...found.filter((s) => s.id !== value?.id)]
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={t('inventory.sales.find')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('inventory.sales.findPlaceholder')} autoFocus /></FormField>
      <FormField label={t('inventory.sales.student')} required error={error}>
        <Select value={value?.id ?? ''} onChange={(e) => onPick(options.find((s) => s.id === e.target.value) ?? null)}>
          <option value="">{q.length >= 2 || value ? t('inventory.sales.pick') : t('inventory.sales.typeFirst')}</option>
          {options.map((s) => <option key={s.id} value={s.id}>{[s.name, s.class, s.admissionNo].filter(Boolean).join(' · ')}</option>)}
        </Select>
      </FormField>
    </div>
  )
}

/** Rupees typed in a field → paise for the API ('' → null). */
export const paiseOf = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 100))
/** Paise → rupees for a field (null → ''). */
export const rupeesOf = (p) => (p == null ? '' : String(p / 100))
