#!/usr/bin/env node
/**
 * Automated CI Translation Guardrail for SchoolGiant.
 * Enforces 100% key parity across all 12 Indic and RTL languages:
 *   en, hi, kn, ta, te, ml, mr, gu, bn, pa, or, ur
 *
 * Checks:
 *   1. Namespace Parity: Every namespace in English exists in all target locales.
 *   2. Key Parity: Every key in English exists in all target locales.
 *   3. Value Non-emptiness: No translation key is empty or null.
 *   4. Interpolation Integrity: All {{variable}} placeholders in English are preserved.
 *   5. Orphan Detection: Flags any keys present in target locales that do not exist in English.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const LOCALES_DIR = join(ROOT, 'src', 'i18n', 'locales')

const EXPECTED_LANGUAGES = ['en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr', 'gu', 'bn', 'pa', 'or', 'ur']

function flattenKeys(obj, prefix = '') {
  const result = {}
  if (!obj || typeof obj !== 'object') return result

  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenKeys(v, full))
    } else {
      result[full] = v
    }
  }
  return result
}

function extractPlaceholders(str) {
  if (typeof str !== 'string') return []
  const matches = str.match(/\{\{([a-zA-Z0-9_]+)\}\}/g)
  return matches ? [...new Set(matches)].sort() : []
}

if (!existsSync(LOCALES_DIR)) {
  console.error(`Error: Locales directory not found at ${LOCALES_DIR}`)
  process.exit(1)
}

const enDir = join(LOCALES_DIR, 'en')
if (!existsSync(enDir)) {
  console.error(`Error: English baseline locale not found at ${enDir}`)
  process.exit(1)
}

const namespaces = readdirSync(enDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort()

const targetLanguages = EXPECTED_LANGUAGES.filter((l) => l !== 'en')

let totalKeysChecked = 0
let totalErrors = 0
const errorsByLang = {}

for (const lang of targetLanguages) {
  errorsByLang[lang] = {
    missingNamespaces: [],
    missingKeys: [],
    emptyValues: [],
    missingPlaceholders: [],
    orphanKeys: [],
  }
}

for (const ns of namespaces) {
  const enFile = join(enDir, `${ns}.json`)
  let enData = {}
  try {
    enData = JSON.parse(readFileSync(enFile, 'utf8'))
  } catch (err) {
    console.error(`Error parsing ${enFile}: ${err.message}`)
    totalErrors++
    continue
  }

  const enFlat = flattenKeys(enData)
  const enKeyList = Object.keys(enFlat)
  totalKeysChecked += enKeyList.length

  for (const lang of targetLanguages) {
    const langFile = join(LOCALES_DIR, lang, `${ns}.json`)
    if (!existsSync(langFile)) {
      errorsByLang[lang].missingNamespaces.push(ns)
      totalErrors++
      continue
    }

    let langData = {}
    try {
      langData = JSON.parse(readFileSync(langFile, 'utf8'))
    } catch (err) {
      errorsByLang[lang].emptyValues.push(`${ns}: parse error (${err.message})`)
      totalErrors++
      continue
    }

    const langFlat = flattenKeys(langData)

    // Check missing keys & empty values & placeholders
    for (const key of enKeyList) {
      if (!(key in langFlat)) {
        errorsByLang[lang].missingKeys.push(`${ns}.${key}`)
        totalErrors++
      } else {
        const val = langFlat[key]
        if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
          errorsByLang[lang].emptyValues.push(`${ns}.${key}`)
          totalErrors++
        } else if (typeof val === 'string') {
          const enPlaceholders = extractPlaceholders(enFlat[key])
          const langPlaceholders = extractPlaceholders(val)
          for (const ph of enPlaceholders) {
            if (!langPlaceholders.includes(ph)) {
              errorsByLang[lang].missingPlaceholders.push(`${ns}.${key} (missing ${ph})`)
              totalErrors++
            }
          }
        }
      }
    }

    // Check orphan keys
    for (const key of Object.keys(langFlat)) {
      if (!(key in enFlat)) {
        errorsByLang[lang].orphanKeys.push(`${ns}.${key}`)
        totalErrors++
      }
    }
  }
}

console.log('====================================================')
console.log('       SchoolGiant i18n Guardrail (lint:i18n)       ')
console.log('====================================================')
console.log(`• Languages Audited: ${EXPECTED_LANGUAGES.length} (${EXPECTED_LANGUAGES.join(', ')})`)
console.log(`• Namespaces Audited: ${namespaces.length} per language`)
console.log(`• Translation Keys Audited: ${totalKeysChecked.toLocaleString()} base keys (${(totalKeysChecked * EXPECTED_LANGUAGES.length).toLocaleString()} total checks)`)
console.log('----------------------------------------------------')

let hasFailures = false

for (const lang of targetLanguages) {
  const errs = errorsByLang[lang]
  const count =
    errs.missingNamespaces.length +
    errs.missingKeys.length +
    errs.emptyValues.length +
    errs.missingPlaceholders.length +
    errs.orphanKeys.length

  if (count > 0) {
    hasFailures = true
    console.log(`\n❌ [${lang.toUpperCase()}] ${count} violation(s) found:`)
    if (errs.missingNamespaces.length) {
      console.log(`   - Missing namespaces (${errs.missingNamespaces.length}): ${errs.missingNamespaces.join(', ')}`)
    }
    if (errs.missingKeys.length) {
      console.log(`   - Missing keys (${errs.missingKeys.length}):`)
      errs.missingKeys.slice(0, 10).forEach((k) => console.log(`       * ${k}`))
      if (errs.missingKeys.length > 10) console.log(`       ... and ${errs.missingKeys.length - 10} more`)
    }
    if (errs.emptyValues.length) {
      console.log(`   - Empty / null values (${errs.emptyValues.length}):`)
      errs.emptyValues.slice(0, 10).forEach((k) => console.log(`       * ${k}`))
      if (errs.emptyValues.length > 10) console.log(`       ... and ${errs.emptyValues.length - 10} more`)
    }
    if (errs.missingPlaceholders.length) {
      console.log(`   - Missing placeholders (${errs.missingPlaceholders.length}):`)
      errs.missingPlaceholders.slice(0, 10).forEach((k) => console.log(`       * ${k}`))
    }
    if (errs.orphanKeys.length) {
      console.log(`   - Orphan keys (${errs.orphanKeys.length}):`)
      errs.orphanKeys.slice(0, 10).forEach((k) => console.log(`       * ${k}`))
    }
  } else {
    console.log(`✓ [${lang.toUpperCase()}] 100% Key Parity & Valid Placeholders (${totalKeysChecked} keys)`)
  }
}

console.log('----------------------------------------------------')
if (hasFailures) {
  console.error(`\n❌ i18n Lint Failed with ${totalErrors} issue(s). Key parity across all 12 locales is required.`)
  process.exit(1)
} else {
  console.log(`\n✓ SUCCESS: 100% translation key parity across all 12 languages. Zero missing keys or broken placeholders.`)
  process.exit(0)
}
