import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Percent, Plus, Tag, TicketPercent } from 'lucide-react'
import { ColorChip, DataTable, DateCell, Drawer, ExpiryBadge, FormField, Input, LevelBar, PageContainer, PageHeader, StatusPill } from '../../components/system'
import { canPlatform } from '../../api/auth'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { createCoupon, fetchCoupons, fetchSaPlans, updateCoupon } from '../../api/superadmin'
import { useSnackbar } from '../../context/SnackbarContext'
import { PlanChip } from './Dashboard'

const BLANK = { code: '', pct: 10, description: '', planCodes: [], validUntil: '', maxUses: '', active: true }

/** Create or edit a coupon: % off one invoice when an institution subscribes or changes plan. */
function CouponEditor({ coupon, plans, onClose, onSaved }) {
  const { t } = useTranslation('superadmin')
  const isNew = !coupon
  const [form, setForm] = useState(() => (coupon ? { ...BLANK, ...coupon, validUntil: coupon.validUntil?.slice(0, 10) ?? '', maxUses: coupon.maxUses ?? '' } : BLANK))
  const [errors, setErrors] = useState({})
  const { showError } = useSnackbar()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const togglePlan = (code) => setForm((f) => ({ ...f, planCodes: f.planCodes.includes(code) ? f.planCodes.filter((c) => c !== code) : [...f.planCodes, code] }))
  const save = useMutation({
    mutationFn: () => {
      const body = { pct: Number(form.pct), description: form.description, planCodes: form.planCodes, validUntil: form.validUntil || null, maxUses: form.maxUses === '' ? null : Number(form.maxUses), active: form.active }
      return isNew ? createCoupon({ ...body, code: form.code }) : updateCoupon(coupon.id, body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Drawer open onClose={onClose} title={isNew ? t('superadmin.coupons.newTitle') : coupon.code} subtitle={t('superadmin.coupons.subtitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button icon={Check} loading={save.isPending} disabled={(isNew && !form.code) || !(Number(form.pct) >= 1 && Number(form.pct) <= 100)} onClick={() => save.mutate()}>{t('superadmin.coupons.save')}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('superadmin.coupons.code')} required error={errors.code}><Input value={form.code} disabled={!isNew} onChange={(e) => set('code')(e.target.value.toUpperCase())} placeholder="WELCOME10" /></FormField>
          <FormField label={t('superadmin.coupons.pct')} required error={errors.pct}><Input type="number" min="1" max="100" value={form.pct} onChange={set('pct')} /></FormField>
        </div>
        <FormField label={t('superadmin.coupons.description')} error={errors.description}><Input value={form.description ?? ''} onChange={set('description')} maxLength={200} /></FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('superadmin.coupons.validUntil')} hint={t('superadmin.coupons.validUntilHint')}><Input type="date" value={form.validUntil} onChange={set('validUntil')} /></FormField>
          <FormField label={t('superadmin.coupons.maxUses')} hint={t('superadmin.coupons.maxUsesHint')}><Input type="number" min="1" value={form.maxUses} onChange={set('maxUses')} /></FormField>
        </div>
        <FormField label={t('superadmin.coupons.plans')} hint={t('superadmin.coupons.plansHint')}>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => (
              <label key={p.code} className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border text-sm text-ink hover:border-brand-300 cursor-pointer">
                <input type="checkbox" checked={form.planCodes.includes(p.code)} onChange={() => togglePlan(p.code)} className="rounded border-border text-brand-500 focus:ring-brand-500" /> {p.name}
              </label>
            ))}
          </div>
        </FormField>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 h-10 text-sm text-ink">{t('superadmin.coupons.active')} <Switch checked={form.active} onChange={set('active')} label={t('superadmin.coupons.active')} /></label>
      </div>
    </Drawer>
  )
}

export default function Coupons() {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['sa-coupons'], queryFn: fetchCoupons })
  const { data: plans = [] } = useQuery({ queryKey: ['sa-plans'], queryFn: fetchSaPlans })
  const [editing, setEditing] = useState(null)
  const planName = (code) => plans.find((p) => p.code === code)?.name ?? code
  const expired = (c) => c.validUntil && new Date(c.validUntil) < new Date()
  const usedUp = (c) => c.maxUses != null && c.uses >= c.maxUses
  return (
    <PageContainer>
      <PageHeader icon={Tag} title={t('superadmin.coupons.title')} subtitle={t('superadmin.coupons.pageSubtitle')} actions={canPlatform('coupons') && <Button icon={Plus} onClick={() => setEditing('new')}>{t('superadmin.coupons.add')}</Button>} />
      <DataTable
        rows={rows}
        loading={isLoading}
        onRowClick={canPlatform('coupons') ? setEditing : undefined}
        columns={[
          { key: 'code', header: t('superadmin.coupons.code'), mobilePrimary: true, render: (v, r) => (
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 bg-pink-50 text-pink-700 border-pink-200"><TicketPercent className="w-4 h-4" /></span>
              <div className="min-w-0"><p className="font-mono-num font-semibold tracking-wide text-ink">{v}</p>{r.description && <p className="text-xs text-ink-muted line-clamp-1">{r.description}</p>}</div>
            </div>
          ) },
          { key: 'pct', header: t('superadmin.coupons.off'), align: 'right', render: (v) => <ColorChip label={`${v}%`} tone="pink" icon={Percent} /> },
          { key: 'planCodes', header: t('superadmin.coupons.plans'), mobileHidden: true, render: (v) => (v?.length ? <div className="flex flex-wrap gap-1">{v.map((c) => <PlanChip key={c} code={c} name={planName(c)} />)}</div> : <span className="text-sm text-ink-muted">{t('superadmin.coupons.allPlans')}</span>) },
          { key: 'uses', header: t('superadmin.coupons.uses'), align: 'right', render: (v, r) => (r.maxUses != null ? <LevelBar value={v} max={r.maxUses} highIsBad warnAt={r.maxUses * 0.8} dangerAt={r.maxUses} width="w-24" /> : <span className="font-semibold tabular-nums text-ink">{v}</span>) },
          { key: 'validUntil', header: t('superadmin.coupons.validUntil'), mobileHidden: true, render: (v, r) => (v ? (r.active ? <ExpiryBadge value={v} warnDays={14} dangerDays={3} /> : <DateCell value={v} relative={false} />) : '—') },
          { key: 'active', header: t('common.status'), render: (v, r) => <StatusPill tone={v && !expired(r) && !usedUp(r) ? 'success' : 'neutral'}>{!v ? t('superadmin.coupons.off_status') : expired(r) ? t('superadmin.coupons.expired') : usedUp(r) ? t('superadmin.coupons.usedUp') : t('superadmin.coupons.live')}</StatusPill> },
        ]}
        emptyIcon={Tag} emptyTitle={t('superadmin.coupons.empty')} emptyHint={t('superadmin.coupons.emptyHint')}
      />
      {editing && <CouponEditor coupon={editing === 'new' ? null : editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['sa-coupons'] }); showSuccess(t('superadmin.coupons.saved')) }} />}
    </PageContainer>
  )
}
