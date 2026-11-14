import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Package, PackagePlus, RotateCcw } from 'lucide-react'
import { ASSET_CATEGORIES } from '@schoolgiant/shared'
import { CodeBadge, FormPage, Money, Note, Panel, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import AssetForm, { assetBody, assetFormValues } from '../../components/inventory/AssetForm'
import { ASSET_ICON, AssetPill, useInventoryLabels } from '../../components/inventory/InventoryKit'
import { fetchAssets, saveAsset } from '../../api/inventory'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

/** What to look up while typing: the serial number (3+ characters) beats the name (3+ letters). */
function probeOf(form) {
  const serial = form.serialNo.trim()
  if (serial.length >= 3) return { search: serial, by: 'serial' }
  const name = form.name.trim()
  return name.length >= 3 ? { search: name, by: 'name' } : null
}

/** Right-hand panel: assets already in the register with this serial number or a similar name. */
function AlreadyHere({ form }) {
  const { t } = useTranslation('inventory')
  const probe = probeOf(form)
  const key = useDebouncedValue(probe ? JSON.stringify(probe) : '', 450)
  const p = key ? JSON.parse(key) : null
  const { data, isFetching } = useQuery({
    queryKey: ['inventory', 'assets', 'add-check', key],
    queryFn: () => fetchAssets({ search: p.search, status: 'ALL' }),
    enabled: !!p,
    placeholderData: keepPreviousData,
  })
  const all = !p ? [] : (data?.data ?? []).filter((a) => p.by !== 'serial' || String(a.serialNo ?? '').toLowerCase().includes(p.search.toLowerCase()))
  const rows = all.slice(0, 5)

  if (!rows.length) {
    return (
      <Panel title={t('inventory.assets.check.title')}>
        <p className="text-sm text-ink-muted">{p && isFetching ? t('inventory.assets.check.checking') : t('inventory.assets.check.empty')}</p>
      </Panel>
    )
  }
  const serial = p.by === 'serial'
  return (
    <SectionCard icon={Package} tone={serial ? 'warning' : 'neutral'} title={serial ? t('inventory.assets.check.foundSerial') : t('inventory.assets.check.foundName')} count={all.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{serial ? t('inventory.assets.check.serialHint') : t('inventory.assets.check.nameHint')}</p>
      <ul className="divide-y divide-border">
        {rows.map((a) => {
          const Icon = ASSET_ICON[a.category] ?? Package
          return (
            <li key={a.id}>
              <Link to="/inventory/assets" state={{ open: a.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg">
                <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{a.name}</span>
                  <span className="block truncate text-xs text-ink-faint">{[a.assetTag, a.serialNo, a.roomName ?? a.location].filter(Boolean).join(' · ')}</span>
                </span>
                <AssetPill status={a.status} />
              </Link>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}

/** Right-hand panel: what the register already holds in the chosen category, and the last tag given. */
function CategoryNow({ category }) {
  const { t } = useTranslation('inventory')
  const L = useInventoryLabels()
  const { data } = useQuery({
    queryKey: ['inventory', 'assets', 'add-category', category],
    queryFn: () => fetchAssets({ category, status: 'ALL' }),
    placeholderData: keepPreviousData,
  })
  const Icon = ASSET_ICON[category] ?? Package
  const sum = data?.summary?.byCategory?.[category]
  const lastTag = (data?.data ?? []).filter((a) => a.category === category).map((a) => a.assetTag).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).at(-1)
  const life = ASSET_CATEGORIES.find((c) => c.value === category)?.lifeYears
  return (
    <Panel icon={Icon} title={t('inventory.assets.check.inCategory', { category: L.assetCat(category) })}>
      {sum?.count ? (
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-ink-muted">{t('inventory.assets.countN')}</dt><dd className="font-medium tabular-nums">{sum.count}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-muted">{t('inventory.assets.bookValue')}</dt><dd><Money value={sum.bookValue} paise /></dd></div>
          {lastTag && <div className="flex justify-between gap-3"><dt className="text-ink-muted">{t('inventory.assets.check.lastTag')}</dt><dd><CodeBadge>{lastTag}</CodeBadge></dd></div>}
        </dl>
      ) : <p className="text-sm text-ink-muted">{t('inventory.assets.check.firstInCategory')}</p>}
      {life && <p className="mt-2 text-xs text-ink-faint">{t('inventory.assets.check.lifeNote', { n: life })}</p>}
    </Panel>
  )
}

/** Store › Asset register › New asset: one form; the tag comes from the category's number series unless typed. */
export default function NewAsset() {
  const { t } = useTranslation('inventory')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => assetFormValues(null))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => saveAsset(null, assetBody(form)),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      showSuccess(t('inventory.assets.saved'))
      navigate('/inventory/assets', { state: { open: a.id } })
    },
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const clear = () => { setForm(assetFormValues(null)); setErrors({}) }

  return (
    <FormPage
      icon={PackagePlus} title={t('inventory.assets.newTitle')} subtitle={t('inventory.assets.form.subtitle')}
      headerActions={<Button to="/inventory/assets" variant="secondary" icon={Package}>{t('inventory.assets.pageTitle')}</Button>}
      errors={errors}
      submitLabel={t('inventory.assets.form.save')} submitIcon={PackagePlus} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={!!form.name.trim()}
      cancelLabel={t('inventory.assets.form.clear')} cancelIcon={RotateCcw} onCancel={clear}
      aside={<>
        <AlreadyHere form={form} />
        <CategoryNow category={form.category} />
        <Note icon={Package}>{t('inventory.assets.form.requiredNote')}</Note>
      </>}
    >
      <AssetForm value={form} onChange={setForm} errors={errors} />
    </FormPage>
  )
}
