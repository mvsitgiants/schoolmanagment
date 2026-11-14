import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardList, History, Receipt, RotateCcw, ShoppingBag, ShoppingCart } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { CodeBadge, DateCell, FormPage, Money, Note, Panel, SectionCard, Totals } from '../../components/system'
import Button from '../../components/ui/Button'
import PoForm, { poBody, poFormValues, poReady, poTotals } from '../../components/inventory/PoForm'
import { PoPill, useInventoryMeta } from '../../components/inventory/InventoryKit'
import { fetchPos, savePo } from '../../api/inventory'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/** Right-hand panel: the order's figures as they are typed — items, quantity, value before tax, tax, total. */
function OrderTotal({ form }) {
  const { t } = useTranslation('inventory')
  const { data: meta } = useInventoryMeta()
  const sum = poTotals(form)
  const unpriced = form.lines.some((l) => l.itemId && l.rate === '')
  const overLimit = hasPermission('inventory.purchase-orders.approve') && meta?.poApproveMax != null && sum.total > meta.poApproveMax
  return (
    <Panel icon={Receipt} title={t('inventory.po.form.totalTitle')}>
      <Totals paise wide rows={[
        { key: 'items', label: t('inventory.po.form.itemsN'), value: t('inventory.po.form.itemsQty', { count: sum.lines, lines: sum.lines, qty: sum.qty }) },
        { key: 'sub', label: t('inventory.po.form.subtotal'), value: sum.subtotal },
        { key: 'tax', label: t('inventory.po.tax'), value: sum.tax, muted: !sum.tax },
        { key: 'total', label: t('inventory.po.total'), value: sum.total, total: true },
      ]} />
      {unpriced && <p className="mt-3 text-xs text-ink-faint">{t('inventory.po.form.unpriced')}</p>}
      {overLimit && <Note tone="warning" className="mt-3">{t('inventory.po.overLimit', { limit: formatINR(meta.poApproveMax) })}</Note>}
    </Panel>
  )
}

/** Right-hand panel: the chosen vendor's contact and their last few orders (open one to copy rates or terms). */
function VendorRecent({ vendorId }) {
  const { t } = useTranslation('inventory')
  const { data: meta } = useInventoryMeta()
  const vendor = (meta?.vendors ?? []).find((v) => v.id === vendorId)
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'pos', 'vendor-recent', vendorId],
    queryFn: () => fetchPos({ vendorId, status: 'ALL', pageSize: 5 }),
    enabled: !!vendorId,
  })
  if (!vendorId) {
    return (
      <Panel icon={History} title={t('inventory.po.form.recentTitle')}>
        <p className="text-sm text-ink-muted">{t('inventory.po.form.recentPick')}</p>
      </Panel>
    )
  }
  const rows = data?.data ?? []
  const contact = [vendor?.contactPerson, vendor?.phone].filter(Boolean).join(' · ')
  return (
    <SectionCard icon={History} title={t('inventory.po.form.recentFrom', { name: vendor?.name ?? '' })} count={data ? data.total : undefined} flush>
      {contact && <p className="px-4 pt-3 text-xs text-ink-muted">{contact}</p>}
      {isLoading ? <p className="px-4 py-3 text-sm text-ink-muted">{t('inventory.loading')}</p> : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">{t('inventory.po.form.recentNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((po) => (
            <li key={po.id}>
              <Link to="/inventory/purchase-orders" state={{ open: po.id }} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-bg">
                <span className="min-w-0">
                  <span className="flex items-center gap-2"><CodeBadge>{po.poNo}</CodeBadge><PoPill status={po.status} /></span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint"><DateCell value={po.date} relative={false} /> · {t('inventory.po.linesN', { n: po.lines.length })}</span>
                </span>
                <Money value={po.total} paise />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/** Store › Purchase orders › New: vendor, items with rates, tax and terms — saved as a draft to send for approval. */
export default function NewPurchaseOrder() {
  const { t } = useTranslation('inventory')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: meta } = useInventoryMeta()
  const [form, setForm] = useState(() => poFormValues(null, meta))
  const [errors, setErrors] = useState({})
  // the campus defaults to the user's own once the pickers have loaded
  useEffect(() => { if (meta?.myBranchId) setForm((f) => (f.branchId ? f : { ...f, branchId: meta.myBranchId })) }, [meta?.myBranchId])
  const save = useMutation({
    mutationFn: () => savePo(null, poBody(form)),
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      showSuccess(t('inventory.po.saved', { no: po.poNo }))
      navigate('/inventory/purchase-orders', { state: { open: po.id } })
    },
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const clear = () => { setForm(poFormValues(null, meta)); setErrors({}) }

  return (
    <FormPage
      icon={ShoppingCart} title={t('inventory.po.newTitle')} subtitle={t('inventory.po.form.subtitle')}
      headerActions={<Button to="/inventory/purchase-orders" variant="secondary" icon={ShoppingBag}>{t('inventory.po.pageTitle')}</Button>}
      errors={errors}
      submitLabel={t('inventory.po.saveDraft')} submitIcon={ClipboardList} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={poReady(form)}
      cancelLabel={t('inventory.po.form.clear')} cancelIcon={RotateCcw} onCancel={clear}
      aside={<>
        <OrderTotal form={form} />
        <VendorRecent vendorId={form.vendorId} />
        <Note icon={ClipboardList}>{t('inventory.po.form.requiredNote')}</Note>
      </>}
    >
      <PoForm value={form} onChange={setForm} errors={errors} />
    </FormPage>
  )
}
