import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, Blocks, FileStack, Lock, Map as MapIcon, MousePointerClick, Settings2 } from 'lucide-react'
import { PageContainer, PageHeader, StatCardRow, SearchInput } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchCatalog } from '../../api/core'
import { iconFor } from '../../catalog/icons'
import { isBuilt } from '../../catalog/built'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { pagePath } from '@schoolgiant/shared'

const BackIcon = ({ className, ...rest }) => <ArrowLeft {...rest} className={`${className ?? ''} rtl:rotate-180`} />

/**
 * Every page and action of the institution's plan — what the Institution Admin role can
 * open (docs/04 §2.1 "See all pages"). Read-only map used while designing roles.
 */
export default function AllPages() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const { data: catalog, isLoading } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog })
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const enabled = useMemo(() => (catalog?.modules ?? []).filter((m) => m.enabled), [catalog])
  const locked = (catalog?.modules ?? []).filter((m) => !m.enabled)
  const pages = enabled.reduce((n, m) => n + m.pages.length, 0)
  const actions = enabled.reduce((n, m) => n + m.pages.reduce((k, p) => k + p.actions.length, 0), 0)
  const sensitive = enabled.reduce((n, m) => n + m.pages.reduce((k, p) => k + p.actions.filter((a) => a.sensitive).length, 0), 0)

  const show = (m) => m.pages.filter((p) => !query || [m.name, cl.module(m), p.name, cl.page(m, p)].some((x) => x.toLowerCase().includes(query)) || p.actions.some((a) => a.label.toLowerCase().includes(query) || cl.action(a).toLowerCase().includes(query)))

  return (
    <PageContainer>
      <PageHeader
        icon={MapIcon}
        title={t('admin.allPages.title')}
        subtitle={t('admin.allPages.subtitle', { plan: catalog?.plan?.name ?? '' })}
        actions={<Button to="/core/roles" variant="secondary" icon={BackIcon}>{t('admin.allPages.roles')}</Button>}
      />
      <StatCardRow items={[
        { icon: Blocks, label: t('admin.allPages.stats.modules'), value: isLoading ? '—' : enabled.length, sub: locked.length ? t('admin.allPages.stats.moreOnBigger', { count: locked.length }) : t('admin.allPages.stats.everythingIncluded'), tone: 'brand' },
        { icon: FileStack, label: t('admin.allPages.stats.pages'), value: isLoading ? '—' : pages, sub: t('admin.allPages.stats.pagesSub'), tone: 'info' },
        { icon: MousePointerClick, label: t('admin.allPages.stats.actions'), value: isLoading ? '—' : actions, sub: t('admin.allPages.stats.actionsSub'), tone: 'violet' },
        { icon: AlertTriangle, label: t('admin.allPages.stats.sensitive'), value: isLoading ? '—' : sensitive, sub: t('admin.allPages.stats.sensitiveSub'), tone: 'warning' },
      ]} />
      <SearchInput value={q} onChange={setQ} placeholder={t('admin.allPages.searchPlaceholder')} className="max-w-md" />

      {catalog?.categories.map((cat) => {
        const mods = enabled.filter((m) => m.category === cat.id).map((m) => ({ ...m, shown: show(m) })).filter((m) => m.shown.length)
        if (!mods.length) return null
        return (
          <section key={cat.id}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{cl.category(cat)}</h2>
            </div>
            <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {mods.map((m) => {
                const Icon = iconFor(m.icon)
                return (
                  <article key={m.id} className="rounded-xl border border-border bg-surface shadow-card overflow-hidden">
                    <header className="flex items-start gap-3 px-4 py-3 border-b border-border">
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}14`, color: cat.color }}><Icon className="w-[18px] h-[18px]" /></span>
                      <div className="min-w-0">
                        <h3 className="font-medium text-ink">{cl.module(m)}</h3>
                        <p className="text-xs text-ink-muted">{cl.description(m) || m.desc}</p>
                      </div>
                    </header>
                    <ul className="divide-y divide-border">
                      {m.shown.map((p) => (
                        <li key={p.id} className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {p.nav !== false ? <Link to={pagePath(m.id, p.id)} className="text-sm text-ink hover:text-brand-600">{cl.page(m, p)}</Link> : <span className="text-sm text-ink">{cl.page(m, p)}</span>}
                            {p.setup && <Settings2 className="w-3 h-3 text-ink-faint" aria-label={t('admin.allPages.setupPage')} />}
                            {!isBuilt(m.id, p.id) && <span className="text-[10px] text-ink-faint">· {t('admin.allPages.soon')}</span>}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {p.actions.map((a) => (
                              <span key={a.id} className={a.sensitive ? 'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600' : 'text-[11px] px-1.5 py-0.5 rounded bg-black/5 text-ink-muted'}>
                                {a.sensitive && <AlertTriangle className="w-2.5 h-2.5" />}{cl.action(a)}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}

      {locked.length > 0 && !query && (
        <section className="rounded-xl border border-dashed border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> {t('admin.allPages.lockedTitle', { count: locked.length })}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {locked.map((m) => { const Icon = iconFor(m.icon); return <span key={m.id} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-bg text-ink-faint"><Icon className="w-3.5 h-3.5" />{cl.module(m)}</span> })}
          </div>
          <Link to="/core/subscription" className="inline-block mt-3 text-sm text-brand-600 hover:underline">{t('admin.allPages.comparePlans')}</Link>
        </section>
      )}
    </PageContainer>
  )
}
