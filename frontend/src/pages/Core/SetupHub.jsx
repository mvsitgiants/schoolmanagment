import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import {
  Activity,
  ArrowRight,
  Award,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Compass,
  CreditCard,
  FileCheck2,
  FileText,
  Institution,
  Key,
  Layers,
  LayoutDashboard,
  Palette,
  Phone,
  Plus,
  Printer,
  Rocket,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import { MODULE_BY_ID } from '@schoolgiant/shared'
import { PageContainer } from '../../components/system'
import Button from '../../components/ui/Button'
import { createRolesFromTemplates, fetchRoleTemplates, fetchRoles, fetchSetup } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import useAuthUser from '../../hooks/useAuthUser'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const SUGGESTED = ['FRONT_DESK', 'CONSULTANT', 'STAFF_NURSE', 'CASHIER', 'LAB_TECH', 'PHARMACIST']

// Step visual tokens and metadata
const STEP_META = {
  profile: {
    icon: Building2,
    badge: 'Identity & Info',
    accent: 'text-brand-600 bg-brand-50 border-brand-200/80',
    number: '01',
    estTime: '2 min',
  },
  branding: {
    icon: Palette,
    badge: 'Logo & Colors',
    accent: 'text-brand-600 bg-brand-50 border-brand-200/80',
    number: '02',
    estTime: '1 min',
  },
  departments: {
    icon: Stethoscope,
    badge: 'Clinical Structure',
    accent: 'text-info-600 bg-info-50 border-info-200/80',
    number: '03',
    estTime: '3 min',
  },
  roles: {
    icon: ShieldCheck,
    badge: 'Governance & RBAC',
    accent: 'text-amber-600 bg-amber-50 border-amber-200/80',
    number: '04',
    estTime: '2 min',
  },
  users: {
    icon: UserPlus,
    badge: 'Staff Accounts',
    accent: 'text-danger-600 bg-danger-50 border-danger-200/80',
    number: '05',
    estTime: '2 min',
  },
  subscription: {
    icon: CreditCard,
    badge: 'Institution Plan',
    accent: 'text-brand-600 bg-brand-50 border-brand-200/80',
    number: '06',
    estTime: '1 min',
  },
}

// Clinical modules definition for roadmap visualization
const CLINICAL_MODULES = [
  { id: 'opd', name: 'OPD Consultation', tag: 'Outpatient', desc: 'Queues, doctor desk, vitals & electronic prescriptions' },
  { id: 'ipd', name: 'IPD & Wards', tag: 'Inpatient', desc: 'Bed matrix, admissions, daily rounds & discharge summaries' },
  { id: 'emergency', name: 'Emergency & Triage', tag: 'Emergency', desc: 'ESI triage, red/yellow/green bays & MLC intimation' },
  { id: 'lab', name: 'Laboratory (LIS)', tag: 'Diagnostics', desc: 'Worklists, normal ranges, panic values & report signing' },
  { id: 'radiology', name: 'Radiology & PACS', tag: 'Imaging', desc: 'DICOM web viewer, ultrasound, CT/MRI & radiologist notes' },
  { id: 'pharmacy', name: 'Pharmacy & Dispensing', tag: 'Medicines', desc: 'Rx queue, batch tracking, expiry & POS billing' },
  { id: 'ot', name: 'Operating Theatre', tag: 'Surgical', desc: 'Theatre slots, WHO safety checklist & PAC assessment' },
  { id: 'cssd', name: 'CSSD & Sterilization', tag: 'Sterile', desc: 'Sets, autoclaving cycles & pack tracking' },
  { id: 'billing', name: 'Billing & Cashier', tag: 'Finance', desc: 'Interim bills, deposits, insurance claims & TPA' },
  { id: 'hrms', name: 'HRMS & Payroll', tag: 'Staffing', desc: 'Biometric attendance, shift rosters, salary & leaves' },
]

function getRoleCategory(code) {
  const c = String(code).toUpperCase()
  if (['CONSULTANT', 'DOCTOR', 'STAFF_NURSE', 'SURGEON', 'ANESTHETIST', 'NURSE'].some((k) => c.includes(k))) return 'clinical'
  if (['FRONT_DESK', 'CASHIER', 'BILLING', 'ADMIN', 'MANAGER', 'RECEPTION'].some((k) => c.includes(k))) return 'administrative'
  if (['LAB_TECH', 'PHARMACIST', 'RADIOLOGIST', 'BIOCHEMIST', 'STORE_KEEPER'].some((k) => c.includes(k))) return 'diagnostic'
  return 'other'
}

/** Team & Roles Tab Component */
function RolesTabContent({ setup }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { showSuccess, showError } = useSnackbar()
  const me = useAuthUser()
  const { data: templates = [] } = useQuery({ queryKey: ['role-templates'], queryFn: fetchRoleTemplates })
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles })
  const [picked, setPicked] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const usable = templates.filter((tp) => tp.available && !tp.alreadyCreated)

  useEffect(() => {
    if (picked === null && templates.length) {
      setPicked(new Set(roles.length <= 1 ? SUGGESTED.filter((c) => usable.some((tp) => tp.code === c)) : []))
    }
  }, [templates, roles, picked, usable])

  const create = useMutation({
    mutationFn: () => createRolesFromTemplates([...(picked ?? [])]),
    onSuccess: ({ created, skipped }) => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['role-templates'] })
      qc.invalidateQueries({ queryKey: ['setup'] })
      setPicked(new Set())
      showSuccess(skipped.length
        ? t('admin.setupHub.createdSkipped', { count: created.length, skipped: skipped.length })
        : t('admin.setupHub.created', { count: created.length }))
    },
    onError: (e) => showError(e.message),
  })

  const toggle = (code) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(code)) n.delete(code)
    else n.add(code)
    return n
  })

  const others = roles.filter((r) => !r.system)
  const canCreate = hasPermission('core.roles.create')

  const filteredTemplates = useMemo(() => {
    return templates.filter((tp) => {
      if (categoryFilter !== 'all') {
        const cat = getRoleCategory(tp.code)
        if (cat !== categoryFilter) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesName = tp.name?.toLowerCase().includes(q)
        const matchesDesc = tp.description?.toLowerCase().includes(q)
        const matchesModules = tp.modules?.some((m) => m.toLowerCase().includes(q))
        if (!matchesName && !matchesDesc && !matchesModules) return false
      }
      return true
    })
  }, [templates, categoryFilter, searchQuery])

  return (
    <div className="space-y-6">
      {/* Root Administrator Card */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-300/80 bg-amber-50/60 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 border border-amber-200">
              <ShieldCheck className="w-7 h-7" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg sm:text-xl font-bold text-ink">
                  {setup.admin.roleName}
                </h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-amber-200/80 text-amber-900 border border-amber-300">
                  {t('admin.setupHub.builtIn')}
                </span>
                <span className="text-xs text-ink-faint">
                  · {me?.fullAccess ? t('admin.setupHub.you') : t('admin.setupHub.administrators')}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-ink-muted mt-1.5 leading-relaxed max-w-2xl">
                <Trans
                  t={t}
                  i18nKey="admin.setupHub.fullAccess"
                  values={{
                    pages: setup.admin.pageCount,
                    modules: setup.admin.moduleCount,
                    actions: setup.admin.actionCount,
                  }}
                  components={{ b: <span className="font-semibold text-ink" /> }}
                />
              </p>

              {/* Privilege Metrics Pills */}
              <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface/90 border border-amber-200 text-xs font-medium text-ink">
                  <Layers className="w-3.5 h-3.5 text-amber-600" />
                  <span className="font-bold text-amber-900">{setup.admin.pageCount}</span> {t('admin.setupHub.hub.pagesUnlocked', 'Pages Unlocked')}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface/90 border border-amber-200 text-xs font-medium text-ink">
                  <Activity className="w-3.5 h-3.5 text-amber-600" />
                  <span className="font-bold text-amber-900">{setup.admin.moduleCount}</span> {t('admin.setupHub.hub.activeModules', 'Active Modules')}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface/90 border border-amber-200 text-xs font-medium text-ink">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                  <span className="font-bold text-amber-900">{setup.admin.actionCount}</span> {t('admin.setupHub.hub.rootPrivileges', 'Root Privileges')}
                </span>
              </div>
            </div>
          </div>

          <Button to="/core/all-pages" variant="secondary" iconRight={ChevronRight} className="rtl:[&_svg]:rotate-180 shrink-0 self-start lg:self-center">
              {t('admin.setupHub.seeAllPages')}
            </Button>
        </div>
      </div>

      {/* Existing Roles Carousel */}
      {others.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-faint">
                {t('admin.setupHub.yourRoles')} ({others.length})
              </h4>
              <p className="text-xs text-ink-muted mt-0.5">
                {t('admin.setupHub.hub.rolesConfigured', 'Roles configured for {{name}} staff. Click to review or adjust permissions.', { name: me?.tenant?.name || t('admin.setupHub.yourInstitution', 'your institution') })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/core/roles')}
              className="text-xs text-brand-600 hover:text-brand-700 font-semibold hover:underline self-start sm:self-auto"
            >
              {t('admin.setupHub.hub.openRoleDirectory', 'Open Role Directory →')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {others.map((r) => (
              <Link
                key={r.id}
                to={`/core/roles/${r.id}`}
                className="group inline-flex items-center gap-2 text-xs font-medium px-3.5 py-2 rounded-xl bg-bg/80 border border-border text-ink hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700 transition"
              >
                <Key className="w-3.5 h-3.5 text-ink-faint group-hover:text-brand-500 transition" />
                <span className="font-semibold">{r.name}</span>
                {r.memberCount != null && (
                  <span className="ms-1 text-[11px] px-1.5 py-0.2 rounded-full bg-surface text-ink-muted border border-border">
                    {t('admin.setupHub.hub.userCount', '{{count}} users', { count: r.memberCount })}
                  </span>
                )}
              </Link>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => navigate('/core/roles/new')}
              className="text-xs py-1.5 px-3"
            >
              {t('admin.setupHub.blankRole')}
            </Button>
          </div>
        </div>
      )}

      {/* Role Recommendations Builder */}
      {canCreate && (
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="text-base font-bold text-ink flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-500" />
                {t('admin.setupHub.createFromRecs')}
              </h4>
              <p className="text-xs text-ink-muted mt-1 max-w-xl">
                {t('admin.setupHub.hub.rolesIntro', 'Ready-to-use clinical, nursing, front-office and diagnostic roles. Each role maps to real institution workflows.')}
              </p>
            </div>

            {/* Filter and Search */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex rounded-xl border border-border bg-bg p-1 text-xs font-medium">
                {[
                  { id: 'all', label: t('admin.setupHub.hub.allRoles', 'All Roles') },
                  { id: 'clinical', label: t('admin.setupHub.hub.clinical', 'Clinical') },
                  { id: 'administrative', label: t('admin.setupHub.hub.frontOffice', 'Front Office') },
                  { id: 'diagnostic', label: t('admin.setupHub.hub.diagnostics', 'Diagnostics') },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCategoryFilter(tab.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg transition font-medium',
                      categoryFilter === tab.id
                        ? 'bg-surface text-ink font-bold'
                        : 'text-ink-muted hover:text-ink'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('admin.setupHub.hub.filterTemplates', 'Filter role templates…')}
                  className="h-8 ps-8 pe-3 text-xs rounded-xl border border-border bg-surface text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-brand-500"
                />
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredTemplates.map((tp) => {
              const Icon = iconFor(tp.icon)
              const disabled = !tp.available || tp.alreadyCreated
              const on = picked?.has(tp.code)

              return (
                <button
                  key={tp.code}
                  type="button"
                  role="checkbox"
                  aria-checked={!!on}
                  disabled={disabled}
                  onClick={() => toggle(tp.code)}
                  className={clsx(
                    'text-start rounded-xl border p-4 flex gap-3.5 transition relative group',
                    disabled
                      ? 'opacity-60 cursor-not-allowed bg-bg/50 border-border/80'
                      : on
                      ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500/30'
                      : 'border-border bg-surface hover:border-brand-300 hover:-translate-y-0.5'
                  )}
                >
                  <span className="pt-0.5 shrink-0">
                    {tp.alreadyCreated ? (
                      <CheckCircle2 className="w-5 h-5 text-success-500" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'w-5 h-5 rounded-md border flex items-center justify-center transition',
                          on
                            ? 'bg-brand-500 border-brand-500 text-white'
                            : 'border-ink-faint/40 bg-surface group-hover:border-brand-400'
                        )}
                      >
                        {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-bold text-ink">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-bg text-ink-muted">
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="truncate">{tp.name}</span>
                    </span>

                    <span className="block text-xs text-ink-muted mt-1 line-clamp-2 leading-relaxed">
                      {tp.description}
                    </span>

                    <span className="block text-[11px] text-ink-faint mt-2 font-medium">
                      {tp.alreadyCreated ? (
                        <span className="inline-flex items-center gap-1 text-success-600 font-bold">
                          <Check className="w-3 h-3" /> {t('admin.setupHub.alreadyCreated')}
                        </span>
                      ) : !tp.available ? (
                        <span className="text-ink-faint italic">{t('admin.setupHub.notInPlan')}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-ink-muted">
                          <span className="font-semibold text-ink">{tp.permissionCount}</span> {t('admin.setupHub.hub.permsShort', 'perms')} ·{' '}
                          <span className="truncate">
                            {tp.modules.slice(0, 3).map((m) => (MODULE_BY_ID[m] ? cl.module(m) : m)).join(', ')}
                            {tp.modules.length > 3 ? '…' : ''}
                          </span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* Action Toolbar */}
          <div className="rounded-xl border border-border bg-bg/50 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                icon={Sparkles}
                disabled={!picked?.size}
                loading={create.isPending}
                onClick={() => create.mutate()}
                className=" font-semibold"
              >
                {picked?.size
                  ? t('admin.setupHub.createRoles', { count: picked.size })
                  : t('admin.setupHub.createRolesNone')}
              </Button>

              <Button
                variant="secondary"
                icon={Plus}
                onClick={() => navigate('/core/roles/new')}
              >
                {t('admin.setupHub.blankRole')}
              </Button>
            </div>

            {usable.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setPicked(new Set(usable.map((tp) => tp.code)))}
                  className="text-brand-600 hover:text-brand-700 font-bold hover:underline"
                >
                  {t('admin.setupHub.selectAll', { count: usable.length })}
                </button>
                {picked?.size > 0 && (
                  <>
                    <span className="text-ink-faint">·</span>
                    <button
                      type="button"
                      onClick={() => setPicked(new Set())}
                      className="text-ink-muted hover:text-ink hover:underline font-medium"
                    >
                      {t('admin.setupHub.hub.clearSelection', 'Clear selection ({{count}})', { count: picked.size })}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Overview Tab Content */
function OverviewTabContent({ setup, next, pct, stepTitle, onNavigateTab }) {
  const { t } = useTranslation('admin')

  return (
    <div className="space-y-6">
      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-2">
            <span>{t('admin.setupHub.hub.overallReadiness', 'Overall Readiness')}</span>
            <Compass className="w-4 h-4 text-brand-500" />
          </div>
          <div className="font-display text-2xl font-extrabold text-ink">{pct}%</div>
          <p className="text-xs text-ink-muted mt-1">{t('admin.setupHub.hub.milestonesComplete', '{{done}} of {{total}} milestones complete', { done: setup.done, total: setup.total })}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-2">
            <span>{t('admin.setupHub.hub.clinicalWings', 'Clinical Wings')}</span>
            <Stethoscope className="w-4 h-4 text-info-500" />
          </div>
          <div className="font-display text-2xl font-extrabold text-ink">
            {setup.steps.find((s) => s.id === 'departments')?.count ?? '—'}
          </div>
          <p className="text-xs text-ink-muted mt-1">{t('admin.setupHub.hub.departmentsActive', 'Departments active (min. 3)')}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-2">
            <span>{t('admin.setupHub.hub.configuredRoles', 'Configured Roles')}</span>
            <ShieldCheck className="w-4 h-4 text-amber-500" />
          </div>
          <div className="font-display text-2xl font-extrabold text-ink">
            {setup.steps.find((s) => s.id === 'roles')?.count ?? '—'}
          </div>
          <p className="text-xs text-ink-muted mt-1">{t('admin.setupHub.hub.accessTiers', 'Access tiers provisioned')}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-2">
            <span>{t('admin.setupHub.hub.staffAccounts', 'Staff Accounts')}</span>
            <Users className="w-4 h-4 text-danger-500" />
          </div>
          <div className="font-display text-2xl font-extrabold text-ink">
            {setup.steps.find((s) => s.id === 'users')?.count ?? '—'}
          </div>
          <p className="text-xs text-ink-muted mt-1">{t('admin.setupHub.hub.usersInvited', 'Users invited to system')}</p>
        </div>
      </div>

      {/* Progress & Next Step Spotlight Card */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex-1 max-w-xl">
            <div className="flex items-center justify-between gap-4 mb-2">
              <h3 className="font-display text-lg font-bold text-ink">
                {setup.done === setup.total
                  ? t('admin.setupHub.allSet')
                  : t('admin.setupHub.stepsDone', { done: setup.done, total: setup.total })}
              </h3>
              <span className="font-display text-lg font-extrabold text-brand-600">{pct}%</span>
            </div>

            <div className="h-3 w-full rounded-full bg-bg border border-border/80 overflow-hidden p-0.5">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5 font-semibold text-success-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('admin.setupHub.hub.completedCount', '{{count}} Completed', { count: setup.done })}
              </span>
              <span className="text-ink-faint">·</span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600">
                <Circle className="w-3.5 h-3.5" />
                {t('admin.setupHub.hub.pendingCount', '{{count}} Pending', { count: setup.total - setup.done })}
              </span>
              <span className="text-ink-faint">·</span>
              <span className="inline-flex items-center gap-1 text-ink-faint">
                <Clock className="w-3 h-3" /> {t('admin.setupHub.hub.totalSetupTime', '~5 min total setup')}
              </span>
            </div>
          </div>

          {next && (
            <div className="rounded-xl border border-brand-200 bg-surface p-4 lg:max-w-md w-full flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-brand-500" /> {t('admin.setupHub.hub.recommendedNext', 'Recommended Next Action')}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 font-semibold">
                  {t('admin.setupHub.hub.priority', 'Priority')}
                </span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">{stepTitle(next)}</h4>
                <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">
                  {t(`admin.setupHub.steps.${next.id}.hint`, { defaultValue: next.hint })}
                </p>
              </div>
              <Button to={next.path} size="sm" iconRight={ArrowRight} className="w-full sm:w-auto rtl:[&_svg]:rotate-180 font-medium self-start sm:self-auto">
                  {t('admin.setupHub.next', { title: stepTitle(next) })}
                </Button>
            </div>
          )}
        </div>
      </div>

      {/* The 6 Setup Milestones Grid */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-ink">{t('admin.setupHub.hub.milestonesTitle', 'Core Onboarding Milestones')}</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {t('admin.setupHub.hub.milestonesSubtitle', 'Complete these 6 foundational configurations to enable paperless institution operations.')}
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
            {t('admin.setupHub.hub.finishedCount', '{{done}}/{{total}} Finished', { done: setup.done, total: setup.total })}
          </span>
        </div>

        <ol className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {setup.steps.map((s, i) => {
            const meta = STEP_META[s.id] || {
              icon: Circle,
              badge: t('admin.setupHub.hub.step', 'Step'),
              accent: 'text-brand-600 bg-brand-50 border-brand-200',
              number: String(i + 1).padStart(2, '0'),
              estTime: '2 min',
            }
            const Icon = meta.icon

            return (
              <li key={s.id}>
                <Link
                  to={s.path}
                  className={clsx(
                    'group h-full flex flex-col justify-between rounded-xl border p-4 transition-all duration-200 relative overflow-hidden',
                    s.done
                      ? 'border-success-500/30 bg-surface hover:border-success-500'
                      : 'border-border bg-surface hover:border-brand-400 hover:-translate-y-0.5'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="flex items-center gap-2">
                        <span
                          className={clsx(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition',
                            s.done
                              ? 'bg-success-50 text-success-600 border-success-200'
                              : meta.accent
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                          {STEP_META[s.id] ? t(`admin.setupHub.hub.stepBadges.${s.id}`, meta.badge) : meta.badge}
                        </span>
                      </span>

                      {s.done ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-success-100 text-success-800 border border-success-200">
                          <Check className="w-3 h-3 stroke-[2.5]" /> {t('admin.setupHub.hub.completed', 'Completed')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-bg text-ink-muted border border-border group-hover:border-brand-300 transition">
                          <Circle className="w-2.5 h-2.5 text-ink-faint" /> {t('admin.setupHub.hub.pending', 'Pending')}
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-bold text-ink group-hover:text-brand-600 transition flex items-center justify-between">
                      <span>{meta.number}. {stepTitle(s)}</span>
                      {s.count != null && (
                        <span className="text-xs px-2 py-0.5 rounded-md bg-bg text-ink-muted font-normal border border-border">
                          {s.count}
                        </span>
                      )}
                    </h4>

                    <p className="text-xs text-ink-muted mt-1 leading-relaxed line-clamp-2">
                      {t(`admin.setupHub.steps.${s.id}.hint`, { defaultValue: s.hint })}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs font-semibold">
                    <span className={clsx(s.done ? 'text-success-600' : 'text-brand-600 group-hover:underline')}>
                      {s.done ? t('admin.setupHub.hub.reviewSettings', 'Review Settings') : t('admin.setupHub.hub.configureMilestone', 'Configure Milestone')}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-faint group-hover:text-brand-600 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Clinical Ecosystem Banner */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 border border-brand-200">
              <Rocket className="w-5 h-5" />
            </span>
            <div>
              <h4 className="text-sm font-bold text-ink flex items-center gap-2">
                {t('admin.setupHub.hub.modularArchitecture', 'Modular Clinical Architecture')}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-800">
                  {t('admin.setupHub.hub.ready', 'Ready')}
                </span>
              </h4>
              <p className="text-xs sm:text-sm text-ink-muted mt-1 leading-relaxed max-w-3xl">
                {t('admin.setupHub.clinicalNote')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('modules')}
            className="shrink-0 self-start md:self-center"
          >
            <Button variant="secondary" size="sm" iconRight={ChevronRight} className="rtl:[&_svg]:rotate-180">
              {t('admin.setupHub.hub.viewAllModules', 'View All Modules')}
            </Button>
          </button>
        </div>
      </div>
    </div>
  )
}

/** Profile & Letterhead Preview Tab Content */
function ProfileTabContent() {
  const { t } = useTranslation('admin')
  const me = useAuthUser()
  const navigate = useNavigate()
  const tenant = me?.tenant
  const profile = tenant?.profile ?? {}

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-5">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{t('admin.setupHub.hub.profileTitle', 'Institution Profile & Letterhead')}</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {t('admin.setupHub.hub.profileSubtitle', 'Official institution details shown on Rx, Lab Reports, Inpatient Bills and Discharge Summaries.')}
            </p>
          </div>
          <Button icon={Building2} onClick={() => navigate('/core/profile')}>
            {t('admin.setupHub.hub.editProfile', 'Edit Institution Profile')}
          </Button>
        </div>

        {/* Live Letterhead Preview Card */}
        <div className="rounded-xl border border-border/80 bg-bg/50 p-6">
          <div className="text-xs font-bold uppercase tracking-wider text-ink-faint mb-3 flex items-center gap-2">
            <Printer className="w-3.5 h-3.5" /> {t('admin.setupHub.hub.letterheadPreview', 'Letterhead & Document Header Live Simulation')}
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between border-b-2 border-brand-500 pb-4">
              <div className="flex items-center gap-3.5">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 font-bold text-xl border border-brand-200">
                  {tenant?.name?.charAt(0) || 'H'}
                </span>
                <div>
                  <h4 className="font-display text-lg font-extrabold text-ink tracking-tight">
                    {tenant?.name || 'City Care Institution'}
                  </h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {profile.tagline || 'Multi-Speciality Healthcare & Research Institute'}
                  </p>
                </div>
              </div>
              <div className="text-end text-xs text-ink-muted space-y-0.5">
                <p className="font-medium">{profile.phone || '+91 98765 43210'}</p>
                <p>{profile.email || 'info@citycarehospital.com'}</p>
                <p className="text-[11px] text-ink-faint">NABH Accredited</p>
              </div>
            </div>

            <div className="mt-4 text-xs text-ink-muted flex flex-wrap items-center justify-between gap-2">
              <span>{profile.addressLine || '123 Medical Enclave, Main Road'}, {profile.city || 'Metro City'}</span>
              <span>{t('admin.setupHub.hub.regLabel', 'Reg:')} {profile.regNumber || 'HOSP-2026-CC01'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Departments Tab Content */
function DepartmentsTabContent({ setup }) {
  const { t } = useTranslation('admin')
  const navigate = useNavigate()
  const deptStep = setup.steps.find((s) => s.id === 'departments')

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-5">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{t('admin.setupHub.hub.departmentsTitle', 'Clinical & Support Departments')}</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {t('admin.setupHub.hub.departmentsSubtitle', 'Organize your medical specialities, wards, diagnostic centers and support teams.')}
            </p>
          </div>
          <Button icon={Stethoscope} onClick={() => navigate('/core/departments')}>
            {t('admin.setupHub.hub.manageDepartments', 'Manage Departments')}
          </Button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: 'General Medicine', type: 'Clinical', doctorCount: 4, badge: 'Active' },
            { title: 'Emergency & Trauma', type: 'Clinical', doctorCount: 6, badge: '24/7' },
            { title: 'Pathology & Lab', type: 'Diagnostic', doctorCount: 3, badge: 'Active' },
            { title: 'Radiology & Imaging', type: 'Diagnostic', doctorCount: 2, badge: 'Active' },
          ].map((d) => (
            <div key={d.title} className="rounded-xl border border-border bg-bg/40 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.type}</span>
              <h4 className="text-sm font-bold text-ink mt-1">{d.title}</h4>
              <p className="text-xs text-ink-muted mt-0.5">{t('admin.setupHub.hub.doctorsAssigned', '{{count}} doctors assigned', { count: d.doctorCount })}</p>
              <span className="mt-3 inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-success-100 text-success-800">
                {d.badge}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Modules Ecosystem Tab Content */
function ModulesTabContent() {
  const { t } = useTranslation('admin')
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-5">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{t('admin.setupHub.hub.modulesTitle', 'SchoolGiant modules architecture')}</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {t('admin.setupHub.hub.modulesSubtitle', 'Full suite of specialized clinical and administrative workflows designed for Indian institutions.')}
            </p>
          </div>
          <Button icon={Layers} variant="secondary" onClick={() => navigate('/core/all-pages')}>
            {t('admin.setupHub.hub.exploreAllPages', 'Explore All Pages')}
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {CLINICAL_MODULES.map((mod) => (
            <div key={mod.id} className="rounded-xl border border-border p-4 bg-surface hover:border-brand-300 transition">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h4 className="text-sm font-bold text-ink">{t(`admin.setupHub.hub.clinicalModules.${mod.id}.name`, mod.name)}</h4>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                  {t(`admin.setupHub.hub.clinicalModules.${mod.id}.tag`, mod.tag)}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">{t(`admin.setupHub.hub.clinicalModules.${mod.id}.desc`, mod.desc)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Main SetupHub Page Component with Sub-Sidebar Layout */
export default function SetupHub() {
  const { t } = useTranslation('admin')
  const location = useLocation()
  const navigate = useNavigate()
  const { data: setup, isLoading } = useQuery({ queryKey: ['setup'], queryFn: fetchSetup })
  const me = useAuthUser()

  const [activeTab, setActiveTab] = useState('overview')

  // Support direct linking via hash or tab
  useEffect(() => {
    if (location.hash === '#roles') {
      setActiveTab('roles')
    }
  }, [location.hash])

  const pct = setup ? Math.round((setup.done / setup.total) * 100) : 0
  const next = useMemo(() => setup?.steps.find((s) => !s.done), [setup])
  const stepTitle = (s) => t(`admin.setupHub.steps.${s.id}.title`, { defaultValue: s.title })

  // Sub-sidebar navigation items
  const SUB_NAV_ITEMS = [
    { id: 'overview', label: t('admin.setupHub.hub.navOverview', 'Overview & Checklist'), icon: Rocket, badge: setup ? `${setup.done}/${setup.total}` : null },
    { id: 'profile', label: t('admin.setupHub.hub.navProfile', 'Institution Profile'), icon: Building2, badge: setup?.steps.find((s) => s.id === 'profile')?.done ? '✓' : null },
    { id: 'departments', label: t('admin.setupHub.hub.navDepartments', 'Departments & Wings'), icon: Stethoscope, badge: setup?.steps.find((s) => s.id === 'departments')?.count },
    { id: 'roles', label: t('admin.setupHub.hub.navRoles', 'Team & Role Access'), icon: ShieldCheck, badge: setup?.steps.find((s) => s.id === 'roles')?.count },
    { id: 'modules', label: t('admin.setupHub.hub.navModules', 'Clinical Ecosystem'), icon: Layers, badge: '10' },
  ]

  return (
    <PageContainer>
      {/* Executive Hero Banner */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-7 shadow-card mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4 sm:gap-5">
            <span className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 border border-brand-100">
              <Institution className="w-7 h-7 sm:w-8 sm:h-8" />
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                  {pct === 100 ? t('admin.setupHub.hub.liveOperational', 'Live & Operational') : t('admin.setupHub.hub.onboardingCenter', 'Onboarding Command Center')}
                </span>
                <span className="text-xs text-ink-faint font-medium">
                  {setup ? t('admin.setupHub.hub.milestonesCompleted', '{{done}} of {{total}} milestones completed', { done: setup.done, total: setup.total }) : t('admin.setupHub.hub.loadingChecklist', 'Loading checklist…')}
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink tracking-tight">
                {t('admin.setupHub.title', { name: me?.tenant?.name ?? t('admin.setupHub.yourInstitution') })}
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted mt-1 max-w-2xl leading-relaxed">
                {t('admin.setupHub.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center shrink-0">
            <Button
              variant="secondary"
              icon={FileText}
              onClick={() => navigate('/core/all-pages')}
              className="text-xs sm:text-sm"
            >
              {t('admin.setupHub.hub.allPagesDirectory', 'All Pages Directory')}
            </Button>
            <Button
              variant="secondary"
              icon={Building2}
              onClick={() => navigate('/core/profile')}
              className="text-xs sm:text-sm"
            >
              {t('admin.setupHub.hub.profileSettings', 'Profile Settings')}
            </Button>
          </div>
        </div>
      </div>

      {isLoading || !setup ? (
        <div className="space-y-4">
          <div className="h-40 rounded-2xl bg-black/5 animate-pulse" />
          <div className="h-64 rounded-2xl bg-black/5 animate-pulse" />
        </div>
      ) : (
        /* Master-Detail Layout with Sub-Sidebar */
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Sub-Sidebar Navigation Rail */}
          <aside className="w-full lg:w-72 shrink-0 rounded-2xl border border-border bg-surface p-4 shadow-card lg:sticky lg:top-4 space-y-5">
            {/* Institution Mini Identifier */}
            <div className="p-3 rounded-xl bg-bg/70 border border-border/80">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 font-bold border border-brand-200">
                  {me?.tenant?.name?.charAt(0) || 'H'}
                </span>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-ink truncate">
                    {me?.tenant?.name || t('admin.setupHub.yourInstitution', 'your institution')}
                  </h4>
                  <p className="text-[11px] text-ink-muted truncate">
                    {t('admin.setupHub.hub.workspaceSetupHub', 'Workspace Setup Hub')}
                  </p>
                </div>
              </div>

              {/* Sidebar Progress Tracker */}
              <div className="mt-3 pt-2.5 border-t border-border/60">
                <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
                  <span className="text-ink-muted">{t('admin.setupHub.hub.readiness', 'Readiness')}</span>
                  <span className="text-brand-600 font-bold">{pct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Sub-Sidebar Navigation Links */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint px-3 mb-2">
                {t('admin.setupHub.hub.setupNavigation', 'Setup Navigation')}
              </div>
              <nav className="space-y-1">
                {SUB_NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const active = activeTab === item.id

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition text-start',
                        active
                          ? 'bg-brand-50 text-brand-700 font-bold border border-brand-200/80'
                          : 'text-ink-muted hover:bg-bg hover:text-ink border border-transparent'
                      )}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon className={clsx('w-4 h-4 shrink-0', active ? 'text-brand-600' : 'text-ink-faint')} />
                        <span className="truncate">{item.label}</span>
                      </span>

                      {item.badge && (
                        <span
                          className={clsx(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                            active
                              ? 'bg-brand-200/60 text-brand-900'
                              : 'bg-bg text-ink-muted border border-border'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Quick Next Step Helper in Sidebar */}
            {next && (
              <div className="p-3 rounded-xl border border-brand-200 bg-brand-50/50 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-brand-800">
                  <Sparkles className="w-3.5 h-3.5 text-brand-600" /> {t('admin.setupHub.hub.nextMilestone', 'Next Milestone')}
                </div>
                <p className="text-xs text-ink font-semibold truncate">{stepTitle(next)}</p>
                <Button to={next.path} size="sm" iconRight={ArrowRight} className="w-full text-xs py-1 rtl:[&_svg]:rotate-180 block">
                    {t('admin.setupHub.hub.configureStep', 'Configure Step')}
                  </Button>
              </div>
            )}
          </aside>

          {/* Main Content Workspace */}
          <main className="flex-1 min-w-0 w-full">
            {activeTab === 'overview' && (
              <OverviewTabContent
                setup={setup}
                next={next}
                pct={pct}
                stepTitle={stepTitle}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === 'profile' && <ProfileTabContent />}

            {activeTab === 'departments' && <DepartmentsTabContent setup={setup} />}

            {activeTab === 'roles' && <RolesTabContent setup={setup} />}

            {activeTab === 'modules' && <ModulesTabContent />}
          </main>
        </div>
      )}
    </PageContainer>
  )
}
