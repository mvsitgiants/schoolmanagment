import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Layers, Pencil, Plus, Star } from 'lucide-react'
import { CATEGORIES, closeOverDependencies, formatINR } from '@schoolgiant/shared'
import { Drawer, FormField, Input, Note, PageContainer, PageHeader, Select, StatusPill, Textarea } from '../../components/system'
import { canPlatform } from '../../api/auth'
import Button from '../../components/ui/Button'
import { Switch, Tick } from '../../components/app/Controls'
import { createPlan, fetchSaCatalog, fetchSaPlans, updatePlan } from '../../api/superadmin'
import { useSnackbar } from '../../context/SnackbarContext'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const SWITCHES = ['isPublic', 'active', 'highlight']

const rupees = (p) => (p == null ? '' : String(p / 100))

function PlanEditor({ plan, plans, catalog, onClose, onSaved }) {
  const { t } = useTranslation('superadmin')
  // plan prices are what we bill institutions — always in rupees, whatever an institution's own currency is
  const cl = useCatalogLabel()
  const isNew = !plan?.code
  const [form, setForm] = useState(() => ({
    code: '', name: '', tagline: '', trialDays: 14, isPublic: true, active: true, highlight: false, sortOrder: 10,
    limits: { users: 10, branches: 1, beds: 0, storageGb: 10 }, features: [], modules: [],
    ...plan,
    priceMonthly: rupees(plan?.priceMonthly ?? 0), priceYearly: rupees(plan?.priceYearly ?? 0),
    featuresText: (plan?.features ?? []).join('\n'),
  }))
  const { showError } = useSnackbar()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const picked = useMemo(() => new Set(form.modules), [form.modules])
  const effective = useMemo(() => new Set(closeOverDependencies(form.modules)), [form.modules])
  const toggle = (id) => setForm((f) => ({ ...f, modules: picked.has(id) ? f.modules.filter((m) => m !== id) : [...f.modules, id] }))

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code, name: form.name, tagline: form.tagline, trialDays: Number(form.trialDays),
        priceMonthly: Math.round(Number(form.priceMonthly) * 100), priceYearly: Math.round(Number(form.priceYearly) * 100),
        limits: Object.fromEntries(Object.entries(form.limits).map(([k, v]) => [k, Number(v)])),
        modules: [...effective], features: form.featuresText.split('\n').map((s) => s.trim()).filter(Boolean),
        isPublic: form.isPublic, active: form.active, highlight: form.highlight, sortOrder: Number(form.sortOrder),
        renewsInto: form.renewsInto || '',
      }
      return isNew ? createPlan(body) : updatePlan(plan.code, body)
    },
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })

  return (
    <Drawer open onClose={onClose} size="xl" subtitle={isNew ? t('superadmin.plans.newPlan') : t('superadmin.plans.planInstitutions', { count: plan.tenantCount })} title={isNew ? t('superadmin.plans.createTitle') : plan.name}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!form.name || (isNew && !form.code) || !form.modules.length} onClick={() => save.mutate()}>{isNew ? t('superadmin.plans.create') : t('superadmin.plans.save')}</Button></>}>
      <div className="space-y-6">
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('superadmin.plans.code')} required hint={t('superadmin.plans.codeHint')}><Input value={form.code} disabled={!isNew} onChange={(e) => set('code')(e.target.value.toUpperCase())} placeholder="CLINIC_PLUS" /></FormField>
          <FormField label={t('common.name')} required><Input value={form.name} onChange={set('name')} /></FormField>
          <FormField label={t('superadmin.common.trialDays')}><Input type="number" min="0" max="90" value={form.trialDays} onChange={set('trialDays')} /></FormField>
        </div>
        <FormField label={t('superadmin.plans.tagline')}><Input value={form.tagline ?? ''} onChange={set('tagline')} placeholder={t('superadmin.plans.taglinePlaceholder')} /></FormField>
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('superadmin.plans.priceMonthCur', 'Price per month ({{cur}})', { cur: '₹' })} hint={t('superadmin.plans.beforeGst')}><Input type="number" min="0" value={form.priceMonthly} onChange={set('priceMonthly')} /></FormField>
          <FormField label={t('superadmin.plans.priceYearCur', 'Price per year ({{cur}})', { cur: '₹' })} hint={Number(form.priceMonthly) ? t('superadmin.plans.offMonthly', { pct: Math.round((1 - Number(form.priceYearly) / (Number(form.priceMonthly) * 12)) * 100) }) : ''}><Input type="number" min="0" value={form.priceYearly} onChange={set('priceYearly')} /></FormField>
          <FormField label={t('superadmin.plans.sortOrder')}><Input type="number" value={form.sortOrder} onChange={set('sortOrder')} /></FormField>
        </div>
        {/* retiring a plan: its institutions move to another at their next renewal */}
        <FormField label={t('superadmin.plans.renewsInto')} hint={t(form.active ? 'superadmin.plans.renewsIntoHintActive' : 'superadmin.plans.renewsIntoHint')}>
          <Select value={form.renewsInto ?? ''} onChange={set('renewsInto')}>
            <option value="">{t('superadmin.plans.renewsIntoNone')}</option>
            {plans.filter((p) => p.active && p.code !== form.code).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </Select>
        </FormField>
        <div>
          <p className="text-sm font-medium text-ink mb-2">{t('superadmin.plans.limits')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {catalog.limitKeys.map((l) => (
              <FormField key={l.key} label={`${t(`superadmin.limits.${l.key}`, { defaultValue: l.label })}${l.unit ? ` (${l.unit})` : ''}`}><Input type="number" min="0" value={form.limits[l.key] ?? 0} onChange={(e) => setForm((f) => ({ ...f, limits: { ...f.limits, [l.key]: e.target.value } }))} /></FormField>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium text-ink">{t('superadmin.common.modules')}</p>
            <p className="text-xs text-ink-muted">{t('superadmin.plans.includedCount', { count: effective.size })}</p>
          </div>
          <div className="space-y-4">
            {CATEGORIES.map((c) => {
              const mods = catalog.modules.filter((m) => m.category === c.id)
              return (
                <div key={c.id}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-1.5 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />{cl.category(c)}</p>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {mods.map((m) => {
                      const Icon = iconFor(m.icon)
                      const auto = !picked.has(m.id) && effective.has(m.id)
                      const on = picked.has(m.id) || effective.has(m.id)
                      return (
                        <div key={m.id} className={clsx('flex items-center gap-2.5 rounded-md border px-2.5 py-1.5', on ? 'border-brand-200 bg-brand-50/40' : 'border-border')}>
                          <Tick state={on} disabled={m.mandatory || auto} onClick={() => toggle(m.id)} label={cl.module(m.id)} size={16} />
                          <Icon className="w-4 h-4 text-ink-muted" />
                          <span className="text-sm text-ink flex-1">{cl.module(m.id)}</span>
                          {m.mandatory && <span className="text-[10px] text-ink-faint">{t('superadmin.plans.always')}</span>}
                          {auto && !m.mandatory && <span className="text-[10px] text-ink-faint">{t('superadmin.plans.needed')}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <FormField label={t('superadmin.plans.features')} hint={t('superadmin.plans.onePerLine')}><Textarea rows={5} value={form.featuresText} onChange={set('featuresText')} /></FormField>
        <div className="grid sm:grid-cols-3 gap-3">
          {SWITCHES.map((k) => [k, t(`superadmin.plans.switch.${k}`), t(`superadmin.plans.switch.${k}Hint`)]).map(([k, l, h]) => (
            <label key={k} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span><span className="block text-sm font-medium text-ink">{l}</span><span className="block text-xs text-ink-muted">{h}</span></span>
              <Switch checked={!!form[k]} onChange={(v) => set(k)(v)} label={l} />
            </label>
          ))}
        </div>
        {!isNew && plan.tenantCount > 0 && <Note tone="warning">{t('superadmin.plans.inUseNote', { count: plan.tenantCount })}</Note>}
      </div>
    </Drawer>
  )
}

export default function Plans() {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { data: plans = [], isLoading } = useQuery({ queryKey: ['sa-plans'], queryFn: fetchSaPlans })
  const { data: catalog } = useQuery({ queryKey: ['sa-catalog'], queryFn: fetchSaCatalog })
  const [editing, setEditing] = useState(null)

  return (
    <PageContainer>
      <PageHeader icon={Layers} title={t('superadmin.plans.title')} subtitle={t('superadmin.plans.subtitle')}
        actions={canPlatform('plans') && <Button icon={Plus} onClick={() => setEditing({})}>{t('superadmin.plans.newPlan')}</Button>} />
      {isLoading ? <div className="h-64 rounded-xl bg-black/5 animate-pulse" /> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((p) => (
            <article key={p.code} className={clsx('rounded-xl border bg-surface shadow-card p-5 flex flex-col', !p.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink flex items-center gap-1.5">{p.name}{p.highlight && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}</h3>
                  <p className="text-xs text-ink-faint font-mono-num">{p.code}</p>
                </div>
                <div className="flex gap-1">{!p.isPublic && <StatusPill tone="neutral">{t('superadmin.plans.private')}</StatusPill>}{!p.active && <StatusPill tone="danger">{t('superadmin.common.inactive')}</StatusPill>}</div>
              </div>
              <p className="mt-3"><span className="font-display text-2xl font-semibold text-ink">{formatINR(p.priceMonthly)}</span><span className="text-xs text-ink-faint"> {t('superadmin.plans.perMonth')}</span></p>
              <p className="text-xs text-ink-faint">{t('superadmin.plans.perYear', { price: formatINR(p.priceYearly) })}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-[11px] text-ink-faint uppercase tracking-wide">{t('superadmin.plans.institutions')}</dt><dd className="font-medium text-ink">{p.tenantCount}</dd></div>
                <div><dt className="text-[11px] text-ink-faint uppercase tracking-wide">{t('superadmin.common.modules')}</dt><dd className="font-medium text-ink">{p.modules.length}</dd></div>
                <div><dt className="text-[11px] text-ink-faint uppercase tracking-wide">{t('superadmin.limits.users')}</dt><dd className="font-medium text-ink">{p.limits.users}</dd></div>
                <div><dt className="text-[11px] text-ink-faint uppercase tracking-wide">{t('superadmin.limits.beds')}</dt><dd className="font-medium text-ink">{p.limits.beds}</dd></div>
              </dl>
              <ul className="mt-4 space-y-1 flex-1">{p.features.slice(0, 4).map((f) => <li key={f} className="text-xs text-ink-muted flex gap-1.5"><Check className="w-3.5 h-3.5 text-brand-500 shrink-0" />{f}</li>)}</ul>
              {canPlatform('plans') && <Button variant="secondary" icon={Pencil} className="mt-4" onClick={() => setEditing(p)}>{t('superadmin.plans.edit')}</Button>}
            </article>
          ))}
        </div>
      )}
      {editing && catalog && <PlanEditor plan={editing.code ? editing : null} plans={plans} catalog={catalog} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['sa-plans'] }); showSuccess(t('superadmin.plans.saved')) }} />}
    </PageContainer>
  )
}
