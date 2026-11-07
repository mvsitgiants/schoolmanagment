import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  AlertCircle,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  Database,
  Filter,
  Info,
  Layers,
  ListChecks,
  Search,
  Settings2,
  Sparkles,
  ToggleLeft,
  X,
} from 'lucide-react'
import { CATEGORIES, MODULE_BY_ID, pagePath } from '@schoolgiant/shared'
import { PageContainer } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchMasters } from '../../api/core'
import { iconFor } from '../../catalog/icons'
import { isBuilt } from '../../catalog/built'
import { useFormat } from '../../context/SettingsContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

/**
 * Masters Hub: Every master list and set-up screen grouped by functional area,
 * featuring sub-sidebar navigation, completeness health tracking, and deep data representation.
 */
export default function Masters() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const { date, number } = useFormat()
  const { data = [], isLoading } = useQuery({ queryKey: ['masters-hub'], queryFn: fetchMasters })

  const [activeCategory, setActiveCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'populated' | 'empty' | 'config'
  const [searchQuery, setSearchQuery] = useState('')

  // Enrich master items with module and page catalog metadata
  const enrichedRows = useMemo(() => {
    return data
      .map((r) => {
        const mod = MODULE_BY_ID[r.moduleId]
        return {
          ...r,
          mod,
          page: mod?.pages?.find((p) => p.id === r.pageId),
          built: isBuilt(r.moduleId, r.pageId),
        }
      })
      .filter((r) => r.mod && r.page)
  }, [data])

  const lists = useMemo(() => enrichedRows.filter((r) => r.total != null), [enrichedRows])
  const sum = (k) => lists.reduce((n, r) => n + (r[k] ?? r.total ?? 0), 0)

  const totalRecords = sum('total')
  const activeRecords = sum('active')
  const inactiveRecords = totalRecords - activeRecords
  const populatedCount = lists.filter((r) => r.total > 0).length
  const emptyCount = lists.filter((r) => r.total === 0).length
  const configCount = enrichedRows.filter((r) => r.total == null).length
  const healthPercent = lists.length ? Math.round((populatedCount / lists.length) * 100) : 0

  // Category counts and record stats for the sub-sidebar navigation
  const categoryStats = useMemo(() => {
    const stats = {}
    for (const cat of CATEGORIES) {
      const catRows = enrichedRows.filter((r) => r.mod.category === cat.id)
      const populated = catRows.filter((r) => r.total != null && r.total > 0).length
      stats[cat.id] = {
        total: catRows.length,
        populated,
        records: catRows.reduce((acc, r) => acc + (r.total || 0), 0),
      }
    }
    return stats
  }, [enrichedRows])

  // Filter master items by category, status, and search query
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    return CATEGORIES.map((cat) => {
      if (activeCategory !== 'all' && activeCategory !== cat.id) return null

      let catRows = enrichedRows.filter((r) => r.mod.category === cat.id)

      if (statusFilter === 'populated') {
        catRows = catRows.filter((r) => r.total != null && r.total > 0)
      } else if (statusFilter === 'empty') {
        catRows = catRows.filter((r) => r.total === 0)
      } else if (statusFilter === 'config') {
        catRows = catRows.filter((r) => r.total == null)
      }

      if (q) {
        catRows = catRows.filter((r) => {
          const pageName = cl.page(r.mod, r.page).toLowerCase()
          const modName = cl.module(r.mod).toLowerCase()
          const rawPage = (r.page?.name || '').toLowerCase()
          const rawMod = (r.mod?.name || '').toLowerCase()
          const desc = (cl.description(r.mod) || r.mod?.desc || '').toLowerCase()
          return (
            pageName.includes(q) ||
            modName.includes(q) ||
            rawPage.includes(q) ||
            rawMod.includes(q) ||
            desc.includes(q)
          )
        })
      }

      return {
        ...cat,
        items: catRows,
      }
    }).filter((c) => c && c.items.length > 0)
  }, [enrichedRows, activeCategory, statusFilter, searchQuery, cl])

  return (
    <PageContainer>
      {/* Executive Header Banner */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-7 shadow-card mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4 sm:gap-5">
            <span className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 border border-brand-100">
              <Database className="w-7 h-7 sm:w-8 sm:h-8" />
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                  {lists.length} Master Tables
                </span>
                <span className="text-xs text-ink-faint font-medium">
                  {number(totalRecords)} total records across institution
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink tracking-tight">
                {t('admin.masters.title')}
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted mt-1 max-w-2xl leading-relaxed">
                {t('admin.masters.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center shrink-0">
            <Button to="/core/setup" variant="secondary" icon={Sparkles} className="text-xs sm:text-sm">
                Institution Setup Hub
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
        /* Master-Detail Layout with In-Page Sub-Sidebar */
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Sub-Sidebar Navigation Rail */}
          <aside className="w-full lg:w-72 shrink-0 rounded-2xl border border-border bg-surface p-4 shadow-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-5">
            {/* Master Data Health & Readiness Gauge */}
            <div className="p-3.5 rounded-xl bg-bg/80 border border-border/80">
              <div className="flex items-center justify-between text-xs font-bold text-ink mb-1.5">
                <span>Master Readiness</span>
                <span className="text-brand-600 font-extrabold">{healthPercent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-border overflow-hidden p-0.5">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${healthPercent}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
                <span>{populatedCount} populated</span>
                <span>{emptyCount} need setup</span>
              </div>
            </div>

            {/* Quick Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('admin.masters.searchPlaceholder')}
                className="w-full h-8 ps-8 pe-8 text-xs rounded-xl border border-border bg-bg text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-brand-500"
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
                <span>Filter By Status</span>
                <Filter className="w-3 h-3 text-ink-faint" />
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-bg border border-border text-xs font-medium">
                {[
                  { id: 'all', label: `All (${enrichedRows.length})` },
                  { id: 'populated', label: `With Data (${populatedCount})` },
                  { id: 'empty', label: `Empty (${emptyCount})` },
                  { id: 'config', label: `Settings (${configCount})` },
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

            {/* Functional Category Navigation List */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint px-3 mb-2">
                Master Categories
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
                    <Layers
                      className={clsx(
                        'w-4 h-4 shrink-0',
                        activeCategory === 'all' ? 'text-brand-600' : 'text-ink-faint'
                      )}
                    />
                    <span className="truncate">All Categories</span>
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-bg text-ink-muted border border-border">
                    {enrichedRows.length}
                  </span>
                </button>

                {/* Categories Loop */}
                {CATEGORIES.map((cat) => {
                  const stat = categoryStats[cat.id]
                  if (!stat || stat.total === 0) return null
                  const active = activeCategory === cat.id

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
                          active ? 'bg-brand-200/60 text-brand-900' : 'bg-bg text-ink-muted border border-border'
                        )}
                      >
                        {stat.total}
                      </span>
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Master Data Intelligence Helper Card */}
            <div className="p-3.5 rounded-xl border border-brand-200 bg-brand-50/60 text-xs text-brand-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-brand-900 text-[11px] uppercase tracking-wider">
                <Info className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                <span>Foundational Data</span>
              </div>
              <p className="text-[11px] leading-relaxed text-brand-900/90">
                Masters establish central pricing, tariffs, lab definitions, bed layouts, and clinician directories before live operational workflows begin.
              </p>
            </div>
          </aside>

          {/* Main Content Workspace */}
          <main className="flex-1 min-w-0 w-full space-y-6">
            {/* KPI Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.masters.stats.lists')}</span>
                  <ListChecks className="w-4 h-4 text-brand-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{lists.length}</div>
                <p className="text-xs text-ink-muted mt-0.5">{t('admin.masters.stats.listsSub')}</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.masters.stats.records')}</span>
                  <Layers className="w-4 h-4 text-success-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{number(totalRecords)}</div>
                <p className="text-xs text-ink-muted mt-0.5">{t('admin.masters.stats.recordsSub')}</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.masters.stats.inactive')}</span>
                  <ToggleLeft className="w-4 h-4 text-amber-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{number(inactiveRecords)}</div>
                <p className="text-xs text-ink-muted mt-0.5">{t('admin.masters.stats.inactiveSub')}</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-faint mb-1.5">
                  <span>{t('admin.masters.stats.screens')}</span>
                  <Settings2 className="w-4 h-4 text-brand-500" />
                </div>
                <div className="font-display text-2xl font-extrabold text-ink">{enrichedRows.length}</div>
                <p className="text-xs text-ink-muted mt-0.5">{t('admin.masters.stats.screensSub')}</p>
              </div>
            </div>

            {/* Active Category Filter Tag Header (if filtered) */}
            {activeCategory !== 'all' && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">Filtered category:</span>
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
                  View All Categories
                </button>
              </div>
            )}

            {/* Category Groups with Upgraded Master Cards */}
            {filteredCategories.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-12 text-center shadow-card space-y-3">
                <Boxes className="w-10 h-10 text-ink-faint mx-auto opacity-50" />
                <h3 className="font-display text-base font-bold text-ink">
                  {searchQuery ? t('admin.masters.noMatch') : 'No master lists in this view'}
                </h3>
                <p className="text-xs text-ink-muted max-w-sm mx-auto">
                  Try clearing your search query or switching your status filter to “All”.
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
                  Reset all filters
                </button>
              </div>
            ) : (
              filteredCategories.map((cat) => {
                const totalInCat = cat.items.reduce((acc, r) => acc + (r.total || 0), 0)

                return (
                  <section
                    key={cat.id}
                    className="rounded-2xl border border-border bg-surface p-6 shadow-card space-y-4"
                  >
                    {/* Category Title Row */}
                    <div className="flex items-center justify-between border-b border-border pb-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3 h-3 rounded-full" style={{ background: cat.color }} />
                        <h2 className="font-display text-base font-bold text-ink tracking-tight">
                          {cl.category(cat)}
                        </h2>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-ink-muted border border-border font-medium">
                          {cat.items.length} {cat.items.length === 1 ? 'master' : 'masters'}
                        </span>
                      </div>

                      {totalInCat > 0 && (
                        <span className="text-xs text-ink-faint font-medium">
                          {number(totalInCat)} total records
                        </span>
                      )}
                    </div>

                    {/* Master Cards Grid */}
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {cat.items.map((r) => {
                        const Icon = iconFor(r.mod.icon)
                        const inactive = r.active != null ? r.total - r.active : 0
                        const isConfigOnly = r.total == null
                        const isEmpty = r.total === 0

                        return (
                          <Link
                            key={r.key}
                            to={pagePath(r.moduleId, r.pageId)}
                            className="group rounded-2xl border border-border/90 bg-surface p-5 hover:border-brand-400 hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between text-start"
                          >
                            <div>
                              {/* Card Top Row: Category Icon + Title + Status Pill */}
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
                                      {cl.page(r.mod, r.page)}
                                    </h3>
                                    <span className="text-[11px] text-ink-faint font-medium block truncate">
                                      {cl.module(r.mod)}
                                    </span>
                                  </div>
                                </div>

                                <div className="shrink-0">
                                  {!r.built ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg border border-border text-ink-faint text-[10px] font-bold uppercase tracking-wider">
                                      {t('admin.masters.soon')}
                                    </span>
                                  ) : isConfigOnly ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg border border-border text-ink-muted text-[11px] font-semibold">
                                      <Settings2 className="w-3.5 h-3.5 text-ink-faint" />
                                      Settings
                                    </span>
                                  ) : isEmpty ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-700 text-[11px] font-bold">
                                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                                      Needs Setup
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200/80 text-brand-700 text-xs font-bold font-mono-num">
                                      <Layers className="w-3.5 h-3.5 text-brand-600" />
                                      {number(r.total)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Description / Scope */}
                              <p className="text-xs text-ink-muted leading-relaxed line-clamp-2 min-h-[2.5rem]">
                                {cl.description(r.mod) || r.mod?.desc}
                              </p>
                            </div>

                            {/* Uniform Bottom Metadata Strip */}
                            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
                              {/* Left: Record details or configuration note */}
                              {isConfigOnly ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint font-medium">
                                  <Settings2 className="w-3 h-3 text-ink-faint" />
                                  <span>System Layout</span>
                                </span>
                              ) : isEmpty ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
                                  <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                                  <span>0 records added</span>
                                </span>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success-500 shrink-0" />
                                  <span>
                                    <strong className="font-semibold text-ink">
                                      {number(r.active ?? r.total)}
                                    </strong>{' '}
                                    active
                                  </span>
                                  {inactive > 0 && (
                                    <span className="text-ink-faint">
                                      · {t('admin.masters.inactiveCount', { n: number(inactive) })}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Right: Updated date or action link */}
                              <div className="flex items-center gap-2 shrink-0">
                                {r.updatedAt ? (
                                  <span className="text-[11px] text-ink-faint hidden sm:inline">
                                    {t('admin.masters.updatedOn', { date: date(r.updatedAt) })}
                                  </span>
                                ) : null}

                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-600 group-hover:text-brand-700 transition">
                                  <span>Configure</span>
                                  <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 rtl:[&_svg]:rotate-180" />
                                </span>
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </section>
                )
              })
            )}
          </main>
        </div>
      )}
    </PageContainer>
  )
}
