import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, Clock, Crown, Gem, GraduationCap, IndianRupee, LayoutDashboard, PlayCircle, Receipt, Rocket, Sprout, TrendingUp } from 'lucide-react'
import { formatINR, formatINRCompact } from '@schoolgiant/shared'
import {
  Avatar, BreakdownDonut, CHART, ColorChip, DataTable, DateCell, MiniBarChart, PageContainer, PageHeader, RailList, StatCardRow, StatusPill, TrendArea,
} from '../../components/system'
import { canPlatform } from '../../api/auth'
import Button from '../../components/ui/Button'
import { fetchDashboard, runBilling } from '../../api/superadmin'
import { useSnackbar } from '../../context/SnackbarContext'

export const TENANT_STATUS = {
  TRIAL: { tone: 'info', label: 'Trial', color: CHART.status.info },
  ACTIVE: { tone: 'success', label: 'Active', color: CHART.status.good },
  PAST_DUE: { tone: 'warning', label: 'Past due', color: CHART.status.warning },
  TRIAL_EXPIRED: { tone: 'danger', label: 'Trial ended', color: '#9CA3AF' },
  SUSPENDED: { tone: 'danger', label: 'Suspended', color: CHART.status.critical },
  CANCELLED: { tone: 'neutral', label: 'Cancelled', color: '#D1D5DB' },
}

/** Translated tenant status label (keys superadmin.tenantStatus.<code>). */
export const tenantStatusLabel = (t, code) => t(`superadmin.tenantStatus.${code}`, { defaultValue: TENANT_STATUS[code]?.label ?? code })

// each plan's chip icon and colour (a plan added later gets a gem and a colour from its code)
const PLAN_LOOK = {
  STARTER: { icon: Sprout, tone: 'teal' },
  GROWTH: { icon: Rocket, tone: 'brand' },
  HIGHER_ED: { icon: GraduationCap, tone: 'violet' },
  ENTERPRISE: { icon: Crown, tone: 'orange' },
}
export const planLook = (code) => PLAN_LOOK[code] ?? { icon: Gem, seed: code }

/** A plan as a coloured chip with its icon. */
export function PlanChip({ code, name, sub }) {
  return <ColorChip label={name ?? code} sub={sub} {...planLook(code)} />
}

/** An institution's initials on a rounded tile, with its name (and a muted line) beside it. */
export function InstitutionCell({ name, sub, size = 36, badge }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-3 align-middle">
      <Avatar name={name} size={size} soft className="!rounded-xl" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink">{name || '—'}{badge}</span>
        {sub && <span className="block truncate text-[11.5px] text-ink-faint">{sub}</span>}
      </span>
    </span>
  )
}

const SOURCES = ['SIGNUP', 'SUPERADMIN', 'SEED']

const daysUntil = (d) => Math.ceil((+new Date(d) - Date.now()) / 864e5)

export default function Dashboard() {
  const { t } = useTranslation('superadmin')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: d, isLoading } = useQuery({ queryKey: ['sa-dashboard'], queryFn: fetchDashboard })
  const billing = useMutation({
    mutationFn: runBilling,
    onSuccess: (r) => { qc.invalidateQueries(); showSuccess(t('superadmin.dashboard.billingRun', { checked: r.checked, invoices: r.invoices, statusChanges: r.statusChanges })) },
    onError: (e) => showError(e.message),
  })

  if (isLoading || !d) return <PageContainer><div className="h-96 rounded-xl bg-black/5 animate-pulse" /></PageContainer>

  return (
    <PageContainer>
      <PageHeader icon={LayoutDashboard} title={t('superadmin.dashboard.title')} subtitle={t('superadmin.dashboard.subtitle')}
        actions={canPlatform('billing') && <Button variant="secondary" icon={PlayCircle} loading={billing.isPending} onClick={() => billing.mutate()}>{t('superadmin.dashboard.runBilling')}</Button>} />

      <StatCardRow items={[
        { icon: TrendingUp, label: t('superadmin.dashboard.mrr'), value: formatINRCompact(d.mrr), sub: t('superadmin.dashboard.mrrSub', { arr: formatINRCompact(d.arr), monthly: formatINR(Math.round(d.mrr / 100) * 100) }), tone: 'brand', trend: d.signupsByWeek.map((w) => w.signups) },
        { icon: Building2, label: t('superadmin.dashboard.payingInstitutions'), value: d.payingTenants, sub: t('superadmin.dashboard.institutionsInTotal', { count: d.tenants }), tone: 'success', onClick: () => navigate('/superadmin/tenants?status=ACTIVE') },
        { icon: Clock, label: t('superadmin.dashboard.onTrial'), value: d.byStatus.TRIAL ?? 0, sub: t('superadmin.dashboard.endingWithin7', { count: d.trialsEnding.length }), tone: 'info', onClick: () => navigate('/superadmin/tenants?status=TRIAL') },
        { icon: Receipt, label: t('superadmin.dashboard.outstanding'), value: formatINRCompact(d.outstanding), sub: t('superadmin.dashboard.unpaidInvoices', { count: d.outstandingCount }), tone: d.outstanding ? 'warning' : 'neutral', onClick: () => navigate('/superadmin/invoices?status=DUE') },
        { icon: IndianRupee, label: t('superadmin.dashboard.collected30d'), value: formatINRCompact(d.collected30d), sub: t('superadmin.dashboard.paymentsRecorded'), tone: 'success', onClick: () => navigate('/superadmin/invoices?status=PAID') },
      ]} />

      <div className="grid xl:grid-cols-3 gap-6">
        <TrendArea className="xl:col-span-2" title={t('superadmin.dashboard.newPerWeek')} subtitle={t('superadmin.dashboard.newPerWeekSub')} data={d.signupsByWeek.map((w) => ({ label: w.label, value: w.signups }))} series={[{ key: 'value', name: t('superadmin.dashboard.newInstitutions') }]} />
        <BreakdownDonut title={t('superadmin.dashboard.byStatus')} centerLabel={t('superadmin.dashboard.institutionsCenter')}
          segments={Object.entries(d.byStatus).filter(([, n]) => n > 0).map(([k, n]) => ({ name: tenantStatusLabel(t, k), value: n, color: TENANT_STATUS[k]?.color }))} />
      </div>

      <div className="grid xl:grid-cols-3 gap-6">
        <MiniBarChart title={t('superadmin.dashboard.mrrByPlan')} subtitle={t('superadmin.dashboard.mrrByPlanSub')} data={d.byPlan.map((p) => ({ label: p.name, value: p.mrr }))} valueFormat={(v) => formatINRCompact(v)} />
        <RailList title={t('superadmin.dashboard.needsAttention')} icon={AlertTriangle} empty={t('superadmin.dashboard.allGood')}
          rows={d.attention.map((x) => ({ id: x.id, label: x.name, value: tenantStatusLabel(t, x.status), tone: TENANT_STATUS[x.status]?.tone }))}
          onRowClick={(r) => navigate(`/superadmin/tenants/${r.id}`)} />
        <RailList title={t('superadmin.dashboard.trialsEnding')} icon={Clock} empty={t('superadmin.dashboard.noTrialsEnding')}
          rows={d.trialsEnding.map((x) => { const n = daysUntil(x.trialEndsAt); return { id: x.id, label: x.name, value: n <= 0 ? t('superadmin.dashboard.today') : t('superadmin.dashboard.days', { count: n }), tone: n <= 2 ? 'danger' : 'warning' } })}
          onRowClick={(r) => navigate(`/superadmin/tenants/${r.id}`)} />
      </div>

      <DataTable
        title={t('superadmin.dashboard.newest')}
        rows={d.recent}
        onRowClick={(r) => navigate(`/superadmin/tenants/${r.id}`)}
        columns={[
          { key: 'name', header: t('superadmin.common.institution'), mobilePrimary: true, render: (v) => <InstitutionCell name={v} size={30} /> },
          { key: 'planCode', header: t('superadmin.common.plan'), render: (v) => <PlanChip code={v} name={d.byPlan.find((p) => p.code === v)?.name} /> },
          { key: 'status', header: t('common.status'), render: (v) => <StatusPill tone={TENANT_STATUS[v]?.tone}>{tenantStatusLabel(t, v)}</StatusPill> },
          { key: 'createdVia', header: t('superadmin.common.source'), render: (v) => (v ? <ColorChip label={SOURCES.includes(v) ? t(`superadmin.dashboard.source.${v}`) : v} seed={v} dot /> : <span className="text-ink-faint">—</span>) },
          { key: 'createdAt', header: t('superadmin.common.joined'), nowrap: true, render: (v) => <DateCell value={v} /> },
        ]}
      />
    </PageContainer>
  )
}
