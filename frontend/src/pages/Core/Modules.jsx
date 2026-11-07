import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  Filter,
  Info,
  Layers,
  Link2,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { CATEGORIES, MODULE_BY_ID } from '@schoolgiant/shared'
import { PageContainer, useConfirm } from '../../components/system'
import { Switch } from '../../components/app/Controls'
import Button from '../../components/ui/Button'
import { fetchModules, setModuleEnabled } from '../../api/core'
import { hasPermission, syncCurrentUser } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import useAuthUser from '../../hooks/useAuthUser'
import { iconFor } from '../../catalog/icons'
import { moduleHasScreens } from '../../catalog/built'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const names = (ids, cl) => ids.map((id) => cl.module(id)).join(', ')

/** Format dependency tags to avoid huge text blocks while providing full tooltip inspection */
function formatDependencyReason(m, cl, t, planName) {
  if (m.mandatory) {
    return {
      type: 'alwaysOn',
      fullText: t('admin.modules.reason.alwaysOn'),
    }
  }
  if (!m.inPlan) {
    return {
      type: 'notInPlan',
      fullText: t('admin.modules.reason.notInPlan', { plan: planName }),
    }
  }
  if (m.blockedBy && m.blockedBy.length > 0) {
    const isNeededBy = m.enabled
    const allNames = names(m.blockedBy, cl)
    return {
      type: isNeededBy ? 'neededBy' : 'needsFirst',
      count: m.blockedBy.length,
      firstModuleName: cl.module(m.blockedBy[0]),
      fullText: isNeededBy
        ? t('admin.modules.reason.neededBy', { names: allNames })
        : t('admin.modules.reason.needsFirst', { names: allNames }),
    }
  }
  return null
}

export default function Modules() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const qc = useQueryClient()
  const me = useAuthUser()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()

  const { data: modules = [], isLoading } = useQuery({ queryKey: ['modules'], queryFn: fetchModules })
  const canEdit = hasPermission('core.modules.edit')

  const [activeCategory, setActiveCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'enabled' | 'inPlan' | 'locked'
  const [searchQuery, setSearchQuery] = useState('')

  const toggle = useMutation({
    mutationFn: ({ id, enabled }) => setModuleEnabled(id, enabled),
    onSuccess: async (_, { id, enabled }) => {
      qc.invalidateQueries({ queryKey: ['modules'] })
      qc.invalidateQueries({ queryKey: ['catalog'] })
      await syncCurrentUser()
      showSuccess(t(enabled ? 'admin.modules.switchedOn' : 'admin.modules.switchedOff', { name: cl.module(id) }))
    },
    onError: (e) => showError(e.message),
  })

  const onToggle = async (m, enabled) => {
    if (!enabled) {
      const ok = await confirm({
        title: t('admin.modules.confirmOff.title', { name: cl.module(m) }),
        message: t('admin.modules.confirmOff.message'),
        tone: 'danger',
        confirmLabel: t('admin.modules.confirmOff.confirm'),
      })
      if (!ok) return
    }
    toggle.mutate({ id: m.id, enabled })
  }

  const on = modules.filter((m) => m.enabled).length
  const inPlan = modules.filter((m) => m.inPlan).length
  const notInPlan = modules.length - inPlan
  const totalPages = modules.reduce((sum, m) => sum + (m.enabled ? m.pageCount : 0), 0)
  const planName = me?.subscription?.plan?.name ?? t('admin.modules.hub.standardPlan', 'Standard')

  // Categorized counts for the sub-sidebar
  const categoryStats = useMemo(() => {
    const stats = {}
    for (const cat of CATEGORIES) {
      const mods = modules.filter((m) => m.category === cat.id)
      stats[cat.id] = {
        total: mods.length,
        enabled: mods.filter((m) => m.enabled).length,
      }
    }
    return stats
  }, [modules])

  // Filter modules by category, status, and search query
  const filteredCategories = useMemo(() => {
    return CATEGORIES.map((cat) => {
      if (activeCategory !== 'all' && activeCategory !== cat.id) return null

      let mods = modules.filter((m) => m.category === cat.id)

      if (statusFilter === 'enabled') {
        mods = mods.filter((m) => m.enabled)
      } else if (statusFilter === 'inPlan') {
        mods = mods.filter((m) => m.inPlan && !m.enabled)
      } else if (statusFilter === 'locked') {
        mods = mods.filter((m) => !m.inPlan)
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        mods = mods.filter((m) => {
          const modName = cl.module(m).toLowerCase()
          const modDesc = (cl.description(m) || m.desc || '').toLowerCase()
          return modName.includes(q) || modDesc.includes(q)
        })
      }

      return { ...cat, modules: mods }
    }).filter((c) => c && c.modules.length > 0)
  }, [modules, activeCategory, statusFilter, searchQuery, cl])

  return (
    <PageContainer>
      {/* Executive Header Banner */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-7 shadow-card mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4 sm:gap-5">
            <span className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 border border-brand-100">
              <Boxes className="w-7 h-7 sm:w-8 sm:h-8" />
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                  {t('admin.modules.hub.planBadge', '{{plan}} Plan', { plan: planName })}
                </span>
                <span className="text-xs text-ink-faint font-medium">
                  {t('admin.modules.hub.activeSummary', '{{on}} active · {{pages}} pages unlocked', { on, pages: totalPages })}
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink tracking-tight">
                {t('admin.modules.title')}
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted mt-1 max-w-2xl leading-relaxed">
                {t('admin.modules.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center shrink-0">
            <Button to="/core/subscription" variant="secondary" icon={Sparkles} className="text-xs sm:text-sm">
                {t('admin.modules.hub.subscriptionPlans', 'Subscription & Plans')}
              </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="h-28 rounded-2xl bg-black/5 animate-pulse" />
          <div className="h-64 rounded-2xl bg-black/5 animate-pulse" />
        </div>
      ) : (
        /* Master-Detail Layout with Sub-Sidebar */
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Sub-Sidebar Navigation Rail */}
          <aside className="w-full lg:w-72 shrink-0 rounded-2xl border border-border bg-surface p-4 shadow-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-5">
            {/* Plan Coverage Indicator Card */}
            <div className="p-3.5 rounded-xl bg-bg/80 border border-border/80">
              <div className="flex items-center justify-between text-xs font-bold text-ink mb-1.5">
                <span>{t('admin.modules.hub.planCoverage', 'Plan Module Coverage')}</span>
                <span className="text-brand-600 font-extrabold">{on}/{inPlan}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-border overflow-hidden p-0.5">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${inPlan ? Math.round((on / inPlan) * 100) : 0}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
                <span>{notInPlan > 0 ? t('admin.modules.hub.lockedCount', '{{count}} locked', { count: notInPlan }) : t('admin.modules.hub.allUnlocked', 'All unlocked')}</span>
                <span>{t('admin.modules.hub.totalPages', '{{count}} total pages', { count: totalPages })}</span>
              </div>
            </div>

            {/* Quick Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('admin.modules.hub.searchModules', 'Search modules…')}
                className="w-full h-8 ps-8 pe-3 text-xs rounded-xl border border-border bg-bg text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-brand-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Quick Status Filter Tabs */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint px-3 mb-2 flex items-center justify-between">
                <span>{t('admin.modules.hub.filterByStatus', 'Filter By Status')}</span>
                <Filter className="w-3 h-3 text-ink-faint" />
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-bg border border-border text-xs font-medium">
                {[
                  { id: 'all', label: t('admin.modules.hub.allModules', 'All Modules') },
                  { id: 'enabled', label: t('admin.modules.hub.activeCount', 'Active ({{count}})', { count: on }) },
                  { id: 'inPlan', label: t('admin.modules.hub.inactive', 'Inactive') },
                  { id: 'locked', label: t('admin.modules.hub.lockedFilter', 'Locked ({{count}})', { count: notInPlan }) },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatusFilter(s.id)}
                    className={clsx(
                      'px-2 py-1.5 rounded-lg text-center transition font-medium text-[11px]',
                      statusFilter === s.id
                        ? 'bg-surface text-ink font-bold'
                        : 'text-ink-muted hover:text-ink'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-Sidebar Category Navigation Links */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint px-3 mb-2">
                {t('admin.modules.hub.moduleCategories', 'Module Categories')}
              </div>
              <nav className="space-y-1">
                {/* All Categories Option */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('all')}
                  className={clsx(
                    'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition text-start',
                    activeCategory === 'all'
                      ? 'bg-brand-50 text-brand-700 font-bold border border-brand-200/80'
                      : 'text-ink-muted hover:bg-bg hover:text-ink border border-transparent'
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Layers className={clsx('w-4 h-4 shrink-0', activeCategory === 'all' ? 'text-brand-600' : 'text-ink-faint')} />
                    <span className="truncate">{t('admin.modules.hub.allCategories', 'All Categories')}</span>
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-bg text-ink-muted border border-border">
                    {modules.length}
                  </span>
                </button>

                {/* Categories Loop */}
                {CATEGORIES.map((cat) => {
                  const active = activeCategory === cat.id
                  const stat = categoryStats[cat.id] || { total: 0, enabled: 0 }

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition text-start',
                        active
                          ? 'bg-brand-50 text-brand-700 font-bold border border-brand-200/80'
                          : 'text-ink-muted hover:bg-bg hover:text-ink border border-transparent'
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.color }} />
                        <span className="truncate">{cl.category(cat)}</span>
                      </span>

                      <span
                        className={clsx(
                          'text-[10px] font-semibold px-1.5 py-0.2 rounded-full shrink-0',
                          active
                            ? 'bg-brand-200/60 text-brand-900'
                            : 'bg-bg text-ink-muted border border-border'
                        )}
                      >
                        {stat.enabled}/{stat.total}
                      </span>
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Dependency Engine Intelligence Helper Card */}
            <div className="p-3.5 rounded-xl border border-info-200 bg-info-50/60 text-xs text-info-700 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-info-700 text-[11px] uppercase tracking-wider">
                <Info className="w-3.5 h-3.5 text-info-600" /> {t('admin.modules.hub.dependencyEngine', 'Dependency Engine')}
              </div>
              <p className="text-[11px] leading-relaxed text-info-700/90">
                {t('admin.modules.dependencyNote')}
              </p>
            </div>
          </aside>

          {/* Main Content Workspace */}
          <main className="flex-1 min-w-0 w-full space-y-6">
            {/* KPI Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.modules.stats.switchedOn')}</span>
                  <Boxes className="w-4 h-4 text-brand-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{on}</div>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t('admin.modules.stats.ofInPlan', { count: inPlan, plan: planName })}
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.modules.hub.unlockedPages', 'Unlocked Pages')}</span>
                  <Layers className="w-4 h-4 text-success-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{totalPages}</div>
                <p className="text-xs text-ink-muted mt-0.5">{t('admin.modules.hub.workflowsAvailable', 'Workflows available across menu')}</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.modules.stats.onBiggerPlans')}</span>
                  <Lock className="w-4 h-4 text-amber-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{notInPlan}</div>
                <p className="text-xs text-ink-muted mt-0.5">
                  {notInPlan ? t('admin.modules.stats.upgradeToUnlock') : t('admin.modules.stats.youHaveEverything')}
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.modules.hub.mandatoryCore', 'Mandatory Core')}</span>
                  <ShieldCheck className="w-4 h-4 text-brand-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">
                  {modules.filter((m) => m.mandatory).length}
                </div>
                <p className="text-xs text-ink-muted mt-0.5">{t('admin.modules.hub.alwaysActive', 'Always active for security & compliance')}</p>
              </div>
            </div>

            {/* Active Category Filter Tag Header (if filtered) */}
            {activeCategory !== 'all' && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">{t('admin.modules.hub.filteredCategory', 'Filtered category:')}</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-border text-xs font-bold text-ink">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: CATEGORIES.find((c) => c.id === activeCategory)?.color }}
                    />
                    {cl.category(CATEGORIES.find((c) => c.id === activeCategory))}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCategory('all')}
                  className="text-xs text-brand-600 hover:text-brand-700 font-semibold hover:underline"
                >
                  {t('admin.modules.hub.viewAllCategories', 'View All Categories')}
                </button>
              </div>
            )}

            {/* Category Groups */}
            {filteredCategories.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-12 text-center shadow-card space-y-3">
                <Boxes className="w-10 h-10 text-ink-faint mx-auto opacity-50" />
                <h3 className="font-display text-base font-bold text-ink">{t('admin.modules.hub.noMatchTitle', 'No modules match your filter')}</h3>
                <p className="text-xs text-ink-muted max-w-sm mx-auto">
                  {t('admin.modules.hub.noMatchHint', 'Try clearing your search query or switching your status filter to “All Modules”.')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                    setActiveCategory('all')
                  }}
                  className="text-xs text-brand-600 font-bold hover:underline"
                >
                  {t('admin.modules.hub.resetFilters', 'Reset all filters')}
                </button>
              </div>
            ) : (
              filteredCategories.map((cat) => (
                <section key={cat.id} className="rounded-2xl border border-border bg-surface p-6 shadow-card space-y-4">
                  {/* Category Title Row */}
                  <div className="flex items-center justify-between border-b border-border pb-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full" style={{ background: cat.color }} />
                      <h2 className="font-display text-base font-bold text-ink tracking-tight">
                        {cl.category(cat)}
                      </h2>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-ink-muted border border-border font-medium">
                        {cat.modules.length === 1 ? t('admin.modules.hub.oneModule', '1 module') : t('admin.modules.hub.moduleCount', '{{count}} modules', { count: cat.modules.length })}
                      </span>
                    </div>

                    <span className="text-xs text-ink-faint font-medium">
                      {t('admin.modules.hub.switchedOnCount', '{{count}} switched on', { count: cat.modules.filter((m) => m.enabled).length })}
                    </span>
                  </div>

                  {/* Module Cards Grid */}
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {cat.modules.map((m) => {
                      const Icon = iconFor(m.icon)
                      const isMandatory = m.mandatory
                      const isBlocked = m.blockedBy && m.blockedBy.length > 0
                      const disabled = !canEdit || isMandatory || !m.inPlan || isBlocked || toggle.isPending
                      const depReason = formatDependencyReason(m, cl, t, planName)

                      return (
                        <article
                          key={m.id}
                          className={clsx(
                            'group rounded-2xl border p-5 flex flex-col justify-between transition-all duration-200 relative',
                            m.enabled
                              ? 'border-border/90 bg-surface hover:border-brand-400 hover:-translate-y-0.5'
                              : m.inPlan
                              ? 'border-dashed border-border bg-bg/40 opacity-80 hover:opacity-100 hover:border-brand-300 hover:bg-surface'
                              : 'border-border/60 bg-bg/25 opacity-70'
                          )}
                        >
                          <div>
                            {/* Card Top Row: Category Icon + Title + Action */}
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105"
                                  style={{
                                    background: `${cat.color}18`,
                                    color: cat.color,
                                    border: `1px solid ${cat.color}30`,
                                  }}
                                >
                                  <Icon className="w-5 h-5" />
                                </span>

                                <div className="min-w-0">
                                  <h3 className="font-display font-bold text-sm text-ink tracking-tight truncate group-hover:text-brand-600 transition">
                                    {cl.module(m)}
                                  </h3>
                                  <span className="text-[11px] text-ink-faint font-medium block truncate">
                                    {cl.category(cat)}
                                  </span>
                                </div>
                              </div>

                              <div className="shrink-0">
                                {isMandatory ? (
                                  <span
                                    title={t('admin.modules.reason.alwaysOn')}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200/80 text-[11px] font-bold text-brand-800"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5 text-brand-600" />
                                    {t('admin.modules.hub.mandatory', 'Mandatory')}
                                  </span>
                                ) : !m.inPlan ? (
                                  <Link
                                    to="/core/subscription"
                                    className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/80 transition"
                                  >
                                    <Sparkles className="w-3 h-3 text-amber-600" />
                                    {t('admin.modules.upgrade')}
                                  </Link>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={clsx(
                                        'text-[11px] font-semibold',
                                        m.enabled ? 'text-success-600' : 'text-ink-faint'
                                      )}
                                    >
                                      {m.enabled ? t('admin.modules.hub.active', 'Active') : t('admin.modules.hub.off', 'Off')}
                                    </span>
                                    <div
                                      title={
                                        disabled && isBlocked
                                          ? depReason?.fullText
                                          : undefined
                                      }
                                    >
                                      <Switch
                                        size="sm"
                                        checked={m.enabled}
                                        disabled={disabled}
                                        onChange={(v) => onToggle(m, v)}
                                        label={t('admin.modules.switchLabel', { name: cl.module(m) })}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Full-width Description */}
                            <p className="text-xs text-ink-muted leading-relaxed line-clamp-2 min-h-[2.5rem]">
                              {cl.description(m) || m.desc}
                            </p>
                          </div>

                          {/* Uniform Bottom Metadata Strip */}
                          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
                            {/* Left: Screens Count */}
                            <div className="flex items-center gap-1.5 text-ink-muted font-medium">
                              <Layers className="w-3.5 h-3.5 text-ink-faint" />
                              <span>{t('admin.modules.pageCount', { count: m.pageCount })}</span>

                              {!moduleHasScreens(MODULE_BY_ID[m.id]) && (
                                <span className="text-[10px] text-ink-faint px-1.5 py-0.2 rounded bg-bg border border-border">
                                  {t('admin.modules.arrivesInPhase', { phase: m.phase })}
                                </span>
                              )}
                            </div>

                            {/* Right: State & Dependency Badge */}
                            {isMandatory ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                                {t('admin.modules.hub.coreSystem', 'Core System')}
                              </span>
                            ) : !m.inPlan ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-faint">
                                <Lock className="w-3 h-3 text-ink-faint" />
                                {t('admin.modules.hub.planLocked', 'Plan Locked')}
                              </span>
                            ) : m.enabled && isBlocked ? (
                              <span
                                title={depReason?.fullText}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/80 cursor-help transition hover:bg-amber-100"
                              >
                                <Link2 className="w-3 h-3 text-amber-600 shrink-0" />
                                <span>
                                  {m.blockedBy.length === 1 ? t('admin.modules.hub.requiredByOne', 'Required by 1 module') : t('admin.modules.hub.requiredByMany', 'Required by {{count}} modules', { count: m.blockedBy.length })}
                                </span>
                              </span>
                            ) : !m.enabled && isBlocked ? (
                              <span
                                title={depReason?.fullText}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-danger-50 text-danger-700 border border-danger-200/80 cursor-help transition hover:bg-danger-100"
                              >
                                <AlertCircle className="w-3 h-3 text-danger-600 shrink-0" />
                                <span>
                                  {m.blockedBy.length === 1
                                    ? t('admin.modules.hub.requiresModule', 'Requires {{name}}', { name: depReason?.firstModuleName })
                                    : t('admin.modules.hub.requiresDeps', 'Requires {{count}} dependencies', { count: m.blockedBy.length })}
                                </span>
                              </span>
                            ) : m.enabled ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success-700">
                                <CheckCircle2 className="w-3.5 h-3.5 text-success-500" />
                                {t('admin.modules.hub.activeWorkflow', 'Active Workflow')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-faint">
                                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint/60" />
                                {t('admin.modules.hub.readyToEnable', 'Ready to Enable')}
                              </span>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))
            )}
          </main>
        </div>
      )}
    </PageContainer>
  )
}
