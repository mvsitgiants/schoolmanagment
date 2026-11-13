// Languages the app is offered in. SchoolGiant launches in English only.
//
// To add a language later (no code changes elsewhere):
//   1. add its row here (the commented rows below are ready to switch on),
//   2. add frontend/src/i18n/locales/<code>/*.json — the same files as locales/en/,
//   3. add its web font in frontend/src/i18n/fonts.js if it needs a non-Latin script.
// Every screen and the language picker read this list; with one language the picker hides itself.

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', script: 'Latin', dir: 'ltr', font: 'Inter, sans-serif' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', dir: 'ltr', font: "'Noto Sans Devanagari', sans-serif" },
  // { code: 'mr', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', dir: 'ltr', font: "'Noto Sans Devanagari', sans-serif" },
  // { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', dir: 'ltr', font: "'Noto Sans Gujarati', sans-serif" },
  // { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', dir: 'ltr', font: "'Noto Sans Tamil', sans-serif" },
  // { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', dir: 'ltr', font: "'Noto Sans Telugu', sans-serif" },
  // { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', dir: 'ltr', font: "'Noto Sans Kannada', sans-serif" },
  // { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', dir: 'ltr', font: "'Noto Sans Bengali', sans-serif" },
]

export const DEFAULT_LANGUAGE = 'en'

/** Lookup language metadata by code ('hi') or full English name ('Hindi') */
export function getLanguage(codeOrName) {
  if (!codeOrName) return SUPPORTED_LANGUAGES[0]
  const val = String(codeOrName).trim().toLowerCase()
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === val || l.name.toLowerCase() === val) ||
    SUPPORTED_LANGUAGES[0]
  )
}

/** Convert language name to code (e.g. 'Kannada' -> 'kn', 'Hindi' -> 'hi') */
export function langCodeFor(languageName) {
  return getLanguage(languageName)?.code || DEFAULT_LANGUAGE
}

/** Convert language code to language name (e.g. 'kn' -> 'Kannada', 'hi' -> 'Hindi') */
export function langNameFor(code) {
  return getLanguage(code)?.name || 'English'
}

/** Format label for selectors: "हिन्दी (Hindi)" */
export function languageLabel(lang) {
  const l = typeof lang === 'string' ? getLanguage(lang) : lang
  if (!l) return 'English'
  return l.code === 'en' ? 'English' : `${l.nativeName} (${l.name})`
}
