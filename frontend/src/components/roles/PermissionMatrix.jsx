import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, ChevronRight, Lock, Search, Settings2 } from 'lucide-react'
import { Tick } from '../app/Controls'
import { ControlChip } from '../system'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { STD_COLS, actionOf, grant, keyOf, moduleKeys, moreActions, pageKeys, revoke } from './catalogUtils'

/**
 * The role designer's grid (docs/04 §4.3): modules → pages (rows) × actions (columns).
 *
 *   · ticking any action also ticks that page's View; unticking View clears the page;
 *   · a column header ticks/unticks that action on every page of the module;
 *   · None / View only / All presets per module;
 *   · 🔒 = you don't hold it yourself, so you can't grant it; amber = sensitive action;
 *   · modules outside the plan are listed at the bottom, locked.
 */
export default function PermissionMatrix({ catalog, selected, onChange, readOnly = false, defaultExpanded }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const [query, setQuery] = useState('')
  const [show, setShow] = useState('All')
  const enabled = catalog.modules.filter((m) => m.enabled)
  const locked = catalog.modules.filter((m) => !m.enabled)
  const [expanded, setExpanded] = useState(() => new Set(defaultExpanded ?? enabled.filter((m) => moduleKeys(m).some((k) => selected.has(k))).slice(0, 2).map((m) => m.id)))
  const q = query.trim().toLowerCase()

  const apply = (fn) => {
    if (readOnly) return
    const next = new Set(selected)
    fn(next)
    onChange(next)
  }
  const grantable = (a) => a.grantable !== false

  const toggle = (m, p, a) => apply((s) => (s.has(keyOf(m, p, a)) ? revoke(s, m, p, a.id) : grant(s, m, p, a.id)))

  const setModule = (m, preset) => apply((s) => {
    for (const p of m.pages) {
      for (const a of p.actions) {
        const key = keyOf(m, p, a)
        if (!grantable(a)) continue
        if (preset === 'none') s.delete(key)
        else if (preset === 'view') { if (a.id === 'view') s.add(key); else s.delete(key) }
        else s.add(key)
      }
    }
  })

  const toggleColumn = (m, actionId) => {
    const pages = m.pages.filter((p) => actionOf(p, actionId) && grantable(actionOf(p, actionId)))
    const allOn = pages.length && pages.every((p) => selected.has(keyOf(m, p, actionOf(p, actionId))))
    apply((s) => pages.forEach((p) => (allOn ? revoke(s, m, p, actionId) : grant(s, m, p, actionId))))
  }

  const matchesPage = (m, p) => !q || [m.name, cl.module(m), p.name, cl.page(m, p)].some((x) => x.toLowerCase().includes(q)) || p.actions.some((a) => a.label.toLowerCase().includes(q) || cl.action(a).toLowerCase().includes(q))
  const visible = useMemo(() => enabled.map((m) => ({
    ...m,
    shownPages: m.pages.filter((p) => matchesPage(m, p) && (show === 'All' || pageKeys(m, p).some((k) => selected.has(k)))),
  })).filter((m) => m.shownPages.length), [enabled, q, show, selected, cl]) // eslint-disable-line react-hooks/exhaustive-deps

  const showLabels = { All: t('admin.permissionMatrix.all'), Granted: t('admin.permissionMatrix.granted') }
  const isOpen = (id) => expanded.has(id) || !!q || show === 'Granted'
  const flip = (id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.permissionMatrix.searchPlaceholder')} className="w-full h-9 ps-9 pe-3 rounded-md border border-border bg-surface text-sm outline-none focus:border-brand-500" />
        </div>
        <div className="flex gap-2">
          <ControlChip label={t('admin.permissionMatrix.show')} value={showLabels[show]} active={show !== 'All'} options={Object.values(showLabels)} onChange={(v) => setShow(Object.keys(showLabels).find((k) => showLabels[k] === v) ?? 'All')} />
          <button type="button" onClick={() => setExpanded(expanded.size ? new Set() : new Set(enabled.map((m) => m.id)))} className="h-8 px-3 rounded-full text-sm text-ink-muted hover:bg-black/5">
            {expanded.size ? t('admin.permissionMatrix.collapseAll') : t('admin.permissionMatrix.expandAll')}
          </button>
        </div>
      </div>

      {catalog.categories.map((cat) => {
        const mods = visible.filter((m) => m.category === cat.id)
        if (!mods.length) return null
        return (
          <section key={cat.id}>
            <div className="flex items-center gap-2 px-1 mb-1.5 mt-4">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: cat.color }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{cl.category(cat)}</span>
            </div>
            <div className="space-y-2">
              {mods.map((m) => {
                const all = moduleKeys(m)
                const granted = all.filter((k) => selected.has(k)).length
                const state = granted === 0 ? false : granted === all.length ? true : 'some'
                const Icon = iconFor(m.icon)
                const open = isOpen(m.id)
                return (
                  <div key={m.id} className={clsx('rounded-lg border bg-surface', granted ? 'border-brand-200' : 'border-border')}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button type="button" onClick={() => flip(m.id)} className="text-ink-faint hover:text-ink" aria-label={open ? t('admin.permissionMatrix.collapse') : t('admin.permissionMatrix.expand')}>
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                      </button>
                      <Tick state={state} disabled={readOnly} label={t('admin.permissionMatrix.allOf', { module: cl.module(m) })} onClick={() => setModule(m, state === true ? 'none' : 'all')} />
                      <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${cat.color}14`, color: cat.color }}><Icon className="w-4 h-4" /></span>
                      <button type="button" onClick={() => flip(m.id)} className="min-w-0 flex-1 text-start">
                        <span className="block text-sm font-medium text-ink truncate">{cl.module(m)}{m.internal && <span className="ms-1.5 text-[10px] text-ink-faint font-normal">{t('admin.permissionMatrix.shared')}</span>}</span>
                        <span className="block text-xs text-ink-faint truncate">{cl.description(m) || m.desc}</span>
                      </button>
                      <span className="hidden sm:inline text-xs tabular-nums text-ink-muted shrink-0">{granted}/{all.length}</span>
                      {!readOnly && (
                        <div className="hidden md:flex items-center rounded-md border border-border overflow-hidden shrink-0 text-xs">
                          {[['none', t('admin.permissionMatrix.presetNone')], ['view', t('admin.permissionMatrix.presetView')], ['all', t('admin.permissionMatrix.all')]].map(([v, l]) => (
                            <button key={v} type="button" onClick={() => setModule(m, v)} className="px-2 py-1 hover:bg-bg text-ink-muted hover:text-ink border-s first:border-s-0 border-border">{l}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {open && (
                      <div className="border-t border-border overflow-x-auto scroll-thin">
                        <table className="w-full text-sm min-w-[640px]">
                          <thead>
                            <tr className="bg-bg/70 text-[11px] uppercase tracking-wide text-ink-faint">
                              <th className="text-start font-semibold px-3 py-2 w-[34%]">{t('admin.permissionMatrix.page')}</th>
                              {STD_COLS.map((c) => (
                                <th key={c.id} className="font-semibold px-2 py-2 w-[9%]">
                                  <button type="button" disabled={readOnly} onClick={() => toggleColumn(m, c.id)} className="uppercase tracking-wide hover:text-brand-600 disabled:hover:text-ink-faint" title={t('admin.permissionMatrix.tickColumn', { action: cl.action(c).toLocaleLowerCase() })}>{cl.action(c)}</button>
                                </th>
                              ))}
                              <th className="text-start font-semibold px-3 py-2">{t('admin.permissionMatrix.moreActions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {m.shownPages.map((p) => (
                              <tr key={p.id} className="hover:bg-bg/40">
                                <td className="px-3 py-2">
                                  <span className="text-ink">{cl.page(m, p)}</span>
                                  {p.setup && <span title={t('admin.permissionMatrix.setupTitle')} className="ms-1.5 inline-flex items-center gap-0.5 text-[10px] text-ink-faint align-middle"><Settings2 className="w-3 h-3" />{t('admin.permissionMatrix.setup')}</span>}
                                  {p.nav === false && <span className="ms-1.5 text-[10px] text-ink-faint">{t('admin.permissionMatrix.actionOnly')}</span>}
                                </td>
                                {STD_COLS.map((c) => {
                                  const a = actionOf(p, c.id)
                                  if (!a) return <td key={c.id} className="text-center text-ink-faint/50">—</td>
                                  const on = selected.has(keyOf(m, p, a))
                                  return (
                                    <td key={c.id} className="text-center py-2">
                                      <span className="inline-flex"><Tick state={on} disabled={readOnly} locked={!grantable(a)} label={`${cl.page(m, p)}: ${cl.action(a)}`} onClick={() => toggle(m, p, a)} /></span>
                                    </td>
                                  )
                                })}
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1.5">
                                    {moreActions(p).map((a) => {
                                      const on = selected.has(keyOf(m, p, a))
                                      return (
                                        <span key={a.id} className={clsx('inline-flex items-center gap-1.5 rounded-md border ps-1 pe-2 py-0.5 text-xs',
                                          a.sensitive ? (on ? 'border-amber-400/60 bg-amber-50 text-amber-600' : 'border-amber-400/30 text-ink-muted') : on ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-border text-ink-muted')}>
                                          <Tick size={14} state={on} disabled={readOnly} locked={!grantable(a)} tone={a.sensitive ? 'warning' : 'brand'} label={`${cl.page(m, p)}: ${cl.action(a)}`} onClick={() => toggle(m, p, a)} />
                                          {cl.action(a)}
                                          {a.sensitive && <AlertTriangle className="w-3 h-3 text-amber-600" aria-label={t('admin.permissionMatrix.sensitive')} />}
                                        </span>
                                      )
                                    })}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {!visible.length && <p className="text-sm text-ink-muted text-center py-10">{t('admin.permissionMatrix.noMatch', { query })}</p>}

      {locked.length > 0 && !q && show === 'All' && (
        <section className="mt-6 rounded-lg border border-dashed border-border p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-2 flex items-center gap-1.5"><Lock className="w-3 h-3" /> {t('admin.permissionMatrix.notOn', { count: locked.length })}</p>
          <div className="flex flex-wrap gap-1.5">
            {locked.map((m) => {
              const Icon = iconFor(m.icon)
              return <span key={m.id} title={m.inPlan ? t('admin.permissionMatrix.switchedOff') : t('admin.permissionMatrix.notInPlan')} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-bg text-ink-faint"><Icon className="w-3.5 h-3.5" />{cl.module(m)}{!m.inPlan && <span className="text-[10px]">· {t('admin.permissionMatrix.upgrade')}</span>}</span>
            })}
          </div>
        </section>
      )}
    </div>
  )
}
