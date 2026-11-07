import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Check, Columns3, Minus, ShieldCheck, X } from 'lucide-react'
import { hasPermissionIn } from '@schoolgiant/shared'
import { EmptyState, PageContainer, PageHeader, Panel, Select } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { compareRoles, fetchCatalog, fetchRoles } from '../../api/core'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

/** Side-by-side permissions of 2–4 roles (docs/04 §4.6) — for reviews and audits. */
export default function RoleCompare() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const [params, setParams] = useSearchParams()
  const ids = (params.get('ids') || '').split(',').filter(Boolean)
  const [onlyDiff, setOnlyDiff] = useState(true)
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles })
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog })
  const { data: chosen = [], isFetching } = useQuery({ queryKey: ['roles-compare', ids.join(',')], queryFn: () => compareRoles(ids), enabled: ids.length >= 2 })

  const setIds = (next) => setParams(next.length ? { ids: next.join(',') } : {})
  const ordered = ids.map((id) => chosen.find((r) => r.id === id)).filter(Boolean)
  const holds = (role, key) => (role.fullAccess ? true : hasPermissionIn(role.permissions, key))

  const rows = useMemo(() => {
    if (!catalog || ordered.length < 2) return []
    const out = []
    for (const m of catalog.modules.filter((x) => x.enabled)) {
      const pageRows = []
      for (const p of m.pages) {
        const actions = p.actions.map((a) => ({ ...a, cells: ordered.map((r) => holds(r, a.key)) }))
          .filter((a) => a.cells.some(Boolean))
          .filter((a) => !onlyDiff || new Set(a.cells).size > 1)
        if (actions.length) pageRows.push({ page: p, actions })
      }
      if (pageRows.length) out.push({ module: m, pages: pageRows })
    }
    return out
  }, [catalog, ordered, onlyDiff]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = ordered.map((r) => (r.fullAccess ? '∞' : r.permissions.length))

  return (
    <PageContainer>
      <PageHeader icon={Columns3} title={t('admin.roleCompare.title')} subtitle={t('admin.roleCompare.subtitle')}
        actions={<Button to="/core/roles" variant="secondary" icon={ArrowLeft}>{t('admin.roleCompare.roles')}</Button>} />

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          {ids.map((id) => {
            const r = roles.find((x) => x.id === id)
            return (
              <span key={id} className="inline-flex items-center gap-1.5 ps-2.5 pe-1 py-1 rounded-full bg-brand-50 text-brand-700 text-sm">
                {r?.name ?? '…'}
                <button onClick={() => setIds(ids.filter((x) => x !== id))} className="w-5 h-5 rounded-full hover:bg-brand-100 flex items-center justify-center" aria-label={t('admin.roleCompare.remove', { name: r?.name ?? '' })}><X className="w-3 h-3" /></button>
              </span>
            )
          })}
          {ids.length < 4 && (
            <div className="w-56">
              <Select value="" onChange={(e) => e.target.value && setIds([...ids, e.target.value])} placeholder={t('admin.roleCompare.addRole')}>
                <option value="">{t('admin.roleCompare.addRole')}</option>
                {roles.filter((r) => !ids.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
          )}
          <label className="ms-auto flex items-center gap-2 text-sm text-ink-muted">
            <Switch size="sm" checked={onlyDiff} onChange={setOnlyDiff} label={t('admin.roleCompare.onlyDiff')} /> {t('admin.roleCompare.onlyDiff')}
          </label>
        </div>
      </Panel>

      {ids.length < 2 ? (
        <EmptyState icon={Columns3} title={t('admin.roleCompare.pickTwo')} hint={t('admin.roleCompare.pickTwoHint')} />
      ) : (
        <div className="rounded-xl border border-border bg-surface shadow-card overflow-x-auto scroll-thin">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="border-b border-border">
                <th className="text-start px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wide">{t('admin.roleCompare.pageAction')}</th>
                {ordered.map((r, i) => (
                  <th key={r.id} className="px-3 py-3 text-center min-w-[140px]">
                    <span className="flex items-center justify-center gap-1.5 font-medium text-ink">{r.fullAccess && <ShieldCheck className="w-4 h-4 text-amber-600" />}{r.name}</span>
                    <span className="block text-[11px] text-ink-faint font-normal">{r.fullAccess ? t('admin.roleCompare.unlimited') : t('admin.roles.permissions', { count: counts[i] })}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isFetching && !rows.length && <tr><td colSpan={ordered.length + 1} className="px-4 py-10 text-center text-ink-faint">{t('ui.common.loading')}</td></tr>}
              {!isFetching && rows.length === 0 && <tr><td colSpan={ordered.length + 1} className="px-4 py-10 text-center text-ink-muted">{onlyDiff ? t('admin.roleCompare.same') : t('admin.roleCompare.nothing')}</td></tr>}
              {rows.map(({ module: m, pages }) => {
                const Icon = iconFor(m.icon)
                return [
                  <tr key={m.id} className="bg-bg/70 border-y border-border">
                    <td colSpan={ordered.length + 1} className="px-4 py-2"><div className="text-xs font-semibold text-ink flex items-center gap-2"><Icon className="w-3.5 h-3.5 text-ink-muted" />{cl.module(m)}</div></td>
                  </tr>,
                  ...pages.flatMap(({ page, actions }) => actions.map((a, i) => (
                    <tr key={a.key} className="border-b border-border/60 hover:bg-bg/40">
                      <td className="px-4 py-1.5">
                        {i === 0 ? <span className="text-ink">{cl.page(m, page)}</span> : <span className="text-transparent select-none">{cl.page(m, page)}</span>}
                        <span className={clsx('ms-2 text-xs', a.sensitive ? 'text-amber-600' : 'text-ink-muted')}>{cl.action({ id: String(a.key).split('.').pop(), label: a.label })}</span>
                      </td>
                      {a.cells.map((on, j) => (
                        <td key={j} className="text-center py-1.5">
                          {on ? <Check className="w-4 h-4 text-success-500 inline" strokeWidth={2.5} /> : <Minus className="w-4 h-4 text-ink-faint/50 inline" />}
                        </td>
                      ))}
                    </tr>
                  ))),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  )
}
