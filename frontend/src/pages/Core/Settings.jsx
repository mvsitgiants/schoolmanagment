import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Check, SlidersHorizontal } from 'lucide-react'
import { CATEGORIES, MODULE_BY_ID } from '@schoolgiant/shared'
import { FormField, Input, PageContainer, PageHeader, SearchInput, Select, useConfirm } from '../../components/system'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { fetchModuleSettings, saveModuleSettings } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

// Labels, help and option names of each setting: `settings.defs.<module>.<key>.*` (generated from
// packages/shared/settings.js), falling back to the English the API sends.
const optKey = (v) => String(v).replace(/\./g, '_')
function useSettingText() {
  const { t } = useTranslation('settings')
  return useMemo(() => ({
    label: (m, d) => t(`settings.defs.${m}.${d.key}.label`, { defaultValue: d.label }),
    help: (m, d) => (d.help ? t(`settings.defs.${m}.${d.key}.help`, { defaultValue: d.help }) : ''),
    option: (m, d, o) => t(`settings.defs.${m}.${d.key}.options.${optKey(o.value)}`, { defaultValue: o.label }),
  }), [t])
}

/** One control per setting type (engine E3: definitions live in packages/shared/settings.js). */
function Control({ module, def, value, onChange, disabled }) {
  const st = useSettingText()
  if (def.type === 'bool') return <Switch checked={!!value} onChange={onChange} disabled={disabled} label={st.label(module, def)} />
  if (def.type === 'number') return <Input type="number" min={def.min} max={def.max} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className="max-w-[160px]" />
  if (def.type === 'select') return <div className="max-w-xs"><Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{def.options.map((o) => <option key={o.value} value={o.value}>{st.option(module, def, o)}</option>)}</Select></div>
  if (def.type === 'multi') {
    const arr = value ?? []
    return (
      <div className="flex flex-wrap gap-1.5">
        {def.options.map((o) => {
          const on = arr.includes(o.value)
          return (
            <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
              className={clsx('text-xs px-2.5 py-1 rounded-full border transition', on ? 'bg-brand-500 text-white border-brand-500' : 'border-border text-ink-muted hover:border-ink-faint', disabled && 'opacity-60')}>
              {st.option(module, def, o)}
            </button>
          )
        })}
      </div>
    )
  }
  return <Input value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="max-w-md" />
}

function Group({ group, name, onDirtyChange }) {
  const { t } = useTranslation('settings')
  const st = useSettingText()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [values, setValues] = useState(group.values)
  const [errors, setErrors] = useState({})
  useEffect(() => setValues(group.values), [group.values])
  const canEdit = hasPermission('core.settings.edit')
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(group.values[k])))
  const hasChanges = Object.keys(changed).length > 0
  useEffect(() => { onDirtyChange?.(hasChanges) }, [hasChanges, onDirtyChange])
  const save = useMutation({
    mutationFn: () => saveModuleSettings(group.module, changed),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['module-settings'] }); qc.invalidateQueries({ queryKey: ['patient-meta'] }); setErrors({}); showSuccess(t('settings.page.saved', { name })) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <div>
      <div className="divide-y divide-border">
        {group.definitions.map((d) => (
          <div key={d.key} className={clsx('grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 md:gap-8 py-4', d.type === 'bool' && 'items-center')}>
            <div>
              <p className="text-sm font-medium text-ink">{st.label(group.module, d)}</p>
              {d.help && <p className="text-xs text-ink-muted mt-0.5">{st.help(group.module, d)}</p>}
            </div>
            <FormField error={errors[d.key]}>
              <Control module={group.module} def={d} value={values[d.key]} disabled={!canEdit} onChange={(v) => setValues((s) => ({ ...s, [d.key]: v }))} />
            </FormField>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="pt-4 border-t border-border flex items-center gap-3">
          <Button icon={Check} disabled={!Object.keys(changed).length} loading={save.isPending} onClick={() => save.mutate()}>{t('settings.page.save', { name })}</Button>
          {hasChanges && <span className="text-xs text-ink-muted">{t('settings.page.unsaved', { count: Object.keys(changed).length })}</span>}
        </div>
      )}
    </div>
  )
}

/** Modules in sidebar order, under their category headings (like the main menu). Searches the shown (translated) names. */
function groupedByCategory(data, q, cl, st) {
  const needle = q.trim().toLowerCase()
  const has = (s) => String(s ?? '').toLowerCase().includes(needle)
  const rows = data.filter((g) => !needle || has(cl.module(g.module)) || has(g.name)
    || g.definitions.some((d) => has(st.label(g.module, d)) || has(d.label)))
  return CATEGORIES
    .map((c) => ({ ...c, label: cl.category(c), items: rows.filter((g) => (MODULE_BY_ID[g.module]?.category ?? 'platform') === c.id) }))
    .filter((c) => c.items.length)
}

export default function Settings() {
  const { t } = useTranslation('settings')
  const cl = useCatalogLabel()
  const st = useSettingText()
  const { data = [], isLoading } = useQuery({ queryKey: ['module-settings'], queryFn: fetchModuleSettings })
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [dirty, setDirty] = useState(false)
  const confirm = useConfirm()
  const tab = params.get('module')
  const active = data.find((g) => g.module === tab) ?? data[0]
  const sections = useMemo(() => groupedByCategory(data, q, cl, st), [data, q, cl, st])
  const nameOf = (g) => cl.module(g.module) || g.name

  const open = async (module) => {
    if (module === active?.module) return
    if (dirty && !(await confirm({ title: t('settings.page.leaveTitle'), message: t('settings.page.leaveMessage', { name: active ? nameOf(active) : '' }), tone: 'danger', confirmLabel: t('settings.page.discard') }))) return
    setDirty(false)
    setParams((p) => { p.set('module', module); return p }, { replace: true })
  }

  return (
    <PageContainer>
      <PageHeader icon={SlidersHorizontal} title={t('settings.page.title')} subtitle={t('settings.page.subtitle')} />
      {isLoading ? <div className="h-64 rounded-xl bg-black/5 animate-pulse" /> : (
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
          {/* phone / tablet: a picker instead of the side menu */}
          <div className="lg:hidden w-full">
            <Select value={active?.module ?? ''} onChange={(e) => open(e.target.value)} aria-label={t('settings.page.module')}>
              {sections.map((c) => (
                <optgroup key={c.id} label={c.label}>
                  {c.items.map((g) => <option key={g.module} value={g.module}>{nameOf(g)}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>

          {/* desktop: vertical sub-menu */}
          <nav aria-label={t('settings.page.sections')} className="hidden lg:flex flex-col w-60 shrink-0 sticky top-0 max-h-[calc(100dvh-9rem)] rounded-xl border border-border bg-surface shadow-card">
            <div className="p-2.5 border-b border-border"><SearchInput value={q} onChange={setQ} placeholder={t('settings.page.find')} /></div>
            <div className="flex-1 overflow-y-auto scroll-thin p-2">
              {sections.map((c) => (
                <div key={c.id} className="mb-2 last:mb-0">
                  <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{c.label}</p>
                  {c.items.map((g) => {
                    const Icon = iconFor(MODULE_BY_ID[g.module]?.icon)
                    const on = g.module === active?.module
                    return (
                      <button key={g.module} type="button" onClick={() => open(g.module)} aria-current={on ? 'page' : undefined}
                        className={clsx('w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-start transition-colors',
                          on ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-muted hover:bg-bg hover:text-ink')}>
                        <Icon className={clsx('w-4 h-4 shrink-0', on ? 'text-brand-600' : 'text-ink-faint')} />
                        <span className="flex-1 min-w-0 truncate">{nameOf(g)}</span>
                        <span className="text-[11px] text-ink-faint tabular-nums">{g.definitions.length}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {!sections.length && <p className="px-2.5 py-6 text-center text-sm text-ink-muted">{t('settings.page.noMatch', { q })}</p>}
            </div>
          </nav>

          <section className="flex-1 min-w-0 w-full rounded-xl border border-border bg-surface shadow-card">
            {active && (
              <>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                  {(() => { const Icon = iconFor(MODULE_BY_ID[active.module]?.icon); return <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px]" /></span> })()}
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink truncate">{nameOf(active)}</h2>
                    <p className="text-xs text-ink-muted">{t('settings.page.count', { count: active.definitions.length })}</p>
                  </div>
                </div>
                <div className="px-5 pb-5"><Group key={active.module} group={active} name={nameOf(active)} onDirtyChange={setDirty} /></div>
              </>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  )
}
