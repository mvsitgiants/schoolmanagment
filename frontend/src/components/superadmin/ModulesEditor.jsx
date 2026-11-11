import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { CATEGORIES } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Note, Panel, SegmentedControl, useConfirm } from '../system'
import Button from '../ui/Button'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { saveTenantModules } from '../../api/superadmin'

const today = () => new Date().toISOString().slice(0, 10)

/** The draft the editor works on, built from the institution's module list. */
function draftFrom(modules) {
  const adds = {}
  const removals = {}
  const hidden = {}
  for (const m of modules) {
    if (m.addOn) adds[m.id] = { until: m.addOn.until ?? '', note: m.addOn.note ?? '' }
    if (m.removal) removals[m.id] = { note: m.removal.note ?? '' }
    for (const p of m.pages ?? []) if (p.hidden) hidden[p.key] = { note: p.note ?? '' }
  }
  return { adds, removals, hidden }
}

/**
 * Super admin › Institution › Modules & screens: give this institution extra modules (optionally until a
 * date), take plan modules away, and hide single screens. Nothing changes until "Save changes".
 */
export default function ModulesEditor({ tenantId, planName, modules, canEdit, onSaved }) {
  const { t } = useTranslation('superadmin')
  const cl = useCatalogLabel()
  const { date } = useFormat()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const initial = useMemo(() => draftFrom(modules), [modules])
  const [draft, setDraft] = useState(initial)
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null) // module id whose add-on form is open
  const [filter, setFilter] = useState('ALL')
  const [q, setQ] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const stateOf = (m) => {
    if (m.mandatory) return 'ALWAYS'
    if (draft.removals[m.id]) return 'REMOVED'
    if (draft.adds[m.id]) return draft.adds[m.id].until && draft.adds[m.id].until < today() ? 'ENDED' : 'ADDED'
    return m.planIncludes ? 'PLAN' : 'NONE'
  }
  const hiddenCount = (m) => (m.pages ?? []).filter((p) => draft.hidden[p.key]).length
  const counts = useMemo(() => {
    const c = { PLAN: 0, ADDED: 0, REMOVED: 0, NONE: 0, hidden: Object.keys(draft.hidden).length }
    for (const m of modules) { const s = stateOf(m); if (s === 'ALWAYS' || s === 'PLAN') c.PLAN++; else if (s === 'ENDED') c.NONE++; else c[s]++ }
    return c
  }, [modules, draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fn) => setDraft((d) => { const n = { adds: { ...d.adds }, removals: { ...d.removals }, hidden: { ...d.hidden } }; fn(n); return n })
  const addModule = (id) => { set((n) => { n.adds[id] = { until: '', note: '' }; delete n.removals[id] }); setEditing(id) }
  const dropAdd = (id) => set((n) => { delete n.adds[id] })
  const takeAway = (id) => set((n) => { n.removals[id] = { note: '' }; delete n.adds[id] })
  const giveBack = (id) => set((n) => { delete n.removals[id] })
  const toggleScreen = (key) => set((n) => { if (n.hidden[key]) delete n.hidden[key]; else n.hidden[key] = { note: '' } })

  const save = useMutation({
    mutationFn: () => saveTenantModules(tenantId, {
      moduleAdds: Object.entries(draft.adds).map(([moduleId, a]) => ({ moduleId, until: a.until || '', note: a.note || undefined })),
      moduleRemovals: Object.entries(draft.removals).map(([moduleId, r]) => ({ moduleId, note: r.note || undefined })),
      hiddenPages: Object.entries(draft.hidden).map(([key, h]) => ({ key, note: h.note || undefined })),
    }),
    onSuccess: (r) => {
      showSuccess(t('superadmin.modulesEditor.saved', { on: r.changes.enabled.length, off: r.changes.disabled.length }))
      setEditing(null)
      onSaved?.()
    },
    onError: (e) => showError(e.message),
  })
  const askSave = async () => {
    if (await confirm({ title: t('superadmin.modulesEditor.confirm.title'), message: t('superadmin.modulesEditor.confirm.message'), confirmLabel: t('superadmin.modulesEditor.save') })) save.mutate()
  }

  const match = (m) => {
    const s = stateOf(m)
    if (filter === 'PLAN' && !(s === 'PLAN' || s === 'ALWAYS')) return false
    if (filter === 'ADDED' && !(s === 'ADDED' || s === 'ENDED')) return false
    if (filter === 'REMOVED' && s !== 'REMOVED') return false
    if (filter === 'NONE' && s !== 'NONE') return false
    if (filter === 'HIDDEN' && !hiddenCount(m)) return false
    const needle = q.trim().toLowerCase()
    return !needle || cl.module(m.id).toLowerCase().includes(needle) || (m.pages ?? []).some((p) => cl.page(m.id, p.id).toLowerCase().includes(needle))
  }

  return (
    <div className="space-y-4">
      <Note>{t('superadmin.modulesEditor.intro', { plan: planName })}</Note>
      <p className="text-sm text-ink">
        {t('superadmin.modulesEditor.summary', { plan: planName, inPlan: counts.PLAN, added: counts.ADDED, removed: counts.REMOVED, hidden: counts.hidden })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={filter} onChange={setFilter} options={[
          { value: 'ALL', label: t('superadmin.modulesEditor.filter.all') },
          { value: 'PLAN', label: t('superadmin.modulesEditor.filter.plan') },
          { value: 'ADDED', label: t('superadmin.modulesEditor.filter.added') },
          { value: 'REMOVED', label: t('superadmin.modulesEditor.filter.removed') },
          { value: 'NONE', label: t('superadmin.modulesEditor.filter.none') },
          { value: 'HIDDEN', label: t('superadmin.modulesEditor.filter.hidden') },
        ]} />
        <div className="relative ms-auto w-64 max-w-full">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
          <Input className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('superadmin.modulesEditor.search')} />
        </div>
      </div>

      {CATEGORIES.map((c) => {
        const list = modules.filter((m) => m.category === c.id && !m.internal && match(m))
        if (!list.length) return null
        return (
          <Panel key={c.id} title={cl.category(c)}>
            <ul className="-my-2 divide-y divide-border">
              {list.map((m) => {
                const s = stateOf(m)
                const Icon = iconFor(m.icon)
                const add = draft.adds[m.id]
                const nHidden = hiddenCount(m)
                const isOpen = open === m.id
                return (
                  <li key={m.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => setOpen(isOpen ? null : m.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-start" aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />}
                        <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                        <span className="min-w-0">
                          <span className={clsx('block truncate text-sm font-medium', s === 'REMOVED' || s === 'NONE' || s === 'ENDED' ? 'text-ink-muted' : 'text-ink')}>{cl.module(m.id)}</span>
                          <span className="block text-xs text-ink-faint">
                            {t(`superadmin.modulesEditor.state.${s}`, { date: add?.until ? date(add.until) : '' })}
                            {s === 'ADDED' && !add?.until && ` · ${t('superadmin.modulesEditor.noEnd')}`}
                            {nHidden > 0 && ` · ${t('superadmin.modulesEditor.screensHidden', { count: nHidden })}`}
                            {m.enabled && s !== 'REMOVED' && ` · ${t('superadmin.modulesEditor.onNow')}`}
                          </span>
                        </span>
                      </button>
                      {canEdit && !m.mandatory && (
                        <div className="flex shrink-0 gap-2">
                          {s === 'PLAN' && <Button size="sm" variant="ghost" onClick={() => takeAway(m.id)}>{t('superadmin.modulesEditor.takeAway')}</Button>}
                          {s === 'REMOVED' && <Button size="sm" variant="secondary" onClick={() => giveBack(m.id)}>{t('superadmin.modulesEditor.giveBack')}</Button>}
                          {s === 'NONE' && <Button size="sm" variant="secondary" onClick={() => addModule(m.id)}>{t('superadmin.modulesEditor.add')}</Button>}
                          {(s === 'ADDED' || s === 'ENDED') && <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(editing === m.id ? null : m.id)}>{t('superadmin.modulesEditor.editAdd')}</Button>
                            <Button size="sm" variant="ghost" onClick={() => dropAdd(m.id)}>{t('superadmin.modulesEditor.removeAdd')}</Button>
                          </>}
                        </div>
                      )}
                    </div>

                    {canEdit && editing === m.id && add && (
                      <div className="mt-2 ms-10 grid gap-3 rounded-lg border border-border bg-bg p-3 sm:grid-cols-[12rem_1fr]">
                        <FormField label={t('superadmin.modulesEditor.until')} hint={t('superadmin.modulesEditor.untilHint')}>
                          <DateInput value={add.until} min={today()} onChange={(e) => set((n) => { n.adds[m.id] = { ...n.adds[m.id], until: e.target.value } })} />
                        </FormField>
                        <FormField label={t('superadmin.modulesEditor.note')} hint={t('superadmin.modulesEditor.noteHint')}>
                          <Input value={add.note} maxLength={200} onChange={(e) => set((n) => { n.adds[m.id] = { ...n.adds[m.id], note: e.target.value } })} />
                        </FormField>
                      </div>
                    )}

                    {isOpen && (
                      <div className="mt-2 ms-10">
                        <p className="mb-1.5 text-xs text-ink-muted">{t('superadmin.modulesEditor.screensHint')}</p>
                        <ul className="grid gap-1 sm:grid-cols-2">
                          {(m.pages ?? []).map((p) => {
                            const hid = !!draft.hidden[p.key]
                            return (
                              <li key={p.key}>
                                <label className={clsx('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', canEdit && 'cursor-pointer hover:bg-bg')}>
                                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!hid} disabled={!canEdit} onChange={() => toggleScreen(p.key)} />
                                  <span className={hid ? 'text-ink-faint line-through' : 'text-ink'}>{cl.page(m.id, p.id)}</span>
                                  {hid && <span className="text-xs text-ink-muted">{t('superadmin.modulesEditor.hidden')}</span>}
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Panel>
        )
      })}

      {canEdit && dirty && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface px-4 py-3 shadow-pop">
          <span className="me-auto text-sm text-ink-muted">{t('superadmin.modulesEditor.unsaved')}</span>
          <Button variant="secondary" onClick={() => { setDraft(initial); setEditing(null) }}>{t('superadmin.modulesEditor.undo')}</Button>
          <Button loading={save.isPending} onClick={askSave}>{t('superadmin.modulesEditor.save')}</Button>
        </div>
      )}
    </div>
  )
}
