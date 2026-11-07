import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import {
  ControlChip, DataTable, Drawer, FormField, Input, Note, PageContainer, PageHeader, Select, StatusPill, Toolbar, VerifiedBadge, ViewControls,
} from '../../components/system'
import { canPlatform } from '../../api/auth'
import Button from '../../components/ui/Button'
import { fetchSaPlans, fetchTenants, provisionTenant } from '../../api/superadmin'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { TENANT_STATUS, tenantStatusLabel } from './Dashboard'

function ProvisionDrawer({ open, onClose, plans, onDone }) {
  const { t } = useTranslation('superadmin')
  const blank = { institutionName: '', city: '', state: '', planCode: 'GROWTH', billingCycle: 'MONTHLY', trialDays: 14, adminName: '', adminEmail: '', adminMobile: '', adminPassword: '' }
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const { showError } = useSnackbar()
  useEffect(() => { if (open) { setForm(blank); setErrors({}) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const create = useMutation({
    mutationFn: () => provisionTenant({ ...form, trialDays: Number(form.trialDays) }),
    onSuccess: onDone,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Drawer open={open} onClose={onClose} title={t('superadmin.tenants.newInstitution')} subtitle={t('superadmin.tenants.createWorkspace')} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={create.isPending} disabled={!form.institutionName || !form.adminEmail || !form.adminName || !form.adminPassword} onClick={() => create.mutate()}>{t('superadmin.tenants.createWorkspaceBtn')}</Button></>}>
      <div className="space-y-6">
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('superadmin.common.institution')}</p>
          <FormField label={t('superadmin.tenants.institutionName')} required error={errors.institutionName}><Input value={form.institutionName} onChange={set('institutionName')} placeholder={t('superadmin.tenants.institutionNamePlaceholder')} /></FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={t('superadmin.tenants.city')}><Input value={form.city} onChange={set('city')} /></FormField>
            <FormField label={t('superadmin.tenants.state')}><Input value={form.state} onChange={set('state')} /></FormField>
          </div>
        </section>
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('superadmin.common.plan')}</p>
          <div className="grid grid-cols-3 gap-4">
            <FormField label={t('superadmin.common.plan')} required>
              <Select value={form.planCode} onChange={set('planCode')}>{plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>
            </FormField>
            <FormField label={t('superadmin.common.billing')}><Select value={form.billingCycle} onChange={set('billingCycle')}><option value="MONTHLY">{t('superadmin.cycle.MONTHLY')}</option><option value="YEARLY">{t('superadmin.cycle.YEARLY')}</option></Select></FormField>
            <FormField label={t('superadmin.common.trialDays')} error={errors.trialDays}><Input type="number" min="0" max="90" value={form.trialDays} onChange={set('trialDays')} /></FormField>
          </div>
        </section>
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('superadmin.tenants.firstAdmin')}</p>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={t('common.name')} required error={errors.adminName}><Input value={form.adminName} onChange={set('adminName')} /></FormField>
            <FormField label={t('superadmin.tenants.mobile')} error={errors.adminMobile}><Input value={form.adminMobile} onChange={set('adminMobile')} /></FormField>
          </div>
          <FormField label={t('superadmin.tenants.email')} required error={errors.adminEmail}><Input type="email" value={form.adminEmail} onChange={set('adminEmail')} /></FormField>
          <FormField label={t('superadmin.tenants.password')} required error={errors.adminPassword} hint={t('superadmin.tenants.passwordHint')}><Input value={form.adminPassword} onChange={set('adminPassword')} /></FormField>
        </section>
        <Note><Trans t={t} i18nKey="superadmin.tenants.oneRoleNote" components={{ b: <span className="font-medium" /> }} /></Note>
      </div>
    </Drawer>
  )
}

export default function Tenants() {
  const { t } = useTranslation('superadmin')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { date } = useFormat()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const status = params.get('status') || ''
  const planCode = params.get('plan') || ''
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, status, planCode])

  const query = { search: q, status, planCode, page, pageSize: 25 }
  const { data, isLoading } = useQuery({ queryKey: ['sa-tenants', query], queryFn: () => fetchTenants(query), placeholderData: (p) => p })
  const { data: plans = [] } = useQuery({ queryKey: ['sa-plans'], queryFn: fetchSaPlans })
  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n) }
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={Building2} title={t('superadmin.tenants.title')} subtitle={t('superadmin.tenants.subtitle')}
        actions={canPlatform('tenants.create') && <Button icon={Plus} onClick={() => setCreating(true)}>{t('superadmin.tenants.newInstitution')}</Button>} />
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        onRowClick={(r) => navigate(`/superadmin/tenants/${r.id}`)}
        toolbar={(
          <Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('superadmin.tenants.search')} right={(
            <ViewControls>
              <ControlChip label={t('common.status')} value={TENANT_STATUS[status] ? tenantStatusLabel(t, status) : t('superadmin.common.all')} active={!!status} options={[t('superadmin.common.all'), ...Object.keys(TENANT_STATUS).map((k) => tenantStatusLabel(t, k))]} onChange={(v) => setParam('status', Object.keys(TENANT_STATUS).find((k) => tenantStatusLabel(t, k) === v))} />
              <ControlChip label={t('superadmin.common.plan')} value={plans.find((p) => p.code === planCode)?.name ?? t('superadmin.common.all')} active={!!planCode} options={[t('superadmin.common.all'), ...plans.map((p) => p.name)]} onChange={(v) => setParam('plan', plans.find((p) => p.name === v)?.code)} />
            </ViewControls>
          )} />
        )}
        columns={[
          { key: 'name', header: t('superadmin.common.institution'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}{r.verified && <VerifiedBadge size="xs" className="ms-1" title={t('superadmin.verification.verified')} />}</p><p className="text-xs text-ink-faint">{[r.city, r.email].filter(Boolean).join(' · ')}</p></div> },
          { key: 'planName', header: t('superadmin.common.plan'), render: (v, r) => <div><p className="text-sm text-ink">{v}</p><p className="text-xs text-ink-faint">{r.billingCycle === 'YEARLY' ? t('superadmin.cycle.YEARLY') : t('superadmin.cycle.MONTHLY')}</p></div> },
          { key: 'status', header: t('common.status'), render: (v) => <StatusPill tone={TENANT_STATUS[v]?.tone}>{tenantStatusLabel(t, v)}</StatusPill> },
          { key: 'users', header: t('superadmin.common.users'), align: 'right', render: (v, r) => <span className={r.userLimit != null && v >= r.userLimit ? 'text-danger-600' : ''}>{v}<span className="text-ink-faint"> / {r.userLimit ?? '∞'}</span></span> },
          { key: 'mrr', header: t('superadmin.dashboard.mrr'), align: 'right', render: (v) => (v ? formatINR(v) : <span className="text-ink-faint">—</span>) },
          { key: 'currentPeriodEnd', header: t('superadmin.tenants.renews'), nowrap: true, mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{['TRIAL', 'TRIAL_EXPIRED'].includes(r.status) ? t('superadmin.tenants.trialUntil', { date: date(r.trialEndsAt) }) : v ? date(v) : '—'}</span> },
          { key: 'createdAt', header: t('superadmin.common.joined'), nowrap: true, mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{date(v)}</span> },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={Building2} emptyTitle={t('superadmin.tenants.empty')}
      />
      <ProvisionDrawer open={creating} plans={plans} onClose={() => setCreating(false)} onDone={(x) => {
        setCreating(false)
        qc.invalidateQueries({ queryKey: ['sa-tenants'] })
        qc.invalidateQueries({ queryKey: ['sa-dashboard'] })
        showSuccess(t('superadmin.tenants.created', { name: x.name, role: x.adminRole }))
        navigate(`/superadmin/tenants/${x.id}`)
      }} />
    </PageContainer>
  )
}
