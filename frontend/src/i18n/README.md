# Translations (i18n)

i18next + react-i18next. 13 languages: `en` plus `hi kn ta te ml mr gu bn pa or ur`
(`packages/shared/src/languages.js` → `SUPPORTED_LANGUAGES`).

## Files

```
locales/<lang>/<namespace>.json
```

| namespace | what goes in it | loaded |
|---|---|---|
| `common` | truly shared words only: `actions.*`, `status.*`, `notifications.*`, `language.*`, `auth.*`, `home.*`, `search.*` | before first render |
| `ui` | shared components — `components/system`, `components/ui`, `layouts` (`ui.table.*`, `ui.modal.*`, …) | before first render |
| `nav` | top bar / menu chrome (sign out, alerts, …) | before first render |
| `catalog` | module / page / action / category names from `packages/shared/src/catalog.js`, keyed by id | before first render |
| `portal` | patient portal (keys are **not** wrapped, see below) | when a portal screen mounts |
| `<module>` | one per module: `cssd`, `assets`, `quality`, `inventory`, `procurement`, … | when a screen calls `useTranslation('<module>')` |

**Module files keep their prefix as the single top-level key**, so keys in code are unchanged:

```jsonc
// locales/en/cssd.json
{ "cssd": { "title": "CSSD", "cycles": { "new": "New cycle" } } }
```

```jsx
const { t } = useTranslation('cssd')   // loads cssd.json for the active language
t('cssd.cycles.new')                    // same key as before the split
t('actions.save')                       // common keys still resolve (fallback namespace)
```

## Adding a module

1. Put its keys in `locales/en/<module>.json` as `{ "<module>": { … } }` — **not** in `common.json`.
2. Add the same file, translated, for every other language (`hi kn ta te ml mr gu bn pa or ur`).
   Keep `{{placeholders}}` identical; use `_one` / `_other` suffixes for counts (`t('x', { count })`).
3. In each component of that module: `useTranslation('<module>')`. A screen that also needs another
   module's keys: `useTranslation(['<module>', '<other>'])` (first one is looked up first).
4. Nothing to register — `index.js` discovers files with `import.meta.glob`, and new namespaces are
   picked up on the next build.

A script that writes keys should target `locales/<lang>/<module>.json`. (If keys do land in
`common.json` under a module prefix, moving them out is a mechanical split: same prefix → file of
that name, merged, then removed from `common.json`.)

## How loading works (`index.js`)

- **English is bundled** (all namespaces) and is the fallback for any missing key or namespace.
- Other languages are fetched per namespace with dynamic imports (one small chunk each):
  the core namespaces (`common ui nav catalog`) before the app renders (`i18nReady` in
  `main.jsx`), a module namespace the first time a component asks for it. Until it arrives the
  screen shows English, then re-renders.
- `fallbackNS` lists every namespace, so a key still shows (in English at worst) if a component
  forgot to name its namespace — but name it, otherwise the translation never loads.
- `changeLanguage(code)` loads every namespace in use for the new language, then switches.
  Order of preference at sign-in: the user's saved language (`/auth/me` → `language`) → this
  browser's choice (`localStorage.hx_language`) → hospital default (`core.defaultAppLanguage`
  setting) → `en`. The patient portal defaults to the patient's preferred language.
- Script fonts (Noto Sans Devanagari, Tamil, …, Noto Nastaliq Urdu) are added only when that
  language is active (`fonts.js`); `index.css` picks them per `:lang()`.

## Catalog labels

Module / page / action names are translated by id, never by English text:

```js
import { useCatalogLabel } from '../hooks/useCatalogLabel'
const cl = useCatalogLabel()
cl.module(mod)            // catalog:modules.<id>         → falls back to mod.name
cl.page(mod.id, page)     // catalog:pages.<module>.<page> → falls back to page.name
cl.action(action)         // catalog:actions.<id>          → falls back to action.label
cl.category(cat)          // catalog:categories.<id>       → falls back to cat.label
```

## RTL (Urdu)

`<html dir="rtl">` is set for Urdu. Use logical Tailwind classes — `ms-/me-/ps-/pe-`,
`start-/end-`, `text-start/text-end`, `border-s/border-e`, `rounded-s/e` — instead of
`ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`, and `rtl:rotate-180` on arrows/chevrons that
point "forward"/"back". `components/system`, `components/ui` and `layouts` already follow this.

## Checks

`npm run build` and `npm run lint:pages` from the repo root.
