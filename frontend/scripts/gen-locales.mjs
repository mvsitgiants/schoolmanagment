#!/usr/bin/env node
/**
 * Regenerates the English locale files that mirror the shared package, so the names a
 * translator sees always match the product:
 *   catalog.json        ← packages/shared/src/catalog.js (categories, modules, pages, actions, scopes, limits)
 *   settings.json       ← settings.js (defs.<module>.<key>.label / help / options)
 *   notifications.json  ← notifications.js (default wording of every family message)
 * Hand-written parts of these files (catalog.modulePage, settings.page) are kept as they are.
 *
 *   npm run gen:locales --workspace @schoolgiant/frontend
 *
 * Run it after changing the catalog, a setting or a notification event; then translate the
 * same keys in locales/<lang>/ for every other language you have switched on.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, MODULES, NOTIFY_EVENTS, ROLE_LIMITS, SCOPE_LABELS, SETTINGS, STANDARD_ACTIONS } from '@schoolgiant/shared'

const EN = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'i18n', 'locales', 'en')
const read = (ns) => JSON.parse(readFileSync(join(EN, `${ns}.json`), 'utf8'))
const write = (ns, data) => writeFileSync(join(EN, `${ns}.json`), `${JSON.stringify(data, null, 2)}\n`)

// ── catalog
{
  const old = read('catalog').catalog ?? {}
  const actions = { ...STANDARD_ACTIONS }
  for (const m of MODULES) for (const p of m.pages) for (const a of p.actions) actions[a.id] ??= a.label
  write('catalog', {
    catalog: {
      categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])),
      modules: Object.fromEntries(MODULES.map((m) => [m.id, m.name])),
      descriptions: Object.fromEntries(MODULES.map((m) => [m.id, m.desc])),
      pages: Object.fromEntries(MODULES.map((m) => [m.id, Object.fromEntries(m.pages.map((p) => [p.id, p.name]))])),
      actions: Object.fromEntries(Object.entries(actions).sort(([a], [b]) => a.localeCompare(b))),
      scopes: { ...SCOPE_LABELS },
      limits: Object.fromEntries(ROLE_LIMITS.map((l) => [l.key.replace(/\./g, '_'), l.label])),
      modulePage: old.modulePage ?? {},
    },
  })
}

// ── settings
{
  const old = read('settings').settings ?? {}
  const optKey = (v) => String(v).replace(/\./g, '_')
  const defs = {}
  for (const d of SETTINGS) {
    const row = { label: d.label }
    if (d.help) row.help = d.help
    if (d.options?.length) row.options = Object.fromEntries(d.options.map((o) => [optKey(o.value), o.label]))
    ;(defs[d.module] ??= {})[d.key] = row
  }
  write('settings', { settings: { page: old.page ?? {}, defs } })
}

// ── notifications
{
  const events = {}
  for (const e of NOTIFY_EVENTS) {
    events[e.event.replace(/\./g, '_')] = Object.fromEntries(Object.entries(e.defaults).map(([ch, d]) => [ch, Object.fromEntries(['subject', 'body'].filter((k) => d[k]).map((k) => [k, d[k]]))]))
  }
  write('notifications', { notifications: { events } })
}

console.log('✓ catalog.json, settings.json and notifications.json regenerated from @schoolgiant/shared')
