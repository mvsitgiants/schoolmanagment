// The app's translation files (frontend/src/i18n/locales/<lang>/<namespace>.json), read by the print engine for
// labels ({{t}}) and by words.js for amounts, dates and classes in words (printWords.json). Read once, then cached.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES_DIR = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/src/i18n/locales'),
  path.resolve(process.cwd(), 'frontend/src/i18n/locales'),
  path.resolve(process.cwd(), '../frontend/src/i18n/locales'),
].find((d) => fs.existsSync(d)) || null

const bundleCache = new Map()

/** One namespace of one language as parsed JSON, or null when that file isn't there. */
export function getBundle(lang, ns) {
  // a language code only ('hi', 'pt-BR') — it becomes part of a file path
  if (!LOCALES_DIR || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(lang ?? '')) || !/^[A-Za-z]+$/.test(ns)) return null
  const cacheKey = `${lang}:${ns}`
  if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey)
  const file = path.join(LOCALES_DIR, lang, `${ns}.json`)
  let data = null
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  }
  bundleCache.set(cacheKey, data)
  return data
}
