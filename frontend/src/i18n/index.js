import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, getLanguage } from '@schoolgiant/shared'
import { applyLanguageFont } from './fonts'
import { configureFormat } from '../utils/format'

// ── Translation resources ───────────────────────────────────────────────────────────────
// One JSON file per namespace per language: locales/<lang>/<namespace>.json (see README.md).
//  · English is bundled (it is the fallback for every missing key), so it never loads late.
//  · Every other language is fetched on demand, one namespace at a time: the core namespaces
//    before the app first renders, a module's namespace when a screen calls
//    useTranslation('<module>').
const EN_BUNDLES = import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' })
const LAZY_BUNDLES = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json'], { import: 'default' })

const nsOf = (path) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length)

/** Loaded with the language before the first render (shell, menu, shared components). */
export const CORE_NAMESPACES = ['common', 'ui', 'nav', 'catalog', 'errors']
/** Every namespace that exists (from the English files). */
export const ALL_NAMESPACES = Object.keys(EN_BUNDLES).map(nsOf)

const enResources = Object.fromEntries(Object.entries(EN_BUNDLES).map(([path, data]) => [nsOf(path), data]))

/** i18next backend that resolves locales/<lng>/<ns>.json through Vite's dynamic imports. */
const lazyBackend = {
  type: 'backend',
  init() {},
  read(lng, ns, callback) {
    const load = LAZY_BUNDLES[`./locales/${lng}/${ns}.json`]
    // Not translated yet → an empty bundle, and every key falls back to English.
    if (!load) return callback(null, {})
    load().then((data) => callback(null, data), (err) => callback(err, null))
  },
}

const STORAGE_KEY = 'hx_language'
const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code)
const isSupported = (code) => !!code && SUPPORTED_CODES.includes(code)

/** The language this browser chose last (null when it never chose one). */
export const getStoredLanguage = () => {
  try {
    const code = localStorage.getItem(STORAGE_KEY)
    return isSupported(code) ? code : null
  } catch {
    return null
  }
}

export const getSavedLanguage = () => getStoredLanguage() || DEFAULT_LANGUAGE

export const setSavedLanguage = (langCode) => {
  try {
    localStorage.setItem(STORAGE_KEY, langCode)
  } catch {
    // Ignore private storage error
  }
}

/** The signed-in staff profile cached by api/auth.js (read directly to avoid an import cycle). */
const cachedProfile = () => {
  try {
    return JSON.parse(localStorage.getItem('erp_user') || 'null')
  } catch {
    return null
  }
}

/**
 * Which language a signed-in staff member sees:
 * their own saved choice → this browser's last choice → the institution default → English.
 */
export function languageForProfile(me) {
  if (isSupported(me?.user?.language)) return me.user.language
  const stored = getStoredLanguage()
  if (stored) return stored
  if (isSupported(me?.tenant?.defaultLanguage)) return me.tenant.defaultLanguage
  return DEFAULT_LANGUAGE
}

const initialLang = cachedProfile()?.user ? languageForProfile(cachedProfile()) : getSavedLanguage()

const initPromise = i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    resources: { en: enResources },
    partialBundledLanguages: true, // en is bundled, the rest come from lazyBackend
    lng: initialLang,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_CODES,
    ns: CORE_NAMESPACES,
    defaultNS: 'common',
    // A key is looked up in the component's namespace first, then in common, then in any other
    // loaded namespace — so a t('cssd.x') that reaches a screen whose namespace list misses
    // 'cssd' still shows the English text instead of the raw key.
    fallbackNS: ['common', ...ALL_NAMESPACES.filter((n) => n !== 'common')],
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false,
    },
  })

// Sync HTML direction (for RTL Urdu), lang attribute and the script's web font
export function syncDocumentLang(code) {
  if (typeof document === 'undefined') return
  const langMeta = getLanguage(code)
  document.documentElement.lang = langMeta.code
  document.documentElement.dir = langMeta.dir || 'ltr'
  applyLanguageFont(langMeta.code)
  configureFormat({ locale: langMeta.code === 'en' ? 'en-IN' : langMeta.code })
}

// Initial document sync
syncDocumentLang(initialLang)

/**
 * Resolves once the active language's core namespaces are loaded (or after a few seconds
 * at most — a failed or slow fetch leaves English showing rather than a blank page).
 */
export const i18nReady = Promise.race([
  initPromise.catch(() => i18n.changeLanguage(DEFAULT_LANGUAGE)),
  new Promise((resolve) => setTimeout(resolve, 4000)),
]).catch(() => {})

/**
 * Change the active application language. Loads the language's namespaces that are in use
 * before switching, so the screen flips in one go.
 * @param {string} code - e.g. 'en', 'hi', 'kn', 'ta'
 * @param {{ persist?: boolean }} [opts] - persist: false applies it without remembering it
 *   in this browser (e.g. a signed-in user's saved preference).
 */
export async function changeLanguage(code, { persist = true } = {}) {
  const target = getLanguage(code).code
  if (i18n.language !== target) {
    try {
      await i18n.changeLanguage(target)
    } catch {
      await i18n.changeLanguage(DEFAULT_LANGUAGE)
    }
  }
  if (persist) setSavedLanguage(target)
  syncDocumentLang(i18n.language)
  window.dispatchEvent(new CustomEvent('hx:language-changed', { detail: { language: target } }))
  return target
}

/**
 * Apply a freshly read staff profile's language (sign-in, /auth/me refresh). Only acts when the
 * profile's language inputs changed, so a periodic refresh never fights the user's selector.
 */
export function applyProfileLanguage(me, before) {
  const sig = (u) => (u ? `${u.user?.id}|${u.user?.language ?? ''}|${u.tenant?.defaultLanguage ?? ''}` : '')
  if (before && sig(before) === sig(me)) return
  const target = languageForProfile(me)
  // the user's own saved choice is also remembered in this browser (sign-in screen next time);
  // the institution default is not, so it never masquerades as a choice
  if (target !== i18n.language) changeLanguage(target, { persist: isSupported(me?.user?.language) })
}

/** Load a namespace for the active language (and English) ahead of use. */
export async function loadLanguageNamespace(lang, namespace) {
  if (lang && lang !== i18n.language) await i18n.loadLanguages(lang)
  await i18n.loadNamespaces(namespace)
}

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE }
export default i18n
