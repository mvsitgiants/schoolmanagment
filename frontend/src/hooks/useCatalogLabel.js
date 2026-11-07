import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { MODULE_BY_ID, CATEGORY_BY_ID, STANDARD_ACTIONS, SCOPE_LABELS } from '@schoolgiant/shared'

// Translated names for the shared catalog (packages/shared/src/catalog.js): modules, pages,
// actions, categories, scopes, role limits. Keys live in the `catalog` namespace by id —
//   catalog.modules.<id> · catalog.pages.<module>.<page> · catalog.actions.<id> ·
//   catalog.categories.<id> · catalog.descriptions.<module> · catalog.scopes.<SCOPE> ·
//   catalog.limits.<limit key with . → _>
// and every lookup falls back to the English label carried by the catalog itself, so a
// page added to the catalog shows in English until its translation lands.

const idOf = (x) => (x && typeof x === 'object' ? x.id : x)

function make(t) {
  const tr = (key, fallback) => (fallback == null ? t(key, { ns: 'catalog' }) : t(key, { ns: 'catalog', defaultValue: fallback }))
  const moduleOf = (m) => (m && typeof m === 'object' ? m : MODULE_BY_ID[m])
  return {
    /** module object or id */
    module: (m) => {
      const mod = moduleOf(m)
      return tr(`catalog.modules.${idOf(m)}`, mod?.name ?? idOf(m))
    },
    /** module object or id → its one-line description */
    description: (m) => {
      const mod = moduleOf(m)
      return mod?.desc ? tr(`catalog.descriptions.${mod.id}`, mod.desc) : ''
    },
    /** (module object or id, page object or id) */
    page: (m, p) => {
      const mid = idOf(m)
      const page = p && typeof p === 'object' ? p : moduleOf(m)?.pages.find((x) => x.id === p)
      return tr(`catalog.pages.${mid}.${idOf(p)}`, page?.name ?? idOf(p))
    },
    /** action object ({ id, label }) or id */
    action: (a) => {
      const id = idOf(a)
      const label = (a && typeof a === 'object' && a.label) || STANDARD_ACTIONS[id] || id
      return tr(`catalog.actions.${id}`, label)
    },
    /** category object or id */
    category: (c) => tr(`catalog.categories.${idOf(c)}`, (c && typeof c === 'object' && c.label) || CATEGORY_BY_ID[c]?.label || idOf(c)),
    /** data scope id ('OWN', 'BRANCH', …) */
    scope: (s) => tr(`catalog.scopes.${s}`, SCOPE_LABELS[s] ?? s),
    /** role limit ({ key, label }) */
    limit: (l) => tr(`catalog.limits.${String(l.key).replace(/\./g, '_')}`, l.label),
  }
}

/** Non-hook form (event handlers, helpers). Re-read on each call, so it follows the language. */
export const tCatalog = make((key, opts) => i18n.t(key, opts))

/** `const cl = useCatalogLabel(); cl.module(m); cl.page(m, p); cl.action(a)` — re-renders on language change. */
export function useCatalogLabel() {
  const { t, i18n: inst } = useTranslation('catalog')
  return useMemo(() => make(t), [t, inst.language]) // eslint-disable-line react-hooks/exhaustive-deps
}

export default useCatalogLabel
